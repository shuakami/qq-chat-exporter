use crate::base::{format_timestamp, ms_to_local, preprocess_messages, ExporterContext};
use crate::error::ExportResultT;
use crate::message_source::{CleanMessageSource, SliceMessageSource};
use crate::stream_utils::{yield_to_event_loop, BufferedTextWriter, DEFAULT_FLUSH_THRESHOLD};
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
    let ms = if ts < 1_000_000_000_000 {
        ts * 1000
    } else {
        ts
    };
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

    /// 导出入口（全量内存切片；大规模导出请用 [`Self::export_source`]）。
    pub async fn export(
        &self,
        messages: Vec<CleanMessage>,
        chat_info: &ChatInfo,
    ) -> ExportResultT<ExportOutcome> {
        let filtered = preprocess_messages(messages);
        let mut source = SliceMessageSource::new(&filtered);
        self.export_source(&mut source, chat_info, filtered.len())
            .await
    }

    /// 导出入口（分批数据源；issue #666）。
    ///
    /// 文件头里的「消息总数 / 时间范围」需要先知道全部消息，因此先扫一遍数据源
    /// 只做计数与时间范围统计，再复位数据源逐批格式化写盘；两遍都只持有一批消息。
    /// `total_hint` 仅用于进度显示。
    pub async fn export_source<S: CleanMessageSource>(
        &self,
        source: &mut S,
        chat_info: &ChatInfo,
        total_hint: usize,
    ) -> ExportResultT<ExportOutcome> {
        let start_time = Instant::now();
        self.ctx
            .update_progress(0, total_hint, &format!("开始{}导出", self.ctx.format));
        self.ctx.ensure_output_directory().await?;

        let mut summary = TextSummary::default();
        source.restart().await?;
        while let Some(batch) = source.next_batch().await? {
            self.ctx.check_cancelled()?;
            for message in &batch {
                summary.consume(message);
            }
            yield_to_event_loop().await;
        }
        let total = summary.count;

        let mut writer =
            BufferedTextWriter::create(&self.ctx.options.output_path, DEFAULT_FLUSH_THRESHOLD)
                .await?;
        for line in self.generate_header(chat_info, &summary) {
            writer.write(&line).await?;
            writer.write("\n").await?;
        }
        writer.write("\n").await?;

        let mut written = 0usize;
        source.restart().await?;
        while let Some(batch) = source.next_batch().await? {
            self.ctx.check_cancelled()?;
            for message in &batch {
                if message.id.is_empty() {
                    continue;
                }
                written += 1;
                for line in self.format_message(message, written) {
                    writer.write(&line).await?;
                    writer.write("\n").await?;
                }
                if written < total {
                    writer.write(&self.text_options.message_separator).await?;
                    writer.write("\n").await?;
                }
            }
            yield_to_event_loop().await;
            self.ctx
                .update_progress(written, total, &format!("格式化消息 {written}/{total}"));
        }

        writer.write("\n").await?;
        let footer = self.generate_footer(total);
        let last = footer.len().saturating_sub(1);
        for (index, line) in footer.iter().enumerate() {
            writer.write(line).await?;
            if index < last {
                writer.write("\n").await?;
            }
        }
        writer.end().await?;

        self.ctx.update_progress(total, total, "导出完成");

        Ok(ExportOutcome {
            task_id: String::new(),
            format: self.ctx.format,
            file_path: self.ctx.options.output_path.clone(),
            file_size: self.ctx.output_file_size().await,
            message_count: total,
            resource_count: summary.resource_count,
            export_time: start_time.elapsed().as_millis(),
            completed_at: crate::base::now_iso(),
        })
    }

    /// 生成文件头部信息。
    fn generate_header(&self, chat_info: &ChatInfo, summary: &TextSummary) -> Vec<String> {
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
        if summary.count > 0 {
            lines.push(format!("消息总数: {}", summary.count));
            if let Some(range) = self.format_time_range(summary) {
                lines.push(format!("时间范围: {range}"));
            }
        }
        lines.push(String::new());

        lines
    }

    /// 生成文件尾部信息。
    fn generate_footer(&self, total: usize) -> Vec<String> {
        vec![
            "===============================================".to_owned(),
            "              导出完成".to_owned(),
            "===============================================".to_owned(),
            format!("总计导出 {total} 条消息"),
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
            lines.push(format!("资源: {} 个文件", message.content.resources.len()));
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

    /// 换行处理（按字符数切分，不做 `Vec<char>` 中间分配）。
    fn wrap_line(&self, line: &str) -> String {
        let width = self.text_options.line_width;
        if width == 0 || line.chars().count() <= width {
            return line.to_owned();
        }
        let mut out = String::with_capacity(line.len() + self.text_options.indent_char.len() * 4);
        for (index, ch) in line.chars().enumerate() {
            if index > 0 && index % width == 0 {
                out.push('\n');
                out.push_str(&self.text_options.indent_char);
            }
            out.push(ch);
        }
        out
    }

    /// 格式化消息的实际时间范围。
    fn format_time_range(&self, summary: &TextSummary) -> Option<String> {
        let (start, end) = (summary.earliest?, summary.latest?);
        let start_time = format_timestamp(ms_to_local(start)?, self.ctx.options.time_format);
        let end_time = format_timestamp(ms_to_local(end)?, self.ctx.options.time_format);
        Some(format!("{start_time} - {end_time}"))
    }
}

/// 第一遍扫描得到的聚合信息（计数 / 资源数 / 时间范围）。
#[derive(Debug, Default)]
struct TextSummary {
    count: usize,
    resource_count: usize,
    earliest: Option<i64>,
    latest: Option<i64>,
}

impl TextSummary {
    fn consume(&mut self, message: &CleanMessage) {
        if message.id.is_empty() {
            return;
        }
        self.count += 1;
        self.resource_count += message.content.resources.len();
        let ts = message.timestamp;
        if ts <= 0 {
            return;
        }
        self.earliest = Some(self.earliest.map_or(ts, |e| e.min(ts)));
        self.latest = Some(self.latest.map_or(ts, |l| l.max(ts)));
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
