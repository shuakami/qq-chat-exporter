use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

use async_trait::async_trait;
use serde_json::Value;

use qce_exporter::json_exporter::{JsonExporter, JsonFormatOptions};
use qce_exporter::modern_html_exporter::{HtmlExportOptions, ModernHtmlExporter};
use qce_exporter::stream_utils::{BufferedTextWriter, DEFAULT_FLUSH_THRESHOLD};
use qce_exporter::text_exporter::{TextExporter, TextFormatOptions};
use qce_exporter::types::MessageResource;
use qce_exporter::{ChatInfo, CleanMessage, ExportOptions};

use qce_server::api::helpers::{backfill_self_sender_names, chat_avatar_url};
use qce_server::api::path_security::resolve_for_creation_within;
use qce_server::export_debug::ExportDebugSession;
use qce_server::fetcher::{
    classify_chat_type_binary, BatchFetchConfig, BatchMessageFetcher, MessageFilter, Peer,
};
use qce_server::napcat::NapCatBridgeClient;
use qce_server::parser::{ForwardFetcher, SimpleMessageParser, SimpleParserOptions};
use qce_server::paths::PathManager;
use qce_server::resource::ResourceHandler;
use qce_server::scheduler::{ExecutionOutcome, ScheduledExportExecutor};
use qce_server::storage::ResourceInfo;

/// 基于 NapCat bridge 的定时导出执行器。
pub struct ApiScheduledExportExecutor {
    napcat: NapCatBridgeClient,
    resource_handler: Arc<ResourceHandler>,
    path_manager: Arc<PathManager>,
}

impl ApiScheduledExportExecutor {
    /// 创建执行器。
    pub fn new(
        napcat: NapCatBridgeClient,
        resource_handler: Arc<ResourceHandler>,
        path_manager: Arc<PathManager>,
    ) -> Self {
        Self {
            napcat,
            resource_handler,
            path_manager,
        }
    }
}

#[async_trait]
impl ScheduledExportExecutor for ApiScheduledExportExecutor {
    async fn execute(
        &self,
        task: &Value,
        start_time_sec: i64,
        end_time_sec: i64,
    ) -> Result<ExecutionOutcome, String> {
        let peer_value = task.get("peer").ok_or("任务缺少 peer 配置")?;
        let chat_type = loose_i64(peer_value.get("chatType")).ok_or("peer.chatType 无效")?;
        let peer_uid = peer_value
            .get("peerUid")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("peer.peerUid 无效")?
            .to_string();
        let peer_uin = peer_value
            .get("peerUin")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let task_name = task
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("scheduled_export")
            .to_string();
        let session_name = task
            .get("sessionName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&task_name)
            .to_string();
        let format = task
            .get("format")
            .and_then(Value::as_str)
            .unwrap_or("HTML")
            .to_uppercase();
        let options = task.get("options").cloned().unwrap_or(Value::Null);
        let requested_output_dir = task
            .get("outputDir")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map_or_else(|| self.path_manager.scheduled_exports_dir(), PathBuf::from);
        let output_roots = [
            self.path_manager.exports_dir(),
            self.path_manager.scheduled_exports_dir(),
        ];
        let output_dir = resolve_for_creation_within(&requested_output_dir, &output_roots)
            .ok_or_else(|| "定时导出目录不在允许的导出目录内".to_string())?;
        let debug_session = if options.get("debugExport").and_then(Value::as_bool) == Some(true) {
            let export_name = format!(
                "scheduled-{}-{}",
                sanitize_task_name(&task_name, 40),
                chrono::Local::now().format("%Y%m%d_%H%M%S%3f")
            );
            let session = ExportDebugSession::start(&output_dir, &export_name).await?;
            session
                .trace()
                .record(serde_json::json!({
                    "type": "scheduled_export_started",
                    "format": format,
                }))
                .await;
            Some(session)
        } else {
            None
        };

        // 阶段 1：抓取消息
        let fetcher = BatchMessageFetcher::new(
            Arc::new(self.napcat.clone()),
            BatchFetchConfig {
                batch_size: 1000,
                timeout_ms: 30_000,
                retry_count: 3,
                ..BatchFetchConfig::default()
            },
        );
        let peer = Peer {
            chat_type,
            peer_uid: peer_uid.clone(),
            guild_id: None,
        };
        let fetch_filter = MessageFilter {
            start_time: Some(start_time_sec * 1000),
            end_time: Some(end_time_sec * 1000),
            ..MessageFilter::default()
        };

        let mut all_messages: Vec<Value> = Vec::new();
        let mut previous = None;
        loop {
            let batch = match fetcher
                .fetch_next_batch(&peer, &fetch_filter, previous.as_ref())
                .await
            {
                Ok(Some(batch)) => batch,
                Ok(None) => break,
                Err(error) => return Err(format!("获取消息失败: {error}")),
            };
            all_messages.extend(batch.messages.iter().cloned());
            previous = Some(batch);
        }

        if all_messages.is_empty() {
            return Ok(ExecutionOutcome {
                message_count: 0,
                note: Some("指定时间范围内没有消息".to_string()),
                ..ExecutionOutcome::default()
            });
        }

        // 按时间升序排序（抓取返回的是倒序）。
        all_messages.sort_by_key(msg_time_ms);
        if let Some(debug) = &debug_session {
            debug
                .write_jsonl("01-raw-messages.jsonl", &all_messages)
                .await?;
        }

        // 阶段 2：资源下载（issue #341 跳过类型）
        let requested_skip_types: Vec<String> = options
            .get("skipDownloadResourceTypes")
            .and_then(Value::as_array)
            .map_or_else(
                || {
                    if options.get("skipFileDownload").and_then(Value::as_bool) == Some(true) {
                        vec!["file".to_string()]
                    } else {
                        Vec::new()
                    }
                },
                |arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_lowercase)
                        .collect()
                },
            );
        let normalized_skip_types: Vec<String> = requested_skip_types
            .into_iter()
            .filter(|t| matches!(t.as_str(), "image" | "video" | "audio" | "file"))
            .collect();
        if normalized_skip_types.is_empty() {
            self.resource_handler.set_skip_download_types(None).await;
        } else {
            self.resource_handler
                .set_skip_download_types(Some(&normalized_skip_types))
                .await;
        }

