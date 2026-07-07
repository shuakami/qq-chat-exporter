use crate::base::ms_to_iso;
use crate::error::{ExportError, ExportResultT};
use crate::stream_utils::{BufferedTextWriter, DEFAULT_FLUSH_THRESHOLD};
use serde::Serialize;
use std::path::PathBuf;

/// chunk 元信息（对应 TS `ChunkedJsonlChunkInfo`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkedJsonlChunkInfo {
    /// 从 1 开始的序号。
    pub index: usize,
    /// 文件名，例如 `c000001.jsonl`。
    pub file_name: String,
    /// manifest 引用的相对路径，例如 `chunks/c000001.jsonl`。
    pub relative_path: String,
    /// chunk 开始时间（ISO），可能为空串。
    pub start: String,
    /// chunk 结束时间（ISO），可能为空串。
    pub end: String,
    /// chunk 消息数。
    pub count: u64,
    /// chunk 写入字节数。
    pub bytes: u64,
    /// chunk 开始时间戳（ms）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_ts_ms: Option<i64>,
    /// chunk 结束时间戳（ms）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ts_ms: Option<i64>,
}

/// 写入器配置（对应 TS `ChunkedJsonlWriterOptions`）。
pub struct ChunkedJsonlWriterOptions {
    /// chunk 输出目录（绝对路径）。
    pub chunks_dir: PathBuf,
    /// manifest 引用用的 chunks 相对目录名。
    pub chunks_dir_name_for_manifest: String,
    /// 每个 chunk 最多消息数，0=不限。
    pub max_messages: u64,
    /// 每个 chunk 最大字节数，0=不限。
    pub max_bytes: u64,
    /// chunk 文件命名函数（只返回文件名，不含目录）。
    pub get_chunk_file_name: Box<dyn Fn(usize) -> String + Send + Sync>,
    /// 内部写入缓冲阈值（字节，默认 1 MiB）。
    pub writer_buffer_bytes: usize,
}

struct CurrentChunk {
    writer: BufferedTextWriter,
    index: usize,
    file_name: String,
    count: u64,
    bytes: u64,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
}

/// chunked-jsonl 写入器。
pub struct ChunkedJsonlWriter {
    opts: ChunkedJsonlWriterOptions,
    chunks: Vec<ChunkedJsonlChunkInfo>,
    current: Option<CurrentChunk>,
}

impl ChunkedJsonlWriter {
    /// 新建写入器并确保 chunks 目录存在。
    pub async fn new(opts: ChunkedJsonlWriterOptions) -> ExportResultT<Self> {
        tokio::fs::create_dir_all(&opts.chunks_dir)
            .await
            .map_err(|e| ExportError::io("mkdirChunksDir", &opts.chunks_dir, e))?;
        Ok(Self {
            opts,
            chunks: Vec::new(),
            current: None,
        })
    }

    /// 写入一条 JSONL 行（自动补齐 `\n`）。
    ///
    /// `ts_ms` 为消息时间戳（ms），用于 chunk 元信息；`None` 则留空。
    pub async fn write_line(&mut self, raw_line: &str, ts_ms: Option<i64>) -> ExportResultT<()> {
        let needs_newline = !raw_line.ends_with('\n');
        let line_bytes = (raw_line.len() + usize::from(needs_newline)) as u64;

        self.rotate_if_needed(line_bytes).await?;

        let current = self
            .current
            .as_mut()
            .expect("rotate_if_needed 保证已打开 chunk");

        if let Some(ts) = ts_ms {
            if ts > 0 {
                current.start_ts = Some(current.start_ts.map_or(ts, |s| s.min(ts)));
                current.end_ts = Some(current.end_ts.map_or(ts, |e| e.max(ts)));
            }
        }

        current.writer.write(raw_line).await?;
        if needs_newline {
            current.writer.write("\n").await?;
        }
        current.count += 1;
        current.bytes += line_bytes;
        Ok(())
    }

    /// 结束写入：关闭当前 chunk。
    pub async fn finalize(&mut self) -> ExportResultT<()> {
        self.close_current_chunk().await
    }

    /// 取全部 chunk 元信息。
    #[must_use]
    pub fn chunks(&self) -> &[ChunkedJsonlChunkInfo] {
        &self.chunks
    }

    /// chunks 总字节数。
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.chunks.iter().map(|c| c.bytes).sum()
    }

    async fn rotate_if_needed(&mut self, next_line_bytes: u64) -> ExportResultT<()> {
        match &self.current {
            None => self.open_new_chunk().await,
            Some(current) => {
                // 按消息数切分：写入前判断
                if self.opts.max_messages > 0 && current.count >= self.opts.max_messages {
                    self.close_current_chunk().await?;
                    return self.open_new_chunk().await;
                }
                // 按字节数切分：当前 chunk 已有内容且写入会超时切分
                if self.opts.max_bytes > 0
                    && current.count > 0
                    && current.bytes + next_line_bytes > self.opts.max_bytes
                {
                    self.close_current_chunk().await?;
                    return self.open_new_chunk().await;
                }
                Ok(())
            }
        }
    }

    async fn open_new_chunk(&mut self) -> ExportResultT<()> {
        let index = self.chunks.len() + 1;
        let file_name = (self.opts.get_chunk_file_name)(index);
        let file_path = self.opts.chunks_dir.join(&file_name);
        let writer = BufferedTextWriter::create(
            &file_path,
            if self.opts.writer_buffer_bytes == 0 {
                DEFAULT_FLUSH_THRESHOLD
            } else {
                self.opts.writer_buffer_bytes
            },
        )
        .await?;
        self.current = Some(CurrentChunk {
            writer,
            index,
            file_name,
            count: 0,
            bytes: 0,
            start_ts: None,
            end_ts: None,
        });
        Ok(())
    }

    async fn close_current_chunk(&mut self) -> ExportResultT<()> {
        let Some(current) = self.current.take() else {
            return Ok(());
        };
        current.writer.end().await?;

        let relative_path = format!(
            "{}/{}",
            self.opts.chunks_dir_name_for_manifest, current.file_name
        );

        self.chunks.push(ChunkedJsonlChunkInfo {
            index: current.index,
            file_name: current.file_name,
            relative_path,
            start: current.start_ts.map(ms_to_iso).unwrap_or_default(),
            end: current.end_ts.map(ms_to_iso).unwrap_or_default(),
            count: current.count,
            bytes: current.bytes,
            start_ts_ms: current.start_ts,
            end_ts_ms: current.end_ts,
        });
        Ok(())
    }
}
