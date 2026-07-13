use std::collections::{HashMap, HashSet};
use std::path::{Path as FsPath, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::{Extension, Json, State};
use axum::response::Response;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};

use qce_exporter::excel_exporter::{ExcelExporter, ExcelFormatOptions};
use qce_exporter::json_exporter::{
    ChunkedJsonlExportOptions, JsonExportMode, JsonExporter, JsonFormatOptions,
};
use qce_exporter::modern_html_exporter::{
    ChunkedHtmlExportOptions, HtmlExportOptions, ModernHtmlExporter,
};
use qce_exporter::text_exporter::{TextExporter, TextFormatOptions};
use qce_exporter::types::MessageResource;
use qce_exporter::{ChatInfo, CleanMessage, ExportOptions};

use crate::api::helpers::{
    chat_avatar_url, resolve_peer_uid, resolve_peer_uin, resolve_session_name,
};
use crate::api::response::{self, ApiError, RequestId};
use crate::api::state::{MessageCacheEntry, SharedState, CACHE_EXPIRE_TIME_MS};
use crate::fetcher::{
    chat_type_prefix, classify_chat_type_binary, BatchFetchConfig, BatchMessageFetcher,
    MessageFilter, Peer, GROUP_CHAT_TYPE,
};
use crate::parser::{ForwardFetcher, SimpleMessageParser, SimpleParserOptions};
use crate::paths::PathManager;
use crate::resource::ResourceBatchSummary;
use crate::storage::ResourceInfo;

/// 当前毫秒时间戳。
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 当前 ISO 时间串。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 10 位秒级时间戳转毫秒（TS 同款启发式）。
fn normalize_to_ms(ts: i64) -> i64 {
    if ts > 1_000_000_000 && ts < 10_000_000_000 {
        ts * 1000
    } else {
        ts
    }
}

/// 从 JSON 里宽松取 i64（数字或数字字符串）。
fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// 从请求体解析 peer（chatType 允许数字或字符串）。
fn parse_peer(body: &Value) -> Option<(i64, String)> {
    let peer = body.get("peer")?;
    let chat_type = loose_i64(peer.get("chatType"))?;
    let peer_uid = peer
        .get("peerUid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?
        .to_string();
    Some((chat_type, peer_uid))
}

/// 消息 msgTime → 毫秒。
fn msg_time_ms(message: &Value) -> i64 {
    normalize_to_ms(loose_i64(message.get("msgTime")).unwrap_or(0))
}

/// 把用户可见信息压成 Windows / Unicode 安全的文件名片段。
fn sanitize_chat_name(name: &str, max_length: usize) -> String {
    let mut safe = String::new();
    let mut last_underscore = false;
    for ch in name.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 || c == '\u{7f}' => '_',
            c if c.is_whitespace() => '_',
            c => c,
        };
        if mapped == '_' {
            if !last_underscore {
                safe.push('_');
            }
            last_underscore = true;
        } else {
            safe.push(mapped);
            last_underscore = false;
        }
    }
    let mut safe = safe.trim_matches(['_', ' ', '.']).to_string();
    if safe.chars().count() > max_length {
        safe = safe.chars().take(max_length).collect();
        safe = safe.trim_end_matches(['_', ' ', '.']).to_string();
    }
    let reserved = matches!(
        safe.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        safe.insert(0, '_');
    }
    safe
}

fn export_name_stem(
    chat_type_prefix: &str,
    peer_identity: &str,
    session_name: &str,
    date_str: &str,
    time_str: &str,
) -> String {
    let safe_name = sanitize_chat_name(session_name, 40);
    let safe_name = if safe_name.is_empty() {
        "未命名会话".to_string()
    } else {
        safe_name
    };
    let safe_identity = sanitize_chat_name(peer_identity, 32);
    let safe_identity = if safe_identity.is_empty() {
        "unknown".to_string()
    } else {
        safe_identity
    };
    format!("{chat_type_prefix}_{safe_name}_{safe_identity}_{date_str}_{time_str}")
}

/// 生成统一的人类可读导出文件名。
#[allow(clippy::too_many_arguments)]
fn build_export_file_name(
    chat_type_prefix: &str,
    peer_identity: &str,
    session_name: &str,
    date_str: &str,
    time_str: &str,
    extension: &str,
    _use_name_in_file_name: bool,
    _use_friendly_file_name: bool,
) -> String {
    format!(
        "{}.{extension}",
        export_name_stem(
            chat_type_prefix,
            peer_identity,
            session_name,
            date_str,
            time_str
        )
    )
}

/// 生成统一的人类可读导出目录名。
#[allow(clippy::too_many_arguments)]
fn build_export_dir_name(
    chat_type_prefix: &str,
    peer_identity: &str,
    session_name: &str,
    date_str: &str,
    time_str: &str,
    suffix: &str,
    _use_name_in_file_name: bool,
    _use_friendly_file_name: bool,
) -> String {
    format!(
        "{}{suffix}",
        export_name_stem(
            chat_type_prefix,
            peer_identity,
            session_name,
            date_str,
            time_str
        )
    )
}

fn collision_name(file_name: &str, suffix: u32) -> String {
    let (base, extension) = match file_name.rsplit_once('.') {
        Some((base, extension))
            if matches!(
                extension.to_ascii_lowercase().as_str(),
                "html" | "json" | "txt" | "xlsx" | "zip"
            ) =>
        {
            (base, &file_name[base.len()..])
        }
        _ => (file_name, ""),
    };
    format!("{base}_{suffix}{extension}")
}

fn reserved_export_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static RESERVED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    RESERVED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 为运行中的任务预留唯一输出路径；预留项在任务结束时释放。
fn reserve_export_file_name(output_dir: &FsPath, file_name: &str) -> String {
    let mut reserved = reserved_export_paths()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for suffix in 1_u32.. {
        let candidate = if suffix == 1 {
            file_name.to_string()
        } else {
            collision_name(file_name, suffix)
        };
        let path = output_dir.join(&candidate);
        if !path.exists() && !reserved.contains(&path) {
            reserved.insert(path);
            return candidate;
        }
    }
    unreachable!("u32 filename suffix space exhausted")
}

fn release_export_path(path: &FsPath) {
    reserved_export_paths()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(path);
}

/// Issue #192：根据是否使用自定义路径生成下载 URL。
fn generate_download_url(
    file_path: &FsPath,
    file_name: &str,
    custom_output_dir: &str,
    url_prefix: &str,
) -> String {
    if !custom_output_dir.trim().is_empty() {
        let encoded =
            utf8_percent_encode(&file_path.to_string_lossy(), NON_ALPHANUMERIC).to_string();
        return format!("/api/download-file?path={encoded}");
    }
    format!("{url_prefix}{file_name}")
}

/// 生成 `export_{ms}_{rand9}` 风格任务 ID。
fn generate_task_id(prefix: &str) -> String {
    let rand: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(9)
        .collect();
    format!("{prefix}_{}_{rand}", now_ms())
}

/// 本地日期 / 时间字符串（YYYYMMDD / HHMMSSmmm）。
fn local_date_time_strings() -> (String, String) {
    let now = chrono::Local::now();
    (
        now.format("%Y%m%d").to_string(),
        now.format("%H%M%S%3f").to_string(),
    )
}

