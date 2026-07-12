use crate::base::escape_html;
use crate::bloom::{fnv1a32, BloomFilter};
use crate::error::{ExportError, ExportResultT};
use crate::modern_html_templates::{
    render_template, MODERN_CHUNKED_APP_JS, MODERN_CHUNKED_INDEX_HTML_TEMPLATE, MODERN_CSS,
    MODERN_FOOTER_HTML, MODERN_SINGLE_HTML_BOTTOM_TEMPLATE, MODERN_SINGLE_HTML_TOP_TEMPLATE,
    MODERN_SINGLE_SCRIPTS_HTML, MODERN_TOOLBAR_HTML,
};
use crate::reply_preview_renderer::{render_reply_preview_elements, ReplyPreviewRenderContext};
use crate::reply_render::{choose_reply_jump_target, format_reply_timestamp, ReplyRenderInput};
use crate::types::{ChatInfo, CleanMessage};
use chrono::{DateTime, Datelike, Local, NaiveDateTime, TimeZone, Timelike, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::task::JoinSet;

/// HTML 导出选项（对应 TS `HtmlExportOptions`）。
#[derive(Debug, Clone)]
pub struct HtmlExportOptions {
    /// 输出文件路径（单文件模式为 HTML 文件，chunked 模式为 index.html）。
    pub output_path: PathBuf,
    /// 是否包含资源链接（默认 true）。
    pub include_resource_links: bool,
    /// 是否包含系统消息（默认 true）。
    pub include_system_messages: bool,
    /// Issue #311：自包含 HTML 模式。开启后不再生成同级 `resources/` 目录，
    /// 所有图片 / 语音 / 视频 / 文件改为以 base64 data URI 内联到单个 HTML
    /// 文件中，便于单独发送或在没有附属文件夹的环境下查看。
    pub embed_resources_as_data_uri: bool,
    /// Issue #311：当 `embed_resources_as_data_uri` 启用时，单个资源若超过
    /// 此大小（字节）则不内联，仍按外链 / 文件名占位渲染。默认 50 MB；
    /// 设为 0 关闭单文件上限。
    pub max_embed_file_size_bytes: u64,
    /// Issue #467：是否在导出的 HTML 中显示底部胶囊式搜索/工具栏（默认 true）。
    pub show_search_bar: bool,
    /// Issue #467：是否启用虚拟滚动（消息超过 100 条时只渲染可视区域，默认 true）。
    pub enable_virtual_scroll: bool,
    /// 导出器版本号，写入 manifest 供查看器展示（例如 "5.5.80"）。
    pub exporter_version: Option<String>,
}

impl Default for HtmlExportOptions {
    fn default() -> Self {
        Self {
            output_path: PathBuf::new(),
            include_resource_links: true,
            include_system_messages: true,
            embed_resources_as_data_uri: false,
            max_embed_file_size_bytes: 50 * 1024 * 1024,
            show_search_bar: true,
            enable_virtual_scroll: true,
            exporter_version: None,
        }
    }
}

/// Chunked 导出选项（对应 TS `ChunkedHtmlExportOptions`）。
#[derive(Debug, Clone, Default)]
pub struct ChunkedHtmlExportOptions {
    /// 资源与数据目录名（相对于 `output_path` 所在目录），默认 `assets`。
    pub assets_dir_name: Option<String>,
    /// 数据目录名，默认 `data`。
    pub data_dir_name: Option<String>,
    /// chunk 目录名，默认 `chunks`。
    pub chunks_dir_name: Option<String>,
    /// 索引目录名，默认 `index`。
    pub index_dir_name: Option<String>,
    /// 每个 chunk 最大消息数（默认 2000，下限 100）。
    pub max_messages_per_chunk: Option<usize>,
    /// chunk 文件软限制（默认 50MB，下限 1MB）。
    pub max_chunk_bytes: Option<u64>,
    /// 是否生成文本 Bloom（默认 true）。
    pub enable_text_bloom: Option<bool>,
    /// 文本 Bloom 位数（默认 16384，下限 2048）。
    pub bloom_text_bits: Option<u32>,
    /// 文本 Bloom 哈希次数（默认 6，下限 2）。
    pub bloom_text_hashes: Option<u32>,
    /// sender Bloom 位数（默认 2048，下限 512）。
    pub bloom_sender_bits: Option<u32>,
    /// sender Bloom 哈希次数（默认 4，下限 2）。
    pub bloom_sender_hashes: Option<u32>,
    /// 单条消息用于 Bloom 的最大字符数（默认 8192，下限 256）。
    pub bloom_max_chars_per_message: Option<usize>,
    /// message.text 存储长度（默认 4096，下限 256）。
    pub store_text_max_chars: Option<usize>,
    /// msgId 索引分桶数量（默认 64，范围 [8, 256]）。
    pub msg_id_index_bucket_count: Option<u32>,
    /// 是否输出 manifest.json（默认 true；manifest.js 总是输出）。
    pub write_manifest_json: Option<bool>,
}

/// Chunked 导出结果（对应 TS `ChunkedHtmlExportResult`）。
#[derive(Debug, Clone)]
pub struct ChunkedHtmlExportResult {
    /// 输出目录。
    pub output_dir: PathBuf,
    /// index.html 路径。
    pub index_html_path: PathBuf,
    /// manifest.js 路径。
    pub manifest_js_path: PathBuf,
    /// manifest.json 路径（`write_manifest_json=false` 时为 `None`）。
    pub manifest_json_path: Option<PathBuf>,
    /// chunk 数量。
    pub chunk_count: usize,
    /// 消息总数。
    pub total_messages: usize,
    /// 已复制的资源相对路径列表。
    pub copied_resources: Vec<String>,
}

/// 内部资源任务结构（对应 TS `ResourceTask`）。
#[derive(Debug, Clone)]
struct ResourceTask {
    /// image / video / audio / file / ...
    resource_type: String,
    file_name: String,
    local_path: String,
}

/// 现代化 HTML 导出器。
pub struct ModernHtmlExporter {
    options: HtmlExportOptions,
    current_chat_info: Option<ChatInfo>,
    last_rendered_date: Option<String>,
    /// Issue #311：data URI 缓存。key 为 `<typeDir>/<basename>`，value 为完整
    /// `data:<mime>;base64,...` 字符串。仅当 `embed_resources_as_data_uri=true`
    /// 时被填充，否则始终为空，渲染路径走原有的 `./resources/...`。
    data_uri_cache: HashMap<String, String>,
    /// Issue #311：已尝试过、确认不可内联的资源 key，避免重复磁盘探测。
    data_uri_misses: HashSet<String>,
    /// 资源引用基础路径（URL 相对前缀）。
    /// - 单文件导出使用 `./resources`（资源目录与 HTML 同级，便于独立移动，
    ///   修复 Issue #213）；
    /// - Chunked 方案使用 `resources`（无 `./` 前缀）。
    resource_base_href: String,
}

/// chunk 写入器内部状态（chunked 模式）。
struct ChunkState {
    index: usize,
    id: String,
    writer: Option<BufWriter<fs::File>>,
    path: PathBuf,
    count: usize,
    bytes: u64,
    start_ts: i64,
    end_ts: i64,
    start_date: String,
    end_date: String,
    first_msg_id: String,
    last_msg_id: String,
    text_bloom: Option<BloomFilter>,
    sender_bloom: Option<BloomFilter>,
    text_bloom_incomplete: bool,
    is_first_record: bool,
}

impl ModernHtmlExporter {
    /// 新建导出器。
    #[must_use]
    pub fn new(options: HtmlExportOptions) -> Self {
        Self {
            options,
            current_chat_info: None,
            last_rendered_date: None,
            data_uri_cache: HashMap::new(),
            data_uri_misses: HashSet::new(),
            resource_base_href: "./resources".to_owned(),
        }
    }

    /// 导出聊天记录为单文件 HTML（流式）。返回已复制的资源相对路径列表。
    ///
    /// # Errors
    /// 输出文件 / 目录 I/O 失败时返回 [`ExportError::Io`]。
    pub async fn export(
        &mut self,
        messages: &[CleanMessage],
        chat_info: &ChatInfo,
    ) -> ExportResultT<Vec<String>> {
        let output_path = self.options.output_path.clone();
        let output_dir = output_path
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| ExportError::io("mkdir", &output_dir, e))?;

        let file = fs::File::create(&output_path)
            .await
            .map_err(|e| ExportError::io("createWriteStream", &output_path, e))?;
        let mut ws = BufWriter::new(file);

        self.current_chat_info = Some(chat_info.clone());
        self.last_rendered_date = None;

        let mut total_messages = 0usize;
        let mut first_time: Option<i64> = None;
        let mut last_time: Option<i64> = None;
        let mut copied_resources: Vec<String> = Vec::new();

        // 资源复制并发限制（根据 CPU 数量自适应，范围 [2, 8]）
        let concurrency = copy_concurrency();
        let mut running: JoinSet<Option<String>> = JoinSet::new();

        // Issue #311: 在 embed_resources_as_data_uri 模式下跳过资源目录创建与
        // 拷贝，资源直接以 base64 内联。
        let use_data_uri =
            self.options.include_resource_links && self.options.embed_resources_as_data_uri;
        if self.options.include_resource_links && !use_data_uri {
            for type_dir in ["images", "videos", "audios", "files"] {
                let dir = output_dir.join("resources").join(type_dir);
                fs::create_dir_all(&dir)
                    .await
                    .map_err(|e| ExportError::io("mkdir", &dir, e))?;
            }
        }

        let export_time_iso = now_iso();
        let metadata = json!({
            "messageCount": 0,
            "chatName": chat_info.name,
            "chatType": chat_info.chat_type,
            "avatarUrl": chat_info.avatar,
            "peerUid": chat_info.peer_uid,
            "peerUin": chat_info.peer_uin,
            "exportTime": export_time_iso,
        });

        // 1) 写入文档头与样式/脚本 + 头部信息(占位)
        let top_html = render_template(
            MODERN_SINGLE_HTML_TOP_TEMPLATE,
            &[
                ("METADATA_JSON", &metadata.to_string()),
                ("CHAT_NAME_ESC", &escape_html(&chat_info.name)),
                ("STYLES", &self.generate_styles()),
                ("SCRIPTS", &self.generate_scripts()),
                ("TOOLBAR", &self.generate_toolbar()),
                (
                    "HEADER",
                    &self.generate_header(chat_info, TotalMessages::Placeholder, "--"),
                ),
            ],
        );
        write_chunk(&mut ws, &output_path, &top_html).await?;

        // 2) 单次遍历：一边渲染消息写入，一边调度资源复制
        for message in messages {
            // 统计时间范围（首/尾）
            if let Some(ts) = message_ts_ms(message) {
                if first_time.is_none_or(|f| ts < f) {
                    first_time = Some(ts);
                }
                if last_time.is_none_or(|l| ts > l) {
                    last_time = Some(ts);
                }
            }

            // 是否跳过系统消息
            if !self.options.include_system_messages && is_system_message(message) {
                continue;
            }

            // Issue #311: 内联模式下，为当前消息预加载所有资源为 data URI。
            // 顺序 await 以保证随后的同步 render_message 可从缓存中取到；
            // 同一资源 key 二次出现时会命中缓存不重复读盘。
            if use_data_uri {
                for res in iter_resources(message) {
                    self.preload_data_uri(&res).await;
                }
            }

            // 渲染并写入单条消息（小字符串，立即写出，避免累积）
            let chunk = self.render_message(message);
            write_chunk(&mut ws, &output_path, &chunk).await?;
            write_chunk(&mut ws, &output_path, "\n").await?;
            total_messages += 1;

            // 并发受限地复制资源（仅当启用本地资源且不在内联模式下）
            if self.options.include_resource_links && !use_data_uri {
                for res in iter_resources(message) {
                    while running.len() >= concurrency {
                        drain_one_copy(&mut running, &mut copied_resources).await;
                    }
                    let output_dir = output_dir.clone();
                    running.spawn(async move { copy_resource_file(&res, &output_dir).await });
                }
            }
        }

        // 等待剩余资源拷贝任务完成
        while !running.is_empty() {
            drain_one_copy(&mut running, &mut copied_resources).await;
        }

        // 3) 收尾：页脚 + 占位数据回填脚本 + 结束
        let time_range_text = match (first_time, last_time) {
            (Some(f), Some(l)) => format!("{} 至 {}", locale_date_zh(f), locale_date_zh(l)),
            _ => "--".to_owned(),
        };
        // 使用安全的 JSON 转义注入文本
        let time_range_js = Value::String(time_range_text).to_string();

        let bottom_html = render_template(
            MODERN_SINGLE_HTML_BOTTOM_TEMPLATE,
            &[
                ("FOOTER", MODERN_FOOTER_HTML),
                ("TOTAL_MESSAGES", &total_messages.to_string()),
                ("TIME_RANGE_JS", &time_range_js),
            ],
        );
        write_chunk(&mut ws, &output_path, &bottom_html).await?;

        ws.flush()
            .await
            .map_err(|e| ExportError::io("flush", &output_path, e))?;
        ws.into_inner()
            .sync_all()
            .await
            .map_err(|e| ExportError::io("finish", &output_path, e))?;

        // 更新元数据注释中的消息数量（失败静默，不影响导出流程）
        self.update_metadata(total_messages).await;

        Ok(copied_resources)
    }

    /// 导出为自包含单文件 HTML：HyperScroll viewer + manifest + 全部数据
    /// chunk + msgId 索引全部内联进一个 `.html`（虚拟滚动照常工作）。
    ///
    /// 实现方式：先用 [`Self::export_chunked`] 导出到隐藏临时目录，再把
    /// 数据脚本按 JSONP 收集形式内联拼装进单个 HTML；`resources/` 目录
    /// （若未启用 data URI 内联）会移动到最终 HTML 同级。
    ///
    /// # Errors
    /// 输出文件 / 目录 I/O 失败时返回 [`ExportError::Io`]。
    pub async fn export_single_inline(
        &mut self,
        messages: &[CleanMessage],
        chat_info: &ChatInfo,
    ) -> ExportResultT<Vec<String>> {
        let output_path = self.options.output_path.clone();
        let output_dir = output_path
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| ExportError::io("mkdir", &output_dir, e))?;

        let stem = output_path
            .file_stem()
            .map_or_else(|| "export".to_owned(), |s| s.to_string_lossy().into_owned());
        let temp_dir = output_dir.join(format!(".{stem}.qce-inline-tmp"));
        if fs::try_exists(&temp_dir).await.unwrap_or(false) {
            let _ = fs::remove_dir_all(&temp_dir).await;
        }

        // 1) chunked 导出到临时目录
        self.options.output_path = temp_dir.join("index.html");
        let chunked_result = self
            .export_chunked(
                messages,
                chat_info,
                &ChunkedHtmlExportOptions {
                    write_manifest_json: Some(false),
                    ..ChunkedHtmlExportOptions::default()
                },
            )
            .await;
        self.options.output_path = output_path.clone();
        let chunked = match chunked_result {
            Ok(v) => v,
            Err(e) => {
                let _ = fs::remove_dir_all(&temp_dir).await;
                return Err(e);
            }
        };

        // 2) resources/ 移动到最终 HTML 同级（data URI 内联模式下不存在）
        let temp_resources = temp_dir.join("resources");
        if fs::try_exists(&temp_resources).await.unwrap_or(false) {
            move_dir_merge(&temp_resources, &output_dir.join("resources")).await?;
        }

        // 3) 拼装单文件 HTML：外壳 head + 内联数据脚本 + 内联 app.js + 外壳尾部
        let index_html = fs::read_to_string(&chunked.index_html_path)
            .await
            .map_err(|e| ExportError::io("readFile", &chunked.index_html_path, e))?;
        const APP_SCRIPT_TAG: &str = "<script src=\"assets/app.js\" defer></script>";
        let (shell_head, shell_tail) = index_html.split_once(APP_SCRIPT_TAG).ok_or_else(|| {
            ExportError::InvalidOptions(
                "chunked index.html 中缺少 app.js 引用，无法内联".to_owned(),
            )
        })?;

        let file = fs::File::create(&output_path)
            .await
            .map_err(|e| ExportError::io("createWriteStream", &output_path, e))?;
        let mut ws = BufWriter::new(file);
        write_chunk(&mut ws, &output_path, shell_head).await?;

        // 3a) bootstrap：先注册 JSONP 回调，把随后内联的数据收进 __QCE_INLINE__
        write_chunk(
            &mut ws,
            &output_path,
            concat!(
                "<script>",
                "window.__QCE_INLINE__={chunks:{},msgid:{}};",
                "window.__QCE_MANIFEST__=function(m){window.__QCE_INLINE__.manifest=m};",
                "window.__QCE_CHUNK__=function(c){window.__QCE_INLINE__.chunks[c.id]=c.messages};",
                "window.__QCE_MSGID_INDEX__=function(b,p){window.__QCE_INLINE__.msgid[b]=p};",
                "</script>\n",
            ),
        )
        .await?;

        // 3b) manifest + chunks + msgid 索引（逐文件读入、转义、写出）
        inline_script_file(&mut ws, &output_path, &chunked.manifest_js_path).await?;
        let chunks_dir = temp_dir.join("data").join("chunks");
        for path in sorted_js_files(&chunks_dir).await? {
            inline_script_file(&mut ws, &output_path, &path).await?;
        }
        let index_dir = temp_dir.join("data").join("index");
        for path in sorted_js_files(&index_dir).await? {
            inline_script_file(&mut ws, &output_path, &path).await?;
        }

        // 3c) viewer 应用脚本
        write_chunk(&mut ws, &output_path, "<script>").await?;
        write_chunk(
            &mut ws,
            &output_path,
            &escape_inline_script(MODERN_CHUNKED_APP_JS),
        )
        .await?;
        write_chunk(&mut ws, &output_path, "</script>\n").await?;

        write_chunk(&mut ws, &output_path, shell_tail).await?;
        ws.flush()
            .await
            .map_err(|e| ExportError::io("flush", &output_path, e))?;
        ws.into_inner()
            .sync_all()
            .await
            .map_err(|e| ExportError::io("finish", &output_path, e))?;

        let _ = fs::remove_dir_all(&temp_dir).await;
        Ok(chunked.copied_resources)
    }

    /// Chunked Viewer 导出（Issue #467）。
    ///
    /// 输出 `index.html + assets/ + data/manifest(.js/.json) + data/chunks/*.js +
    /// data/index/msgid_bXX.js`；Streaming 写入、分块、索引、资源复制并发受限，避免 OOM。
    ///
    /// # Errors
    /// 输出文件 / 目录 I/O 失败时返回 [`ExportError::Io`]。
    #[allow(clippy::too_many_lines)]
    pub async fn export_chunked(
        &mut self,
        messages: &[CleanMessage],
        chat_info: &ChatInfo,
        options: &ChunkedHtmlExportOptions,
    ) -> ExportResultT<ChunkedHtmlExportResult> {
        let output_path = self.options.output_path.clone();
        let output_dir = output_path
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| ExportError::io("mkdir", &output_dir, e))?;

        // dirs
        let assets_dir_name = options.assets_dir_name.as_deref().unwrap_or("assets");
        let data_dir_name = options.data_dir_name.as_deref().unwrap_or("data");
        let chunks_dir_name = options.chunks_dir_name.as_deref().unwrap_or("chunks");
        let index_dir_name = options.index_dir_name.as_deref().unwrap_or("index");

        let assets_dir = output_dir.join(assets_dir_name);
        let data_dir = output_dir.join(data_dir_name);
        let chunks_dir = data_dir.join(chunks_dir_name);
        let index_dir = data_dir.join(index_dir_name);

        for dir in [&assets_dir, &data_dir, &chunks_dir, &index_dir] {
            fs::create_dir_all(dir)
                .await
                .map_err(|e| ExportError::io("mkdir", dir.as_path(), e))?;
        }

        // write assets (style.css + app.js)
        let style_path = assets_dir.join("style.css");
        fs::write(&style_path, MODERN_CSS)
            .await
            .map_err(|e| ExportError::io("writeFile", &style_path, e))?;
        let app_js_path = assets_dir.join("app.js");
        fs::write(&app_js_path, MODERN_CHUNKED_APP_JS)
            .await
            .map_err(|e| ExportError::io("writeFile", &app_js_path, e))?;

        // resource dirs（data URI 内联模式下不生成 resources/ 目录）
        let use_data_uri =
            self.options.include_resource_links && self.options.embed_resources_as_data_uri;
        if self.options.include_resource_links && !use_data_uri {
            for type_dir in ["images", "videos", "audios", "files"] {
                let dir = output_dir.join("resources").join(type_dir);
                fs::create_dir_all(&dir)
                    .await
                    .map_err(|e| ExportError::io("mkdir", &dir, e))?;
            }
        }

        // concurrency for resource copy
        let concurrency = copy_concurrency();
        let mut running: JoinSet<Option<String>> = JoinSet::new();
        let mut copied_resources: Vec<String> = Vec::new();

        // chunk options（与 TS 相同的下限 / 默认值钳制）
        let max_messages_per_chunk = options.max_messages_per_chunk.unwrap_or(2000).max(100);
        let max_chunk_bytes = options
            .max_chunk_bytes
            .unwrap_or(50 * 1024 * 1024)
            .max(1024 * 1024);
        let enable_text_bloom = options.enable_text_bloom.unwrap_or(true);
        let bloom_text_bits = options.bloom_text_bits.unwrap_or(16384).max(2048);
        let bloom_text_hashes = options.bloom_text_hashes.unwrap_or(6).max(2);
        let bloom_sender_bits = options.bloom_sender_bits.unwrap_or(2048).max(512);
        let bloom_sender_hashes = options.bloom_sender_hashes.unwrap_or(4).max(2);
        let bloom_max_chars_per_message =
            options.bloom_max_chars_per_message.unwrap_or(8192).max(256);
        let store_text_max_chars = options.store_text_max_chars.unwrap_or(4096).max(256);
        let msg_id_index_bucket_count = options
            .msg_id_index_bucket_count
            .unwrap_or(64)
            .clamp(8, 256);
        let write_manifest_json = options.write_manifest_json.unwrap_or(true);

        // manifest structures
        let mut chunks_meta: Vec<Value> = Vec::new();
        let mut senders_by_uid: indexmap::IndexMap<String, SenderInfo> = indexmap::IndexMap::new();

        let mut total_messages = 0usize;
        let mut first_time: Option<i64> = None;
        let mut last_time: Option<i64> = None;
        let mut min_date_key: Option<String> = None;
        let mut max_date_key: Option<String> = None;

        // msgId index bucket streams
        let bucket_file_prefix = "msgid_b";
        let bucket_file_ext = ".js";
        let mut bucket_streams: Vec<BufWriter<fs::File>> = Vec::new();
        let mut bucket_paths: Vec<PathBuf> = Vec::new();
        let mut bucket_first: Vec<bool> = Vec::new();
        for i in 0..msg_id_index_bucket_count {
            let file_name = format!("{bucket_file_prefix}{i:02x}{bucket_file_ext}");
            let abs_path = index_dir.join(&file_name);
            let file = fs::File::create(&abs_path)
                .await
                .map_err(|e| ExportError::io("createWriteStream", &abs_path, e))?;
            let mut ws = BufWriter::new(file);
            let header = format!("window.__QCE_MSGID_INDEX__ && window.__QCE_MSGID_INDEX__({i}, [\n");
            write_chunk(&mut ws, &abs_path, &header).await?;
            bucket_streams.push(ws);
            bucket_paths.push(abs_path);
            bucket_first.push(true);
        }

        // chunk writer state
        let mut chunk = ChunkState {
            index: 0,
            id: String::new(),
            writer: None,
            path: PathBuf::new(),
            count: 0,
            bytes: 0,
            start_ts: 0,
            end_ts: 0,
            start_date: String::new(),
            end_date: String::new(),
            first_msg_id: String::new(),
            last_msg_id: String::new(),
            text_bloom: None,
            sender_bloom: None,
            text_bloom_incomplete: false,
            is_first_record: true,
        };

        // setup exporter state
        self.current_chat_info = Some(chat_info.clone());
        self.last_rendered_date = None;

        // For chunked viewer, resource href base should be "resources"
        let old_resource_base_href =
            std::mem::replace(&mut self.resource_base_href, "resources".to_owned());

        let result = self
            .export_chunked_inner(ChunkedRunArgs {
                messages,
                chat_info,
                output_dir: &output_dir,
                output_path: &output_path,
                data_dir: &data_dir,
                chunks_dir: &chunks_dir,
                dir_names: DirNames {
                    assets: assets_dir_name,
                    data: data_dir_name,
                    chunks: chunks_dir_name,
                    index: index_dir_name,
                },
                limits: ChunkLimits {
                    max_messages_per_chunk,
                    max_chunk_bytes,
                    enable_text_bloom,
                    bloom_text_bits,
                    bloom_text_hashes,
                    bloom_sender_bits,
                    bloom_sender_hashes,
                    bloom_max_chars_per_message,
                    store_text_max_chars,
                    msg_id_index_bucket_count,
                    write_manifest_json,
                },
                bucket_file_prefix,
                bucket_file_ext,
                concurrency,
                running: &mut running,
                copied_resources: &mut copied_resources,
                chunks_meta: &mut chunks_meta,
                senders_by_uid: &mut senders_by_uid,
                total_messages: &mut total_messages,
                first_time: &mut first_time,
                last_time: &mut last_time,
                min_date_key: &mut min_date_key,
                max_date_key: &mut max_date_key,
                bucket_streams: &mut bucket_streams,
                bucket_paths: &bucket_paths,
                bucket_first: &mut bucket_first,
                chunk: &mut chunk,
            })
            .await;

        // restore（对应 TS finally 分支）
        self.resource_base_href = old_resource_base_href;
        // 出错时中止未完成的复制任务，避免后台任务泄漏
        if result.is_err() {
            running.abort_all();
        }
        result
    }

    /// `export_chunked` 主体（拆分出来以便 finally 语义下恢复 `resource_base_href`）。
    #[allow(clippy::too_many_lines)]
    async fn export_chunked_inner(
        &mut self,
        args: ChunkedRunArgs<'_>,
    ) -> ExportResultT<ChunkedHtmlExportResult> {
        let ChunkedRunArgs {
            messages,
            chat_info,
            output_dir,
            output_path,
            data_dir,
            chunks_dir,
            dir_names,
            limits,
            bucket_file_prefix,
            bucket_file_ext,
            concurrency,
            running,
            copied_resources,
            chunks_meta,
            senders_by_uid,
            total_messages,
            first_time,
            last_time,
            min_date_key,
            max_date_key,
            bucket_streams,
            bucket_paths,
            bucket_first,
            chunk,
        } = args;

        let chunk_file_rel =
            |id: &str| -> String { format!("{}/{}/{id}.js", dir_names.data, dir_names.chunks) };

        // stream process messages
        for message in messages {
            if !self.options.include_system_messages && is_system_message(message) {
                continue;
            }

            let ts = message_ts_ms(message).unwrap_or(0);
            let date_key = message_date_key(message).unwrap_or_default();

            // global stats
            if let Some(t) = message_ts_ms(message) {
                if first_time.is_none_or(|f| t < f) {
                    *first_time = Some(t);
                }
                if last_time.is_none_or(|l| t > l) {
                    *last_time = Some(t);
                }
            }
            if !date_key.is_empty() {
                if min_date_key.as_deref().is_none_or(|m| date_key.as_str() < m) {
                    *min_date_key = Some(date_key.clone());
                }
                if max_date_key.as_deref().is_none_or(|m| date_key.as_str() > m) {
                    *max_date_key = Some(date_key.clone());
                }
            }

            // sender stats
            let sender_uid = sender_uid_of(message);
            let sender_name = get_display_name(message);
            let sender_name_lower = sender_name.to_lowercase();
            if !sender_uid.is_empty() {
                let sender_uin = message.sender.uin.clone().filter(|s| !s.is_empty());
                let info = senders_by_uid
                    .entry(sender_uid.clone())
                    .or_insert_with(|| SenderInfo {
                        names: indexmap::IndexSet::new(),
                        display_name: sender_name.clone(),
                        count: 0,
                        uin: None,
                    });
                info.names.insert(sender_name.clone());
                info.count += 1;
                if info.display_name.is_empty() {
                    info.display_name = sender_name.clone();
                }
                if info.uin.is_none() {
                    info.uin = sender_uin;
                }
            }

            // ensure chunk
            if chunk.writer.is_none() {
                start_chunk(chunk, chunks_dir, &limits).await?;
            }

            // set chunk boundary stats
            if chunk.count == 0 {
                chunk.start_ts = ts;
                chunk.start_date = date_key.clone();
                chunk.first_msg_id = format!("msg-{}", message.id);
            }
            chunk.end_ts = ts;
            chunk.end_date = date_key.clone();
            chunk.last_msg_id = format!("msg-{}", message.id);

            // data URI 内联模式：渲染前预载本条消息的资源
            if self.options.include_resource_links && self.options.embed_resources_as_data_uri {
                for res in iter_resources(message) {
                    self.preload_data_uri(&res).await;
                }
            }

            // render HTML
            let html = self.render_message(message);

            // extract plain text
            let plain = extract_plain_text(message);
            let plain_lower_full = plain.to_lowercase();
            let plain_units: Vec<u16> = plain_lower_full.encode_utf16().collect();
            let stored_units = &plain_units[..plain_units.len().min(limits.store_text_max_chars)];
            let stored_text = String::from_utf16_lossy(stored_units);
            let text_truncated = plain_units.len() > limits.store_text_max_chars;

            // bloom update
            if !sender_uid.is_empty() {
                if let Some(sb) = chunk.sender_bloom.as_mut() {
                    sb.add(&sender_uid);
                }
            }
            if limits.enable_text_bloom {
                if let Some(tb) = chunk.text_bloom.as_mut() {
                    let mut bloom_units = plain_units.clone();
                    bloom_units.push(u16::from(b' '));
                    bloom_units.extend(sender_name_lower.encode_utf16());
                    if bloom_units.len() > limits.bloom_max_chars_per_message {
                        chunk.text_bloom_incomplete = true;
                        bloom_units.truncate(limits.bloom_max_chars_per_message);
                    }
                    add_text_to_bloom(tb, &bloom_units);
                }
            }

            // write msgId -> chunkId mapping (bucketed)
            let dom_msg_id = format!("msg-{}", message.id);
            let bucket = (fnv1a32(&dom_msg_id, 0x811c_9dc5) % limits.msg_id_index_bucket_count)
                as usize;
            let pair = json!([dom_msg_id, chunk.id]).to_string();
            let sep = if bucket_first[bucket] { "" } else { ",\n" };
            bucket_first[bucket] = false;
            let line = format!("{sep}{pair}");
            write_chunk(&mut bucket_streams[bucket], &bucket_paths[bucket], &line).await?;

            // build record
            let record = json!({
                "id": dom_msg_id,
                "ts": ts,
                "date": date_key,
                "uid": sender_uid,
                "name": sender_name,
                "nameLower": sender_name_lower,
                "text": stored_text,
                "textTruncated": text_truncated,
                "html": html,
            });
            let json_str = record.to_string();
            let prefix = if chunk.is_first_record { "" } else { ",\n" };
            chunk.is_first_record = false;

            let payload = format!("{prefix}{json_str}");
            let chunk_path = chunk.path.clone();
            if let Some(writer) = chunk.writer.as_mut() {
                write_chunk(writer, &chunk_path, &payload).await?;
            }
            chunk.bytes += payload.len() as u64;

            *total_messages += 1;
            chunk.count += 1;

            // resource copy
            if self.options.include_resource_links && !self.options.embed_resources_as_data_uri {
                for res in iter_resources(message) {
                    while running.len() >= concurrency {
                        drain_one_copy(running, copied_resources).await;
                    }
                    let output_dir = output_dir.to_path_buf();
                    running.spawn(async move { copy_resource_file(&res, &output_dir).await });
                }
            }

            // rotate chunk
            if chunk.count >= limits.max_messages_per_chunk || chunk.bytes >= limits.max_chunk_bytes
            {
                finish_chunk(chunk, chunks_meta, &chunk_file_rel).await?;
            }
        }

        // final flush
        if chunk.writer.is_some() {
            finish_chunk(chunk, chunks_meta, &chunk_file_rel).await?;
        }

        // wait resource copies
        while !running.is_empty() {
            drain_one_copy(running, copied_resources).await;
        }

        // close bucket index streams
        for (ws, path) in bucket_streams.iter_mut().zip(bucket_paths.iter()) {
            write_chunk(ws, path, "\n]);\n").await?;
            ws.flush()
                .await
                .map_err(|e| ExportError::io("finish", path.as_path(), e))?;
        }

        // build manifest
        let export_time_iso = now_iso();
        let time_range_text = match (*first_time, *last_time) {
            (Some(f), Some(l)) => format!("{} 至 {}", locale_date_zh(f), locale_date_zh(l)),
            _ => "--".to_owned(),
        };

        let senders: Vec<Value> = senders_by_uid
            .iter()
            .filter(|(uid, info)| {
                // 过滤无效发送者（uid 缺失/未知且无可用名称），避免筛选器出现 "0" 等脏条目
                let name_ok = !info.display_name.is_empty() && info.display_name != "0";
                let uid_ok = !uid.is_empty() && *uid != "未知";
                uid_ok && name_ok
            })
            .map(|(uid, info)| {
                let avatar = info
                    .uin
                    .as_deref()
                    .filter(|u| !u.is_empty())
                    .map(|u| format!("https://q.qlogo.cn/g?b=qq&nk={u}&s=100"));
                json!({
                    "uid": uid,
                    "displayName": if info.display_name.is_empty() { uid.clone() } else { info.display_name.clone() },
                    "aliases": info.names.iter().collect::<Vec<_>>(),
                    "count": info.count,
                    "avatar": avatar,
                })
            })
            .collect();

        let manifest = json!({
            "format": "qce-modern-html-chunked",
            "version": 1,
            "exporter": self.options.exporter_version.as_deref().map(|v| json!({
                "name": "qq-chat-exporter",
                "version": v,
            })),
            "exportTime": export_time_iso,
            "chat": {
                "name": chat_info.name,
                "type": chat_info.chat_type,
                "avatar": chat_info.avatar,
                "selfUid": chat_info.self_uid,
                "selfUin": chat_info.self_uin,
                "selfName": chat_info.self_name,
                "peerUid": chat_info.peer_uid,
                "peerUin": chat_info.peer_uin,
            },
            "stats": {
                "totalMessages": *total_messages,
                "firstTime": first_time.map(iso_from_ms),
                "lastTime": last_time.map(iso_from_ms),
                "timeRangeText": time_range_text,
                "minDateKey": *min_date_key,
                "maxDateKey": *max_date_key,
            },
            "chunking": {
                "maxMessagesPerChunk": limits.max_messages_per_chunk,
                "maxChunkBytes": limits.max_chunk_bytes,
            },
            "bloom": {
                "textBits": limits.bloom_text_bits,
                "textHashes": limits.bloom_text_hashes,
                "senderBits": limits.bloom_sender_bits,
                "senderHashes": limits.bloom_sender_hashes,
            },
            "msgidIndex": {
                "bucketCount": limits.msg_id_index_bucket_count,
                "dir": format!("{}/{}", dir_names.data, dir_names.index),
                "filePrefix": bucket_file_prefix,
                "fileExt": bucket_file_ext,
            },
            "paths": {
                "assetsDir": dir_names.assets,
                "dataDir": dir_names.data,
                "chunksDir": format!("{}/{}", dir_names.data, dir_names.chunks),
                "indexDir": format!("{}/{}", dir_names.data, dir_names.index),
                "resourcesDir": "resources",
            },
            "senders": senders,
            "chunks": chunks_meta,
        });

        // write manifest.js (JSONP)
        let manifest_js_path = data_dir.join("manifest.js");
        let manifest_json_path = data_dir.join("manifest.json");

        let manifest_js = format!(
            "window.__QCE_MANIFEST__ && window.__QCE_MANIFEST__({manifest});\n"
        );
        fs::write(&manifest_js_path, manifest_js)
            .await
            .map_err(|e| ExportError::io("writeFile", &manifest_js_path, e))?;
        if limits.write_manifest_json {
            let pretty = serde_json::to_string_pretty(&manifest)?;
            fs::write(&manifest_json_path, pretty)
                .await
                .map_err(|e| ExportError::io("writeFile", &manifest_json_path, e))?;
        }

        // write index.html (viewer shell) AFTER stats computed
        let metadata = json!({
            "messageCount": *total_messages,
            "chatName": chat_info.name,
            "chatType": chat_info.chat_type,
            "avatarUrl": chat_info.avatar,
            "peerUid": chat_info.peer_uid,
            "peerUin": chat_info.peer_uin,
            "exportTime": export_time_iso,
            "mode": "chunked",
        });

        let header_html =
            self.generate_header(chat_info, TotalMessages::Count(*total_messages), &time_range_text);
        let index_html = render_template(
            MODERN_CHUNKED_INDEX_HTML_TEMPLATE,
            &[
                ("METADATA_JSON", &metadata.to_string()),
                ("CHAT_NAME_ESC", &escape_html(&chat_info.name)),
                ("TOOLBAR", MODERN_TOOLBAR_HTML),
                ("HEADER", &header_html),
                ("FOOTER", MODERN_FOOTER_HTML),
            ],
        );
        fs::write(output_path, index_html)
            .await
            .map_err(|e| ExportError::io("writeFile", output_path, e))?;

        Ok(ChunkedHtmlExportResult {
            output_dir: output_dir.to_path_buf(),
            index_html_path: output_path.to_path_buf(),
            manifest_js_path,
            manifest_json_path: limits.write_manifest_json.then_some(manifest_json_path),
            chunk_count: chunks_meta.len(),
            total_messages: *total_messages,
            copied_resources: std::mem::take(copied_resources),
        })
    }

    /* ------------------------ 元数据回填 ------------------------ */

    /// 更新 HTML 文件中的元数据注释（对应 TS `updateMetadata`；失败静默）。
    async fn update_metadata(&self, message_count: usize) {
        let Ok(content) = fs::read_to_string(&self.options.output_path).await else {
            return;
        };
        // 与 TS 正则 `<!-- QCE_METADATA: \{[^}]+\} -->` 等价的手工匹配
        let Some(start) = content.find("<!-- QCE_METADATA: {") else {
            return;
        };
        let brace_start = start + "<!-- QCE_METADATA: ".len();
        let Some(brace_rel_end) = content[brace_start..].find('}') else {
            return;
        };
        let brace_end = brace_start + brace_rel_end + 1;
        if !content[brace_end..].starts_with(" -->") {
            return;
        }
        let metadata_str = &content[brace_start..brace_end];
        let Ok(mut metadata) = serde_json::from_str::<Value>(metadata_str) else {
            return;
        };
        let Some(obj) = metadata.as_object_mut() else {
            return;
        };
        obj.insert("messageCount".to_owned(), json!(message_count));
        let new_comment = format!("<!-- QCE_METADATA: {metadata} -->");
        let comment_end = brace_end + " -->".len();
        let new_content = format!(
            "{}{}{}",
            &content[..start],
            new_comment,
            &content[comment_end..]
        );
        // 写回失败同样静默，不影响导出流程
        let _ = fs::write(&self.options.output_path, new_content).await;
    }

    /* ------------------------ Issue #311: data URI 内联 ------------------------ */

    /// 把单个资源读入内存并缓存为 data URI。命中以下任一情况则跳过：
    /// 缓存已存在、之前已记录过 miss、文件超过 `max_embed_file_size_bytes`。
    async fn preload_data_uri(&mut self, resource: &ResourceTask) {
        let key = data_uri_cache_key(resource);
        if key.is_empty() {
            return;
        }
        if self.data_uri_cache.contains_key(&key) || self.data_uri_misses.contains(&key) {
            return;
        }

        let Some(source_path) = resolve_resource_source_path(resource).await else {
            self.data_uri_misses.insert(key);
            return;
        };

        let Ok(meta) = fs::metadata(&source_path).await else {
            self.data_uri_misses.insert(key);
            return;
        };
        let limit = self.options.max_embed_file_size_bytes;
        if limit > 0 && meta.len() > limit {
            self.data_uri_misses.insert(key);
            return;
        }
        match fs::read(&source_path).await {
            Ok(buf) => {
                let mime = guess_mime_type(resource, &source_path);
                use base64::engine::general_purpose::STANDARD as BASE64;
                use base64::Engine as _;
                let data_uri = format!("data:{mime};base64,{}", BASE64.encode(buf));
                self.data_uri_cache.insert(key, data_uri);
            }
            Err(_) => {
                self.data_uri_misses.insert(key);
            }
        }
    }

    /// 渲染期通过 `<typeDir>/<basename>` 查询已加载的 data URI（Issue #311）。
    fn lookup_data_uri(&self, type_dir: &str, file_name: &str) -> Option<String> {
        if type_dir.is_empty() || file_name.is_empty() {
            return None;
        }
        self.data_uri_cache
            .get(&format!("{type_dir}/{file_name}"))
            .cloned()
    }

    /* ------------------------ HTML 片段生成 ------------------------ */

    fn generate_styles(&self) -> String {
        format!("<style>\n{MODERN_CSS}\n</style>\n")
    }

    fn generate_scripts(&self) -> String {
        // 保持原结构：lucide CDN + 内联脚本。
        // Issue #467: 注入运行期开关，控制是否启用虚拟滚动。
        let enable_virtual_scroll = self.options.enable_virtual_scroll;
        format!(
            "<script>window.__QCE_ENABLE_VIRTUAL_SCROLL = {enable_virtual_scroll};</script>\n{MODERN_SINGLE_SCRIPTS_HTML}"
        )
    }

    /// 生成 Toolbar（底部胶囊）。
    ///
    /// Issue #467: 关闭搜索栏时隐藏整条工具栏（保留 DOM 节点，避免脚本里的
    /// 事件绑定取到 null 报错），`display:none` 同时让打印 / PDF 不再捕获它。
    fn generate_toolbar(&self) -> String {
        if !self.options.show_search_bar {
            return MODERN_TOOLBAR_HTML.replacen(
                "<div class=\"toolbar\">",
                "<div class=\"toolbar\" style=\"display:none\">",
                1,
            );
        }
        MODERN_TOOLBAR_HTML.to_owned()
    }

    /// Hero Section（左对齐，Apple 风格）。
    fn generate_header(
        &self,
        chat_info: &ChatInfo,
        total_messages: TotalMessages,
        time_range: &str,
    ) -> String {
        let current_time = locale_datetime_zh(Local::now());
        let total = match total_messages {
            TotalMessages::Count(n) => n.to_string(),
            TotalMessages::Placeholder => "--".to_owned(),
        };
        format!(
            r#"<div class="hero">
        <h1 class="hero-title">{}</h1>
        <p class="hero-subtitle">聊天记录</p>
        <div class="hero-meta">
            <div class="meta-item">
                <span class="meta-label">导出时间</span>
                <span class="meta-value">{current_time}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">消息总数</span>
                <span class="meta-value" id="info-total">{}</span>
        </div>
            <div class="meta-item">
                <span class="meta-label">时间范围</span>
                <span class="meta-value" id="info-range">{}</span>
                </div>
            </div>
        </div>"#,
            escape_html(&chat_info.name),
            escape_html(&total),
            escape_html(time_range)
        )
    }

    /// 渲染单条消息（Apple 风格带气泡角）。
    fn render_message(&mut self, message: &CleanMessage) -> String {
        // 系统消息
        if is_system_message(message) {
            let content = self.parse_message_content(message);
            let date_key = message_date_key(message).unwrap_or_default();
            let date_label = message_date_label(message).unwrap_or_default();
            let mut date_marker = String::new();
            if !date_key.is_empty() && self.last_rendered_date.as_deref() != Some(&date_key) {
                self.last_rendered_date = Some(date_key.clone());
                date_marker = format!(
                    r#"<div class="date-divider" data-date="{date_key}" data-label="{label}" id="date-{date_key}">
                    {label}
                </div>"#,
                    label = escape_html(&date_label)
                );
            }
            let system_class = if message.recalled {
                "system-message-container recalled-message"
            } else {
                "system-message-container"
            };
            return format!(
                r#"<div class="message-block" data-date="{date_key}">
                {date_marker}
                <div class="{system_class}" role="note">
                    {content}
                    <div class="system-message-time">{}</div>
                </div>
            </div>"#,
                format_time(&message.time)
            );
        }

        // 普通消息
        let date_key = message_date_key(message).unwrap_or_default();
        let date_label = message_date_label(message).unwrap_or_default();
        let mut date_marker = String::new();
        if !date_key.is_empty() && self.last_rendered_date.as_deref() != Some(&date_key) {
            self.last_rendered_date = Some(date_key.clone());
            date_marker = format!(
                r#"<div class="date-divider" data-date="{date_key}" data-label="{label}" id="date-{date_key}">
                {label}
            </div>"#,
                label = escape_html(&date_label)
            );
        }

        let is_self = self.is_self_message(message);
        let css_class = if is_self { "self" } else { "other" };
        let avatar_content = generate_avatar_html(
            message.sender.uin.as_deref(),
            Some(message.sender.name.as_str()).filter(|s| !s.is_empty()),
        );
        let content = self.parse_message_content(message);

        // 获取发送者 UID 用于筛选（支持同一用户不同群名片整合）
        let sender_uid = if message.sender.uid.is_empty() {
            message.sender.uin.clone().unwrap_or_default()
        } else {
            message.sender.uid.clone()
        };
        // 群头衔（issue #331）：当 senderTitleResolver 命中时，渲染为 sender 旁的小徽章
        let title_html = message
            .sender
            .title
            .as_deref()
            .filter(|t| !t.is_empty())
            .map(|t| format!("<span class=\"sender-title\">{}</span>", escape_html(t)))
            .unwrap_or_default();
        format!(
            r#"
        <div class="message-block" data-date="{date_key}">
            {date_marker}
            <div class="message {css_class}" data-date="{date_key}" data-sender-uid="{}" id="msg-{}">
                <div class="avatar">{avatar_content}</div>
                <div class="message-wrapper">
                    <div class="message-header">
                        {title_html}<span class="sender">{}</span>
                        <span class="time">{}</span>
                    </div>
                    <div class="message-bubble">
                        <div class="content">{content}</div>
                    </div>
                </div>
            </div>
        </div>"#,
            escape_html(&sender_uid),
            message.id,
            escape_html(&get_display_name(message)),
            format_time(&message.time)
        )
    }

    /// 解析消息内容（按元素渲染）。
    fn parse_message_content(&self, message: &CleanMessage) -> String {
        let elements = &message.content.elements;
        if elements.is_empty() {
            let text = if message.content.text.is_empty() {
                "[空消息]"
            } else {
                message.content.text.as_str()
            };
            return format!("<span class=\"text-content\">{}</span>", escape_html(text));
        }

        let mut result = String::new();
        for element in elements {
            let data = &element.data;
            match element.element_type.as_str() {
                "text" => result.push_str(&render_text_element(data)),
                "image" => result.push_str(&self.render_image_element(data)),
                "audio" => result.push_str(&self.render_audio_element(data)),
                "video" => result.push_str(&self.render_video_element(data)),
                "file" => result.push_str(&self.render_file_element(data)),
                "face" => result.push_str(&render_face_element(data)),
                "market_face" => result.push_str(&render_market_face_element(data)),
                "reply" => result.push_str(&self.render_reply_element(data)),
                "json" => result.push_str(&render_json_element(data)),
                "forward" => result.push_str(&render_forward_element(data, 0)),
                "system" => result.push_str(&render_system_element(data)),
                "location" => result.push_str(&render_location_element(data)),
                _ => {
                    let raw_text = str_field(data, "text")
                        .or_else(|| str_field(data, "summary"))
                        .or_else(|| str_field(data, "content"))
                        .unwrap_or_default();
                    if !raw_text.is_empty() {
                        result.push_str(&format!(
                            "<span class=\"text-content\">{}</span>",
                            escape_html(&raw_text)
                        ));
                    }
                }
            }
        }
        if result.is_empty() {
            "<span class=\"text-content\">[空消息]</span>".to_owned()
        } else {
            result
        }
    }

    /* ------------------------ 资源类元素渲染 ------------------------ */

    /// 资源 src 选择：localPath →（分块模式）filename → 过滤后的外链 URL。
    fn pick_resource_src(&self, data: &Value, type_dir: &str) -> String {
        if let Some(local_path) = str_field(data, "localPath") {
            if is_valid_resource_path(&local_path) {
                let base_name = base_name_of(&local_path);
                // Issue #311: 自包含模式下优先取内联 data URI，未命中才退回相对路径。
                return self.lookup_data_uri(type_dir, &base_name).unwrap_or_else(|| {
                    format!("{}/{type_dir}/{base_name}", self.resource_base_href)
                });
            }
        }
        if let Some(filename) = str_field(data, "filename") {
            if !filename.is_empty() && self.options.include_resource_links {
                return self.lookup_data_uri(type_dir, &filename).unwrap_or_else(|| {
                    format!("{}/{type_dir}/{filename}", self.resource_base_href)
                });
            }
        }
        if let Some(url) = str_field(data, "url") {
            // 过滤掉 file:// 协议和本地文件系统路径
            if is_acceptable_remote_url(&url) {
                return url;
            }
        }
        String::new()
    }

    fn render_image_element(&self, data: &Value) -> String {
        let filename = str_field(data, "filename").unwrap_or_else(|| "图片".to_owned());
        let src = self.pick_resource_src(data, "images");
        if !src.is_empty() {
            // issue #510: 自定义表情包（picSubType=1）渲染成裸贴纸，与商城表情一致。
            if str_field(data, "subType").as_deref() == Some("sticker") {
                return format!(
                    "<span class=\"sticker-wrap\"><img src=\"{src}\" alt=\"{n}\" class=\"sticker sticker-img\" title=\"{n}\" loading=\"lazy\" onclick=\"showImageModal(this.src)\"></span>",
                    n = escape_html(&filename)
                );
            }
            // Issue #311: 当 src 为 data URI 时直接传入会让 HTML 体积翻倍，
            // 并可能造成 onclick 字符串字面量超长引发解析问题。改为从 this.src
            // 读取，对外链与 data URI 行为一致。
            return format!(
                "<div class=\"image-content\"><img src=\"{src}\" alt=\"{}\" loading=\"lazy\" onclick=\"showImageModal(this.src)\"></div>",
                escape_html(&filename)
            );
        }
        format!(
            "<span class=\"text-content\">📷 {}</span>",
            escape_html(&filename)
        )
    }

    fn render_audio_element(&self, data: &Value) -> String {
        let duration_raw = num_field_display(data, "duration");
        let duration = duration_raw.parse::<f64>().unwrap_or(0.0).round() as i64;
        let filename = str_field(data, "filename").unwrap_or_else(|| "语音".to_owned());
        let src = self.pick_resource_src(data, "audios");

        if !src.is_empty() {
            // 波形条：根据时长伪随机生成一组高度，纯装饰。
            let duration_seed = usize::try_from(duration).unwrap_or(0);
            let bars = (0..18).fold(String::new(), |mut bars, i| {
                let h = 30 + ((i * 37 + duration_seed * 13) % 60);
                let _ = write!(bars, "<i style=\"height:{h}%\"></i>");
                bars
            });
            let dur_label = if duration > 0 {
                format!("{duration}\"")
            } else {
                "语音".to_owned()
            };
            return format!(
                "<div class=\"voice-bubble\" data-src=\"{src}\" data-name=\"{fname}\" role=\"button\" tabindex=\"0\">\
                    <span class=\"vplay\"></span>\
                    <span class=\"vbars\">{bars}</span>\
                    <span class=\"vsec\">{dur_label}</span>\
                    <span class=\"vdl\" title=\"下载语音\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg></span>\
                </div>",
                fname = escape_html(&filename)
            );
        }
        format!("<span class=\"text-content\">🎤 [语音:{duration}秒]</span>")
    }

    fn render_video_element(&self, data: &Value) -> String {
        let filename = str_field(data, "filename").unwrap_or_else(|| "视频".to_owned());
        let src = self.pick_resource_src(data, "videos");
        if !src.is_empty() {
            // video-bubble：首帧当缩略图（#t=0.1），播放角标 + 文件名，点击进预览层。
            return format!(
                "<div class=\"video-bubble\" data-src=\"{src}\" data-name=\"{fname}\" role=\"button\" tabindex=\"0\">\
                    <video class=\"img\" src=\"{src}#t=0.1\" preload=\"metadata\" muted playsinline></video>\
                    <span class=\"vbadge\"><span class=\"vtri\"></span>视频</span>\
                    <span class=\"vname\">{fname}</span>\
                </div>",
                fname = escape_html(&filename)
            );
        }
        format!(
            "<span class=\"text-content\">🎬 {}</span>",
            escape_html(&filename)
        )
    }

    fn render_file_element(&self, data: &Value) -> String {
        let filename = str_field(data, "filename").unwrap_or_else(|| "文件".to_owned());
        let href = self.pick_resource_src(data, "files");
        let size_bytes = data
            .get("fileSize")
            .or_else(|| data.get("size"))
            .and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => s.parse::<u64>().ok(),
                _ => None,
            })
            .unwrap_or(0);
        let size_label = format_file_size(size_bytes);
        let icon = file_icon_svg(&filename);
        if !href.is_empty() {
            return format!(
                "<a href=\"{href}\" class=\"message-file file-bubble\" download=\"{fname}\">\
                    <span class=\"ficon\">{icon}</span>\
                    <span class=\"fmeta\"><span class=\"fname\">{fname}</span>{size_html}</span>\
                </a>",
                fname = escape_html(&filename),
                size_html = if size_label.is_empty() {
                    String::new()
                } else {
                    format!("<span class=\"fsize\">{size_label}</span>")
                }
            );
        }
        format!(
            "<span class=\"text-content\">📎 {}</span>",
            escape_html(&filename)
        )
    }

    fn render_reply_element(&self, data: &Value) -> String {
        let sender_name = str_field(data, "senderName").unwrap_or_else(|| "用户".to_owned());
        let content = str_field(data, "content")
            .or_else(|| str_field(data, "text"))
            .unwrap_or_else(|| "引用消息".to_owned());

        // Issue #128: 选 reply 跳转目标 / 时间字段。SimpleMessageParser
        // 写的是 referencedMessageId / timestamp（秒级 epoch number），跟
        // 历史的 replyMsgId / time 字段不同；这两个 helper 把字段挑选
        // 统一掉，并把时间格式化成「MM-DD HH:mm」中文串。
        let input = ReplyRenderInput::from_value(data);
        let jump_target = choose_reply_jump_target(&input);
        let time_str = format_reply_timestamp(input.timestamp.as_ref().or(input.time.as_ref()));

        // Issue #128 子项：被引用消息里如果带图片 / 表情 / 音视频 / 文件，
        // HTML 里把它们渲染成对应的缩略图、表情图、icon + 文件名，纯文字部分
        // 用 escape 后的 text 拼接。渲染细节统一交给 reply_preview_renderer，
        // 这里只负责注入上下文。
        let preview_elements: Vec<Value> = data
            .get("previewElements")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let body_html = if preview_elements.is_empty() {
            // 兼容老路径：data.imageUrl / data.elements 上有人手动塞过的图片
            let mut image_html = String::new();
            let img_src = str_field(data, "imageUrl").or_else(|| str_field(data, "image"));
            if let Some(img_src) = img_src.filter(|s| !s.is_empty()) {
                image_html =
                    format!("<img src=\"{img_src}\" class=\"reply-content-thumb\" alt=\"引用图片\">");
            } else if content.contains("[图片]") {
                if let Some(elements) = data.get("elements").and_then(Value::as_array) {
                    let img_element = elements.iter().find(|el| {
                        el.get("type").and_then(Value::as_str) == Some("image")
                    });
                    if let Some(local_path) = img_element
                        .and_then(|el| el.get("data"))
                        .and_then(|d| d.get("localPath"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                    {
                        let base_name = base_name_of(local_path);
                        let img_src =
                            self.lookup_data_uri("images", &base_name).unwrap_or_else(|| {
                                format!("{}/images/{base_name}", self.resource_base_href)
                            });
                        image_html = format!(
                            "<img src=\"{img_src}\" class=\"reply-content-thumb\" alt=\"引用图片\" loading=\"lazy\">"
                        );
                    }
                }
            }
            format!("{}{image_html}", escape_html(&content))
        } else {
            let lookup = |kind: &str, base: &str| self.lookup_data_uri(kind, base);
            let face = |id: &str| get_face_name_by_id(id);
            let ctx = ReplyPreviewRenderContext {
                resource_base_href: &self.resource_base_href,
                lookup_data_uri: &lookup,
                get_face_name: &face,
            };
            render_reply_preview_elements(&preview_elements, &ctx)
        };

        let interaction_attrs = jump_target
            .as_deref()
            .map(|t| {
                format!(
                    "data-reply-to=\"msg-{}\" role=\"button\" tabindex=\"0\" aria-label=\"跳转到原消息\"",
                    escape_html(t)
                )
            })
            .unwrap_or_default();
        let time_html = if time_str.is_empty() {
            String::new()
        } else {
            format!(
                "<span class=\"reply-content-time\">{}</span>",
                escape_html(&time_str)
            )
        };

        format!(
            r#"<div class="reply-content" {interaction_attrs}>
            <div class="reply-content-header">
                <strong>{}</strong>
                {time_html}
            </div>
            <div class="reply-content-text">{body_html}</div>
        </div>"#,
            escape_html(&sender_name)
        )
    }

    fn is_self_message(&self, message: &CleanMessage) -> bool {
        let Some(chat_info) = &self.current_chat_info else {
            return false;
        };
        if let Some(self_uid) = chat_info.self_uid.as_deref().filter(|s| !s.is_empty()) {
            if !message.sender.uid.is_empty() && message.sender.uid == self_uid {
                return true;
            }
        }
        if let Some(self_uin) = chat_info.self_uin.as_deref().filter(|s| !s.is_empty()) {
            if let Some(uin) = message.sender.uin.as_deref().filter(|s| !s.is_empty()) {
                if uin == self_uin {
                    return true;
                }
            }
        }
        false
    }
}

/// 消息总数展示（数字 / 占位符 `--`）。
enum TotalMessages {
    Count(usize),
    Placeholder,
}

/// sender 聚合信息（chunked manifest 用）。
struct SenderInfo {
    names: indexmap::IndexSet<String>,
    display_name: String,
    count: u64,
    /// QQ 号（用于拼真实头像 URL）。
    uin: Option<String>,
}

/// 目录名集合（chunked 模式）。
struct DirNames<'a> {
    assets: &'a str,
    data: &'a str,
    chunks: &'a str,
    index: &'a str,
}

