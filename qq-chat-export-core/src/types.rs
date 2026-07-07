use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// 导出格式（与 TS `ExportFormat` 对齐）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ExportFormat {
    /// 纯文本导出。
    Txt,
    /// JSON / JSONL 导出。
    Json,
    /// 表格化 HTML 导出。
    Html,
    /// Excel (.xlsx) 导出。
    Excel,
    /// 现代化 HTML 导出（单文件 / chunked viewer）。
    ModernHtml,
}

impl std::fmt::Display for ExportFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Txt => "TXT",
            Self::Json => "JSON",
            Self::Html => "HTML",
            Self::Excel => "EXCEL",
            Self::ModernHtml => "MODERN_HTML",
        };
        f.write_str(s)
    }
}

/// 消息发送者（对应 `CleanMessage.sender`）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sender {
    /// 发送者 UID。
    pub uid: String,
    /// 发送者 QQ 号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uin: Option<String>,
    /// 展示名称。
    pub name: String,
    /// 昵称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    /// 群名片。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_card: Option<String>,
    /// 备注。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
    /// 群头衔（issue #331）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 头像 base64（embedAvatarsAsBase64 模式）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_base64: Option<String>,
}

/// 消息元素（`content.elements[]`）。`data` 为弱类型透传。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageElement {
    /// 元素类型：text / image / video / audio / file / face / market_face /
    /// reply / at / forward / json / location / system ……
    #[serde(rename = "type")]
    pub element_type: String,
    /// 元素数据（结构随类型而异，保持与 TS 输出一致的弱类型透传）。
    #[serde(default)]
    pub data: Value,
}

/// 消息资源（`content.resources[]`）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageResource {
    /// 资源类型：image / video / audio / file。
    #[serde(rename = "type", default)]
    pub resource_type: String,
    /// 文件名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    /// 文件大小（字节）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// 原始 URL。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 本地路径。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// 图片宽度。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// 图片高度。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// 音视频时长（秒）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

/// @ 提及（`content.mentions[]`）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    /// 被提及者 UID。
    #[serde(default)]
    pub uid: String,
    /// 被提及者名称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 提及类型（user / all）。
    #[serde(rename = "type", default = "default_mention_type")]
    pub mention_type: String,
}

fn default_mention_type() -> String {
    "user".to_owned()
}

/// 消息内容（`CleanMessage.content`）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageContent {
    /// 纯文本。
    #[serde(default)]
    pub text: String,
    /// 预渲染 HTML（可选）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// 结构化元素。
    #[serde(default)]
    pub elements: Vec<MessageElement>,
    /// 资源列表。
    #[serde(default)]
    pub resources: Vec<MessageResource>,
    /// 提及列表。
    #[serde(default)]
    pub mentions: Vec<Mention>,
}

/// 解析后消息（对应 TS `CleanMessage`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanMessage {
    /// 消息 ID。
    pub id: String,
    /// 消息序号。
    #[serde(default)]
    pub seq: String,
    /// 毫秒级时间戳。
    #[serde(default)]
    pub timestamp: i64,
    /// 本地化时间串（`YYYY-MM-DD HH:mm:ss`）。
    #[serde(default)]
    pub time: String,
    /// 发送者。
    pub sender: Sender,
    /// 消息类型（`type_1` 等）。
    #[serde(rename = "type", default)]
    pub message_type: String,
    /// 消息内容。
    #[serde(default)]
    pub content: MessageContent,
    /// 是否已撤回。
    #[serde(default)]
    pub recalled: bool,
    /// 是否系统消息。
    #[serde(default)]
    pub system: bool,
    /// 原始消息（cleanRawMessage 之后的精简对象，可选）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_message: Option<Value>,
}

/// 聊天信息（对应 TS `chatInfo` 参数）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInfo {
    /// 聊天名称。
    #[serde(default)]
    pub name: String,
    /// 聊天类型：group / private / temp。
    #[serde(rename = "type", default)]
    pub chat_type: String,
    /// 头像 URL。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// 参与人数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participant_count: Option<u64>,
    /// 当前登录用户 UID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_uid: Option<String>,
    /// 当前登录用户 QQ 号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_uin: Option<String>,
    /// 当前登录用户昵称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_name: Option<String>,
}

