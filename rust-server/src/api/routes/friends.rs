//! 好友路由：列表（分页）/ 详情 / 最近联系人（QQ Bot、服务号等）。

use std::collections::HashMap;

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use serde_json::{json, Value};

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

/// 宽松取字符串（字符串或数字字段）。
fn str_of(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// 单个好友映射（对应 TS friends 列表项）。
fn map_friend(friend: &Value, category_id: &Value) -> Value {
    // NapCat 新结构：字段在 coreInfo / baseInfo 下；旧结构直接平铺。
    let core = friend.get("coreInfo").unwrap_or(friend);
    let base = friend.get("baseInfo").unwrap_or(friend);
    let status = friend.get("status").cloned().unwrap_or(Value::Null);
    let uid = str_of(core, "uid");
    let uin = {
        let u = str_of(core, "uin");
        if u.is_empty() { str_of(friend, "uin") } else { u }
    };
    let nick = {
        let n = str_of(core, "nick");
        if n.is_empty() { str_of(friend, "nick") } else { n }
    };
    let remark = {
        let r = str_of(core, "remark");
        if r.is_empty() { str_of(friend, "remark") } else { r }
    };
    let is_online = base
        .get("isOnline")
        .and_then(Value::as_bool)
        .or_else(|| friend.get("isOnline").and_then(Value::as_bool))
        .unwrap_or(false);
    json!({
        "uid": if uid.is_empty() { str_of(friend, "uid") } else { uid },
        "uin": uin,
        "nick": nick,
        "remark": remark,
        "avatarUrl": format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640"),
        "isOnline": is_online,
        "status": status,
        "categoryId": category_id,
    })
}

/// `GET /api/friends` — 好友列表（分页）。
pub async fn list_friends(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let (page, limit) = page_and_limit(&params);
    let force_refresh = params.get("forceRefresh").map(String::as_str) == Some("true");

    let categories = match state.napcat.get_buddy_v2_ex_with_cate(force_refresh).await {
        Ok(value) => value,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "GET_FRIENDS_FAILED");
            return response::error(&err, &request_id);
        }
    };

    let empty: Vec<Value> = Vec::new();
    let cats = categories.as_array().unwrap_or(&empty);
    let mut friends: Vec<Value> = Vec::new();
    for cat in cats {
        let category_id = cat
            .get("categoryId")
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(list) = cat.get("buddyList").and_then(Value::as_array) {
            for friend in list {
                friends.push(map_friend(friend, &category_id));
            }
        }
    }

    let total = friends.len();
    let start_index = (page - 1) * limit;
    let end_index = start_index + limit;
    let paginated: Vec<Value> = friends.iter().skip(start_index).take(limit).cloned().collect();

    response::success(
        json!({
            "friends": paginated,
            "totalCount": total,
            "currentPage": page,
            "totalPages": total.div_ceil(limit),
            "hasNext": end_index < total,
            "hasPrev": page > 1,
        }),
        &request_id,
    )
}

/// `GET /api/friends/:uid` — 好友详情。
pub async fn friend_detail(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(uid): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if uid.is_empty() {
        let err = ApiError::validation("用户ID不能为空", "INVALID_UID");
        return response::error(&err, &request_id);
    }
    let _no_cache = params.get("no_cache").map(String::as_str) == Some("true");
    match state.napcat.get_user_detail_info(&uid).await {
        Ok(Value::Null) => {
            let err = ApiError::new(ErrorType::Api, "用户不存在", "USER_NOT_FOUND");
            response::error(&err, &request_id)
        }
        Ok(detail) => response::success(detail, &request_id),
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "FRIEND_DETAIL_FAILED");
            response::error(&err, &request_id)
        }
    }
}

/// `GET /api/recent-contacts` — 最近联系人中不属于好友 / 群聊的会话。
pub async fn recent_contacts(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|l| *l >= 1)
        .unwrap_or(100);
    let include_all = params.get("includeAll").map(String::as_str) == Some("true");

    let snapshot = match state.napcat.get_recent_contact_list_snapshot(limit).await {
        Ok(value) => value,
        Err(error) => {
            let err = ApiError::new(ErrorType::Api, error.to_string(), "RECENT_CONTACTS_FAILED");
            return response::error(&err, &request_id);
        }
    };

    // NapCat 返回 { info: { changedList: [...] } } 或直接数组，两种形态都兼容。
    let empty: Vec<Value> = Vec::new();
    let list = snapshot
        .get("info")
        .and_then(|i| i.get("changedList"))
        .and_then(Value::as_array)
        .or_else(|| snapshot.get("changedList").and_then(Value::as_array))
        .or_else(|| snapshot.as_array())
        .unwrap_or(&empty);

    // 好友 uid / 群号集合，用于排除普通会话。
    let mut friend_uids: std::collections::HashSet<String> = std::collections::HashSet::new();
    if !include_all {
        if let Ok(friends) = state.napcat.get_friends(false).await {
            if let Some(friend_list) = friends.as_array() {
                for friend in friend_list {
                    let uid = str_of(friend, "uid");
                    if !uid.is_empty() {
                        friend_uids.insert(uid);
                    }
                    let uin = str_of(friend, "uin");
                    if !uin.is_empty() {
                        friend_uids.insert(uin);
                    }
                }
            }
        }
    }

    let contacts: Vec<Value> = list
        .iter()
        .filter(|contact| {
            if include_all {
                return true;
            }
            let chat_type = contact.get("chatType").and_then(Value::as_i64).unwrap_or(0);
            if chat_type == 2 {
                return false; // 群聊排除
            }
            let peer_uid = str_of(contact, "peerUid");
            !friend_uids.contains(&peer_uid)
        })
        .map(|contact| {
            let peer_uid = str_of(contact, "peerUid");
            let peer_uin = str_of(contact, "peerUin");
            let avatar_key = if peer_uin.is_empty() { &peer_uid } else { &peer_uin };
            json!({
                "chatType": contact.get("chatType").cloned().unwrap_or(Value::Null),
                "peerUid": peer_uid,
                "peerUin": peer_uin,
                "peerName": {
                    let name = str_of(contact, "peerName");
                    if name.is_empty() { str_of(contact, "remark") } else { name }
                },
                "remark": str_of(contact, "remark"),
                "msgTime": contact.get("msgTime").cloned().unwrap_or(Value::Null),
                "sendNickName": str_of(contact, "sendNickName"),
                "avatarUrl": format!("https://q1.qlogo.cn/g?b=qq&nk={avatar_key}&s=640"),
            })
        })
        .collect();

    response::success(
        json!({
            "contacts": contacts,
            "totalCount": contacts.len(),
        }),
        &request_id,
    )
}
