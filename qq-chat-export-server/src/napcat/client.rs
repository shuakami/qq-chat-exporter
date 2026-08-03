use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

use crate::fetcher::{MessageFetchApi, Peer};
use crate::parser::ForwardFetcher;

/// bridge 调用错误。
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    /// 网络 / 传输错误。
    #[error("bridge 传输错误: {0}")]
    Transport(#[from] reqwest::Error),
    /// bridge 返回业务错误。
    #[error("bridge 调用失败: {0}")]
    Rpc(String),
    /// 响应结构异常。
    #[error("bridge 响应结构异常: {0}")]
    InvalidResponse(String),
}

/// NapCat bridge 客户端（可 `Clone`，内部连接池共享）。
#[derive(Debug, Clone)]
pub struct NapCatBridgeClient {
    http: reqwest::Client,
    endpoint: String,
    request_seq: std::sync::Arc<AtomicU64>,
}

impl NapCatBridgeClient {
    /// 创建客户端。`endpoint` 形如 `http://127.0.0.1:40654`。
    pub fn new(endpoint: &str, timeout_ms: u64) -> Result<Self, BridgeError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()?;
        Ok(Self {
            http,
            endpoint: format!("{}/rpc", endpoint.trim_end_matches('/')),
            request_seq: std::sync::Arc::new(AtomicU64::new(1)),
        })
    }

    /// 通用 RPC 调用。
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, BridgeError> {
        let id = self.request_seq.fetch_add(1, Ordering::Relaxed);
        let response = self
            .http
            .post(&self.endpoint)
            .json(&json!({ "id": id, "method": method, "params": params }))
            .send()
            .await?;
        let body: Value = response.json().await?;
        let ok = body
            .get("ok")
            .and_then(Value::as_bool)
            .ok_or_else(|| BridgeError::InvalidResponse("缺少 ok 字段".to_string()))?;
        if !ok {
            let error = body
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("未知错误")
                .to_string();
            return Err(BridgeError::Rpc(error));
        }
        match body {
            Value::Object(mut map) => Ok(map.remove("result").unwrap_or(Value::Null)),
            _ => Ok(Value::Null),
        }
    }

    /// bridge 健康检查（`GET /healthz`）。
    pub async fn healthy(&self) -> bool {
        let url = self.endpoint.replace("/rpc", "/healthz");
        matches!(
            self.http.get(&url).send().await,
            Ok(response) if response.status().is_success()
        )
    }

    /// 当前登录账号信息（`core.selfInfo`）。
    pub async fn self_info(&self) -> Result<Value, BridgeError> {
        self.call("Core.selfInfo", json!([])).await
    }

    /// 获取群列表。
    pub async fn get_groups(&self, force_refresh: bool) -> Result<Value, BridgeError> {
        self.call("GroupApi.getGroups", json!([force_refresh]))
            .await
    }

    /// 获取群详情。
    pub async fn fetch_group_detail(&self, group_code: &str) -> Result<Value, BridgeError> {
        self.call("GroupApi.fetchGroupDetail", json!([group_code]))
            .await
    }

    /// 获取群全部成员。
    pub async fn get_group_member_all(
        &self,
        group_code: &str,
        force_update: bool,
    ) -> Result<Value, BridgeError> {
        match self
            .call(
                "GroupService.getAllMemberList",
                json!([group_code, force_update]),
            )
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => {
                self.call(
                    "GroupApi.getGroupMemberAll",
                    json!([group_code, force_update]),
                )
                .await
            }
        }
    }

    /// 获取群系统消息（入群申请等）。
    pub async fn get_group_system_msg(&self) -> Result<Value, BridgeError> {
        self.call("GroupApi.getGroupSystemMsg", json!([])).await
    }

    /// 获取群文件数量。
    pub async fn get_group_file_count(
        &self,
        group_codes: Vec<String>,
    ) -> Result<Value, BridgeError> {
        self.call("GroupApi.getGroupFileCount", json!([group_codes]))
            .await
    }

    /// 获取好友列表（带分组）。
    pub async fn get_buddy_v2_ex_with_cate(&self, refresh: bool) -> Result<Value, BridgeError> {
        self.call("FriendApi.getBuddyV2ExWithCate", json!([refresh]))
            .await
    }

    /// 获取好友列表（简单版）。
    pub async fn get_friends(&self, force_refresh: bool) -> Result<Value, BridgeError> {
        self.call("FriendApi.getFriends", json!([force_refresh]))
            .await
    }

    /// 获取用户详细信息。
    /// `UserApi.getUidByUinV2`（可能不受旧版 NapCat 支持，调用方需容错）。
    pub async fn get_uid_by_uin_v2(&self, uin: &str) -> Result<Value, BridgeError> {
        self.call("UserApi.getUidByUinV2", serde_json::json!([uin]))
            .await
    }

    /// `FriendApi.getBuddy`（好友缓存列表）。
    pub async fn get_buddy(&self) -> Result<Value, BridgeError> {
        self.call("FriendApi.getBuddy", serde_json::json!([])).await
    }

    pub async fn get_user_detail_info(&self, uid: &str) -> Result<Value, BridgeError> {
        self.call("UserApi.getUserDetailInfo", json!([uid])).await
    }

    /// 获取最近会话列表快照。
    pub async fn get_recent_contact_list_snapshot(&self, count: i64) -> Result<Value, BridgeError> {
        self.call("UserApi.getRecentContactListSnapShot", json!([count]))
            .await
    }

    /// 获取 NTQQ 本地保存的全量会话列表。
    pub async fn get_recent_contact_list_sync(&self) -> Result<Value, BridgeError> {
        self.call("UserApi.getRecentContactListSync", json!([]))
            .await
    }

    /// 获取 NTQQ 本地保存的全量会话列表（部分版本使用异步方法名）。
    pub async fn get_recent_contact_list(&self) -> Result<Value, BridgeError> {
        self.call("UserApi.getRecentContactList", json!([])).await
    }

    /// 获取合并转发消息内容。
    pub async fn get_multi_msg(
        &self,
        peer: &Value,
        root_msg_id: &str,
        parent_msg_id: &str,
    ) -> Result<Value, BridgeError> {
        match self
            .call(
                "MsgService.getMultiMsg",
                json!([peer, root_msg_id, parent_msg_id]),
            )
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => {
                self.call(
                    "MsgApi.getMultiMsg",
                    json!([peer, root_msg_id, parent_msg_id]),
                )
                .await
            }
        }
    }

    /// 下载媒体资源，返回本地路径。
    #[allow(clippy::too_many_arguments)]
    pub async fn download_media(
        &self,
        msg_id: &str,
        chat_type: i64,
        peer_uid: &str,
        element_id: &str,
        this_path: &str,
        source_path: &str,
        timeout_ms: u64,
        force: bool,
    ) -> Result<Value, BridgeError> {
        self.call(
            "FileApi.downloadMedia",
            download_media_params(
                msg_id,
                chat_type,
                peer_uid,
                element_id,
                this_path,
                source_path,
                timeout_ms,
                force,
            ),
        )
        .await
    }

    /// 获取语音下载地址。
    pub async fn get_ptt_url(
        &self,
        peer: &Value,
        msg_id: &str,
        element_id: &str,
    ) -> Result<Value, BridgeError> {
        self.call("FileApi.getPttUrl", json!([peer, msg_id, element_id]))
            .await
    }

    /// 获取群精华消息（全部）。
    pub async fn get_group_essence_msg_all(&self, group_code: &str) -> Result<Value, BridgeError> {
        self.call("WebApi.getGroupEssenceMsgAll", json!([group_code]))
            .await
    }

    /// 获取群荣誉信息。
    pub async fn get_group_honor_info(
        &self,
        group_code: &str,
        honor_type: i64,
    ) -> Result<Value, BridgeError> {
        self.call("WebApi.getGroupHonorInfo", json!([group_code, honor_type]))
            .await
    }

    /// 获取群相册列表。
    pub async fn get_album_list(&self, group_code: &str) -> Result<Value, BridgeError> {
        self.call("WebApi.getAlbumListByNTQQ", json!([group_code]))
            .await
    }

    /// 获取群相册媒体列表。
    pub async fn get_album_media_list(
        &self,
        group_code: &str,
        album_id: &str,
        attach_info: &str,
    ) -> Result<Value, BridgeError> {
        self.call(
            "WebApi.getAlbumMediaListByNTQQ",
            json!([group_code, album_id, attach_info]),
        )
        .await
    }

    /// 获取群文件列表。
    pub async fn get_group_file_list(
        &self,
        group_code: &str,
        params: &Value,
    ) -> Result<Value, BridgeError> {
        self.call("MsgApi.getGroupFileList", json!([group_code, params]))
            .await
    }

    /// 获取群文件下载地址（Packet API）。
    pub async fn get_group_file_url(
        &self,
        group_code: &str,
        file_id: &str,
    ) -> Result<Value, BridgeError> {
        self.call("PacketApi.getGroupFileUrl", json!([group_code, file_id]))
            .await
    }

    async fn get_message_history(
        &self,
        peer: &Peer,
        msg_id: &str,
        count: i64,
    ) -> Result<Value, BridgeError> {
        let params = json!([peer_to_value(peer), msg_id, count, true]);
        match self
            .call("MsgService.getMsgsIncludeSelf", params.clone())
            .await
        {
            Ok(result) => Ok(normalize_message_response(result)),
            Err(service_error) => {
                tracing::debug!(
                    "MsgService.getMsgsIncludeSelf 调用失败，尝试 MsgApi 包装层: {}",
                    service_error
                );
                self.call("MsgApi.getMsgHistory", params)
                    .await
                    .map(normalize_message_response)
            }
        }
    }

    /// 从 NTQQ 本地消息数据库读取会话最新消息。
    /// 该内核接口与首屏/历史查询相互独立，用于数据线会话空结果回退。
    async fn get_latest_db_messages(
        &self,
        peer: &Peer,
        count: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.getLatestDbMsgs",
            json!([peer_to_value(peer), count]),
        )
        .await
        .map(normalize_message_response)
    }

    async fn latest_device_message_id(&self, peer: &Peer) -> Option<String> {
        if let Ok(contacts) = self.get_recent_contact_list_sync().await {
            if let Some(msg_id) = latest_message_id_for_peer(&contacts, peer) {
                return Some(msg_id);
            }
        }
        if let Ok(contacts) = self.get_recent_contact_list().await {
            if let Some(msg_id) = latest_message_id_for_peer(&contacts, peer) {
                return Some(msg_id);
            }
        }
        if let Ok(contacts) = self.get_recent_contact_list_snapshot(2_000).await {
            return latest_message_id_for_peer(&contacts, peer);
        }
        None
    }
}

