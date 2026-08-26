//! 解析后消息的磁盘暂存与归并读取（issue #666）。
//!
//! 抓取阶段已经用 JSONL spool 避免了原始消息常驻内存，但导出阶段仍然把全部
//! [`CleanMessage`] 攒在 `Vec` 里：百万级大群（issue #666 现场约 247 万条）会
//! 因此吃掉数 GB 内存，把 QQ 进程一起拖到 OOM。
//!
//! 这里提供一个「分段有序 + k 路归并」的磁盘 spool：
//! - 解析流水线每处理完一个原始块，就把这一块（块内已按时间排序）作为一个
//!   **段** 追加落盘，内存里不留消息；
//! - 读取时对所有段做 k 路归并，按 `timestamp` 升序流式产出，等价于原先的
//!   `clean_messages.sort_by_key(|m| m.timestamp)`；
//! - 可以被多次重读（chunked 导出需要读两遍），内存占用只有每段一条前瞻消息。

use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};

use qce_exporter::types::CleanMessage;
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _};

/// 归并读取时每批产出的消息条数。
pub const CLEAN_SPOOL_BATCH_SIZE: usize = 2_000;

/// 解析后消息的磁盘暂存文件（分段 JSONL）。
///
/// 文件布局：每行一条 `CleanMessage` JSON，段与段之间靠 [`Self::segments`]
/// 记录的行区间划分；段内按时间升序，段间无序（由归并读取负责全局排序）。
pub struct CleanMessageSpool {
    path: PathBuf,
    writer: Option<tokio::io::BufWriter<tokio::fs::File>>,
    /// 每段的 `(起始字节偏移, 消息条数)`。
    segments: Vec<(u64, usize)>,
    bytes_written: u64,
    count: usize,
}

impl CleanMessageSpool {
    /// 创建暂存文件。
    ///
    /// # Errors
    /// 创建文件失败时返回错误描述。
    pub async fn create(path: PathBuf) -> Result<Self, String> {
        let file = tokio::fs::File::create(&path)
            .await
            .map_err(|e| format!("创建解析结果暂存文件失败: {e}"))?;
        Ok(Self {
            path,
            writer: Some(tokio::io::BufWriter::new(file)),
            segments: Vec::new(),
            bytes_written: 0,
            count: 0,
        })
    }

    /// 追加一个「段内已按时间升序」的消息批次。
    ///
    /// # Errors
    /// 序列化或写盘失败时返回错误描述。
    pub async fn append_sorted_segment(&mut self, messages: &[CleanMessage]) -> Result<(), String> {
        if messages.is_empty() {
            return Ok(());
        }
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "解析结果暂存文件已关闭".to_string())?;
        let start_offset = self.bytes_written;
        for message in messages {
            let mut line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
            line.push(b'\n');
            writer
                .write_all(&line)
                .await
                .map_err(|e| format!("写入解析结果暂存文件失败: {e}"))?;
            self.bytes_written += line.len() as u64;
        }
        self.segments.push((start_offset, messages.len()));
        self.count += messages.len();
        Ok(())
    }

    /// 刷盘并关闭写入端（之后只能读）。
    ///
    /// # Errors
    /// 刷盘失败时返回错误描述。
    pub async fn finish(&mut self) -> Result<(), String> {
        if let Some(mut writer) = self.writer.take() {
            writer
                .flush()
                .await
                .map_err(|e| format!("写入解析结果暂存文件失败: {e}"))?;
        }
        Ok(())
    }

    /// 已暂存的消息总数。
    #[must_use]
    pub fn count(&self) -> usize {
        self.count
    }

    /// 暂存文件路径。
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 打开一个按时间升序的归并读取器。
    ///
    /// # Errors
    /// 打开文件或读取失败时返回错误描述。
    pub async fn reader(&self) -> Result<CleanMessageMergeReader, String> {
        CleanMessageMergeReader::open(&self.path, &self.segments, CLEAN_SPOOL_BATCH_SIZE).await
    }
}

