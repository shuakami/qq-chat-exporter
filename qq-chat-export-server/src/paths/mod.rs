use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// 路径校验错误。
#[derive(Debug, thiserror::Error)]
pub enum PathError {
    /// 命中系统关键目录黑名单。
    #[error("禁止访问系统关键目录")]
    DangerousPath,
}

/// 路径管理器：应用数据位于 `~/.qq-chat-exporter`，导出文件位于用户文档目录。
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
        let normalized_input = sanitized.replace('\\', "/").to_lowercase();
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
            || normalized_input == "/etc"
            || normalized_input.starts_with("/etc/")
            || normalized_input == "/bin"
            || normalized_input.starts_with("/bin/")
            || normalized_input == "/usr/bin"
            || normalized_input.starts_with("/usr/bin/")
            || normalized_input == "/sbin"
            || normalized_input.starts_with("/sbin/")
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

    /// 默认导出根目录，与程序和内部数据库分开保存。
    pub fn default_export_root_dir(&self) -> PathBuf {
        dirs::document_dir()
            .unwrap_or_else(Self::user_home)
            .join("QQChatExporter")
    }

    /// 导出目录。
    pub fn exports_dir(&self) -> PathBuf {
        if let Ok(guard) = self.custom_output_dir.read() {
            if let Some(dir) = guard.as_ref() {
                return dir.clone();
            }
        }
        self.default_export_root_dir().join("exports")
    }

    /// 定时导出目录。
    pub fn scheduled_exports_dir(&self) -> PathBuf {
        if let Ok(guard) = self.custom_scheduled_export_dir.read() {
            if let Some(dir) = guard.as_ref() {
                return dir.clone();
            }
        }
        self.default_export_root_dir().join("scheduled-exports")
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

    /// 把旧版默认目录中的导出文件移动到新的独立数据目录。
    pub async fn migrate_legacy_export_dirs(&self) -> io::Result<()> {
        let mut migrations = Vec::with_capacity(5);
        if self
            .custom_output_dir
            .read()
            .is_ok_and(|guard| guard.is_none())
        {
            let exports_dir = self.default_export_root_dir().join("exports");
            migrations.push((self.default_base_dir().join("exports"), exports_dir.clone()));
            migrations.push((
                self.default_base_dir().join("group-files"),
                exports_dir.join("group-files"),
            ));
            migrations.push((
                self.default_base_dir().join("group-albums"),
                exports_dir.join("group-albums"),
            ));
            migrations.push((
                self.default_base_dir().join("sticker-packs"),
                exports_dir.join("sticker-packs"),
            ));
        }
        if self
            .custom_scheduled_export_dir
            .read()
            .is_ok_and(|guard| guard.is_none())
        {
            migrations.push((
                self.default_base_dir().join("scheduled-exports"),
                self.default_export_root_dir().join("scheduled-exports"),
            ));
        }

        tokio::task::spawn_blocking(move || {
            for (source, destination) in migrations {
                move_directory_contents(&source, &destination)?;
            }
            Ok(())
        })
        .await
        .map_err(io::Error::other)?
    }
}

fn move_directory_contents(source: &Path, destination: &Path) -> io::Result<()> {
    if !source.exists() {
        return Ok(());
    }
    if !destination.exists() {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if std::fs::rename(source, destination).is_ok() {
            return Ok(());
        }
    }

    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if destination_path.exists() {
            if source_path.is_dir() && destination_path.is_dir() {
                move_directory_contents(&source_path, &destination_path)?;
                continue;
            }
            move_path(&source_path, &next_available_path(&destination_path))?;
        } else {
            move_path(&source_path, &destination_path)?;
        }
    }

    if std::fs::read_dir(source)?.next().is_none() {
        std::fs::remove_dir(source)?;
    }
    Ok(())
}

fn move_path(source: &Path, destination: &Path) -> io::Result<()> {
    if std::fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    if source.is_dir() {
        move_directory_contents(source, destination)
    } else {
        std::fs::copy(source, destination)?;
        std::fs::remove_file(source)
    }
}

fn next_available_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1.. {
        let file_name = extension.map_or_else(
            || format!("{stem}_legacy_{index}"),
            |extension| format!("{stem}_legacy_{index}.{extension}"),
        );
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
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

    #[test]
    fn default_exports_are_separate_from_internal_data() {
        let pm = PathManager::new();
        assert!(!pm.exports_dir().starts_with(pm.default_base_dir()));
        assert!(!pm
            .scheduled_exports_dir()
            .starts_with(pm.default_base_dir()));
    }

    #[test]
    fn migration_preserves_conflicting_files() {
        let root = std::env::temp_dir().join(format!(
            "qce-path-migration-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ));
        let source = root.join("legacy");
        let destination = root.join("current");
        std::fs::create_dir_all(&source).expect("legacy directory should be created");
        std::fs::create_dir_all(&destination).expect("current directory should be created");
        std::fs::write(source.join("chat.html"), "legacy").expect("legacy file should be written");
        std::fs::write(destination.join("chat.html"), "current")
            .expect("current file should be written");

        move_directory_contents(&source, &destination).expect("migration should succeed");

        assert_eq!(
            std::fs::read_to_string(destination.join("chat.html"))
                .expect("current file should remain"),
            "current"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("chat_legacy_1.html"))
                .expect("legacy file should be preserved"),
            "legacy"
        );
        assert!(!source.exists());
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
