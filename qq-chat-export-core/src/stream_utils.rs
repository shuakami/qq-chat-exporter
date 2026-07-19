use crate::error::{ExportError, ExportResultT};
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufWriter};

/// 默认写缓冲阈值为 1 MiB。
pub const DEFAULT_FLUSH_THRESHOLD: usize = 1024 * 1024;

/// 小缓冲文本写入器。
///
/// 攒批到阈值后一次性写入底层文件，避免每条消息一次写调用；
/// 全程流式，内存占用上限为 `flush_threshold + 单次写入长度`。
pub struct BufferedTextWriter {
    inner: BufWriter<File>,
    path: PathBuf,
    buffer: String,
    flush_threshold: usize,
    bytes_written: u64,
}

impl BufferedTextWriter {
    /// 创建目标文件并构造写入器（覆盖已存在文件，与 `fs.createWriteStream` 一致）。
    pub async fn create(path: &Path, flush_threshold: usize) -> ExportResultT<Self> {
        let file = File::create(path)
            .await
            .map_err(|e| ExportError::io("createWriteStream", path, e))?;
        Ok(Self {
            inner: BufWriter::new(file),
            path: path.to_owned(),
            buffer: String::new(),
            flush_threshold,
            bytes_written: 0,
        })
    }

    /// 写入文本；缓冲达到阈值时冲刷到文件。
    pub async fn write(&mut self, text: &str) -> ExportResultT<()> {
        if text.is_empty() {
            return Ok(());
        }
        self.buffer.push_str(text);
        if self.buffer.len() >= self.flush_threshold {
            self.flush_buffer().await?;
        }
        Ok(())
    }

    /// 冲刷内部字符串缓冲到底层文件。
    pub async fn flush_buffer(&mut self) -> ExportResultT<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        self.inner
            .write_all(self.buffer.as_bytes())
            .await
            .map_err(|e| ExportError::io("writeToStream", &self.path, e))?;
        self.bytes_written += self.buffer.len() as u64;
        self.buffer.clear();
        Ok(())
    }

    /// 已写入字节数（UTF-8）。
    #[must_use]
    pub fn bytes_written(&self) -> u64 {
        self.bytes_written + self.buffer.len() as u64
    }

    /// 结束写入：冲刷缓冲、同步文件并释放句柄。
    pub async fn end(mut self) -> ExportResultT<u64> {
        self.flush_buffer().await?;
        self.inner
            .flush()
            .await
            .map_err(|e| ExportError::io("endWriteStream", &self.path, e))?;
        let file = self.inner.into_inner();
        file.sync_all()
            .await
            .map_err(|e| ExportError::io("endWriteStream", &self.path, e))?;
        Ok(self.bytes_written)
    }
}

/// 让出执行权：长循环中避免饿死同 runtime 的其他任务。
pub async fn yield_to_event_loop() {
    tokio::task::yield_now().await;
}
