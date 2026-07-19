use crate::base::{ensure_parent_dir, file_size_or_zero, now_iso, preprocess_messages, ExporterContext};
use crate::chunked_jsonl_writer::{
    ChunkedJsonlChunkInfo, ChunkedJsonlWriter, ChunkedJsonlWriterOptions,
};
use crate::error::{ExportError, ExportResultT};
use crate::json_templates::{
    create_json_stream_context, format_chunk_file_name, render_json_file,
    JsonObjectStreamTemplates, JsonSingleFileTemplates, DEFAULT_AVATARS_FILE_NAME,
    DEFAULT_CHUNKS_DIR_NAME, DEFAULT_MANIFEST_FILE_NAME,
};
use crate::stats::{FinalStats, StatsAccumulator};
use crate::stream_utils::{yield_to_event_loop, BufferedTextWriter, DEFAULT_FLUSH_THRESHOLD};
use crate::types::{
    AppMetadata, ChatInfo, CleanMessage, ExportFormat, ExportOptions, ExportOutcome,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// 导出模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum JsonExportMode {
    /// 单文件 JSON（默认）。
    #[default]
    SingleJson,
    /// manifest + chunks/*.jsonl。
    ChunkedJsonl,
}

/// 分块 JSONL 导出选项。
#[derive(Debug, Clone)]
pub struct ChunkedJsonlExportOptions {
    /// 输出目录；`None` 时从 `output_path` 推导：`<outputBase>_chunked_jsonl`。
    pub output_dir: Option<PathBuf>,
    /// chunks 子目录名（默认 `chunks`）。
    pub chunks_dir_name: String,
    /// manifest 文件名（默认 `manifest.json`）。
    pub manifest_file_name: String,
    /// avatars 文件名（默认 `avatars.json`）。
    pub avatars_file_name: String,
    /// chunk 文件扩展名（默认 `.jsonl`）。
    pub chunk_file_ext: String,
    /// 每个 chunk 最大消息数（0 = 不限）。
    pub max_messages_per_chunk: u64,
    /// 每个 chunk 最大字节数（0 = 不限）。
    pub max_bytes_per_chunk: u64,
}

impl Default for ChunkedJsonlExportOptions {
    fn default() -> Self {
        Self {
            output_dir: None,
            chunks_dir_name: DEFAULT_CHUNKS_DIR_NAME.to_owned(),
            manifest_file_name: DEFAULT_MANIFEST_FILE_NAME.to_owned(),
            avatars_file_name: DEFAULT_AVATARS_FILE_NAME.to_owned(),
            chunk_file_ext: ".jsonl".to_owned(),
            // 建议默认：5 万条或 50MB
            max_messages_per_chunk: 50_000,
            max_bytes_per_chunk: 50 * 1024 * 1024,
        }
    }
}

/// JSON 格式选项。
#[derive(Debug, Clone)]
pub struct JsonFormatOptions {
    /// 是否美化输出。
    pub pretty: bool,
    /// 缩进字符数。
    pub indent: usize,
    /// 是否包含详细元数据（exportOptions 字段）。
    pub include_metadata: bool,
    /// 是否将头像嵌入为 base64。
    pub embed_avatars_as_base64: bool,
    /// 导出模式。
    pub export_mode: JsonExportMode,
    /// chunked-jsonl 默认参数。
    pub chunked_jsonl: ChunkedJsonlExportOptions,
}

impl Default for JsonFormatOptions {
    fn default() -> Self {
        Self {
            pretty: true,
            indent: 2,
            include_metadata: true,
            embed_avatars_as_base64: false,
            export_mode: JsonExportMode::SingleJson,
            chunked_jsonl: ChunkedJsonlExportOptions::default(),
        }
    }
}

