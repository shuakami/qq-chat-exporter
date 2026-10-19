//! QQ 本地聊天记录缓存扫描与媒体回退。
//!
//! 背景：QCE 通过 NapCat bridge 下载消息媒体。当 bridge 返回空路径
//! （错误信息形如 `video资源API返回空路径且无法找到有效的下载文件`）时，
//! 视频 / 语音 / 文件会整批丢失——即便这些文件其实早已存在于本机 QQ
//! 客户端的本地缓存 `nt_data` 目录里（它们本就是用户"已下载"的资源）。
//!
//! 本模块直接扫描本机 QQ 客户端缓存目录，按 md5（或文件名 / 目录前缀）
//! 找回原始文件，作为 NapCat 下载失败时的兜底，使"本地已下载的视频 /
//! 语音 / 文件"也能被正常导出。
//!
//! QQ 客户端 NT 版缓存布局（`<Tencent Files>\<uin>\nt_qq\nt_data`）：
//! - 视频：`Video\<yyyy-MM>\Ori\<md5>.mp4`（缩略图 `Thumb\<md5>_0.png`）
//! - 语音：`Ptt\<yyyy-MM>\Ori\<md5>.amr`
//! - 文件：`File\<...>\<md5>_<uuid>\<原文件名>`
//! - 图片：`Pic\<...>\<md5>.<ext>`

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

/// 在盘符根目录下探测 "Tencent Files" 容器目录的最大深度。
/// 覆盖 `<盘>:\Tencent Files` 与 `<盘>:\<任意目录>\Tencent Files`。
const BASE_SEARCH_DEPTH: usize = 2;
/// 在 "Tencent Files" 容器下探测 `nt_data` 的最大深度：
/// `Tencent Files\<uin>\nt_qq\nt_data`。
const NT_DATA_SEARCH_DEPTH: usize = 3;

/// 视频扩展名（小写，含点）。
const VIDEO_EXTS: [&str; 6] = [".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv"];
/// 语音扩展名（小写，含点；含 QQ 原始 silk 容器）。
const AUDIO_EXTS: [&str; 7] = [".amr", ".silk", ".slk", ".wav", ".mp3", ".ogg", ".m4a"];

/// 盘符浅扫时跳过的系统顶层目录（小写）。
const SKIP_TOP_DIRS: [&str; 10] = [
    "windows",
    "program files",
    "program files (x86)",
    "$recycle.bin",
    "system volume information",
    "perflogs",
    "recovery",
    "programdata",
    "appdata",
    "intel",
];

/// 探测本机全部 QQ `nt_data` 缓存目录。
///
/// 探测顺序（结果去重）：
/// 1. 环境变量 `QCE_QQ_DATA_ROOT` / `QCE_QQ_DATA_ROOTS`（`;` 分隔，用户可自行指定）；
/// 2. 用户主目录下 `Documents\Tencent Files` 等常见位置；
/// 3. 各盘符浅扫（深度 [`BASE_SEARCH_DEPTH`]）找到的 `Tencent Files` 容器。
#[must_use]
pub fn detect_nt_data_dirs() -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();

    // 1. 环境变量显式指定（视为用户手动配置）
    for key in ["QCE_QQ_DATA_ROOT", "QCE_QQ_DATA_ROOTS"] {
        if let Ok(raw) = std::env::var(key) {
            for part in raw.split(';') {
                let trimmed = part.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let path = PathBuf::from(trimmed);
                if path.is_dir() {
                    push_unique(&mut bases, path);
                }
            }
        }
    }

    // 2. 用户主目录常见位置
    if let Some(home) = user_home() {
        for rel in [
            "Documents/Tencent Files",
            "Documents/腾讯文件",
            "文档/Tencent Files",
        ] {
            let candidate = home.join(rel);
            if candidate.is_dir() {
                push_unique(&mut bases, candidate);
            }
        }
    }

    // 3. 各盘符浅扫
    for disk in disk_roots() {
        for base in find_tencent_files_dirs(&disk) {
            push_unique(&mut bases, base);
        }
    }

    let mut nt_data_dirs: Vec<PathBuf> = Vec::new();
    for base in &bases {
        collect_nt_data_dirs(base, &mut nt_data_dirs);
    }
    nt_data_dirs
}

