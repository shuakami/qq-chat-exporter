use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use percent_encoding::percent_decode_str;
use qce_exporter::modern_html_exporter::{
    HtmlExportOptions, HtmlMergeMessage, InlineHtmlRecord, ModernHtmlExporter,
};
use qce_exporter::types::ChatInfo;
use serde_json::Value;

use super::{
    avatar_url, ext_of, merge_resource_files, merge_source_messages, rewrite_merged_resource_paths,
    valid_export_file_name, MergeGroup, MergeSource,
};
use crate::api::path_security::{
    open_verified_file, resolve_existing_within, valid_relative_resource_path,
};

const MANIFEST: &str = "<script>window.__QCE_MANIFEST__ && window.__QCE_MANIFEST__(";
const CHUNK: &str = "<script>window.__QCE_CHUNK__ && window.__QCE_CHUNK__({id:";
const ASSET_TYPES: [&str; 4] = ["images", "videos", "audios", "files"];

pub(super) struct HtmlMergeResult {
    pub html_path: PathBuf,
    pub messages: usize,
    pub deduplicated: usize,
    pub resources: usize,
    pub missing_resources: usize,
    pub missing_examples: Vec<String>,
}

struct Backup {
    directory: PathBuf,
    file_name: String,
    resources: String,
    records: Vec<InlineHtmlRecord>,
}

fn read_backup(path: &Path) -> Result<Backup, String> {
    fn invalid() -> String {
        "无法识别或读取完整的 QCE 单文件 HTML 备份".to_owned()
    }

    let manifest;
    let mut lines = BufReader::new(open_verified_file(path).map_err(|_| invalid())?).lines();
    loop {
        let line = lines.next().ok_or_else(invalid)?.map_err(|_| invalid())?;
        if let Some(wrapper) = line.trim().strip_prefix(MANIFEST) {
            manifest =
                serde_json::from_str::<Value>(wrapper.strip_suffix(");").ok_or_else(invalid)?)
                    .map_err(|_| invalid())?;
            break;
        }
    }
    if manifest["format"] != "qce-modern-html-chunked" || manifest["version"] != 1 {
        return Err(invalid());
    }
    let resource_dir = manifest["paths"]["resourcesDir"]
        .as_str()
        .unwrap_or("resources");
    if !valid_export_file_name(resource_dir)
        || !(resource_dir == "resources" || resource_dir.starts_with("resources_"))
    {
        return Err(invalid());
    }
    let chunks = manifest["chunks"].as_array().ok_or_else(invalid)?;
    let mut records = Vec::new();
    for expected in chunks {
        // Each original export writes its chunk header, records, and footer
        // on separate lines. The script bodies are never run.
        let header = lines.next().ok_or_else(invalid)?.map_err(|_| invalid())?;
        if header.trim() != "</script>" {
            return Err(invalid());
        }
        let line = lines.next().ok_or_else(invalid)?.map_err(|_| invalid())?;
        let chunk_id = line
            .trim()
            .strip_prefix(CHUNK)
            .and_then(|line| line.strip_suffix(",messages:["))
            .and_then(|value| serde_json::from_str::<String>(value).ok())
            .ok_or_else(invalid)?;
        if expected["id"] != chunk_id {
            return Err(invalid());
        }
        let first = records.len();
        for line in lines.by_ref() {
            let line = line.map_err(|_| invalid())?;
            let line = line.trim();
            if line == "]});" {
                break;
            }
            let record: InlineHtmlRecord =
                serde_json::from_str(line.strip_suffix(',').unwrap_or(line))
                    .map_err(|_| invalid())?;
            if !record.id.starts_with("msg-")
                || (!record.date.is_empty()
                    && chrono::NaiveDate::parse_from_str(&record.date, "%Y-%m-%d").is_err())
            {
                return Err(invalid());
            }
            records.push(record);
        }
        if expected["count"].as_u64() != Some((records.len() - first) as u64) {
            return Err(invalid());
        }
    }
    if lines.next().and_then(Result::ok).as_deref().map(str::trim) != Some("</script>")
        || manifest["stats"]["totalMessages"].as_u64() != Some(records.len() as u64)
    {
        return Err(invalid());
    }
    Ok(Backup {
        directory: path.parent().ok_or_else(invalid)?.to_path_buf(),
        file_name: path
            .file_name()
            .ok_or_else(invalid)?
            .to_string_lossy()
            .into_owned(),
        resources: resource_dir.to_owned(),
        records,
    })
}

#[derive(Default)]
struct MediaFiles {
    files: HashMap<PathBuf, Option<String>>,
    copied: usize,
    missing: usize,
    missing_examples: Vec<String>,
}

