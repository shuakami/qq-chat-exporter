async fn prepare_request(state: &SharedState, body: &Value) -> Result<StreamingRequest, ApiError> {
    let peer = body
        .get("peer")
        .ok_or_else(|| ApiError::validation("peer参数不完整", "INVALID_PEER"))?;
    let chat_type = loose_i64(peer.get("chatType"))
        .ok_or_else(|| ApiError::validation("chatType无效", "INVALID_PEER"))?;
    let raw_peer_uid = peer
        .get("peerUid")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("peerUid无效", "INVALID_PEER"))?;
    let peer_uid = resolve_peer_uid(chat_type, raw_peer_uid, &state.napcat).await;
    let peer_uin = peer
        .get("peerUin")
        .and_then(Value::as_str)
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))
        .map(str::to_string)
        .or_else(|| {
            (chat_type != GROUP_CHAT_TYPE
                && raw_peer_uid
                    .chars()
                    .all(|character| character.is_ascii_digit()))
            .then(|| raw_peer_uid.to_string())
        });
    let filter = body.get("filter").cloned().unwrap_or(Value::Null);
    let options = body.get("options").cloned().unwrap_or(Value::Null);
    let session_name = match body
        .get("sessionName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => resolve_session_name(chat_type, &peer_uid, &state.napcat).await,
    };
    let custom_output_dir = PathManager::sanitize_path(
        options
            .get("outputDir")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let requested = if custom_output_dir.is_empty() {
        state.path_manager.exports_dir()
    } else {
        PathBuf::from(&custom_output_dir)
    };
    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
    ];
    let output_dir = crate::api::path_security::resolve_for_creation_within(&requested, &roots)
        .ok_or_else(|| ApiError::validation("导出目录不在允许范围内", "INVALID_PATH"))?;
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| {
            ApiError::new(
                ErrorType::FileSystem,
                format!("无法创建导出目录: {error}"),
                "CREATE_EXPORT_DIR_FAILED",
            )
        })?;
    Ok(StreamingRequest {
        chat_type,
        peer_uid: peer_uid.clone(),
        peer_identity: if chat_type == GROUP_CHAT_TYPE {
            raw_peer_uid.to_string()
        } else {
            peer_uin.clone().unwrap_or_else(|| peer_uid.clone())
        },
        peer_uin,
        session_name,
        filter,
        options,
        output_dir,
        custom_output_dir,
    })
}

async fn register_task(state: &SharedState, task: &Value) -> bool {
    let task_id = task
        .get("taskId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    {
        let mut tasks = state.export_tasks.lock().await;
        let active = tasks
            .values()
            .filter(|task| {
                matches!(
                    task.get("status").and_then(Value::as_str),
                    Some("pending" | "running")
                )
            })
            .count();
        if active >= MAX_ACTIVE_EXPORT_TASKS {
            return false;
        }
        tasks.insert(task_id, task.clone());
    }
    if let Err(error) = state.db.save_task(task, task, true).await {
        tracing::warn!("[DiskStreaming] 保存任务失败: {error}");
    }
    true
}