impl Drop for CleanMessageSpool {
    fn drop(&mut self) {
        self.writer.take();
        let _ = std::fs::remove_file(&self.path);
    }
}

/// 单个段的顺序读取游标。
struct SegmentCursor {
    lines: tokio::io::Lines<tokio::io::BufReader<tokio::fs::File>>,
    remaining: usize,
}

impl SegmentCursor {
    async fn open(path: &Path, start_offset: u64, count: usize) -> Result<Self, String> {
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|e| format!("打开解析结果暂存文件失败: {e}"))?;
        tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(start_offset))
            .await
            .map_err(|e| format!("定位解析结果暂存文件失败: {e}"))?;
        Ok(Self {
            lines: tokio::io::BufReader::new(file).lines(),
            remaining: count,
        })
    }

    async fn next(&mut self) -> Result<Option<CleanMessage>, String> {
        while self.remaining > 0 {
            let line = self
                .lines
                .next_line()
                .await
                .map_err(|e| format!("读取解析结果暂存文件失败: {e}"))?;
            let Some(line) = line else {
                self.remaining = 0;
                return Ok(None);
            };
            self.remaining -= 1;
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str(&line)
                .map(Some)
                .map_err(|e| format!("解析暂存消息失败: {e}"));
        }
        Ok(None)
    }
}

/// 归并堆里的一项：按 `(timestamp, segment_index)` 升序取出。
struct HeapItem {
    timestamp: i64,
    segment: usize,
    message: CleanMessage,
}

impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.timestamp == other.timestamp && self.segment == other.segment
    }
}

impl Eq for HeapItem {}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // BinaryHeap 是大顶堆，这里反转成小顶堆。
        (other.timestamp, other.segment).cmp(&(self.timestamp, self.segment))
    }
}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// 按 `timestamp` 升序流式读取 spool 的 k 路归并读取器。
pub struct CleanMessageMergeReader {
    path: PathBuf,
    segments: Vec<(u64, usize)>,
    cursors: Vec<SegmentCursor>,
    heap: BinaryHeap<HeapItem>,
    batch_size: usize,
}

impl CleanMessageMergeReader {
    async fn open(
        path: &Path,
        segments: &[(u64, usize)],
        batch_size: usize,
    ) -> Result<Self, String> {
        let mut reader = Self {
            path: path.to_path_buf(),
            segments: segments.to_vec(),
            cursors: Vec::new(),
            heap: BinaryHeap::new(),
            batch_size: batch_size.max(1),
        };
        reader.reset().await?;
        Ok(reader)
    }

    /// 复位到第一条消息（chunked 导出需要读两遍）。
    ///
    /// # Errors
    /// 打开或读取暂存文件失败时返回错误描述。
    pub async fn reset(&mut self) -> Result<(), String> {
        self.cursors.clear();
        self.heap.clear();
        for &(offset, count) in &self.segments {
            self.cursors
                .push(SegmentCursor::open(&self.path, offset, count).await?);
        }
        for segment in 0..self.cursors.len() {
            self.push_next(segment).await?;
        }
        Ok(())
    }

    async fn push_next(&mut self, segment: usize) -> Result<(), String> {
        if let Some(message) = self.cursors[segment].next().await? {
            self.heap.push(HeapItem {
                timestamp: message.timestamp,
                segment,
                message,
            });
        }
        Ok(())
    }

    /// 读取下一批（按时间升序）；`None` 表示读完。
    ///
    /// # Errors
    /// 读取或反序列化失败时返回错误描述。
    pub async fn next_batch(&mut self) -> Result<Option<Vec<CleanMessage>>, String> {
        let mut batch = Vec::new();
        while batch.len() < self.batch_size {
            let Some(item) = self.heap.pop() else {
                break;
            };
            let segment = item.segment;
            batch.push(item.message);
            self.push_next(segment).await?;
        }
        Ok(if batch.is_empty() { None } else { Some(batch) })
    }
}

