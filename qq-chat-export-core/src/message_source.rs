//! 解析后消息的分批数据源（issue #666）。
//!
//! 超大会话（百万级消息）无法把全部 [`CleanMessage`] 常驻内存：chunked 导出
//! 本身是流式写盘的，只要输入也按批提供，导出阶段的内存占用就与消息总数无关。
//! 数据源需要被读两遍（第一遍建立 reply 跳转索引，第二遍写 chunk），因此约定
//! [`CleanMessageSource::restart`] 必须能把游标复位到开头。

use crate::error::ExportResultT;
use crate::types::CleanMessage;

/// 按批提供解析后消息的数据源。
///
/// 实现必须保证：
/// - 消息按时间戳升序给出（与旧的全量 `sort_by_key(timestamp)` 语义一致）；
/// - [`Self::restart`] 之后重新从第一条开始，且两遍读到的序列完全一致；
/// - [`Self::next_batch`] 返回 `None` 表示读完。
pub trait CleanMessageSource {
    /// 复位游标到第一条消息。
    fn restart(&mut self) -> impl std::future::Future<Output = ExportResultT<()>> + Send;

    /// 读取下一批消息；`None` 表示已读完。
    fn next_batch(
        &mut self,
    ) -> impl std::future::Future<Output = ExportResultT<Option<Vec<CleanMessage>>>> + Send;
}

/// 内存切片数据源：让已有的全量导出入口复用流式实现。
pub struct SliceMessageSource<'a> {
    messages: &'a [CleanMessage],
    position: usize,
    batch_size: usize,
}

impl<'a> SliceMessageSource<'a> {
    /// 默认批大小（与 chunked 导出的单块消息数同量级）。
    pub const DEFAULT_BATCH_SIZE: usize = 2000;

    /// 用默认批大小包装消息切片。
    #[must_use]
    pub fn new(messages: &'a [CleanMessage]) -> Self {
        Self::with_batch_size(messages, Self::DEFAULT_BATCH_SIZE)
    }

    /// 指定批大小包装消息切片。
    #[must_use]
    pub fn with_batch_size(messages: &'a [CleanMessage], batch_size: usize) -> Self {
        Self {
            messages,
            position: 0,
            batch_size: batch_size.max(1),
        }
    }
}

impl CleanMessageSource for SliceMessageSource<'_> {
    // 内存切片没有真正的异步 I/O，直接返回就绪的 future。
    fn restart(&mut self) -> impl std::future::Future<Output = ExportResultT<()>> + Send {
        self.position = 0;
        std::future::ready(Ok(()))
    }

    fn next_batch(
        &mut self,
    ) -> impl std::future::Future<Output = ExportResultT<Option<Vec<CleanMessage>>>> + Send {
        let batch = if self.position >= self.messages.len() {
            None
        } else {
            let end = (self.position + self.batch_size).min(self.messages.len());
            let batch = self.messages[self.position..end].to_vec();
            self.position = end;
            Some(batch)
        };
        std::future::ready(Ok(batch))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str) -> CleanMessage {
        CleanMessage {
            id: id.to_owned(),
            seq: String::new(),
            timestamp: 0,
            time: String::new(),
            sender: crate::types::Sender::default(),
            message_type: "type_1".to_owned(),
            content: crate::types::MessageContent::default(),
            recalled: false,
            system: false,
            raw_message: None,
        }
    }

    #[tokio::test]
    async fn slice_source_batches_and_restarts() {
        let messages: Vec<CleanMessage> = (0..5).map(|i| message(&format!("m{i}"))).collect();
        let mut source = SliceMessageSource::with_batch_size(&messages, 2);

        let mut ids = Vec::new();
        while let Some(batch) = source.next_batch().await.unwrap() {
            assert!(batch.len() <= 2);
            ids.extend(batch.into_iter().map(|m| m.id));
        }
        assert_eq!(ids, vec!["m0", "m1", "m2", "m3", "m4"]);

        source.restart().await.unwrap();
        let first = source.next_batch().await.unwrap().unwrap();
        assert_eq!(first[0].id, "m0");
    }
}