/// chunked-jsonl manifest。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkedJsonlManifest<'a> {
    metadata: &'a AppMetadata,
    chat_info: &'a FormattedChatInfo,
    statistics: &'a FinalStats,
    chunked: ChunkedSection<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatars: Option<AvatarsRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    export_options: Option<ExportOptionsRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkedSection<'a> {
    format: &'static str,
    chunks_dir: &'a str,
    chunk_file_ext: &'a str,
    max_messages_per_chunk: u64,
    max_bytes_per_chunk: u64,
    chunks: &'a [ChunkedJsonlChunkInfo],
}

#[derive(Debug, Clone, Serialize)]
struct AvatarsRef {
    file: String,
    count: usize,
}

/// 导出选项记录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptionsRecord {
    included_fields: Vec<&'static str>,
    filters: Value,
    options: Value,
}

/// 格式化后的 chatInfo。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormattedChatInfo {
    name: String,
    #[serde(rename = "type")]
    chat_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    self_uid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    self_uin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    self_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    peer_uid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    peer_uin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    participant_count: Option<u64>,
}

/// chunked-jsonl 导出结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkedJsonlOutcome {
    /// 兼容 `ExportOutcome` 的通用字段。
    #[serde(flatten)]
    pub base: ExportOutcome,
    /// 输出目录。
    pub output_dir: PathBuf,
    /// manifest 路径。
    pub manifest_path: PathBuf,
    /// chunk 数量。
    pub chunk_count: usize,
}

/// JSON 格式导出器。
pub struct JsonExporter {
    ctx: ExporterContext,
    json_options: JsonFormatOptions,
    metadata: AppMetadata,
    http: reqwest::Client,
}

impl JsonExporter {
    /// 新建导出器。
    #[must_use]
    pub fn new(options: ExportOptions, json_options: JsonFormatOptions) -> Self {
        Self {
            ctx: ExporterContext::new(ExportFormat::Json, options),
            json_options,
            metadata: AppMetadata::default(),
            http: reqwest::Client::new(),
        }
    }

    /// 共享上下文（进度回调 / 取消令牌）。
    pub fn context_mut(&mut self) -> &mut ExporterContext {
        &mut self.ctx
    }

    /// 覆盖应用元信息。
    pub fn set_metadata(&mut self, metadata: AppMetadata) {
        self.metadata = metadata;
    }

    /// 导出入口。
    pub async fn export(
        &self,
        messages: Vec<CleanMessage>,
        chat_info: &ChatInfo,
    ) -> ExportResultT<ExportOutcome> {
        match self.json_options.export_mode {
            JsonExportMode::ChunkedJsonl => {
                let r = self
                    .export_chunked_jsonl(messages, chat_info, self.json_options.chunked_jsonl.clone())
                    .await?;
                Ok(r.base)
            }
            JsonExportMode::SingleJson => self.export_single_json_streaming(messages, chat_info).await,
        }
    }

    /// 方案 A：单文件 JSON 两阶段流式导出。
    ///
    /// 阶段 1：写 NDJSON 临时文件（issue #192：临时文件放输出目录而非系统临时目录）；
    /// 阶段 2：流式读 NDJSON，合成最终 JSON（metadata / statistics / avatars）。
    pub async fn export_single_json_streaming(
        &self,
        messages: Vec<CleanMessage>,
        chat_info: &ChatInfo,
    ) -> ExportResultT<ExportOutcome> {
        let start_time = Instant::now();
        self.ctx
            .update_progress(0, messages.len(), "开始JSON流式导出");
        self.ctx.ensure_output_directory().await?;

        let filtered = preprocess_messages(messages);
        let total = filtered.len();

        let output_dir = self
            .ctx
            .options
            .output_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let tmp_file = output_dir.join(format!(".qce_temp_{nanos}.ndjson"));

        let result = self
            .export_single_json_inner(&filtered, chat_info, &tmp_file, total, start_time)
            .await;

        // 无论成败都清理临时文件
        let _ = tokio::fs::remove_file(&tmp_file).await;

        result
    }

