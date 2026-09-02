use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, Semaphore, SemaphorePermit, TryAcquireError};

use crate::fetcher::chat_type::is_private_like_chat_type;

/// issue #305 / #316：自适应缩小后的 batchSize 下限。
const MIN_BATCH_SIZE_ON_TIMEOUT: i64 = 200;

/// 缩小后的 batchSize 连续成功该次数后翻倍回升（不超过配置值）。
const BATCH_SIZE_RECOVERY_SUCCESSES: u32 = 3;

/// 分页批次之间的间隔（本地 IPC 调用，仅留出让路空隙）。
const INTER_BATCH_DELAY_MS: u64 = 20;

/// issue #634：群聊序列分页的单页上限。大窗口历史查询会在 QQ 原生
/// Worker（wrapper.node）内积累巨大内存压力，最终导致 0xC0000005 崩溃。
const GROUP_SEQ_PAGE_MAX: i64 = 500;

/// issue #634：超时后的冷却时间。本地超时并不代表 Worker 内的原生查询已经
/// 结束，立即重试会造成重量级查询在 Worker 内叠加。
const TIMEOUT_COOLDOWN_MS: u64 = 15_000;

/// issue #634：bridge / Worker 崩溃后等待恢复（NapCat 重启并重新登录）的上限。
const BRIDGE_RECOVERY_WAIT_MS: u64 = 10 * 60 * 1000;

/// bridge 恢复探测间隔。
const BRIDGE_PROBE_INTERVAL_MS: u64 = 5_000;

/// 单次 API 调用允许的 bridge 崩溃恢复次数（不计入普通重试次数）。
const MAX_BRIDGE_RECOVERIES: u32 = 5;

/// issue #666：锚点二分定位的最大探测次数（覆盖 2^24 ≈ 1600 万条序列空间）。
const SEEK_MAX_PROBES: u32 = 24;

/// 锚点探测单次拉取的消息条数（只需要一条即可读出该处时间）。
const SEEK_PROBE_COUNT: i64 = 1;

/// 锚点探测的超时上限；比正常批次更短，避免定位阶段长时间挂住。
const SEEK_PROBE_TIMEOUT_MS: u64 = 30_000;

/// 定位到的锚点向新方向留出的安全余量（序列号与时间并非严格同序）。
const SEEK_ANCHOR_MARGIN: i64 = GROUP_SEQ_PAGE_MAX;

/// `endTime` 距当前时间在该范围内时视为「到最新消息」，跳过锚点定位。
const SEEK_END_TIME_SLACK_MS: i64 = 6 * 60 * 60 * 1000;

/// 单个二分点探测失败时，向更新方向另找邻近探测点的重试次数。
const SEEK_NEIGHBOR_RETRIES: u32 = 3;

/// 邻近探测点的步长（一个序列页宽度）。
const SEEK_NEIGHBOR_STEP: i64 = GROUP_SEQ_PAGE_MAX;

/// issue #634：进程级历史查询门控。同一时刻只允许一个重量级历史消息查询
/// 进入 NapCat Worker，防止并发/叠加查询压垮 QQ 原生模块。
fn history_fetch_gate() -> &'static Semaphore {
    static GATE: OnceLock<Semaphore> = OnceLock::new();
    GATE.get_or_init(|| Semaphore::new(1))
}

