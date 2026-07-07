use crate::base::{escape_html, format_timestamp, ms_to_local, preprocess_messages, ExporterContext};
use crate::error::{ExportError, ExportResultT};
use crate::types::{ChatInfo, CleanMessage, ExportFormat, ExportOptions, ExportOutcome};
use chrono::Local;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Instant;

/// HTML 主题（对应 TS `HtmlTheme`）。
#[derive(Debug, Clone)]
pub struct HtmlTheme {
    /// 主题名称。
    pub name: &'static str,
    /// 主色调。
    pub primary_color: &'static str,
    /// 次要色调。
    pub secondary_color: &'static str,
    /// 背景色。
    pub background_color: &'static str,
    /// 文字颜色。
    pub text_color: &'static str,
    /// 消息气泡颜色。
    pub bubble_color: &'static str,
    /// 字体家族。
    pub font_family: &'static str,
}

const FONT_STACK_CN: &str = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif";

/// 预定义主题（对应 TS `PREDEFINED_THEMES`）。
#[must_use]
pub fn predefined_theme(name: &str) -> Option<HtmlTheme> {
    match name {
        "default" => Some(HtmlTheme {
            name: "默认主题",
            primary_color: "#1890ff",
            secondary_color: "#f0f2f5",
            background_color: "#ffffff",
            text_color: "#262626",
            bubble_color: "#e6f7ff",
            font_family: FONT_STACK_CN,
        }),
        "dark" => Some(HtmlTheme {
            name: "暗黑主题",
            primary_color: "#177ddc",
            secondary_color: "#2f2f2f",
            background_color: "#1f1f1f",
            text_color: "#ffffff",
            bubble_color: "#3a3a3a",
            font_family: FONT_STACK_CN,
        }),
        "minimal" => Some(HtmlTheme {
            name: "简约主题",
            primary_color: "#52c41a",
            secondary_color: "#fafafa",
            background_color: "#ffffff",
            text_color: "#595959",
            bubble_color: "#f6ffed",
            font_family: "\"Helvetica Neue\", Helvetica, Arial, sans-serif",
        }),
        "wechat" => Some(HtmlTheme {
            name: "微信风格",
            primary_color: "#07c160",
            secondary_color: "#ededed",
            background_color: "#f5f5f5",
            text_color: "#333333",
            bubble_color: "#95ec69",
            font_family: FONT_STACK_CN,
        }),
        _ => None,
    }
}

fn default_theme() -> HtmlTheme {
    predefined_theme("default").expect("default 主题恒定存在")
}

/// HTML 格式选项（对应 TS `HtmlFormatOptions`）。
#[derive(Debug, Clone)]
pub struct HtmlFormatOptions {
    /// 页面标题（`None` 时取「聊天名 - 聊天记录」）。
    pub page_title: Option<String>,
    /// 主题设置。
    pub theme: HtmlTheme,
    /// 是否包含 CSS 样式。
    pub include_css: bool,
    /// 是否包含 JavaScript。
    pub include_js: bool,
    /// 是否启用响应式设计。
    pub responsive: bool,
    /// 是否显示时间戳。
    pub show_timestamps: bool,
    /// 是否显示头像。
    pub show_avatars: bool,
    /// 是否启用搜索功能。
    pub enable_search: bool,
    /// 是否启用消息统计。
    pub show_statistics: bool,
    /// 图片懒加载。
    pub lazy_load_images: bool,
    /// 自定义 CSS。
    pub custom_css: Option<String>,
    /// 自定义 JavaScript。
    pub custom_js: Option<String>,
}

impl Default for HtmlFormatOptions {
    fn default() -> Self {
        Self {
            page_title: None,
            theme: default_theme(),
            include_css: true,
            include_js: true,
            responsive: true,
            show_timestamps: true,
            show_avatars: true,
            enable_search: false,
            show_statistics: true,
            lazy_load_images: true,
            custom_css: None,
            custom_js: None,
        }
    }
}

