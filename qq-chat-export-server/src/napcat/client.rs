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

    /// 查询私聊漫游日历。
    ///
    /// `msg_time` 是 Unix 秒时间戳；调用方应仅传入 `chatType = 1` 的 `Peer`。
    pub async fn query_roam_calendar(
        &self,
        peer: &Peer,
        msg_time: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.queryRoamCalendar",
            roam_calendar_params(peer, msg_time),
        )
        .await
    }

    /// 查询 `msg_time` 所在日期的首条私聊漫游消息锚点。
    ///
    /// `msg_time` 是 Unix 秒时间戳；调用方应仅传入 `chatType = 1` 的 `Peer`。
    pub async fn query_first_roam_msg(
        &self,
        peer: &Peer,
        msg_time: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.queryFirstRoamMsg",
            first_roam_msg_params(peer, msg_time),
        )
        .await
    }

    /// 通过漫游锚点精确查询私聊消息。
    ///
    /// 序号和时间均保持十进制字符串，避免大整数精度损失。
    pub async fn get_msg_by_client_seq_and_time(
        &self,
        peer: &Peer,
        client_seq: &str,
        msg_time: &str,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.getMsgByClientSeqAndTime",
            msg_by_client_seq_and_time_params(peer, client_seq, msg_time),
        )
        .await
    }

    /// 从指定消息序列号向更早方向读取固定数量的消息。
    ///
    /// 该固定封装同时供普通批量获取器与有界漫游锚点桥接使用，避免两条路径
    /// 对 NapCat 参数顺序产生分歧。
    pub async fn get_msgs_by_seq_and_count(
        &self,
        peer: &Peer,
        anchor_seq: i64,
        count: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgApi.getMsgsBySeqAndCount",
            msgs_by_seq_and_count_params(peer, anchor_seq, count),
        )
        .await
    }

    /// 获取该私聊当前可见的最新消息，作为有界漫游扫描的尾端候选。
    pub async fn get_roaming_latest_messages(
        &self,
        peer: &Peer,
        count: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.getAioFirstViewLatestMsgs",
            latest_messages_params(peer, count),
        )
        .await
    }

    /// 按已知正整数消息序列查询一条私聊消息。
    pub async fn get_roaming_single_msg(
        &self,
        peer: &Peer,
        msg_seq: i64,
    ) -> Result<Value, BridgeError> {
        self.call(
            "MsgService.getSingleMsg",
            single_message_params(peer, msg_seq),
        )
        .await
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
        match self
            .call("MsgService.getAioFirstViewLatestMsgs", params.clone())
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .call("MsgApi.getAioFirstViewLatestMsgs", params)
                .await
                .map_err(|error| error.to_string()),
        }
    }

    async fn get_msg_history(
        &self,
        peer: &Peer,
        msg_id: &str,
        count: i64,
    ) -> Result<Value, String> {
        let params = json!([peer_to_value(peer), msg_id, count, true]);
        match self
            .call("MsgService.getMsgsIncludeSelf", params.clone())
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .call("MsgApi.getMsgHistory", params)
                .await
                .map_err(|error| error.to_string()),
        }
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
        NapCatBridgeClient::get_msgs_by_seq_and_count(self, peer, anchor_seq, count)
            .await
            .map_err(|error| error.to_string())
    }

    async fn bridge_healthy(&self) -> bool {
        self.healthy().await
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

fn roam_calendar_params(peer: &Peer, msg_time: i64) -> Value {
    json!([peer_to_value(peer), msg_time])
}

fn first_roam_msg_params(peer: &Peer, msg_time: i64) -> Value {
    json!([peer_to_value(peer), msg_time])
}

fn msg_by_client_seq_and_time_params(peer: &Peer, client_seq: &str, msg_time: &str) -> Value {
    json!([peer_to_value(peer), client_seq, msg_time])
}

fn msgs_by_seq_and_count_params(peer: &Peer, anchor_seq: i64, count: i64) -> Value {
    // NapCat 的 msgSeq 参数是字符串。
    json!([
        peer_to_value(peer),
        anchor_seq.to_string(),
        count,
        true,
        true
    ])
}

fn latest_messages_params(peer: &Peer, count: i64) -> Value {
    json!([peer_to_value(peer), count])
}

fn single_message_params(peer: &Peer, msg_seq: i64) -> Value {
    json!([peer_to_value(peer), msg_seq.to_string()])
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
        download_media_params, extract_forward_messages, first_roam_msg_params,
        latest_messages_params, msg_by_client_seq_and_time_params, roam_calendar_params,
        single_message_params, NapCatBridgeClient,
    };
    use crate::fetcher::Peer;
    use axum::extract::Json;
    use axum::routing::post;
    use axum::Router;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn private_peer() -> Peer {
        Peer {
            chat_type: 1,
            peer_uid: "u_peer".to_string(),
            guild_id: None,
        }
    }

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

    #[test]
    fn roaming_calendar_params_keep_native_peer_shape_and_seconds() {
        let params = roam_calendar_params(&private_peer(), 1_704_067_200);
        assert_eq!(
            params,
            json!([{
                "chatType": 1,
                "peerUid": "u_peer",
                "guildId": "",
            }, 1_704_067_200])
        );

        assert_eq!(
            first_roam_msg_params(&private_peer(), 1_704_067_200),
            params
        );
    }

    #[test]
    fn exact_roaming_lookup_preserves_string_anchor_order_and_precision() {
        let client_seq = "184467440737095516160001";
        let msg_time = "184467440737095516160002";
        let params = msg_by_client_seq_and_time_params(&private_peer(), client_seq, msg_time);

        assert_eq!(params[1], client_seq);
        assert_eq!(params[2], msg_time);
        assert!(params[1].is_string());
        assert!(params[2].is_string());
    }

    #[tokio::test]
    async fn roaming_wrappers_send_fixed_methods_and_native_parameter_order() {
        let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = Arc::clone(&calls);
        let app = Router::new().route(
            "/rpc",
            post(move |Json(request): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    captured.lock().await.push(request);
                    Json(json!({"ok": true, "result": {"result": 0}}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test bridge server");
        });
        let client =
            NapCatBridgeClient::new(&format!("http://{address}"), 1_000).expect("bridge client");
        let peer = private_peer();

        client
            .query_roam_calendar(&peer, 1_704_067_200)
            .await
            .expect("calendar call");
        client
            .query_first_roam_msg(&peer, 1_704_067_201)
            .await
            .expect("first call");
        client
            .get_msg_by_client_seq_and_time(&peer, "9007199254740993", "1704067202")
            .await
            .expect("exact call");
        client
            .get_roaming_latest_messages(&peer, 10)
            .await
            .expect("latest call");
        client
            .get_roaming_single_msg(&peer, 13_774)
            .await
            .expect("single sequence call");

        server.abort();
        let calls = calls.lock().await;
        assert_eq!(calls.len(), 5);
        assert_eq!(calls[0]["method"], "MsgService.queryRoamCalendar");
        assert_eq!(
            calls[0]["params"],
            roam_calendar_params(&peer, 1_704_067_200)
        );
        assert_eq!(calls[1]["method"], "MsgService.queryFirstRoamMsg");
        assert_eq!(
            calls[1]["params"],
            first_roam_msg_params(&peer, 1_704_067_201)
        );
        assert_eq!(calls[2]["method"], "MsgService.getMsgByClientSeqAndTime");
        assert_eq!(
            calls[2]["params"],
            msg_by_client_seq_and_time_params(&peer, "9007199254740993", "1704067202")
        );
        assert_eq!(calls[3]["method"], "MsgService.getAioFirstViewLatestMsgs");
        assert_eq!(calls[3]["params"], latest_messages_params(&peer, 10));
        assert_eq!(calls[4]["method"], "MsgService.getSingleMsg");
        assert_eq!(calls[4]["params"], single_message_params(&peer, 13_774));
    }

    #[tokio::test]
    async fn roaming_latest_and_single_wrappers_do_not_fall_back_on_method_error() {
        let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = Arc::clone(&calls);
        let app = Router::new().route(
            "/rpc",
            post(move |Json(request): Json<Value>| {
                let captured = Arc::clone(&captured);
                async move {
                    captured.lock().await.push(request);
                    Json(json!({"ok": false, "error": "method not found"}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test bridge server");
        });
        let client =
            NapCatBridgeClient::new(&format!("http://{address}"), 1_000).expect("bridge client");

        let latest_error = client
            .get_roaming_latest_messages(&private_peer(), 10)
            .await
            .expect_err("fixed latest method must not fall back");
        let single_error = client
            .get_roaming_single_msg(&private_peer(), 321)
            .await
            .expect_err("fixed single method must not fall back");

        server.abort();
        let calls = calls.lock().await;
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["method"], "MsgService.getAioFirstViewLatestMsgs");
        assert_eq!(calls[1]["method"], "MsgService.getSingleMsg");
        assert!(matches!(latest_error, super::BridgeError::Rpc(_)));
        assert!(matches!(single_error, super::BridgeError::Rpc(_)));
    }
}
