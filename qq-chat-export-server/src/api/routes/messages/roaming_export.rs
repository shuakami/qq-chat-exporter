use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{Datelike, Local, NaiveDate, TimeZone};
use futures_util::future::join_all;
use md5::{Digest, Md5};
use serde_json::{json, Value};

use super::{
    is_cancelled, local_date_from_seconds, loose_i64, update_and_broadcast_progress,
    RawMessageSpool, RoamingExportConfig, RoamingScanSummary, TaskFailure, ROAMING_CANCEL_POLL_MS,
    ROAMING_CLOSING_LOOKAHEAD_DAYS, ROAMING_DAILY_PROBE_DELAY_MS, ROAMING_LATEST_MESSAGE_COUNT,
    ROAMING_MAX_RETRIES, ROAMING_RETRY_BACKOFF_BASE_MS, ROAMING_SEQUENCE_BATCH_DELAY_MS,
    ROAMING_SINGLE_QUERY_CONCURRENCY,
};
use crate::api::routes::roaming;
use crate::api::state::SharedState;
use crate::fetcher::Peer;
use crate::napcat::{BridgeError, NapCatBridgeClient};

#[derive(Clone, Debug)]
struct RoamingAnchor {
    msg_time: String,
    msg_seq: i64,
}

#[async_trait]
trait RoamingHistoryApi: Send + Sync {
    async fn query_calendar(&self, peer: &Peer, msg_time: i64) -> Result<Value, BridgeError>;
    async fn query_first(&self, peer: &Peer, msg_time: i64) -> Result<Value, BridgeError>;
    async fn query_exact(
        &self,
        peer: &Peer,
        client_seq: &str,
        msg_time: &str,
    ) -> Result<Value, BridgeError>;
    async fn query_latest(&self, peer: &Peer, count: i64) -> Result<Value, BridgeError>;
    async fn query_single(&self, peer: &Peer, msg_seq: i64) -> Result<Value, BridgeError>;
}

#[async_trait]
impl RoamingHistoryApi for NapCatBridgeClient {
    async fn query_calendar(&self, peer: &Peer, msg_time: i64) -> Result<Value, BridgeError> {
        NapCatBridgeClient::query_roam_calendar(self, peer, msg_time).await
    }

    async fn query_first(&self, peer: &Peer, msg_time: i64) -> Result<Value, BridgeError> {
        NapCatBridgeClient::query_first_roam_msg(self, peer, msg_time).await
    }

    async fn query_exact(
        &self,
        peer: &Peer,
        client_seq: &str,
        msg_time: &str,
    ) -> Result<Value, BridgeError> {
        NapCatBridgeClient::get_msg_by_client_seq_and_time(self, peer, client_seq, msg_time).await
    }

    async fn query_latest(&self, peer: &Peer, count: i64) -> Result<Value, BridgeError> {
        NapCatBridgeClient::get_roaming_latest_messages(self, peer, count).await
    }

    async fn query_single(&self, peer: &Peer, msg_seq: i64) -> Result<Value, BridgeError> {
        NapCatBridgeClient::get_roaming_single_msg(self, peer, msg_seq).await
    }
}

#[async_trait]
trait RoamingScanRuntime: Send + Sync {
    async fn is_cancelled(&self) -> bool;
    async fn report(&self, summary: &RoamingScanSummary, progress: i64, message: &str);
    async fn wait_between_daily_probes(&self) -> bool;
    async fn wait_between_sequence_batches(&self) -> bool;
    async fn wait_before_retry(&self, delay_ms: u64) -> bool;
}

struct TaskRoamingScanRuntime {
    state: SharedState,
    task_id: String,
    cancel_flag: Arc<AtomicBool>,
}

impl TaskRoamingScanRuntime {
    async fn wait_or_cancel(&self, delay_ms: u64) -> bool {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(delay_ms);
        loop {
            if self.is_cancelled().await {
                return true;
            }
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            tokio::time::sleep(
                remaining.min(std::time::Duration::from_millis(ROAMING_CANCEL_POLL_MS)),
            )
            .await;
        }
    }
}

#[async_trait]
impl RoamingScanRuntime for TaskRoamingScanRuntime {
    async fn is_cancelled(&self) -> bool {
        is_cancelled(&self.state, &self.task_id, &self.cancel_flag).await
    }

    async fn report(&self, summary: &RoamingScanSummary, progress: i64, message: &str) {
        let roaming_scan = summary.as_value();
        let _ = update_and_broadcast_progress(
            &self.state,
            &self.task_id,
            json!({
                "progress": progress,
                "message": message,
                "messageCount": summary.message_count,
                "processedMessages": summary.raw_messages_seen,
                "roamingScan": roaming_scan,
            }),
            progress,
            message,
            summary.message_count,
        )
        .await;
    }

