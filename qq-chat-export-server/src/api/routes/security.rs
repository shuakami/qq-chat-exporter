use axum::body::Body;
use axum::extract::{Extension, State};
use axum::http::Request;
use axum::response::Response;
use serde_json::{json, Value};

use crate::api::middleware::client_ip;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::security::VerifyTokenReason;

/// 服务器地址信息。
fn server_addresses(state: &SharedState) -> Value {
    let port = state.port;
    let mut result = json!({ "local": format!("http://127.0.0.1:{port}") });
    if let Some(public_ip) = state.security_manager.public_ip() {
        if public_ip != "127.0.0.1" && public_ip != "localhost" {
            if let Some(obj) = result.as_object_mut() {
                obj.insert(
                    "external".to_string(),
                    Value::String(format!("http://{public_ip}:{port}")),
                );
            }
        }
    }
    result
}

/// `GET /security-status` — 安全状态检查。
pub async fn security_status(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    _request: Request<Body>,
) -> Response {
    let mut status = state.security_manager.security_status();
    if let Some(obj) = status.as_object_mut() {
        obj.insert("requiresAuth".to_string(), Value::Bool(true));
        obj.remove("publicIP");
        obj.remove("createdAt");
        obj.remove("lastAccess");
    }
    response::success(status, &request_id)
}

/// `POST /auth` — 认证验证端点。
pub async fn auth(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    request: Request<Body>,
) -> Response {
    let ip = client_ip(&request);
    let Ok(body_bytes) = axum::body::to_bytes(request.into_body(), 4096).await else {
        let err = ApiError::validation("缺少访问令牌", "MISSING_TOKEN");
        return response::error(&err, &request_id);
    };
    let body: Value = serde_json::from_slice(&body_bytes).unwrap_or(Value::Null);
    let Some(token) = body
        .get("token")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
    else {
        let err = ApiError::validation("缺少访问令牌", "MISSING_TOKEN");
        return response::error(&err, &request_id);
    };

    match state
        .security_manager
        .verify_token_with_reason(token, ip.as_deref())
    {
        Ok(()) => response::success(
            json!({
                "authenticated": true,
                "message": "认证成功",
                "serverIP": state.security_manager.public_ip(),
                "clientIP": ip,
            }),
            &request_id,
        ),
        Err(reason) => {
            let (code, message) = match reason {
                VerifyTokenReason::TokenExpired => {
                    ("TOKEN_EXPIRED", "访问令牌已过期，请在控制台重新获取".to_string())
                }
                VerifyTokenReason::IpNotAllowed => (
                    "IP_NOT_ALLOWED",
                    format!(
                        "客户端 IP{} 不在 IP 白名单内（可在 security.json 中关闭 IP 白名单或加入当前 IP）",
                        ip.as_deref().map(|v| format!(" {v}")).unwrap_or_default()
                    ),
                ),
                VerifyTokenReason::InvalidToken => ("INVALID_TOKEN", "无效的访问令牌".to_string()),
            };
            let err = ApiError::new(ErrorType::Auth, message, code)
                .with_status(axum::http::StatusCode::FORBIDDEN);
            response::error(&err, &request_id)
        }
    }
}

fn valid_ip_rule(value: &str) -> bool {
    if value == "*" || value == "0.0.0.0" {
        return true;
    }
    if value.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    let Some((address, prefix)) = value.split_once('/') else {
        return false;
    };
    address.parse::<std::net::Ipv4Addr>().is_ok()
        && prefix.parse::<u8>().is_ok_and(|bits| bits <= 32)
}

/// `POST /api/server/host` — 更新服务器地址配置。
pub async fn update_server_host(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    axum::Json(body): axum::Json<Value>,
) -> Response {
    let Some(host) = body.get("host").and_then(Value::as_str).map(str::trim) else {
        let err = ApiError::validation("服务器地址不能为空", "INVALID_HOST");
        return response::error(&err, &request_id);
    };
    let valid_host = !host.is_empty()
        && host.len() <= 255
        && !host.chars().any(char::is_control)
        && !host.contains(['/', '\\', ':']);
    if !valid_host {
        let err = ApiError::validation("服务器地址格式无效", "INVALID_HOST");
        return response::error(&err, &request_id);
    }
    state.security_manager.update_server_host(host);
    response::success(
        json!({
            "message": "服务器地址更新成功",
            "serverAddresses": server_addresses(&state),
        }),
        &request_id,
    )
}

