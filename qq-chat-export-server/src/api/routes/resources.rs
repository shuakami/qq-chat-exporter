use std::collections::{HashMap, HashSet};
use std::path::{Path as FsPath, PathBuf};

use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use md5::{Digest, Md5};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;

use qce_exporter::modern_html_exporter::{HtmlExportOptions, ModernHtmlExporter};
use qce_exporter::types::{ChatInfo, CleanMessage};

use crate::api::middleware::PREVIEW_TOKEN_COOKIE;
use crate::api::path_security::{
    open_verified_file, resolve_existing_exact, resolve_existing_within,
    resolve_for_creation_within, valid_relative_resource_path,
};
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::paths::sanitize_task_name;

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

fn is_merged_base_name(base_name: &str) -> bool {
    base_name
        .get(.."merged_".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("merged_"))
}

fn find_sibling_file_ci(base_dir: &FsPath, base_name: &str, extension: &str) -> Option<PathBuf> {
    let expected = format!("{base_name}.{extension}");
    let exact = base_dir.join(&expected);
    let candidate = if exact.is_file() {
        exact
    } else {
        std::fs::read_dir(base_dir)
            .ok()?
            .flatten()
            .find(|entry| {
                entry.file_type().is_ok_and(|kind| kind.is_file())
                    && entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&expected)
            })
            .map(|entry| entry.path())?
    };
    let resolved = candidate.canonicalize().ok()?;
    let canonical_base = base_dir.canonicalize().ok()?;
    resolved.starts_with(canonical_base).then_some(resolved)
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
        && !file_name.contains(['/', '\\'])
        && !file_name.contains('\0')
}

struct ResolvedExportFile {
    path: PathBuf,
    base_dir: PathBuf,
    is_scheduled: bool,
    is_merged: bool,
}

/// Resolves an existing export file inside a single base directory without
/// permitting traversal or symlink escape.
fn resolve_within_base(
    base_dir: PathBuf,
    is_scheduled: bool,
    is_merged: bool,
    file_name: &str,
) -> Option<ResolvedExportFile> {
    if !valid_export_file_name(file_name) {
        return None;
    }

    let candidate = base_dir.join(file_name);
    if !candidate.is_file() {
        return None;
    }
    let (Ok(path), Ok(canonical_base)) = (candidate.canonicalize(), base_dir.canonicalize()) else {
        return None;
    };
    if path.starts_with(&canonical_base) {
        return Some(ResolvedExportFile {
            path,
            base_dir,
            is_scheduled,
            is_merged,
        });
    }
    None
}

/// Resolves an existing top-level export file without permitting traversal or symlink escape.
fn resolve_export_file(state: &SharedState, file_name: &str) -> Option<ResolvedExportFile> {
    resolve_within_base(state.path_manager.exports_dir(), false, false, file_name).or_else(|| {
        resolve_within_base(
            state.path_manager.scheduled_exports_dir(),
            true,
            false,
            file_name,
        )
    })
}

/// Resolves an existing merged export file under `exports/merged`（不进普通导出目录）。
fn resolve_merged_export_file(state: &SharedState, file_name: &str) -> Option<ResolvedExportFile> {
    resolve_within_base(
        state.path_manager.merged_exports_dir(),
        false,
        true,
        file_name,
    )
}