/// HTML 格式导出器。
pub struct HtmlExporter {
    ctx: ExporterContext,
    html_options: HtmlFormatOptions,
}

struct MessageStats {
    total_messages: usize,
    unique_senders: usize,
    total_resources: usize,
    duration_days: i64,
}

impl HtmlExporter {
    /// 新建导出器。
    #[must_use]
    pub fn new(options: ExportOptions, html_options: HtmlFormatOptions) -> Self {
        Self {
            ctx: ExporterContext::new(ExportFormat::Html, options),
            html_options,
        }
    }

    /// 共享上下文（进度回调 / 取消令牌）。
    pub fn context_mut(&mut self) -> &mut ExporterContext {
        &mut self.ctx
    }

    /// 设置预定义主题（对应 TS `setTheme`；未知主题名保持不变）。
    pub fn set_theme(&mut self, theme_name: &str) {
        if let Some(theme) = predefined_theme(theme_name) {
            self.html_options.theme = theme;
        }
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

        // issue #277：拷贝资源到导出目录（失败不阻断导出）
        if let Some(dir) = self.ctx.options.output_path.parent() {
            self.ctx.copy_resources_alongside_export(dir).await;
        }

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

    /// 生成 HTML 内容（对应 TS `generateContent`）。
    fn generate_content(&self, messages: &[CleanMessage], chat_info: &ChatInfo) -> String {
        let statistics = if self.html_options.show_statistics {
            self.generate_statistics(messages)
        } else {
            String::new()
        };
        let search_bar = if self.html_options.enable_search {
            self.generate_search_bar()
        } else {
            String::new()
        };
        let js = if self.html_options.include_js {
            self.generate_javascript()
        } else {
            String::new()
        };

        let html = format!(
            "\n<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    {head}\n</head>\n<body>\n    <div class=\"chat-container\">\n        {header}\n        {statistics}\n        {search_bar}\n        <div class=\"messages-container\" id=\"messagesContainer\">\n            {messages}\n        </div>\n        {footer}\n    </div>\n    {js}\n</body>\n</html>",
            head = self.generate_html_head(chat_info),
            header = self.generate_header(chat_info, messages),
            messages = self.generate_messages_html(messages),
            footer = self.generate_footer(),
        );
        html.trim().to_owned()
    }

    /// 生成 HTML 头部（对应 TS `generateHtmlHead`）。
    fn generate_html_head(&self, chat_info: &ChatInfo) -> String {
        let title = self
            .html_options
            .page_title
            .clone()
            .unwrap_or_else(|| format!("{} - 聊天记录", chat_info.name));

        let css = if self.html_options.include_css {
            format!("<style>{}</style>", self.generate_css())
        } else {
            String::new()
        };
        let custom_css = self
            .html_options
            .custom_css
            .as_deref()
            .map(|c| format!("<style>{c}</style>"))
            .unwrap_or_default();

        format!(
            "\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <meta name=\"description\" content=\"{name}的聊天记录导出文件\">\n    <meta name=\"generator\" content=\"QQ聊天记录导出工具\">\n    <title>{title}</title>\n    {css}\n    {custom_css}\n    <link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><text y='20' font-size='20'>💬</text></svg>\">",
            name = chat_info.name,
            title = escape_html(&title),
        )
    }

    /// 生成 CSS 样式（对应 TS `generateCss`，主题变量注入逻辑一致）。
    fn generate_css(&self) -> String {
        let theme = &self.html_options.theme;
        let responsive = self.html_options.responsive;

        let body_responsive = if responsive {
            "\n            font-size: 14px;\n            @media (max-width: 768px) {\n                font-size: 12px;\n            }"
        } else {
            ""
        };
        let container_responsive = if responsive {
            "\n            @media (max-width: 768px) {\n                padding: 10px;\n            }"
        } else {
            ""
        };
        let message_responsive = if responsive {
            "\n            @media (max-width: 768px) {\n                padding: 12px;\n                margin-bottom: 15px;\n            }"
        } else {
            ""
        };
        let time_responsive = if responsive {
            "\n            @media (max-width: 768px) {\n                display: none;\n            }"
        } else {
            ""
        };
        let content_responsive = if responsive {
            "\n            @media (max-width: 768px) {\n                margin-left: 0;\n            }"
        } else {
            ""
        };
        let content_margin = if self.html_options.show_avatars {
            "46px"
        } else {
            "0"
        };
        let responsive_media = if responsive {
            "\n        @media (max-width: 768px) {\n            .chat-title {\n                font-size: 1.8em;\n            }\n            \n            .statistics {\n                grid-template-columns: repeat(2, 1fr);\n                gap: 10px;\n                padding: 15px;\n            }\n            \n            .stat-number {\n                font-size: 1.5em;\n            }\n            \n            .message-header {\n                flex-wrap: wrap;\n            }\n            \n            .message-time {\n                width: 100%;\n                margin-top: 5px;\n                margin-left: 46px;\n            }\n        }".to_owned()
        } else {
            String::new()
        };
        let dark_scheme = if theme.name == "默认主题" {
            "\n            body {\n                background-color: #1f1f1f;\n                color: #ffffff;\n            }\n            \n            .message {\n                background: #3a3a3a;\n            }\n            \n            .statistics {\n                background: #2f2f2f;\n            }"
        } else {
            ""
        };

        format!(
            r#"
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: {font_family};
            background-color: {background_color};
            color: {text_color};
            line-height: 1.6;{body_responsive}
        }}

        .chat-container {{
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;{container_responsive}
        }}

        .chat-header {{
            text-align: center;
            padding: 30px 0;
            border-bottom: 2px solid {secondary_color};
            margin-bottom: 30px;
        }}

        .chat-title {{
            font-size: 2.5em;
            font-weight: bold;
            color: {primary_color};
            margin-bottom: 10px;
        }}

        .chat-info {{
            font-size: 1.1em;
            color: {text_color};
            opacity: 0.8;
        }}

        .chat-avatar {{
            width: 80px;
            height: 80px;
            border-radius: 50%;
            margin: 0 auto 20px;
            background: {secondary_color};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2em;
        }}

        .statistics {{
            background: {secondary_color};
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }}

        .stat-item {{
            text-align: center;
        }}

        .stat-number {{
            font-size: 2em;
            font-weight: bold;
            color: {primary_color};
        }}

        .stat-label {{
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 5px;
        }}

        .search-bar {{
            margin-bottom: 20px;
        }}

        .search-input {{
            width: 100%;
            padding: 12px 20px;
            border: 2px solid {secondary_color};
            border-radius: 25px;
            font-size: 1em;
            background: {background_color};
            color: {text_color};
            transition: border-color 0.3s;
        }}

        .search-input:focus {{
            outline: none;
            border-color: {primary_color};
        }}

        .messages-container {{
            margin-bottom: 50px;
        }}

        .message {{
            margin-bottom: 20px;
            padding: 15px;
            border-radius: 12px;
            background: {bubble_color};
            position: relative;
            word-wrap: break-word;{message_responsive}
        }}

        .message.system {{
            text-align: center;
            background: {secondary_color};
            font-style: italic;
            opacity: 0.8;
        }}

        .message-header {{
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            gap: 10px;
        }}

        .message-avatar {{
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: {primary_color};
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 0.8em;
        }}

        .message-sender {{
            font-weight: bold;
            color: {primary_color};
            flex-grow: 1;
        }}

        /* 群头衔徽章（issue #331） */
        .message-sender-title {{
            display: inline-block;
            font-size: 0.75em;
            font-weight: 600;
            line-height: 1.4;
            color: #fff;
            background: linear-gradient(135deg, #ff7a59, #ff4d4f);
            padding: 1px 6px;
            border-radius: 4px;
            margin-right: 6px;
            white-space: nowrap;
            vertical-align: middle;
        }}

        .message-time {{
            font-size: 0.85em;
            opacity: 0.6;{time_responsive}
        }}

        .message-content {{
            margin-left: {content_margin};{content_responsive}
        }}

        .reply-content {{
            background: {secondary_color};
            padding: 8px 12px;
            border-radius: 8px;
            margin-bottom: 8px;
            border-left: 3px solid {primary_color};
            font-size: 0.9em;
            opacity: 0.8;
        }}

        .mention {{
            color: {primary_color};
            font-weight: bold;
            text-decoration: none;
        }}

        .mention:hover {{
            text-decoration: underline;
        }}

        .emoji {{
            font-size: 1.2em;
        }}

        .message-image, .message-video {{
            max-width: 100%;
            max-height: 400px;
            border-radius: 8px;
            margin: 8px 0;
            cursor: pointer;
            transition: transform 0.2s;
        }}

        .message-image:hover, .message-video:hover {{
            transform: scale(1.02);
        }}

        .message-audio {{
            width: 100%;
            margin: 8px 0;
        }}

        .message-file {{
            display: inline-flex;
            align-items: center;
            padding: 8px 12px;
            background: {secondary_color};
            border-radius: 8px;
            text-decoration: none;
            color: {text_color};
            margin: 8px 0;
            transition: background-color 0.2s;
        }}

        .message-file:hover {{
            background: {primary_color};
            color: white;
        }}

        .resource-placeholder {{
            display: inline-block;
            padding: 4px 8px;
            background: {secondary_color};
            border-radius: 4px;
            font-size: 0.9em;
            opacity: 0.8;
        }}

        .resources-list {{
            margin-top: 8px;
            padding: 8px;
            background: {secondary_color};
            border-radius: 6px;
            font-size: 0.9em;
        }}

        .resource-item {{
            margin: 4px 0;
            padding: 4px 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
        }}

        .resource-item:last-child {{
            border-bottom: none;
        }}

        .chat-footer {{
            text-align: center;
            padding: 30px 0;
            border-top: 2px solid {secondary_color};
            font-size: 0.9em;
            opacity: 0.6;
        }}

        .loading {{
            text-align: center;
            padding: 20px;
            opacity: 0.6;
        }}

        /* 响应式设计 */
        {responsive_media}

        /* 打印样式 */
        @media print {{
            .search-bar, .chat-footer {{
                display: none;
            }}
            
            .message {{
                break-inside: avoid;
                margin-bottom: 10px;
            }}
            
            .message-image, .message-video {{
                max-height: 200px;
            }}
        }}

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {{
            {dark_scheme}
        }}

        /* 动画效果 */
        .message {{
            animation: fadeIn 0.3s ease-in;
        }}

        @keyframes fadeIn {{
            from {{
                opacity: 0;
                transform: translateY(10px);
            }}
            to {{
                opacity: 1;
                transform: translateY(0);
            }}
        }}

        /* 滚动条样式 */
        ::-webkit-scrollbar {{
            width: 8px;
        }}

        ::-webkit-scrollbar-track {{
            background: {secondary_color};
        }}

        ::-webkit-scrollbar-thumb {{
            background: {primary_color};
            border-radius: 4px;
        }}

        ::-webkit-scrollbar-thumb:hover {{
            background: {primary_color}CC;
        }}
        "#,
            font_family = theme.font_family,
            background_color = theme.background_color,
            text_color = theme.text_color,
            secondary_color = theme.secondary_color,
            primary_color = theme.primary_color,
            bubble_color = theme.bubble_color,
        )
    }

