use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};

use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use md5::{Digest, Md5};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};

use qce_exporter::modern_html_exporter::{HtmlExportOptions, ModernHtmlExporter};
use qce_exporter::types::{ChatInfo, CleanMessage};

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;


// 通用小工具


fn iso(time: std::time::SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn file_times(meta: &std::fs::Metadata) -> (String, String) {
    let create = meta
        .created()
        .or_else(|_| meta.modified())
        .map(iso)
        .unwrap_or_default();
    let modify = meta.modified().map(iso).unwrap_or_default();
    (create, modify)
}

fn encode_uri_component(input: &str) -> String {
    utf8_percent_encode(input, NON_ALPHANUMERIC).to_string()
}

fn resource_type_from_ext(ext: &str) -> &'static str {
    const IMAGES: [&str; 8] = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".svg",
    ];
    const VIDEOS: [&str; 7] = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv"];
    const AUDIOS: [&str; 9] = [
        ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".amr", ".silk",
    ];
    if IMAGES.contains(&ext) {
        "image"
    } else if VIDEOS.contains(&ext) {
        "video"
    } else if AUDIOS.contains(&ext) {
        "audio"
    } else {
        "file"
    }
}

fn mime_type_from_ext(ext: &str) -> &'static str {
    match ext {
        ".jpg" | ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".ico" => "image/x-icon",
        ".svg" => "image/svg+xml",
        ".mp4" => "video/mp4",
        ".avi" => "video/x-msvideo",
        ".mov" => "video/quicktime",
        ".mkv" => "video/x-matroska",
        ".webm" => "video/webm",
        ".flv" => "video/x-flv",
        ".wmv" => "video/x-ms-wmv",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".ogg" => "audio/ogg",
        ".flac" => "audio/flac",
        ".aac" => "audio/aac",
        ".m4a" => "audio/mp4",
        ".wma" => "audio/x-ms-wma",
        ".amr" => "audio/amr",
        ".silk" => "audio/silk",
        _ => "application/octet-stream",
    }
}

fn html_json_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)\.(html|json)$").expect("valid regex"))
}

fn ext_of(name: &str) -> String {
    FsPath::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn valid_export_file_name(file_name: &str) -> bool {
    let mut components = FsPath::new(file_name).components();
    matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none()
        && !file_name.contains('\0')
}

struct ResolvedExportFile {
    path: PathBuf,
    base_dir: PathBuf,
    is_scheduled: bool,
}

/// Resolves an existing top-level export file without permitting traversal or symlink escape.
fn resolve_export_file(state: &SharedState, file_name: &str) -> Option<ResolvedExportFile> {
    if !valid_export_file_name(file_name) {
        return None;
    }

    for (base_dir, is_scheduled) in [
        (state.path_manager.exports_dir(), false),
        (state.path_manager.scheduled_exports_dir(), true),
    ] {
        let candidate = base_dir.join(file_name);
        if !candidate.is_file() {
            continue;
        }
        let (Ok(path), Ok(canonical_base)) = (candidate.canonicalize(), base_dir.canonicalize()) else {
            continue;
        };
        if path.starts_with(&canonical_base) {
            return Some(ResolvedExportFile {
                path,
                base_dir,
                is_scheduled,
            });
        }
    }
    None
}


// 导出文件名解析（Issue #216 新旧格式兼容）


fn valid_qq_uin(value: &str) -> bool {
    value != "0" && !value.is_empty() && value.chars().all(|c| c.is_ascii_digit())
}

fn avatar_url(chat_type: &str, chat_id: &str) -> Option<String> {
    if chat_type == "friend" {
        valid_qq_uin(chat_id).then(|| format!("https://q1.qlogo.cn/g?b=qq&nk={chat_id}&s=100"))
    } else {
        Some(format!("https://p.qlogo.cn/gh/{chat_id}/{chat_id}/100"))
    }
}

/// 构建 UID→UIN 查找表（用于将 `u_xxx` 形式的 peerUid 解析为 QQ 号码）。
async fn build_uid_to_uin_map(state: &SharedState) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if let Ok(friends) = state.napcat.get_friends(false).await {
        if let Some(arr) = friends.as_array() {
            for f in arr {
                let core = f.get("coreInfo").unwrap_or(f);
                let uid = core.get("uid").and_then(Value::as_str).unwrap_or_default();
                let uin = {
                    let u = core.get("uin").and_then(Value::as_str).unwrap_or_default();
                    if u.is_empty() {
                        f.get("uin").and_then(Value::as_str).unwrap_or_default()
                    } else {
                        u
                    }
                };
                if !uid.is_empty() && valid_qq_uin(uin) {
                    map.insert(uid.to_string(), uin.to_string());
                }
            }
        }
    }
    map
}

/// 根据 UID→UIN 查找表修正文件列表中的 avatarUrl（将 `u_xxx` 替换为 QQ 号码）。
fn fix_avatar_urls(files: &mut [Value], uid_to_uin: &std::collections::HashMap<String, String>) {
    for file in files.iter_mut() {
        let chat_type = file
            .get("chatType")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if chat_type != "friend" {
            continue;
        }
        let chat_id = file
            .get("chatId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !chat_id.starts_with("u_") {
            continue;
        }
        if let Some(uin) = uid_to_uin.get(chat_id).filter(|value| valid_qq_uin(value)) {
            file["avatarUrl"] = Value::String(format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=100"));
            file["peerUin"] = Value::String(uin.clone());
        }
    }
}

/// 解析 `(friend|group)_<middle>_<YYYYMMDD>_<HHMMSS[mmm]>` 结构，返回
/// `(chatType, chatId, exportDate, displayName)`。
fn parse_base_name(base: &str) -> Option<(String, String, String, Option<String>)> {
    let re = base_name_re();
    let caps = re.captures(base)?;
    let chat_type = caps.get(1)?.as_str().to_lowercase();
    let middle = caps.get(2)?.as_str();
    let date = caps.get(3)?.as_str();
    let time = caps.get(4)?.as_str();
    let date_time = format!(
        "{}-{}-{} {}:{}:{}",
        &date[0..4],
        &date[4..6],
        &date[6..8],
        &time[0..2],
        &time[2..4],
        &time[4..6]
    );

    // 新格式：middle = "聊天名_ID"；旧格式：middle 就是 ID。
    if let Some(last_idx) = middle.rfind('_') {
        let possible_id = &middle[last_idx + 1..];
        let possible_name = &middle[..last_idx];
        if !possible_id.is_empty()
            && possible_id.chars().all(|c| c.is_ascii_digit())
            && !possible_name.is_empty()
        {
            return Some((
                chat_type,
                possible_id.to_string(),
                date_time,
                Some(possible_name.replace('_', " ")),
            ));
        }
        // chatName_u_xxx 格式（ID 以 u_ 开头）。
        if let Some(second_idx) = possible_name.rfind('_') {
            if &possible_name[second_idx + 1..] == "u" {
                let chat_name = &possible_name[..second_idx];
                let id = format!("u_{possible_id}");
                return Some((chat_type, id, date_time, Some(chat_name.replace('_', " "))));
            }
        }
    }

    Some((chat_type, middle.to_string(), date_time, None))
}

fn base_name_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"(?i)^(friend|group)_(.+)_(\d{8})_(\d{6,9})(?:_\d+)?$")
            .expect("valid regex")
    })
}

/// 解析普通导出文件名（`.html` / `.json`，兼容 `_NNN_TEMP` 后缀）。
fn parse_export_file_name(file_name: &str) -> Option<Value> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?i)^(.+?)(?:_\d{3}_TEMP)?\.(html|json)$").expect("valid regex")
    });
    let caps = re.captures(file_name)?;
    let base = caps.get(1)?.as_str();
    let ext = caps.get(2)?.as_str().to_lowercase();
    let (chat_type, chat_id, export_date, display_name) = parse_base_name(base)?;
    Some(json!({
        "chatType": chat_type,
        "chatId": chat_id,
        "exportDate": export_date,
        "displayName": display_name,
        "format": if ext == "json" { "JSON" } else { "HTML" },
        "avatarUrl": avatar_url(&chat_type, &chat_id),
    }))
}

/// 解析 `_chunked_jsonl` 目录名。
fn parse_chunked_jsonl_dir_name(dir_name: &str) -> Option<Value> {
    let base = strip_suffix_ci(dir_name, "_chunked_jsonl")?;
    let (chat_type, chat_id, export_date, display_name) = parse_base_name(base)?;
    Some(json!({
        "chatType": chat_type,
        "chatId": chat_id,
        "exportDate": export_date,
        "displayName": display_name,
        "format": "JSONL",
        "avatarUrl": avatar_url(&chat_type, &chat_id),
    }))
}

