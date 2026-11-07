use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tokio::sync::{broadcast, Mutex, Semaphore};

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

pub const MAX_ACTIVE_EXPORT_TASKS: usize = 32;

/// 定时导出任务数量上限的默认值（issue #720：群聊多的用户 128 个不够用，
/// 默认放宽到 1024；仍可通过 `/api/config` 的 `maxScheduledExports` 或
/// `QCE_MAX_SCHEDULED_EXPORTS` 环境变量调整）。
pub const DEFAULT_MAX_SCHEDULED_EXPORTS: usize = 1024;
/// 定时导出上限允许配置的最小值。
pub const MIN_MAX_SCHEDULED_EXPORTS: usize = 1;
/// 定时导出上限允许配置的最大值（防止误配出不可控的任务数量）。
pub const MAX_CONFIGURABLE_SCHEDULED_EXPORTS: usize = 10_000;

/// 解析定时导出任务数量上限：环境变量优先，其次用户配置，最后回退默认值。
///
/// `configured` 为 `user-config.json` 里的 `maxScheduledExports`（JSON 数字）；
/// `env` 为 `QCE_MAX_SCHEDULED_EXPORTS` 原始字符串。非法或越界的值告警后
/// 回退到下一个来源，最终保证落在 `[MIN, MAX]` 区间内。
#[must_use]
pub fn resolve_max_scheduled_exports(configured: Option<i64>, env: Option<&str>) -> usize {
    if let Some(raw) = env.map(str::trim).filter(|value| !value.is_empty()) {
        match raw.parse::<usize>() {
            Ok(value)
                if (MIN_MAX_SCHEDULED_EXPORTS..=MAX_CONFIGURABLE_SCHEDULED_EXPORTS)
                    .contains(&value) =>
            {
                return value;
            }
            _ => tracing::warn!("QCE_MAX_SCHEDULED_EXPORTS 的值无效或超出允许范围: {raw}"),
        }
    }
    configured
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| {
            (MIN_MAX_SCHEDULED_EXPORTS..=MAX_CONFIGURABLE_SCHEDULED_EXPORTS).contains(value)
        })
        .unwrap_or(DEFAULT_MAX_SCHEDULED_EXPORTS)
}

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
    /// 定时导出任务数量上限（issue #720：`/api/config` 更新后即时生效）。
    pub max_scheduled_exports: AtomicUsize,
    /// 安全管理器。
    pub security_manager: Arc<SecurityManager>,
    /// 路径管理器。
    pub path_manager: Arc<PathManager>,
    /// WebSocket 广播通道。
    pub ws_tx: broadcast::Sender<WsMessage>,
    /// 导出任务表（taskId → 任务 JSON）。
    pub export_tasks: Mutex<HashMap<String, Value>>,
    /// 导出任务信号量（限制同时运行的导出任务数）。
    pub export_semaphore: Arc<Semaphore>,
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

    /// 当前定时导出任务数量上限。
    #[must_use]
    pub fn max_scheduled_exports(&self) -> usize {
        self.max_scheduled_exports.load(Ordering::Relaxed)
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
    use super::{
        is_high_frequency_ws_message, resolve_max_scheduled_exports, RunMode,
        DEFAULT_MAX_SCHEDULED_EXPORTS, MAX_CONFIGURABLE_SCHEDULED_EXPORTS,
        MIN_MAX_SCHEDULED_EXPORTS,
    };
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

    /// issue #720：上限解析优先级为 环境变量 > 用户配置 > 默认值，
    /// 非法与越界值逐级回退。
    #[test]
    fn max_scheduled_exports_resolution_order_and_bounds() {
        // 无配置无环境变量 → 默认值。
        assert_eq!(
            resolve_max_scheduled_exports(None, None),
            DEFAULT_MAX_SCHEDULED_EXPORTS
        );
        // 仅配置文件。
        assert_eq!(resolve_max_scheduled_exports(Some(256), None), 256);
        // 环境变量覆盖配置文件。
        assert_eq!(resolve_max_scheduled_exports(Some(256), Some("512")), 512);
        // 环境变量非法 → 回退配置文件。
        assert_eq!(resolve_max_scheduled_exports(Some(256), Some("abc")), 256);
        assert_eq!(resolve_max_scheduled_exports(Some(256), Some("-1")), 256);
        // 环境变量越界 → 回退配置文件。
        assert_eq!(
            resolve_max_scheduled_exports(
                Some(256),
                Some(&(MAX_CONFIGURABLE_SCHEDULED_EXPORTS + 1).to_string())
            ),
            256
        );
        // 配置文件非法 / 越界 → 默认值。
        assert_eq!(
            resolve_max_scheduled_exports(Some(0), None),
            DEFAULT_MAX_SCHEDULED_EXPORTS
        );
        assert_eq!(
            resolve_max_scheduled_exports(Some(-5), None),
            DEFAULT_MAX_SCHEDULED_EXPORTS
        );
        assert_eq!(
            resolve_max_scheduled_exports(
                Some(i64::try_from(MAX_CONFIGURABLE_SCHEDULED_EXPORTS).unwrap() + 1),
                None
            ),
            DEFAULT_MAX_SCHEDULED_EXPORTS
        );
        // 边界值合法。
        assert_eq!(
            resolve_max_scheduled_exports(Some(MIN_MAX_SCHEDULED_EXPORTS as i64), None),
            MIN_MAX_SCHEDULED_EXPORTS
        );
        assert_eq!(
            resolve_max_scheduled_exports(
                Some(i64::try_from(MAX_CONFIGURABLE_SCHEDULED_EXPORTS).unwrap()),
                None
            ),
            MAX_CONFIGURABLE_SCHEDULED_EXPORTS
        );
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
