//! 进度跟踪器。
//!
//! 与 TS 侧 `ProgressTracker.ts` 语义对齐：任务进度的实时跟踪、持久化存储与
//! 状态管理，支持多任务并发、断点续传与详细的进度统计。
//!
//! 事件模型：TS 的 `EventEmitter` 在 Rust 侧映射为 `tokio::sync::broadcast`
//! 通道 —— WebSocket 层订阅 [`ProgressTracker::subscribe`] 即可收到全部事件。
//! 每任务的自动保存 / 性能监控定时器映射为可 abort 的 `tokio::spawn` 任务。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex};

use crate::storage::DatabaseManager;

/// 自动保存间隔（毫秒）。
const AUTO_SAVE_INTERVAL_MS: u64 = 5000;
/// 性能监控检查间隔（毫秒）。
const PERFORMANCE_CHECK_INTERVAL_MS: u64 = 10000;
/// 任务完成后内存数据保留时长（毫秒）。
const TASK_CLEANUP_DELAY_MS: u64 = 60000;
/// 保留的进度快照上限。
const SNAPSHOT_LIMIT: usize = 1000;
/// 速度历史数据点上限。
const SPEED_HISTORY_LIMIT: usize = 60;

/// 任务状态枚举（与 TS `ExportTaskStatus` 字符串值一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportTaskStatus {
    /// 等待中。
    Pending,
    /// 执行中。
    Running,
    /// 已暂停。
    Paused,
    /// 已完成。
    Completed,
    /// 失败。
    Failed,
    /// 已取消。
    Cancelled,
}

/// 导出任务状态（与 TS `ExportTaskState` JSON 结构一致）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTaskState {
    /// 任务 ID。
    pub task_id: String,
    /// 当前状态。
    pub status: ExportTaskStatus,
    /// 总消息数。
    pub total_messages: i64,
    /// 已处理消息数。
    pub processed_messages: i64,
    /// 成功处理数。
    pub success_count: i64,
    /// 失败处理数。
    pub failure_count: i64,
    /// 当前处理的消息 ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_message_id: Option<String>,
    /// 错误信息。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 开始时间（ISO 字符串）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    /// 结束时间（ISO 字符串）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    /// 估计剩余时间（毫秒）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_time_remaining: Option<i64>,
    /// 处理速度（消息/秒）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_speed: Option<f64>,
    /// 兼容 TS 侧可能存在的额外字段。
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

/// 事件类型（与 TS `EventType` 字符串值一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// 任务状态变更。
    TaskStatusChanged,
    /// 任务进度更新。
    TaskProgressUpdated,
    /// 任务完成。
    TaskCompleted,
    /// 任务失败。
    TaskFailed,
    /// 消息获取进度。
    MessageFetchProgress,
    /// 导出进度。
    ExportProgress,
    /// 系统错误。
    SystemError,
    /// 健康状态变更。
    HealthStatusChanged,
}

/// 事件数据（与 TS `EventData` JSON 结构一致）。
#[derive(Debug, Clone, Serialize)]
pub struct EventData {
    /// 事件类型。
    #[serde(rename = "type")]
    pub event_type: EventType,
    /// 事件负载。
    pub data: Value,
    /// 时间戳（ISO 字符串）。
    pub timestamp: String,
}

/// 阶段状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PhaseStatus {
    /// 待执行。
    Pending,
    /// 执行中。
    Running,
    /// 已完成。
    Completed,
    /// 失败。
    Failed,
}

/// 任务阶段定义（对应 TS `TaskPhase`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPhase {
    /// 阶段名称。
    pub name: String,
    /// 阶段描述。
    pub description: String,
    /// 阶段权重（用于计算总进度）。
    pub weight: f64,
    /// 阶段开始时间。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    /// 阶段结束时间。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    /// 阶段状态。
    pub status: PhaseStatus,
}

impl TaskPhase {
    fn new(name: &str, description: &str, weight: f64) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            weight,
            start_time: None,
            end_time: None,
            status: PhaseStatus::Pending,
        }
    }
}

/// 预定义的任务阶段。
fn default_phases() -> Vec<TaskPhase> {
    vec![
        TaskPhase::new("init", "初始化任务", 5.0),
        TaskPhase::new("fetch", "获取消息数据", 60.0),
        TaskPhase::new("process", "处理消息内容", 20.0),
        TaskPhase::new("export", "导出文件", 10.0),
        TaskPhase::new("finalize", "完成任务", 5.0),
    ]
}

