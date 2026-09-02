use super::super::{
    parse_roaming_export_config, RawMessageSpool, RoamingExportConfig, RoamingScanSummary,
    SpoolChunkReader, MAX_ROAMING_SCAN_DAYS, RAW_SPOOL_CHUNK_SIZE,
};
use super::{
    anchor_message_seq, append_roaming_messages, call_roaming_with_retry,
    extract_sequence_messages, is_retryable_roaming_error, query_time_for_local_date,
    roaming_task_failure, scan_roaming_into_spool, scan_roaming_sequence_window,
    sequence_native_failure_code, sequence_window_progress, sort_and_deduplicate_anchors,
    tolerated_empty_sequence_rpc_code, validate_latest_response, RoamingAnchor, RoamingHistoryApi,
    RoamingQueryFailure, RoamingScanRuntime,
};
use crate::fetcher::Peer;
use crate::napcat::BridgeError;
use crate::parser::simple_parser::{SimpleMessageParser, SimpleParserOptions};
use async_trait::async_trait;
use chrono::{Duration, NaiveDate};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;

#[test]
fn roaming_export_contract_requires_seconds_and_bounded_private_range() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start = query_time_for_local_date(start_date).expect("local timestamp");
    let end = query_time_for_local_date(start_date + Duration::days(30)).expect("local timestamp");
    let body = json!({
        "peer": {"chatType": 1, "peerUid": "u_test_peer", "guildId": ""},
        "filter": {"startTime": start, "endTime": end},
        "roaming": {"maxMessages": 1234, "maxSequenceQueries": 4321}
    });
    let config = parse_roaming_export_config(&body).expect("valid roaming export contract");
    assert_eq!(config.requested_days, 31);
    assert_eq!(config.max_messages, 1234);
    assert_eq!(config.max_sequence_queries, 4321);

    let mut fractional = body.clone();
    fractional["filter"]["startTime"] = json!(start as f64 + 0.5);
    assert_eq!(
        parse_roaming_export_config(&fractional)
            .expect_err("fractional timestamps must be rejected")
            .code,
        "INVALID_ROAMING_TIME_RANGE"
    );

    let mut milliseconds = body.clone();
    milliseconds["filter"]["startTime"] = json!(start * 1_000);
    assert_eq!(
        parse_roaming_export_config(&milliseconds)
            .expect_err("milliseconds must be rejected")
            .code,
        "INVALID_ROAMING_TIME_RANGE"
    );

    let mut oversized = body;
    oversized["filter"]["endTime"] = json!(query_time_for_local_date(
        start_date + Duration::days(MAX_ROAMING_SCAN_DAYS)
    )
    .expect("oversized end"));
    assert_eq!(
        parse_roaming_export_config(&oversized)
            .expect_err("range beyond hard limit")
            .code,
        "ROAMING_RANGE_TOO_LARGE"
    );

    let mut excessive_messages = oversized;
    excessive_messages["filter"]["endTime"] = json!(end);
    excessive_messages["roaming"]["maxMessages"] = json!(100_001);
    assert_eq!(
        parse_roaming_export_config(&excessive_messages)
            .expect_err("message limit beyond hard bound")
            .code,
        "INVALID_ROAMING_LIMIT"
    );

    excessive_messages["roaming"]["maxMessages"] = json!(100_000);
    excessive_messages["roaming"]["maxSequenceQueries"] = json!(100_001);
    assert_eq!(
        parse_roaming_export_config(&excessive_messages)
            .expect_err("sequence query limit beyond hard bound")
            .code,
        "INVALID_ROAMING_LIMIT"
    );
}

#[derive(Default)]
struct MockRoamingRuntime {
    reports: Mutex<Vec<(i64, usize)>>,
    waits: Mutex<usize>,
    sequence_batch_waits: Mutex<usize>,
    retry_waits: Mutex<Vec<u64>>,
    cancel_during_retry: bool,
}

#[async_trait]
impl RoamingScanRuntime for MockRoamingRuntime {
    async fn is_cancelled(&self) -> bool {
        false
    }

    async fn report(&self, summary: &RoamingScanSummary, progress: i64, _message: &str) {
        self.reports
            .lock()
            .expect("report lock")
            .push((progress, summary.message_count));
    }

    async fn wait_between_daily_probes(&self) -> bool {
        *self.waits.lock().expect("waits lock") += 1;
        false
    }

    async fn wait_between_sequence_batches(&self) -> bool {
        *self
            .sequence_batch_waits
            .lock()
            .expect("sequence batch waits lock") += 1;
        false
    }

    async fn wait_before_retry(&self, delay_ms: u64) -> bool {
        self.retry_waits
            .lock()
            .expect("retry waits lock")
            .push(delay_ms);
        self.cancel_during_retry
    }
}

struct CancelAfterFirstProbeRuntime;

#[async_trait]
impl RoamingScanRuntime for CancelAfterFirstProbeRuntime {
    async fn is_cancelled(&self) -> bool {
        false
    }

    async fn report(&self, _summary: &RoamingScanSummary, _progress: i64, _message: &str) {}

    async fn wait_between_daily_probes(&self) -> bool {
        true
    }

    async fn wait_between_sequence_batches(&self) -> bool {
        true
    }

    async fn wait_before_retry(&self, _delay_ms: u64) -> bool {
        true
    }
}

#[test]
fn roaming_daily_probe_starts_at_local_midnight() {
    let date = NaiveDate::from_ymd_opt(2023, 1, 15).expect("fixture date");
    let timestamp = query_time_for_local_date(date).expect("local day start");
    let local = chrono::DateTime::from_timestamp(timestamp, 0)
        .expect("valid timestamp")
        .with_timezone(&chrono::Local);

    assert_eq!(local.date_naive(), date);
    assert_eq!(local.time(), chrono::NaiveTime::MIN);
}

#[test]
fn periodic_sequence_progress_never_regresses_between_windows() {
    let total_windows = 4;
    let mut reports = Vec::new();
    for completed_before in 0..total_windows {
        // 周期页报告使用当前窗口基线，窗口完成报告再前进一步。
        reports.push(sequence_window_progress(completed_before, total_windows));
        reports.push(sequence_window_progress(completed_before, total_windows));
        reports.push(sequence_window_progress(
            completed_before + 1,
            total_windows,
        ));
    }
    assert_eq!(reports.first(), Some(&25));
    assert_eq!(reports.last(), Some(&49));
    assert!(reports.windows(2).all(|window| window[0] <= window[1]));
}

