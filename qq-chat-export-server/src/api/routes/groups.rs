use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use axum::Json;
use chrono::Utc;
use serde_json::{json, Value};

use crate::api::helpers::normalize_group_system_notify;
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;

/// 分页参数解析（page 默认 1、limit 默认 999）。
fn page_and_limit(params: &HashMap<String, String>) -> (usize, usize) {
    let page = params
        .get("page")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|p| *p >= 1)
        .unwrap_or(1);
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|l| *l >= 1)
        .unwrap_or(999);
    (page, limit)
}

/// 文件名安全化（对应 TS `replace(/[<>:"/\\|?*]/g, '_')`）。
#[must_use]
pub fn sanitize_file_component(name: &str, max_len: usize) -> String {
    let replaced: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    replaced.chars().take(max_len).collect()
}

/// 时间戳文件名片段（对应 TS `new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)`）。
#[must_use]
pub fn timestamp_slug() -> String {
    let iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    iso.replace([':', '.'], "-").chars().take(19).collect()
}

/// `GET /api/groups` — 群列表（分页 + 头像）。
pub async fn list_groups(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let force_refresh = params.get("forceRefresh").map(String::as_str) == Some("true");
    let (page, limit) = page_and_limit(&params);

    let groups = match state.napcat.get_groups(force_refresh).await {
        Ok(value) => value,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GET_GROUPS_FAILED");
            return response::error(&err, &request_id);
        }
    };
    let empty: Vec<Value> = Vec::new();
    let list = groups.as_array().unwrap_or(&empty);

    let groups_with_avatars: Vec<Value> = list
        .iter()
        .map(|group| {
            let code = group
                .get("groupCode")
                .and_then(Value::as_str)
                .unwrap_or_default();
            json!({
                "groupCode": group.get("groupCode").cloned().unwrap_or(Value::Null),
                "groupName": group.get("groupName").cloned().unwrap_or(Value::Null),
                "memberCount": group.get("memberCount").cloned().unwrap_or(Value::Null),
                "maxMember": group.get("maxMember").cloned().unwrap_or(Value::Null),
                "remark": Value::Null,
                "avatarUrl": format!("https://p.qlogo.cn/gh/{code}/{code}/640/"),
            })
        })
        .collect();

    let total = groups_with_avatars.len();
    let start_index = (page - 1) * limit;
    let end_index = start_index + limit;
    let paginated: Vec<Value> = groups_with_avatars
        .iter()
        .skip(start_index)
        .take(limit)
        .cloned()
        .collect();

    response::success(
        json!({
            "groups": paginated,
            "totalCount": total,
            "currentPage": page,
            "totalPages": total.div_ceil(limit),
            "hasNext": end_index < total,
            "hasPrev": page > 1,
        }),
        &request_id,
    )
}

/// `GET /api/groups/:groupCode` — 群详情。
pub async fn group_detail(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    match state.napcat.fetch_group_detail(&group_code).await {
        Ok(Value::Null) => {
            let err = ApiError::new(ErrorType::Api, "群组不存在", "GROUP_NOT_FOUND");
            response::error(&err, &request_id)
        }
        Ok(detail) => response::success(detail, &request_id),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_DETAIL_FAILED");
            response::error(&err, &request_id)
        }
    }
}

/// bridge 侧把 `Map<uin, info>` 序列化成对象或数组，两种形态都取成员数组。
#[must_use]
pub fn extract_member_list(result: &Value) -> Vec<Value> {
    let infos = result
        .get("result")
        .and_then(|r| r.get("infos"))
        .or_else(|| result.get("infos"))
        .unwrap_or(result);
    match infos {
        Value::Array(list) => list.clone(),
        Value::Object(map) => map.values().cloned().collect(),
        _ => Vec::new(),
    }
}

/// `GET /api/groups/:groupCode/members` — 群成员列表。
pub async fn group_members(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let force_refresh = params.get("forceRefresh").map(String::as_str) == Some("true");
    match state
        .napcat
        .get_group_member_all(&group_code, force_refresh)
        .await
    {
        Ok(result) => response::success(Value::Array(extract_member_list(&result)), &request_id),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_MEMBERS_FAILED");
            response::error(&err, &request_id)
        }
    }
}

