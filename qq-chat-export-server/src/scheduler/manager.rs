use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{Datelike, Local, TimeZone, Timelike};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::storage::DatabaseManager;

use super::cron::should_execute;

/// 执行历史保留上限（与 TS 一致）。
const HISTORY_LIMIT: usize = 100;

/// 单次导出执行结果（由执行器返回，管理器负责落库与状态归类）。
#[derive(Debug, Clone, Default)]
pub struct ExecutionOutcome {
    /// 消息数量。
    pub message_count: i64,
    /// 导出文件路径（无消息时为 `None`）。
    pub file_path: Option<String>,
    /// 文件大小（字节）。
    pub file_size: Option<i64>,
    /// 资源下载摘要（issue #363，`attempted`/`failed` 等字段的 JSON）。
    pub resource_summary: Option<Value>,
    /// 提示信息（如「指定时间范围内没有消息」）。
    pub note: Option<String>,
}

/// 定时导出执行器：给定任务配置与秒级时间范围，完成拉取 / 解析 / 导出。
#[async_trait]
pub trait ScheduledExportExecutor: Send + Sync {
    /// 执行导出，返回执行结果或错误描述。
    async fn execute(
        &self,
        task: &Value,
        start_time_sec: i64,
        end_time_sec: i64,
    ) -> Result<ExecutionOutcome, String>;
}

/// 定时导出管理器。
pub struct ScheduledExportManager {
    db: Arc<DatabaseManager>,
    executor: Arc<dyn ScheduledExportExecutor>,
    /// 任务配置（弱类型 JSON，与 TS 存储结构一致）。
    tasks: Mutex<HashMap<String, Value>>,
    /// 每个任务的 cron 调度句柄。
    cron_jobs: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    /// 内存中的执行历史（数据库为持久层）。
    history: Mutex<HashMap<String, Vec<Value>>>,
}

impl ScheduledExportManager {
    /// 创建管理器。
    pub fn new(db: Arc<DatabaseManager>, executor: Arc<dyn ScheduledExportExecutor>) -> Self {
        Self {
            db,
            executor,
            tasks: Mutex::new(HashMap::new()),
            cron_jobs: Mutex::new(HashMap::new()),
            history: Mutex::new(HashMap::new()),
        }
    }

    /// 初始化调度器：从数据库加载任务并启动全部启用的任务。
    pub async fn initialize(self: &Arc<Self>) {
        let stored = self.db.get_scheduled_exports().await;
        {
            let mut tasks = self.tasks.lock().await;
            for task in stored {
                if let Some(id) = task.get("id").and_then(Value::as_str) {
                    tasks.insert(id.to_string(), task.clone());
                }
            }
        }
        self.start_all_enabled_tasks().await;
    }

    /// 创建定时导出任务。
    pub async fn create_scheduled_export(self: &Arc<Self>, config: Value) -> Value {
        let now = now_iso();
        let id = format!("scheduled_{}_{}", now_millis(), random_suffix());
        let mut task = match config {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        task.insert("id".to_string(), json!(id));
        task.insert("createdAt".to_string(), json!(now));
        task.insert("updatedAt".to_string(), json!(now));
        let next_run = calculate_next_run(
            task.get("scheduleType").and_then(Value::as_str).unwrap_or("daily"),
            task.get("cronExpression").and_then(Value::as_str),
            task.get("executeTime").and_then(Value::as_str),
        );
        task.insert("nextRun".to_string(), json!(next_run));
        let task = Value::Object(task);

        {
            let mut tasks = self.tasks.lock().await;
            tasks.insert(id.clone(), task.clone());
        }
        self.save_task(&task).await;

        if task.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
            self.start_task(&id).await;
        }
        task
    }