/// 尝试进入进程级历史查询门控，不等待排队。
pub(crate) fn try_history_query_permit() -> Result<SemaphorePermit<'static>, TryAcquireError> {
    history_fetch_gate().try_acquire()
}

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
    /// 主动修复未取得进展。
    #[error(
        "MESSAGE_SEQUENCE_REPAIR_NO_PROGRESS: 群聊历史仍有 {gap_count} 个大序列缺口（估算缺失 {missing_positions} 个序号）"
    )]
    SequenceRepairNoProgress {
        gap_count: usize,
        missing_positions: i64,
    },
    /// 主动修复达到请求预算。
    #[error(
        "MESSAGE_SEQUENCE_REPAIR_BUDGET_EXHAUSTED: 群聊历史仍有 {gap_count} 个大序列缺口（估算缺失 {missing_positions} 个序号）"
    )]
    SequenceRepairBudgetExhausted {
        gap_count: usize,
        missing_positions: i64,
    },
    /// 主动修复达到轮次限制后仍未收敛。
    #[error(
        "MESSAGE_SEQUENCE_GAPS_UNRESOLVED: 群聊历史仍有 {gap_count} 个大序列缺口（估算缺失 {missing_positions} 个序号）"
    )]
    SequenceGapsUnresolved {
        gap_count: usize,
        missing_positions: i64,
    },
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

    /// 判断错误是否属于 bridge / Worker 不可用（NapCat Worker 崩溃或重启）。
    fn is_bridge_down(&self) -> bool {
        let Self::Api(message) = self else {
            return false;
        };
        if message.contains("传输错误") {
            return true;
        }
        let lower = message.to_lowercase();
        [
            "connection refused",
            "connection reset",
            "connection closed",
            "broken pipe",
            "error sending request",
            "connect error",
            "unexpected eof",
            "channel closed",
            "dns error",
        ]
        .iter()
        .any(|pattern| lower.contains(pattern))
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

    /// 从指定序列号向前获取固定数量消息。
    async fn get_msgs_by_seq_and_count(
        &self,
        peer: &Peer,
        anchor_seq: i64,
        count: i64,
    ) -> Result<Value, String>;

    /// bridge / Worker 是否健康可用（默认视为健康）。
    async fn bridge_healthy(&self) -> bool {
        true
    }
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
    /// issue #634：基于序列号的小页分页（群聊安全路径）。
    SequenceBasedPaged,
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
        // issue #634：群聊使用小页序列分页，避免大窗口 getMsgHistory 查询
        // 压垮 QQ 原生 Worker。
        let _ = filter;
        tracing::debug!(
            "策略选择: 群聊使用序列小页分页, 对等体={}, chatType={}",
            peer.peer_uid,
            peer.chat_type
        );
        FetchStrategy::SequenceBasedPaged
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
            FetchStrategy::SequenceBasedPaged => {
                self.fetch_by_seq_paged(peer, filter, start_seq).await
            }
        }
    }

    /// issue #666：把首批锚点二分定位到 `filter.end_time` 附近。
    ///
    /// 序列分页只能从新到旧翻页。当时间范围上界远早于最新消息时（例如导出
    /// 2020–2022 的历史），逐页回溯会先把范围之外的上百万条消息全部查一遍，
    /// 在 QQ 原生 Worker 内积累巨量内存并触发连接重置（`recv failed 10054`）。
    ///
    /// 这里用 `O(log n)` 次单条探测把锚点定位到上界附近；无法定位时返回
    /// `None`，回退到原来的从最新消息翻页行为。
    async fn seek_anchor_for_end_time(&self, peer: &Peer, filter: &MessageFilter) -> Option<i64> {
        let end_time = filter.end_time?;
        // 上界接近当前时间：最新消息本身就在范围内，无需定位。
        if end_time >= now_ms() - SEEK_END_TIME_SLACK_MS {
            return None;
        }

        let (latest_seq, latest_time) = self.probe_seq_head(peer, None).await?;
        if latest_time <= end_time {
            return None;
        }

        let mut lo = 1_i64;
        let mut hi = latest_seq;
        let mut best: Option<i64> = None;
        let mut successful_probes = 0_u32;
        let mut probes = 0_u32;
        while lo <= hi && probes < SEEK_MAX_PROBES {
            if self.is_cancelled() {
                return None;
            }
            let mid = lo + (hi - lo) / 2;
            // 探测点可能落在撤回 / 不可见消息上，也可能只是接口抖动。这类
            // 「未知」结果绝不能当成「目标在更高处」的证据（那会整段漏掉历史
            // 消息），只允许在更新方向另找邻近探测点重试。
            let mut probe: Option<(i64, i64)> = None;
            let mut point = mid;
            for retry in 0..=SEEK_NEIGHBOR_RETRIES {
                if probes >= SEEK_MAX_PROBES {
                    break;
                }
                let candidate = mid + i64::from(retry) * SEEK_NEIGHBOR_STEP;
                if candidate > hi {
                    break;
                }
                probes += 1;
                if let Some(result) = self.probe_seq_head(peer, Some(candidate)).await {
                    point = candidate;
                    probe = Some(result);
                    break;
                }
            }
            // 邻近探测点全部失败：方向不可判定。此时任何「猜一个锚点」都可能整段
            // 漏掉历史消息，只能放弃定位，退回从最新消息翻页（慢但绝不丢消息）。
            let Some((probe_seq, probe_time)) = probe else {
                tracing::warn!(
                    "[BatchMessageFetcher] issue #666：锚点探测连续失败（seq≈{mid}），回退到从最新消息翻页"
                );
                return None;
            };
            successful_probes += 1;
            if probe_time <= end_time {
                best = Some(probe_seq.max(best.unwrap_or(probe_seq)));
                lo = point + 1;
            } else {
                hi = probe_seq.min(point) - 1;
            }
        }

        // 探测次数用尽而区间还没收敛：同样不能凭半成品猜锚点。
        if lo <= hi {
            tracing::warn!(
                "[BatchMessageFetcher] issue #666：锚点定位未收敛（probes={probes}），回退到从最新消息翻页"
            );
            return None;
        }
        // best 为空说明整段历史都比 endTime 新：锚在最旧处，首批自然为空。
        let anchor = best
            .map(|seq| (seq + SEEK_ANCHOR_MARGIN).min(latest_seq))
            .or_else(|| (successful_probes > 0).then_some(1))?;
        tracing::info!(
            "[BatchMessageFetcher] issue #666：按 endTime={end_time} 定位首批锚点 anchorSeq={anchor}（latestSeq={latest_seq}, probes={probes}）"
        );
        Some(anchor)
    }

    /// 探测 `seq <= anchor_seq` 区间内最新一条消息的 `(msgSeq, msgTime)`。
    ///
    /// `anchor_seq` 为 `None` 时探测会话最新消息。空结果 / 调用失败返回 `None`。
    async fn probe_seq_head(&self, peer: &Peer, anchor_seq: Option<i64>) -> Option<(i64, i64)> {
        let permit = history_fetch_gate().acquire().await.ok()?;
        let timeout = Duration::from_millis(self.config.timeout_ms.min(SEEK_PROBE_TIMEOUT_MS));
        let call = async {
            match anchor_seq {
                None => {
                    self.api
                        .get_aio_first_view_latest_msgs(peer, SEEK_PROBE_COUNT)
                        .await
                }
                Some(anchor_seq) => {
                    self.api
                        .get_msgs_by_seq_and_count(peer, anchor_seq, SEEK_PROBE_COUNT)
                        .await
                }
            }
        };
        let result = tokio::time::timeout(timeout, call).await;
        drop(permit);
        let value = match result {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                tracing::warn!(
                    "[BatchMessageFetcher] 锚点探测失败 (anchor={anchor_seq:?}): {error}"
                );
                return None;
            }
            Err(_) => {
                tracing::warn!("[BatchMessageFetcher] 锚点探测超时 (anchor={anchor_seq:?})");
                return None;
            }
        };
        extract_msg_list(value)
            .iter()
            .filter_map(|message| {
                Some((loose_msg_seq(message)?, to_millis(loose_msg_time(message)?)))
            })
            .max_by_key(|(seq, _)| *seq)
    }

    /// issue #634：基于序列号的小页分页获取（群聊安全路径）。
    ///
    /// 首批用 `getAioFirstViewLatestMsgs` 的小窗口拿到当前最新序列号，之后
    /// 每批用 `getMsgsBySeqAndCount` 从锚点向前翻小页。空页（历史缺口）按
    /// 页宽线性跳过，序列号单调递减保证终止。
    async fn fetch_by_seq_paged(
        &self,
        peer: &Peer,
        filter: &MessageFilter,
        start_seq: Option<&str>,
    ) -> Result<BatchFetchResult, FetchError> {
        let mut anchor = start_seq.and_then(|seq| seq.parse::<i64>().ok());
        if let Some(anchor) = anchor {
            if anchor <= 0 {
                return Ok(BatchFetchResult::default());
            }
        }

        // issue #666：首批先把锚点定位到 endTime 附近，避免从最新消息一路翻页
        // 回到时间范围上界（活跃大群会因此多做数万次原生历史查询，把 QQ
        // Worker 的内存推到崩溃并出现 recv failed 10054）。
        if anchor.is_none() {
            anchor = self.seek_anchor_for_end_time(peer, filter).await;
        }

        let api = Arc::clone(&self.api);
        let peer_clone = peer.clone();
        let result = self
            .call_with_retry(move |batch_size| {
                let api = Arc::clone(&api);
                let peer = peer_clone.clone();
                let page = seq_page_size(batch_size);
                async move {
                    match anchor {
                        None => {
                            tracing::info!(
                                "[BatchMessageFetcher] 调用 getAioFirstViewLatestMsgs API (seq 分页首批), count={page}"
                            );
                            api.get_aio_first_view_latest_msgs(&peer, page).await
                        }
                        Some(anchor) => {
                            tracing::info!(
                                "[BatchMessageFetcher] 调用 getMsgsBySeqAndCount API, anchorSeq={anchor}, count={page}"
                            );
                            api.get_msgs_by_seq_and_count(&peer, anchor, page).await
                        }
                    }
                }
            })
            .await?;

        let page = seq_page_size(self.state.lock().await.batch_size);
        let mut batch = process_seq_page_result(result, filter, anchor, page);
        batch.messages = apply_client_side_filter(batch.messages, filter);
        batch.actual_count = batch.messages.len();
        Ok(batch)
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
        let mut bridge_recoveries = 0_u32;
        let mut attempt = 0_u32;

        loop {
            if self.is_cancelled() {
                return Err(FetchError::Cancelled);
            }
            let batch_size = { self.state.lock().await.batch_size };
            tracing::info!(
                "[BatchMessageFetcher] 开始API调用 (尝试 {}/{}) batchSize={batch_size}",
                attempt + 1,
                self.config.retry_count + 1
            );

            // issue #634：进程级串行门控，避免多个重量级历史查询同时进入 Worker。
            let gate_permit = history_fetch_gate()
                .acquire()
                .await
                .map_err(|_| FetchError::Api("历史查询门控已关闭".to_string()))?;
            let call_result = tokio::time::timeout(
                Duration::from_millis(self.config.timeout_ms),
                api_call(batch_size),
            )
            .await;
            drop(gate_permit);
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

            // issue #634：bridge / Worker 崩溃属于可恢复状态：等待 NapCat 重启
            // 并重新登录后从当前游标继续，不计入普通重试次数。
            if result.is_bridge_down() {
                if bridge_recoveries >= MAX_BRIDGE_RECOVERIES {
                    return Err(result);
                }
                bridge_recoveries += 1;
                self.shrink_batch_size().await;
                tracing::warn!(
                    "[BatchMessageFetcher] bridge 不可用（Worker 可能崩溃/重启），等待恢复后继续 (第 {bridge_recoveries}/{MAX_BRIDGE_RECOVERIES} 次)"
                );
                if !self.wait_for_bridge_recovery().await {
                    return Err(result);
                }
                continue;
            }

            if attempt >= self.config.retry_count {
                return Err(result);
            }
            attempt += 1;

            // issue #305 / #316：超时类错误下次重试用更小的 batchSize。
            // issue #634：本地超时不代表 Worker 内旧查询已结束，先冷却再等
            // bridge 健康，避免重量级查询在 Worker 内叠加。
            if result.is_timeout() {
                self.shrink_batch_size().await;
                let cooldown =
                    TIMEOUT_COOLDOWN_MS.max(self.config.retry_interval_ms * u64::from(attempt));
                tracing::info!("[BatchMessageFetcher] 超时冷却 {cooldown}ms 后重试");
                tokio::time::sleep(Duration::from_millis(cooldown)).await;
                if !self.wait_for_bridge_recovery().await {
                    return Err(result);
                }
            } else {
                let retry_delay = self.config.retry_interval_ms * u64::from(attempt);
                tracing::info!("[BatchMessageFetcher] 等待 {retry_delay}ms 后重试");
                tokio::time::sleep(Duration::from_millis(retry_delay)).await;
            }
        }
    }

    /// 超时 / 崩溃后自适应缩小 batchSize（不低于 [`MIN_BATCH_SIZE_ON_TIMEOUT`]）。
    async fn shrink_batch_size(&self) {
        let mut state = self.state.lock().await;
        state.consecutive_successes = 0;
        if state.batch_size > MIN_BATCH_SIZE_ON_TIMEOUT {
            let previous = state.batch_size;
            let next = (previous / 2).max(MIN_BATCH_SIZE_ON_TIMEOUT);
            state.batch_size = next;
            tracing::warn!("[BatchMessageFetcher] 自适应缩小 batchSize: {previous} -> {next}");
        }
    }

    /// 等待 bridge / Worker 恢复健康；被取消或超出等待上限时返回 `false`。
    async fn wait_for_bridge_recovery(&self) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_millis(BRIDGE_RECOVERY_WAIT_MS);
        loop {
            if self.is_cancelled() {
                return false;
            }
            if self.api.bridge_healthy().await {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                tracing::error!(
                    "[BatchMessageFetcher] bridge 在 {BRIDGE_RECOVERY_WAIT_MS}ms 内未恢复"
                );
                return false;
            }
            tracing::info!("[BatchMessageFetcher] 等待 bridge 恢复...");
            tokio::time::sleep(Duration::from_millis(BRIDGE_PROBE_INTERVAL_MS)).await;
        }
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

