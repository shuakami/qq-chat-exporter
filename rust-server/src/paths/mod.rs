//! 路径管理（对应 TS `utils/PathManager.ts`）。

use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// 路径校验错误。
#[derive(Debug, thiserror::Error)]
pub enum PathError {
    /// 命中系统关键目录黑名单。
    #[error("禁止访问系统关键目录")]
    DangerousPath,
}

/// 路径管理器：默认基目录 `~/.qq-chat-exporter`，支持自定义导出目录。
#[derive(Debug)]
pub struct PathManager {
    custom_output_dir: RwLock<Option<PathBuf>>,
    custom_scheduled_export_dir: RwLock<Option<PathBuf>>,
}

impl Default for PathManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PathManager {
    /// 创建路径管理器。
    #[must_use]
    pub fn new() -> Self {
        Self {
            custom_output_dir: RwLock::new(None),
            custom_scheduled_export_dir: RwLock::new(None),
        }
    }

    /// 用户主目录（`USERPROFILE` / `HOME`，兜底当前目录）。
    fn user_home() -> PathBuf {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map_or_else(|| PathBuf::from("."), PathBuf::from)
    }

    /// 清理用户从文件管理器复制来的路径（去引号、去首尾空白）。
    #[must_use]
    pub fn sanitize_path(input: &str) -> String {
        let mut cleaned = input.trim();
        if (cleaned.starts_with('"') && cleaned.ends_with('"') && cleaned.len() >= 2)
            || (cleaned.starts_with('\'') && cleaned.ends_with('\'') && cleaned.len() >= 2)
        {
            cleaned = cleaned[1..cleaned.len() - 1].trim();
        }
        cleaned.to_string()
    }

    /// 校验路径：只禁止系统关键目录，允许任意其他位置。
    fn validate_path(input: &str) -> Result<PathBuf, PathError> {
        let sanitized = Self::sanitize_path(input);
        let resolved = if Path::new(&sanitized).is_absolute() {
            PathBuf::from(&sanitized)
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(&sanitized)
        };
        let normalized = resolved.to_string_lossy().replace('\\', "/").to_lowercase();
        let dangerous = normalized.contains("/windows/system32")
            || normalized.contains("/windows/syswow64")
            || normalized.starts_with("/etc/")
            || normalized.starts_with("/bin/")
            || normalized.starts_with("/usr/bin")
            || normalized.starts_with("/sbin/");
        if dangerous {
            return Err(PathError::DangerousPath);
        }
        Ok(resolved)
    }

    /// 设置自定义导出目录（`None` 表示恢复默认）。
    pub fn set_custom_output_dir(&self, dir: Option<&str>) -> Result<(), PathError> {
        let value = match dir {
            Some(d) if !d.trim().is_empty() => Some(Self::validate_path(d)?),
            _ => None,
        };
        if let Ok(mut guard) = self.custom_output_dir.write() {
            *guard = value;
        }
        Ok(())
    }

    /// 设置自定义定时导出目录（`None` 表示恢复默认）。
    pub fn set_custom_scheduled_export_dir(&self, dir: Option<&str>) -> Result<(), PathError> {
        let value = match dir {
            Some(d) if !d.trim().is_empty() => Some(Self::validate_path(d)?),
            _ => None,
        };
        if let Ok(mut guard) = self.custom_scheduled_export_dir.write() {
            *guard = value;
        }
        Ok(())
    }

    /// 默认基目录：`~/.qq-chat-exporter`。
    pub fn default_base_dir(&self) -> PathBuf {
        Self::user_home().join(".qq-chat-exporter")
    }

    /// 导出目录。
    pub fn exports_dir(&self) -> PathBuf {
        if let Ok(guard) = self.custom_output_dir.read() {
            if let Some(dir) = guard.as_ref() {
                return dir.clone();
            }
        }
        self.default_base_dir().join("exports")
    }

    /// 定时导出目录。
    pub fn scheduled_exports_dir(&self) -> PathBuf {
        if let Ok(guard) = self.custom_scheduled_export_dir.read() {
            if let Some(dir) = guard.as_ref() {
                return dir.clone();
            }
        }
        self.default_base_dir().join("scheduled-exports")
    }

    /// 资源目录。
    pub fn resources_dir(&self) -> PathBuf {
        self.default_base_dir().join("resources")
    }

    /// 数据库目录。
    pub fn database_dir(&self) -> PathBuf {
        self.default_base_dir().join("database")
    }

    /// 头像目录。
    pub fn avatars_dir(&self) -> PathBuf {
        self.exports_dir().join("avatars")
    }

    /// 确保全部目录存在。
    pub async fn ensure_all_directories_exist(&self) -> std::io::Result<()> {
        for dir in [
            self.exports_dir(),
            self.scheduled_exports_dir(),
            self.resources_dir(),
            self.database_dir(),
        ] {
            tokio::fs::create_dir_all(&dir).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_quotes() {
        assert_eq!(PathManager::sanitize_path("  \"C:/a b\"  "), "C:/a b");
        assert_eq!(PathManager::sanitize_path("'/tmp/x'"), "/tmp/x");
        assert_eq!(PathManager::sanitize_path("/plain"), "/plain");
    }

    #[test]
    fn rejects_dangerous_paths() {
        let pm = PathManager::new();
        assert!(pm.set_custom_output_dir(Some("/etc/passwd-dir")).is_err());
        assert!(pm
            .set_custom_output_dir(Some("C:\\Windows\\System32\\x"))
            .is_err());
        assert!(pm.set_custom_output_dir(Some("/home/user/exports")).is_ok());
    }
}
