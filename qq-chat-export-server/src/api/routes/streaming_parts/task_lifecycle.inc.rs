pub async fn export_streaming_zip(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    create_streaming_task(state, request_id, body, StreamingOutput::HtmlZip).await
}

pub async fn export_streaming_jsonl(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    create_streaming_task(state, request_id, body, StreamingOutput::Jsonl).await
}

async fn create_streaming_task(
    state: SharedState,
    request_id: String,
    body: Value,
    mode: StreamingOutput,
) -> Response {
    let request = match prepare_request(&state, &body).await {
        Ok(request) => request,
        Err(error) => return response::error(&error, &request_id),
    };
    let task_id = format!(
        "disk_stream_{}_{}",
        Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..9]
    );
    let stem = readable_stem(&request.session_name, &request.peer_identity, &task_id);
    let file_name = match mode {
        StreamingOutput::HtmlZip => format!("{stem}_streaming.zip"),
        StreamingOutput::Jsonl => format!("{stem}_chunked_jsonl"),
    };
    let file_path = request.output_dir.join(&file_name);
    if tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
        let error = ApiError::new(
            ErrorType::FileSystem,
            "导出目标已存在，请重新创建任务",
            "EXPORT_TARGET_EXISTS",
        );
        return response::error(&error, &request_id);
    }

    let task = json!({
        "taskId": task_id,
        "peer": { "chatType": request.chat_type, "peerUid": request.peer_uid },
        "sessionName": request.session_name,
        "fileName": file_name,
        "filePath": file_path.to_string_lossy(),
        "downloadUrl": download_url(&file_path, &request.custom_output_dir),
        "messageCount": 0,
        "status": "running",
        "phase": "fetching",
        "progress": 0,
        "createdAt": now_iso(),
        "format": if mode == StreamingOutput::HtmlZip { "STREAMING_ZIP" } else { "STREAMING_JSONL" },
        "filter": request.filter,
        "options": request.options,
    });
    if !register_task(&state, &task).await {
        let error = ApiError::new(
            ErrorType::Api,
            "运行中的导出任务已达到上限",
            "EXPORT_TASK_LIMIT_REACHED",
        )
        .with_status(axum::http::StatusCode::TOO_MANY_REQUESTS);
        return response::error(&error, &request_id);
    }

    let reply = json!({
        "taskId": task_id,
        "sessionName": request.session_name,
        "fileName": file_name,
        "filePath": file_path.to_string_lossy(),
        "downloadUrl": download_url(&file_path, &request.custom_output_dir),
        "messageCount": 0,
        "status": "running",
        "streamingMode": true,
        "diskBacked": true,
    });
    let state_background = Arc::clone(&state);
    tokio::spawn(async move {
        run_streaming_task(state_background, task_id, request, file_name, mode).await;
    });
    response::success(reply, &request_id)
}

async fn run_streaming_task(
    state: SharedState,
    task_id: String,
    request: StreamingRequest,
    file_name: String,
    mode: StreamingOutput,
) {
    let was_cancelled = {
        let cancelled = state.cancelled_task_ids.lock().await;
        cancelled.contains(&task_id)
    };
    let cancel_flag = Arc::new(AtomicBool::new(was_cancelled));
    state
        .running_export_cancel_flags
        .lock()
        .await
        .insert(task_id.clone(), Arc::clone(&cancel_flag));

    let result = if was_cancelled {
        Err("任务已被用户停止".to_string())
    } else {
        process_streaming_task(&state, &task_id, &request, &file_name, mode, &cancel_flag).await
    };

    if let Err(error) = result {
        let cancelled = cancel_flag.load(Ordering::SeqCst)
            || state.cancelled_task_ids.lock().await.contains(&task_id);
        if cancelled {
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "cancelled",
                    "phase": "cancelled",
                    "message": "任务已停止，临时聊天数据已清理",
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_progress",
                "data": {
                    "taskId": task_id,
                    "status": "cancelled",
                    "message": "任务已停止，临时聊天数据已清理",
                }
            }));
        } else {
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "failed",
                    "phase": "failed",
                    "error": error,
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_error",
                "data": { "taskId": task_id, "status": "failed", "error": error },
            }));
        }
    }

    state
        .running_export_cancel_flags
        .lock()
        .await
        .remove(&task_id);
    state.cancelled_task_ids.lock().await.remove(&task_id);
}

#[allow(clippy::too_many_lines)]
async fn process_streaming_task(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    file_name: &str,
    mode: StreamingOutput,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut spool = StreamingMessageSpool::create(&request.output_dir, task_id).await?;
    let include_system_messages = request
        .options
        .get("includeSystemMessages")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut writer = DiskOutputWriter::create(
        &request.output_dir,
        file_name,
        mode,
        task_id,
        include_system_messages,
    )
    .await?;

    let result = process_streaming_inner(
        state,
        task_id,
        request,
        &mut spool,
        &mut writer,
        cancel_flag,
    )
    .await;
    // 错误时 writer 仍是实际输出；成功时它是 finish 前换入的占位目录。
    // 两条路径都清理，保证取消、失败和成功后不残留聊天暂存数据。
    writer.abort().await;
    spool.cleanup().await;
    let (final_path, message_count, resource_summary) = result?;

    let file_size = path_size(&final_path).await;
    let completion_message = resource_summary_message(&resource_summary);
    update_task(
        state,
        task_id,
        json!({
            "status": "completed",
            "phase": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "filePath": final_path.to_string_lossy(),
            "fileSize": file_size,
            "completedAt": now_iso(),
            "fileName": file_name,
            "isZipExport": mode == StreamingOutput::HtmlZip,
            "diskBacked": true,
            "resourceSummary": resource_summary,
        }),
    )
    .await;
    state.broadcast_ws(&json!({
        "type": "export_complete",
        "data": {
            "taskId": task_id,
            "status": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "fileName": file_name,
            "filePath": final_path.to_string_lossy(),
            "fileSize": file_size,
            "downloadUrl": download_url(&final_path, &request.custom_output_dir),
            "isZipExport": mode == StreamingOutput::HtmlZip,
            "diskBacked": true,
            "resourceSummary": resource_summary,
        }
    }));
    let _ = state.db.flush_write_queue().await;
    state.resource_file_cache.lock().await.clear();
    Ok(())
}