    /// 生成页面头部（对应 TS `generateHeader`）。
    fn generate_header(&self, chat_info: &ChatInfo, messages: &[CleanMessage]) -> String {
        let time_range = self.get_time_range(messages);

        let avatar_block = match &chat_info.avatar {
            Some(avatar) => format!(
                "\n            <div class=\"chat-avatar\">\n                <img src=\"{avatar}\" alt=\"头像\" style=\"width: 100%; height: 100%; border-radius: 50%; object-fit: cover;\">\n            </div>"
            ),
            None => format!(
                "\n            <div class=\"chat-avatar\">\n                {}\n            </div>",
                chat_type_icon(&chat_info.chat_type)
            ),
        };
        let participant_block = chat_info
            .participant_count
            .filter(|c| *c > 0)
            .map(|c| format!("<div>参与人数: {c}</div>"))
            .unwrap_or_default();
        let time_range_block = time_range
            .map(|r| format!("<div>时间范围: {r}</div>"))
            .unwrap_or_default();

        format!(
            "\n        <div class=\"chat-header\">\n            {avatar_block}\n            <h1 class=\"chat-title\">{title}</h1>\n            <div class=\"chat-info\">\n                <div>{type_name}</div>\n                {participant_block}\n                <div>导出时间: {export_time}</div>\n                {time_range_block}\n            </div>\n        </div>",
            title = escape_html(&chat_info.name),
            type_name = chat_type_display_name(&chat_info.chat_type),
            export_time = format_timestamp(Local::now(), self.ctx.options.time_format),
        )
    }