    /// 更新定时导出任务（保持 `id`/`createdAt` 不变，重算 `nextRun` 并重新调度）。
    pub async fn update_scheduled_export(
        self: &Arc<Self>,
        id: &str,
        updates: Value,
    ) -> Option<Value> {
        let updated = {
            let mut tasks = self.tasks.lock().await;
            let existing = tasks.get(id)?.clone();
            let Value::Object(mut merged) = existing.clone() else {
                return None;
            };
            if let Value::Object(update_map) = updates {
                for (key, value) in update_map {
                    merged.insert(key, value);
                }
            }
            merged.insert("id".to_string(), json!(id));
            if let Some(created_at) = existing.get("createdAt") {
                merged.insert("createdAt".to_string(), created_at.clone());
            }
            merged.insert("updatedAt".to_string(), json!(now_iso()));
            let next_run = calculate_next_run(
                merged.get("scheduleType").and_then(Value::as_str).unwrap_or("daily"),
                merged.get("cronExpression").and_then(Value::as_str),
                merged.get("executeTime").and_then(Value::as_str),
            );
            merged.insert("nextRun".to_string(), json!(next_run));
            let merged = Value::Object(merged);
            tasks.insert(id.to_string(), merged.clone());
            merged
        };

        self.save_task(&updated).await;

        self.stop_task(id).await;
        if updated.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
            self.start_task(id).await;
        }
        Some(updated)
    }

    /// 删除定时导出任务。
    pub async fn delete_scheduled_export(&self, id: &str) -> bool {
        let removed = {
            let mut tasks = self.tasks.lock().await;
            tasks.remove(id).is_some()
        };
        if !removed {
            return false;
        }
        self.stop_task(id).await;
        self.history.lock().await.remove(id);
        if let Err(error) = self.db.delete_scheduled_export(id).await {
            tracing::warn!("Failed to delete scheduled task {id}: {error}");
        }
        true
    }

    /// 获取所有定时导出任务。
    pub async fn all_scheduled_exports(&self) -> Vec<Value> {
        self.tasks.lock().await.values().cloned().collect()
    }

    /// 获取指定的定时导出任务。
    pub async fn scheduled_export(&self, id: &str) -> Option<Value> {
        self.tasks.lock().await.get(id).cloned()
    }

    /// 手动触发定时导出任务。
    pub async fn trigger_scheduled_export(self: &Arc<Self>, id: &str) -> Option<Value> {
        let task = self.scheduled_export(id).await?;
        Some(self.execute_export_task(&task).await)
    }

    /// 一键触发所有定时导出任务（issue #445）。
    ///
    /// 默认只触发已启用的任务；任务在后台串行执行，避免并发争抢 NapCat 资源。
    /// 立即返回被排入执行的任务列表，实际结果通过执行历史查询。
    pub async fn trigger_all_scheduled_exports(
        self: &Arc<Self>,
        include_disabled: bool,
    ) -> Vec<Value> {
        let targets: Vec<Value> = {
            let tasks = self.tasks.lock().await;
            tasks
                .values()
                .filter(|task| {
                    include_disabled
                        || task.get("enabled").and_then(Value::as_bool).unwrap_or(false)
                })
                .cloned()
                .collect()
        };

        let manager = Arc::clone(self);
        let queue = targets.clone();
        tokio::spawn(async move {
            for task in queue {
                // 单个任务失败不影响后续任务，结果已记录在执行历史中。
                let _ = manager.execute_export_task(&task).await;
            }
        });

        targets
            .iter()
            .map(|task| {
                json!({
                    "id": task.get("id").cloned().unwrap_or(Value::Null),
                    "name": task.get("name").cloned().unwrap_or(Value::Null),
                })
            })
            .collect()
    }

    /// 获取任务执行历史。
    pub async fn execution_history(&self, scheduled_export_id: &str, limit: usize) -> Vec<Value> {
        self.db.get_execution_history(scheduled_export_id, limit).await
    }

    /// 关闭调度器：停止全部 cron 任务。
    pub async fn shutdown(&self) {
        let mut jobs = self.cron_jobs.lock().await;
        for (_, handle) in jobs.drain() {
            handle.abort();
        }
    }

    /// 启动所有启用的任务。
    async fn start_all_enabled_tasks(self: &Arc<Self>) {
        let ids: Vec<String> = {
            let tasks = self.tasks.lock().await;
            tasks
                .iter()
                .filter(|(_, task)| {
                    task.get("enabled").and_then(Value::as_bool).unwrap_or(false)
                })
                .map(|(id, _)| id.clone())
                .collect()
        };
        for id in ids {
            self.start_task(&id).await;
        }
    }

    /// 启动单个任务的 cron 循环（每分钟检查一次表达式命中）。
    async fn start_task(self: &Arc<Self>, id: &str) {
        self.stop_task(id).await;

        let Some(task) = self.scheduled_export(id).await else {
            return;
        };
        let cron_expression = build_cron_expression(&task);

        let manager = Arc::clone(self);
        let task_id = id.to_string();
        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                interval.tick().await;
                if should_execute(&cron_expression, &Local::now()) {
                    // 每次执行前取最新配置，保证任务更新后即刻生效。
                    if let Some(latest) = manager.scheduled_export(&task_id).await {
                        let _ = manager.execute_export_task(&latest).await;
                    }
                }
            }
        });

        let mut jobs = self.cron_jobs.lock().await;
        if let Some(previous) = jobs.insert(id.to_string(), handle) {
            previous.abort();
        }
    }

    /// 停止单个任务的 cron 循环。
    async fn stop_task(&self, id: &str) {
        let mut jobs = self.cron_jobs.lock().await;
        if let Some(handle) = jobs.remove(id) {
            handle.abort();
        }
    }

    /// 执行导出任务并记录执行历史。
    async fn execute_export_task(self: &Arc<Self>, task: &Value) -> Value {
        let start_millis = now_millis();
        let history_id = format!("history_{}_{}", start_millis, random_suffix());
        let task_id = task
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let mut history = Map::new();
        history.insert("id".to_string(), json!(history_id));
        history.insert("scheduledExportId".to_string(), json!(task_id));
        history.insert("executedAt".to_string(), json!(now_iso()));
        history.insert("status".to_string(), json!("failed"));
        history.insert("duration".to_string(), json!(0));

        let (start_time, end_time) = calculate_time_range(
            task.get("timeRangeType").and_then(Value::as_str).unwrap_or("yesterday"),
            task.get("customTimeRange"),
        );

        match self.executor.execute(task, start_time, end_time).await {
            Ok(outcome) => {
                // issue #363：有资源下载失败时状态降级为 partial。
                let failed_resources = outcome
                    .resource_summary
                    .as_ref()
                    .and_then(|summary| summary.get("failed"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let status = if failed_resources > 0 { "partial" } else { "success" };
                history.insert("status".to_string(), json!(status));
                history.insert("messageCount".to_string(), json!(outcome.message_count));
                if let Some(file_path) = outcome.file_path {
                    history.insert("filePath".to_string(), json!(file_path));
                }
                if let Some(file_size) = outcome.file_size {
                    history.insert("fileSize".to_string(), json!(file_size));
                }
                if let Some(summary) = outcome.resource_summary {
                    history.insert("resourceSummary".to_string(), summary);
                }
                if let Some(note) = outcome.note {
                    history.insert("error".to_string(), json!(note));
                }

                // 更新任务的上次 / 下次执行时间。
                let updated_task = {
                    let mut tasks = self.tasks.lock().await;
                    tasks.get_mut(&task_id).map(|stored| {
                        if let Value::Object(map) = stored {
                            map.insert("lastRun".to_string(), json!(now_iso()));
                            let next_run = calculate_next_run(
                                map.get("scheduleType")
                                    .and_then(Value::as_str)
                                    .unwrap_or("daily"),
                                map.get("cronExpression").and_then(Value::as_str),
                                map.get("executeTime").and_then(Value::as_str),
                            );
                            map.insert("nextRun".to_string(), json!(next_run));
                        }
                        stored.clone()
                    })
                };
                if let Some(updated) = updated_task {
                    self.save_task(&updated).await;
                }
            }
            Err(error) => {
                history.insert("status".to_string(), json!("failed"));
                history.insert("error".to_string(), json!(error));
            }
        }

        history.insert(
            "duration".to_string(),
            json!(now_millis() - start_millis),
        );
        let history = Value::Object(history);

        // 内存历史（保留最近 100 条）。
        {
            let mut all_history = self.history.lock().await;
            let entries = all_history.entry(task_id.clone()).or_default();
            entries.push(history.clone());
            if entries.len() > HISTORY_LIMIT {
                let overflow = entries.len() - HISTORY_LIMIT;
                entries.drain(0..overflow);
            }
        }

        // 持久化历史。
        if let Err(error) = self.db.save_execution_history(&history).await {
            tracing::warn!("Failed to save execution history: {error}");
        }
        history
    }

    /// 保存任务到数据库（静默处理错误，与 TS 一致）。
    async fn save_task(&self, task: &Value) {
        if let Err(error) = self.db.save_scheduled_export(task).await {
            tracing::warn!("Failed to save scheduled task: {error}");
        }
    }
}

/// 根据任务配置构造 cron 表达式（与 TS `startTask` 一致）。
fn build_cron_expression(task: &Value) -> String {
    let schedule_type = task
        .get("scheduleType")
        .and_then(Value::as_str)
        .unwrap_or("daily");
    if schedule_type == "custom" {
        if let Some(expr) = task.get("cronExpression").and_then(Value::as_str) {
            if !expr.is_empty() {
                return expr.to_string();
            }
        }
    }
    let (hour, minute) = parse_execute_time(task.get("executeTime").and_then(Value::as_str));
    match schedule_type {
        "weekly" => format!("{minute} {hour} * * 1"),
        "monthly" => format!("{minute} {hour} 1 * *"),
        _ => format!("{minute} {hour} * * *"),
    }
}

/// 解析 `HH:mm` 执行时间（默认 02:00）。
fn parse_execute_time(execute_time: Option<&str>) -> (u32, u32) {
    let raw = execute_time.unwrap_or("02:00");
    let mut parts = raw.split(':');
    let hour = parts
        .next()
        .and_then(|p| p.parse::<u32>().ok())
        .unwrap_or(2)
        .min(23);
    let minute = parts
        .next()
        .and_then(|p| p.parse::<u32>().ok())
        .unwrap_or(0)
        .min(59);
    (hour, minute)
}

/// 计算下次执行时间（ISO 字符串，与 TS `calculateNextRun` 语义一致）。
fn calculate_next_run(
    schedule_type: &str,
    cron_expression: Option<&str>,
    execute_time: Option<&str>,
) -> String {
    let now = Local::now();
    if schedule_type == "custom" && cron_expression.is_some() {
        // TS 简单实现：自定义 cron 直接返回 24 小时后。
        return to_iso(now + chrono::Duration::days(1));
    }
    let (hour, minute) = parse_execute_time(execute_time);
    let today = now.date_naive();
    let candidate = today.and_hms_opt(hour, minute, 0).unwrap_or_else(|| {
        today
            .and_hms_opt(2, 0, 0)
            .unwrap_or_else(|| now.naive_local())
    });
    let mut next = Local
        .from_local_datetime(&candidate)
        .earliest()
        .unwrap_or(now);
    if next <= now {
        next = match schedule_type {
            "weekly" => next + chrono::Duration::days(7),
            "monthly" => add_one_month(next),
            _ => next + chrono::Duration::days(1),
        };
    }
    to_iso(next)
}

/// 加一个月（JS `setMonth(+1)` 语义：日期溢出时顺延）。
fn add_one_month(dt: chrono::DateTime<Local>) -> chrono::DateTime<Local> {
    let (year, month) = if dt.month() == 12 {
        (dt.year() + 1, 1)
    } else {
        (dt.year(), dt.month() + 1)
    };
    let mut day = dt.day();
    loop {
        if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
            let naive = date
                .and_hms_opt(dt.hour(), dt.minute(), dt.second())
                .unwrap_or_else(|| date.and_hms_opt(0, 0, 0).unwrap_or(dt.naive_local()));
            if let Some(result) = Local.from_local_datetime(&naive).earliest() {
                return result;
            }
        }
        if day == 1 {
            return dt + chrono::Duration::days(30);
        }
        day -= 1;
    }
}