/// 进度快照（对应 TS `ProgressSnapshot`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    /// 快照时间。
    pub timestamp: String,
    /// 已处理消息数。
    pub processed_messages: i64,
    /// 成功处理数。
    pub success_count: i64,
    /// 失败处理数。
    pub failure_count: i64,
    /// 处理速度（消息/秒）。
    pub speed: f64,
    /// 阶段描述。
    pub phase: String,
}

/// 性能统计（对应 TS `PerformanceStats`）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceStats {
    /// 平均处理速度（消息/秒）。
    pub average_speed: f64,
    /// 峰值处理速度（消息/秒）。
    pub peak_speed: f64,
    /// 当前处理速度（消息/秒）。
    pub current_speed: f64,
    /// 处理速度历史（最近 60 个数据点）。
    pub speed_history: Vec<f64>,
}

/// 单任务跟踪数据。
struct TaskEntry {
    state: ExportTaskState,
    config: Value,
    snapshots: Vec<ProgressSnapshot>,
    performance: PerformanceStats,
    phases: Vec<TaskPhase>,
    auto_save_handle: Option<tokio::task::JoinHandle<()>>,
    performance_handle: Option<tokio::task::JoinHandle<()>>,
}

/// 进度跟踪器。
pub struct ProgressTracker {
    db: Arc<DatabaseManager>,
    tasks: Mutex<HashMap<String, TaskEntry>>,
    event_tx: broadcast::Sender<EventData>,
}

impl ProgressTracker {
    /// 创建跟踪器。
    pub fn new(db: Arc<DatabaseManager>) -> Self {
        let (event_tx, _) = broadcast::channel(1024);
        Self {
            db,
            tasks: Mutex::new(HashMap::new()),
            event_tx,
        }
    }

    /// 订阅全部进度事件（WebSocket 层使用）。
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<EventData> {
        self.event_tx.subscribe()
    }

    /// 初始化任务跟踪（支持断点续传：已存在的任务恢复其状态）。
    pub async fn initialize_task(
        self: &Arc<Self>,
        task_id: &str,
        config: Value,
        total_messages: i64,
        phases: Option<Vec<TaskPhase>>,
    ) -> Result<(), String> {
        let existing = self
            .db
            .load_task(task_id)
            .await
            .map_err(|error| format!("初始化任务跟踪失败: {error}"))?;

        let state = match existing {
            Some((_config, state_value)) => {
                let mut state: ExportTaskState = serde_json::from_value(state_value)
                    .map_err(|error| format!("初始化任务跟踪失败: {error}"))?;
                state.status = ExportTaskStatus::Running;
                state
            }
            None => ExportTaskState {
                task_id: task_id.to_string(),
                status: ExportTaskStatus::Running,
                total_messages,
                processed_messages: 0,
                success_count: 0,
                failure_count: 0,
                current_message_id: None,
                error: None,
                start_time: Some(now_iso()),
                end_time: None,
                estimated_time_remaining: None,
                processing_speed: Some(0.0),
                extra: serde_json::Map::new(),
            },
        };

        let status = state.status;
        {
            let mut tasks = self.tasks.lock().await;
            let entry = tasks.entry(task_id.to_string()).or_insert_with(|| TaskEntry {
                state: state.clone(),
                config: config.clone(),
                snapshots: Vec::new(),
                performance: PerformanceStats::default(),
                phases: phases.clone().unwrap_or_else(default_phases),
                auto_save_handle: None,
                performance_handle: None,
            });
            entry.state = state;
            entry.config = config;
        }

        self.start_auto_save(task_id).await;
        self.start_performance_monitoring(task_id).await;

        let progress = self.calculate_overall_progress(task_id).await;
        self.emit_event(
            EventType::TaskStatusChanged,
            json!({
                "taskId": task_id,
                "status": status,
                "progress": progress,
            }),
        );
        Ok(())
    }

    /// 更新消息处理进度。
    pub async fn update_progress(
        &self,
        task_id: &str,
        processed_count: i64,
        success_count: Option<i64>,
        failure_count: Option<i64>,
        current_message_id: Option<String>,
    ) {
        let event_payload = {
            let mut tasks = self.tasks.lock().await;
            let Some(entry) = tasks.get_mut(task_id) else {
                tracing::warn!("任务状态不存在: {task_id}");
                return;
            };

            entry.state.processed_messages = processed_count;
            if let Some(success) = success_count {
                entry.state.success_count = success;
            }
            if let Some(failure) = failure_count {
                entry.state.failure_count = failure;
            }
            if let Some(message_id) = current_message_id {
                entry.state.current_message_id = Some(message_id);
            }

            calculate_processing_speed(entry);
            estimate_remaining_time(&mut entry.state);
            record_progress_snapshot(entry);

            let total = entry.state.total_messages;
            let percentage = if total > 0 {
                ((processed_count as f64 / total as f64) * 100.0).round() as i64
            } else {
                0
            };
            json!({
                "taskId": task_id,
                "processed": processed_count,
                "total": total,
                "percentage": percentage,
                "speed": entry.state.processing_speed,
                "estimatedTimeRemaining": entry.state.estimated_time_remaining,
            })
        };
        self.emit_event(EventType::TaskProgressUpdated, event_payload);
    }