    /// 生成统计信息（对应 TS `generateStatistics`）。
    fn generate_statistics(&self, messages: &[CleanMessage]) -> String {
        let stats = calculate_message_stats(messages);
        format!(
            "\n        <div class=\"statistics\">\n            <div class=\"stat-item\">\n                <div class=\"stat-number\">{}</div>\n                <div class=\"stat-label\">总消息数</div>\n            </div>\n            <div class=\"stat-item\">\n                <div class=\"stat-number\">{}</div>\n                <div class=\"stat-label\">参与者</div>\n            </div>\n            <div class=\"stat-item\">\n                <div class=\"stat-number\">{}</div>\n                <div class=\"stat-label\">资源文件</div>\n            </div>\n            <div class=\"stat-item\">\n                <div class=\"stat-number\">{}</div>\n                <div class=\"stat-label\">时间跨度(天)</div>\n            </div>\n        </div>",
            stats.total_messages, stats.unique_senders, stats.total_resources, stats.duration_days,
        )
    }

    /// 生成搜索栏（对应 TS `generateSearchBar`）。
    fn generate_search_bar(&self) -> String {
        "\n        <div class=\"search-bar\">\n            <input type=\"text\" class=\"search-input\" placeholder=\"搜索消息内容...\" id=\"searchInput\">\n        </div>".to_owned()
    }

