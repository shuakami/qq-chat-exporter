use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};

use axum::extract::{Extension, Query, State};
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};

use crate::api::helpers::http_get_bytes;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// 内嵌系统表情配置（与解析器共用）。
static FACE_CONFIG: &str = include_str!("../../../assets/face_config.json");

/// 导出记录保留上限。
const RECORD_LIMIT: usize = 100;

fn export_base_path(state: &SharedState) -> PathBuf {
    state.path_manager.exports_dir().join("sticker-packs")
}

/// 导出记录文件路径。
fn records_path(state: &SharedState) -> PathBuf {
    state
        .path_manager
        .default_base_dir()
        .join("sticker-export-records.json")
}

/// 读取导出记录。
async fn load_records(state: &SharedState) -> Vec<Value> {
    let path = records_path(state);
    match tokio::fs::read_to_string(&path).await {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 追加导出记录（保留最近 100 条）。
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

fn list_values(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(list)) => list.clone(),
        Some(Value::Object(map)) => map.values().cloned().collect(),
        _ => Vec::new(),
    }
}

fn object_result(value: &Value) -> &Value {
    value
        .get("result")
        .filter(|result| result.is_object())
        .unwrap_or(value)
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

/// 收藏表情 → 表情包。
async fn favorite_pack(state: &SharedState) -> Option<Value> {
    let result = match state
        .napcat
        .call(
            "MsgService.fetchFavEmojiList",
            json!(["", 1000, true, true]),
        )
        .await
    {
        Ok(result) => result,
        Err(_) => state
            .napcat
            .call("MsgApi.fetchFavEmojiList", json!([1000]))
            .await
            .ok()?,
    };
    let result = object_result(&result);
    let list = list_values(result.get("emojiInfoList"));
    if list.is_empty() {
        return None;
    }
    let stickers: Vec<Value> = list
        .iter()
        .map(|emoji| {
            let sticker_id = {
                let eid = str_of(emoji, "eId");
                if eid.is_empty() {
                    str_of(emoji, "emoId")
                } else {
                    eid
                }
            };
            let name = {
                let desc = str_of(emoji, "desc");
                let word = str_of(emoji, "modifyWord");
                if !desc.is_empty() {
                    desc
                } else if !word.is_empty() {
                    word
                } else {
                    format!("表情_{}", str_of(emoji, "emoId"))
                }
            };
            let path = {
                let p = str_of(emoji, "emoPath");
                if p.is_empty() {
                    str_of(emoji, "emoOriginalPath")
                } else {
                    p
                }
            };
            json!({
                "stickerId": sticker_id,
                "name": name,
                "path": path,
                "downloaded": emoji.get("isExist").and_then(Value::as_bool).unwrap_or(false),
                "md5": str_of(emoji, "md5"),
                "fileSize": 0,
            })
        })
        .collect();
    Some(json!({
        "packId": "favorite_emojis",
        "packName": "收藏的表情",
        "packType": "favorite_emoji",
        "description": "用户收藏的单个表情",
        "stickerCount": stickers.len(),
        "stickers": stickers,
    }))
}

/// 市场表情包 tab 列表提取。
fn market_tab_list(result: &Value) -> Vec<Value> {
    let Some(tab) = object_result(result)
        .get("marketEmoticonInfo")
        .and_then(|i| i.get("roamEmojiTab"))
    else {
        return Vec::new();
    };
    for key in ["ordinaryTabinfoList", "ordinaryTabInfoList"] {
        if let Some(list) = tab.get(key).and_then(Value::as_array) {
            if !list.is_empty() {
                return list.clone();
            }
        }
    }
    for key in ["ordinaryTabinfoList", "ordinaryTabInfoList"] {
        if let Some(list) = tab.get(key).and_then(Value::as_array) {
            return list.clone();
        }
    }
    Vec::new()
}

/// 从市场表情包 JSON 文件解析表情列表。
fn parse_market_json(pack_data: &Value) -> Vec<Value> {
    list_values(pack_data.get("imgs"))
        .iter()
        .map(|emoji| {
            let md5 = str_of(emoji, "id");
            let name = {
                let n = str_of(emoji, "name");
                if n.is_empty() {
                    format!("表情_{md5}")
                } else {
                    n
                }
            };
            let prefix: String = md5.chars().take(2).collect();
            let url =
                format!("https://gxh.vip.qq.com/club/item/parcel/item/{prefix}/{md5}/raw300.gif");
            json!({
                "stickerId": md5,
                "name": name,
                "path": url,
                "downloaded": true,
                "md5": md5,
                "fileSize": 0,
            })
        })
        .collect()
}

fn parse_market_pack_info(pack_info: &Value) -> Vec<Value> {
    let pack_info = object_result(pack_info);
    let list = if pack_info.get("emojiInfoList").is_some() {
        list_values(pack_info.get("emojiInfoList"))
    } else {
        list_values(
            pack_info
                .get("marketEmoticonInfo")
                .and_then(|info| info.get("emojiList")),
        )
    };
    list.iter()
        .map(|emoji| {
            let sticker_id = ["eId", "emoId", "id"]
                .iter()
                .map(|key| str_of(emoji, key))
                .find(|value| !value.is_empty())
                .unwrap_or_default();
            let name = ["name", "desc", "emojiName"]
                .iter()
                .map(|key| str_of(emoji, key))
                .find(|value| !value.is_empty())
                .unwrap_or_else(|| format!("表情_{sticker_id}"));
            let path = ["path", "emoPath"]
                .iter()
                .map(|key| str_of(emoji, key))
                .find(|value| !value.is_empty())
                .unwrap_or_default();
            json!({
                "stickerId": sticker_id,
                "name": name,
                "path": path,
                "downloaded": emoji.get("isExist").and_then(Value::as_bool).unwrap_or(false),
                "md5": str_of(emoji, "md5"),
                "fileSize": emoji.get("size").and_then(Value::as_u64).unwrap_or(0),
            })
        })
        .collect()
}

async fn fetch_market_tabs(state: &SharedState) -> Option<Value> {
    let mut fallback = None;
    for params in [json!(["", 0]), json!([0, 0])] {
        if let Ok(result) = state
            .napcat
            .call("MsgService.fetchMarketEmoticonList", params)
            .await
        {
            if !market_tab_list(&result).is_empty() {
                return Some(result);
            }
            fallback.get_or_insert(result);
        }
    }
    if let Ok(result) = state
        .napcat
        .call("MsgApi.fetchMarketEmoticonList", json!([]))
        .await
    {
        if !market_tab_list(&result).is_empty() {
            return Some(result);
        }
        fallback.get_or_insert(result);
    }
    fallback
}

async fn fetch_market_pack_detail(state: &SharedState, method: &str, ep_id: &str) -> Option<Value> {
    let raw_method = format!("MsgService.{method}");
    match state.napcat.call(&raw_method, json!([ep_id])).await {
        Ok(result) => Some(result),
        Err(_) => {
            let api_method = format!("MsgApi.{method}");
            state.napcat.call(&api_method, json!([ep_id])).await.ok()
        }
    }
}

/// 市场表情包列表。
async fn market_packs(state: &SharedState) -> Vec<Value> {
    let mut packs = Vec::new();
    let Some(result) = fetch_market_tabs(state).await else {
        return packs;
    };
    for tab in market_tab_list(&result) {
        let ep_id = str_of(&tab, "epId");
        let pack_name = {
            let name = str_of(&tab, "tabName");
            if name.is_empty() {
                format!("表情包 #{ep_id}")
            } else {
                name
            }
        };
        let mut stickers: Vec<Value> = Vec::new();
        let mut description = String::new();
        if let Some(json_result) =
            fetch_market_pack_detail(state, "fetchMarketEmotionJsonFile", &ep_id).await
        {
            let ok = json_result.get("result").and_then(Value::as_i64) == Some(0);
            let json_path = str_of(&json_result, "errMsg");
            if ok && !json_path.is_empty() {
                if let Ok(content) = tokio::fs::read_to_string(&json_path).await {
                    if let Ok(pack_data) = serde_json::from_str::<Value>(&content) {
                        stickers = parse_market_json(&pack_data);
                        description = ["mark", "description"]
                            .iter()
                            .map(|key| str_of(&pack_data, key))
                            .find(|value| !value.is_empty())
                            .unwrap_or_default();
                    }
                }
            }
        }
        for method in [
            "fetchMarketEmoticonFaceImages",
            "fetchMarketEmoticonAioImage",
        ] {
            if !stickers.is_empty() {
                break;
            }
            if let Some(detail) = fetch_market_pack_detail(state, method, &ep_id).await {
                if detail.get("result").and_then(Value::as_i64) == Some(0) {
                    stickers = parse_market_pack_info(&detail);
                    description = ["mark", "description"]
                        .iter()
                        .map(|key| str_of(&detail, key))
                        .find(|value| !value.is_empty())
                        .unwrap_or_default();
                }
            }
        }
        if description.is_empty() {
            description = if stickers.is_empty() {
                "待加载详情".to_string()
            } else {
                format!("包含 {} 个表情", stickers.len())
            };
        }
        packs.push(json!({
            "packId": format!("market_{ep_id}"),
            "packName": pack_name,
            "packType": "market_pack",
            "description": description,
            "stickerCount": stickers.len(),
            "stickers": stickers,
        }));
    }
    packs
}

/// 系统表情包（内嵌 face_config.json，按 AniStickerPackName 分组）。
fn system_packs() -> Vec<Value> {
    let Ok(config) = serde_json::from_str::<Value>(FACE_CONFIG) else {
        return Vec::new();
    };
    let empty: Vec<Value> = Vec::new();
    let sysface = config
        .get("sysface")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let mut pack_map: Vec<(String, Vec<&Value>)> = Vec::new();
    for face in sysface {
        let pack_name = {
            let name = str_of(face, "AniStickerPackName");
            if name.is_empty() {
                "系统表情".to_string()
            } else {
                name
            }
        };
        match pack_map.iter_mut().find(|(name, _)| *name == pack_name) {
            Some((_, faces)) => faces.push(face),
            None => pack_map.push((pack_name, vec![face])),
        }
    }
    pack_map
        .into_iter()
        .map(|(pack_name, faces)| {
            let stickers: Vec<Value> = faces
                .iter()
                .map(|face| {
                    let sticker_id = {
                        let sid = str_of(face, "QSid");
                        if sid.is_empty() {
                            str_of(face, "AniStickerId")
                        } else {
                            sid
                        }
                    };
                    let name = {
                        let desc = str_of(face, "QDes");
                        if desc.is_empty() {
                            format!("表情_{}", str_of(face, "QSid"))
                        } else {
                            desc
                        }
                    };
                    json!({
                        "stickerId": sticker_id,
                        "name": name,
                        "path": "",
                        "downloaded": false,
                        "fileSize": 0,
                    })
                })
                .collect();
            json!({
                "packId": format!("system_{}", pack_name.replace(char::is_whitespace, "_")),
                "packName": format!("系统表情 - {pack_name}"),
                "packType": "system_pack",
                "description": "QQ系统内置表情包",
                "stickerCount": stickers.len(),
                "stickers": stickers,
            })
        })
        .collect()
}

/// 汇总获取表情包列表。
async fn get_sticker_packs(state: &SharedState, types: Option<&Vec<String>>) -> Vec<Value> {
    let want = |t: &str| types.is_none_or(|list| list.iter().any(|item| item == t));
    let mut packs = Vec::new();
    if want("favorite_emoji") {
        if let Some(pack) = favorite_pack(state).await {
            packs.push(pack);
        }
    }
    if want("market_pack") {
        packs.extend(market_packs(state).await);
    }
    if want("system_pack") {
        packs.extend(system_packs());
    }
    packs
}

/// issue #313：按 magic bytes 判断真实图片扩展名。
fn detect_ext_by_magic(buf: &[u8]) -> Option<&'static str> {
    if buf.len() < 4 {
        return None;
    }
    if buf.starts_with(&[0x47, 0x49, 0x46, 0x38]) {
        return Some(".gif");
    }
    if buf.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some(".png");
    }
    if buf.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(".jpg");
    }
    if buf.len() >= 12 && buf.starts_with(b"RIFF") && &buf[8..12] == b"WEBP" {
        return Some(".webp");
    }
    if buf.starts_with(b"BM") {
        return Some(".bmp");
    }
    None
}

