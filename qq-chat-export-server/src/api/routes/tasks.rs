use axum::extract::{Extension, Path, State};
use axum::response::Response;
use serde_json::{json, Value};
use std::path::{Path as FsPath, PathBuf};

use crate::api::path_security::resolve_existing_descendant_within;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// 取任务 createdAt（毫秒），用于排序。
fn created_at_ms(task: &Value) -> i64 {
    match task.get("createdAt") {
        Some(Value::String(s)) => {
            chrono::DateTime::parse_from_rfc3339(s).map_or(0, |dt| dt.timestamp_millis())
        }
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}

/// 把内部任务格式转换为前端 `ExportTask` 接口期望的结构：
/// - `taskId` → 额外加 `id` 字段（前端以 `id` 做匹配）
/// - `filter.startTime` / `filter.endTime` 提升到顶层（前端直接读 `task.startTime`）
fn normalize_task_for_frontend(task: &Value) -> Value {
    let mut t = task.clone();
    if let Some(obj) = t.as_object_mut() {
        if let Some(tid) = obj.get("taskId").cloned() {
            obj.insert("id".to_string(), tid);
        }
        // flatten filter.startTime / filter.endTime
        if let Some(filter) = obj.get("filter").cloned() {
            if !obj.contains_key("startTime") {
                if let Some(v) = filter.get("startTime") {
                    obj.insert("startTime".to_string(), v.clone());
                }
            }
            if !obj.contains_key("endTime") {
                if let Some(v) = filter.get("endTime") {
                    obj.insert("endTime".to_string(), v.clone());
                }
            }
        }
    }
    t
}

fn active_task_delete_error(task: &Value) -> Option<ApiError> {
    matches!(
        task.get("status").and_then(Value::as_str),
        Some("pending" | "running")
    )
    .then(|| {
        ApiError::new(
            ErrorType::Api,
            "任务仍在运行，请先停止任务再删除",
            "TASK_STILL_RUNNING",
        )
        .with_status(axum::http::StatusCode::CONFLICT)
    })
}

fn preserve_cancel_tracking_after_delete(task: &Value) -> bool {
    task.get("status").and_then(Value::as_str) == Some("cancelled")
}

fn original_export_path(task: &Value) -> Option<PathBuf> {
    task.get("originalFilePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            task.get("originalFilesDir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
        })
}

async fn remove_original_export_path(path: &FsPath) -> std::io::Result<()> {
    let metadata = tokio::fs::metadata(path).await?;
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(path).await
    } else {
        tokio::fs::remove_file(path).await
    }
}

/// 在持有 `export_tasks` 锁时完成取消状态转换。
///
/// 这使 worker 的 completed/failed 终态与用户取消形成一次原子竞争：只有先取得
/// 任务锁的一方能提交终态，取消端不会用第二次查表覆盖已经完成的任务。
fn transition_task_to_cancelled(task: &mut Value, completed_at: &str) -> Result<Value, ApiError> {
    let status = task.get("status").and_then(Value::as_str);
    if !matches!(status, Some("pending" | "running")) {
        return Err(ApiError::validation("任务已结束", "TASK_ALREADY_FINISHED"));
    }
    if let Some(obj) = task.as_object_mut() {
        obj.insert("status".to_string(), Value::String("cancelled".to_string()));
        obj.insert(
            "completedAt".to_string(),
            Value::String(completed_at.to_string()),
        );
        obj.insert(
            "message".to_string(),
            Value::String("任务已停止".to_string()),
        );
        if obj.get("taskKind").and_then(Value::as_str) == Some("roaming_export") {
            if let Some(scan) = obj.get_mut("roamingScan").and_then(Value::as_object_mut) {
                scan.insert("partial".to_string(), Value::Bool(true));
                scan.insert(
                    "stopReason".to_string(),
                    Value::String("cancelled".to_string()),
                );
                scan.insert("currentDate".to_string(), Value::Null);
            }
        }
    }
    Ok(task.clone())
}