    /// 生成消息 HTML 列表（对应 TS `generateMessagesHtml`）。
    fn generate_messages_html(&self, messages: &[CleanMessage]) -> String {
        let mut elements: Vec<String> = Vec::with_capacity(messages.len());
        for (i, message) in messages.iter().enumerate() {
            if self.ctx.cancellation.is_cancelled() {
                break;
            }
            elements.push(self.generate_message_html(message));
            if i % 50 == 0 {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]
                let current =
                    (messages.len() as f64 * 0.7 + i as f64 * 0.25).round() as usize;
                self.ctx.update_progress(
                    current,
                    messages.len(),
                    &format!("生成HTML {}/{}", i + 1, messages.len()),
                );
            }
        }
        elements.join("\n")
    }

    /// 生成单条消息 HTML（对应 TS `generateMessageHtml`）。
    fn generate_message_html(&self, message: &CleanMessage) -> String {
        if message.system {
            return format!(
                "\n            <div class=\"message system\" data-message-id=\"{id}\">\n                <div class=\"message-content\">\n                    {content}\n                </div>\n            </div>",
                id = message.id,
                content = process_message_text(&message.content.text),
            );
        }

        let sender_display = if message.sender.name.is_empty() {
            message.sender.uid.as_str()
        } else {
            message.sender.name.as_str()
        };

        let avatar_block = if self.html_options.show_avatars {
            let inner = match message.sender.avatar_base64.as_deref() {
                Some(avatar) if !avatar.is_empty() => format!(
                    "<img src=\"{avatar}\" alt=\"头像\" style=\"width: 100%; height: 100%; border-radius: 50%; object-fit: cover;\">"
                ),
                _ => avatar_placeholder(sender_display),
            };
            format!(
                "\n                <div class=\"message-avatar\">\n                    {inner}\n                </div>"
            )
        } else {
            String::new()
        };

        let title_block = match message.sender.title.as_deref() {
            Some(title) if !title.is_empty() => format!(
                "<span class=\"message-sender-title\">{}</span>",
                escape_html(title)
            ),
            _ => String::new(),
        };

        let time_block = if self.html_options.show_timestamps {
            let label = ms_to_local(message.timestamp)
                .map(|dt| format_timestamp(dt, self.ctx.options.time_format))
                .unwrap_or_default();
            format!("\n                <span class=\"message-time\">{label}</span>")
        } else {
            String::new()
        };

        let reply_block = find_reply_data(message)
            .map(|reply| self.generate_reply_html(reply))
            .unwrap_or_default();
        let text_block = if message.content.text.is_empty() {
            String::new()
        } else {
            process_message_text(&message.content.text)
        };
        let resources_block = if message.content.resources.is_empty() {
            String::new()
        } else {
            self.generate_resources_html(&message.content.resources)
        };

        format!(
            "\n        <div class=\"message\" data-message-id=\"{id}\">\n            <div class=\"message-header\">\n                {avatar_block}\n                {title_block}<span class=\"message-sender\">{sender}</span>\n                {time_block}\n            </div>\n            <div class=\"message-content\">\n                {reply_block}\n                {text_block}\n                {resources_block}\n            </div>\n        </div>",
            id = message.id,
            sender = escape_html(sender_display),
        )
    }

    /// 生成回复 HTML（对应 TS `generateReplyHtml`）。
    fn generate_reply_html(&self, reply: &Value) -> String {
        let sender_name = reply
            .get("senderName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("用户");
        let content = reply
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        format!(
            "\n        <div class=\"reply-content\">\n            <strong>{}:</strong>\n            {}\n        </div>",
            escape_html(sender_name),
            escape_html(content),
        )
    }

    /// 生成资源 HTML（对应 TS `generateResourcesHtml`）。
    fn generate_resources_html(&self, resources: &[crate::types::MessageResource]) -> String {
        let include_links = self.ctx.options.include_resource_links;
        let elements: Vec<String> = resources
            .iter()
            .map(|resource| {
                let resource_url = resource
                    .local_path
                    .as_deref()
                    .filter(|p| !p.is_empty())
                    .or(resource.url.as_deref())
                    .filter(|u| !u.is_empty());
                let file_name = resource.filename.as_deref().filter(|n| !n.is_empty());

                match resource.resource_type.as_str() {
                    "image" => {
                        if include_links {
                            if let Some(url) = resource_url {
                                let lazy = if self.html_options.lazy_load_images {
                                    "loading=\"lazy\""
                                } else {
                                    ""
                                };
                                return format!(
                                    "<img src=\"{url}\" alt=\"{}\" class=\"message-image\" {lazy}>",
                                    file_name.unwrap_or("image")
                                );
                            }
                        }
                        format!(
                            "<span class=\"resource-placeholder\">[图片: {}]</span>",
                            file_name.unwrap_or("unknown")
                        )
                    }
                    "video" => {
                        if include_links {
                            if let Some(url) = resource_url {
                                return format!(
                                    "<video src=\"{url}\" controls class=\"message-video\" preload=\"metadata\">[视频: {}]</video>",
                                    file_name.unwrap_or("video")
                                );
                            }
                        }
                        format!(
                            "<span class=\"resource-placeholder\">[视频: {}]</span>",
                            file_name.unwrap_or("unknown")
                        )
                    }
                    "audio" => {
                        if include_links {
                            if let Some(url) = resource_url {
                                return format!(
                                    "<audio src=\"{url}\" controls class=\"message-audio\" preload=\"metadata\">[语音: {}]</audio>",
                                    file_name.unwrap_or("audio")
                                );
                            }
                        }
                        format!(
                            "<span class=\"resource-placeholder\">[语音: {}]</span>",
                            file_name.unwrap_or("unknown")
                        )
                    }
                    "file" => {
                        if include_links {
                            if let Some(url) = resource_url {
                                return format!(
                                    "<a href=\"{url}\" class=\"message-file\" download=\"{name}\">📎 {name}</a>",
                                    name = file_name.unwrap_or("file")
                                );
                            }
                        }
                        format!(
                            "<span class=\"resource-placeholder\">[文件: {}]</span>",
                            file_name.unwrap_or("unknown")
                        )
                    }
                    other => format!(
                        "<span class=\"resource-placeholder\">[{other}: {}]</span>",
                        file_name.unwrap_or("unknown")
                    ),
                }
            })
            .collect();
        elements.join("<br>")
    }

    /// 生成页脚（对应 TS `generateFooter`）。
    fn generate_footer(&self) -> String {
        format!(
            "\n        <div class=\"chat-footer\">\n            <p>由 <strong>QQ聊天记录导出工具</strong> 生成</p>\n            <p>导出时间: {}</p>\n        </div>",
            format_timestamp(Local::now(), self.ctx.options.time_format),
        )
    }

    /// 生成 JavaScript（对应 TS `generateJavaScript`）。
    fn generate_javascript(&self) -> String {
        let search_js = if self.html_options.enable_search {
            r"
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                let searchTimeout;
                searchInput.addEventListener('input', function() {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        const searchTerm = this.value.toLowerCase();
                        const messages = document.querySelectorAll('.message');
                        
                        messages.forEach(message => {
                            const content = message.textContent.toLowerCase();
                            if (searchTerm === '' || content.includes(searchTerm)) {
                                message.style.display = '';
                            } else {
                                message.style.display = 'none';
                            }
                        });
                    }, 300);
                });
            }"
        } else {
            ""
        };
        let lazy_js = if self.html_options.lazy_load_images {
            r"
            if ('IntersectionObserver' in window) {
                const imageObserver = new IntersectionObserver((entries, observer) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            if (img.dataset.src) {
                                img.src = img.dataset.src;
                                img.removeAttribute('data-src');
                                observer.unobserve(img);
                            }
                        }
                    });
                });

                document.querySelectorAll('img[data-src]').forEach(img => {
                    imageObserver.observe(img);
                });
            }"
        } else {
            ""
        };
        let custom_js = self.html_options.custom_js.as_deref().unwrap_or("");

        format!(
            r#"
        <script>
        (function() {{
            // 搜索功能
            {search_js}

            // 图片点击放大
            document.addEventListener('click', function(e) {{
                if (e.target.classList.contains('message-image')) {{
                    const img = e.target;
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; cursor: pointer;';
                    
                    const enlargedImg = img.cloneNode();
                    enlargedImg.style.cssText = 'max-width: 90%; max-height: 90%; object-fit: contain;';
                    
                    overlay.appendChild(enlargedImg);
                    document.body.appendChild(overlay);
                    
                    overlay.addEventListener('click', () => {{
                        document.body.removeChild(overlay);
                    }});
                }}
            }});

            // 懒加载实现
            {lazy_js}

            // 平滑滚动到锚点
            document.addEventListener('click', function(e) {{
                if (e.target.tagName === 'A' && e.target.hash) {{
                    e.preventDefault();
                    const target = document.querySelector(e.target.hash);
                    if (target) {{
                        target.scrollIntoView({{ behavior: 'smooth' }});
                    }}
                }}
            }});

            // 自定义JavaScript
            {custom_js}

            console.log('QQ聊天记录导出工具 - HTML页面已加载完成');
        }})();
        </script>"#
        )
    }

    /// 获取时间范围（对应 TS `getTimeRange`）。
    fn get_time_range(&self, messages: &[CleanMessage]) -> Option<String> {
        if messages.is_empty() {
            return None;
        }
        let mut earliest = messages[0].timestamp;
        let mut latest = messages[0].timestamp;
        for msg in messages {
            earliest = earliest.min(msg.timestamp);
            latest = latest.max(msg.timestamp);
        }
        let start = format_timestamp(ms_to_local(earliest)?, self.ctx.options.time_format);
        let end = format_timestamp(ms_to_local(latest)?, self.ctx.options.time_format);
        Some(format!("{start} 至 {end}"))
    }
}

