use std::collections::HashMap;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};

use crate::api::path_security::resolve_for_creation_within;
use crate::api::response::{self, ApiError, RequestId};
use crate::api::state::SharedState;

const MAX_SCHEDULED_EXPORTS: usize = 128;
const MAX_NAME_LENGTH: usize = 128;
const MAX_IDENTIFIER_LENGTH: usize = 256;

fn validate_string_field(
    body: &Value,
    key: &str,
    required: bool,
    max_length: usize,
) -> Result<(), ApiError> {
    let Some(value) = body.get(key) else {
        return if required {
            Err(ApiError::validation(
                format!("缺少必填字段: {key}"),
                "MISSING_REQUIRED_FIELD",
            ))
        } else {
            Ok(())
        };
    };
    let Some(value) = value.as_str() else {
        return Err(ApiError::validation(
            format!("{key} 必须是字符串"),
            "INVALID_FIELD_TYPE",
        ));
    };
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_length || value.chars().any(char::is_control)
    {
        return Err(ApiError::validation(
            format!("{key} 无效"),
            "INVALID_FIELD_VALUE",
        ));
    }
    Ok(())
}

/// 校验创建 / 更新请求体的必填字段。
fn validate_config(body: &Value, partial: bool) -> Result<(), ApiError> {
    if !body.is_object() {
        return Err(ApiError::validation("请求体必须是对象", "INVALID_BODY"));
    }
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
    }

    validate_string_field(body, "name", !partial, MAX_NAME_LENGTH)?;
    validate_string_field(body, "scheduleType", !partial, 16)?;
    validate_string_field(body, "timeRangeType", !partial, 32)?;
    validate_string_field(body, "format", !partial, 16)?;

    if let Some(schedule_type) = body.get("scheduleType").and_then(Value::as_str) {
        if !matches!(schedule_type, "daily" | "weekly" | "monthly" | "custom") {
            return Err(ApiError::validation(
                "scheduleType 无效",
                "INVALID_SCHEDULE_TYPE",
            ));
        }
        if schedule_type == "custom" {
            validate_string_field(body, "cronExpression", true, 128)?;
            let expression = body["cronExpression"].as_str().unwrap_or_default();
            if expression.split_whitespace().count() != 5 {
                return Err(ApiError::validation("cronExpression 无效", "INVALID_CRON"));
            }
        }
    }
    if body.get("cronExpression").is_some() {
        validate_string_field(body, "cronExpression", true, 128)?;
        if body["cronExpression"]
            .as_str()
            .unwrap_or_default()
            .split_whitespace()
            .count()
            != 5
        {
            return Err(ApiError::validation("cronExpression 无效", "INVALID_CRON"));
        }
    }
    if let Some(time_range_type) = body.get("timeRangeType").and_then(Value::as_str) {
        if !matches!(
            time_range_type,
            "yesterday" | "last-week" | "last-month" | "last-7-days" | "last-30-days" | "custom"
        ) {
            return Err(ApiError::validation(
                "timeRangeType 无效",
                "INVALID_TIME_RANGE",
            ));
        }
        if time_range_type == "custom" {
            let range = body
                .get("customTimeRange")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    ApiError::validation("customTimeRange 无效", "INVALID_TIME_RANGE")
                })?;
            let start = range.get("startTime").and_then(Value::as_i64);
            let end = range.get("endTime").and_then(Value::as_i64);
            if !matches!((start, end), (Some(start), Some(end)) if start <= end) {
                return Err(ApiError::validation(
                    "customTimeRange 无效",
                    "INVALID_TIME_RANGE",
                ));
            }
        }
    }
    if body.get("customTimeRange").is_some() {
        let range = body
            .get("customTimeRange")
            .and_then(Value::as_object)
            .ok_or_else(|| ApiError::validation("customTimeRange 无效", "INVALID_TIME_RANGE"))?;
        let start = range.get("startTime").and_then(Value::as_i64);
        let end = range.get("endTime").and_then(Value::as_i64);
        if !matches!((start, end), (Some(start), Some(end)) if start <= end) {
            return Err(ApiError::validation(
                "customTimeRange 无效",
                "INVALID_TIME_RANGE",
            ));
        }
    }
    if let Some(format) = body.get("format").and_then(Value::as_str) {
        if !matches!(
            format.to_ascii_uppercase().as_str(),
            "HTML" | "JSON" | "TXT" | "EXCEL"
        ) {
            return Err(ApiError::validation("format 无效", "INVALID_FORMAT"));
        }
    }
    if let Some(execute_time) = body.get("executeTime") {
        let valid = execute_time.as_str().is_some_and(|value| {
            let mut parts = value.split(':');
            matches!(
                (parts.next(), parts.next(), parts.next()),
                (Some(hour), Some(minute), None)
                    if hour.len() == 2
                        && minute.len() == 2
                        && hour.parse::<u8>().is_ok_and(|value| value < 24)
                        && minute.parse::<u8>().is_ok_and(|value| value < 60)
            )
        });
        if !valid {
            return Err(ApiError::validation(
                "executeTime 无效",
                "INVALID_EXECUTE_TIME",
            ));
        }
    }
    if let Some(peer) = body.get("peer") {
        let peer = peer
            .as_object()
            .ok_or_else(|| ApiError::validation("peer 必须是对象", "INVALID_PEER"))?;
        let peer_uid = peer.get("peerUid").and_then(Value::as_str).map(str::trim);
        if peer_uid.is_none_or(|value| {
            value.is_empty()
                || value.chars().count() > MAX_IDENTIFIER_LENGTH
                || value.chars().any(char::is_control)
        }) {
            return Err(ApiError::validation("peer.peerUid 无效", "INVALID_PEER"));
        }
        if peer.get("chatType").and_then(Value::as_i64).is_none() {
            return Err(ApiError::validation("peer.chatType 无效", "INVALID_PEER"));
        }
    }
    if let Some(options) = body.get("options") {
        if !options.is_object() {
            return Err(ApiError::validation(
                "options 必须是对象",
                "INVALID_OPTIONS",
            ));
        }
    }
    Ok(())
}