    async fn wait_between_daily_probes(&self) -> bool {
        self.wait_or_cancel(ROAMING_DAILY_PROBE_DELAY_MS).await
    }

    async fn wait_between_sequence_batches(&self) -> bool {
        self.wait_or_cancel(ROAMING_SEQUENCE_BATCH_DELAY_MS).await
    }

    async fn wait_before_retry(&self, delay_ms: u64) -> bool {
        self.wait_or_cancel(delay_ms).await
    }
}

#[derive(Debug)]
enum RoamingQueryFailure {
    Cancelled,
    Bridge(BridgeError),
}

fn rpc_contains_qq_business_code(detail: &str) -> bool {
    let normalized = detail.trim().to_ascii_lowercase();
    if !normalized.is_empty() && normalized.bytes().all(|byte| byte.is_ascii_digit()) {
        return true;
    }
    let tokens: Vec<&str> = normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    tokens.windows(3).any(|tokens| {
        tokens[0] == "qq"
            && tokens[1] == "result"
            && tokens[2].bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn is_retryable_roaming_error(error: &BridgeError) -> bool {
    match error {
        BridgeError::Transport(error) => {
            !error.is_builder()
                && !error.is_decode()
                && (error.is_timeout()
                    || error.is_connect()
                    || error.is_request()
                    || error.is_body())
        }
        BridgeError::InvalidResponse(_) => false,
        BridgeError::Rpc(detail) => {
            let normalized = detail.trim().to_ascii_lowercase();
            if normalized.contains("method not found") || rpc_contains_qq_business_code(&normalized)
            {
                return false;
            }
            [
                "timeout",
                "timed out",
                "temporarily unavailable",
                "temporary unavailable",
                "try again",
                "connection reset",
                "connection closed",
                "channel closed",
                "broken pipe",
                "unexpected eof",
                "econnreset",
                "worker busy",
                "worker is busy",
                "worker not ready",
                "worker unavailable",
                "worker disconnected",
                "worker restarting",
            ]
            .iter()
            .any(|pattern| normalized.contains(pattern))
        }
    }
}

async fn call_roaming_with_retry<F, Fut>(
    runtime: &dyn RoamingScanRuntime,
    operation: &str,
    mut call: F,
) -> Result<Value, RoamingQueryFailure>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<Value, BridgeError>>,
{
    let mut retry_count = 0_usize;
    loop {
        if runtime.is_cancelled().await {
            return Err(RoamingQueryFailure::Cancelled);
        }
        match call().await {
            Ok(value) => return Ok(value),
            Err(error)
                if retry_count < ROAMING_MAX_RETRIES && is_retryable_roaming_error(&error) =>
            {
                retry_count += 1;
                let shift = u32::try_from(retry_count - 1).unwrap_or_default();
                let delay_ms = ROAMING_RETRY_BACKOFF_BASE_MS
                    .checked_shl(shift)
                    .unwrap_or(u64::MAX);
                tracing::warn!(
                    "[RoamingScan] {operation} 瞬时失败，等待 {delay_ms}ms 后重试 ({retry_count}/{ROAMING_MAX_RETRIES}): {error}"
                );
                if runtime.wait_before_retry(delay_ms).await {
                    return Err(RoamingQueryFailure::Cancelled);
                }
            }
            Err(error) => return Err(RoamingQueryFailure::Bridge(error)),
        }
    }
}

fn roaming_query_failure(error: RoamingQueryFailure) -> TaskFailure {
    match error {
        RoamingQueryFailure::Cancelled => TaskFailure::export("任务已被用户停止"),
        RoamingQueryFailure::Bridge(error) => roaming_task_failure(error),
    }
}

fn roaming_task_failure(error: BridgeError) -> TaskFailure {
    TaskFailure::from_api(roaming::bridge_error(error))
}

fn validate_normalized_roaming_result(
    response: &Value,
    has_usable_payload: bool,
    operation: &str,
) -> Result<(), TaskFailure> {
    let result_code = loose_i64(response.get("resultCode")).ok_or_else(|| TaskFailure {
        message: format!("漫游 {operation} 响应缺少有效 resultCode"),
        code: "INVALID_ROAMING_RESPONSE".to_string(),
        http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
        roaming_scan: None,
    })?;
    if has_usable_payload || matches!(result_code, 0 | 2_004_000) {
        return Ok(());
    }
    Err(TaskFailure {
        message: format!("漫游 {operation} 返回未支持的 QQ 业务码: {result_code}"),
        code: "ROAMING_QUERY_FAILED".to_string(),
        http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
        roaming_scan: None,
    })
}

fn extract_sequence_messages(result: &Value) -> Result<Vec<Value>, TaskFailure> {
    let candidates = [
        result.get("msgList"),
        result.get("result").and_then(|value| value.get("msgList")),
        result.get("msgsRsp").and_then(|value| value.get("msgList")),
    ];
    if let Some(messages) = candidates
        .iter()
        .flatten()
        .find_map(|candidate| candidate.as_array())
    {
        return Ok(messages.clone());
    }
    if candidates.into_iter().any(|candidate| candidate.is_some()) {
        return Err(TaskFailure {
            message: "漫游序列分页返回结构异常：msgList 不是数组".to_string(),
            code: "INVALID_ROAMING_RESPONSE".to_string(),
            http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
            roaming_scan: None,
        });
    }
    Err(TaskFailure {
        message: "漫游序列分页返回结构异常：缺少 msgList".to_string(),
        code: "INVALID_ROAMING_RESPONSE".to_string(),
        http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
        roaming_scan: None,
    })
}

fn sequence_native_failure_code(result: &Value) -> Option<i64> {
    [
        Some(result),
        result.get("msgsRsp").filter(|value| value.is_object()),
        result.get("result").filter(|value| value.is_object()),
    ]
    .into_iter()
    .flatten()
    .filter_map(|payload| loose_i64(payload.get("resultCode").or_else(|| payload.get("result"))))
    .find(|code| *code != 0)
}

fn tolerated_empty_sequence_rpc_code(detail: &str) -> Option<i64> {
    let normalized = detail.trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "2004000" | "2004007") {
        return normalized.parse().ok();
    }
    let tokens: Vec<&str> = normalized
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    tokens
        .windows(3)
        .find(|tokens| {
            tokens[0] == "qq" && tokens[1] == "result" && matches!(tokens[2], "2004000" | "2004007")
        })
        .and_then(|tokens| tokens[2].parse().ok())
}

fn roaming_native_failure(operation: &str, result_code: i64) -> TaskFailure {
    TaskFailure {
        message: format!("漫游 {operation} 返回未支持的 QQ 业务码: {result_code}"),
        code: "ROAMING_QUERY_FAILED".to_string(),
        http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
        roaming_scan: None,
    }
}

fn validate_latest_response(result: &Value) -> Result<Vec<Value>, TaskFailure> {
    if let Some(result_code) = sequence_native_failure_code(result) {
        if result_code == 2_004_000 {
            return Ok(Vec::new());
        }
        return Err(roaming_native_failure("latest", result_code));
    }
    let messages = extract_sequence_messages(result)?;
    for message in &messages {
        if positive_message_seq(message).is_none() || message_time_seconds(message).is_none() {
            return Err(TaskFailure {
                message: "漫游 latest 返回缺少正 msgSeq 或有效 msgTime 的消息".to_string(),
                code: "INVALID_ROAMING_RESPONSE".to_string(),
                http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
                roaming_scan: None,
            });
        }
    }
    Ok(messages)
}

fn validate_single_sequence_response(
    result: &Value,
    requested_seq: i64,
) -> Result<Vec<Value>, TaskFailure> {
    if let Some(result_code) = sequence_native_failure_code(result) {
        if matches!(result_code, 2_004_000 | 2_004_007) {
            return Ok(Vec::new());
        }
        return Err(roaming_native_failure("single", result_code));
    }
    let messages = extract_sequence_messages(result)?;
    if messages
        .iter()
        .any(|message| positive_message_seq(message) != Some(requested_seq))
    {
        return Err(TaskFailure {
            message: format!("漫游 single 返回的 msgSeq 与请求序列 {requested_seq} 不一致"),
            code: "INVALID_ROAMING_RESPONSE".to_string(),
            http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
            roaming_scan: None,
        });
    }
    Ok(messages)
}

async fn query_roaming_single_sequence(
    api: &dyn RoamingHistoryApi,
    runtime: &dyn RoamingScanRuntime,
    peer: &Peer,
    requested_seq: i64,
) -> Result<Vec<Value>, TaskFailure> {
    match call_roaming_with_retry(runtime, "query_single", || {
        api.query_single(peer, requested_seq)
    })
    .await
    {
        Ok(raw) => validate_single_sequence_response(&raw, requested_seq),
        Err(RoamingQueryFailure::Bridge(BridgeError::Rpc(detail)))
            if tolerated_empty_sequence_rpc_code(&detail).is_some() =>
        {
            Ok(Vec::new())
        }
        Err(error) => Err(roaming_query_failure(error)),
    }
}

fn query_time_for_local_date(date: NaiveDate) -> Result<i64, TaskFailure> {
    let day_start = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| TaskFailure::export("无法构造漫游查询日期"))?;
    for second_offset in 0..86_400 {
        let candidate = day_start + chrono::Duration::seconds(second_offset);
        if let Some(local) = Local.from_local_datetime(&candidate).earliest() {
            return Ok(local.timestamp());
        }
    }
    Err(TaskFailure::export("无法将漫游查询日期转换为本机时间"))
}

fn decimal_text(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(value))
            if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            Some(value.clone())
        }
        Some(Value::Number(value)) => value.as_u64().map(|value| value.to_string()),
        _ => None,
    }
}