/// issue #363：把资源摘要翻译成给用户看的一句话（对应 TS `buildResourceSummaryMessage`）。
fn build_resource_summary_message(summary: Option<&ResourceBatchSummary>) -> Option<String> {
    let summary = summary?;
    if summary.attempted == 0 {
        return None;
    }
    let reused = summary.already_available + summary.downloaded;
    let head = format!("资源 {reused}/{}", summary.attempted);
    if summary.failed == 0 {
        return Some(head);
    }
    Some(format!(
        "{head}，失败 {}。文本记录已完整导出。\
         部分多媒体文件因 QQ 接口限流或暂时降级导致下载失败。\
         修复：可在 QQ 客户端中手动点开这些图片以刷新缓存，\
         随后在 QCE 任务列表中点击「重试」补齐。",
        summary.failed
    ))
}

/// 发件人过滤器（对应 TS `buildSenderFilter`，include/exclude 均空时为 None）。
fn build_sender_filter(filter: &Value) -> Option<(HashSet<String>, HashSet<String>)> {
    fn normalize(list: Option<&Value>) -> HashSet<String> {
        list.and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| match v {
                        Value::String(s) => Some(s.trim().to_string()),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    })
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }
    let include = normalize(filter.get("includeUserUins"));
    let exclude = normalize(filter.get("excludeUserUins"));
    if include.is_empty() && exclude.is_empty() {
        None
    } else {
        Some((include, exclude))
    }
}

