//! HTML 导出期的有界状态（issue #666）。
//!
//! 旧实现把全部消息 id、全部 `(时间, 发送者) -> id` 映射以及所有已内联的
//! data URI 都放在 `HashMap<String, _>` 里，内存随会话规模线性增长；百万级
//! 会话仅 reply 跳转索引就要几百 MB。这里把它们改成：
//!
//! - [`ReplyTargetIndex`]：消息 id 只保留 64 位哈希（每条 8 字节），
//!   `(时间, 发送者)` 回退表只对「确实被 reply 引用过」的键建立；
//! - [`DataUriCache`]：按字节预算 + 条目数双重上限的 FIFO 缓存，且保证当前
//!   正在渲染的消息所预载的资源不会被淘汰；miss 集合同样有上限。

use crate::types::CleanMessage;
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

/// reply 跳转索引。
///
/// 使用方式（两遍读取数据源）：
/// 1. 第一遍对每条消息调用 [`Self::index_message`]；
/// 2. 第二遍（渲染）在渲染每条消息**之前**调用 [`Self::observe_rendered`]，
///    随后即可用 [`Self::contains_id`] / [`Self::lookup_by_time_sender`] 解析。
///
/// 回退表只对第一遍见过的 reply 键建立，且只覆盖渲染顺序上位于 reply 之前的
/// 目标消息（被引用消息按时间排序时总在 reply 之前）。
#[derive(Debug, Default)]
pub struct ReplyTargetIndex {
    id_hashes: HashSet<u64>,
    wanted_keys: HashSet<(i64, String)>,
    resolved_keys: HashMap<(i64, String), Option<String>>,
}

impl ReplyTargetIndex {
    /// 清空索引，准备新的两遍扫描。
    pub fn clear(&mut self) {
        self.id_hashes.clear();
        self.wanted_keys.clear();
        self.resolved_keys.clear();
    }

    /// 第一遍：记录消息 id 哈希，并收集其 reply 元素的 `(时间, 发送者)` 键。
    pub fn index_message(&mut self, message: &CleanMessage) {
        let id = message.id.trim();
        if id.is_empty() {
            return;
        }
        self.id_hashes.insert(fnv1a64(id));
        for element in &message.content.elements {
            if element.element_type != "reply" {
                continue;
            }
            self.collect_reply_keys(&element.data);
        }
    }

    fn collect_reply_keys(&mut self, data: &Value) {
        let input = crate::reply_render::ReplyRenderInput::from_value(data);
        let Some(timestamp) = crate::reply_render::reply_timestamp_millis(
            input.timestamp.as_ref().or(input.time.as_ref()),
        ) else {
            return;
        };
        for key in ["senderUin", "senderUidStr", "senderUid"] {
            let Some(sender) = data.get(key).and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            if sender.is_empty() {
                continue;
            }
            self.wanted_keys.insert((timestamp, sender.to_owned()));
        }
    }

    /// 第二遍：在渲染 `message` 之前调用，把它登记为潜在的 reply 目标。
    pub fn observe_rendered(&mut self, message: &CleanMessage) {
        if self.wanted_keys.is_empty() || message.id.trim().is_empty() {
            return;
        }
        for sender in [
            Some(message.sender.uid.as_str()),
            message.sender.uin.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|sender| !sender.is_empty())
        {
            let key = (message.timestamp, sender.to_owned());
            if !self.wanted_keys.contains(&key) {
                continue;
            }
            match self.resolved_keys.entry(key) {
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(Some(message.id.clone()));
                }
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    if entry.get().as_deref() != Some(message.id.as_str()) {
                        entry.insert(None);
                    }
                }
            }
        }
    }

    /// 消息 id 是否存在于本次导出（64 位哈希判定，碰撞概率可忽略）。
    #[must_use]
    pub fn contains_id(&self, id: &str) -> bool {
        self.id_hashes.contains(&fnv1a64(id.trim()))
    }

    /// `(时间, 发送者)` 回退查询：`Some(Some(id))` 唯一命中，`Some(None)` 多条歧义。
    #[must_use]
    pub fn lookup_by_time_sender(&self, timestamp: i64, sender: &str) -> Option<&Option<String>> {
        self.resolved_keys.get(&(timestamp, sender.to_owned()))
    }
}

