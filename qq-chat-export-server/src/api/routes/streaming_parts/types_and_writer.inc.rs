use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Extension, Json, State};
use axum::response::Response;
use chrono::Utc;
use md5::{Digest, Md5};
use qce_exporter::{ChatInfo, CleanMessage};
use serde_json::{json, Value};
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
            self.first_time = Some(
                self.first_time
                    .map_or(start_time, |value| value.min(start_time)),
            );
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

    async fn finish(self, chat_info: &ChatInfo) -> Result<(PathBuf, usize), String> {
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
                let _ = tokio::fs::remove_dir_all(&self.work_di�K�]�Z]��
�[���[�[�]�[���[�Y\��Y�\�JB�B�B�B��\�[����X�ܝ
	��[�HY��[��[�HOH��X[Z[���]]��[�\]�H��[Ύ��Ύ��[[ݙW�\��[
	��[���ܚ��\�K�]�Z]H[�H]�H��[Ύ��Ύ��[[ݙW�\��[
	��[���[�[�]
K�]�Z]B�B�B