use crate::base::ms_to_iso;
use crate::types::CleanMessage;
use indexmap::IndexMap;
use serde::Serialize;

/// 发送者统计条目。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderStat {
    /// 发送者 UID。
    pub uid: String,
    /// 发送者名称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 消息数量。
    pub message_count: u64,
    /// 占比（保留两位小数）。
    pub percentage: f64,
}

/// 时间范围统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRangeStat {
    /// 开始时间（ISO），可能为空串。
    pub start: String,
    /// 结束时间（ISO），可能为空串。
    pub end: String,
    /// 时间跨度（天）。
    pub duration_days: u64,
}

/// 资源统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceStat {
    /// 总资源数。
    pub total: u64,
    /// 按类型分组。
    pub by_type: IndexMap<String, u64>,
    /// 总大小（字节）。
    pub total_size: u64,
}

/// 最终统计（对应 TS `finalize()` 返回结构）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalStats {
    /// 消息总数。
    pub total_messages: u64,
    /// 时间范围。
    pub time_range: TimeRangeStat,
    /// 消息类型统计。
    pub message_types: IndexMap<String, u64>,
    /// 发送者统计（按消息数降序）。
    pub senders: Vec<SenderStat>,
    /// 资源统计。
    pub resources: ResourceStat,
}

/// 在线统计累加器。
#[derive(Debug, Default)]
pub struct StatsAccumulator {
    total: u64,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    by_type: IndexMap<String, u64>,
    by_sender: IndexMap<String, (Option<String>, u64)>,
    res_total: u64,
    res_by_type: IndexMap<String, u64>,
    res_total_size: u64,
}

impl StatsAccumulator {
    /// 新建累加器。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 消费一条消息（只更新聚合，不缓存消息体）。
    pub fn consume(&mut self, m: &CleanMessage) {
        self.total += 1;

        let ts = m.timestamp;
        if ts > 0 {
            self.start_ts = Some(self.start_ts.map_or(ts, |s| s.min(ts)));
            self.end_ts = Some(self.end_ts.map_or(ts, |e| e.max(ts)));
        }

        let type_key = if m.message_type.is_empty() {
            "unknown"
        } else {
            m.message_type.as_str()
        };
        *self.by_type.entry(type_key.to_owned()).or_insert(0) += 1;

        // 系统灰条消息没有真实发送者，不计入发送者统计，避免第三方导入工具
        // 把它当成一个真实成员。
        if !m.system {
            let sender_key = if m.sender.uid.is_empty() {
                "unknown".to_owned()
            } else {
                m.sender.uid.clone()
            };
            let entry = self.by_sender.entry(sender_key).or_insert((None, 0));
            entry.1 += 1;
            if entry.0.is_none() && !m.sender.name.is_empty() {
                entry.0 = Some(m.sender.name.clone());
            }
        }

        for r in &m.content.resources {
            self.res_total += 1;
            let rt = if r.resource_type.is_empty() {
                "file"
            } else {
                r.resource_type.as_str()
            };
            *self.res_by_type.entry(rt.to_owned()).or_insert(0) += 1;
            self.res_total_size += r.size.unwrap_or(0);
        }
    }

    /// 完成统计并输出最终结构。
    #[must_use]
    pub fn finalize(self) -> FinalStats {
        let duration_days = match (self.start_ts, self.end_ts) {
            (Some(start), Some(end)) => {
                let days =
                    ((end - start) as f64 / f64::from(24 * 3600 * 1000)).round().max(1.0);
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                {
                    days as u64
                }
            }
            _ => 0,
        };

        let total = self.total;
        let mut senders: Vec<SenderStat> = self
            .by_sender
            .into_iter()
            .map(|(uid, (name, count))| SenderStat {
                uid,
                name,
                message_count: count,
                percentage: if total > 0 {
                    (count as f64 / total as f64 * 10000.0).round() / 100.0
                } else {
                    0.0
                },
            })
            .collect();
        senders.sort_by_key(|s| std::cmp::Reverse(s.message_count));

        FinalStats {
            total_messages: total,
            time_range: TimeRangeStat {
                start: self.start_ts.map(ms_to_iso).unwrap_or_default(),
                end: self.end_ts.map(ms_to_iso).unwrap_or_default(),
                duration_days,
            },
            message_types: self.by_type,
            senders,
            resources: ResourceStat {
                total: self.res_total,
                by_type: self.res_by_type,
                total_size: self.res_total_size,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StatsAccumulator;
    use crate::types::{CleanMessage, MessageContent, Sender};

    fn message(uid: &str, name: &str, system: bool) -> CleanMessage {
        CleanMessage {
            id: "1".to_owned(),
            seq: "1".to_owned(),
            timestamp: 1_700_000_000_000,
            time: String::new(),
            sender: Sender {
                uid: uid.to_owned(),
                uin: None,
                name: name.to_owned(),
                nickname: None,
                group_card: None,
                remark: None,
                title: None,
                avatar_base64: None,
            },
            message_type: if system { "system" } else { "text" }.to_owned(),
            content: MessageContent {
                text: String::new(),
                html: None,
                elements: Vec::new(),
                resources: Vec::new(),
                mentions: Vec::new(),
            },
            recalled: false,
            system,
            raw_message: None,
        }
    }

    #[test]
    fn system_messages_are_counted_but_excluded_from_senders() {
        let mut acc = StatsAccumulator::new();
        acc.consume(&message("u_alice", "Alice", false));
        acc.consume(&message("未知", "系统消息", true));

        let stats = acc.finalize();
        assert_eq!(stats.total_messages, 2);
        assert_eq!(stats.senders.len(), 1);
        assert_eq!(stats.senders[0].uid, "u_alice");
    }
}