/// `GET /api/tasks` — 全部导出任务（按创建时间倒序）。
pub async fn list_tasks(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let tasks_guard = state.export_tasks.lock().await;
    let mut tasks: Vec<Value> = tasks_guard
        .values()
        .map(normalize_task_for_frontend)
        .collect();
    drop(tasks_guard);
    tasks.sort_by_key(|task| std::cmp::Reverse(created_at_ms(task)));
    response::success(
        json!({
            "tasks": tasks,
            "totalCount": tasks.len(),
        }),
        &request_id,
    )
}

/// `GET /api/tasks/:taskId` — 单个任务状态。
pub async fn get_task(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(task_id): Path<String>,
) -> Response {
    let tasks = state.export_tasks.lock().await;
    match tasks.get(&task_id) {
        Some(task) => response::success(normalize_task_for_frontend(task), &request_id),
        None => {
            let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
            response::error(&err, &request_id)
        }
    }
}

/// `DELETE /api/tasks/:taskId` — 删除任务（含持久化记录）。
pub async fn delete_task(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(task_id): Path<String>,
) -> Response {
    let preserve_cancel_tracking = {
        let mut tasks = state.export_tasks.lock().await;
        let Some(task) = tasks.get(&task_id) else {
            let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
            return response::error(&err, &request_id);
        };
        if let Some(error) = active_task_delete_error(task) {
            return response::error(&error, &request_id);
        }
        let preserve_cancel_tracking = preserve_cancel_tracking_after_delete(task);
        tasks.remove(&task_id);
        preserve_cancel_tracking
    };
    if !preserve_cancel_tracking {
        {
            let mut cancelled = state.cancelled_task_ids.lock().await;
            cancelled.remove(&task_id);
        }
        {
            let mut flags = state.running_export_cancel_flags.lock().await;
            flags.remove(&task_id);
        }
    }
    if let Err(error) = state.db.delete_task(&task_id).await {
        tracing::warn!("[ApiServer] 删除任务持久化记录失败: {error}");
    }

    state.broadcast_ws(&json!({
        "type": "task_deleted",
        "data": { "taskId": task_id },
    }));

    response::success(
        json!({
            "message": "任务已删除",
            "taskId": task_id,
        }),
        &request_id,
    )
}