/// 把归并读取器包装成导出核心的 [`CleanMessageSource`]，并在产出前对每条消息
/// 做导出前的最终加工（资源本地路径写回、reply 预览补全、自己的昵称补全等）。
///
/// 加工放在这里而不是提前写回 spool，是为了让「先建全局索引、再流式产出」两遍
/// 读取拿到完全一致的消息内容。
pub struct SpooledCleanMessageSource<F> {
    reader: CleanMessageMergeReader,
    transform: F,
}

impl<F> SpooledCleanMessageSource<F>
where
    F: FnMut(&mut CleanMessage) + Send,
{
    /// 用 spool 归并读取器与逐条加工闭包构造数据源。
    pub fn new(reader: CleanMessageMergeReader, transform: F) -> Self {
        Self { reader, transform }
    }
}

fn spool_error(path: &Path, message: String) -> qce_exporter::ExportError {
    qce_exporter::ExportError::io("readMessageSpool", path, std::io::Error::other(message))
}

impl<F> qce_exporter::CleanMessageSource for SpooledCleanMessageSource<F>
where
    F: FnMut(&mut CleanMessage) + Send,
{
    async fn restart(&mut self) -> qce_exporter::ExportResultT<()> {
        let result = self.reader.reset().await;
        result.map_err(|e| spool_error(&self.reader.path, e))
    }

    async fn next_batch(&mut self) -> qce_exporter::ExportResultT<Option<Vec<CleanMessage>>> {
        let result = self.reader.next_batch().await;
        let batch = result.map_err(|e| spool_error(&self.reader.path, e))?;
        Ok(batch.map(|mut batch| {
            for message in &mut batch {
                (self.transform)(message);
            }
            batch
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, timestamp: i64) -> CleanMessage {
        CleanMessage {
            id: id.to_string(),
            seq: String::new(),
            timestamp,
            time: String::new(),
            sender: qce_exporter::types::Sender::default(),
            message_type: "text".to_string(),
            content: qce_exporter::types::MessageContent::default(),
            recalled: false,
            system: false,
            raw_message: None,
        }
    }

    #[tokio::test]
    async fn merges_segments_in_timestamp_order_and_supports_reset() {
        let dir = std::env::temp_dir().join(format!("qce-clean-spool-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let mut spool = CleanMessageSpool::create(dir.join("clean.jsonl"))
            .await
            .unwrap();

        // 三个段，段内升序、段间交错（模拟按批解析的真实顺序）。
        spool
            .append_sorted_segment(&[message("c", 30), message("d", 40)])
            .await
            .unwrap();
        spool
            .append_sorted_segment(&[message("a", 10), message("e", 50)])
            .await
            .unwrap();
        spool
            .append_sorted_segment(&[message("b", 20)])
            .await
            .unwrap();
        spool.finish().await.unwrap();
        assert_eq!(spool.count(), 5);

        let mut reader = spool.reader().await.unwrap();
        let mut ids = Vec::new();
        while let Some(batch) = reader.next_batch().await.unwrap() {
            ids.extend(batch.into_iter().map(|m| m.id));
        }
        assert_eq!(ids, vec!["a", "b", "c", "d", "e"]);

        // 第二遍必须完全一致。
        reader.reset().await.unwrap();
        let mut again = Vec::new();
        while let Some(batch) = reader.next_batch().await.unwrap() {
            again.extend(batch.into_iter().map(|m| m.id));
        }
        assert_eq!(again, ids);

        let path = spool.path().to_path_buf();
        drop(reader);
        drop(spool);
        // Drop 必须清理暂存文件。
        assert!(!path.exists());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn empty_spool_yields_nothing() {
        let dir =
            std::env::temp_dir().join(format!("qce-clean-spool-empty-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let mut spool = CleanMessageSpool::create(dir.join("clean.jsonl"))
            .await
            .unwrap();
        spool.append_sorted_segment(&[]).await.unwrap();
        spool.finish().await.unwrap();
        let mut reader = spool.reader().await.unwrap();
        assert!(reader.next_batch().await.unwrap().is_none());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
