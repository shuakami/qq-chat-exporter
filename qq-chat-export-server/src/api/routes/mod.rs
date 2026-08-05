pub mod albums;
pub mod files;
pub mod friends;
pub mod group_files;
pub mod groups;
#[path = "messages.rs"]
mod messages_impl;
pub mod resources;
pub mod scheduled;
pub mod security;
pub mod stickers;
pub mod streaming;
pub mod system;
pub mod tasks;
pub mod users;

/// 保持既有 `routes::messages::*` API 不变，但把两个“流式”端点切换到
/// 真正的磁盘分块流水线。普通导出和消息预览继续使用原实现。
pub mod messages {
    pub use super::messages_impl::{export_messages, fetch_messages};
    pub use super::streaming::{export_streaming_jsonl, export_streaming_zip};
}
