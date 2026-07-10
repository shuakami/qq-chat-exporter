use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use qce_exporter::types::{CleanMessage, MessageContent, MessageElement, MessageResource, Mention, Sender};
use serde_json::{json, Map, Value};

use super::multi_forward_xml::parse_multi_forward_xml;

/// 嵌套合并转发递归深度上限。三层基本足够，再深就不展开避免栈/性能爆炸。
const MAX_FORWARD_DEPTH: u32 = 3;

/// 合并转发子消息拉取器：由 bridge 侧实现（`MsgApi.getMultiMsg`）。
///
/// 任何错误都应在实现内部吞掉并返回 `None`，解析器绝不因拉取失败而中断。
#[async_trait]
pub trait ForwardFetcher: Send + Sync {
    /// 拉取合并转发卡片内层消息列表（RawMessage JSON 数组）。
    async fn get_multi_msg(
        &self,
        chat_type: i64,
        peer_uid: &str,
        root_msg_id: &str,
        res_id: &str,
    ) -> Option<Vec<Value>>;
}

/// 发件人群头衔解析器（issue #331）。
pub type SenderTitleResolver = Arc<dyn Fn(Option<&str>, Option<&str>) -> Option<String> + Send + Sync>;

/// 解析器配置。
#[derive(Default)]
pub struct SimpleParserOptions {
    /// 是否生成 HTML 片段（`html: 'full' | 'none'`）。
    pub html_enabled: bool,
    /// 群聊里是否优先使用群名片。
    pub prefer_group_member_name: bool,
    /// 可选的发件人群头衔解析器。
    pub sender_title_resolver: Option<SenderTitleResolver>,
    /// 可选的合并转发子消息拉取器。
    pub forward_fetcher: Option<Arc<dyn ForwardFetcher>>,
}

impl SimpleParserOptions {
    /// 与 TS `DEFAULT_SIMPLE_OPTIONS` 对齐的默认值（html=full、preferGroupMemberName=true）。
    #[must_use]
    pub fn standard() -> Self {
        Self {
            html_enabled: true,
            prefer_group_member_name: true,
            sender_title_resolver: None,
            forward_fetcher: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct CachedSenderInfo {
    group_card: Option<String>,
    remark: Option<String>,
    nickname: Option<String>,
}

struct SenderDisplayInfo {
    name: String,
    nickname: Option<String>,
    group_card: Option<String>,
    remark: Option<String>,
}

/// 简化消息解析器。
pub struct SimpleMessageParser {
    options: SimpleParserOptions,
    message_map: HashMap<String, Value>,
    sender_info_cache: HashMap<String, CachedSenderInfo>,
    face_map: HashMap<String, String>,
}

/* ------------------------------ Value 访问工具 ------------------------------ */

fn v_get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(key))
}

fn v_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v_get(v, key).and_then(Value::as_str)
}

fn v_i64(v: &Value, key: &str) -> Option<i64> {
    match v_get(v, key)? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}

/// 与 TS `String(value)` + trim 对齐：数字也转字符串。
fn trimmed_field(v: &Value, key: &str) -> Option<String> {
    let raw = v_get(v, key)?;
    let text = match raw {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => return None,
    };
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn trimmed_opt(value: Option<&str>) -> Option<String> {
    let t = value?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// RFC3339（UTC，毫秒精度）格式化，与 TS `rfc3339FromMillis` 输出对齐。
#[must_use]
pub fn rfc3339_from_millis(ms: i64) -> String {
    match Utc.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        None => "1970-01-01T00:00:00.000Z".to_string(),
    }
}

/// 秒 → 毫秒，非法输入返回 0，与 TS `millisFromUnixSeconds` 对齐。
fn millis_from_unix_seconds(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_i64().map_or(0, |s| s.saturating_mul(1000)),
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map_or(0, |n| n.saturating_mul(1000)),
        _ => 0,
    }
}

/// HTML 转义（与 TS `escapeHtmlFast` 语义一致）。
#[must_use]
pub fn escape_html_fast(text: &str) -> String {
    if !text.contains(['&', '<', '>', '"', '\'']) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len() + 16);
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

fn parse_size_value(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => {
            // parseInt 语义：截取前导数字
            let trimmed = s.trim();
            let digits: String = trimmed
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '-')
                .collect();
            digits.parse::<i64>().unwrap_or(0)
        }
        _ => 0,
    }
}

impl SimpleMessageParser {
    /// 创建解析器并加载 QQ 表情映射表（编译期内嵌 `face_config.json`）。
    #[must_use]
    pub fn new(options: SimpleParserOptions) -> Self {
        Self {
            options,
            message_map: HashMap::new(),
            sender_info_cache: HashMap::new(),
            face_map: Self::initialize_face_map(),
        }
    }

    fn initialize_face_map() -> HashMap<String, String> {
        static FACE_CONFIG: &str = include_str!("../../assets/face_config.json");
        let mut map = HashMap::new();
        if let Ok(config) = serde_json::from_str::<Value>(FACE_CONFIG) {
            if let Some(faces) = v_get(&config, "sysface").and_then(Value::as_array) {
                for face in faces {
                    if let (Some(id), Some(des)) = (
                        v_get(face, "QSid").map(|v| match v {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        }),
                        v_str(face, "QDes"),
                    ) {
                        map.insert(id, des.to_string());
                    }
                }
            }
        }
        map
    }