#[tokio::test]
async fn roaming_retry_recovers_after_one_transport_disconnect() {
    let runtime = MockRoamingRuntime::default();
    let attempts = std::sync::atomic::AtomicUsize::new(0);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind a disposable local port");
    let address = listener.local_addr().expect("local listener address");
    drop(listener);

    let result = call_roaming_with_retry(&runtime, "query_first", || {
        let attempt = attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async move {
            if attempt == 0 {
                let error = reqwest::Client::new()
                    .get(format!("http://{address}"))
                    .send()
                    .await
                    .expect_err("closed local port must refuse the connection");
                assert!(
                    error.is_connect(),
                    "fixture must be a connect error: {error}"
                );
                Err(BridgeError::Transport(error))
            } else {
                Ok(json!({"result": 0, "roamDatemsg": {}}))
            }
        }
    })
    .await
    .expect("the second attempt succeeds");

    assert_eq!(result["result"], 0);
    assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert_eq!(
        *runtime.retry_waits.lock().expect("retry waits lock"),
        vec![120]
    );
}

#[tokio::test]
async fn roaming_retry_cancellation_stops_during_backoff() {
    let runtime = MockRoamingRuntime {
        cancel_during_retry: true,
        ..MockRoamingRuntime::default()
    };
    let attempts = std::sync::atomic::AtomicUsize::new(0);

    let result = call_roaming_with_retry(&runtime, "query_exact", || {
        attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async {
            Err(BridgeError::Rpc(
                "RPC timeout while worker is busy".to_string(),
            ))
        }
    })
    .await;

    assert!(matches!(result, Err(RoamingQueryFailure::Cancelled)));
    assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        *runtime.retry_waits.lock().expect("retry waits lock"),
        vec![120]
    );
}

#[tokio::test]
async fn roaming_retry_is_bounded_and_skips_permanent_errors() {
    let runtime = MockRoamingRuntime::default();
    let attempts = std::sync::atomic::AtomicUsize::new(0);
    let result = call_roaming_with_retry(&runtime, "query_single", || {
        attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async {
            Err(BridgeError::Rpc(
                "worker temporarily unavailable".to_string(),
            ))
        }
    })
    .await;
    assert!(matches!(result, Err(RoamingQueryFailure::Bridge(_))));
    assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 4);
    assert_eq!(
        *runtime.retry_waits.lock().expect("retry waits lock"),
        vec![120, 240, 480]
    );

    let no_retry_runtime = MockRoamingRuntime::default();
    let no_retry_attempts = std::sync::atomic::AtomicUsize::new(0);
    let result = call_roaming_with_retry(&no_retry_runtime, "query_first", || {
        no_retry_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async {
            Err(BridgeError::Rpc(
                "TypeError: invalid request shape".to_string(),
            ))
        }
    })
    .await;
    assert!(matches!(result, Err(RoamingQueryFailure::Bridge(_))));
    assert_eq!(
        no_retry_attempts.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert!(no_retry_runtime
        .retry_waits
        .lock()
        .expect("retry waits lock")
        .is_empty());

    for detail in [
        "method not found",
        "query_failed_qq_result_2004007",
        "2004007",
    ] {
        assert!(!is_retryable_roaming_error(&BridgeError::Rpc(
            detail.to_string()
        )));
    }
}

