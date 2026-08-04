use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Extension, Json, State};
use axum::response::Response;
use chrono::Utc;
use md5::{Digest, Md5};
use qce_exporter::{ChatInfo, CleanMessage};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncWriteExt, BufWriter};

use crate::api::helpers::{
    backfill_self_sender_names, chat_avatar_url, resolve_peer_uid, resolve_session_name,
};
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::fetcher::{
    classify_chat_type_binary, repair_group_message_sequence, BatchFetchConfig,
    BatchMessageFetcher, MessageFilter, Peer, SequenceRepairConfig, GROUP_CHAT_TYPE,
};
use crate::parser::{ForwardFetcher, SimpleMessageParser, SimpleParserOptions};
use crate::paths::PathManager;
use crate::resource::ResourceBatchSummary;
use crate::streaming_spool::{read_jsonl, StreamingMessageSpool};

const MAX_ACTIVE_EXPORT_TASKS: usize = 32;
const STREAM_BATCH_SIZE: i64 = 1_000;
const FETCH_TIMEOUT_MS: u64 = 60_000;
const HEARTBEAT_SECONDS: u64 = 10;
const MAX_EMPTY_BATCHES_WITH_MORE: u32 = 3;
const CHUNK_MESSAGES: usize = 1_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StreamingOutput {
    HtmlZip,
    Jsonl,
}

struct StreamingRequest {
    chat_type: i64,
    peer_uid: String,
    peer_identity: String,
    peer_uin: Option<String>,
    session_name: String,
    filter: Value,
    options: Value,
    output_dir: PathBuf,
    custom_output_dir: String,
}

#[derive(Default)]
struct GroupMemberMaps {
    cards: HashMap<String, String>,
    titles: HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkMeta {
    id: String,
    file: String,
    count: usize,
    start_time: i64,
    end_time: i64,
}

struct DiskOutputWriter {
    mode: StreamingOutput,
    final_path: PathBuf,
    work_dir: PathBuf,
    chunks_dir: PathBuf,
    resources_dir: PathBuf,
    chunks: Vec<ChunkMeta>,
    total_messages: usize,
    first_time: Option<i64>,
    last_time: Option<i64>,
    include_system_messages: bool,
}

impl DiskOutputWriter {
    async fn create(
        output_dir: &Path,
        file_name: &str,
        mode: StreamingOutput,
        task_id: &str,
        include_system_messages: bool,
    ) -> Result<Self, String> {
        let final_path = output_dir.join(file_name);
        let work_dir = match mode {
            StreamingOutput::HtmlZip => output_dir.join(format!(".{file_name}.partial-{task_id}")),
            StreamingOutput::Jsonl => final_path.clone(),
        };
        if tokio::fs::try_exists(&work_dir).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(&work_dir)
                .await
                .map_err(|error| format!("清理旧流式输出失败: {error}"))?;
        }
        let chunks_dir = match mode {
            StreamingOutput::HtmlZip => work_dir.join("data/chunks"),
            StreamingOutput::Jsonl => work_dir.join("chunks"),
        };
        let resources_dir = work_dir.join("resources");
        tokio::fs::create_dir_all(&chunks_dir)
            .await
            .map_err(|error| format!("创建流式分块目录失败: {error}"))?;
        tokio::fs::create_dir_all(&resources_dir)
            .await
            .map_err(|error| format!("创建资源目录失败: {error}"))?;
        Ok(Self {
            mode,
            final_path,
            work_dir,
            chunks_dir,
            resources_dir,
            chunks: Vec::new(),
            total_messages: 0,
            first_time: None,
            last_time: None,
            include_system_messages,
        })
    }

    async fn write_messages(&mut self, messages: Vec<CleanMessage>) -> Result<(), String> {
        let mut filtered: Vec<CleanMessage> = messages
            .into_iter()
            .filter(|message| self.include_system_messages || !message.system)
            .collect();
        if filtered.is_empty() {
            return Ok(());
        }
        filtered.sort_by_key(|message| message.timestamp);

        for group in filtered.chunks_mut(CHUNK_MESSAGES) {
            self.rewrite_and_copy_resources(group).await?;
            let index = self.chunks.len() + 1;
            let id = format!("chunk-{index:06}");
            let start_time = group.first().map_or(0, |message| message.timestamp);
            let end_time = group.last().map_or(0, |message| message.timestamp);
            self.first_time = Some(self.first_time.map_or(start_time, |value| value.min(start_time)));
            self.last_time = Some(self.last_time.map_or(end_time, |value| value.max(end_time)));

            let file_name = match self.mode {
                StreamingOutput::HtmlZip => format!("{id}.js"),
                StreamingOutput::Jsonl => format!("{id}.jsonl"),
            };
            let path = self.chunks_dir.join(&file_name);
            match self.mode {
                StreamingOutput::HtmlZip => {
                    let file = tokio::fs::File::create(&path)
                        .await
                        .map_err(|error| format!("创建 HTML 数据分块失败: {error}"))?;
                    let mut writer = BufWriter::new(file);
                    writer
                        .write_all(format!("window.__QCE_DISK_CHUNK__({index},[").as_bytes())
                        .await
                        .map_err(|error| format!("写入 HTML 数据分块失败: {error}"))?;
                    for (message_index, message) in group.iter().enumerate() {
                        if message_index > 0 {
                            writer
                                .write_all(b",")
                                .await
                                .map_err(|error| format!("写入 HTML 数据分块失败: {error}"))?;
                        }
                        let encoded = serde_json::to_vec(message)
                            .map_err(|error| format!("序列化消息失败: {error}"))?;
                        writer
                            .write_all(&encoded)
                            .await
                            .map_err(|error| format!("写入 HTML 数据分块失败: {error}"))?;
                    }
                    writer
                        .write_all(b"]);\n")
                        .await
                        .map_err(|error| format!("写入 HTML 数据分块失败: {error}"))?;
                    writer
                        .flush()
                        .await
                        .map_err(|error| format!("刷新 HTML 数据分块失败: {error}"))?;
                }
                StreamingOutput::Jsonl => {
                    let file = tokio::fs::File::create(&path)
                        .await
                        .map_err(|error| format!("创建 JSONL 分块失败: {error}"))?;
                    let mut writer = BufWriter::new(file);
                    for message in group.iter() {
                        let encoded = serde_json::to_vec(message)
                            .map_err(|error| format!("序列化消息失败: {error}"))?;
                        writer
                            .write_all(&encoded)
                            .await
                            .map_err(|error| format!("写入 JSONL 分块失败: {error}"))?;
                        writer
                            .write_all(b"\n")
                            .await
                            .map_err(|error| format!("写入 JSONL 分块失败: {error}"))?;
                    }
                    writer
                        .flush()
                        .await
                        .map_err(|error| format!("刷新 JSONL 分块失败: {error}"))?;
                }
            }
            self.total_messages += group.len();
            self.chunks.push(ChunkMeta {
                id,
                file: match self.mode {
                    StreamingOutput::HtmlZip => format!("data/chunks/{file_name}"),
                    StreamingOutput::Jsonl => format!("chunks/{file_name}"),
                },
                count: group.len(),
                start_time,
                end_time,
            });
        }
        Ok(())
    }

