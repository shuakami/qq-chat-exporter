//! 把 NTQQ ChatType 数值映射成导出层关心的二分类（issue #365）。
//!
//! NTQQ 的 ChatType 枚举里：
//!   - 1   好友
//!   - 2   群聊
//!   - 4   频道
//!   - 9 / 16    频道子会话
//!   - 100 临时会话
//!   - 118 / 201 服务号 / 公众账号
//!   - 132-134 通知类
//!
//! 除群聊（2）外，其余都是 1 对 1 的单聊型会话，导出 / 文件命名 / 策略选择
//! 都应按私聊处理。本模块只做纯映射，不依赖任何 NapCat 类型。

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
