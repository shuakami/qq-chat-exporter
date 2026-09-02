use axum::extract::{Extension, Json, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{json, Value};

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::fetcher::{try_history_query_permit, Peer};
use crate::napcat::BridgeError;

const MAX_PEER_UID_LENGTH: usize = 256;
const MAX_DECIMAL_CURSOR_LENGTH: usize = 20;
const MAX_UNIX_SECONDS: i64 = 9_999_999_999;

/// `POST /api/messages/roaming/calendar` — 查询私聊漫游月份位图。
pub async fn query_calendar(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    if state.is_standalone() {
        return response::error(&state.standalone_mode_error("查询漫游历史"), &request_id);
    }
    let (peer, msg_time) = match parse_time_request(&body) {
        Ok(request) => request,
        Err(error) => return response::error(&error, &request_id),
    };

    let permit = match roaming_query_permit() {
        Ok(permit) => permit,
        Err(error) => return response::error(&error, &request_id),
    };
    let result = state.napcat.query_roam_calendar(&peer, msg_time).await;
    drop(permit);
    match result {
        Ok(result) => match normalize_calendar_response(&result) {
            Ok(data) => response::success(data, &request_id),
            Err(error) => response::error(&error, &request_id),
        },
        Err(error) => response::error(&bridge_error(error), &request_id),
    }
}

/// `POST /api/messages/roaming/first` — 查询 `msgTime` 所在日期的首条私聊漫游锚点。
pub async fn query_first(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    if state.is_standalone() {
        return response::error(&state.standalone_mode_error("查询漫游历史"), &request_id);
    }
    let (peer, msg_time) = match parse_time_request(&body) {
        Ok(request) => request,
        Err(error) => return response::error(&error, &request_id),
    };

    let permit = match roaming_query_permit() {
        Ok(permit) => permit,
        Err(error) => return response::error(&error, &request_id),
    };
    let result = state.napcat.query_first_roam_msg(&peer, msg_time).await;
    drop(permit);
    match result {
        Ok(result) => match normalize_first_response(&result) {
            Ok(data) => response::success(data, &request_id),
            Err(error) => response::error(&error, &request_id),
        },
        Err(error) => response::error(&bridge_error(error), &request_id),
    }
}

/// `POST /api/messages/roaming/exact` — 按漫游锚点查询对应私聊原始消息。
pub async fn query_exact(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    if state.is_standalone() {
        return response::error(&state.standalone_mode_error("查询漫游历史"), &request_id);
    }
    let (peer, client_seq, msg_time) = match parse_exact_request(&body) {
        Ok(request) => request,
        Err(error) => return response::error(&error, &request_id),
    };

    let permit = match roaming_query_permit() {
        Ok(permit) => permit,
        Err(error) => return response::error(&error, &request_id),
    };
    let result = state
        .napcat
        .get_msg_by_client_seq_and_time(&peer, &client_seq, &msg_time)
        .await;
    drop(permit);
    match result {
        Ok(result) => match normalize_exact_response(&result) {
            Ok(data) => {
                if data.get("count").and_then(Value::as_u64).unwrap_or(0) > 0 {
                    state
                        .invalidate_message_cache_for_peer(1, &peer.peer_uid)
                        .await;
                }
                response::success(data, &request_id)
            }
            Err(error) => response::error(&error, &request_id),
        },
        Err(error) => response::error(&bridge_error(error), &request_id),
    }
}

fn parse_time_request(body: &Value) -> Result<(Peer, i64), ApiError> {
    let peer = parse_private_peer(body)?;
    let msg_time = parse_unix_seconds(body.get("msgTime"))?;
    Ok((peer, msg_time))
}

fn parse_exact_request(body: &Value) -> Result<(Peer, String, String), ApiError> {
    let peer = parse_private_peer(body)?;
    let client_seq = parse_decimal_cursor(body.get("clientSeq"), "clientSeq")?;
    let msg_time = parse_decimal_cursor(body.get("msgTime"), "msgTime")?;
    let seconds = msg_time.parse::<i64>().map_err(|_| invalid_time_error())?;
    if !(1..=MAX_UNIX_SECONDS).contains(&seconds) {
        return Err(invalid_time_error());
    }
    Ok((peer, client_seq, msg_time))
}

pub(super) fn parse_private_peer(body: &Value) -> Result<Peer, ApiError> {
    let peer = body
        .get("peer")
        .and_then(Value::as_object)
        .ok_or_else(|| ApiError::validation("peer 必须是私聊会话对象", "INVALID_ROAMING_PEER"))?;
    let chat_type = loose_i64(peer.get("chatType"));
    let peer_uid = peer
        .get("peerUid")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let guild_id_valid = match peer.get("guildId") {
        None | Some(Value::Null) => true,
        Some(Value::String(value)) => value.is_empty(),
        Some(_) => false,
    };

    if chat_type != Some(1)
        || peer_uid.is_empty()
        || peer_uid.len() > MAX_PEER_UID_LENGTH
        || peer_uid.bytes().all(|byte| byte.is_ascii_digit())
        || peer_uid.chars().any(char::is_whitespace)
        || peer_uid.chars().any(char::is_control)
        || !guild_id_valid
    {
        return Err(ApiError::validation(
            "漫游查询仅支持 chatType=1、空 guildId 的私聊 peerUid；QQ 号请先通过 /api/users/lookup 解析",
            "INVALID_ROAMING_PEER",
        ));
    }

    Ok(Peer {
        chat_type: 1,
        peer_uid: peer_uid.to_string(),
        guild_id: Some(String::new()),
    })
}

fn parse_unix_seconds(value: Option<&Value>) -> Result<i64, ApiError> {
    let seconds = loose_i64(value).ok_or_else(invalid_time_error)?;
    if !(1..=MAX_UNIX_SECONDS).contains(&seconds) {
        return Err(invalid_time_error());
    }
    Ok(seconds)
}

fn parse_decimal_cursor(value: Option<&Value>, field: &str) -> Result<String, ApiError> {
    let value = value.and_then(Value::as_str).unwrap_or_default();
    if value.is_empty()
        || value.len() > MAX_DECIMAL_CURSOR_LENGTH
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.bytes().all(|byte| byte == b'0')
    {
        return Err(ApiError::validation(
            format!("{field} 必须是非零十进制字符串"),
            "INVALID_ROAMING_CURSOR",
        ));
    }
    Ok(value.to_string())
}

fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(number)) => number.parse().ok(),
        _ => None,
    }
}