/// 序列分页的每页大小：跟随自适应 batchSize，但不超过 [`GROUP_SEQ_PAGE_MAX`]。
fn seq_page_size(batch_size: i64) -> i64 {
    batch_size.clamp(1, GROUP_SEQ_PAGE_MAX)
}

/// 宽松读取 msgSeq（可能是字符串或数字）。
fn loose_msg_seq(msg: &Value) -> Option<i64> {
    match msg.get("msgSeq") {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// 从 API 响应中提取消息数组（兼容 `result.msgList` / `msgList` 两种包装）。
fn extract_msg_list(api_result: Value) -> Vec<Value> {
    match api_result {
        Value::Object(mut root) => {
            if let Some(Value::Object(result)) = root.get_mut("result") {
                if let Some(Value::Array(messages)) = result.remove("msgList") {
                    return messages;
                }
            }
            match root.remove("msgList") {
                Some(Value::Array(messages)) => messages,
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

/// issue #634：处理序列分页的 API 结果。
///
/// 下一锚点 = 本页最小序列号 - 1；空页或序列未前进时按页宽线性跳过缺口，
/// 序列号严格递减保证不会死循环。
fn process_seq_page_result(
    api_result: Value,
    filter: &MessageFilter,
    anchor: Option<i64>,
    page: i64,
) -> BatchFetchResult {
    let messages = extract_msg_list(api_result);

    let min_seq = messages.iter().filter_map(loose_msg_seq).min();
    let mut earliest_msg_time = messages
        .iter()
        .filter_map(loose_msg_time)
        .min()
        .map(to_millis);
    if messages.is_empty() {
        earliest_msg_time = None;
    }

    let next_anchor = match (min_seq, anchor) {
        (Some(min_seq), Some(anchor)) if min_seq < anchor => min_seq - 1,
        (Some(min_seq), None) => min_seq - 1,
        // 空页或未前进：按页宽跳过缺口。首批（无锚点）空结果视为空会话。
        (_, Some(anchor)) => anchor - page.max(1),
        (None, None) => 0,
    };

    let mut has_more = next_anchor > 0 && !(anchor.is_none() && messages.is_empty());

    // 早停：最早时间早于筛选开始时间。
    if let (Some(earliest), Some(start_time)) = (earliest_msg_time, filter.start_time) {
        if earliest < start_time {
            tracing::info!(
                "[BatchMessageFetcher] 早停：earliestMsgTime={earliest} < startTime={start_time}，停止继续获取"
            );
            has_more = false;
        }
    }

    let next_seq = has_more.then(|| next_anchor.to_string());
    tracing::info!(
        "[BatchMessageFetcher] 序列分页结果: {} 条消息, anchor={anchor:?}, nextSeq={next_seq:?}, hasMore={has_more}",
        messages.len()
    );

    let actual_count = messages.len();
    BatchFetchResult {
        messages,
        has_more,
        next_message_id: None,
        next_seq,
        actual_count,
        fetch_time_ms: 0,
        earliest_msg_time,
    }
}

/// 处理 API 调用结果，统一格式化。
fn process_api_result(
    api_result: Value,
    filter: Option<&MessageFilter>,
    current_message_id: Option<&str>,
) -> BatchFetchResult {
    let messages = extract_msg_list(api_result);

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
        next_seq = loose_msg_seq(earliest).map(|seq| seq.to_string());
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

        async fn get_msgs_by_seq_and_count(
            &self,
            _peer: &Peer,
            _anchor_seq: i64,
            _count: i64,
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

    /// issue #666：合成的连续群聊历史（seq 1..=`latest_seq`，每条相隔 `step_ms`）。
    struct SyntheticHistory {
        latest_seq: i64,
        oldest_time_ms: i64,
        step_ms: i64,
        calls: std::sync::atomic::AtomicU64,
        /// 单条探测落入该闭区间时模拟接口失败（issue #666 现场的超时 / 10054）。
        fail_range: Option<(i64, i64)>,
    }

    impl SyntheticHistory {
        fn new(latest_seq: i64, step_ms: i64) -> Self {
            Self {
                latest_seq,
                // 对齐到整秒：合成消息的 msgTime 是秒级字符串。
                oldest_time_ms: (now_ms() - latest_seq * step_ms) / 1000 * 1000,
                step_ms,
                calls: std::sync::atomic::AtomicU64::new(0),
                fail_range: None,
            }
        }

        fn with_failing_range(mut self, low: i64, high: i64) -> Self {
            self.fail_range = Some((low, high));
            self
        }

        fn fails_at(&self, anchor_seq: i64) -> bool {
            self.fail_range
                .is_some_and(|(low, high)| (low..=high).contains(&anchor_seq))
        }

        fn time_at(&self, seq: i64) -> i64 {
            self.oldest_time_ms + seq * self.step_ms
        }

        fn page(&self, anchor_seq: i64, count: i64) -> Value {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let messages: Vec<Value> = (1..=anchor_seq.min(self.latest_seq))
                .rev()
                .take(usize::try_from(count.max(1)).unwrap_or(1))
                .map(|seq| {
                    json!({
                        "msgId": format!("m{seq}"),
                        "msgSeq": seq.to_string(),
                        "msgTime": (self.time_at(seq) / 1000).to_string(),
                    })
                })
                .collect();
            json!({ "msgList": messages })
        }

        fn call_count(&self) -> u64 {
            self.calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl MessageFetchApi for SyntheticHistory {
        async fn get_aio_first_view_latest_msgs(
            &self,
            _peer: &Peer,
            count: i64,
        ) -> Result<Value, String> {
            Ok(self.page(self.latest_seq, count))
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

        async fn get_msgs_by_seq_and_count(
            &self,
            _peer: &Peer,
            anchor_seq: i64,
            count: i64,
        ) -> Result<Value, String> {
            if count <= SEEK_PROBE_COUNT && self.fails_at(anchor_seq) {
                self.calls.fetch_add(1, Ordering::SeqCst);
                return Err("recv failed with error: 10054".to_string());
            }
            Ok(self.page(anchor_seq, count))
        }
    }

    fn group_peer() -> Peer {
        Peer {
            chat_type: 2,
            peer_uid: "group-1".to_string(),
            guild_id: None,
        }
    }

    #[tokio::test]
    async fn first_batch_anchor_seeks_to_end_time_instead_of_walking_from_latest() {
        // 20 万条消息、每条相隔 1 分钟；导出区间只覆盖 seq 1000 附近的一小段。
        let api = Arc::new(SyntheticHistory::new(200_000, 60_000));
        let fetcher = BatchMessageFetcher::new(
            Arc::clone(&api) as Arc<dyn MessageFetchApi>,
            BatchFetchConfig::default(),
        );
        let filter = MessageFilter {
            start_time: Some(api.time_at(900)),
            end_time: Some(api.time_at(1000)),
            ..MessageFilter::default()
        };

        // 像导出流程那样把分页跑完。
        let mut previous = None;
        let mut seqs: Vec<i64> = Vec::new();
        let mut batches = 0;
        while let Some(batch) = fetcher
            .fetch_next_batch(&group_peer(), &filter, previous.as_ref())
            .await
            .expect("batch")
        {
            seqs.extend(batch.messages.iter().filter_map(loose_msg_seq));
            batches += 1;
            assert!(batches < 20, "分页未按预期收敛");
            previous = Some(batch);
        }

        // 区间内消息全部到位，且不包含区间之外的消息。
        seqs.sort_unstable();
        assert_eq!(seqs, (900..=1000).collect::<Vec<i64>>());
        // 定位成本是对数级：远小于线性回溯所需的约 400 页。
        assert!(
            api.call_count() <= u64::from(SEEK_MAX_PROBES) + 5,
            "锚点定位调用次数过多: {}",
            api.call_count()
        );
    }

    /// issue #666：探测失败不得被当成「目标在更高序列」的证据——否则二分
    /// 会把下界推过目标区间，整段历史消息会静默丢失。
    #[tokio::test]
    async fn anchor_seek_does_not_lose_messages_when_probes_fail() {
        // 让目标区间（900..=1000）附近的探测全部失败。
        let api = Arc::new(SyntheticHistory::new(20_000, 60_000).with_failing_range(300, 2_000));
        let fetcher = BatchMessageFetcher::new(
            Arc::clone(&api) as Arc<dyn MessageFetchApi>,
            BatchFetchConfig {
                retry_count: 0,
                retry_interval_ms: 0,
                ..BatchFetchConfig::default()
            },
        );
        let filter = MessageFilter {
            start_time: Some(api.time_at(400)),
            end_time: Some(api.time_at(500)),
            ..MessageFilter::default()
        };

        let mut previous = None;
        let mut seqs: Vec<i64> = Vec::new();
        let mut batches = 0;
        while let Some(batch) = fetcher
            .fetch_next_batch(&group_peer(), &filter, previous.as_ref())
            .await
            .expect("batch")
        {
            seqs.extend(batch.messages.iter().filter_map(loose_msg_seq));
            batches += 1;
            assert!(batches < 4_000, "分页未按预期收敛");
            previous = Some(batch);
        }

        seqs.sort_unstable();
        assert_eq!(seqs, (400..=500).collect::<Vec<i64>>());
    }

    #[tokio::test]
    async fn first_batch_skips_anchor_seek_when_end_time_is_recent() {
        let api = Arc::new(SyntheticHistory::new(5_000, 60_000));
        let fetcher = BatchMessageFetcher::new(
            Arc::clone(&api) as Arc<dyn MessageFetchApi>,
            BatchFetchConfig::default(),
        );
        let filter = MessageFilter {
            start_time: Some(api.time_at(1)),
            end_time: Some(now_ms()),
            ..MessageFilter::default()
        };

        fetcher
            .fetch_messages(&group_peer(), &filter, None, None)
            .await
            .expect("first batch");

        assert_eq!(api.call_count(), 1, "范围到最新消息时不应做锚点定位");
    }

    #[test]
    fn seq_page_result_advances_cursor_monotonically() {
        let filter = MessageFilter::default();
        let batch = process_seq_page_result(
            json!({ "msgList": [
                { "msgId": "m3", "msgSeq": "300", "msgTime": "1783866274" },
                { "msgId": "m2", "msgSeq": 250, "msgTime": "1783866270" },
            ] }),
            &filter,
            Some(320),
            100,
        );
        assert!(batch.has_more);
        assert_eq!(batch.next_seq.as_deref(), Some("249"));
    }

    #[test]
    fn seq_page_result_skips_empty_pages_without_looping() {
        let filter = MessageFilter::default();
        // 空页（历史缺口）：按页宽跳过，游标必须前进。
        let batch = process_seq_page_result(json!({ "msgList": [] }), &filter, Some(1000), 200);
        assert!(batch.has_more);
        assert_eq!(batch.next_seq.as_deref(), Some("800"));

        // 序列号未前进（返回的最小 seq >= 锚点）同样按页宽跳过。
        let batch = process_seq_page_result(
            json!({ "msgList": [{ "msgId": "m1", "msgSeq": "1000" }] }),
            &filter,
            Some(1000),
            200,
        );
        assert_eq!(batch.next_seq.as_deref(), Some("800"));

        // 游标触底后终止。
        let batch = process_seq_page_result(json!({ "msgList": [] }), &filter, Some(150), 200);
        assert!(!batch.has_more);
        assert!(batch.next_seq.is_none());
    }

    #[test]
    fn seq_page_result_terminates_on_empty_first_page() {
        let batch = process_seq_page_result(
            json!({ "msgList": [] }),
            &MessageFilter::default(),
            None,
            200,
        );
        assert!(!batch.has_more);
        assert!(batch.next_seq.is_none());
    }

    #[test]
    fn seq_page_result_stops_early_before_start_time() {
        let filter = MessageFilter {
            start_time: Some(1_800_000_000_000),
            ..MessageFilter::default()
        };
        let batch = process_seq_page_result(
            json!({ "msgList": [{ "msgId": "m1", "msgSeq": "500", "msgTime": "1783866274" }] }),
            &filter,
            Some(600),
            200,
        );
        assert!(!batch.has_more);
        assert!(batch.next_seq.is_none());
    }

    #[test]
    fn seq_page_size_is_capped() {
        assert_eq!(seq_page_size(5000), GROUP_SEQ_PAGE_MAX);
        assert_eq!(seq_page_size(200), 200);
        assert_eq!(seq_page_size(0), 1);
    }

    #[test]
    fn bridge_down_errors_are_detected() {
        assert!(FetchError::Api("传输错误: error sending request".to_string()).is_bridge_down());
        assert!(FetchError::Api("Connection refused (os error 111)".to_string()).is_bridge_down());
        assert!(!FetchError::Api("API调用超时".to_string()).is_bridge_down());
        assert!(!FetchError::Timeout(1000).is_bridge_down());
    }

    #[tokio::test]
    async fn history_gate_serializes_concurrent_calls() {
        use std::sync::atomic::AtomicI64;

        struct ConcurrencyProbe {
            active: AtomicI64,
            max_active: AtomicI64,
        }

        #[async_trait]
        impl MessageFetchApi for ConcurrencyProbe {
            async fn get_aio_first_view_latest_msgs(
                &self,
                _peer: &Peer,
                _count: i64,
            ) -> Result<Value, String> {
                let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.max_active.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                self.active.fetch_sub(1, Ordering::SeqCst);
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

            async fn get_msgs_by_seq_and_count(
                &self,
                _peer: &Peer,
                _anchor_seq: i64,
                _count: i64,
            ) -> Result<Value, String> {
                Ok(json!({ "msgList": [] }))
            }
        }

        let api = Arc::new(ConcurrencyProbe {
            active: AtomicI64::new(0),
            max_active: AtomicI64::new(0),
        });
        // 两个独立 fetcher 实例并发调用，进程级门控必须保证串行。
        let fetcher_a =
            BatchMessageFetcher::new(Arc::clone(&api) as _, BatchFetchConfig::default());
        let fetcher_b =
            BatchMessageFetcher::new(Arc::clone(&api) as _, BatchFetchConfig::default());
        let api_a = Arc::clone(&api);
        let api_b = Arc::clone(&api);
        let peer = Peer {
            chat_type: 2,
            peer_uid: "group".to_string(),
            guild_id: None,
        };
        let peer_a = peer.clone();
        let peer_b = peer;
        let call_a = fetcher_a.call_with_retry(move |count| {
            let api = Arc::clone(&api_a);
            let peer = peer_a.clone();
            async move { api.get_aio_first_view_latest_msgs(&peer, count).await }
        });
        let call_b = fetcher_b.call_with_retry(move |count| {
            let api = Arc::clone(&api_b);
            let peer = peer_b.clone();
            async move { api.get_aio_first_view_latest_msgs(&peer, count).await }
        });
        let (a, b) = tokio::join!(call_a, call_b);
        a.expect("call a succeeds");
        b.expect("call b succeeds");
        assert_eq!(api.max_active.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn nonblocking_history_permit_uses_the_process_gate() {
        let permit = history_fetch_gate()
            .acquire()
            .await
            .expect("history permit");
        assert!(try_history_query_permit().is_err());
        drop(permit);
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