/// 分块 / 索引参数（钳制后的有效值）。
struct ChunkLimits {
    max_messages_per_chunk: usize,
    max_chunk_bytes: u64,
    enable_text_bloom: bool,
    bloom_text_bits: u32,
    bloom_text_hashes: u32,
    bloom_sender_bits: u32,
    bloom_sender_hashes: u32,
    bloom_max_chars_per_message: usize,
    store_text_max_chars: usize,
    msg_id_index_bucket_count: u32,
    write_manifest_json: bool,
}

/// `export_chunked_inner` 的借用参数打包（避免形参过多）。
struct ChunkedRunArgs<'a> {
    messages: &'a [CleanMessage],
    chat_info: &'a ChatInfo,
    output_dir: &'a Path,
    output_path: &'a Path,
    data_dir: &'a Path,
    chunks_dir: &'a Path,
    dir_names: DirNames<'a>,
    limits: ChunkLimits,
    bucket_file_prefix: &'a str,
    bucket_file_ext: &'a str,
    concurrency: usize,
    running: &'a mut JoinSet<Option<String>>,
    copied_resources: &'a mut Vec<String>,
    chunks_meta: &'a mut Vec<Value>,
    senders_by_uid: &'a mut indexmap::IndexMap<String, SenderInfo>,
    total_messages: &'a mut usize,
    first_time: &'a mut Option<i64>,
    last_time: &'a mut Option<i64>,
    min_date_key: &'a mut Option<String>,
    max_date_key: &'a mut Option<String>,
    bucket_streams: &'a mut Vec<BufWriter<fs::File>>,
    bucket_paths: &'a [PathBuf],
    bucket_first: &'a mut Vec<bool>,
    chunk: &'a mut ChunkState,
}

