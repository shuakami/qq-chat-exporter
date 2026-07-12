use chrono::{DateTime, Datelike, Timelike, Utc};
use serde_json::Value;

/// reply 元素的字段挑选输入（对应 TS `ReplyRenderInput`，弱类型透传）。
#[derive(Debug, Clone, Default)]
pub struct ReplyRenderInput {
    /// SimpleMessageParser 写入的目标消息 id（与 messageMap key 对齐）。
    pub referenced_message_id: Option<String>,
    /// 历史字段，部分老代码 / 老快照里仍然在用。
    pub reply_msg_id: Option<String>,
    /// 内部查找用的 sourceMsgIdInRecords，作为兜底。
    pub msg_id: Option<String>,
    /// parser 写入的时间：秒级 epoch / ms 级 epoch / ISO string。
    pub timestamp: Option<Value>,
    /// 老路径会读 `data.time`，保留兼容。
    pub time: Option<Value>,
}

impl ReplyRenderInput {
    /// 从 reply 元素的 `data` JSON 对象构建。
    #[must_use]
    pub fn from_value(data: &Value) -> Self {
        let get_str = |key: &str| -> Option<String> {
            match data.get(key) {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Number(n)) => Some(n.to_string()),
                _ => None,
            }
        };
        Self {
            referenced_message_id: get_str("referencedMessageId"),
            reply_msg_id: get_str("replyMsgId"),
            msg_id: get_str("msgId").or_else(|| get_str("messageId")),
            timestamp: data.get("timestamp").cloned(),
            time: data.get("time").cloned(),
        }
    }
}

/// 选择「跳转到原消息」的目标 msgId。优先级：
/// `referencedMessageId > replyMsgId > msgId`。
///
/// 任何空串 / `"0"` 都视为没值；返回 `None` 表示不应渲染跳转交互。
#[must_use]
pub fn choose_reply_jump_target(data: &ReplyRenderInput) -> Option<String> {
    for raw in [
        data.referenced_message_id.as_deref(),
        data.reply_msg_id.as_deref(),
        data.msg_id.as_deref(),
    ] {
        let Some(raw) = raw else { continue };
        let s = raw.trim();
        if s.is_empty() || s == "0" {
            continue;
        }
        return Some(s.to_owned());
    }
    None
}

/// 把 reply 元素里五花八门的时间字段统一成「MM-DD HH:mm」展示串。
///
/// - 数字：> 1e12 视为毫秒，否则视为秒级 epoch；
/// - 字符串：先 trim，全数字先按数字走，否则按 RFC3339 / 常见格式解析；
/// - 0 / 空 / 解析失败：返回空串。
///
/// 与 TS 一致固定走 UTC 计算，保证跨时区 / CI 稳定。
#[must_use]
pub fn format_reply_timestamp(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };

    let ms: Option<i64> = match value {
        Value::Number(n) => n
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0)
            .map(|v| {
                #[allow(clippy::cast_possible_truncation)]
                if v > 1e12 {
                    v as i64
                } else {
                    (v * 1000.0) as i64
                }
            }),
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed.chars().all(|c| c.is_ascii_digit()) {
                trimmed.parse::<i64>().ok().filter(|n| *n > 0).map(|n| {
                    if n > 1_000_000_000_000 {
                        n
                    } else {
                        n * 1000
                    }
                })
            } else {
                DateTime::parse_from_rfc3339(trimmed)
                    .map(|dt| dt.timestamp_millis())
                    .ok()
            }
        }
        _ => None,
    };

    let Some(ms) = ms.filter(|m| *m > 0) else {
        return String::new();
    };
    let Some(date) = DateTime::<Utc>::from_timestamp_millis(ms) else {
        return String::new();
    };
    format!(
        "{:02}-{:02} {:02}:{:02}",
        date.month(),
        date.day(),
        date.hour(),
        date.minute()
    )
}

/// 合成跳转目标与时间标签（对应 TS `pickReplyRenderHints`）。
#[must_use]
pub fn pick_reply_render_hints(data: &ReplyRenderInput) -> (Option<String>, String) {
    let formatted_time =
        format_reply_timestamp(data.timestamp.as_ref().or(data.time.as_ref()));
    (choose_reply_jump_target(data), formatted_time)
}
