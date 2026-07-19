use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::export_debug::ExportDebugTrace;
use crate::resource::circuit_breaker::CircuitBreaker;
use crate::resource::health::{ResourceHealthChecker, RESOURCE_HEALTH_CACHE_MS};
use crate::storage::{DatabaseManager, ResourceInfo};

/// 健康检查过期阈值（6 小时）。
const RESOURCE_HEALTH_STALE_MS: i64 = 6 * 60 * 60 * 1000;
/// 每轮健康检查的批大小。
const RESOURCE_HEALTH_BATCH_SIZE: usize = 50;

/// 图片/语音走 NT 本地缓存或 CDN 直链，正常几秒内完成；超过该时长基本
/// 可判定为卡死，不必等满配置的完整超时。视频/文件可能很大，仍用配置值。
const SMALL_MEDIA_TIMEOUT_MS: u64 = 15000;

/// 命中完整下载超时的资源最多尝试的总次数（含首次）：吃满超时的下载几乎
/// 不会在重试中成功，而每次重试都要再付出一个完整超时窗口，会拖长导出尾部。
const MAX_TIMEOUT_ATTEMPTS: u32 = 2;

/// 资源处理配置。
#[derive(Debug, Clone)]
pub struct ResourceHandlerConfig {
    /// 资源存储根目录。
    pub storage_root: PathBuf,
    /// 下载超时（毫秒）。
    pub download_timeout_ms: u64,
    /// 最大并发下载数。
    pub max_concurrent_downloads: usize,
    /// 最大重试次数。
    pub max_retries: u32,
    /// 熔断阈值（连续严重失败次数）。
    pub circuit_breaker_threshold: u32,
    /// 熔断恢复时间（毫秒）。
    pub circuit_breaker_recovery_time_ms: u64,
    /// 健康检查间隔（毫秒）。
    pub health_check_interval_ms: u64,
    /// 是否启用本地缓存。
    pub enable_local_cache: bool,
    /// 缓存清理阈值（天）。
    pub cache_cleanup_threshold_days: i64,
    /// 是否把 SILK 语音转码成浏览器原生支持的音频（issue #306）。
    pub transcode_silk_to_browser_audio: bool,
}

impl Default for ResourceHandlerConfig {
    fn default() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_or_else(|_| PathBuf::from("."), PathBuf::from);
        Self {
            storage_root: home.join(".qq-chat-exporter").join("resources"),
            download_timeout_ms: 30000,
            max_concurrent_downloads: 8,
            max_retries: 5,
            circuit_breaker_threshold: 20,
            circuit_breaker_recovery_time_ms: 60000,
            health_check_interval_ms: 600_000,
            enable_local_cache: true,
            cache_cleanup_threshold_days: 30,
            transcode_silk_to_browser_audio: true,
        }
    }
}

/// 媒体下载抽象。
///
/// 由 NapCat bridge 客户端实现：返回下载完成后的文件路径（可能为空字符串，
/// 表示 API 返回空路径），错误以人类可读消息返回供熔断器分类。
#[async_trait]
pub trait MediaDownloader: Send + Sync {
    /// 下载消息元素对应的媒体文件。
    async fn download_media(
        &self,
        msg_id: &str,
        chat_type: i64,
        peer_uid: &str,
        element_id: &str,
        dest_path: &str,
        timeout_ms: u64,
    ) -> Result<String, String>;
}

/// SILK → 浏览器原生音频转码抽象（issue #306）。
#[async_trait]
pub trait SilkTranscoder: Send + Sync {
    /// 输出扩展名，不含前导点。
    fn target_extension(&self) -> &'static str;
    /// 输出 MIME 类型。
    fn target_mime_type(&self) -> &'static str;
    /// 转码；成功返回 true。失败返回 false 时调用方保留原始 SILK 文件。
    async fn transcode(&self, silk_path: &Path, output_path: &Path) -> bool;
}

/// 资源下载进度。
#[derive(Debug, Clone, Serialize)]
pub struct ResourceProgress {
    /// 需要下载的总数。
    pub total: usize,
    /// 已完成数。
    pub completed: usize,
    /// 失败数。
    pub failed: usize,
    /// 当前文件名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    /// 人类可读进度消息。
    pub message: String,
}

/// 进度回调类型。
pub type ResourceProgressCallback = Arc<dyn Fn(ResourceProgress) + Send + Sync>;

/// 单次 `process_message_resources` 调用的资源摘要（issue #363）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBatchSummary {
    /// 命中的总资源条数。
    pub attempted: usize,
    /// 无需重新下载的条数。
    pub already_available: usize,
    /// 实际新下载完成的条数。
    pub downloaded: usize,
    /// 下载失败的条数。
    pub failed: usize,
    /// 主动跳过的条数（issue #341）。
    pub skipped: usize,
    /// 失败资源的简短样本（最多 5 个）。
    pub failed_samples: Vec<String>,
}

/// 进度计数器。
#[derive(Debug, Default)]
struct ProgressCounters {
    total: usize,
    completed: usize,
    failed: usize,
}

/// 下载任务。
struct DownloadTask {
    resource: Arc<Mutex<ResourceInfo>>,
    msg_id: String,
    chat_type: i64,
    peer_uid: String,
    element_id: String,
    element: Value,
    priority: i64,
}

/// 单个资源的初始状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InitialState {
    Available,
    Skipped,
    Pending,
}

/// 资源处理器主类。
pub struct ResourceHandler {
    downloader: Arc<dyn MediaDownloader>,
    silk_transcoder: Option<Arc<dyn SilkTranscoder>>,
    db: Arc<DatabaseManager>,
    config: ResourceHandlerConfig,
    circuit_breaker: CircuitBreaker,
    health_checker: ResourceHealthChecker,
    skip_download_types: Mutex<HashSet<String>>,
    progress_callback: Mutex<Option<ResourceProgressCallback>>,
    progress: Mutex<ProgressCounters>,
    last_batch_summary: Mutex<ResourceBatchSummary>,
    download_semaphore: Arc<Semaphore>,
    is_downloading: std::sync::atomic::AtomicBool,
    health_check_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pending_downloads: std::sync::atomic::AtomicUsize,
}

