//! 已下载资源的紧凑索引（issue #277 / #666）。
//!
//! 导出器只需要回答两个问题：某个文件名对应的资源应该拷到 `resources/<typeDir>/`
//! 的哪个位置，以及它在磁盘上的源文件在哪里。旧实现按 `msgId → Vec<MessageResource>`
//! 保存整份资源记录，规模随消息数线性增长，且与解析后消息里的资源字段重复。
//! 这里改成按文件名去重的索引：条目数只与去重后的资源数相关，目录名做了字符串
//! 驻留，绝大多数资源共享同一个资源根目录，因此每个条目只多出文件名和类型。

use crate::base::resource_type_dir;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 资源类型编码（与 [`resource_type_dir`] 的目录约定一一对应）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResourceKind {
    Image,
    Video,
    Audio,
    File,
}

impl ResourceKind {
    fn from_type(resource_type: &str) -> Self {
        match resource_type {
            "image" => Self::Image,
            "video" => Self::Video,
            "audio" => Self::Audio,
            _ => Self::File,
        }
    }

    fn type_name(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::File => "file",
        }
    }

    fn type_dir(self) -> &'static str {
        resource_type_dir(self.type_name())
    }
}

#[derive(Debug, Clone)]
struct Entry {
    kind: ResourceKind,
    /// 源文件所在目录（驻留后的共享引用）。
    dir: Arc<Path>,
}

/// 已下载资源条目的只读视图。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadedResource {
    /// 资源类型：image / video / audio / file。
    pub resource_type: &'static str,
    /// 导出目录内的相对路径（`<typeDir>/<fileName>`）。
    pub relative_path: String,
    /// 源文件绝对路径。
    pub source_path: PathBuf,
}

/// 按文件名索引的已下载资源集合。
#[derive(Debug, Clone, Default)]
pub struct DownloadedResourceIndex {
    by_name: HashMap<String, Entry>,
    dirs: HashSet<Arc<Path>>,
}

impl DownloadedResourceIndex {
    /// 空索引。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记一个已下载资源。`local_path` 必须是源文件路径；同名文件只保留首次登记。
    /// 返回是否新增了条目。
    pub fn insert(&mut self, resource_type: &str, local_path: &str) -> bool {
        let local_path = local_path.trim();
        if local_path.is_empty() {
            return false;
        }
        let path = Path::new(local_path);
        let Some(file_name) = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            return false;
        };
        if file_name.is_empty() || self.by_name.contains_key(&file_name) {
            return false;
        }
        let dir = path.parent().unwrap_or_else(|| Path::new(""));
        let dir = match self.dirs.get(dir) {
            Some(existing) => Arc::clone(existing),
            None => {
                let shared: Arc<Path> = Arc::from(dir);
                self.dirs.insert(Arc::clone(&shared));
                shared
            }
        };
        self.by_name.insert(
            file_name,
            Entry {
                kind: ResourceKind::from_type(resource_type),
                dir,
            },
        );
        true
    }

    /// 是否没有任何条目。
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    /// 条目数（按文件名去重后）。
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_name.len()
    }

    /// 按文件名（或任意含该文件名的路径）查询导出目录内的相对路径
    /// `<typeDir>/<fileName>`。
    #[must_use]
    pub fn relative_path_for(&self, name_or_path: &str) -> Option<String> {
        let base = Path::new(name_or_path.trim())
            .file_name()?
            .to_string_lossy()
            .into_owned();
        let entry = self.by_name.get(&base)?;
        Some(format!("{}/{base}", entry.kind.type_dir()))
    }

    /// 遍历全部条目（顺序不保证）。
    pub fn iter(&self) -> impl Iterator<Item = DownloadedResource> + '_ {
        self.by_name.iter().map(|(name, entry)| DownloadedResource {
            resource_type: entry.kind.type_name(),
            relative_path: format!("{}/{name}", entry.kind.type_dir()),
            source_path: entry.dir.join(name),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedupes_by_file_name_and_shares_directories() {
        let mut index = DownloadedResourceIndex::new();
        assert!(index.insert("image", "/root/images/a.png"));
        assert!(!index.insert("image", "/other/images/a.png"));
        assert!(index.insert("file", "/root/images/b.bin"));
        assert!(!index.insert("file", "   "));
        assert_eq!(index.len(), 2);
        assert_eq!(index.dirs.len(), 1);
        assert_eq!(
            index.relative_path_for("/x/y/a.png").as_deref(),
            Some("images/a.png")
        );
        assert_eq!(
            index.relative_path_for("b.bin").as_deref(),
            Some("files/b.bin")
        );
        assert_eq!(index.relative_path_for("missing.png"), None);

        let mut entries: Vec<DownloadedResource> = index.iter().collect();
        entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        assert_eq!(entries[0].source_path, PathBuf::from("/root/images/b.bin"));
        assert_eq!(entries[1].resource_type, "image");
    }
}