    /// 设置当前任务阶段。
    pub async fn set_task_phase(&self, task_id: &str, phase_name: &str) {
        let event_payload = {
            let mut tasks = self.tasks.lock().await;
            let Some(entry) = tasks.get_mut(task_id) else {
                return;
            };
            let mut found = false;
            for phase in &mut entry.phases {
                if phase.name == phase_name {
                    if phase.status == PhaseStatus::Pending {
                        phase.status = PhaseStatus::Running;
                        phase.start_time = Some(now_iso());
                    }
                    found = true;
                } else if phase.status == PhaseStatus::Running {
                    phase.status = PhaseStatus::Completed;
                    phase.end_time = Some(now_iso());
                }
            }
            if !found {
                tracing::warn!("未找到阶段: {phase_name}");
                return;
            }
            let phases: Vec<Value> = entry
                .phases
                .iter()
                .map(|phase| {
                    json!({
                        "name": phase.name,
                        "description": phase.description,
                        "status": phase.status,
                    })
                })
                .collect();
            json!({
                "taskId": task_id,
                "phase": phase_name,
                "phases": phases,
            })
        };
        self.emit_event(EventType::MessageFetchProgress, event_payload);
    }

    /// 完成任务（`error` 非空则视为失败）。
    pub async fn complete_task(self: &Arc<Self>, task_id: &str, error: Option<String>) {
        let (event_type, event_payload, save_data) = {
            let mut tasks = self.tasks.lock().await;
            let Some(entry) = tasks.get_mut(task_id) else {
                return;
            };

            entry.state.status = if error.is_some() {
                ExportTaskStatus::Failed
            } else {
                ExportTaskStatus::Completed
            };
            entry.state.end_time = Some(now_iso());
            entry.state.error = error.clone();

            for phase in &mut entry.phases {
                if phase.status == PhaseStatus::Running || phase.status == PhaseStatus::Pending {
                    phase.status = if error.is_some() {
                        PhaseStatus::Failed
                    } else {
                        PhaseStatus::Completed
                    };
                    phase.end_time = Some(now_iso());
                }
            }

            if let Some(handle) = entry.auto_save_handle.take() {
                handle.abort();
            }
            if let Some(handle) = entry.performance_handle.take() {
                handle.abort();
            }

            let duration_ms = duration_ms(&entry.state);
            let event_type = if error.is_some() {
                EventType::TaskFailed
            } else {
                EventType::TaskCompleted
            };
            let payload = json!({
                "taskId": task_id,
                "status": entry.state.status,
                "totalProcessed": entry.state.processed_messages,
                "successCount": entry.state.success_count,
                "failureCount": entry.state.failure_count,
                "duration": duration_ms,
                "error": error,
            });
            let save_data = serde_json::to_value(&entry.state)
                .ok()
                .map(|state| (entry.config.clone(), state));
            (event_type, payload, save_data)
        };

        // 最终保存（强制持久化）。
        if let Some((config, state)) = save_data {
            if let Err(save_error) = self.db.save_task(&config, &state, true).await {
                tracing::error!("保存任务状态失败: {save_error}");
            }
        }

        self.emit_event(event_type, event_payload);
        self.schedule_cleanup(task_id);
    }

    /// 暂停任务。
    pub async fn pause_task(&self, task_id: &str) {
        let payload = {
            let mut tasks = self.tasks.lock().await;
            let Some(entry) = tasks.get_mut(task_id) else {
                return;
            };
            entry.state.status = ExportTaskStatus::Paused;
            if let Some(handle) = entry.auto_save_handle.take() {
                handle.abort();
            }
            if let Some(handle) = entry.performance_handle.take() {
                handle.abort();
            }
            json!({ "taskId": task_id, "status": entry.state.status })
        };
        self.emit_event(EventType::TaskStatusChanged, payload);
    }

    /// 恢复任务。
    pub async fn resume_task(self: &Arc<Self>, task_id: &str) {
        let payload = {
            let mut tasks = self.tasks.lock().await;
            let Some(entry) = tasks.get_mut(task_id) else {
                return;
            };
            entry.state.status = ExportTaskStatus::Running;
            json!({ "taskId": task_id, "status": entry.state.status })
        };
        self.start_auto_save(task_id).await;
        self.start_performance_monitoring(task_id).await;
        self.emit_event(EventType::TaskStatusChanged, payload);
    }