fn positive_message_seq(message: &Value) -> Option<i64> {
    loose_i64(message.get("msgSeq")).filter(|value| *value > 0)
}

fn message_time_seconds(message: &Value) -> Option<i64> {
    let raw = loose_i64(message.get("msgTime"))?;
    let seconds = if raw > 9_999_999_999 {
        raw / 1_000
    } else {
        raw
    };
    (seconds > 0).then_some(seconds)
}

fn message_identity(message: &Value) -> String {
    if let Some(msg_id) = decimal_text(message.get("msgId")) {
        if msg_id.bytes().any(|byte| byte != b'0') {
            return format!("id:{msg_id}");
        }
    }
    if let (Some(msg_seq), Some(msg_time)) =
        (positive_message_seq(message), message_time_seconds(message))
    {
        return format!("seq:{msg_seq}:time:{msg_time}");
    }
    if let (Some(client_seq), Some(msg_time)) = (
        decimal_text(message.get("clientSeq")),
        message_time_seconds(message),
    ) {
        return format!("client:{client_seq}:time:{msg_time}");
    }
    let encoded = serde_json::to_vec(message).unwrap_or_default();
    let mut hasher = Md5::new();
    hasher.update(encoded);
    format!("raw:{:x}", hasher.finalize())
}

fn anchor_message_seq(anchor: &Value, messages: &[Value]) -> Option<i64> {
    let client_seq = decimal_text(anchor.get("clientSeq"));
    let msg_time = decimal_text(anchor.get("msgTime"));
    let anchor_seq = loose_i64(anchor.get("msgSeq")).filter(|value| *value > 0);
    messages.iter().find_map(|message| {
        let message_seq = positive_message_seq(message)?;
        if anchor_seq.is_some_and(|expected| expected != message_seq) {
            return None;
        }
        if decimal_text(message.get("clientSeq")) != client_seq
            || decimal_text(message.get("msgTime")) != msg_time
        {
            return None;
        }
        Some(message_seq)
    })
}

