use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};
use std::time::Duration;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};

use crate::api::helpers::http_get_bytes;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// 导出记录保留上限。
const RECORD_LIMIT: usize = 100;

fn export_base_path(state: &SharedState) -> PathBuf {
    state.path_manager.default_base_dir().join("group-files")
}

fn records_path(state: &SharedState) -> PathBuf {
    state
        .path_manager
        .default_base_dir()
        .join("group-files-records.json")
}

pub(crate) async fn load_records(state: &SharedState) -> Vec<Value> {
    match tokio::fs::read_to_string(records_path(state)).await {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

async fn add_record(state: &SharedState, record: Value) {
    let mut records = load_records(state).await;
    records.insert(0, record);
    records.truncate(RECORD_LIMIT);
    let path = records_path(state);
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    if let Ok(data) = serde_json::to_string_pretty(&records) {
        let _ = tokio::fs::write(&path, data).await;
    }
}

fn str_of(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn num_of(value: &Value, key: &str) -> i64 {
    match value.get(key) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn export_id() -> String {
    format!(
        "files_{}_{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..9]
    )
}

fn format_file_size(bytes: i64) -> String {
    if bytes <= 0 {
        return "0 B".to_string();
    }
    const SIZES: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let i = ((bytes as f64).ln() / 1024f64.ln()).floor() as usize;
    let i = i.min(SIZES.len() - 1);
    let value = bytes as f64 / 1024f64.powi(i as i32);
    format!("{value:.2} {}", SIZES[i])
}

/// 获取单个文件夹下的群文件与子文件夹。
async fn fetch_file_list(
    state: &SharedState,
    group_code: &str,
    folder_id: &str,
    start_index: i64,
    file_count: i64,
) -> (Vec<Value>, Vec<Value>) {
    let params = json!({
        "sortType": 1,
        "fileCount": file_count,
        "startIndex": start_index,
        "sortOrder": 2,
        "showOnlinedocFolder": 0,
        "folderId": folder_id,
    });
    let Ok(items) = state.napcat.get_group_file_list(group_code, &params).await else {
        return (Vec::new(), Vec::new());
    };
    let empty: Vec<Value> = Vec::new();
    let items = items.as_array().unwrap_or(&empty);

    let parent = if folder_id.is_empty() { "/" } else { folder_id };
    let mut files = Vec::new();
    let mut folders = Vec::new();
    for item in items {
        if let Some(info) = item.get("fileInfo") {
            files.push(json!({
                "fileId": str_of(info, "fileId"),
                "fileName": str_of(info, "fileName"),
                "fileSize": num_of(info, "fileSize"),
                "uploadTime": info.get("uploadTime").cloned().unwrap_or(Value::Null),
                "uploaderUin": str_of(info, "uploaderUin"),
                "uploaderNick": str_of(info, "uploaderName"),
                "downloadCount": info.get("downloadTimes").cloned().unwrap_or(Value::Null),
                "deadTime": info.get("deadTime").cloned().unwrap_or(Value::Null),
                "modifyTime": info.get("modifyTime").cloned().unwrap_or(Value::Null),
                "parentFolderId": parent,
            }));
        }
        if let Some(info) = item.get("folderInfo") {
            folders.push(json!({
                "folderId": str_of(info, "folderId"),
                "folderName": str_of(info, "folderName"),
                "createTime": info.get("createTime").cloned().unwrap_or(Value::Null),
                "creatorUin": str_of(info, "createUin"),
                "creatorNick": str_of(info, "creatorName"),
                "totalFileCount": info.get("totalFileCount").cloned().unwrap_or(Value::Null),
                "parentFolderId": parent,
            }));
        }
    }
    (files, folders)
}

/// 广度优先递归获取全部文件与文件夹。
async fn fetch_all_files_recursive(
    state: &SharedState,
    group_code: &str,
) -> (Vec<Value>, Vec<Value>) {
    let mut all_files = Vec::new();
    let mut all_folders = Vec::new();
    let mut queue: Vec<String> = vec![String::new()];
    while let Some(folder_id) = queue.pop() {
        let (files, folders) = fetch_file_list(state, group_code, &folder_id, 0, 100).await;
        all_files.extend(files);
        for folder in folders {
            queue.push(str_of(&folder, "folderId"));
            all_folders.push(folder);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    (all_files, all_folders)
}

/// 获取群文件下载链接。
async fn file_download_url(state: &SharedState, group_code: &str, file_id: &str) -> Option<String> {
    let file_uuid = file_id.strip_prefix('/').unwrap_or(file_id);
    let result = state.napcat.get_group_file_url(group_code, file_uuid).await.ok()?;
    match result {
        Value::String(url) if !url.is_empty() => Some(url),
        other => {
            let url = str_of(&other, "url");
            if url.is_empty() { None } else { Some(url) }
        }
    }
}

/// `GET /api/groups/:groupCode/files` — 群文件列表（单层）。
pub async fn list_group_files(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群号不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let folder_id = params.get("folderId").cloned().unwrap_or_default();
    let start_index = params
        .get("startIndex")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let file_count = params
        .get("fileCount")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|c| *c >= 1)
        .unwrap_or(100);
    let (files, folders) =
        fetch_file_list(&state, &group_code, &folder_id, start_index, file_count).await;
    response::success(
        json!({
            "files": files,
            "folders": folders,
            "fileCount": files.len(),
            "folderCount": folders.len(),
        }),
        &request_id,
    )
}

/// `GET /api/groups/:groupCode/files/count` — 群文件数量。
pub async fn group_file_count(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群号不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let count = match state.napcat.get_group_file_count(vec![group_code.clone()]).await {
        Ok(result) => result
            .get("groupFileCounts")
            .and_then(Value::as_array)
            .and_then(|counts| counts.first())
            .and_then(Value::as_i64)
            .unwrap_or(0),
        Err(_) => 0,
    };
    response::success(
        json!({
            "groupCode": group_code,
            "fileCount": count,
        }),
        &request_id,
    )
}

/// `POST /api/groups/:groupCode/files/download` — 获取文件下载链接。
pub async fn download_group_file(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let file_id = str_of(&body, "fileId");
    if group_code.is_empty() || file_id.is_empty() {
        let err = ApiError::validation("群号和文件ID不能为空", "INVALID_PARAMS");
        return response::error(&err, &request_id);
    }
    match file_download_url(&state, &group_code, &file_id).await {
        Some(url) => response::success(
            json!({
                "fileId": file_id,
                "downloadUrl": url,
            }),
            &request_id,
        ),
        None => {
            let err = ApiError::new(ErrorType::Api, "获取文件下载链接失败", "DOWNLOAD_URL_FAILED");
            response::error(&err, &request_id)
        }
    }
}

/// 生成可读文件清单（Markdown）。
fn build_readable_list(group_name: &str, files: &[Value], folders: &[Value], total_size: i64) -> String {
    let mut text = format!("# {group_name} 群文件列表\n");
    text.push_str(&format!("导出时间: {}\n", now_iso()));
    text.push_str(&format!("文件总数: {}\n", files.len()));
    text.push_str(&format!("文件夹数: {}\n", folders.len()));
    text.push_str(&format!("总大小: {}\n\n", format_file_size(total_size)));

    let root_files: Vec<&Value> = files
        .iter()
        .filter(|f| matches!(str_of(f, "parentFolderId").as_str(), "/" | ""))
        .collect();
    if !root_files.is_empty() {
        text.push_str(&format!("## 根目录 ({} 个文件)\n\n", root_files.len()));
        for file in &root_files {
            text.push_str(&format!(
                "- {} ({})\n",
                str_of(file, "fileName"),
                format_file_size(num_of(file, "fileSize"))
            ));
        }
        text.push('\n');
    }
    for folder in folders {
        let folder_id = str_of(folder, "folderId");
        let folder_files: Vec<&Value> = files
            .iter()
            .filter(|f| str_of(f, "parentFolderId") == folder_id)
            .collect();
        text.push_str(&format!(
            "## {} ({} 个文件)\n\n",
            str_of(folder, "folderName"),
            folder_files.len()
        ));
        for file in &folder_files {
            text.push_str(&format!(
                "- {} ({})\n",
                str_of(file, "fileName"),
                format_file_size(num_of(file, "fileSize"))
            ));
        }
        text.push('\n');
    }
    text
}

/// `POST /api/groups/:groupCode/files/export` — 导出群文件元数据（不下载）。
pub async fn export_group_files_metadata(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群号不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let group_name = {
        let name = str_of(&body, "groupName");
        if name.is_empty() { group_code.clone() } else { name }
    };
    let id = export_id();
    let export_dir = export_base_path(&state).join(format!(
        "{}_{}_{}",
        sanitize(&group_name),
        group_code,
        chrono::Utc::now().timestamp_millis()
    ));
    if let Err(error) = tokio::fs::create_dir_all(&export_dir).await {
        let err = ApiError::new(ErrorType::FileSystem, error.to_string(), "CREATE_DIR_FAILED");
        return response::error(&err, &request_id);
    }

    let (files, folders) = fetch_all_files_recursive(&state, &group_code).await;
    let total_size: i64 = files.iter().map(|f| num_of(f, "fileSize")).sum();

    let metadata = json!({
        "groupCode": group_code,
        "groupName": group_name,
        "exportTime": now_iso(),
        "fileCount": files.len(),
        "folderCount": folders.len(),
        "totalSize": total_size,
        "folders": folders
            .iter()
            .map(|folder| {
                let folder_id = str_of(folder, "folderId");
                let mut entry = folder.clone();
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert(
                        "files".to_string(),
                        Value::Array(
                            files
                                .iter()
                                .filter(|f| str_of(f, "parentFolderId") == folder_id)
                                .cloned()
                                .collect(),
                        ),
                    );
                }
                entry
            })
            .collect::<Vec<Value>>(),
        "rootFiles": files
            .iter()
            .filter(|f| matches!(str_of(f, "parentFolderId").as_str(), "/" | ""))
            .cloned()
            .collect::<Vec<Value>>(),
    });
    if let Ok(data) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(export_dir.join("file-list.json"), data).await;
    }
    let readable = build_readable_list(&group_name, &files, &folders, total_size);
    let _ = tokio::fs::write(export_dir.join("file-list.md"), readable).await;

    add_record(
        &state,
        json!({
            "id": id,
            "groupCode": group_code,
            "groupName": group_name,
            "fileCount": files.len(),
            "folderCount": folders.len(),
            "downloadedCount": 0,
            "totalSize": total_size,
            "exportPath": export_dir.to_string_lossy(),
            "exportTime": now_iso(),
            "success": true,
        }),
    )
    .await;

    response::success(
        json!({
            "success": true,
            "groupCode": group_code,
            "groupName": group_name,
            "fileCount": files.len(),
            "folderCount": folders.len(),
            "downloadedCount": 0,
            "failedCount": 0,
            "totalSize": total_size,
            "exportPath": export_dir.to_string_lossy(),
            "exportId": id,
        }),
        &request_id,
    )
}

/// 下载单个群文件到指定路径（通过下载链接）。
async fn download_file_to(state: &SharedState, group_code: &str, file_id: &str, dest: &FsPath) -> bool {
    let Some(url) = file_download_url(state, group_code, file_id).await else {
        return false;
    };
    match http_get_bytes(&url).await {
        Some(data) => tokio::fs::write(dest, data).await.is_ok(),
        None => false,
    }
}

/// `POST /api/groups/:groupCode/files/export-with-download` — 导出并下载群文件。
pub async fn export_group_files_with_download(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群号不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let group_name = {
        let name = str_of(&body, "groupName");
        if name.is_empty() { group_code.clone() } else { name }
    };
    let id = export_id();
    let export_dir = export_base_path(&state).join(format!(
        "{}_{}_{}",
        sanitize(&group_name),
        group_code,
        chrono::Utc::now().timestamp_millis()
    ));
    if let Err(error) = tokio::fs::create_dir_all(&export_dir).await {
        let err = ApiError::new(ErrorType::FileSystem, error.to_string(), "CREATE_DIR_FAILED");
        return response::error(&err, &request_id);
    }

    let (files, folders) = fetch_all_files_recursive(&state, &group_code).await;
    let total_size: i64 = files.iter().map(|f| num_of(f, "fileSize")).sum();

    // 文件夹层级映射：folderId → 本地路径。
    let mut folder_paths: HashMap<String, PathBuf> = HashMap::new();
    folder_paths.insert("/".to_string(), export_dir.clone());
    folder_paths.insert(String::new(), export_dir.clone());
    for folder in &folders {
        let parent = str_of(folder, "parentFolderId");
        let parent_path = folder_paths.get(&parent).cloned().unwrap_or_else(|| export_dir.clone());
        let folder_path = parent_path.join(sanitize(&str_of(folder, "folderName")));
        let _ = tokio::fs::create_dir_all(&folder_path).await;
        folder_paths.insert(str_of(folder, "folderId"), folder_path);
    }

    let mut downloaded = 0usize;
    let mut failed = 0usize;
    for (index, file) in files.iter().enumerate() {
        let parent = str_of(file, "parentFolderId");
        let parent_path = folder_paths.get(&parent).cloned().unwrap_or_else(|| export_dir.clone());
        let file_path = parent_path.join(sanitize(&str_of(file, "fileName")));

        state.broadcast_ws(&json!({
            "type": "group_files_export_progress",
            "data": {
                "exportId": id,
                "phase": "downloading",
                "current": index + 1,
                "total": files.len(),
                "fileName": str_of(file, "fileName"),
            },
        }));

        if download_file_to(&state, &group_code, &str_of(file, "fileId"), &file_path).await {
            downloaded += 1;
        } else {
            failed += 1;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let metadata = json!({
        "groupCode": group_code,
        "groupName": group_name,
        "exportTime": now_iso(),
        "fileCount": files.len(),
        "folderCount": folders.len(),
        "downloadedCount": downloaded,
        "failedCount": failed,
        "totalSize": total_size,
        "files": files,
        "folders": folders,
    });
    if let Ok(data) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(export_dir.join("metadata.json"), data).await;
    }

    add_record(
        &state,
        json!({
            "id": id,
            "groupCode": group_code,
            "groupName": group_name,
            "fileCount": files.len(),
            "folderCount": folders.len(),
            "downloadedCount": downloaded,
            "totalSize": total_size,
            "exportPath": export_dir.to_string_lossy(),
            "exportTime": now_iso(),
            "success": true,
        }),
    )
    .await;

    response::success(
        json!({
            "success": true,
            "groupCode": group_code,
            "groupName": group_name,
            "fileCount": files.len(),
            "folderCount": folders.len(),
            "downloadedCount": downloaded,
            "failedCount": failed,
            "totalSize": total_size,
            "exportPath": export_dir.to_string_lossy(),
            "exportId": id,
        }),
        &request_id,
    )
}
