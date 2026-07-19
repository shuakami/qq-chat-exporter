use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, Request};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::security::VerifyTokenReason;

/// 请求 ID 中间件：读取 `X-Request-ID` 或生成新 ID，注入 extensions 与响应头。
pub async fn request_id_middleware(mut request: Request<Body>, next: Next) -> Response {
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map_or_else(response::generate_request_id, ToString::to_string);
    request.extensions_mut().insert(RequestId(request_id.clone()));
    let mut response = next.run(request).await;
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", header_value);
    }
    response
}

/// 从请求中提取真实客户端 IP。
pub fn client_ip(request: &Request<Body>) -> Option<String> {
    let headers = request.headers();
    if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = forwarded.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = real_ip.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    request
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|info| info.0.ip().to_string())
}

/// Issue #438: verifyToken 失败原因 → HTTP 状态 + error code + 用户可读消息。
fn map_verify_token_failure(
    reason: VerifyTokenReason,
    client_ip: Option<&str>,
) -> (axum::http::StatusCode, &'static str, String) {
    match reason {
        VerifyTokenReason::TokenExpired => (
            axum::http::StatusCode::FORBIDDEN,
            "TOKEN_EXPIRED",
            "访问令牌已过期，请在控制台重新获取".to_string(),
        ),
        VerifyTokenReason::IpNotAllowed => (
            axum::http::StatusCode::FORBIDDEN,
            "IP_NOT_ALLOWED",
            format!(
                "客户端 IP{} 不在 IP 白名单内（可在 security.json 中关闭 IP 白名单或加入当前 IP）",
                client_ip.map(|ip| format!(" {ip}")).unwrap_or_default()
            ),
        ),
        VerifyTokenReason::InvalidToken => (
            axum::http::StatusCode::FORBIDDEN,
            "INVALID_TOKEN",
            "无效的访问令牌".to_string(),
        ),
    }
}

/// 判断路径是否为公开路由（无需认证）。
fn is_public_route(path: &str) -> bool {
    const PUBLIC_ROUTES: [&str; 6] =
        ["/", "/health", "/auth", "/auth/", "/security-status", "/qce"];
    const STATIC_EXTENSIONS: [&str; 11] = [
        ".png", ".jpg", ".jpeg", ".svg", ".gif", ".ico", ".css", ".js", ".woff", ".woff2", ".ttf",
    ];

    let lower = path.to_lowercase();
    let is_static_file = STATIC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext));

    let preview_like = || {
        let Some(rest) = path.strip_prefix("/api/exports/files/") else {
            return false;
        };
        if let Some((name, tail)) = rest.split_once('/') {
            if name.is_empty() {
                return false;
            }
            return tail == "preview" || tail == "info" || tail.starts_with("resources/");
        }
        false
    };

    PUBLIC_ROUTES.contains(&path)
        || path.starts_with("/static/")
        || path.starts_with("/qce/")
        || is_static_file
        || path == "/api/exports/files"
        || preview_like()
        || path.starts_with("/resources/")
        || path.starts_with("/downloads/")
        || path.starts_with("/scheduled-downloads/")
        || path == "/download"
    // 注意：/api/download-file 需要认证（Issue #192 安全修复）
}

/// 安全认证中间件。
pub async fn auth_middleware(
    State(state): State<SharedState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    if is_public_route(&path) {
        return next.run(request).await;
    }

    let request_id = request
        .extensions()
        .get::<RequestId>()
        .map_or_else(response::generate_request_id, |id| id.0.clone());

    // 检查认证令牌：Authorization Bearer / ?token= / X-Access-Token
    let token = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim_start_matches("Bearer ").to_string())
        .or_else(|| {
            request.uri().query().and_then(|query| {
                url_query_param(query, "token")
            })
        })
        .or_else(|| {
            request
                .headers()
                .get("x-access-token")
                .and_then(|value| value.to_str().ok())
                .map(ToString::to_string)
        });

    let Some(token) = token.filter(|t| !t.is_empty()) else {
        let err = ApiError::new(ErrorType::Auth, "需要访问令牌", "MISSING_TOKEN")
            .with_status(axum::http::StatusCode::UNAUTHORIZED);
        return response::error(&err, &request_id).into_response();
    };

    let ip = client_ip(&request);
    if let Err(reason) = state
        .security_manager
        .verify_token_with_reason(&token, ip.as_deref())
    {
        let (status, code, message) = map_verify_token_failure(reason, ip.as_deref());
        let mut err = ApiError::new(ErrorType::Auth, message, code).with_status(status);
        if code == "IP_NOT_ALLOWED" {
            if let Some(ip) = ip {
                err = err.with_context(serde_json::json!({ "clientIP": ip }));
            }
        }
        return response::error(&err, &request_id).into_response();
    }

    next.run(request).await
}

/// 从 query string 中提取参数（URL 解码）。
fn url_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=')?;
        if k == key {
            return percent_encoding::percent_decode_str(v)
                .decode_utf8()
                .ok()
                .map(|decoded| decoded.replace('+', " "));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_route_detection() {
        assert!(is_public_route("/"));
        assert!(is_public_route("/health"));
        assert!(is_public_route("/qce/index.html"));
        assert!(is_public_route("/static/app.css"));
        assert!(is_public_route("/api/exports/files"));
        assert!(is_public_route("/api/exports/files/abc.html/preview"));
        assert!(is_public_route("/api/exports/files/abc.html/info"));
        assert!(is_public_route("/api/exports/files/abc/resources/images/x.bin"));
        assert!(!is_public_route("/api/download-file"));
        assert!(!is_public_route("/api/groups"));
    }
}