    /// 取消任务。
    pub async fn cancel_task(self: &Arc<Self>, task_id: &str) {
        self.complete_task(task_id, Some("任务已被用户取消".to_string()))
            .await;
        let mut tasks = self.tasks.lock().await;
        if let Some(entry) = tasks.get_mut(task_id) {
            entry.state.status = ExportTaskStatus::Cancelled;
        }
    }

    /// 获取任务状态。
    pub async fn task_state(&self, task_id: &str) -> Option<ExportTaskState> {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|entry| entry.state.clone())
    }

    /// 获取任务性能统计。
    pub async fn performance_stats(&self, task_id: &str) -> Option<PerformanceStats> {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|entry| entry.performance.clone())
    }

    /// 获取任务阶段信息。
    pub async fn task_phases(&self, task_id: &str) -> Option<Vec<TaskPhase>> {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|entry| entry.phases.clone())
    }

    /// 获取进度历史。
    pub async fn progress_history(&self, task_id: &str) -> Vec<ProgressSnapshot> {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|entry| entry.snapshots.clone())
            .unwrap_or_default()
    }

    /// 获取所有活跃任务（运行中 / 已暂停）。
    pub async fn active_tasks(&self) -> Vec<ExportTaskState> {
        self.tasks
            .lock()
            .await
            .values()
            .filter(|entry| {
                matches!(
                    entry.state.status,
                    ExportTaskStatus::Running | ExportTaskStatus::Paused
                )
            })
            .map(|entry| entry.state.clone())
            .collect()
    }

    /// 生成详细进度报告。
    pub async fn generate_progress_report(&self, task_id: &str) -> Option<Value> {
        let tasks = self.tasks.lock().await;
        let entry = tasks.get(task_id)?;
        let state = &entry.state;
        let percentage = if state.total_messages > 0 {
            ((state.processed_messages as f64 / state.total_messages as f64) * 100.0).round()
                as i64
        } else {
            0
        };
        Some(json!({
            "taskId": task_id,
            "status": state.status,
            "progress": {
                "processed": state.processed_messages,
                "total": state.total_messages,
                "percentage": percentage,
                "success": state.success_count,
                "failure": state.failure_count,
            },
            "timing": {
                "startTime": state.start_time,
                "endTime": state.end_time,
                "estimatedRemaining": state.estimated_time_remaining,
            },
            "performance": entry.performance,
            "phases": entry.phases,
            "snapshotCount": entry.snapshots.len(),
            "generatedAt": now_iso(),
        }))
    }

    /// 计算总体进度（基于阶段权重）。
    async fn calculate_overall_progress(&self, task_id: &str) -> i64 {
        let tasks = self.tasks.lock().await;
        let Some(entry) = tasks.get(task_id) else {
            return 0;
        };
        let mut total_weight = 0.0;
        let mut completed_weight = 0.0;
        for phase in &entry.phases {
            total_weight += phase.weight;
            match phase.status {
                PhaseStatus::Completed => completed_weight += phase.weight,
                PhaseStatus::Running => {
                    let message_progress = if entry.state.total_messages > 0 {
                        entry.state.processed_messages as f64 / entry.state.total_messages as f64
                    } else {
                        0.0
                    };
                    completed_weight += phase.weight * message_progress;
                }
                _ => {}
            }
        }
        if total_weight > 0.0 {
            ((completed_weight / total_weight) * 100.0).round() as i64
        } else {
            0
        }
    }

    /// 启动自动保存定时任务。
    async fn start_auto_save(self: &Arc<Self>, task_id: &str) {
        let tracker = Arc::clone(self);
        let task_id_owned = task_id.to_string();
        let handle = tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(AUTO_SAVE_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                interval.tick().await;
                let save_data = {
                    let tasks = tracker.tasks.lock().await;
                    tasks.get(&task_id_owned).and_then(|entry| {
                        serde_json::to_value(&entry.state)
                            .ok()
                            .map(|state| (entry.config.clone(), state))
                    })
                };
                match save_data {
                    Some((config, state)) => {
                        if let Err(error) = tracker.db.save_task(&config, &state, false).await {
                            tracing::error!("自动保存任务 {task_id_owned} 失败: {error}");
                        }
                    }
                    None => {
                        tracing::warn!("自动保存失败: 任务 {task_id_owned} 的状态或配置不存在");
                    }
                }
            }
        });
        let mut tasks = self.tasks.lock().await;
        if let Some(entry) = tasks.get_mut(task_id) {
            if let Some(previous) = entry.auto_save_handle.replace(handle) {
                previous.abort();
            }
        } else {
            handle.abort();
        }
    }

    /// 启动性能监控定时任务（速度显著下降时发出健康告警）。
    async fn start_performance_monitoring(self: &Arc<Self>, task_id: &str) {
        let tracker = Arc::clone(self);
        let task_id_owned = task_id.to_string();
        let handle = tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(PERFORMANCE_CHECK_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                interval.tick().await;
                let warning_payload = {
                    let tasks = tracker.tasks.lock().await;
                    tasks.get(&task_id_owned).and_then(|entry| {
                        let perf = &entry.performance;
                        if perf.current_speed < perf.average_speed * 0.3 {
                            Some(json!({
                                "taskId": task_id_owned,
                                "warning": "处理速度显著下降",
                                "currentSpeed": perf.current_speed,
                                "averageSpeed": perf.average_speed,
                            }))
                        } else {
                            None
                        }
                    })
                };
                if let Some(payload) = warning_payload {
                    tracker.emit_event(EventType::HealthStatusChanged, payload);
                }
            }
        });
        let mut tasks = self.tasks.lock().await;
        if let Some(entry) = tasks.get_mut(task_id) {
            if let Some(previous) = entry.performance_handle.replace(handle) {
                previous.abort();
            }
        } else {
            handle.abort();
        }
    }

    /// 完成后延迟清理内存数据（保留一段时间用于查询）。
    fn schedule_cleanup(self: &Arc<Self>, task_id: &str) {
        let tracker = Arc::clone(self);
        let task_id_owned = task_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(TASK_CLEANUP_DELAY_MS)).await;
            let mut tasks = tracker.tasks.lock().await;
            if let Some(entry) = tasks.remove(&task_id_owned) {
                if let Some(handle) = entry.auto_save_handle {
                    handle.abort();
                }
                if let Some(handle) = entry.performance_handle {
                    handle.abort();
                }
            }
        });
    }

    /// 发送事件（广播；无订阅者时静默丢弃）。
    fn emit_event(&self, event_type: EventType, data: Value) {
        let _ = self.event_tx.send(EventData {
            event_type,
            data,
            timestamp: now_iso(),
        });
    }
}

