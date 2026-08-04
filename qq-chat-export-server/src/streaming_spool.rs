use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};

/// 超大导出的磁盘暂存区。
///
/// 原始消息和解析后的消息分别按批次写成 JSONL。内存中只保留当前批次，
/// 任务结束时会主动清理；Drop 再做一次同步兜底，避免异常路径遗留聊天内容。
pub struct StreamingMessageSpool {
    root: PathBuf,
    raw_dir: PathBuf,
    clean_dir: PathBuf,
    raw_files: Vec<PathBuf>,
    clean_files: Vec<PathBuf>,
}

impl StreamingMessageSpool {
    pub async fn create(output_dir: &Path, task_id: &str) -> Result<Self, String> {
        let safe_task_id: String = task_id
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .take(80)
            .collect();
        let root = output_dir.join(format!(".qce-stream-spool-{safe_task_id}"));
        if tokio::fs::try_exists(&root).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(&root)
                .await
                .map_err(|error| format!("清理旧流式暂存目录失败: {error}"))?;
        }
        let raw_dir = root.join("raw");
        let clean_dir = root.join("clean");
        tokio::fs::create_dir_all(&raw_dir)
            .await
            .map_err(|error| format!("创建原始消息暂存目录失败: {error}"))?;
        tokio::fs::create_dir_all(&clean_dir)
            .await
            .map_err(|error| format!("创建解析消息暂存目录失败: {error}"))?;
        Ok(Self {
            root,
            raw_dir,
            clean_dir,
            raw_files: Vec::new(),
            clean_files: Vec::new(),
        })
    }

    pub async fn push_raw_batch<T: Serialize>(&mut self, items: &[T]) -> Result<(), String> {
        let index = self.raw_files.len() + 1;
        let path = self.raw_dir.join(format!("batch-{index:06}.jsonl"));
        write_jsonl(&path, items).await?;
        self.raw_files.push(path);
        Ok(())
    }

    pub async fn push_clean_batch<T: Serialize>(&mut self, items: &[T]) -> Result<(), String> {
        if items.is_empty() {
            return Ok(());
        }
        let index = self.clean_files.len() + 1;
        let path = self.clean_dir.join(format!("batch-{index:06}.jsonl"));
        write_jsonl(&path, items).await?;
        self.clean_files.push(path);
        Ok(())
    }

    /// QQ 历史分页通常由新到旧返回；倒序处理批次，再对批次内部按时间排序，
    /// 可以在不进行全量内存排序的情况下恢复为旧到新的导出顺序。
    #[must_use]
    pub fn raw_files_oldest_first(&self) -> Vec<PathBuf> {
        self.raw_files.iter().rev().cloned().collect()
    }

    #[must_use]
    pub fn clean_files(&self) -> &[PathBuf] {
        &self.clean_files
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub async fn cleanup(&self) {
        if let Err(error) = tokio::fs::remove_dir_all(&self.root).await {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("[StreamingSpool] 清理暂存目录失败: {error}");
            }
        }
    }
}

impl Drop for StreamingMessageSpool {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub async fn read_jsonl<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("读取暂存批次失败 {}: {error}", path.display()))?;
    let mut lines = BufReader::new(file).lines();
    let mut items = Vec::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("读取暂存批次失败 {}: {error}", path.display()))?
    {
        if line.trim().is_empty() {
            continue;
        }
        let item = serde_json::from_str(&line)
            .map_err(|error| format!("解析暂存批次失败 {}: {error}", path.display()))?;
        items.push(item);
    }
    Ok(items)
}

async fn write_jsonl<T: Serialize>(path: &Path, items: &[T]) -> Result<(), String> {
    let file = tokio::fs::File::create(path)
        .await
        .map_err(|error| format!("创建暂存批次失败 {}: {error}", path.display()))?;
    let mut writer = BufWriter::new(file);
    for item in items {
        let line = serde_json::to_vec(item)
            .map_err(|error| format!("序列化暂存批次失败 {}: {error}", path.display()))?;
        writer
            .write_all(&line)
            .await
            .map_err(|error| format!("写入暂存批次失败 {}: {error}", path.display()))?;
        writer
            .write_all(b"\n")
            .await
            .map_err(|error| format!("写入暂存批次失败 {}: {error}", path.display()))?;
    }
    writer
        .flush()
        .await
        .map_err(|error| format!("刷新暂存批次失败 {}: {error}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{read_jsonl, StreamingMessageSpool};

    #[tokio::test]
    async fn stores_batches_on_disk_and_reverses_fetch_order() {
        let root = std::env::temp_dir().join(format!(
            "qce-streaming-spool-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&root).await.expect("create root");
        let mut spool = StreamingMessageSpool::create(&root, "task-1")
            .await
            .expect("create spool");
        spool
            .push_raw_batch(&[json!({"msgId": "new"})])
            .await
            .expect("write newest");
        spool
            .push_raw_batch(&[json!({"msgId": "old"})])
            .await
            .expect("write oldest");

        let paths = spool.raw_files_oldest_first();
        let first: Vec<Value> = read_jsonl(&paths[0]).await.expect("read oldest");
        assert_eq!(first[0]["msgId"], "old");

        spool.cleanup().await;
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}