fn validate_output_dir(state: &SharedState, body: &Value) -> Result<(), ApiError> {
    let Some(output_dir) = body.get("outputDir") else {
        return Ok(());
    };
    let Some(output_dir) = output_dir.as_str() else {
        return Err(ApiError::validation(
            "outputDir 必须是字符串",
            "INVALID_PATH",
        ));
    };
    let output_dir = output_dir.trim();
    if output_dir.is_empty() {
        return Ok(());
    }
    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
    ];
    if resolve_for_creation_within(std::path::Path::new(output_dir), &roots).is_none() {
        return Err(ApiError::validation(
            "outputDir 必须位于允许的导出目录内",
            "INVALID_PATH",
        ));
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
    if let Err(err) = validate_output_dir(&state, &body) {
        return response::error(&err, &request_id);
    }
    if state
        .scheduled_export_manager
        .all_scheduled_exports()
        .await
        .len()
        >= MAX_SCHEDULED_EXPORTS
    {
        let err = ApiError::validation("定时导出任务已达到上限", "SCHEDULE_LIMIT_REACHED");
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
    if let Err(err) = validate_output_dir(&state, &body) {
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
    if state
        .scheduled_export_manager
        .delete_scheduled_export(&id)
        .await
    {
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
    match state
        .scheduled_export_manager
        .trigger_scheduled_export(&id)
        .await
    {
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
        .map_or(50, |l| l.min(100));
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

#[cfg(test)]
mod tests {
    use super::validate_config;
    use serde_json::json;

    fn valid_config() -> serde_json::Value {
        json!({
            "name": "daily export",
            "peer": { "chatType": 2, "peerUid": "123" },
            "scheduleType": "daily",
            "executeTime": "02:00",
            "timeRangeType": "yesterday",
            "format": "HTML",
            "options": {}
        })
    }

    #[test]
    fn accepts_valid_scheduled_export() {
        assert!(validate_config(&valid_config(), false).is_ok());
    }

    #[test]
    fn rejects_invalid_types_enums_and_ranges() {
        let mut config = valid_config();
        config["name"] = json!({});
        assert!(validate_config(&config, false).is_err());

        let mut config = valid_config();
        config["scheduleType"] = json!("custom");
        config["cronExpression"] = json!("* * *");
        assert!(validate_config(&config, false).is_err());

        let mut config = valid_config();
        config["timeRangeType"] = json!("custom");
        config["customTimeRange"] = json!({ "startTime": 10, "endTime": 1 });
        assert!(validate_config(&config, false).is_err());
    }
}