/// 解析 `_streaming.zip` 文件名。
fn parse_streaming_zip_file_name(file_name: &str) -> Option<Value> {
    let base = strip_suffix_ci(file_name, "_streaming.zip")?;
    let (chat_type, chat_id, export_date, display_name) = parse_base_name(base)?;
    Some(json!({
        "chatType": chat_type,
        "chatId": chat_id,
        "exportDate": export_date,
        "displayName": display_name,
        "format": "ZIP",
        "avatarUrl": avatar_url(&chat_type, &chat_id),
    }))
}

fn strip_suffix_ci<'a>(input: &'a str, suffix: &str) -> Option<&'a str> {
    if input.len() >= suffix.len()
        && input[input.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    {
        Some(&input[..input.len() - suffix.len()])
    } else {
        None
    }
}


// 导出文件元数据解析


#[derive(Default)]
struct FileMetadata {
    message_count: Option<i64>,
    chat_name: Option<String>,
    time_range: Option<String>,
    peer_uid: Option<String>,
    peer_uin: Option<String>,
    avatar_url: Option<String>,
}

fn metadata_string(data: &Value, pointer: &str) -> Option<String> {
    data.pointer(pointer)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 从 HTML 文件头部提取 `QCE_METADATA` 注释。
fn parse_html_metadata(file_path: &FsPath) -> FileMetadata {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"<!-- QCE_METADATA: (\{[^}]+\}) -->").expect("valid regex")
    });
    let Ok(bytes) = std::fs::read(file_path) else {
        return FileMetadata::default();
    };
    let header = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).into_owned();
    if let Some(caps) = re.captures(&header) {
        if let Ok(metadata) = serde_json::from_str::<Value>(&caps[1]) {
            return FileMetadata {
                message_count: metadata.get("messageCount").and_then(Value::as_i64),
                chat_name: metadata_string(&metadata, "/chatName"),
                peer_uid: metadata_string(&metadata, "/peerUid"),
                peer_uin: metadata_string(&metadata, "/peerUin"),
                avatar_url: metadata_string(&metadata, "/avatarUrl"),
                ..FileMetadata::default()
            };
        }
    }
    FileMetadata::default()
}

/// 从 JSON 导出文件提取聊天元数据。
fn parse_json_metadata(file_path: &FsPath) -> FileMetadata {
    let Ok(content) = std::fs::read_to_string(file_path) else {
        return FileMetadata::default();
    };
    let Ok(data) = serde_json::from_str::<Value>(&content) else {
        return FileMetadata::default();
    };
    let message_count = data
        .pointer("/statistics/totalMessages")
        .and_then(Value::as_i64);
    let chat_name = data
        .pointer("/chatInfo/name")
        .and_then(Value::as_str)
        .map(String::from);
    let time_range = match (
        data.pointer("/statistics/timeRange/start")
            .and_then(Value::as_str),
        data.pointer("/statistics/timeRange/end")
            .and_then(Value::as_str),
    ) {
        (Some(start), Some(end)) => Some(format!("{start} ~ {end}")),
        _ => None,
    };
    FileMetadata {
        message_count,
        chat_name,
        time_range,
        peer_uid: metadata_string(&data, "/chatInfo/peerUid"),
        peer_uin: metadata_string(&data, "/chatInfo/peerUin"),
        avatar_url: metadata_string(&data, "/chatInfo/avatar"),
    }
}

fn apply_file_metadata(file_info: &mut Value, metadata: FileMetadata) {
    if let Some(count) = metadata.message_count {
        file_info["messageCount"] = json!(count);
    }
    if let Some(name) = metadata.chat_name {
        file_info["displayName"] = json!(name);
    }
    if let Some(time_range) = metadata.time_range {
        file_info["description"] = json!(time_range);
    }
    if let Some(peer_uid) = metadata.peer_uid {
        file_info["peerUid"] = json!(peer_uid);
    }
    if let Some(peer_uin) = metadata.peer_uin.filter(|value| valid_qq_uin(value)) {
        file_info["avatarUrl"] = json!(format!("https://q1.qlogo.cn/g?b=qq&nk={peer_uin}&s=100"));
        file_info["peerUin"] = json!(peer_uin);
    } else if let Some(avatar_url) = metadata.avatar_url {
        file_info["avatarUrl"] = json!(avatar_url);
    }
}

fn parse_manifest_metadata(manifest: &Value) -> FileMetadata {
    FileMetadata {
        message_count: manifest
            .pointer("/statistics/totalMessages")
            .or_else(|| manifest.pointer("/stats/totalMessages"))
            .and_then(Value::as_i64),
        chat_name: metadata_string(manifest, "/chatInfo/name")
            .or_else(|| metadata_string(manifest, "/chat/name")),
        peer_uid: metadata_string(manifest, "/chatInfo/peerUid")
            .or_else(|| metadata_string(manifest, "/chat/peerUid")),
        peer_uin: metadata_string(manifest, "/chatInfo/peerUin")
            .or_else(|| metadata_string(manifest, "/chat/peerUin")),
        avatar_url: metadata_string(manifest, "/chatInfo/avatar")
            .or_else(|| metadata_string(manifest, "/chat/avatar")),
        ..FileMetadata::default()
    }
}

/// 获取聊天对象显示名（群名 / 好友昵称）。
async fn display_name_for_chat(
    state: &SharedState,
    chat_type: &str,
    chat_id: &str,
) -> Option<String> {
    if chat_type == "group" {
        let groups = state.napcat.get_groups(false).await.ok()?;
        groups.as_array()?.iter().find_map(|g| {
            if g.get("groupCode").and_then(Value::as_str) == Some(chat_id) {
                g.get("groupName").and_then(Value::as_str).map(String::from)
            } else {
                None
            }
        })
    } else {
        let friends = state.napcat.get_friends(false).await.ok()?;
        friends.as_array()?.iter().find_map(|f| {
            let uin = f.get("uin").and_then(Value::as_str);
            let uid = f.get("uid").and_then(Value::as_str);
            if uin == Some(chat_id) || uid == Some(chat_id) {
                f.get("nick")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .or_else(|| f.get("remark").and_then(Value::as_str))
                    .map(String::from)
            } else {
                None
            }
        })
    }
}


// 目录扫描


/// 高性能目录统计（递归文件数 + 总大小）。
fn scan_directory_stats(dir: &FsPath) -> (i64, i64) {
    let mut count = 0i64;
    let mut size = 0i64;
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                count += 1;
                size += i64::try_from(meta.len()).unwrap_or(0);
            }
        }
    }
    (count, size)
}

/// 扫描 JSONL 分块目录，返回 `(resourceCount, resourceSize)`。
fn scan_jsonl_directory(dir: &FsPath) -> (i64, i64) {
    let mut resource_count = 0i64;
    let mut resource_size = 0i64;
    let manifest_path = dir.join("manifest.json");
    if let Ok(content) = std::fs::read_to_string(&manifest_path) {
        if let Ok(manifest) = serde_json::from_str::<Value>(&content) {
            resource_count = manifest
                .pointer("/statistics/resources/total")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            resource_size = manifest
                .pointer("/statistics/resources/totalSize")
                .and_then(Value::as_i64)
                .unwrap_or(0);
        }
    }
    if resource_count == 0 {
        let chunks_dir = dir.join("chunks");
        if chunks_dir.exists() {
            let (_, size) = scan_directory_stats(&chunks_dir);
            resource_size = size;
        }
    }
    (resource_count, resource_size)
}

/// 扫描单个导出目录，把识别出的文件加入 `files`。
async fn scan_export_dir(
    state: &SharedState,
    dir: &FsPath,
    is_scheduled: bool,
    files: &mut Vec<Value>,
) {
    let prefix = if is_scheduled {
        "/scheduled-downloads"
    } else {
        "/downloads"
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let normalized = file_name.to_lowercase();
        let file_path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };

        let mut info: Option<Value> = None;
        if meta.is_dir() && normalized.ends_with("_chunked_jsonl") {
            if let Some(mut file_info) = parse_chunked_jsonl_dir_name(&file_name) {
                // 从 manifest.json 读取元数据。
                let manifest_path = file_path.join("manifest.json");
                if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<Value>(&content) {
                        apply_file_metadata(&mut file_info, parse_manifest_metadata(&manifest));
                    }
                }
                info = Some(file_info);
            }
        } else if meta.is_file() && normalized.ends_with("_streaming.zip") {
            info = parse_streaming_zip_file_name(&file_name);
        } else if meta.is_file() && (normalized.ends_with(".html") || normalized.ends_with(".json"))
        {
            if let Some(mut file_info) = parse_export_file_name(&file_name) {
                let format = file_info
                    .get("format")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if format == "HTML" {
                    apply_file_metadata(&mut file_info, parse_html_metadata(&file_path));
                } else if format == "JSON" {
                    apply_file_metadata(&mut file_info, parse_json_metadata(&file_path));
                }
                info = Some(file_info);
            }
        }

        let Some(mut file_info) = info else { continue };
        if file_info
            .get("displayName")
            .and_then(Value::as_str)
            .is_none()
        {
            let chat_type = file_info
                .get("chatType")
                .and_then(Value::as_str)
                .unwrap_or("friend")
                .to_string();
            let chat_id = file_info
                .get("chatId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if let Some(name) = display_name_for_chat(state, &chat_type, &chat_id).await {
                file_info["displayName"] = json!(name);
            }
        }

        let (create_time, modify_time) = file_times(&meta);
        let mut item = json!({
            "fileName": file_name,
            "filePath": file_path.to_string_lossy(),
            "relativePath": format!("{prefix}/{file_name}"),
            "size": meta.len(),
            "createTime": create_time,
            "modifyTime": modify_time,
        });
        if is_scheduled {
            item["isScheduled"] = json!(true);
        }
        if let (Some(obj), Some(extra)) = (item.as_object_mut(), file_info.as_object()) {
            for (key, value) in extra {
                obj.insert(key.clone(), value.clone());
            }
        }
        files.push(item);
    }
}