#[tokio::test]
async fn roaming_retry_does_not_retry_builder_or_decode_errors() {
    let builder_runtime = MockRoamingRuntime::default();
    let builder_attempts = std::sync::atomic::AtomicUsize::new(0);
    let builder_result = call_roaming_with_retry(&builder_runtime, "query_latest", || {
        builder_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async {
            let error = reqwest::Client::new()
                .get("not a valid URL")
                .build()
                .expect_err("fixture URL must fail to build");
            assert!(error.is_builder());
            Err(BridgeError::Transport(error))
        }
    })
    .await;
    assert!(matches!(
        builder_result,
        Err(RoamingQueryFailure::Bridge(_))
    ));
    assert_eq!(
        builder_attempts.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert!(builder_runtime
        .retry_waits
        .lock()
        .expect("retry waits lock")
        .is_empty());

    let decode_runtime = MockRoamingRuntime::default();
    let decode_attempts = std::sync::atomic::AtomicUsize::new(0);
    let decode_result = call_roaming_with_retry(&decode_runtime, "query_single", || {
            decode_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async {
                use tokio::io::AsyncWriteExt as _;

                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("bind JSON fixture server");
                let address = listener.local_addr().expect("fixture server address");
                let server = tokio::spawn(async move {
                    let (mut stream, _) = listener.accept().await.expect("accept fixture request");
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 8\r\nconnection: close\r\n\r\nnot-json",
                        )
                        .await
                        .expect("write invalid JSON response");
                });
                let response = reqwest::Client::new()
                    .get(format!("http://{address}"))
                    .send()
                    .await
                    .expect("receive fixture response");
                let error = response
                    .json::<Value>()
                    .await
                    .expect_err("fixture body must fail JSON decoding");
                server.await.expect("fixture server task");
                assert!(error.is_decode());
                Err(BridgeError::Transport(error))
            }
        })
        .await;
    assert!(matches!(decode_result, Err(RoamingQueryFailure::Bridge(_))));
    assert_eq!(decode_attempts.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(decode_runtime
        .retry_waits
        .lock()
        .expect("retry waits lock")
        .is_empty());
}

struct MockRoamingApi {
    start_date: NaiveDate,
    calls: Mutex<Vec<String>>,
    calendar_error: bool,
    calendar_result_code: Option<i64>,
    anchor_hour: u32,
    first_empty_result_code: Option<i64>,
    first_omit_anchor_field: bool,
    first_uses_negative_sentinel: bool,
    exact_empty_result_code: Option<i64>,
    exact_rpc_result_code: Option<i64>,
    exact_returns_mismatched_batch: bool,
    invalid_sequence_response: bool,
    business_error_anchor: Option<i64>,
    native_error_code: Option<i64>,
    native_error_has_msg_list: bool,
    latest_empty: bool,
    latest_is_stale: bool,
    latest_is_far_future: bool,
    latest_has_conflicting_sequence_time: bool,
}

impl MockRoamingApi {
    fn message(&self, seq: i64, date_offset: i64, hour: u32) -> Value {
        let date = self.start_date + Duration::days(date_offset);
        let base = query_time_for_local_date(date).expect("message date");
        let seconds = base + i64::from(hour) * 60 * 60;
        json!({
            "msgId": seq.to_string(),
            "msgSeq": seq.to_string(),
            "clientSeq": seq.to_string(),
            "msgTime": seconds.to_string(),
            "senderUid": "u_sender_fixture",
            "elements": []
        })
    }

    fn anchor_for_date(&self, date: NaiveDate) -> Option<Value> {
        let offset = (date - self.start_date).num_days();
        let seq = match offset {
            0 => 100,
            1 => 110,
            2 => 120,
            _ => return None,
        };
        let message = self.message(seq, offset, self.anchor_hour);
        Some(json!({
            "clientSeq": seq.to_string(),
            "msgSeq": seq.to_string(),
            "msgTime": message["msgTime"],
        }))
    }
}

#[async_trait]
impl RoamingHistoryApi for MockRoamingApi {
    async fn query_calendar(&self, _peer: &Peer, _msg_time: i64) -> Result<Value, BridgeError> {
        self.calls
            .lock()
            .expect("calls lock")
            .push("calendar".to_string());
        if self.calendar_error {
            return Err(BridgeError::Rpc(
                "worker temporarily unavailable".to_string(),
            ));
        }
        Ok(json!({
            "result": self.calendar_result_code.unwrap_or(0),
            "calendar": []
        }))
    }

    async fn query_first(&self, _peer: &Peer, msg_time: i64) -> Result<Value, BridgeError> {
        let date =
            super::local_date_from_seconds(msg_time).expect("query timestamp must resolve to date");
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("first:{date}"));
        if let Some(result_code) = self.first_empty_result_code {
            return Ok(if self.first_omit_anchor_field {
                json!({"result": result_code})
            } else {
                json!({"result": result_code, "roamDatemsg": {}})
            });
        }
        if self.first_uses_negative_sentinel {
            return Ok(json!({
                "result": 0,
                "roamDatemsg": {"msgSeq": -1, "clientSeq": -1, "msgTime": -1}
            }));
        }
        Ok(self.anchor_for_date(date).map_or_else(
            || json!({"result": 0, "roamDatemsg": {}}),
            |anchor| json!({"result": 0, "roamDatemsg": anchor}),
        ))
    }

    async fn query_exact(
        &self,
        _peer: &Peer,
        client_seq: &str,
        _msg_time: &str,
    ) -> Result<Value, BridgeError> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("exact:{client_seq}"));
        if let Some(result_code) = self.exact_rpc_result_code {
            return Err(BridgeError::Rpc(format!(
                "query_failed_qq_result_{result_code}"
            )));
        }
        if let Some(result_code) = self.exact_empty_result_code {
            return Ok(json!({"result": result_code, "msgList": []}));
        }
        let seq = client_seq.parse::<i64>().expect("fixture client seq");
        let offset = (seq - 100) / 10;
        if self.exact_returns_mismatched_batch {
            return Ok(json!({
                "result": 0,
                "msgList": [self.message(seq + 1_000, offset, self.anchor_hour)]
            }));
        }
        Ok(json!({
            "result": 0,
            "msgList": [self.message(seq, offset, self.anchor_hour)]
        }))
    }

    async fn query_latest(&self, _peer: &Peer, count: i64) -> Result<Value, BridgeError> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("latest:{count}"));
        let messages = if self.latest_empty {
            Vec::new()
        } else if self.latest_has_conflicting_sequence_time {
            let mut in_range = self.message(120, 1, 0);
            let in_range_millis = in_range["msgTime"]
                .as_str()
                .expect("fixture message time")
                .parse::<i64>()
                .expect("fixture seconds")
                * 1_000;
            in_range["msgTime"] = Value::from(in_range_millis);
            vec![self.message(120, 2, 0), in_range]
        } else if self.latest_is_far_future {
            vec![self.message(10_000, 365 * 3, 0)]
        } else if self.latest_is_stale {
            vec![self.message(90, 0, 0)]
        } else {
            vec![self.message(120, 2, 0)]
        };
        Ok(json!({"result": 0, "msgList": messages}))
    }

    async fn query_single(&self, _peer: &Peer, anchor_seq: i64) -> Result<Value, BridgeError> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("single:{anchor_seq}"));
        if self.business_error_anchor == Some(anchor_seq) {
            return Err(BridgeError::Rpc(
                "query_failed_qq_result_2004007".to_string(),
            ));
        }
        if let Some(result_code) = self.native_error_code {
            return Ok(if self.native_error_has_msg_list {
                json!({
                    "result": result_code,
                    "msgList": [self.message(anchor_seq, 0, 12)]
                })
            } else {
                json!({"result": result_code})
            });
        }
        if self.invalid_sequence_response {
            return Ok(json!({"unexpected": []}));
        }
        let recover_exact_anchor = self
            .exact_empty_result_code
            .or(self.exact_rpc_result_code)
            .is_some_and(|code| matches!(code, 2_004_000 | 2_004_007))
            || self.exact_returns_mismatched_batch;
        let messages = match anchor_seq {
            100 | 110 | 120 if recover_exact_anchor => {
                let offset = (anchor_seq - 100) / 10;
                vec![self.message(anchor_seq, offset, self.anchor_hour)]
            }
            105 => vec![self.message(105, 0, 12)],
            115 => vec![self.message(115, 1, 12)],
            _ => Vec::new(),
        };
        Ok(json!({"result": 0, "msgList": messages}))
    }
}

fn roaming_test_config(start_date: NaiveDate) -> RoamingExportConfig {
    RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    }
}

fn mock_roaming_api(start_date: NaiveDate) -> MockRoamingApi {
    MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: None,
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    }
}

async fn run_mock_roaming_scan(
    label: &str,
    api: &MockRoamingApi,
    config: &RoamingExportConfig,
) -> Result<RoamingScanSummary, super::TaskFailure> {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-{label}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let result = scan_roaming_into_spool(api, &runtime, &peer, config, &mut spool).await;
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
    result
}

struct SingleSequenceApi {
    calls: Mutex<Vec<i64>>,
    msg_time: i64,
}

#[async_trait]
impl RoamingHistoryApi for SingleSequenceApi {
    async fn query_calendar(&self, _peer: &Peer, _msg_time: i64) -> Result<Value, BridgeError> {
        unreachable!("direct sequence test does not query calendar")
    }

    async fn query_first(&self, _peer: &Peer, _msg_time: i64) -> Result<Value, BridgeError> {
        unreachable!("direct sequence test does not query first")
    }

    async fn query_exact(
        &self,
        _peer: &Peer,
        _client_seq: &str,
        _msg_time: &str,
    ) -> Result<Value, BridgeError> {
        unreachable!("direct sequence test does not query exact")
    }