async fn update_task(state: &SharedState, task_id: &str, patch: Value) {
    let updated = {
        let mut tasks = state.export_tasks.lock().await;
        let Some(task) = tasks.get_mut(task_id) else {
            return;
        };
        if task.get("status").and_then(Value::as_str) == Some("cancelled")
            && patch.get("status").and_then(Value::as_str) != Some("cancelled")
        {
            return;
        }
        if let (Some(target), Some(source)) = (task.as_object_mut(), patch.as_object()) {
            for (key, value) in source {
                if value.is_null() {
                    target.remove(key);
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
        task.clone()
    };
    if let Err(error) = state.db.save_task(&updated, &updated, false).await {
        tracing::warn!("[DiskStreaming] 更新任务失败: {error}");
    }
}

#[allow(clippy::too_many_arguments)]
async fn progress(
    state: &SharedState,
    task_id: &str,
    value: i64,
    phase: &str,
    message: &str,
    count: usize,
    batch_count: usize,
    waiting_seconds: Option<u64>,
) {
    let patch = json!({
        "status": "running",
        "progress": value,
        "phase": phase,
        "message": message,
        "messageCount": count,
        "batchCount": batch_count,
        "lastActivityAt": now_iso(),
        "waitingSeconds": waiting_seconds,
        "diskBacked": true,
    });
    update_task(state, task_id, patch).await;
    broadcast_progress(
        state,
        task_id,
        value,
        phase,
        message,
        count,
        batch_count,
        waiting_seconds,
    );
}

#[allow(clippy::too_many_arguments)]
fn broadcast_progress(
    state: &SharedState,
    task_id: &str,
    value: i64,
    phase: &str,
    message: &str,
    count: usize,
    batch_count: usize,
    waiting_seconds: Option<u64>,
) {
    state.broadcast_ws(&json!({
        "type": "export_progress",
        "data": {
            "taskId": task_id,
            "status": "running",
            "progress": value,
            "phase": phase,
            "message": message,
            "messageCount": count,
            "batchCount": batch_count,
            "lastActivityAt": now_iso(),
            "waitingSeconds": waiting_seconds,
            "diskBacked": true,
        }
    }));
}

async fn ensure_running(
    state: &SharedState,
    task_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    if cancel_flag.load(Ordering::SeqCst) || state.cancelled_task_ids.lock().await.contains(task_id)
    {
        return Err("任务已被用户停止".to_string());
    }
    Ok(())
}

async fn fetch_group_member_maps(
    state: &SharedState,
    peer_uid: &str,
    chat_type: i64,
) -> GroupMemberMaps {
    if chat_type != GROUP_CHAT_TYPE {
        return GroupMemberMaps::default();
    }
    let Ok(response) = state.napcat.get_group_member_all(peer_uid, false).await else {
        return GroupMemberMaps::default();
    };
    let Some(infos) = response
        .pointer("/result/infos")
        .or_else(|| response.get("infos"))
        .and_then(Value::as_object)
    else {
        return GroupMemberMaps::default();
    };
    let mut maps = GroupMemberMaps::default();
    for (uid, member) in infos {
        let uin = member
            .get("uin")
            .map(|value| match value {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default();
        if let Some(card) = member
            .get("cardName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            maps.cards.insert(uid.clone(), card.to_string());
            if !uin.is_empty() {
                maps.cards.insert(uin.clone(), card.to_string());
            }
        }
        if let Some(title) = ["memberSpecialTitle", "specialTitle", "title"]
            .iter()
            .find_map(|key| member.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            maps.titles.insert(uid.clone(), title.to_string());
            if !uin.is_empty() {
                maps.titles.insert(uin, title.to_string());
            }
        }
    }
    maps
}

fn apply_group_member_maps(messages: &mut [Value], maps: &GroupMemberMaps) {
    for message in messages {
        let needs_name = message
            .get("sendMemberName")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty());
        if !needs_name {
            continue;
        }
        let uid = message
            .get("senderUid")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let uin = message
            .get("senderUin")
            .map(|value| match value {
                Value::String(value) => value.as_str().to_string(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default();
        if let Some(name) = maps.cards.get(uid).or_else(|| maps.cards.get(&uin)) {
            if let Some(object) = message.as_object_mut() {
                object.insert("sendMemberName".to_string(), Value::String(name.clone()));
            }
        }
    }
}

fn apply_sender_filter(messages: Vec<Value>, filter: &Value) -> Vec<Value> {
    let normalize = |key: &str| -> HashSet<String> {
        filter
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| match item {
                        Value::String(value) => Some(value.trim().to_string()),
                        Value::Number(value) => Some(value.to_string()),
                        _ => None,
                    })
                    .filter(|value| !value.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };
    let include = normalize("includeUserUins");
    let exclude = normalize("excludeUserUins");
    if include.is_empty() && exclude.is_empty() {
        return messages;
    }
    messages
        .into_iter()
        .filter(|message| {
            let uin = message
                .get("senderUin")
                .map(|value| match value {
                    Value::String(value) => value.clone(),
                    Value::Number(value) => value.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            (include.is_empty() || include.contains(&uin)) && !exclude.contains(&uin)
        })
        .collect()
}
