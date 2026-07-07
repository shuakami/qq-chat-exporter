//! 定时导出路由：CRUD / 手动触发 / 全量触发 / 执行历史。

use std::collections::HashMap;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};

use crate::api::response::{self, ApiError, RequestId};
use crate::api::state::SharedState;

/// 校验创建 / 更新请求体的必填字段。
fn validate_config(body: &Value, partial: bool) -> Result<(), ApiError> {
    let required: [&str; 5] = ["name", "peer", "scheduleType", "timeRangeType", "format"];
    if !partial {
        for key in required {
            if body.get(key).is_none() || body.get(key) == Some(&Value::Null) {
                return Err(ApiError::validation(
                    format!("缺少必填字段: {key}"),
                    "MISSING_REQUIRED_FIELD",
                ));
            }
        }
        let peer = body.get("peer").cloned().unwrap_or(Value::Null);
        if peer.get("peerUid").and_then(Value::as_str).unwrap_or("").is_empty() {
            return Err(ApiError::validation("peer.peerUid 不能为空", "INVALID_PEER"));
        }
    }
    Ok(())
}

/// `POST /api/scheduled-exports` — 创建定时导出。
pub async fn create_scheduled_export(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(err) = validate_config(&body, false) {
        return response::error(&err, &request_id);
    }
    let config = state
        .scheduled_export_manager
        .create_scheduled_export(body)
        .await;
    response::success(config, &request_id)
}

/// `GET /api/scheduled-exports` — 全部定时导出。
pub async fn list_scheduled_exports(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let configs = state.scheduled_export_manager.all_scheduled_exports().await;
    response::success(
        json!({
            "scheduledExports": configs,
            "totalCount": configs.len(),
        }),
        &request_id,
    )
}

/// `POST /api/scheduled-exports/trigger-all` — 触发全部定时导出。
pub async fn trigger_all_scheduled_exports(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    body: Option<Json<Value>>,
) -> Response {
    let include_disabled = body
        .as_ref()
        .and_then(|Json(b)| b.get("includeDisabled").and_then(Value::as_bool))
        .unwrap_or(false);
    let triggered = state
        .scheduled_export_manager
        .trigger_all_scheduled_exports(include_disabled)
        .await;
    response::success(
        json!({
            "message": format!("已触发 {} 个定时导出任务", triggered.len()),
            "triggeredCount": triggered.len(),
            "triggered": triggered,
        }),
        &request_id,
    )
}

/// `GET /api/scheduled-exports/:id` — 单个定时导出。
pub async fn get_scheduled_export(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(id): Path<String>,
) -> Response {
    match state.scheduled_export_manager.scheduled_export(&id).await {
        Some(config) => response::success(config, &request_id),
        None => {
            let err = ApiError::not_found("定时导出不存在", "SCHEDULED_EXPORT_NOT_FOUND");
            response::error(&err, &request_id)
        }
    }
}

/// `PUT /api/scheduled-exports/:id` — 更新定时导出。
pub async fn update_scheduled_export(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(err) = validate_config(&body, true) {
        return response::error(&err, &request_id);
    }
    match state
        .scheduled_export_manager
        .update_scheduled_export(&id, body)
        .await
    {
        Some(config) => response::success(config, &request_id),
        None => {
            let err = ApiError::not_found("定时导出不存在", "SCHEDULED_EXPORT_NOT_FOUND");
            response::error(&err, &request_id)
        }
    }
}

/// `DELETE /api/scheduled-exports/:id` — 删除定时导出。
pub async fn delete_scheduled_export(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(id): Path<String>,
) -> Response {
    if state.scheduled_export_manager.delete_scheduled_export(&id).await {
        response::success(
            json!({
                "message": "定时导出已删除",
                "id": id,
            }),
            &request_id,
        )
    } else {
        let err = ApiError::not_found("定时导出不存在", "SCHEDULED_EXPORT_NOT_FOUND");
        response::error(&err, &request_id)
    }
}

/// `POST /api/scheduled-exports/:id/trigger` — 手动触发。
pub async fn trigger_scheduled_export(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(id): Path<String>,
) -> Response {
    match state.scheduled_export_manager.trigger_scheduled_export(&id).await {
        Some(result) => response::success(result, &request_id),
        None => {
            let err = ApiError::not_found("定时导出不存在", "SCHEDULED_EXPORT_NOT_FOUND");
            response::error(&err, &request_id)
        }
    }
}

/// `GET /api/scheduled-exports/:id/history` — 执行历史（默认 50 条）。
pub async fn scheduled_export_history(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|l| *l >= 1)
        .unwrap_or(50);
    let history = state
        .scheduled_export_manager
        .execution_history(&id, limit)
        .await;
    response::success(
        json!({
            "history": history,
            "totalCount": history.len(),
        }),
        &request_id,
    )
}