/* ------------------------ chunk 生命周期 ------------------------ */

/// 开启新 chunk（对应 TS `startChunk`）。
async fn start_chunk(
    chunk: &mut ChunkState,
    chunks_dir: &Path,
    limits: &ChunkLimits,
) -> ExportResultT<()> {
    chunk.index += 1;
    chunk.id = format!("c{:06}", chunk.index);
    let abs_path = chunks_dir.join(format!("{}.js", chunk.id));
    let file = fs::File::create(&abs_path)
        .await
        .map_err(|e| ExportError::io("createWriteStream", &abs_path, e))?;
    let mut ws = BufWriter::new(file);

    chunk.count = 0;
    chunk.bytes = 0;
    chunk.start_ts = 0;
    chunk.end_ts = 0;
    chunk.start_date.clear();
    chunk.end_date.clear();
    chunk.first_msg_id.clear();
    chunk.last_msg_id.clear();
    chunk.is_first_record = true;

    chunk.text_bloom_incomplete = false;
    chunk.text_bloom = limits
        .enable_text_bloom
        .then(|| BloomFilter::new(limits.bloom_text_bits, limits.bloom_text_hashes));
    chunk.sender_bloom = Some(BloomFilter::new(
        limits.bloom_sender_bits,
        limits.bloom_sender_hashes,
    ));

    let header = format!(
        "window.__QCE_CHUNK__ && window.__QCE_CHUNK__({{id:{},messages:[\n",
        Value::String(chunk.id.clone())
    );
    write_chunk(&mut ws, &abs_path, &header).await?;
    chunk.bytes += header.len() as u64;

    chunk.writer = Some(ws);
    chunk.path = abs_path;
    Ok(())
}