    /// 解析消息列表（有序输出）。
    pub async fn parse_messages(&mut self, messages: &[Value]) -> Vec<CleanMessage> {
        self.message_map.clear();
        self.sender_info_cache.clear();
        for msg in messages {
            if let Some(id) = v_str(msg, "msgId") {
                if !id.is_empty() {
                    self.message_map.insert(id.to_string(), msg.clone());
                    self.cache_sender_info(msg);
                    if let Some(records) = v_get(msg, "records").and_then(Value::as_array) {
                        for record in records {
                            if let Some(rid) = v_str(record, "msgId") {
                                if !rid.is_empty() {
                                    self.message_map.insert(rid.to_string(), record.clone());
                                    self.cache_sender_info(record);
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut out = Vec::with_capacity(messages.len());
        for message in messages {
            out.push(self.parse_message(message).await);
        }

        self.message_map.clear();
        self.sender_info_cache.clear();
        out
    }

    /// 解析单条消息（公开）。
    pub async fn parse_single_message(&mut self, message: &Value) -> CleanMessage {
        self.parse_message(message).await
    }

    fn cache_sender_info(&mut self, message: &Value) {
        let group_card = trimmed_field(message, "sendMemberName");
        let remark = trimmed_field(message, "sendRemarkName");
        let nickname = trimmed_field(message, "sendNickName");
        if group_card.is_none() && remark.is_none() && nickname.is_none() {
            return;
        }
        let mut keys: Vec<String> = Vec::with_capacity(2);
        if let Some(uid) = trimmed_field(message, "senderUid") {
            keys.push(uid);
        }
        if let Some(uin) = trimmed_field(message, "senderUin") {
            keys.push(uin);
        }
        for key in keys {
            let existing = self.sender_info_cache.entry(key).or_default();
            if existing.group_card.is_none() {
                existing.group_card = group_card.clone();
            }
            if existing.remark.is_none() {
                existing.remark = remark.clone();
            }
            if existing.nickname.is_none() {
                existing.nickname = nickname.clone();
            }
        }
    }

    fn lookup_cached_sender_info(
        &self,
        sender_uid: Option<&str>,
        sender_uin: Option<&str>,
    ) -> Option<&CachedSenderInfo> {
        if let Some(uid) = trimmed_opt(sender_uid) {
            if let Some(hit) = self.sender_info_cache.get(&uid) {
                return Some(hit);
            }
        }
        if let Some(uin) = trimmed_opt(sender_uin) {
            if let Some(hit) = self.sender_info_cache.get(&uin) {
                return Some(hit);
            }
        }
        None
    }

    async fn parse_message(&mut self, message: &Value) -> CleanMessage {
        let ts_ms = millis_from_unix_seconds(v_get(message, "msgTime"));
        let timestamp = if ts_ms > 0 {
            ts_ms
        } else {
            Utc::now().timestamp_millis()
        };
        let sender_info = self.get_sender_display_info(message);
        let content = self.parse_message_content(message, 0).await;
        let msg_type = v_i64(message, "msgType").unwrap_or(0);

        CleanMessage {
            id: v_str(message, "msgId").unwrap_or_default().to_string(),
            seq: v_str(message, "msgSeq").unwrap_or_default().to_string(),
            timestamp,
            time: rfc3339_from_millis(timestamp),
            sender: Sender {
                uid: v_str(message, "senderUid")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("未知")
                    .to_string(),
                uin: v_str(message, "senderUin").map(str::to_string),
                name: sender_info.name,
                nickname: sender_info.nickname,
                group_card: sender_info.group_card,
                remark: sender_info.remark,
                title: self.resolve_sender_title(message),
                avatar_base64: None,
            },
            message_type: Self::get_message_type_string(msg_type),
            content,
            recalled: v_get(message, "recallTime")
                .and_then(Value::as_str)
                .is_none_or(|t| t != "0"),
            system: msg_type == 5,
            raw_message: None,
        }
    }

    fn resolve_sender_title(&self, message: &Value) -> Option<String> {
        let resolver = self.options.sender_title_resolver.as_ref()?;
        if v_i64(message, "chatType") != Some(2) {
            return None;
        }
        let title = resolver(v_str(message, "senderUid"), v_str(message, "senderUin"));
        trimmed_opt(title.as_deref())
    }

    fn get_message_type_string(type_num: i64) -> String {
        match type_num {
            1 | 2 => "text".to_string(),
            3 => "file".to_string(),
            4 | 7 => "video".to_string(),
            5 => "system".to_string(),
            6 => "audio".to_string(),
            8 => "forward".to_string(),
            9 => "reply".to_string(),
            11 => "json".to_string(),
            other => format!("type_{other}"),
        }
    }

    /// 单趟解析消息内容。
    async fn parse_message_content(&mut self, message: &Value, forward_depth: u32) -> MessageContent {
        let empty = Vec::new();
        let elements = v_get(message, "elements")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .clone();

        let mut parsed_elements: Vec<MessageElement> = Vec::with_capacity(elements.len());
        let mut resources: Vec<MessageResource> = Vec::new();
        let mut mentions: Vec<Mention> = Vec::new();
        let mut text_b = String::new();
        let mut html_b = String::new();
        let html_enabled = self.options.html_enabled;

        for element in &elements {
            let Some(parsed) = self.parse_element(element, message, forward_depth).await else {
                continue;
            };

            if let Some(resource) = Self::extract_resource(&parsed) {
                resources.push(resource);
            }

            if parsed.element_type == "at" {
                let uid = v_str(&parsed.data, "uid").unwrap_or("unknown");
                mentions.push(Mention {
                    uid: uid.to_string(),
                    name: Some(
                        v_str(&parsed.data, "name")
                            .filter(|s| !s.is_empty())
                            .unwrap_or("某人")
                            .to_string(),
                    ),
                    mention_type: if uid == "all" { "all" } else { "user" }.to_string(),
                });
            }

            let (text, html) = self.element_to_text(&parsed, html_enabled);
            text_b.push_str(&text);
            if html_enabled {
                html_b.push_str(&html);
            }
            parsed_elements.push(parsed);
        }

        MessageContent {
            text: text_b.trim().to_string(),
            html: if html_enabled {
                Some(html_b.trim().to_string())
            } else {
                Some(String::new())
            },
            elements: parsed_elements,
            resources,
            mentions,
        }
    }

    /// 元素解析。`forward_depth` 用于跟踪当前消息嵌套在多少层合并转发里。
    async fn parse_element(
        &mut self,
        element: &Value,
        message: &Value,
        forward_depth: u32,
    ) -> Option<MessageElement> {
        // 文本 / @ 提及
        if let Some(te) = v_get(element, "textElement").filter(|v| !v.is_null()) {
            let at_type = v_i64(te, "atType").unwrap_or(0);
            if at_type == 1 {
                return Some(MessageElement {
                    element_type: "at".to_string(),
                    data: json!({ "uid": "all", "uin": "0", "name": "全体成员", "atType": 1 }),
                });
            }
            if at_type == 2 {
                let at_nt_uid = v_str(te, "atNtUid").filter(|s| !s.is_empty());
                let at_uid = v_str(te, "atUid").filter(|s| !s.is_empty());
                let name = v_str(te, "content")
                    .unwrap_or("")
                    .trim_start_matches('@')
                    .to_string();
                return Some(MessageElement {
                    element_type: "at".to_string(),
                    data: json!({
                        "uid": at_nt_uid.or(at_uid).unwrap_or("unknown"),
                        "uin": at_uid.unwrap_or("0"),
                        "name": name,
                        "atType": 2
                    }),
                });
            }
            return Some(MessageElement {
                element_type: "text".to_string(),
                data: json!({ "text": v_str(te, "content").unwrap_or("") }),
            });
        }

        // 表情
        if let Some(fe) = v_get(element, "faceElement").filter(|v| !v.is_null()) {
            let face_id = v_get(fe, "faceIndex").map_or(String::new(), |v| match v {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            });
            let face_name = v_str(fe, "faceText")
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| self.face_map.get(&face_id).cloned())
                .unwrap_or_else(|| format!("表情{face_id}"));
            return Some(MessageElement {
                element_type: "face".to_string(),
                data: json!({ "id": face_id, "name": face_name }),
            });
        }

        // 商城表情
        if let Some(mfe) = v_get(element, "marketFaceElement").filter(|v| !v.is_null()) {
            let emoji_id = v_str(mfe, "emojiId").unwrap_or("");
            let url = if emoji_id.is_empty() {
                String::new()
            } else {
                Self::generate_market_face_url(emoji_id)
            };
            return Some(MessageElement {
                element_type: "market_face".to_string(),
                data: json!({
                    "name": v_str(mfe, "faceName").filter(|s| !s.is_empty()).unwrap_or("商城表情"),
                    "tabName": v_str(mfe, "tabName").unwrap_or(""),
                    "key": v_str(mfe, "key").unwrap_or(""),
                    "emojiId": emoji_id,
                    "emojiPackageId": v_get(mfe, "emojiPackageId").cloned().unwrap_or(Value::Null),
                    "url": url
                }),
            });
        }

        // 图片
        if let Some(pe) = v_get(element, "picElement").filter(|v| !v.is_null()) {
            // issue #510: picSubType 0=普通图片，1=自定义表情包；缺失时不猜测、省略字段。
            let sub_type = v_get(pe, "picSubType").and_then(Value::as_i64).map(|v| {
                if v == 1 {
                    "sticker"
                } else {
                    "photo"
                }
            });
            let mut data = json!({
                "filename": v_str(pe, "fileName").filter(|s| !s.is_empty()).unwrap_or("图片"),
                "size": parse_size_value(v_get(pe, "fileSize")),
                "width": v_get(pe, "picWidth").cloned().unwrap_or(Value::Null),
                "height": v_get(pe, "picHeight").cloned().unwrap_or(Value::Null),
                "md5": v_get(pe, "md5HexStr").cloned().unwrap_or(Value::Null),
                "url": v_str(pe, "originImageUrl").unwrap_or("")
            });
            if let (Some(st), Some(obj)) = (sub_type, data.as_object_mut()) {
                obj.insert("subType".to_string(), json!(st));
            }
            return Some(MessageElement {
                element_type: "image".to_string(),
                data,
            });
        }

        // 文件
        if let Some(fe) = v_get(element, "fileElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "file".to_string(),
                data: json!({
                    "filename": v_str(fe, "fileName").filter(|s| !s.is_empty()).unwrap_or("文件"),
                    "size": parse_size_value(v_get(fe, "fileSize")),
                    "md5": v_get(fe, "fileMd5").cloned().unwrap_or(Value::Null)
                }),
            });
        }

        // 视频
        if let Some(ve) = v_get(element, "videoElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "video".to_string(),
                data: json!({
                    "filename": v_str(ve, "fileName").filter(|s| !s.is_empty()).unwrap_or("视频"),
                    "size": parse_size_value(v_get(ve, "fileSize")),
                    "duration": v_get(ve, "duration").cloned().unwrap_or(json!(0)),
                    "thumbSize": parse_size_value(v_get(ve, "thumbSize"))
                }),
            });
        }

        // 语音
        if let Some(pe) = v_get(element, "pttElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "audio".to_string(),
                data: json!({
                    "filename": v_str(pe, "fileName").filter(|s| !s.is_empty()).unwrap_or("语音"),
                    "size": parse_size_value(v_get(pe, "fileSize")),
                    "duration": v_get(pe, "duration").cloned().unwrap_or(json!(0))
                }),
            });
        }

        // 回复
        if let Some(re) = v_get(element, "replyElement").filter(|v| !v.is_null()) {
            let reply_data = self.extract_reply_content(re, message);
            return Some(MessageElement {
                element_type: "reply".to_string(),
                data: reply_data,
            });
        }

        // 转发
        if let Some(mf) = v_get(element, "multiForwardMsgElement").filter(|v| !v.is_null()) {
            let res_id = v_str(mf, "resId").unwrap_or("").to_string();
            let xml_content = v_str(mf, "xmlContent").unwrap_or("").to_string();

            let inner_messages = if forward_depth >= MAX_FORWARD_DEPTH {
                Vec::new()
            } else {
                self.fetch_forward_inner_messages(message, &res_id, forward_depth + 1)
                    .await
            };

            let xml_info = parse_multi_forward_xml(Some(&xml_content));
            let card_title = if xml_info.header.is_empty() {
                "聊天记录".to_string()
            } else {
                xml_info.header.clone()
            };
            let card_summary = if xml_info.summary.is_empty() {
                if inner_messages.is_empty() {
                    "查看转发消息".to_string()
                } else {
                    format!("查看{}条转发消息", inner_messages.len())
                }
            } else {
                xml_info.summary.clone()
            };
            let message_count = if inner_messages.is_empty() {
                xml_info.message_count
            } else {
                inner_messages.len()
            };

            return Some(MessageElement {
                element_type: "forward".to_string(),
                data: json!({
                    "title": card_title,
                    "resId": res_id,
                    "summary": card_summary,
                    "preview": xml_info.preview_lines,
                    "messageCount": message_count,
                    "messages": inner_messages
                }),
            });
        }

        // JSON 卡片
        if let Some(ae) = v_get(element, "arkElement").filter(|v| !v.is_null()) {
            let json_content = v_str(ae, "bytesData").unwrap_or("{}").to_string();
            let parsed_json = Self::parse_json_content(&json_content);
            let title = v_str(&parsed_json, "title");
            let description = v_str(&parsed_json, "description");
            let summary = title
                .or(description)
                .unwrap_or("JSON消息")
                .to_string();
            return Some(MessageElement {
                element_type: "json".to_string(),
                data: json!({
                    "content": json_content,
                    "title": title.unwrap_or("JSON消息"),
                    "description": v_get(&parsed_json, "description").cloned().unwrap_or(Value::Null),
                    "url": v_get(&parsed_json, "url").cloned().unwrap_or(Value::Null),
                    "preview": v_get(&parsed_json, "preview").cloned().unwrap_or(Value::Null),
                    "appName": v_get(&parsed_json, "appName").cloned().unwrap_or(Value::Null),
                    "summary": summary
                }),
            });
        }

        // 位置
        if v_get(element, "shareLocationElement").is_some_and(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "location".to_string(),
                data: json!({ "title": "位置消息", "summary": "分享了位置" }),
            });
        }

        // 小灰条（系统提示）
        if let Some(gt) = v_get(element, "grayTipElement").filter(|v| !v.is_null()) {
            return Some(Self::parse_gray_tip_element(gt));
        }

        // 长消息
        if let Some(sl) = v_get(element, "structLongMsgElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "long_message".to_string(),
                data: json!({
                    "summary": "长消息",
                    "resId": v_str(sl, "resId").unwrap_or(""),
                    "xmlContent": v_str(sl, "xmlContent").unwrap_or("")
                }),
            });
        }

        // 音视频通话记录
        if let Some(av) = v_get(element, "avRecordElement").filter(|v| !v.is_null()) {
            let av_type = v_i64(av, "type").unwrap_or(0);
            let type_text = match av_type {
                1 => "语音通话",
                2 => "视频通话",
                _ => "通话",
            };
            let status_text = v_str(av, "text").filter(|s| !s.is_empty()).unwrap_or("已结束");
            return Some(MessageElement {
                element_type: "av_record".to_string(),
                data: json!({
                    "summary": format!("{type_text} - {status_text}"),
                    "type": av_type,
                    "time": v_str(av, "time").filter(|s| !s.is_empty()).unwrap_or("0"),
                    "text": status_text,
                    "mainType": v_get(av, "mainType").cloned().unwrap_or(Value::Null),
                    "extraType": v_get(av, "extraType").cloned().unwrap_or(Value::Null)
                }),
            });
        }

        // Markdown
        if let Some(md) = v_get(element, "markdownElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "markdown".to_string(),
                data: json!({
                    "content": v_str(md, "content").unwrap_or(""),
                    "summary": "Markdown消息"
                }),
            });
        }

        // Giphy 动图
        if let Some(ge) = v_get(element, "giphyElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "giphy".to_string(),
                data: json!({
                    "id": v_str(ge, "id").unwrap_or(""),
                    "width": v_get(ge, "width").cloned().unwrap_or(json!(0)),
                    "height": v_get(ge, "height").cloned().unwrap_or(json!(0)),
                    "isClip": v_get(ge, "isClip").cloned().unwrap_or(json!(false)),
                    "summary": "Giphy动图"
                }),
            });
        }

        // 内联键盘
        if let Some(ik) = v_get(element, "inlineKeyboardElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "inline_keyboard".to_string(),
                data: json!({
                    "botAppid": v_str(ik, "botAppid").unwrap_or(""),
                    "rows": v_get(ik, "rows").cloned().unwrap_or(json!([])),
                    "summary": "内联键盘"
                }),
            });
        }

        // 日历
        if let Some(cal) = v_get(element, "calendarElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "calendar".to_string(),
                data: json!({
                    "summary": v_str(cal, "summary").filter(|s| !s.is_empty()).unwrap_or("日历"),
                    "msg": v_str(cal, "msg").unwrap_or(""),
                    "expireTimeMs": v_str(cal, "expireTimeMs").filter(|s| !s.is_empty()).unwrap_or("0"),
                    "schemaType": v_get(cal, "schemaType").cloned().unwrap_or(json!(0))
                }),
            });
        }

        // YOLO 游戏结果
        if let Some(yolo) = v_get(element, "yoloGameResultElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "yolo_game_result".to_string(),
                data: json!({
                    "userInfo": v_get(yolo, "UserInfo").cloned().unwrap_or(json!([])),
                    "summary": "YOLO游戏结果"
                }),
            });
        }

        // 表情气泡
        if let Some(fb) = v_get(element, "faceBubbleElement").filter(|v| !v.is_null()) {
            let face_summary = v_str(fb, "faceSummary").unwrap_or("");
            return Some(MessageElement {
                element_type: "face_bubble".to_string(),
                data: json!({
                    "faceCount": v_get(fb, "faceCount").cloned().unwrap_or(json!(0)),
                    "faceSummary": face_summary,
                    "summary": if face_summary.is_empty() { "表情气泡" } else { face_summary }
                }),
            });
        }

        // 豆腐记录
        if let Some(tofu) = v_get(element, "tofuRecordElement").filter(|v| !v.is_null()) {
            let desc = v_str(tofu, "descriptionContent").unwrap_or("");
            return Some(MessageElement {
                element_type: "tofu_record".to_string(),
                data: json!({
                    "type": v_get(tofu, "type").cloned().unwrap_or(json!(0)),
                    "descriptionContent": desc,
                    "summary": if desc.is_empty() { "豆腐记录" } else { desc }
                }),
            });
        }

        // 置顶任务消息
        if let Some(task) = v_get(element, "taskTopMsgElement").filter(|v| !v.is_null()) {
            let title = v_str(task, "msgTitle").unwrap_or("");
            return Some(MessageElement {
                element_type: "task_top_msg".to_string(),
                data: json!({
                    "msgTitle": title,
                    "msgSummary": v_str(task, "msgSummary").unwrap_or(""),
                    "iconUrl": v_str(task, "iconUrl").unwrap_or(""),
                    "summary": if title.is_empty() { "置顶消息" } else { title }
                }),
            });
        }

        // 推荐消息
        if let Some(rec) = v_get(element, "recommendedMsgElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "recommended_msg".to_string(),
                data: json!({
                    "botAppid": v_str(rec, "botAppid").unwrap_or(""),
                    "summary": "推荐消息"
                }),
            });
        }

        // 操作栏
        if let Some(ab) = v_get(element, "actionBarElement").filter(|v| !v.is_null()) {
            return Some(MessageElement {
                element_type: "action_bar".to_string(),
                data: json!({
                    "botAppid": v_str(ab, "botAppid").unwrap_or(""),
                    "rows": v_get(ab, "rows").cloned().unwrap_or(json!([])),
                    "summary": "操作栏"
                }),
            });
        }

        // 未知类型
        let element_type = v_get(element, "elementType").cloned().unwrap_or(Value::Null);
        let summary = Self::get_system_message_summary(&element_type);
        Some(MessageElement {
            element_type: "system".to_string(),
            data: json!({
                "elementType": element_type,
                "summary": summary,
                "text": summary
            }),
        })
    }

    fn extract_resource(element: &MessageElement) -> Option<MessageResource> {
        if !matches!(element.element_type.as_str(), "image" | "file" | "video" | "audio") {
            return None;
        }
        let d = &element.data;
        Some(MessageResource {
            resource_type: element.element_type.clone(),
            filename: Some(
                v_str(d, "filename")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("未知")
                    .to_string(),
            ),
            size: Some(u64::try_from(v_i64(d, "size").unwrap_or(0)).unwrap_or(0)),
            url: v_str(d, "url").map(str::to_string),
            local_path: v_str(d, "localPath").map(str::to_string),
            width: v_i64(d, "width").and_then(|v| u32::try_from(v).ok()),
            height: v_i64(d, "height").and_then(|v| u32::try_from(v).ok()),
            duration: v_get(d, "duration").and_then(Value::as_f64),
        })
    }

    fn element_to_text(&self, element: &MessageElement, html_enabled: bool) -> (String, String) {
        let d = &element.data;
        match element.element_type.as_str() {
            "text" => {
                let t = v_str(d, "text").unwrap_or("").to_string();
                let html = if html_enabled { escape_html_fast(&t) } else { String::new() };
                (t, html)
            }
            "face" => {
                let t = format!(
                    "[表情{}]",
                    v_get(d, "id").map_or(String::new(), |v| match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                );
                let html = if html_enabled { t.clone() } else { String::new() };
                (t, html)
            }
            "market_face" => {
                let t = format!(
                    "[{}]",
                    v_str(d, "name").filter(|s| !s.is_empty()).unwrap_or("表情")
                );
                let html = if html_enabled { t.clone() } else { String::new() };
                (t, html)
            }
            "image" => {
                let filename = v_str(d, "filename").unwrap_or("");
                let t = format!("[图片:{filename}]");
                let html = if html_enabled {
                    format!("<img alt=\"{}\" class=\"image\">", escape_html_fast(filename))
                } else {
                    String::new()
                };
                (t, html)
            }
            "file" => {
                let t = format!("[文件:{}]", v_str(d, "filename").unwrap_or(""));
                let html = if html_enabled {
                    format!("<span class=\"file\">{}</span>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "video" => {
                let t = format!("[视频:{}]", v_str(d, "filename").unwrap_or(""));
                let html = if html_enabled {
                    format!("<span class=\"video\">{}</span>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "audio" => {
                let duration = v_get(d, "duration").map_or(String::from("0"), |v| match v {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::from("0"),
                });
                let t = format!("[语音:{duration}秒]");
                let html = if html_enabled {
                    format!("<span class=\"audio\">{}</span>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "at" => {
                let name = v_str(d, "name").filter(|s| !s.is_empty()).unwrap_or("某人");
                let t = format!("@{name}");
                let uid = v_str(d, "uid").filter(|s| !s.is_empty()).unwrap_or("unknown");
                let html = if html_enabled {
                    if uid == "all" {
                        format!(
                            "<span class=\"mention mention-all\">{}</span>",
                            escape_html_fast(&t)
                        )
                    } else {
                        format!(
                            "<span class=\"mention\" data-uid=\"{uid}\">{}</span>",
                            escape_html_fast(&t)
                        )
                    }
                } else {
                    String::new()
                };
                (t, html)
            }
            "reply" => {
                let t = "[回复消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"reply\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "forward" => self.forward_to_text(d, html_enabled),
            "location" => {
                let t = "[位置消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"location\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "json" => {
                let t = "[JSON消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"json\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "long_message" => {
                let t = "[长消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"long-message\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "av_record" => {
                let t = v_str(d, "summary")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("[通话记录]")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"av-record\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "markdown" => {
                let t = "[Markdown消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"markdown\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "giphy" => {
                let t = "[Giphy动图]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"giphy\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "inline_keyboard" => {
                let t = "[内联键盘]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"inline-keyboard\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "calendar" => {
                let t = v_str(d, "summary")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("[日历]")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"calendar\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "yolo_game_result" => {
                let t = "[YOLO游戏结果]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"yolo-game\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "face_bubble" => {
                let t = v_str(d, "summary")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("[表情气泡]")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"face-bubble\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "tofu_record" => {
                let t = v_str(d, "summary")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("[豆腐记录]")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"tofu-record\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "task_top_msg" => {
                let t = v_str(d, "summary")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("[置顶消息]")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"task-top\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            "recommended_msg" => {
                let t = "[推荐消息]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"recommended\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "action_bar" => {
                let t = "[操作栏]".to_string();
                let html = if html_enabled {
                    format!("<div class=\"action-bar\">{t}</div>")
                } else {
                    String::new()
                };
                (t, html)
            }
            "system" => {
                let t = v_str(d, "text")
                    .filter(|s| !s.is_empty())
                    .or_else(|| v_str(d, "summary").filter(|s| !s.is_empty()))
                    .unwrap_or("系统消息")
                    .to_string();
                let html = if html_enabled {
                    format!("<div class=\"system\">{}</div>", escape_html_fast(&t))
                } else {
                    String::new()
                };
                (t, html)
            }
            _ => {
                let raw_text = v_str(d, "text")
                    .filter(|s| !s.is_empty())
                    .or_else(|| v_str(d, "summary").filter(|s| !s.is_empty()))
                    .or_else(|| v_str(d, "content").filter(|s| !s.is_empty()))
                    .unwrap_or("")
                    .to_string();
                let html = if html_enabled && !raw_text.is_empty() {
                    format!("<span>{}</span>", escape_html_fast(&raw_text))
                } else {
                    String::new()
                };
                (raw_text, html)
            }
        }
    }

    fn forward_to_text(&self, d: &Value, html_enabled: bool) -> (String, String) {
        let empty = Vec::new();
        let inner = v_get(d, "messages")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let count = v_i64(d, "messageCount")
            .unwrap_or_else(|| i64::try_from(inner.len()).unwrap_or(i64::MAX));
        let xml_preview: Vec<&str> = v_get(d, "preview")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let inner_line = |m: &Value| -> (String, String) {
            let name = v_get(m, "sender")
                .and_then(|s| v_str(s, "name"))
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    v_get(m, "sender")
                        .and_then(|s| v_str(s, "uin"))
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                })
                .unwrap_or_default();
            let body_raw = v_get(m, "content")
                .and_then(|c| v_str(c, "text"))
                .unwrap_or("");
            let body = body_raw.split_whitespace().collect::<Vec<_>>().join(" ");
            (name, body)
        };

        let inner_preview_lines: Vec<String> = inner
            .iter()
            .take(3)
            .filter_map(|m| {
                let (name, body) = inner_line(m);
                let trimmed_body: String = if body.chars().count() > 40 {
                    let cut: String = body.chars().take(40).collect();
                    format!("{cut}…")
                } else {
                    body
                };
                if !name.is_empty() && !trimmed_body.is_empty() {
                    Some(format!("{name}: {trimmed_body}"))
                } else if !name.is_empty() {
                    Some(name)
                } else if !trimmed_body.is_empty() {
                    Some(trimmed_body)
                } else {
                    None
                }
            })
            .collect();

        let preview_lines: Vec<String> = if inner_preview_lines.is_empty() {
            xml_preview
                .iter()
                .take(3)
                .map(|l| {
                    if l.chars().count() > 60 {
                        let cut: String = l.chars().take(60).collect();
                        format!("{cut}…")
                    } else {
                        (*l).to_string()
                    }
                })
                .collect()
        } else {
            inner_preview_lines
        };

        let header = if count > 0 {
            format!("[转发消息: {count}条]")
        } else {
            "[转发消息]".to_string()
        };
        let text = if preview_lines.is_empty() {
            header.clone()
        } else {
            let body = preview_lines
                .iter()
                .map(|l| format!("  {l}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{header}\n{body}")
        };

        if !html_enabled {
            return (text, String::new());
        }

        let mut inner_html = String::new();
        if !inner.is_empty() {
            inner_html.push_str("<ul class=\"forward-inner\">");
            for m in inner {
                let (name, body) = inner_line(m);
                let name = if name.is_empty() { "未知".to_string() } else { name };
                inner_html.push_str(&format!(
                    "<li><span class=\"forward-inner-sender\">{}</span><span class=\"forward-inner-text\">{}</span></li>",
                    escape_html_fast(&name),
                    escape_html_fast(&body)
                ));
            }
            inner_html.push_str("</ul>");
        } else if !xml_preview.is_empty() {
            inner_html.push_str("<ul class=\"forward-inner\">");
            for line in xml_preview.iter().take(5) {
                inner_html.push_str(&format!(
                    "<li><span class=\"forward-inner-text\">{}</span></li>",
                    escape_html_fast(line)
                ));
            }
            inner_html.push_str("</ul>");
        }
        let html = format!(
            "<div class=\"forward\">{}{inner_html}</div>",
            escape_html_fast(&header)
        );
        (text, html)
    }

    /// 拉合并转发消息卡片里的子消息列表并扁平化（issue #161）。
    async fn fetch_forward_inner_messages(
        &mut self,
        message: &Value,
        res_id: &str,
        depth: u32,
    ) -> Vec<Value> {
        if depth > MAX_FORWARD_DEPTH {
            return Vec::new();
        }

        let mut raws: Vec<Value> = v_get(message, "records")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if raws.is_empty() {
            if let Some(fetcher) = self.options.forward_fetcher.clone() {
                let chat_type = v_i64(message, "chatType").unwrap_or(0);
                let peer_uid = v_str(message, "peerUid").unwrap_or("").to_string();
                let msg_id = v_str(message, "msgId").unwrap_or("").to_string();
                if let Some(list) = fetcher
                    .get_multi_msg(chat_type, &peer_uid, &msg_id, res_id)
                    .await
                {
                    raws = list;
                }
            }
        }

        if raws.is_empty() {
            return Vec::new();
        }

        let mut out: Vec<Value> = Vec::with_capacity(raws.len());
        for raw in &raws {
            if raw.is_null() {
                continue;
            }
            let ts_ms = millis_from_unix_seconds(v_get(raw, "msgTime"));
            self.cache_sender_info(raw);
            let sender_info = self.get_sender_display_info(raw);

            let mut elements_arr: Vec<Value> = Vec::new();
            let mut text_parts = String::new();
            let els = v_get(raw, "elements")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for el in &els {
                let Some(parsed) = Box::pin(self.parse_element(el, raw, depth)).await else {
                    continue;
                };
                let (text, _) = self.element_to_text(&parsed, false);
                text_parts.push_str(&text);
                elements_arr.push(json!({ "type": parsed.element_type, "data": parsed.data }));
            }

            let mut sender = Map::new();
            if let Some(uid) = v_str(raw, "senderUid").filter(|s| !s.is_empty()) {
                sender.insert("uid".to_string(), json!(uid));
            }
            if let Some(uin) = v_str(raw, "senderUin").filter(|s| !s.is_empty()) {
                sender.insert("uin".to_string(), json!(uin));
            }
            sender.insert("name".to_string(), json!(sender_info.name));

            out.push(json!({
                "id": v_str(raw, "msgId").unwrap_or(""),
                "timestamp": ts_ms,
                "time": rfc3339_from_millis(ts_ms),
                "sender": Value::Object(sender),
                "content": { "text": text_parts, "elements": elements_arr }
            }));
        }
        out
    }

    fn get_sender_display_info(&self, message: &Value) -> SenderDisplayInfo {
        let mut group_card = trimmed_field(message, "sendMemberName");
        let mut remark = trimmed_field(message, "sendRemarkName");
        let mut nickname = trimmed_field(message, "sendNickName");
        let is_group_chat = v_i64(message, "chatType") == Some(2);
        let prefer_group_member_name = is_group_chat && self.options.prefer_group_member_name;

        // #274：当本条消息没有任何可读名字时，回退到同发件人在其他消息上出现过的名字。
        if group_card.is_none() && remark.is_none() && nickname.is_none() {
            if let Some(cached) = self.lookup_cached_sender_info(
                v_str(message, "senderUid"),
                v_str(message, "senderUin"),
            ) {
                group_card = cached.group_card.clone();
                remark = cached.remark.clone();
                nickname = cached.nickname.clone();
            }
        }

        let primary = if is_group_chat {
            if prefer_group_member_name {
                group_card.clone().or_else(|| remark.clone()).or_else(|| nickname.clone())
            } else {
                nickname.clone()
            }
        } else {
            remark.clone().or_else(|| nickname.clone())
        };

        let name = primary
            .or_else(|| trimmed_field(message, "senderUin"))
            .or_else(|| trimmed_field(message, "senderUid"))
            .unwrap_or_else(|| "未知用户".to_string());

        SenderDisplayInfo {
            name,
            nickname,
            group_card,
            remark,
        }
    }

    /// 是否纯媒体消息（无实际文字内容），用于 `filterPureImageMessages`。
    #[must_use]
    pub fn is_pure_media_message(message: &CleanMessage) -> bool {
        let has_media = message.content.elements.iter().any(|e| {
            matches!(
                e.element_type.as_str(),
                "image" | "video" | "audio" | "file" | "face"
            )
        });
        if !has_media {
            return false;
        }
        let actual_text = message.content.text.trim();
        if !actual_text.is_empty() {
            static CQ_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            let cq_re = CQ_RE.get_or_init(|| regex::Regex::new(r"\[CQ:[^\]]+\]").expect("valid regex"));
            let without_cq = cq_re.replace_all(actual_text, "");
            if !without_cq.trim().is_empty() {
                return false;
            }
        }
        true
    }

    /// 资源路径二次回填（issue #30 / #277）：把下载完成的资源相对路径写回
    /// `content.resources[]` 与媒体元素 data。`resources` 为
    /// `{ type, localPath }` 结构的 JSON 数组。
    pub fn update_single_message_resource_paths(message: &mut CleanMessage, resources: &[Value]) {
        let res_arr = &mut message.content.resources;
        let n = res_arr.len().min(resources.len());
        for i in 0..n {
            let info = &resources[i];
            if let Some(local_path) = v_str(info, "localPath").filter(|s| !s.is_empty()) {
                let file_name = std::path::Path::new(local_path)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                let res_type = v_str(info, "type").unwrap_or("file");
                let type_dir = format!("{res_type}s");
                res_arr[i].local_path = Some(format!("{type_dir}/{file_name}"));
                res_arr[i].url = Some(format!("resources/{type_dir}/{file_name}"));
                res_arr[i].resource_type = res_type.to_string();
            }
        }

        // 更新 elements 中的 URL：按类型和顺序匹配。
        let mut resource_index = 0usize;
        for el in &mut message.content.elements {
            if !matches!(el.element_type.as_str(), "image" | "video" | "audio" | "file") {
                continue;
            }
            let matching = resources
                .iter()
                .enumerate()
                .skip(resource_index)
                .find(|(_, r)| v_str(r, "type") == Some(el.element_type.as_str()));
            if let Some((idx, r)) = matching {
                if let Some(local_path) = v_str(r, "localPath").filter(|s| !s.is_empty()) {
                    let file_name = std::path::Path::new(local_path)
                        .file_name()
                        .map(|f| f.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let res_type = v_str(r, "type").unwrap_or("file");
                    let type_dir = format!("{res_type}s");
                    if let Some(obj) = el.data.as_object_mut() {
                        obj.insert("localPath".to_string(), json!(format!("{type_dir}/{file_name}")));
                        obj.insert("url".to_string(), json!(format!("resources/{type_dir}/{file_name}")));
                    }
                    resource_index = idx + 1;
                }
            }
        }
    }

    /// issue #128：所有消息资源路径写完之后，回填 reply 元素里
    /// `previewElements[].localPath`，让 HTML 导出能直接渲染缩略图。
    pub fn backfill_reply_preview_local_paths(messages: &mut [CleanMessage]) {
        if messages.is_empty() {
            return;
        }
        // 第一步：建 msgId → image[] 索引
        let mut images_by_msg_id: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for m in messages.iter() {
            let mut imgs: Vec<(String, String)> = Vec::new();
            for el in &m.content.elements {
                if el.element_type != "image" {
                    continue;
                }
                let Some(local_path) = v_str(&el.data, "localPath").filter(|s| !s.is_empty()) else {
                    continue;
                };
                let md5 = v_str(&el.data, "md5").unwrap_or("").to_string();
                imgs.push((md5, local_path.to_string()));
            }
            if !imgs.is_empty() {
                images_by_msg_id.insert(m.id.clone(), imgs);
            }
        }
        if images_by_msg_id.is_empty() {
            return;
        }
        // 第二步：扫所有 reply 元素，按 referencedMessageId 找回原消息的图片
        for m in messages.iter_mut() {
            for el in &mut m.content.elements {
                if el.element_type != "reply" {
                    continue;
                }
                let ref_id = v_str(&el.data, "referencedMessageId")
                    .unwrap_or("")
                    .to_string();
                if ref_id.is_empty() {
                    continue;
                }
                let Some(ref_imgs) = images_by_msg_id.get(&ref_id) else {
                    continue;
                };
                if ref_imgs.is_empty() {
                    continue;
                }
                let Some(previews) = el
                    .data
                    .as_object_mut()
                    .and_then(|o| o.get_mut("previewElements"))
                    .and_then(Value::as_array_mut)
                else {
                    continue;
                };
                let mut fallback_idx = 0usize;
                for pe in previews.iter_mut() {
                    if v_str(pe, "type") != Some("image") {
                        continue;
                    }
                    let pe_md5 = v_str(pe, "md5").unwrap_or("").to_string();
                    let by_md5 = if pe_md5.is_empty() {
                        None
                    } else {
                        ref_imgs.iter().find(|(md5, _)| !md5.is_empty() && *md5 == pe_md5)
                    };
                    let candidate = by_md5.or_else(|| ref_imgs.get(fallback_idx));
                    if let Some((_, local_path)) = candidate {
                        if let Some(obj) = pe.as_object_mut() {
                            obj.insert("localPath".to_string(), json!(local_path));
                        }
                    }
                    fallback_idx += 1;
                }
            }
        }
    }

    fn parse_json_content(json_string: &str) -> Value {
        let Ok(parsed) = serde_json::from_str::<Value>(json_string) else {
            return json!({});
        };
        let mut result = Map::new();

        let meta_detail = v_get(&parsed, "meta").and_then(|m| v_get(m, "detail_1"));
        let meta_news = v_get(&parsed, "meta").and_then(|m| v_get(m, "news"));

        // TS 侧全部走 truthy 判断，空字符串视为缺失。
        fn truthy(v: Option<&str>) -> Option<&str> {
            v.filter(|s| !s.is_empty())
        }

        // 标题
        if let Some(prompt) = truthy(v_str(&parsed, "prompt")) {
            result.insert("title".to_string(), json!(prompt));
        } else if let Some(title) = truthy(meta_detail.and_then(|d| v_str(d, "title"))) {
            result.insert("title".to_string(), json!(title));
        } else if let Some(title) = truthy(meta_news.and_then(|n| v_str(n, "title"))) {
            result.insert("title".to_string(), json!(title));
        }

        // 描述
        if let Some(desc) = truthy(meta_detail.and_then(|d| v_str(d, "desc"))) {
            result.insert("description".to_string(), json!(desc));
        } else if let Some(desc) = truthy(meta_news.and_then(|n| v_str(n, "desc"))) {
            result.insert("description".to_string(), json!(desc));
        }

        // URL
        if let Some(url) = truthy(meta_detail.and_then(|d| v_str(d, "qqdocurl"))) {
            result.insert("url".to_string(), json!(url));
        } else if let Some(url) = truthy(meta_detail.and_then(|d| v_str(d, "url"))) {
            result.insert("url".to_string(), json!(url));
        } else if let Some(url) = truthy(meta_news.and_then(|n| v_str(n, "jumpUrl"))) {
            result.insert("url".to_string(), json!(url));
        }

        // 预览图
        if let Some(preview) = truthy(meta_detail.and_then(|d| v_str(d, "preview"))) {
            result.insert("preview".to_string(), json!(preview));
        } else if let Some(preview) = truthy(meta_news.and_then(|n| v_str(n, "preview"))) {
            result.insert("preview".to_string(), json!(preview));
        }

        // 应用名称
        let app = truthy(v_str(&parsed, "app"));
        let detail_title = truthy(meta_detail.and_then(|d| v_str(d, "title")));
        if let (Some(title), Some(_)) = (detail_title, app) {
            result.insert("appName".to_string(), json!(title));
        } else if v_str(&parsed, "app") == Some("com.tencent.miniapp_01") {
            result.insert("appName".to_string(), json!("小程序"));
        }

        Value::Object(result)
    }

    fn extract_reply_content(&self, reply_element: &Value, message: &Value) -> Value {
        // 使用 replayMsgId 作为被引用消息的真实ID（但要排除 "0" 的情况）
        let replay_msg_id = v_str(reply_element, "replayMsgId");
        let mut referenced_message_id: Option<String> = replay_msg_id
            .filter(|id| !id.is_empty() && *id != "0")
            .map(str::to_string);

        let source_msg_id = v_str(reply_element, "sourceMsgIdInRecords");
        let mut referenced_message: Option<Value> = None;

        // 1. replayMsgId 从全局消息映射中查找
        if let Some(ref_id) = &referenced_message_id {
            if let Some(hit) = self.message_map.get(ref_id) {
                referenced_message = Some(hit.clone());
            }
        }

        // 2. 从当前消息的 records 数组中查找
        if referenced_message.is_none() {
            if let Some(src_id) = source_msg_id.filter(|id| !id.is_empty() && *id != "0") {
                if let Some(records) = v_get(message, "records").and_then(Value::as_array) {
                    if let Some(hit) = records.iter().find(|r| v_str(r, "msgId") == Some(src_id)) {
                        referenced_message = Some(hit.clone());
                        referenced_message_id = v_str(hit, "msgId").map(str::to_string);
                    }
                }
            }
        }

        // 3. replayMsgSeq 匹配 msgSeq
        if referenced_message.is_none() {
            if let Some(seq) = v_str(reply_element, "replayMsgSeq").filter(|s| !s.is_empty()) {
                if let Some(hit) = self
                    .message_map
                    .values()
                    .find(|m| v_str(m, "msgSeq") == Some(seq))
                {
                    referenced_message = Some(hit.clone());
                    referenced_message_id = v_str(hit, "msgId").map(str::to_string);
                }
            }
        }

        // 4. replyMsgClientSeq 匹配 clientSeq
        if referenced_message.is_none() {
            if let Some(cseq) = v_str(reply_element, "replyMsgClientSeq").filter(|s| !s.is_empty()) {
                if let Some(hit) = self
                    .message_map
                    .values()
                    .find(|m| v_str(m, "clientSeq") == Some(cseq))
                {
                    referenced_message = Some(hit.clone());
                    referenced_message_id = v_str(hit, "msgId").map(str::to_string);
                }
            }
        }

        // #289：被引用消息发件人显示名解析
        let sender_name =
            self.resolve_reply_sender_name(reply_element, message, referenced_message.as_ref());

        let message_id = source_msg_id
            .filter(|s| !s.is_empty())
            .or(replay_msg_id.filter(|s| !s.is_empty()))
            .or_else(|| v_str(reply_element, "replayMsgSeq").filter(|s| !s.is_empty()))
            .unwrap_or("0")
            .to_string();

        let mut sender_uin = v_str(reply_element, "senderUin")
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                referenced_message
                    .as_ref()
                    .and_then(|m| v_str(m, "senderUin"))
                    .map(str::to_string)
            })
            .unwrap_or_default();

        let mut content = "原消息".to_string();
        let mut timestamp: i64 = 0;
        let mut preview_elements: Vec<Value> = Vec::new();

        if let Some(ref_msg) = &referenced_message {
            if let Some(uin) = v_str(ref_msg, "senderUin") {
                sender_uin = uin.to_string();
            }

            if let Some(elements) = v_get(ref_msg, "elements").and_then(Value::as_array) {
                let mut parts: Vec<String> = Vec::new();
                for element in elements {
                    if let Some(text) = v_get(element, "textElement")
                        .filter(|v| !v.is_null())
                        .and_then(|te| v_str(te, "content"))
                        .filter(|s| !s.is_empty())
                    {
                        parts.push(text.to_string());
                        preview_elements.push(json!({ "type": "text", "text": text }));
                    } else if let Some(pe) = v_get(element, "picElement").filter(|v| !v.is_null()) {
                        parts.push("[图片]".to_string());
                        preview_elements.push(json!({
                            "type": "image",
                            "text": "[图片]",
                            "md5": v_str(pe, "md5HexStr").unwrap_or(""),
                            "originUrl": v_str(pe, "originImageUrl").unwrap_or(""),
                            "fileName": v_str(pe, "fileName").unwrap_or("")
                        }));
                    } else if let Some(ve) = v_get(element, "videoElement").filter(|v| !v.is_null()) {
                        let video_name = v_str(ve, "fileName").unwrap_or("");
                        let video_text = if video_name.is_empty() {
                            "[视频]".to_string()
                        } else {
                            format!("[视频:{video_name}]")
                        };
                        parts.push(video_text.clone());
                        preview_elements.push(json!({
                            "type": "video",
                            "text": video_text,
                            "fileName": video_name
                        }));
                    } else if v_get(element, "pttElement").is_some_and(|v| !v.is_null()) {
                        parts.push("[语音]".to_string());
                        preview_elements.push(json!({ "type": "audio", "text": "[语音]" }));
                    } else if let Some(fe) = v_get(element, "fileElement").filter(|v| !v.is_null()) {
                        let file_name = v_str(fe, "fileName").unwrap_or("");
                        let file_text = if file_name.is_empty() {
                            "[文件]".to_string()
                        } else {
                            format!("[文件:{file_name}]")
                        };
                        parts.push(file_text.clone());
                        preview_elements.push(json!({
                            "type": "file",
                            "text": file_text,
                            "fileName": file_name
                        }));
                    } else if let Some(face) = v_get(element, "faceElement").filter(|v| !v.is_null()) {
                        let face_id = v_get(face, "faceIndex").map_or(String::new(), |v| match v {
                            Value::Number(n) => n.to_string(),
                            Value::String(s) => s.clone(),
                            _ => String::new(),
                        });
                        let face_text = v_str(face, "faceText")
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .or_else(|| self.face_map.get(&face_id).cloned())
                            .unwrap_or_else(|| format!("表情{face_id}"));
                        let face_part = if face_text.starts_with('[') {
                            face_text
                        } else {
                            format!("[{face_text}]")
                        };
                        parts.push(face_part.clone());
                        preview_elements.push(json!({
                            "type": "face",
                            "text": face_part,
                            "faceIndex": v_get(face, "faceIndex").cloned().unwrap_or(Value::Null)
                        }));
                    } else if let Some(mf) = v_get(element, "marketFaceElement").filter(|v| !v.is_null()) {
                        let face_name = v_str(mf, "faceName")
                            .filter(|s| !s.is_empty())
                            .unwrap_or("超级表情");
                        parts.push(format!("[{face_name}]"));
                        preview_elements.push(json!({
                            "type": "marketFace",
                            "text": format!("[{face_name}]"),
                            "faceName": face_name,
                            "url": Self::generate_market_face_url(v_str(mf, "emojiId").unwrap_or(""))
                        }));
                    }
                }
                if !parts.is_empty() {
                    content = parts.join("");
                }
            }

            if let Some(t) = v_str(ref_msg, "msgTime") {
                timestamp = t.parse::<i64>().unwrap_or(0);
            } else if let Some(t) = v_i64(ref_msg, "msgTime") {
                timestamp = t;
            }
        } else {
            // 备用方案：从 replyElement 中提取内容
            if let Some(text) = v_str(reply_element, "sourceMsgText").filter(|s| !s.is_empty()) {
                content = text.to_string();
            } else if let Some(elems) = v_get(reply_element, "sourceMsgTextElems").and_then(Value::as_array)
            {
                let parts: Vec<&str> = elems
                    .iter()
                    .filter_map(|e| {
                        v_get(e, "textElement")
                            .filter(|v| !v.is_null())
                            .and_then(|te| v_str(te, "content"))
                            .filter(|s| !s.is_empty())
                    })
                    .collect();
                if !parts.is_empty() {
                    content = parts.join("");
                }
            } else if let Some(body) = v_get(reply_element, "referencedMsg")
                .filter(|v| !v.is_null())
                .and_then(|rm| v_str(rm, "msgBody"))
            {
                content = body.to_string();
            }
        }

        if let Some(t) = v_get(reply_element, "replayMsgTime") {
            match t {
                Value::Number(n) => {
                    if let Some(v) = n.as_i64() {
                        if v != 0 {
                            timestamp = v;
                        }
                    }
                }
                Value::String(s) => {
                    if let Ok(v) = s.parse::<i64>() {
                        if v != 0 {
                            timestamp = v;
                        }
                    }
                }
                _ => {}
            }
        }

        json!({
            "messageId": message_id,
            "referencedMessageId": referenced_message_id,
            "senderUin": sender_uin,
            "senderName": sender_name,
            "content": content,
            "timestamp": timestamp,
            "previewElements": preview_elements
        })
    }

    /// 把被引用消息（reply）发件人解析成尽量可读的名字（#289）。
    fn resolve_reply_sender_name(
        &self,
        reply_element: &Value,
        message: &Value,
        referenced_message: Option<&Value>,
    ) -> String {
        if let Some(ref_msg) = referenced_message {
            let display = self.get_sender_display_info(ref_msg);
            if !display.name.is_empty() && display.name != "未知用户" {
                return display.name;
            }
        }

        let sender_member_name = trimmed_field(reply_element, "senderMemberName");
        let sender_nick = trimmed_field(reply_element, "senderNick");
        let is_group_chat = v_i64(message, "chatType") == Some(2);
        let prefer_group_member_name = is_group_chat && self.options.prefer_group_member_name;
        if prefer_group_member_name {
            if let Some(name) = &sender_member_name {
                return name.clone();
            }
        }
        if let Some(nick) = sender_nick {
            return nick;
        }
        if let Some(name) = sender_member_name {
            return name;
        }

        if let Some(cached) = self.lookup_cached_sender_info(
            v_str(reply_element, "senderUid"),
            v_str(reply_element, "senderUin"),
        ) {
            let from_cache = if prefer_group_member_name {
                cached
                    .group_card
                    .clone()
                    .or_else(|| cached.remark.clone())
                    .or_else(|| cached.nickname.clone())
            } else {
                cached
                    .remark
                    .clone()
                    .or_else(|| cached.nickname.clone())
                    .or_else(|| cached.group_card.clone())
            };
            if let Some(name) = from_cache {
                return name;
            }
        }

        if let Some(uin) = trimmed_field(reply_element, "senderUin") {
            return uin;
        }
        if let Some(uid_str) = trimmed_field(reply_element, "senderUidStr") {
            return uid_str;
        }
        String::new()
    }

    fn generate_market_face_url(emoji_id: &str) -> String {
        if emoji_id.chars().count() < 2 {
            return String::new();
        }
        let prefix: String = emoji_id.chars().take(2).collect();
        format!("https://gxh.vip.qq.com/club/item/parcel/item/{prefix}/{emoji_id}/raw300.gif")
    }

    fn parse_gray_tip_element(gray_tip: &Value) -> MessageElement {
        let sub_type = v_i64(gray_tip, "subElementType").unwrap_or(0);
        let mut text = String::new();

        if sub_type == 1 {
            if let Some(revoke) = v_get(gray_tip, "revokeElement").filter(|v| !v.is_null()) {
                let operator_name = v_str(revoke, "operatorName")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("用户");
                let original_sender_name = v_str(revoke, "origMsgSenderName")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("用户");
                let is_self = v_get(revoke, "isSelfOperate")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                text = if is_self || operator_name == original_sender_name {
                    format!("{operator_name} 撤回了一条消息")
                } else {
                    format!("{operator_name} 撤回了 {original_sender_name} 的消息")
                };
                if let Some(wording) = v_str(revoke, "wording").filter(|s| !s.is_empty()) {
                    text = wording.to_string();
                }
            }
        } else if sub_type == 4 {
            if let Some(ge) = v_get(gray_tip, "groupElement").filter(|v| !v.is_null()) {
                text = v_str(ge, "content")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("群聊更新")
                    .to_string();
            }
        } else if sub_type == 17 {
            if let Some(jg) = v_get(gray_tip, "jsonGrayTipElement").filter(|v| !v.is_null()) {
                let json_content = v_str(jg, "jsonStr").unwrap_or("{}");
                text = serde_json::from_str::<Value>(json_content)
                    .ok()
                    .and_then(|parsed| {
                        v_str(&parsed, "prompt")
                            .filter(|s| !s.is_empty())
                            .or_else(|| v_str(&parsed, "content").filter(|s| !s.is_empty()))
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "系统提示".to_string());
            }
        } else if let Some(aio_op) = v_get(gray_tip, "aioOpGrayTipElement").filter(|v| !v.is_null()) {
            if v_i64(aio_op, "operateType") == Some(1) {
                let from_user = v_str(aio_op, "peerName")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("用户");
                let to_user = v_str(aio_op, "targetName")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("用户");
                text = format!("{from_user} 拍了拍 {to_user}");
                if let Some(suffix) = v_str(aio_op, "suffix").filter(|s| !s.is_empty()) {
                    text.push(' ');
                    text.push_str(suffix);
                }
            } else {
                text = v_str(aio_op, "content")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("互动消息")
                    .to_string();
            }
        }

        if text.is_empty() {
            let content = v_str(gray_tip, "content")
                .filter(|s| !s.is_empty())
                .or_else(|| v_str(gray_tip, "text").filter(|s| !s.is_empty()))
                .or_else(|| v_str(gray_tip, "wording").filter(|s| !s.is_empty()));
            text = content.map_or_else(|| format!("系统提示 (类型: {sub_type})"), str::to_string);
        }

        MessageElement {
            element_type: "system".to_string(),
            data: json!({
                "subType": sub_type,
                "text": text,
                "summary": text,
                "originalData": gray_tip
            }),
        }
    }

    fn get_system_message_summary(element_type: &Value) -> String {
        let t = match element_type {
            Value::Number(n) => n.as_i64().unwrap_or(-1),
            Value::String(s) => s.parse::<i64>().unwrap_or(-1),
            _ => -1,
        };
        match t {
            8 => "系统提示消息".to_string(),
            9 => "钱包/红包消息".to_string(),
            10 => "Ark卡片消息".to_string(),
            11 => "商城表情".to_string(),
            12 => "直播礼物".to_string(),
            13 => "长消息".to_string(),
            14 => "Markdown消息".to_string(),
            15 => "Giphy动图".to_string(),
            16 => "合并转发".to_string(),
            17 => "内联键盘".to_string(),
            18 => "文内礼物".to_string(),
            19 => "日历".to_string(),
            20 => "YOLO游戏结果".to_string(),
            21 => "音视频通话记录".to_string(),
            22 => "动态".to_string(),
            23 => "豆腐记录".to_string(),
            24 => "ACE气泡".to_string(),
            25 => "活动".to_string(),
            26 => "豆腐".to_string(),
            27 => "表情气泡".to_string(),
            28 => "位置分享".to_string(),
            29 => "置顶任务消息".to_string(),
            43 => "推荐消息".to_string(),
            44 => "操作栏".to_string(),
            other => format!("系统消息 (类型: {other})"),
        }
    }
}