fn copy_resource(source: &Path, root: &Path, destination: &Path) -> Option<()> {
    let source = resolve_existing_within(source, &[root.to_path_buf()])?;
    if !source.is_file() {
        return None;
    }
    let mut file = open_verified_file(&source).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .ok()?;
    if std::io::copy(&mut file, &mut output).is_err() {
        drop(output);
        let _ = fs::remove_file(destination);
        return None;
    }
    Some(())
}

fn is_inline_media(tag: &str, url: &str) -> bool {
    let Some((header, _)) = url.split_once(',') else {
        return false;
    };
    let Some(mime) = header
        .strip_prefix("data:")
        .and_then(|header| header.strip_suffix(";base64"))
    else {
        return false;
    };
    match tag {
        "img" => mime.starts_with("image/"),
        "video" | "audio" | "source" | "div" => {
            mime.starts_with("video/") || mime.starts_with("audio/")
        }
        _ => false,
    }
}

fn clean_records(
    backup: &Backup,
    records: &mut [InlineHtmlRecord],
    stage: &Path,
    resource_name: &str,
    files: &Arc<Mutex<MediaFiles>>,
) {
    let media_root = backup.directory.join(&backup.resources);
    let root = resolve_existing_within(&media_root, std::slice::from_ref(&backup.directory))
        .filter(|root| *root == media_root);
    let resource_prefix = format!("{}/", backup.resources);
    let resource_name = resource_name.to_owned();
    let destination = stage.join(&resource_name);
    let backup_name = backup.file_name.clone();
    let files = Arc::clone(files);
    let mut sanitizer = ammonia::Builder::default();
    sanitizer
        .add_tags(["button", "video", "audio", "source", "svg", "path", "rect", "polyline", "line", "circle"])
        .add_generic_attributes([
            "id", "class", "title", "role", "tabindex", "aria-label", "aria-hidden", "aria-expanded",
            "data-date", "data-label", "data-sender-uid", "data-reply-to", "data-native-type",
        ])
        .add_tag_attributes("div", ["data-src", "data-name"])
        .add_tag_attributes("button", ["type", "data-count"])
        .add_tag_attributes("img", ["loading", "referrerpolicy", "onclick", "onerror", "data-fallback-url"])
        .add_tag_attributes("a", ["download", "target"])
        .add_tag_attributes("video", ["src", "preload", "muted", "playsinline", "controls", "poster"])
        .add_tag_attributes("audio", ["src", "preload", "controls"])
        .add_tag_attributes("source", ["src", "type"])
        .add_tag_attributes("svg", ["viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"])
        .add_tag_attributes("path", ["d"])
        .add_tag_attributes("rect", ["x", "y", "width", "height", "rx"])
        .add_tag_attributes("polyline", ["points"])
        .add_tag_attributes("line", ["x1", "x2", "y1", "y2"])
        .add_tag_attributes("circle", ["cx", "cy", "r"])
        .add_generic_attributes(["style"])
        .filter_style_properties(["display", "height", "width", "background-color"].into())
        .url_schemes(HashSet::from(["https", "http", "data", "mailto"]))
        .attribute_filter(move |tag, attr, value| {
            match attr {
                "onclick" => return (value == "showImageModal(this.src)").then_some(Cow::Borrowed(value)),
                "onerror" => return matches!(
                    value,
                    "this.style.display='none'; this.nextSibling.style.display='inline-flex';"
                        | "this.replaceWith(document.createTextNode('[图片]'))"
                        | "this.parentElement.textContent=this.alt"
                        | "if(!this.dataset.fallbackTried&&this.dataset.fallbackUrl){this.dataset.fallbackTried='1';this.src=this.dataset.fallbackUrl}else{this.replaceWith(document.createTextNode(this.alt))}"
                ).then_some(Cow::Borrowed(value)),
                "target" => return (value == "_blank").then_some(Cow::Borrowed(value)),
                "src" | "href" | "data-src" | "poster" | "data-fallback-url" => {}
                _ => return Some(Cow::Borrowed(value)),
            }
            let url = value.trim();
            if tag == "a" && attr == "href" {
                // Preserve embedded attachment bytes with an inert download MIME type.
                if let Some((header, data)) = url.split_once(',') {
                    if header.starts_with("data:") && header.ends_with(";base64") {
                        return Some(Cow::Owned(format!("data:application/octet-stream;base64,{data}")));
                    }
                }
            }
            if url.starts_with("https://") || url.starts_with("http://")
                || (attr == "href" && (url.starts_with('#') || url.starts_with("mailto:")))
                || is_inline_media(tag, url)
            {
                return Some(Cow::Borrowed(url));
            }
            let url = url.strip_prefix("./").unwrap_or(url);
            let (path, suffix) = url.find(['?', '#']).map_or((url, ""), |index| url.split_at(index));
            let relative = percent_decode_str(path.strip_prefix(&resource_prefix)?)
                .decode_utf8().ok()?;
            let (kind, name) = relative.split_once('/')?;
            if !ASSET_TYPES.contains(&kind) || !valid_relative_resource_path(&relative)
                || !valid_export_file_name(name)
            {
                return None;
            }

            let source_path = media_root.join(relative.as_ref());
            let mut files = files.lock().expect("HTML merge media state");
            if let Some(mapped) = files.files.get(&source_path) {
                return mapped.as_ref().map(|path| Cow::Owned(format!("{path}{suffix}")));
            }
            let extension = ext_of(name);
            let extension = extension
                .strip_prefix('.')
                .filter(|ext| ext.len() <= 12 && ext.bytes().all(|byte| byte.is_ascii_alphanumeric()))
                .map_or("", |_| extension.as_str());
            let name_out = format!("html-{}{extension}", files.files.len() + 1);
            let copied = root.as_ref().is_some_and(|root| {
                copy_resource(&root.join(relative.as_ref()), root, &destination.join(kind).join(&name_out)).is_some()
            });
            let mapped = if copied {
                files.copied += 1;
                Some(format!("{resource_name}/{kind}/{name_out}"))
            } else {
                files.missing += 1;
                if files.missing_examples.len() < 10 {
                    files.missing_examples.push(format!("{backup_name} / {name}"));
                }
                None
            };
            let rewritten = mapped.as_ref().map(|path| Cow::Owned(format!("{path}{suffix}")));
            files.files.insert(source_path, mapped);
            rewritten
        });
    for record in records {
        record.html = sanitizer.clean(&record.html).to_string();
    }
}