/// Resolves a top-level export file first, then falls back to the merged directory.
fn resolve_export_or_merged_file(
    state: &SharedState,
    file_name: &str,
) -> Option<ResolvedExportFile> {
    resolve_export_file(state, file_name).or_else(|| resolve_merged_export_file(state, file_name))
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
        .and_then(Value::as_i64)
        .or_else(|| {
            data.pointer("/metadata/messageCount")
                .and_then(Value::as_i64)
        });
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
        peer_uid: metadata_string(&data, "/chatInfo/peerUid")
            .or_else(|| metadata_string(&data, "/metadata/chatId")),
        peer_uin: metadata_string(&data, "/chatInfo/peerUin"),
        avatar_url: metadata_string(&data, "/chatInfo/avatar")
            .or_else(|| metadata_string(&data, "/metadata/avatarUrl")),
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

fn merged_resource_dir_for_file(merged_dir: &FsPath, base_name: &str) -> Option<PathBuf> {
    let isolated = merged_resource_dir(merged_dir, base_name);
    if isolated.is_dir() {
        Some(isolated)
    } else {
        let shared = merged_dir.join("resources");
        shared.is_dir().then_some(shared)
    }
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

/// 扫描合并导出目录 `exports/merged`，把识别出的合并产物（HTML/JSON 一对）加入 `files`。
async fn scan_merged_export_dir(state: &SharedState, files: &mut Vec<Value>) {
    let merged_dir = state.path_manager.merged_exports_dir();
    let Ok(entries) = std::fs::read_dir(&merged_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some(parsed) = parse_merged_export_file_name(&file_name) else {
            continue;
        };
        let file_path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }

        let MergedExportName {
            format,
            timestamp,
            chat_type,
            display_name,
        } = parsed;
        let is_json = format == "json";
        let display_time = merged_export_display_time(&timestamp);
        let mut file_info = json!({
            "chatType": chat_type,
            "chatId": "merged",
            "displayName": display_name,
            "exportDate": display_time,
            "description": format!("合并于 {display_time}"),
            "format": if is_json { "JSON" } else { "HTML" },
        });
        // JSON 全量解析;HTML 只读 4KB 头部 QCE_METADATA(含 messageCount/avatarUrl/peerUid)。
        let metadata = if is_json {
            parse_json_metadata(&file_path)
        } else {
            parse_html_metadata(&file_path)
        };
        // 聊天对象 ID 来自产物元数据(旧格式无此字段时保持 "merged"),
        // friend + u_xxx 的行随后由 fix_avatar_urls 走 UID→UIN 映射补头像。
        if let Some(peer_uid) = &metadata.peer_uid {
            file_info["chatId"] = json!(peer_uid);
        }
        apply_file_metadata(&mut file_info, metadata);

        let (create_time, modify_time) = file_times(&meta);
        let mut item = json!({
            "fileName": file_name,
            "filePath": file_path.to_string_lossy(),
            "relativePath": format!("/downloads/merged/{file_name}"),
            "size": meta.len(),
            "createTime": create_time,
            "modifyTime": modify_time,
            "isMerged": true,
        });
        if let (Some(obj), Some(extra)) = (item.as_object_mut(), file_info.as_object()) {
            for (key, value) in extra {
                obj.insert(key.clone(), value.clone());
            }
        }
        files.push(item);
    }
}

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
    scan_merged_export_dir(&state, &mut files).await;
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
    let Some(resolved) = resolve_export_or_merged_file(&state, &file_name) else {
        let err = ApiError::validation("导出文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };
    let file_path = resolved.path;
    let is_scheduled = resolved.is_scheduled;
    let is_merged = resolved.is_merged;
    let basic_info = if is_merged {
        parse_merged_export_file_name(&file_name).map(|parsed| {
            let MergedExportName {
                format,
                timestamp,
                chat_type,
                display_name,
            } = parsed;
            let is_json = format == "json";
            json!({
                "chatType": chat_type,
                "chatId": "merged",
                "displayName": display_name,
                "exportDate": merged_export_display_time(&timestamp),
                "format": if is_json { "JSON" } else { "HTML" },
            })
        })
    } else {
        parse_export_file_name(&file_name)
    };
    let Some(basic_info) = basic_info else {
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
                if let Some(time) = data
                    .pointer("/metadata/exportTime")
                    .and_then(Value::as_str)
                    .or_else(|| data.pointer("/metadata/mergedAt").and_then(Value::as_str))
                {
                    detailed.insert("exportTime".into(), json!(time));
                }
                if let Some(count) = data
                    .pointer("/statistics/totalMessages")
                    .and_then(Value::as_i64)
                    .or_else(|| {
                        data.pointer("/metadata/messageCount")
                            .and_then(Value::as_i64)
                    })
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
    } else if is_merged {
        "/downloads/merged"
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
        "isMerged": is_merged,
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
    let Some(resolved) = resolve_export_or_merged_file(&state, &file_name) else {
        let err = ApiError::validation("文件不存在", "FILE_NOT_FOUND");
        return response::error(&err, &request_id);
    };
    let base_dir = resolved.base_dir;

    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(?i)\.(html|json)$").expect("valid regex"));
    let base_name = re.replace(&file_name, "").into_owned();
    let html_path = find_sibling_file_ci(&base_dir, &base_name, "html")
        .unwrap_or_else(|| base_dir.join(format!("{base_name}.html")));
    let json_path = find_sibling_file_ci(&base_dir, &base_name, "json")
        .unwrap_or_else(|| base_dir.join(format!("{base_name}.json")));
    // 合并产物使用按文件隔离的资源目录；旧版共享目录不随单个文件删除。
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
    let Some(resolved) = resolve_export_or_merged_file(&state, &file_name) else {
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
            r#"(?P<attr>src|href)=\"(?:\./|\.\./)?resources(?:_[^/\"]+)?/(?P<path>[^\"]*)\""#,
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

    let mut resp = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::X_FRAME_OPTIONS, "SAMEORIGIN"),
            (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
        ],
        html,
    )
        .into_response();

    // 预览页把访问令牌写入 Cookie，让 iframe 内运行时渲染的资源子请求（带不上
    // `?token=`）也能通过认证。Path 固定到导出文件读接口前缀（编码无关，稳妥），
    // 配合 `SameSite=Strict` + `HttpOnly` 防跨站，且中间件只在该前缀下认 Cookie。
    if let Some(token) = params.get("token").filter(|token| !token.is_empty()) {
        let cookie = format!(
            "{PREVIEW_TOKEN_COOKIE}={}; Path=/api/exports/files/; Max-Age=86400; HttpOnly; SameSite=Strict",
            encode_uri_component(token)
        );
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            resp.headers_mut().append(header::SET_COOKIE, value);
        }
    }

    resp
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
    if cache.len() >= 256 && !cache.contains_key(dir_path) {
        cache.clear();
    }
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
    let resources_dir = state.path_manager.resources_dir();
    resolve_existing_within(&resources_dir.join(dir_path).join(actual), &[resources_dir])
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
    if !valid_relative_resource_path(&resource_path) {
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
    let resource_dir = if is_merged_base_name(base_name) {
        let merged_dir = state.path_manager.merged_exports_dir();
        merged_resource_dir_for_file(&merged_dir, base_name)
            .unwrap_or_else(|| merged_dir.join(&dir_name))
    } else {
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
        resource_dir
    };
    if !resource_dir.exists() {
        return None;
    }

    let candidate = resource_dir.join(resource_path);
    if candidate.is_file() {
        return resolve_existing_within(&candidate, std::slice::from_ref(&resource_dir));
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
            return resolve_existing_within(&entry.path(), std::slice::from_ref(&resource_dir));
        }
        if let Some(idx) = file_name.find('_') {
            if idx > 0 && file_name[idx + 1..] == short_name {
                return resolve_existing_within(&entry.path(), std::slice::from_ref(&resource_dir));
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
    let mut counted_resource_dirs: HashSet<PathBuf> = HashSet::new();
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
                    if counted_resource_dirs.insert(resource_dir) && resource_count > 0 {
                        total_resources += resource_count;
                        total_size += resource_size;
                        bump(&mut by_source, format, resource_count, resource_size);
                    }
                }
            }
        }
    }

    // 3. 扫描合并产物；HTML/JSON 成对存在时共享同一资源目录，只计入汇总一次。
    let merged_dir = state.path_manager.merged_exports_dir();
    let mut counted_merged_dirs: HashSet<PathBuf> = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&merged_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(parsed) = parse_merged_export_file_name(&name) else {
                continue;
            };
            let full_path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }

            let mut info = json!({
                "chatType": parsed.chat_type,
                "chatId": "merged",
                "displayName": parsed.display_name,
                "format": parsed.format,
            });
            let is_json = name.to_lowercase().ends_with(".json");
            let metadata = if is_json {
                parse_json_metadata(&full_path)
            } else {
                parse_html_metadata(&full_path)
            };
            if let Some(peer_uid) = &metadata.peer_uid {
                info["chatId"] = json!(peer_uid);
            }
            apply_file_metadata(&mut info, metadata);

            let base_name = html_json_re().replace(&name, "").into_owned();
            let resource_dir = merged_resource_dir_for_file(&merged_dir, &base_name);
            let (resource_count, resource_size) =
                resource_dir.as_deref().map_or((0, 0), scan_directory_stats);
            exports.push(json!({
                "fileName": name,
                "format": if is_json { "json" } else { "html" },
                "resourceCount": resource_count,
                "resourceSize": resource_size,
                "chatType": info.get("chatType").cloned(),
                "chatId": info.get("chatId").cloned(),
                "displayName": info.get("displayName").cloned(),
            }));

            let Some(resource_dir) = resource_dir else {
                continue;
            };
            if !counted_merged_dirs.insert(resource_dir.clone()) {
                continue;
            }
            if resource_count > 0 || resource_size > 0 {
                total_resources += resource_count;
                total_size += resource_size;
                bump(&mut by_source, "merged", resource_count, resource_size);
                for type_name in ["images", "videos", "audios", "files"] {
                    let (count, size) = scan_directory_stats(&resource_dir.join(type_name));
                    if count > 0 || size > 0 {
                        bump(&mut by_type, type_name, count, size);
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

    let resource_dir = if parse_merged_export_file_name(&file_name).is_some() {
        let merged_dir = state.path_manager.merged_exports_dir();
        merged_resource_dir_for_file(&merged_dir, &base_name)
            .unwrap_or_else(|| merged_dir.join(format!("resources_{base_name}")))
    } else {
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
        resource_dir
    };

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
        .clamp(1, 1_000_000);
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 200);
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
    let start_index = (page - 1).saturating_mul(limit);
    let paginated: Vec<Value> = files.into_iter().skip(start_index).take(limit).collect();

    response::success(
        json!({
            "files": paginated,
            "total": total,
            "page": page,
            "limit": limit,
            "hasMore": start_index.saturating_add(limit) < total,
        }),
        &request_id,
    )
}

// GET /api/download-file（Issue #192）

fn registered_export_task_paths(tasks: &HashMap<String, Value>) -> Vec<PathBuf> {
    tasks
        .values()
        .filter_map(|task| task.get("filePath").and_then(Value::as_str))
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect()
}

async fn resolve_registered_export_task_path(
    state: &SharedState,
    requested_path: &FsPath,
) -> Option<PathBuf> {
    let registered_paths = {
        let tasks = state.export_tasks.lock().await;
        registered_export_task_paths(&tasks)
    };
    resolve_existing_exact(requested_path, &registered_paths)
}

/// 动态下载 API（自定义导出路径的文件下载，含路径安全校验）。
pub async fn download_file(
    State(state): State<SharedState>,
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

    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
    ];
    let normalized = match resolve_existing_within(&normalized, &roots) {
        Some(path) => Some(path),
        None => resolve_registered_export_task_path(&state, &normalized).await,
    };
    let Some(normalized) = normalized else {
        return response::error(
            &permission_err("文件不在允许的导出目录内", "PATH_NOT_ALLOWED"),
            &request_id,
        );
    };

    let file = match open_verified_file(&normalized) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let err = ApiError::new(ErrorType::FileSystem, "文件不存在", "FILE_NOT_FOUND")
                .with_status(StatusCode::NOT_FOUND);
            return response::error(&err, &request_id);
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return response::error(
                &permission_err("文件路径在安全校验后发生变化", "PATH_NOT_ALLOWED"),
                &request_id,
            );
        }
        Err(_) => {
            let err = ApiError::new(ErrorType::FileSystem, "文件读取失败", "FILE_READ_ERROR");
            return response::error(&err, &request_id);
        }
    };
    let Ok(meta) = file.metadata() else {
        let err = ApiError::new(ErrorType::FileSystem, "文件读取失败", "FILE_READ_ERROR");
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

    let mut opened_file = tokio::fs::File::from_std(file);
    let mut bytes = Vec::new();
    if opened_file.read_to_end(&mut bytes).await.is_err() {
        let err = ApiError::new(ErrorType::FileSystem, "文件读取失败", "FILE_READ_ERROR");
        return response::error(&err, &request_id);
    }

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

fn file_manager_target_is_safe(target: &FsPath) -> bool {
    target.is_absolute()
        && std::fs::symlink_metadata(target)
            .is_ok_and(|metadata| !metadata.file_type().is_symlink())
        && target
            .canonicalize()
            .is_ok_and(|canonical| canonical == target)
}

fn unsafe_file_manager_target() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "file-manager target changed after path validation",
    )
}

fn open_in_file_manager(target: &FsPath, select_file: bool) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        cmd.args(windows_explorer_args(target, select_file));
        if !file_manager_target_is_safe(target) {
            return Err(unsafe_file_manager_target());
        }
        cmd.spawn().map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if select_file {
            cmd.arg("-R");
        }
        cmd.arg(target);
        if !file_manager_target_is_safe(target) {
            return Err(unsafe_file_manager_target());
        }
        cmd.spawn().map(|_| ())
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
        if !file_manager_target_is_safe(target) || !file_manager_target_is_safe(&dir) {
            return Err(unsafe_file_manager_target());
        }
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
    }
}

fn should_select_in_file_manager(target: &FsPath) -> bool {
    !target.is_dir()
}