/// 计算时间范围（返回秒级时间戳，与 TS `calculateTimeRange` 一致）。
fn calculate_time_range(time_range_type: &str, custom: Option<&Value>) -> (i64, i64) {
    let now_ms = now_millis();
    let now = Local::now();
    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    match time_range_type {
        "yesterday" => {
            let yesterday = now.date_naive() - chrono::Duration::days(1);
            let start = local_midnight_millis(yesterday);
            let end = start + DAY_MS - 1;
            (start / 1000, end / 1000)
        }
        "last-week" => {
            let last_week = now.date_naive() - chrono::Duration::days(7);
            let start = local_midnight_millis(last_week);
            let end = start + 7 * DAY_MS - 1;
            (start / 1000, end / 1000)
        }
        "last-month" => {
            let (year, month) = if now.month() == 1 {
                (now.year() - 1, 12)
            } else {
                (now.year(), now.month() - 1)
            };
            let start_date =
                chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(now.date_naive());
            let start = local_midnight_millis(start_date);
            let this_month_start =
                chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
                    .unwrap_or(now.date_naive());
            let end = local_midnight_millis(this_month_start) - 1;
            (start / 1000, end / 1000)
        }
        "last-7-days" => ((now_ms - 7 * DAY_MS) / 1000, now_ms / 1000),
        "last-30-days" => ((now_ms - 30 * DAY_MS) / 1000, now_ms / 1000),
        "custom" => {
            if let Some(range) = custom {
                let start_offset = range.get("startTime").and_then(Value::as_i64);
                let end_offset = range.get("endTime").and_then(Value::as_i64);
                if let (Some(start_offset), Some(end_offset)) = (start_offset, end_offset) {
                    return (
                        (now_ms + start_offset * 1000) / 1000,
                        (now_ms + end_offset * 1000) / 1000,
                    );
                }
            }
            calculate_time_range("yesterday", None)
        }
        _ => calculate_time_range("yesterday", None),
    }
}