/// issue #313：将落盘文件按真实格式重命名扩展名。
async fn normalize_sticker_extension(path: &FsPath) -> PathBuf {
    let Ok(data) = tokio::fs::read(path).await else {
        return path.to_path_buf();
    };
    let Some(detected) = detect_ext_by_magic(&data[..data.len().min(12)]) else {
        return path.to_path_buf();
    };
    let current_ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if current_ext == detected {
        return path.to_path_buf();
    }
    let target = path.with_extension(&detected[1..]);
    if (tokio::fs::remove_file(&target).await.is_ok() || !target.exists())
        && tokio::fs::rename(path, &target).await.is_ok()
    {
        return target;
    }
    path.to_path_buf()
}

/// 根据源路径 / URL 猜初始扩展名（最终由 magic bytes 校正）。
fn guess_initial_extension(source: &str) -> String {
    let path_part = if source.starts_with("http://") || source.starts_with("https://") {
        source.split('?').next().unwrap_or(source)
    } else {
        source
    };
    FsPath::new(path_part).extension().map_or_else(
        || ".gif".to_string(),
        |e| format!(".{}", e.to_string_lossy()),
    )
}

/// 下载或复制单个表情文件。
async fn save_sticker(sticker: &Value, stickers_dir: &FsPath) -> bool {
    let source = str_of(sticker, "path");
    if source.is_empty() {
        return false;
    }
    let initial_ext = guess_initial_extension(&source);
    let file_name = format!(
        "{}_{}{}",
        str_of(sticker, "stickerId"),
        sanitize(&str_of(sticker, "name")),
        initial_ext
    );
    let dest = stickers_dir.join(file_name);
    let ok = if source.starts_with("http://") || source.starts_with("https://") {
        match http_get_bytes(&source).await {
            Some(bytes) => tokio::fs::write(&dest, bytes).await.is_ok(),
            None => false,
        }
    } else {
        tokio::fs::copy(&source, &dest).await.is_ok()
    };
    if ok {
        normalize_sticker_extension(&dest).await;
    }
    ok
}

