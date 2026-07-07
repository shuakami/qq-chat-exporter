use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::storage::error::DatabaseError;

/// 数据库模式版本。
const DB_SCHEMA_VERSION: i64 = 1;
/// 任务持久化最小间隔（毫秒）。
const TASK_PERSIST_MIN_INTERVAL_MS: i64 = 30 * 1000;
/// 任务持久化进度步长（条数）。
const TASK_PERSIST_PROGRESS_STEP: i64 = 200;
/// 任务持久化进度百分比阈值。
const TASK_PERSIST_PROGRESS_PERCENT: f64 = 0.05;
/// 资源 checkedAt 持久化间隔（毫秒）。
const RESOURCE_CHECKED_AT_PERSIST_INTERVAL_MS: i64 = 6 * 60 * 60 * 1000;
/// 资源文件重建的最少重复行数。
const RESOURCE_REBUILD_MIN_DUPLICATE_LINES: usize = 64;
/// 资源文件重建的重复率阈值。
const RESOURCE_REBUILD_DUPLICATE_RATIO: f64 = 1.2;
/// 批量写入冲刷间隔（毫秒）。
const BATCH_FLUSH_INTERVAL_MS: u64 = 100;
/// 写入队列立即冲刷阈值。
const WRITE_QUEUE_FLUSH_THRESHOLD: usize = 100;
/// 每个定时导出保留的执行历史条数。
const EXECUTION_HISTORY_LIMIT: usize = 100;

/// 任务数据库记录（与 TS `TaskDbRecord` JSON 结构一致）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDbRecord {
    /// 记录 ID（TS 侧为 `Date.now()`）。
    pub id: i64,
    /// 任务 ID。
    #[serde(rename = "taskId")]
    pub task_id: String,
    /// 任务配置（JSON 字符串）。
    pub config: String,
    /// 任务状态（JSON 字符串）。
    pub state: String,
    /// 创建时间（ISO 字符串）。
    #[serde(rename = "createdAt")]
    pub created_at: Value,
    /// 更新时间（ISO 字符串）。
    #[serde(rename = "updatedAt")]
    pub updated_at: Value,
    /// 兼容 TS 侧可能存在的额外字段。
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 资源信息（与 TS `ResourceInfo` JSON 结构一致，弱类型透传额外字段）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    /// 资源 MD5（主键）。
    #[serde(default)]
    pub md5: String,
    /// 资源类型（image / video / audio / file）。
    #[serde(rename = "type", default)]
    pub resource_type: String,
    /// 原始 URL。
    #[serde(rename = "originalUrl", default)]
    pub original_url: String,
    /// 本地路径。
    #[serde(rename = "localPath", skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// 文件名。
    #[serde(rename = "fileName", skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    /// 文件大小。
    #[serde(rename = "fileSize", skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    /// MIME 类型。
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// 是否可访问。
    #[serde(default, deserialize_with = "deserialize_loose_bool")]
    pub accessible: bool,
    /// 资源状态（pending / downloaded / failed / expired）。
    #[serde(default)]
    pub status: String,
    /// 最近一次检查时间（ISO 字符串）。
    #[serde(rename = "checkedAt", default)]
    pub checked_at: Value,
    /// 下载尝试次数。
    #[serde(rename = "downloadAttempts", skip_serializing_if = "Option::is_none")]
    pub download_attempts: Option<i64>,
    /// 最近错误。
    #[serde(rename = "lastError", skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// 兼容 TS 侧其它字段（taskId、messageId、created_at 等）。
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 宽松布尔反序列化：TS 历史数据中 `accessible` 可能为 0/1 或 bool。
fn deserialize_loose_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(match value {
        Value::Bool(b) => b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => false,
    })
}

/// 任务持久化去抖快照（对应 TS `TaskPersistSnapshot`）。
#[derive(Debug, Clone)]
struct TaskPersistSnapshot {
    config_json: String,
    state_signature: String,
    processed_messages: i64,
    success_count: i64,
    failure_count: i64,
    total_messages: i64,
    status: String,
    persisted_at: i64,
}

/// 资源持久化去抖快照（对应 TS `ResourcePersistSnapshot`）。
#[derive(Debug, Clone)]
struct ResourcePersistSnapshot {
    signature: String,
    checked_at: i64,
}

/// 内存状态（索引 + 写入队列）。
#[derive(Debug, Default)]
struct DbState {
    /// 记录 ID → 任务记录。
    tasks: HashMap<String, TaskDbRecord>,
    /// taskId → 记录 ID。
    task_id_to_record_id: HashMap<String, String>,
    /// md5 → 资源信息。
    resources: HashMap<String, ResourceInfo>,
    /// 系统信息键值。
    system_info: HashMap<String, Value>,
    /// 定时导出配置（id → 配置，弱类型透传）。
    scheduled_exports: HashMap<String, Value>,
    /// 执行历史（scheduledExportId → 历史列表）。
    execution_history: HashMap<String, Vec<Value>>,
    /// 待落盘写入队列（文件路径 → 行数据）。
    write_queue: Vec<(PathBuf, Value)>,
    /// 任务持久化去抖快照。
    task_persist_snapshots: HashMap<String, TaskPersistSnapshot>,
    /// 资源持久化去抖快照。
    resource_persist_snapshots: HashMap<String, ResourcePersistSnapshot>,
    /// 是否已初始化。
    initialized: bool,
}

/// JSONL 文件路径集合。
#[derive(Debug, Clone)]
struct JsonlFiles {
    tasks: PathBuf,
    messages: PathBuf,
    resources: PathBuf,
    system_info: PathBuf,
    scheduled_exports: PathBuf,
    execution_history: PathBuf,
}