    async fn query_latest(&self, _peer: &Peer, _count: i64) -> Result<Value, BridgeError> {
        unreachable!("direct sequence test does not query latest")
    }

    async fn query_single(&self, _peer: &Peer, msg_seq: i64) -> Result<Value, BridgeError> {
        self.calls.lock().expect("calls lock").push(msg_seq);
        let messages = if matches!(msg_seq, 102 | 104) {
            vec![json!({
                "msgId": msg_seq.to_string(),
                "msgSeq": msg_seq.to_string(),
                "msgTime": self.msg_time,
                "elements": []
            })]
        } else {
            Vec::new()
        };
        Ok(json!({
            "result": 0,
            "msgList": messages
        }))
    }
}

#[tokio::test]
async fn roaming_sequence_scan_checks_the_open_interval_in_order() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-frontier-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let config = RoamingExportConfig {
        start_time,
        end_time: start_time + 86_399,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = SingleSequenceApi {
        calls: Mutex::new(Vec::new()),
        msg_time: start_time,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let older = RoamingAnchor {
        msg_time: start_time.to_string(),
        msg_seq: 100,
    };
    let newer = RoamingAnchor {
        msg_time: start_time.to_string(),
        msg_seq: 106,
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let mut summary = RoamingScanSummary::new(&config);
    let mut seen = HashSet::new();

    assert!(!scan_roaming_sequence_window(
        &api,
        &runtime,
        &peer,
        &older,
        &newer,
        25,
        &config,
        &mut spool,
        &mut summary,
        &mut seen,
    )
    .await
    .expect("scan the open interval"));

    assert_eq!(
        *api.calls.lock().expect("calls lock"),
        vec![101, 102, 103, 104, 105]
    );
    assert_eq!(summary.sequence_queries, 5);
    assert_eq!(summary.empty_sequence_queries, 3);
    assert_eq!(summary.message_count, 2);
    assert_eq!(spool.count(), 2);
    assert_eq!(*runtime.sequence_batch_waits.lock().expect("waits lock"), 1);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn conflicting_anchor_times_with_the_same_sequence_are_not_silently_deduplicated() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-conflicting-anchor-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let config = RoamingExportConfig {
        start_time,
        end_time: start_time + 86_399,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = SingleSequenceApi {
        calls: Mutex::new(Vec::new()),
        msg_time: start_time,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut anchors = vec![
        RoamingAnchor {
            msg_time: start_time.to_string(),
            msg_seq: 100,
        },
        RoamingAnchor {
            msg_time: start_time.to_string(),
            msg_seq: 100,
        },
        RoamingAnchor {
            msg_time: (start_time + 60).to_string(),
            msg_seq: 100,
        },
    ];

    sort_and_deduplicate_anchors(&mut anchors);
    assert_eq!(anchors.len(), 2, "only the exact duplicate is removed");

    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let mut summary = RoamingScanSummary::new(&config);
    let mut seen = HashSet::new();
    assert!(!scan_roaming_sequence_window(
        &api,
        &runtime,
        &peer,
        &anchors[0],
        &anchors[1],
        25,
        &config,
        &mut spool,
        &mut summary,
        &mut seen,
    )
    .await
    .expect("conflicting anchors produce a bounded partial result"));

    assert!(summary.partial);
    assert_eq!(summary.gap_count, 1);
    assert_eq!(summary.stop_reason, "non_monotonic_anchor_sequence");
    assert!(api.calls.lock().expect("calls lock").is_empty());
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_sequence_scan_reports_progress_after_crossing_a_hundred_queries() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-progress-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let config = RoamingExportConfig {
        start_time,
        end_time: start_time + 86_399,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 100,
        max_sequence_queries: 200,
    };
    let api = SingleSequenceApi {
        calls: Mutex::new(Vec::new()),
        msg_time: start_time,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let older = RoamingAnchor {
        msg_time: start_time.to_string(),
        msg_seq: 100,
    };
    let newer = RoamingAnchor {
        msg_time: start_time.to_string(),
        msg_seq: 210,
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let mut summary = RoamingScanSummary::new(&config);
    // Exact-anchor fallbacks can offset the global query count before a
    // sequence window starts. The periodic report must not depend on an exact
    // modulo match.
    summary.sequence_queries = 1;
    let mut seen = HashSet::new();

    assert!(!scan_roaming_sequence_window(
        &api,
        &runtime,
        &peer,
        &older,
        &newer,
        25,
        &config,
        &mut spool,
        &mut summary,
        &mut seen,
    )
    .await
    .expect("scan a long sequence window"));

    assert_eq!(summary.sequence_queries, 110);
    assert_eq!(runtime.reports.lock().expect("reports lock").len(), 1);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn cancelled_roaming_scan_clears_current_date_in_terminal_summary() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-cancel-summary-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let api = mock_roaming_api(start_date);
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let error = scan_roaming_into_spool(
        &api,
        &CancelAfterFirstProbeRuntime,
        &peer,
        &config,
        &mut spool,
    )
    .await
    .expect_err("fixture cancels after the first daily probe");

    let scan = error.roaming_scan.expect("cancelled scan summary");
    assert_eq!(scan["stopReason"], "cancelled");
    assert_eq!(scan["currentDate"], Value::Null);
    assert_eq!(scan["partial"], true);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_checks_each_sequence_between_daily_anchors() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-scan-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let end_time = query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1;
    let config = RoamingExportConfig {
        start_time,
        end_time,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: None,
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let summary = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect("bounded scan");
    spool.finish().await.expect("finish spool");

    assert_eq!(summary.scanned_days, 2);
    assert_eq!(summary.probed_days, 3);
    assert_eq!(summary.anchor_days, 3);
    assert_eq!(summary.exact_queries, 3);
    assert_eq!(summary.latest_queries, 1);
    assert_eq!(summary.sequence_queries, 18);
    assert_eq!(summary.empty_sequence_queries, 16);
    assert_eq!(summary.message_count, 4);
    assert!(summary.closing_anchor_found);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
    assert_eq!(*runtime.waits.lock().expect("waits lock"), 2);
    assert_eq!(
        *runtime
            .sequence_batch_waits
            .lock()
            .expect("sequence waits lock"),
        5
    );

    let calls = api.calls.lock().expect("calls lock").clone();
    assert_eq!(
        calls
            .iter()
            .filter(|call| call.starts_with("single:"))
            .count(),
        18
    );
    assert!(calls.iter().any(|call| call == "single:105"));
    assert!(calls.iter().any(|call| call == "single:115"));
    drop(calls);
    let mut reader = SpoolChunkReader::open(spool.path(), RAW_SPOOL_CHUNK_SIZE)
        .await
        .expect("open spool");
    let messages = reader
        .next_chunk()
        .await
        .expect("read spool")
        .expect("messages");
    assert_eq!(messages.len(), 4);
    drop(reader);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn same_day_anchor_after_inclusive_end_closes_the_range() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let day_start = query_time_for_local_date(start_date).expect("day start");
    let config = RoamingExportConfig {
        start_time: day_start,
        end_time: day_start + 11 * 60 * 60,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let mut api = mock_roaming_api(start_date);
    api.anchor_hour = 12;

    let summary = run_mock_roaming_scan("same-day-closing-anchor", &api, &config)
        .await
        .expect("same-day later anchor closes inclusive end");

    assert_eq!(summary.probed_days, 1);
    assert_eq!(summary.scanned_days, 1);
    assert!(summary.closing_anchor_found);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
}

#[tokio::test]
async fn anchor_at_inclusive_end_keeps_scanning_for_same_second_sequences() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let day_start = query_time_for_local_date(start_date).expect("day start");
    let config = RoamingExportConfig {
        start_time: day_start,
        end_time: day_start + 12 * 60 * 60,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let mut api = mock_roaming_api(start_date);
    api.anchor_hour = 12;

    let summary = run_mock_roaming_scan("inclusive-end-same-second", &api, &config)
        .await
        .expect("a later anchor closes the inclusive range");

    assert_eq!(summary.probed_days, 2);
    assert_eq!(summary.scanned_days, 1);
    assert_eq!(summary.sequence_queries, 9);
    assert_eq!(summary.message_count, 2);
    assert!(summary.closing_anchor_found);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
}

#[tokio::test]
async fn roaming_scan_records_sequence_query_limit_as_partial() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-page-limit-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 1,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: None,
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let summary = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect("bounded partial scan");

    assert_eq!(summary.sequence_queries, 1);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "sequence_query_limit_reached");
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_treats_calendar_failure_as_advisory() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-calendar-advisory-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: true,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: None,
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let summary = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect("calendar failure must not fail the scan");

    assert_eq!(summary.calendar_queries, 1);
    assert_eq!(summary.calendar_errors, 1);
    assert_eq!(summary.message_count, 4);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
    assert_eq!(
        api.calls
            .lock()
            .expect("calls lock")
            .iter()
            .filter(|call| call.as_str() == "calendar")
            .count(),
        4,
        "three retries still count as one logical calendar query/error"
    );
    assert_eq!(
        *runtime.retry_waits.lock().expect("retry waits lock"),
        vec![120, 240, 480]
    );
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_treats_calendar_business_code_as_advisory() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.calendar_result_code = Some(12_345);

    let summary = run_mock_roaming_scan("calendar-code-advisory", &api, &config)
        .await
        .expect("calendar business code must not fail the scan");

    assert_eq!(summary.calendar_queries, 1);
    assert_eq!(summary.calendar_errors, 1);
    assert_eq!(summary.message_count, 4);
    assert!(!summary.partial);
}

#[tokio::test]
async fn roaming_scan_rejects_unknown_empty_first_and_exact_results() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);

    let mut first_api = mock_roaming_api(start_date);
    first_api.first_empty_result_code = Some(12_345);
    first_api.first_omit_anchor_field = true;
    let first_error = run_mock_roaming_scan("first-native-error", &first_api, &config)
        .await
        .expect_err("unknown empty first result must fail");
    assert_eq!(first_error.code, "ROAMING_QUERY_FAILED");
    assert_eq!(first_error.http_status, 502);
    let first_scan = first_error.roaming_scan.expect("first scan summary");
    assert_eq!(first_scan["exactQueries"], 0);
    assert_eq!(first_scan["stopReason"], "native_query_failed");

    let mut exact_api = mock_roaming_api(start_date);
    exact_api.exact_empty_result_code = Some(12_345);
    let exact_error = run_mock_roaming_scan("exact-native-error", &exact_api, &config)
        .await
        .expect_err("unknown empty exact result must fail");
    assert_eq!(exact_error.code, "ROAMING_QUERY_FAILED");
    assert_eq!(exact_error.http_status, 502);
    let exact_scan = exact_error.roaming_scan.expect("exact scan summary");
    assert_eq!(exact_scan["exactQueries"], 1);
    assert_eq!(exact_scan["stopReason"], "native_query_failed");
}

#[tokio::test]
async fn roaming_scan_rejects_successful_first_response_without_anchor_field() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.first_empty_result_code = Some(0);
    api.first_omit_anchor_field = true;

    let error = run_mock_roaming_scan("first-missing-anchor", &api, &config)
        .await
        .expect_err("successful first response must include its anchor field");

    assert_eq!(error.code, "INVALID_ROAMING_RESPONSE");
    assert_eq!(error.http_status, 502);
    let scan = error.roaming_scan.expect("structured scan summary");
    assert_eq!(scan["stopReason"], "invalid_native_response");
    assert_eq!(scan["partial"], true);
}

#[tokio::test]
async fn roaming_scan_accepts_empty_2004000_first_and_recovers_exact_endpoints() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let mut config = roaming_test_config(start_date);
    config.max_sequence_queries = 30;

    let mut first_api = mock_roaming_api(start_date);
    first_api.first_empty_result_code = Some(2_004_000);
    first_api.first_omit_anchor_field = true;
    let first_summary = run_mock_roaming_scan("first-end-code", &first_api, &config)
        .await
        .expect("2004000 empty first result remains a valid empty response");
    assert_eq!(first_summary.anchor_days, 0);
    assert_eq!(first_summary.exact_queries, 0);
    assert_eq!(first_summary.stop_reason, "closing_anchor_not_found");
    assert!(!first_summary.closing_anchor_found);
    assert!(first_summary.partial);

    let mut exact_api = mock_roaming_api(start_date);
    exact_api.exact_empty_result_code = Some(2_004_000);
    let exact_summary = run_mock_roaming_scan("exact-end-code", &exact_api, &config)
        .await
        .expect("2004000 empty exact result falls back to single-sequence endpoints");
    assert_eq!(exact_summary.exact_queries, 3);
    assert_eq!(exact_summary.sequence_queries, 21);
    assert_eq!(exact_summary.empty_sequence_queries, 16);
    assert_eq!(exact_summary.unresolved_anchors, 0);
    assert_eq!(exact_summary.message_count, 4);
    assert!(!exact_summary.partial);
    assert_eq!(exact_summary.stop_reason, "requested_range_scanned");
    let calls = exact_api.calls.lock().expect("calls lock");
    assert!(calls.iter().any(|call| call == "single:100"));
    assert!(calls.iter().any(|call| call == "single:110"));
    assert!(calls.iter().any(|call| call == "single:120"));
}

#[tokio::test]
async fn roaming_scan_recovers_raw_and_rpc_2004007_exact_endpoints() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let mut config = roaming_test_config(start_date);
    config.max_sequence_queries = 30;

    for (label, raw_code, rpc_code) in [
        ("exact-raw-2004007", Some(2_004_007), None),
        ("exact-rpc-2004007", None, Some(2_004_007)),
    ] {
        let mut api = mock_roaming_api(start_date);
        api.exact_empty_result_code = raw_code;
        api.exact_rpc_result_code = rpc_code;

        let summary = run_mock_roaming_scan(label, &api, &config)
            .await
            .expect("known empty exact code falls back to single-sequence endpoints");

        assert_eq!(summary.exact_queries, 3);
        assert_eq!(summary.sequence_queries, 21);
        assert_eq!(summary.unresolved_anchors, 0);
        assert_eq!(summary.message_count, 4);
        assert!(!summary.partial);
        assert_eq!(summary.stop_reason, "requested_range_scanned");
    }
}

#[tokio::test]
async fn roaming_scan_marks_an_unrecoverable_exact_endpoint_partial() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.exact_empty_result_code = Some(0);

    let summary = run_mock_roaming_scan("exact-empty-unrecoverable", &api, &config)
        .await
        .expect("a structurally valid empty endpoint is a bounded partial result");

    assert_eq!(summary.exact_queries, 3);
    assert_eq!(summary.sequence_queries, 3);
    assert_eq!(summary.empty_sequence_queries, 3);
    assert_eq!(summary.unresolved_anchors, 3);
    assert_eq!(summary.message_count, 0);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "unresolved_anchors");
}