async fn append_roaming_messages(
    spool: &mut RawMessageSpool,
    messages: &[Value],
    config: &RoamingExportConfig,
    summary: &mut RoamingScanSummary,
    seen: &mut HashSet<String>,
) -> Result<bool, TaskFailure> {
    summary.raw_messages_seen += messages.len();
    let mut accepted = Vec::new();
    for message in messages {
        let Some(msg_time) = message_time_seconds(message) else {
            summary.untimestamped_messages += 1;
            summary.partial = true;
            continue;
        };
        if msg_time < config.start_time || msg_time > config.end_time {
            continue;
        }
        if summary.message_count >= config.max_messages {
            summary.partial = true;
            summary.stop_reason = "message_limit_reached".to_string();
            break;
        }
        let mut normalized_message = message.clone();
        if loose_i64(message.get("msgTime")).is_some_and(|raw| raw > 9_999_999_999) {
            if let Some(object) = normalized_message.as_object_mut() {
                object.insert("msgTime".to_string(), Value::from(msg_time));
            }
        }
        if !seen.insert(message_identity(&normalized_message)) {
            continue;
        }
        accepted.push(normalized_message);
        summary.message_count += 1;
    }
    spool.append(&accepted).await.map_err(TaskFailure::export)?;
    if summary.message_count >= config.max_messages {
        summary.partial = true;
        summary.stop_reason = "message_limit_reached".to_string();
        return Ok(true);
    }
    Ok(false)
}

fn discovery_progress(probed_days: usize, total_probe_days: usize) -> i64 {
    let fraction = probed_days as f64 / total_probe_days.max(1) as f64;
    (1.0 + 23.0 * fraction).round() as i64
}

