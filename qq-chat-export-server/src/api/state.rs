use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tokio::sync::{broadcast, Mutex};

use crate::api::response::{ApiError, ErrorType};
use crate::napcat::NapCatBridgeClient;
use crate::paths::PathManager;
use crate::progress::ProgressTracker;
use crate::resource::ResourceHandler;
use crate::scheduler::ScheduledExportManager;
use crate::security::SecurityManager;
use crate::storage::DatabaseManager;
use axum::http::StatusCode;

/// 消息缓存条目（预览 / 搜索复用，10 分钟过期）。
#[derive(Debug, Clone)]
pub struct MessageCacheEntry {
    /// 缓存的原始消息。
    pub messages: Vec<Value>,
    /// 最近更新时间戳（毫秒）。
    pub last_update: i64,
    /// 是否还有更多消息。
    pub has_more: bool,
}

/// 缓存过期时间（10 分钟，毫秒）。
pub const CACHE_EXPIRE_TIME_MS: i64 = 10 * 60 * 1000;

/// WebSocket 广播消息。
pub type WsMessage = String;

/// 服务器运行模式：`plugin`（NapCat 内启动，bridge 可用）或
/// `standalone`（start-standalone 脚本直接拉起，没有 bridge，issue #668）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    Plugin,
    Standalone,
}

impl RunMode {
    /// 用于 `/api/system/info` 序列化（前端 issue #340 的 `mode` 字段）。
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plugin => "plugin",
            Self::Standalone => "standalone",
        }
    }

    /// 解析 `QCE_STANDALONE_MODE` 环境变量（"1"/"true" 视为独立模式）。
    #[must_use]
    pub fn from_env() -> Self {
        match std::env::var("QCE_STANDALONE_MODE") {
            Ok(value) if matches!(value.trim(), "1" | "true" | "TRUE" | "True") => Self::Standalone,
            _ => Self::Plugin,
        }
    }

    /// issue #668：独立模式下没有 bridge，依赖实时 QQ 数据的接口统一返回
    /// 503 `STANDALONE_MODE`，而不是误导性的「bridge 传输错误」。
    #[must_use]
    pub fn standalone_mode_error(feature: &str) -> ApiError {
        ApiError::new(
            ErrorType::Api,
            format!("独立模式不支持{feature}：当前没有运行 NapCat，无法获取实时 QQ 数据。请改用完整模式（如 ./launcher-user.sh）启动并登录 QQ"),
            "STANDALONE_MODE",
        )
        .with_status(StatusCode::SERVICE_UNAVAILABLE)
    }
}

/// API 服务器共享状态。
pub struct AppState {
    /// NapCat bridge 客户端。
    pub napcat: NapCatBridgeClient,
    /// 服务器运行模式（standalone 下无 bridge，实时数据接口返回 STANDALONE_MODE）。
    pub run_mode: RunMode,
    /// 数据库管理器。
    pub db: Arc<DatabaseManager>,
    /// 全局资源处理器。
    pub resource_handler: Arc<ResourceHandler>,
    /// 进度跟踪器。
    pub progress_tracker: Arc<ProgressTracker>,
    /// 定时导出管理器。
    pub scheduled_export_manager: Arc<ScheduledExportManager>,
    /// 安全管理器。
    pub security_manager: Arc<SecurityManager>,
    /// 路径管理器。
    pub path_manager: Arc<PathManager>,
    /// WebSocket 广播通道。
    pub ws_tx: broadcast::Sender<WsMessage>,
    /// 导出任务表（taskId → 任务 JSON）。
    pub export_tasks: Mutex<HashMap<String, Value>>,
    /// issue #446：被用户主动停止的任务 ID。
    pub cancelled_task_ids: Mutex<std::collections::HashSet<String>>,
    /// issue #446：运行中任务的取消信号（taskId → 取消 flag）。
    pub running_export_cancel_flags: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    /// 资源文件名缓存（dirPath → (shortName → fullFileName)）。
    pub resource_file_cache: Mutex<HashMap<String, HashMap<String, String>>>,
    /// 消息缓存（peerKey → 缓存条目）。
    pub message_cache: Mutex<HashMap<String, MessageCacheEntry>>,
    /// 服务器启动时间。
    pub started_at: Instant,
    /// 静态前端目录（`static/qce`）。
    pub static_dir: PathBuf,
    /// 服务器监听端口。
    pub port: u16,
}

/// 共享状态句柄。
pub type SharedState = Arc<AppState>;

fn is_high_frequency_ws_message(msg_type: &str) -> bool {
    matches!(
        msg_type,
        "export_progress"
            | "album_export_progress"
            | "group_files_export_progress"
            | "merge-progress"
            | "search_progress"
    )
}