#[tokio::test]
async fn exact_endpoint_fallback_obeys_the_sequence_query_budget() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let mut config = roaming_test_config(start_date);
    config.max_sequence_queries = 2;
    let mut api = mock_roaming_api(start_date);
    api.exact_empty_result_code = Some(2_004_000);

    let summary = run_mock_roaming_scan("exact-endpoint-budget", &api, &config)
        .await
        .expect("budget exhaustion returns the verified partial result");

    assert_eq!(summary.sequence_queries, 2);
    assert_eq!(summary.message_count, 2);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "sequence_query_limit_reached");
    assert_eq!(summary.current_date, None);
}

#[tokio::test]
async fn roaming_scan_accepts_the_verified_negative_empty_sentinel() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.first_uses_negative_sentinel = true;
    api.latest_empty = true;

    let summary = run_mock_roaming_scan("negative-empty-sentinel", &api, &config)
        .await
        .expect("strict triple -1 is an empty day, not a malformed response");

    assert_eq!(summary.anchor_days, 0);
    assert_eq!(summary.exact_queries, 0);
    assert_eq!(summary.sequence_queries, 0);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "closing_anchor_not_found");
}

#[tokio::test]
async fn roaming_scan_rejects_a_latest_anchor_older_than_daily_anchors() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.latest_is_stale = true;

    let summary = run_mock_roaming_scan("stale-latest-anchor", &api, &config)
        .await
        .expect("stale latest cache is a bounded partial result");

    assert!(!summary.closing_anchor_found);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "closing_anchor_not_found");
    assert_eq!(summary.sequence_queries, 9);
}