/// 时间戳格式（对应 TS `options.timeFormat` 的取值语义）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimeFormat {
    /// `YYYY-MM-DD HH:mm:ss`（默认）。
    #[default]
    Full,
    /// 仅日期 `YYYY-MM-DD`。
    DateOnly,
    /// 仅时间 `HH:mm:ss`。
    TimeOnly,
    /// 相对时间（「x 天前」等）。
    Relative,
}

impl TimeFormat {
    /// 从 TS 侧字符串解析（未知值回退 Full，与 TS 的 default 分支一致）。
    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s {
            "date-only" => Self::DateOnly,
            "time-only" => Self::TimeOnly,
            "relative" => Self::Relative,
            _ => Self::Full,
        }
    }
}

/// 导出选项（对应 TS `ExportOptions`）。
#[derive(Debug, Clone)]
pub struct ExportOptions {
    /// 输出文件路径。
    pub output_path: PathBuf,
    /// 是否包含资源链接。
    pub include_resource_links: bool,
    /// 是否包含系统消息。
    pub include_system_messages: bool,
    /// 是否过滤纯图片消息（TS 侧该过滤已废弃，恒为直通）。
    pub filter_pure_image_messages: bool,
    /// 时间格式。
    pub time_format: TimeFormat,
    /// 是否美化输出。
    pub pretty_format: bool,
    /// 自定义 CSS（HTML 导出）。
    pub custom_css: Option<String>,
    /// 分块大小（大文件分块输出，字节 / 字符数）。
    pub chunk_size: Option<usize>,
    /// 群聊导出时是否优先使用群成员名称。
    pub prefer_group_member_name: bool,
    /// issue #277：msgId → 已下载资源列表（用于路径覆写与资源拷贝）。
    pub resource_map: HashMap<String, Vec<MessageResource>>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            output_path: PathBuf::new(),
            include_resource_links: true,
            include_system_messages: true,
            filter_pure_image_messages: false,
            time_format: TimeFormat::Full,
            pretty_format: true,
            custom_css: None,
            chunk_size: None,
            prefer_group_member_name: true,
            resource_map: HashMap::new(),
        }
    }
}

/// 导出进度。
#[derive(Debug, Clone)]
pub struct ExportProgress {
    /// 当前进度。
    pub current: usize,
    /// 总量。
    pub total: usize,
    /// 百分比（0–100）。
    pub percentage: u32,
    /// 进度说明。
    pub message: String,
}

/// 进度回调（TS `ProgressCallback` 的线程安全等价物）。
pub type ProgressCallback = Arc<dyn Fn(ExportProgress) + Send + Sync>;

/// 取消令牌：`cancel()` 之后导出主循环在下一个检查点返回 `ExportError::Cancelled`。
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    flag: Arc<AtomicBool>,
}

impl CancellationToken {
    /// 新建未取消的令牌。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 请求取消。
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    /// 是否已请求取消。
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// 导出结果（对应 TS `ExportResult`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    /// 任务 ID（由调用方回填，导出器内为空字符串，与 TS 一致）。
    pub task_id: String,
    /// 导出格式。
    pub format: ExportFormat,
    /// 输出文件路径。
    pub file_path: PathBuf,
    /// 输出文件大小（字节）。
    pub file_size: u64,
    /// 消息数量。
    pub message_count: usize,
    /// 资源数量。
    pub resource_count: usize,
    /// 导出耗时（毫秒）。
    pub export_time: u128,
    /// 完成时间（ISO 8601）。
    pub completed_at: String,
}

/// 应用元信息（对应 TS `APP_INFO` / `VERSION`）。
#[derive(Debug, Clone, Serialize)]
pub struct AppMetadata {
    /// 软件名称。
    pub name: String,
    /// 版权信息。
    pub copyright: String,
    /// 版本号。
    pub version: String,
}

impl Default for AppMetadata {
    fn default() -> Self {
        Self {
            name: "QQChatExporter".to_owned(),
            copyright: "https://github.com/shuakami/qq-chat-exporter".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}