/// 关闭当前 chunk 并记录 meta（对应 TS `finishChunk`）。
async fn finish_chunk(
    chunk: &mut ChunkState,
    chunks_meta: &mut Vec<Value>,
    chunk_file_rel: &(dyn Fn(&str) -> String + Sync),
) -> ExportResultT<()> {
    let Some(mut ws) = chunk.writer.take() else {
        return Ok(());
    };
    let footer = "\n]});\n";
    write_chunk(&mut ws, &chunk.path, footer).await?;
    chunk.bytes += footer.len() as u64;
    ws.flush()
        .await
        .map_err(|e| ExportError::io("finish", chunk.path.as_path(), e))?;
    ws.into_inner()
        .sync_all()
        .await
        .map_err(|e| ExportError::io("finish", chunk.path.as_path(), e))?;

    // meta
    let meta = json!({
        "id": chunk.id,
        "file": chunk_file_rel(&chunk.id),
        "count": chunk.count,
        "startTs": chunk.start_ts,
        "endTs": chunk.end_ts,
        "startDate": chunk.start_date,
        "endDate": chunk.end_date,
        "textBloom": chunk.text_bloom.as_ref().map_or_else(String::new, BloomFilter::to_base64),
        "textBloomIncomplete": chunk.text_bloom_incomplete,
        "senderBloom": chunk.sender_bloom.as_ref().map_or_else(String::new, BloomFilter::to_base64),
        "firstMsgId": chunk.first_msg_id,
        "lastMsgId": chunk.last_msg_id,
        "bytes": chunk.bytes,
    });
    chunks_meta.push(meta);

    chunk.text_bloom = None;
    chunk.sender_bloom = None;
    Ok(())
}