#[tokio::test]
async fn roaming_scan_marks_lone_in_range_latest_partial_when_all_daily_probes_are_empty() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.latest_is_stale = true;
    api.first_empty_result_code = Some(0);

    let summary = run_mock_roaming_scan("in-range-latest-with-empty-days", &api, &config)
        .await
        .expect("a contradictory latest page returns a bounded partial result");

    assert_eq!(summary.anchor_days, 0);
    assert_eq!(summary.message_count, 1);
    assert!(!summary.closing_anchor_found);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "closing_anchor_not_found");
}

#[tokio::test]
async fn roaming_scan_marks_lone_post_range_latest_partial_when_all_daily_probes_are_empty() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.first_empty_result_code = Some(0);

    let summary = run_mock_roaming_scan("post-range-latest-with-empty-days", &api, &config)
        .await
        .expect("a post-range latest page returns a bounded partial result");

    assert_eq!(summary.anchor_days, 0);
    assert_eq!(summary.message_count, 0);
    assert!(!summary.closing_anchor_found);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "closing_anchor_not_found");
}

#[tokio::test]
async fn roaming_scan_stops_on_conflicting_times_for_one_sequence_in_the_latest_page() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);
    let mut api = mock_roaming_api(start_date);
    api.latest_has_conflicting_sequence_time = true;

    let summary = run_mock_roaming_scan("latest-conflicting-sequence-time", &api, &config)
        .await
        .expect("a contradictory latest page returns its bounded partial result");

    assert_eq!(summary.scanned_days, 0);
    assert_eq!(summary.probed_days, 0);
    assert_eq!(summary.message_count, 1);
    assert_eq!(summary.gap_count, 1);
    assert!(!summary.closing_anchor_found);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "non_monotonic_anchor_sequence");
    assert!(api
        .calls
        .lock()
        .expect("calls lock")
        .iter()
        .all(|call| !call.starts_with("first:") && call != "calendar"));
}

#[tokio::test]
async fn roaming_scan_does_not_bridge_to_a_latest_anchor_beyond_the_probe_horizon() {
    let api_start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("API start date");
    let request_start_date = api_start_date + Duration::days(2);
    let config = roaming_test_config(request_start_date);
    let mut api = mock_roaming_api(api_start_date);
    api.latest_is_far_future = true;

    let summary = run_mock_roaming_scan("far-future-latest", &api, &config)
        .await
        .expect("a far-future latest anchor returns a bounded partial result");

    assert_eq!(summary.anchor_days, 1);
    assert_eq!(summary.message_count, 1);
    assert_eq!(summary.sequence_queries, 0);
    assert_eq!(summary.probed_days, 33);
    assert!(!summary.closing_anchor_found);
    assert!(summary.partial);
    assert_eq!(summary.stop_reason, "closing_anchor_not_found");
}