        let resource_map = self
            .resource_handler
            .process_message_resources_with_cancel_and_trace(
                &all_messages,
                Arc::new(AtomicBool::new(false)),
                debug_session.as_ref().map(ExportDebugSession::trace),
            )
            .await;
        // issue #363：资源下载摘要。
        let resource_summary =
            serde_json::to_value(self.resource_handler.last_batch_summary().await).ok();
        // 重置共享 ResourceHandler 的状态，避免影响后续任务。
        self.resource_handler.set_skip_download_types(None).await;

        // 阶段 3：文件名 / 输出目录
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| format!("创建输出目录失败: {e}"))?;
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S%3f");
        let chat_type_name = if chat_type == 2 { "group" } else { "friend" };
        let peer_identity = if chat_type == 2 {
            peer_uid.as_str()
        } else {
            peer_uin.as_deref().unwrap_or(&peer_uid)
        };
        let base_file_name = scheduled_export_file_name(
            chat_type_name,
            &session_name,
            peer_identity,
            &timestamp.to_string(),
            &format.to_lowercase(),
        );
        let (file_name, _reservation) = reserve_scheduled_file_name(&output_dir, &base_file_name);
        let file_path = output_dir.join(&file_name);

        // 阶段 4：流式解析 + 导出（分批解析避免全量消息同时驻留在内存）
        let mut parser = SimpleMessageParser::new(SimpleParserOptions {
            html_enabled: format == "HTML",
            prefer_group_member_name: options
                .get("preferGroupMemberName")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            sender_title_resolver: None,
            forward_fetcher: Some(Arc::new(self.napcat.clone()) as Arc<dyn ForwardFetcher>),
        });

        // 用 NDJSON 中间文件，分批解析消息后立即落盘释放内存
        let ndjson_tmp = output_dir.join(format!(
            ".qce_scheduled_ndjson_{}.tmp",
            chrono::Local::now().format("%Y%m%d_%H%M%S%3f")
        ));
        let mut ndjson_writer =
            BufferedTextWriter::create(&ndjson_tmp, DEFAULT_FLUSH_THRESHOLD)
                .await
                .map_err(|e| format!("创建 NDJSON 临时文件失败: {e}"))?;

        let mut stats_acc = qce_exporter::stats::StatsAccumulator::new();
        let mut resource_count = 0usize;
        let value_resource_map = to_value_resource_map(&resource_map);

        // issue #277：把已下载资源的本地路径写回消息。
        const PARSE_BATCH_SIZE: usize = 5000;
        for chunk in all_messages.chunks(PARSE_BATCH_SIZE) {
            let mut clean_batch = parser.parse_messages(chunk).await;
            for message in &mut clean_batch {
                stats_acc.consume(message);
                resource_count += message.content.resources.len();
                if let Some(resources) = value_resource_map.get(&message.id) {
                    SimpleMessageParser::update_single_message_resource_paths(
                        message, resources,
                    );
                }
                ndjson_writer
                    .write(
                        &serde_json::to_string(message)
                            .map_err(|e| format!("序列化消息失败: {e}"))?,
                    )
                    .await
                    .map_err(|e| format!("写入 NDJSON 失败: {e}"))?;
                ndjson_writer
                    .write("\n")
                    .await
                    .map_err(|e| format!("写入 NDJSON 失败: {e}"))?;
            }
        }
        // 解析完成后立即释放原始消息内存
        drop(all_messages);

        ndjson_writer
            .end()
            .await
            .map_err(|e| format!("关闭 NDJSON 文件失败: {e}"))?;

        let final_stats = stats_acc.finalize();

        let self_info = self.napcat.self_info().await.unwrap_or(Value::Null);
        let self_uid = self_info
            .get("uid")
            .and_then(Value::as_str)
            .map(str::to_string);
        let self_uin = self_info
            .get("uin")
            .and_then(Value::as_str)
            .map(str::to_string);
        let self_name = self_info
            .get("nick")
            .and_then(Value::as_str)
            .map(str::to_string);

        // 回填引用预览 + backfill self sender names（一次遍历，避免反复读写 NDJSON）
        {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let read_file = tokio::fs::File::open(&ndjson_tmp)
                .await
                .map_err(|e| format!("读取 NDJSON 文件失败: {e}"))?;
            let mut lines = BufReader::new(read_file).lines();
            let mut backfill_messages: Vec<CleanMessage> = Vec::new();
            while let Some(line) = lines
                .next_line()
                .await
                .map_err(|e| format!("读取 NDJSON 行失败: {e}"))?
            {
                if line.trim().is_empty() {
                    continue;
                }
                let msg: CleanMessage =
                    serde_json::from_str(&line).map_err(|e| format!("解析 NDJSON 行失败: {e}"))?;
                backfill_messages.push(msg);
            }
            SimpleMessageParser::backfill_reply_preview_local_paths(&mut backfill_messages);
            backfill_self_sender_names(
                &mut backfill_messages,
                self_uid.as_deref(),
                self_uin.as_deref(),
                self_name.as_deref(),
            );
            // 回写 NDJSON
            drop(lines);
            let mut writer =
                BufferedTextWriter::create(&ndjson_tmp, DEFAULT_FLUSH_THRESHOLD)
                    .await
                    .map_err(|e| format!("重新创建 NDJSON 文件失败: {e}"))?;
            for msg in &backfill_messages {
                writer
                    .write(&serde_json::to_string(msg).map_err(|e| format!("序列化失败: {e}"))?)
                    .await
                    .map_err(|e| format!("写入 NDJSON 失败: {e}"))?;
                writer
                    .write("\n")
                    .await
                    .map_err(|e| format!("写入 NDJSON 失败: {e}"))?;
            }
            writer
                .end()
                .await
                .map_err(|e| format!("关闭 NDJSON 文件失败: {e}"))?;
        }

        if let Some(debug) = &debug_session {
            // 读取 NDJSON 写调试文件（debug 用，不优化）
            let content = tokio::fs::read_to_string(&ndjson_tmp)
                .await
                .unwrap_or_default();
            let parsed: Vec<CleanMessage> = content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect();
            debug
                .write_jsonl("02-parsed-messages.jsonl", &parsed)
                .await?;
        }

        let message_count = final_stats.total_messages as i64;

        let peer_uin = (chat_type != 2)
            .then(|| {
                peer_uin.clone().or_else(|| {
                    // resolve_peer_uin 需要 CleanMessage 切片，从 NDJSON 读少量即可
                    None
                })
            })
            .flatten();
        let normalized_chat_type = classify_chat_type_binary(Some(chat_type)).to_string();
        let chat_info = ChatInfo {
            name: session_name,
            chat_type: normalized_chat_type.clone(),
            avatar: chat_avatar_url(&normalized_chat_type, &peer_uid, peer_uin.as_deref()),
            participant_count: None,
            self_uid,
            self_uin,
            self_name,
            peer_uid: Some(peer_uid.clone()),
            peer_uin,
        };

        let include_resource_links = options
            .get("includeResourceLinks")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let include_system_messages = options
            .get("includeSystemMessages")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let export_options = ExportOptions {
            output_path: file_path.clone(),
            include_resource_links,
            include_system_messages,
            filter_pure_image_messages: options
                .get("filterPureImageMessages")
                .and_then(Value::as_bool)
                == Some(true),
            pretty_format: options
                .get("prettyFormat")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            prefer_group_member_name: options
                .get("preferGroupMemberName")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            resource_map: to_exporter_resource_map(&resource_map),
            ..ExportOptions::default()
        };

        match format.as_str() {
            "JSON" => {
                let exporter =
                    JsonExporter::new(export_options, JsonFormatOptions::default());
                exporter
                    .synthesize_from_ndjson(
                        &ndjson_tmp,
                        &chat_info,
                        &final_stats,
                        resource_count,
                        message_count as usize,
                        None, // avatar_map
                        std::time::Instant::now(),
                    )
                    .await
                    .map_err(|e| format!("JSON 流式合成失败: {e}"))?;
            }
            "HTML" => {
                // HTML 导出需要全量 CleanMessage，从 NDJSON 读入（唯一的大内存块）
                let all_clean: Vec<CleanMessage> = {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let read_file = tokio::fs::File::open(&ndjson_tmp)
                        .await
                        .map_err(|e| format!("读取 NDJSON 失败: {e}"))?;
                    let mut lines = BufReader::new(read_file).lines();
                    let mut msgs = Vec::with_capacity(message_count as usize);
                    while let Some(line) =
                        lines.next_line().await.map_err(|e| format!("读取失败: {e}"))?
                    {
                        if line.trim().is_empty() {
                            continue;
                        }
                        msgs.push(
                            serde_json::from_str(&line)
                                .map_err(|e| format!("解析失败: {e}"))?,
                        );
                    }
                    msgs
                };
                let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
                    output_path: file_path.clone(),
                    include_resource_links,
                    include_system_messages,
                    embed_resources_as_data_uri: options
                        .get("embedResourcesAsDataUri")
                        .and_then(Value::as_bool)
                        == Some(true),
                    max_embed_file_size_bytes: loose_i64(options.get("maxEmbedFileSizeBytes"))
                        .and_then(|v| u64::try_from(v).ok())
                        .unwrap_or(50 * 1024 * 1024),
                    show_search_bar: options.get("showSearchBar").and_then(Value::as_bool)
                        != Some(false),
                    enable_virtual_scroll: options
                        .get("enableVirtualScroll")
                        .and_then(Value::as_bool)
                        != Some(false),
                    exporter_version: Some(qce_server::version::VERSION.get().to_string()),
                });
                exporter
                    .export_single_inline(&all_clean, &chat_info)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "TXT" => {
                let all_clean: Vec<CleanMessage> = {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let read_file = tokio::fs::File::open(&ndjson_tmp)
                        .await
                        .map_err(|e| format!("读取 NDJSON 失败: {e}"))?;
                    let mut lines = BufReader::new(read_file).lines();
                    let mut msgs = Vec::with_capacity(message_count as usize);
                    while let Some(line) =
                        lines.next_line().await.map_err(|e| format!("读取失败: {e}"))?
                    {
                        if line.trim().is_empty() {
                            continue;
                        }
                        msgs.push(
                            serde_json::from_str(&line)
                                .map_err(|e| format!("解析失败: {e}"))?,
                        );
                    }
                    msgs
                };
                let exporter =
                    TextExporter::new(export_options, TextFormatOptions::default());
                exporter
                    .export(all_clean, &chat_info)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            other => return Err(format!("不支持的定时导出格式: {other}")),
        }

        // 清理 NDJSON 临时文件
        let _ = tokio::fs::remove_file(&ndjson_tmp).await;

        let file_size = tokio::fs::metadata(&file_path)
            .await
            .ok()
            .and_then(|meta| i64::try_from(meta.len()).ok());
        if let Some(debug) = debug_session {
            debug
                .write_json(
                    "summary.json",
                    &serde_json::json!({
                        "format": format,
                        "messageCount": message_count,
                        "resourceSummary": resource_summary,
                        "finalFileName": file_name,
                        "finalFileSize": file_size,
                    }),
                )
                .await?;
            debug.finish().await?;
        }

        Ok(ExecutionOutcome {
            message_count,
            file_path: Some(file_path.to_string_lossy().into_owned()),
            file_size,
            resource_summary,
            note: None,
        })
    }
}