    async fn export_single_json_inner(
        &self,
        filtered: &[CleanMessage],
        chat_info: &ChatInfo,
        tmp_file: &Path,
        total: usize,
        start_time: Instant,
    ) -> ExportResultT<ExportOutcome> {
        // 阶段1: 写 NDJSON
        let mut ndjson_writer =
            BufferedTextWriter::create(tmp_file, DEFAULT_FLUSH_THRESHOLD).await?;
        let mut stats_acc = StatsAccumulator::new();
        let mut resource_count = 0usize;

        // 头像 base64 预下载
        let avatar_map = if self.json_options.embed_avatars_as_base64 {
            Some(self.pre_download_avatars(filtered).await)
        } else {
            None
        };

        let resource_map = &self.ctx.options.resource_map;

        for (i, msg) in filtered.iter().enumerate() {
            self.ctx.check_cancelled()?;

            stats_acc.consume(msg);
            resource_count += msg.content.resources.len();

            let mut clean_msg = msg.clone();
            // 智能清理 rawMessage：递归删除 null / 空值
            if let Some(raw) = clean_msg.raw_message.take() {
                clean_msg.raw_message = clean_raw_message(&raw);
            }
            // issue #277：把已下载资源的相对路径写到消息
            if let Some(resources) = resource_map.get(&clean_msg.id) {
                update_message_resource_paths(&mut clean_msg, resources);
            }

            ndjson_writer
                .write(&serde_json::to_string(&clean_msg)?)
                .await?;
            ndjson_writer.write("\n").await?;

            if (i + 1) % 5000 == 0 {
                yield_to_event_loop().await;
                self.ctx
                    .update_progress(i + 1, total, &format!("解析进度 {}/{total}", i + 1));
            }
        }
        ndjson_writer.end().await?;

        // 阶段2: 合成最终 JSON
        let final_stats = stats_acc.finalize();
        let formatted_chat_info = self.format_chat_info_async(chat_info).await;

        let mut out_writer =
            BufferedTextWriter::create(&self.ctx.options.output_path, DEFAULT_FLUSH_THRESHOLD)
                .await?;
        let ctx = create_json_stream_context(self.json_options.pretty, "  ");

        out_writer
            .write(&JsonSingleFileTemplates::begin(
                &self.metadata,
                &formatted_chat_info,
                &final_stats,
                &ctx,
            )?)
            .await?;

        // 流式读取 NDJSON，逐行输出到 messages 数组
        {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let read_file = tokio::fs::File::open(tmp_file)
                .await
                .map_err(|e| ExportError::io("readNdjson", tmp_file, e))?;
            let mut lines = BufReader::new(read_file).lines();
            let mut is_first = true;
            while let Some(line) = lines
                .next_line()
                .await
                .map_err(|e| ExportError::io("readNdjson", tmp_file, e))?
            {
                if line.trim().is_empty() {
                    continue;
                }
                if !is_first {
                    out_writer.write(&format!(",{}", ctx.nl)).await?;
                }
                if ctx.pretty {
                    out_writer
                        .write(&format!("{0}{0}{line}", ctx.indent_unit))
                        .await?;
                } else {
                    out_writer.write(&line).await?;
                }
                is_first = false;
            }
        }

        out_writer
            .write(&JsonSingleFileTemplates::messages_array_end(&ctx))
            .await?;

        // 头像嵌入（单文件模式：写入 avatars 字段）
        if let Some(avatar_map) = &avatar_map {
            if !avatar_map.is_empty() {
                out_writer
                    .write(&JsonSingleFileTemplates::avatars_begin(&ctx))
                    .await?;
                let total_avatars = avatar_map.len();
                for (idx, (uin, base64)) in avatar_map.iter().enumerate() {
                    let is_last = idx + 1 == total_avatars;
                    out_writer
                        .write(&JsonSingleFileTemplates::avatar_entry(
                            uin, base64, is_last, &ctx,
                        )?)
                        .await?;
                }
                out_writer
                    .write(&JsonSingleFileTemplates::avatars_end(&ctx))
                    .await?;
            }
        }

        if self.json_options.include_metadata {
            let export_options = self.generate_export_options();
            out_writer
                .write(&JsonSingleFileTemplates::export_options_field(
                    &export_options,
                    &ctx,
                )?)
                .await?;
        }

        out_writer.write(&JsonSingleFileTemplates::end(&ctx)).await?;
        out_writer.end().await?;

        // issue #277：拷贝资源到导出目录（失败不阻断导出）
        if let Some(dir) = self.ctx.options.output_path.parent() {
            self.ctx.copy_resources_alongside_export(dir).await;
        }

        self.ctx.update_progress(total, total, "导出完成");

        Ok(ExportOutcome {
            task_id: String::new(),
            format: self.ctx.format,
            file_path: self.ctx.options.output_path.clone(),
            file_size: self.ctx.output_file_size().await,
            message_count: total,
            resource_count,
            export_time: start_time.elapsed().as_millis(),
            completed_at: now_iso(),
        })
    }