/// 应用发件人过滤器。
fn apply_sender_filter(messages: Vec<Value>, filter: &Value) -> Vec<Value> {
    let Some((include, exclude)) = build_sender_filter(filter) else {
        return messages;
    };
    messages
        .into_iter()
        .filter(|msg| {
            let uin = msg
                .get("senderUin")
                .map(|v| match v {
                    Value::String(s) => s.trim().to_string(),
                    Value::Number(n) => n.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            if !exclude.is_empty() && exclude.contains(&uin) {
                return false;
            }
            if !include.is_empty() && !include.contains(&uin) {
                return false;
            }
            true
        })
        .collect()
}

/// 更新内存任务表并持久化到数据库。
async fn update_task(state: &SharedState, task_id: &str, patch: Value) {
    let updated = {
        let mut tasks = state.export_tasks.lock().await;
        let Some(task) = tasks.get_mut(task_id) else {
            return;
        };
        if !should_apply_task_patch(task, &patch) {
            return;
        }
        if let (Some(target), Some(source)) = (task.as_object_mut(), patch.as_object()) {
            for (key, value) in source {
                if value.is_null() {
                    target.remove(key);
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
        task.clone()
    };
    if let Err(error) = state.db.save_task(&updated, &updated, false).await {
        tracing::warn!("[ApiServer] 保存任务到数据库失败: {error}");
    }
}

fn should_apply_task_patch(task: &Value, patch: &Value) -> bool {
    task.get("status").and_then(Value::as_str) != Some("cancelled")
        || patch.get("status").and_then(Value::as_str) == Some("cancelled")
}

/// 广播导出进度。
fn broadcast_progress(
    state: &SharedState,
    task_id: &str,
    progress: i64,
    message: &str,
    count: usize,
) {
    state.broadcast_ws(&json!({
        "type": "export_progress",
        "data": {
            "taskId": task_id,
            "status": "running",
            "progress": progress,
            "message": message,
            "messageCount": count,
        },
    }));
}

/// `POST /api/messages/fetch` — 分页抓取消息（10 分钟缓存 + 懒加载分页）。
pub async fn fetch_messages(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let Some((chat_type, peer_uid)) = parse_peer(&body) else {
        let err = ApiError::validation("peer参数不完整", "INVALID_PEER");
        return response::error(&err, &request_id);
    };
    let filter = body.get("filter").cloned().unwrap_or(Value::Null);
    let batch_size = loose_i64(body.get("batchSize")).unwrap_or(5000);
    let page = loose_i64(body.get("page")).unwrap_or(1).max(1);
    let limit = loose_i64(body.get("limit")).unwrap_or(50).max(1);

    let start_time = loose_i64(filter.get("startTime"));
    let end_time = loose_i64(filter.get("endTime"));
    if let (Some(start), Some(end)) = (start_time, end_time) {
        if end < start {
            let err = ApiError::validation("结束时间不能早于开始时间", "INVALID_TIME_RANGE");
            return response::error(&err, &request_id);
        }
    }

    let now = now_ms();
    let cache_key = format!(
        "{chat_type}_{peer_uid}_{}_{}",
        start_time.unwrap_or(0),
        end_time.unwrap_or(now)
    );

    let cached = {
        let mut cache = state.message_cache.lock().await;
        match cache.get(&cache_key) {
            Some(entry) if now - entry.last_update > CACHE_EXPIRE_TIME_MS => {
                cache.remove(&cache_key);
                None
            }
            Some(entry) => Some(entry.clone()),
            None => None,
        }
    };

    let cache_hit = cached.is_some();
    let mut all_messages: Vec<Value> = Vec::new();
    let mut has_more = false;
    if let Some(entry) = cached {
        all_messages = entry.messages;
        has_more = entry.has_more;
    }

    let start_index = usize::try_from((page - 1) * limit).unwrap_or(0);
    let end_index = usize::try_from(page * limit).unwrap_or(usize::MAX);

    let paginate_response = |messages: &[Value], has_next: bool, hit: bool| -> Response {
        let total = messages.len();
        let slice: Vec<Value> = messages
            .iter()
            .skip(start_index)
            .take(end_index.saturating_sub(start_index))
            .cloned()
            .collect();
        let total_pages = total.div_ceil(usize::try_from(limit).unwrap_or(1));
        response::success(
            json!({
                "messages": slice,
                "totalCount": total,
                "currentPage": page,
                "totalPages": total_pages,
                "hasNext": has_next,
                "cacheHit": hit,
                "fetchedAt": now_iso(),
            }),
            &request_id,
        )
    };

    // 缓存足够当前页，或缓存已是全部消息 → 直接返回。
    if cache_hit {
        if all_messages.len() > end_index {
            return paginate_response(&all_messages, has_more, true);
        }
        if !has_more {
            return paginate_response(&all_messages, false, true);
        }
    }

    // 懒加载：目标 = 当前页 + 富余 10 页，减少请求次数。
    let fetcher = BatchMessageFetcher::new(
        Arc::new(state.napcat.clone()),
        BatchFetchConfig {
            batch_size,
            timeout_ms: 30_000,
            retry_count: 3,
            ..BatchFetchConfig::default()
        },
    );
    let peer = Peer {
        chat_type,
        peer_uid: peer_uid.clone(),
        guild_id: None,
    };
    let fetch_filter = MessageFilter {
        start_time: Some(start_time.unwrap_or(0)),
        end_time: Some(end_time.unwrap_or(now)),
        ..MessageFilter::default()
    };

    let target_count = usize::try_from(page * limit + limit * 10).unwrap_or(usize::MAX);
    let mut seen_ids: HashSet<String> = all_messages
        .iter()
        .filter_map(|m| m.get("msgId").and_then(Value::as_str).map(str::to_string))
        .collect();
    let mut previous = None;
    let mut reached_target = false;

    loop {
        let mut batch = match fetcher
            .fetch_next_batch(&peer, &fetch_filter, previous.as_ref())
            .await
        {
            Ok(Some(batch)) => batch,
            Ok(None) => break,
            Err(error) => {
                let err = ApiError::internal(format!("获取消息失败: {error}"), "FETCH_FAILED");
                return response::error(&err, &request_id);
            }
        };
        for message in batch.messages.drain(..) {
            let msg_id = message
                .get("msgId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if msg_id.is_empty() || seen_ids.insert(msg_id) {
                all_messages.push(message);
            }
        }
        if all_messages.len() >= target_count {
            reached_target = true;
            break;
        }
        previous = Some(batch);
    }
    has_more = reached_target;

    // 按时间戳倒序。
    all_messages.sort_by_key(|m| std::cmp::Reverse(msg_time_ms(m)));

    let has_next = all_messages.len() > end_index || has_more;
    let paginated = paginate_response(&all_messages, has_next, cache_hit);
    {
        let mut cache = state.message_cache.lock().await;
        cache.insert(
            cache_key,
            MessageCacheEntry {
                messages: all_messages,
                last_update: now_ms(),
                has_more,
            },
        );
    }

    paginated
}

/// 导出请求的公共参数。
struct ExportRequest {
    chat_type: i64,
    peer_uid: String,
    peer_identity: String,
    peer_uin: Option<String>,
    filter: Value,
    options: Value,
    session_name: String,
    custom_output_dir: String,
    output_dir: PathBuf,
    use_name_in_file_name: bool,
    use_friendly_file_name: bool,
    date_str: String,
    time_str: String,
}

/// 解析导出请求公共部分（peer 校验 / uid 解析 / 会话名 / 输出目录）。
async fn prepare_export_request(
    state: &SharedState,
    body: &Value,
) -> Result<ExportRequest, ApiError> {
    let Some((chat_type, raw_peer_uid)) = parse_peer(body) else {
        return Err(ApiError::validation("peer参数不完整", "INVALID_PEER"));
    };
    // Issue #226 / #353：支持通过 QQ 号导出，自动转换为 uid。
    let peer_uid = resolve_peer_uid(chat_type, &raw_peer_uid, &state.napcat).await;
    let request_peer_uin = body
        .pointer("/peer/peerUin")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        .map(str::to_string);
    let peer_uin = if chat_type == GROUP_CHAT_TYPE {
        None
    } else {
        request_peer_uin.or_else(|| {
            raw_peer_uid
                .chars()
                .all(|ch| ch.is_ascii_digit())
                .then(|| raw_peer_uid.clone())
        })
    };
    let peer_identity = if chat_type == GROUP_CHAT_TYPE {
        raw_peer_uid.clone()
    } else {
        peer_uin.clone().unwrap_or_else(|| peer_uid.clone())
    };
    let filter = body.get("filter").cloned().unwrap_or(Value::Null);
    let options = body.get("options").cloned().unwrap_or(Value::Null);

    // Issue #192：自定义导出路径。
    let custom_output_dir = PathManager::sanitize_path(
        options
            .get("outputDir")
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    let output_dir = if custom_output_dir.trim().is_empty() {
        state.path_manager.exports_dir()
    } else {
        PathBuf::from(&custom_output_dir)
    };

    // 会话名：优先用户输入（issue #365）。
    let user_session_name = body
        .get("sessionName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let session_name = match user_session_name {
        Some(name) => name.to_string(),
        None => resolve_session_name(chat_type, &peer_uid, &state.napcat).await,
    };

    let (date_str, time_str) = local_date_time_strings();
    Ok(ExportRequest {
        chat_type,
        peer_uid,
        peer_identity,
        peer_uin,
        use_name_in_file_name: options.get("useNameInFileName").and_then(Value::as_bool)
            == Some(true),
        use_friendly_file_name: options.get("useFriendlyFileName").and_then(Value::as_bool)
            == Some(true),
        filter,
        options,
        session_name,
        custom_output_dir,
        output_dir,
        date_str,
        time_str,
    })
}

/// 创建任务记录、入表并持久化。
async fn register_task(state: &SharedState, task: &Value) {
    let task_id = task
        .get("taskId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    {
        let mut tasks = state.export_tasks.lock().await;
        tasks.insert(task_id, task.clone());
    }
    if let Err(error) = state.db.save_task(task, task, true).await {
        tracing::warn!("[ApiServer] 保存新任务到数据库失败: {error}");
    }
}

/// `POST /api/messages/export` — 创建异步导出任务。
pub async fn export_messages(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let req = match prepare_export_request(&state, &body).await {
        Ok(req) => req,
        Err(err) => return response::error(&err, &request_id),
    };
    let format = body
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("JSON")
        .to_uppercase();
    let file_ext = match format.as_str() {
        "TXT" => "txt",
        "HTML" => "html",
        "EXCEL" => "xlsx",
        _ => "json",
    };

    let task_id = generate_task_id("export");
    let prefix = chat_type_prefix(Some(req.chat_type));
    let base_file_name = build_export_file_name(
        prefix,
        &req.peer_identity,
        &req.session_name,
        &req.date_str,
        &req.time_str,
        file_ext,
        req.use_name_in_file_name,
        req.use_friendly_file_name,
    );
    let file_name = reserve_export_file_name(&req.output_dir, &base_file_name);
    let file_path = req.output_dir.join(&file_name);
    let download_url = generate_download_url(
        &file_path,
        &file_name,
        &req.custom_output_dir,
        "/downloads/",
    );

    let task = json!({
        "taskId": task_id,
        "peer": { "chatType": req.chat_type, "peerUid": req.peer_uid },
        "sessionName": req.session_name,
        "fileName": file_name,
        "downloadUrl": download_url,
        "messageCount": 0,
        "status": "running",
        "progress": 0,
        "createdAt": now_iso(),
        "format": format,
        "filter": req.filter,
        "options": req.options,
    });
    register_task(&state, &task).await;

    let reply = json!({
        "taskId": task_id,
        "sessionName": req.session_name,
        "fileName": file_name,
        "downloadUrl": download_url,
        "filePath": file_path.to_string_lossy(),
        "messageCount": 0,
        "status": "running",
        "startTime": req.filter.get("startTime").cloned().unwrap_or(Value::Null),
        "endTime": req.filter.get("endTime").cloned().unwrap_or(Value::Null),
    });

    let state_bg = Arc::clone(&state);
    tokio::spawn(async move {
        run_export_task(
            state_bg,
            task_id,
            req,
            format,
            file_name,
            ExportMode::Standard,
        )
        .await;
    });

    response::success(reply, &request_id)
}

/// `POST /api/messages/export-streaming-zip` — 流式 ZIP 导出（防 OOM）。
pub async fn export_streaming_zip(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let req = match prepare_export_request(&state, &body).await {
        Ok(req) => req,
        Err(err) => return response::error(&err, &request_id),
    };

    let task_id = generate_task_id("streaming_zip");
    let prefix = chat_type_prefix(Some(req.chat_type));
    let file_name = build_export_file_name(
        prefix,
        &req.peer_identity,
        &req.session_name,
        &req.date_str,
        &req.time_str,
        "zip",
        req.use_name_in_file_name,
        req.use_friendly_file_name,
    );
    let base_file_name = if let Some(stripped) = file_name.strip_suffix(".zip") {
        format!("{stripped}_streaming.zip")
    } else {
        file_name
    };
    let file_name = reserve_export_file_name(&req.output_dir, &base_file_name);
    let file_path = req.output_dir.join(&file_name);
    let download_url = generate_download_url(
        &file_path,
        &file_name,
        &req.custom_output_dir,
        "/downloads/",
    );

    let mut options = req.options.clone();
    if let Some(obj) = options.as_object_mut() {
        obj.insert("streamingMode".to_string(), Value::Bool(true));
    }
    let task = json!({
        "taskId": task_id,
        "peer": { "chatType": req.chat_type, "peerUid": req.peer_uid },
        "sessionName": req.session_name,
        "fileName": file_name,
        "downloadUrl": download_url,
        "messageCount": 0,
        "status": "running",
        "progress": 0,
        "createdAt": now_iso(),
        "format": "STREAMING_ZIP",
        "filter": req.filter,
        "options": options,
    });
    register_task(&state, &task).await;

    let reply = json!({
        "taskId": task_id,
        "sessionName": req.session_name,
        "fileName": file_name,
        "downloadUrl": download_url,
        "filePath": file_path.to_string_lossy(),
        "messageCount": 0,
        "status": "running",
        "startTime": req.filter.get("startTime").cloned().unwrap_or(Value::Null),
        "endTime": req.filter.get("endTime").cloned().unwrap_or(Value::Null),
        "streamingMode": true,
    });

    let state_bg = Arc::clone(&state);
    tokio::spawn(async move {
        run_export_task(
            state_bg,
            task_id,
            req,
            "STREAMING_ZIP".to_string(),
            file_name,
            ExportMode::StreamingZip,
        )
        .await;
    });

    response::success(reply, &request_id)
}

/// `POST /api/messages/export-streaming-jsonl` — 流式 JSONL 导出（防 OOM）。
pub async fn export_streaming_jsonl(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let req = match prepare_export_request(&state, &body).await {
        Ok(req) => req,
        Err(err) => return response::error(&err, &request_id),
    };

    let task_id = generate_task_id("streaming_jsonl");
    let prefix = chat_type_prefix(Some(req.chat_type));
    let dir_name = build_export_dir_name(
        prefix,
        &req.peer_identity,
        &req.session_name,
        &req.date_str,
        &req.time_str,
        "_chunked_jsonl",
        req.use_name_in_file_name,
        req.use_friendly_file_name,
    );
    let dir_name = reserve_export_file_name(&req.output_dir, &dir_name);
    let dir_path = req.output_dir.join(&dir_name);
    // JSONL 导出是目录，不支持直接下载。
    let download_url = if req.custom_output_dir.trim().is_empty() {
        format!("/downloads/{dir_name}")
    } else {
        dir_path.to_string_lossy().to_string()
    };

    let mut options = req.options.clone();
    if let Some(obj) = options.as_object_mut() {
        obj.insert("streamingMode".to_string(), Value::Bool(true));
    }
    let task = json!({
        "taskId": task_id,
        "peer": { "chatType": req.chat_type, "peerUid": req.peer_uid },
        "sessionName": req.session_name,
        "fileName": dir_name,
        "downloadUrl": download_url,
        "messageCount": 0,
        "status": "running",
        "progress": 0,
        "createdAt": now_iso(),
        "format": "STREAMING_JSONL",
        "filter": req.filter,
        "options": options,
    });
    register_task(&state, &task).await;

    let reply = json!({
        "taskId": task_id,
        "sessionName": req.session_name,
        "fileName": dir_name,
        "downloadUrl": download_url,
        "filePath": dir_path.to_string_lossy(),
        "messageCount": 0,
        "status": "running",
        "startTime": req.filter.get("startTime").cloned().unwrap_or(Value::Null),
        "endTime": req.filter.get("endTime").cloned().unwrap_or(Value::Null),
        "streamingMode": true,
    });

    let state_bg = Arc::clone(&state);
    tokio::spawn(async move {
        run_export_task(
            state_bg,
            task_id,
            req,
            "STREAMING_JSONL".to_string(),
            dir_name,
            ExportMode::StreamingJsonl,
        )
        .await;
    });

    response::success(reply, &request_id)
}

/// 导出模式。
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportMode {
    /// 普通导出（TXT / JSON / HTML / EXCEL）。
    Standard,
    /// 流式 ZIP（chunked HTML + ZIP）。
    StreamingZip,
    /// 流式 JSONL（manifest + chunks/*.jsonl）。
    StreamingJsonl,
}

/// 后台导出主流程包装：负责取消 / 失败态与清理（对应 TS `processExportTaskAsync`）。
async fn run_export_task(
    state: SharedState,
    task_id: String,
    req: ExportRequest,
    format: String,
    file_name: String,
    mode: ExportMode,
) {
    // issue #446：注册取消 flag，使「停止任务」接口能打断本任务。
    let cancelled_before_registration = {
        let cancelled = state.cancelled_task_ids.lock().await;
        cancelled.contains(&task_id)
    };
    let cancel_flag = Arc::new(AtomicBool::new(cancelled_before_registration));
    {
        let mut flags = state.running_export_cancel_flags.lock().await;
        flags.insert(task_id.clone(), Arc::clone(&cancel_flag));
    }

    let result = if cancelled_before_registration {
        Err("任务已被用户停止".to_string())
    } else {
        process_export_task(
            &state,
            &task_id,
            &req,
            &format,
            &file_name,
            mode,
            &cancel_flag,
        )
        .await
    };
    release_export_path(&req.output_dir.join(&file_name));

    if let Err(error) = result {
        let was_cancelled = {
            let cancelled = state.cancelled_task_ids.lock().await;
            cancelled.contains(&task_id) || cancel_flag.load(Ordering::SeqCst)
        };
        if was_cancelled {
            tracing::info!("[ApiServer] 导出任务已被用户停止: {task_id}");
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "cancelled",
                    "message": "任务已停止",
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_progress",
                "data": { "taskId": task_id, "status": "cancelled", "message": "任务已停止" },
            }));
        } else {
            tracing::error!("[ApiServer] 导出任务失败: {task_id} — {error}");
            update_task(
                &state,
                &task_id,
                json!({
                    "status": "failed",
                    "error": error,
                    "completedAt": now_iso(),
                }),
            )
            .await;
            state.broadcast_ws(&json!({
                "type": "export_error",
                "data": { "taskId": task_id, "status": "failed", "error": error },
            }));
        }
    }

    // issue #446：清理停止任务的跟踪状态。
    {
        let mut flags = state.running_export_cancel_flags.lock().await;
        flags.remove(&task_id);
    }
    {
        let mut cancelled = state.cancelled_task_ids.lock().await;
        cancelled.remove(&task_id);
    }
}

/// 检查任务是否已被用户停止。
async fn is_cancelled(state: &SharedState, task_id: &str, cancel_flag: &AtomicBool) -> bool {
    if cancel_flag.load(Ordering::SeqCst) {
        return true;
    }
    let cancelled = state.cancelled_task_ids.lock().await;
    cancelled.contains(task_id)
}

async fn wait_for_atomic_cancellation(cancel_flag: &AtomicBool) {
    while !cancel_flag.load(Ordering::SeqCst) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// issue #331：拉取群成员「群头衔」，构造 (uid|uin) → title 映射。
async fn fetch_group_member_title_map(
    state: &SharedState,
    peer_uid: &str,
    chat_type: i64,
) -> Option<HashMap<String, String>> {
    if chat_type != GROUP_CHAT_TYPE {
        return None;
    }
    let mut title_map: HashMap<String, String> = HashMap::new();
    if let Ok(group_members) = state.napcat.get_group_member_all(peer_uid, false).await {
        if let Some(infos) = group_members
            .pointer("/result/infos")
            .or_else(|| group_members.get("infos"))
            .and_then(Value::as_object)
        {
            for (uid, member) in infos {
                let title = ["memberSpecialTitle", "specialTitle", "title"]
                    .iter()
                    .find_map(|key| member.get(*key).and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|t| !t.is_empty());
                let Some(title) = title else { continue };
                if !uid.is_empty() {
                    title_map.insert(uid.clone(), title.to_string());
                }
                if let Some(uin) = member.get("uin").and_then(Value::as_str) {
                    if !uin.is_empty() {
                        title_map.insert(uin.to_string(), title.to_string());
                    }
                }
            }
        }
    }
    // 兜底：WebApi.getGroupMembers 的 .title 字段比较稳。
    if title_map.is_empty() {
        if let Ok(web_members) = state
            .napcat
            .call("WebApi.getGroupMembers", json!([peer_uid]))
            .await
        {
            if let Some(list) = web_members.as_array() {
                for member in list {
                    let title = member
                        .get("title")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|t| !t.is_empty());
                    let Some(title) = title else { continue };
                    let uin = match member.get("uin") {
                        Some(Value::String(s)) => s.clone(),
                        Some(Value::Number(n)) => n.to_string(),
                        _ => continue,
                    };
                    if !uin.is_empty() {
                        title_map.insert(uin, title.to_string());
                    }
                }
            }
        }
    }
    if title_map.is_empty() {
        None
    } else {
        Some(title_map)
    }
}

/// 补全群消息的群昵称（sendMemberName）。
async fn fill_group_member_names(state: &SharedState, peer_uid: &str, messages: &mut [Value]) {
    let Ok(group_members) = state.napcat.get_group_member_all(peer_uid, false).await else {
        return;
    };
    let Some(infos) = group_members
        .pointer("/result/infos")
        .or_else(|| group_members.get("infos"))
        .and_then(Value::as_object)
    else {
        return;
    };
    for message in messages.iter_mut() {
        let needs_fill = message
            .get("sendMemberName")
            .and_then(Value::as_str)
            .is_none_or(|s| s.trim().is_empty());
        if !needs_fill {
            continue;
        }
        let Some(sender_uid) = message.get("senderUid").and_then(Value::as_str) else {
            continue;
        };
        if let Some(card_name) = infos
            .get(sender_uid)
            .and_then(|m| m.get("cardName"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            if let Some(obj) = message.as_object_mut() {
                obj.insert(
                    "sendMemberName".to_string(),
                    Value::String(card_name.to_string()),
                );
            }
        }
    }
}

/// 把 ResourceHandler 的资源映射转成导出器的 `resource_map`。
fn to_exporter_resource_map(
    resource_map: &HashMap<String, Vec<ResourceInfo>>,
) -> HashMap<String, Vec<MessageResource>> {
    resource_map
        .iter()
        .map(|(msg_id, resources)| {
            let converted = resources
                .iter()
                .map(|r| MessageResource {
                    resource_type: r.resource_type.clone(),
                    filename: r.file_name.clone(),
                    size: r.file_size.and_then(|s| u64::try_from(s).ok()),
                    url: if r.original_url.is_empty() {
                        None
                    } else {
                        Some(r.original_url.clone())
                    },
                    local_path: r.local_path.clone(),
                    width: None,
                    height: None,
                    duration: None,
                })
                .collect();
            (msg_id.clone(), converted)
        })
        .collect()
}

/// 把资源映射序列化成 `update_single_message_resource_paths` 需要的 Value 列表。
fn to_value_resource_map(
    resource_map: &HashMap<String, Vec<ResourceInfo>>,
) -> HashMap<String, Vec<Value>> {
    resource_map
        .iter()
        .map(|(msg_id, resources)| {
            let values = resources
                .iter()
                .filter_map(|r| serde_json::to_value(r).ok())
                .collect();
            (msg_id.clone(), values)
        })
        .collect()
}

/// ZIP 打包（阻塞线程执行）：HTML 文件 + resources 相对路径列表。
async fn create_zip_with_resources(
    base_dir: PathBuf,
    main_file: PathBuf,
    resource_rel_paths: Vec<String>,
    zip_path: PathBuf,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write as _;
        let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let main_name = main_file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| "无效的主文件名".to_string())?;
        zip.start_file(&main_name, options)
            .map_err(|e| e.to_string())?;
        let data = std::fs::read(&main_file).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
        for rel in resource_rel_paths {
            let src = base_dir.join(&rel);
            let Ok(data) = std::fs::read(&src) else {
                continue;
            };
            let entry_name = rel.replace('\\', "/");
            if zip.start_file(&entry_name, options).is_err() {
                continue;
            }
            let _ = zip.write_all(&data);
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ZIP 打包整个目录（阻塞线程执行）。
async fn create_zip_from_dir(dir: PathBuf, zip_path: PathBuf) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write as _;
        let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for entry in walkdir::WalkDir::new(&dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let rel = entry.path().strip_prefix(&dir).map_err(|e| e.to_string())?;
            zip.start_file(rel.to_string_lossy().replace('\\', "/"), options)
                .map_err(|e| e.to_string())?;
            let data = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 导出主流程（对应 TS `processExportTaskAsync` / 流式变体）。
#[allow(clippy::too_many_lines)]
async fn process_export_task(
    state: &SharedState,
    task_id: &str,
    req: &ExportRequest,
    format: &str,
    file_name: &str,
    mode: ExportMode,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    if is_cancelled(state, task_id, cancel_flag).await {
        return Err("任务已被用户停止".to_string());
    }
    update_task(
        state,
        task_id,
        json!({ "status": "running", "progress": 0, "message": "开始获取消息..." }),
    )
    .await;
    broadcast_progress(state, task_id, 0, "开始获取消息...", 0);

    // ============ 阶段 1：抓取消息（0 → 50） ============
    let batch_size = loose_i64(req.options.get("batchSize")).unwrap_or(5000);
    let fetcher = BatchMessageFetcher::new(
        Arc::new(state.napcat.clone()),
        BatchFetchConfig {
            batch_size,
            timeout_ms: 120_000,
            retry_count: 3,
            ..BatchFetchConfig::default()
        },
    );
    let peer = Peer {
        chat_type: req.chat_type,
        peer_uid: req.peer_uid.clone(),
        guild_id: None,
    };
    let start_time_ms = normalize_to_ms(loose_i64(req.filter.get("startTime")).unwrap_or(0));
    let end_time_ms = normalize_to_ms(loose_i64(req.filter.get("endTime")).unwrap_or_else(now_ms));
    let fetch_filter = MessageFilter {
        start_time: Some(start_time_ms),
        end_time: Some(end_time_ms),
        ..MessageFilter::default()
    };

    let mut all_messages: Vec<Value> = Vec::new();
    let mut previous = None;
    let mut batch_count: i64 = 0;
    loop {
        if is_cancelled(state, task_id, cancel_flag).await {
            fetcher.cancel();
            return Err("任务已被用户停止".to_string());
        }
        let fetch_result = tokio::select! {
            result = fetcher.fetch_next_batch(&peer, &fetch_filter, previous.as_ref()) => Some(result),
            () = wait_for_atomic_cancellation(cancel_flag) => None,
        };
        let Some(fetch_result) = fetch_result else {
            fetcher.cancel();
            return Err("任务已被用户停止".to_string());
        };
        let mut batch = match fetch_result {
            Ok(Some(batch)) => batch,
            Ok(None) => break,
            Err(error) => return Err(format!("获取消息失败: {error}")),
        };
        batch_count += 1;
        all_messages.append(&mut batch.messages);

        let progress = (batch_count * 10).min(50);
        let message = format!("已获取 {} 条消息...", all_messages.len());
        update_task(
            state,
            task_id,
            json!({ "progress": progress, "messageCount": all_messages.len(), "message": message }),
        )
        .await;
        broadcast_progress(state, task_id, progress, &message, all_messages.len());
        previous = Some(batch);
    }

    if is_cancelled(state, task_id, cancel_flag).await {
        return Err("任务已被用户停止".to_string());
    }

    // ============ 群昵称补全 + 群头衔映射（issue #331） ============
    let mut title_map: Option<HashMap<String, String>> = None;
    if req.chat_type == GROUP_CHAT_TYPE && !all_messages.is_empty() {
        fill_group_member_names(state, &req.peer_uid, &mut all_messages).await;
        let show_group_member_titles = req
            .options
            .get("showGroupMemberTitles")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if show_group_member_titles {
            title_map = fetch_group_member_title_map(state, &req.peer_uid, req.chat_type).await;
        }
    }

    // 按 includeUserUins / excludeUserUins 过滤（issue #369）。
    let mut filtered_messages = apply_sender_filter(all_messages, &req.filter);

    update_task(
        state,
        task_id,
        json!({ "progress": 60, "message": "正在解析消息...", "messageCount": filtered_messages.len() }),
    )
    .await;
    broadcast_progress(
        state,
        task_id,
        60,
        "正在解析消息...",
        filtered_messages.len(),
    );

    filtered_messages.sort_by_key(msg_time_ms);

    let sender_title_resolver = title_map.map(|map| {
        let map = Arc::new(map);
        Arc::new(move |uid: Option<&str>, uin: Option<&str>| {
            uid.and_then(|u| map.get(u).cloned())
                .or_else(|| uin.and_then(|u| map.get(u).cloned()))
        }) as crate::parser::simple_parser::SenderTitleResolver
    });
    let mut parser = SimpleMessageParser::new(SimpleParserOptions {
        html_enabled: format == "HTML" || mode != ExportMode::Standard,
        prefer_group_member_name: req
            .options
            .get("preferGroupMemberName")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        sender_title_resolver,
        forward_fetcher: Some(Arc::new(state.napcat.clone()) as Arc<dyn ForwardFetcher>),
    });
    let mut clean_messages: Vec<CleanMessage> = parser.parse_messages(&filtered_messages).await;
    let mut resource_messages = filtered_messages.clone();
    resource_messages.extend(parser.take_forward_raw_messages());
    let mut resource_message_ids = HashSet::new();
    resource_messages.retain(|message| {
        let Some(message_id) = message.get("msgId").and_then(Value::as_str) else {
            return true;
        };
        message_id == "0" || resource_message_ids.insert(message_id.to_string())
    });

    // ============ 阶段 2：资源下载（70 → 85） ============
    let filter_pure_image = req
        .options
        .get("filterPureImageMessages")
        .and_then(Value::as_bool)
        == Some(true);
    let mut resource_map: HashMap<String, Vec<ResourceInfo>> = HashMap::new();
    let mut resource_summary: Option<ResourceBatchSummary> = None;
    if filter_pure_image {
        tracing::info!("[ApiServer] 已启用纯多媒体消息过滤，跳过资源下载");
    } else {
        update_task(
            state,
            task_id,
            json!({ "progress": 70, "message": "正在下载资源...", "messageCount": filtered_messages.len() }),
        )
        .await;
        broadcast_progress(
            state,
            task_id,
            70,
            "正在下载资源...",
            filtered_messages.len(),
        );

        // 资源下载进度回调（70 → 85）。
        let state_cb = Arc::clone(state);
        let task_id_cb = task_id.to_string();
        let count_cb = filtered_messages.len();
        state
            .resource_handler
            .set_progress_callback(Some(Arc::new(move |progress| {
                let percent = 70
                    + ((progress.completed as f64 / progress.total.max(1) as f64) * 15.0).round()
                        as i64;
                broadcast_progress(&state_cb, &task_id_cb, percent, &progress.message, count_cb);
            })))
            .await;

        // Issue #341：跳过下载的资源类型（仅保留元数据）。
        let requested_skip_types: Vec<String> = req
            .options
            .get("skipDownloadResourceTypes")
            .and_then(Value::as_array)
            .map_or_else(
                || {
                    if req.options.get("skipFileDownload").and_then(Value::as_bool) == Some(true) {
                        vec!["file".to_string()]
                    } else {
                        Vec::new()
                    }
                },
                |arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_lowercase)
                        .collect()
                },
            );
        let normalized_skip_types: Vec<String> = requested_skip_types
            .into_iter()
            .filter(|t| matches!(t.as_str(), "image" | "video" | "audio" | "file"))
            .collect();
        if normalized_skip_types.is_empty() {
            state.resource_handler.set_skip_download_types(None).await;
        } else {
            tracing::info!(
                "[ApiServer] 跳过下载的资源类型: {}",
                normalized_skip_types.join(", ")
            );
            state
                .resource_handler
                .set_skip_download_types(Some(&normalized_skip_types))
                .await;
        }

        resource_map = state
            .resource_handler
            .process_message_resources_with_cancel(&resource_messages, Arc::clone(cancel_flag))
            .await;
        let summary = state.resource_handler.last_batch_summary().await;
        state.resource_handler.set_progress_callback(None).await;
        state.resource_handler.set_skip_download_types(None).await;
        tracing::info!(
            "[ApiServer] 处理了 {} 个消息的资源（attempted={}, downloaded={}, alreadyAvailable={}, failed={}, skipped={}）",
            resource_map.len(),
            summary.attempted,
            summary.downloaded,
            summary.already_available,
            summary.failed,
            summary.skipped,
        );
        resource_summary = Some(summary);
    }

    if is_cancelled(state, task_id, cancel_flag).await {
        return Err("任务已被用户停止".to_string());
    }

    // ============ 阶段 3：解析 + 生成文件（85 →） ============
    update_task(
        state,
        task_id,
        json!({ "progress": 85, "message": "正在生成文件...", "messageCount": filtered_messages.len() }),
    )
    .await;
    broadcast_progress(
        state,
        task_id,
        85,
        "正在生成文件...",
        filtered_messages.len(),
    );

    // Issue #30 / #192：确保输出目录存在。
    tokio::fs::create_dir_all(&req.output_dir)
        .await
        .map_err(|e| format!("创建输出目录失败: {e}"))?;
    let file_path = req.output_dir.join(file_name);

    // issue #277：把已下载资源的本地路径写回消息。
    let value_resource_map = to_value_resource_map(&resource_map);
    for message in &mut clean_messages {
        SimpleMessageParser::update_message_resource_paths_recursive(message, &value_resource_map);
    }
    SimpleMessageParser::backfill_reply_preview_local_paths(&mut clean_messages);

    let message_count = clean_messages.len();
    let self_info = state.napcat.self_info().await.unwrap_or(Value::Null);
    let self_uid = self_info
        .get("uid")
        .and_then(Value::as_str)
        .map(str::to_string);
    let self_uin = self_info
        .get("uin")
        .and_then(Value::as_str)
        .map(str::to_string);
    let peer_uin = if req.chat_type == GROUP_CHAT_TYPE {
        None
    } else {
        req.peer_uin
            .clone()
            .or_else(|| resolve_peer_uin(&req.peer_uid, self_uin.as_deref(), &clean_messages))
    };
    let normalized_chat_type = classify_chat_type_binary(Some(req.chat_type)).to_string();
    let chat_info = ChatInfo {
        name: req.session_name.clone(),
        chat_type: normalized_chat_type.clone(),
        avatar: chat_avatar_url(&normalized_chat_type, &req.peer_uid, peer_uin.as_deref()),
        participant_count: None,
        self_uid,
        self_uin,
        self_name: self_info
            .get("nick")
            .and_then(Value::as_str)
            .map(str::to_string),
        peer_uid: Some(req.peer_uid.clone()),
        peer_uin,
    };

    let export_options = ExportOptions {
        output_path: file_path.clone(),
        include_resource_links: req
            .options
            .get("includeResourceLinks")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        include_system_messages: req
            .options
            .get("includeSystemMessages")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        filter_pure_image_messages: filter_pure_image,
        pretty_format: req
            .options
            .get("prettyFormat")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        prefer_group_member_name: req
            .options
            .get("preferGroupMemberName")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        resource_map: to_exporter_resource_map(&resource_map),
        ..ExportOptions::default()
    };

    let mut final_file_path = file_path.clone();
    let mut final_file_name = file_name.to_string();
    let mut is_zip_export = false;
    let mut original_file_path: Option<PathBuf> = None;

    match mode {
        ExportMode::Standard => {
            let mut copied_resource_paths: Vec<String> = Vec::new();
            match format {
                "TXT" => {
                    let exporter = TextExporter::new(export_options, TextFormatOptions::default());
                    exporter
                        .export(clean_messages, &chat_info)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                "JSON" => {
                    let json_options = JsonFormatOptions {
                        embed_avatars_as_base64: req
                            .options
                            .get("embedAvatarsAsBase64")
                            .and_then(Value::as_bool)
                            == Some(true),
                        ..JsonFormatOptions::default()
                    };
                    broadcast_progress(state, task_id, 90, "正在写入JSON文件...", message_count);
                    let exporter = JsonExporter::new(export_options, json_options);
                    exporter
                        .export(clean_messages, &chat_info)
                        .await
                        .map_err(|e| e.to_string())?;
                    broadcast_progress(state, task_id, 95, "JSON文件写入完成", message_count);
                }
                "EXCEL" => {
                    let exporter =
                        ExcelExporter::new(export_options, ExcelFormatOptions::default());
                    exporter
                        .export(clean_messages, &chat_info)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                "HTML" => {
                    let mut html_exporter = ModernHtmlExporter::new(HtmlExportOptions {
                        output_path: file_path.clone(),
                        include_resource_links: export_options.include_resource_links,
                        include_system_messages: export_options.include_system_messages,
                        // Issue #311：自包含 HTML（资源以 base64 内联）。
                        embed_resources_as_data_uri: req
                            .options
                            .get("embedResourcesAsDataUri")
                            .and_then(Value::as_bool)
                            == Some(true),
                        max_embed_file_size_bytes: loose_i64(
                            req.options.get("maxEmbedFileSizeBytes"),
                        )
                        .and_then(|v| u64::try_from(v).ok())
                        .unwrap_or(50 * 1024 * 1024),
                        // Issue #467：打印 / PDF 友好开关，默认开启。
                        show_search_bar: req.options.get("showSearchBar").and_then(Value::as_bool)
                            != Some(false),
                        enable_virtual_scroll: req
                            .options
                            .get("enableVirtualScroll")
                            .and_then(Value::as_bool)
                            != Some(false),
                        exporter_version: Some(crate::version::VERSION.get().to_string()),
                    });
                    copied_resource_paths = html_exporter
                        .export_single_inline(&clean_messages, &chat_info)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                _ => return Err("不支持的导出格式".to_string()),
            }

            // HTML + exportAsZip（95 → 打包）。
            if format == "HTML"
                && req.options.get("exportAsZip").and_then(Value::as_bool) == Some(true)
            {
                update_task(
                    state,
                    task_id,
                    json!({ "progress": 95, "message": "正在打包ZIP文件..." }),
                )
                .await;
                broadcast_progress(state, task_id, 95, "正在打包ZIP文件...", message_count);

                let base_zip_file_name = if let Some(stripped) = file_name
                    .strip_suffix(".html")
                    .or_else(|| file_name.strip_suffix(".HTML"))
                {
                    format!("{stripped}.zip")
                } else {
                    format!("{file_name}.zip")
                };
                let zip_file_name = reserve_export_file_name(&req.output_dir, &base_zip_file_name);
                let zip_file_path = req.output_dir.join(&zip_file_name);
                let zip_result = create_zip_with_resources(
                    req.output_dir.clone(),
                    file_path.clone(),
                    copied_resource_paths,
                    zip_file_path.clone(),
                )
                .await;
                release_export_path(&zip_file_path);
                match zip_result {
                    Ok(()) => {
                        original_file_path = Some(file_path.clone());
                        final_file_path = zip_file_path;
                        final_file_name = zip_file_name;
                        is_zip_export = true;
                    }
                    Err(error) => {
                        tracing::error!("[ApiServer] 创建ZIP压缩包失败: {error}");
                        tracing::warn!("[ApiServer] 将使用原始HTML文件作为导出结果");
                    }
                }
            }
        }
        ExportMode::StreamingZip => {
            // chunked HTML 导出到临时目录，再整体打包成 ZIP。
            let temp_dir_name = format!(".{}", file_name.trim_end_matches(".zip"));
            let temp_dir = req.output_dir.join(&temp_dir_name);
            tokio::fs::create_dir_all(&temp_dir)
                .await
                .map_err(|e| format!("创建临时目录失败: {e}"))?;

            let mut html_exporter = ModernHtmlExporter::new(HtmlExportOptions {
                output_path: temp_dir.join("index.html"),
                include_resource_links: export_options.include_resource_links,
                include_system_messages: export_options.include_system_messages,
                exporter_version: Some(crate::version::VERSION.get().to_string()),
                ..HtmlExportOptions::default()
            });
            html_exporter
                .export_chunked(
                    &clean_messages,
                    &chat_info,
                    &ChunkedHtmlExportOptions::default(),
                )
                .await
                .map_err(|e| e.to_string())?;

            update_task(
                state,
                task_id,
                json!({ "progress": 95, "message": "正在打包ZIP文件..." }),
            )
            .await;
            broadcast_progress(state, task_id, 95, "正在打包ZIP文件...", message_count);
            create_zip_from_dir(temp_dir.clone(), file_path.clone()).await?;
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        }
        ExportMode::StreamingJsonl => {
            // manifest + chunks/*.jsonl 目录导出。
            let json_options = JsonFormatOptions {
                export_mode: JsonExportMode::ChunkedJsonl,
                chunked_jsonl: ChunkedJsonlExportOptions {
                    output_dir: Some(file_path.clone()),
                    ..ChunkedJsonlExportOptions::default()
                },
                ..JsonFormatOptions::default()
            };
            let mut export_options = export_options;
            export_options.output_path = file_path.join("export.json");
            let exporter = JsonExporter::new(export_options, json_options);
            exporter
                .export_chunked_jsonl(
                    clean_messages,
                    &chat_info,
                    ChunkedJsonlExportOptions {
                        output_dir: Some(file_path.clone()),
                        ..ChunkedJsonlExportOptions::default()
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // ============ 完成（100） ============
    if is_cancelled(state, task_id, cancel_flag).await {
        return Err("任务已被用户停止".to_string());
    }
    let file_size = dir_or_file_size(&final_file_path).await;
    let resource_summary_value = resource_summary
        .as_ref()
        .and_then(|s| serde_json::to_value(s).ok());
    let summary_message = build_resource_summary_message(resource_summary.as_ref());
    let completion_message =
        summary_message.map_or_else(|| "导出完成".to_string(), |s| format!("导出完成 · {s}"));

    update_task(
        state,
        task_id,
        json!({
            "status": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "filePath": final_file_path.to_string_lossy(),
            "fileSize": file_size,
            "completedAt": now_iso(),
            "fileName": final_file_name,
            "isZipExport": is_zip_export,
            "originalFilePath": original_file_path
                .as_ref()
                .map_or(Value::Null, |p| Value::String(p.to_string_lossy().to_string())),
            "resourceSummary": resource_summary_value.clone().unwrap_or(Value::Null),
        }),
    )
    .await;

    // Issue #192：根据是否使用自定义路径生成正确的下载 URL。
    let final_download_url = generate_download_url(
        &final_file_path,
        &final_file_name,
        &req.custom_output_dir,
        if is_zip_export {
            "/download?file="
        } else {
            "/downloads/"
        },
    );
    state.broadcast_ws(&json!({
        "type": "export_complete",
        "data": {
            "taskId": task_id,
            "status": "completed",
            "progress": 100,
            "message": completion_message,
            "messageCount": message_count,
            "fileName": final_file_name,
            "filePath": final_file_path.to_string_lossy(),
            "fileSize": file_size,
            "downloadUrl": final_download_url,
            "isZipExport": is_zip_export,
            "originalFilePath": original_file_path
                .as_ref()
                .map_or(Value::Null, |p| Value::String(p.to_string_lossy().to_string())),
            "resourceSummary": resource_summary_value.unwrap_or(Value::Null),
        },
    }));

    // 立即刷新数据库，确保任务状态持久化。
    if let Err(error) = state.db.flush_write_queue().await {
        tracing::warn!("[ApiServer] 刷新数据库写队列失败: {error}");
    }
    // 清除资源缓存，确保新下载的资源能被访问。
    {
        let mut cache = state.resource_file_cache.lock().await;
        cache.clear();
    }
    Ok(())
}

/// 文件大小；目录时递归求和。
async fn dir_or_file_size(path: &FsPath) -> u64 {
    match tokio::fs::metadata(path).await {
        Ok(meta) if meta.is_file() => meta.len(),
        Ok(meta) if meta.is_dir() => {
            let dir = path.to_path_buf();
            tokio::task::spawn_blocking(move || {
                walkdir::WalkDir::new(&dir)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_file())
                    .filter_map(|e| e.metadata().ok())
                    .map(|m| m.len())
                    .sum()
            })
            .await
            .unwrap_or(0)
        }
        _ => 0,
    }
}

#[cfg(test)]
mod file_name_tests {
    use super::{
        build_export_dir_name, build_export_file_name, release_export_path,
        reserve_export_file_name, sanitize_chat_name, should_apply_task_patch,
    };
    use serde_json::json;

    #[test]
    fn cancelled_task_rejects_late_non_cancelled_updates() {
        let task = json!({ "status": "cancelled", "progress": 42 });
        assert!(!should_apply_task_patch(
            &task,
            &json!({ "status": "running", "progress": 60 })
        ));
        assert!(!should_apply_task_patch(
            &task,
            &json!({ "status": "completed", "progress": 100 })
        ));
        assert!(should_apply_task_patch(
            &task,
            &json!({ "status": "cancelled", "message": "任务已停止" })
        ));
    }

    #[test]
    fn sanitizes_windows_unsafe_and_reserved_components() {
        assert_eq!(
            sanitize_chat_name(" AxT<>:\"/\\|?* 鸽子窝. ", 64),
            "AxT_鸽子窝"
        );
        assert_eq!(sanitize_chat_name("CON.", 64), "_CON");
        assert_eq!(sanitize_chat_name("Lpt9", 64), "_Lpt9");
        assert_eq!(sanitize_chat_name("你好世界", 3), "你好世");
    }

    #[test]
    fn builds_readable_friend_group_and_streaming_names() {
        assert_eq!(
            build_export_file_name(
                "friend",
                "1687657986",
                "笨蛋Darf v2",
                "20260712",
                "163632123",
                "html",
                false,
                false,
            ),
            "friend_笨蛋Darf_v2_1687657986_20260712_163632123.html"
        );
        assert_eq!(
            build_export_dir_name(
                "group",
                "960420904",
                "AxT 鸽子窝",
                "20260712",
                "163632123",
                "_chunked_jsonl",
                false,
                false,
            ),
            "group_AxT_鸽子窝_960420904_20260712_163632123_chunked_jsonl"
        );
    }

    #[test]
    fn disambiguates_existing_files_and_directories_without_overwriting() {
        let base =
            std::env::temp_dir().join(format!("qce-export-name-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("friend_name_1_20260712_163632123.html"), b"old").unwrap();
        let file_collision =
            reserve_export_file_name(&base, "friend_name_1_20260712_163632123.html");
        assert_eq!(file_collision, "friend_name_1_20260712_163632123_2.html");
        release_export_path(&base.join(file_collision));

        std::fs::create_dir(base.join("group_name_2_20260712_163632123_chunked_jsonl")).unwrap();
        let dir_collision =
            reserve_export_file_name(&base, "group_name_2_20260712_163632123_chunked_jsonl");
        assert_eq!(
            dir_collision,
            "group_name_2_20260712_163632123_chunked_jsonl_2"
        );
        release_export_path(&base.join(dir_collision));
        let concurrent =
            reserve_export_file_name(&base, "friend_concurrent_1_20260712_163632123.html");
        let concurrent_2 =
            reserve_export_file_name(&base, "friend_concurrent_1_20260712_163632123.html");
        assert_eq!(
            concurrent_2,
            "friend_concurrent_1_20260712_163632123_2.html"
        );
        release_export_path(&base.join(concurrent));
        release_export_path(&base.join(concurrent_2));
        std::fs::remove_dir_all(base).unwrap();
    }
}