/* ------------------------ 流式写入 / 并发复制 ------------------------ */

/// 写入一段字符串（对应 TS `writeChunk`；tokio `write_all` 天然遵循 backpressure）。
async fn write_chunk(
    ws: &mut BufWriter<fs::File>,
    path: &Path,
    chunk: &str,
) -> ExportResultT<()> {
    ws.write_all(chunk.as_bytes())
        .await
        .map_err(|e| ExportError::io("writeChunk", path, e))
}

/// 资源复制并发数：根据 CPU 数量自适应，范围 [2, 8]（与 TS 一致）。
fn copy_concurrency() -> usize {
    let cpus = std::thread::available_parallelism().map_or(4, std::num::NonZeroUsize::get);
    cpus.clamp(2, 8)
}

/// 等待任一复制任务完成并收集其结果（复制失败仅跳过，不中断导出）。
async fn drain_one_copy(running: &mut JoinSet<Option<String>>, copied: &mut Vec<String>) {
    if let Some(Ok(Some(resource_path))) = running.join_next().await {
        copied.push(resource_path);
    }
}

/* ------------------------ 单文件内联辅助 ------------------------ */

/// 内联进 `<script>` 前的转义：防止 JS 字符串里的 `</script` 提前闭合标签。
/// 该序列只会出现在 JSON/JS 字符串字面量内，`<\/` 是等价的合法转义。
fn escape_inline_script(source: &str) -> String {
    source.replace("</script", "<\\/script")
}

/// 读取一个 JSONP 数据脚本文件并以内联 `<script>` 形式写出。
async fn inline_script_file(
    ws: &mut BufWriter<fs::File>,
    output_path: &Path,
    file_path: &Path,
) -> ExportResultT<()> {
    let content = fs::read_to_string(file_path)
        .await
        .map_err(|e| ExportError::io("readFile", file_path, e))?;
    write_chunk(ws, output_path, "<script>").await?;
    write_chunk(ws, output_path, &escape_inline_script(&content)).await?;
    write_chunk(ws, output_path, "</script>\n").await?;
    Ok(())
}

