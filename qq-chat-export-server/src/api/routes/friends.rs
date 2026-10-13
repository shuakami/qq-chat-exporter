use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::extract::{Extension, Path, Query, State};
use axum::response::Response;
use futures_util::future::join_all;
use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::routes::groups::standalone_guard;
use crate::api::state::{bridge_error_to_api_error, SharedState};

/// 补丁 v5：bridge 就绪等待参数（可用环境变量覆盖）。
///
/// 背景：`qce-server.exe` 是 QQ 内插件 spawn 的子进程，QQ 重启时它跟着死再被拉起，
/// 空窗期（实测数十秒）内前端 `Promise.all([loadGroups, loadFriends])` 会双双撞上
/// `reqwest::Error` → 前端显示误导性的「bridge 传输错误」。
/// 调大这两个值可让接口在 QQ 启动期间「等一等再答」，显著降低误报。
fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
}

/// 探活最多尝试次数。
fn bridge_ready_attempts() -> u32 {
    env_u32("QCE_BRIDGE_READY_ATTEMPTS", 20)
}

/// 探活间隔（毫秒）。默认 20 × 500ms ≈ 最多等 10 秒。
fn bridge_ready_interval_ms() -> u64 {
    env_u32("QCE_BRIDGE_READY_INTERVAL_MS", 500) as u64
}

/// 单次调用遭遇传输错误后的重试次数。
fn bridge_call_retries() -> u32 {
    env_u32("QCE_BRIDGE_CALL_RETRIES", 2)
}

/// 分页参数解析（page 默认 1、limit 默认 999）。
fn page_and_limit(params: &HashMap<String, String>) -> (usize, usize) {
    let page = params
        .get("page")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|p| *p >= 1)
        .unwrap_or(1)
        .min(1_000_000);
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|l| *l >= 1)
        .unwrap_or(999)
        .min(2_000);
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

fn int_of(value: &Value, key: &str) -> Option<i64> {
    match value.get(key) {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(number)) => number.parse().ok(),
        _ => None,
    }
}

fn recent_contact_limit(params: &HashMap<String, String>) -> i64 {
    params
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|limit| *limit >= 1)
        .map_or(100, |limit| limit.min(2_000))
}

fn extract_recent_contacts(payload: &Value) -> Vec<Value> {
    payload
        .get("info")
        .and_then(|info| info.get("changedList"))
        .and_then(Value::as_array)
        .or_else(|| payload.get("changedList").and_then(Value::as_array))
        .or_else(|| payload.as_array())
        .cloned()
        .unwrap_or_default()
}

fn recent_contact_key(contact: &Value) -> Option<String> {
    let chat_type = int_of(contact, "chatType")?;
    let peer_uid = str_of(contact, "peerUid");
    (!peer_uid.is_empty()).then(|| format!("{chat_type}|{peer_uid}"))
}

fn merge_recent_contacts(lists: impl IntoIterator<Item = Vec<Value>>) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for list in lists {
        for contact in list {
            let Some(key) = recent_contact_key(&contact) else {
                continue;
            };
            if seen.insert(key) {
                merged.push(contact);
            }
        }
    }
    merged
}

fn contact_classification(
    chat_type: i64,
    peer_uid: &str,
    friend_uids: &HashSet<String>,
    include_all: bool,
) -> &'static str {
    if chat_type == 2 {
        "group"
    } else if chat_type == 1 && friend_uids.contains(peer_uid) {
        "friend"
    } else if chat_type == 1 && !include_all {
        "private"
    } else {
        "special"
    }
}

/// 数据线 / 设备会话（手机 QQ 的「我的电脑 / 我的手机 / 我的设备」）。
/// NapCat 的 KCHATTYPEDATALINE(8) / KCHATTYPEDATALINEMQQ(134)。（Issue #609）
fn is_device_chat_type(chat_type: i64) -> bool {
    chat_type == 8 || chat_type == 134
}

fn contact_name(contact: &Value, chat_type: i64, peer_uid: &str) -> String {
    for key in ["peerName", "sendNickName", "sendMemberName", "remark"] {
        let value = str_of(contact, key);
        if !value.is_empty() {
            return value;
        }
    }
    // 设备会话往往没有 peerName，用友好兜底而不是暴露原始 peerUid。
    if is_device_chat_type(chat_type) {
        return "我的设备".to_string();
    }
    peer_uid.to_string()
}

