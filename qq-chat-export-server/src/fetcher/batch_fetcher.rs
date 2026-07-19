use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::fetcher::chat_type::is_private_like_chat_type;

/// issue #305 / #316：自适应缩小后的 batchSize 下限。
const MIN_BATCH_SIZE_ON_TIMEOUT: i64 = 200;

/// 缩小后的 batchSize 连续成功该次数后翻倍回升（不超过配置值）。
const BATCH_SIZE_RECOVERY_SUCCESSES: u32 = 3;

/// 分页批次之间的间隔（本地 IPC 调用，仅留出让路空隙）。
const INTER_BATCH_DELAY_MS: u64 = 20;

/// 聊天对象（对应 NapCat `Peer`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// 会话类型（1 好友 / 2 群聊 / 100 临时会话等）。
    pub chat_type: i64,
    /// 对端 uid。
    pub peer_uid: String,
    /// 冗余 uin（可选）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_id: Option<String>,
}

/// 消息类型筛选项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTypeFilter {
    /// NTMsgType 数值。
    pub r#type: i64,
    /// 子类型列表。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_types: Option<Vec<i64>>,
}

/// 消息筛选条件。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageFilter {
    /// 起始时间（毫秒时间戳）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    /// 结束时间（毫秒时间戳）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
    /// 发送者 uid 白名单。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_uids: Option<Vec<String>>,
    /// 消息类型白名单。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_types: Option<Vec<MessageTypeFilter>>,
    /// 关键词（对 elements JSON 做大小写不敏感包含匹配）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
}

/// 批量获取配置。
#[derive(Debug, Clone)]
pub struct BatchFetchConfig {
    /// 每批次获取数量（建议 1000-10000）。
    pub batch_size: i64,
    /// 超时时间（毫秒）。
    pub timeout_ms: u64,
    /// 重试次数。
    pub retry_count: u32,
    /// 重试间隔（毫秒）。
    pub retry_interval_ms: u64,
    /// 是否启用优化模式。
    pub enable_optimization: bool,
}

impl Default for BatchFetchConfig {
    fn default() -> Self {
        Self {
            batch_size: 5000,
            timeout_ms: 30000,
            retry_count: 3,
            retry_interval_ms: 1000,
            enable_optimization: true,
        }
    }
}

/// 批量获取结果。
#[derive(Debug, Clone, Default)]
pub struct BatchFetchResult {
    /// 本批消息（NapCat RawMessage 原始 JSON）。
    pub messages: Vec<Value>,
    /// 是否还有更多。
    pub has_more: bool,
    /// 下一批起始消息 ID。
    pub next_message_id: Option<String>,
    /// 下一批起始序列号。
    pub next_seq: Option<String>,
    /// 客户端筛选后的实际条数。
    pub actual_count: usize,
    /// 本次获取耗时（毫秒）。
    pub fetch_time_ms: i64,
    /// 本批最早消息时间（毫秒）。
    pub earliest_msg_time: Option<i64>,
}

/// API 调用统计。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCallStats {
    /// 调用总数。
    pub call_count: u64,
    /// 成功次数。
    pub success_count: u64,
    /// 失败次数。
    pub failure_count: u64,
    /// 平均响应时间（毫秒）。
    pub average_response_time: f64,
    /// 连续失败次数。
    pub consecutive_failures: u64,
}

/// 获取器错误。
#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    /// 获取器忙。
    #[error("批量获取器正忙，请稍后再试")]
    Busy,
    /// 操作已被取消。
    #[error("操作已被取消")]
    Cancelled,
    /// API 调用超时。
    #[error("API调用超时 ({0}ms)")]
    Timeout(u64),
    /// 底层 API 错误。
    #[error("{0}")]
    Api(String),
}

impl FetchError {
    /// 判断错误是否属于 API 超时（TS `isTimeoutError`）。
    fn is_timeout(&self) -> bool {
        match self {
            Self::Timeout(_) => true,
            Self::Api(message) => {
                let lower = message.to_lowercase();
                lower.contains("timeout") || message.contains("API调用超时")
            }
            _ => false,
        }
    }
}

