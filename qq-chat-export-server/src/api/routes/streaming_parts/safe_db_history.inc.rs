const SAFE_GROUP_BOOTSTRAP_COUNT: i64 = 1;
const SAFE_GROUP_INITIAL_BATCH: i64 = 20;
const SAFE_GROUP_MAX_BATCH: i64 = 200;
const SAFE_GROUP_PAGE_DELAY_MS: u64 = 250;
const SAFE_GROUP_CALL_TIMEOUT_MS: u64 = 45_000;
const SAFE_GROUP_FAILURE_COOLDOWN_MS: u64 = 30_000;
const SAFE_GROUP_BOOTSTRAP_METHOD: &str = "MsgService.getLatestDbMsgs";
const SAFE_GROUP_PAGE_METHOD: &str = "MsgService.queryMsgsWithFilterEx";

fn group_history_gate() -> &'static tokio::sync::Semaphore {
    static GATE: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Semaphore::new(1))
}

fn group_history_cooldown_until() -> &'static std::sync::atomic::AtomicU64 {
    static UNTIL: std::sync::OnceLock<std::sync::atomic::AtomicU64> = std::sync::OnceLock::new();
    UNTIL.get_or_init(|| std::sync::atomic::AtomicU64::new(0))
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn open_group_history_circuit() {
    group_history_cooldown_until().store(
        unix_time_ms().saturating_add(SAFE_GROUP_FAILURE_COOLDOWN_MS),
        Ordering::SeqCst,
    );
}

