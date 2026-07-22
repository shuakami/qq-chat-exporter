use std::collections::HashMap;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::api::state::SharedState;
use crate::fetcher::{BatchFetchConfig, BatchMessageFetcher, MessageFilter, Peer};

const MAX_WS_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_ACTIVE_STREAM_SEARCHES: usize = 8;
const MAX_ACTIVE_STREAM_SEARCHES_PER_CONNECTION: usize = 2;
const MAX_STREAM_SEARCH_MESSAGES: usize = 100_000;
const MAX_STREAM_SEARCH_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_SEARCHABLE_TEXT_CHARS: usize = 16_384;
const MAX_SEARCH_RESULTS_PER_BATCH: usize = 100;
const MAX_SEARCH_RESULT_BYTES_PER_BATCH: usize = 192 * 1024;

struct ActiveSearch {
    owner_id: String,
    cancel_flag: Arc<AtomicBool>,
}

/// 活跃流式搜索及其连接所有者。
fn active_searches() -> &'static Mutex<HashMap<String, ActiveSearch>> {
    static SEARCHES: OnceLock<Mutex<HashMap<String, ActiveSearch>>> = OnceLock::new();
    SEARCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancel_owned_search(
    searches: &HashMap<String, ActiveSearch>,
    owner_id: &str,
    search_id: &str,
) -> bool {
    let Some(search) = searches.get(search_id) else {
        return false;
    };
    if search.owner_id != owner_id {
        return false;
    }
    search.cancel_flag.store(true, Ordering::SeqCst);
    true
}