impl JsonlFiles {
    fn all(&self) -> [(&'static str, &Path); 6] {
        [
            ("tasks", self.tasks.as_path()),
            ("messages", self.messages.as_path()),
            ("resources", self.resources.as_path()),
            ("systemInfo", self.system_info.as_path()),
            ("scheduledExports", self.scheduled_exports.as_path()),
            ("executionHistory", self.execution_history.as_path()),
        ]
    }
}

/// JSONL 数据库管理器。
#[derive(Debug)]
pub struct DatabaseManager {
    db_dir: PathBuf,
    backup_dir: PathBuf,
    files: JsonlFiles,
    state: Arc<Mutex<DbState>>,
    flush_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl DatabaseManager {
    /// 创建管理器。`db_path` 与 TS 侧一致：取其父目录作为数据库目录。
    #[must_use]
    pub fn new(db_path: &Path) -> Self {
        let db_dir = db_path
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        let backup_dir = db_dir.join("backups");
        let files = JsonlFiles {
            tasks: db_dir.join("tasks.jsonl"),
            messages: db_dir.join("messages.jsonl"),
            resources: db_dir.join("resources.jsonl"),
            system_info: db_dir.join("system_info.jsonl"),
            scheduled_exports: db_dir.join("scheduled_exports.jsonl"),
            execution_history: db_dir.join("execution_history.jsonl"),
        };
        Self {
            db_dir,
            backup_dir,
            files,
            state: Arc::new(Mutex::new(DbState::default())),
            flush_handle: Mutex::new(None),
        }
    }

    /// 初始化数据库：建目录、建文件、加载索引、启动期维护、启动批量写入任务。
    pub async fn initialize(self: &Arc<Self>) -> Result<(), DatabaseError> {
        {
            let state = self.state.lock().await;
            if state.initialized {
                return Ok(());
            }
        }

        tokio::fs::create_dir_all(&self.db_dir).await?;
        tokio::fs::create_dir_all(&self.backup_dir).await?;

        self.initialize_files().await?;

        let mut maintenance = StartupMaintenanceFlags::default();
        self.load_indexes(&mut maintenance).await?;
        self.perform_startup_maintenance(maintenance).await?;

        self.spawn_batch_flush().await;

        self.set_system_info("schema_version", &DB_SCHEMA_VERSION.to_string())
            .await;
        self.set_system_info("initialized_at", &now_iso()).await;

        self.cleanup_failed_tasks().await?;

        let mut state = self.state.lock().await;
        state.initialized = true;
        Ok(())
    }

    /// 初始化 JSONL 文件并归档遗留 messages.jsonl（#309）。
    async fn initialize_files(&self) -> Result<(), DatabaseError> {
        for (_, path) in self.files.all() {
            if !path.exists() {
                tokio::fs::write(path, "").await?;
            }
        }
        self.archive_legacy_messages_file().await;
        Ok(())
    }

    /// 归档遗留 messages.jsonl（失败仅告警，不影响启动）。
    async fn archive_legacy_messages_file(&self) {
        let messages_path = &self.files.messages;
        let Ok(meta) = tokio::fs::metadata(messages_path).await else {
            return;
        };
        if meta.len() == 0 {
            return;
        }
        if tokio::fs::create_dir_all(&self.backup_dir).await.is_err() {
            return;
        }
        let timestamp = file_safe_timestamp();
        let archive_path = self
            .backup_dir
            .join(format!("legacy-messages-{timestamp}.jsonl"));
        if tokio::fs::rename(messages_path, &archive_path).await.is_ok() {
            if let Err(error) = tokio::fs::write(messages_path, "").await {
                tracing::warn!("重置 messages.jsonl 失败: {error}");
            } else {
                tracing::warn!(
                    "messages.jsonl 已不被使用，归档至 {} 以加速启动（{} 字节）。",
                    archive_path.display(),
                    meta.len()
                );
            }
        }
    }

    /// 并行加载 5 个内存索引（messages.jsonl 不再加载，见 #309）。
    async fn load_indexes(
        &self,
        maintenance: &mut StartupMaintenanceFlags,
    ) -> Result<(), DatabaseError> {
        {
            let mut state = self.state.lock().await;
            state.task_id_to_record_id.clear();
            state.task_persist_snapshots.clear();
            state.resource_persist_snapshots.clear();
        }

        self.load_task_index(maintenance).await?;
        self.load_resource_index(maintenance).await?;
        self.load_system_info_index().await?;
        self.load_scheduled_export_index().await?;
        self.load_execution_history_index().await?;
        Ok(())
    }

    /// 加载任务索引，去重时保留最新记录。
    async fn load_task_index(
        &self,
        maintenance: &mut StartupMaintenanceFlags,
    ) -> Result<(), DatabaseError> {
        let lines = read_jsonl_lines(&self.files.tasks).await?;
        let mut duplicate_count = 0usize;
        let mut latest: HashMap<String, TaskDbRecord> = HashMap::new();

        for line in lines {
            let Ok(task) = serde_json::from_str::<TaskDbRecord>(&line) else {
                continue;
            };
            match latest.get(&task.task_id) {
                Some(existing) => {
                    duplicate_count += 1;
                    let existing_time = to_timestamp(if existing.updated_at.is_null() {
                        &existing.created_at
                    } else {
                        &existing.updated_at
                    });
                    let current_time = to_timestamp(if task.updated_at.is_null() {
                        &task.created_at
                    } else {
                        &task.updated_at
                    });
                    if current_time > existing_time || task.id > existing.id {
                        latest.insert(task.task_id.clone(), task);
                    }
                }
                None => {
                    latest.insert(task.task_id.clone(), task);
                }
            }
        }

        let mut state = self.state.lock().await;
        for (task_id, task) in latest {
            let record_id = task.id.to_string();
            remember_persisted_task(&mut state, &task, None, None);
            state.task_id_to_record_id.insert(task_id, record_id.clone());
            state.tasks.insert(record_id, task);
        }
        if duplicate_count > 0 {
            maintenance.tasks = true;
        }
        Ok(())
    }

    /// 加载资源索引，修正 checkedAt 字段并统计重复率。
    async fn load_resource_index(
        &self,
        maintenance: &mut StartupMaintenanceFlags,
    ) -> Result<(), DatabaseError> {
        let lines = read_jsonl_lines(&self.files.resources).await?;
        let mut loaded_count = 0usize;
        let mut duplicate_count = 0usize;

        let mut state = self.state.lock().await;
        for line in lines {
            let Ok(mut resource) = serde_json::from_str::<ResourceInfo>(&line) else {
                tracing::warn!("解析资源数据行失败: {line}");
                continue;
            };
            loaded_count += 1;
            normalize_checked_at(&mut resource);
            if resource.md5.is_empty() {
                continue;
            }
            if state.resources.contains_key(&resource.md5) {
                duplicate_count += 1;
            }
            remember_persisted_resource(&mut state, &resource);
            state.resources.insert(resource.md5.clone(), resource);
        }

        if should_compact_resource_file(loaded_count, duplicate_count, state.resources.len()) {
            maintenance.resources = true;
        }
        Ok(())
    }

    /// 加载系统信息索引。
    async fn load_system_info_index(&self) -> Result<(), DatabaseError> {
        let lines = read_jsonl_lines(&self.files.system_info).await?;
        let mut state = self.state.lock().await;
        for line in lines {
            let Ok(info) = serde_json::from_str::<Value>(&line) else {
                tracing::warn!("解析系统信息行失败: {line}");
                continue;
            };
            if let (Some(key), Some(value)) = (
                info.get("key").and_then(Value::as_str),
                info.get("value"),
            ) {
                state.system_info.insert(key.to_string(), value.clone());
            }
        }
        Ok(())
    }

    /// 加载定时导出任务索引。
    async fn load_scheduled_export_index(&self) -> Result<(), DatabaseError> {
        let lines = read_jsonl_lines(&self.files.scheduled_exports).await?;
        let mut state = self.state.lock().await;
        for line in lines {
            let Ok(config) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(id) = config.get("id").and_then(Value::as_str) {
                state.scheduled_exports.insert(id.to_string(), config.clone());
            }
        }
        Ok(())
    }

    /// 加载执行历史索引。
    async fn load_execution_history_index(&self) -> Result<(), DatabaseError> {
        let lines = read_jsonl_lines(&self.files.execution_history).await?;
        let mut state = self.state.lock().await;
        for line in lines {
            let Ok(history) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(scheduled_export_id) =
                history.get("scheduledExportId").and_then(Value::as_str)
            {
                state
                    .execution_history
                    .entry(scheduled_export_id.to_string())
                    .or_default()
                    .push(history.clone());
            }
        }
        Ok(())
    }

    /// 启动后台批量写入任务（每 100ms 冲刷写入队列）。
    async fn spawn_batch_flush(self: &Arc<Self>) {
        let mut handle_guard = self.flush_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }
        let manager = Arc::clone(self);
        *handle_guard = Some(tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_millis(BATCH_FLUSH_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                if let Err(error) = manager.flush_write_queue().await {
                    tracing::error!("批量写入失败: {error}");
                }
            }
        }));
    }

    /// 加入写入队列；队列过大时立即冲刷。
    async fn queue_write(&self, file: PathBuf, data: Value) {
        let should_flush = {
            let mut state = self.state.lock().await;
            state.write_queue.push((file, data));
            state.write_queue.len() >= WRITE_QUEUE_FLUSH_THRESHOLD
        };
        if should_flush {
            if let Err(error) = self.flush_write_queue().await {
                tracing::error!("批量写入失败: {error}");
            }
        }
    }

    /// 冲刷写入队列（公开方法，允许外部立即刷新）。
    pub async fn flush_write_queue(&self) -> Result<(), DatabaseError> {
        let queue = {
            let mut state = self.state.lock().await;
            if state.write_queue.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut state.write_queue)
        };

        let mut file_groups: HashMap<PathBuf, String> = HashMap::new();
        for (file, data) in &queue {
            let entry = file_groups.entry(file.clone()).or_default();
            entry.push_str(&data.to_string());
            entry.push('\n');
        }

        let mut failed = false;
        for (file, content) in file_groups {
            if let Err(error) = append_to_file(&file, &content).await {
                tracing::error!("批量写入失败: {error}");
                failed = true;
            }
        }
        if failed {
            let mut state = self.state.lock().await;
            let mut restored = queue;
            restored.extend(std::mem::take(&mut state.write_queue));
            state.write_queue = restored;
        }
        Ok(())
    }

    /// 保存任务配置与状态（带持久化去抖，`force` 可跳过去抖）。
    pub async fn save_task(
        &self,
        config: &Value,
        task_state: &Value,
        force: bool,
    ) -> Result<(), DatabaseError> {
        let task_id = config
            .get("taskId")
            .and_then(Value::as_str)
            .ok_or_else(|| DatabaseError::InvalidRecord("任务配置缺少 taskId".to_string()))?
            .to_string();
        let config_json = config.to_string();
        let state_json = task_state.to_string();

        let (record, should_persist) = {
            let mut state = self.state.lock().await;
            let existing_record_id = state.task_id_to_record_id.get(&task_id).cloned();
            let record = if let Some(record_id) = existing_record_id {
                if let Some(existing) = state.tasks.get(&record_id) {
                    let mut updated = existing.clone();
                    updated.config = config_json.clone();
                    updated.state = state_json.clone();
                    updated.updated_at = json!(now_iso());
                    updated
                } else {
                    new_task_record(&task_id, &config_json, &state_json)
                }
            } else {
                new_task_record(&task_id, &config_json, &state_json)
            };
            state
                .task_id_to_record_id
                .insert(task_id.clone(), record.id.to_string());
            state.tasks.insert(record.id.to_string(), record.clone());

            let should_persist =
                should_persist_task(&state, &task_id, &config_json, task_state, force);
            if should_persist {
                remember_persisted_task(&mut state, &record, Some(&config_json), Some(task_state));
            }
            (record, should_persist)
        };

        if should_persist {
            let record_value = serde_json::to_value(&record)?;
            self.queue_write(self.files.tasks.clone(), record_value).await;
        }
        Ok(())
    }

    /// 加载任务配置与状态。
    pub async fn load_task(&self, task_id: &str) -> Result<Option<(Value, Value)>, DatabaseError> {
        let state = self.state.lock().await;
        let Some(record_id) = state.task_id_to_record_id.get(task_id) else {
            return Ok(None);
        };
        let Some(record) = state.tasks.get(record_id) else {
            return Ok(None);
        };
        let config: Value = serde_json::from_str(&record.config)?;
        let task_state: Value = serde_json::from_str(&record.state)?;
        Ok(Some((config, task_state)))
    }

    /// 获取所有任务（按开始时间倒序）。
    pub async fn get_all_tasks(&self) -> Vec<(Value, Value)> {
        let state = self.state.lock().await;
        let mut results: Vec<(Value, Value)> = Vec::with_capacity(state.tasks.len());
        for record in state.tasks.values() {
            let Ok(config) = serde_json::from_str::<Value>(&record.config) else {
                continue;
            };
            let Ok(task_state) = serde_json::from_str::<Value>(&record.state) else {
                continue;
            };
            results.push((config, task_state));
        }
        results.sort_by_key(|(_, task_state)| {
            std::cmp::Reverse(
                task_state
                    .get("startTime")
                    .map_or(0, to_timestamp),
            )
        });
        results
    }

    /// 删除任务及其相关数据，并重建文件。
    pub async fn delete_task(&self, task_id: &str) -> Result<(), DatabaseError> {
        self.flush_write_queue().await?;
        {
            let mut state = self.state.lock().await;
            let record_id = state.task_id_to_record_id.get(task_id).cloned().or_else(|| {
                state
                    .tasks
                    .iter()
                    .find(|(_, record)| record.task_id == task_id)
                    .map(|(record_id, _)| record_id.clone())
            });
            if let Some(record_id) = record_id {
                state.tasks.remove(&record_id);
                state.task_id_to_record_id.remove(task_id);
                state.task_persist_snapshots.remove(task_id);
            }
        }
        self.rebuild_files().await?;
        self.flush_write_queue().await
    }

    /// 重建任务与资源文件（原子替换）。
    async fn rebuild_files(&self) -> Result<(), DatabaseError> {
        self.rebuild_task_file().await?;
        self.rebuild_resource_file().await
    }

    /// 重建任务文件。
    async fn rebuild_task_file(&self) -> Result<(), DatabaseError> {
        let records: Vec<Value> = {
            let state = self.state.lock().await;
            state
                .tasks
                .values()
                .filter_map(|record| serde_json::to_value(record).ok())
                .collect()
        };
        write_jsonl_file_atomically(&self.files.tasks, &records).await?;
        let mut state = self.state.lock().await;
        reset_task_persist_snapshots(&mut state);
        Ok(())
    }

    /// 重建资源文件。
    async fn rebuild_resource_file(&self) -> Result<(), DatabaseError> {
        let records: Vec<Value> = {
            let state = self.state.lock().await;
            state
                .resources
                .values()
                .filter_map(|resource| serde_json::to_value(resource).ok())
                .collect()
        };
        write_jsonl_file_atomically(&self.files.resources, &records).await?;
        let mut state = self.state.lock().await;
        reset_resource_persist_snapshots(&mut state);
        Ok(())
    }

    /// 清理失败任务：PENDING/RUNNING 且进度为 0% 的任务。
    async fn cleanup_failed_tasks(&self) -> Result<(), DatabaseError> {
        let tasks_to_delete: Vec<String> = {
            let state = self.state.lock().await;
            let mut to_delete = Vec::new();
            for record in state.tasks.values() {
                let parsed_state = serde_json::from_str::<Value>(&record.state);
                let parsed_config = serde_json::from_str::<Value>(&record.config);
                match (parsed_config, parsed_state) {
                    (Ok(config), Ok(task_state)) => {
                        let total = task_state
                            .get("totalMessages")
                            .and_then(Value::as_i64)
                            .unwrap_or(0);
                        let processed = task_state
                            .get("processedMessages")
                            .and_then(Value::as_i64)
                            .unwrap_or(0);
                        #[allow(clippy::cast_precision_loss)] // 消息数远小于 2^52，损失可忽略
                        let progress = if total > 0 {
                            ((processed as f64 / total as f64) * 100.0).round() as i64
                        } else {
                            0
                        };
                        let status = task_state
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if (status == "pending" || status == "running") && progress == 0 {
                            if let Some(task_id) = config.get("taskId").and_then(Value::as_str) {
                                to_delete.push(task_id.to_string());
                            }
                        }
                    }
                    _ => to_delete.push(record.task_id.clone()),
                }
            }
            to_delete
        };

        if tasks_to_delete.is_empty() {
            return Ok(());
        }

        {
            let mut state = self.state.lock().await;
            for task_id in &tasks_to_delete {
                let record_id = state.task_id_to_record_id.get(task_id).cloned().or_else(|| {
                    state
                        .tasks
                        .iter()
                        .find(|(_, record)| record.task_id == *task_id)
                        .map(|(record_id, _)| record_id.clone())
                });
                if let Some(record_id) = record_id {
                    state.tasks.remove(&record_id);
                    state.task_id_to_record_id.remove(task_id);
                    state.task_persist_snapshots.remove(task_id);
                }
            }
        }
        self.rebuild_files().await
    }

    /// 设置系统信息。
    pub async fn set_system_info(&self, key: &str, value: &str) {
        let record = json!({
            "key": key,
            "value": value,
            "updated_at": now_iso(),
        });
        {
            let mut state = self.state.lock().await;
            state.system_info.insert(key.to_string(), json!(value));
        }
        self.queue_write(self.files.system_info.clone(), record).await;
    }

    /// 获取系统信息。
    pub async fn get_system_info(&self, key: &str) -> Option<Value> {
        let state = self.state.lock().await;
        state.system_info.get(key).cloned()
    }

    /// 创建数据库备份，返回备份目录。
    pub async fn create_backup(&self) -> Result<PathBuf, DatabaseError> {
        let timestamp = file_safe_timestamp();
        let backup_dir = self.backup_dir.join(format!("backup-{timestamp}"));
        tokio::fs::create_dir_all(&backup_dir).await?;
        self.flush_write_queue().await?;
        for (name, path) in self.files.all() {
            if path.exists() {
                tokio::fs::copy(path, backup_dir.join(format!("{name}.jsonl"))).await?;
            }
        }
        Ok(backup_dir)
    }

    /// 获取数据库统计信息。
    pub async fn get_database_stats(&self) -> Value {
        let (total_tasks, total_resources) = {
            let state = self.state.lock().await;
            (state.tasks.len(), state.resources.len())
        };
        let mut database_size: u64 = 0;
        for (_, path) in self.files.all() {
            if let Ok(meta) = tokio::fs::metadata(path).await {
                database_size += meta.len();
            }
        }
        json!({
            "totalTasks": total_tasks,
            "totalMessages": 0,
            "totalResources": total_resources,
            "databaseSize": database_size,
        })
    }

    /// 数据库优化：冲刷 + 重建 + 重新加载。
    pub async fn optimize(&self) -> Result<(), DatabaseError> {
        self.flush_write_queue().await?;
        self.rebuild_files().await?;
        {
            let mut state = self.state.lock().await;
            state.tasks.clear();
            state.resources.clear();
            state.system_info.clear();
            state.scheduled_exports.clear();
            state.execution_history.clear();
            state.task_id_to_record_id.clear();
            state.task_persist_snapshots.clear();
            state.resource_persist_snapshots.clear();
        }
        let mut maintenance = StartupMaintenanceFlags::default();
        self.load_indexes(&mut maintenance).await
    }

    /// 关闭数据库：冲刷队列、停止后台任务、清空索引。
    pub async fn close(&self) -> Result<(), DatabaseError> {
        {
            let state = self.state.lock().await;
            if !state.initialized {
                return Ok(());
            }
        }
        self.flush_write_queue().await?;
        if let Some(handle) = self.flush_handle.lock().await.take() {
            handle.abort();
        }
        let mut state = self.state.lock().await;
        state.tasks.clear();
        state.resources.clear();
        state.system_info.clear();
        state.scheduled_exports.clear();
        state.execution_history.clear();
        state.task_id_to_record_id.clear();
        state.task_persist_snapshots.clear();
        state.resource_persist_snapshots.clear();
        state.initialized = false;
        Ok(())
    }

    /// 是否已初始化。
    pub async fn is_connected(&self) -> bool {
        self.state.lock().await.initialized
    }

    // ================================
    // 资源管理
    // ================================

    /// 保存资源信息（带去抖）。
    pub async fn save_resource_info(&self, resource: &ResourceInfo) -> Result<(), DatabaseError> {
        let mut normalized = resource.clone();
        normalize_checked_at(&mut normalized);

        let should_persist = {
            let mut state = self.state.lock().await;
            if !normalized.md5.is_empty() {
                state
                    .resources
                    .insert(normalized.md5.clone(), normalized.clone());
            }
            let should = should_persist_resource(&state, &normalized);
            if should {
                remember_persisted_resource(&mut state, &normalized);
            }
            should
        };

        if should_persist {
            let mut record = serde_json::to_value(&normalized)?;
            if let Some(obj) = record.as_object_mut() {
                obj.insert("accessible".to_string(), json!(i32::from(normalized.accessible)));
                obj.insert("created_at".to_string(), json!(now_iso()));
                obj.insert("updated_at".to_string(), json!(now_iso()));
            }
            self.queue_write(self.files.resources.clone(), record).await;
        }
        Ok(())
    }

    /// 根据 MD5 获取资源信息。
    pub async fn get_resource_by_md5(&self, md5: &str) -> Option<ResourceInfo> {
        let state = self.state.lock().await;
        state.resources.get(md5).cloned()
    }

    /// 根据状态获取资源列表（按检查时间倒序）。
    pub async fn get_resources_by_status(&self, status: &str) -> Vec<ResourceInfo> {
        let state = self.state.lock().await;
        let mut resources: Vec<ResourceInfo> = state
            .resources
            .values()
            .filter(|resource| resource.status == status)
            .cloned()
            .collect();
        resources.sort_by_key(|resource| std::cmp::Reverse(to_timestamp(&resource.checked_at)));
        resources
    }

    /// 获取需要健康检查的资源。
    pub async fn get_resources_needing_health_check(
        &self,
        cutoff_ms: i64,
        limit: usize,
    ) -> Vec<ResourceInfo> {
        let state = self.state.lock().await;
        let mut resources: Vec<ResourceInfo> = state
            .resources
            .values()
            .filter(|resource| {
                resource.status == "downloaded"
                    && resource.local_path.as_deref().is_some_and(|p| !p.is_empty())
                    && to_timestamp(&resource.checked_at) <= cutoff_ms
            })
            .cloned()
            .collect();
        resources.sort_by_key(|resource| to_timestamp(&resource.checked_at));
        resources.truncate(limit);
        resources
    }

    /// 获取检查时间早于给定时刻的资源列表。
    pub async fn get_resources_older_than(&self, cutoff_ms: i64) -> Vec<ResourceInfo> {
        let state = self.state.lock().await;
        state
            .resources
            .values()
            .filter(|resource| to_timestamp(&resource.checked_at) < cutoff_ms)
            .cloned()
            .collect()
    }

    /// 删除过期资源，返回删除数量。
    pub async fn delete_expired_resources(&self, cutoff_ms: i64) -> Result<usize, DatabaseError> {
        let deleted_count = {
            let mut state = self.state.lock().await;
            let to_delete: Vec<String> = state
                .resources
                .iter()
                .filter(|(_, resource)| to_timestamp(&resource.checked_at) < cutoff_ms)
                .map(|(md5, _)| md5.clone())
                .collect();
            for md5 in &to_delete {
                state.resources.remove(md5);
                state.resource_persist_snapshots.remove(md5);
            }
            to_delete.len()
        };
        if deleted_count > 0 {
            self.rebuild_resource_file().await?;
        }
        Ok(deleted_count)
    }

    /// 获取资源统计信息。
    pub async fn get_resource_statistics(&self) -> Value {
        let state = self.state.lock().await;
        let mut downloaded = 0usize;
        let mut failed = 0usize;
        let mut pending = 0usize;
        for resource in state.resources.values() {
            match resource.status.as_str() {
                "downloaded" => downloaded += 1,
                "failed" => failed += 1,
                "pending" => pending += 1,
                _ => {}
            }
        }
        json!({
            "total": state.resources.len(),
            "downloaded": downloaded,
            "failed": failed,
            "pending": pending,
        })
    }

    // ================================
    // 定时导出 / 执行历史
    // ================================

    /// 保存定时导出任务。
    pub async fn save_scheduled_export(&self, config: &Value) -> Result<(), DatabaseError> {
        let id = config
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| DatabaseError::InvalidRecord("定时导出配置缺少 id".to_string()))?
            .to_string();
        {
            let mut state = self.state.lock().await;
            state.scheduled_exports.insert(id, config.clone());
        }
        self.queue_write(self.files.scheduled_exports.clone(), config.clone())
            .await;
        Ok(())
    }

    /// 获取所有定时导出任务（按创建时间倒序）。
    pub async fn get_scheduled_exports(&self) -> Vec<Value> {
        let state = self.state.lock().await;
        let mut configs: Vec<Value> = state.scheduled_exports.values().cloned().collect();
        configs.sort_by_key(|config| {
            std::cmp::Reverse(config.get("createdAt").map_or(0, to_timestamp))
        });
        configs
    }

    /// 获取指定定时导出任务。
    pub async fn get_scheduled_export(&self, id: &str) -> Option<Value> {
        let state = self.state.lock().await;
        state.scheduled_exports.get(id).cloned()
    }

    /// 删除定时导出任务，返回是否存在。
    pub async fn delete_scheduled_export(&self, id: &str) -> Result<bool, DatabaseError> {
        let exists = {
            let mut state = self.state.lock().await;
            let exists = state.scheduled_exports.remove(id).is_some();
            if exists {
                state.execution_history.remove(id);
            }
            exists
        };
        if exists {
            self.rebuild_scheduled_export_file().await?;
            self.rebuild_execution_history_file().await?;
        }
        Ok(exists)
    }

    /// 保存执行历史（内存中每个定时导出仅保留最近 100 条）。
    pub async fn save_execution_history(&self, history: &Value) -> Result<(), DatabaseError> {
        let scheduled_export_id = history
            .get("scheduledExportId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                DatabaseError::InvalidRecord("执行历史缺少 scheduledExportId".to_string())
            })?
            .to_string();
        {
            let mut state = self.state.lock().await;
            let list = state
                .execution_history
                .entry(scheduled_export_id)
                .or_default();
            list.push(history.clone());
            if list.len() > EXECUTION_HISTORY_LIMIT {
                let overflow = list.len() - EXECUTION_HISTORY_LIMIT;
                list.drain(0..overflow);
            }
        }
        self.queue_write(self.files.execution_history.clone(), history.clone())
            .await;
        Ok(())
    }

    /// 获取执行历史（最近 `limit` 条，倒序）。
    pub async fn get_execution_history(&self, scheduled_export_id: &str, limit: usize) -> Vec<Value> {
        let state = self.state.lock().await;
        let Some(history) = state.execution_history.get(scheduled_export_id) else {
            return Vec::new();
        };
        let start = history.len().saturating_sub(limit);
        let mut recent: Vec<Value> = history[start..].to_vec();
        recent.reverse();
        recent
    }

    /// 重建定时导出任务文件。
    async fn rebuild_scheduled_export_file(&self) -> Result<(), DatabaseError> {
        let records: Vec<Value> = {
            let state = self.state.lock().await;
            state.scheduled_exports.values().cloned().collect()
        };
        write_jsonl_file_atomically(&self.files.scheduled_exports, &records).await
    }

    /// 重建执行历史文件。
    async fn rebuild_execution_history_file(&self) -> Result<(), DatabaseError> {
        let records: Vec<Value> = {
            let state = self.state.lock().await;
            state
                .execution_history
                .values()
                .flat_map(|list| list.iter().cloned())
                .collect()
        };
        write_jsonl_file_atomically(&self.files.execution_history, &records).await
    }

    /// 启动期维护：先备份再原子重建。
    async fn perform_startup_maintenance(
        &self,
        flags: StartupMaintenanceFlags,
    ) -> Result<(), DatabaseError> {
        if !flags.tasks && !flags.resources {
            return Ok(());
        }
        if let Err(error) = self.create_maintenance_backup().await {
            tracing::warn!("创建自动优化备份失败，继续使用原子重建保证安全: {error}");
        }
        if flags.tasks {
            self.rebuild_task_file().await?;
        }
        if flags.resources {
            self.rebuild_resource_file().await?;
        }
        Ok(())
    }

    /// 创建维护备份。
    async fn create_maintenance_backup(&self) -> Result<PathBuf, DatabaseError> {
        let timestamp = file_safe_timestamp();
        let backup_dir = self.backup_dir.join(format!("auto-optimize-{timestamp}"));
        tokio::fs::create_dir_all(&backup_dir).await?;
        for (name, path) in self.files.all() {
            if path.exists() {
                tokio::fs::copy(path, backup_dir.join(format!("{name}.jsonl"))).await?;
            }
        }
        Ok(backup_dir)
    }
}