    /// 方案 B：chunked-jsonl 导出。
    ///
    /// 输出结构：`<outputDir>/manifest.json + chunks/cNNNNNN.jsonl [+ avatars.json]`。
    pub async fn export_chunked_jsonl(
        &self,
        messages: Vec<CleanMessage>,
        chat_info: &ChatInfo,
        options: ChunkedJsonlExportOptions,
    ) -> ExportResultT<ChunkedJsonlOutcome> {
        let start_time = Instant::now();
        self.ctx
            .update_progress(0, messages.len(), "开始JSONL分块导出");
        self.ctx.ensure_output_directory().await?;

        let filtered = preprocess_messages(messages);
        let total = filtered.len();

        let output_dir = options
            .output_dir
            .clone()
            .unwrap_or_else(|| self.derive_default_chunked_output_dir());
        let chunks_dir = output_dir.join(&options.chunks_dir_name);
        let manifest_path = output_dir.join(&options.manifest_file_name);

        // 目录冲突检查
        if let Ok(meta) = tokio::fs::metadata(&output_dir).await {
            if !meta.is_dir() {
                return Err(ExportError::OutputDirConflict(output_dir));
            }
        }
        tokio::fs::create_dir_all(&chunks_dir)
            .await
            .map_err(|e| ExportError::io("mkdirChunksDir", &chunks_dir, e))?;

        let mut stats_acc = StatsAccumulator::new();
        let mut resource_count = 0usize;

        let avatar_map = if self.json_options.embed_avatars_as_base64 {
            Some(self.pre_download_avatars(&filtered).await)
        } else {
            None
        };

        let chunk_ext = options.chunk_file_ext.clone();
        let mut writer = ChunkedJsonlWriter::new(ChunkedJsonlWriterOptions {
            chunks_dir,
            chunks_dir_name_for_manifest: options.chunks_dir_name.clone(),
            max_messages: options.max_messages_per_chunk,
            max_bytes: options.max_bytes_per_chunk,
            get_chunk_file_name: Box::new(move |index| format_chunk_file_name(index, &chunk_ext)),
            writer_buffer_bytes: DEFAULT_FLUSH_THRESHOLD,
        })
        .await?;

        let resource_map = &self.ctx.options.resource_map;
        let mut processed = 0usize;

        for msg in &filtered {
            self.ctx.check_cancelled()?;

            stats_acc.consume(msg);
            resource_count += msg.content.resources.len();

            let mut clean_msg = msg.clone();
            if let Some(raw) = clean_msg.raw_message.take() {
                clean_msg.raw_message = clean_raw_message(&raw);
            }
            if let Some(resources) = resource_map.get(&clean_msg.id) {
                update_message_resource_paths(&mut clean_msg, resources);
            }

            let ts_ms = clean_msg.timestamp;
            let line = serde_json::to_string(&clean_msg)?;
            writer.write_line(&line, Some(ts_ms)).await?;

            processed += 1;
            if processed % 5000 == 0 {
                yield_to_event_loop().await;
                self.ctx.update_progress(
                    processed,
                    total,
                    &format!("解析并写入 chunk {processed}/{total}"),
                );
            }
        }

        writer.finalize().await?;

        let final_stats = stats_acc.finalize();
        let formatted_chat_info = self.format_chat_info_async(chat_info).await;

        // avatars 文件（流式写，避免大对象常驻内存）
        let mut avatars_ref: Option<AvatarsRef> = None;
        if let Some(avatar_map) = &avatar_map {
            if !avatar_map.is_empty() {
                let avatars_path = output_dir.join(&options.avatars_file_name);
                self.write_avatar_map_to_json_file(avatar_map, &avatars_path)
                    .await?;
                avatars_ref = Some(AvatarsRef {
                    file: options.avatars_file_name.clone(),
                    count: avatar_map.len(),
                });
            }
        }

        let chunks = writer.chunks().to_vec();
        let manifest = ChunkedJsonlManifest {
            metadata: &self.metadata,
            chat_info: &formatted_chat_info,
            statistics: &final_stats,
            chunked: ChunkedSection {
                format: "jsonl",
                chunks_dir: &options.chunks_dir_name,
                chunk_file_ext: &options.chunk_file_ext,
                max_messages_per_chunk: options.max_messages_per_chunk,
                max_bytes_per_chunk: options.max_bytes_per_chunk,
                chunks: &chunks,
            },
            avatars: avatars_ref.clone(),
            export_options: self
                .json_options
                .include_metadata
                .then(|| self.generate_export_options()),
        };

        let manifest_content =
            render_json_file(&manifest, self.json_options.pretty, self.json_options.indent)?;
        tokio::fs::write(&manifest_path, manifest_content.as_bytes())
            .await
            .map_err(|e| ExportError::io("writeManifest", &manifest_path, e))?;

        // 统计总大小：manifest + chunks + avatars
        let mut total_size = file_size_or_zero(&manifest_path).await;
        total_size += writer.total_bytes();
        if let Some(avatars) = &avatars_ref {
            total_size += file_size_or_zero(&output_dir.join(&avatars.file)).await;
        }

        // issue #277：拷贝资源到 chunked-jsonl 输出目录（失败不阻断导出）
        self.ctx.copy_resources_alongside_export(&output_dir).await;

        self.ctx.update_progress(total, total, "导出完成");

        Ok(ChunkedJsonlOutcome {
            base: ExportOutcome {
                task_id: String::new(),
                format: self.ctx.format,
                file_path: manifest_path.clone(),
                file_size: total_size,
                message_count: total,
                resource_count,
                export_time: start_time.elapsed().as_millis(),
                completed_at: now_iso(),
            },
            output_dir,
            manifest_path,
            chunk_count: chunks.len(),
        })
    }