/// `GET /api/security/ip-whitelist` — 获取 IP 白名单配置。
pub async fn get_ip_whitelist(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    request: Request<Body>,
) -> Response {
    response::success(
        json!({
            "allowedIPs": state.security_manager.allowed_ips(),
            "disabled": state.security_manager.is_ip_whitelist_disabled(),
            "isDocker": state.security_manager.is_in_docker(),
            "currentClientIP": client_ip(&request),
        }),
        &request_id,
    )
}

/// `POST /api/security/ip-whitelist` — 添加 IP 到白名单。
pub async fn add_ip_whitelist(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    axum::Json(body): axum::Json<Value>,
) -> Response {
    let Some(ip) = body.get("ip").and_then(Value::as_str).map(str::trim) else {
        let err = ApiError::validation("IP地址不能为空", "INVALID_IP");
        return response::error(&err, &request_id);
    };
    if !valid_ip_rule(ip) {
        let err = ApiError::validation("IP地址或CIDR格式无效", "INVALID_IP");
        return response::error(&err, &request_id);
    }
    state.security_manager.add_allowed_ip(ip);
    response::success(
        json!({
            "message": format!("IP {ip} 已添加到白名单"),
            "allowedIPs": state.security_manager.allowed_ips(),
        }),
        &request_id,
    )
}

/// `DELETE /api/security/ip-whitelist` — 从白名单移除 IP。
pub async fn remove_ip_whitelist(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    axum::Json(body): axum::Json<Value>,
) -> Response {
    let Some(ip) = body
        .get("ip")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    else {
        let err = ApiError::validation("IP地址不能为空", "INVALID_IP");
        return response::error(&err, &request_id);
    };
    if state.security_manager.remove_allowed_ip(ip) {
        response::success(
            json!({
                "message": format!("IP {ip} 已从白名单移除"),
                "allowedIPs": state.security_manager.allowed_ips(),
            }),
            &request_id,
        )
    } else {
        let err = ApiError::validation(format!("IP {ip} 不在白名单中"), "IP_NOT_FOUND")
            .with_status(axum::http::StatusCode::NOT_FOUND);
        response::error(&err, &request_id)
    }
}

/// `PUT /api/security/ip-whitelist/toggle` — 启用/禁用 IP 白名单验证。
pub async fn toggle_ip_whitelist(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    axum::Json(body): axum::Json<Value>,
) -> Response {
    let Some(disabled) = body.get("disabled").and_then(Value::as_bool) else {
        let err = ApiError::validation("disabled参数必须是布尔值", "INVALID_PARAM");
        return response::error(&err, &request_id);
    };
    state.security_manager.set_disable_ip_whitelist(disabled);
    response::success(
        json!({
            "message": format!("IP白名单验证已{}", if disabled { "禁用" } else { "启用" }),
            "disabled": state.security_manager.is_ip_whitelist_disabled(),
        }),
        &request_id,
    )
}

/// `POST /api/security/ip-whitelist/add-current` — 快速添加当前客户端 IP。
pub async fn add_current_ip(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    request: Request<Body>,
) -> Response {
    let Some(ip) = client_ip(&request) else {
        let err = ApiError::validation("无法获取客户端IP", "NO_CLIENT_IP");
        return response::error(&err, &request_id);
    };
    state.security_manager.add_allowed_ip(&ip);
    response::success(
        json!({
            "message": format!("当前IP {ip} 已添加到白名单"),
            "clientIP": ip,
            "allowedIPs": state.security_manager.allowed_ips(),
        }),
        &request_id,
    )
}

#[cfg(test)]
mod tests {
    use super::valid_ip_rule;

    #[test]
    fn ip_rules_accept_supported_forms_and_reject_malformed_values() {
        for valid in ["127.0.0.1", "::1", "10.0.0.0/8", "*"] {
            assert!(valid_ip_rule(valid), "{valid}");
        }
        for invalid in ["", "999.1.1.1", "10.0.0.0/33", "not-an-ip", "10.0.0.0/x"] {
            assert!(!valid_ip_rule(invalid), "{invalid}");
        }
    }
}