/// 启动期维护标记。
#[derive(Debug, Default, Clone, Copy)]
struct StartupMaintenanceFlags {
    tasks: bool,
    resources: bool,
}

/// 新建任务记录。
fn new_task_record(task_id: &str, config_json: &str, state_json: &str) -> TaskDbRecord {
    TaskDbRecord {
        id: Utc::now().timestamp_millis(),
        task_id: task_id.to_string(),
        config: config_json.to_string(),
        state: state_json.to_string(),
        created_at: json!(now_iso()),
        updated_at: json!(now_iso()),
        extra: Map::new(),
    }
}

/// 判断任务是否需要落盘（去抖逻辑，对应 TS `shouldPersistTask`）。
fn should_persist_task(
    state: &DbState,
    task_id: &str,
    config_json: &str,
    task_state: &Value,
    force: bool,
) -> bool {
    if force {
        return true;
    }
    let Some(snapshot) = state.task_persist_snapshots.get(task_id) else {
        return true;
    };
    if snapshot.config_json != config_json {
        return true;
    }
    let state_signature = build_task_state_signature(task_state);
    if snapshot.state_signature == state_signature {
        return false;
    }
    let status = task_state.get("status").and_then(Value::as_str).unwrap_or("");
    if snapshot.status != status {
        return true;
    }
    let total = task_state
        .get("totalMessages")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if snapshot.total_messages != total {
        return true;
    }
    let failure = task_state
        .get("failureCount")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if snapshot.failure_count != failure {
        return true;
    }
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    // 消息数远小于 2^52，损失可忽略
    let progress_step = TASK_PERSIST_PROGRESS_STEP.max(
        ((total.max(snapshot.total_messages)) as f64 * TASK_PERSIST_PROGRESS_PERCENT).ceil() as i64,
    );
    let processed = task_state
        .get("processedMessages")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let success = task_state
        .get("successCount")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let processed_delta = (processed - snapshot.processed_messages).abs();
    let success_delta = (success - snapshot.success_count).abs();
    if processed_delta >= progress_step || success_delta >= progress_step {
        return true;
    }
    Utc::now().timestamp_millis() - snapshot.persisted_at >= TASK_PERSIST_MIN_INTERVAL_MS
}

