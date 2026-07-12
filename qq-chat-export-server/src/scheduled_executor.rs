use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use qce_exporter::json_exporter::{JsonExporter, JsonFormatOptions};
use qce_exporter::modern_html_exporter::{HtmlExportOptions, ModernHtmlExporter};
use qce_exporter::text_exporter::{TextExporter, TextFormatOptions};
use qce_exporter::types::MessageResource;
use qce_exporter::{ChatInfo, CleanMessage, ExportOptions};

use qce_server::api::helpers::{chat_avatar_url, resolve_peer_uin};
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
        let task_name = task
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("scheduled_export")
            .to_string();
        let format = task
            .get("format")
            .and_then(Value::as_str)
            .unwrap_or("HTML")
            .to_uppercase();
        let options = task.get("options").cloned().unwrap_or(Value::Null);

        // ============ 阶段 1：抓取消息 ============
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
            let batch = match fetcher.fetch_next_batch(&peer, &fetch_filter, previous.as_ref()).await
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

        // ============ 阶段 2：资源下载（issue #341 跳过类型） ============
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
            .process_message_resources(&all_messages)
            .await;
        // issue #363：资源下载摘要。
        let resource_summary =
            serde_json::to_value(self.resource_handler.last_batch_summary().await).ok();
        // 重置共享 ResourceHandler 的状态，避免影响后续任务。
        self.resource_handler.set_skip_download_types(None).await;

        // ============ 阶段 3：文件名 / 输出目录 ============
        let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
        let session_name = sanitize_task_name(&task_name);
        let file_name = format!("{session_name}_{timestamp}.{}", format.to_lowercase());

        let output_dir = task
            .get("outputDir")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map_or_else(|| self.path_manager.scheduled_exports_dir(), PathBuf::from);
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| format!("创建输出目录失败: {e}"))?;
        let file_path = output_dir.join(&file_name);

        // ============ 阶段 4：解析 + 导出 ============
        let mut parser = SimpleMessageParser::new(SimpleParserOptions {
            html_enabled: format == "HTML",
            prefer_group_member_name: options
                .get("preferGroupMemberName")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            sender_title_resolver: None,
            forward_fetcher: Some(Arc::new(self.napcat.clone()) as Arc<dyn ForwardFetcher>),
        });
        let mut clean_messages: Vec<CleanMessage> = parser.parse_messages(&all_messages).await;

        // issue #277：把已下载资源的本地路径写回消息。
        let value_resource_map = to_value_resource_map(&resource_map);
        for message in &mut clean_messages {
            if let Some(resources) = value_resource_map.get(&message.id) {
                SimpleMessageParser::update_single_message_resource_paths(message, resources);
            }
        }
        SimpleMessageParser::backfill_reply_preview_local_paths(&mut clean_messages);

        let message_count = clean_messages.len() as i64;
        let self_info = self.napcat.self_info().await.unwrap_or(Value::Null);
        let self_uid = self_info.get("uid").and_then(Value::as_str).map(str::to_string);
        let self_uin = self_info.get("uin").and_then(Value::as_str).map(str::to_string);
        let peer_uin = (chat_type != 2)
            .then(|| resolve_peer_uin(&peer_uid, self_uin.as_deref(), &clean_messages))
            .flatten();
        let normalized_chat_type = classify_chat_type_binary(Some(chat_type)).to_string();
        let chat_info = ChatInfo {
            name: task_name.clone(),
            chat_type: normalized_chat_type.clone(),
            avatar: chat_avatar_url(&normalized_chat_type, &peer_uid, peer_uin.as_deref()),
            participant_count: None,
            self_uid,
            self_uin,
            self_name: self_info.get("nick").and_then(Value::as_str).map(str::to_string),
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
            "HTML" => {
                let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
                    output_path: file_path.clone(),
                    include_resource_links,
                    include_system_messages,
                    // Issue #311：自包含 HTML（资源以 base64 内联）。
                    embed_resources_as_data_uri: options
                        .get("embedResourcesAsDataUri")
                        .and_then(Value::as_bool)
                        == Some(true),
                    max_embed_file_size_bytes: loose_i64(options.get("maxEmbedFileSizeBytes"))
                        .and_then(|v| u64::try_from(v).ok())
                        .unwrap_or(50 * 1024 * 1024),
                    // Issue #467：打印 / PDF 友好开关，默认开启。
                    show_search_bar: options.get("showSearchBar").and_then(Value::as_bool)
                        != Some(false),
                    enable_virtual_scroll: options
                        .get("enableVirtualScroll")
                        .and_then(Value::as_bool)
                        != Some(false),
                    exporter_version: Some(qce_server::version::VERSION.get().to_string()),
                });
                exporter
                    .export_single_inline(&clean_messages, &chat_info)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "JSON" => {
                let exporter = JsonExporter::new(export_options, JsonFormatOptions::default());
                exporter
                    .export(clean_messages, &chat_info)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "TXT" => {
                let exporter = TextExporter::new(export_options, TextFormatOptions::default());
                exporter
                    .export(clean_messages, &chat_info)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            other => return Err(format!("不支持的定时导出格式: {other}")),
        }

        let file_size = tokio::fs::metadata(&file_path)
            .await
            .ok()
            .and_then(|meta| i64::try_from(meta.len()).ok());

        Ok(ExecutionOutcome {
            message_count,
            file_path: Some(file_path.to_string_lossy().into_owned()),
            file_size,
            resource_summary,
            note: None,
        })
    }
}

/// 任务名 → 文件名片段（对应 TS `task.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')`）。
fn sanitize_task_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ('\u{4e00}'..='\u{9fa5}').contains(&c) {
                c
            } else {
                '_'
            }
        })
        .collect()
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