fn sequence_window_progress(completed_windows: usize, total_windows: usize) -> i64 {
    25 + i64::try_from(24 * completed_windows / total_windows.max(1)).unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
async fn scan_roaming_sequence_window(
    api: &dyn RoamingHistoryApi,
    runtime: &dyn RoamingScanRuntime,
    peer: &Peer,
    older: &RoamingAnchor,
    newer: &RoamingAnchor,
    report_progress: i64,
    config: &RoamingExportConfig,
    spool: &mut RawMessageSpool,
    summary: &mut RoamingScanSummary,
    seen: &mut HashSet<String>,
) -> Result<bool, TaskFailure> {
    if newer.msg_seq <= older.msg_seq {
        summary.gap_count += 1;
        summary.partial = true;
        summary.stop_reason = "non_monotonic_anchor_sequence".to_string();
        return Ok(false);
    }
    let Some(mut next_seq) = older.msg_seq.checked_add(1) else {
        return Err(TaskFailure::export("漫游消息序列超出支持范围"));
    };
    let mut sequence_queries_since_report = 0usize;
    while next_seq < newer.msg_seq {
        if runtime.is_cancelled().await {
            return Err(TaskFailure::export("任务已被用户停止"));
        }
        let remaining_budget = config
            .max_sequence_queries
            .saturating_sub(summary.sequence_queries);
        if remaining_budget == 0 {
            summary.partial = true;
            summary.stop_reason = "sequence_query_limit_reached".to_string();
            return Ok(true);
        }
        if summary.sequence_queries > 0 && runtime.wait_between_sequence_batches().await {
            return Err(TaskFailure::export("任务已被用户停止"));
        }
        let distance = usize::try_from(newer.msg_seq - next_seq).unwrap_or(usize::MAX);
        let batch_len = ROAMING_SINGLE_QUERY_CONCURRENCY
            .min(remaining_budget)
            .min(distance);
        let sequences: Vec<i64> = (0..batch_len)
            .map(|offset| {
                next_seq
                    .checked_add(i64::try_from(offset).unwrap_or(i64::MAX))
                    .ok_or_else(|| TaskFailure::export("漫游消息序列超出支持范围"))
            })
            .collect::<Result<_, _>>()?;
        // 预算在发起并发批次前一次性预留，retry attempt 不重复计数。
        summary.sequence_queries += sequences.len();
        sequence_queries_since_report += sequences.len();
        let results = join_all(
            sequences
                .iter()
                .map(|sequence| query_roaming_single_sequence(api, runtime, peer, *sequence)),
        )
        .await;

        for result in results {
            let messages = result?;
            if messages.is_empty() {
                summary.empty_sequence_queries += 1;
                continue;
            }
            if append_roaming_messages(spool, &messages, config, summary, seen).await? {
                return Ok(true);
            }
        }
        next_seq = sequences
            .last()
            .and_then(|sequence| sequence.checked_add(1))
            .ok_or_else(|| TaskFailure::export("漫游消息序列超出支持范围"))?;

        // Anchor fallbacks can make the cumulative counter start at an
        // arbitrary offset. Report after each 100 queries made in this window
        // instead of waiting for the global total to land exactly on a
        // multiple of 100.
        if sequence_queries_since_report >= 100 {
            let message = format!(
                "正在逐序号核对漫游消息：{} 次查询，{} 条去重消息...",
                summary.sequence_queries, summary.message_count
            );
            runtime.report(summary, report_progress, &message).await;
            sequence_queries_since_report %= 100;
        }
    }
    Ok(false)
}

async fn scan_roaming_into_spool(
    api: &dyn RoamingHistoryApi,
    runtime: &dyn RoamingScanRuntime,
    peer: &Peer,
    config: &RoamingExportConfig,
    spool: &mut RawMessageSpool,
) -> Result<RoamingScanSummary, TaskFailure> {
    let mut summary = RoamingScanSummary::new(config);
    match scan_roaming_into_spool_inner(api, runtime, peer, config, spool, &mut summary).await {
        Ok(()) => {
            summary.current_date = None;
            Ok(summary)
        }
        Err(mut error) => {
            summary.partial = true;
            let stop_reason = error.roaming_stop_reason();
            summary.stop_reason = stop_reason.to_string();
            if stop_reason == "cancelled" {
                summary.current_date = None;
            }
            error.roaming_scan = Some(summary.as_value());
            Err(error)
        }
    }
}

async fn scan_roaming_into_spool_inner(
    api: &dyn RoamingHistoryApi,
    runtime: &dyn RoamingScanRuntime,
    peer: &Peer,
    config: &RoamingExportConfig,
    spool: &mut RawMessageSpool,
    summary: &mut RoamingScanSummary,
) -> Result<(), TaskFailure> {
    let mut seen = HashSet::new();
    let mut anchors = Vec::new();

    summary.latest_queries += 1;
    let latest_raw = call_roaming_with_retry(runtime, "query_latest", || {
        api.query_latest(peer, ROAMING_LATEST_MESSAGE_COUNT)
    })
    .await
    .map_err(roaming_query_failure)?;
    let latest_messages = validate_latest_response(&latest_raw)?;
    let latest_anchors = latest_messages
        .iter()
        .filter_map(|message| {
            Some(RoamingAnchor {
                msg_time: message_time_seconds(message)?.to_string(),
                msg_seq: positive_message_seq(message)?,
            })
        })
        .collect::<Vec<_>>();
    let mut latest_times_by_sequence = HashMap::new();
    let latest_has_conflicting_sequence_time = latest_anchors.iter().any(|anchor| {
        latest_times_by_sequence
            .insert(anchor.msg_seq, anchor.msg_time.clone())
            .is_some_and(|previous| previous != anchor.msg_time)
    });
    let latest_anchor = latest_anchors
        .into_iter()
        .max_by_key(|anchor| anchor.msg_seq);
    let latest_is_within_end = latest_anchor
        .as_ref()
        .and_then(|anchor| anchor.msg_time.parse::<i64>().ok())
        .is_some_and(|time| time <= config.end_time);
    let latest_reached_message_limit =
        append_roaming_messages(spool, &latest_messages, config, summary, &mut seen).await?;
    if latest_has_conflicting_sequence_time {
        summary.gap_count += 1;
        summary.partial = true;
        summary.stop_reason = "non_monotonic_anchor_sequence".to_string();
        return Ok(());
    }
    if latest_reached_message_limit {
        return Ok(());
    }

    let lookahead_days = if latest_anchor.is_some() && latest_is_within_end {
        0
    } else {
        usize::try_from(ROAMING_CLOSING_LOOKAHEAD_DAYS).unwrap_or_default()
    };
    let total_probe_days = config.requested_days + lookahead_days;
    let mut previous_month = None;

    for probe_index in 0..total_probe_days {
        if runtime.is_cancelled().await {
            return Err(TaskFailure::export("任务已被用户停止"));
        }
        let offset = i64::try_from(probe_index).map_err(|_| TaskFailure::export("日期范围过大"))?;
        let Some(date) = config
            .start_date
            .checked_add_signed(chrono::Duration::days(offset))
        else {
            return Err(TaskFailure::export("日期范围超出支持范围"));
        };
        let is_requested_date = date <= config.end_date;
        let day_start = query_time_for_local_date(date)?;
        let query_time = if date == config.start_date {
            day_start.max(config.start_time)
        } else {
            day_start
        };
        summary.current_date = Some(date);
        summary.probed_days += 1;
        if is_requested_date {
            summary.scanned_days += 1;
        }

        let month = (date.year(), date.month());
        if previous_month != Some(month) {
            summary.calendar_queries += 1;
            let calendar_valid = match call_roaming_with_retry(runtime, "query_calendar", || {
                api.query_calendar(peer, query_time)
            })
            .await
            {
                Ok(raw) => roaming::normalize_calendar_response(&raw).is_ok_and(|calendar| {
                    validate_normalized_roaming_result(&calendar, false, "calendar").is_ok()
                }),
                Err(RoamingQueryFailure::Cancelled) => {
                    return Err(TaskFailure::export("任务已被用户停止"));
                }
                Err(RoamingQueryFailure::Bridge(_)) => false,
            };
            if !calendar_valid {
                summary.calendar_errors += 1;
                tracing::warn!(
                    "[RoamingScan] 漫游日历提示查询失败，继续执行逐日锚点扫描: year={}, month={}",
                    date.year(),
                    date.month()
                );
            }
            previous_month = Some(month);
        }

        let raw =
            call_roaming_with_retry(runtime, "query_first", || api.query_first(peer, query_time))
                .await
                .map_err(roaming_query_failure)?;
        let normalized = roaming::normalize_first_response(&raw).map_err(TaskFailure::from_api)?;
        let found = normalized.get("found").and_then(Value::as_bool) == Some(true);
        validate_normalized_roaming_result(&normalized, found, "first")?;
        if found {
            summary.anchor_days += 1;
            let anchor = normalized.get("anchor").cloned().unwrap_or(Value::Null);
            let anchor_time =
                decimal_text(anchor.get("msgTime")).and_then(|value| value.parse::<i64>().ok());
            let anchor_date = anchor_time.and_then(|seconds| local_date_from_seconds(seconds).ok());
            if anchor_date != Some(date) {
                summary.mismatched_anchors += 1;
                summary.partial = true;
            } else if let (Some(client_seq), Some(msg_time)) = (
                decimal_text(anchor.get("clientSeq")),
                decimal_text(anchor.get("msgTime")),
            ) {
                summary.exact_queries += 1;
                let exact_result = call_roaming_with_retry(runtime, "query_exact", || {
                    api.query_exact(peer, &client_seq, &msg_time)
                })
                .await;
                let messages = match exact_result {
                    Ok(exact_raw) => {
                        let exact = roaming::normalize_exact_response(&exact_raw)
                            .map_err(TaskFailure::from_api)?;
                        let messages = exact
                            .get("messages")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let result_code =
                            loose_i64(exact.get("resultCode")).ok_or_else(|| TaskFailure {
                                message: "漫游 exact 响应缺少有效 resultCode".to_string(),
                                code: "INVALID_ROAMING_RESPONSE".to_string(),
                                http_status: axum::http::StatusCode::BAD_GATEWAY.as_u16(),
                                roaming_scan: None,
                            })?;
                        if messages.is_empty() && !matches!(result_code, 0 | 2_004_000 | 2_004_007)
                        {
                            return Err(roaming_native_failure("exact", result_code));
                        }
                        messages
                    }
                    Err(RoamingQueryFailure::Bridge(BridgeError::Rpc(detail)))
                        if tolerated_empty_sequence_rpc_code(&detail).is_some() =>
                    {
                        Vec::new()
                    }
                    Err(error) => return Err(roaming_query_failure(error)),
                };
                let mut msg_seq = anchor_message_seq(&anchor, &messages);
                // exact 在部分 QQ/NTQQ 版本上可能返回结构合法但与请求锚点无关的旧批次。
                // 只有批次内确实存在匹配锚点时，整批消息才有资格进入有界结果。
                if msg_seq.is_some()
                    && append_roaming_messages(spool, &messages, config, summary, &mut seen).await?
                {
                    runtime
                        .report(
                            summary,
                            discovery_progress(summary.probed_days, total_probe_days),
                            "漫游消息已达到请求上限，准备导出有界结果...",
                        )
                        .await;
                    return Ok(());
                }
                if msg_seq.is_none() {
                    if let Some(anchor_seq) =
                        loose_i64(anchor.get("msgSeq")).filter(|value| *value > 0)
                    {
                        if summary.sequence_queries >= config.max_sequence_queries {
                            summary.partial = true;
                            summary.stop_reason = "sequence_query_limit_reached".to_string();
                            return Ok(());
                        }
                        summary.sequence_queries += 1;
                        let endpoint_messages =
                            query_roaming_single_sequence(api, runtime, peer, anchor_seq).await?;
                        if endpoint_messages.is_empty() {
                            summary.empty_sequence_queries += 1;
                        } else if let Some(recovered_seq) =
                            anchor_message_seq(&anchor, &endpoint_messages)
                        {
                            if append_roaming_messages(
                                spool,
                                &endpoint_messages,
                                config,
                                summary,
                                &mut seen,
                            )
                            .await?
                            {
                                runtime
                                    .report(
                                        summary,
                                        discovery_progress(summary.probed_days, total_probe_days),
                                        "漫游消息已达到请求上限，准备导出有界结果...",
                                    )
                                    .await;
                                return Ok(());
                            }
                            msg_seq = Some(recovered_seq);
                        }
                    }
                }
                if let Some(msg_seq) = msg_seq {
                    anchors.push(RoamingAnchor { msg_time, msg_seq });
                    // `end_time` is inclusive. An anchor at the exact same second may have
                    // higher-sequence siblings that exact did not return, so only a strictly
                    // later anchor proves the requested second has been crossed.
                    if anchor_time.is_some_and(|seconds| seconds > config.end_time) {
                        summary.closing_anchor_found = true;
                    }
                } else {
                    summary.unresolved_anchors += 1;
                    summary.partial = true;
                }
            }
        }

        let progress = discovery_progress(summary.probed_days, total_probe_days);
        let message = format!(
            "正在扫描漫游日期：{}/{}，已恢复 {} 条去重消息...",
            summary.scanned_days, summary.requested_days, summary.message_count
        );
        runtime.report(summary, progress, &message).await;
        if summary.closing_anchor_found {
            break;
        }
        if probe_index + 1 < total_probe_days && runtime.wait_between_daily_probes().await {
            return Err(TaskFailure::export("任务已被用户停止"));
        }
    }

    if !summary.closing_anchor_found {
        if let Some(latest_anchor) = latest_anchor {
            let latest_time = latest_anchor.msg_time.parse::<i64>().ok();
            let probe_horizon_date = i64::try_from(lookahead_days).ok().and_then(|days| {
                config
                    .end_date
                    .checked_add_signed(chrono::Duration::days(days))
            });
            let latest_within_probe_horizon = latest_time
                .and_then(|time| local_date_from_seconds(time).ok())
                .zip(probe_horizon_date)
                .is_some_and(|(latest_date, horizon_date)| latest_date <= horizon_date);
            let follows_all_discovered_anchors = anchors.iter().all(|anchor| {
                latest_time
                    .zip(anchor.msg_time.parse::<i64>().ok())
                    .is_some_and(|(latest, discovered)| {
                        latest >= discovered && latest_anchor.msg_seq >= anchor.msg_seq
                    })
            });
            // With no daily anchor, the small `latest` page proves an empty requested range
            // only when the newest known message is strictly older than the range. An
            // in-range or post-range latest page cannot establish that all requested days
            // were scanned successfully by itself.
            let proves_empty_requested_range =
                latest_time.is_some_and(|time| time < config.start_time);
            if follows_all_discovered_anchors
                && if anchors.is_empty() {
                    proves_empty_requested_range
                } else {
                    latest_within_probe_horizon
                }
            {
                anchors.push(latest_anchor);
                summary.closing_anchor_found = true;
            } else {
                summary.partial = true;
                if summary.unresolved_anchors == 0 && summary.stop_reason == "running" {
                    summary.stop_reason = "closing_anchor_not_found".to_string();
                }
            }
        } else {
            summary.partial = true;
            summary.stop_reason = "closing_anchor_not_found".to_string();
        }
    }

    // 按本地时间稳定排序，只移除时间与序列都相同的重复锚点；同序列不同时间的
    // 矛盾锚点必须保留给窗口单调性校验。最老锚点之前没有经服务端验证的序列
    // 边界，因此不向 seq=1 盲扫；最终仍按请求时间范围过滤所有恢复出的消息。
    sort_and_deduplicate_anchors(&mut anchors);
    let total_windows = anchors.len().saturating_sub(1).max(1);
    for (index, window) in anchors.windows(2).enumerate() {
        if runtime.is_cancelled().await {
            return Err(TaskFailure::export("任务已被用户停止"));
        }
        let report_progress = sequence_window_progress(index, total_windows);
        if scan_roaming_sequence_window(
            api,
            runtime,
            peer,
            &window[0],
            &window[1],
            report_progress,
            config,
            spool,
            summary,
            &mut seen,
        )
        .await?
        {
            break;
        }
        let completed_windows = index + 1;
        let progress = sequence_window_progress(completed_windows, total_windows);
        let message = format!(
            "已核对 {completed_windows}/{total_windows} 个锚点区间，恢复 {} 条去重消息...",
            summary.message_count
        );
        runtime.report(summary, progress, &message).await;
    }

    if summary.stop_reason == "running" {
        summary.stop_reason = if summary.partial {
            if summary.gap_count > 0 {
                "sequence_gaps_encountered"
            } else if summary.unresolved_anchors > 0 {
                "unresolved_anchors"
            } else if summary.untimestamped_messages > 0 {
                "untimestamped_messages"
            } else {
                "bounded_partial_result"
            }
        } else {
            "requested_range_scanned"
        }
        .to_string();
    }
    summary.current_date = None;
    Ok(())
}

fn sort_and_deduplicate_anchors(anchors: &mut Vec<RoamingAnchor>) {
    anchors.sort_by_key(|anchor| (anchor.msg_time.parse::<i64>().unwrap_or(0), anchor.msg_seq));
    let mut anchor_pairs = HashSet::new();
    anchors.retain(|anchor| {
        anchor_pairs.insert((anchor.msg_time.parse::<i64>().unwrap_or(0), anchor.msg_seq))
    });
}

pub(super) async fn scan_task_into_spool(
    state: &SharedState,
    task_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    peer: &Peer,
    config: &RoamingExportConfig,
    spool: &mut RawMessageSpool,
) -> Result<RoamingScanSummary, TaskFailure> {
    let runtime = TaskRoamingScanRuntime {
        state: Arc::clone(state),
        task_id: task_id.to_string(),
        cancel_flag: Arc::clone(cancel_flag),
    };
    scan_roaming_into_spool(&state.napcat, &runtime, peer, config, spool).await
}

#[cfg(test)]
mod tests;