    async fn rewrite_and_copy_resources(
        &self,
        messages: &mut [CleanMessage],
    ) -> Result<(), String> {
        let mut values = Vec::with_capacity(messages.len());
        let mut sources = HashSet::new();
        for message in messages.iter() {
            let value = serde_json::to_value(message)
                .map_err(|error| format!("序列化资源信息失败: {error}"))?;
            collect_local_paths(&value, &mut sources);
            values.push(value);
        }

        let mut replacements = HashMap::new();
        for source in sources {
            let path = PathBuf::from(&source);
            if !path.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .map_or_else(|| "resource.bin".to_string(), sanitize_component);
            let mut hasher = Md5::new();
            hasher.update(source.as_bytes());
            let hash = format!("{:x}", hasher.finalize());
            let relative = format!("resources/{}_{}", &hash[..12], name);
            let destination = self.work_dir.join(&relative);
            if !tokio::fs::try_exists(&destination).await.unwrap_or(false) {
                tokio::fs::copy(&path, &destination)
                    .await
                    .map_err(|error| format!("复制资源失败 {}: {error}", path.display()))?;
            }
            replacements.insert(source, relative);
        }

        for (index, mut value) in values.into_iter().enumerate() {
            replace_local_paths(&mut value, &replacements);
            messages[index] = serde_json::from_value(value)
                .map_err(|error| format!("恢复消息资源信息失败: {error}"))?;
        }
        Ok(())
    }

    async fn finish(mut self, chat_info: &ChatInfo) -> Result<(PathBuf, usize), String> {
        let manifest = json!({
            "version": 2,
            "storage": "disk-bounded",
            "chat": chat_info,
            "messageCount": self.total_messages,
            "chunkCount": self.chunks.len(),
            "firstTime": self.first_time,
            "lastTime": self.last_time,
            "chunks": self.chunks,
        });
        let manifest_json = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("生成 manifest 失败: {error}"))?;
        tokio::fs::write(self.work_dir.join("manifest.json"), &manifest_json)
            .await
            .map_err(|error| format!("写入 manifest 失败: {error}"))?;

        match self.mode {
            StreamingOutput::Jsonl => {
                tokio::fs::write(
                    self.work_dir.join("README.txt"),
                    "QCE 磁盘流式 JSONL 导出\r\n每个 chunks/*.jsonl 文件包含按时间顺序排列的消息。\r\nmanifest.json 包含分块清单。\r\n",
                )
                .await
                .map_err(|error| format!("写入 JSONL 说明失败: {error}"))?;
                Ok((self.final_path, self.total_messages))
            }
            StreamingOutput::HtmlZip => {
                let manifest_js = format!(
                    "window.__QCE_DISK_MANIFEST__={};\n",
                    serde_json::to_string(&manifest)
                        .map_err(|error| format!("生成 manifest.js 失败: {error}"))?
                );
                tokio::fs::create_dir_all(self.work_dir.join("data"))
                    .await
                    .map_err(|error| format!("创建 HTML 数据目录失败: {error}"))?;
                tokio::fs::write(self.work_dir.join("data/manifest.js"), manifest_js)
                    .await
                    .map_err(|error| format!("写入 manifest.js 失败: {error}"))?;
                tokio::fs::write(self.work_dir.join("index.html"), viewer_html())
                    .await
                    .map_err(|error| format!("写入 HTML 查看器失败: {error}"))?;
                let zip_path = self.final_path.clone();
                let work_dir = self.work_dir.clone();
                tokio::task::spawn_blocking(move || zip_directory(&work_dir, &zip_path))
                    .await
                    .map_err(|error| format!("ZIP 任务异常: {error}"))??;
                let _ = tokio::fs::remove_dir_all(&self.work_dir).await;
                Ok((self.final_path, self.total_messages))
            }
        }
    }

    async fn abort(&self) {
        if self.mode == StreamingOutput::HtmlZip {
            let _ = tokio::fs::remove_dir_all(&self.work_dir).await;
        } else {
            let _ = tokio::fs::remove_dir_all(&self.final_path).await;
        }
    }
}

pub async fn export_streaming_zip(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    create_streaming_task(state, request_id, body, StreamingOutput::HtmlZip).await
}

pub async fn export_streaming_jsonl(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    create_streaming_task(state, request_id, body, StreamingOutput::Jsonl).await
}