fn prepare_messages(
    sources: Vec<MergeSource>,
    stage: &Path,
    resource_base: &str,
    deduplicate: bool,
) -> Result<(Vec<HtmlMergeMessage>, HtmlMergeResult), String> {
    let (json_sources, html_sources): (Vec<_>, Vec<_>) = sources
        .into_iter()
        .partition(|source| source.json_file.is_some());
    let (resources, mapping) = merge_resource_files(&json_sources, stage, resource_base)?;
    let mut messages = Vec::new();
    let mut seen = HashSet::new();
    let mut deduplicated = 0;
    let mut keep = |id: &str, ts| {
        let keep = !deduplicate || id.is_empty() || seen.insert((id.to_owned(), ts));
        deduplicated += usize::from(!keep);
        keep
    };
    if !json_sources.is_empty() {
        let (mut structured, _) = merge_source_messages(&json_sources, false)?;
        rewrite_merged_resource_paths(&mut structured, &mapping, stage, true);
        for message in structured {
            let clean = serde_json::from_value(message)
                .map_err(|_| "JSON 备份中的消息数据无效".to_owned())?;
            let message = HtmlMergeMessage::Structured(Box::new(clean));
            let (id, ts) = message.merge_key();
            if keep(id, ts) {
                messages.push(message);
            }
        }
    }

    let files = Arc::new(Mutex::new(MediaFiles::default()));
    let resource_name = format!("resources_{resource_base}");
    for source in &html_sources {
        let mut backup = read_backup(&source.html_file).map_err(|error| {
            format!(
                "{}：{error}",
                source
                    .html_file
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            )
        })?;
        let mut records = std::mem::take(&mut backup.records);
        records.retain(|record| {
            keep(
                record.id.strip_prefix("msg-").unwrap_or(&record.id),
                record.ts,
            )
        });
        clean_records(&backup, &mut records, stage, &resource_name, &files);
        messages.extend(records.into_iter().map(HtmlMergeMessage::Rendered));
    }
    messages.sort_by_key(|message| message.merge_key().1);
    let mut files = files.lock().expect("HTML merge media state");
    let result = HtmlMergeResult {
        html_path: PathBuf::new(),
        messages: messages.len(),
        deduplicated,
        resources: resources + files.copied,
        missing_resources: files.missing,
        missing_examples: std::mem::take(&mut files.missing_examples),
    };
    Ok((messages, result))
}

async fn publish_html(
    stage: &Path,
    output: &Path,
    html: &str,
    resources: &str,
) -> std::io::Result<()> {
    let asset_path = output.join(resources);
    tokio::fs::create_dir(&asset_path).await?;
    let output_path = output.join(html);
    let mut reserved_file = false;
    let result = async {
        let mut directories = tokio::fs::read_dir(stage.join(resources)).await?;
        while let Some(entry) = directories.next_entry().await? {
            tokio::fs::rename(entry.path(), asset_path.join(entry.file_name())).await?;
        }
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
            .await?;
        reserved_file = true;
        drop(file);
        tokio::fs::rename(stage.join(html), &output_path).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(&asset_path).await;
        if reserved_file {
            let _ = tokio::fs::remove_file(&output_path).await;
        }
    }
    result
}