/// 记录任务持久化快照。
fn remember_persisted_task(
    state: &mut DbState,
    record: &TaskDbRecord,
    config_json: Option<&str>,
    parsed_state: Option<&Value>,
) {
    let owned_state;
    let task_state: &Value = match parsed_state {
        Some(value) => value,
        None => {
            let Ok(parsed) = serde_json::from_str::<Value>(&record.state) else {
                return;
            };
            owned_state = parsed;
            &owned_state
        }
    };
    let persisted_at = if record.updated_at.is_null() {
        to_timestamp(&record.created_at)
    } else {
        to_timestamp(&record.updated_at)
    };
    state.task_persist_snapshots.insert(
        record.task_id.clone(),
        TaskPersistSnapshot {
            config_json: config_json.unwrap_or(&record.config).to_string(),
            state_signature: build_task_state_signature(task_state),
            processed_messages: task_state
                .get("processedMessages")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            success_count: task_state
                .get("successCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            failure_count: task_state
                .get("failureCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            total_messages: task_state
                .get("totalMessages")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            status: task_state
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            persisted_at,
        },
    );
}

/// 从索引重置任务持久化快照。
fn reset_task_persist_snapshots(state: &mut DbState) {
    state.task_persist_snapshots.clear();
    let records: Vec<TaskDbRecord> = state.tasks.values().cloned().collect();
    for record in &records {
        remember_persisted_task(state, record, None, None);
    }
}

/// 构建任务状态签名。
fn build_task_state_signature(task_state: &Value) -> String {
    json!({
        "status": task_state.get("status").cloned().unwrap_or(Value::Null),
        "totalMessages": task_state.get("totalMessages").cloned().unwrap_or(Value::Null),
        "processedMessages": task_state.get("processedMessages").cloned().unwrap_or(Value::Null),
        "successCount": task_state.get("successCount").cloned().unwrap_or(Value::Null),
        "failureCount": task_state.get("failureCount").cloned().unwrap_or(Value::Null),
        "error": task_state.get("error").cloned().unwrap_or(Value::Null),
        "startTime": normalize_date_value(task_state.get("startTime")),
        "endTime": normalize_date_value(task_state.get("endTime")),
    })
    .to_string()
}

/// 判断资源是否需要落盘（去抖逻辑）。
fn should_persist_resource(state: &DbState, resource: &ResourceInfo) -> bool {
    if resource.md5.is_empty() {
        return true;
    }
    let Some(snapshot) = state.resource_persist_snapshots.get(&resource.md5) else {
        return true;
    };
    let signature = build_resource_signature(resource);
    if snapshot.signature != signature {
        return true;
    }
    to_timestamp(&resource.checked_at) - snapshot.checked_at
        >= RESOURCE_CHECKED_AT_PERSIST_INTERVAL_MS
}

/// 记录资源持久化快照。
fn remember_persisted_resource(state: &mut DbState, resource: &ResourceInfo) {
    if resource.md5.is_empty() {
        return;
    }
    state.resource_persist_snapshots.insert(
        resource.md5.clone(),
        ResourcePersistSnapshot {
            signature: build_resource_signature(resource),
            checked_at: to_timestamp(&resource.checked_at),
        },
    );
}

/// 从索引重置资源持久化快照。
fn reset_resource_persist_snapshots(state: &mut DbState) {
    state.resource_persist_snapshots.clear();
    let resources: Vec<ResourceInfo> = state.resources.values().cloned().collect();
    for resource in &resources {
        remember_persisted_resource(state, resource);
    }
}

/// 构建资源签名。
fn build_resource_signature(resource: &ResourceInfo) -> String {
    json!({
        "type": resource.resource_type,
        "originalUrl": resource.original_url,
        "localPath": resource.local_path,
        "fileName": resource.file_name,
        "fileSize": resource.file_size,
        "mimeType": resource.mime_type,
        "md5": resource.md5,
        "accessible": resource.accessible,
        "status": resource.status,
        "downloadAttempts": resource.download_attempts.unwrap_or(0),
        "lastError": resource.last_error.clone().unwrap_or_default(),
    })
    .to_string()
}

/// 是否需要压缩资源文件。
fn should_compact_resource_file(
    loaded_count: usize,
    duplicate_count: usize,
    live_count: usize,
) -> bool {
    if duplicate_count < RESOURCE_REBUILD_MIN_DUPLICATE_LINES {
        return false;
    }
    if live_count == 0 {
        return false;
    }
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    // 记录数远小于 2^52，损失可忽略
    let threshold = (live_count as f64 * RESOURCE_REBUILD_DUPLICATE_RATIO).ceil() as usize;
    loaded_count >= threshold
}

/// 修正 checkedAt 字段：无效或缺失时置为当前时间。
fn normalize_checked_at(resource: &mut ResourceInfo) {
    let ts = to_timestamp(&resource.checked_at);
    if ts == 0 {
        resource.checked_at = json!(now_iso());
    }
}

/// 将 Date / ISO 字符串 / 毫秒数转换成毫秒时间戳，无效时返回 0。
fn to_timestamp(value: &Value) -> i64 {
    match value {
        Value::String(s) => {
            DateTime::parse_from_rfc3339(s).map_or(0, |dt| dt.timestamp_millis())
        }
        Value::Number(n) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}

/// 规范化日期值为 ISO 字符串（无效返回 null）。
fn normalize_date_value(value: Option<&Value>) -> Value {
    let Some(value) = value else {
        return Value::Null;
    };
    let ts = to_timestamp(value);
    if ts == 0 {
        return Value::Null;
    }
    DateTime::<Utc>::from_timestamp_millis(ts)
        .map_or(Value::Null, |dt| json!(dt.to_rfc3339_opts(SecondsFormat::Millis, true)))
}

/// 当前 UTC 时间 ISO 字符串（毫秒精度，与 JS `toISOString()` 对齐）。
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// 文件名安全的时间戳（`:` 与 `.` 替换为 `-`）。
fn file_safe_timestamp() -> String {
    now_iso().replace([':', '.'], "-")
}

/// 读取 JSONL 文件的非空行。
async fn read_jsonl_lines(path: &Path) -> Result<Vec<String>, DatabaseError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = tokio::fs::read_to_string(path).await?;
    Ok(content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect())
}

/// 追加内容到文件。
async fn append_to_file(path: &Path, content: &str) -> Result<(), DatabaseError> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(content.as_bytes()).await?;
    Ok(())
}

/// 原子写入 JSONL 文件（临时文件 + rename）。
async fn write_jsonl_file_atomically(path: &Path, records: &[Value]) -> Result<(), DatabaseError> {
    let temp_path = path.with_extension("jsonl.tmp");
    let mut content = String::new();
    for record in records {
        content.push_str(&record.to_string());
        content.push('\n');
    }
    let result: Result<(), DatabaseError> = async {
        tokio::fs::write(&temp_path, &content).await?;
        if path.exists() {
            tokio::fs::remove_file(path).await?;
        }
        tokio::fs::rename(&temp_path, path).await?;
        Ok(())
    }
    .await;
    if result.is_err() && temp_path.exists() {
        let _ = tokio::fs::remove_file(&temp_path).await;
    }
    result
}
