use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::api::state::SharedState;
use crate::fetcher::{BatchFetchConfig, BatchMessageFetcher, MessageFilter, Peer};

/// 活跃流式搜索的取消标记（searchId → flag）。
fn active_searches() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static SEARCHES: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    SEARCHES.get_or_init(|| Mutex::new(HashMap::new()))
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
    ws.on_upgrade(move |socket| handle_socket(state, socket))
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
                handle_stream_search(&state, Arc::clone(&sender), data).await;
            }
            "cancel_search" => {
                let search_id = data
                    .get("searchId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let searches = active_searches().lock().await;
                if let Some(flag) = searches.get(&search_id) {
                    flag.store(true, Ordering::SeqCst);
                }
            }
            other => {
                tracing::warn!("[ApiServer] 未知的WebSocket消息类型: {other}");
            }
        }
    }

    forward.abort();
    tracing::info!("[API] WebSocket连接关闭: {request_id}");
}

type WsSender = Arc<Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>;

async fn send_json(sender: &WsSender, payload: &Value) {
    let mut guard = sender.lock().await;
    let _ = guard.send(Message::Text(payload.to_string())).await;
}

/// 提取消息文本（正文 + 发送者名，供搜索匹配）。
fn extract_text(message: &Value) -> String {
    let mut texts: Vec<String> = Vec::new();
    if let Some(elements) = message.get("elements").and_then(Value::as_array) {
        for element in elements {
            if let Some(content) = element
                .get("textElement")
                .and_then(|t| t.get("content"))
                .and_then(Value::as_str)
            {
                texts.push(content.to_string());
            }
        }
    }
    for key in ["sendMemberName", "sendNickName"] {
        if let Some(name) = message.get(key).and_then(Value::as_str) {
            if !name.is_empty() {
                texts.push(name.to_string());
                break;
            }
        }
    }
    texts.join(" ")
}

/// 处理流式搜索：边拉取边匹配边推送，处理完一批即释放。
async fn handle_stream_search(state: &SharedState, sender: WsSender, data: Value) {
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
    if search_id.is_empty() || search_id.len() > 128 || query.is_empty() {
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

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut searches = active_searches().lock().await;
        if searches.len() >= 64 || searches.contains_key(&search_id) {
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
        searches.insert(search_id.clone(), Arc::clone(&cancel_flag));
    }

    let napcat = Arc::new(state.napcat.clone());
    let search_id_bg = search_id.clone();
    tokio::spawn(async move {
        let fetcher = BatchMessageFetcher::new(napcat, BatchFetchConfig::default());
        let mut processed: usize = 0;
        let mut matched: usize = 0;
        let mut previous = None;
        let query_lower = query.to_lowercase();

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                send_json(
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
            let batch = match fetcher
                .fetch_next_batch(&peer, &filter, previous.as_ref())
                .await
            {
                Ok(Some(batch)) => batch,
                Ok(None) => {
                    send_json(
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
                    send_json(
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

            let results: Vec<Value> = batch
                .messages
                .iter()
                .filter(|message| extract_text(message).to_lowercase().contains(&query_lower))
                .cloned()
                .collect();
            processed += batch.messages.len();
            matched += results.len();

            send_json(
                &sender,
                &json!({
                    "type": "search_progress",
                    "data": {
                        "searchId": search_id_bg,
                        "status": "searching",
                        "processedCount": processed,
                        "matchedCount": matched,
                        "results": results,
                    },
                }),
            )
            .await;
            previous = Some(batch);
        }

        let mut searches = active_searches().lock().await;
        searches.remove(&search_id_bg);
    });
}