fn invalid_time_error() -> ApiError {
    ApiError::validation(
        "msgTime 必须是 Unix 秒级整数，不能使用毫秒时间戳",
        "INVALID_ROAMING_TIME",
    )
}

pub(super) fn roaming_query_permit() -> Result<tokio::sync::SemaphorePermit<'static>, ApiError> {
    try_history_query_permit().map_err(|_| {
        ApiError::new(
            ErrorType::Api,
            "另一个历史消息查询正在进行，请稍后重试",
            "HISTORY_QUERY_BUSY",
        )
        .with_status(StatusCode::TOO_MANY_REQUESTS)
    })
}

pub(super) fn bridge_error(error: BridgeError) -> ApiError {
    let message = error.to_string();
    if matches!(
        &error,
        BridgeError::Rpc(detail) if detail.to_ascii_lowercase().contains("method not found")
    ) {
        return ApiError::new(
            ErrorType::Api,
            "当前 QQ/NapCat 版本不支持该漫游查询接口",
            "ROAMING_API_UNAVAILABLE",
        )
        .with_status(StatusCode::NOT_IMPLEMENTED);
    }
    ApiError::new(ErrorType::Api, message, "ROAMING_QUERY_FAILED")
        .with_status(StatusCode::BAD_GATEWAY)
}