/// NapCat 消息获取 API 抽象（由 bridge 客户端实现）。
#[async_trait]
pub trait MessageFetchApi: Send + Sync {
    /// 获取最新消息（对应 `MsgApi.getAioFirstViewLatestMsgs`）。
    /// 返回值需包含 `msgList` 数组。
    async fn get_aio_first_view_latest_msgs(
        &self,
        peer: &Peer,
        count: i64,
    ) -> Result<Value, String>;

    /// 从指定消息向前获取历史消息（对应 `MsgApi.getMsgHistory`，reverse=true）。
    async fn get_msg_history(&self, peer: &Peer, msg_id: &str, count: i64)
        -> Result<Value, String>;

    /// 按序列号范围获取消息（对应 `getMsgService().getMsgsBySeqRange`）。
    async fn get_msgs_by_seq_range(
        &self,
        peer: &Peer,
        start_seq: &str,
        end_seq: &str,
    ) -> Result<Value, String>;
}

/// 获取策略。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchStrategy {
    /// 基于时间范围的顺序获取。
    TimeBasedSequential,
    /// 基于序列号的范围获取。
    SequenceBasedRange,
    /// 混合策略（动态选择）。
    Hybrid,
}

/// 内部可变状态。
#[derive(Debug)]
struct FetcherState {
    batch_size: i64,
    consecutive_successes: u32,
    stats: ApiCallStats,
    current_strategy: FetchStrategy,
}

/// 批量消息获取器。
pub struct BatchMessageFetcher {
    api: Arc<dyn MessageFetchApi>,
    config: BatchFetchConfig,
    state: Mutex<FetcherState>,
    is_fetching: AtomicBool,
    cancelled: AtomicBool,
}

impl BatchMessageFetcher {
    /// 创建获取器。
    pub fn new(api: Arc<dyn MessageFetchApi>, config: BatchFetchConfig) -> Self {
        let batch_size = config.batch_size;
        Self {
            api,
            config,
            state: Mutex::new(FetcherState {
                batch_size,
                consecutive_successes: 0,
                stats: ApiCallStats::default(),
                current_strategy: FetchStrategy::Hybrid,
            }),
            is_fetching: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        }
    }

    /// 当前使用的获取策略。
    pub async fn current_strategy(&self) -> FetchStrategy {
        self.state.lock().await.current_strategy
    }

    /// 抓取序列起点：重置取消标记（issue #446 —— 取消标记只在序列起点重置，
    /// 避免分页过程中的 cancel() 被下一批次清掉）。
    pub fn reset_cancel_token(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
    }

    /// 取消当前获取操作。
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// 当前抓取是否已被取消（issue #446）。
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 是否正在获取中。
    #[must_use]
    pub fn is_busy(&self) -> bool {
        self.is_fetching.load(Ordering::SeqCst)
    }

    /// 获取当前统计信息。
    pub async fn stats(&self) -> ApiCallStats {
        self.state.lock().await.stats.clone()
    }

    /// 重置统计信息。
    pub async fn reset_stats(&self) {
        self.state.lock().await.stats = ApiCallStats::default();
    }