/// 列出目录下的 `.js` 文件并按文件名排序（chunk id / bucket 编号有序）。
async fn sorted_js_files(dir: &Path) -> ExportResultT<Vec<PathBuf>> {
    let mut entries = fs::read_dir(dir)
        .await
        .map_err(|e| ExportError::io("readdir", dir, e))?;
    let mut files: Vec<PathBuf> = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| ExportError::io("readdir", dir, e))?
    {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "js") {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

/// 把 `src` 目录的内容合并移动到 `dst`（同名文件覆盖，子目录递归）。
async fn move_dir_merge(src: &Path, dst: &Path) -> ExportResultT<()> {
    let src = src.to_path_buf();
    let dst = dst.to_path_buf();
    tokio::task::spawn_blocking(move || move_dir_merge_sync(&src, &dst)).await??;
    Ok(())
}

fn move_dir_merge_sync(src: &Path, dst: &Path) -> ExportResultT<()> {
    std::fs::create_dir_all(dst).map_err(|e| ExportError::io("mkdir", dst, e))?;
    for entry in std::fs::read_dir(src).map_err(|e| ExportError::io("readdir", src, e))? {
        let entry = entry.map_err(|e| ExportError::io("readdir", src, e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let is_dir = entry
            .file_type()
            .map_err(|e| ExportError::io("stat", &from, e))?
            .is_dir();
        if is_dir {
            move_dir_merge_sync(&from, &to)?;
            let _ = std::fs::remove_dir(&from);
        } else if std::fs::rename(&from, &to).is_err() {
            // 跨设备 / 目标被占用等情况回退为复制
            std::fs::copy(&from, &to).map_err(|e| ExportError::io("copyFile", &to, e))?;
            let _ = std::fs::remove_file(&from);
        }
    }
    Ok(())
}

/* ------------------------ 资源枚举与复制 ------------------------ */

/// 枚举消息中的资源任务（对应 TS `iterResources`）。
fn iter_resources(message: &CleanMessage) -> Vec<ResourceTask> {
    let mut tasks = Vec::new();

    // 自带 resources 数组
    for r in &message.content.resources {
        if let Some(local_path) = r.local_path.as_deref() {
            if is_valid_resource_path(local_path) {
                tasks.push(ResourceTask {
                    resource_type: if r.resource_type.is_empty() {
                        "file".to_owned()
                    } else {
                        r.resource_type.clone()
                    },
                    file_name: base_name_of(local_path),
                    local_path: local_path.to_owned(),
                });
            }
        }
    }

    // elements 中的资源元素
    for el in &message.content.elements {
        let data = &el.data;
        if !data.is_object() {
            continue;
        }
        let el_type = if el.element_type.is_empty() {
            "file".to_owned()
        } else {
            el.element_type.clone()
        };

        // 优先使用有效的 localPath
        let local_path = str_field(data, "localPath").unwrap_or_default();
        if !local_path.is_empty() && is_valid_resource_path(&local_path) {
            tasks.push(ResourceTask {
                resource_type: el_type,
                file_name: base_name_of(&local_path),
                local_path,
            });
            continue;
        }
        // 如果没有有效的 localPath，但有 filename/md5，也尝试处理（用于流式导出）
        let filename = str_field(data, "filename").filter(|s| !s.is_empty());
        let md5 = str_field(data, "md5").filter(|s| !s.is_empty());
        if filename.is_some() || md5.is_some() {
            let file_name = filename.or_else(|| md5.map(|m| format!("{m}.jpg")));
            if let Some(file_name) = file_name {
                tasks.push(ResourceTask {
                    resource_type: el_type,
                    file_name,
                    // 空路径，copy_resource_file 会从 ResourceHandler 目录查找
                    local_path: String::new(),
                });
            }
        }
    }
    tasks
}

/// 流式复制单个资源到导出目录（对应 TS `copyResourceFileStream`）。
///
/// 返回成功复制（或已存在）的相对路径；失败 / 找不到时返回 `None`（静默跳过）。
async fn copy_resource_file(resource: &ResourceTask, output_dir: &Path) -> Option<String> {
    let source_absolute_path = resolve_resource_source_path(resource).await?;

    // 目标路径（按 HTML 中引用规则）
    let type_dir = normalize_type_dir(&resource.resource_type);
    let target_relative = format!("resources/{type_dir}/{}", resource.file_name);
    let target_absolute = output_dir
        .join("resources")
        .join(type_dir)
        .join(&resource.file_name);

    // 文件已存在则跳过（以磁盘为真，避免维护超大 Set）
    if fs::try_exists(&target_absolute).await.unwrap_or(false) {
        return Some(target_relative);
    }

    // 确保父目录存在（理论上已创建，这里兜底）
    if let Some(parent) = target_absolute.parent() {
        if fs::create_dir_all(parent).await.is_err() {
            return None;
        }
    }

    // tokio::fs::copy 内部按块读写，内存占用极小
    match fs::copy(&source_absolute_path, &target_absolute).await {
        Ok(_) => Some(target_relative),
        Err(_) => None,
    }
}

/// 解析资源在磁盘上的真实路径（Issue #311，与 `copy_resource_file` 规则一致）：
/// 先认 `local_path`，再退回到 ResourceHandler 默认资源目录按文件名匹配
/// （支持带 md5 前缀 `<md5>_<name>` 的文件名）。返回 `None` 表示未找到。
async fn resolve_resource_source_path(resource: &ResourceTask) -> Option<PathBuf> {
    if !resource.local_path.trim().is_empty() {
        let candidate = resolve_resource_path(&resource.local_path);
        if let Ok(meta) = fs::metadata(&candidate).await {
            if !meta.is_dir() {
                return Some(candidate);
            }
        }
    }
    if !resource.file_name.is_empty() {
        let type_dir = normalize_type_dir(&resource.resource_type);
        let resource_handler_dir = resource_handler_root().join(type_dir);
        if fs::try_exists(&resource_handler_dir).await.unwrap_or(false) {
            let base_name = resource.file_name.to_lowercase();
            let mut entries = fs::read_dir(&resource_handler_dir).await.ok()?;
            while let Ok(Some(entry)) = entries.next_entry().await {
                let f = entry.file_name().to_string_lossy().into_owned();
                let f_lower = f.to_lowercase();
                if f_lower == base_name || f_lower.ends_with(&format!("_{base_name}")) {
                    let full_path = resource_handler_dir.join(&f);
                    if fs::try_exists(&full_path).await.unwrap_or(false) {
                        return Some(full_path);
                    }
                }
            }
        }
    }
    None
}

/// ResourceHandler 资源根目录：`%USERPROFILE%/.qq-chat-exporter/resources`，
/// 无 `USERPROFILE`（非 Windows）时与 TS 相同回退到进程工作目录。
fn resource_handler_root() -> PathBuf {
    let base = std::env::var_os("USERPROFILE").map_or_else(
        || std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        PathBuf::from,
    );
    base.join(".qq-chat-exporter").join("resources")
}

/// 跨平台 HOME 目录（对应 TS `os.homedir()`）。
fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map_or_else(
            || std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            PathBuf::from,
        )
}

/// 解析资源路径为绝对路径（对应 TS `resolveResourcePath`，修复 Issue #30）。
fn resolve_resource_path(resource_path: &str) -> PathBuf {
    let p = Path::new(resource_path);
    // 已是绝对路径
    if p.is_absolute() {
        return p.to_path_buf();
    }
    // 资源根目录：跨平台 HOME 目录
    let resource_root = home_dir().join(".qq-chat-exporter").join("resources");
    // 处理 images/xxx.jpg 格式的相对路径
    for type_prefix in ["images/", "videos/", "audios/", "files/"] {
        if resource_path.starts_with(type_prefix) {
            return resource_root.join(resource_path);
        }
    }
    // resources/ 相对路径
    if let Some(rest) = resource_path.strip_prefix("resources/") {
        return resource_root.join(rest);
    }
    // 仅文件名：遍历资源类型目录
    for type_dir in ["images", "videos", "audios", "files"] {
        let full_path = resource_root.join(type_dir).join(resource_path);
        if full_path.exists() {
            return full_path;
        }
    }
    // 默认回退
    resource_root.join(resource_path)
}

/// 资源路径有效性（对应 TS `isValidResourcePath`）。
fn is_valid_resource_path(resource_path: &str) -> bool {
    let trimmed = resource_path.trim();
    if trimmed.is_empty() {
        return false;
    }
    // 修复 Issue #30: 允许 images/videos/audios/files 开头的相对路径
    let has_valid_prefix = ["images/", "videos/", "audios/", "files/"]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix));
    trimmed.starts_with("resources/")
        || has_valid_prefix
        || Path::new(trimmed).is_absolute()
        || (!trimmed.contains('\\') && !trimmed.contains('/'))
}

/// 资源类型 → 约定目录名（对应 TS `normalizeTypeDir`）。
fn normalize_type_dir(resource_type: &str) -> &'static str {
    // 仅特定类型收敛到约定目录，其他一律归档至 files
    match resource_type {
        "image" => "images",
        "video" => "videos",
        "audio" => "audios",
        _ => "files",
    }
}

/// 生成稳定的资源 key（Issue #311）：`<typeDir>/<basename>`。
fn data_uri_cache_key(resource: &ResourceTask) -> String {
    let type_dir = normalize_type_dir(&resource.resource_type);
    let base = if resource.local_path.trim().is_empty() {
        resource.file_name.clone()
    } else {
        base_name_of(&resource.local_path)
    };
    if base.is_empty() {
        return String::new();
    }
    format!("{type_dir}/{base}")
}

/// 根据资源类型与文件扩展名推断 MIME（Issue #311）。未识别的扩展名退回到
/// `application/octet-stream`，浏览器可在下载链接里正确处理。
fn guess_mime_type(resource: &ResourceTask, source_path: &Path) -> &'static str {
    let ext = source_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .or_else(|| {
            Path::new(&resource.file_name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
        })
        .unwrap_or_default();
    let by_ext = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mkv" => Some("video/x-matroska"),
        "avi" => Some("video/x-msvideo"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "amr" => Some("audio/amr"),
        "silk" => Some("audio/silk"),
        "pdf" => Some("application/pdf"),
        "zip" => Some("application/zip"),
        "json" => Some("application/json"),
        "txt" => Some("text/plain"),
        "html" => Some("text/html"),
        _ => None,
    };
    if let Some(mime) = by_ext {
        return mime;
    }
    match resource.resource_type.as_str() {
        "image" => "image/jpeg",
        "video" => "video/mp4",
        "audio" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

/* ------------------------ 与渲染无关的元素工具 ------------------------ */

/// 读取 JSON 对象字符串字段；数字字段转为字符串（对齐 TS 的宽松取值）。
fn str_field(data: &Value, key: &str) -> Option<String> {
    match data.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// 数字字段展示：缺省 / 非数字时为 0（对应 TS `data?.duration || 0`）。
fn num_field_display(data: &Value, key: &str) -> String {
    match data.get(key) {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => "0".to_owned(),
    }
}

/// 提取路径最后一段文件名（对应 `path.basename`，同时兼容 Windows 分隔符）。
fn base_name_of(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_owned()
}

/// 外链 URL 过滤：排除 file:// 协议和本地文件系统路径（对齐 TS 判断）。
fn is_acceptable_remote_url(url: &str) -> bool {
    if url.starts_with("file://") || url.starts_with("C:/") || url.starts_with("D:/") {
        return false;
    }
    // 等价于 TS 的 /^[A-Z]:\\/ 判断
    let bytes = url.as_bytes();
    !(bytes.len() >= 3 && bytes[0].is_ascii_uppercase() && bytes[1] == b':' && bytes[2] == b'\\')
}

fn render_text_element(data: &Value) -> String {
    let text = str_field(data, "text").unwrap_or_default();
    format!("<span class=\"text-content\">{}</span>", linkify_escaped(&text))
}

/// URL 中允许的字符（保守集合，遇到空白/中文/引号/尖括号等即截止）。
fn is_url_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c)
}

/// 转义文本并将其中的 http(s) 链接渲染为带样式的 <a> 标签。
fn linkify_escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut rest = text;
    loop {
        let found = rest.find("https://").map_or_else(
            || rest.find("http://").map(|i| (i, 7)),
            |i| match rest.find("http://") {
                Some(j) if j < i => Some((j, 7)),
                _ => Some((i, 8)),
            },
        );
        let Some((at, _scheme_len)) = found else {
            out.push_str(&escape_html(rest));
            return out;
        };
        out.push_str(&escape_html(&rest[..at]));
        let tail = &rest[at..];
        let mut end = tail.len();
        for (i, c) in tail.char_indices() {
            if !is_url_char(c) {
                end = i;
                break;
            }
        }
        // 去掉尾部常见句末标点，避免把句号/括号算进链接
        let mut url = &tail[..end];
        while let Some(last) = url.chars().last() {
            if matches!(last, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '\'') {
                url = &url[..url.len() - last.len_utf8()];
            } else {
                break;
            }
        }
        if url.len() <= 8 || !is_acceptable_remote_url(url) {
            out.push_str(&escape_html(&tail[..end.max(1).min(tail.len())]));
            rest = &tail[end.max(1).min(tail.len())..];
            continue;
        }
        let esc = escape_html(url);
        let _ = write!(
            out,
            "<a class=\"msg-link\" href=\"{esc}\" target=\"_blank\" rel=\"noopener noreferrer\">{esc}</a>"
        );
        rest = &tail[url.len()..];
    }
}

fn render_face_element(data: &Value) -> String {
    let id = str_field(data, "id")
        .or_else(|| str_field(data, "faceId"))
        .unwrap_or_default();
    let name = str_field(data, "name")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| get_face_name_by_id(&id));
    format!("<span class=\"face-emoji\">{}</span>", escape_html(&name))
}

fn render_market_face_element(data: &Value) -> String {
    let name = str_field(data, "name").unwrap_or_else(|| "商城表情".to_owned());
    let url = str_field(data, "url").unwrap_or_default();
    if !url.is_empty() {
        return format!(
            "<span class=\"sticker-wrap\"><img src=\"{url}\" alt=\"{n}\" class=\"sticker sticker-img market-face\" title=\"{n}\" loading=\"lazy\"></span>",
            n = escape_html(&name)
        );
    }
    format!("<span class=\"text-content\">[{}]</span>", escape_html(&name))
}

/// 人类可读文件大小（B/KB/MB/GB）。0 时返回空串。
fn format_file_size(bytes: u64) -> String {
    if bytes == 0 {
        return String::new();
    }
    let b = bytes as f64;
    if b < 1024.0 {
        format!("{bytes} B")
    } else if b < 1024.0 * 1024.0 {
        format!("{:.1} KB", b / 1024.0)
    } else if b < 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} MB", b / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", b / (1024.0 * 1024.0 * 1024.0))
    }
}

/// 按扩展名返回一个无色线性 SVG 图标（对齐 demo 的文件类型不同图标）。
fn file_icon_svg(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .map(str::to_lowercase)
        .unwrap_or_default();
    const ARCHIVE: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M12 3v18M9 6h1M9 9h1M9 12h1\"/></svg>";
    const SHEET: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18M3 15h18M9 3v18M15 3v18\"/></svg>";
    const CODE: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"16 18 22 12 16 6\"/><polyline points=\"8 6 2 12 8 18\"/></svg>";
    const DOC: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"8\" y1=\"13\" x2=\"16\" y2=\"13\"/><line x1=\"8\" y1=\"17\" x2=\"16\" y2=\"17\"/></svg>";
    const IMG: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/></svg>";
    const AUDIO: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 18V5l12-2v13\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><circle cx=\"18\" cy=\"16\" r=\"3\"/></svg>";
    const VIDEO: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m22 8-6 4 6 4V8Z\"/><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\"/></svg>";
    const GENERIC: &str = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/></svg>";
    match ext.as_str() {
        "zip" | "rar" | "7z" | "gz" | "tar" | "bz2" | "xz" => ARCHIVE,
        "xls" | "xlsx" | "csv" | "numbers" => SHEET,
        "js" | "ts" | "tsx" | "jsx" | "json" | "html" | "css" | "py" | "rs" | "go" | "java"
        | "c" | "cpp" | "h" | "sh" | "xml" | "yml" | "yaml" => CODE,
        "doc" | "docx" | "pdf" | "txt" | "md" | "ppt" | "pptx" | "rtf" => DOC,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "heic" => IMG,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "amr" | "m4a" => AUDIO,
        "mp4" | "mov" | "avi" | "mkv" | "flv" | "wmv" | "webm" => VIDEO,
        _ => GENERIC,
    }
}

fn render_json_element(data: &Value) -> String {
    let title = str_field(data, "title")
        .or_else(|| str_field(data, "summary"))
        .unwrap_or_else(|| "JSON消息".to_owned());
    let description = str_field(data, "description").unwrap_or_default();
    let url = str_field(data, "url").unwrap_or_default();
    let description_html = if description.is_empty() {
        String::new()
    } else {
        format!(
            "<div class=\"json-description\">{}</div>",
            escape_html(&description)
        )
    };
    let url_html = if url.is_empty() {
        String::new()
    } else {
        format!(
            "<a href=\"{url}\" target=\"_blank\" class=\"json-url\">{}</a>",
            escape_html(&url)
        )
    };
    format!(
        r#"<div class="json-card">
            <div class="json-title">{}</div>
            {description_html}
            {url_html}
        </div>"#,
        escape_html(&title)
    )
}

