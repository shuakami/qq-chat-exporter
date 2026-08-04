async fn process_streaming_inner(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    writer: &mut DiskOutputWriter,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(PathBuf, usize, ResourceBatchSummary), String> {
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
            Err(error) => return Err(format!("获取消息失败（已自动降批次和重试）: {error}")),
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

    ensure_running(state, task_id, cancel_flag).await?;
    progress(
        state,
        task_id,
        35,
        "processing",
        "消息抓取完成，正在按批次解析并生成文件...",
        total_fetched,
        batch_count,
        None,
    )
    .await;

    let member_maps = fetch_group_member_maps(state, &request.peer_uid, request.chat_type).await;
    let self_info = state.napcat.self_info().await.unwrap_or(Value::Null);
    let self_uid = self_info
        .get("uid")
        .and_then(Value::as_str)
        .map(str::to_string);
    let self_uin = self_info
        .get("uin")
        .and_then(Value::as_str)
        .map(str::to_string);
    let self_name = self_info
        .get("nick")
        .and_then(Value::as_str)
        .map(str::to_string);
    let chat_type = classify_chat_type_binary(Some(request.chat_type)).to_string();
    let chat_info = ChatInfo {
        name: request.session_name.clone(),
        chat_type: chat_type.clone(),
        avatar: chat_avatar_url(&chat_type, &request.peer_uid, request.peer_uin.as_deref()),
        participant_count: None,
        self_uid: self_uid.clone(),
        self_uin: self_uin.clone(),
        self_name: self_name.clone(),
        peer_uid: Some(request.peer_uid.clone()),
        peer_uin: request.peer_uin.clone(),
    };

    configure_skip_types(state, &request.options).await;
    let mut summary = ResourceBatchSummary::default();
    let files = spool.raw_files_oldest_first();
    let mut processed_raw = 0usize;
    for (file_index, file) in files.iter().enumerate() {
        ensure_running(state, task_id, cancel_flag).await?;
        let mut raw_messages: Vec<Value> = read_jsonl(file).await?;
        raw_messages.sort_by_key(raw_message_time);
        if request.chat_type == GROUP_CHAT_TYPE && !raw_messages.is_empty() {
            if let Err(error) = repair_group_message_sequence(
                &state.napcat,
                &peer,
                &mut raw_messages,
                SequenceRepairConfig::default(),
            )
            .await
            {
                tracing::warn!("[DiskStreaming] 当前批次序列修复未完成，继续导出: {error}");
            }
            apply_group_member_maps(&mut raw_messages, &member_maps);
        }
        raw_messages = apply_sender_filter(raw_messages, &request.filter);
        processed_raw += raw_messages.len();

        let title_map = Arc::new(member_maps.titles.clone());
        let mut parser = SimpleMessageParser::new(SimpleParserOptions {
            html_enabled: true,
            prefer_group_member_name: request
                .options
                .get("preferGroupMemberName")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            sender_title_resolver: Some(Arc::new(move |uid, uin| {
                uid.and_then(|value| title_map.get(value).cloned())
                    .or_else(|| uin.and_then(|value| title_map.get(value).cloned()))
            })),
            forward_fetcher: Some(Arc::new(state.napcat.clone()) as Arc<dyn ForwardFetcher>),
        });
        let mut clean_messages = parser.parse_messages(&raw_messages).await;
        let mut resource_messages = raw_messages;
        resource_messages.extend(parser.take_forward_raw_messages());

        if !resource_messages.is_empty() {
            let resource_map = state
                .resource_handler
                .process_message_resources_with_cancel_and_trace(
                    &resource_messages,
                    Arc::clone(cancel_flag),
                    None,
                )
                .await;
            add_summary(
                &mut summary,
                state.resource_handler.last_batch_summary().await,
            );
            let value_map: HashMap<String, Vec<Value>> = resource_map
                .into_iter()
                .map(|(id, resources)| {
                    let values = resources
                        .into_iter()
                        .filter_map(|resource| serde_json::to_value(resource).ok())
                        .collect();
                    (id, values)
                })
                .collect();
            for message in &mut clean_messages {
                SimpleMessageParser::update_message_resource_paths_recursive(message, &value_map);
            }
            SimpleMessageParser::backfill_reply_preview_local_paths(&mut clean_messages);
        }
        backfill_self_sender_names(
            &mut clean_messages,
            self_uid.as_deref(),
            self_uin.as_deref(),
            self_name.as_deref(),
        );
        writer.write_messages(clean_messages).await?;

        let progress_value =
            35 + (((file_index + 1) as f64 / files.len().max(1) as f64) * 50.0).round() as i64;
        let message = format!(
            "正在磁盘分块处理 · {}/{} 批 · 已处理 {} 条",
            file_index + 1,
            files.len(),
            processed_raw,
        );
        progress(
            state,
            task_id,
            progress_value.min(85),
            "processing",
            &message,
            processed_raw,
            file_index + 1,
            None,
        )
        .await;
    }
    state.resource_handler.set_skip_download_types(None).await;
    state.resource_handler.set_progress_callback(None).await;

    ensure_running(state, task_id, cancel_flag).await?;
    progress(
        state,
        task_id,
        90,
        "finalizing",
        if writer.mode == StreamingOutput::HtmlZip {
            "消息分块已完成，正在生成查看器并打包 ZIP..."
        } else {
            "消息分块已完成，正在写入清单..."
        },
        writer.total_messages,
        writer.chunks.len(),
        None,
    )
    .await;
    let writer = std::mem::replace(
        writer,
        DiskOutputWriter::create(
            &request.output_dir,
            &format!(".unused-{task_id}"),
            StreamingOutput::Jsonl,
            task_id,
            true,
        )
        .await?,
    );
    let (final_path, message_count) = writer.finish(&chat_info).await?;
    Ok((final_path, message_count, summary))
}