fn extract_forward_messages(value: &Value) -> Option<Vec<Value>> {
    [
        value.get("msgList"),
        value.get("messages"),
        value.get("data").and_then(|data| data.get("messages")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_array)
    .cloned()
}

fn is_device_chat_type(chat_type: i64) -> bool {
    matches!(chat_type, 8 | 134)
}

fn message_list(value: &Value) -> Option<&Vec<Value>> {
    value
        .get("msgList")
        .and_then(Value::as_array)
        .or_else(|| {
            value
                .get("result")
                .and_then(|result| result.get("msgList"))
                .and_then(Value::as_array)
        })
        .or_else(|| {
            value
                .get("data")
                .and_then(|data| data.get("msgList"))
                .and_then(Value::as_array)
        })
        .or_else(|| {
            value
                .get("data")
                .and_then(|data| data.get("result"))
                .and_then(|result| result.get("msgList"))
                .and_then(Value::as_array)
        })
}

/// 统一为批量获取器能够稳定消费的顶层 `msgList` 响应。
fn normalize_message_response(value: Value) -> Value {
    message_list(&value)
        .cloned()
        .map_or(value, |messages| json!({ "msgList": messages }))
}

fn message_response_shape(value: &Value) -> &'static str {
    if value.get("msgList").is_some() {
        "msgList"
    } else if value
        .get("result")
        .and_then(|result| result.get("msgList"))
        .is_some()
    {
        "result.msgList"
    } else if value
        .get("data")
        .and_then(|data| data.get("msgList"))
        .is_some()
    {
        "data.msgList"
    } else if value
        .get("data")
        .and_then(|data| data.get("result"))
        .and_then(|result| result.get("msgList"))
        .is_some()
    {
        "data.result.msgList"
    } else {
        "missing"
    }
}