/// UTF-16 语义的字符串截断（对应 JS `String#slice(0, n)`）。
fn utf16_slice(s: &str, max: usize) -> (String, bool) {
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() <= max {
        (s.to_owned(), false)
    } else {
        (String::from_utf16_lossy(&units[..max]), true)
    }
}

/// 渲染合并转发卡片（对应 TS `renderForwardElement`，issue #161 / #434）。
fn render_forward_element(data: &Value, depth: usize) -> String {
    let title = str_field(data, "title").unwrap_or_else(|| "聊天记录".to_owned());
    let raw_summary = str_field(data, "summary")
        .or_else(|| str_field(data, "content"))
        .unwrap_or_default();
    // issue #128 子项 3：老数据里 summary 可能是 NapCat 推下来的 multiForwardMsg XML
    // 原文，不能直接当预览渲染。
    let summary_looks_like_xml = looks_like_xml(&raw_summary);
    let summary = if summary_looks_like_xml || raw_summary.is_empty() {
        "查看转发消息".to_owned()
    } else {
        raw_summary.clone()
    };
    let preview: Vec<Value> = data
        .get("preview")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // issue #161：解析器现在会把合并转发消息卡片里的真实子消息塞进 data.messages，
    // 优先用它渲染完整列表，老数据 / fallback 再退回 preview / summary。
    let inner_messages: Vec<Value> = data
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let message_count = data
        .get("messageCount")
        .and_then(Value::as_u64)
        .map_or(inner_messages.len(), |n| usize::try_from(n).unwrap_or(usize::MAX));
    // issue #434：子消息本身可能又是一条合并转发（嵌套[聊天记录]），递归展开成
    // 内层卡片。解析器侧 MAX_FORWARD_DEPTH=3，这里用同样的上限兜底异常数据。
    const MAX_RENDER_DEPTH: usize = 3;

    let mut preview_html = String::new();
    if inner_messages.is_empty() {
        if !preview.is_empty() {
            for line in preview.iter().take(5) {
                let text = match line {
                    Value::String(s) => s.clone(),
                    other => str_field(other, "text").unwrap_or_default(),
                };
                let (mut trimmed, truncated) = utf16_slice(&text, 80);
                if truncated {
                    trimmed.push('…');
                }
                preview_html.push_str(&format!(
                    "<div class=\"forward-card-line\"><span class=\"forward-card-body\">{}</span></div>",
                    escape_html(&trimmed)
                ));
            }
        } else if !summary_looks_like_xml && !summary.is_empty() {
            // 解析器没解析出预览行时，用 summary（"查看N条转发消息"）当占位文本。
            preview_html = format!(
                "<div class=\"forward-card-line\"><span class=\"forward-card-body\">{}</span></div>",
                escape_html(&summary)
            );
        }
    } else {
        for m in inner_messages.iter().take(5) {
            let sender = m.get("sender");
            let name_raw = sender
                .and_then(|s| s.get("name"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .or_else(|| {
                    sender
                        .and_then(|s| s.get("uin"))
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .filter(|s| !s.is_empty())
                })
                .unwrap_or_else(|| "未知".to_owned());
            let name = escape_html(&name_raw);
            let text_raw = m
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let text: String = normalize_whitespace(text_raw);
            let (mut trimmed, truncated) = utf16_slice(&text, 60);
            if truncated {
                trimmed.push('…');
            }
            let nested_html: String = if depth < MAX_RENDER_DEPTH {
                m.get("content")
                    .and_then(|c| c.get("elements"))
                    .and_then(Value::as_array)
                    .map(|els| {
                        els.iter()
                            .filter(|el| {
                                el.get("type").and_then(Value::as_str) == Some("forward")
                                    && el.get("data").is_some_and(|d| !d.is_null())
                            })
                            .map(|el| {
                                render_forward_element(
                                    el.get("data").unwrap_or(&Value::Null),
                                    depth + 1,
                                )
                            })
                            .collect::<String>()
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };
            // 子消息只是一条嵌套转发时，正文就是"[转发消息: N条]"这类占位，已由内层卡片表达，去掉避免重复。
            let body_text = if !nested_html.is_empty() && text.starts_with("[转发消息") {
                String::new()
            } else {
                trimmed
            };
            let body_html = if body_text.is_empty() {
                String::new()
            } else {
                format!(
                    "<span class=\"forward-card-body\">{}</span>",
                    escape_html(&body_text)
                )
            };
            preview_html.push_str(&format!(
                "<div class=\"forward-card-line\"><span class=\"forward-card-sender\">{name}:</span> {body_html}{nested_html}</div>"
            ));
        }
    }

    let footer_label = if message_count > 0 {
        format!("转发消息 · {message_count}条")
    } else {
        "转发消息".to_owned()
    };
    let nested_class = if depth > 0 { " forward-card-nested" } else { "" };
    let content_html = if preview_html.is_empty() {
        "点击查看转发的聊天记录"
    } else {
        preview_html.as_str()
    };

    format!(
        r#"<div class="forward-card{nested_class}">
            <div class="forward-card-header">
                <svg class="forward-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>{}</span>
            </div>
            <div class="forward-card-content">
                {content_html}
            </div>
            <div class="forward-card-footer">{}</div>
        </div>"#,
        escape_html(&title),
        escape_html(&footer_label)
    )
}

/// 判断 summary 是否像 XML 原文（对应 TS 的 startsWith('<') + 标签正则）。
fn looks_like_xml(s: &str) -> bool {
    let trimmed = s.trim();
    trimmed.starts_with('<')
        && s.contains('<')
        && s.split('<').skip(1).any(|part| {
            let part = part.strip_prefix('/').unwrap_or(part);
            part.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        })
}

/// 对应 TS `text.replace(/\s+/g, ' ').trim()`。
fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn render_system_element(data: &Value) -> String {
    let text = str_field(data, "text")
        .or_else(|| str_field(data, "content"))
        .unwrap_or_else(|| "系统消息".to_owned());
    if let Some(items) = data.get("items").and_then(Value::as_array).filter(|items| !items.is_empty())
    {
        let content = items
            .iter()
            .filter_map(|item| {
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                let item_text = item.get("text").and_then(Value::as_str).unwrap_or_default();
                let url = item.get("url").and_then(Value::as_str).unwrap_or_default();
                match item_type {
                    "img" => {
                        let src = item.get("src").and_then(Value::as_str).unwrap_or_default();
                        is_acceptable_remote_url(src).then(|| {
                            let image = format!(
                                r#"<img class="system-message-image" src="{}" alt="" loading="lazy">"#,
                                escape_html(src)
                            );
                            if is_acceptable_remote_url(url) {
                                format!(
                                    r#"<a class="system-message-link" href="{}" target="_blank" rel="noopener noreferrer">{image}</a>"#,
                                    escape_html(url)
                                )
                            } else {
                                image
                            }
                        })
                    }
                    "url" if is_acceptable_remote_url(url) && !item_text.is_empty() => Some(format!(
                        r#"<a class="system-message-link" href="{}" target="_blank" rel="noopener noreferrer">{}</a>"#,
                        escape_html(url),
                        escape_html(item_text)
                    )),
                    _ if !item_text.is_empty() => Some(escape_html(item_text)),
                    _ => None,
                }
            })
            .collect::<String>();
        if !content.is_empty() {
            return format!(r#"<div class="system-message">{content}</div>"#);
        }
    }
    format!("<div class=\"system-message\">{}</div>", escape_html(&text))
}

fn render_location_element(data: &Value) -> String {
    let name = str_field(data, "name").unwrap_or_else(|| "位置".to_owned());
    let address = str_field(data, "address").unwrap_or_default();
    let lat = str_field(data, "lat")
        .or_else(|| str_field(data, "latitude"))
        .unwrap_or_default();
    let lng = str_field(data, "lng")
        .or_else(|| str_field(data, "longitude"))
        .unwrap_or_default();

    let mut location_text = format!("📍 {}", escape_html(&name));
    if !address.is_empty() {
        location_text.push_str(&format!(" - {}", escape_html(&address)));
    }
    if !lat.is_empty() && !lng.is_empty() {
        location_text.push_str(&format!(" ({lat}, {lng})"));
    }
    format!("<span class=\"text-content\">{location_text}</span>")
}

/* ------------------------ Chunked：全文检索文本提取 ------------------------ */

/// 提取消息的纯文本用于索引/搜索（不影响原 HTML 渲染，对应 TS `extractPlainText`）。
/// 仅用于 Chunked 模式 message.text 与 Bloom 建索引。
#[allow(clippy::too_many_lines)]
fn extract_plain_text(message: &CleanMessage) -> String {
    let elements = &message.content.elements;
    if elements.is_empty() {
        return message.content.text.clone();
    }

    let mut parts: Vec<String> = Vec::new();
    for el in elements {
        let d = &el.data;
        match el.element_type.as_str() {
            "text" => {
                if let Some(text) = str_field(d, "text").filter(|s| !s.is_empty()) {
                    parts.push(text);
                }
            }
            "image" => {
                let filename = str_field(d, "filename").filter(|s| !s.is_empty());
                parts.push(match filename {
                    Some(f) => format!("[图片:{f}]"),
                    None => "[图片]".to_owned(),
                });
            }
            "audio" => {
                let duration = str_field(d, "duration").filter(|s| !s.is_empty() && s != "0");
                parts.push(match duration {
                    Some(dur) => format!("[语音:{dur}秒]"),
                    None => "[语音]".to_owned(),
                });
            }
            "video" => {
                let filename = str_field(d, "filename").filter(|s| !s.is_empty());
                parts.push(match filename {
                    Some(f) => format!("[视频:{f}]"),
                    None => "[视频]".to_owned(),
                });
            }
            "file" => {
                let filename = str_field(d, "filename").filter(|s| !s.is_empty());
                parts.push(match filename {
                    Some(f) => format!("[文件:{f}]"),
                    None => "[文件]".to_owned(),
                });
            }
            "face" => {
                let id = str_field(d, "id")
                    .or_else(|| str_field(d, "faceId"))
                    .unwrap_or_default();
                let name = str_field(d, "name")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| get_face_name_by_id(&id));
                if !name.is_empty() {
                    parts.push(name);
                }
            }
            "market_face" => {
                let name = str_field(d, "name")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "商城表情".to_owned());
                parts.push(format!("[{name}]"));
            }
            "reply" => {
                if let Some(content) = str_field(d, "content").filter(|s| !s.is_empty()) {
                    parts.push(content);
                } else if let Some(text) = str_field(d, "text").filter(|s| !s.is_empty()) {
                    parts.push(text);
                } else {
                    parts.push("[回复]".to_owned());
                }
            }
            "json" => {
                let title = str_field(d, "title")
                    .or_else(|| str_field(d, "summary"))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "JSON".to_owned());
                let description = str_field(d, "description").unwrap_or_default();
                let url = str_field(d, "url").unwrap_or_default();
                parts.push(format!("{title} {description} {url}").trim().to_owned());
            }
            "forward" => {
                // issue #161：搜索时把合并转发消息卡片里的子消息内容也带上，否则
                // 只能搜到外壳标题，搜不到真实文本。
                // issue #128 子项 3：summary 可能是 multiForwardMsg XML 原文（老数据），
                // 把它写进搜索索引里只会让索引被 `<msg>` / `<item>` 标签污染，跳掉。
                let fwd_summary = str_field(d, "summary").unwrap_or_default();
                let fwd_summary_clean = if looks_like_xml(&fwd_summary) {
                    String::new()
                } else {
                    fwd_summary
                };
                let title = str_field(d, "title")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "转发".to_owned());
                let tail = if fwd_summary_clean.is_empty() {
                    str_field(d, "content").unwrap_or_default()
                } else {
                    fwd_summary_clean
                };
                parts.push(format!("{title} {tail}").trim().to_owned());
                if let Some(preview) = d.get("preview").and_then(Value::as_array) {
                    for line in preview {
                        if let Some(s) = line.as_str() {
                            if !s.trim().is_empty() {
                                parts.push(s.to_owned());
                            }
                        }
                    }
                }
                if let Some(msgs) = d.get("messages").and_then(Value::as_array) {
                    for m in msgs {
                        let sender = m.get("sender");
                        let name = sender
                            .and_then(|s| s.get("name"))
                            .and_then(Value::as_str)
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned)
                            .or_else(|| {
                                sender.and_then(|s| s.get("uin")).map(|v| match v {
                                    Value::String(s) => s.clone(),
                                    other => other.to_string(),
                                })
                            })
                            .unwrap_or_default();
                        let text = m
                            .get("content")
                            .and_then(|c| c.get("text"))
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !name.is_empty() {
                            parts.push(name);
                        }
                        if !text.is_empty() {
                            parts.push(text.to_owned());
                        }
                    }
                }
            }
            "location" => {
                let name = str_field(d, "name")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "位置".to_owned());
                let address = str_field(d, "address").unwrap_or_default();
                parts.push(format!("{name} {address}").trim().to_owned());
            }
            "system" => {
                let text = str_field(d, "text")
                    .or_else(|| str_field(d, "content"))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "系统消息".to_owned());
                parts.push(text.trim().to_owned());
            }
            _ => {
                let raw_text = str_field(d, "text")
                    .or_else(|| str_field(d, "summary"))
                    .or_else(|| str_field(d, "content"))
                    .unwrap_or_default();
                if !raw_text.is_empty() {
                    parts.push(raw_text);
                }
            }
        }
    }
    parts.join(" ").trim().to_owned()
}

/// 把消息文本按 2/3-gram 加入 Bloom（对应 TS `addTextToBloom`，按 UTF-16 码元）。
fn add_text_to_bloom(bloom: &mut BloomFilter, text_lower_units: &[u16]) {
    if text_lower_units.is_empty() {
        return;
    }
    for n in [2usize, 3usize] {
        if text_lower_units.len() < n {
            continue;
        }
        for i in 0..=(text_lower_units.len() - n) {
            bloom.add_utf16(&text_lower_units[i..i + n]);
        }
    }
}

/* ------------------------ 基础工具 ------------------------ */