#[tokio::test]
async fn roaming_scan_keeps_lone_latest_before_start_as_a_complete_empty_range() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let mut config = roaming_test_config(start_date);
    config.start_time += 1;
    let mut api = mock_roaming_api(start_date);
    api.latest_is_stale = true;
    api.first_empty_result_code = Some(0);

    let summary = run_mock_roaming_scan("latest-before-start-with-empty-days", &api, &config)
        .await
        .expect("latest before the requested range proves the range is empty");

    assert_eq!(summary.anchor_days, 0);
    assert_eq!(summary.message_count, 0);
    assert!(summary.closing_anchor_found);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
}

#[test]
fn exact_anchor_requires_the_matching_endpoint_message() {
    let anchor = json!({"msgSeq": "100", "clientSeq": "77", "msgTime": "123"});
    assert_eq!(anchor_message_seq(&anchor, &[]), None);
    assert_eq!(
        anchor_message_seq(
            &anchor,
            &[json!({"msgSeq": "101", "clientSeq": "77", "msgTime": "123"})]
        ),
        None
    );
    assert_eq!(
        anchor_message_seq(
            &anchor,
            &[json!({"msgSeq": "100", "clientSeq": "77", "msgTime": "123"})]
        ),
        Some(100)
    );
}

#[test]
fn latest_response_rejects_nonpositive_message_times() {
    for msg_time in [json!(0), json!(-1), json!("0"), json!("-1")] {
        let response = json!({
            "result": 0,
            "msgList": [{ "msgSeq": "120", "msgTime": msg_time }]
        });
        let error = validate_latest_response(&response)
            .expect_err("latest anchors require a positive message timestamp");
        assert_eq!(error.code, "INVALID_ROAMING_RESPONSE");
    }
}

#[tokio::test]
async fn mismatched_exact_batch_is_not_spooled_when_single_recovers_the_anchor() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-exact-mismatch-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let mut config = roaming_test_config(start_date);
    config.max_sequence_queries = 30;
    let mut api = mock_roaming_api(start_date);
    api.exact_returns_mismatched_batch = true;
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let summary = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect("single fallback recovers each mismatched exact anchor");
    spool.finish().await.expect("finish spool");

    assert_eq!(summary.exact_queries, 3);
    assert_eq!(summary.unresolved_anchors, 0);
    assert_eq!(summary.message_count, 4);
    assert!(!summary.partial);

    let mut reader = SpoolChunkReader::open(spool.path(), RAW_SPOOL_CHUNK_SIZE)
        .await
        .expect("open spool");
    let mut stored_messages = Vec::new();
    while let Some(chunk) = reader.next_chunk().await.expect("read spool") {
        stored_messages.extend(chunk);
    }
    let mut stored_sequences: Vec<i64> = stored_messages
        .iter()
        .filter_map(super::positive_message_seq)
        .collect();
    stored_sequences.sort_unstable();
    assert_eq!(stored_sequences, vec![100, 105, 110, 115]);
    assert!(stored_messages.iter().all(|message| {
        message
            .get("msgId")
            .and_then(Value::as_str)
            .is_none_or(|msg_id| !matches!(msg_id, "1100" | "1110" | "1120"))
    }));

    let calls = api.calls.lock().expect("calls lock");
    assert!(calls.iter().any(|call| call == "single:100"));
    assert!(calls.iter().any(|call| call == "single:110"));
    assert!(calls.iter().any(|call| call == "single:120"));
    drop(calls);
    drop(reader);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_continues_after_a_known_empty_sequence_rpc_code() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-window-fallback-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: Some(115),
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let summary = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect("known empty-sequence RPC code must not fail the scan");

    assert_eq!(summary.sequence_queries, 18);
    assert_eq!(summary.empty_sequence_queries, 17);
    assert_eq!(summary.gap_count, 0);
    assert_eq!(summary.message_count, 3);
    assert!(!summary.partial);
    assert_eq!(summary.stop_reason, "requested_range_scanned");
    let calls = api.calls.lock().expect("calls lock");
    assert_eq!(
        calls
            .iter()
            .filter(|call| call.starts_with("single:"))
            .count(),
        18
    );
    assert!(calls.iter().any(|call| call == "single:115"));
    drop(calls);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_rejects_unallowlisted_native_business_code() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-native-error-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: false,
        business_error_anchor: None,
        native_error_code: Some(12_345),
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let error = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect_err("unknown QQ business code must fail the task");

    assert_eq!(error.code, "ROAMING_QUERY_FAILED");
    assert_eq!(error.http_status, 502);
    let scan = error.roaming_scan.expect("failure scan summary");
    assert_eq!(scan["sequenceQueries"], 4);
    assert_eq!(scan["partial"], true);
    assert_eq!(scan["stopReason"], "native_query_failed");
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_scan_treats_known_native_codes_as_empty_integer_sequences() {
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = roaming_test_config(start_date);

    for result_code in [2_004_000, 2_004_007] {
        for has_msg_list in [true, false] {
            let mut api = mock_roaming_api(start_date);
            api.native_error_code = Some(result_code);
            api.native_error_has_msg_list = has_msg_list;
            let label = format!("sequence-empty-{result_code}-{has_msg_list}");

            let summary = run_mock_roaming_scan(&label, &api, &config)
                .await
                .expect("known code identifies an empty integer sequence");

            assert_eq!(summary.sequence_queries, 18);
            assert_eq!(summary.empty_sequence_queries, 18);
            assert_eq!(summary.gap_count, 0);
            assert!(!summary.partial);
            assert_eq!(summary.stop_reason, "requested_range_scanned");
        }
    }
}

