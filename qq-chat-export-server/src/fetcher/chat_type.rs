/// 群聊 ChatType 值。
pub const GROUP_CHAT_TYPE: i64 = 2;

/// 该 chatType 在导出层是否按「单聊」对待。
#[must_use]
pub fn is_private_like_chat_type(chat_type: Option<i64>) -> bool {
    match chat_type {
        None => true,
        Some(value) => value != GROUP_CHAT_TYPE,
    }
}

/// 文件名 / 目录名前缀。仅 chatType == 2 用 `group`，其它走 `friend`。
#[must_use]
pub fn chat_type_prefix(chat_type: Option<i64>) -> &'static str {
    if is_private_like_chat_type(chat_type) {
        "friend"
    } else {
        "group"
    }
}

/// 导出 pipeline 通用的二分类（exporter type / 任务记录的 chatType 字段等）。
#[must_use]
pub fn classify_chat_type_binary(chat_type: Option<i64>) -> &'static str {
    if is_private_like_chat_type(chat_type) {
        "private"
    } else {
        "group"
    }
}
