use crate::base::{format_timestamp, ms_to_local, preprocess_messages, ExporterContext};
use crate::error::{ExportError, ExportResultT};
use crate::types::{
    ChatInfo, CleanMessage, ExportFormat, ExportOptions, ExportOutcome, TimeFormat,
};
use chrono::Local;
use serde_json::Value;
use std::time::Instant;

/// 时间戳格式。
pub type TextTimestampFormat = TimeFormat;

/// 文本格式选项。
#[derive(Debug, Clone)]
pub struct TextFormatOptions {
    /// 消息之间的分隔符。
    pub message_separator: String,
    /// 是否显示发送者信息。
    pub show_sender: bool,
    /// 是否显示消息类型。
    pub show_message_type: bool,
    /// 是否显示资源统计。
    pub show_resource_stats: bool,
    /// 行宽限制（0 表示不限制）。
    pub line_width: usize,
    /// 缩进字符。
    pub indent_char: String,
    /// 是否显示消息序号。
    pub show_message_number: bool,
}

impl Default for TextFormatOptions {
    fn default() -> Self {
        Self {
            message_separator: "\n".to_owned(),
            show_sender: true,
            show_message_type: false,
            show_resource_stats: true,
            line_width: 0,
            indent_char: "  ".to_owned(),
            show_message_number: false,
        }
    }
}

/// 纯文本导出器。
pub struct TextExporter {
    ctx: ExporterContext,
    text_options: TextFormatOptions,
}

/// issue #128：把被引用消息时间戳渲染成 `MM-DD HH:MM` 标签（本地时区，
/// 使用本地时间的年、月、日和时分生成标签。
fn format_reply_time_label(ts: i64) -> String {
    if ts <= 0 {
        return String::new();
    }
    let ms = if ts < 1_000_000_000_000 { ts * 1000 } else { ts };
    let Some(d) = ms_to_local(ms) else {
        return String::new();
    };
    use chrono::{Datelike, Timelike};
    format!(
        "{:02}-{:02} {:02}:{:02}",
        d.month(),
        d.day(),
        d.hour(),
        d.minute()
    )
}

impl TextExporter {
    /// 新建导出器。
    #[must_use]
    pub fn new(options: ExportOptions, text_options: TextFormatOptions) -> Self {
        Self {
            ctx: ExporterContext::new(ExportFormat::Txt, options),
            text_options,
        }
    }

    /// 共享上下文（进度回调 / 取消令牌）。
    pub fn context_mut(&mut self) -> &mut ExporterContext {
        &mut self.ctx
    }

    /// 导出入口。
    pub async fn export(
        &self,
        messages: Vec<CleanMessage>,
        chat_info: &ChatInfo,
    ) -> ExportResultT<ExportOutcome> {
        let start_time = Instant::now();
        self.ctx
            .update_progress(0, messages.len(), &format!("开始{}导出", self.ctx.format));
        self.ctx.ensure_output_directory().await?;

        let filtered = preprocess_messages(messages);
        let content = self.generate_content(&filtered, chat_info);
        self.ctx.check_cancelled()?;

        tokio::fs::write(&self.ctx.options.output_path, content.as_bytes())
            .await
            .map_err(|e| ExportError::io("writeToFile", &self.ctx.options.output_path, e))?;

        self.ctx
            .update_progress(filtered.len(), filtered.len(), "导出完成");

        let resource_count: usize = filtered.iter().map(|m| m.content.resources.len()).sum();
        Ok(ExportOutcome {
            task_id: String::new(),
            format: self.ctx.format,
            file_path: self.ctx.options.output_path.clone(),
            file_size: self.ctx.output_file_size().await,
            message_count: filtered.len(),
            resource_count,
            export_time: start_time.elapsed().as_millis(),
            completed_at: crate::base::now_iso(),
        })
    }

    /// 生成文本内容。
    fn generate_content(
        &self,
        messages: &[CleanMessage],
        chat_info: &ChatInfo,
    ) -> String {
        let mut lines: Vec<String> = Vec::new();

        lines.extend(self.generate_header(chat_info, messages));
        lines.push(String::new());

        for (i, message) in messages.iter().enumerate() {
            if self.ctx.cancellation.is_cancelled() {
                break;
            }
            lines.extend(self.format_message(message, i + 1));
            if i + 1 < messages.len() {
                lines.push(self.text_options.message_separator.clone());
            }
            if i % 100 == 0 {
                self.ctx.update_progress(
                    i,
                    messages.len(),
                    &format!("格式化消息 {}/{}", i + 1, messages.len()),
                );
            }
        }

        lines.push(String::new());
        lines.extend(self.generate_footer(messages));

        lines.join("\n")
    }

    /// 生成文件头部信息。
    fn generate_header(&self, chat_info: &ChatInfo, messages: &[CleanMessage]) -> Vec<String> {
        let mut lines: Vec<String> = vec![
            "[QQChatExporter V5 / https://github.com/shuakami/qq-chat-exporter]".to_owned(),
            "[本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~]"
                .to_owned(),
            String::new(),
            "===============================================".to_owned(),
            "           QQ聊天记录导出文件".to_owned(),
            "===============================================".to_owned(),
            String::new(),
        ];

        let name = if chat_info.name.is_empty() {
            "未知聊天"
        } else {
            chat_info.name.as_str()
        };
        lines.push(format!("聊天名称: {name}"));
        lines.push(format!(
            "聊天类型: {}",
            chat_type_display_name(&chat_info.chat_type)
        ));
        if let Some(count) = chat_info.participant_count {
            lines.push(format!("参与人数: {count}"));
        }

        lines.push(format!(
            "导出时间: {}",
            format_timestamp(Local::now(), self.ctx.options.time_format)
        ));
        if !messages.is_empty() {
            lines.push(format!("消息总数: {}", messages.len()));
            if let Some(range) = self.calculate_time_range(messages) {
                lines.push(format!("时间范围: {range}"));
            }
        }
        lines.push(String::new());

        lines
    }