#[tokio::test]
async fn roaming_scan_failure_keeps_structured_partial_summary() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-invalid-page-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let config = RoamingExportConfig {
        start_time: query_time_for_local_date(start_date).expect("start"),
        end_time: query_time_for_local_date(start_date + Duration::days(2)).expect("end") - 1,
        start_date,
        end_date: start_date + Duration::days(1),
        requested_days: 2,
        max_messages: 100,
        max_sequence_queries: 20,
    };
    let api = MockRoamingApi {
        start_date,
        calls: Mutex::new(Vec::new()),
        calendar_error: false,
        calendar_result_code: None,
        anchor_hour: 0,
        first_empty_result_code: None,
        first_omit_anchor_field: false,
        first_uses_negative_sentinel: false,
        exact_empty_result_code: None,
        exact_rpc_result_code: None,
        exact_returns_mismatched_batch: false,
        invalid_sequence_response: true,
        business_error_anchor: None,
        native_error_code: None,
        native_error_has_msg_list: true,
        latest_empty: false,
        latest_is_stale: false,
        latest_is_far_future: false,
        latest_has_conflicting_sequence_time: false,
    };
    let runtime = MockRoamingRuntime::default();
    let peer = Peer {
        chat_type: 1,
        peer_uid: "u_test_peer".to_string(),
        guild_id: Some(String::new()),
    };
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");

    let error = scan_roaming_into_spool(&api, &runtime, &peer, &config, &mut spool)
        .await
        .expect_err("invalid sequence page must fail the task");

    assert_eq!(error.code, "INVALID_ROAMING_RESPONSE");
    assert_eq!(error.http_status, 502);
    let scan = error.roaming_scan.expect("failure scan summary");
    assert_eq!(scan["sequenceQueries"], 4);
    assert_eq!(scan["partial"], true);
    assert_eq!(scan["stopReason"], "invalid_native_response");
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_message_limit_flushes_the_accepted_prefix() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-message-limit-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let config = RoamingExportConfig {
        start_time,
        end_time: start_time + 86_399,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 1,
        max_sequence_queries: 1,
    };
    let mut summary = RoamingScanSummary::new(&config);
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let mut seen = HashSet::new();
    let messages = vec![
        json!({"msgId": "1", "msgSeq": "1", "msgTime": start_time}),
        json!({"msgId": "2", "msgSeq": "2", "msgTime": start_time + 1}),
    ];

    assert!(
        append_roaming_messages(&mut spool, &messages, &config, &mut summary, &mut seen,)
            .await
            .expect("append bounded messages")
    );
    spool.finish().await.expect("finish spool");
    assert_eq!(summary.message_count, 1);
    assert_eq!(spool.count(), 1);
    assert_eq!(summary.stop_reason, "message_limit_reached");
    let mut reader = SpoolChunkReader::open(spool.path(), RAW_SPOOL_CHUNK_SIZE)
        .await
        .expect("open spool");
    assert_eq!(
        reader
            .next_chunk()
            .await
            .expect("read spool")
            .expect("accepted prefix")
            .len(),
        1
    );
    drop(reader);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn roaming_millisecond_message_times_are_normalized_before_spooling_and_parsing() {
    let root = std::env::temp_dir().join(format!(
        "qce-roaming-millisecond-time-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let start_date = NaiveDate::from_ymd_opt(2023, 1, 1).expect("start date");
    let start_time = query_time_for_local_date(start_date).expect("start");
    let config = RoamingExportConfig {
        start_time,
        end_time: start_time + 86_399,
        start_date,
        end_date: start_date,
        requested_days: 1,
        max_messages: 10,
        max_sequence_queries: 1,
    };
    let mut summary = RoamingScanSummary::new(&config);
    let mut spool = RawMessageSpool::create(root.join("scan.jsonl"))
        .await
        .expect("create spool");
    let mut seen = HashSet::new();
    let messages = vec![
        json!({
            "msgId": "1",
            "msgSeq": "1",
            "msgTime": start_time * 1_000,
            "elements": []
        }),
        json!({
            "msgId": "2",
            "msgSeq": "2",
            "msgTime": ((start_time + 1) * 1_000).to_string(),
            "elements": []
        }),
    ];

    assert!(
        !append_roaming_messages(&mut spool, &messages, &config, &mut summary, &mut seen)
            .await
            .expect("append millisecond messages")
    );
    spool.finish().await.expect("finish spool");

    let mut reader = SpoolChunkReader::open(spool.path(), RAW_SPOOL_CHUNK_SIZE)
        .await
        .expect("open spool");
    let stored = reader
        .next_chunk()
        .await
        .expect("read spool")
        .expect("stored messages");
    assert_eq!(stored[0]["msgTime"], json!(start_time));
    assert_eq!(stored[1]["msgTime"], json!(start_time + 1));

    let mut parser = SimpleMessageParser::new(SimpleParserOptions::default());
    let parsed = parser.parse_messages(&stored).await;
    assert_eq!(parsed[0].timestamp, start_time * 1_000);
    assert_eq!(parsed[1].timestamp, (start_time + 1) * 1_000);

    drop(reader);
    drop(spool);
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn sequence_response_contract_rejects_unknown_codes_and_invalid_lists() {
    assert_eq!(
        tolerated_empty_sequence_rpc_code("query_failed_qq_result_2004007"),
        Some(2_004_007)
    );
    assert_eq!(
        tolerated_empty_sequence_rpc_code("2004007"),
        Some(2_004_007)
    );
    assert_eq!(tolerated_empty_sequence_rpc_code("12004007"), None);
    assert_eq!(
        tolerated_empty_sequence_rpc_code("TypeError inside QQ worker"),
        None
    );
    assert_eq!(
        tolerated_empty_sequence_rpc_code("TypeError: invalid msgSeq=2004007"),
        None
    );
    assert_eq!(
        tolerated_empty_sequence_rpc_code("worker rejected sequence 2004007"),
        None
    );
    assert_eq!(
        sequence_native_failure_code(&json!({"result": 2_004_007})),
        Some(2_004_007)
    );
    assert_eq!(
        sequence_native_failure_code(&json!({"result": 2_004_000, "msgList": []})),
        Some(2_004_000)
    );
    assert_eq!(
        sequence_native_failure_code(&json!({"result": 2_004_000})),
        Some(2_004_000)
    );
    assert_eq!(
        sequence_native_failure_code(&json!({
            "result": 2_004_007,
            "msgList": [{"msgSeq": "1"}]
        })),
        Some(2_004_007)
    );
    for invalid in [json!({}), json!({"msgList": {}})] {
        let error = extract_sequence_messages(&invalid).expect_err("invalid sequence page");
        assert_eq!(error.code, "INVALID_ROAMING_RESPONSE");
        assert_eq!(error.http_status, 502);
    }
    assert!(extract_sequence_messages(&json!({"msgsRsp": {"msgList": []}})).is_ok());

    let unsupported = roaming_task_failure(BridgeError::Rpc("method not found".to_string()));
    assert_eq!(unsupported.code, "ROAMING_API_UNAVAILABLE");
    assert_eq!(unsupported.http_status, 501);
    let failed = roaming_task_failure(BridgeError::InvalidResponse("fixture".to_string()));
    assert_eq!(failed.code, "ROAMING_QUERY_FAILED");
    assert_eq!(failed.http_status, 502);
    let worker_error = roaming_task_failure(BridgeError::Rpc("TypeError fixture".to_string()));
    assert_eq!(worker_error.code, "ROAMING_QUERY_FAILED");
    assert_eq!(worker_error.http_status, 502);
}