/// 打开文件所在位置（文件管理器中选中该文件）。
pub async fn open_file_location(
    State(state): State<SharedState>,
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
    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
        state.path_manager.resources_dir(),
    ];
    let requested_path = PathBuf::from(file_path);
    let path = match resolve_existing_within(&requested_path, &roots) {
        Some(path) => Some(path),
        None => resolve_registered_export_task_path(&state, &requested_path).await,
    };
    let Some(path) = path else {
        let err = ApiError::validation("文件不在允许的导出目录内", "PATH_NOT_ALLOWED");
        return response::error(&err, &request_id);
    };
    if !file_manager_target_is_safe(&path) {
        let err = ApiError::validation("文件路径在安全校验后发生变化", "PATH_NOT_ALLOWED");
        return response::error(&err, &request_id);
    }
    if let Err(error) = open_in_file_manager(&path, should_select_in_file_manager(&path)) {
        let err = if error.kind() == std::io::ErrorKind::PermissionDenied {
            ApiError::validation("文件路径在安全校验后发生变化", "PATH_NOT_ALLOWED")
        } else {
            ApiError::new(
                ErrorType::FileSystem,
                format!("无法打开文件位置: {error}"),
                "OPEN_FILE_LOCATION_FAILED",
            )
        };
        return response::error(&err, &request_id);
    }
    response::success(json!({ "message": "已打开文件位置" }), &request_id)
}

/// 打开导出目录。
pub async fn open_export_directory(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let export_dir = state.path_manager.exports_dir();
    let _ = std::fs::create_dir_all(&export_dir);
    let _ = open_in_file_manager(&export_dir, false);
    response::success(json!({ "message": "已打开导出目录" }), &request_id)
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

/// 合并导出文件名解析结果。
struct MergedExportName {
    format: String,
    timestamp: String,
    chat_type: String,
    display_name: String,
}

/// 解析合并导出文件名。
///
/// 新格式(按聊天合并):`merged_{chatType}_{聊天名}_{YYYY-MM-DDTHH-MM-SS}.{html|json}`,
/// 同名冲突带 `_N` 后缀;旧格式:`merged_{YYYY-MM-DDTHH-MM-SS}.{html|json}`(历史产物,
/// 显示名「合并的聊天记录」,chatType 视为 group)。
fn parse_merged_export_file_name(file_name: &str) -> Option<MergedExportName> {
    static RE_NEW: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_new = RE_NEW.get_or_init(|| {
        regex::Regex::new(
            r"(?i)^merged_(friend|group)_(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:_\d+)?\.(html|json)$",
        )
        .expect("valid regex")
    });
    if let Some(caps) = re_new.captures(file_name) {
        return Some(MergedExportName {
            format: caps[4].to_lowercase(),
            timestamp: caps[3].to_string(),
            chat_type: caps[1].to_lowercase(),
            display_name: caps[2].replace('_', " "),
        });
    }

    static RE_LEGACY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_legacy = RE_LEGACY.get_or_init(|| {
        regex::Regex::new(r"(?i)^merged_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(html|json)$")
            .expect("valid regex")
    });
    let caps = re_legacy.captures(file_name)?;
    Some(MergedExportName {
        format: caps[2].to_lowercase(),
        timestamp: caps[1].to_string(),
        chat_type: "group".to_string(),
        display_name: "合并的聊天记录".to_string(),
    })
}

/// 把合并文件名时间戳 `YYYY-MM-DDTHH-MM-SS` 转为展示格式 `YYYY-MM-DD HH:MM:SS`。
fn merged_export_display_time(timestamp: &str) -> String {
    let (date, time) = timestamp.split_once('T').unwrap_or((timestamp, ""));
    format!("{date} {}", time.replace('-', ":"))
}

/// 生成合并导出文件名对(json/html 同一 base,保证成对);目标对任一存在则递增 `_N` 后缀(从 `_2` 起)。
fn merged_output_names(
    output_path: &FsPath,
    chat_type: &str,
    chat_name: &str,
    timestamp: &str,
) -> (String, String) {
    let base = format!(
        "merged_{chat_type}_{}_{timestamp}",
        sanitize_task_name(chat_name, 40)
    );
    let json_name = format!("{base}.json");
    let html_name = format!("{base}.html");
    let resource_dir = output_path.join(format!("resources_{base}"));
    if !output_path.join(&json_name).exists()
        && !output_path.join(&html_name).exists()
        && !resource_dir.exists()
    {
        return (json_name, html_name);
    }
    for suffix in 2u32..1000 {
        let json_name = format!("{base}_{suffix}.json");
        let html_name = format!("{base}_{suffix}.html");
        let resource_dir = output_path.join(format!("resources_{base}_{suffix}"));
        if !output_path.join(&json_name).exists()
            && !output_path.join(&html_name).exists()
            && !resource_dir.exists()
        {
            return (json_name, html_name);
        }
    }
    (format!("{base}.json"), format!("{base}.html"))
}

/// 定时备份文件名解析结果。
struct ScheduledExportInfo {
    /// 分组键：现行格式为 `{chatType}_{chatId}`；遗留格式为任务名。
    group_key: String,
    /// 展示名：现行格式为会话名（缺省时退回 chatId）；遗留格式为任务名。
    task_name: String,
    /// 时间戳：现行格式为 `YYYY-MM-DD HH:MM:SS`（毫秒丢弃，无 T 以便前端直出显示）；
    /// 遗留格式为 `YYYY-MM-DDTHH-MM-SS`。
    timestamp: String,
}

/// 解析定时备份文件名。
///
/// 现行格式由 `scheduled_executor::scheduled_export_file_name` 生成：
/// `{chatType}_{会话名}_{peer}_{YYYYMMDD}_{HHMMSSmmm}.{ext}`，同目录重名时带 `_N`
/// 碰撞后缀；直接复用 `parse_export_file_name`（兼容碰撞后缀与 `_NNN_TEMP`）。
/// 不满足时退回早期版本的 `任务名_YYYY-MM-DDTHH-MM-SS` 格式。
fn parse_scheduled_export_file_name(file_name: &str) -> Option<ScheduledExportInfo> {
    // 合并产物(merged_ 前缀)不是可合并源;虽然 merged 目录本就不被 available-tasks
    // 扫描,这里加一道防线,防止未来扫描范围变化时被当成备份任务泄漏进合并源。
    if is_merged_base_name(file_name) {
        return None;
    }
    if let Some(info) = parse_export_file_name(file_name) {
        let chat_type = info.get("chatType")?.as_str()?.to_string();
        let chat_id = info.get("chatId")?.as_str()?.to_string();
        let display_name = info
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let timestamp = info
            .get("exportDate")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Some(ScheduledExportInfo {
            group_key: format!("{chat_type}_{chat_id}"),
            task_name: if display_name.is_empty() {
                chat_id
            } else {
                display_name
            },
            timestamp,
        });
    }

    static RE_LEGACY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_legacy = RE_LEGACY.get_or_init(|| {
        regex::Regex::new(r"^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(html|json)$")
            .expect("valid regex")
    });
    let caps = re_legacy.captures(file_name)?;
    Some(ScheduledExportInfo {
        group_key: caps[1].to_string(),
        task_name: caps[1].to_string(),
        timestamp: caps[2].to_string(),
    })
}

// GET /api/merge-resources/available-tasks

/// 获取可用于合并的备份列表（定时备份 + 手动导出，按会话分组）。
pub async fn merge_available_tasks(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    // 1. 定时备份：现行文件名 {chatType}_{会话名}_{peer}_{YYYYMMDD}_{HHMMSSmmm}.{ext}
    //    （scheduled_executor 生成，重名带 _N 后缀），兼容早期“任务名_YYYY-MM-DDTHH-MM-SS”。
    let mut scheduled_groups: HashMap<String, Vec<Value>> = HashMap::new();
    let scheduled_dir = state.path_manager.scheduled_exports_dir();
    if let Ok(entries) = std::fs::read_dir(&scheduled_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".html") && !name.ends_with(".json") {
                continue;
            }
            let Some(info) = parse_scheduled_export_file_name(&name) else {
                continue;
            };
            let Ok(meta) = entry.metadata() else { continue };
            let created_at = meta.modified().map(iso).unwrap_or_default();
            scheduled_groups
                .entry(info.group_key)
                .or_default()
                .push(json!({
                    "fileName": name,
                    "taskName": info.task_name,
                    "timestamp": info.timestamp,
                    "createdAt": created_at,
                    "fileSize": meta.len(),
                }));
        }
    }

    let mut scheduled_tasks: Vec<Value> = scheduled_groups
        .into_iter()
        .map(|(group_key, mut backups)| {
            backups.sort_by(|a, b| {
                let time_a = a.get("createdAt").and_then(Value::as_str).unwrap_or("");
                let time_b = b.get("createdAt").and_then(Value::as_str).unwrap_or("");
                time_b.cmp(time_a)
            });
            let latest = backups.first().cloned().unwrap_or(Value::Null);
            let task_name = latest
                .get("taskName")
                .and_then(Value::as_str)
                .unwrap_or(&group_key)
                .to_string();
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

/// 一个按聊天分组的待合并集合。
struct MergeGroup {
    chat_type: String,
    chat_id: Option<String>,
    display_name: String,
    file_names: Vec<String>,
    sources: Vec<MergeSource>,
}

/// 因该聊天文件数不足 2 而被跳过的源。
struct SkippedMergeSource {
    file_name: String,
    reason: String,
}

/// 按聊天把源文件分组;每组至少 2 个文件才合并,单文件组跳过并报告。
fn group_merge_sources(
    file_names: &[String],
    sources: Vec<MergeSource>,
) -> (Vec<MergeGroup>, Vec<SkippedMergeSource>) {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut groups: Vec<MergeGroup> = Vec::new();

    for (file_name, source) in file_names.iter().zip(sources) {
        let (group_key, chat_type, chat_id, display_name) =
            if let Some(info) = parse_scheduled_export_file_name(file_name) {
                // 现行定时备份名可额外解析出 chatType/chatId;遗留格式无法解析时按群聊处理。
                let export_info = parse_export_file_name(file_name);
                let chat_type = export_info
                    .as_ref()
                    .and_then(|value| value.get("chatType").and_then(Value::as_str))
                    .unwrap_or("group")
                    .to_string();
                let chat_id = export_info
                    .as_ref()
                    .and_then(|value| value.get("chatId").and_then(Value::as_str))
                    .map(String::from);
                (info.group_key, chat_type, chat_id, info.task_name)
            } else if let Some(info) = parse_manual_export_file_name(file_name) {
                let display_name = info
                    .session_name
                    .clone()
                    .unwrap_or_else(|| info.peer_uid.clone());
                let chat_id = Some(info.peer_uid.clone());
                (
                    format!("{}_{}", info.chat_type, info.peer_uid),
                    info.chat_type,
                    chat_id,
                    display_name,
                )
            } else {
                // 兜底:无法识别的文件名(正常 UI 流程不会出现)合并为一组,沿用旧行为。
                (
                    "__unclassified__".to_string(),
                    "group".to_string(),
                    None,
                    "合并的聊天记录".to_string(),
                )
            };

        let group_idx = if let Some(&existing) = index.get(&group_key) {
            existing
        } else {
            let new_index = groups.len();
            groups.push(MergeGroup {
                chat_type,
                chat_id,
                display_name,
                file_names: Vec::new(),
                sources: Vec::new(),
            });
            index.insert(group_key, new_index);
            new_index
        };
        groups[group_idx].file_names.push(file_name.clone());
        groups[group_idx].sources.push(source);
    }

    let mut merged = Vec::new();
    let mut skipped = Vec::new();
    for group in groups {
        if group.sources.len() >= 2 {
            merged.push(group);
        } else if let Some(file_name) = group.file_names.first() {
            skipped.push(SkippedMergeSource {
                file_name: file_name.clone(),
                reason: "该聊天只有 1 个备份文件,无法合并".to_string(),
            });
        }
    }
    (merged, skipped)
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
    let re = RE.get_or_init(|| regex::Regex::new(r"(?i)\.(html|json)$").expect("valid regex"));

    for file_name in file_names {
        if !valid_export_file_name(file_name) {
            return Err(format!("非法的导出文件名: {file_name}"));
        }
        let Some(resolved) = resolve_export_file(state, file_name) else {
            return Err(format!(
                "未找到文件: {file_name}（已搜索exports和scheduled-exports目录）"
            ));
        };
        let found_path = resolved.path;
        let task_dir = resolved.base_dir;

        let base_name = re.replace(file_name, "").into_owned();
        let json_path = if found_path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            Some(found_path.clone())
        } else {
            find_sibling_file_ci(&task_dir, &base_name, "json")
                .or_else(|| find_sibling_file_ci(&export_dir, &base_name, "json"))
                .or_else(|| find_sibling_file_ci(&scheduled_dir, &base_name, "json"))
        };
        let html_file = {
            if found_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("html"))
            {
                found_path.clone()
            } else {
                find_sibling_file_ci(&task_dir, &base_name, "html")
                    .or_else(|| find_sibling_file_ci(&export_dir, &base_name, "html"))
                    .or_else(|| find_sibling_file_ci(&scheduled_dir, &base_name, "html"))
                    .unwrap_or_else(|| found_path.clone())
            }
        };

        let resource_candidate = task_dir.join(format!("resources_{base_name}"));
        let resource_dir = if resource_candidate.exists() {
            resolve_existing_within(&resource_candidate, std::slice::from_ref(&task_dir))
                .ok_or_else(|| format!("资源目录越过导出目录边界: {file_name}"))?
        } else {
            resource_candidate
        };
        sources.push(MergeSource {
            html_file,
            json_file: json_path,
            resource_dir,
        });
    }
    Ok(sources)
}

