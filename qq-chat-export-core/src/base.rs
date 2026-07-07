use crate::error::{ExportError, ExportResultT};
use crate::types::{
    CancellationToken, CleanMessage, ExportFormat, ExportOptions, ExportProgress,
    ProgressCallback, TimeFormat,
};
use chrono::{DateTime, Datelike, Local, TimeZone, Timelike, Utc};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 导出器共享上下文。
pub struct ExporterContext {
    /// 导出格式。
    pub format: ExportFormat,
    /// 导出选项。
    pub options: ExportOptions,
    /// 取消令牌。
    pub cancellation: CancellationToken,
    /// 进度回调（可选）。
    pub progress_callback: Option<ProgressCallback>,
}

impl ExporterContext {
    /// 新建上下文。
    #[must_use]
    pub fn new(format: ExportFormat, options: ExportOptions) -> Self {
        Self {
            format,
            options,
            cancellation: CancellationToken::new(),
            progress_callback: None,
        }
    }

    /// 设置进度回调。
    pub fn set_progress_callback(&mut self, callback: Option<ProgressCallback>) {
        self.progress_callback = callback;
    }

    /// 更新进度（对应 TS `updateProgress`）。
    pub fn update_progress(&self, current: usize, total: usize, message: &str) {
        if let Some(cb) = &self.progress_callback {
            let percentage = if total > 0 {
                let ratio = current as f64 / total as f64 * 100.0;
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                {
                    ratio.round() as u32
                }
            } else {
                0
            };
            cb(ExportProgress {
                current,
                total,
                percentage,
                message: message.to_owned(),
            });
        }
    }

    /// 检查取消：已取消时返回 `ExportError::Cancelled`。
    pub fn check_cancelled(&self) -> ExportResultT<()> {
        if self.cancellation.is_cancelled() {
            Err(ExportError::Cancelled)
        } else {
            Ok(())
        }
    }

    /// 确保输出目录存在（对应 TS `ensureOutputDirectory`）。
    pub async fn ensure_output_directory(&self) -> ExportResultT<()> {
        ensure_parent_dir(&self.options.output_path).await
    }

    /// 获取输出文件大小；失败时返回 0（与 TS `getFileSize` 一致）。
    pub async fn output_file_size(&self) -> u64 {
        file_size_or_zero(&self.options.output_path).await
    }

    /// 按指定时间格式格式化本地时间（对应 TS `formatTimestamp`）。
    #[must_use]
    pub fn format_timestamp(&self, ts: DateTime<Local>) -> String {
        format_timestamp(ts, self.options.time_format)
    }

    /// issue #277：把 `resource_map` 中已下载的资源复制到导出目录
    /// `resources/<typeDir>/<fileName>` 下（对应 TS `copyResourcesAlongsideExport`）。
    ///
    /// - 重复目标路径按存在性跳过；
    /// - 单个资源拷贝失败仅跳过，不中断导出；
    /// - `resource_map` 为空时 no-op。
    pub async fn copy_resources_alongside_export(&self, output_dir: &Path) -> usize {
        let map = &self.options.resource_map;
        if map.is_empty() {
            return 0;
        }

        let mut copied = 0usize;
        let mut seen: HashSet<PathBuf> = HashSet::new();
        for resources in map.values() {
            for r in resources {
                let Some(local_path) = r.local_path.as_deref() else {
                    continue;
                };
                if local_path.trim().is_empty() {
                    continue;
                }
                let source = Path::new(local_path);
                let Ok(meta) = tokio::fs::metadata(source).await else {
                    continue;
                };
                if !meta.is_file() {
                    continue;
                }

                let Some(file_name) = source.file_name() else {
                    continue;
                };
                let type_dir = resource_type_dir(&r.resource_type);
                let target_dir = output_dir.join("resources").join(type_dir);
                let target_path = target_dir.join(file_name);
                if !seen.insert(target_path.clone()) {
                    continue;
                }

                if tokio::fs::try_exists(&target_path).await.unwrap_or(false) {
                    copied += 1;
                    continue;
                }
                if tokio::fs::create_dir_all(&target_dir).await.is_err() {
                    continue;
                }
                if tokio::fs::copy(source, &target_path).await.is_ok() {
                    copied += 1;
                }
            }
        }
        copied
    }
}