async fn create_streaming_task(
    state: SharedState,
    request_id: String,
    body: Value,
    mode: StreamingOutput,
) -> Response {
    let request = match prepare_request(&state, &body).await {
        Ok(request) => request,
        Err(error) => return response::error(&error, &request_id),
    };
    let task_id = format!(
        "disk_stream_{}_{}",
        Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..9]
    );
    let stem = readable_stem(
        &request.session_name,
        &request.peer_identity,
        &task_id,
    );
    let file_name = match mode {
        StreamingOutput::HtmlZip => format!("{stem}_streaming.zip"),
        StreamingOutput::Jsonl => format!("{stem}_chunked_jsonl"),
    };
    let file_path = request.output_dir.join(&file_name);
    if tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
        let error = ApiError::new(
            ErrorType::FileSystem,
            "导出目标已存在，请重新创建任务",
            "EXPORT_TARGET_EXISTS",
        );
        return response::error(&error, &request_id);
    }

    let task = json!({
        "taskId": task_id,
        "peer": { "chatType": request.chat_type, "peerUid": request.peer_uid },
        "sessionName": request.session_name,
        "fileName": file_name,
        "filePath": file_path.to_string_lossy(),
        "downloadUrl": download_url(&file_path, &request.custom_output_dir),
        "messageCount": 0,
        "status": "running",
        "phase": "fetching",
        "progress": 0,
        "createdAt": now_iso(),
        "format": if mode == StreamingOutput::HtmlZip { "STREAMING_ZIP" } else { "STREAMING_JSONL" },
        "filter": request.filter,
        "options": request.options,
    });
    if !register_task(&state, &task).await {
        let error = ApiError::new(
            ErrorType::Api,
            "运行中的导出任务已达到上限",
            "EXPORT_TASK_LIMIT_REACHED",
        )
        .with_status(axum::http::StatusCode::TOO_MANY_REQUESTS);
        return response::error(&error, &request_id);
    }

    let reply = json!({
        "taskId": task_id,
        "sessionName": request.session_name,
        "fileName": file_name,
        "filePath": file_path.to_string_lossy(),
        "downloadUrl": download_url(&file_path, &request.custom_output_dir),
        "messageCount": 0,
        "status": "running",
        "streamingMode": true,
        "diskBacked": true,
    });
    let state_background = Arc::clone(&state);
    tokio::spawn(async move {
        run_streaming_task(state_background, task_id, request, file_name, mode).await;
    });
    response::success(reply, &request_id)
}

async fn run_streaming_task(
    state: SharedState,
    task_id: String,
    request: StreamingRequest,
    file_name: String,
    mode: StreamingOutput,
) {
    let was_cancelled = {
        let cancelled = state.cancelled_task_ids.lock().await;
        cancelled.contains(&task_id)
    };
    let cancel_flag = Arc::new(AtomicBool::new(was_cancelled));
    state
        .running_export_cancel_flags
        .lock()
        .await
        .insert(task_id.clone(), Arc::clone(&cancel_flag));

    let result = if was_cancelled {
        Err("任务已被用户停止".to_string())
    } else {
        process_streaming_task(
            &state,
            &task_id,
            &request,
            &file_name,
            mode,
            &cancel_flag,
        )
        .await
    };

    if let Err(error) = result {
        let cancelled = cancel_flag.load(Ordering::SeqCst)
            || state.cancelled_task_ids.lock().await.contains(&task_id);
        if cancelled {
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "cancelled",
                    "phase": "cancelled",
                    "message": "任务已停止，临时聊天数据已清理",
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_progress",
                "data": {
                    "taskId": task_id,
                    "status": "cancelled",
                    "message": "任务已停止，临时聊天数据已清理",
                }
            }));
        } else {
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "failed",
                    "phase": "failed",
                    "error": error,
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_error",
                "data": { "taskId": task_id, "status": "failed", "error": error },
            }));
        }
    }

    state.running_export_cancel_flags.lock().await.remove(&task_id);
    state.cancelled_task_ids.lock().await.remove(&task_id);
}

#[allow(clippy::too_many_lines)]
async fn process_streaming_task(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    file_name: &str,
    mode: StreamingOutput,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut spool = StreamingMessageSpool::create(&request.output_dir, task_id).await?;
    let include_system_messages = request
        .options
        .get("includeSystemMessages")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut writer = DiskOutputWriter::create(
        &request.output_dir,
        file_name,
        mode,
        task_id,
        include_system_messages,
    )
    .await?;

    let result = process_streaming_inner(
        state,
        task_id,
        request,
        &mut spool,
        &mut writer,
        cancel_flag,
    )
    .await;
    if result.is_err() {
        writer.abort().await;
    }
    spool.cleanup().await;
    let (final_path, message_count, resource_summary) = result?;

    let file_size = path_size(&final_path).await;
    let completion_message = resource_summary_message(&resource_summary);
    update_task(
        state,
        task_id,
        json!({
            "status": "completed",
            "phase": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "filePath": final_path.to_string_lossy(),
            "fileSize": file_size,
            "completedAt": now_iso(),
            "fileName": file_name,
            "isZipExport": mode == StreamingOutput::HtmlZip,
            "diskBacked": true,
            "resourceSummary": resource_summary,
        }),
    )
    .await;
    state.broadcast_ws(&json!({
        "type": "export_complete",
        "data": {
            "taskId": task_id,
            "status": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "fileName": file_name,
            "filePath": final_path.to_string_lossy(),
            "fileSize": file_size,
            "downloadUrl": download_url(&final_path, &request.custom_output_dir),
            "isZipExport": mode == StreamingOutput::HtmlZip,
            "diskBacked": true,
            "resourceSummary": resource_summary,
        }
    }));
    let _ = state.db.flush_write_queue().await;
    state.resource_file_cache.lock().await.clear();
    Ok(())
}