fn merge_source_messages(
    sources: &[MergeSource],
    deduplicate: bool,
) -> Result<(Vec<Value>, usize), String> {
    let mut all_messages: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut deduplicated = 0usize;
    let mut readable_json = 0usize;
    let mut failures = Vec::new();

    for (index, source) in sources.iter().enumerate() {
        let source_name = source.html_file.file_name().map_or_else(
            || format!("第{}个源", index + 1),
            |name| name.to_string_lossy().into_owned(),
        );
        let Some(json_path) = &source.json_file else {
            failures.push(format!("{source_name} 缺少 JSON 消息数据"));
            continue;
        };
        let content = match std::fs::read_to_string(json_path) {
            Ok(content) => content,
            Err(error) => {
                let json_name = json_path
                    .file_name()
                    .map_or_else(|| source_name.clone().into(), |name| name.to_string_lossy());
                failures.push(format!("{json_name} 读取失败: {error}"));
                continue;
            }
        };
        let data = match serde_json::from_str::<Value>(&content) {
            Ok(data) => data,
            Err(error) => {
                let json_name = json_path
                    .file_name()
                    .map_or_else(|| source_name.clone().into(), |name| name.to_string_lossy());
                failures.push(format!("{json_name} 解析失败: {error}"));
                continue;
            }
        };
        let Some(messages) = data.get("messages").and_then(Value::as_array) else {
            let json_name = json_path
                .file_name()
                .map_or_else(|| source_name.clone().into(), |name| name.to_string_lossy());
            failures.push(format!("{json_name} 缺少 messages 数组"));
            continue;
        };
        readable_json += 1;
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

    if readable_json == 0 {
        if failures
            .iter()
            .all(|failure| failure.contains("缺少 JSON 消息数据"))
        {
            return Err("缺少可合并的 JSON 消息数据".to_string());
        }
        return Err(format!(
            "缺少可合并的 JSON 消息数据: {}",
            failures.join("；")
        ));
    }
    if !failures.is_empty() {
        return Err(format!("部分 JSON 消息数据不可用: {}", failures.join("；")));
    }
    all_messages.sort_by_key(|m| {
        m.get("timestamp")
            .and_then(Value::as_i64)
            .or_else(|| m.get("time").and_then(Value::as_i64))
            .unwrap_or(0)
    });
    Ok((all_messages, deduplicated))
}

fn md5_of_file(path: &FsPath) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Md5::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

fn merged_resource_dir(output_path: &FsPath, base_name: &str) -> PathBuf {
    output_path.join(format!("resources_{base_name}"))
}

fn merge_resource_files(
    sources: &[MergeSource],
    output_path: &FsPath,
    base_name: &str,
) -> Result<(usize, Vec<(String, String)>), String> {
    let target_resource_path = merged_resource_dir(output_path, base_name);
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
                let type_dir = target_resource_path.join(type_name);
                let mut target_name = file_name.clone();
                let mut target = type_dir.join(&target_name);
                if target.is_file() && md5_of_file(&target).as_deref() != Some(md5.as_str()) {
                    target_name = format!("{md5}_{file_name}");
                    target = type_dir.join(&target_name);
                }
                if target.is_file() {
                    if md5_of_file(&target).as_deref() != Some(md5.as_str()) {
                        continue;
                    }
                } else if std::fs::copy(&source_path, &target).is_err() {
                    continue;
                }
                let relative = format!("resources_{base_name}/{type_name}/{target_name}");
                copied.insert(md5.clone(), relative.clone());
                mapping.push((md5, relative));
                total += 1;
            }
        }
    }
    Ok((total, mapping))
}

fn merged_resource_type_dir(resource_type: &str) -> &'static str {
    match resource_type {
        "image" => "images",
        "video" => "videos",
        "audio" => "audios",
        _ => "files",
    }
}