// GET /api/exports/files


/// 获取导出文件列表（聊天记录索引页面）。
pub async fn list_export_files(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let mut files: Vec<Value> = Vec::new();
    scan_export_dir(&state, &state.path_manager.exports_dir(), false, &mut files).await;
    scan_export_dir(
        &state,
        &state.path_manager.scheduled_exports_dir(),
        true,
        &mut files,
    )
    .await;
    // 将 u_xxx 形式的 peerUid 解析为 QQ 号码以生成正确的头像 URL。
    let uid_to_uin = build_uid_to_uin_map(&state).await;
    fix_avatar_urls(&mut files, &uid_to_uin);
    files.sort_by(|a, b| {
        let time_a = a.get("modifyTime").and_then(Value::as_str).unwrap_or("");
        let time_b = b.get("modifyTime").and_then(Value::as_str).unwrap_or("");
        time_b.cmp(time_a)
    });
    response::success(json!({ "files": files }), &request_id)
}


// GET /api/exports/files/:fileName/info


/// 获取特定导出文件的详细信息。
pub async fn export_file_info(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(file_name): Path<String>,
) -> Response {
    let Some(resolved) = resolve_export_file(&state, &file_name) else {
        let err = ApiError::validation("导出文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };
    let file_path = resolved.path;
    let is_scheduled = resolved.is_scheduled;
    let Some(basic_info) = parse_export_file_name(&file_name) else {
        let err = ApiError::validation("无效的文件名格式", "INVALID_FILENAME");
        return response::error(&err, &request_id);
    };
    let Ok(meta) = std::fs::metadata(&file_path) else {
        let err = ApiError::validation("导出文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };

    // 从文件内容提取详细信息。
    let mut detailed = serde_json::Map::new();
    let is_json = basic_info.get("format").and_then(Value::as_str) == Some("JSON")
        || file_name.to_lowercase().ends_with(".json");
    if is_json {
        if let Ok(content) = std::fs::read_to_string(&file_path) {
            if let Ok(data) = serde_json::from_str::<Value>(&content) {
                if let Some(name) = data.pointer("/chatInfo/name").and_then(Value::as_str) {
                    detailed.insert("displayName".into(), json!(name));
                }
                if let Some(time) = data.pointer("/metadata/exportTime").and_then(Value::as_str) {
                    detailed.insert("exportTime".into(), json!(time));
                }
                if let Some(count) = data
                    .pointer("/statistics/totalMessages")
                    .and_then(Value::as_i64)
                {
                    detailed.insert("messageCount".into(), json!(count));
                }
                if let (Some(start), Some(end)) = (
                    data.pointer("/statistics/timeRange/start")
                        .and_then(Value::as_str),
                    data.pointer("/statistics/timeRange/end")
                        .and_then(Value::as_str),
                ) {
                    detailed.insert("timeRange".into(), json!(format!("{start} ~ {end}")));
                }
                if let Some(first) = data
                    .pointer("/messages/0/sender")
                    .and_then(|s| s.get("name").or_else(|| s.get("uid")))
                    .and_then(Value::as_str)
                {
                    detailed.insert("senderName".into(), json!(first));
                }
            }
        }
    } else if let Ok(html_content) = std::fs::read_to_string(&file_path) {
        for (pattern, key) in [
            (
                r"<title>([^<]+?)(?:\s*-\s*聊天记录)?</title>",
                "displayName",
            ),
            (r#"<div class="info-value">([^<]+)</div>"#, "exportTime"),
            (r#"<span class="sender">([^<]+)</span>"#, "senderName"),
        ] {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(&html_content) {
                    detailed.insert(key.into(), json!(caps[1].trim()));
                }
            }
        }
        if let Ok(re) = regex::Regex::new(r#"(?s)消息总数.*?<div class="info-value">(\d+)</div>"#)
        {
            if let Some(caps) = re.captures(&html_content) {
                if let Ok(count) = caps[1].parse::<i64>() {
                    detailed.insert("messageCount".into(), json!(count));
                }
            }
        }
        if let Some(time_range) = extract_html_time_range(&html_content) {
            detailed.insert("timeRange".into(), json!(time_range));
        }
    }

    let (create_time, modify_time) = file_times(&meta);
    let prefix = if is_scheduled {
        "/scheduled-downloads"
    } else {
        "/downloads"
    };
    let mut result = json!({
        "fileName": file_name,
        "filePath": file_path.to_string_lossy(),
        "relativePath": format!("{prefix}/{file_name}"),
        "size": meta.len(),
        "createTime": create_time,
        "modifyTime": modify_time,
        "isScheduled": is_scheduled,
    });
    if let Some(obj) = result.as_object_mut() {
        if let Some(basic) = basic_info.as_object() {
            for (key, value) in basic {
                obj.insert(key.clone(), value.clone());
            }
        }
        for (key, value) in detailed {
            obj.insert(key, value);
        }
    }
    response::success(result, &request_id)
}


// DELETE /api/exports/files/:fileName（Issue #32）


/// 删除导出文件（HTML + JSON + 资源目录）。
pub async fn delete_export_file(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(file_name): Path<String>,
) -> Response {
    let Some(resolved) = resolve_export_file(&state, &file_name) else {
        let err = ApiError::validation("文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };
    let base_dir = resolved.base_dir;

    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\.(html|json)$").expect("valid regex"));
    let base_name = re.replace(&file_name, "").into_owned();
    let html_path = base_dir.join(format!("{base_name}.html"));
    let json_path = base_dir.join(format!("{base_name}.json"));
    let resources_dir = base_dir.join(format!("resources_{base_name}"));

    let mut deleted: Vec<&str> = Vec::new();
    if html_path.exists() && tokio::fs::remove_file(&html_path).await.is_ok() {
        deleted.push("HTML文件");
    }
    if json_path.exists() && tokio::fs::remove_file(&json_path).await.is_ok() {
        deleted.push("JSON文件");
    }
    if resources_dir.exists() && tokio::fs::remove_dir_all(&resources_dir).await.is_ok() {
        deleted.push("资源目录");
    }

    response::success(
        json!({ "message": "文件删除成功", "deleted": deleted }),
        &request_id,
    )
}


// GET /api/exports/files/:fileName/preview


fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// 格式化 JSON 为带颜色的 HTML 字符串。
fn format_json_for_display(value: &Value, indent: usize) -> String {
    let spaces = "  ".repeat(indent);
    let next_spaces = "  ".repeat(indent + 1);
    match value {
        Value::Null => r#"<span class="json-null">null</span>"#.to_string(),
        Value::String(s) => format!(r#"<span class="json-string">"{}"</span>"#, escape_html(s)),
        Value::Number(n) => format!(r#"<span class="json-number">{n}</span>"#),
        Value::Bool(b) => format!(r#"<span class="json-boolean">{b}</span>"#),
        Value::Array(items) => {
            if items.is_empty() {
                return "[]".to_string();
            }
            let body = items
                .iter()
                .map(|item| format!("{next_spaces}{}", format_json_for_display(item, indent + 1)))
                .collect::<Vec<_>>()
                .join(",\n");
            format!("[\n{body}\n{spaces}]")
        }
        Value::Object(map) => {
            if map.is_empty() {
                return "{}".to_string();
            }
            let body = map
                .iter()
                .map(|(key, val)| {
                    format!(
                        r#"{next_spaces}<span class="json-key">"{}"</span>: {}"#,
                        escape_html(key),
                        format_json_for_display(val, indent + 1)
                    )
                })
                .collect::<Vec<_>>()
                .join(",\n");
            format!("{{\n{body}\n{spaces}}}")
        }
    }
}

/// HTML / JSON 文件预览（iframe 内嵌显示）。
pub async fn preview_export_file(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(file_name): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(resolved) = resolve_export_file(&state, &file_name) else {
        let err = ApiError::validation("导出文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };
    let file_path = resolved.path;

    let is_json = ext_of(&file_name) == ".json";
    let html = if is_json {
        let json_content = std::fs::read_to_string(&file_path).unwrap_or_default();
        let json_data: Value = serde_json::from_str(&json_content)
            .unwrap_or_else(|_| json!({ "error": "无法解析JSON", "content": json_content }));
        format!(
            r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSON 预览 - {file_name}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: #ffffff;
            padding: 20px;
            line-height: 1.6;
            color: #1d1d1f;
        }}
        pre {{
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.8;
            white-space: pre-wrap;
            word-wrap: break-word;
        }}
        .json-key {{ color: #881391; font-weight: 500; }}
        .json-string {{ color: #0e5c99; }}
        .json-number {{ color: #1c00cf; }}
        .json-boolean {{ color: #0d22aa; font-weight: 500; }}
        .json-null {{ color: #808080; font-style: italic; }}
    </style>
</head>
<body>
    <pre>{}</pre>
</body>
</html>"#,
            format_json_for_display(&json_data, 0)
        )
    } else {
        // HTML 文件：把相对资源路径改写为绝对 API 路径（兼容新旧导出格式）。
        let mut content = std::fs::read_to_string(&file_path).unwrap_or_default();
        let encoded = encode_uri_component(&file_name);
        let api_prefix = format!("/api/exports/files/{encoded}/resources/");
        let token_suffix = params
            .get("token")
            .filter(|token| !token.is_empty())
            .map(|token| format!("?token={}", encode_uri_component(token)))
            .unwrap_or_default();
        let resource_re = regex::Regex::new(
            r#"(?P<attr>src|href)=\"(?:\./|\.\./)resources/(?P<path>[^\"]*)\""#,
        )
        .expect("valid resource URL regex");
        content = resource_re
            .replace_all(&content, |captures: &regex::Captures<'_>| {
                format!(
                    "{}=\"{api_prefix}{}{}\"",
                    &captures["attr"], &captures["path"], token_suffix
                )
            })
            .into_owned();
        content
    };

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::X_FRAME_OPTIONS, "SAMEORIGIN"),
            (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
        ],
        html,
    )
        .into_response()
}


// GET /api/exports/files/:fileName/resources/*path


/// 构建单个资源目录的文件名缓存（shortName → 实际文件名）。
async fn build_resource_cache(state: &SharedState, dir_path: &str) -> HashMap<String, String> {
    {
        let cache = state.resource_file_cache.lock().await;
        if let Some(existing) = cache.get(dir_path) {
            return existing.clone();
        }
    }

    let mut map: HashMap<String, String> = HashMap::new();
    let full_dir = state.path_manager.resources_dir().join(dir_path);
    if let Ok(entries) = std::fs::read_dir(&full_dir) {
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            // 带 MD5 前缀的文件名格式：md5_originalName.ext。
            if let Some(idx) = file_name.find('_') {
                if idx > 0 {
                    map.insert(file_name[idx + 1..].to_string(), file_name.clone());
                }
            }
            map.insert(file_name.clone(), file_name);
        }
    }

    let mut cache = state.resource_file_cache.lock().await;
    cache.insert(dir_path.to_string(), map.clone());
    map
}

/// O(1) 查找资源文件的实际路径。
async fn find_resource_file(state: &SharedState, resource_path: &str) -> Option<PathBuf> {
    let path = FsPath::new(resource_path);
    let dir_path = path.parent().map(|p| p.to_string_lossy().into_owned())?;
    let short_name = path.file_name().map(|n| n.to_string_lossy().into_owned())?;
    let cache = build_resource_cache(state, &dir_path).await;
    let actual = cache.get(&short_name)?;
    Some(
        state
            .path_manager
            .resources_dir()
            .join(dir_path)
            .join(actual),
    )
}

/// HTML 预览页面的资源文件服务。
///
/// 资源查找顺序：
/// 1. 导出文件同级的 `resources_{base_name}/` 目录（HTML 导出产物）
/// 2. 全局 `~/.qq-chat-exporter/resources/` 目录（下载缓存）
pub async fn export_file_resource(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path((file_name, resource_path)): Path<(String, String)>,
) -> Response {
    if !valid_export_file_name(&file_name) {
        let err = ApiError::validation("非法的导出文件名", "INVALID_FILENAME");
        return response::error(&err, &request_id);
    }
    if resource_path.contains("..")
        || resource_path.starts_with('/')
        || resource_path.starts_with('\\')
    {
        let err = ApiError::validation("非法的资源路径", "INVALID_PATH");
        return response::error(&err, &request_id);
    }

    // 从 fileName 推导 base_name（去掉扩展名）
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(?i)\.(html|json|zip)$").expect("valid regex"));
    let base_name = re.replace(&file_name, "").into_owned();

    // 优先在导出文件同级 resources_{base_name}/ 目录查找
    let full_path = find_export_local_resource(&state, &base_name, &resource_path)
        .await
        .or(find_resource_file(&state, &resource_path).await);

    let Some(full_path) = full_path else {
        let err = ApiError::validation(
            format!("资源文件不存在: {resource_path}"),
            "RESOURCE_NOT_FOUND",
        );
        return response::error(&err, &request_id);
    };
    let Ok(bytes) = tokio::fs::read(&full_path).await else {
        let err = ApiError::validation(
            format!("资源文件不存在: {resource_path}"),
            "RESOURCE_NOT_FOUND",
        );
        return response::error(&err, &request_id);
    };

    let content_type = mime_type_from_ext(&ext_of(&resource_path));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=31536000"),
        ],
        bytes,
    )
        .into_response()
}

/// 在导出文件同级的 `resources_{base_name}/` 目录查找资源。
async fn find_export_local_resource(
    state: &SharedState,
    base_name: &str,
    resource_path: &str,
) -> Option<PathBuf> {
    let exports_dir = state.path_manager.exports_dir();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();

    let dir_name = format!("resources_{base_name}");
    let mut resource_dir = exports_dir.join(&dir_name);
    if !resource_dir.exists() {
        resource_dir = scheduled_dir.join(&dir_name);
    }
    // chunked jsonl 方案：exports/{base_name}/resources/
    if !resource_dir.exists() {
        let jsonl_dir = exports_dir.join(base_name);
        if jsonl_dir.is_dir() {
            resource_dir = jsonl_dir.join("resources");
        }
    }
    if !resource_dir.exists() {
        let jsonl_dir = scheduled_dir.join(base_name);
        if jsonl_dir.is_dir() {
            resource_dir = jsonl_dir.join("resources");
        }
    }
    if !resource_dir.exists() {
        return None;
    }

    let candidate = resource_dir.join(resource_path);
    if candidate.is_file() {
        return Some(candidate);
    }

    // 带 MD5 前缀匹配：目录下文件名为 `md5_originalName.ext`
    let path = FsPath::new(resource_path);
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let short_name = path.file_name()?.to_string_lossy().into_owned();

    let search_dir = if parent.is_empty() {
        resource_dir.clone()
    } else {
        resource_dir.join(&parent)
    };

    let entries = std::fs::read_dir(&search_dir).ok()?;
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name == short_name {
            return Some(entry.path());
        }
        if let Some(idx) = file_name.find('_') {
            if idx > 0 && file_name[idx + 1..] == short_name {
                return Some(entry.path());
            }
        }
    }
    None
}


// GET /api/resources/index


/// 构建完整的资源索引（全局资源目录 + ZIP + JSONL）。
pub async fn resources_index(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let resources_dir = state.path_manager.resources_dir();
    let exports_dir = state.path_manager.exports_dir();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();

    let mut total_resources = 0i64;
    let mut total_size = 0i64;
    let mut by_type: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut by_source: serde_json::Map<String, Value> = serde_json::Map::new();

    fn bump(map: &mut serde_json::Map<String, Value>, key: &str, count: i64, size: i64) {
        let entry = map
            .entry(key.to_string())
            .or_insert_with(|| json!({ "count": 0, "size": 0 }));
        entry["count"] = json!(entry["count"].as_i64().unwrap_or(0) + count);
        entry["size"] = json!(entry["size"].as_i64().unwrap_or(0) + size);
    }

    // 1. 全局资源目录。
    let mut global_resources = serde_json::Map::new();
    for type_name in ["images", "videos", "audios", "files"] {
        let dir = resources_dir.join(type_name);
        let (count, size) = if dir.exists() {
            scan_directory_stats(&dir)
        } else {
            (0, 0)
        };
        if count > 0 || size > 0 {
            total_resources += count;
            total_size += size;
            bump(&mut by_type, type_name, count, size);
            bump(&mut by_source, "global", count, size);
        }
        global_resources.insert(
            type_name.to_string(),
            json!({ "count": count, "size": size, "path": dir.to_string_lossy() }),
        );
    }

    // 2. 扫描导出目录。
    let mut exports: Vec<Value> = Vec::new();
    for dir in [&exports_dir, &scheduled_dir] {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let full_path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };

            if meta.is_dir() {
                if name.ends_with("_chunked_jsonl") {
                    let (resource_count, resource_size) = scan_jsonl_directory(&full_path);
                    let info = parse_export_file_name(&name.replace("_chunked_jsonl", ".json"));
                    exports.push(json!({
                        "fileName": name,
                        "format": "jsonl",
                        "resourceCount": resource_count,
                        "resourceSize": resource_size,
                        "chatType": info.as_ref().and_then(|i| i.get("chatType")).cloned(),
                        "chatId": info.as_ref().and_then(|i| i.get("chatId")).cloned(),
                        "displayName": info.as_ref().and_then(|i| i.get("displayName")).cloned(),
                    }));
                    total_resources += resource_count;
                    total_size += resource_size;
                    bump(&mut by_source, "jsonl", resource_count, resource_size);
                } else if name.starts_with("friend_") || name.starts_with("group_") {
                    let resources_sub = full_path.join("resources");
                    if resources_sub.exists() {
                        let (count, size) = scan_directory_stats(&resources_sub);
                        let info = parse_export_file_name(&format!("{name}.html"));
                        exports.push(json!({
                            "fileName": name,
                            "format": "zip",
                            "resourceCount": count,
                            "resourceSize": size,
                            "chatType": info.as_ref().and_then(|i| i.get("chatType")).cloned(),
                            "chatId": info.as_ref().and_then(|i| i.get("chatId")).cloned(),
                            "displayName": info.as_ref().and_then(|i| i.get("displayName")).cloned(),
                        }));
                        total_resources += count;
                        total_size += size;
                        bump(&mut by_source, "zip", count, size);
                    }
                }
            } else if meta.is_file() {
                let ext = ext_of(&name);
                if ext == ".zip" {
                    let info = parse_export_file_name(&name.replace(".zip", ".html"));
                    exports.push(json!({
                        "fileName": name,
                        "format": "zip",
                        "resourceCount": 0,
                        "resourceSize": meta.len(),
                        "chatType": info.as_ref().and_then(|i| i.get("chatType")).cloned(),
                        "chatId": info.as_ref().and_then(|i| i.get("chatId")).cloned(),
                        "displayName": info.as_ref().and_then(|i| i.get("displayName")).cloned(),
                    }));
                    bump(
                        &mut by_source,
                        "zip",
                        0,
                        i64::try_from(meta.len()).unwrap_or(0),
                    );
                } else if ext == ".html" || ext == ".json" {
                    let info = parse_export_file_name(&name);
                    let base_name = html_json_re().replace(&name, "").into_owned();
                    let resource_dir = dir.join(format!("resources_{base_name}"));
                    let (resource_count, resource_size) = if resource_dir.exists() {
                        scan_directory_stats(&resource_dir)
                    } else {
                        (0, 0)
                    };
                    let format = if ext == ".html" { "html" } else { "json" };
                    exports.push(json!({
                        "fileName": name,
                        "format": format,
                        "resourceCount": resource_count,
                        "resourceSize": resource_size,
                        "chatType": info.as_ref().and_then(|i| i.get("chatType")).cloned(),
                        "chatId": info.as_ref().and_then(|i| i.get("chatId")).cloned(),
                        "displayName": info.as_ref().and_then(|i| i.get("displayName")).cloned(),
                    }));
                    if resource_count > 0 {
                        total_resources += resource_count;
                        total_size += resource_size;
                        bump(&mut by_source, format, resource_count, resource_size);
                    }
                }
            }
        }
    }

    exports.sort_by_key(|e| {
        std::cmp::Reverse(e.get("resourceSize").and_then(Value::as_i64).unwrap_or(0))
    });

    response::success(
        json!({
            "summary": {
                "totalResources": total_resources,
                "totalSize": total_size,
                "byType": by_type,
                "bySource": by_source,
            },
            "globalResources": global_resources,
            "exports": exports,
        }),
        &request_id,
    )
}


// GET /api/resources/export/:fileName


/// 获取特定导出文件的资源列表。
pub async fn export_file_resources(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(file_name): Path<String>,
) -> Response {
    if !valid_export_file_name(&file_name) {
        let err = ApiError::validation("非法的导出文件名", "INVALID_FILENAME");
        return response::error(&err, &request_id);
    }
    let exports_dir = state.path_manager.exports_dir();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();

    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(?i)\.(html|json|zip)$").expect("valid regex"));
    let base_name = if file_name.ends_with("_chunked_jsonl") {
        file_name.clone()
    } else {
        re.replace(&file_name, "").into_owned()
    };

    let mut resource_dir = exports_dir.join(format!("resources_{base_name}"));
    if !resource_dir.exists() {
        resource_dir = scheduled_dir.join(format!("resources_{base_name}"));
    }
    if !resource_dir.exists() {
        let jsonl_dir = exports_dir.join(&base_name);
        if jsonl_dir.is_dir() {
            resource_dir = jsonl_dir.join("resources");
        }
    }
    if !resource_dir.exists() {
        let jsonl_dir = scheduled_dir.join(&base_name);
        if jsonl_dir.is_dir() {
            resource_dir = jsonl_dir.join("resources");
        }
    }

    let mut resources: Vec<Value> = Vec::new();
    if resource_dir.exists() {
        let encoded = encode_uri_component(&file_name);
        for entry in walkdir::WalkDir::new(&resource_dir).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            let relative = entry.path().strip_prefix(&resource_dir).map_or_else(
                |_| entry_name.clone(),
                |p| p.to_string_lossy().replace('\\', "/"),
            );
            let ext = ext_of(&entry_name);
            resources.push(json!({
                "type": resource_type_from_ext(&ext),
                "fileName": entry_name,
                "relativePath": format!("/api/exports/files/{encoded}/resources/{relative}"),
                "size": meta.len(),
                "mimeType": mime_type_from_ext(&ext),
            }));
        }
    }
    resources
        .sort_by_key(|r| std::cmp::Reverse(r.get("size").and_then(Value::as_i64).unwrap_or(0)));

    response::success(json!({ "resources": resources }), &request_id)
}


// GET /api/resources/files


/// `nameSearch` 子串最大长度。
const MAX_NAME_SEARCH_LENGTH: usize = 200;

fn normalize_name_search(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let truncated: String = trimmed.chars().take(MAX_NAME_SEARCH_LENGTH).collect();
    let lower = truncated.to_lowercase();
    if lower.is_empty() {
        None
    } else {
        Some(lower)
    }
}

/// 获取全局资源文件列表（画廊浏览）。
pub async fn global_resource_files(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let type_filter = params.get("type").map_or("all", String::as_str);
    let page = params
        .get("page")
        .and_then(|p| p.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(50)
        .max(1);
    let name_search = normalize_name_search(params.get("nameSearch").map(String::as_str));

    let resources_dir = state.path_manager.resources_dir();
    let mut dirs_to_scan: Vec<(&str, &str)> = Vec::new();
    if type_filter == "all" || type_filter == "images" {
        dirs_to_scan.push(("images", "image"));
    }
    if type_filter == "all" || type_filter == "videos" {
        dirs_to_scan.push(("videos", "video"));
    }
    if type_filter == "all" || type_filter == "audios" {
        dirs_to_scan.push(("audios", "audio"));
    }
    if type_filter == "all" || type_filter == "files" {
        dirs_to_scan.push(("files", "file"));
    }

    let mut files: Vec<Value> = Vec::new();
    for (dir_name, resource_type) in dirs_to_scan {
        let dir = resources_dir.join(dir_name);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            if let Some(term) = &name_search {
                if !entry_name.to_lowercase().contains(term) {
                    continue;
                }
            }
            let Ok(meta) = entry.metadata() else { continue };
            let ext = ext_of(&entry_name);
            let modify_time = meta.modified().map(iso).unwrap_or_default();
            files.push(json!({
                "type": resource_type,
                "fileName": entry_name,
                "url": format!("/resources/{resource_type}s/{entry_name}"),
                "size": meta.len(),
                "mimeType": mime_type_from_ext(&ext),
                "modifyTime": modify_time,
            }));
        }
    }

    files.sort_by(|a, b| {
        let time_a = a.get("modifyTime").and_then(Value::as_str).unwrap_or("");
        let time_b = b.get("modifyTime").and_then(Value::as_str).unwrap_or("");
        time_b.cmp(time_a)
    });

    let total = files.len();
    let start_index = (page - 1) * limit;
    let paginated: Vec<Value> = files.into_iter().skip(start_index).take(limit).collect();

    response::success(
        json!({
            "files": paginated,
            "total": total,
            "page": page,
            "limit": limit,
            "hasMore": start_index + limit < total,
        }),
        &request_id,
    )
}


// GET /api/download-file（Issue #192）


/// 动态下载 API（自定义导出路径的文件下载，含路径安全校验）。
pub async fn download_file(
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(raw_path) = params.get("path").filter(|p| !p.is_empty()) else {
        let err = ApiError::validation("缺少文件路径参数", "MISSING_PATH");
        return response::error(&err, &request_id);
    };

    let permission_err = |message: &str, code: &str| {
        ApiError::new(ErrorType::Api, message, code).with_status(StatusCode::FORBIDDEN)
    };

    // 安全检查：危险字符（规范化前后各查一次）。
    if raw_path.contains("..") || raw_path.contains('\0') || raw_path.contains("%00") {
        return response::error(
            &permission_err("非法的文件路径", "INVALID_PATH"),
            &request_id,
        );
    }
    let normalized = PathBuf::from(raw_path);
    if normalized
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return response::error(
            &permission_err("非法的文件路径", "INVALID_PATH"),
            &request_id,
        );
    }

    // 只允许下载导出文件扩展名。
    let ext = ext_of(raw_path);
    let allowed = [".json", ".html", ".txt", ".xlsx", ".zip", ".jsonl"];
    if !allowed.contains(&ext.as_str()) {
        return response::error(
            &permission_err("不允许下载此类型的文件", "FORBIDDEN_FILE_TYPE"),
            &request_id,
        );
    }

    if !normalized.is_absolute() {
        return response::error(
            &permission_err("必须使用绝对路径", "RELATIVE_PATH_NOT_ALLOWED"),
            &request_id,
        );
    }

    let Ok(meta) = std::fs::metadata(&normalized) else {
        let err = ApiError::new(ErrorType::FileSystem, "文件不存在", "FILE_NOT_FOUND")
            .with_status(StatusCode::NOT_FOUND);
        return response::error(&err, &request_id);
    };
    if !meta.is_file() {
        let err = ApiError::validation("路径不是文件", "NOT_A_FILE");
        return response::error(&err, &request_id);
    }

    let file_name = normalized
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let content_type = match ext.as_str() {
        ".json" => "application/json",
        ".html" => "text/html",
        ".txt" => "text/plain",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".zip" => "application/zip",
        ".jsonl" => "application/x-ndjson",
        _ => "application/octet-stream",
    };

    let Ok(bytes) = tokio::fs::read(&normalized).await else {
        let err = ApiError::new(ErrorType::FileSystem, "文件读取失败", "FILE_READ_ERROR");
        return response::error(&err, &request_id);
    };

    let disposition = format!(
        "attachment; filename*=UTF-8''{}",
        encode_uri_component(&file_name)
    );
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        bytes,
    )
        .into_response()
}


// POST /api/open-file-location / /api/open-export-directory


fn extract_html_time_range(html: &str) -> Option<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(
            r#"(?s)(?:时间范围|范围).*?class\s*=\s*["'][^"']*(?:info-value|meta-value)[^"']*["'][^>]*>\s*([^<]+)<"#,
        )
        .expect("valid time range regex")
    });
    re.captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().trim().to_string())
}

#[cfg(any(test, target_os = "windows"))]
fn windows_explorer_args(target: &FsPath, select_file: bool) -> Vec<std::ffi::OsString> {
    let path = target.to_string_lossy().replace('/', "\\");
    if select_file {
        vec!["/select,".into(), path.into()]
    } else {
        vec![path.into()]
    }
}

fn open_in_file_manager(target: &FsPath, select_file: bool) {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        cmd.args(windows_explorer_args(target, select_file));
        let _ = cmd.spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if select_file {
            cmd.arg("-R");
        }
        cmd.arg(target);
        let _ = cmd.spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let dir = if select_file {
            target
                .parent()
                .map_or_else(|| target.to_path_buf(), FsPath::to_path_buf)
        } else {
            target.to_path_buf()
        };
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }
}

fn should_select_in_file_manager(target: &FsPath) -> bool {
    !target.is_dir()
}

/// 打开文件所在位置（文件管理器中选中该文件）。
pub async fn open_file_location(
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let Some(file_path) = body
        .get("filePath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
    else {
        let err = ApiError::validation("缺少文件路径参数", "MISSING_FILE_PATH");
        return response::error(&err, &request_id);
    };
    let path = PathBuf::from(file_path);
    if !path.exists() {
        let err = ApiError::validation("文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    }
    open_in_file_manager(&path, should_select_in_file_manager(&path));
    response::success(json!({ "message": "已打开文件位置" }), &request_id)
}

/// 打开导出目录。
pub async fn open_export_directory(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let export_dir = state.path_manager.exports_dir();
    let _ = std::fs::create_dir_all(&export_dir);
    open_in_file_manager(&export_dir, false);
    response::success(
        json!({ "message": "已打开导出目录", "path": export_dir.to_string_lossy() }),
        &request_id,
    )
}


// 手动导出文件名解析（Issue #163）


/// 手动导出文件名解析结果。
struct ManualExportInfo {
    chat_type: String,
    peer_uid: String,
    session_name: Option<String>,
    timestamp: Option<String>,
}

/// 解析手动导出文件名（新旧三种命名格式）。
fn parse_manual_export_file_name(file_name: &str) -> Option<ManualExportInfo> {
    static RE_FRIENDLY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_friendly = RE_FRIENDLY.get_or_init(|| {
        regex::Regex::new(r"^(.+?)\((\d+)\)(?:_(\d{8})_(\d{6,9})(?:_\d+)?)?\.(html|json)$")
            .expect("valid regex")
    });

    // `<safeName>(<uid>).<ext>`（旧友好命名无法区分 friend/group，默认 friend）。
    if let Some(caps) = re_friendly.captures(file_name) {
        let timestamp = match (caps.get(3), caps.get(4)) {
            (Some(date), Some(time)) => Some(format!("{}-{}", date.as_str(), time.as_str())),
            _ => None,
        };
        return Some(ManualExportInfo {
            chat_type: "friend".to_string(),
            peer_uid: caps[2].to_string(),
            session_name: Some(caps[1].to_string()),
            timestamp,
        });
    }

    let stem = file_name
        .strip_suffix(".html")
        .or_else(|| file_name.strip_suffix(".json"))?;
    let (chat_type, peer_uid, timestamp, session_name) = parse_base_name(stem)?;
    Some(ManualExportInfo {
        chat_type,
        peer_uid,
        session_name,
        timestamp: Some(timestamp),
    })
}


// GET /api/merge-resources/available-tasks


/// 获取可用于合并的备份列表（定时备份 + 手动导出，按会话分组）。
pub async fn merge_available_tasks(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    // 1. 定时备份：任务名_时间戳.格式。
    static RE_SCHEDULED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_scheduled = RE_SCHEDULED.get_or_init(|| {
        regex::Regex::new(r"^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(html|json)$")
            .expect("valid regex")
    });

    let mut scheduled_groups: HashMap<String, Vec<Value>> = HashMap::new();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();
    if let Ok(entries) = std::fs::read_dir(&scheduled_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".html") && !name.ends_with(".json") {
                continue;
            }
            let Some(caps) = re_scheduled.captures(&name) else {
                continue;
            };
            let Ok(meta) = entry.metadata() else { continue };
            let created_at = meta.modified().map(iso).unwrap_or_default();
            scheduled_groups
                .entry(caps[1].to_string())
                .or_default()
                .push(json!({
                    "fileName": name,
                    "taskName": &caps[1],
                    "timestamp": &caps[2],
                    "createdAt": created_at,
                    "fileSize": meta.len(),
                }));
        }
    }

    let mut scheduled_tasks: Vec<Value> = scheduled_groups
        .into_iter()
        .map(|(task_name, mut backups)| {
            backups.sort_by(|a, b| {
                let time_a = a.get("createdAt").and_then(Value::as_str).unwrap_or("");
                let time_b = b.get("createdAt").and_then(Value::as_str).unwrap_or("");
                time_b.cmp(time_a)
            });
            let latest = backups.first().cloned().unwrap_or(Value::Null);
            json!({
                "taskName": task_name,
                "backupCount": backups.len(),
                "backups": backups,
                "latestBackup": latest,
            })
        })
        .collect();
    scheduled_tasks.sort_by(|a, b| {
        let time_a = a
            .pointer("/latestBackup/createdAt")
            .and_then(Value::as_str)
            .unwrap_or("");
        let time_b = b
            .pointer("/latestBackup/createdAt")
            .and_then(Value::as_str)
            .unwrap_or("");
        time_b.cmp(time_a)
    });

    // 2. Issue #163：手动导出按会话分组。
    let mut manual_groups: HashMap<String, Vec<Value>> = HashMap::new();
    let manual_dir = state.path_manager.exports_dir();
    if let Ok(entries) = std::fs::read_dir(&manual_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".html") && !name.ends_with(".json") {
                continue;
            }
            let Some(info) = parse_manual_export_file_name(&name) else {
                continue;
            };
            let ManualExportInfo {
                chat_type,
                peer_uid,
                session_name,
                timestamp,
            } = info;
            let Ok(meta) = entry.metadata() else { continue };
            let created_at = meta.modified().map(iso).unwrap_or_default();
            let fallback_ts = created_at.replace(['-', ':', 'T'], "");
            let fallback_ts = fallback_ts.chars().take(14).collect::<String>();
            let group_key = format!("{chat_type}_{peer_uid}");
            manual_groups.entry(group_key.clone()).or_default().push(json!({
                "fileName": name,
                "taskName": session_name.clone().unwrap_or_else(|| format!("{chat_type}_{peer_uid}")),
                "chatType": chat_type,
                "peerUid": peer_uid,
                "sessionName": session_name,
                "timestamp": timestamp.unwrap_or(fallback_ts),
                "createdAt": created_at,
                "fileSize": meta.len(),
                "groupKey": group_key,
            }));
        }
    }

    let mut manual_tasks: Vec<Value> = manual_groups
        .into_iter()
        .map(|(group_key, mut backups)| {
            backups.sort_by(|a, b| {
                let time_a = a.get("createdAt").and_then(Value::as_str).unwrap_or("");
                let time_b = b.get("createdAt").and_then(Value::as_str).unwrap_or("");
                time_b.cmp(time_a)
            });
            let latest = backups.first().cloned().unwrap_or(Value::Null);
            let named = backups
                .iter()
                .find(|it| it.get("sessionName").and_then(Value::as_str).is_some());
            let task_name = named
                .and_then(|it| it.get("sessionName").and_then(Value::as_str))
                .map_or_else(
                    || {
                        latest
                            .get("taskName")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string()
                    },
                    String::from,
                );
            json!({
                "groupKey": group_key,
                "taskName": task_name,
                "chatType": latest.get("chatType").cloned(),
                "peerUid": latest.get("peerUid").cloned(),
                "backupCount": backups.len(),
                "backups": backups,
                "latestBackup": latest,
            })
        })
        .collect();
    manual_tasks.sort_by(|a, b| {
        let time_a = a
            .pointer("/latestBackup/createdAt")
            .and_then(Value::as_str)
            .unwrap_or("");
        let time_b = b
            .pointer("/latestBackup/createdAt")
            .and_then(Value::as_str)
            .unwrap_or("");
        time_b.cmp(time_a)
    });

    response::success(
        json!({ "scheduledTasks": scheduled_tasks, "manualTasks": manual_tasks }),
        &request_id,
    )
}


// POST /api/merge-resources（ResourceMerger 移植）


struct MergeSource {
    html_file: PathBuf,
    json_file: Option<PathBuf>,
    resource_dir: PathBuf,
}

fn broadcast_merge_progress(
    state: &SharedState,
    phase: &str,
    current: usize,
    total: usize,
    message: &str,
) {
    let percentage = if total > 0 {
        ((current as f64 / total as f64) * 100.0).round() as i64
    } else {
        0
    };
    state.broadcast_ws(&json!({
        "type": "merge-progress",
        "data": {
            "phase": phase,
            "current": current,
            "total": total,
            "percentage": percentage,
            "message": message,
        },
    }));
}

fn validate_merge_sources(
    state: &SharedState,
    file_names: &[String],
) -> Result<Vec<MergeSource>, String> {
    let export_dir = state.path_manager.exports_dir();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();
    let mut sources = Vec::new();

    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\.(html|json)$").expect("valid regex"));

    for file_name in file_names {
        let export_path = export_dir.join(file_name);
        let scheduled_path = scheduled_dir.join(file_name);
        let (found_path, task_dir) = if export_path.exists() {
            (export_path, &export_dir)
        } else if scheduled_path.exists() {
            (scheduled_path, &scheduled_dir)
        } else {
            return Err(format!(
                "未找到文件: {file_name}（已搜索exports和scheduled-exports目录）"
            ));
        };

        let base_name = re.replace(file_name, "").into_owned();
        let json_file = format!("{base_name}.json");
        let json_in_exports = export_dir.join(&json_file);
        let json_in_scheduled = scheduled_dir.join(&json_file);
        let json_path = if json_in_exports.exists() {
            Some(json_in_exports)
        } else if json_in_scheduled.exists() {
            Some(json_in_scheduled)
        } else {
            None
        };

        sources.push(MergeSource {
            html_file: found_path,
            json_file: json_path,
            resource_dir: task_dir.join(format!("resources_{base_name}")),
        });
    }
    Ok(sources)
}

fn merge_source_messages(sources: &[MergeSource], deduplicate: bool) -> (Vec<Value>, usize) {
    let mut all_messages: Vec<Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deduplicated = 0usize;

    for source in sources {
        let Some(json_path) = &source.json_file else {
            continue;
        };
        let Ok(content) = std::fs::read_to_string(json_path) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<Value>(&content) else {
            continue;
        };
        let Some(messages) = data.get("messages").and_then(Value::as_array) else {
            continue;
        };
        for message in messages {
            if deduplicate {
                let id = message.get("id").and_then(Value::as_str).unwrap_or("");
                let ts = message
                    .get("timestamp")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let key = format!("{id}_{ts}");
                if !seen.insert(key) {
                    deduplicated += 1;
                    continue;
                }
            }
            all_messages.push(message.clone());
        }
    }

    all_messages.sort_by_key(|m| {
        m.get("timestamp")
            .and_then(Value::as_i64)
            .or_else(|| m.get("time").and_then(Value::as_i64))
            .unwrap_or(0)
    });
    (all_messages, deduplicated)
}

fn md5_of_file(path: &FsPath) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Md5::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

fn merge_resource_files(
    sources: &[MergeSource],
    output_path: &FsPath,
) -> Result<(usize, Vec<(String, String)>), String> {
    let target_resource_path = output_path.join("resources");
    for type_name in ["images", "videos", "audios", "files"] {
        std::fs::create_dir_all(target_resource_path.join(type_name))
            .map_err(|e| format!("创建资源目录失败: {e}"))?;
    }

    let mut copied: HashMap<String, String> = HashMap::new();
    let mut mapping: Vec<(String, String)> = Vec::new();
    let mut total = 0usize;

    for source in sources {
        if !source.resource_dir.exists() {
            continue;
        }
        for type_name in ["images", "videos", "audios", "files"] {
            let source_dir = source.resource_dir.join(type_name);
            let Ok(entries) = std::fs::read_dir(&source_dir) else {
                continue;
            };
            for entry in entries.flatten() {
                if !entry.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                let source_path = entry.path();
                let Some(md5) = md5_of_file(&source_path) else {
                    continue;
                };
                if copied.contains_key(&md5) {
                    continue;
                }
                let file_name = entry.file_name().to_string_lossy().into_owned();
                let target = target_resource_path.join(type_name).join(&file_name);
                if std::fs::copy(&source_path, &target).is_err() {
                    continue;
                }
                let relative = format!("resources/{type_name}/{file_name}");
                copied.insert(md5.clone(), relative.clone());
                mapping.push((md5, relative));
                total += 1;
            }
        }
    }
    Ok((total, mapping))
}

async fn write_merged_data(
    output_path: &FsPath,
    messages: &[Value],
    mapping: &[(String, String)],
) -> Result<(PathBuf, PathBuf), String> {
    tokio::fs::create_dir_all(output_path)
        .await
        .map_err(|e| format!("创建输出目录失败: {e}"))?;

    let timestamp = Utc::now()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        .replace([':', '.'], "-")
        .chars()
        .take(19)
        .collect::<String>();

    // 1. JSON。
    let json_path = output_path.join(format!("merged_{timestamp}.json"));
    let json_data = json!({
        "metadata": {
            "mergedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "messageCount": messages.len(),
            "resourceCount": mapping.len(),
        },
        "messages": messages,
        "resources": mapping.iter().map(|(md5, path)| json!({ "md5": md5, "path": path })).collect::<Vec<_>>(),
    });
    let json_text = serde_json::to_string_pretty(&json_data).map_err(|e| e.to_string())?;
    tokio::fs::write(&json_path, json_text)
        .await
        .map_err(|e| format!("写入JSON失败: {e}"))?;

    // 2. HTML（失败时仅保留 JSON）。
    let html_path = output_path.join(format!("merged_{timestamp}.html"));
    let clean_messages: Vec<CleanMessage> = messages
        .iter()
        .filter_map(|m| serde_json::from_value(m.clone()).ok())
        .collect();
    let chat_info = ChatInfo {
        name: "合并的聊天记录".to_string(),
        chat_type: "group".to_string(),
        self_name: Some("合并导出".to_string()),
        ..ChatInfo::default()
    };
    let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
        output_path: html_path.clone(),
        include_resource_links: true,
        include_system_messages: true,
        exporter_version: Some(crate::version::VERSION.get().to_string()),
        ..HtmlExportOptions::default()
    });
    let html_result = exporter
        .export_single_inline(&clean_messages, &chat_info)
        .await;
    let final_html = if html_result.is_ok() {
        html_path
    } else {
        PathBuf::new()
    };
    Ok((json_path, final_html))
}

fn cleanup_merge_sources(sources: &[MergeSource]) {
    for source in sources {
        let _ = std::fs::remove_file(&source.html_file);
        if let Some(json_path) = &source.json_file {
            let _ = std::fs::remove_file(json_path);
        }
        if source.resource_dir.exists() {
            let _ = std::fs::remove_dir_all(&source.resource_dir);
        }
    }
}

/// 合并多个备份任务的资源为单一资源。
pub async fn merge_resources(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let source_task_ids: Vec<String> = body
        .get("sourceTaskIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if source_task_ids.len() < 2 {
        let err = ApiError::validation("至少需要选择2个任务进行合并", "INVALID_SOURCE_TASKS");
        return response::error(&err, &request_id);
    }
    let delete_source_files = body
        .get("deleteSourceFiles")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let deduplicate = body
        .get("deduplicateMessages")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let output_path = body
        .get("outputPath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .map_or_else(
            || state.path_manager.default_base_dir().join("merged"),
            PathBuf::from,
        );

    let start_time = std::time::Instant::now();
    let merge_task_id = format!(
        "merge_{}_{}",
        Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..7]
    );

    // Phase 1: 验证源文件。
    let total = source_task_ids.len();
    broadcast_merge_progress(&state, "validate", 0, total, "验证源文件...");
    let sources = match validate_merge_sources(&state, &source_task_ids) {
        Ok(sources) => sources,
        Err(message) => {
            let err = ApiError::validation(message, "MERGE_SOURCE_NOT_FOUND");
            return response::error(&err, &request_id);
        }
    };
    broadcast_merge_progress(&state, "validate", total, total, "源文件验证完成");

    // Phase 2: 合并消息。
    broadcast_merge_progress(&state, "merge", 0, 100, "读取消息数据...");
    let (messages, deduplicated) = merge_source_messages(&sources, deduplicate);
    broadcast_merge_progress(
        &state,
        "merge",
        50,
        100,
        &format!("合并消息完成，共 {} 条", messages.len()),
    );

    // Phase 3: 合并资源文件。
    broadcast_merge_progress(&state, "resources", 0, 100, "合并资源文件...");
    let (resource_count, mapping) = match merge_resource_files(&sources, &output_path) {
        Ok(result) => result,
        Err(message) => {
            let err = ApiError::internal(message, "MERGE_RESOURCES_FAILED");
            return response::error(&err, &request_id);
        }
    };
    broadcast_merge_progress(
        &state,
        "resources",
        100,
        100,
        &format!("资源文件合并完成，共 {resource_count} 个文件"),
    );

    // Phase 4: 写入合并数据。
    broadcast_merge_progress(&state, "write", 0, 100, "写入合并数据...");
    let (json_path, html_path) = match write_merged_data(&output_path, &messages, &mapping).await {
        Ok(paths) => paths,
        Err(message) => {
            let err = ApiError::internal(message, "MERGE_WRITE_FAILED");
            return response::error(&err, &request_id);
        }
    };
    broadcast_merge_progress(&state, "write", 100, 100, "数据写入完成");

    // Phase 5: 清理源文件。
    if delete_source_files {
        broadcast_merge_progress(&state, "cleanup", 0, total, "清理源文件...");
        cleanup_merge_sources(&sources);
        broadcast_merge_progress(&state, "cleanup", total, total, "清理完成");
    }

    let (_, total_size) = scan_directory_stats(&output_path);
    let result = json!({
        "mergeTaskId": merge_task_id,
        "outputPath": output_path.to_string_lossy(),
        "jsonPath": json_path.to_string_lossy(),
        "htmlPath": html_path.to_string_lossy(),
        "sourceCount": total,
        "totalMessages": messages.len(),
        "deduplicatedMessages": deduplicated,
        "totalResources": resource_count,
        "totalSize": total_size,
        "mergeTime": start_time.elapsed().as_millis() as i64,
        "completedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
    response::success(json!({ "result": result }), &request_id)
}

#[cfg(test)]
mod metadata_tests {
    use super::{
        apply_file_metadata, avatar_url, extract_html_time_range, parse_export_file_name,
        parse_manifest_metadata, parse_manual_export_file_name, should_select_in_file_manager,
        valid_export_file_name, windows_explorer_args,
    };
    use serde_json::json;
    use std::fs;

    #[test]
    fn private_avatar_rejects_uid_and_zero_values() {
        assert!(avatar_url("friend", "u_peer").is_none());
        assert!(avatar_url("friend", "0").is_none());
        assert!(avatar_url("friend", "1687657986").is_some());
    }

    #[test]
    fn export_file_name_rejects_traversal_and_absolute_paths() {
        assert!(valid_export_file_name("friend_123_20260713_002703.html"));
        for invalid in [
            "../etc/passwd",
            "..\\Windows\\win.ini",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "nested/file.html",
            "nested\\file.html",
            "",
        ] {
            assert!(!valid_export_file_name(invalid), "{invalid}");
        }
    }

    #[test]
    fn modern_chunked_manifest_supplies_peer_avatar_metadata() {
        let manifest = json!({
            "chat": {
                "name": "笨蛋Darf v2",
                "peerUid": "u_peer",
                "peerUin": "1687657986"
            },
            "stats": { "totalMessages": 3538 }
        });
        let mut file = json!({});
        apply_file_metadata(&mut file, parse_manifest_metadata(&manifest));
        assert_eq!(file["displayName"], "笨蛋Darf v2");
        assert_eq!(file["messageCount"], 3538);
        assert_eq!(file["peerUid"], "u_peer");
        assert_eq!(file["peerUin"], "1687657986");
        assert_eq!(
            file["avatarUrl"],
            "https://q1.qlogo.cn/g?b=qq&nk=1687657986&s=100"
        );
    }

    #[test]
    fn file_manager_selects_files_but_opens_directories() {
        let base = std::env::temp_dir().join(format!(
            "qce-open-location-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let file = base.join("export.html");
        fs::create_dir_all(&base).unwrap();
        fs::write(&file, b"test").unwrap();

        assert!(!should_select_in_file_manager(&base));
        assert!(should_select_in_file_manager(&file));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn explorer_receives_select_switch_separately_from_unicode_path() {
        let target = std::path::Path::new(
            "C:/Users/QCE/Documents/AxT 鸽子窝_960420904_群头像_20260712_163632.zip",
        );
        let args = windows_explorer_args(target, true);
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "/select,");
        assert_eq!(
            args[1],
            r"C:\Users\QCE\Documents\AxT 鸽子窝_960420904_群头像_20260712_163632.zip"
        );

        let directory_args = windows_explorer_args(target.parent().unwrap(), false);
        assert_eq!(directory_args.len(), 1);
        assert_eq!(directory_args[0], r"C:\Users\QCE\Documents");
    }

    #[test]
    fn time_range_metadata_accepts_old_and_new_labels() {
        let old = r#"<span>时间范围</span><div class="info-value">old range</div>"#;
        let new = r#"<span class="meta-label">范围</span><span class="meta-value" id="info-range">new range</span>"#;
        assert_eq!(extract_html_time_range(old).as_deref(), Some("old range"));
        assert_eq!(extract_html_time_range(new).as_deref(), Some("new range"));

        let reordered = r#"
            <span data-kind="range" class="meta-label">范围</span>
            <span id="info-range" data-extra="yes" class='value meta-value compact'>
                reordered range
            </span>
        "#;
        assert_eq!(
            extract_html_time_range(reordered).as_deref(),
            Some("reordered range")
        );
    }

    #[test]
    fn filename_parsers_accept_legacy_and_millisecond_names() {
        let legacy =
            parse_export_file_name("friend_u_UPWhwEIrK6nqDmJUmoYq3Q_20260713_002703.html").unwrap();
        assert_eq!(legacy["chatId"], "u_UPWhwEIrK6nqDmJUmoYq3Q");

        let modern =
            parse_export_file_name("friend_笨蛋Darf_v2_1687657986_20260713_002703456.html")
                .unwrap();
        assert_eq!(modern["chatId"], "1687657986");
        assert_eq!(modern["displayName"], "笨蛋Darf v2");
        assert_eq!(modern["exportDate"], "2026-07-13 00:27:03");

        let duplicate =
            parse_manual_export_file_name("group_AxT_鸽子窝_960420904_20260713_002703456_2.json")
                .unwrap();
        assert_eq!(duplicate.chat_type, "group");
        assert_eq!(duplicate.peer_uid, "960420904");
        assert_eq!(duplicate.session_name.as_deref(), Some("AxT 鸽子窝"));

        let uid_fallback = parse_manual_export_file_name(
            "friend_联系人_u_UPWhwEIrK6nqDmJUmoYq3Q_20260713_002703456.html",
        )
        .unwrap();
        assert_eq!(uid_fallback.peer_uid, "u_UPWhwEIrK6nqDmJUmoYq3Q");
        assert_eq!(uid_fallback.session_name.as_deref(), Some("联系人"));
    }
}