/// 消息统计（对应 TS `calculateMessageStats`）。
fn calculate_message_stats(messages: &[CleanMessage]) -> MessageStats {
    let senders: HashSet<&str> = messages.iter().map(|m| m.sender.uid.as_str()).collect();
    let total_resources: usize = messages.iter().map(|m| m.content.resources.len()).sum();

    let mut duration_days = 0i64;
    if !messages.is_empty() {
        let mut earliest = messages[0].timestamp;
        let mut latest = messages[0].timestamp;
        for msg in messages {
            earliest = earliest.min(msg.timestamp);
            latest = latest.max(msg.timestamp);
        }
        duration_days = (latest - earliest).div_euclid(86_400_000)
            + i64::from((latest - earliest).rem_euclid(86_400_000) > 0);
    }

    MessageStats {
        total_messages: messages.len(),
        unique_senders: senders.len(),
        total_resources,
        duration_days,
    }
}

/// 处理消息文本（URL 链接 + 换行；对应 TS `processMessageText`）。
#[must_use]
pub fn process_message_text(text: &str) -> String {
    let escaped = escape_html(text);
    let linked = linkify_urls(&escaped);
    linked.replace('\n', "<br>")
}

/// 简易 URL 链接化（等价于 TS 的 `/(https?:\/\/[^\s]+)/g` 替换）。
fn linkify_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let Some(pos) = rest.find("http") else {
            out.push_str(rest);
            break;
        };
        let (before, candidate) = rest.split_at(pos);
        out.push_str(before);
        let scheme_len = if candidate.starts_with("https://") {
            8
        } else if candidate.starts_with("http://") {
            7
        } else {
            out.push_str("http");
            rest = &candidate[4..];
            continue;
        };
        let after_scheme = &candidate[scheme_len..];
        let url_end = after_scheme
            .find(char::is_whitespace)
            .unwrap_or(after_scheme.len());
        if url_end == 0 {
            out.push_str(&candidate[..scheme_len]);
            rest = after_scheme;
            continue;
        }
        let url = &candidate[..scheme_len + url_end];
        out.push_str(&format!(
            "<a href=\"{url}\" target=\"_blank\" rel=\"noopener noreferrer\">{url}</a>"
        ));
        rest = &candidate[scheme_len + url_end..];
    }
    out
}

/// 头像占位符：名字首字符大写（对应 TS `generateAvatarPlaceholder`）。
fn avatar_placeholder(name: &str) -> String {
    name.chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_default()
}

/// 聊天类型图标（对应 TS `getChatTypeIcon`）。
#[must_use]
pub fn chat_type_icon(chat_type: &str) -> &'static str {
    match chat_type {
        "group" => "👥",
        "private" => "💬",
        "temp" => "⏰",
        _ => "💭",
    }
}

/// 聊天类型显示名称（对应 TS `getChatTypeDisplayName`；未知类型原样返回）。
#[must_use]
pub fn chat_type_display_name(chat_type: &str) -> &str {
    match chat_type {
        "group" => "群聊",
        "private" => "私聊",
        "temp" => "临时聊天",
        other => other,
    }
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