/// `POST /api/tasks/:taskId/cancel` — 停止任务（issue #446）。
pub async fn cancel_task(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(task_id): Path<String>,
) -> Response {
    let completed_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let updated_task = {
        let mut tasks = state.export_tasks.lock().await;
        let Some(task) = tasks.get_mut(&task_id) else {
            let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
            return response::error(&err, &request_id);
        };
        let updated_task = match transition_task_to_cancelled(task, &completed_at) {
            Ok(task) => task,
            Err(error) => return response::error(&error, &request_id),
        };

        // 锁顺序固定为 export_tasks → cancelled_task_ids → cancel_flags。worker
        // 不会以相反顺序嵌套获取这些锁；在释放任务锁前发布取消信号，避免 worker
        // 在状态转换与信号注册之间提交 completed/failed。
        {
            let mut cancelled = state.cancelled_task_ids.lock().await;
            cancelled.insert(task_id.clone());
        }
        {
            let flags = state.running_export_cancel_flags.lock().await;
            if let Some(flag) = flags.get(&task_id) {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        // Persist before releasing the task lock. Progress writers use the
        // same boundary, so an older running snapshot cannot land after this
        // forced terminal write and reappear after a restart.
        if let Err(error) = state.db.save_task(&updated_task, &updated_task, true).await {
            tracing::warn!("[ApiServer] 保存取消任务状态失败: {error}");
        }
        updated_task
    };
    let frontend_task = normalize_task_for_frontend(&updated_task);
    state.broadcast_ws(&json!({
        "type": "task_cancelled",
        "data": frontend_task,
    }));

    response::success(frontend_task, &request_id)
}

/// `DELETE /api/tasks/:taskId/original-files` — 删除 ZIP 导出的原始文件。
pub async fn delete_original_files(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(task_id): Path<String>,
) -> Response {
    let task = {
        let tasks = state.export_tasks.lock().await;
        tasks.get(&task_id).cloned()
    };
    let Some(task) = task else {
        let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
        return response::error(&err, &request_id);
    };

    // HTML + exportAsZip 当前保留原始 HTML 文件；兼容旧任务可能记录的目录字段。
    let Some(original_path) = original_export_path(&task) else {
        let err = ApiError::validation("该任务没有可删除的原始文件", "NO_ORIGINAL_FILES");
        return response::error(&err, &request_id);
    };

    let requested_output_dir = task.pointer("/options/outputDir").and_then(Value::as_str);
    let roots = state.path_manager.export_output_roots(requested_output_dir);
    let Some(path) = resolve_existing_descendant_within(&original_path, &roots) else {
        let err = ApiError::validation("路径不在导出目录内", "INVALID_PATH");
        return response::error(&err, &request_id);
    };
    if task
        .get("filePath")
        .and_then(Value::as_str)
        .and_then(|final_path| std::path::Path::new(final_path).canonicalize().ok())
        .is_some_and(|final_path| final_path == path)
    {
        let err = ApiError::validation("原始文件路径不能与最终导出文件相同", "INVALID_PATH");
        return response::error(&err, &request_id);
    }

    if let Err(error) = remove_original_export_path(&path).await {
        let err = ApiError::new(ErrorType::FileSystem, error.to_string(), "DELETE_FAILED");
        return response::error(&err, &request_id);
    }

    let updated_task = {
        let mut tasks = state.export_tasks.lock().await;
        if let Some(task) = tasks.get_mut(&task_id) {
            if let Some(obj) = task.as_object_mut() {
                obj.insert("originalFilePath".to_string(), Value::Null);
                obj.insert("originalFilesDir".to_string(), Value::Null);
                obj.insert("originalFilesDeleted".to_string(), Value::Bool(true));
            }
        }
        tasks.get(&task_id).cloned()
    };
    if let Some(updated_task) = updated_task {
        if let Err(error) = state.db.save_task(&updated_task, &updated_task, true).await {
            tracing::warn!("[ApiServer] 保存原始文件删除状态失败: {error}");
        } else if let Err(error) = state.db.flush_write_queue().await {
            tracing::warn!("[ApiServer] 刷新原始文件删除状态失败: {error}");
        }
    }

    response::success(
        json!({
            "message": "原始文件已删除",
            "taskId": task_id,
        }),
        &request_id,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        active_task_delete_error, normalize_task_for_frontend, original_export_path,
        preserve_cancel_tracking_after_delete, remove_original_export_path,
        transition_task_to_cancelled,
    };
    use axum::http::StatusCode;
    use serde_json::{json, Value};
    use std::collections::HashSet;

    #[test]
    fn delete_requires_active_tasks_to_be_cancelled_first() {
        for status in ["pending", "running"] {
            let error = active_task_delete_error(&json!({"status": status}))
                .expect("active task must conflict");
            assert_eq!(error.status, StatusCode::CONFLICT);
            assert_eq!(error.code, "TASK_STILL_RUNNING");
        }
        for status in ["completed", "failed", "cancelled"] {
            assert!(active_task_delete_error(&json!({"status": status})).is_none());
        }
    }

    #[test]
    fn cancel_then_delete_preserves_marker_until_worker_registration() {
        let task_id = "export_fixture".to_string();
        let mut cancelled_task_ids = HashSet::from([task_id.clone()]);
        let cancelled_task = json!({"taskId": task_id, "status": "cancelled"});

        if !preserve_cancel_tracking_after_delete(&cancelled_task) {
            cancelled_task_ids.remove("export_fixture");
        }

        assert!(cancelled_task_ids.contains("export_fixture"));
    }

    #[test]
    fn cancelled_http_and_websocket_payload_use_frontend_task_shape() {
        let payload = normalize_task_for_frontend(&json!({
            "taskId": "export_fixture",
            "status": "cancelled",
            "message": "任务已停止",
            "filter": {"startTime": 1_672_531_200, "endTime": 1_672_617_599}
        }));

        assert_eq!(payload["id"], "export_fixture");
        assert_eq!(payload["taskId"], "export_fixture");
        assert_eq!(payload["status"], "cancelled");
        assert_eq!(payload["message"], "任务已停止");
        assert_eq!(payload["startTime"], 1_672_531_200_i64);
        assert_eq!(payload["endTime"], 1_672_617_599_i64);
    }

    #[test]
    fn cancellation_transition_is_atomic_and_never_overwrites_a_terminal_task() {
        for status in ["pending", "running"] {
            let mut task = json!({
                "taskId": "export_fixture",
                "taskKind": "roaming_export",
                "status": status,
                "roamingScan": {
                    "probedDays": 7,
                    "partial": false,
                    "stopReason": "running",
                    "currentDate": "2023-01-07"
                }
            });
            let updated = transition_task_to_cancelled(&mut task, "2026-09-02T00:00:00.000Z")
                .expect("active task can transition once");
            assert_eq!(updated["status"], "cancelled");
            assert_eq!(updated["message"], "任务已停止");
            assert_eq!(updated["completedAt"], "2026-09-02T00:00:00.000Z");
            assert_eq!(updated["roamingScan"]["probedDays"], 7);
            assert_eq!(updated["roamingScan"]["partial"], true);
            assert_eq!(updated["roamingScan"]["stopReason"], "cancelled");
            assert_eq!(updated["roamingScan"]["currentDate"], Value::Null);
        }

        // 模拟 worker 在 cancel 路由取得同一把任务锁前先提交终态。CAS 式 helper
        // 必须拒绝该转换，且不能改写 worker 已提交的结果。
        for status in ["completed", "failed", "cancelled"] {
            let mut task = json!({"taskId": "export_fixture", "status": status});
            let before = task.clone();
            let error = transition_task_to_cancelled(&mut task, "2026-09-02T00:00:00.000Z")
                .expect_err("terminal task cannot be cancelled again");
            assert_eq!(error.code, "TASK_ALREADY_FINISHED");
            assert_eq!(task, before);
        }
    }

    #[tokio::test]
    async fn original_export_cleanup_uses_persisted_field_and_handles_files_or_directories() {
        let root = std::env::temp_dir().join(format!(
            "qce-original-export-cleanup-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let original_file = root.join("chat.html");
        let legacy_dir = root.join("legacy-assets");
        std::fs::write(&original_file, "fixture").expect("create original file");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(legacy_dir.join("asset.bin"), "fixture").expect("create legacy asset");

        let current = json!({
            "originalFilePath": original_file.to_string_lossy(),
            "originalFilesDir": legacy_dir.to_string_lossy()
        });
        assert_eq!(original_export_path(&current), Some(original_file.clone()));
        remove_original_export_path(&original_file)
            .await
            .expect("remove original HTML file");
        assert!(!original_file.exists());

        let legacy = json!({"originalFilesDir": legacy_dir.to_string_lossy()});
        assert_eq!(original_export_path(&legacy), Some(legacy_dir.clone()));
        let null_current = json!({
            "originalFilePath": null,
            "originalFilesDir": legacy_dir.to_string_lossy()
        });
        assert_eq!(
            original_export_path(&null_current),
            Some(legacy_dir.clone())
        );
        remove_original_export_path(&legacy_dir)
            .await
            .expect("remove legacy original directory");
        assert!(!legacy_dir.exists());

        std::fs::remove_dir_all(root).expect("remove fixture root");
    }
}
