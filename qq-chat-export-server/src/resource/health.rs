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
        {
            let cache = self.cache.lock().await;
            if let Some(entry) = cache.get(&resource.md5) {
                if entry.checked_at.elapsed() < cache_duration && (!verify_md5 || entry.md5_verified)
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

        let mut cache = self.cache.lock().await;
        cache.insert(
            resource.md5.clone(),
            HealthCacheEntry {
                healthy,
                checked_at: Instant::now(),
                md5_verified: verify_md5,
            },
        );
        healthy
    }

    /// 清理缓存。
    pub async fn cleanup(&self) {
        self.cache.lock().await.clear();
    }
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