fn contact_time_iso(contact: &Value) -> Option<String> {
    let raw = contact.get("msgTime")?;
    if let Some(value) = raw.as_str() {
        if chrono::DateTime::parse_from_rfc3339(value).is_ok() {
            return Some(value.to_string());
        }
    }
    let timestamp = match raw {
        Value::Number(number) => number.as_i64()?,
        Value::String(number) => number.parse().ok()?,
        _ => return None,
    };
    let millis = if timestamp.abs() < 100_000_000_000 {
        timestamp.checked_mul(1_000)?
    } else {
        timestamp
    };
    chrono::DateTime::from_timestamp_millis(millis)
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn map_recent_contact(
    contact: &Value,
    friend_uids: &HashSet<String>,
    include_all: bool,
) -> Option<Value> {
    let chat_type = int_of(contact, "chatType")?;
    let peer_uid = str_of(contact, "peerUid");
    if peer_uid.is_empty() {
        return None;
    }
    let peer_uin = str_of(contact, "peerUin");
    let peer_name = str_of(contact, "peerName");
    let remark = str_of(contact, "remark");
    let send_nick_name = str_of(contact, "sendNickName");
    let send_member_name = str_of(contact, "sendMemberName");
    let avatar_key = if peer_uin.is_empty() {
        &peer_uid
    } else {
        &peer_uin
    };
    Some(json!({
        "chatType": chat_type,
        "peerUid": peer_uid,
        "peerUin": peer_uin,
        "peerName": peer_name,
        "remark": remark,
        "msgTime": contact.get("msgTime").cloned().unwrap_or(Value::Null),
        "sendNickName": send_nick_name,
        "sendMemberName": send_member_name,
        "name": contact_name(contact, chat_type, &peer_uid),
        "avatarUrl": format!("https://q1.qlogo.cn/g?b=qq&nk={avatar_key}&s=640"),
        "lastMsgId": str_of(contact, "msgId"),
        "lastMsgTime": contact_time_iso(contact),
        "classification": contact_classification(
            chat_type,
            &peer_uid,
            friend_uids,
            include_all,
        ),
    }))
}

fn build_recent_contacts(
    raw_contacts: &[Value],
    friend_uids: &HashSet<String>,
    include_all: bool,
) -> Vec<Value> {
    raw_contacts
        .iter()
        .filter_map(|contact| map_recent_contact(contact, friend_uids, include_all))
        .filter(|contact| {
            include_all
                || matches!(
                    contact.get("classification").and_then(Value::as_str),
                    Some("private" | "special")
                )
        })
        .collect()
}

fn detail_name(detail: &Value) -> Option<String> {
    for key in ["remark", "nick", "nickName"] {
        let value = str_of(detail, key);
        if !value.is_empty() {
            return Some(value);
        }
    }
    let core = detail
        .get("simpleInfo")
        .and_then(|simple| simple.get("coreInfo"))?;
    for key in ["remark", "nick"] {
        let value = str_of(core, key);
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

async fn detail_name_with_timeout<F, E>(timeout: Duration, lookup: F) -> Option<String>
where
    F: std::future::Future<Output = Result<Value, E>>,
{
    let detail = tokio::time::timeout(timeout, lookup).await.ok()?.ok()?;
    detail_name(&detail)
}

fn unnamed_special_contacts(contacts: &[Value], limit: usize) -> Vec<(usize, String)> {
    contacts
        .iter()
        .enumerate()
        .filter_map(|(index, contact)| {
            let peer_uid = contact.get("peerUid")?.as_str()?;
            let name = contact.get("name")?.as_str()?;
            (contact.get("classification").and_then(Value::as_str) == Some("special")
                && name == peer_uid
                && peer_uid.starts_with("u_"))
            .then(|| (index, peer_uid.to_string()))
        })
        .take(limit)
        .collect()
}

async fn enrich_contact_names(contacts: &mut [Value], state: &SharedState, include_all: bool) {
    if !include_all {
        return;
    }
    let lookups = unnamed_special_contacts(contacts, 30)
        .into_iter()
        .map(|(index, peer_uid)| {
            let napcat = state.napcat.clone();
            async move {
                detail_name_with_timeout(
                    Duration::from_secs(2),
                    napcat.get_user_detail_info(&peer_uid),
                )
                .await
                .map(|name| (index, name))
            }
        });
    for (index, name) in join_all(lookups).await.into_iter().flatten() {
        if let Some(contact) = contacts.get_mut(index).and_then(Value::as_object_mut) {
            contact.insert("name".to_string(), Value::String(name));
        }
    }
}

/// 单个好友映射。
fn map_friend(friend: &Value, category_id: &Value) -> Value {
    // NapCat 新结构：字段在 coreInfo / baseInfo 下；旧结构直接平铺。
    let core = friend.get("coreInfo").unwrap_or(friend);
    let base = friend.get("baseInfo").unwrap_or(friend);
    let status = friend.get("status").cloned().unwrap_or(Value::Null);
    let uid = str_of(core, "uid");
    let uin = {
        let u = str_of(core, "uin");
        if u.is_empty() {
            str_of(friend, "uin")
        } else {
            u
        }
    };
    let nick = {
        let n = str_of(core, "nick");
        if n.is_empty() {
            str_of(friend, "nick")
        } else {
            n
        }
    };
    let remark = {
        let r = str_of(core, "remark");
        if r.is_empty() {
            str_of(friend, "remark")
        } else {
            r
        }
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

/// 把 NapCat 的分组好友结构展开成扁平列表。
///
/// Issue #649：同一个好友可以同时出现在多个分组里，按 uid 去重，避免会话列表出现
/// 重复条目。
fn flatten_friend_categories(categories: &[Value]) -> Vec<Value> {
    let mut seen_uids: HashSet<String> = HashSet::new();
    let mut friends: Vec<Value> = Vec::new();
    for cat in categories {
        let category_id = cat.get("categoryId").cloned().unwrap_or(Value::Null);
        if let Some(list) = cat.get("buddyList").and_then(Value::as_array) {
            for friend in list {
                let mapped = map_friend(friend, &category_id);
                let uid = str_of(&mapped, "uid");
                if !uid.is_empty() && !seen_uids.insert(uid) {
                    continue;
                }
                friends.push(mapped);
            }
        }
    }
    friends
}

/// 好友分类列表的服务端缓存。
///
/// NapCat 的 `getBuddyV2ExWithCate` 每次都要在 QQ 本地库里逐条组装 2274 个好友
/// 的完整资料（约 2.5 MB），实测单次 12~20 秒，且**自身没有任何缓存**——
/// 同一秒内重复调用一样慢。而 QCE 前端每次「加载好友」、每翻一页都会全量重拉
/// （实测前端只传 `page`/`limit`，不传 `forceRefresh`），于是首屏要等十几秒。
///
/// 这里兜一层进程内缓存，让第一页付一次代价、后续请求直接命中。
/// TTL 由 `QCE_FRIENDS_CACHE_SECS` 覆盖，设为 `0` 即完全禁用（退回原行为）。
static FRIENDS_CACHE: OnceLock<RwLock<Option<(Instant, Value)>>> = OnceLock::new();

fn friends_cache() -> &'static RwLock<Option<(Instant, Value)>> {
    FRIENDS_CACHE.get_or_init(|| RwLock::new(None))
}

/// 缓存有效期，默认 300 秒。
fn friends_cache_ttl() -> Duration {
    let secs = std::env::var("QCE_FRIENDS_CACHE_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(300);
    Duration::from_secs(secs)
}

/// `GET /api/friends` — 好友列表（分页）。
pub async fn list_friends(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if let Some(err) = standalone_guard(&state) {
        return response::error(&err, &request_id);
    }
    // 补丁 v4：可用 `QCE_FRIENDS_DISABLED=1` 强制返回空列表。
    // 前端有多条独立的好友加载路径（Provider 的 loadFriends + 两个 useSearch 实例），
    // 只改前端难保证覆盖全部；这里从数据源头掐断，一劳永逸。
    // 设 `QCE_FRIENDS_DISABLED=0` / 不设 → 恢复原行为。
    if std::env::var("QCE_FRIENDS_DISABLED")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
    {
        let empty: Vec<Value> = Vec::new();
        let body = serde_json::json!({
            "friends": empty,
            "totalCount": 0,
            "currentPage": 1,
            "totalPages": 0,
            "hasNext": false,
            "hasPrev": false,
        });
        return response::success(body, &request_id);
    }
    let (page, limit) = page_and_limit(&params);
    let force_refresh = params.get("forceRefresh").map(String::as_str) == Some("true");

    // 先看缓存（只在到期或前端显式 forceRefresh 时回源）。
    // 注意：读锁必须在进入 await 之前释放，所以这里用内层作用域收口。
    let ttl = friends_cache_ttl();
    let mut cached: Option<Value> = None;
    if !force_refresh && !ttl.is_zero() {
        let guard = friends_cache().read().await;
        cached = guard
            .as_ref()
            .filter(|(at, _)| at.elapsed() < ttl)
            .map(|(_, value)| value.clone());
    }

    let categories = match cached {
        Some(value) => value,
        None => match state
            .napcat
            .call_with_retry(
                "FriendApi.getBuddyV2ExWithCate",
                json!([force_refresh]),
                bridge_ready_attempts(),
                bridge_ready_interval_ms(),
                bridge_call_retries(),
            )
            .await
        {
            Ok(value) => {
                if !ttl.is_zero() {
                    let mut guard = friends_cache().write().await;
                    *guard = Some((Instant::now(), value.clone()));
                }
                value
            }
            Err(error) => {
                return response::error(
                    &bridge_error_to_api_error(error, "好友列表"),
                    &request_id,
                );
            }
        },
    };

    let empty: Vec<Value> = Vec::new();
    let cats = categories.as_array().unwrap_or(&empty);
    let friends = flatten_friend_categories(cats);

    let total = friends.len();
    let start_index = (page - 1).saturating_mul(limit);
    let end_index = start_index.saturating_add(limit);
    let paginated: Vec<Value> = friends
        .iter()
        .skip(start_index)
        .take(limit)
        .cloned()
        .collect();

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
    if let Some(err) = standalone_guard(&state) {
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
    if let Some(err) = standalone_guard(&state) {
        return response::error(&err, &request_id);
    }
    let limit = recent_contact_limit(&params);
    let include_all = params.get("includeAll").map(String::as_str) == Some("true");

    let snapshot = match state
        .napcat
        .call_with_retry(
            "UserApi.getRecentContactListSnapShot",
            json!([limit]),
            bridge_ready_attempts(),
            bridge_ready_interval_ms(),
            bridge_call_retries(),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return response::error(
                &bridge_error_to_api_error(error, "最近联系人"),
                &request_id,
            );
        }
    };
    if snapshot
        .get("info")
        .and_then(|info| info.get("errCode"))
        .and_then(Value::as_i64)
        .is_some_and(|code| code != 0)
    {
        let message = snapshot
            .get("info")
            .and_then(|info| info.get("errMsg"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let err = ApiError::new(
            ErrorType::Api,
            format!("获取最近联系人失败: {message}"),
            "RECENT_CONTACTS_FAILED",
        );
        return response::error(&err, &request_id);
    }

    let mut lists = vec![extract_recent_contacts(&snapshot)];
    if include_all {
        let full_list = match tokio::time::timeout(
            Duration::from_secs(5),
            state.napcat.get_recent_contact_list_sync(),
        )
        .await
        {
            Ok(Ok(value)) => Some(value),
            Ok(Err(error)) => {
                tracing::debug!("getRecentContactListSync unavailable: {error}");
                None
            }
            Err(_) => {
                tracing::debug!("getRecentContactListSync timed out");
                None
            }
        };
        let full_list = if full_list.is_some() {
            full_list
        } else {
            match tokio::time::timeout(
                Duration::from_secs(5),
                state.napcat.get_recent_contact_list(),
            )
            .await
            {
                Ok(Ok(value)) => Some(value),
                Ok(Err(error)) => {
                    tracing::debug!("getRecentContactList unavailable: {error}");
                    None
                }
                Err(_) => {
                    tracing::debug!("getRecentContactList timed out");
                    None
                }
            }
        };
        if let Some(value) = full_list {
            lists.push(extract_recent_contacts(&value));
        }
    }
    let raw_contacts = merge_recent_contacts(lists);

    let mut friend_uids = HashSet::new();
    if let Ok(friends) = state.napcat.get_friends(false).await {
        if let Some(friend_list) = friends.as_array() {
            for friend in friend_list {
                let core = friend.get("coreInfo").unwrap_or(friend);
                let uid = {
                    let uid = str_of(core, "uid");
                    if uid.is_empty() {
                        str_of(friend, "uid")
                    } else {
                        uid
                    }
                };
                if !uid.is_empty() {
                    friend_uids.insert(uid);
                }
                let uin = {
                    let uin = str_of(core, "uin");
                    if uin.is_empty() {
                        str_of(friend, "uin")
                    } else {
                        uin
                    }
                };
                if !uin.is_empty() {
                    friend_uids.insert(uin);
                }
            }
        }
    }

    let mut contacts = build_recent_contacts(&raw_contacts, &friend_uids, include_all);
    enrich_contact_names(&mut contacts, &state, include_all).await;

    response::success(
        json!({
            "contacts": contacts,
            "totalCount": contacts.len(),
            "rawCount": raw_contacts.len(),
        }),
        &request_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_snapshot_count_without_rejecting_valid_values() {
        assert_eq!(recent_contact_limit(&HashMap::new()), 100);
        assert_eq!(
            recent_contact_limit(&HashMap::from([("limit".to_string(), "500".to_string())])),
            500
        );
        assert_eq!(
            recent_contact_limit(&HashMap::from([("limit".to_string(), "9000".to_string())])),
            2_000
        );
    }

    #[test]
    fn flattened_friends_are_deduplicated_across_categories() {
        let categories = vec![
            json!({
                "categoryId": 0,
                "buddyList": [
                    {"coreInfo": {"uid": "u_a", "uin": "1001", "nick": "A"}},
                    {"coreInfo": {"uid": "u_b", "uin": "1002", "nick": "B"}},
                ],
            }),
            json!({
                "categoryId": 1,
                "buddyList": [
                    {"coreInfo": {"uid": "u_a", "uin": "1001", "nick": "A"}},
                    {"coreInfo": {"uid": "u_c", "uin": "1003", "nick": "C"}},
                ],
            }),
        ];

        let friends = flatten_friend_categories(&categories);

        assert_eq!(friends.len(), 3);
        assert_eq!(friends[0]["uid"], "u_a");
        assert_eq!(friends[0]["categoryId"], 0);
        assert_eq!(friends[1]["uid"], "u_b");
        assert_eq!(friends[2]["uid"], "u_c");
    }

    #[test]
    fn merges_snapshot_and_local_contacts_with_stable_deduplication() {
        let merged = merge_recent_contacts([
            vec![
                json!({"chatType": 1, "peerUid": "bot", "peerName": "snapshot"}),
                json!({"chatType": 2, "peerUid": "group"}),
            ],
            vec![
                json!({"chatType": 1, "peerUid": "bot", "peerName": "local"}),
                json!({"chatType": 118, "peerUid": "service"}),
                json!({"chatType": 100}),
            ],
        ]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["peerName"], "snapshot");
        assert_eq!(merged[2]["peerUid"], "service");
    }

    #[test]
    fn maps_non_friend_private_sessions_for_frontend_merging() {
        let contact = json!({
            "chatType": 1,
            "peerUid": "u_bot",
            "peerUin": "123456",
            "sendNickName": "QQ Bot",
            "msgId": "message-1",
            "msgTime": 1_783_950_000,
        });
        let mapped = map_recent_contact(&contact, &HashSet::new(), true).unwrap();
        assert_eq!(mapped["classification"], "special");
        assert_eq!(mapped["name"], "QQ Bot");
        assert_eq!(mapped["lastMsgId"], "message-1");
        assert_eq!(mapped["lastMsgTime"], "2026-07-13T13:40:00.000Z");
    }

    #[test]
    fn include_all_keeps_friends_distinct_from_non_friend_private_sessions() {
        let friend_uids = HashSet::from(["u_friend".to_string()]);
        let friend = map_recent_contact(
            &json!({"chatType": 1, "peerUid": "u_friend"}),
            &friend_uids,
            true,
        )
        .unwrap();
        let non_friend = map_recent_contact(
            &json!({"chatType": 1, "peerUid": "u_bot"}),
            &friend_uids,
            true,
        )
        .unwrap();
        assert_eq!(friend["classification"], "friend");
        assert_eq!(non_friend["classification"], "special");
    }

    #[test]
    fn device_sessions_are_special_and_named() {
        // 数据线设备会话（chatType 8/134）：无 peerName 时兜底「我的设备」，且归类 special。
        for chat_type in [8, 134] {
            let contact = json!({
                "chatType": chat_type,
                "peerUid": "u_device_peer",
            });
            let mapped = map_recent_contact(&contact, &HashSet::new(), true).unwrap();
            assert_eq!(mapped["classification"], "special");
            assert_eq!(mapped["name"], "我的设备");
        }
        // NapCat 提供了 peerName（如「我的电脑」）时应保留原名。
        let named = map_recent_contact(
            &json!({"chatType": 8, "peerUid": "u_device_peer", "peerName": "我的电脑"}),
            &HashSet::new(),
            true,
        )
        .unwrap();
        assert_eq!(named["name"], "我的电脑");
    }

    #[test]
    fn preserves_private_group_and_special_classification() {
        let friend_uids = HashSet::from(["u_friend".to_string()]);
        let cases = [
            (json!({"chatType": 1, "peerUid": "u_friend"}), "friend"),
            (json!({"chatType": 1, "peerUid": "u_bot"}), "private"),
            (json!({"chatType": 2, "peerUid": "12345"}), "group"),
            (json!({"chatType": 100, "peerUid": "u_temp"}), "special"),
            (json!({"chatType": 118, "peerUid": "u_service"}), "special"),
            (json!({"chatType": 201, "peerUid": "u_public"}), "special"),
            (json!({"chatType": 9, "peerUid": "u_guild"}), "special"),
            (json!({"chatType": 16, "peerUid": "u_channel"}), "special"),
        ];
        for (contact, expected) in cases {
            assert_eq!(
                map_recent_contact(&contact, &friend_uids, false).unwrap()["classification"],
                expected
            );
        }
    }

    #[test]
    fn default_response_excludes_friends_and_groups() {
        let friend_uids = HashSet::from(["u_friend".to_string()]);
        let contacts = build_recent_contacts(
            &[
                json!({"chatType": 1, "peerUid": "u_friend"}),
                json!({"chatType": 1, "peerUid": "u_bot"}),
                json!({"chatType": 2, "peerUid": "12345"}),
                json!({"chatType": 118, "peerUid": "u_service"}),
            ],
            &friend_uids,
            false,
        );
        assert_eq!(contacts.len(), 2);
        assert_eq!(contacts[0]["classification"], "private");
        assert_eq!(contacts[1]["classification"], "special");
    }

    #[test]
    fn unnamed_enrichment_is_bounded_to_thirty_special_contacts() {
        let contacts: Vec<Value> = (0..35)
            .map(|index| {
                json!({
                    "peerUid": format!("u_{index}"),
                    "name": format!("u_{index}"),
                    "classification": "special",
                })
            })
            .collect();
        let candidates = unnamed_special_contacts(&contacts, 30);
        assert_eq!(candidates.len(), 30);
        assert_eq!(candidates[0], (0, "u_0".to_string()));
        assert_eq!(candidates[29], (29, "u_29".to_string()));
    }

    #[tokio::test]
    async fn detail_name_lookup_times_out_and_tolerates_errors() {
        let timed_out = detail_name_with_timeout(
            Duration::from_millis(1),
            std::future::pending::<Result<Value, ()>>(),
        )
        .await;
        assert_eq!(timed_out, None);

        let failed =
            detail_name_with_timeout(Duration::from_secs(1), async { Err::<Value, ()>(()) }).await;
        assert_eq!(failed, None);

        let resolved = detail_name_with_timeout(Duration::from_secs(1), async {
            Ok::<Value, ()>(json!({
                "simpleInfo": {"coreInfo": {"nick": "Readable Bot"}}
            }))
        })
        .await;
        assert_eq!(resolved.as_deref(), Some("Readable Bot"));
    }
}
