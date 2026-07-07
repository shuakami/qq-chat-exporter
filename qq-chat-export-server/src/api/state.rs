use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tokio::sync::{broadcast, Mutex};

use crate::napcat::NapCatBridgeClient;
use crate::paths::PathManager;
use crate::progress::ProgressTracker;
use crate::resource::ResourceHandler;
use crate::scheduler::ScheduledExportManager;
use crate::security::SecurityManager;
use crate::storage::DatabaseManager;

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

/// API 服务器共享状态（对应 TS `QQChatExporterApiServer` 的成员）。
pub struct AppState {
    /// NapCat bridge 客户端。
    pub napcat: NapCatBridgeClient,
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
    /// 静态前端目录（`static/qce-v4-tool`）。
    pub static_dir: PathBuf,
    /// 服务器监听端口。
    pub port: u16,
}

/// 共享状态句柄。
pub type SharedState = Arc<AppState>;

impl AppState {
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
            Ok(n) => tracing::info!(
                "[WS] 广播 {msg_type} → {n}/{receivers} 个客户端收到"
            ),
            Err(_) => tracing::debug!(
                "[WS] 广播 {msg_type} 无订阅者 (receivers={receivers})"
            ),
        }
    }
}