pub(super) async fn merge_html_backups(
    group: &MergeGroup,
    output: &Path,
    html_name: &str,
    resource_base: &str,
    deduplicate: bool,
) -> Result<HtmlMergeResult, String> {
    tokio::fs::create_dir_all(output)
        .await
        .map_err(|error| format!("创建合并目录失败: {error}"))?;
    let stage = output.join(format!(".qce-html-merge-{}", uuid::Uuid::new_v4().simple()));
    tokio::fs::create_dir(&stage)
        .await
        .map_err(|error| format!("创建合并临时目录失败: {error}"))?;
    let sources = group.sources.clone();
    let stage_for_read = stage.clone();
    let resource_base_owned = resource_base.to_owned();
    let result = async {
        let (messages, mut result) = tokio::task::spawn_blocking(move || {
            prepare_messages(sources, &stage_for_read, &resource_base_owned, deduplicate)
        })
        .await
        .map_err(|_| "读取备份失败".to_owned())??;
        let resources = format!("resources_{resource_base}");
        let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
            output_path: stage.join(html_name),
            resource_dir_name: Some(resources.clone()),
            exporter_version: Some(crate::version::VERSION.get().to_string()),
            ..HtmlExportOptions::default()
        });
        exporter
            .export_merged_inline(
                messages,
                &ChatInfo {
                    name: group.display_name.clone(),
                    chat_type: group.chat_type.clone(),
                    avatar: group
                        .chat_id
                        .as_deref()
                        .and_then(|id| avatar_url(&group.chat_type, id)),
                    peer_uid: group.chat_id.clone(),
                    ..ChatInfo::default()
                },
            )
            .await
            .map_err(|error| {
                format!("生成合并 HTML 失败: {}", super::export_error_reason(&error))
            })?;
        publish_html(&stage, output, html_name, &resources)
            .await
            .map_err(|error| format!("保存合并 HTML 失败: {error}"))?;
        result.html_path = output.join(html_name);
        Ok(result)
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&stage).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn merges_overlapping_html_backups_and_reports_missing_media() {
        let root =
            std::env::temp_dir().join(format!("qce-html-merge-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let output = root.join("output");
        let chat = ChatInfo {
            name: "test".into(),
            chat_type: "group".into(),
            ..ChatInfo::default()
        };
        let mut group = MergeGroup {
            chat_type: chat.chat_type.clone(),
            chat_id: None,
            display_name: chat.name.clone(),
            file_names: Vec::new(),
            sources: Vec::new(),
        };
        let message = |id: u32, kind, file_name| {
            serde_json::from_value(json!({
                "id": id.to_string(), "timestamp": 1_730_000_000_000_i64 + i64::from(id),
                "sender": { "uid": "1", "name": "test" },
                "content": { "elements": [{ "type": kind, "data": { "filename": file_name, "text": "text" } }] }
            })).unwrap()
        };
        for (directory, messages) in [
            (
                "first",
                vec![message(1, "image", "kept.png"), message(2, "text", "")],
            ),
            (
                "second",
                vec![message(2, "text", ""), message(3, "video", "missing.mp4")],
            ),
        ] {
            let directory = root.join(directory);
            fs::create_dir_all(&directory).unwrap();
            let html = directory.join("backup.html");
            let media = directory.join("resources");
            let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
                output_path: html.clone(),
                include_resource_links: true,
                ..HtmlExportOptions::default()
            });
            exporter
                .export_single_inline(&messages, &chat)
                .await
                .unwrap();
            if messages[0].id == "1" {
                fs::create_dir_all(media.join("images")).unwrap();
                fs::write(media.join("images/kept.png"), b"image fixture").unwrap();
            }
            group.sources.push(MergeSource {
                html_file: html,
                json_file: None,
                resource_dir: media,
            });
        }
        let result = merge_html_backups(&group, &output, "merged.html", "merged", true)
            .await
            .unwrap();
        assert_eq!(
            (
                result.messages,
                result.deduplicated,
                result.resources,
                result.missing_resources
            ),
            (3, 1, 1, 1)
        );
        assert_eq!(result.missing_examples, ["backup.html / missing.mp4"]);
        let records = read_backup(&result.html_path).unwrap().records;
        assert_eq!(
            records
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            ["msg-1", "msg-2", "msg-3"]
        );
        assert!(records[0]
            .html
            .contains("src=\"resources_merged/images/html-1.png\""));
        assert_eq!(
            fs::read(output.join("resources_merged/images/html-1.png")).unwrap(),
            b"image fixture"
        );
        assert!(group
            .sources
            .iter()
            .all(|source| source.html_file.is_file()));
        fs::remove_dir_all(root).unwrap();
    }
}