    /// 批量获取消息（主要外部接口，支持筛选与分页）。
    pub async fn fetch_messages(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        start_message_id: Option<&str>,
        start_seq: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        if self
            .is_fetching
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(FetchError::Busy);
        }
        // RAII 守卫：任何返回路径都会复位 is_fetching。
        struct FetchGuard<'a>(&'a AtomicBool);
        impl Drop for FetchGuard<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _guard = FetchGuard(&self.is_fetching);

        let start_time = now_ms();
        let strategy = self.select_optimal_strategy(filter, peer);
        {
            let mut state = self.state.lock().await;
            state.current_strategy = strategy;
        }
        tracing::info!("[BatchMessageFetcher] 选择策略: {strategy:?}, 开始执行获取");

        let result = self
            .execute_strategy(strategy, peer, filter, start_message_id, start_seq)
            .await;
        match result {
            Ok(mut batch) => {
                tracing::info!(
                    "[BatchMessageFetcher] 策略执行完成, 获取{}条消息",
                    batch.messages.len()
                );
                let fetch_time = now_ms() - start_time;
                self.update_stats(true, fetch_time).await;
                batch.fetch_time_ms = fetch_time;
                Ok(batch)
            }
            Err(error) => {
                self.update_stats(false, 0).await;
                Err(error)
            }
        }
    }

    /// 分页拉取：给定上一批结果拉取下一批；首批传 `None`。
    ///
    /// TS 的 `fetchAllMessagesInTimeRange` AsyncGenerator 在 Rust 侧的等价物：
    /// 调用方用 while-let 循环驱动，返回 `Ok(None)` 表示分页结束。
    pub async fn fetch_next_batch(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        previous: Option<&BatchFetchResult>,
    ) -> Result<Option<BatchFetchResult>, FetchError> {
        match previous {
            None => {
                // 抓取序列起点重置取消标记（issue #446）。
                self.reset_cancel_token();
            }
            Some(prev) => {
                if !prev.has_more || self.is_cancelled() {
                    return Ok(None);
                }
                // 避免过于频繁的 API 调用。
                tokio::time::sleep(Duration::from_millis(INTER_BATCH_DELAY_MS)).await;
            }
        }
        if self.is_cancelled() {
            return Ok(None);
        }

        let (next_message_id, next_seq) = previous.map_or((None, None), |prev| {
            (prev.next_message_id.clone(), prev.next_seq.clone())
        });
        let result = self
            .fetch_messages(
                peer,
                filter,
                next_message_id.as_deref(),
                next_seq.as_deref(),
            )
            .await?;

        // 防御性提前停止：客户端筛选后为空且批次最早时间早于开始时间，无需继续回溯。
        if result.messages.is_empty() {
            if let (Some(earliest), Some(start_time)) =
                (result.earliest_msg_time, filter.start_time)
            {
                if earliest < start_time {
                    return Ok(None);
                }
            }
            if !result.has_more {
                return Ok(None);
            }
        }
        Ok(Some(result))
    }

    /// 根据筛选条件和性能情况选择最优的获取策略。
    fn select_optimal_strategy(&self, filter: &MessageFilter, peer: &Peer) -> FetchStrategy {
        // 单聊型会话（含好友、临时会话、服务号、频道私聊等，issue #365）
        // 直接使用最简单可靠的方法。
        if is_private_like_chat_type(Some(peer.chat_type)) {
            tracing::debug!(
                "策略选择: 单聊使用基础getMsgHistory方法, 对等体={}, chatType={}",
                peer.peer_uid,
                peer.chat_type
            );
            return FetchStrategy::TimeBasedSequential;
        }
        if !self.config.enable_optimization {
            return FetchStrategy::TimeBasedSequential;
        }
        // 暂时统一使用基础方法，避免不同版本的复杂 API 差异。
        let _ = filter;
        FetchStrategy::TimeBasedSequential
    }

    /// 执行指定的获取策略。
    async fn execute_strategy(
        &self,
        strategy: FetchStrategy,
        peer: &Peer,
        filter: &MessageFilter,
        start_message_id: Option<&str>,
        start_seq: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        match strategy {
            FetchStrategy::TimeBasedSequential => {
                self.fetch_by_time_based_sequential(peer, filter, start_message_id)
                    .await
            }
            FetchStrategy::SequenceBasedRange => {
                self.fetch_by_sequence_range(peer, filter, start_seq).await
            }
            FetchStrategy::Hybrid => {
                self.fetch_by_hybrid_strategy(peer, filter, start_message_id, start_seq)
                    .await
            }
        }
    }

    /// 基于时间的顺序获取策略。
    async fn fetch_by_time_based_sequential(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        start_message_id: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        tracing::info!(
            "[BatchMessageFetcher] 时间筛选参数: 原始={:?}-{:?}",
            filter.start_time,
            filter.end_time
        );

        let api = Arc::clone(&self.api);
        let peer_clone = peer.clone();
        let start_message_id_owned = start_message_id.map(ToString::to_string);
        let result = self
            .call_with_retry(move |batch_size| {
                let api = Arc::clone(&api);
                let peer = peer_clone.clone();
                let start_message_id = start_message_id_owned.clone();
                async move {
                    match start_message_id {
                        None => {
                            tracing::info!(
                                "[BatchMessageFetcher] 调用 getAioFirstViewLatestMsgs API, count={batch_size}"
                            );
                            api.get_aio_first_view_latest_msgs(&peer, batch_size).await
                        }
                        Some(msg_id) => {
                            tracing::info!(
                                "[BatchMessageFetcher] 调用 getMsgHistory API, msgId={msg_id}, count={batch_size}"
                            );
                            api.get_msg_history(&peer, &msg_id, batch_size).await
                        }
                    }
                }
            })
            .await?;

        let mut batch = process_api_result(result, Some(filter), start_message_id);
        batch.messages = apply_client_side_filter(batch.messages, filter);
        batch.actual_count = batch.messages.len();
        Ok(batch)
    }

    /// 基于序列号范围的获取策略。
    async fn fetch_by_sequence_range(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        start_seq: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        let start_seq = match start_seq {
            Some(seq) => seq.to_string(),
            None => {
                let mut latest = self
                    .api
                    .get_aio_first_view_latest_msgs(peer, 1)
                    .await
                    .map_err(FetchError::Api)?;
                let first = latest
                    .get_mut("msgList")
                    .and_then(Value::as_array_mut)
                    .and_then(|messages| {
                        if messages.is_empty() {
                            None
                        } else {
                            Some(messages.remove(0))
                        }
                    });
                let Some(first) = first else {
                    return Ok(BatchFetchResult::default());
                };
                first
                    .get("msgSeq")
                    .and_then(Value::as_str)
                    .unwrap_or("0")
                    .to_string()
            }
        };

        let batch_size = { self.state.lock().await.batch_size };
        let start_seq_num = start_seq.parse::<i64>().unwrap_or(0);
        let end_seq = (start_seq_num - batch_size).max(0).to_string();

        let api = Arc::clone(&self.api);
        let peer_clone = peer.clone();
        let start_seq_owned = start_seq.clone();
        let result = self
            .call_with_retry(move |_batch_size| {
                let api = Arc::clone(&api);
                let peer = peer_clone.clone();
                let end_seq = end_seq.clone();
                let start_seq = start_seq_owned.clone();
                async move { api.get_msgs_by_seq_range(&peer, &end_seq, &start_seq).await }
            })
            .await?;

        let mut batch = process_api_result(result, Some(filter), None);
        batch.messages = apply_client_side_filter(batch.messages, filter);
        batch.actual_count = batch.messages.len();
        Ok(batch)
    }

    /// 混合策略：根据筛选复杂度动态选择 API。
    async fn fetch_by_hybrid_strategy(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        start_message_id: Option<&str>,
        start_seq: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        let has_complex_filter = filter
            .sender_uids
            .as_ref()
            .is_some_and(|uids| !uids.is_empty())
            || filter
                .message_types
                .as_ref()
                .is_some_and(|types| !types.is_empty())
            || filter
                .keywords
                .as_ref()
                .is_some_and(|keywords| !keywords.is_empty());
        if has_complex_filter {
            self.fetch_by_time_based_sequential(peer, filter, start_message_id)
                .await
        } else {
            self.fetch_by_sequence_range(peer, filter, start_seq).await
        }
    }

    /// 带重试的 API 调用。
    ///
    /// issue #305 / #316：超时类错误下次重试自动折半 batchSize（不低于
    /// [`MIN_BATCH_SIZE_ON_TIMEOUT`]），让 QQ 客户端有机会用更小窗口完成查询。
    async fn call_with_retry<F, Fut>(&self, api_call: F) -> Result<Value, FetchError>
    where
        F: Fn(i64) -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let mut last_error = FetchError::Api("未知API错误".to_string());

        for attempt in 0..=self.config.retry_count {
            if self.is_cancelled() {
                return Err(FetchError::Cancelled);
            }
            let batch_size = { self.state.lock().await.batch_size };
            tracing::info!(
                "[BatchMessageFetcher] 开始API调用 (尝试 {}/{}) batchSize={batch_size}",
                attempt + 1,
                self.config.retry_count + 1
            );

            let call_result = tokio::time::timeout(
                Duration::from_millis(self.config.timeout_ms),
                api_call(batch_size),
            )
            .await;
            let result = match call_result {
                Ok(Ok(value)) => {
                    tracing::info!("[BatchMessageFetcher] API调用成功");
                    let mut state = self.state.lock().await;
                    state.stats.consecutive_failures = 0;
                    // issue #305 / #316 的反向路径：缩小后的 batchSize 在连续成功后
                    // 逐步翻倍回升，避免一次超时让整个任务全程使用小批次。
                    if state.batch_size < self.config.batch_size {
                        state.consecutive_successes += 1;
                        if state.consecutive_successes >= BATCH_SIZE_RECOVERY_SUCCESSES {
                            let previous = state.batch_size;
                            let next = (previous * 2).min(self.config.batch_size);
                            state.batch_size = next;
                            state.consecutive_successes = 0;
                            tracing::info!(
                                "[BatchMessageFetcher] 连续成功，batchSize 回升: {previous} -> {next}"
                            );
                        }
                    } else {
                        state.consecutive_successes = 0;
                    }
                    return Ok(value);
                }
                Ok(Err(message)) => FetchError::Api(message),
                Err(_) => FetchError::Timeout(self.config.timeout_ms),
            };

            tracing::warn!(
                "[BatchMessageFetcher] API调用失败 (尝试 {}/{}): {result}",
                attempt + 1,
                self.config.retry_count + 1
            );
            {
                let mut state = self.state.lock().await;
                state.stats.consecutive_failures += 1;
            }

            if attempt == self.config.retry_count {
                last_error = result;
                break;
            }

            // issue #305 / #316：超时类错误下次重试用更小的 batchSize。
            if result.is_timeout() {
                let mut state = self.state.lock().await;
                state.consecutive_successes = 0;
                if state.batch_size > MIN_BATCH_SIZE_ON_TIMEOUT {
                    let previous = state.batch_size;
                    let next = (previous / 2).max(MIN_BATCH_SIZE_ON_TIMEOUT);
                    state.batch_size = next;
                    tracing::warn!(
                        "[BatchMessageFetcher] 检测到超时，自适应缩小 batchSize: {previous} -> {next}"
                    );
                }
            }
            last_error = result;

            let retry_delay = self.config.retry_interval_ms * u64::from(attempt + 1);
            tracing::info!("[BatchMessageFetcher] 等待 {retry_delay}ms 后重试");
            tokio::time::sleep(Duration::from_millis(retry_delay)).await;
        }

        Err(last_error)
    }

    /// 更新统计信息。
    async fn update_stats(&self, success: bool, response_time_ms: i64) {
        let mut state = self.state.lock().await;
        let stats = &mut state.stats;
        stats.call_count += 1;
        if success {
            stats.success_count += 1;
            stats.average_response_time = (stats.average_response_time
                * (stats.success_count - 1) as f64
                + response_time_ms as f64)
                / stats.success_count as f64;
        } else {
            stats.failure_count += 1;
        }
    }
}