fn sanitize_task_name(name: &str, max_length: usize) -> String {
    let mut safe = String::new();
    let mut last_underscore = false;
    for ch in name.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            value if (value as u32) < 0x20 || value == '\u{7f}' => '_',
            value if value.is_whitespace() => '_',
            value => value,
        };
        if mapped == '_' {
            if !last_underscore {
                safe.push(mapped);
            }
            last_underscore = true;
        } else {
            safe.push(mapped);
            last_underscore = false;
        }
        if safe.chars().count() >= max_length {
            break;
        }
    }
    let mut safe = safe.trim_matches([' ', '.', '_']).to_string();
    if safe.is_empty() {
        safe = "unknown".to_string();
    }
    let device_name = safe
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device_name.strip_prefix("COM").is_some_and(|value| {
            matches!(value, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || device_name.strip_prefix("LPT").is_some_and(|value| {
            matches!(value, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
    {
        safe.insert(0, '_');
    }
    safe
}

fn scheduled_export_file_name(
    chat_type: &str,
    session_name: &str,
    peer_identity: &str,
    timestamp: &str,
    extension: &str,
) -> String {
    format!(
        "{chat_type}_{}_{}_{timestamp}.{extension}",
        sanitize_task_name(session_name, 40),
        sanitize_task_name(peer_identity, 32),
    )
}

fn collision_name(file_name: &str, suffix: u32) -> String {
    let (base, extension) = file_name
        .rsplit_once('.')
        .map_or((file_name, String::new()), |(base, extension)| {
            (base, format!(".{extension}"))
        });
    format!("{base}_{suffix}{extension}")
}

fn reserved_scheduled_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static RESERVED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    RESERVED.get_or_init(|| Mutex::new(HashSet::new()))
}

struct ScheduledPathReservation(PathBuf);

impl Drop for ScheduledPathReservation {
    fn drop(&mut self) {
        reserved_scheduled_paths()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.0);
    }
}

fn reserve_scheduled_file_name(
    output_dir: &std::path::Path,
    file_name: &str,
) -> (String, ScheduledPathReservation) {
    let mut reserved = reserved_scheduled_paths()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for suffix in 1_u32.. {
        let candidate = if suffix == 1 {
            file_name.to_string()
        } else {
            collision_name(file_name, suffix)
        };
        let path = output_dir.join(&candidate);
        if !path.exists() && !reserved.contains(&path) {
            reserved.insert(path.clone());
            return (candidate, ScheduledPathReservation(path));
        }
    }
    unreachable!("u32 filename suffix space exhausted")
}

/// 从 JSON 里宽松取 i64（数字或数字字符串）。
fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// 消息 msgTime → 毫秒（10 位秒级自动 ×1000）。
fn msg_time_ms(message: &Value) -> i64 {
    let ts = loose_i64(message.get("msgTime")).unwrap_or(0);
    if ts > 1_000_000_000 && ts < 10_000_000_000 {
        ts * 1000
    } else {
        ts
    }
}

/// 资源映射 → 导出器需要的 `MessageResource` 形式。
fn to_exporter_resource_map(
    resource_map: &HashMap<String, Vec<ResourceInfo>>,
) -> HashMap<String, Vec<MessageResource>> {
    resource_map
        .iter()
        .map(|(msg_id, resources)| {
            let converted = resources
                .iter()
                .map(|r| MessageResource {
                    resource_type: r.resource_type.clone(),
                    filename: r.file_name.clone(),
                    size: r.file_size.and_then(|s| u64::try_from(s).ok()),
                    url: if r.original_url.is_empty() {
                        None
                    } else {
                        Some(r.original_url.clone())
                    },
                    local_path: r.local_path.clone(),
                    width: None,
                    height: None,
                    duration: None,
                })
                .collect();
            (msg_id.clone(), converted)
        })
        .collect()
}

/// 资源映射 → `update_single_message_resource_paths` 需要的 Value 列表。
fn to_value_resource_map(
    resource_map: &HashMap<String, Vec<ResourceInfo>>,
) -> HashMap<String, Vec<Value>> {
    resource_map
        .iter()
        .map(|(msg_id, resources)| {
            let values = resources
                .iter()
                .filter_map(|r| serde_json::to_value(r).ok())
                .collect();
            (msg_id.clone(), values)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{reserve_scheduled_file_name, sanitize_task_name, scheduled_export_file_name};

    #[test]
    fn scheduled_names_are_readable_safe_and_reserved_concurrently() {
        assert_eq!(sanitize_task_name("CON.", 40), "_CON");
        let file_name = scheduled_export_file_name(
            "friend",
            "笨蛋 Darf/v2",
            "1687657986",
            "20260713_002703456",
            "html",
        );
        assert_eq!(
            file_name,
            "friend_笨蛋_Darf_v2_1687657986_20260713_002703456.html"
        );

        let base = std::env::temp_dir().join(format!(
            "qce-scheduled-export-name-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let (first, _first_reservation) = reserve_scheduled_file_name(&base, &file_name);
        let (second, _second_reservation) = reserve_scheduled_file_name(&base, &file_name);
        assert_eq!(first, file_name);
        assert_eq!(
            second,
            "friend_笨蛋_Darf_v2_1687657986_20260713_002703456_2.html"
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