/// 把用户指定的路径展开为 `nt_data` 目录集合。
///
/// 用户可能填 `Tencent Files` 容器目录、某账号目录、或直接的 `nt_data`
/// 目录，三种形态都会被正确展开。
#[must_use]
pub fn expand_to_nt_data_dirs(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for path in paths {
        collect_nt_data_dirs(path, &mut out);
    }
    out
}

/// 在给定 `nt_data` 目录集合中按 md5 / 文件名查找缓存媒体文件。
///
/// `expected_size` 为期望字节数；`> 0` 时要求缓存文件大小与之相符
/// （允许 10% 误差），否则只要求文件非空。
#[must_use]
pub fn find_cached_media(
    nt_data_dirs: &[PathBuf],
    resource_type: &str,
    md5: &str,
    file_name: &str,
    expected_size: i64,
) -> Option<PathBuf> {
    let md5 = md5.trim().to_ascii_lowercase();
    for nt_data in nt_data_dirs {
        if !nt_data.is_dir() {
            continue;
        }
        let found = match resource_type {
            "video" => find_video(nt_data, &md5),
            "audio" => find_audio(nt_data, &md5),
            "file" => find_file(nt_data, &md5, file_name),
            "image" => find_image(nt_data, &md5),
            _ => None,
        };
        if let Some(path) = found {
            if size_acceptable(&path, expected_size) {
                return Some(path);
            }
        }
    }
    None
}

/// 查找视频：`Video\<yyyy-MM>\Ori\<md5>.<ext>`，兜底深度遍历。
fn find_video(nt_data: &Path, md5: &str) -> Option<PathBuf> {
    if md5.is_empty() {
        return None;
    }
    let video_root = nt_data.join("Video");
    if !video_root.is_dir() {
        return None;
    }
    for month in read_subdirs(&video_root) {
        let ori = month.join("Ori");
        if let Some(path) = find_by_stem(&ori, md5, &VIDEO_EXTS) {
            return Some(path);
        }
    }
    find_by_stem_deep(&video_root, md5, &VIDEO_EXTS, 4)
}

/// 查找语音：`Ptt\<yyyy-MM>\Ori\<md5>.<ext>`，兜底深度遍历。
fn find_audio(nt_data: &Path, md5: &str) -> Option<PathBuf> {
    if md5.is_empty() {
        return None;
    }
    let ptt_root = nt_data.join("Ptt");
    if !ptt_root.is_dir() {
        return None;
    }
    for month in read_subdirs(&ptt_root) {
        let ori = month.join("Ori");
        if let Some(path) = find_by_stem(&ori, md5, &AUDIO_EXTS) {
            return Some(path);
        }
    }
    find_by_stem_deep(&ptt_root, md5, &AUDIO_EXTS, 4)
}

/// 查找文件：`File\...\<md5>_<uuid>\<原文件名>`（md5 在目录名前缀）。
fn find_file(nt_data: &Path, md5: &str, file_name: &str) -> Option<PathBuf> {
    let file_root = nt_data.join("File");
    if !file_root.is_dir() {
        return None;
    }
    if !md5.is_empty() {
        for entry in WalkDir::new(&file_root)
            .max_depth(6)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            if entry.file_type().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with(&md5)
            {
                if let Some(path) = pick_file_in_dir(entry.path(), file_name) {
                    return Some(path);
                }
            }
        }
    }
    if !file_name.is_empty() {
        for entry in WalkDir::new(&file_root)
            .max_depth(6)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            if entry.file_type().is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(file_name)
            {
                return Some(entry.path().to_path_buf());
            }
        }
    }
    None
}

/// 查找图片：`Pic\...\<md5>.<ext>`。
fn find_image(nt_data: &Path, md5: &str) -> Option<PathBuf> {
    if md5.is_empty() {
        return None;
    }
    let pic_root = nt_data.join("Pic");
    if !pic_root.is_dir() {
        return None;
    }
    find_by_stem_deep(&pic_root, md5, &[], 6)
}

/// 读取目录下的一级子目录。
fn read_subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.push(path);
            }
        }
    }
    out
}

/// 在目录一级内按 `<stem><ext>` 精确匹配（`exts` 为空表示任意扩展名）。
fn find_by_stem(dir: &Path, stem: &str, exts: &[&str]) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if file_matches_stem(&path, stem, exts) {
            return Some(path);
        }
    }
    None
}