#[allow(clippy::too_many_lines)]
async fn process_streaming_inner(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    writer: &mut DiskOutputWriter,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(PathBuf, usize, ResourceBatchSummary), String> {
    progress(
        state,
        task_id,
        5,
        "fetching",
        "正在从 QQ 获取消息，批次会立即写入磁盘...",
        0,
        0,
        None,
    )
    .await;
    let fetcher = BatchMessageFetcher::new(
        Arc::new(state.napcat.clone()),
        BatchFetchConfig {
            batch_size: request
                .options
                .get("batchSize")
                .and_then(Value::as_i64)
                .unwrap_or(STREAM_BATCH_SIZE)
                .clamp(200, STREAM_BATCH_SIZE),
            timeout_ms: FETCH_TIMEOUT_MS,
            retry_count: 3,
            ..BatchFetchConfig::default()
        },
    );
    let peer = Peer {
        chat_type: request.chat_type,
        peer_uid: request.peer_uid.clone(),
        guild_id: None,
    };
    let filter = MessageFilter {
        start_time: Some(normalize_ms(loose_i64(request.filter.get("startTime")).unwrap_or(0))),
        end_time: Some(normalize_ms(
            loose_i64(request.filter.get("endTime"))
                .unwrap_or_else(|| Utc::now().timestamp_millis()),
        )),
        ..MessageFilter::default()
    };

    let mut previous = None;
    let mut total_fetched = 0usize;
    let mut batch_count = 0usize;
    let mut empty_batches = 0u32;
    let mut last_cursor: Option<String> = None;
    let mut recent_ids: HashSet<String> = HashSet::new();

    loop {
        ensure_running(state, task_id, cancel_flag).await?;
        let started = tokio::time::Instant::now();
        let fetch_future = fetcher.fetch_next_batch(&peer, &filter, previous.as_ref());
        tokio::pin!(fetch_future);
        let mut heartbeat = tokio::time::interval(Duration::from_secs(HEARTBEAT_SECONDS));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let fetch_result = loop {
            tokio::select! {
                result = &mut fetch_future => break result,
                _ = heartbeat.tick() => {
                    ensure_running(state, task_id, cancel_flag).await?;
                    let waiting = started.elapsed().as_secs();
                    let message = format!(
                        "正在获取第 {} 批 · 已写入 {} 条 · 当前请求等待 {} 秒",
                        batch_count + 1,
                        total_fetched,
                        waiting,
                    );
                    broadcast_progress(state, task_id, 10, "fetching", &message, total_fetched, batch_count, Some(waiting));
                }
            }
        };
        let mut batch = match fetch_result {
            Ok(Some(batch)) => batch,
            Ok(None) => break,
            Err(error) => return Err(format!("获取消息失败（已自动降批次和重试）: {error}")),
        };
        batch_count += 1;

        let cursor = batch.next_message_id.clone();
        if batch.has_more && cursor.is_some() && cursor == last_cursor {
            return Err(format!(
                "检测到消息游标连续重复，已停止以避免无限循环（第 {batch_count} 批）"
            ));
        }
        last_cursor = cursor;

        let mut current_ids = HashSet::new();
        batch.messages.retain(|message| {
            let id = message
                .get("msgId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if id.is_empty() {
                return true;
            }
            current_ids.insert(id.to_string()) && !recent_ids.contains(id)
        });
        recent_ids = batch
            .messages
            .iter()
            .rev()
            .take(16)
            .filter_map(|message| message.get("msgId").and_then(Value::as_str))
            .map(str::to_string)
            .collect();

        if batch.messages.is_empty() && batch.has_more {
            empty_batches += 1;
            if empty_batches >= MAX_EMPTY_BATCHES_WITH_MORE {
                return Err("连续空批次仍声明存在更多消息，已停止以避免假运行".to_string());
            }
        } else {
            empty_batches = 0;
        }
        total_fetched += batch.messages.len();
        spool.push_raw_batch(&batch.messages).await?;

        let message = format!(
            "消息仍在正常获取 · 第 {batch_count} 批 · 已写入 {total_fetched} 条 · 本批 {} ms",
            batch.fetch_time_ms,
        );
        progress(
            state,
            task_id,
            10,
            "fetching",
            &message,
            total_fetched,
            batch_count,
            Some(0),
        )
        .await;
        let has_more = batch.has_more;
        previous = Some(batch);
        if !has_more {
            break;
        }
    }

    ensure_running(state, task_id, cancel_flag).await?;
    progress(
        state,
        task_id,
        35,
        "processing",
        "消息抓取完成，正在按批次解析并生成文件...",
        total_fetched,
        batch_count,
        None,
    )
    .await;

    let member_maps = fetch_group_member_maps(state, &request.peer_uid, request.chat_type).await;
    let self_info = state.napcat.self_info().await.unwrap_or(Value::Null);
    let self_uid = self_info.get("uid").and_then(Value::as_str).map(str::to_string);
    let self_uin = self_info.get("uin").and_then(Value::as_str).map(str::to_string);
    let self_name = self_info.get("nick").and_then(Value::as_str).map(str::to_string);
    let chat_type = classify_chat_type_binary(Some(request.chat_type)).to_string();
    let chat_info = ChatInfo {
        name: request.session_name.clone(),
        chat_type: chat_type.clone(),
        avatar: chat_avatar_url(&chat_type, &request.peer_uid, request.peer_uin.as_deref()),
        participant_count: None,
        self_uid: self_uid.clone(),
        self_uin: self_uin.clone(),
        self_name: self_name.clone(),
        peer_uid: Some(request.peer_uid.clone()),
        peer_uin: request.peer_uin.clone(),
    };

    configure_skip_types(state, &request.options).await;
    let mut summary = ResourceBatchSummary::default();
    let skip_all_resources = request
        .options
        .get("filterPureImageMessages")
        .and_then(Value::as_bool)
        == Some(true);
    let files = spool.raw_files_oldest_first();
    let mut processed_raw = 0usize;
    for (file_index, file) in files.iter().enumerate() {
        ensure_running(state, task_id, cancel_flag).await?;
        let mut raw_messages: Vec<Value> = read_jsonl(file).await?;
        raw_messages.sort_by_key(raw_message_time);
        if request.chat_type == GROUP_CHAT_TYPE && !raw_messages.is_empty() {
            if let Err(error) = repair_group_message_sequence(
                &state.napcat,
                &peer,
                &mut raw_messages,
                SequenceRepairConfig::default(),
            )
            .await
            {
                tracing::warn!("[DiskStreaming] 当前批次序列修复未完成，继续导出: {error}");
            }
            apply_group_member_maps(&mut raw_messages, &member_maps);
        }
        raw_messages = apply_sender_filter(raw_messages, &request.filter);
        processed_raw += raw_messages.len();

        let title_map = Arc::new(member_maps.titles.clone());
        let mut parser = SimpleMessageParser::new(SimpleParserOptions {
            html_enabled: true,
            prefer_group_member_name: request
                .options
                .get("preferGroupMemberName")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            sender_title_resolver: Some(Arc::new(move |uid, uin| {
                uid.and_then(|value| title_map.get(value).cloned())
                    .or_else(|| uin.and_then(|value| title_map.get(value).cloned()))
            })),
            forward_fetcher: Some(Arc::new(state.napcat.clone()) as Arc<dyn ForwardFetcher>),
        });
        let mut clean_messages = parser.parse_messages(&raw_messages).await;
        let mut resource_messages = raw_messages;
        resource_messages.extend(parser.take_forward_raw_messages());

        if !skip_all_resources && !resource_messages.is_empty() {
            let resource_map = state
                .resource_handler
                .process_message_resources_with_cancel_and_trace(
                    &resource_messages,
                    Arc::clone(cancel_flag),
                    None,
                )
                .await;
            add_summary(&mut summary, state.resource_handler.last_batch_summary().await);
            let value_map: HashMap<String, Vec<Value>> = resource_map
                .into_iter()
                .map(|(id, resources)| {
                    let values = resources
                        .into_iter()
                        .filter_map(|resource| serde_json::to_value(resource).ok())
                        .collect();
                    (id, values)
                })
                .collect();
            for message in &mut clean_messages {
                SimpleMessageParser::update_message_resource_paths_recursive(message, &value_map);
            }
            SimpleMessageParser::backfill_reply_preview_local_paths(&mut clean_messages);
        }
        backfill_self_sender_names(
            &mut clean_messages,
            self_uid.as_deref(),
            self_uin.as_deref(),
            self_name.as_deref(),
        );
        writer.write_messages(clean_messages).await?;

        let progress_value = 35
            + (((file_index + 1) as f64 / files.len().max(1) as f64) * 50.0).round() as i64;
        let message = format!(
            "正在磁盘分块处理 · {}/{} 批 · 已处理 {} 条",
            file_index + 1,
            files.len(),
            processed_raw,
        );
        progress(
            state,
            task_id,
            progress_value.min(85),
            "processing",
            &message,
            processed_raw,
            file_index + 1,
            None,
        )
        .await;
    }
    state.resource_handler.set_skip_download_types(None).await;
    state.resource_handler.set_progress_callback(None).await;

    ensure_running(state, task_id, cancel_flag).await?;
    progress(
        state,
        task_id,
        90,
        "finalizing",
        if writer.mode == StreamingOutput::HtmlZip {
            "消息分块已完成，正在生成查看器并打包 ZIP..."
        } else {
            "消息分块已完成，正在写入清单..."
        },
        writer.total_messages,
        writer.chunks.len(),
        None,
    )
    .await;
    let writer = std::mem::replace(
        writer,
        DiskOutputWriter::create(
            &request.output_dir,
            &format!(".unused-{task_id}"),
            StreamingOutput::Jsonl,
            task_id,
            true,
        )
        .await?,
    );
    let (final_path, message_count) = writer.finish(&chat_info).await?;
    Ok((final_path, message_count, summary))
}

async fn prepare_request(state: &SharedState, body: &Value) -> Result<StreamingRequest, ApiError> {
    let peer = body
        .get("peer")
        .ok_or_else(|| ApiError::validation("peer参数不完整", "INVALID_PEER"))?;
    let chat_type = loose_i64(peer.get("chatType"))
        .ok_or_else(|| ApiError::validation("chatType无效", "INVALID_PEER"))?;
    let raw_peer_uid = peer
        .get("peerUid")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("peerUid无效", "INVALID_PEER"))?;
    let peer_uid = resolve_peer_uid(chat_type, raw_peer_uid, &state.napcat).await;
    let peer_uin = peer
        .get("peerUin")
        .and_then(Value::as_str)
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))
        .map(str::to_string)
        .or_else(|| {
            (chat_type != GROUP_CHAT_TYPE
                && raw_peer_uid
                    .chars()
                    .all(|character| character.is_ascii_digit()))
            .then(|| raw_peer_uid.to_string())
        });
    let filter = body.get("filter").cloned().unwrap_or(Value::Null);
    let options = body.get("options").cloned().unwrap_or(Value::Null);
    let session_name = match body
        .get("sessionName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => resolve_session_name(chat_type, &peer_uid, &state.napcat).await,
    };
    let custom_output_dir = PathManager::sanitize_path(
        options
            .get("outputDir")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let requested = if custom_output_dir.is_empty() {
        state.path_manager.exports_dir()
    } else {
        PathBuf::from(&custom_output_dir)
    };
    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
    ];
    let output_dir = crate::api::path_security::resolve_for_creation_within(&requested, &roots)
        .ok_or_else(|| {
            ApiError::validation(
                "导出目录不在允许范围内",
                "INVALID_PATH",
            )
        })?;
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| {
            ApiError::new(
                ErrorType::FileSystem,
                format!("无法创建导出目录: {error}"),
                "CREATE_EXPORT_DIR_FAILED",
            )
        })?;
    Ok(StreamingRequest {
        chat_type,
        peer_uid,
        peer_identity: if chat_type == GROUP_CHAT_TYPE {
            raw_peer_uid.to_string()
        } else {
            peer_uin.clone().unwrap_or_else(|| peer_uid.clone())
        },
        peer_uin,
        session_name,
        filter,
        options,
        output_dir,
        custom_output_dir,
    })
}

