async fn process_streaming_inner(
    state: &SharedState,
    task_id: &str,
    request: &StreamingRequest,
    spool: &mut StreamingMessageSpool,
    writer: &mut DiskOutputWriter,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(PathBuf, usize, ResourceBatchSummary), String> {
    let (total_fetched, batch_count) =
        fetch_streaming_messages_to_spool(state, task_id, request, spool, cancel_flag).await?;

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

        // 安全群聊分页已经严格按递减 msgSeq 获取并在边界去重。
        // 不再调用 repair_group_message_sequence：该函数会再次请求 QQ 历史接口，
        // 既破坏“单一历史读取通道”，也可能让刚恢复的 Worker 再次崩溃。
        if request.chat_type == GROUP_CHAT_TYPE && !raw_messages.is_empty() {
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