    /// 生成文件尾部信息。
    fn generate_footer(&self, messages: &[CleanMessage]) -> Vec<String> {
        vec![
            "===============================================".to_owned(),
            "              导出完成".to_owned(),
            "===============================================".to_owned(),
            format!("总计导出 {} 条消息", messages.len()),
            format!(
                "导出时间: {}",
                format_timestamp(Local::now(), self.ctx.options.time_format)
            ),
        ]
    }

    /// 格式化单条消息。
    fn format_message(&self, message: &CleanMessage, message_number: usize) -> Vec<String> {
        let mut lines: Vec<String> = Vec::new();

        if self.text_options.show_message_number {
            lines.push(format!("[{message_number}]"));
        }

        if self.text_options.show_sender {
            let sender_name = if message.sender.name.is_empty() {
                message.sender.uid.as_str()
            } else {
                message.sender.name.as_str()
            };
            // 群头衔（issue #331）：命中时加在名字前
            let sender_label = match message.sender.title.as_deref() {
                Some(title) if !title.is_empty() => format!("[{title}] {sender_name}"),
                _ => sender_name.to_owned(),
            };
            lines.push(format!("{sender_label}:"));
        }

        let ts_label = ms_to_local(message.timestamp)
            .map(|dt| format_timestamp(dt, self.ctx.options.time_format))
            .unwrap_or_default();
        lines.push(format!("时间: {ts_label}"));

        if self.text_options.show_message_type {
            lines.push(format!("类型: {}", message.message_type));
        }

        let content = message.content.text.trim();
        if !content.is_empty() {
            lines.push(format!("内容: {content}"));
        } else if !message.content.resources.is_empty() {
            let resource_types: Vec<&str> = message
                .content
                .resources
                .iter()
                .map(|r| r.resource_type.as_str())
                .collect();
            lines.push(format!("内容: [{}消息]", resource_types.join("、")));
        } else if message.system {
            lines.push("内容: [系统消息]".to_owned());
        } else if has_emoji_element(message) {
            lines.push("内容: [表情消息]".to_owned());
        } else {
            lines.push("内容: [无文本内容]".to_owned());
        }

        if self.text_options.show_resource_stats && !message.content.resources.is_empty() {
            lines.push(format!(
                "资源: {} 个文件",
                message.content.resources.len()
            ));
            for resource in &message.content.resources {
                lines.push(format!(
                    "  - {}: {}",
                    resource.resource_type,
                    resource.filename.as_deref().unwrap_or_default()
                ));
            }
        }

        if !message.content.mentions.is_empty() {
            let mentions: Vec<&str> = message
                .content
                .mentions
                .iter()
                .map(|m| m.name.as_deref().unwrap_or(m.uid.as_str()))
                .collect();
            lines.push(format!("提及: {}", mentions.join(", ")));
        }

        // issue #128：reply 元素回挂到「回复: 时间 名字 - 内容」路径
        if let Some(reply) = find_reply_data(message) {
            let ts = reply
                .get("timestamp")
                .and_then(Value::as_i64)
                .filter(|t| *t > 0)
                .unwrap_or(0);
            let ts_label = if ts > 0 {
                format_reply_time_label(ts)
            } else {
                String::new()
            };
            let sender = reply
                .get("senderName")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let head = if ts_label.is_empty() {
                sender.to_owned()
            } else {
                format!("{ts_label} {sender}").trim().to_owned()
            };
            let content = reply
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            lines.push(format!("回复: {head} - {content}"));
        }

        lines.iter().map(|line| self.wrap_line(line)).collect()
    }

    /// 换行处理。
    fn wrap_line(&self, line: &str) -> String {
        let width = self.text_options.line_width;
        let chars: Vec<char> = line.chars().collect();
        if width == 0 || chars.len() <= width {
            return line.to_owned();
        }
        let mut chunks: Vec<String> = Vec::new();
        for chunk in chars.chunks(width) {
            chunks.push(chunk.iter().collect());
        }
        chunks.join(&format!("\n{}", self.text_options.indent_char))
    }

    /// 计算消息的实际时间范围。
    fn calculate_time_range(&self, messages: &[CleanMessage]) -> Option<String> {
        let mut earliest: Option<i64> = None;
        let mut latest: Option<i64> = None;
        for message in messages {
            let ts = message.timestamp;
            if ts <= 0 {
                continue;
            }
            earliest = Some(earliest.map_or(ts, |e| e.min(ts)));
            latest = Some(latest.map_or(ts, |l| l.max(ts)));
        }
        let (start, end) = (earliest?, latest?);
        let start_time =
            format_timestamp(ms_to_local(start)?, self.ctx.options.time_format);
        let end_time = format_timestamp(ms_to_local(end)?, self.ctx.options.time_format);
        Some(format!("{start_time} - {end_time}"))
    }
}

/// 聊天类型显示名称。
#[must_use]
pub fn chat_type_display_name(chat_type: &str) -> &'static str {
    match chat_type {
        "group" => "群聊",
        "private" => "私聊",
        "temp" => "临时会话",
        _ => "未知类型",
    }
}

fn has_emoji_element(message: &CleanMessage) -> bool {
    message
        .content
        .elements
        .iter()
        .any(|e| e.element_type == "face" || e.element_type == "market_face")
}

fn find_reply_data(message: &CleanMessage) -> Option<&Value> {
    message
        .content
        .elements
        .iter()
        .find(|e| e.element_type == "reply")
        .map(|e| &e.data)
        .filter(|d| d.is_object())
}