fn cancel_owner_searches(searches: &HashMap<String, ActiveSearch>, owner_id: &str) {
    for search in searches
        .values()
        .filter(|search| search.owner_id == owner_id)
    {
        search.cancel_flag.store(true, Ordering::SeqCst);
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// issue #144：构造任务全量同步 payload（只挑前端需要的字段）。
fn build_task_resync_payload(tasks: &[Value]) -> Vec<Value> {
    tasks
        .iter()
        .filter_map(|task| {
            let task_id = task.get("taskId").and_then(Value::as_str)?;
            if task_id.is_empty() {
                return None;
            }
            let mut view = json!({
                "taskId": task_id,
                "status": task
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("pending"),
                "progress": task
                    .get("progress")
                    .and_then(Value::as_f64)
                    .filter(|p| p.is_finite())
                    .unwrap_or(0.0),
                "messageCount": task
                    .get("messageCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            });
            if let Some(error) = task.get("error").and_then(Value::as_str) {
                if !error.is_empty() {
                    if let Some(obj) = view.as_object_mut() {
                        obj.insert("error".to_string(), Value::String(error.to_string()));
                    }
                }
            }
            Some(view)
        })
        .collect()
}

/// `GET /ws` — WebSocket 升级入口。
pub async fn ws_handler(State(state): State<SharedState>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(state, socket))
}

/// 单连接处理：下发连接确认与 task_resync，转发广播，处理客户端指令。
async fn handle_socket(state: SharedState, socket: WebSocket) {
    let request_id = crate::api::response::generate_request_id();
    tracing::info!("[API] WebSocket连接建立: {request_id}");

    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));

    // 连接确认。
    send_json(
        &sender,
        &json!({
            "type": "connected",
            "data": { "message": "WebSocket连接成功", "requestId": request_id },
            "timestamp": now_iso(),
        }),
    )
    .await;

    // issue #144：连接建立即全量同步任务状态。
    {
        let tasks: Vec<Value> = state.export_tasks.lock().await.values().cloned().collect();
        send_json(
            &sender,
            &json!({
                "type": "task_resync",
                "data": { "tasks": build_task_resync_payload(&tasks) },
                "timestamp": now_iso(),
            }),
        )
        .await;
    }

    // 广播转发任务。
    let mut rx = state.ws_tx.subscribe();
    let forward_sender = Arc::clone(&sender);
    let forward = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(payload) => {
                    let mut guard = forward_sender.lock().await;
                    if guard.send(Message::Text(payload)).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // 客户端消息处理。
    while let Some(Ok(message)) = receiver.next().await {
        let Message::Text(text) = message else {
            if matches!(message, Message::Close(_)) {
                break;
            }
            continue;
        };
        let Ok(payload) = serde_json::from_str::<Value>(&text) else {
            send_json(
                &sender,
                &json!({
                    "type": "error",
                    "data": { "message": "消息格式错误" },
                    "timestamp": now_iso(),
                }),
            )
            .await;
            continue;
        };
        let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or("");
        let data = payload.get("data").cloned().unwrap_or(Value::Null);
        match msg_type {
            "start_stream_search" => {
                handle_stream_search(&state, Arc::clone(&sender), &request_id, data).await;
            }
            "cancel_search" => {
                let search_id = data
                    .get("searchId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let searches = active_searches().lock().await;
                cancel_owned_search(&searches, &request_id, &search_id);
            }
            other => {
                tracing::warn!("[ApiServer] 未知的WebSocket消息类型: {other}");
            }
        }
    }

    {
        let searches = active_searches().lock().await;
        cancel_owner_searches(&searches, &request_id);
    }
    forward.abort();
    tracing::info!("[API] WebSocket连接关闭: {request_id}");
}

type WsSender = Arc<Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>;

async fn send_json(sender: &WsSender, payload: &Value) -> bool {
    let mut guard = sender.lock().await;
    guard.send(Message::Text(payload.to_string())).await.is_ok()
}

/// 提取消息文本（正文 + 发送者名，供搜索匹配）。
fn extract_text(message: &Value) -> String {
    let mut text = String::new();
    let mut remaining = MAX_SEARCHABLE_TEXT_CHARS;
    let mut append = |value: &str| {
        if remaining == 0 || value.is_empty() {
            return;
        }
        if !text.is_empty() {
            text.push(' ');
        }
        for character in value.chars().take(remaining) {
            text.push(character);
            remaining -= 1;
        }
    };
    if let Some(elements) = message.get("elements").and_then(Value::as_array) {
        for element in elements {
            if let Some(content) = element
                .get("textElement")
                .and_then(|t| t.get("content"))
                .and_then(Value::as_str)
            {
                append(content);
            }
        }
    }
    for key in ["sendMemberName", "sendNickName"] {
        if let Some(name) = message.get(key).and_then(Value::as_str) {
            if !name.is_empty() {
                append(name);
                break;
            }
        }
    }
    text
}

struct SizeLimitedWriter {
    written: usize,
    limit: usize,
}

impl Write for SizeLimitedWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.len() > self.limit.saturating_sub(self.written) {
            return Err(io::Error::other("serialized value exceeds limit"));
        }
        self.written += buffer.len();
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serialized_size_with_limit(value: &Value, limit: usize) -> Option<usize> {
    let mut writer = SizeLimitedWriter { written: 0, limit };
    serde_json::to_writer(&mut writer, value).ok()?;
    Some(writer.written)
}

fn bounded_search_results(messages: &[Value], query_lower: &str) -> (Vec<Value>, usize, bool) {
    let mut results = Vec::new();
    let mut matched = 0usize;
    let mut serialized_bytes = 0usize;
    let mut truncated = false;
    for message in messages {
        if !extract_text(message).to_lowercase().contains(query_lower) {
            continue;
        }
        matched += 1;
        let remaining_bytes = MAX_SEARCH_RESULT_BYTES_PER_BATCH.saturating_sub(serialized_bytes);
        let Some(size) = serialized_size_with_limit(message, remaining_bytes) else {
            truncated = true;
            continue;
        };
        if results.len() >= MAX_SEARCH_RESULTS_PER_BATCH {
            truncated = true;
            continue;
        }
        serialized_bytes += size;
        results.push(message.clone());
    }
    (results, matched, truncated)
}

/// 处理流式搜索：边拉取边匹配边推送，处理完一批即释放。
async fn handle_stream_search(state: &SharedState, sender: WsSender, owner_id: &str, data: Value) {
    let search_id = data
        .get("searchId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let query = data
        .get("searchQuery")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    let peer_value = data.get("peer").cloned().unwrap_or(Value::Null);
    let Ok(peer) = serde_json::from_value::<Peer>(peer_value) else {
        send_json(
            &sender,
            &json!({
                "type": "search_error",
                "data": { "searchId": search_id, "message": "缺少必要参数" },
            }),
        )
        .await;
        return;
    };
    if search_id.is_empty()
        || search_id.len() > 128
        || query.is_empty()
        || peer.peer_uid.is_empty()
        || peer.peer_uid.len() > 256
        || peer.peer_uid.chars().any(char::is_control)
    {
        send_json(
            &sender,
            &json!({
                "type": "search_error",
                "data": { "searchId": search_id, "message": "缺少必要参数" },
            }),
        )
        .await;
        return;
    }

    let filter_value = data.get("filter").cloned().unwrap_or(Value::Null);
    let filter = MessageFilter {
        start_time: Some(
            filter_value
                .get("startTime")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ),
        end_time: Some(
            filter_value
                .get("endTime")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
        ),
        ..MessageFilter::default()
    };
    if filter
        .start_time
        .zip(filter.end_time)
        .is_some_and(|(start, end)| end < start)
    {
        send_json(
            &sender,
            &json!({
                "type": "search_error",
                "data": { "searchId": search_id, "message": "结束时间不能早于开始时间" },
            }),
        )
        .await;
        return;
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut searches = active_searches().lock().await;
        let owner_search_count = searches
            .values()
            .filter(|search| search.owner_id == owner_id)
            .count();
        if searches.len() >= MAX_ACTIVE_STREAM_SEARCHES
            || owner_search_count >= MAX_ACTIVE_STREAM_SEARCHES_PER_CONNECTION
            || searches.contains_key(&search_id)
        {
            send_json(
                &sender,
                &json!({
                    "type": "search_error",
                    "data": { "searchId": search_id, "message": "搜索任务数量已达上限或ID重复" },
                }),
            )
            .await;
            return;
        }
        searches.insert(
            search_id.clone(),
            ActiveSearch {
                owner_id: owner_id.to_string(),
                cancel_flag: Arc::clone(&cancel_flag),
            },
        );
    }

    let napcat = Arc::new(state.napcat.clone());
    let search_id_bg = search_id.clone();
    tokio::spawn(async move {
        let fetcher = BatchMessageFetcher::new(napcat, BatchFetchConfig::default());
        let mut processed: usize = 0;
        let mut matched: usize = 0;
        let mut previous = None;
        let query_lower = query.to_lowercase();
        let deadline = tokio::time::Instant::now() + MAX_STREAM_SEARCH_DURATION;

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                let _ = send_json(
                    &sender,
                    &json!({
                        "type": "search_progress",
                        "data": {
                            "searchId": search_id_bg,
                            "status": "cancelled",
                            "processedCount": processed,
                            "matchedCount": matched,
                            "results": [],
                        },
                    }),
                )
                .await;
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                let _ = send_json(
                    &sender,
                    &json!({
                        "type": "search_progress",
                        "data": {
                            "searchId": search_id_bg,
                            "status": "completed",
                            "processedCount": processed,
                            "matchedCount": matched,
                            "results": [],
                            "truncated": true,
                            "warning": "搜索已达到时间上限，请缩小时间范围后继续",
                        },
                    }),
                )
                .await;
                break;
            }
            let batch = match fetcher
                .fetch_next_batch(&peer, &filter, previous.as_ref())
                .await
            {
                Ok(Some(batch)) => batch,
                Ok(None) => {
                    let _ = send_json(
                        &sender,
                        &json!({
                            "type": "search_progress",
                            "data": {
                                "searchId": search_id_bg,
                                "status": "completed",
                                "processedCount": processed,
                                "matchedCount": matched,
                                "results": [],
                            },
                        }),
                    )
                    .await;
                    break;
                }
                Err(error) => {
                    let _ = send_json(
                        &sender,
                        &json!({
                            "type": "search_progress",
                            "data": {
                                "searchId": search_id_bg,
                                "status": "error",
                                "processedCount": processed,
                                "matchedCount": matched,
                                "results": [],
                                "error": error.to_string(),
                            },
                        }),
                    )
                    .await;
                    break;
                }
            };

            let remaining = MAX_STREAM_SEARCH_MESSAGES.saturating_sub(processed);
            let searched_count = remaining.min(batch.messages.len());
            let (results, batch_matched, results_truncated) =
                bounded_search_results(&batch.messages[..searched_count], &query_lower);
            processed += searched_count;
            matched += batch_matched;

            if !send_json(
                &sender,
                &json!({
                    "type": "search_progress",
                    "data": {
                        "searchId": search_id_bg,
                        "status": "searching",
                        "processedCount": processed,
                        "matchedCount": matched,
                        "results": results,
                        "resultsTruncated": results_truncated,
                    },
                }),
            )
            .await
            {
                break;
            }
            if searched_count < batch.messages.len() || processed >= MAX_STREAM_SEARCH_MESSAGES {
                let _ = send_json(
                    &sender,
                    &json!({
                        "type": "search_progress",
                        "data": {
                            "searchId": search_id_bg,
                            "status": "completed",
                            "processedCount": processed,
                            "matchedCount": matched,
                            "results": [],
                            "truncated": true,
                            "warning": "搜索已达到消息扫描上限，请缩小时间范围后继续",
                        },
                    }),
                )
                .await;
                break;
            }
            previous = Some(batch);
        }

        let mut searches = active_searches().lock().await;
        searches.remove(&search_id_bg);
    });
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_search_results, cancel_owned_search, extract_text, ActiveSearch,
        MAX_SEARCHABLE_TEXT_CHARS,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[test]
    fn searchable_text_is_bounded() {
        let message = json!({
            "elements": [{ "textElement": { "content": "x".repeat(MAX_SEARCHABLE_TEXT_CHARS + 100) } }],
            "sendNickName": "sender"
        });
        assert_eq!(
            extract_text(&message).chars().count(),
            MAX_SEARCHABLE_TEXT_CHARS
        );
    }

    #[test]
    fn search_results_are_bounded_by_serialized_size() {
        let messages = vec![
            json!({ "elements": [{ "textElement": { "content": "needle" } }], "data": "x".repeat(200_000) }),
            json!({ "elements": [{ "textElement": { "content": "needle" } }] }),
        ];
        let (results, matched, truncated) = bounded_search_results(&messages, "needle");
        assert!(truncated);
        assert_eq!(matched, 2);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_cancellation_is_scoped_to_owner() {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let mut searches = HashMap::new();
        searches.insert(
            "search-1".to_string(),
            ActiveSearch {
                owner_id: "connection-1".to_string(),
                cancel_flag: Arc::clone(&cancel_flag),
            },
        );

        assert!(!cancel_owned_search(&searches, "connection-2", "search-1"));
        assert!(!cancel_flag.load(Ordering::SeqCst));
        assert!(cancel_owned_search(&searches, "connection-1", "search-1"));
        assert!(cancel_flag.load(Ordering::SeqCst));
    }
}