fn invalid_response_error(field: &str) -> ApiError {
    ApiError::new(
        ErrorType::Api,
        format!("漫游接口返回结构异常：缺少有效的 {field}"),
        "INVALID_ROAMING_RESPONSE",
    )
    .with_status(StatusCode::BAD_GATEWAY)
}

pub(super) fn normalize_calendar_response(result: &Value) -> Result<Value, ApiError> {
    let payload = native_payload(result);
    let result_code = native_result_code(payload)?;
    let calendar = native_array(payload, "calendar", &result_code)?;
    Ok(json!({
        "resultCode": result_code,
        "errorMessage": native_error_message(payload),
        "calendar": calendar,
        "calendarAdvisory": true,
        "serverCompletenessProven": false,
    }))
}

pub(super) fn normalize_first_response(result: &Value) -> Result<Value, ApiError> {
    let payload = native_payload(result);
    let result_code = native_result_code(payload)?;
    let anchor_value = payload
        .get("roamDatemsg")
        .or_else(|| payload.get("roamDateMsg"));
    if anchor_value.is_none() && native_result_succeeded(&result_code) {
        return Err(invalid_response_error("roamDatemsg"));
    }
    let anchor = normalize_anchor(anchor_value, &result_code)?;
    Ok(json!({
        "resultCode": result_code,
        "errorMessage": native_error_message(payload),
        "found": !anchor.is_null(),
        "anchor": anchor,
        "serverCompletenessProven": false,
    }))
}

pub(super) fn normalize_exact_response(result: &Value) -> Result<Value, ApiError> {
    let payload = native_payload(result);
    let result_code = native_result_code(payload)?;
    let messages = native_array(payload, "msgList", &result_code)?;
    Ok(json!({
        "resultCode": result_code,
        "errorMessage": native_error_message(payload),
        "count": messages.len(),
        "messages": messages,
        "serverCompletenessProven": false,
    }))
}

fn native_payload(result: &Value) -> &Value {
    result
        .get("msgsRsp")
        .filter(|value| value.is_object())
        .or_else(|| result.get("result").filter(|value| value.is_object()))
        .unwrap_or(result)
}

fn native_result_code(payload: &Value) -> Result<Value, ApiError> {
    let result = payload
        .get("resultCode")
        .or_else(|| payload.get("result"))
        .filter(|value| match value {
            Value::Number(number) => number.as_i64().is_some(),
            Value::String(number) => number.parse::<i64>().is_ok(),
            _ => false,
        })
        .cloned()
        .ok_or_else(|| invalid_response_error("result/resultCode"))?;
    Ok(result)
}

fn native_array(payload: &Value, field: &str, result_code: &Value) -> Result<Vec<Value>, ApiError> {
    match payload.get(field) {
        Some(Value::Array(values)) => Ok(values.clone()),
        None | Some(Value::Null) if !native_result_succeeded(result_code) => Ok(Vec::new()),
        _ => Err(invalid_response_error(field)),
    }
}

fn native_result_succeeded(result_code: &Value) -> bool {
    match result_code {
        Value::Number(value) => value.as_i64() == Some(0),
        Value::String(value) => value == "0",
        _ => false,
    }
}