impl ResourceHandler {
    /// 创建处理器并确保存储目录存在。
    pub async fn new(
        downloader: Arc<dyn MediaDownloader>,
        silk_transcoder: Option<Arc<dyn SilkTranscoder>>,
        db: Arc<DatabaseManager>,
        config: ResourceHandlerConfig,
    ) -> Self {
        let handler = Self {
            downloader,
            silk_transcoder,
            db,
            circuit_breaker: CircuitBreaker::new(
                config.circuit_breaker_threshold,
                config.circuit_breaker_recovery_time_ms,
            ),
            health_checker: ResourceHealthChecker::new(),
            skip_download_types: Mutex::new(HashSet::new()),
            progress_callback: Mutex::new(None),
            progress: Mutex::new(ProgressCounters::default()),
            last_batch_summary: Mutex::new(ResourceBatchSummary::default()),
            download_semaphore: Arc::new(Semaphore::new(config.max_concurrent_downloads.max(1))),
            is_downloading: std::sync::atomic::AtomicBool::new(false),
            health_check_handle: Mutex::new(None),
            pending_downloads: std::sync::atomic::AtomicUsize::new(0),
            config,
        };
        handler.ensure_storage_directories().await;
        handler
    }

    /// 启动定期健康检查任务。
    pub async fn start_health_check(self: &Arc<Self>) {
        let mut guard = self.health_check_handle.lock().await;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
        let handler = Arc::clone(self);
        let interval_ms = self.config.health_check_interval_ms;
        *guard = Some(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(interval_ms.max(1000)));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                interval.tick().await;
                handler.perform_scheduled_health_check().await;
            }
        }));
    }

    /// 设置进度回调。
    pub async fn set_progress_callback(&self, callback: Option<ResourceProgressCallback>) {
        *self.progress_callback.lock().await = callback;
    }

    /// 配置需要跳过下载的资源类型（issue #341）。
    pub async fn set_skip_download_types(&self, types: Option<&[String]>) {
        let mut skip = self.skip_download_types.lock().await;
        skip.clear();
        if let Some(types) = types {
            skip.extend(types.iter().cloned());
        }
    }

    /// 触发进度回调。
    async fn emit_progress(&self, current: Option<String>) {
        let callback = { self.progress_callback.lock().await.clone() };
        let Some(callback) = callback else {
            return;
        };
        let (total, completed, failed) = {
            let progress = self.progress.lock().await;
            (progress.total, progress.completed, progress.failed)
        };
        if total == 0 {
            return;
        }
        let remaining = total.saturating_sub(completed).saturating_sub(failed);
        let mut message = format!("下载资源 {completed}/{total}");
        if remaining > 0 {
            message.push_str(&format!(" (剩余 {remaining})"));
        }
        if failed > 0 {
            message.push_str(&format!(" (失败 {failed})"));
        }
        callback(ResourceProgress {
            total,
            completed,
            failed,
            current,
            message,
        });
    }

    /// 批量处理消息中的资源，返回 msgId → 资源列表。
    pub async fn process_message_resources(
        self: &Arc<Self>,
        messages: &[Value],
    ) -> HashMap<String, Vec<ResourceInfo>> {
        self.process_message_resources_with_cancel(messages, Arc::new(AtomicBool::new(false)))
            .await
    }

    /// 批量处理消息资源，并在取消信号触发后停止排队及在途下载。
    pub async fn process_message_resources_with_cancel(
        self: &Arc<Self>,
        messages: &[Value],
        cancel_flag: Arc<AtomicBool>,
    ) -> HashMap<String, Vec<ResourceInfo>> {
        self.process_message_resources_with_cancel_and_trace(messages, cancel_flag, None)
            .await
    }

    /// 批量处理消息资源，并把资源排队、调用耗时及重试结果写入可选调试轨迹。
    pub async fn process_message_resources_with_cancel_and_trace(
        self: &Arc<Self>,
        messages: &[Value],
        cancel_flag: Arc<AtomicBool>,
        debug_trace: Option<ExportDebugTrace>,
    ) -> HashMap<String, Vec<ResourceInfo>> {
        {
            let mut progress = self.progress.lock().await;
            *progress = ProgressCounters::default();
        }
        {
            let mut summary = self.last_batch_summary.lock().await;
            *summary = ResourceBatchSummary::default();
        }

        let mut resource_refs: HashMap<String, Vec<Arc<Mutex<ResourceInfo>>>> = HashMap::new();
        let mut all_resources: Vec<(Arc<Mutex<ResourceInfo>>, InitialState)> = Vec::new();
        let mut tasks: Vec<DownloadTask> = Vec::new();

        for message in messages {
            if cancel_flag.load(Ordering::SeqCst) {
                break;
            }
            let msg_id = str_field(message, "msgId").unwrap_or_default().to_string();
            let chat_type = message.get("chatType").and_then(Value::as_i64).unwrap_or(0);
            let peer_uid = str_field(message, "peerUid")
                .unwrap_or_default()
                .to_string();
            let Some(elements) = message.get("elements").and_then(Value::as_array) else {
                continue;
            };
            let mut resources_for_message: Vec<Arc<Mutex<ResourceInfo>>> = Vec::new();

            for element in elements {
                if cancel_flag.load(Ordering::SeqCst) {
                    break;
                }
                if !is_media_element(element) {
                    continue;
                }
                let Some((mut resource, initial)) = self.process_element(element).await else {
                    continue;
                };
                if initial == InitialState::Pending {
                    let element_id = str_field(element, "elementId")
                        .unwrap_or_default()
                        .to_string();
                    resource.status = "pending".to_string();
                    let shared = Arc::new(Mutex::new(resource));
                    tasks.push(DownloadTask {
                        resource: Arc::clone(&shared),
                        msg_id: msg_id.clone(),
                        chat_type,
                        peer_uid: peer_uid.clone(),
                        element_id,
                        element: element.clone(),
                        priority: calculate_priority(&*shared.lock().await),
                    });
                    resources_for_message.push(Arc::clone(&shared));
                    all_resources.push((shared, initial));
                } else {
                    let shared = Arc::new(Mutex::new(resource));
                    resources_for_message.push(Arc::clone(&shared));
                    all_resources.push((shared, initial));
                }
            }

            if !resources_for_message.is_empty() && !msg_id.is_empty() {
                resource_refs.insert(msg_id, resources_for_message);
            }
        }

        // 设置进度总数并按优先级下载
        {
            let mut progress = self.progress.lock().await;
            progress.total = tasks.len();
        }
        if !tasks.is_empty() {
            self.emit_progress(None).await;
            self.run_downloads(tasks, cancel_flag, debug_trace).await;
        }

        // 计算本批次摘要（issue #363）
        {
            let mut summary = self.last_batch_summary.lock().await;
            for (resource, initial) in &all_resources {
                summary.attempted += 1;
                let resource = resource.lock().await;
                match initial {
                    InitialState::Skipped => summary.skipped += 1,
                    InitialState::Available | InitialState::Pending => {
                        let ok = resource.status == "downloaded" && resource.accessible;
                        if ok {
                            if *initial == InitialState::Available {
                                summary.already_available += 1;
                            } else {
                                summary.downloaded += 1;
                            }
                        } else {
                            summary.failed += 1;
                            if summary.failed_samples.len() < 5 {
                                let sample = resource
                                    .file_name
                                    .clone()
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or_else(|| {
                                        if resource.md5.is_empty() {
                                            "unknown".to_string()
                                        } else {
                                            resource.md5.clone()
                                        }
                                    });
                                summary.failed_samples.push(sample);
                            }
                        }
                    }
                }
            }
        }

        // 输出最终资源快照
        let mut result: HashMap<String, Vec<ResourceInfo>> = HashMap::new();
        for (msg_id, resources) in resource_refs {
            let mut list = Vec::with_capacity(resources.len());
            for resource in resources {
                list.push(resource.lock().await.clone());
            }
            result.insert(msg_id, list);
        }
        result
    }

    /// 读取上一次批处理摘要（issue #363）。
    pub async fn last_batch_summary(&self) -> ResourceBatchSummary {
        self.last_batch_summary.lock().await.clone()
    }

    /// 处理单个媒体元素：提取信息、合并缓存、健康检查、判定初始状态并写库。
    async fn process_element(&self, element: &Value) -> Option<(ResourceInfo, InitialState)> {
        let base = extract_resource_info(element)?;
        let mut resource = self.merge_with_cached_resource(base).await;

        let local_path = resource
            .local_path
            .clone()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| self.generate_local_path(&resource));
        resource.local_path = Some(local_path);

        let healthy = self
            .health_checker
            .check_health(&resource, false, RESOURCE_HEALTH_CACHE_MS)
            .await;
        resource.accessible = healthy;
        resource.checked_at = serde_json::json!(now_iso());
        let initial = if healthy {
            resource.status = "downloaded".to_string();
            resource.last_error = None;
            InitialState::Available
        } else if self
            .skip_download_types
            .lock()
            .await
            .contains(&resource.resource_type)
        {
            // Issue #341: 命中跳过类型的资源不入下载队列，仅保留元数据。
            resource.status = "skipped".to_string();
            resource.accessible = false;
            resource.local_path = Some(String::new());
            InitialState::Skipped
        } else {
            resource.status = "pending".to_string();
            InitialState::Pending
        };

        if let Err(error) = self.db.save_resource_info(&resource).await {
            tracing::warn!("保存资源信息失败: {error}");
        }
        Some((resource, initial))
    }

    /// 与数据库缓存记录合并。
    async fn merge_with_cached_resource(&self, resource: ResourceInfo) -> ResourceInfo {
        if resource.md5.is_empty() {
            return resource;
        }
        let Some(cached) = self.db.get_resource_by_md5(&resource.md5).await else {
            return resource;
        };
        let mut merged = resource;
        if merged.file_size.unwrap_or(0) == 0 {
            merged.file_size = cached.file_size;
        }
        if merged.mime_type.as_deref().unwrap_or("").is_empty() {
            merged.mime_type = cached.mime_type;
        }
        if cached.local_path.as_deref().is_some_and(|p| !p.is_empty()) {
            merged.local_path = cached.local_path;
        }
        merged.accessible = cached.accessible;
        merged.checked_at = cached.checked_at;
        if !cached.status.is_empty() {
            merged.status = cached.status;
        }
        merged.download_attempts = Some(
            cached
                .download_attempts
                .unwrap_or(0)
                .max(merged.download_attempts.unwrap_or(0)),
        );
        if cached.last_error.is_some() {
            merged.last_error = cached.last_error;
        }
        merged
    }

    /// 生成本地存储路径（复数目录名：image → images）。
    fn generate_local_path(&self, resource: &ResourceInfo) -> String {
        let type_dir = format!("{}s", resource.resource_type);
        let file_name = resource.file_name.as_deref().unwrap_or("unknown");
        let full_name = if resource.md5.is_empty() {
            file_name.to_string()
        } else {
            format!("{}_{}", resource.md5, file_name)
        };
        self.config
            .storage_root
            .join(type_dir)
            .join(full_name)
            .to_string_lossy()
            .into_owned()
    }

    /// 并发执行下载任务（Semaphore 限流 + 优先级排序 + 指数退避重试）。
    async fn run_downloads(
        self: &Arc<Self>,
        mut tasks: Vec<DownloadTask>,
        cancel_flag: Arc<AtomicBool>,
        debug_trace: Option<ExportDebugTrace>,
    ) {
        tasks.sort_by_key(|task| std::cmp::Reverse(task.priority));
        self.is_downloading
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.pending_downloads
            .store(tasks.len(), std::sync::atomic::Ordering::SeqCst);

        let mut join_set: JoinSet<()> = JoinSet::new();
        for task in tasks {
            let handler = Arc::clone(self);
            let task_cancel_flag = Arc::clone(&cancel_flag);
            let task_debug_trace = debug_trace.clone();
            join_set.spawn(async move {
                handler
                    .execute_download_with_retries(
                        &task,
                        task_cancel_flag.as_ref(),
                        task_debug_trace.as_ref(),
                    )
                    .await;
                handler.pending_downloads.fetch_sub(1, Ordering::SeqCst);
            });
        }
        loop {
            tokio::select! {
                result = join_set.join_next() => {
                    if result.is_none() {
                        break;
                    }
                }
                () = wait_for_cancellation(cancel_flag.as_ref()) => {
                    join_set.abort_all();
                    while join_set.join_next().await.is_some() {}
                    break;
                }
            }
        }
        self.pending_downloads.store(0, Ordering::SeqCst);
        self.is_downloading.store(false, Ordering::SeqCst);
    }

    /// 带重试的下载执行。
    async fn execute_download_with_retries(
        &self,
        task: &DownloadTask,
        cancel_flag: &AtomicBool,
        debug_trace: Option<&ExportDebugTrace>,
    ) {
        let mut retries: u32 = 0;
        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                return;
            }
            let queued_at = Instant::now();
            let permit = tokio::select! {
                result = self.download_semaphore.acquire() => result.ok(),
                () = wait_for_cancellation(cancel_flag) => None,
            };
            let Some(permit) = permit else {
                return;
            };
            let attempt = retries + 1;
            let (resource_type, file_name) = {
                let resource = task.resource.lock().await;
                (
                    resource.resource_type.clone(),
                    resource.file_name.clone().unwrap_or_default(),
                )
            };
            if let Some(trace) = debug_trace {
                trace
                    .record(serde_json::json!({
                        "type": "resource_attempt_started",
                        "messageId": task.msg_id,
                        "elementId": task.element_id,
                        "resourceType": resource_type,
                        "fileName": file_name,
                        "attempt": attempt,
                        "queueWaitMs": queued_at.elapsed().as_millis(),
                        "timeoutMs": effective_download_timeout_ms(
                            &resource_type,
                            self.config.download_timeout_ms,
                        ),
                    }))
                    .await;
            }
            let started_at = Instant::now();
            let result = tokio::select! {
                result = self.execute_download_once(task) => result,
                () = wait_for_cancellation(cancel_flag) => return,
            };
            drop(permit);
            match result {
                Ok(()) => {
                    if let Some(trace) = debug_trace {
                        trace
                            .record(serde_json::json!({
                                "type": "resource_attempt_finished",
                                "messageId": task.msg_id,
                                "elementId": task.element_id,
                                "resourceType": resource_type,
                                "fileName": file_name,
                                "attempt": attempt,
                                "durationMs": started_at.elapsed().as_millis(),
                                "outcome": "downloaded",
                            }))
                            .await;
                    }
                    let file_name = { task.resource.lock().await.file_name.clone() };
                    {
                        let mut progress = self.progress.lock().await;
                        progress.completed += 1;
                    }
                    self.emit_progress(file_name).await;
                    return;
                }
                Err(error_message) => {
                    retries += 1;
                    let (retriable, skipped) = {
                        let mut resource = task.resource.lock().await;
                        resource.download_attempts =
                            Some(resource.download_attempts.unwrap_or(0) + 1);
                        if is_non_retriable_error(&error_message) {
                            resource.status = "skipped".to_string();
                            resource.last_error = Some(format!("已跳过：{error_message}"));
                            (false, true)
                        } else {
                            resource.status = "failed".to_string();
                            resource.last_error = Some(error_message.clone());
                            (is_retriable_error(&error_message), false)
                        }
                    };
                    if let Some(trace) = debug_trace {
                        trace
                            .record(serde_json::json!({
                                "type": "resource_attempt_finished",
                                "messageId": task.msg_id,
                                "elementId": task.element_id,
                                "resourceType": resource_type,
                                "fileName": file_name,
                                "attempt": attempt,
                                "durationMs": started_at.elapsed().as_millis(),
                                "outcome": if retriable { "retry" } else if skipped { "skipped" } else { "failed" },
                                "error": error_message,
                            }))
                            .await;
                    }
                    {
                        let resource = task.resource.lock().await.clone();
                        if let Err(error) = self.db.save_resource_info(&resource).await {
                            tracing::warn!("保存资源信息失败: {error}");
                        }
                    }
                    let attempt_limit = if is_timeout_error(&error_message) {
                        MAX_TIMEOUT_ATTEMPTS.min(self.config.max_retries)
                    } else {
                        self.config.max_retries
                    };
                    if retriable && retries < attempt_limit {
                        // 指数退避：1s, 2s, 4s, ... 上限 10s
                        let delay_ms = (1000u64 << (retries.saturating_sub(1)).min(10)).min(10000);
                        tokio::select! {
                            () = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                            () = wait_for_cancellation(cancel_flag) => return,
                        }
                        continue;
                    }
                    let mut progress = self.progress.lock().await;
                    if skipped {
                        progress.completed += 1;
                    } else {
                        progress.failed += 1;
                    }
                    drop(progress);
                    self.emit_progress(None).await;
                    return;
                }
            }
        }
    }

    /// 单次下载执行（含熔断准入、音频扩展名规范化与 SILK 转码）。
    async fn execute_download_once(&self, task: &DownloadTask) -> Result<(), String> {
        self.circuit_breaker.before_execute().await?;

        let result = self.download_resource(task).await;
        match result {
            Ok(mut file_path) => {
                self.circuit_breaker.on_success().await;
                let resource_type = { task.resource.lock().await.resource_type.clone() };
                if !file_path.is_empty() && resource_type == "audio" {
                    // issue #285：按 magic bytes 规范化音频扩展名
                    let mut resource = task.resource.lock().await;
                    file_path = normalize_audio_file_extension(&file_path, &mut resource).await;
                    // issue #306：SILK 转成浏览器原生音频，让 HTML 可直接播放
                    if self.config.transcode_silk_to_browser_audio
                        && file_path.to_lowercase().ends_with(".silk")
                    {
                        if let Some(transcoder) = &self.silk_transcoder {
                            file_path = maybe_transcode_silk_for_browser(
                                transcoder.as_ref(),
                                &file_path,
                                &mut resource,
                            )
                            .await;
                        }
                    }
                }
                {
                    let mut resource = task.resource.lock().await;
                    resource.local_path = Some(file_path);
                    resource.accessible = true;
                    resource.status = "downloaded".to_string();
                    resource.checked_at = serde_json::json!(now_iso());
                }
                let resource = task.resource.lock().await.clone();
                if let Err(error) = self.db.save_resource_info(&resource).await {
                    tracing::warn!("保存资源信息失败: {error}");
                }
                Ok(())
            }
            Err(error_message) => {
                self.circuit_breaker.on_failure(&error_message).await;
                Err(error_message)
            }
        }
    }

    /// 下载资源。
    async fn download_resource(&self, task: &DownloadTask) -> Result<String, String> {
        let (local_path, resource_type, expected_size) = {
            let resource = task.resource.lock().await;
            let local_path = resource
                .local_path
                .clone()
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| self.generate_local_path(&resource));
            (
                local_path,
                resource.resource_type.clone(),
                resource.file_size.unwrap_or(0),
            )
        };

        if let Some(parent) = Path::new(&local_path).parent() {
            if let Err(error) = tokio::fs::create_dir_all(parent).await {
                return Err(format!("创建目录失败: {error}"));
            }
        }

        if file_matches_expected_size(&local_path, expected_size).await {
            return Ok(local_path);
        }
        if let Some(source_path) = element_source_path(&task.element) {
            if file_matches_expected_size(&source_path, expected_size).await {
                if source_path == local_path {
                    return Ok(local_path);
                }
                if tokio::fs::copy(&source_path, &local_path).await.is_ok()
                    && file_matches_expected_size(&local_path, expected_size).await
                {
                    return Ok(local_path);
                }
                return Ok(source_path);
            }
        }

        let timeout_ms =
            effective_download_timeout_ms(&resource_type, self.config.download_timeout_ms);
        let download = self.downloader.download_media(
            &task.msg_id,
            task.chat_type,
            &task.peer_uid,
            &task.element_id,
            &local_path,
            timeout_ms,
        );
        let downloaded_path = tokio::time::timeout(Duration::from_millis(timeout_ms), download)
            .await
            .map_err(|_| {
                enhance_download_error(&resource_type, &format!("timeout after {timeout_ms}ms"))
            })?
            .map_err(|error| enhance_download_error(&resource_type, &error))?;

        if downloaded_path.trim().is_empty() {
            // 尝试检查本地路径是否已有文件
            if file_size_positive(&local_path).await {
                return Ok(local_path);
            }
            // 回退到元素自带的源路径
            let source_path = element_source_path(&task.element);
            if let Some(source_path) = source_path {
                if tokio::fs::metadata(&source_path).await.is_ok() {
                    if source_path != local_path
                        && tokio::fs::copy(&source_path, &local_path).await.is_ok()
                        && tokio::fs::metadata(&local_path).await.is_ok()
                    {
                        return Ok(local_path);
                    }
                    return Ok(source_path);
                }
            }
            return Err(enhance_download_error(
                &resource_type,
                &format!("{resource_type}资源API返回空路径且无法找到有效的下载文件"),
            ));
        }

        match tokio::fs::metadata(&downloaded_path).await {
            Ok(metadata) => {
                if metadata.len() == 0 {
                    return Err(enhance_download_error(&resource_type, "下载的文件为空"));
                }
                if downloaded_path != local_path {
                    if tokio::fs::copy(&downloaded_path, &local_path).await.is_ok()
                        && tokio::fs::metadata(&local_path).await.is_ok()
                    {
                        return Ok(local_path);
                    }
                    return Ok(downloaded_path);
                }
                Ok(downloaded_path)
            }
            Err(_) => Err(enhance_download_error(
                &resource_type,
                &format!("{resource_type}资源未下载到预期位置: {downloaded_path}"),
            )),
        }
    }

    /// 执行定期健康检查。
    async fn perform_scheduled_health_check(&self) {
        if self
            .is_downloading
            .load(std::sync::atomic::Ordering::SeqCst)
            || self
                .pending_downloads
                .load(std::sync::atomic::Ordering::SeqCst)
                > 0
        {
            return;
        }
        let cutoff_ms = now_ms() - RESOURCE_HEALTH_STALE_MS;
        let resources = self
            .db
            .get_resources_needing_health_check(cutoff_ms, RESOURCE_HEALTH_BATCH_SIZE)
            .await;
        for mut resource in resources {
            let healthy = self
                .health_checker
                .check_health(&resource, false, RESOURCE_HEALTH_CACHE_MS)
                .await;
            resource.checked_at = serde_json::json!(now_iso());
            resource.accessible = healthy;
            if !healthy && resource.status == "downloaded" {
                resource.status = "failed".to_string();
            } else if healthy {
                resource.status = "downloaded".to_string();
                resource.last_error = None;
            }
            if let Err(error) = self.db.save_resource_info(&resource).await {
                tracing::warn!("保存资源信息失败: {error}");
            }
        }
    }

    /// 确保存储目录存在。
    async fn ensure_storage_directories(&self) {
        let subdirs = ["image", "video", "audio", "file"];
        if let Err(error) = tokio::fs::create_dir_all(&self.config.storage_root).await {
            tracing::warn!("创建资源根目录失败: {error}");
        }
        for subdir in subdirs {
            let dir = self.config.storage_root.join(subdir);
            if let Err(error) = tokio::fs::create_dir_all(&dir).await {
                tracing::warn!("创建资源目录失败: {} - {error}", dir.display());
            }
        }
    }

    /// 获取统计信息。
    pub async fn statistics(&self) -> Value {
        let stats = self.db.get_resource_statistics().await;
        serde_json::json!({
            "totalResources": stats.get("total").cloned().unwrap_or_default(),
            "downloadedResources": stats.get("downloaded").cloned().unwrap_or_default(),
            "failedResources": stats.get("failed").cloned().unwrap_or_default(),
            "pendingDownloads": self.pending_downloads.load(std::sync::atomic::Ordering::SeqCst),
            "activeDownloads": self.config.max_concurrent_downloads
                .saturating_sub(self.download_semaphore.available_permits()),
            "circuitBreakerStatus": self.circuit_breaker.status().await,
        })
    }

    /// 清理资源：停止健康检查任务并清空缓存。
    pub async fn cleanup(&self) {
        if let Some(handle) = self.health_check_handle.lock().await.take() {
            handle.abort();
        }
        self.health_checker.cleanup().await;
    }

    /// 清理过期缓存文件。
    pub async fn cleanup_expired_cache(&self) {
        if !self.config.enable_local_cache {
            return;
        }
        let cutoff_ms = now_ms() - self.config.cache_cleanup_threshold_days * 24 * 60 * 60 * 1000;
        let expired = self.db.get_resources_older_than(cutoff_ms).await;
        for resource in expired {
            if let Some(local_path) = resource.local_path.as_deref().filter(|p| !p.is_empty()) {
                let _ = tokio::fs::remove_file(local_path).await;
            }
        }
        if let Err(error) = self.db.delete_expired_resources(cutoff_ms).await {
            tracing::warn!("删除过期资源记录失败: {error}");
        }
    }
}