/// 处理 API 调用结果，统一格式化。
fn process_api_result(
    api_result: Value,
    filter: Option<&MessageFilter>,
    current_message_id: Option<&str>,
) -> BatchFetchResult {
    let messages = match api_result {
        Value::Object(mut root) => {
            if let Some(Value::Object(result)) = root.get_mut("result") {
                if let Some(Value::Array(messages)) = result.remove("msgList") {
                    messages
                } else {
                    match root.remove("msgList") {
                        Some(Value::Array(messages)) => messages,
                        _ => Vec::new(),
                    }
                }
            } else {
                match root.remove("msgList") {
                    Some(Value::Array(messages)) => messages,
                    _ => Vec::new(),
                }
            }
        }
        _ => Vec::new(),
    };

    let mut has_more = !messages.is_empty();
    let mut next_message_id: Option<String> = None;
    let mut next_seq: Option<String> = None;
    let mut earliest_msg_time: Option<i64> = None;

    if !messages.is_empty() {
        // 取时间最早的消息作为下一次查询的起点。
        let mut earliest = &messages[0];
        for msg in &messages {
            let msg_time = loose_msg_time(msg);
            let earliest_time = loose_msg_time(earliest);
            if msg_time.is_some() && (earliest_time.is_none() || msg_time < earliest_time) {
                earliest = msg;
            }
        }
        next_message_id = earliest
            .get("msgId")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        next_seq = earliest
            .get("msgSeq")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        if let Some(raw_time) = loose_msg_time(earliest) {
            earliest_msg_time = Some(to_millis(raw_time));
        }
        // 防止无限循环：返回了与当前查询起点相同的消息。
        if let (Some(current), Some(next)) = (current_message_id, next_message_id.as_deref()) {
            if current == next {
                has_more = false;
                next_message_id = None;
                next_seq = None;
            }
        }
    }

    // 早停：最早时间早于筛选开始时间。
    if let (Some(earliest), Some(start_time)) = (
        earliest_msg_time,
        filter.and_then(|filter| filter.start_time),
    ) {
        if earliest < start_time {
            tracing::info!(
                "[BatchMessageFetcher] 早停：earliestMsgTime={earliest} < startTime={start_time}，停止继续获取"
            );
            has_more = false;
            next_message_id = None;
            next_seq = None;
        }
    }

    tracing::info!(
        "[BatchMessageFetcher] 处理结果: {} 条消息, hasMore={has_more}, nextMessageId={next_message_id:?}, earliestMsgTime={earliest_msg_time:?}",
        messages.len()
    );

    let actual_count = messages.len();
    BatchFetchResult {
        messages,
        has_more,
        next_message_id,
        next_seq,
        actual_count,
        fetch_time_ms: 0,
        earliest_msg_time,
    }
}

