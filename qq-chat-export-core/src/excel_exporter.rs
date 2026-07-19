use crate::base::{ms_to_iso, now_iso, preprocess_messages, ExporterContext};
use crate::error::{ExportError, ExportResultT};
use crate::types::{ChatInfo, CleanMessage, ExportFormat, ExportOptions, ExportOutcome};
use indexmap::IndexMap;
use rust_xlsxwriter::{Workbook, Worksheet};
use serde_json::Value;
use std::time::Instant;

/// 列宽设置。
#[derive(Debug, Clone)]
pub struct ExcelColumnWidths {
    /// 时间列宽。
    pub timestamp: f64,
    /// 发送者列宽。
    pub sender: f64,
    /// 消息内容列宽。
    pub content: f64,
    /// 消息类型列宽。
    pub message_type: f64,
}

impl Default for ExcelColumnWidths {
    fn default() -> Self {
        Self {
            timestamp: 20.0,
            sender: 15.0,
            content: 60.0,
            message_type: 12.0,
        }
    }
}

/// Excel 格式选项。
#[derive(Debug, Clone)]
pub struct ExcelFormatOptions {
    /// 主工作表名称。
    pub sheet_name: String,
    /// 是否包含统计表。
    pub include_statistics: bool,
    /// 是否包含发送者统计表。
    pub include_sender_stats: bool,
    /// 是否包含资源统计表。
    pub include_resource_stats: bool,
    /// 列宽设置。
    pub column_widths: ExcelColumnWidths,
}

impl Default for ExcelFormatOptions {
    fn default() -> Self {
        Self {
            sheet_name: "聊天记录".to_owned(),
            include_statistics: true,
            include_sender_stats: true,
            include_resource_stats: true,
            column_widths: ExcelColumnWidths::default(),
        }
    }
}

/// 发送者统计条目。
#[derive(Debug, Clone)]
pub struct SenderEntry {
    /// 发送者 UID。
    pub uid: String,
    /// 发送者 QQ 号。
    pub uin: Option<String>,
    /// 消息数量。
    pub count: u64,
}

/// 消息统计。
#[derive(Debug, Clone, Default)]
pub struct MessageStatistics {
    /// 消息总数。
    pub total: u64,
    /// 按类型分组（插入序保序，与 JS 对象键序一致）。
    pub by_type: IndexMap<String, u64>,
    /// 按发送者显示名分组。
    pub by_sender: IndexMap<String, SenderEntry>,
    /// 资源总数。
    pub resources_total: u64,
    /// 资源按类型分组。
    pub resources_by_type: IndexMap<String, u64>,
    /// 资源总大小（字节）。
    pub resources_total_size: u64,
    /// 时间范围开始（ISO），可能为空串。
    pub time_range_start: String,
    /// 时间范围结束（ISO），可能为空串。
    pub time_range_end: String,
    /// 时间跨度（天，`Math.ceil` 语义）。
    pub duration_days: i64,
}

/// 计算消息统计。
#[must_use]
pub fn calculate_statistics(messages: &[CleanMessage]) -> MessageStatistics {
    let mut stats = MessageStatistics {
        total: messages.len() as u64,
        ..MessageStatistics::default()
    };
    if messages.is_empty() {
        return stats;
    }

    let mut ts: Vec<i64> = messages
        .iter()
        .map(|m| m.timestamp)
        .filter(|t| *t > 0)
        .collect();
    ts.sort_unstable();
    if let (Some(first), Some(last)) = (ts.first(), ts.last()) {
        stats.time_range_start = ms_to_iso(*first);
        stats.time_range_end = ms_to_iso(*last);
        let diff = last - first;
        stats.duration_days = diff.div_euclid(86_400_000)
            + i64::from(diff.rem_euclid(86_400_000) > 0);
    }

    for m in messages {
        *stats.by_type.entry(m.message_type.clone()).or_insert(0) += 1;

        let sender_key = if !m.sender.name.is_empty() {
            m.sender.name.clone()
        } else if !m.sender.uid.is_empty() {
            m.sender.uid.clone()
        } else {
            "未知用户".to_owned()
        };
        let entry = stats
            .by_sender
            .entry(sender_key)
            .or_insert_with(|| SenderEntry {
                uid: if m.sender.uid.is_empty() {
                    "unknown".to_owned()
                } else {
                    m.sender.uid.clone()
                },
                uin: m.sender.uin.clone(),
                count: 0,
            });
        if entry.uin.is_none() {
            entry.uin.clone_from(&m.sender.uin);
        }
        entry.count += 1;

        for r in &m.content.resources {
            stats.resources_total += 1;
            let t = if r.resource_type.is_empty() {
                "unknown".to_owned()
            } else {
                r.resource_type.clone()
            };
            *stats.resources_by_type.entry(t).or_insert(0) += 1;
            stats.resources_total_size += r.size.unwrap_or(0);
        }
    }

    stats
}