/// 读取字符串字段。
fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// 判断是否为媒体元素（直接检查元素属性）。
fn is_media_element(element: &Value) -> bool {
    ["picElement", "videoElement", "pttElement", "fileElement"]
        .iter()
        .any(|key| element.get(*key).is_some_and(|v| !v.is_null()))
}

/// 从消息元素提取资源信息。
fn extract_resource_info(element: &Value) -> Option<ResourceInfo> {
    let now = now_ms();
    if let Some(pic) = element.get("picElement").filter(|v| !v.is_null()) {
        let file_name = str_field(pic, "fileName")
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("image_{now}.jpg"), ToString::to_string);
        let mime = pic
            .get("picType")
            .and_then(Value::as_i64)
            .map_or("image/jpeg", mime_type_from_pic_type);
        return Some(base_resource(
            "image",
            str_field(pic, "sourcePath").unwrap_or(""),
            file_name,
            loose_i64(pic.get("fileSize")),
            mime,
            str_field(pic, "md5HexStr").unwrap_or("").to_string(),
        ));
    }
    if let Some(video) = element.get("videoElement").filter(|v| !v.is_null()) {
        let file_name = str_field(video, "fileName")
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("video_{now}.mp4"), ToString::to_string);
        // 从文件名中提取 MD5（通常格式为 {md5}.mp4）
        let md5_from_file_name = strip_video_extension(&file_name);
        let md5 = str_field(video, "md5HexStr")
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .or(if md5_from_file_name.is_empty() {
                None
            } else {
                Some(md5_from_file_name)
            })
            .or_else(|| {
                str_field(video, "fileUuid")
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string)
            })
            .unwrap_or_default();
        return Some(base_resource(
            "video",
            "",
            file_name,
            loose_i64(video.get("fileSize")),
            "video/mp4",
            md5,
        ));
    }
    if let Some(ptt) = element.get("pttElement").filter(|v| !v.is_null()) {
        let file_name = str_field(ptt, "fileName")
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("audio_{now}.wav"), ToString::to_string);
        return Some(base_resource(
            "audio",
            "",
            file_name,
            loose_i64(ptt.get("fileSize")),
            "audio/wav",
            str_field(ptt, "md5HexStr").unwrap_or("").to_string(),
        ));
    }
    if let Some(file) = element.get("fileElement").filter(|v| !v.is_null()) {
        let file_name = str_field(file, "fileName")
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("file_{now}"), ToString::to_string);
        return Some(base_resource(
            "file",
            "",
            file_name,
            loose_i64(file.get("fileSize")),
            "application/octet-stream",
            str_field(file, "fileMd5").unwrap_or("").to_string(),
        ));
    }
    None
}