/// 客户端筛选。
fn apply_client_side_filter(messages: Vec<Value>, filter: &MessageFilter) -> Vec<Value> {
    let input_count = messages.len();
    let mut filtered = messages;

    // 时间筛选（秒级时间戳自动转毫秒）。
    if filter.start_time.is_some() || filter.end_time.is_some() {
        filtered.retain(|msg| {
            let Some(raw_time) = loose_msg_time(msg) else {
                return false;
            };
            let msg_time = to_millis(raw_time);
            filter.start_time.is_none_or(|start| msg_time >= start)
                && filter.end_time.is_none_or(|end| msg_time <= end)
        });
    }

    // 发送者筛选。
    if let Some(sender_uids) = filter.sender_uids.as_ref().filter(|uids| !uids.is_empty()) {
        filtered.retain(|msg| {
            let sender = msg
                .get("senderUid")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .or_else(|| msg.get("peerUid").and_then(Value::as_str))
                .unwrap_or("");
            sender_uids.iter().any(|uid| uid == sender)
        });
    }

    // 消息类型筛选。
    if let Some(message_types) = filter
        .message_types
        .as_ref()
        .filter(|types| !types.is_empty())
    {
        let allowed: std::collections::HashSet<i64> =
            message_types.iter().map(|mt| mt.r#type).collect();
        filtered.retain(|msg| {
            msg.get("msgType")
                .and_then(Value::as_i64)
                .is_some_and(|t| allowed.contains(&t))
        });
    }

    // 关键词筛选（对 elements JSON 做大小写不敏感包含匹配）。
    if let Some(keywords) = filter.keywords.as_ref().filter(|kw| !kw.is_empty()) {
        let lowered_keywords: Vec<String> = keywords
            .iter()
            .map(|keyword| keyword.to_lowercase())
            .collect();
        filtered.retain(|msg| {
            let content = msg
                .get("elements")
                .map(|elements| elements.to_string().to_lowercase())
                .unwrap_or_default();
            lowered_keywords
                .iter()
                .any(|keyword| content.contains(keyword))
        });
    }

    tracing::info!(
        "[BatchMessageFetcher] 客户端筛选完成，最终输出消息数量: {} (输入: {input_count}, 过滤掉: {})",
        filtered.len(),
        input_count - filtered.len()
    );
    filtered
}

/// 宽松读取 msgTime（可能是字符串或数字）。
fn loose_msg_time(msg: &Value) -> Option<i64> {
    match msg.get("msgTime") {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse::<i64>().ok(),
        _ => None,
    }
}

/// 秒级时间戳（10 位数）自动转毫秒。
fn to_millis(raw_time: i64) -> i64 {
    if raw_time > 1_000_000_000 && raw_time < 10_000_000_000 {
        raw_time * 1000
    } else {
        raw_time
    }
}

/// 当前毫秒时间戳。
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn processes_result_wrapped_message_lists() {
        let batch = process_api_result(
            json!({
                "result": {
                    "msgList": [{
                        "msgId": "message-1",
                        "msgSeq": "10",
                        "msgTime": "1783866274"
                    }]
                }
            }),
            None,
            None,
        );

        assert_eq!(batch.actual_count, 1);
        assert_eq!(batch.next_message_id.as_deref(), Some("message-1"));
    }

    struct NoopApi;

    #[async_trait]
    impl MessageFetchApi for NoopApi {
        async fn get_aio_first_view_latest_msgs(
            &self,
            _peer: &Peer,
            _count: i64,
        ) -> Result<Value, String> {
            Ok(json!({ "msgList": [] }))
        }

        async fn get_msg_history(
            &self,
            _peer: &Peer,
            _msg_id: &str,
            _count: i64,
        ) -> Result<Value, String> {
            Ok(json!({ "msgList": [] }))
        }

        async fn get_msgs_by_seq_range(
            &self,
            _peer: &Peer,
            _start_seq: &str,
            _end_seq: &str,
        ) -> Result<Value, String> {
            Ok(json!({ "msgList": [] }))
        }
    }

    #[tokio::test]
    async fn shrunk_batch_size_recovers_after_consecutive_successes() {
        let fetcher = BatchMessageFetcher::new(Arc::new(NoopApi), BatchFetchConfig::default());
        {
            let mut state = fetcher.state.lock().await;
            state.batch_size = MIN_BATCH_SIZE_ON_TIMEOUT;
        }

        for _ in 0..BATCH_SIZE_RECOVERY_SUCCESSES {
            fetcher
                .call_with_retry(|_batch_size| async { Ok(json!({ "msgList": [] })) })
                .await
                .expect("call succeeds");
        }
        assert_eq!(
            fetcher.state.lock().await.batch_size,
            MIN_BATCH_SIZE_ON_TIMEOUT * 2
        );

        // 回升不超过配置上限。
        {
            let mut state = fetcher.state.lock().await;
            state.batch_size = 4000;
            state.consecutive_successes = 0;
        }
        for _ in 0..BATCH_SIZE_RECOVERY_SUCCESSES {
            fetcher
                .call_with_retry(|_batch_size| async { Ok(json!({ "msgList": [] })) })
                .await
                .expect("call succeeds");
        }
        assert_eq!(fetcher.state.lock().await.batch_size, 5000);
    }

    #[test]
    fn processes_root_message_lists() {
        let batch = process_api_result(
            json!({
                "msgList": [{
                    "msgId": "message-2",
                    "msgSeq": "11",
                    "msgTime": "1783866275"
                }]
            }),
            None,
            None,
        );

        assert_eq!(batch.actual_count, 1);
        assert_eq!(batch.next_message_id.as_deref(), Some("message-2"));
    }
}