/// 确保某个文件路径的父目录存在。
pub async fn ensure_parent_dir(path: &Path) -> ExportResultT<()> {
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            tokio::fs::create_dir_all(dir)
                .await
                .map_err(|e| ExportError::io("ensureOutputDirectory", dir, e))?;
        }
    }
    Ok(())
}

/// 获取文件大小；失败返回 0。
pub async fn file_size_or_zero(path: &Path) -> u64 {
    tokio::fs::metadata(path).await.map_or(0, |m| m.len())
}

/// 资源类型 → 目录名映射（与 TS `typeOf` 一致）。
#[must_use]
pub fn resource_type_dir(resource_type: &str) -> &'static str {
    match resource_type {
        "image" => "images",
        "video" => "videos",
        "audio" => "audios",
        _ => "files",
    }
}

/// HTML 转义（对应 TS `escapeHtml`：& < > " '）。
#[must_use]
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// 按 `TimeFormat` 格式化本地时间（对应 TS `formatTimestamp`）。
#[must_use]
pub fn format_timestamp(ts: DateTime<Local>, format: TimeFormat) -> String {
    match format {
        TimeFormat::DateOnly => format!("{:04}-{:02}-{:02}", ts.year(), ts.month(), ts.day()),
        TimeFormat::TimeOnly => {
            format!("{:02}:{:02}:{:02}", ts.hour(), ts.minute(), ts.second())
        }
        TimeFormat::Relative => relative_time(ts),
        TimeFormat::Full => format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            ts.year(),
            ts.month(),
            ts.day(),
            ts.hour(),
            ts.minute(),
            ts.second()
        ),
    }
}

/// 相对时间（对应 TS `getRelativeTime`）。
#[must_use]
fn relative_time(ts: DateTime<Local>) -> String {
    let diff_ms = Local::now().timestamp_millis() - ts.timestamp_millis();
    let minutes = diff_ms / 60_000;
    let hours = minutes / 60;
    let days = hours / 24;
    if days > 0 {
        format!("{days}天前")
    } else if hours > 0 {
        format!("{hours}小时前")
    } else if minutes > 0 {
        format!("{minutes}分钟前")
    } else {
        "刚刚".to_owned()
    }
}

/// 毫秒级时间戳 → 本地时间；无效时间返回 `None`。
#[must_use]
pub fn ms_to_local(ts_ms: i64) -> Option<DateTime<Local>> {
    Local.timestamp_millis_opt(ts_ms).single()
}

/// 毫秒级时间戳 → ISO 8601（UTC，形如 `2024-01-01T00:00:00.000Z`，与 JS
/// `Date#toISOString` 输出一致）。
#[must_use]
pub fn ms_to_iso(ts_ms: i64) -> String {
    Utc.timestamp_millis_opt(ts_ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default()
}

/// 当前时间的 ISO 8601（UTC）。
#[must_use]
pub fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// 按时间戳排序消息（对应 TS `sortMessagesByTimestamp`）。
///
/// `CleanMessage.timestamp` 已是毫秒级；与 TS 相同地把无效（<=0）时间戳排到最前，
/// 并对疑似秒级（10 位）时间戳做比较级换算，原始数据保持不变。
pub fn sort_messages_by_timestamp(messages: &mut [CleanMessage]) {
    messages.sort_by_key(|m| comparable_ts(m.timestamp));
}

fn comparable_ts(ts: i64) -> i64 {
    if ts <= 0 {
        return 0;
    }
    // 秒级时间戳（10 位数）换算为毫秒级用于比较
    if ts > 1_000_000_000 && ts < 10_000_000_000 {
        ts * 1000
    } else {
        ts
    }
}

/// 消息预处理：过滤空 ID + 时间排序（对应 TS `preprocessMessages`；
/// `applyPureImageFilter` 在 TS 侧已废弃为直通，这里同样直通）。
#[must_use]
pub fn preprocess_messages(messages: Vec<CleanMessage>) -> Vec<CleanMessage> {
    let mut valid: Vec<CleanMessage> = messages.into_iter().filter(|m| !m.id.is_empty()).collect();
    sort_messages_by_timestamp(&mut valid);
    valid
}