/// 构造基础资源信息。
fn base_resource(
    resource_type: &str,
    original_url: &str,
    file_name: String,
    file_size: i64,
    mime_type: &str,
    md5: String,
) -> ResourceInfo {
    ResourceInfo {
        md5,
        resource_type: resource_type.to_string(),
        original_url: original_url.to_string(),
        local_path: None,
        file_name: Some(file_name),
        file_size: Some(file_size),
        mime_type: Some(mime_type.to_string()),
        accessible: false,
        status: "pending".to_string(),
        checked_at: serde_json::json!(now_iso()),
        download_attempts: Some(0),
        last_error: None,
        extra: serde_json::Map::new(),
    }
}

/// 宽松读取整数，`fileSize` 可以是字符串或数字。
fn loose_i64(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

/// 去掉视频扩展名（.mp4 / .avi / .mov / .mkv，大小写不敏感）。
fn strip_video_extension(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    for ext in [".mp4", ".avi", ".mov", ".mkv"] {
        if lower.ends_with(ext) {
            return file_name[..file_name.len() - ext.len()].to_string();
        }
    }
    file_name.to_string()
}

/// 计算下载优先级（图片最高、小文件加分）。
fn calculate_priority(resource: &ResourceInfo) -> i64 {
    let mut priority: i64 = match resource.resource_type.as_str() {
        "image" => 100,
        "audio" => 50,
        "video" => 30,
        _ => 10,
    };
    let file_size = resource.file_size.unwrap_or(0);
    if file_size < 1024 * 1024 {
        priority += 20;
    } else if file_size < 10 * 1024 * 1024 {
        priority += 10;
    }
    priority
}

/// 按资源类型取有效下载超时：图片/语音用较短超时，视频/文件用配置值。
fn effective_download_timeout_ms(resource_type: &str, configured_ms: u64) -> u64 {
    match resource_type {
        "video" | "file" => configured_ms,
        _ => configured_ms.min(SMALL_MEDIA_TIMEOUT_MS),
    }
}

/// 判断是否为下载超时错误（含桥接调用超时）。
fn is_timeout_error(error_message: &str) -> bool {
    error_message.contains("下载超时") || error_message.to_lowercase().contains("timeout")
}

/// 判断是否为可重试的错误。
fn is_retriable_error(error_message: &str) -> bool {
    const RETRIABLE: [&str; 11] = [
        "timeout",
        "connect",
        "network",
        "temporary",
        "server error",
        "500",
        "502",
        "503",
        "504",
        "econnreset",
        "econnrefused",
    ];
    let lower = error_message.to_lowercase();
    RETRIABLE.iter().any(|pattern| lower.contains(pattern))
}

/// 判断是否为明确不可重试的错误。
fn is_non_retriable_error(error_message: &str) -> bool {
    const NON_RETRIABLE: [&str; 10] = [
        "404",
        "403",
        "401",
        "not found",
        "forbidden",
        "unauthorized",
        "invalid url",
        "malformed",
        "file exists",
        "disk quota",
    ];
    let lower = error_message.to_lowercase();
    NON_RETRIABLE.iter().any(|pattern| lower.contains(pattern))
}

/// 根据错误类型生成更具体的错误信息。
fn enhance_download_error(resource_type: &str, error_message: &str) -> String {
    let mut enhanced = format!("{resource_type}资源下载失败");
    if error_message.contains("空路径") {
        enhanced.push_str("：下载API返回空路径，可能是文件不存在或权限问题");
    } else if error_message.contains("文件为空") {
        enhanced.push_str("：下载的文件为空，可能是网络问题或文件损坏");
    } else if error_message.contains("预期位置") {
        enhanced.push_str("：文件未下载到预期位置，可能是权限问题");
    } else if error_message.to_lowercase().contains("timeout") || error_message.contains("超时") {
        enhanced.push_str("：下载超时，可能是网络问题或文件过大");
    }
    format!("{enhanced}: {error_message}")
}

/// 获取元素自带的源路径（下载 API 返回空路径时的回退）。
fn element_source_path(element: &Value) -> Option<String> {
    for (container, key) in [
        ("picElement", "sourcePath"),
        ("videoElement", "filePath"),
        ("fileElement", "filePath"),
        ("pttElement", "filePath"),
    ] {
        if let Some(path) = element
            .get(container)
            .and_then(|v| v.get(key))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return Some(path.to_string());
        }
    }
    None
}

