//! 任务路由：列表 / 详情 / 删除 / 停止（issue #446）/ 删除 ZIP 原始文件。

use axum::extract::{Extension, Path, State};
use axum::response::Response;
use serde_json::{json, Value};

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// 取任务 createdAt（毫秒），用于排序。
fn created_at_ms(task: &Value) -> i64 {
    match task.get("createdAt") {
        Some(Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(0),
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}

/// `GET /api/tasks` — 全部导出任务（按创建时间倒序）。
pub async fn list_tasks(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let tasks_guard = state.export_tasks.lock().await;
    let mut tasks: Vec<Value> = tasks_guard.values().cloned().collect();
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
        Some(task) => response::success(task.clone(), &request_id),
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
    let removed = {
        let mut tasks = state.export_tasks.lock().await;
        tasks.remove(&task_id)
    };
    if removed.is_none() {
        let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
        return response::error(&err, &request_id);
    }
    {
        let mut cancelled = state.cancelled_task_ids.lock().await;
        cancelled.remove(&task_id);
    }
    {
        let mut flags = state.running_export_cancel_flags.lock().await;
        flags.remove(&task_id);
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
    let exists = {
        let tasks = state.export_tasks.lock().await;
        tasks.contains_key(&task_id)
    };
    if !exists {
        let err = ApiError::not_found("任务不存在", "TASK_NOT_FOUND");
        return response::error(&err, &request_id);
    }

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

    let updated_task = {
        let mut tasks = state.export_tasks.lock().await;
        if let Some(task) = tasks.get_mut(&task_id) {
            if let Some(obj) = task.as_object_mut() {
                obj.insert("status".to_string(), Value::String("cancelled".to_string()));
                obj.insert(
                    "endTime".to_string(),
                    Value::String(
                        chrono::Utc::now()
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    ),
                );
            }
            Some(task.clone())
        } else {
            None
        }
    };

    if let Some(task) = &updated_task {
        state.broadcast_ws(&json!({
            "type": "task_cancelled",
            "data": task,
        }));
    }

    response::success(
        json!({
            "message": "任务已停止",
            "taskId": task_id,
        }),
        &request_id,
    )
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

    // 只有流式 ZIP 任务保留了原始目录。
    let original_dir = task
        .get("originalFilesDir")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let Some(original_dir) = original_dir.filter(|d| !d.is_empty()) else {
        let err = ApiError::validation("该任务没有可删除的原始文件", "NO_ORIGINAL_FILES");
        return response::error(&err, &request_id);
    };

    let path = std::path::PathBuf::from(&original_dir);
    // 安全约束：只允许删除导出目录内的路径。
    let exports_dir = state.path_manager.exports_dir();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();
    if !(path.starts_with(&exports_dir) || path.starts_with(&scheduled_dir)) {
        let err = ApiError::validation("路径不在导出目录内", "INVALID_PATH");
        return response::error(&err, &request_id);
    }

    if path.exists() {
        if let Err(error) = tokio::fs::remove_dir_all(&path).await {
            let err = ApiError::new(ErrorType::FileSystem, error.to_string(), "DELETE_FAILED");
            return response::error(&err, &request_id);
        }
    }

    {
        let mut tasks = state.export_tasks.lock().await;
        if let Some(task) = tasks.get_mut(&task_id) {
            if let Some(obj) = task.as_object_mut() {
                obj.insert("originalFilesDir".to_string(), Value::Null);
                obj.insert("originalFilesDeleted".to_string(), Value::Bool(true));
            }
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