fn rewrite_merged_resource_paths(
    messages: &mut [Value],
    mapping: &[(String, String)],
    output_path: &FsPath,
    absolute: bool,
) {
    let mut by_md5 = HashMap::new();
    let mut by_type_name = HashMap::new();
    for (md5, relative) in mapping {
        by_md5.insert(md5.as_str(), relative.as_str());
        let path = FsPath::new(relative);
        let Some(type_dir) = path
            .parent()
            .and_then(FsPath::file_name)
            .map(|name| name.to_string_lossy().into_owned())
        else {
            continue;
        };
        let Some(target_name) = path.file_name().map(|name| name.to_string_lossy()) else {
            continue;
        };
        by_type_name.insert(
            (type_dir.clone(), target_name.to_string()),
            relative.as_str(),
        );
        if let Some(source_name) = target_name.strip_prefix(&format!("{md5}_")) {
            by_type_name
                .entry((type_dir, source_name.to_string()))
                .or_insert(relative.as_str());
        }
    }

    fn rewrite_value(
        value: &mut Value,
        inherited_type: Option<&str>,
        by_md5: &HashMap<&str, &str>,
        by_type_name: &HashMap<(String, String), &str>,
        output_path: &FsPath,
        absolute: bool,
    ) {
        match value {
            Value::Array(items) => {
                for item in items {
                    rewrite_value(
                        item,
                        inherited_type,
                        by_md5,
                        by_type_name,
                        output_path,
                        absolute,
                    );
                }
            }
            Value::Object(object) => {
                let resource_type = object
                    .get("type")
                    .and_then(Value::as_str)
                    .or(inherited_type)
                    .map(str::to_owned);
                let local_path = object
                    .get("localPath")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let file_name = object
                    .get("filename")
                    .or_else(|| object.get("fileName"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        local_path.as_deref().and_then(|path| {
                            FsPath::new(path)
                                .file_name()
                                .map(|name| name.to_string_lossy().into_owned())
                        })
                    });
                let md5 = object.get("md5").and_then(Value::as_str);
                let relative = md5
                    .and_then(|value| by_md5.get(value).copied())
                    .or_else(|| {
                        resource_type.as_deref().and_then(|kind| {
                            file_name.as_deref().and_then(|name| {
                                by_type_name
                                    .get(&(
                                        merged_resource_type_dir(kind).to_owned(),
                                        name.to_owned(),
                                    ))
                                    .copied()
                            })
                        })
                    });
                if let Some(relative) = relative {
                    let path = if absolute {
                        output_path.join(relative).to_string_lossy().into_owned()
                    } else {
                        relative.to_owned()
                    };
                    object.insert("localPath".to_string(), Value::String(path));
                    if object
                        .get("url")
                        .and_then(Value::as_str)
                        .is_some_and(|url| url.starts_with("resources"))
                    {
                        object.insert("url".to_string(), Value::String(relative.to_owned()));
                    }
                }
                for child in object.values_mut() {
                    rewrite_value(
                        child,
                        resource_type.as_deref(),
                        by_md5,
                        by_type_name,
                        output_path,
                        absolute,
                    );
                }
            }
            _ => {}
        }
    }

    for message in messages {
        rewrite_value(message, None, &by_md5, &by_type_name, output_path, absolute);
    }
}

/// 单组合并写盘参数。
struct MergedWriteOptions<'a> {
    chat_name: &'a str,
    chat_type: &'a str,
    chat_id: Option<&'a str>,
    generate_json: bool,
    generate_html: bool,
}

#[derive(Debug)]
struct MergedWritePaths {
    json_path: PathBuf,
    html_path: PathBuf,
}

struct MergedWriteError {
    message: String,
    json_path: PathBuf,
    html_path: PathBuf,
}

fn existing_file_path(path: &FsPath) -> String {
    if path.is_file() {
        path.to_string_lossy().into_owned()
    } else {
        String::new()
    }
}

fn export_error_reason(error: &qce_exporter::ExportError) -> String {
    match error {
        qce_exporter::ExportError::Io { source, .. } => source.to_string(),
        qce_exporter::ExportError::OutputDirConflict(_) => "输出目录冲突".to_string(),
        _ => error.to_string(),
    }
}

async fn write_merged_data(
    output_path: &FsPath,
    json_name: &str,
    html_name: &str,
    resource_dir_name: &str,
    messages: &[Value],
    mapping: &[(String, String)],
    options: &MergedWriteOptions<'_>,
) -> Result<MergedWritePaths, MergedWriteError> {
    tokio::fs::create_dir_all(output_path)
        .await
        .map_err(|e| MergedWriteError {
            message: format!("创建输出目录失败: {e}"),
            json_path: PathBuf::new(),
            html_path: PathBuf::new(),
        })?;

    let avatar = options
        .chat_id
        .and_then(|id| avatar_url(options.chat_type, id));
    let mut merged_messages = messages.to_vec();
    rewrite_merged_resource_paths(&mut merged_messages, mapping, output_path, false);

    // 1. JSON(可选)。
    let mut written_json_path = PathBuf::new();
    if options.generate_json {
        let json_path = output_path.join(json_name);
        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "mergedAt".to_string(),
            json!(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        );
        metadata.insert("messageCount".to_string(), json!(merged_messages.len()));
        metadata.insert("resourceCount".to_string(), json!(mapping.len()));
        if let Some(id) = options.chat_id {
            metadata.insert("chatId".to_string(), json!(id));
        }
        if let Some(url) = avatar.as_ref() {
            metadata.insert("avatarUrl".to_string(), json!(url));
        }
        let json_data = json!({
            "metadata": metadata,
            "messages": merged_messages.clone(),
            "resources": mapping.iter().map(|(md5, path)| json!({ "md5": md5, "path": path })).collect::<Vec<_>>(),
        });
        let json_text = serde_json::to_string_pretty(&json_data).map_err(|e| MergedWriteError {
            message: format!("生成JSON失败: {e}"),
            json_path: PathBuf::new(),
            html_path: PathBuf::new(),
        })?;
        if let Err(error) = tokio::fs::write(&json_path, json_text).await {
            let _ = tokio::fs::remove_file(&json_path).await;
            return Err(MergedWriteError {
                message: format!("写入JSON失败: {error}"),
                json_path: PathBuf::new(),
                html_path: PathBuf::new(),
            });
        }
        written_json_path = json_path;
    }

    // 2. HTML(可选)。
    let mut written_html_path = PathBuf::new();
    if options.generate_html {
        let html_path = output_path.join(html_name);
        let mut html_messages = merged_messages.clone();
        rewrite_merged_resource_paths(&mut html_messages, mapping, output_path, true);
        let clean_messages: Vec<CleanMessage> = html_messages
            .iter()
            .enumerate()
            .map(|(index, message)| {
                serde_json::from_value(message.clone()).map_err(|error| (index + 1, error))
            })
            .collect::<Result<_, _>>()
            .map_err(|(index, error)| MergedWriteError {
                message: format!("写入HTML失败: 第{index}条消息数据无效: {error}"),
                json_path: written_json_path.clone(),
                html_path: PathBuf::new(),
            })?;
        let chat_info = ChatInfo {
            name: options.chat_name.to_string(),
            chat_type: options.chat_type.to_string(),
            self_name: Some("合并导出".to_string()),
            avatar,
            peer_uid: options.chat_id.map(String::from),
            ..ChatInfo::default()
        };
        let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
            output_path: html_path.clone(),
            resource_dir_name: Some(resource_dir_name.to_string()),
            include_resource_links: true,
            include_system_messages: true,
            exporter_version: Some(crate::version::VERSION.get().to_string()),
            ..HtmlExportOptions::default()
        });
        let html_result = exporter
            .export_single_inline(&clean_messages, &chat_info)
            .await;
        if let Err(error) = html_result {
            let _ = tokio::fs::remove_file(&html_path).await;
            return Err(MergedWriteError {
                message: format!("写入HTML失败: {}", export_error_reason(&error)),
                json_path: written_json_path,
                html_path: PathBuf::new(),
            });
        }
        written_html_path = html_path;
    }
    Ok(MergedWritePaths {
        json_path: written_json_path,
        html_path: written_html_path,
    })
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