/// 导出单个表情包到目录，返回成功下载数。
async fn export_pack_to_dir(_state: &SharedState, pack: &Value, pack_dir: &FsPath) -> usize {
    let _ = tokio::fs::create_dir_all(pack_dir).await;
    if let Ok(info) = serde_json::to_string_pretty(pack) {
        let _ = tokio::fs::write(pack_dir.join("pack_info.json"), info).await;
    }
    let stickers_dir = pack_dir.join("stickers");
    let _ = tokio::fs::create_dir_all(&stickers_dir).await;
    let empty: Vec<Value> = Vec::new();
    let stickers = pack
        .get("stickers")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let mut success = 0usize;
    // 分批并发下载（并发度 10）。
    for batch in stickers.chunks(10) {
        let results = futures_util::future::join_all(
            batch
                .iter()
                .map(|sticker| save_sticker(sticker, &stickers_dir)),
        )
        .await;
        success += results.into_iter().filter(|ok| *ok).count();
    }
    success
}

fn export_id() -> String {
    format!(
        "export_{}_{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().simple().to_string()[..9]
    )
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// `GET /api/sticker-packs` — 表情包列表。
pub async fn list_sticker_packs(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let types: Option<Vec<String>> = params.get("types").map(|raw| {
        raw.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });
    let packs = get_sticker_packs(&state, types.as_ref()).await;
    let total_stickers: u64 = packs
        .iter()
        .map(|p| p.get("stickerCount").and_then(Value::as_u64).unwrap_or(0))
        .sum();
    let mut stats: HashMap<String, u64> = HashMap::new();
    for key in ["favorite_emoji", "market_pack", "system_pack"] {
        stats.insert(key.to_string(), 0);
    }
    for pack in &packs {
        let pack_type = str_of(pack, "packType");
        *stats.entry(pack_type).or_insert(0) += 1;
    }
    response::success(
        json!({
            "packs": packs,
            "totalCount": packs.len(),
            "totalStickers": total_stickers,
            "stats": stats,
        }),
        &request_id,
    )
}

/// `POST /api/sticker-packs/export` — 导出指定表情包。
pub async fn export_sticker_pack(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let pack_id = str_of(&body, "packId");
    if pack_id.is_empty() {
        let err = ApiError::validation("packId 不能为空", "INVALID_PACK_ID");
        return response::error(&err, &request_id);
    }
    let packs = get_sticker_packs(&state, None).await;
    let Some(pack) = packs.iter().find(|p| str_of(p, "packId") == pack_id) else {
        let err = ApiError::not_found("表情包不存在", "PACK_NOT_FOUND");
        return response::error(&err, &request_id);
    };

    let pack_name = str_of(pack, "packName");
    let export_dir = export_base_path(&state).join(format!(
        "{}_{}",
        sanitize(&pack_name),
        chrono::Utc::now().timestamp_millis()
    ));
    let success_count = export_pack_to_dir(&state, pack, &export_dir).await;

    let id = export_id();
    add_record(
        &state,
        json!({
            "id": id,
            "type": "single",
            "packId": pack_id,
            "packName": pack_name,
            "packCount": 1,
            "stickerCount": success_count,
            "exportPath": export_dir.to_string_lossy(),
            "exportTime": now_iso(),
            "success": true,
        }),
    )
    .await;

    response::success(
        json!({
            "success": true,
            "packCount": 1,
            "stickerCount": success_count,
            "exportPath": export_dir.to_string_lossy(),
            "exportId": id,
        }),
        &request_id,
    )
}

/// `POST /api/sticker-packs/export-all` — 导出所有表情包。
pub async fn export_all_sticker_packs(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let packs = get_sticker_packs(&state, None).await;
    if packs.is_empty() {
        let err = ApiError::new(ErrorType::Api, "没有找到表情包", "NO_STICKER_PACKS");
        return response::error(&err, &request_id);
    }
    let export_dir = export_base_path(&state).join(format!(
        "all_packs_{}",
        chrono::Utc::now().timestamp_millis()
    ));
    let _ = tokio::fs::create_dir_all(&export_dir).await;

    let mut total_success = 0usize;
    for pack in &packs {
        let pack_dir = export_dir.join(sanitize(&str_of(pack, "packName")));
        total_success += export_pack_to_dir(&state, pack, &pack_dir).await;
    }

    // 汇总信息。
    let summary = json!({
        "exportTime": now_iso(),
        "packCount": packs.len(),
        "totalStickers": packs
            .iter()
            .map(|p| p.get("stickerCount").and_then(Value::as_u64).unwrap_or(0))
            .sum::<u64>(),
        "successfulStickers": total_success,
        "packs": packs
            .iter()
            .map(|p| json!({
                "packId": p.get("packId"),
                "packName": p.get("packName"),
                "stickerCount": p.get("stickerCount"),
            }))
            .collect::<Vec<Value>>(),
    });
    if let Ok(data) = serde_json::to_string_pretty(&summary) {
        let _ = tokio::fs::write(export_dir.join("summary.json"), data).await;
    }

    let favorite_packs: Vec<&Value> = packs
        .iter()
        .filter(|pack| str_of(pack, "packType") == "favorite_emoji")
        .collect();
    if !favorite_packs.is_empty() {
        let favorite_stickers: Vec<Value> = favorite_packs
            .iter()
            .flat_map(|pack| {
                let pack_id = str_of(pack, "packId");
                let pack_name = str_of(pack, "packName");
                list_values(pack.get("stickers"))
                    .into_iter()
                    .map(move |sticker| {
                        json!({
                            "id": sticker.get("stickerId"),
                            "name": sticker.get("name"),
                            "url": sticker.get("path"),
                            "md5": sticker.get("md5"),
                            "packId": pack_id.clone(),
                            "packName": pack_name.clone(),
                        })
                    })
            })
            .collect();
        let favorite_data = json!({
            "exportTime": now_iso(),
            "totalStickers": favorite_stickers.len(),
            "stickers": favorite_stickers,
        });
        if let Ok(data) = serde_json::to_string_pretty(&favorite_data) {
            let _ = tokio::fs::write(export_dir.join("favorite_emojis.json"), data).await;
        }
    }

    let other_packs: Vec<Value> = packs
        .iter()
        .filter(|pack| str_of(pack, "packType") != "favorite_emoji")
        .map(|pack| {
            let stickers: Vec<Value> = list_values(pack.get("stickers"))
                .iter()
                .map(|sticker| {
                    json!({
                        "id": sticker.get("stickerId"),
                        "name": sticker.get("name"),
                        "url": sticker.get("path"),
                        "md5": sticker.get("md5"),
                    })
                })
                .collect();
            json!({
                "packId": pack.get("packId"),
                "packName": pack.get("packName"),
                "packType": pack.get("packType"),
                "description": pack.get("description"),
                "stickerCount": pack.get("stickerCount"),
                "stickers": stickers,
            })
        })
        .collect();
    if !other_packs.is_empty() {
        let total_stickers = other_packs
            .iter()
            .map(|pack| {
                pack.get("stickerCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            })
            .sum::<u64>();
        let all_packs_data = json!({
            "exportTime": now_iso(),
            "totalPacks": other_packs.len(),
            "totalStickers": total_stickers,
            "packs": other_packs,
        });
        if let Ok(data) = serde_json::to_string_pretty(&all_packs_data) {
            let _ = tokio::fs::write(export_dir.join("all_sticker_packs.json"), data).await;
        }
    }

    let id = export_id();
    add_record(
        &state,
        json!({
            "id": id,
            "type": "all",
            "packName": "所有表情包",
            "packCount": packs.len(),
            "stickerCount": total_success,
            "exportPath": export_dir.to_string_lossy(),
            "exportTime": now_iso(),
            "success": true,
        }),
    )
    .await;

    response::success(
        json!({
            "success": true,
            "packCount": packs.len(),
            "stickerCount": total_success,
            "exportPath": export_dir.to_string_lossy(),
            "exportId": id,
        }),
        &request_id,
    )
}

/// `GET /api/sticker-packs/export-records` — 导出记录。
pub async fn sticker_export_records(
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

#[cfg(test)]
mod tests {
    use super::{market_tab_list, parse_market_json, parse_market_pack_info, system_packs};
    use serde_json::json;

    #[test]
    fn reads_market_tabs_from_wrapped_or_direct_results() {
        let direct = json!({
            "marketEmoticonInfo": {
                "roamEmojiTab": {
                    "ordinaryTabinfoList": [{ "epId": "1" }]
                }
            }
        });
        let wrapped = json!({ "result": direct.clone() });
        assert_eq!(market_tab_list(&direct), vec![json!({ "epId": "1" })]);
        assert_eq!(market_tab_list(&wrapped), vec![json!({ "epId": "1" })]);
    }

    #[test]
    fn parses_market_json_and_api_fallback_shapes() {
        let json_stickers = parse_market_json(&json!({
            "imgs": {
                "first": { "id": "abcdef", "name": "猫猫" }
            }
        }));
        assert_eq!(json_stickers.len(), 1);
        assert_eq!(
            json_stickers[0]["path"],
            "https://gxh.vip.qq.com/club/item/parcel/item/ab/abcdef/raw300.gif"
        );

        let api_stickers = parse_market_pack_info(&json!({
            "result": {
                "emojiInfoList": [{
                    "eId": "emoji_1",
                    "desc": "测试表情",
                    "emoPath": "C:/emoji.gif",
                    "isExist": true
                }]
            }
        }));
        assert_eq!(api_stickers.len(), 1);
        assert_eq!(api_stickers[0]["stickerId"], "emoji_1");
        assert_eq!(api_stickers[0]["path"], "C:/emoji.gif");
    }

    #[test]
    fn includes_embedded_system_sticker_packs() {
        let packs = system_packs();
        assert_eq!(packs.len(), 6);
        assert_eq!(
            packs
                .iter()
                .map(|pack| pack["stickerCount"].as_u64().unwrap_or(0))
                .sum::<u64>(),
            296
        );
    }
}