/// Excel 格式导出器。
pub struct ExcelExporter {
    ctx: ExporterContext,
    excel_options: ExcelFormatOptions,
}

impl ExcelExporter {
    /// 新建导出器。
    #[must_use]
    pub fn new(options: ExportOptions, excel_options: ExcelFormatOptions) -> Self {
        Self {
            ctx: ExporterContext::new(ExportFormat::Excel, options),
            excel_options,
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
        _chat_info: &ChatInfo,
    ) -> ExportResultT<ExportOutcome> {
        let start_time = Instant::now();
        self.ctx
            .update_progress(0, messages.len(), &format!("开始{}导出", self.ctx.format));
        self.ctx.ensure_output_directory().await?;

        let filtered = preprocess_messages(messages);
        self.ctx.check_cancelled()?;

        let mut workbook = Workbook::new();

        self.add_messages_sheet(&mut workbook, &filtered)?;
        if self.excel_options.include_statistics {
            self.add_statistics_sheet(&mut workbook, &filtered)?;
        }
        if self.excel_options.include_sender_stats {
            self.add_sender_stats_sheet(&mut workbook, &filtered)?;
        }
        if self.excel_options.include_resource_stats {
            self.add_resource_stats_sheet(&mut workbook, &filtered)?;
        }

        self.ctx.check_cancelled()?;

        // xlsxwriter 的保存是同步 CPU/IO 密集操作，放到阻塞线程池，避免卡住 runtime
        let output_path = self.ctx.options.output_path.clone();
        let buffer = tokio::task::spawn_blocking(move || workbook.save_to_buffer())
            .await
            .map_err(ExportError::TaskJoin)??;
        tokio::fs::write(&output_path, &buffer)
            .await
            .map_err(|e| ExportError::io("writeXlsx", &output_path, e))?;

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
            completed_at: now_iso(),
        })
    }

    /// 添加聊天记录工作表。
    fn add_messages_sheet(
        &self,
        workbook: &mut Workbook,
        messages: &[CleanMessage],
    ) -> ExportResultT<()> {
        let sheet = workbook.add_worksheet();
        sheet.set_name(&self.excel_options.sheet_name)?;

        // 群头衔列（issue #331）：仅当至少一条消息携带 sender.title 时插入
        let has_title_column = messages
            .iter()
            .any(|m| m.sender.title.as_deref().is_some_and(|t| !t.is_empty()));

        let mut headers: Vec<&str> = vec!["序号", "时间", "发送者", "发送者QQ号"];
        if has_title_column {
            headers.push("群头衔");
        }
        headers.extend(["消息类型", "消息内容", "是否撤回", "资源数量"]);
        write_string_row(sheet, 0, &headers)?;

        for (index, msg) in messages.iter().enumerate() {
            let row = (index + 1) as u32;
            let mut col: u16 = 0;
            sheet.write_number(row, col, (index + 1) as f64)?;
            col += 1;
            sheet.write_string(row, col, &msg.time)?;
            col += 1;
            sheet.write_string(row, col, sender_display_name(msg))?;
            col += 1;
            sheet.write_string(row, col, msg.sender.uin.as_deref().unwrap_or(""))?;
            col += 1;
            if has_title_column {
                sheet.write_string(row, col, msg.sender.title.as_deref().unwrap_or(""))?;
                col += 1;
            }
            sheet.write_string(row, col, message_type_label(&msg.message_type))?;
            col += 1;
            sheet.write_string(row, col, extract_text_content(msg))?;
            col += 1;
            sheet.write_string(row, col, if msg.recalled { "是" } else { "否" })?;
            col += 1;
            sheet.write_number(row, col, msg.content.resources.len() as f64)?;
        }

        // 工作表列宽
        let w = &self.excel_options.column_widths;
        let mut widths: Vec<f64> = vec![8.0, w.timestamp, w.sender, 16.0];
        if has_title_column {
            widths.push(14.0);
        }
        widths.extend([w.message_type, w.content, 10.0, 12.0]);
        for (i, width) in widths.iter().enumerate() {
            sheet.set_column_width(i as u16, *width)?;
        }
        Ok(())
    }

    /// 添加统计信息工作表。
    fn add_statistics_sheet(
        &self,
        workbook: &mut Workbook,
        messages: &[CleanMessage],
    ) -> ExportResultT<()> {
        let stats = calculate_statistics(messages);
        let sheet = workbook.add_worksheet();
        sheet.set_name("统计信息")?;

        let mut row: u32 = 0;
        let kv_str = |sheet: &mut Worksheet, row: &mut u32, k: &str, v: &str| -> ExportResultT<()> {
            sheet.write_string(*row, 0, k)?;
            sheet.write_string(*row, 1, v)?;
            *row += 1;
            Ok(())
        };
        let kv_num = |sheet: &mut Worksheet, row: &mut u32, k: &str, v: f64| -> ExportResultT<()> {
            sheet.write_string(*row, 0, k)?;
            sheet.write_number(*row, 1, v)?;
            *row += 1;
            Ok(())
        };

        kv_str(sheet, &mut row, "统计项目", "数值")?;
        kv_num(sheet, &mut row, "消息总数", stats.total as f64)?;
        kv_str(sheet, &mut row, "开始时间", &stats.time_range_start)?;
        kv_str(sheet, &mut row, "结束时间", &stats.time_range_end)?;
        #[allow(clippy::cast_precision_loss)]
        kv_num(sheet, &mut row, "时间跨度(天)", stats.duration_days as f64)?;
        row += 1; // 空行

        kv_str(sheet, &mut row, "消息类型", "数量")?;
        for (msg_type, count) in &stats.by_type {
            kv_num(sheet, &mut row, message_type_label(msg_type), *count as f64)?;
        }
        row += 1; // 空行

        kv_str(sheet, &mut row, "资源统计", "")?;
        kv_num(sheet, &mut row, "总资源数", stats.resources_total as f64)?;
        kv_num(
            sheet,
            &mut row,
            "总大小(字节)",
            stats.resources_total_size as f64,
        )?;
        row += 1; // 空行

        kv_str(sheet, &mut row, "资源类型", "数量")?;
        for (res_type, count) in &stats.resources_by_type {
            kv_num(sheet, &mut row, res_type, *count as f64)?;
        }

        sheet.set_column_width(0, 20.0)?;
        sheet.set_column_width(1, 30.0)?;
        Ok(())
    }

    /// 添加发送者统计工作表。
    fn add_sender_stats_sheet(
        &self,
        workbook: &mut Workbook,
        messages: &[CleanMessage],
    ) -> ExportResultT<()> {
        let stats = calculate_statistics(messages);
        let sheet = workbook.add_worksheet();
        sheet.set_name("发送者统计")?;

        write_string_row(
            sheet,
            0,
            &["排名", "发送者", "QQ号", "UID", "消息数量", "占比(%)"],
        )?;

        let mut senders: Vec<(&String, &SenderEntry)> = stats.by_sender.iter().collect();
        senders.sort_by_key(|(_, entry)| std::cmp::Reverse(entry.count));

        for (index, (name, entry)) in senders.iter().enumerate() {
            let row = (index + 1) as u32;
            let percentage = if stats.total > 0 {
                (entry.count as f64 / stats.total as f64 * 10000.0).round() / 100.0
            } else {
                0.0
            };
            sheet.write_number(row, 0, (index + 1) as f64)?;
            sheet.write_string(row, 1, name.as_str())?;
            sheet.write_string(row, 2, entry.uin.as_deref().unwrap_or(""))?;
            sheet.write_string(row, 3, &entry.uid)?;
            sheet.write_number(row, 4, entry.count as f64)?;
            sheet.write_number(row, 5, percentage)?;
        }

        for (i, width) in [8.0, 20.0, 16.0, 15.0, 12.0, 12.0].iter().enumerate() {
            sheet.set_column_width(i as u16, *width)?;
        }
        Ok(())
    }

    /// 添加资源统计工作表。
    fn add_resource_stats_sheet(
        &self,
        workbook: &mut Workbook,
        messages: &[CleanMessage],
    ) -> ExportResultT<()> {
        let sheet = workbook.add_worksheet();
        sheet.set_name("资源列表")?;

        write_string_row(
            sheet,
            0,
            &[
                "序号",
                "时间",
                "发送者",
                "发送者QQ号",
                "资源类型",
                "文件名",
                "大小(字节)",
                "URL",
            ],
        )?;

        let mut row: u32 = 1;
        for msg in messages {
            for resource in &msg.content.resources {
                sheet.write_number(row, 0, f64::from(row))?;
                sheet.write_string(row, 1, &msg.time)?;
                sheet.write_string(row, 2, sender_display_name(msg))?;
                sheet.write_string(row, 3, msg.sender.uin.as_deref().unwrap_or(""))?;
                sheet.write_string(row, 4, &resource.resource_type)?;
                sheet.write_string(row, 5, resource.filename.as_deref().unwrap_or(""))?;
                #[allow(clippy::cast_precision_loss)]
                sheet.write_number(row, 6, resource.size.unwrap_or(0) as f64)?;
                let url = resource
                    .url
                    .as_deref()
                    .filter(|u| !u.is_empty())
                    .or(resource.local_path.as_deref())
                    .unwrap_or("");
                sheet.write_string(row, 7, url)?;
                row += 1;
            }
        }

        for (i, width) in [8.0, 20.0, 15.0, 16.0, 12.0, 30.0, 15.0, 50.0]
            .iter()
            .enumerate()
        {
            sheet.set_column_width(i as u16, *width)?;
        }
        Ok(())
    }
}