fn native_error_message(payload: &Value) -> String {
    payload
        .get("errorMessage")
        .or_else(|| payload.get("errMsg"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn normalize_anchor(value: Option<&Value>, result_code: &Value) -> Result<Value, ApiError> {
    let Some(value) = value else {
        return Ok(Value::Null);
    };
    if value.is_null() {
        return Ok(Value::Null);
    }
    let Some(anchor) = value.as_object() else {
        return Err(invalid_response_error("roamDatemsg"));
    };
    if anchor.is_empty() {
        return Ok(Value::Null);
    }
    let msg_seq_field = anchor.get("msgSeq");
    let msg_seq = signed_decimal_value(msg_seq_field);
    if msg_seq_field.is_some_and(|value| !value.is_null()) && msg_seq.is_none() {
        return Err(invalid_response_error("roamDatemsg.msgSeq"));
    }
    let Some(client_seq) = signed_decimal_value(anchor.get("clientSeq")) else {
        return Err(invalid_response_error("roamDatemsg.clientSeq"));
    };
    let Some(msg_time) = signed_decimal_value(anchor.get("msgTime")) else {
        return Err(invalid_response_error("roamDatemsg.msgTime"));
    };

    // 部分已观察到的原生响应会用三个 -1 表示目标日期没有漫游锚点。只接受
    // 这个完整哨兵，避免把单边负数、混合正负或其他未知负值吞成空结果。
    if msg_seq.as_deref() == Some("-1") && client_seq == "-1" && msg_time == "-1" {
        if native_result_succeeded(result_code) {
            return Ok(Value::Null);
        }
        return Err(ApiError::new(
            ErrorType::Api,
            format!("漫游 first 返回 QQ 业务码: {result_code}"),
            "ROAMING_QUERY_FAILED",
        )
        .with_status(StatusCode::BAD_GATEWAY));
    }
    if msg_seq.as_deref().is_some_and(is_negative_decimal)
        || is_negative_decimal(&client_seq)
        || is_negative_decimal(&msg_time)
    {
        return Err(invalid_response_error(
            "roamDatemsg.msgSeq/clientSeq/msgTime sentinel",
        ));
    }

    match (is_zero_decimal(&client_seq), is_zero_decimal(&msg_time)) {
        // 保留既有双零哨兵契约；部分 QQ 版本会附带一个未定义的 msgSeq。
        (true, true) => return Ok(Value::Null),
        (true, false) | (false, true) => {
            return Err(invalid_response_error(
                "roamDatemsg.clientSeq/msgTime sentinel",
            ));
        }
        (false, false) => {}
    }
    if msg_seq.as_deref().is_some_and(is_zero_decimal) {
        return Err(invalid_response_error("roamDatemsg.msgSeq"));
    }

    Ok(json!({
        "msgSeq": msg_seq,
        "clientSeq": client_seq,
        "msgTime": msg_time,
    }))
}

fn signed_decimal_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(value))
            if !value.is_empty()
                && (value.bytes().all(|byte| byte.is_ascii_digit())
                    || value.strip_prefix('-').is_some_and(|digits| {
                        !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
                    })) =>
        {
            Some(value.clone())
        }
        Some(Value::Number(value)) => value
            .as_i64()
            .map(|value| value.to_string())
            .or_else(|| value.as_u64().map(|value| value.to_string())),
        _ => None,
    }
}

fn is_zero_decimal(value: &str) -> bool {
    value.bytes().all(|byte| byte == b'0')
}