fn fnv1a64(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// data URI 缓存默认字节预算（base64 文本长度之和）。
pub const DEFAULT_DATA_URI_BUDGET_BYTES: usize = 96 * 1024 * 1024;
/// data URI 缓存默认条目上限。
pub const DEFAULT_DATA_URI_MAX_ENTRIES: usize = 4096;
/// miss 集合上限；超过即整体清空（只影响是否重复探测磁盘，不影响正确性）。
pub const DEFAULT_DATA_URI_MAX_MISSES: usize = 65_536;

struct CachedUri {
    value: String,
    pinned_generation: u64,
}

/// 有界 data URI 缓存（Issue #311 / #666）。
///
/// - key：`<typeDir>/<basename>`；value：完整 `data:<mime>;base64,...`；
/// - FIFO 淘汰，直到字节与条目都回到预算内；
/// - 调用 [`Self::begin_message`] 后新插入 / 新命中的条目在本条消息渲染完之前
///   不会被淘汰（渲染是同步查表，必须保证预载结果可用）。
pub struct DataUriCache {
    entries: HashMap<String, CachedUri>,
    order: VecDeque<String>,
    misses: HashSet<String>,
    bytes: usize,
    budget_bytes: usize,
    max_entries: usize,
    max_misses: usize,
    generation: u64,
}

impl Default for DataUriCache {
    fn default() -> Self {
        Self::new(DEFAULT_DATA_URI_BUDGET_BYTES, DEFAULT_DATA_URI_MAX_ENTRIES)
    }
}

impl DataUriCache {
    /// 新建缓存。
    #[must_use]
    pub fn new(budget_bytes: usize, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            misses: HashSet::new(),
            bytes: 0,
            budget_bytes: budget_bytes.max(1),
            max_entries: max_entries.max(1),
            max_misses: DEFAULT_DATA_URI_MAX_MISSES,
            generation: 0,
        }
    }

    /// 开始渲染一条新消息：之前被钉住的条目重新变为可淘汰。
    pub fn begin_message(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }

    /// 是否已知（命中或 miss），已知则无需再次读盘。命中时会把条目钉在当前消息上。
    pub fn is_known(&mut self, key: &str) -> bool {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.pinned_generation = self.generation;
            return true;
        }
        self.misses.contains(key)
    }

    /// 记录一次 miss。
    pub fn record_miss(&mut self, key: String) {
        if self.misses.len() >= self.max_misses {
            self.misses.clear();
        }
        self.misses.insert(key);
    }

    /// 插入一条 data URI 并按预算淘汰旧条目。
    pub fn insert(&mut self, key: String, value: String) {
        if let Some(old) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(old.value.len());
            self.order.retain(|k| k != &key);
        }
        self.bytes += value.len();
        self.order.push_back(key.clone());
        self.entries.insert(
            key,
            CachedUri {
                value,
                pinned_generation: self.generation,
            },
        );
        self.evict();
    }

    /// 渲染期查询。
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&str> {
        self.entries.get(key).map(|entry| entry.value.as_str())
    }

    /// 当前缓存条目数。
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// 是否为空。
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn evict(&mut self) {
        let mut scanned = 0usize;
        while (self.bytes > self.budget_bytes || self.entries.len() > self.max_entries)
            && scanned < self.order.len()
        {
            let Some(key) = self.order.pop_front() else {
                break;
            };
            let pinned = self
                .entries
                .get(&key)
                .is_some_and(|entry| entry.pinned_generation == self.generation);
            if pinned {
                self.order.push_back(key);
                scanned += 1;
                continue;
            }
            if let Some(entry) = self.entries.remove(&key) {
                self.bytes = self.bytes.saturating_sub(entry.value.len());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{MessageContent, MessageElement, Sender};
    use serde_json::json;

    fn message(id: &str, ts: i64, uid: &str, elements: Vec<MessageElement>) -> CleanMessage {
        CleanMessage {
            id: id.to_owned(),
            seq: String::new(),
            timestamp: ts,
            time: String::new(),
            sender: Sender {
                uid: uid.to_owned(),
                ..Sender::default()
            },
            message_type: "type_1".to_owned(),
            content: MessageContent {
                elements,
                ..MessageContent::default()
            },
            recalled: false,
            system: false,
            raw_message: None,
        }
    }

    fn reply(ts_seconds: i64, sender: &str) -> MessageElement {
        MessageElement {
            element_type: "reply".to_owned(),
            data: json!({ "timestamp": ts_seconds, "senderUid": sender }),
        }
    }

    #[test]
    fn reply_index_resolves_ids_and_fallback_keys() {
        let target = message("100", 1_700_000_000_000, "u1", vec![]);
        let other = message("101", 1_700_000_000_000, "u2", vec![]);
        let replier = message(
            "200",
            1_700_000_005_000,
            "u3",
            vec![reply(1_700_000_000, "u1")],
        );

        let mut index = ReplyTargetIndex::default();
        for m in [&target, &other, &replier] {
            index.index_message(m);
        }
        assert!(index.contains_id("100"));
        assert!(!index.contains_id("999"));

        index.observe_rendered(&target);
        index.observe_rendered(&other);
        assert_eq!(
            index.lookup_by_time_sender(1_700_000_000_000, "u1"),
            Some(&Some("100".to_owned()))
        );
        // u2 未被任何 reply 引用，不建表
        assert!(index
            .lookup_by_time_sender(1_700_000_000_000, "u2")
            .is_none());
    }

    #[test]
    fn data_uri_cache_evicts_fifo_but_keeps_pinned() {
        let mut cache = DataUriCache::new(10, 100);
        cache.begin_message();
        cache.insert("a".to_owned(), "12345".to_owned());
        cache.insert("b".to_owned(), "12345".to_owned());
        assert_eq!(cache.len(), 2);
        // 同一条消息内继续插入：a/b 都被钉住，不会被淘汰
        cache.insert("c".to_owned(), "123".to_owned());
        assert_eq!(cache.len(), 3);

        cache.begin_message();
        cache.insert("d".to_owned(), "1234567".to_owned());
        assert!(cache.get("a").is_none());
        assert!(cache.get("d").is_some());
        assert!(cache.bytes <= cache.budget_bytes || cache.len() == 1);
    }
}