    /// 从 `output_path` 推导默认 chunked 输出目录：`<dirname>/<basename>_chunked_jsonl`。
    fn derive_default_chunked_output_dir(&self) -> PathBuf {
        let output_path = &self.ctx.options.output_path;
        let dir = output_path.parent().map(Path::to_path_buf).unwrap_or_default();
        let base = output_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        dir.join(format!("{base}_chunked_jsonl"))
    }

    /// 流式写出 avatarMap → JSON 文件。
    async fn write_avatar_map_to_json_file(
        &self,
        avatar_map: &indexmap::IndexMap<String, String>,
        file_path: &Path,
    ) -> ExportResultT<()> {
        ensure_parent_dir(file_path).await?;

        let indent_unit = if self.json_options.pretty {
            " ".repeat(self.json_options.indent)
        } else {
            String::new()
        };
        let ctx = create_json_stream_context(self.json_options.pretty, &indent_unit);

        let mut writer = BufferedTextWriter::create(file_path, DEFAULT_FLUSH_THRESHOLD).await?;
        writer
            .write(&JsonObjectStreamTemplates::begin(&ctx))
            .await?;

        let total = avatar_map.len();
        for (idx, (uin, base64)) in avatar_map.iter().enumerate() {
            let is_last = idx + 1 == total;
            let value_json = serde_json::to_string(base64)?;
            writer
                .write(&JsonObjectStreamTemplates::entry(
                    uin,
                    &value_json,
                    is_last,
                    &ctx,
                )?)
                .await?;
            if (idx + 1) % 2000 == 0 {
                yield_to_event_loop().await;
            }
        }

        writer.write(&JsonObjectStreamTemplates::end(&ctx)).await?;
        writer.end().await?;
        Ok(())
    }

