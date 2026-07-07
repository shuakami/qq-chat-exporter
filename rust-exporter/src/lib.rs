//! # qce-exporter
//!
//! QQ Chat Exporter 导出器模块的生产级 Rust 移植（对应 TS
//! `plugins/qq-chat-exporter/lib/core/exporter/`）。
//!
//! ## 模块结构
//!
//! | Rust 模块 | 对应 TS 文件 | 职责 |
//! |---|---|---|
//! | [`types`] | `BaseExporter.ts`（类型部分） | 核心数据模型（`CleanMessage` / `ChatInfo` / 选项 / 进度） |
//! | [`error`] | `SystemError` 用法 | 统一错误枚举 [`error::ExportError`] |
//! | [`base`] | `BaseExporter.ts` | 导出器上下文、进度 / 取消、时间格式化、消息排序 |
//! | [`stream_utils`] | `streamUtils.ts` | backpressure 感知的缓冲文本写入 |
//! | [`stats`] | 各导出器统计逻辑 | 在线统计累加器（不缓存全部消息） |
//! | [`reply_render`] | `replyRender.ts` | reply 跳转目标选择与时间标签（Issue #128） |
//! | [`reply_preview_renderer`] | `replyPreviewRenderer.ts` | 被引用消息预览元素渲染（Issue #128） |
//! | [`bloom`] | `ModernHtmlExporter.ts` 尾部 | FNV-1a 32 + Bloom Filter（与 TS 位级一致） |
//! | [`json_templates`] | `JsonExporter.ts`（模板部分） | JSON 流式模板 |
//! | [`chunked_jsonl_writer`] | `JsonExporter.ts`（chunked 部分） | JSONL 分块写入与 manifest |
//! | [`text_exporter`] | `TextExporter.ts` | 纯文本导出 |
//! | [`json_exporter`] | `JsonExporter.ts` | 单 JSON / chunked-jsonl 流式导出 |
//! | [`html_exporter`] | `HtmlExporter.ts` | 表格 HTML + 主题导出 |
//! | [`excel_exporter`] | `ExcelExporter.ts` | XLSX 导出 |
//! | [`modern_html_templates`] | `ModernHtmlTemplates.ts` | 现代化 HTML 模板常量与渲染 |
//! | [`modern_html_exporter`] | `ModernHtmlExporter.ts` | 单文件 / Chunked Viewer 导出 |
//!
//! ## 设计原则
//!
//! - **零 panic**：全部错误通过 [`error::ExportResultT`] 显式传播；
//! - **tokio 异步 I/O**：文件写入基于 `tokio::fs` + `BufWriter`，天然遵循 backpressure；
//! - **流式与分块**：大文件导出绝不无界缓冲；
//! - **受限并发**：资源复制通过 `JoinSet` 限制在 `[2, 8]` 并发，单资源失败静默跳过；
//! - **语义对齐**：时间格式、排序稳定性、Bloom/FNV 位级输出与 TS 逐一对齐。

pub mod base;
pub mod bloom;
pub mod chunked_jsonl_writer;
pub mod error;
pub mod excel_exporter;
pub mod html_exporter;
pub mod json_exporter;
pub mod json_templates;
pub mod modern_html_exporter;
pub mod modern_html_templates;
pub mod reply_preview_renderer;
pub mod reply_render;
pub mod stats;
pub mod stream_utils;
pub mod text_exporter;
pub mod types;

pub use error::{ExportError, ExportResultT};
pub use types::{
    ChatInfo, CleanMessage, ExportFormat, ExportOptions, ExportOutcome, ExportProgress,
};