/// 解析合并输出格式:`body.formats` 数组(值小写归一);缺省 `["json","html"]`。
/// 返回 (generate_json, generate_html);非法值或全空返回错误。
fn parse_merge_formats(body: &Value) -> Result<(bool, bool), String> {
    let formats: Vec<String> = match body.get("formats") {
        None => vec!["json".to_string(), "html".to_string()],
        Some(Value::Array(array)) => array
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_lowercase)
                    .ok_or_else(|| "输出格式必须是字符串".to_string())
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err("formats 必须是数组".to_string()),
    };
    if formats.is_empty() {
        return Err("至少选择一种输出格式".to_string());
    }
    if formats
        .iter()
        .any(|format| format != "json" && format != "html")
    {
        return Err("输出格式仅支持 json/html".to_string());
    }
    Ok((
        formats.iter().any(|format| format == "json"),
        formats.iter().any(|format| format == "html"),
    ))
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
    if source_task_ids.len() > 100 {
        let err = ApiError::validation("单次最多合并100个任务", "TOO_MANY_SOURCE_TASKS");
        return response::error(&err, &request_id);
    }
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
    let (generate_json, generate_html) = match parse_merge_formats(&body) {
        Ok(formats) => formats,
        Err(message) => {
            let err = ApiError::validation(message, "INVALID_FORMATS");
            return response::error(&err, &request_id);
        }
    };
    let requested_output_path = body
        .get("outputPath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .map_or_else(|| state.path_manager.merged_exports_dir(), PathBuf::from);
    let roots = [
        state.path_manager.exports_dir(),
        state.path_manager.scheduled_exports_dir(),
    ];
    let Some(output_path) = resolve_for_creation_within(&requested_output_path, &roots) else {
        let err = ApiError::new(
            ErrorType::Api,
            "合并输出目录必须位于导出目录内",
            "OUTPUT_PATH_NOT_ALLOWED",
        )
        .with_status(StatusCode::FORBIDDEN);
        return response::error(&err, &request_id);
    };

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

    // 按聊天分组;每组至少 2 个文件才合并,单文件组跳过。
    let (groups, skipped) = group_merge_sources(&source_task_ids, sources);
    if groups.is_empty() {
        let err = ApiError::validation(
            "没有可合并的聊天:每个聊天至少需要 2 个备份文件",
            "TOO_FEW_SOURCES_PER_CHAT",
        );
        return response::error(&err, &request_id);
    }
    let group_count = groups.len();

    // Phase 2-5: 逐聊天合并(消息 → 资源 → 写入 → 可选清理)。
    let mut group_results: Vec<Value> = Vec::new();
    let mut merged_source_count = 0usize;
    let mut merged_message_count = 0usize;
    let mut merged_deduplicated = 0usize;
    let mut merged_resource_count = 0usize;
    for (index, group) in groups.iter().enumerate() {
        let label = format!(
            "正在合并 {} ({}/{})",
            group.display_name,
            index + 1,
            group_count
        );
        broadcast_merge_progress(&state, "merge", index, group_count, &label);
        let (messages, deduplicated) = match merge_source_messages(&group.sources, deduplicate) {
            Ok(result) => result,
            Err(message) => {
                group_results.push(json!({
                    "chatType": group.chat_type.clone(),
                    "displayName": group.display_name.clone(),
                    "sourceCount": group.sources.len(),
                    "jsonPath": "",
                    "htmlPath": "",
                    "status": "failed",
                    "error": message,
                }));
                continue;
            }
        };
        broadcast_merge_progress(
            &state,
            "merge",
            index + 1,
            group_count,
            &format!(
                "{} 消息合并完成，共 {} 条",
                group.display_name,
                messages.len()
            ),
        );

        broadcast_merge_progress(&state, "resources", index, group_count, "合并资源文件...");
        let timestamp = Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            .replace([':', '.'], "-")
            .chars()
            .take(19)
            .collect::<String>();
        let (json_name, html_name) = merged_output_names(
            &output_path,
            &group.chat_type,
            &group.display_name,
            &timestamp,
        );
        let resource_base_name = json_name.strip_suffix(".json").unwrap_or(&json_name);
        let (resource_count, mapping) =
            match merge_resource_files(&group.sources, &output_path, resource_base_name) {
                Ok(result) => result,
                Err(message) => {
                    broadcast_merge_progress(
                        &state,
                        "resources",
                        index + 1,
                        group_count,
                        &format!("{} 资源合并失败", group.display_name),
                    );
                    group_results.push(json!({
                        "chatType": group.chat_type.clone(),
                        "displayName": group.display_name.clone(),
                        "sourceCount": group.sources.len(),
                        "jsonPath": "",
                        "htmlPath": "",
                        "status": "failed",
                        "error": message,
                    }));
                    continue;
                }
            };
        broadcast_merge_progress(
            &state,
            "resources",
            index + 1,
            group_count,
            &format!(
                "{} 资源文件合并完成，共 {} 个文件",
                group.display_name, resource_count
            ),
        );

        broadcast_merge_progress(&state, "write", index, group_count, "写入合并数据...");
        let paths = match write_merged_data(
            &output_path,
            &json_name,
            &html_name,
            &format!("resources_{resource_base_name}"),
            &messages,
            &mapping,
            &MergedWriteOptions {
                chat_name: &group.display_name,
                chat_type: &group.chat_type,
                chat_id: group.chat_id.as_deref(),
                generate_json,
                generate_html,
            },
        )
        .await
        {
            Ok(paths) => paths,
            Err(error) => {
                let mut result = json!({
                    "chatType": group.chat_type.clone(),
                    "displayName": group.display_name.clone(),
                    "sourceCount": group.sources.len(),
                    "jsonPath": "",
                    "htmlPath": "",
                    "status": "failed",
                    "error": error.message,
                });
                let json_path = existing_file_path(&error.json_path);
                if !json_path.is_empty() {
                    result["jsonPath"] = json!(json_path);
                }
                let html_path = existing_file_path(&error.html_path);
                if !html_path.is_empty() {
                    result["htmlPath"] = json!(html_path);
                }
                group_results.push(result);
                continue;
            }
        };
        broadcast_merge_progress(&state, "write", index + 1, group_count, "数据写入完成");

        // 该组写盘成功后清理该组源文件;失败组保留源文件。
        if delete_source_files {
            broadcast_merge_progress(&state, "cleanup", index, group_count, "清理源文件...");
            cleanup_merge_sources(&group.sources);
            broadcast_merge_progress(&state, "cleanup", index + 1, group_count, "清理完成");
        }

        merged_source_count += group.sources.len();
        merged_message_count += messages.len();
        merged_deduplicated += deduplicated;
        merged_resource_count += resource_count;
        group_results.push(json!({
            "chatType": group.chat_type.clone(),
            "displayName": group.display_name.clone(),
            "sourceCount": group.sources.len(),
            "totalMessages": messages.len(),
            "deduplicatedMessages": deduplicated,
            "totalResources": resource_count,
            "jsonPath": existing_file_path(&paths.json_path),
            "htmlPath": existing_file_path(&paths.html_path),
            "status": "success",
        }));
    }

    let succeeded = group_results
        .iter()
        .filter(|group| group.get("status").and_then(Value::as_str) == Some("success"))
        .count();
    if succeeded == 0 {
        let err = ApiError::internal("所有聊天合并均失败", "MERGE_FAILED");
        return response::error(&err, &request_id);
    }

    let (_, total_size) = scan_directory_stats(&output_path);
    let result = json!({
        "mergeTaskId": merge_task_id,
        "outputPath": output_path.to_string_lossy(),
        "groups": group_results,
        "skipped": skipped.iter().map(|skip| json!({
            "fileName": skip.file_name.clone(),
            "reason": skip.reason.clone(),
        })).collect::<Vec<_>>(),
        "sourceCount": merged_source_count,
        "totalMessages": merged_message_count,
        "deduplicatedMessages": merged_deduplicated,
        "totalResources": merged_resource_count,
        "totalSize": total_size,
        "mergeTime": start_time.elapsed().as_millis() as i64,
        "completedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
    response::success(json!({ "result": result }), &request_id)
}

#[cfg(test)]
mod metadata_tests {
    use super::{
        apply_file_metadata, avatar_url, existing_file_path, extract_html_time_range,
        file_manager_target_is_safe, find_sibling_file_ci, group_merge_sources,
        is_merged_base_name, merge_resource_files, merge_source_messages,
        merged_export_display_time, merged_output_names, merged_resource_dir_for_file,
        parse_export_file_name, parse_manifest_metadata, parse_manual_export_file_name,
        parse_merge_formats, parse_merged_export_file_name, parse_scheduled_export_file_name,
        registered_export_task_paths, rewrite_merged_resource_paths, should_select_in_file_manager,
        valid_export_file_name, windows_explorer_args, write_merged_data, MergeSource,
        MergedWriteOptions,
    };
    use crate::api::path_security::resolve_existing_exact;
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn private_avatar_rejects_uid_and_zero_values() {
        assert!(avatar_url("friend", "u_peer").is_none());
        assert!(avatar_url("friend", "0").is_none());
        assert!(avatar_url("friend", "1687657986").is_some());
    }

    #[test]
    fn custom_export_tasks_authorize_only_their_registered_file() {
        let root = std::env::temp_dir().join(format!(
            "qce-custom-export-auth-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).expect("create custom export root");
        let exported = root.join("registered.json");
        let sibling = root.join("unregistered.json");
        fs::write(&exported, "{}").expect("write registered export");
        fs::write(&sibling, "{}").expect("write unregistered sibling");
        let canonical_exported = exported
            .canonicalize()
            .expect("canonical registered export");
        let tasks = HashMap::from([(
            "task_1".to_string(),
            json!({ "filePath": canonical_exported.to_string_lossy() }),
        )]);
        let registered = registered_export_task_paths(&tasks);

        assert_eq!(
            resolve_existing_exact(&exported, &registered),
            exported.canonicalize().ok()
        );
        assert!(resolve_existing_exact(&sibling, &registered).is_none());

        fs::remove_dir_all(root).expect("remove custom export root");
    }

    #[cfg(unix)]
    #[test]
    fn file_manager_target_rejects_a_final_symlink_added_after_resolution() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "qce-open-location-swap-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).expect("create test root");
        let registered = root.join("registered.json");
        let outside = root.join("outside.json");
        fs::write(&registered, "registered").expect("write registered file");
        fs::write(&outside, "outside").expect("write outside file");
        let resolved = registered.canonicalize().expect("resolve registered file");
        assert!(file_manager_target_is_safe(&resolved));

        fs::remove_file(&registered).expect("remove registered file");
        symlink(&outside, &registered).expect("replace registered path with symlink");
        assert!(!file_manager_target_is_safe(&resolved));

        fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn file_manager_target_rejects_an_ancestor_symlink_added_after_resolution() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "qce-open-location-ancestor-swap-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let authorized_dir = root.join("authorized");
        let displaced_dir = root.join("displaced");
        let outside_dir = root.join("outside");
        fs::create_dir_all(&authorized_dir).expect("create authorized directory");
        fs::create_dir_all(&outside_dir).expect("create outside directory");
        let authorized_file = authorized_dir.join("registered.json");
        fs::write(&authorized_file, "registered").expect("write registered file");
        fs::write(outside_dir.join("registered.json"), "outside").expect("write outside file");
        let resolved = authorized_file
            .canonicalize()
            .expect("resolve registered file");
        assert!(file_manager_target_is_safe(&resolved));

        fs::rename(&authorized_dir, &displaced_dir).expect("move authorized directory");
        symlink(&outside_dir, &authorized_dir).expect("replace ancestor with outside symlink");
        assert!(!file_manager_target_is_safe(&resolved));

        fs::remove_dir_all(root).expect("remove test root");
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
    fn merged_resource_helpers_match_case_insensitively() {
        let base =
            std::env::temp_dir().join(format!("qce-merge-case-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("chat.HTML"), b"html").unwrap();

        let sibling = find_sibling_file_ci(&base, "chat", "html").unwrap();
        assert_eq!(
            sibling.file_name().and_then(|name| name.to_str()),
            Some("chat.HTML")
        );
        assert!(is_merged_base_name(
            "MERGED_group_name_2026-08-30T14-07-16.HTML"
        ));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn merge_response_paths_only_include_real_files() {
        let base = std::env::temp_dir().join(format!(
            "qce-merge-response-paths-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let file = base.join("merged.json");
        fs::create_dir_all(&base).unwrap();
        fs::write(&file, b"{}").unwrap();
        fs::create_dir(base.join("merged.html")).unwrap();

        assert_eq!(
            existing_file_path(&file),
            file.to_string_lossy().into_owned()
        );
        assert_eq!(existing_file_path(&base.join("merged.html")), "");
        assert_eq!(existing_file_path(&base.join("missing.html")), "");

        fs::remove_dir_all(base).unwrap();
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

    #[test]
    fn merged_file_names_parse_per_chat_and_legacy_formats() {
        // 新格式(按聊天合并):group / 多词聊天名 / 碰撞后缀。
        let group =
            parse_merged_export_file_name("merged_group_胡椒玉米汤_2026-08-30T14-07-16.json")
                .unwrap();
        assert_eq!(group.format, "json");
        assert_eq!(group.timestamp, "2026-08-30T14-07-16");
        assert_eq!(group.chat_type, "group");
        assert_eq!(group.display_name, "胡椒玉米汤");

        let friend =
            parse_merged_export_file_name("merged_friend_笨蛋_Darf_v2_2026-08-30T14-07-16_2.html")
                .unwrap();
        assert_eq!(friend.format, "html");
        assert_eq!(friend.timestamp, "2026-08-30T14-07-16");
        assert_eq!(friend.chat_type, "friend");
        assert_eq!(friend.display_name, "笨蛋 Darf v2");

        // 旧格式(历史产物)仍可解析,显示名保持「合并的聊天记录」。
        let legacy = parse_merged_export_file_name("merged_2026-08-30T14-07-16.json").unwrap();
        assert_eq!(legacy.format, "json");
        assert_eq!(legacy.timestamp, "2026-08-30T14-07-16");
        assert_eq!(legacy.chat_type, "group");
        assert_eq!(legacy.display_name, "合并的聊天记录");

        for rejected in [
            "merged_2026-08-30T14-07-16.zip",
            "merged_20260830.json",
            "group_x_123_20260830_020047608.json",
            "merged_.json",
        ] {
            assert!(
                parse_merged_export_file_name(rejected).is_none(),
                "{rejected}"
            );
        }

        // 命名空间隔离:merged 文件名不进入普通/手动/定时解析器,
        // 不会出现在合并源候选(available-tasks)或作为再合并源。
        for merged_name in [
            "merged_group_胡椒玉米汤_2026-08-30T14-07-16.json",
            "merged_2026-08-30T14-07-16.json",
        ] {
            assert!(
                parse_export_file_name(merged_name).is_none(),
                "{merged_name}"
            );
            assert!(
                parse_manual_export_file_name(merged_name).is_none(),
                "{merged_name}"
            );
            assert!(
                parse_scheduled_export_file_name(merged_name).is_none(),
                "{merged_name}"
            );
        }

        // 展示时间:T 换空格,时间部分连字符换冒号。
        assert_eq!(
            merged_export_display_time("2026-08-30T14-07-16"),
            "2026-08-30 14:07:16"
        );
    }

    #[test]
    fn merged_output_names_sanitize_chat_names_and_avoid_collisions() {
        let base = std::env::temp_dir().join(format!(
            "qce-merged-names-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&base).unwrap();

        // 聊天名消毒:空格/斜杠转下划线并折叠。
        let (json_name, html_name) =
            merged_output_names(&base, "group", "胡椒 玉米汤/老群", "2026-08-30T14-07-16");
        assert_eq!(
            json_name,
            "merged_group_胡椒_玉米汤_老群_2026-08-30T14-07-16.json"
        );
        assert_eq!(
            html_name,
            "merged_group_胡椒_玉米汤_老群_2026-08-30T14-07-16.html"
        );

        // 任一成员已存在时递增后缀,json/html 成对一致。
        fs::write(base.join(&json_name), b"x").unwrap();
        let (json_name_2, html_name_2) =
            merged_output_names(&base, "group", "胡椒 玉米汤/老群", "2026-08-30T14-07-16");
        assert_eq!(
            json_name_2,
            "merged_group_胡椒_玉米汤_老群_2026-08-30T14-07-16_2.json"
        );
        assert_eq!(
            html_name_2,
            "merged_group_胡椒_玉米汤_老群_2026-08-30T14-07-16_2.html"
        );

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn group_merge_sources_groups_by_chat_and_skips_single_file_chats() {
        let mk = |name: &str| MergeSource {
            html_file: PathBuf::from(format!("/tmp/{name}.html")),
            json_file: Some(PathBuf::from(format!("/tmp/{name}.json"))),
            resource_dir: PathBuf::from(format!("/tmp/resources_{name}")),
        };
        let file_names: Vec<String> = vec![
            "group_胡椒玉米汤_647668860_20260830_020047608.json".to_string(),
            "group_胡椒玉米汤_647668860_20260829_020047608.json".to_string(),
            "group_黑猫燦炎上指挥部_814219720_20260830_020055645.html".to_string(),
            "friend_笨蛋_Darf_v2_1687657986_20260713_002703456.html".to_string(),
        ];
        let sources = vec![mk("a"), mk("b"), mk("c"), mk("d")];
        let (groups, skipped) = group_merge_sources(&file_names, sources);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].chat_type, "group");
        assert_eq!(groups[0].chat_id.as_deref(), Some("647668860"));
        assert_eq!(groups[0].display_name, "胡椒玉米汤");
        assert_eq!(groups[0].sources.len(), 2);

        assert_eq!(skipped.len(), 2);
        assert_eq!(
            skipped[0].file_name,
            "group_黑猫燦炎上指挥部_814219720_20260830_020055645.html"
        );
        assert_eq!(
            skipped[1].file_name,
            "friend_笨蛋_Darf_v2_1687657986_20260713_002703456.html"
        );

        // 无法识别的文件名归入兜底组(保持旧行为)。
        let odd_names: Vec<String> =
            vec!["weird_one.html".to_string(), "weird_two.json".to_string()];
        let (groups, skipped) = group_merge_sources(&odd_names, vec![mk("e"), mk("f")]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].chat_id, None);
        assert_eq!(groups[0].display_name, "合并的聊天记录");
        assert_eq!(groups[0].sources.len(), 2);
        assert!(skipped.is_empty());

        // 手动导出名:chat_id 取 peer_uid。
        let manual_names: Vec<String> = vec![
            "group_AxT_鸽子窝_960420904_20260713_002703456.json".to_string(),
            "group_AxT_鸽子窝_960420904_20260713_002703456_2.json".to_string(),
        ];
        let (groups, skipped) = group_merge_sources(&manual_names, vec![mk("g"), mk("h")]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].chat_id.as_deref(), Some("960420904"));
        assert!(skipped.is_empty());

        // 遗留定时名(任务名_时间):无 chat_id。
        let legacy_names: Vec<String> = vec![
            "我的每日备份_2025-11-28T06-24-13.html".to_string(),
            "我的每日备份_2025-11-29T06-24-13.html".to_string(),
        ];
        let (groups, skipped) = group_merge_sources(&legacy_names, vec![mk("i"), mk("j")]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].chat_id, None);
        assert!(skipped.is_empty());
    }

    #[test]
    fn merge_formats_parse_defaults_and_validate() {
        let default = parse_merge_formats(&json!({})).unwrap();
        assert_eq!(default, (true, true));

        let html_only = parse_merge_formats(&json!({ "formats": ["html"] })).unwrap();
        assert_eq!(html_only, (false, true));

        let upper = parse_merge_formats(&json!({ "formats": ["JSON", "Html"] })).unwrap();
        assert_eq!(upper, (true, true));

        assert_eq!(
            parse_merge_formats(&json!({ "formats": [] })),
            Err("至少选择一种输出格式".to_string())
        );
        assert_eq!(
            parse_merge_formats(&json!({ "formats": "html" })),
            Err("formats 必须是数组".to_string())
        );
        assert_eq!(
            parse_merge_formats(&json!({ "formats": [1, "html"] })),
            Err("输出格式必须是字符串".to_string())
        );
        assert_eq!(
            parse_merge_formats(&json!({ "formats": [null] })),
            Err("输出格式必须是字符串".to_string())
        );
        assert_eq!(
            parse_merge_formats(&json!({ "formats": ["xlsx"] })),
            Err("输出格式仅支持 json/html".to_string())
        );
        assert_eq!(
            parse_merge_formats(&json!({ "formats": ["json", "zip"] })),
            Err("输出格式仅支持 json/html".to_string())
        );
    }

    #[test]
    fn merge_source_messages_rejects_unavailable_and_accepts_empty_json() {
        let base = std::env::temp_dir().join(format!(
            "qce-merge-messages-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&base).unwrap();
        let valid = base.join("valid.json");
        fs::write(&valid, r#"{"messages":[{"id":"1","timestamp":1}]}"#).unwrap();
        let missing = base.join("missing.json");
        let source = |json_file| MergeSource {
            html_file: PathBuf::new(),
            json_file,
            resource_dir: PathBuf::new(),
        };

        let error = merge_source_messages(&[source(None)], true).unwrap_err();
        assert_eq!(error, "缺少可合并的 JSON 消息数据");

        let error =
            merge_source_messages(&[source(Some(valid.clone())), source(Some(missing))], true)
                .unwrap_err();
        assert!(error.contains("部分 JSON 消息数据不可用"));
        assert!(!error.contains(base.to_string_lossy().as_ref()));

        fs::write(&valid, "not json").unwrap();
        let error = merge_source_messages(&[source(Some(valid))], true).unwrap_err();
        assert!(error.contains("解析失败"));
        assert!(!error.contains(base.to_string_lossy().as_ref()));

        let unreadable = base.join("unreadable.json");
        fs::create_dir(&unreadable).unwrap();
        let error = merge_source_messages(&[source(Some(unreadable))], true).unwrap_err();
        assert!(error.contains("读取失败"));

        let empty = base.join("empty.json");
        fs::write(&empty, r#"{"messages":[]}"#).unwrap();
        let (messages, deduplicated) = merge_source_messages(&[source(Some(empty))], true).unwrap();
        assert!(messages.is_empty());
        assert_eq!(deduplicated, 0);

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn merged_resource_directories_do_not_share_same_named_files() {
        let base = std::env::temp_dir().join(format!(
            "qce-merge-resources-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let source_a = base.join("source-a");
        let source_b = base.join("source-b");
        fs::create_dir_all(source_a.join("images")).unwrap();
        fs::create_dir_all(source_b.join("images")).unwrap();
        fs::write(source_a.join("images/same.bin"), b"a").unwrap();
        fs::write(source_b.join("images/same.bin"), b"b").unwrap();
        let source = |resource_dir| MergeSource {
            html_file: PathBuf::new(),
            json_file: None,
            resource_dir,
        };

        merge_resource_files(&[source(source_a)], &base, "merged_group_a").unwrap();
        merge_resource_files(&[source(source_b)], &base, "merged_group_b").unwrap();
        assert_eq!(
            fs::read(base.join("resources_merged_group_a/images/same.bin")).unwrap(),
            b"a"
        );
        assert_eq!(
            fs::read(base.join("resources_merged_group_b/images/same.bin")).unwrap(),
            b"b"
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn merged_resource_collision_rewrites_message_reference() {
        let md5 = "0123456789abcdef0123456789abcdef";
        let relative = format!("resources_merged/images/{md5}_same.png");
        let mut messages = vec![json!({
            "content": {
                "elements": [{
                    "type": "image",
                    "data": {"filename": "same.png", "md5": md5}
                }]
            }
        })];

        rewrite_merged_resource_paths(
            &mut messages,
            &[(md5.to_string(), relative.clone())],
            std::path::Path::new("/tmp/merged"),
            false,
        );

        assert_eq!(
            messages[0]["content"]["elements"][0]["data"]["localPath"],
            json!(relative)
        );
    }

    #[test]
    fn merged_resource_lookup_supports_isolated_and_legacy_directories() {
        let base = std::env::temp_dir().join(format!(
            "qce-merge-resource-lookup-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(base.join("resources")).unwrap();
        assert_eq!(
            merged_resource_dir_for_file(&base, "merged_old"),
            Some(base.join("resources"))
        );

        let isolated = base.join("resources_merged_new");
        fs::create_dir_all(&isolated).unwrap();
        assert_eq!(
            merged_resource_dir_for_file(&base, "merged_new"),
            Some(isolated)
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn html_write_failure_reports_json_path() {
        let base =
            std::env::temp_dir().join(format!("qce-merge-write-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(base.join("merged.html")).unwrap();
        let result = write_merged_data(
            &base,
            "merged.json",
            "merged.html",
            "resources_merged",
            &[],
            &[],
            &MergedWriteOptions {
                chat_name: "合并",
                chat_type: "group",
                chat_id: None,
                generate_json: true,
                generate_html: true,
            },
        )
        .await;
        let error = result.unwrap_err();
        assert!(error.message.contains("写入HTML失败"));
        assert!(!error.message.contains(base.to_string_lossy().as_ref()));
        assert_eq!(error.json_path, base.join("merged.json"));
        assert!(base.join("merged.json").is_file());
        fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn html_write_failure_reports_invalid_message_data() {
        let base = std::env::temp_dir().join(format!(
            "qce-merge-invalid-message-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let result = write_merged_data(
            &base,
            "merged.json",
            "merged.html",
            "resources_merged",
            &[json!({ "id": "missing-sender" })],
            &[],
            &MergedWriteOptions {
                chat_name: "合并",
                chat_type: "group",
                chat_id: None,
                generate_json: false,
                generate_html: true,
            },
        )
        .await;
        let error = result.unwrap_err();
        assert!(error.message.contains("写入HTML失败: 第1条消息数据无效"));
        assert!(error.json_path.as_os_str().is_empty());
        assert!(error.html_path.as_os_str().is_empty());
        assert!(!base.join("merged.html").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn scheduled_file_names_parse_current_and_legacy_formats() {
        // 现行格式（真实线上样例）：{chatType}_{会话名}_{peer}_{YYYYMMDD}_{HHMMSSmmm}.json
        let current =
            parse_scheduled_export_file_name("group_胡椒玉米汤_647668860_20260830_020047608.json")
                .unwrap();
        assert_eq!(current.group_key, "group_647668860");
        assert_eq!(current.task_name, "胡椒玉米汤");
        assert_eq!(current.timestamp, "2026-08-30 02:00:47");

        // 好友会话 + 碰撞后缀 _2；下划线会话名尽力还原为空格。
        let friend = parse_scheduled_export_file_name(
            "friend_笨蛋_Darf_v2_1687657986_20260713_002703456_2.html",
        )
        .unwrap();
        assert_eq!(friend.group_key, "friend_1687657986");
        assert_eq!(friend.task_name, "笨蛋 Darf v2");
        assert_eq!(friend.timestamp, "2026-07-13 00:27:03");

        // HTML 与 JSON 扩展名均可解析。
        assert!(parse_scheduled_export_file_name(
            "group_黑猫燦炎上指挥部_814219720_20260830_020055645.html"
        )
        .is_some());

        // 遗留格式：任务名_YYYY-MM-DDTHH-MM-SS。
        let legacy =
            parse_scheduled_export_file_name("我的每日备份_2025-11-28T06-24-13.html").unwrap();
        assert_eq!(legacy.group_key, "我的每日备份");
        assert_eq!(legacy.task_name, "我的每日备份");
        assert_eq!(legacy.timestamp, "2025-11-28T06-24-13");

        // 无法解析的文件名：ZIP/JSONL、非导出文件、缺时间戳。
        for rejected in [
            "group_胡椒玉米汤_647668860_20260830_020047608_streaming.zip",
            "group_胡椒玉米汤_647668860_20260830_020047608_chunked_jsonl",
            "随便.txt",
            "not-a-parseable-name.html",
        ] {
            assert!(
                parse_scheduled_export_file_name(rejected).is_none(),
                "{rejected}"
            );
        }
    }
}