/// PicType → MIME 类型映射。
fn mime_type_from_pic_type(pic_type: i64) -> &'static str {
    match pic_type {
        1001 => "image/png",
        1002 => "image/webp",
        1003 => "image/bmp",
        1004 => "image/tiff",
        1005 => "image/gif",
        _ => "image/jpeg",
    }
}

/// issue #285：根据 magic bytes 识别音频真实编码并规范化扩展名。
async fn normalize_audio_file_extension(file_path: &str, resource: &mut ResourceInfo) -> String {
    let original = file_path.to_string();
    let Ok(metadata) = tokio::fs::metadata(file_path).await else {
        return original;
    };
    if !metadata.is_file() || metadata.len() < 4 {
        return original;
    }
    let header = match read_file_header(file_path, 16).await {
        Ok(header) if header.len() >= 4 => header,
        _ => return original,
    };

    let Some((real_ext, real_mime)) = detect_audio_format(&header) else {
        return original;
    };

    let current_ext = Path::new(file_path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if current_ext == real_ext {
        resource.mime_type = Some(real_mime.to_string());
        return original;
    }

    let base_no_ext = if current_ext.is_empty() {
        file_path.to_string()
    } else {
        file_path[..file_path.len() - current_ext.len()].to_string()
    };
    let new_path = format!("{base_no_ext}{real_ext}");
    if tokio::fs::metadata(&new_path).await.is_ok() {
        let _ = tokio::fs::remove_file(&new_path).await;
    }
    if let Err(error) = tokio::fs::rename(file_path, &new_path).await {
        tracing::warn!("修正音频扩展名失败 {file_path} → {new_path}: {error}");
        return original;
    }

    if let Some(file_name) = resource.file_name.clone().filter(|s| !s.is_empty()) {
        let fn_ext = Path::new(&file_name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        let fn_base = if fn_ext.is_empty() {
            file_name.clone()
        } else {
            file_name[..file_name.len() - fn_ext.len()].to_string()
        };
        resource.file_name = Some(format!("{fn_base}{real_ext}"));
    } else {
        resource.file_name = Path::new(&new_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());
    }
    resource.mime_type = Some(real_mime.to_string());
    new_path
}

/// 读取文件头部若干字节。
async fn read_file_header(path: &str, len: usize) -> std::io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0u8; len];
    let mut read_total = 0;
    while read_total < len {
        let read = file.read(&mut buffer[read_total..]).await?;
        if read == 0 {
            break;
        }
        read_total += read;
    }
    buffer.truncate(read_total);
    Ok(buffer)
}

