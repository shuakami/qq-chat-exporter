//! 群相册路由：相册列表 / 媒体列表 / 导出 / 导出记录（对应 TS `GroupAlbumExporter`）。

use std::collections::HashMap;
use std::path::PathBuf;
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
    state.path_manager.default_base_dir().join("group-albums")
}

fn records_path(state: &SharedState) -> PathBuf {
    state
        .path_manager
        .default_base_dir()
        .join("group-album-records.json")
}

async fn load_records(state: &SharedState) -> Vec<Value> {
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

/// 获取相册列表（规范化为 `{albumId, albumName}`）。
async fn fetch_album_list(state: &SharedState, group_code: &str) -> Vec<Value> {
    let Ok(result) = state.napcat.get_album_list(group_code).await else {
        return Vec::new();
    };
    let response_value = result.get("response").unwrap_or(&result);
    if response_value.get("result").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Vec::new();
    }
    let empty: Vec<Value> = Vec::new();
    let album_list = response_value
        .get("album_list")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    album_list
        .iter()
        .map(|album| {
            let album_id = str_of(album, "album_id");
            let name = {
                let n = str_of(album, "name");
                if n.is_empty() { format!("相册_{album_id}") } else { n }
            };
            json!({
                "albumId": album_id,
                "albumName": name,
            })
        })
        .collect()
}

/// 单个媒体项规范化（兼容多种嵌套结构）。
fn normalize_media_item(item: &Value) -> Value {
    let media_data = item
        .get("cell_media")
        .or_else(|| item.get("media"))
        .unwrap_or(item);
    let image_data = media_data.get("image").unwrap_or(media_data);
    let id = {
        let candidates = [
            str_of(image_data, "lloc"),
            str_of(item, "lloc"),
            str_of(item, "id"),
        ];
        candidates
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or_else(|| {
                format!(
                    "media_{}_{}",
                    chrono::Utc::now().timestamp_millis(),
                    &uuid::Uuid::new_v4().simple().to_string()[..9]
                )
            })
    };
    let url = [
        str_of(image_data, "raw_url"),
        str_of(image_data, "url"),
        str_of(image_data, "originUrl"),
        str_of(item, "raw_url"),
        str_of(item, "url"),
    ]
    .into_iter()
    .find(|s| !s.is_empty())
    .unwrap_or_default();
    let thumb_url = [
        str_of(image_data, "thumb_url"),
        str_of(image_data, "thumbUrl"),
        str_of(item, "thumb_url"),
    ]
    .into_iter()
    .find(|s| !s.is_empty())
    .unwrap_or_default();
    let is_video = item.get("is_video").and_then(Value::as_bool).unwrap_or(false)
        || item.get("isVideo").and_then(Value::as_bool).unwrap_or(false)
        || media_data.get("type").and_then(Value::as_i64) == Some(1);
    json!({
        "id": id,
        "url": url,
        "thumbUrl": thumb_url,
        "type": if is_video { "video" } else { "image" },
        "uploadTime": item.get("upload_time").cloned().unwrap_or(Value::Null),
        "uploaderUin": item.get("owner_uin").cloned().or_else(|| item.get("ownerUin").cloned()).unwrap_or(Value::Null),
        "uploaderNick": item.get("owner_name").cloned().or_else(|| item.get("ownerName").cloned()).unwrap_or(Value::Null),
        "width": image_data.get("width").cloned().or_else(|| item.get("width").cloned()).unwrap_or(Value::Null),
        "height": image_data.get("height").cloned().or_else(|| item.get("height").cloned()).unwrap_or(Value::Null),
        "fileSize": image_data.get("picsize").cloned().or_else(|| item.get("picsize").cloned()).unwrap_or(Value::Null),
    })
}

/// 分页获取相册媒体（attach_info 翻页直到结束）。
async fn fetch_album_media(state: &SharedState, group_code: &str, album_id: &str) -> Vec<Value> {
    let mut media_items = Vec::new();
    let mut attach_info = String::new();
    loop {
        let Ok(response_value) = state
            .napcat
            .get_album_media_list(group_code, album_id, &attach_info)
            .await
        else {
            break;
        };
        if response_value.get("result").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            break;
        }
        let empty: Vec<Value> = Vec::new();
        let items = ["media_list", "mediaList", "feed_list", "feedList", "list"]
            .iter()
            .find_map(|key| response_value.get(*key).and_then(Value::as_array))
            .unwrap_or(&empty);
        for item in items {
            let normalized = normalize_media_item(item);
            if !str_of(&normalized, "url").is_empty() {
                media_items.push(normalized);
            }
        }
        let next = [
            str_of(&response_value, "attach_info"),
            str_of(&response_value, "attachInfo"),
        ]
        .into_iter()
        .find(|s| !s.is_empty());
        match next {
            Some(info) if !items.is_empty() => attach_info = info,
            _ => break,
        }
    }
    media_items
}

/// `GET /api/groups/:groupCode/albums` — 相册列表。
pub async fn list_group_albums(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群号不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let albums = fetch_album_list(&state, &group_code).await;
    response::success(
        json!({
            "albums": albums,
            "totalCount": albums.len(),
        }),
        &request_id,
    )
}

