//! 用户路由：详情 / 按 QQ 号反查（issue #204）。

use std::collections::HashMap;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use serde_json::Value;

use crate::api::helpers::lookup_user_by_uin;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// `GET /api/users/lookup?uin=` — 按 QQ 号反查用户（issue #204）。
///
/// 未找到时也返回 200 + `found: false`，非错误。
pub async fn lookup_user(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let uin = params.get("uin").map_or("", String::as_str);
    if uin.trim().is_empty() {
        let err = ApiError::validation("uin 参数不能为空", "INVALID_UIN");
        return response::error(&err, &request_id);
    }
    let result = lookup_user_by_uin(uin, &state.napcat).await;
    response::success(result, &request_id)
}

/// `GET /api/users/:uid` — 用户详细信息。
pub async fn user_detail(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(uid): Path<String>,
) -> Response {
    if uid.is_empty() {
        let err = ApiError::validation("用户ID不能为空", "INVALID_UID");
        return response::error(&err, &request_id);
    }
    match state.napcat.get_user_detail_info(&uid).await {
        Ok(Value::Null) => {
            let err = ApiError::new(ErrorType::Api, "用户不存在", "USER_NOT_FOUND");
            response::error(&err, &request_id)
        }
        Ok(detail) => response::success(detail, &request_id),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "USER_DETAIL_FAILED");
            response::error(&err, &request_id)
        }
    }
}