/// 本地时区某日零点的毫秒时间戳。
fn local_midnight_millis(date: chrono::NaiveDate) -> i64 {
    date.and_hms_opt(0, 0, 0)
        .and_then(|naive| Local.from_local_datetime(&naive).earliest())
        .map_or(0, |dt| dt.timestamp_millis())
}

/// 当前毫秒时间戳。
fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 当前 ISO 时间字符串。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 本地时间转 ISO 字符串。
fn to_iso(dt: chrono::DateTime<Local>) -> String {
    dt.with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 随机 9 位后缀（对应 TS `Math.random().toString(36).substr(2, 9)`）。
fn random_suffix() -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0x9e37_79b9, |d| u64::from(d.subsec_nanos()) ^ (d.as_secs() << 17));
    (0..9)
        .map(|_| {
            // xorshift64
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            CHARS[(seed % 36) as usize] as char
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("qce-scheduler-test-{nonce}"));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct RecordingExecutor {
        executed: Mutex<Vec<String>>,
        fail_id: Option<String>,
    }

    #[async_trait]
    impl ScheduledExportExecutor for RecordingExecutor {
        async fn execute(
            &self,
            task: &Value,
            _start_time_sec: i64,
            _end_time_sec: i64,
        ) -> Result<ExecutionOutcome, String> {
            let id = task
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            self.executed.lock().await.push(id.clone());
            if self.fail_id.as_deref() == Some(id.as_str()) {
                Err("boom".to_owned())
            } else {
                Ok(ExecutionOutcome::default())
            }
        }
    }

    async fn manager(
        fail_id: Option<&str>,
    ) -> (TestDir, Arc<ScheduledExportManager>, Arc<RecordingExecutor>) {
        let temp = TestDir::new();
        let db = Arc::new(DatabaseManager::new(&temp.0.join("qce.db")));
        db.initialize().await.expect("initialize database");
        let executor = Arc::new(RecordingExecutor {
            executed: Mutex::new(Vec::new()),
            fail_id: fail_id.map(str::to_owned),
        });
        let manager = Arc::new(ScheduledExportManager::new(
            db,
            Arc::clone(&executor) as Arc<dyn ScheduledExportExecutor>,
        ));
        (temp, manager, executor)
    }

    async fn install_tasks(manager: &ScheduledExportManager) {
        manager.tasks.lock().await.extend([
            (
                "a".to_owned(),
                json!({
                    "id": "a",
                    "name": "task-a",
                    "enabled": true,
                    "timeRangeType": "yesterday"
                }),
            ),
            (
                "b".to_owned(),
                json!({
                    "id": "b",
                    "name": "task-b",
                    "enabled": false,
                    "timeRangeType": "yesterday"
                }),
            ),
            (
                "c".to_owned(),
                json!({
                    "id": "c",
                    "name": "task-c",
                    "enabled": true,
                    "timeRangeType": "yesterday"
                }),
            ),
        ]);
    }

    async fn wait_for_executions(executor: &RecordingExecutor, expected: usize) -> Vec<String> {
        for _ in 0..100 {
            let executed = executor.executed.lock().await.clone();
            if executed.len() >= expected {
                return executed;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        executor.executed.lock().await.clone()
    }

    #[tokio::test]
    async fn trigger_all_defaults_to_enabled_tasks() {
        let (_temp, manager, executor) = manager(None).await;
        install_tasks(&manager).await;

        let mut triggered = manager.trigger_all_scheduled_exports(false).await;
        triggered.sort_by_key(|task| task["id"].as_str().unwrap_or_default().to_owned());
        assert_eq!(
            triggered,
            vec![
                json!({ "id": "a", "name": "task-a" }),
                json!({ "id": "c", "name": "task-c" }),
            ]
        );

        let mut executed = wait_for_executions(&executor, 2).await;
        executed.sort();
        assert_eq!(executed, vec!["a", "c"]);
    }

    #[tokio::test]
    async fn trigger_all_includes_disabled_and_continues_after_failure() {
        let (_temp, manager, executor) = manager(Some("a")).await;
        install_tasks(&manager).await;

        let triggered = manager.trigger_all_scheduled_exports(true).await;
        assert_eq!(triggered.len(), 3);

        let mut executed = wait_for_executions(&executor, 3).await;
        executed.sort();
        assert_eq!(executed, vec!["a", "b", "c"]);
    }
}