fn is_negative_decimal(value: &str) -> bool {
    value.starts_with('-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer() -> Value {
        json!({
            "peer": {"chatType": 1, "peerUid": "u_example", "guildId": ""}
        })
    }

    #[test]
    fn accepts_private_peer_without_requiring_uid_prefix() {
        let mut body = peer();
        body["peer"]["peerUid"] = json!("future-compatible-id");
        let parsed = parse_private_peer(&body).expect("private peer");
        assert_eq!(parsed.chat_type, 1);
        assert_eq!(parsed.peer_uid, "future-compatible-id");
        assert_eq!(parsed.guild_id.as_deref(), Some(""));
    }

    #[test]
    fn rejects_non_private_or_malformed_peers() {
        let mut group = peer();
        group["peer"]["chatType"] = json!(2);
        assert_eq!(
            parse_private_peer(&group)
                .expect_err("group must fail")
                .code,
            "INVALID_ROAMING_PEER"
        );

        for uid in ["", "white space", "line\nbreak"] {
            let mut body = peer();
            body["peer"]["peerUid"] = json!(uid);
            assert!(parse_private_peer(&body).is_err(), "uid={uid:?}");
        }

        let mut uin = peer();
        uin["peer"]["peerUid"] = json!("0000000000");
        assert!(parse_private_peer(&uin).is_err());

        let mut guild = peer();
        guild["peer"]["guildId"] = json!("not-private");
        assert!(parse_private_peer(&guild).is_err());

        let mut oversized = peer();
        oversized["peer"]["peerUid"] = json!("x".repeat(MAX_PEER_UID_LENGTH + 1));
        assert!(parse_private_peer(&oversized).is_err());
    }

    #[test]
    fn validates_second_timestamps_and_rejects_milliseconds() {
        assert_eq!(
            parse_unix_seconds(Some(&json!(1_672_502_400))).expect("number seconds"),
            1_672_502_400
        );
        assert_eq!(
            parse_unix_seconds(Some(&json!("1672502400"))).expect("string seconds"),
            1_672_502_400
        );
        for value in [
            json!(-1),
            json!(0),
            json!(1_672_502_400_000_i64),
            json!(1.5),
        ] {
            assert_eq!(
                parse_unix_seconds(Some(&value))
                    .expect_err("invalid time")
                    .code,
                "INVALID_ROAMING_TIME"
            );
        }
    }

    #[test]
    fn exact_cursor_requires_nonzero_decimal_strings() {
        assert_eq!(
            parse_decimal_cursor(Some(&json!("35566")), "clientSeq").expect("decimal cursor"),
            "35566"
        );
        for value in [
            json!(35566),
            json!(""),
            json!("0"),
            json!("-1"),
            json!("1.5"),
        ] {
            assert_eq!(
                parse_decimal_cursor(Some(&value), "clientSeq")
                    .expect_err("invalid cursor")
                    .code,
                "INVALID_ROAMING_CURSOR"
            );
        }
    }

    #[test]
    fn normalizes_calendar_and_anchor_response_shapes() {
        let calendar = normalize_calendar_response(&json!({
            "result": 0,
            "errMsg": "success",
            "calendar": [5, 0]
        }))
        .expect("calendar response");
        assert_eq!(calendar["resultCode"], 0);
        assert_eq!(calendar["errorMessage"], "success");
        assert_eq!(calendar["calendar"], json!([5, 0]));
        assert_eq!(calendar["calendarAdvisory"], true);
        assert_eq!(calendar["serverCompletenessProven"], false);
        assert_eq!(
            normalize_calendar_response(&json!({
                "result": {"resultCode": "0", "calendar": []}
            }))
            .expect("result-wrapped calendar")["calendar"],
            json!([])
        );

        assert_eq!(
            normalize_first_response(&json!({
                "result": "0",
                "roamDatemsg": {
                    "msgSeq": 13774,
                    "clientSeq": "35566",
                    "msgTime": 1_719_713_392
                }
            }))
            .expect("first response"),
            json!({
                "resultCode": "0",
                "errorMessage": "",
                "found": true,
                "serverCompletenessProven": false,
                "anchor": {
                    "msgSeq": "13774",
                    "clientSeq": "35566",
                    "msgTime": "1719713392"
                }
            })
        );
        let recoverable = normalize_first_response(&json!({
            "result": 0,
            "roamDatemsg": {"clientSeq": "35566", "msgTime": "1719713392"}
        }))
        .expect("exact response can recover a missing msgSeq");
        assert_eq!(recoverable["found"], true);
        assert_eq!(recoverable["anchor"]["msgSeq"], Value::Null);
        let empty = normalize_first_response(&json!({"result": 0, "roamDatemsg": {}}))
            .expect("empty anchor");
        assert_eq!(empty["anchor"], Value::Null);
        assert_eq!(empty["found"], false);

        assert_eq!(
            normalize_first_response(&json!({
                "result": 0,
                "roamDatemsg": {"clientSeq": "0", "msgTime": "0"}
            }))
            .expect("sentinel anchor")["anchor"],
            Value::Null
        );
        assert_eq!(
            normalize_first_response(&json!({"result": 0, "roamDatemsg": null}))
                .expect("null anchor")["anchor"],
            Value::Null
        );

        for sentinel in [
            json!({"msgSeq": -1, "clientSeq": -1, "msgTime": -1}),
            json!({"msgSeq": "-1", "clientSeq": "-1", "msgTime": "-1"}),
        ] {
            let empty = normalize_first_response(&json!({
                "result": 0,
                "roamDatemsg": sentinel
            }))
            .expect("negative empty sentinel");
            assert_eq!(empty["anchor"], Value::Null);
            assert_eq!(empty["found"], false);
        }
    }

    #[test]
    fn keeps_messages_when_native_result_is_nonzero() {
        let response = normalize_exact_response(&json!({
            "msgsRsp": {
                "result": 2_004_000,
                "errMsg": "no more",
                "msgList": [{"msgId": "9007199254740993"}]
            }
        }))
        .expect("nonzero response with messages");
        assert_eq!(response["resultCode"], 2_004_000);
        assert_eq!(response["count"], 1);
        assert_eq!(response["messages"][0]["msgId"], "9007199254740993");
        assert_eq!(response["serverCompletenessProven"], false);
    }

    #[test]
    fn rejects_success_responses_with_missing_payload_fields() {
        assert_eq!(
            normalize_calendar_response(&json!({"result": 0}))
                .expect_err("calendar is required")
                .code,
            "INVALID_ROAMING_RESPONSE"
        );
        assert_eq!(
            normalize_exact_response(&json!({"result": "not-a-code"}))
                .expect_err("result code must be numeric")
                .code,
            "INVALID_ROAMING_RESPONSE"
        );
        assert_eq!(
            normalize_exact_response(&json!({"result": 0}))
                .expect_err("msgList is required")
                .code,
            "INVALID_ROAMING_RESPONSE"
        );
        assert_eq!(
            normalize_first_response(&json!({"result": 0}))
                .expect_err("successful first response requires an anchor field")
                .code,
            "INVALID_ROAMING_RESPONSE"
        );
        assert_eq!(
            normalize_first_response(&json!({
                "result": 0,
                "roamDatemsg": {"clientSeq": "bad", "msgTime": "1"}
            }))
            .expect_err("malformed anchor")
            .code,
            "INVALID_ROAMING_RESPONSE"
        );
        for anchor in [
            json!({"clientSeq": "0", "msgTime": "1"}),
            json!({"clientSeq": "1", "msgTime": "0"}),
            json!({"msgSeq": "-1", "clientSeq": "0", "msgTime": "0"}),
            json!({"clientSeq": "1"}),
            json!({"msgTime": "1"}),
            json!({"clientSeq": "-1", "msgTime": "-1"}),
            json!({"msgSeq": "-1", "clientSeq": "-1", "msgTime": "1"}),
            json!({"msgSeq": "1", "clientSeq": "-1", "msgTime": "-1"}),
            json!({"msgSeq": "-2", "clientSeq": "-2", "msgTime": "-2"}),
            json!({"msgSeq": "0", "clientSeq": "1", "msgTime": "1"}),
            json!({"msgSeq": "invalid", "clientSeq": "1", "msgTime": "1"}),
        ] {
            assert_eq!(
                normalize_first_response(&json!({"result": 0, "roamDatemsg": anchor}))
                    .expect_err("partial anchor or sentinel must fail")
                    .code,
                "INVALID_ROAMING_RESPONSE"
            );
        }

        assert_eq!(
            normalize_first_response(&json!({
                "result": 2_004_000,
                "roamDatemsg": {"msgSeq": -1, "clientSeq": -1, "msgTime": -1}
            }))
            .expect_err("negative sentinel is only defined for result=0")
            .code,
            "ROAMING_QUERY_FAILED"
        );
    }

    #[test]
    fn maps_unsupported_native_method_separately() {
        let error = bridge_error(BridgeError::Rpc(
            "NapCatCore method not found: MsgService.queryRoamCalendar".to_string(),
        ));
        assert_eq!(error.status, StatusCode::NOT_IMPLEMENTED);
        assert_eq!(error.code, "ROAMING_API_UNAVAILABLE");
    }
}