/// 是否为系统消息（对应 TS `isSystemMessage`）。
fn is_system_message(message: &CleanMessage) -> bool {
    message.message_type == "system"
        || message
            .content
            .elements
            .iter()
            .any(|el| el.element_type == "system")
}

/// 展示名称：remark > name > uin > uid > "未知用户"（对应 TS `getDisplayName`）。
fn get_display_name(message: &CleanMessage) -> String {
    let s = &message.sender;
    if let Some(remark) = s.remark.as_deref().filter(|v| !v.is_empty()) {
        return remark.to_owned();
    }
    if !s.name.is_empty() {
        return s.name.clone();
    }
    if let Some(uin) = s.uin.as_deref().filter(|v| !v.is_empty()) {
        return uin.to_owned();
    }
    if !s.uid.is_empty() {
        return s.uid.clone();
    }
    "未知用户".to_owned()
}

/// sender 的筛选 UID：uid || uin || ''（对应 TS chunked 侧取值）。
fn sender_uid_of(message: &CleanMessage) -> String {
    if !message.sender.uid.is_empty() {
        return message.sender.uid.clone();
    }
    message.sender.uin.clone().unwrap_or_default()
}

/// 消息时间戳（毫秒）：优先 `timestamp` 字段，缺省时解析 `time` 串。
/// 对应 TS `safeToDate(message?.timestamp || message?.time)`。
fn message_ts_ms(message: &CleanMessage) -> Option<i64> {
    if message.timestamp > 0 {
        // 秒级（10 位）时间戳换算为毫秒
        let ts = message.timestamp;
        return Some(if ts > 1_000_000_000 && ts < 10_000_000_000 {
            ts * 1000
        } else {
            ts
        });
    }
    parse_time_string(&message.time).map(|d| d.timestamp_millis())
}

/// 解析 `YYYY-MM-DD HH:mm:ss` 等常见时间串为本地时间。
fn parse_time_string(s: &str) -> Option<DateTime<Local>> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Local));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            if let Some(dt) = Local.from_local_datetime(&naive).single() {
                return Some(dt);
            }
        }
    }
    None
}

/// 本地日期（消息时间）。
fn message_local_date(message: &CleanMessage) -> Option<DateTime<Local>> {
    let ms = message_ts_ms(message)?;
    Local.timestamp_millis_opt(ms).single()
}

/// 日期 key `YYYY-MM-DD`（对应 TS `getMessageDateInfo().key`）。
fn message_date_key(message: &CleanMessage) -> Option<String> {
    let d = message_local_date(message)?;
    Some(format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day()))
}

/// 日期标签 `YYYY-MM-DD 周X`（对应 TS `formatDateLabel`）。
fn message_date_label(message: &CleanMessage) -> Option<String> {
    let d = message_local_date(message)?;
    let weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    let weekday = weekdays[d.weekday().num_days_from_sunday() as usize];
    Some(format!(
        "{:04}-{:02}-{:02} {weekday}",
        d.year(),
        d.month(),
        d.day()
    ))
}

/// 消息时间展示（对应 TS `formatTime` 的 `toLocaleString('zh-CN')` 全字段输出）。
fn format_time(time: &str) -> String {
    parse_time_string(time).map_or_else(String::new, locale_datetime_zh)
}

/// `Date#toLocaleString('zh-CN', 2-digit...)` 等价输出：`YYYY/MM/DD HH:mm:ss`。
fn locale_datetime_zh(d: DateTime<Local>) -> String {
    format!(
        "{:04}/{:02}/{:02} {:02}:{:02}:{:02}",
        d.year(),
        d.month(),
        d.day(),
        d.hour(),
        d.minute(),
        d.second()
    )
}

/// `Date#toLocaleDateString('zh-CN')` 等价输出：`YYYY/M/D`（不补零）。
fn locale_date_zh(ts_ms: i64) -> String {
    Local
        .timestamp_millis_opt(ts_ms)
        .single()
        .map_or_else(|| "--".to_owned(), |d| {
            format!("{}/{}/{}", d.year(), d.month(), d.day())
        })
}

/// 当前时间 ISO 8601（UTC，与 JS `Date#toISOString` 一致）。
fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// 毫秒时间戳 → ISO 8601。
fn iso_from_ms(ms: i64) -> Value {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map_or(Value::Null, |dt| {
            Value::String(dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        })
}

/// 头像 HTML（对应 TS `generateAvatarHtml`）。
fn generate_avatar_html(uin: Option<&str>, name: Option<&str>) -> String {
    match uin.filter(|u| !u.is_empty()) {
        Some(uin) => {
            let avatar_url = format!("http://q.qlogo.cn/g?b=qq&nk={uin}&s=100");
            let fallback_text = name
                .filter(|n| !n.is_empty())
                .map_or_else(
                    || {
                        let units: Vec<u16> = uin.encode_utf16().collect();
                        let start = units.len().saturating_sub(2);
                        String::from_utf16_lossy(&units[start..])
                    },
                    first_char_upper,
                );
            format!(
                "<img src=\"{avatar_url}\" alt=\"{}\" onerror=\"this.style.display='none'; this.nextSibling.style.display='inline-flex';\" />\n                    <span style=\"display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;\">{}</span>",
                escape_html(name.filter(|n| !n.is_empty()).unwrap_or(uin)),
                escape_html(&fallback_text)
            )
        }
        None => {
            let fallback_text = name
                .filter(|n| !n.is_empty())
                .map_or_else(|| "U".to_owned(), first_char_upper);
            format!(
                "<span style=\"display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;\">{}</span>",
                escape_html(&fallback_text)
            )
        }
    }
}

/// 取首字符并大写（对应 TS `name.charAt(0).toUpperCase()`）。
fn first_char_upper(name: &str) -> String {
    name.chars()
        .next()
        .map_or_else(String::new, |c| c.to_uppercase().collect())
}

/// 根据 QQ 表情 ID 获取友好名称（对应 TS `getFaceNameById`）。
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn get_face_name_by_id(id: &str) -> String {
    let name = match id {
        "0" => "/微笑",
        "1" => "/撇嘴",
        "2" => "/色",
        "3" => "/发呆",
        "4" => "/得意",
        "5" => "/流泪",
        "6" => "/害羞",
        "7" => "/闭嘴",
        "8" => "/睡",
        "9" => "/大哭",
        "10" => "/尴尬",
        "11" => "/发怒",
        "12" => "/调皮",
        "13" => "/呲牙",
        "14" => "/惊讶",
        "15" => "/难过",
        "16" => "/酷",
        "17" => "/冷汗",
        "18" => "/抓狂",
        "19" => "/吐",
        "20" => "/偷笑",
        "21" => "/可爱",
        "22" => "/白眼",
        "23" => "/傲慢",
        "24" => "/饥饿",
        "25" => "/困",
        "26" => "/惊恐",
        "27" => "/流汗",
        "28" => "/憨笑",
        "29" => "/大兵",
        "30" => "/奋斗",
        "31" => "/咒骂",
        "32" => "/疑问",
        "33" => "/嘘",
        "34" => "/晕",
        "35" => "/折磨",
        "36" => "/衰",
        "37" => "/骷髅",
        "38" => "/敲打",
        "39" => "/再见",
        "40" => "/擦汗",
        "41" => "/抠鼻",
        "42" => "/鼓掌",
        "43" => "/糗大了",
        "44" => "/坏笑",
        "45" => "/左哼哼",
        "46" => "/右哼哼",
        "47" => "/哈欠",
        "48" => "/鄙视",
        "49" => "/委屈",
        "50" => "/快哭了",
        "51" => "/阴险",
        "52" => "/亲亲",
        "53" => "/吓",
        "54" => "/可怜",
        "55" => "/菜刀",
        "56" => "/西瓜",
        "57" => "/啤酒",
        "58" => "/篮球",
        "59" => "/乒乓",
        "60" => "/咖啡",
        "61" => "/饭",
        "62" => "/猪头",
        "63" => "/玫瑰",
        "64" => "/凋谢",
        "65" => "/示爱",
        "66" => "/爱心",
        "67" => "/心碎",
        "68" => "/蛋糕",
        "69" => "/闪电",
        "70" => "/炸弹",
        "71" => "/刀",
        "72" => "/足球",
        "73" => "/瓢虫",
        "74" => "/便便",
        "75" => "/月亮",
        "76" => "/太阳",
        "77" => "/礼物",
        "78" => "/拥抱",
        "79" => "/强",
        "80" => "/弱",
        "81" => "/握手",
        "82" => "/胜利",
        "83" => "/抱拳",
        "84" => "/勾引",
        "85" => "/拳头",
        "86" => "/差劲",
        "87" => "/爱你",
        "88" => "/NO",
        "89" => "/OK",
        "96" => "/跳跳",
        "97" => "/发抖",
        "98" => "/怄火",
        "99" => "/转圈",
        "100" => "/磕头",
        "101" => "/回头",
        "102" => "/跳绳",
        "103" => "/挥手",
        "104" => "/激动",
        "105" => "/街舞",
        "106" => "/献吻",
        "107" => "/左太极",
        "108" => "/右太极",
        "109" => "/闭眼",
        "110" => "/流鼻涕",
        "111" => "/惊喜",
        "112" => "/骂人",
        "116" => "/爱情",
        "117" => "/飞吻",
        "118" => "/跳跳",
        "120" => "/颤抖",
        "121" => "/怄火",
        "122" => "/转圈",
        "123" => "/磕头",
        "124" => "/回头",
        "125" => "/跳绳",
        "126" => "/投降",
        "127" => "/激动",
        "128" => "/乱舞",
        "129" => "/献吻",
        "173" => "/嘿哈",
        "174" => "/捂脸",
        "175" => "/奸笑",
        "176" => "/机智",
        "177" => "/皱眉",
        "178" => "/耶",
        "179" => "/吃瓜",
        "180" => "/加油",
        "181" => "/汗",
        "182" => "/天啊",
        "183" => "/Emm",
        "184" => "/社会社会",
        "185" => "/旺柴",
        "186" => "/好的",
        "187" => "/打脸",
        "188" => "/哇",
        "189" => "/翻白眼",
        "190" => "/666",
        "191" => "/让我看看",
        "192" => "/叹气",
        "193" => "/苦涩",
        "194" => "/裂开",
        "195" => "/嘴唇",
        "196" => "/爱心",
        "197" => "/惊喜",
        "201" => "/生气",
        "202" => "/吃惊",
        "203" => "/酸了",
        "204" => "/太难了",
        "205" => "/我想开了",
        "206" => "/右上看",
        "207" => "/嘿嘿嘿",
        "208" => "/捂眼",
        "210" => "/敬礼",
        "211" => "/狗头",
        "212" => "/吐舌",
        "214" => "/哦",
        "215" => "/请",
        "216" => "/睁眼",
        "217" => "/敲开心",
        "218" => "/震惊",
        "219" => "/让我康康",
        "220" => "/摸鱼",
        "221" => "/魔鬼笑",
        "222" => "/哦哟",
        "223" => "/傻眼",
        "224" => "/抽烟",
        "225" => "/笑哭",
        "226" => "/汪汪",
        "227" => "/汗",
        "228" => "/打脸",
        "229" => "/无语",
        "230" => "/拥抱",
        "231" => "/摸头",
        "232" => "/加油",
        "233" => "/震惊哭",
        "234" => "/托腮",
        "235" => "/我酸了",
        "236" => "/快哭了",
        "237" => "/吃糖",
        "238" => "/生气",
        "260" => "/拜托",
        "261" => "/求你了",
        "262" => "/好的",
        "263" => "/我想开了",
        "264" => "/比心",
        "265" => "/啵啵",
        "266" => "/蹭蹭",
        "267" => "/拍手",
        "268" => "/佛系",
        "269" => "/喝奶茶",
        "270" => "/吃糖",
        "271" => "/Doge",
        "277" => "/吃",
        "278" => "/呆",
        "279" => "/仔细分析",
        "280" => "/加油",
        "281" => "/崇拜",
        "282" => "/比心",
        "283" => "/庆祝",
        "284" => "/生日快乐",
        "285" => "/舔屏",
        "286" => "/笑哭",
        "287" => "/doge",
        "288" => "/哈哈",
        "289" => "/酸了",
        "290" => "/汪汪",
        "291" => "/哦呼",
        "292" => "/喵喵",
        "293" => "/求抱抱",
        "294" => "/期待",
        "295" => "/拜托了",
        "296" => "/元气满满",
        "297" => "/满分",
        "298" => "/坏笑",
        "299" => "/你真棒",
        "300" => "/收到",
        "301" => "/拒绝",
        "302" => "/吃瓜",
        "303" => "/嗯哼",
        "304" => "/吃鲸",
        "305" => "/汗",
        "306" => "/无眼看",
        "307" => "/敬礼",
        "308" => "/面无表情",
        "309" => "/摊手",
        "310" => "/灵魂出窍",
        "311" => "/脑阔疼",
        "312" => "/沧桑",
        "313" => "/捂脸哭",
        "314" => "/笑cry",
        "315" => "/无语凝噎",
        "316" => "/@所有人",
        "317" => "/裂开",
        "318" => "/叹气",
        "319" => "/摸鱼",
        "320" => "/吃",
        "321" => "/呐",
        "322" => "/左看看",
        "323" => "/右看看",
        "324" => "/叹气",
        "325" => "/我想开了",
        "326" => "/无语",
        "327" => "/问号",
        "328" => "/怂",
        "329" => "/犬",
        "330" => "/坏笑",
        "331" => "/喝奶茶",
        "332" => "/吃瓜",
        "333" => "/鬼脸",
        "334" => "/震惊",
        "335" => "/嘿嘿",
        "336" => "/歪嘴",
        "337" => "/狂笑",
        "338" => "/嘻嘻",
        "339" => "/扶墙",
        "340" => "/捂脸",
        "341" => "/奋斗",
        "342" => "/白眼",
        _ => "",
    };
    if name.is_empty() {
        format!("/表情{id}")
    } else {
        name.to_owned()
    }
}
