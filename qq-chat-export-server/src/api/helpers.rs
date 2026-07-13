use std::time::Duration;

use serde_json::{json, Value};

use qce_exporter::CleanMessage;

use crate::fetcher::is_private_like_chat_type;
use crate::napcat::NapCatBridgeClient;

/// 单步查询超时（毫秒，对齐 TS `DEFAULT_TIMEOUT = 2000`）。
const SESSION_NAME_TIMEOUT_MS: u64 = 2000;

/// 下载 URL 到内存（30 秒超时，跟随重定向；失败返回 `None`）。
pub async fn http_get_bytes(url: &str) -> Option<bytes::Bytes> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default()
    });
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.bytes().await.ok()
}

/// 宽松转数字（对应 TS `toNumber`）。
fn to_number(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) if !s.trim().is_empty() => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// 宽松转字符串（对应 TS `toString`）。
fn to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// 单条通知映射（对应 TS `mapItem`）。
fn map_notify_item(raw: &Value, kind: &str) -> Value {
    let requester_nick = raw
        .get("requester_nick")
        .filter(|v| !v.is_null())
        .or_else(|| raw.get("invitor_nick"));
    json!({
        "requestId": to_number(raw.get("request_id")),
        "kind": kind,
        "groupId": to_string(raw.get("group_id")),
        "groupName": to_string(raw.get("group_name")),
        "requesterUin": to_number(raw.get("invitor_uin")),
        "requesterNick": to_string(requester_nick),
        "actorUin": to_number(raw.get("actor")),
        "invitorUin": to_number(raw.get("invitor_uin")),
        "invitorNick": to_string(raw.get("invitor_nick")),
        "message": to_string(raw.get("message")),
        "checked": raw.get("checked").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// 群系统通知规范化（对应 TS `normalizeGroupSystemNotify`，issue #317）。
pub fn normalize_group_system_notify(raw: &Value) -> Value {
    let empty: Vec<Value> = Vec::new();
    let join = raw
        .get("join_requests")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    // OneBot 字段历史遗留 InvitedRequest（驼峰）和 invited_requests（蛇形）
    // 同时存在，取其一即可，避免重复。
    let invited = raw
        .get("invited_requests")
        .and_then(Value::as_array)
        .or_else(|| raw.get("InvitedRequest").and_then(Value::as_array))
        .unwrap_or(&empty);

    let join_requests: Vec<Value> = join.iter().map(|item| map_notify_item(item, "join")).collect();
    let invited_requests: Vec<Value> = invited
        .iter()
        .map(|item| map_notify_item(item, "invited"))
        .collect();

    json!({
        "joinRequests": join_requests,
        "invitedRequests": invited_requests,
        "totalCount": join_requests.len() + invited_requests.len(),
    })
}

/// 从好友分类结构中拍平出好友列表。
fn flat_buddy_list(categories: &Value) -> Vec<Value> {
    categories
        .as_array()
        .map(|cats| {
            cats.iter()
                .filter_map(|cat| cat.get("buddyList").and_then(Value::as_array))
                .flatten()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// 按 QQ 号反查用户（对应 TS `lookupUserByUin`，issue #204）。
pub async fn lookup_user_by_uin(raw_uin: &str, napcat: &NapCatBridgeClient) -> Value {
    let uin = raw_uin.trim();
    let is_valid = uin.len() >= 4 && uin.len() <= 12 && uin.chars().all(|c| c.is_ascii_digit());
    if !is_valid {
        return json!({
            "found": false,
            "uin": uin,
            "reason": "uin 必须是 4-12 位的数字 QQ 号",
        });
    }

    let uid = match napcat.get_uid_by_uin_v2(uin).await {
        Ok(Value::String(u)) if !u.is_empty() => Some(u),
        Ok(other) => other
            .get("uid")
            .and_then(Value::as_str)
            .filter(|u| !u.is_empty())
            .map(ToString::to_string),
        Err(_) => None,
    };
    let Some(uid) = uid else {
        return json!({
            "found": false,
            "uin": uin,
            "reason": "该 QQ 号未在本机 NTQQ 数据中找到对应 uid（可能从未与之产生过聊天，或对方账号已彻底注销）",
        });
    };

    let mut nick: Option<String> = None;
    let mut remark: Option<String> = None;
    if let Ok(detail) = napcat.get_user_detail_info(&uid).await {
        nick = pick_str(&detail, &["nick", "nickName"])
            .or_else(|| nested_core_info_str(&detail, "nick"));
        remark = pick_str(&detail, &["remark"]).or_else(|| nested_core_info_str(&detail, "remark"));
    }

    let mut is_friend = false;
    if let Ok(categories) = napcat.get_buddy_v2_ex_with_cate(false).await {
        is_friend = flat_buddy_list(&categories).iter().any(|f| {
            let f_uid = pick_str(f, &["uid"])
                .or_else(|| f.get("coreInfo").and_then(|c| pick_str(c, &["uid"])))
                .unwrap_or_default();
            let f_uin = pick_str(f, &["uin"])
                .or_else(|| f.get("coreInfo").and_then(|c| pick_str(c, &["uin"])))
                .unwrap_or_default();
            f_uid == uid || f_uin == uin
        });
    }

    json!({
        "found": true,
        "uin": uin,
        "uid": uid,
        "nick": nick,
        "remark": remark,
        "avatarUrl": format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640"),
        "isFriend": is_friend,
    })
}

/// 从对象中按顺序取第一个非空字符串字段（数字也转成字符串）。
fn pick_str(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        match value.get(key) {
            Some(Value::String(s)) if !s.is_empty() => return Some(s.clone()),
            Some(Value::Number(n)) => return Some(n.to_string()),
            _ => {}
        }
    }
    None
}

/// 取 `simpleInfo.coreInfo.<key>`。
fn nested_core_info_str(value: &Value, key: &str) -> Option<String> {
    value
        .get("simpleInfo")
        .and_then(|s| s.get("coreInfo"))
        .and_then(|c| c.get(key))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

pub fn resolve_peer_uin(
    peer_uid: &str,
    self_uin: Option<&str>,
    messages: &[CleanMessage],
) -> Option<String> {
    let valid_uin = |uin: &&str| {
        !uin.is_empty() && uin.chars().all(|c| c.is_ascii_digit()) && *uin != "0"
    };
    messages
        .iter()
        .find(|message| message.sender.uid == peer_uid)
        .and_then(|message| message.sender.uin.as_deref())
        .filter(valid_uin)
        .or_else(|| {
            messages
                .iter()
                .filter_map(|message| message.sender.uin.as_deref())
                .filter(valid_uin)
                .find(|uin| Some(*uin) != self_uin)
        })
        .map(str::to_string)
}

#[must_use]
pub fn chat_avatar_url(chat_type: &str, peer_uid: &str, peer_uin: Option<&str>) -> Option<String> {
    if chat_type == "group" {
        return (!peer_uid.is_empty())
            .then(|| format!("https://p.qlogo.cn/gh/{peer_uid}/{peer_uid}/640/"));
    }
    peer_uin.map(|uin| format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640"))
}

/// 单聊型会话导出时把数字 QQ 号解析为真正的 NTQQ uid（对应 TS
/// `resolvePeerUid`，issue #353）。任何缺失 / 异常 / 空返回都安全降级到原始
/// peerUid。
pub async fn resolve_peer_uid(
    chat_type: i64,
    peer_uid: &str,
    napcat: &NapCatBridgeClient,
) -> String {
    if !should_resolve_peer_uid(chat_type, peer_uid) {
        return peer_uid.to_string();
    }
    match napcat.get_uid_by_uin_v2(peer_uid).await {
        Ok(Value::String(uid)) if !uid.is_empty() => uid,
        Ok(other) => other
            .get("uid")
            .and_then(Value::as_str)
            .filter(|u| !u.is_empty())
            .map_or_else(|| peer_uid.to_string(), ToString::to_string),
        Err(_) => peer_uid.to_string(),
    }
}

fn should_resolve_peer_uid(chat_type: i64, peer_uid: &str) -> bool {
    is_private_like_chat_type(Some(chat_type))
        && !peer_uid.is_empty()
        && peer_uid.chars().all(|c| c.is_ascii_digit())
}

/// 会话名解析（对应 TS `resolveSessionName`，issue #365）。
///
/// - chatType === 2 → 走群列表；
/// - 其它任何 chatType → 优先用好友缓存，再试 `getUserDetailInfo`，最后兜底
///   fallback（默认 peerUid）。任意异常都吞掉。
pub async fn resolve_session_name(
    chat_type: i64,
    peer_uid: &str,
    napcat: &NapCatBridgeClient,
) -> String {
    let fallback = peer_uid.to_string();
    let timeout = Duration::from_millis(SESSION_NAME_TIMEOUT_MS);

    if !is_private_like_chat_type(Some(chat_type)) {
        let lookup = async {
            let groups = napcat.get_groups(false).await.ok()?;
            groups.as_array()?.iter().find_map(|g| {
                let code = to_string(g.get("groupCode"));
                if code == peer_uid {
                    pick_str(g, &["groupName"])
                } else {
                    None
                }
            })
        };
        return match tokio::time::timeout(timeout, lookup).await {
            Ok(Some(name)) if !name.is_empty() => name,
            _ => format!("群聊 {peer_uid}"),
        };
    }

    let lookup = async {
        if let Ok(friends) = napcat.get_buddy().await {
            if let Some(list) = friends.as_array() {
                for friend in list {
                    let core = friend.get("coreInfo").unwrap_or(&Value::Null);
                    if core.get("uid").and_then(Value::as_str) == Some(peer_uid) {
                        if let Some(name) = pick_str(core, &["remark", "nick"]) {
                            return Some(name);
                        }
                    }
                }
            }
        }
        if let Ok(detail) = napcat.get_user_detail_info(peer_uid).await {
            if let Some(name) = pick_str(&detail, &["remark", "nick", "nickName"])
                .or_else(|| nested_core_info_str(&detail, "remark"))
                .or_else(|| nested_core_info_str(&detail, "nick"))
            {
                return Some(name);
            }
        }
        None
    };
    match tokio::time::timeout(timeout, lookup).await {
        Ok(Some(name)) if !name.is_empty() => name,
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_empty_payload() {
        let normalized = normalize_group_system_notify(&Value::Null);
        assert_eq!(normalized["totalCount"], 0);
        assert!(normalized["joinRequests"].as_array().is_some_and(Vec::is_empty));
    }

    #[test]
    fn normalize_join_and_invited() {
        let raw = json!({
            "join_requests": [{
                "request_id": "123",
                "invitor_uin": 10001,
                "invitor_nick": "inviter",
                "group_id": 999,
                "group_name": "test group",
                "message": "hi",
                "checked": true,
                "actor": 0,
                "requester_nick": "requester"
            }],
            "InvitedRequest": [{
                "request_id": 456,
                "group_id": "888"
            }]
        });
        let normalized = normalize_group_system_notify(&raw);
        assert_eq!(normalized["totalCount"], 2);
        assert_eq!(normalized["joinRequests"][0]["requestId"], 123);
        assert_eq!(normalized["joinRequests"][0]["requesterNick"], "requester");
        assert_eq!(normalized["joinRequests"][0]["checked"], true);
        assert_eq!(normalized["invitedRequests"][0]["kind"], "invited");
        assert_eq!(normalized["invitedRequests"][0]["groupId"], "888");
    }

    #[test]
    fn private_avatar_requires_numeric_uin() {
        assert_eq!(
            chat_avatar_url("private", "u_peer", Some("1687657986")),
            Some("https://q1.qlogo.cn/g?b=qq&nk=1687657986&s=640".to_string())
        );
        assert_eq!(chat_avatar_url("private", "u_peer", None), None);
    }

    #[test]
    fn resolves_numeric_uin_for_every_private_like_chat_type() {
        for chat_type in [1, 9, 16, 100, 118, 201] {
            assert!(
                should_resolve_peer_uid(chat_type, "123456"),
                "chatType={chat_type} should resolve numeric peerUid"
            );
        }
    }

    #[test]
    fn never_resolves_group_codes_or_existing_uids() {
        assert!(!should_resolve_peer_uid(2, "987654321"));
        assert!(!should_resolve_peer_uid(100, "u_existing"));
        assert!(!should_resolve_peer_uid(118, ""));
    }
}