fn response_has_messages(value: &Value) -> bool {
    message_list(value).is_some_and(|messages| !messages.is_empty())
}

fn recent_contact_list(value: &Value) -> Option<&Vec<Value>> {
    value.as_array().or_else(|| {
        value
            .get("info")
            .and_then(|info| info.get("changedList"))
            .and_then(Value::as_array)
    })
    .or_else(|| value.get("changedList").and_then(Value::as_array))
    .or_else(|| {
        value
            .get("result")
            .and_then(|result| result.get("info"))
            .and_then(|info| info.get("changedList"))
            .and_then(Value::as_array)
    })
    .or_else(|| {
        value
            .get("result")
            .and_then(|result| result.get("changedList"))
            .and_then(Value::as_array)
    })
    .or_else(|| {
        value
            .get("data")
            .and_then(|data| data.get("info"))
            .and_then(|info| info.get("changedList"))
            .and_then(Value::as_array)
    })
    .or_else(|| {
        value
            .get("data")
            .and_then(|data| data.get("changedList"))
            .and_then(Value::as_array)
    })
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_as_i64(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(value) => value.as_i64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn latest_message_id_for_peer(value: &Value, peer: &Peer) -> Option<String> {
    recent_contact_list(value)?
        .iter()
        .find(|contact| {
            value_as_i64(contact.get("chatType")) == Some(peer.chat_type)
                && value_as_string(contact.get("peerUid")).as_deref()
                    == Some(peer.peer_uid.as_str())
        })
        .and_then(|contact| value_as_string(contact.get("msgId")))
}

#[async_trait::async_trait]
impl ForwardFetcher for NapCatBridgeClient {
    async fn get_multi_msg(
        &self,
        chat_type: i64,
        peer_uid: &str,
        root_msg_id: &str,
        _res_id: &str,
    ) -> Option<Vec<Value>> {
        let peer = json!({
            "chatType": chat_type,
            "peerUid": peer_uid,
            "guildId": "",
        });
        self.get_multi_msg(&peer, root_msg_id, root_msg_id)
            .await
            .ok()
            .and_then(|value| extract_forward_messages(&value))
    }
}

#[async_trait::async_trait]
impl crate::resource::MediaDownloader for NapCatBridgeClient {
    async fn download_media(
        &self,
        msg_id: &str,
        chat_type: i64,
        peer_uid: &str,
        element_id: &str,
        dest_path: &str,
        timeout_ms: u64,
    ) -> Result<String, String> {
        let result = NapCatBridgeClient::download_media(
            self, msg_id, chat_type, peer_uid, element_id, "", dest_path, timeout_ms, true,
        )
        .await
        .map_err(|error| error.to_string())?;
        match result {
            Value::String(path) => Ok(path),
            Value::Null => Ok(String::new()),
            other => Ok(other
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()),
        }
    }
}

#[async_trait::async_trait]
impl MessageFetchApi for NapCatBridgeClient {
    async fn get_aio_first_view_latest_msgs(
        &self,
        peer: &Peer,
        count: i64,
    ) -> Result<Value, String> {
        let params = json!([peer_to_value(peer), count]);
        let result = match self
            .call("MsgService.getAioFirstViewLatestMsgs", params.clone())
            .await
        {
            Ok(result) => result,
            Err(service_error) => {
                tracing::debug!(
                    "MsgService.getAioFirstViewLatestMsgs 调用失败，尝试 MsgApi 包装层: {}",
                    service_error
                );
                self.call("MsgApi.getAioFirstViewLatestMsgs", params)
                    .await
                    .map_err(|error| error.to_string())?
            }
        };

        if !is_device_chat_type(peer.chat_type) {
            return Ok(result);
        }

        if response_has_messages(&result) {
            return Ok(normalize_message_response(result));
        }

        tracing::warn!(
            "设备会话首屏消息为空，开始多级回退: peerUid={}, chatType={}, responseShape={}",
            peer.peer_uid,
            peer.chat_type,
            message_response_shape(&result)
        );

        match self.get_latest_db_messages(peer, count).await {
            Ok(db_messages) if response_has_messages(&db_messages) => {
                tracing::info!(
                    "设备会话已通过 getLatestDbMsgs 读取本地消息: peerUid={}, chatType={}, count={}",
                    peer.peer_uid,
                    peer.chat_type,
                    message_list(&db_messages).map_or(0, Vec::len)
                );
                return Ok(db_messages);
            }
            Ok(db_messages) => tracing::warn!(
                "设备会话 getLatestDbMsgs 仍为空: peerUid={}, chatType={}, responseShape={}",
                peer.peer_uid,
                peer.chat_type,
                message_response_shape(&db_messages)
            ),
            Err(error) => tracing::warn!(
                "设备会话 getLatestDbMsgs 调用失败: peerUid={}, chatType={}, error={}",
                peer.peer_uid,
                peer.chat_type,
                error
            ),
        }

        let Some(msg_id) = self.latest_device_message_id(peer).await else {
            tracing::warn!(
                "设备会话无法从最近联系人定位消息锚点: peerUid={}, chatType={}",
                peer.peer_uid,
                peer.chat_type
            );
            return Ok(normalize_message_response(result));
        };
        tracing::info!(
            "设备会话使用最近会话锚点回退查询: peerUid={}, chatType={}, msgId={}",
            peer.peer_uid,
            peer.chat_type,
            msg_id
        );

        match self.get_message_history(peer, &msg_id, count).await {
            Ok(history) if response_has_messages(&history) => {
                tracing::info!(
                    "设备会话已通过最近会话锚点读取消息: peerUid={}, chatType={}, count={}",
                    peer.peer_uid,
                    peer.chat_type,
                    message_list(&history).map_or(0, Vec::len)
                );
                Ok(history)
            }
            Ok(history) => {
                tracing::warn!(
                    "设备会话锚点历史查询仍为空: peerUid={}, chatType={}, responseShape={}",
                    peer.peer_uid,
                    peer.chat_type,
                    message_response_shape(&history)
                );
                Ok(normalize_message_response(result))
            }
            Err(error) => {
                tracing::warn!(
                    "设备会话锚点历史查询失败: peerUid={}, chatType={}, error={}",
                    peer.peer_uid,
                    peer.chat_type,
                    error
                );
                Ok(normalize_message_response(result))
            }
        }
    }

    async fn get_msg_history(
        &self,
        peer: &Peer,
        msg_id: &str,
        count: i64,
    ) -> Result<Value, String> {
        self.get_message_history(peer, msg_id, count)
            .await
            .map_err(|error| error.to_string())
    }

    async fn get_msgs_by_seq_range(
        &self,
        peer: &Peer,
        start_seq: &str,
        end_seq: &str,
    ) -> Result<Value, String> {
        let params = json!([peer_to_value(peer), start_seq, end_seq]);
        match self
            .call("MsgService.getMsgsBySeqRange", params.clone())
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .call("MsgApi.getMsgsBySeqRange", params)
                .await
                .map_err(|error| error.to_string()),
        }
    }

    async fn get_msgs_by_seq_and_count(
        &self,
        peer: &Peer,
        anchor_seq: i64,
        count: i64,
    ) -> Result<Value, String> {
        self.call(
            "MsgApi.getMsgsBySeqAndCount",
            json!([peer_to_value(peer), anchor_seq, count, true, true]),
        )
        .await
        .map_err(|error| error.to_string())
    }
}

/// `Peer` → NapCat JSON 结构。
fn peer_to_value(peer: &Peer) -> Value {
    json!({
        "chatType": peer.chat_type,
        "peerUid": peer.peer_uid,
        "guildId": peer.guild_id.clone().unwrap_or_default(),
    })
}

#[allow(clippy::too_many_arguments)]
fn download_media_params(
    msg_id: &str,
    chat_type: i64,
    peer_uid: &str,
    element_id: &str,
    thumb_path: &str,
    source_path: &str,
    timeout_ms: u64,
    force: bool,
) -> Value {
    json!([
        msg_id,
        chat_type,
        peer_uid,
        element_id,
        thumb_path,
        source_path,
        timeout_ms,
        force
    ])
}

#[cfg(test)]
mod tests {
    use super::{
        download_media_params, extract_forward_messages, is_device_chat_type,
        latest_message_id_for_peer, normalize_message_response, response_has_messages,
    };
    use crate::fetcher::Peer;
    use serde_json::json;

    #[test]
    fn extracts_forward_messages_from_supported_response_shapes() {
        let message = json!({"msgId": "inner-1"});
        assert_eq!(
            extract_forward_messages(&json!({"msgList": [message.clone()]})),
            Some(vec![message.clone()])
        );
        assert_eq!(
            extract_forward_messages(&json!({"messages": [message.clone()]})),
            Some(vec![message.clone()])
        );
        assert_eq!(
            extract_forward_messages(&json!({"data": {"messages": [message]}})).map(|v| v.len()),
            Some(1)
        );
        assert_eq!(extract_forward_messages(&json!({"data": {}})), None);
    }

    #[test]
    fn recognizes_message_lists_from_supported_response_shapes() {
        assert!(response_has_messages(&json!({"msgList": [{"msgId": "1"}]})));
        assert!(response_has_messages(
            &json!({"result": {"msgList": [{"msgId": "1"}]}})
        ));
        assert!(response_has_messages(
            &json!({"data": {"msgList": [{"msgId": "1"}]}})
        ));
        assert!(response_has_messages(
            &json!({"data": {"result": {"msgList": [{"msgId": "1"}]}}})
        ));
        assert!(!response_has_messages(&json!({"msgList": []})));
        assert!(!response_has_messages(&json!({})));
    }

    #[test]
    fn normalizes_wrapped_message_lists_for_batch_fetcher() {
        let message = json!({"msgId": "1"});
        assert_eq!(
            normalize_message_response(json!({"data": {"msgList": [message.clone()]}})),
            json!({"msgList": [message.clone()]})
        );
        assert_eq!(
            normalize_message_response(json!({
                "data": {"result": {"msgList": [message.clone()]}}
            })),
            json!({"msgList": [message]})
        );
    }

    #[test]
    fn finds_device_anchor_in_recent_contact_response_shapes() {
        let peer = Peer {
            chat_type: 8,
            peer_uid: "u_device".to_string(),
            guild_id: None,
        };
        assert_eq!(
            latest_message_id_for_peer(
                &json!({
                    "info": {
                        "changedList": [
                            {"chatType": 1, "peerUid": "u_friend", "msgId": "friend-msg"},
                            {"chatType": 8, "peerUid": "u_device", "msgId": "device-msg"}
                        ]
                    }
                }),
                &peer,
            ),
            Some("device-msg".to_string())
        );

        let mobile_peer = Peer {
            chat_type: 134,
            peer_uid: "u_mobile_device".to_string(),
            guild_id: None,
        };
        assert_eq!(
            latest_message_id_for_peer(
                &json!({
                    "data": {
                        "info": {
                            "changedList": [
                                {
                                    "chatType": "134",
                                    "peerUid": "u_mobile_device",
                                    "msgId": 12345
                                }
                            ]
                        }
                    }
                }),
                &mobile_peer,
            ),
            Some("12345".to_string())
        );
    }

    #[test]
    fn device_chat_types_are_limited_to_data_line_sessions() {
        assert!(is_device_chat_type(8));
        assert!(is_device_chat_type(134));
        assert!(!is_device_chat_type(1));
        assert!(!is_device_chat_type(2));
    }

    #[test]
    fn media_download_uses_source_path_as_destination() {
        let params = download_media_params(
            "msg",
            2,
            "peer",
            "element",
            "",
            "C:/exports/image.jpg",
            30_000,
            true,
        );
        let params = params.as_array().expect("download parameters");
        assert_eq!(params[4], "");
        assert_eq!(params[5], "C:/exports/image.jpg");
    }
}