/// 递归（限深）按 `<stem><ext>` 匹配。
fn find_by_stem_deep(root: &Path, stem: &str, exts: &[&str], depth: usize) -> Option<PathBuf> {
    for entry in WalkDir::new(root)
        .max_depth(depth)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_file() && file_matches_stem(entry.path(), stem, exts) {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

/// 判断文件名主干是否等于 `stem`（大小写不敏感），扩展名需在 `exts` 内（空则不限）。
fn file_matches_stem(path: &Path, stem: &str, exts: &[&str]) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let name_lower = name.to_ascii_lowercase();
    if exts.is_empty() {
        // 任意扩展名：取主干比较
        let main = name_lower
            .rsplit_once('.')
            .map_or(name_lower.as_str(), |(main, _)| main);
        return main == stem;
    }
    for ext in exts {
        let expected = format!("{stem}{ext}");
        if name_lower == expected {
            return true;
        }
    }
    false
}

/// 在目录内挑选文件：优先与 `prefer_name` 同名者，否则取第一个非空文件。
fn pick_file_in_dir(dir: &Path, prefer_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut fallback: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !prefer_name.is_empty()
            && path
                .file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case(prefer_name))
                .unwrap_or(false)
        {
            return Some(path);
        }
        if fallback.is_none() && file_non_empty(&path) {
            fallback = Some(path);
        }
    }
    fallback
}

/// 文件是否存在且非空。
fn file_non_empty(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

/// 校验缓存文件大小是否可接受。
fn size_acceptable(path: &Path, expected: i64) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return false;
    }
    if expected <= 0 {
        return true;
    }
    let len = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
    if len == expected {
        return true;
    }
    let diff = (len - expected).abs();
    diff.saturating_mul(100) / expected.max(1) <= 10
}

/// 收集 `base` 下的全部 `nt_data` 目录。
fn collect_nt_data_dirs(base: &Path, out: &mut Vec<PathBuf>) {
    if !base.is_dir() {
        return;
    }
    if base
        .file_name()
        .map(|n| n.eq_ignore_ascii_case("nt_data"))
        .unwrap_or(false)
    {
        push_unique(out, base.to_path_buf());
        return;
    }
    for entry in WalkDir::new(base)
        .max_depth(NT_DATA_SEARCH_DEPTH)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_dir()
            && entry.file_name().to_string_lossy().eq_ignore_ascii_case("nt_data")
        {
            push_unique(out, entry.path().to_path_buf());
        }
    }
}

/// 在盘符根目录下浅扫 `Tencent Files` 容器目录。
fn find_tencent_files_dirs(disk: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let walker = WalkDir::new(disk)
        .max_depth(BASE_SEARCH_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() != 1 {
                return true;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            !SKIP_TOP_DIRS.contains(&name.as_str())
        });
    for entry in walker.flatten() {
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.contains("tencent files") || name.contains("tencentfiles") {
            out.push(entry.path().to_path_buf());
        }
    }
    out
}

/// 本机存在的盘符根目录。
fn disk_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", char::from(letter)));
        if root.is_dir() {
            roots.push(root);
        }
    }
    roots
}

/// 用户主目录。
fn user_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

/// 去重后压入。
fn push_unique(list: &mut Vec<PathBuf>, path: PathBuf) {
    if !list.contains(&path) {
        list.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_roots_have_windows_drive_shape() {
        for root in disk_roots() {
            let text = root.to_string_lossy();
            assert!(text.ends_with(":\\"), "unexpected disk root: {text}");
            assert_eq!(text.len(), 3);
        }
    }

    #[test]
    fn matches_stem_respects_extension() {
        assert!(file_matches_stem(
            Path::new("C:/x/abc123.mp4"),
            "abc123",
            &VIDEO_EXTS
        ));
        assert!(file_matches_stem(
            Path::new("C:/x/ABC123.MP4"),
            "abc123",
            &VIDEO_EXTS
        ));
        assert!(!file_matches_stem(
            Path::new("C:/x/abc123.png"),
            "abc123",
            &VIDEO_EXTS
        ));
        assert!(file_matches_stem(Path::new("C:/x/abc123.webp"), "abc123", &[]));
    }

    #[test]
    fn size_accepts_zero_expectation_for_nonempty_file() {
        let dir = std::env::temp_dir().join(format!(
            "qce-cache-size-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("probe.mp4");
        std::fs::write(&file, vec![0u8; 1024]).expect("write probe");
        assert!(size_acceptable(&file, 0));
        assert!(size_acceptable(&file, 1024));
        assert!(!size_acceptable(&file, 4096));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