fn extract_history_messages(value: &Value) -> Vec<Value> {
    value
        .get("msgList")
        .or_else(|| value.pointer("/result/msgList"))
        .or_else(|| value.pointer("/data/msgList"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn raw_message_seq(message: &Value) -> Option<i64> {
    loose_i64(message.get("msgSeq"))
}

fn raw_message_id(message: &Value) -> Option<String> {
    match message.get("msgId") {
        Some(Value::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn raw_message_matches_fetch_filter(message: &Value, filter: &Value) -> bool {
    let timestamp = raw_message_time(message);
    let start = normalize_ms(loose_i64(filter.get("startTime")).unwrap_or(0));
    let end = normalize_ms(
        loose_i64(filter.get("endTime")).unwrap_or_else(|| Utc::now().timestamp_millis()),
    );
    if timestamp == 0 || timestamp < start || timestamp > end {
        return false;
    }

    let keywords: Vec<String> = filter
        .get("keywords")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .collect();
    if keywords.is_empty() {
        return true;
    }
    let searchable = message
        .get("elements")
        .map(|elements| elements.to_string().to_lowercase())
        .unwrap_or_default();
    keywords.iter().any(|keyword| searchable.contains(keyword))
}

fn next_safe_group_batch_size(current: i64, successful_pages: usize) -> i64 {
    if successful_pages < 3 {
        return current;
    }
    match current {
        0..=20 => 50,
        21..=50 => 100,
        _ => SAFE_GROUP_MAX_BATCH,
    }
    .min(SAFE_GROUP_MAX_BATCH)
}

fn group_db_query_params(peer: &Value, anchor_seq: i64, batch_size: i64) -> Value {
    json!([
        "0",
        "0",
        anchor_seq.to_string(),
        {
            "chatInfo": peer.clone(),
            "filterMsgType": [],
            "filterSendersUid": [],
            "filterMsgToTime": "0",
            "filterMsgFromTime": "0",
            "isReverseOrder": true,
            "isIncludeCurrent": false,
            "pageLimit": batch_size.clamp(1, SAFE_GROUP_MAX_BATCH),
        }
    ])
}

async fn call_group_history_once(
    state: &SharedState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let now = unix_time_ms();
    let cooldown_until = group_history_cooldown_until().load(Ordering::SeqCst);
    if cooldown_until > now {
        return Err(format!(
            "QQ 本地消息数据库刚刚发生异常，已停止继续请求；请等待约 {} 秒后再试",
            (cooldown_until - now).div_ceil(1_000),
        ));
    }

    let _permit = group_history_gate()
        .acquire()
        .await
        .map_err(|_| "QQ 本地消息数据库串行锁已关闭".to_string())?;
    let call = state.napcat.call(method, params);
    match tokio::time::timeout(Duration::from_millis(SAFE_GROUP_CALL_TIMEOUT_MS), call).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => {
            open_group_history_circuit();
            Err(format!(
                "QQ 本地消息数据库调用失败，已停止且不会自动重试，避免 Worker 重复崩溃: {error}"
            ))
        }
        Err(_) => {
            open_group_history_circuit();
            Err(format!(
                "QQ 本地消息数据库等待超过 {} 秒，已停止且不会自动重试",
                SAFE_GROUP_CALL_TIMEOUT_MS / 1_000,
            ))
        }
    }
}

async fn fetch_safe_group_history_to_spool(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(usize, usize), String> {
    ensure_running(state, task_id, cancel_flag).await?;
    if !state.napcat.healthy().await {
        return Err("NapCat bridge 当前不可用，未开始读取聊天记录".to_string());
    }
    tokio::time::timeout(Duration::from_secs(10), state.napcat.self_info())
        .await
        .map_err(|_| "读取 QQ 登录状态超时，未开始本地消息数据库查询".to_string())?
        .map_err(|error| format!("QQ 当前未处于可用登录状态，未开始本地消息数据库查询: {error}"))?;

    let peer = json!({
        "chatType": request.chat_type,
        "peerUid": request.peer_uid,
        "guildId": "",
    });
    progress(
        state,
        task_id,
        5,
        "fetching",
        "正在从 QQ 本地消息数据库分页读取群聊：单请求、全局串行、失败不重试...",
        0,
        0,
        None,
    )
    .await;

    // 仅从本地消息数据库取最新一条作为游标。不要再调用 first-view、
    // getMsgHistory/getMsgsIncludeSelf 或已废弃的 getMsgsBySeqAndCount。
    let bootstrap = call_group_history_once(
        state,
        SAFE_GROUP_BOOTSTRAP_METHOD,
        json!([peer.clone(), SAFE_GROUP_BOOTSTRAP_COUNT]),
    )
    .await?;
    let bootstrap_messages = extract_history_messages(&bootstrap);
    if bootstrap_messages.is_empty() {
        return Ok((0, 0));
    }
    let latest_seq = bootstrap_messages
        .iter()
        .filter_map(raw_message_seq)
        .max()
        .ok_or_else(|| "QQ 本地最新消息缺少 msgSeq，无法进行数据库分页".to_string())?;

    let mut total_written = 0usize;
    let mut page_count = 0usize;
    let mut anchor_seq = latest_seq.saturating_add(1);
    let mut batch_size = SAFE_GROUP_INITIAL_BATCH;
    let mut successes_at_size = 0usize;
    let mut recent_ids = HashSet::new();
    let start_time = normalize_ms(loose_i64(request.filter.get("startTime")).unwrap_or(0));

    loop {
        ensure_running(state, task_id, cancel_flag).await?;
        let started = tokio::time::Instant::now();
        let result = call_group_history_once(
            state,
            SAFE_GROUP_PAGE_METHOD,
            group_db_query_params(&peer, anchor_seq, batch_size),
        )
        .await?;
        let mut raw_messages = extract_history_messages(&result);
        if raw_messages.is_empty() {
            break;
        }
        page_count += 1;

        let minimum_seq = raw_messages
            .iter()
            .filter_map(raw_message_seq)
            .min()
            .ok_or_else(|| format!("第 {page_count} 批本地消息均缺少 msgSeq，已停止数据库分页"))?;
        if minimum_seq >= anchor_seq {
            return Err(format!(
                "QQ 本地数据库游标没有向更早消息移动（anchor={anchor_seq}, min={minimum_seq}），已停止以避免重复请求"
            ));
        }

        raw_messages.sort_by_key(raw_message_time);
        raw_messages.retain(|message| {
            let Some(id) = raw_message_id(message) else {
                return true;
            };
            recent_ids.insert(id)
        });
        if recent_ids.len() > (SAFE_GROUP_MAX_BATCH as usize * 3) {
            let retained: HashSet<String> = raw_messages
                .iter()
                .rev()
                .take(SAFE_GROUP_MAX_BATCH as usize)
                .filter_map(raw_message_id)
                .collect();
            recent_ids = retained;
        }

        let earliest_time = raw_messages
            .iter()
            .map(raw_message_time)
            .filter(|timestamp| *timestamp > 0)
            .min();
        let filtered: Vec<Value> = raw_messages
            .into_iter()
            .filter(|message| raw_message_matches_fetch_filter(message, &request.filter))
            .collect();
        total_written += filtered.len();
        spool.push_raw_batch(&filtered).await?;

        let elapsed = started.elapsed().as_millis();
        let message = format!(
            "本地数据库分页中 · 第 {page_count} 批 · 已写入 {total_written} 条 · 当前批次 {batch_size} · {elapsed} ms"
        );
        progress(
            state,
            task_id,
            10,
            "fetching",
            &message,
            total_written,
            page_count,
            Some(0),
        )
        .await;

        if earliest_time.is_some_and(|timestamp| timestamp < start_time) || minimum_seq <= 1 {
            break;
        }
        anchor_seq = minimum_seq;
        successes_at_size += 1;
        let next_size = next_safe_group_batch_size(batch_size, successes_at_size);
        if next_size != batch_size {
            batch_size = next_size;
            successes_at_size = 0;
        }
        tokio::time::sleep(Duration::from_millis(SAFE_GROUP_PAGE_DELAY_MS)).await;
    }
    Ok((total_written, page_count))
}

async fn fetch_legacy_history_to_spool(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(usize, usize), String> {
    progress(
        state,
        task_id,
        5,
        "fetching",
        "正在从 QQ 获取消息，批次会立即写入磁盘...",
        0,
        0,
        None,
    )
    .await;
    let keywords = request
        .filter
        .get("keywords")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|keyword| !keyword.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty());
    let fetcher = BatchMessageFetcher::new(
        Arc::new(state.napcat.clone()),
        BatchFetchConfig {
            batch_size: request
                .options
                .get("batchSize")
                .and_then(Value::as_i64)
                .unwrap_or(STREAM_BATCH_SIZE)
                .clamp(200, STREAM_BATCH_SIZE),
            timeout_ms: FETCH_TIMEOUT_MS,
            retry_count: 3,
            ..BatchFetchConfig::default()
        },
    );
    let peer = Peer {
        chat_type: request.chat_type,
        peer_uid: request.peer_uid.clone(),
        guild_id: None,
    };
    let filter = MessageFilter {
        start_time: Some(normalize_ms(
            loose_i64(request.filter.get("startTime")).unwrap_or(0),
        )),
        end_time: Some(normalize_ms(
            loose_i64(request.filter.get("endTime"))
                .unwrap_or_else(|| Utc::now().timestamp_millis()),
        )),
        keywords,
        ..MessageFilter::default()
    };

    let mut previous = None;
    let mut total_fetched = 0usize;
    let mut batch_count = 0usize;
    let mut empty_batches = 0u32;
    let mut last_cursor: Option<String> = None;
    let mut recent_ids: HashSet<String> = HashSet::new();

    loop {
        ensure_running(state, task_id, cancel_flag).await?;
        let started = tokio::time::Instant::now();
        let previous_snapshot = previous.clone();
        let fetch_future = fetcher.fetch_next_batch(&peer, &filter, previous_snapshot.as_ref());
        tokio::pin!(fetch_future);
        let mut heartbeat = tokio::time::interval(Duration::from_secs(HEARTBEAT_SECONDS));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let fetch_result = loop {
            tokio::select! {
                result = &mut fetch_future => break result,
                _ = heartbeat.tick() => {
                    ensure_running(state, task_id, cancel_flag).await?;
                    let waiting = started.elapsed().as_secs();
                    let message = format!(
                        "正在获取第 {} 批 · 已写入 {} 条 · 当前请求等待 {} 秒",
                        batch_count + 1,
                        total_fetched,
                        waiting,
                    );
                    broadcast_progress(state, task_id, 10, "fetching", &message, total_fetched, batch_count, Some(waiting));
                }
            }
        };
        let mut batch = match fetch_result {
            Ok(Some(batch)) => batch,
            Ok(None) => break,
            Err(error) => return Err(format!("获取消息失败: {error}")),
        };
        batch_count += 1;

        let cursor = batch.next_message_id.clone();
        if batch.has_more && cursor.is_some() && cursor == last_cursor {
            return Err(format!(
                "检测到消息游标连续重复，已停止以避免无限循环（第 {batch_count} 批）"
            ));
        }
        last_cursor = cursor;

        let mut current_ids = HashSet::new();
        batch.messages.retain(|message| {
            let id = message
                .get("msgId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if id.is_empty() {
                return true;
            }
            current_ids.insert(id.to_string()) && !recent_ids.contains(id)
        });
        recent_ids = batch
            .messages
            .iter()
            .rev()
            .take(16)
            .filter_map(|message| message.get("msgId").and_then(Value::as_str))
            .map(str::to_string)
            .collect();

        if batch.messages.is_empty() && batch.has_more {
            empty_batches += 1;
            if empty_batches >= MAX_EMPTY_BATCHES_WITH_MORE {
                return Err("连续空批次仍声明存在更多消息，已停止以避免假运行".to_string());
            }
        } else {
            empty_batches = 0;
        }
        total_fetched += batch.messages.len();
        spool.push_raw_batch(&batch.messages).await?;

        let message = format!(
            "消息仍在正常获取 · 第 {batch_count} 批 · 已写入 {total_fetched} 条 · 本批 {} ms",
            batch.fetch_time_ms,
        );
        progress(
            state,
            task_id,
            10,
            "fetching",
            &message,
            total_fetched,
            batch_count,
            Some(0),
        )
        .await;
        let has_more = batch.has_more;
        previous = Some(batch);
        if !has_more {
            break;
        }
    }
    Ok((total_fetched, batch_count))
}

async fn fetch_streaming_messages_to_spool(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(usize, usize), String> {
    if request.chat_type == GROUP_CHAT_TYPE {
        fetch_safe_group_history_to_spool(state, task_id, request, spool, cancel_flag).await
    } else {
        fetch_legacy_history_to_spool(state, task_id, request, spool, cancel_flag).await
    }
}