/// `GET /api/groups/:groupCode/albums/:albumId/media` — 相册媒体列表。
pub async fn list_album_media(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path((group_code, album_id)): Path<(String, String)>,
) -> Response {
    if group_code.is_empty() || album_id.is_empty() {
        let err = ApiError::validation("群号和相册ID不能为空", "INVALID_PARAMS");
        return response::error(&err, &request_id);
    }
    let media = fetch_album_media(&state, &group_code, &album_id).await;
    response::success(
        json!({
            "media": media,
            "totalCount": media.len(),
        }),
        &request_id,
    )
}

/// `POST /api/groups/:groupCode/albums/export` — 导出群相册（后台执行）。
pub async fn export_group_album(
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
    let album_ids: Vec<String> = body
        .get("albumIds")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().map(ToString::to_string))
                .collect()
        })
        .unwrap_or_default();

    let export_id = format!(
        "album_{}_{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..9]
    );
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

    let albums = fetch_album_list(&state, &group_code).await;
    if albums.is_empty() {
        let err = ApiError::new(ErrorType::Api, "未找到相册", "NO_ALBUMS");
        return response::error(&err, &request_id);
    }
    let target_albums: Vec<Value> = if album_ids.is_empty() {
        albums
    } else {
        albums
            .into_iter()
            .filter(|album| album_ids.contains(&str_of(album, "albumId")))
            .collect()
    };

    let mut total_media = 0usize;
    let mut downloaded = 0usize;
    let mut failed = 0usize;
    let mut album_data: Vec<Value> = Vec::new();

    for (index, album) in target_albums.iter().enumerate() {
        let album_name = str_of(album, "albumName");
        let album_dir = export_dir.join(sanitize(&album_name));
        let _ = tokio::fs::create_dir_all(&album_dir).await;

        state.broadcast_ws(&json!({
            "type": "album_export_progress",
            "data": {
                "exportId": export_id,
                "phase": "fetching",
                "current": index + 1,
                "total": target_albums.len(),
                "albumName": album_name,
            },
        }));

        let media_items = fetch_album_media(&state, &group_code, &str_of(album, "albumId")).await;
        total_media += media_items.len();

        let mut album_media_data: Vec<Value> = Vec::new();
        for media in &media_items {
            let ext = if str_of(media, "type") == "video" { ".mp4" } else { ".jpg" };
            let file_name = format!("{}{ext}", sanitize(&str_of(media, "id")));
            let file_path = album_dir.join(&file_name);

            state.broadcast_ws(&json!({
                "type": "album_export_progress",
                "data": {
                    "exportId": export_id,
                    "phase": "downloading",
                    "current": downloaded + failed + 1,
                    "total": total_media,
                    "albumName": album_name,
                    "fileName": file_name,
                },
            }));

            let url = str_of(media, "url");
            let ok = match http_get_bytes(&url).await {
                Some(data) => tokio::fs::write(&file_path, data).await.is_ok(),
                None => false,
            };
            let mut entry = media.clone();
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("downloaded".to_string(), Value::Bool(ok));
                if ok {
                    obj.insert("localPath".to_string(), Value::String(file_name));
                }
            }
            if ok {
                downloaded += 1;
            } else {
                failed += 1;
            }
            album_media_data.push(entry);
            // 避免请求过快。
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let downloaded_in_album = album_media_data
            .iter()
            .filter(|m| m.get("downloaded").and_then(Value::as_bool).unwrap_or(false))
            .count();
        album_data.push(json!({
            "albumId": str_of(album, "albumId"),
            "albumName": album_name,
            "mediaCount": media_items.len(),
            "downloadedCount": downloaded_in_album,
            "media": album_media_data,
        }));
    }

    // 保存元数据。
    let metadata = json!({
        "groupCode": group_code,
        "groupName": group_name,
        "exportTime": now_iso(),
        "albumCount": target_albums.len(),
        "totalMediaCount": total_media,
        "downloadedCount": downloaded,
        "failedCount": failed,
        "albums": album_data,
    });
    if let Ok(data) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(export_dir.join("metadata.json"), data).await;
    }

    add_record(
        &state,
        json!({
            "id": export_id,
            "groupCode": group_code,
            "groupName": group_name,
            "albumCount": target_albums.len(),
            "mediaCount": total_media,
            "downloadedCount": downloaded,
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
            "albumCount": target_albums.len(),
            "mediaCount": total_media,
            "downloadedCount": downloaded,
            "failedCount": failed,
            "exportPath": export_dir.to_string_lossy(),
            "exportId": export_id,
        }),
        &request_id,
    )
}

/// `GET /api/group-albums/export-records` — 相册导出记录。
pub async fn album_export_records(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|l| *l >= 1)
        .unwrap_or(50);
    let mut records = load_records(&state).await;
    records.truncate(limit);
    response::success(
        json!({
            "records": records,
            "totalCount": records.len(),
        }),
        &request_id,
    )
}
