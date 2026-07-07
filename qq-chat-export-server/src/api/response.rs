use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde_json::{json, Value};

/// 错误类型（对应 TS `ErrorType` 枚举）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorType {
    /// 参数校验错误。
    Validation,
    /// 认证错误。
    Auth,
    /// 上游 API 错误。
    Api,
    /// 配置错误。
    Config,
    /// 数据库错误。
    Database,
    /// 文件系统错误。
    FileSystem,
    /// 网络错误。
    Network,
    /// 未知 / 内部错误。
    Unknown,
}

impl ErrorType {
    /// TS 侧的字符串常量。
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Validation => "VALIDATION_ERROR",
            Self::Auth => "AUTH_ERROR",
            Self::Api => "API_ERROR",
            Self::Config => "CONFIG_ERROR",
            Self::Database => "DATABASE_ERROR",
            Self::FileSystem => "FILE_SYSTEM_ERROR",
            Self::Network => "NETWORK_ERROR",
            Self::Unknown => "UNKNOWN_ERROR",
        }
    }
}

/// API 层错误：类型 + 消息 + 错误码 + HTTP 状态。
#[derive(Debug, Clone)]
pub struct ApiError {
    /// 错误类型。
    pub error_type: ErrorType,
    /// 用户可读消息。
    pub message: String,
    /// 机器可读错误码。
    pub code: String,
    /// HTTP 状态码。
    pub status: StatusCode,
    /// 附加上下文（并入 error.context）。
    pub context: Option<Value>,
}

impl ApiError {
    /// 创建错误（默认 500）。
    pub fn new(error_type: ErrorType, message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            error_type,
            message: message.into(),
            code: code.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
            context: None,
        }
    }

    /// 指定 HTTP 状态。
    #[must_use]
    pub fn with_status(mut self, status: StatusCode) -> Self {
        self.status = status;
        self
    }

    /// 附加上下文。
    #[must_use]
    pub fn with_context(mut self, context: Value) -> Self {
        self.context = Some(context);
        self
    }

    /// 400 参数错误。
    pub fn validation(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self::new(ErrorType::Validation, message, code).with_status(StatusCode::BAD_REQUEST)
    }

    /// 404 未找到。
    pub fn not_found(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self::new(ErrorType::Api, message, code).with_status(StatusCode::NOT_FOUND)
    }

    /// 500 内部错误。
    pub fn internal(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self::new(ErrorType::Unknown, message, code)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}: {}", self.error_type.as_str(), self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

/// 请求 ID（由中间件注入 extensions）。
#[derive(Debug, Clone)]
pub struct RequestId(pub String);

/// 生成请求 ID（与 TS `generateRequestId` 一致的形态：`req_<ts>_<rand>`）。
#[must_use]
pub fn generate_request_id() -> String {
    let now = Utc::now().timestamp_millis();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    format!("req_{now}_{}", &suffix[..9])
}

/// 成功响应。
#[must_use]
pub fn success(data: Value, request_id: &str) -> Response {
    Json(json!({
        "success": true,
        "data": data,
        "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "requestId": request_id,
    }))
    .into_response()
}

/// 错误响应。
#[must_use]
pub fn error(err: &ApiError, request_id: &str) -> Response {
    let mut context = json!({
        "code": err.code,
        "requestId": request_id,
    });
    if let (Some(extra), Some(obj)) = (err.context.as_ref(), context.as_object_mut()) {
        if let Some(extra_obj) = extra.as_object() {
            for (key, value) in extra_obj {
                obj.insert(key.clone(), value.clone());
            }
        }
    }
    let body = Json(json!({
        "success": false,
        "error": {
            "type": err.error_type.as_str(),
            "message": err.message,
            "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "context": context,
        },
        "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "requestId": request_id,
    }));
    (err.status, body).into_response()
}

/// handler 通用返回类型：`Ok(Value)` 会被包装成成功响应。
pub type ApiResult = Result<Value, ApiError>;
