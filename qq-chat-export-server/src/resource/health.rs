use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

use crate::storage::ResourceInfo;

/// 健康检查缓存有效期（30 分钟）。
pub const RESOURCE_HEALTH_CACHE_MS: u64 = 30 * 60 * 1000;

/// 单条缓存记录。
#[derive(Debug, Clone, Copy)]
struct HealthCacheEntry {
    healthy: bool,
    checked_at: Instant,
    md5_verified: bool,
}

/// 资源健康检查器。
#[derive(Debug, Default)]
pub struct ResourceHealthChecker {
    cache: Mutex<HashMap<String, HealthCacheEntry>>,
}

impl ResourceHealthChecker {
    /// 创建检查器。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 检查资源健康状态。
    pub async fn check_health(
        &self,
        resource: &ResourceInfo,
        verify_md5: bool,
        cache_duration_ms: u64,
    ) -> bool {
        let cache_duration = Duration::from_millis(cache_duration_ms);
        let cache_key = health_cache_key(resource);
        if let Some(cache_key) = cache_key.as_ref() {
            let cache = self.cache.lock().await;
            if let Some(entry) = cache.get(cache_key) {
                if entry.checked_at.elapsed() < cache_duration
                    && (!verify_md5 || entry.md5_verified)
                {
                    return entry.healthy;
                }
            }
        }

        let mut healthy = false;
        if let Some(local_path) = resource.local_path.as_deref().filter(|p| !p.is_empty()) {
            if let Ok(metadata) = tokio::fs::metadata(local_path).await {
                let expected_size = resource.file_size.unwrap_or(0);
                let actual_size = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
                healthy = actual_size > 0 && (expected_size == 0 || actual_size == expected_size);
                if healthy && verify_md5 && !resource.md5.is_empty() {
                    match calculate_file_md5(Path::new(local_path)).await {
                        Ok(file_md5) => healthy = file_md5 == resource.md5,
                        Err(_) => healthy = false,
                    }
                }
            }
        }

        if let Some(cache_key) = cache_key {
            let mut cache = self.cache.lock().await;
            cache.insert(
                cache_key,
                HealthCacheEntry {
                    healthy,
                    checked_at: Instant::now(),
                    md5_verified: verify_md5,
                },
            );
        }
        healthy
    }

    /// 清理缓存。
    pub async fn cleanup(&self) {
        self.cache.lock().await.clear();
    }
}

fn health_cache_key(resource: &ResourceInfo) -> Option<String> {
    if !resource.md5.is_empty() {
        return Some(format!("md5:{}", resource.md5));
    }
    resource
        .local_path
        .as_deref()
        .filter(|path| !path.is_empty())
        .map(|path| format!("path:{path}"))
}

/// 流式计算文件 MD5（64KB 缓冲，不整读进内存）。
pub async fn calculate_file_md5(path: &Path) -> std::io::Result<String> {
    use md5::{Digest, Md5};
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Md5::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value};

    use super::*;

    fn resource(local_path: String) -> ResourceInfo {
        ResourceInfo {
            md5: String::new(),
            resource_type: "image".to_string(),
            original_url: String::new(),
            local_path: Some(local_path),
            file_name: None,
            file_size: None,
            mime_type: None,
            accessible: false,
            status: "pending".to_string(),
            checked_at: Value::Null,
            download_attempts: None,
            last_error: None,
            extra: Map::new(),
        }
    }

    #[tokio::test]
    async fn empty_md5_resources_do_not_share_health_cache_entries() {
        let root = std::env::temp_dir().join(format!("qce-health-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create temp dir");
        let existing = root.join("existing.bin");
        tokio::fs::write(&existing, b"ok")
            .await
            .expect("write fixture");
        let missing = root.join("missing.bin");

        let checker = ResourceHealthChecker::new();
        assert!(
            checker
                .check_health(
                    &resource(existing.to_string_lossy().into_owned()),
                    false,
                    RESOURCE_HEALTH_CACHE_MS,
                )
                .await
        );
        assert!(
            !checker
                .check_health(
                    &resource(missing.to_string_lossy().into_owned()),
                    false,
                    RESOURCE_HEALTH_CACHE_MS,
                )
                .await
        );

        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove temp dir");
    }
}