/// 按 magic bytes 识别音频格式（SILK / AMR / WAV / MP3 / OGG）。
fn detect_audio_format(buf: &[u8]) -> Option<(&'static str, &'static str)> {
    const SILK_SIG: &[u8] = b"#!SILK_V3";
    const AMR_NB_SIG: &[u8] = b"#!AMR\n";
    const AMR_WB_SIG: &[u8] = b"#!AMR-WB\n";

    let is_silk = buf.starts_with(SILK_SIG)
        || (buf.len() > SILK_SIG.len() && buf[0] == 0x02 && buf[1..].starts_with(SILK_SIG));
    if is_silk {
        return Some((".silk", "audio/silk"));
    }
    if buf.starts_with(AMR_NB_SIG) || buf.starts_with(AMR_WB_SIG) {
        return Some((".amr", "audio/amr"));
    }
    if buf.len() >= 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WAVE" {
        return Some((".wav", "audio/wav"));
    }
    let is_mp3 = buf.starts_with(b"ID3")
        || (buf.len() >= 2
            && buf[0] == 0xFF
            && (buf[1] == 0xFB || buf[1] == 0xF3 || buf[1] == 0xF2));
    if is_mp3 {
        return Some((".mp3", "audio/mpeg"));
    }
    if buf.starts_with(b"OggS") {
        return Some((".ogg", "audio/ogg"));
    }
    None
}