    /// 格式化聊天信息。
    async fn format_chat_info_async(&self, chat_info: &ChatInfo) -> FormattedChatInfo {
        let mut avatar = None;
        if let Some(url) = &chat_info.avatar {
            if self.json_options.embed_avatars_as_base64 {
                // 下载失败时保留原 URL。
                avatar = Some(
                    self.download_url_as_base64(url)
                        .await
                        .unwrap_or_else(|| url.clone()),
                );
            } else {
                avatar = Some(url.clone());
            }
        }
        FormattedChatInfo {
            name: chat_info.name.clone(),
            chat_type: chat_info.chat_type.clone(),
            self_uid: chat_info.self_uid.clone(),
            self_uin: chat_info.self_uin.clone(),
            self_name: chat_info.self_name.clone(),
            peer_uid: chat_info.peer_uid.clone(),
            peer_uin: chat_info.peer_uin.clone(),
            avatar,
            participant_count: chat_info.participant_count,
        }
    }

    /// 生成导出选项记录。
    fn generate_export_options(&self) -> ExportOptionsRecord {
        let time_format = match self.ctx.options.time_format {
            crate::types::TimeFormat::Full => "YYYY-MM-DD HH:mm:ss",
            crate::types::TimeFormat::DateOnly => "date-only",
            crate::types::TimeFormat::TimeOnly => "time-only",
            crate::types::TimeFormat::Relative => "relative",
        };
        ExportOptionsRecord {
            included_fields: vec!["id", "timestamp", "sender", "content", "resources"],
            filters: Value::Object(serde_json::Map::new()),
            options: serde_json::json!({
                "includeResourceLinks": self.ctx.options.include_resource_links,
                "includeSystemMessages": self.ctx.options.include_system_messages,
                "preferGroupMemberName": self.ctx.options.prefer_group_member_name,
                "timeFormat": time_format,
                "encoding": "utf-8",
            }),
        }
    }

    /// 预下载所有消息发送者的头像。
    async fn pre_download_avatars(
        &self,
        messages: &[CleanMessage],
    ) -> indexmap::IndexMap<String, String> {
        let mut unique_uins: BTreeSet<String> = BTreeSet::new();
        for msg in messages {
            if let Some(uin) = &msg.sender.uin {
                let uin = uin.trim();
                if !uin.is_empty() && uin != "0" {
                    unique_uins.insert(uin.to_owned());
                }
            }
        }

        let mut avatar_map = indexmap::IndexMap::new();
        for uin in unique_uins {
            if let Some(base64) = self.download_avatar_as_base64(&uin).await {
                avatar_map.insert(uin, base64);
            }
        }
        avatar_map
    }