impl AppState {
    /// 是否运行在独立模式。
    pub fn is_standalone(&self) -> bool {
        self.run_mode == RunMode::Standalone
    }

    /// issue #668：独立模式下没有 bridge，依赖实时 QQ 数据的接口统一返回
    /// 503 `STANDALONE_MODE`，而不是误导性的「bridge 传输错误」。
    pub fn standalone_mode_error(&self, feature: &str) -> ApiError {
        RunMode::standalone_mode_error(feature)
    }

    /// 服务器已运行秒数。
    pub fn uptime_secs(&self) -> f64 {
        self.started_at.elapsed().as_secs_f64()
    }

    /// 当前 WebSocket 连接数（近似值：广播通道接收者数量）。
    pub fn ws_connection_count(&self) -> usize {
        self.ws_tx.receiver_count()
    }

    /// 向所有 WebSocket 客户端广播 JSON 消息。
    pub fn broadcast_ws(&self, payload: &Value) {
        let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or("?");
        let receivers = self.ws_tx.receiver_count();
        match self.ws_tx.send(payload.to_string()) {
            Ok(n) if is_high_frequency_ws_message(msg_type) => {
                tracing::debug!("[WS] 广播 {msg_type} → {n}/{receivers} 个客户端收到");
            }
            Ok(n) => tracing::info!("[WS] 广播 {msg_type} → {n}/{receivers} 个客户端收到"),
            Err(_) => tracing::debug!("[WS] 广播 {msg_type} 无订阅者 (receivers={receivers})"),
        }
    }

    pub async fn invalidate_message_cache_for_peer(&self, chat_type: i64, peer_uid: &str) -> usize {
        let prefix = format!("{chat_type}_{peer_uid}_");
        let mut cache = self.message_cache.lock().await;
        let before = cache.len();
        cache.retain(|key, _| !key.starts_with(&prefix));
        before.saturating_sub(cache.len())
    }
}

#[cfg(test)]
mod tests {
    use super::{is_high_frequency_ws_message, RunMode};
    use crate::api::response::ErrorType;

    #[test]
    fn progress_messages_are_logged_at_debug_level() {
        for msg_type in [
            "export_progress",
            "album_export_progress",
            "group_files_export_progress",
            "merge-progress",
            "search_progress",
        ] {
            assert!(is_high_frequency_ws_message(msg_type));
        }
    }

    #[test]
    fn completion_and_error_messages_remain_visible() {
        for msg_type in ["export_complete", "export_error", "task_cancelled"] {
            assert!(!is_high_frequency_ws_message(msg_type));
        }
    }

    /// issue #668：`QCE_STANDALONE_MODE` 环境变量决定运行模式（默认 plugin）。
    /// env 变量是进程全局的，用互斥锁串行化避免并发测试互相污染。
    #[test]
    fn run_mode_follows_qce_standalone_mode_env() {
        let _guard = RUN_MODE_TEST_MUTEX
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        for value in ["1", "true", "TRUE", " True "] {
            std::env::set_var("QCE_STANDALONE_MODE", value);
            assert_eq!(RunMode::from_env(), RunMode::Standalone, "value={value:?}");
        }
        for value in ["", "0", "false", "yes", "plugin"] {
            std::env::set_var("QCE_STANDALONE_MODE", value);
            assert_eq!(RunMode::from_env(), RunMode::Plugin, "value={value:?}");
        }
        std::env::remove_var("QCE_STANDALONE_MODE");
        assert_eq!(RunMode::from_env(), RunMode::Plugin);
    }

    /// 独立模式标识序列化成前端 issue #340 使用的 `mode` 字段取值。
    #[test]
    fn run_mode_serializes_to_frontend_mode_field() {
        assert_eq!(RunMode::Plugin.as_str(), "plugin");
        assert_eq!(RunMode::Standalone.as_str(), "standalone");
    }

    /// issue #668：独立模式错误必须是 503 + `STANDALONE_MODE` code +
    /// 指导性文案，不得出现误导性的「bridge 传输错误」。
    #[test]
    fn standalone_mode_error_is_distinctive() {
        let err = RunMode::standalone_mode_error("获取群组列表");
        assert_eq!(err.error_type, ErrorType::Api);
        assert_eq!(err.code, "STANDALONE_MODE");
        assert_eq!(err.status, axum::http::StatusCode::SERVICE_UNAVAILABLE);
        assert!(err.message.contains("独立模式不支持获取群组列表"));
        assert!(err.message.contains("请改用完整模式"));
        assert!(!err.message.contains("bridge"));
    }

    static RUN_MODE_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