async fn register_task(state: &SharedState, task: &Value) -> bool {
    let task_id = task
        .get("taskId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    {
        let mut tasks = state.export_tasks.lock().await;
        let active = tasks
            .values()
            .filter(|task| {
                matches!(
                    task.get("status").and_then(Value::as_str),
                    Some("pending" | "running")
                )
            })
            .count();
        if active >= MAX_ACTIVE_EXPORT_TASKS {
            return false;
        }
        tasks.insert(task_id, task.clone());
    }
    if let Err(error) = state.db.save_task(task, task, true).await {
        tracing::warn!("[DiskStreaming] 保存任务失败: {error}");
    }
    true
}

async fn update_task(state: &SharedState, task_id: &str, patch: Value) {
    let updated = {
        let mut tasks = state.export_tasks.lock().await;
        let Some(task) = tasks.get_mut(task_id) else {
            return;
        };
        if task.get("status").and_then(Value::as_str) == Some("cancelled")
            && patch.get("status").and_then(Value::as_str) != Some("cancelled")
        {
            return;
        }
        if let (Some(target), Some(source)) = (task.as_object_mut(), patch.as_object()) {
            for (key, value) in source {
                if value.is_null() {
                    target.remove(key);
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
        task.clone()
    };
    if let Err(error) = state.db.save_task(&updated, &updated, false).await {
        tracing::warn!("[DiskStreaming] 更新任务失败: {error}");
    }
}

#[allow(clippy::too_many_arguments)]
async fn progress(
    state: &SharedState,
    task_id: &str,
    value: i64,
    phase: &str,
    message: &str,
    count: usize,
    batch_count: usize,
    waiting_seconds: Option<u64>,
) {
    let patch = json!({
        "status": "running",
        "progress": value,
        "phase": phase,
        "message": message,
        "messageCount": count,
        "batchCount": batch_count,
        "lastActivityAt": now_iso(),
        "waitingSeconds": waiting_seconds,
        "diskBacked": true,
    });
    update_task(state, task_id, patch).await;
    broadcast_progress(
        state,
        task_id,
        value,
        phase,
        message,
        count,
        batch_count,
        waiting_seconds,
    );
}

#[allow(clippy::too_many_arguments)]
fn broadcast_progress(
    state: &SharedState,
    task_id: &str,
    value: i64,
    phase: &str,
    message: &str,
    count: usize,
    batch_count: usize,
    waiting_seconds: Option<u64>,
) {
    state.broadcast_ws(&json!({
        "type": "export_progress",
        "data": {
            "taskId": task_id,
            "status": "running",
            "progress": value,
            "phase": phase,
            "message": message,
            "messageCount": count,
            "batchCount": batch_count,
            "lastActivityAt": now_iso(),
            "waitingSeconds": waiting_seconds,
            "diskBacked": true,
        }
    }));
}

async fn ensure_running(
    state: &SharedState,
    task_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    if cancel_flag.load(Ordering::SeqCst)
        || state.cancelled_task_ids.lock().await.contains(task_id)
    {
        return Err("任务已被用户停止".to_string());
    }
    Ok(())
}

async fn fetch_group_member_maps(
    state: &SharedState,
    peer_uid: &str,
    chat_type: i64,
) -> GroupMemberMaps {
    if chat_type != GROUP_CHAT_TYPE {
        return GroupMemberMaps::default();
    }
    let Ok(response) = state.napcat.get_group_member_all(peer_uid, false).await else {
        return GroupMemberMaps::default();
    };
    let Some(infos) = response
        .pointer("/result/infos")
        .or_else(|| response.get("infos"))
        .and_then(Value::as_object)
    else {
        return GroupMemberMaps::default();
    };
    let mut maps = GroupMemberMaps::default();
    for (uid, member) in infos {
        let uin = member
            .get("uin")
            .map(|value| match value {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default();
        if let Some(card) = member
            .get("cardName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            maps.cards.insert(uid.clone(), card.to_string());
            if !uin.is_empty() {
                maps.cards.insert(uin.clone(), card.to_string());
            }
        }
        if let Some(title) = ["memberSpecialTitle", "specialTitle", "title"]
            .iter()
            .find_map(|key| member.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            maps.titles.insert(uid.clone(), title.to_string());
            if !uin.is_empty() {
                maps.titles.insert(uin, title.to_string());
            }
        }
    }
    maps
}

fn apply_group_member_maps(messages: &mut [Value], maps: &GroupMemberMaps) {
    for message in messages {
        let needs_name = message
            .get("sendMemberName")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty());
        if !needs_name {
            continue;
        }
        let uid = message
            .get("senderUid")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let uin = message
            .get("senderUin")
            .map(|value| match value {
                Value::String(value) => value.as_str().to_string(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default();
        if let Some(name) = maps.cards.get(uid).or_else(|| maps.cards.get(&uin)) {
            if let Some(object) = message.as_object_mut() {
                object.insert("sendMemberName".to_string(), Value::String(name.clone()));
            }
        }
    }
}

fn apply_sender_filter(messages: Vec<Value>, filter: &Value) -> Vec<Value> {
    let normalize = |key: &str| -> HashSet<String> {
        filter
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| match item {
                        Value::String(value) => Some(value.trim().to_string()),
                        Value::Number(value) => Some(value.to_string()),
                        _ => None,
                    })
                    .filter(|value| !value.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };
    let include = normalize("includeUserUins");
    let exclude = normalize("excludeUserUins");
    if include.is_empty() && exclude.is_empty() {
        return messages;
    }
    messages
        .into_iter()
        .filter(|message| {
            let uin = message
                .get("senderUin")
                .map(|value| match value {
                    Value::String(value) => value.clone(),
                    Value::Number(value) => value.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            (include.is_empty() || include.contains(&uin)) && !exclude.contains(&uin)
        })
        .collect()
}

async fn configure_skip_types(state: &SharedState, options: &Value) {
    let mut types: Vec<String> = options
        .get("skipDownloadResourceTypes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_ascii_lowercase)
                .filter(|value| matches!(value.as_str(), "image" | "video" | "audio" | "file"))
                .collect()
        })
        .unwrap_or_default();
    if options.get("skipFileDownload").and_then(Value::as_bool) == Some(true)
        && !types.iter().any(|value| value == "file")
    {
        types.push("file".to_string());
    }
    if types.is_empty() {
        state.resource_handler.set_skip_download_types(None).await;
    } else {
        state
            .resource_handler
            .set_skip_download_types(Some(&types))
            .await;
    }
}

fn add_summary(target: &mut ResourceBatchSummary, source: ResourceBatchSummary) {
    target.attempted += source.attempted;
    target.already_available += source.already_available;
    target.downloaded += source.downloaded;
    target.failed += source.failed;
    target.skipped += source.skipped;
    for sample in source.failed_samples {
        if target.failed_samples.len() >= 5 {
            break;
        }
        target.failed_samples.push(sample);
    }
}

fn collect_local_paths(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_local_paths(item, output);
            }
        }
        Value::Object(object) => {
            if let Some(path) = object.get("localPath").and_then(Value::as_str) {
                if !path.is_empty() {
                    output.insert(path.to_string());
                }
            }
            for item in object.values() {
                collect_local_paths(item, output);
            }
        }
        _ => {}
    }
}

fn replace_local_paths(value: &mut Value, replacements: &HashMap<String, String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                replace_local_paths(item, replacements);
            }
        }
        Value::Object(object) => {
            if let Some(path) = object.get_mut("localPath") {
                if let Some(replacement) = path
                    .as_str()
                    .and_then(|source| replacements.get(source))
                    .cloned()
                {
                    *path = Value::String(replacement);
                }
            }
            for item in object.values_mut() {
                replace_local_paths(item, replacements);
            }
        }
        _ => {}
    }
}

fn zip_directory(source: &Path, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::create(destination)
        .map_err(|error| format!("创建 ZIP 失败: {error}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for entry in walkdir::WalkDir::new(source)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| format!("计算 ZIP 路径失败: {error}"))?;
        archive
            .start_file(relative.to_string_lossy().replace('\\', "/"), options)
            .map_err(|error| format!("写入 ZIP 条目失败: {error}"))?;
        let mut input = std::fs::File::open(entry.path())
            .map_err(|error| format!("读取 ZIP 条目失败: {error}"))?;
        std::io::copy(&mut input, &mut archive)
            .map_err(|error| format!("复制 ZIP 条目失败: {error}"))?;
    }
    archive
        .finish()
        .map_err(|error| format!("完成 ZIP 失败: {error}"))?;
    Ok(())
}

async fn path_size(path: &Path) -> u64 {
    match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        Ok(metadata) if metadata.is_dir() => {
            let path = path.to_path_buf();
            tokio::task::spawn_blocking(move || {
                walkdir::WalkDir::new(path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .filter_map(|entry| entry.metadata().ok())
                    .map(|metadata| metadata.len())
                    .sum()
            })
            .await
            .unwrap_or(0)
        }
        _ => 0,
    }
}

fn resource_summary_message(summary: &ResourceBatchSummary) -> String {
    if summary.attempted == 0 {
        return "导出完成（磁盘流式模式）".to_string();
    }
    let available = summary.already_available + summary.downloaded;
    format!(
        "导出完成（磁盘流式模式） · 资源 {available}/{}，失败 {}，跳过 {}",
        summary.attempted, summary.failed, summary.skipped,
    )
}

fn readable_stem(session_name: &str, peer_identity: &str, task_id: &str) -> String {
    let session = sanitize_component(session_name);
    let peer = sanitize_component(peer_identity);
    let suffix = task_id.rsplit('_').next().unwrap_or("task");
    format!("{}_{}_{}", session, peer, suffix)
}

fn sanitize_component(value: &str) -> String {
    let result: String = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .take(64)
        .collect();
    let trimmed = result.trim_matches([' ', '.', '_']);
    if trimmed.is_empty() {
        "chat".to_string()
    } else {
        trimmed.to_string()
    }
}

fn download_url(path: &Path, custom_output_dir: &str) -> String {
    if custom_output_dir.is_empty() {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        format!("/downloads/{name}")
    } else {
        let encoded = percent_encoding::utf8_percent_encode(
            &path.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        );
        format!("/api/download-file?path={encoded}")
    }
}

fn raw_message_time(message: &Value) -> i64 {
    normalize_ms(loose_i64(message.get("msgTime")).unwrap_or(0))
}

fn normalize_ms(value: i64) -> i64 {
    if value > 1_000_000_000 && value < 10_000_000_000 {
        value * 1_000
    } else {
        value
    }
}

fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(value)) => value.as_i64(),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn viewer_html() -> &'static str {
    r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QCE 磁盘流式聊天记录</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#1d1d1f}.shell{max-width:960px;margin:auto;min-height:100vh;background:#fff}.top{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.92);backdrop-filter:blur(18px);border-bottom:1px solid #ddd;padding:14px 18px}.title{font-size:17px;font-weight:650}.meta{font-size:12px;color:#777;margin-top:3px}.controls{display:flex;gap:8px;margin-top:10px;align-items:center}.controls button,.controls input{border:1px solid #d2d2d7;border-radius:9px;background:#fff;padding:7px 10px;color:inherit}.controls button:disabled{opacity:.35}.controls input{min-width:0;flex:1}.messages{padding:18px}.message{display:flex;gap:11px;margin:0 0 18px}.avatar{width:34px;height:34px;border-radius:50%;background:#e5e5ea;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px}.body{min-width:0;max-width:82%}.sender{font-size:12px;color:#777;margin:0 0 4px}.bubble{background:#f2f2f7;border-radius:14px;padding:9px 12px;line-height:1.55;overflow-wrap:anywhere}.message.self{justify-content:flex-end}.message.self .avatar{order:2}.message.self .body{order:1}.message.self .bubble{background:#d9fdd3}.resource{display:block;max-width:min(520px,100%);margin-top:8px;border-radius:10px}.file{display:inline-block;margin-top:8px}.empty{text-align:center;color:#888;padding:60px 0}.status{text-align:center;color:#777;padding:12px;font-size:12px}@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f7}.shell{background:#1c1c1e}.top{background:rgba(28,28,30,.92);border-color:#38383a}.bubble{background:#2c2c2e}.message.self .bubble{background:#234a2a}.controls button,.controls input{background:#2c2c2e;border-color:#48484a}}
</style>
</head>
<body><div class="shell"><header class="top"><div class="title" id="title">聊天记录</div><div class="meta" id="meta">读取清单…</div><div class="controls"><button id="prev">上一批</button><input id="jump" type="number" min="1" value="1" aria-label="分块编号"><button id="go">跳转</button><button id="next">下一批</button></div></header><main class="messages" id="messages"></main><div class="status" id="status"></div></div>
<script>window.__QCE_DISK_CHUNK__=(i,d)=>{window.__qceChunk={i,d};window.dispatchEvent(new Event('qcechunk'))}</script>
<script src="data/manifest.js"></script>
<script>
(()=>{const m=window.__QCE_DISK_MANIFEST__,box=document.getElementById('messages'),status=document.getElementById('status'),jump=document.getElementById('jump');let current=1,token=0;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const self=x=>{const c=m.chat||{};return (c.selfUid&&x.sender?.uid===c.selfUid)||(c.selfUin&&x.sender?.uin===c.selfUin)};const resource=r=>{const src=esc(r.localPath||r.url||'');if(!src)return'';if(r.type==='image')return `<img class="resource" loading="lazy" src="${src}" alt="${esc(r.filename||'图片')}">`;if(r.type==='video')return `<video class="resource" controls src="${src}"></video>`;if(r.type==='audio')return `<audio class="resource" controls src="${src}"></audio>`;return `<a class="file" href="${src}">${esc(r.filename||'文件')}</a>`};const render=x=>{const name=x.sender?.name||x.sender?.nickname||x.sender?.uin||'未知';const body=x.content?.html||esc(x.content?.text||'').replace(/\n/g,'<br>');const rs=(x.content?.resources||[]).map(resource).join('');return `<article class="message ${self(x)?'self':''}" id="msg-${esc(x.id)}"><div class="avatar">${esc(name.slice(0,1))}</div><div class="body"><div class="sender">${esc(name)} · ${esc(x.time||new Date(x.timestamp||0).toLocaleString())}${x.recalled?' · 已撤回':''}</div><div class="bubble">${body||'<span style="color:#888">[非文本消息]</span>'}${rs}</div></div></article>`};const update=()=>{document.getElementById('title').textContent=m.chat?.name||'聊天记录';document.getElementById('meta').textContent=`共 ${Number(m.messageCount||0).toLocaleString()} 条 · ${m.chunkCount||0} 个磁盘分块 · 当前 ${current}/${m.chunkCount||0}`;document.getElementById('prev').disabled=current<=1;document.getElementById('next').disabled=current>=m.chunkCount;jump.max=m.chunkCount;jump.value=current};const load=n=>{if(!m||n<1||n>m.chunkCount)return;current=n;update();box.innerHTML='<div class="empty">正在读取当前分块…</div>';status.textContent='浏览器一次只加载一个分块，避免超大记录占满内存';const t=++token;const s=document.createElement('script');s.src=m.chunks[n-1].file;s.onload=()=>{if(t!==token)return;const d=window.__qceChunk?.d||[];box.innerHTML=d.length?d.map(render).join(''):'<div class="empty">这一批没有可显示消息</div>';window.scrollTo({top:0});s.remove()};s.onerror=()=>{box.innerHTML='<div class="empty">分块读取失败，请确认 ZIP 已完整解压</div>';s.remove()};document.body.appendChild(s)};document.getElementById('prev').onclick=()=>load(current-1);document.getElementById('next').onclick=()=>load(current+1);document.getElementById('go').onclick=()=>load(Math.max(1,Math.min(m.chunkCount,Number(jump.value)||1)));if(!m){box.innerHTML='<div class="empty">清单读取失败，请完整解压后打开 index.html</div>';return}load(1)})();
</script></body></html>"#
}

#[cfg(test)]
mod tests {
    use super::{replace_local_paths, sanitize_component};
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn sanitizes_output_components() {
        assert_eq!(sanitize_component("A<>:/\\|?* B"), "A_ B");
    }

    #[test]
    fn rewrites_nested_local_paths() {
        let mut value = json!({
            "content": {
                "resources": [{"localPath": "C:/secret/a.png"}],
                "elements": [{"data": {"localPath": "C:/secret/a.png"}}]
            }
        });
        replace_local_paths(
            &mut value,
            &HashMap::from([(
                "C:/secret/a.png".to_string(),
                "resources/a.png".to_string(),
            )]),
        );
        assert_eq!(
            value.pointer("/content/resources/0/localPath"),
            Some(&json!("resources/a.png"))
        );
        assert_eq!(
            value.pointer("/content/elements/0/data/localPath"),
            Some(&json!("resources/a.png"))
        );
    }
}