/// issue #306：把 SILK 文件转码成浏览器原生音频并切换资源记录。
async fn maybe_transcode_silk_for_browser(
    transcoder: &dyn SilkTranscoder,
    silk_path: &str,
    resource: &mut ResourceInfo,
) -> String {
    let ext = Path::new(silk_path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let base_no_ext = if ext.is_empty() {
        silk_path.to_string()
    } else {
        silk_path[..silk_path.len() - ext.len()].to_string()
    };
    let target_extension = transcoder.target_extension();
    let output_path = format!("{base_no_ext}.{target_extension}");

    if !file_size_positive(&output_path).await {
        let ok = transcoder
            .transcode(Path::new(silk_path), Path::new(&output_path))
            .await;
        if !ok {
            return silk_path.to_string();
        }
    }
    if !file_size_positive(&output_path).await {
        return silk_path.to_string();
    }

    if let Some(file_name) = resource.file_name.clone().filter(|s| !s.is_empty()) {
        let fn_ext = Path::new(&file_name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let fn_base = if fn_ext.is_empty() {
            file_name.clone()
        } else {
            file_name[..file_name.len() - fn_ext.len()].to_string()
        };
        resource.file_name = Some(format!("{fn_base}.{target_extension}"));
    } else {
        resource.file_name = Path::new(&output_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());
    }
    resource.mime_type = Some(transcoder.target_mime_type().to_string());
    if let Ok(metadata) = tokio::fs::metadata(&output_path).await {
        resource.file_size = Some(i64::try_from(metadata.len()).unwrap_or(i64::MAX));
    }
    output_path
}

/// 检查文件存在且大小大于 0。
async fn file_size_positive(path: &str) -> bool {
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|metadata| metadata.len() > 0)
}

/// 检查本地文件是否存在、非空，并在有预期大小时验证大小一致。
async fn file_matches_expected_size(path: &str, expected_size: i64) -> bool {
    tokio::fs::metadata(path).await.is_ok_and(|metadata| {
        let actual_size = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
        actual_size > 0 && (expected_size <= 0 || actual_size == expected_size)
    })
}

/// 等待原子取消标记，供 `tokio::select!` 中止排队、重试和在途 RPC。
async fn wait_for_cancellation(cancel_flag: &AtomicBool) {
    while !cancel_flag.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// 当前毫秒时间戳。
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 当前 ISO 时间字符串。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;
    use tokio::sync::{mpsc, Notify};

    use super::*;

    struct RetrySlotDownloader {
        attempts: AtomicUsize,
        events: mpsc::UnboundedSender<&'static str>,
        release_first_attempt: Notify,
    }

    #[async_trait]
    impl MediaDownloader for RetrySlotDownloader {
        async fn download_media(
            &self,
            _msg_id: &str,
            _chat_type: i64,
            _peer_uid: &str,
            element_id: &str,
            _dest_path: &str,
            _timeout_ms: u64,
        ) -> Result<String, String> {
            if element_id == "retry" {
                let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
                if attempt == 0 {
                    let _ = self.events.send("retry");
                    self.release_first_attempt.notified().await;
                    return Err("timeout".to_string());
                }
                return Err("404".to_string());
            }
            let _ = self.events.send("next");
            Err("packet cant get video url".to_string())
        }
    }

    struct AlwaysTimeoutDownloader {
        attempts: AtomicUsize,
    }

    #[async_trait]
    impl MediaDownloader for AlwaysTimeoutDownloader {
        async fn download_media(
            &self,
            _msg_id: &str,
            _chat_type: i64,
            _peer_uid: &str,
            _element_id: &str,
            _dest_path: &str,
            timeout_ms: u64,
        ) -> Result<String, String> {
            self.attempts.fetch_add(1, Ordering::SeqCst);
            Err(format!("timeout after {timeout_ms}ms"))
        }
    }

    fn download_task(element_id: &str, file_name: &str) -> DownloadTask {
        DownloadTask {
            resource: Arc::new(Mutex::new(base_resource(
                "image",
                "",
                file_name.to_string(),
                0,
                "image/jpeg",
                String::new(),
            ))),
            msg_id: format!("msg-{element_id}"),
            chat_type: 2,
            peer_uid: "peer".to_string(),
            element_id: element_id.to_string(),
            element: json!({ "picElement": { "fileName": file_name } }),
            priority: 100,
        }
    }

    #[tokio::test]
    async fn retry_backoff_releases_download_slot() {
        let root = std::env::temp_dir().join(format!("qce-retry-slot-{}", uuid::Uuid::new_v4()));
        let (events, mut event_rx) = mpsc::unbounded_channel();
        let downloader = Arc::new(RetrySlotDownloader {
            attempts: AtomicUsize::new(0),
            events,
            release_first_attempt: Notify::new(),
        });
        let db = Arc::new(DatabaseManager::new(&root.join("qce.db")));
        let handler = Arc::new(
            ResourceHandler::new(
                downloader.clone(),
                None,
                db,
                ResourceHandlerConfig {
                    storage_root: root,
                    max_concurrent_downloads: 1,
                    max_retries: 2,
                    ..ResourceHandlerConfig::default()
                },
            )
            .await,
        );
        let cancel_flag = Arc::new(AtomicBool::new(false));

        let retry_handle = {
            let handler = Arc::clone(&handler);
            let cancel_flag = Arc::clone(&cancel_flag);
            tokio::spawn(async move {
                handler
                    .execute_download_with_retries(
                        &download_task("retry", "retry.jpg"),
                        cancel_flag.as_ref(),
                        None,
                    )
                    .await;
            })
        };
        assert_eq!(event_rx.recv().await, Some("retry"));

        let next_handle = {
            let handler = Arc::clone(&handler);
            let cancel_flag = Arc::clone(&cancel_flag);
            tokio::spawn(async move {
                handler
                    .execute_download_with_retries(
                        &download_task("next", "next.jpg"),
                        cancel_flag.as_ref(),
                        None,
                    )
                    .await;
            })
        };
        downloader.release_first_attempt.notify_one();

        let next_event = tokio::time::timeout(Duration::from_millis(250), event_rx.recv())
            .await
            .expect("next resource should start while the first resource backs off");
        assert_eq!(next_event, Some("next"));

        cancel_flag.store(true, Ordering::SeqCst);
        retry_handle.await.expect("retry task should exit cleanly");
        next_handle.await.expect("next task should exit cleanly");
    }

    #[test]
    fn small_media_uses_short_timeout_but_large_media_keeps_configured() {
        assert_eq!(effective_download_timeout_ms("image", 30000), 15000);
        assert_eq!(effective_download_timeout_ms("audio", 30000), 15000);
        assert_eq!(effective_download_timeout_ms("video", 30000), 30000);
        assert_eq!(effective_download_timeout_ms("file", 30000), 30000);
        assert_eq!(effective_download_timeout_ms("image", 10000), 10000);
    }

    #[tokio::test]
    async fn timed_out_download_is_retried_at_most_once() {
        let root = std::env::temp_dir().join(format!("qce-timeout-cap-{}", uuid::Uuid::new_v4()));
        let downloader = Arc::new(AlwaysTimeoutDownloader {
            attempts: AtomicUsize::new(0),
        });
        let db = Arc::new(DatabaseManager::new(&root.join("qce.db")));
        let handler = ResourceHandler::new(
            downloader.clone(),
            None,
            db,
            ResourceHandlerConfig {
                storage_root: root,
                ..ResourceHandlerConfig::default()
            },
        )
        .await;
        let cancel_flag = AtomicBool::new(false);

        handler
            .execute_download_with_retries(&download_task("stuck", "stuck.jpg"), &cancel_flag, None)
            .await;

        assert_eq!(
            downloader.attempts.load(Ordering::SeqCst),
            MAX_TIMEOUT_ATTEMPTS as usize
        );
    }

    #[test]
    fn napcat_api_shape_failures_are_not_retried() {
        assert!(!is_retriable_error(
            "Cannot read properties of undefined (reading 'FetchRkey')"
        ));
        assert!(!is_retriable_error(
            "Cannot read properties of undefined (reading 'GetGroupVideoUrl')"
        ));
        assert!(!is_retriable_error("packet cant get video url"));
    }
}