/// 计算处理速度并更新性能统计。
fn calculate_processing_speed(entry: &mut TaskEntry) {
    let Some(start_time) = entry
        .state
        .start_time
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    else {
        return;
    };
    let elapsed_seconds =
        (chrono::Utc::now().timestamp_millis() - start_time.timestamp_millis()) as f64 / 1000.0;
    if elapsed_seconds <= 0.0 {
        return;
    }
    let speed = entry.state.processed_messages as f64 / elapsed_seconds;
    entry.state.processing_speed = Some(speed);

    let perf = &mut entry.performance;
    perf.current_speed = speed;
    perf.average_speed = speed;
    perf.speed_history.push(speed);
    if perf.speed_history.len() > SPEED_HISTORY_LIMIT {
        perf.speed_history.remove(0);
    }
    if speed > perf.peak_speed {
        perf.peak_speed = speed;
    }
}

/// 估计剩余时间。
fn estimate_remaining_time(state: &mut ExportTaskState) {
    let Some(speed) = state.processing_speed.filter(|s| *s > 0.0) else {
        return;
    };
    let remaining = state.total_messages - state.processed_messages;
    state.estimated_time_remaining = Some(((remaining as f64 / speed) * 1000.0).round() as i64);
}

/// 记录进度快照（保留最近 1000 个）。
fn record_progress_snapshot(entry: &mut TaskEntry) {
    let phase = entry
        .phases
        .iter()
        .find(|p| p.status == PhaseStatus::Running)
        .map_or_else(|| "unknown".to_string(), |p| p.name.clone());
    entry.snapshots.push(ProgressSnapshot {
        timestamp: now_iso(),
        processed_messages: entry.state.processed_messages,
        success_count: entry.state.success_count,
        failure_count: entry.state.failure_count,
        speed: entry.state.processing_speed.unwrap_or(0.0),
        phase,
    });
    if entry.snapshots.len() > SNAPSHOT_LIMIT {
        entry.snapshots.remove(0);
    }
}

/// 任务持续时长（毫秒）。
fn duration_ms(state: &ExportTaskState) -> i64 {
    let end = state
        .end_time
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map_or_else(|| chrono::Utc::now().timestamp_millis(), |dt| dt.timestamp_millis());
    let start = state
        .start_time
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map_or(0, |dt| dt.timestamp_millis());
    end - start
}

/// 当前 ISO 时间字符串。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