    /// 下载头像并转换为 base64。
    async fn download_avatar_as_base64(&self, uin: &str) -> Option<String> {
        let avatar_url = format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=100");
        let response = self.http.get(&avatar_url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        Some(format!("data:image/jpeg;base64,{}", BASE64.encode(&bytes)))
    }

    /// 下载任意 URL 的图片并转换为 base64，通过魔数识别 PNG 和 GIF。
    async fn download_url_as_base64(&self, url: &str) -> Option<String> {
        let response = self.http.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        let mime_type = if bytes.len() >= 2 && bytes[0] == 0x89 && bytes[1] == 0x50 {
            "image/png"
        } else if bytes.len() >= 2 && bytes[0] == 0x47 && bytes[1] == 0x49 {
            "image/gif"
        } else {
            "image/jpeg"
        };
        Some(format!(
            "data:{mime_type};base64,{}",
            BASE64.encode(&bytes)
        ))
    }
}

/// 递归删除 `rawMessage` 中的 null、空字符串、空数组和空对象。
#[must_use]
pub fn clean_raw_message(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Array(items) => {
            let cleaned: Vec<Value> = items.iter().filter_map(clean_raw_message).collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(Value::Array(cleaned))
            }
        }
        Value::Object(map) => {
            let mut cleaned = serde_json::Map::new();
            for (key, v) in map {
                match v {
                    Value::Null => continue,
                    Value::String(s) if s.is_empty() => continue,
                    Value::Object(_) | Value::Array(_) => {
                        if let Some(cleaned_value) = clean_raw_message(v) {
                            let empty = match &cleaned_value {
                                Value::Array(a) => a.is_empty(),
                                Value::Object(o) => o.is_empty(),
                                _ => false,
                            };
                            if !empty {
                                cleaned.insert(key.clone(), cleaned_value);
                            }
                        }
                    }
                    other => {
                        cleaned.insert(key.clone(), other.clone());
                    }
                }
            }
            if cleaned.is_empty() {
                None
            } else {
                Some(Value::Object(cleaned))
            }
        }
        other => Some(other.clone()),
    }
}

/// 将已下载资源的相对路径写回消息（issue #277）。
///
/// - `content.resources[]`：按文件名匹配写入 `localPath`（`<typeDir>/<fileName>`）；
/// - `content.elements[]`：image / video / audio / file 元素的 `data.localPath` 同步覆写。
pub fn update_message_resource_paths(
    message: &mut CleanMessage,
    downloaded: &[crate::types::MessageResource],
) {
    if downloaded.is_empty() {
        return;
    }

    // fileName → 相对路径映射
    let mut by_name: HashMap<String, String> = HashMap::new();
    for r in downloaded {
        let Some(local_path) = r.local_path.as_deref() else {
            continue;
        };
        let Some(file_name) = Path::new(local_path).file_name() else {
            continue;
        };
        let file_name = file_name.to_string_lossy().into_owned();
        let type_dir = crate::base::resource_type_dir(&r.resource_type);
        by_name.insert(file_name.clone(), format!("{type_dir}/{file_name}"));
    }
    if by_name.is_empty() {
        return;
    }

    let lookup = |name: Option<&str>| -> Option<String> {
        let name = name?;
        let base = Path::new(name).file_name()?.to_string_lossy().into_owned();
        by_name.get(&base).cloned()
    };

    for resource in &mut message.content.resources {
        let candidate = resource
            .filename
            .as_deref()
            .and_then(|n| lookup(Some(n)))
            .or_else(|| lookup(resource.local_path.as_deref()));
        if let Some(rel) = candidate {
            resource.local_path = Some(rel);
        }
    }

    for element in &mut message.content.elements {
        if !matches!(
            element.element_type.as_str(),
            "image" | "video" | "audio" | "file"
        ) {
            continue;
        }
        let Value::Object(data) = &mut element.data else {
            continue;
        };
        let name = data
            .get("filename")
            .or_else(|| data.get("fileName"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                data.get("localPath")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        if let Some(rel) = lookup(name.as_deref()) {
            data.insert("localPath".to_owned(), Value::String(rel));
        }
    }
}
