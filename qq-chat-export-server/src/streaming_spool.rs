use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};

const SPOOL_PREFIX: &str = ".qce-stream-spool-";
const STALE_SPOOL_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// 超大导出的磁盘暂存区。
///
/// 每一批原始消息立即写成 JSONL，内存中只保留当前批次。正常完成、失败或取消
/// 时主动清理；Drop 再做一次异步兜底。进程异常退出时留下的暂存目录会在下次
/// 创建流式任务时按固定前缀和修改时间清理，避免原始聊天数据长期残留。
pub struct StreamingMessageSpool {
    root: PathBuf,
    raw_dir: PathBuf,
    raw_files: Vec<PathBuf>,
}

impl StreamingMessageSpool {
    pub async fn create(output_dir: &Path, task_id: &str) -> Result<Self, String> {
        let safe_task_id: String = task_id
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .take(80)
            .collect();
        let root = output_dir.join(format!("{SPOOL_PREFIX}{safe_task_id}"));
        cleanup_stale_spools(output_dir, &root).await;
        if tokio::fs::try_exists(&root).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(&root)
                .await
                .map_err(|error| format!("清理旧流式暂存目录失败: {error}"))?;
        }
        let raw_dir = root.join("raw");
        tokio::fs::create_dir_all(&raw_dir)
            .await
            .map_err(|error| format!("创建原始消息暂存目录失败: {error}"))?;
        Ok(Self {
            root,
            raw_dir,
            raw_files: Vec::new(),
        })
    }

    pub async fn push_raw_batch<T: Serialize>(&mut self, items: &[T]) -> Result<(), String> {
        let index = self.raw_files.len() + 1;
        let path = self.raw_dir.join(format!("batch-{index:06}.jsonl"));
        write_jsonl(&path, items).await?;
        self.raw_files.push(path);
        Ok(())
    }

    /// QQ 历史分页通常由新到旧返回；倒序处理批次，再对批次内部按时间排序，
    /// 可以在不进行全量内存排序的情况下恢复为旧到新的导出顺序。
    #[must_use]
    pub fn raw_files_oldest_first(&self) -> Vec<PathBuf> {
        self.raw_files.iter().rev().cloned().collect()
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
        let root = self.root.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = tokio::fs::remove_dir_all(root).await;
            });
        } else {
            let _ = std::fs::remove_dir_all(root);
        }
    }
}

async fn cleanup_stale_spools(output_dir: &Path, current_root: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(output_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path == current_root {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(SPOOL_PREFIX) {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let stale = metadata
            .modified()
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_SPOOL_AGE);
        if stale {
            if let Err(error) = tokio::fs::remove_dir_all(&path).await {
                tracing::warn!(
                    "[StreamingSpool] 清理过期暂存目录失败 {}: {error}",
                    path.display()
                );
            }
        }
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

    use super::{read_jsonl, StreamingMessageSpool, SPOOL_PREFIX};

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

    #[tokio::test]
    async fn leaves_recent_foreign_spool_untouched() {
        let root = std::env::temp_dir().join(format!(
            "qce-streaming-spool-cleanup-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&root).await.expect("create root");
        let recent = root.join(format!("{SPOOL_PREFIX}recent"));
        tokio::fs::create_dir_all(&recent)
            .await
            .expect("create recent spool");

        let spool = StreamingMessageSpool::create(&root, "current")
            .await
            .expect("create current spool");
        assert!(tokio::fs::try_exists(&recent).await.expect("check recent"));

        spool.cleanup().await;
        drop(spool);
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