fn write_string_row(sheet: &mut Worksheet, row: u32, values: &[&str]) -> ExportResultT<()> {
    for (col, value) in values.iter().enumerate() {
        sheet.write_string(row, col as u16, *value)?;
    }
    Ok(())
}

/// 发送者展示名称。
fn sender_display_name(msg: &CleanMessage) -> &str {
    if !msg.sender.name.is_empty() {
        &msg.sender.name
    } else if !msg.sender.uid.is_empty() {
        &msg.sender.uid
    } else {
        "未知用户"
    }
}

/// 消息类型标签（未知类型原样返回）。
#[must_use]
pub fn message_type_label(msg_type: &str) -> &str {
    match msg_type {
        "text" => "文本",
        "image" => "图片",
        "video" => "视频",
        "audio" => "音频",
        "file" => "文件",
        "face" => "表情",
        "at" => "@提及",
        "reply" => "回复",
        "system" => "系统消息",
        "unknown" => "未知",
        other => other,
    }
}

/// 提取消息的文本内容。
#[must_use]
pub fn extract_text_content(msg: &CleanMessage) -> String {
    let mut text = msg.content.text.clone();

    if text.is_empty() && !msg.content.elements.is_empty() {
        let text_elements: Vec<&str> = msg
            .content
            .elements
            .iter()
            .filter(|e| e.element_type == "text")
            .filter_map(|e| e.data.get("text").and_then(Value::as_str))
            .filter(|t| !t.is_empty())
            .collect();
        if text_elements.is_empty() {
            let element_types: Vec<&str> = msg
                .content
                .elements
                .iter()
                .map(|e| e.element_type.as_str())
                .collect();
            text = if element_types.is_empty() {
                "[无文本内容]".to_owned()
            } else {
                format!("[{}]", element_types.join(", "))
            };
        } else {
            text = text_elements.join(" ");
        }
    }

    if !msg.content.resources.is_empty() {
        let resource_info: Vec<String> = msg
            .content
            .resources
            .iter()
            .map(|r| {
                format!(
                    "[{}: {}]",
                    r.resource_type,
                    r.filename.as_deref().unwrap_or("")
                )
            })
            .collect();
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(&resource_info.join(" "));
    }

    if text.is_empty() {
        "[空消息]".to_owned()
    } else {
        text
    }
}
