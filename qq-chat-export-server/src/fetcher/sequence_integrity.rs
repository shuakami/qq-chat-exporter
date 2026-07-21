use std::collections::{BTreeSet, HashSet};

use serde_json::Value;

use super::{FetchError, MessageFetchApi, Peer};

#[derive(Debug, Clone, Copy)]
pub struct SequenceRepairConfig {
    pub max_delta: i64,
    pub chunk_size: i64,
    pub total_budget: i64,
    pub max_rounds: u32,
}

impl Default for SequenceRepairConfig {
    fn default() -> Self {
        Self {
            max_delta: 5,
            chunk_size: 100,
            total_budget: 2000,
            max_rounds: 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeqGap {
    pub lower: i64,
    pub upper: i64,
    pub missing_positions: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SequenceRepairReport {
    pub initial_gap_count: usize,
    pub initial_missing_positions: i64,
    pub repaired_messages: usize,
    pub rounds: u32,
}

#[must_use]
pub fn detect_large_seq_gaps(messages: &[Value], max_delta: i64) -> Vec<SeqGap> {
    let sequences: BTreeSet<i64> = messages
        .iter()
        .filter_map(|message| loose_i64(message.get("msgSeq")))
        .collect();
    let values: Vec<i64> = sequences.into_iter().collect();

    values
        .windows(2)
        .filter_map(|pair| {
            let lower = pair[0];
            let upper = pair[1];
            let delta = upper - lower;
            (delta > max_delta).then_some(SeqGap {
                lower,
                upper,
                missing_positions: delta - 1,
            })
        })
        .collect()
}

pub async fn repair_group_message_sequence(
    api: &dyn MessageFetchApi,
    peer: &Peer,
    messages: &mut Vec<Value>,
    config: SequenceRepairConfig,
) -> Result<SequenceRepairReport, FetchError> {
    let initial_gaps = detect_large_seq_gaps(messages, config.max_delta);
    let initial_missing_positions = total_missing_positions(&initial_gaps);
    if initial_gaps.is_empty() {
        return Ok(SequenceRepairReport::default());
    }

    let initial_len = messages.len();
    let mut remaining_budget = config.total_budget.max(0);
    let mut previous_missing = initial_missing_positions;
    let mut rounds = 0;

    while rounds < config.max_rounds {
        let gaps = detect_large_seq_gaps(messages, config.max_delta);
        if gaps.is_empty() {
            return Ok(report(
                &initial_gaps,
                initial_missing_positions,
                messages,
                initial_len,
                rounds,
            ));
        }
        if remaining_budget == 0 {
            return Err(FetchError::SequenceRepairBudgetExhausted {
                gap_count: gaps.len(),
                missing_positions: total_missing_positions(&gaps),
            });
        }

        rounds += 1;
        for gap in gaps.iter().rev() {
            let mut anchor = gap.upper - 1;
            let mut remaining = gap.missing_positions;
            while remaining > 0 && remaining_budget > 0 {
                let count = config
                    .chunk_size
                    .min(remaining)
                    .min(remaining_budget)
                    .max(1);
                let lower = (anchor - count + 1).max(gap.lower + 1);
                let range_messages = api
                    .get_msgs_by_seq_range(peer, &lower.to_string(), &anchor.to_string())
                    .await
                    .ok()
                    .map(extract_messages)
                    .unwrap_or_default();
                if range_messages.is_empty() {
                    api.get_msgs_by_seq_and_count(peer, anchor, count)
                        .await
                        .map_err(FetchError::Api)?;
                }
                remaining_budget -= count;
                remaining -= count;
                anchor = lower - 1;
            }
            if remaining_budget == 0 {
                break;
            }
        }

        let reprobed = reprobe_with_message_history(api, peer, messages, &gaps, config).await?;
        merge_messages(messages, reprobed);
        let current_gaps = detect_large_seq_gaps(messages, config.max_delta);
        let current_missing = total_missing_positions(&current_gaps);
        if current_gaps.is_empty() {
            return Ok(report(
                &initial_gaps,
                initial_missing_positions,
                messages,
                initial_len,
                rounds,
            ));
        }
        if current_missing >= previous_missing {
            return Err(FetchError::SequenceRepairNoProgress {
                gap_count: current_gaps.len(),
                missing_positions: current_missing,
            });
        }
        previous_missing = current_missing;
    }

    let gaps = detect_large_seq_gaps(messages, config.max_delta);
    Err(FetchError::SequenceGapsUnresolved {
        gap_count: gaps.len(),
        missing_positions: total_missing_positions(&gaps),
    })
}

async fn reprobe_with_message_history(
    api: &dyn MessageFetchApi,
    peer: &Peer,
    messages: &[Value],
    gaps: &[SeqGap],
    config: SequenceRepairConfig,
) -> Result<Vec<Value>, FetchError> {
    let mut reprobed = Vec::new();
    for gap in gaps.iter().rev() {
        let Some(anchor_id) = message_id_for_sequence(messages, gap.upper) else {
            continue;
        };
        let count = (gap.missing_positions + 2)
            .min(config.total_budget.max(config.chunk_size))
            .max(1);
        let result = api
            .get_msg_history(peer, &anchor_id, count)
            .await
            .map_err(FetchError::Api)?;
        reprobed.extend(extract_messages(result));
    }
    Ok(reprobed)
}

fn message_id_for_sequence(messages: &[Value], sequence: i64) -> Option<String> {
    messages.iter().find_map(|message| {
        (loose_i64(message.get("msgSeq")) == Some(sequence))
            .then(|| message.get("msgId").and_then(Value::as_str))
            .flatten()
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn report(
    initial_gaps: &[SeqGap],
    initial_missing: i64,
    messages: &[Value],
    initial_len: usize,
    rounds: u32,
) -> SequenceRepairReport {
    SequenceRepairReport {
        initial_gap_count: initial_gaps.len(),
        initial_missing_positions: initial_missing,
        repaired_messages: messages.len().saturating_sub(initial_len),
        rounds,
    }
}

fn total_missing_positions(gaps: &[SeqGap]) -> i64 {
    gaps.iter().map(|gap| gap.missing_positions).sum()
}

fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value as i64)),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

fn extract_messages(value: Value) -> Vec<Value> {
    match value {
        Value::Array(messages) => messages,
        Value::Object(mut root) => {
            if let Some(Value::Object(result)) = root.get_mut("result") {
                if let Some(Value::Array(messages)) = result.remove("msgList") {
                    return messages;
                }
                if let Some(Value::Array(messages)) = result.remove("messages") {
                    return messages;
                }
            }
            for key in ["msgList", "messages"] {
                if let Some(Value::Array(messages)) = root.remove(key) {
                    return messages;
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn merge_messages(messages: &mut Vec<Value>, fetched: Vec<Value>) {
    let mut identities: HashSet<String> = messages.iter().map(message_identity).collect();
    for message in fetched {
        if identities.insert(message_identity(&message)) {
            messages.push(message);
        }
    }
}

fn message_identity(message: &Value) -> String {
    if let Some(msg_id) = message
        .get("msgId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return format!("id:{msg_id}");
    }
    serde_json::to_string(message).unwrap_or_else(|_| "null".to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use serde_json::json;

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Request {
        Range(i64, i64),
        Count(i64, i64),
        History(String, i64),
    }

    struct MockApi {
        range_results: Mutex<VecDeque<Result<Value, String>>>,
        count_results: Mutex<VecDeque<Result<Value, String>>>,
        history_results: Mutex<VecDeque<Result<Value, String>>>,
        requests: Mutex<Vec<Request>>,
    }

    impl MockApi {
        fn new(
            range_results: Vec<Result<Value, String>>,
            count_results: Vec<Result<Value, String>>,
            history_results: Vec<Result<Value, String>>,
        ) -> Self {
            Self {
                range_results: Mutex::new(range_results.into()),
                count_results: Mutex::new(count_results.into()),
                history_results: Mutex::new(history_results.into()),
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl MessageFetchApi for MockApi {
        async fn get_aio_first_view_latest_msgs(&self, _: &Peer, _: i64) -> Result<Value, String> {
            Ok(json!({ "msgList": [] }))
        }

        async fn get_msg_history(
            &self,
            _: &Peer,
            msg_id: &str,
            count: i64,
        ) -> Result<Value, String> {
            self.requests
                .lock()
                .unwrap()
                .push(Request::History(msg_id.to_string(), count));
            self.history_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(json!({ "msgList": [] })))
        }

        async fn get_msgs_by_seq_range(
            &self,
            _: &Peer,
            start_seq: &str,
            end_seq: &str,
        ) -> Result<Value, String> {
            self.requests.lock().unwrap().push(Request::Range(
                start_seq.parse().unwrap(),
                end_seq.parse().unwrap(),
            ));
            self.range_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(json!({ "msgList": [] })))
        }

        async fn get_msgs_by_seq_and_count(
            &self,
            _: &Peer,
            anchor_seq: i64,
            count: i64,
        ) -> Result<Value, String> {
            self.requests
                .lock()
                .unwrap()
                .push(Request::Count(anchor_seq, count));
            self.count_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(json!({ "msgList": [] })))
        }
    }

    fn peer() -> Peer {
        Peer {
            chat_type: 2,
            peer_uid: "group".into(),
            guild_id: None,
        }
    }

    fn endpoints() -> Vec<Value> {
        vec![
            json!({ "msgId": "one", "msgSeq": 1 }),
            json!({ "msgId": "ten", "msgSeq": 10 }),
        ]
    }

    fn repaired_history() -> Value {
        json!({ "result": { "msgList": [
            { "msgId": "one", "msgSeq": 1 },
            { "msgId": "two", "msgSeq": 2 },
            { "msgId": "three", "msgSeq": 3 },
            { "msgId": "four", "msgSeq": 4 },
            { "msgId": "five", "msgSeq": 5 },
            { "msgId": "six", "msgSeq": 6 },
            { "msgId": "ten", "msgSeq": 10 }
        ] } })
    }

    #[test]
    fn detects_numeric_and_string_sequences() {
        let messages = vec![
            json!({ "msgSeq": 1 }),
            json!({ "msgSeq": "2" }),
            json!({ "msgSeq": "10" }),
        ];
        assert_eq!(
            detect_large_seq_gaps(&messages, 5),
            vec![SeqGap {
                lower: 2,
                upper: 10,
                missing_positions: 7,
            }]
        );
    }

    #[test]
    fn ignores_small_gaps_and_input_order() {
        let messages = vec![
            json!({ "msgSeq": 6 }),
            json!({ "msgSeq": 1 }),
            json!({ "msgSeq": 5 }),
        ];
        assert!(detect_large_seq_gaps(&messages, 5).is_empty());
    }

    #[tokio::test]
    async fn accepts_only_reprobed_messages_as_progress() {
        let api = MockApi::new(
            vec![Ok(repaired_history())],
            vec![],
            vec![Ok(repaired_history())],
        );
        let mut messages = endpoints();
        let report = repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig::default(),
        )
        .await
        .unwrap();

        assert_eq!(report.repaired_messages, 5);
        assert!(detect_large_seq_gaps(&messages, 5).is_empty());
        assert_eq!(messages.len(), 7);
        assert!(api
            .requests
            .lock()
            .unwrap()
            .contains(&Request::History("ten".to_string(), 10)));
    }

    #[tokio::test]
    async fn falls_back_to_count_api_when_range_is_unavailable() {
        let api = MockApi::new(
            vec![Err("range unavailable".to_string())],
            vec![Ok(repaired_history())],
            vec![Ok(repaired_history())],
        );
        let mut messages = endpoints();
        repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig::default(),
        )
        .await
        .unwrap();

        assert_eq!(
            &api.requests.lock().unwrap()[..2],
            &[Request::Range(2, 9), Request::Count(9, 8)]
        );
    }

    #[tokio::test]
    async fn fails_when_normal_reprobe_makes_no_progress() {
        let api = MockApi::new(
            vec![Ok(repaired_history())],
            vec![],
            vec![Ok(json!({ "msgList": endpoints() }))],
        );
        let mut messages = endpoints();
        let error = repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig::default(),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, FetchError::SequenceRepairNoProgress { .. }));
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn reports_budget_exhaustion_after_partial_progress() {
        let api = MockApi::new(
            vec![Ok(
                json!({ "msgList": [{ "msgId": "loaded", "msgSeq": 15 }] }),
            )],
            vec![],
            vec![Ok(json!({ "msgList": [
                { "msgId": "one", "msgSeq": 1 },
                { "msgId": "fifteen", "msgSeq": 15 },
                { "msgId": "twenty", "msgSeq": 20 }
            ] }))],
        );
        let mut messages = vec![
            json!({ "msgId": "one", "msgSeq": 1 }),
            json!({ "msgId": "twenty", "msgSeq": 20 }),
        ];
        let error = repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig {
                max_delta: 5,
                chunk_size: 5,
                total_budget: 5,
                max_rounds: 3,
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(
            error,
            FetchError::SequenceRepairBudgetExhausted { .. }
        ));
    }

    #[tokio::test]
    async fn reports_unresolved_gaps_after_round_limit() {
        let api = MockApi::new(
            vec![Ok(
                json!({ "msgList": [{ "msgId": "loaded", "msgSeq": 15 }] }),
            )],
            vec![],
            vec![Ok(json!({ "msgList": [
                { "msgId": "one", "msgSeq": 1 },
                { "msgId": "fifteen", "msgSeq": 15 },
                { "msgId": "twenty", "msgSeq": 20 }
            ] }))],
        );
        let mut messages = vec![
            json!({ "msgId": "one", "msgSeq": 1 }),
            json!({ "msgId": "twenty", "msgSeq": 20 }),
        ];
        let error = repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig {
                max_delta: 5,
                chunk_size: 5,
                total_budget: 100,
                max_rounds: 1,
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, FetchError::SequenceGapsUnresolved { .. }));
    }

    #[tokio::test]
    async fn plans_newest_gap_first_and_respects_budget() {
        let api = MockApi::new(
            vec![Ok(json!({ "msgList": [] }))],
            vec![Ok(json!({ "msgList": [] }))],
            vec![Ok(json!({ "msgList": [] }))],
        );
        let mut messages = vec![
            json!({ "msgId": "one", "msgSeq": 1 }),
            json!({ "msgId": "twenty", "msgSeq": 20 }),
            json!({ "msgId": "two-hundred", "msgSeq": 200 }),
        ];
        let _ = repair_group_message_sequence(
            &api,
            &peer(),
            &mut messages,
            SequenceRepairConfig {
                max_delta: 5,
                chunk_size: 100,
                total_budget: 100,
                max_rounds: 1,
            },
        )
        .await;

        assert_eq!(
            &api.requests.lock().unwrap()[..2],
            &[Request::Range(100, 199), Request::Count(199, 100)]
        );
    }
}