#[cfg(test)]
mod member_list_tests {
    use super::extract_member_list;
    use serde_json::json;

    #[test]
    fn extracts_bridge_serialized_member_map() {
        let members = extract_member_list(&json!({
            "result": {
                "infos": {
                    "u_1": { "uin": "10001", "nick": "one" },
                    "u_2": { "uin": "10002", "nick": "two" }
                }
            }
        }));
        assert_eq!(members.len(), 2);
        assert!(members.iter().any(|member| member["uin"] == "10001"));
        assert!(members.iter().any(|member| member["uin"] == "10002"));
    }

    #[test]
    fn extracts_direct_infos_shape() {
        let members = extract_member_list(&json!({
            "infos": [{ "uin": "10001" }]
        }));
        assert_eq!(members, vec![json!({ "uin": "10001" })]);
    }
}

/// `GET /api/group-system-notify` — 全部群系统通知（issue #317）。
pub async fn group_system_notify(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    match state.napcat.get_group_system_msg().await {
        Ok(data) => response::success(normalize_group_system_notify(&data), &request_id),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_NOTIFY_FAILED");
            response::error(&err, &request_id)
        }
    }
}

/// `GET /api/groups/:groupCode/join-requests` — 单群入群申请（issue #317）。
pub async fn group_join_requests(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let data = match state.napcat.get_group_system_msg().await {
        Ok(data) => data,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_NOTIFY_FAILED");
            return response::error(&err, &request_id);
        }
    };
    let normalized = normalize_group_system_notify(&data);
    let filter_by_group = |key: &str| -> Vec<Value> {
        normalized
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter(|item| {
                        item.get("groupId").is_some_and(|g| match g {
                            Value::String(s) => s == &group_code,
                            Value::Number(n) => n.to_string() == group_code,
                            _ => false,
                        })
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    };
    let join_requests = filter_by_group("joinRequests");
    let invited_requests = filter_by_group("invitedRequests");
    let total = join_requests.len() + invited_requests.len();
    response::success(
        json!({
            "groupCode": group_code,
            "joinRequests": join_requests,
            "invitedRequests": invited_requests,
            "totalCount": total,
        }),
        &request_id,
    )
}

/// 精华消息内容项映射（对应 TS msg_content 的 map）。
fn map_essence_content(content: Option<&Value>) -> Vec<Value> {
    content
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|c| match c.get("msg_type").and_then(Value::as_i64) {
                    Some(1) => json!({ "type": "text", "text": c.get("text").cloned().unwrap_or(Value::Null) }),
                    Some(3) => json!({ "type": "image", "url": c.get("image_url").cloned().unwrap_or(Value::Null) }),
                    _ => json!({ "type": "unknown", "data": c }),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 从精华消息 API 返回值拍平出消息列表。
fn flatten_essence_messages(essence_list: &Value) -> Vec<Value> {
    essence_list
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|e| {
                    e.get("data")
                        .and_then(|d| d.get("msg_list"))
                        .and_then(Value::as_array)
                })
                .flatten()
                .filter(|m| !m.is_null())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// 秒级时间戳 → `zh-CN` 风格本地时间串。
fn format_seconds_local(seconds: Option<&Value>) -> String {
    let secs = seconds.and_then(Value::as_i64).unwrap_or(0);
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y/%m/%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}

/// `GET /api/groups/:groupCode/essence` — 群精华消息列表。
pub async fn group_essence(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let essence_list = match state.napcat.get_group_essence_msg_all(&group_code).await {
        Ok(list) => list,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_ESSENCE_FAILED");
            return response::error(&err, &request_id);
        }
    };
    let raw_messages = flatten_essence_messages(&essence_list);
    let messages: Vec<Value> = raw_messages
        .iter()
        .map(|msg| {
            json!({
                "msgSeq": msg.get("msg_seq").cloned().unwrap_or(Value::Null),
                "msgRandom": msg.get("msg_random").cloned().unwrap_or(Value::Null),
                "senderUin": msg.get("sender_uin").cloned().unwrap_or(Value::Null),
                "senderNick": msg.get("sender_nick").cloned().unwrap_or(Value::Null),
                "senderTime": msg.get("sender_time").cloned().unwrap_or(Value::Null),
                "addDigestUin": msg.get("add_digest_uin").cloned().unwrap_or(Value::Null),
                "addDigestNick": msg.get("add_digest_nick").cloned().unwrap_or(Value::Null),
                "addDigestTime": msg.get("add_digest_time").cloned().unwrap_or(Value::Null),
                "content": map_essence_content(msg.get("msg_content")),
                "canBeRemoved": msg.get("can_be_removed").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    response::success(
        json!({
            "messages": messages,
            "totalCount": messages.len(),
            "groupCode": group_code,
        }),
        &request_id,
    )
}

/// 查群名（找不到时返回 `群<code>` 兜底）。
async fn lookup_group_name(state: &SharedState, group_code: &str, fallback_prefix: bool) -> String {
    if let Ok(groups) = state.napcat.get_groups(false).await {
        if let Some(list) = groups.as_array() {
            for group in list {
                let code = group
                    .get("groupCode")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if code == group_code {
                    if let Some(name) = group.get("groupName").and_then(Value::as_str) {
                        if !name.is_empty() {
                            return name.to_string();
                        }
                    }
                }
            }
        }
    }
    if fallback_prefix {
        format!("群{group_code}")
    } else {
        group_code.to_string()
    }
}

/// 生成精华消息 HTML（对应 TS `generateEssenceHtml` 的等价简洁实现）。
fn generate_essence_html(group_name: &str, group_code: &str, messages: &[Value]) -> String {
    let escape = qce_exporter::base::escape_html;
    let mut items = String::new();
    for msg in messages {
        let sender = msg
            .get("senderNick")
            .and_then(Value::as_str)
            .unwrap_or("未知");
        let time = msg
            .get("senderTimeFormatted")
            .and_then(Value::as_str)
            .unwrap_or("");
        let digest_nick = msg
            .get("addDigestNick")
            .and_then(Value::as_str)
            .unwrap_or("");
        let digest_time = msg
            .get("addDigestTimeFormatted")
            .and_then(Value::as_str)
            .unwrap_or("");
        let mut content_html = String::new();
        if let Some(content) = msg.get("content").and_then(Value::as_array) {
            for item in content {
                match item.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                        content_html.push_str(&format!("<span>{}</span>", escape(text)));
                    }
                    Some("image") => {
                        let url = item.get("url").and_then(Value::as_str).unwrap_or("");
                        content_html.push_str(&format!(
                            "<img src=\"{}\" alt=\"图片\" style=\"max-width:100%;border-radius:8px;\" />",
                            escape(url)
                        ));
                    }
                    _ => content_html.push_str("<span class=\"unknown\">[未知内容]</span>"),
                }
            }
        }
        items.push_str(&format!(
            "<div class=\"message\"><div class=\"meta\"><span class=\"sender\">{}</span><span class=\"time\">{}</span></div><div class=\"content\">{}</div><div class=\"digest\">由 {} 于 {} 设为精华</div></div>\n",
            escape(sender),
            escape(time),
            content_html,
            escape(digest_nick),
            escape(digest_time),
        ));
    }
    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>{title} - 精华消息</title>\n<style>\nbody{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#1f2328;}}\n.container{{max-width:860px;margin:0 auto;}}\nh1{{font-size:22px;}}\n.subtitle{{color:#656d76;margin-bottom:24px;}}\n.message{{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}}\n.meta{{display:flex;justify-content:space-between;margin-bottom:8px;}}\n.sender{{font-weight:600;}}\n.time{{color:#8b949e;font-size:13px;}}\n.content{{line-height:1.6;word-break:break-word;}}\n.digest{{margin-top:8px;color:#8b949e;font-size:12px;}}\n</style>\n</head>\n<body>\n<div class=\"container\">\n<h1>{title} 群精华消息</h1>\n<div class=\"subtitle\">群号：{code} · 共 {count} 条 · 导出时间：{now}</div>\n{items}</div>\n</body>\n</html>\n",
        title = escape(group_name),
        code = escape(group_code),
        count = messages.len(),
        now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        items = items,
    )
}

/// `POST /api/groups/:groupCode/essence/export` — 导出群精华消息。
pub async fn export_group_essence(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }
    let format = body
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("json")
        .to_string();

    let group_name = lookup_group_name(&state, &group_code, true).await;

    let essence_list = match state.napcat.get_group_essence_msg_all(&group_code).await {
        Ok(list) => list,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_ESSENCE_FAILED");
            return response::error(&err, &request_id);
        }
    };
    let raw_messages = flatten_essence_messages(&essence_list);
    if raw_messages.is_empty() {
        let err = ApiError::validation("该群没有精华消息", "NO_ESSENCE_MESSAGES");
        return response::error(&err, &request_id);
    }

    let messages: Vec<Value> = raw_messages
        .iter()
        .map(|msg| {
            json!({
                "msgSeq": msg.get("msg_seq").cloned().unwrap_or(Value::Null),
                "msgRandom": msg.get("msg_random").cloned().unwrap_or(Value::Null),
                "senderUin": msg.get("sender_uin").cloned().unwrap_or(Value::Null),
                "senderNick": msg.get("sender_nick").cloned().unwrap_or(Value::Null),
                "senderTime": msg.get("sender_time").cloned().unwrap_or(Value::Null),
                "senderTimeFormatted": format_seconds_local(msg.get("sender_time")),
                "addDigestUin": msg.get("add_digest_uin").cloned().unwrap_or(Value::Null),
                "addDigestNick": msg.get("add_digest_nick").cloned().unwrap_or(Value::Null),
                "addDigestTime": msg.get("add_digest_time").cloned().unwrap_or(Value::Null),
                "addDigestTimeFormatted": format_seconds_local(msg.get("add_digest_time")),
                "content": map_essence_content(msg.get("msg_content")),
                "canBeRemoved": msg.get("can_be_removed").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();

    let export_dir = state.path_manager.exports_dir().join("essence");
    if let Err(error) = tokio::fs::create_dir_all(&export_dir).await {
        let err = ApiError::new(
            ErrorType::FileSystem,
            error.to_string(),
            "CREATE_DIR_FAILED",
        );
        return response::error(&err, &request_id);
    }

    let timestamp = timestamp_slug();
    let safe_group_name = sanitize_file_component(&group_name, 50);

    let (file_name, file_content) = if format == "html" {
        (
            format!("{safe_group_name}_{group_code}_essence_{timestamp}.html"),
            generate_essence_html(&group_name, &group_code, &messages),
        )
    } else {
        let payload = json!({
            "groupCode": group_code,
            "groupName": group_name,
            "exportTime": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "totalCount": messages.len(),
            "messages": messages,
        });
        (
            format!("{safe_group_name}_{group_code}_essence_{timestamp}.json"),
            serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string()),
        )
    };

    let file_path = export_dir.join(&file_name);
    if let Err(error) = tokio::fs::write(&file_path, file_content.as_bytes()).await {
        let err = ApiError::new(
            ErrorType::FileSystem,
            error.to_string(),
            "WRITE_FILE_FAILED",
        );
        return response::error(&err, &request_id);
    }
    let file_size = tokio::fs::metadata(&file_path)
        .await
        .map_or(0, |meta| meta.len());

    response::success(
        json!({
            "success": true,
            "groupCode": group_code,
            "groupName": group_name,
            "totalCount": messages.len(),
            "format": format,
            "fileName": file_name,
            "filePath": file_path.to_string_lossy(),
            "fileSize": file_size,
            "downloadUrl": format!("/downloads/essence/{file_name}"),
        }),
        &request_id,
    )
}

/// 下载单个头像（跟随 301/302 重定向由 reqwest 自动处理）。
async fn download_avatar(http: &reqwest::Client, url: &str, dest: &PathBuf) -> Result<(), String> {
    let resp = http
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(dest, &bytes)
        .await
        .map_err(|e| e.to_string())
}

/// `POST /api/groups/:groupCode/avatars/export` — 导出群成员头像 ZIP。
pub async fn export_group_avatars(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(group_code): Path<String>,
) -> Response {
    if group_code.is_empty() {
        let err = ApiError::validation("群组代码不能为空", "INVALID_GROUP_CODE");
        return response::error(&err, &request_id);
    }

    let members = match state.napcat.get_group_member_all(&group_code, true).await {
        Ok(result) => extract_member_list(&result),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GROUP_MEMBERS_FAILED");
            return response::error(&err, &request_id);
        }
    };
    if members.is_empty() {
        let err = ApiError::validation("群成员列表为空", "EMPTY_MEMBERS");
        return response::error(&err, &request_id);
    }

    let group_name = lookup_group_name(&state, &group_code, false).await;

    let export_dir = state.path_manager.avatars_dir();
    if let Err(error) = tokio::fs::create_dir_all(&export_dir).await {
        let err = ApiError::new(
            ErrorType::FileSystem,
            error.to_string(),
            "CREATE_DIR_FAILED",
        );
        return response::error(&err, &request_id);
    }

    let timestamp = timestamp_slug();
    let safe_group_name = sanitize_file_component(&group_name, 50);
    let temp_dir = export_dir.join(format!("{safe_group_name}_{group_code}_{timestamp}"));
    if let Err(error) = tokio::fs::create_dir_all(&temp_dir).await {
        let err = ApiError::new(
            ErrorType::FileSystem,
            error.to_string(),
            "CREATE_DIR_FAILED",
        );
        return response::error(&err, &request_id);
    }

    let http = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let err = ApiError::new(ErrorType::Network, error.to_string(), "HTTP_CLIENT_FAILED");
            return response::error(&err, &request_id);
        }
    };

    let mut success_count = 0usize;
    let mut fail_count = 0usize;
    for member in &members {
        let uin = member
            .get("uin")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or_else(|| {
                member
                    .get("uin")
                    .and_then(Value::as_i64)
                    .map(|n| n.to_string())
            })
            .or_else(|| {
                member
                    .get("uid")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            });
        let Some(uin) = uin.filter(|u| !u.is_empty()) else {
            continue;
        };
        let nick = member
            .get("nick")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                member
                    .get("cardName")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or(&uin);
        let safe_nick = sanitize_file_component(nick, 30);
        let avatar_url = format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640");
        let file_path = temp_dir.join(format!("{safe_nick}_{uin}.jpg"));
        match download_avatar(&http, &avatar_url, &file_path).await {
            Ok(()) => success_count += 1,
            Err(error) => {
                fail_count += 1;
                tracing::warn!("[ApiServer] 下载头像失败: {error}");
                let _ = tokio::fs::remove_file(&file_path).await;
            }
        }
    }

    let zip_file_name = format!("{safe_group_name}_{group_code}_avatars_{timestamp}.zip");
    let zip_file_path = export_dir.join(&zip_file_name);

    // ZIP 打包在阻塞线程执行（zip crate 是同步 I/O）。
    let temp_dir_for_zip = temp_dir.clone();
    let zip_path_for_task = zip_file_path.clone();
    let zip_result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::create(&zip_path_for_task).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for entry in walkdir::WalkDir::new(&temp_dir_for_zip)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(&temp_dir_for_zip)
                .map_err(|e| e.to_string())?;
            zip.start_file(rel.to_string_lossy(), options)
                .map_err(|e| e.to_string())?;
            let data = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    match zip_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let err = ApiError::new(ErrorType::FileSystem, error, "ZIP_FAILED");
            return response::error(&err, &request_id);
        }
        Err(error) => {
            let err = ApiError::new(ErrorType::Unknown, error.to_string(), "ZIP_FAILED");
            return response::error(&err, &request_id);
        }
    }

    let file_size = tokio::fs::metadata(&zip_file_path)
        .await
        .map_or(0, |meta| meta.len());

    response::success(
        json!({
            "success": true,
            "groupCode": group_code,
            "groupName": group_name,
            "totalMembers": members.len(),
            "successCount": success_count,
            "failCount": fail_count,
            "fileName": zip_file_name,
            "filePath": zip_file_path.to_string_lossy(),
            "fileSize": file_size,
            "downloadUrl": format!("/downloads/avatars/{zip_file_name}"),
        }),
        &request_id,
    )
}
