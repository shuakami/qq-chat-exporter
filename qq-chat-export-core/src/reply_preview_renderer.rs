use crate::base::escape_html;
use serde_json::Value;
use std::path::Path;

/// 渲染上下文（对应 TS `ReplyPreviewRenderContext`）。
///
/// - `resource_base_href`：相对资源根（一般是 `resources`）；
/// - `lookup_data_uri`：自包含模式下把资源拉成 data URI；返回 `None` 则走相对路径；
/// - `get_face_name`：QQ 标准小表情 ID → 友好名（"/微笑" 等）。
pub struct ReplyPreviewRenderContext<'a> {
    /// 相对资源根前缀。
    pub resource_base_href: &'a str,
    /// data URI 查询：`(kind, base_name) -> Option<data URI>`。
    pub lookup_data_uri: &'a dyn Fn(&str, &str) -> Option<String>,
    /// 表情 ID → 友好名。
    pub get_face_name: &'a dyn Fn(&str) -> String,
}

fn get_str<'v>(obj: &'v Value, key: &str) -> Option<&'v str> {
    obj.get(key).and_then(Value::as_str)
}

fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 渲染单个 previewElement。返回 HTML 片段（已 escape）；类型未知或字段缺失
/// 时回退到原始 text 文案，至少不会让正文变空白。
#[must_use]
pub fn render_reply_preview_element(pe: &Value, ctx: &ReplyPreviewRenderContext<'_>) -> String {
    if !pe.is_object() {
        return String::new();
    }
    let text = get_str(pe, "text").unwrap_or("");

    match get_str(pe, "type") {
        Some("image") => {
            let local_path = get_str(pe, "localPath").unwrap_or("");
            if !local_path.is_empty() {
                let base = base_name(local_path);
                let img_src = (ctx.lookup_data_uri)("images", &base).unwrap_or_else(|| {
                    format!("{}/{}", ctx.resource_base_href, local_path)
                });
                return format!(
                    "<img src=\"{img_src}\" class=\"reply-content-thumb\" alt=\"引用图片\" loading=\"lazy\">"
                );
            }
            if let Some(origin_url) = get_str(pe, "originUrl").filter(|s| !s.is_empty()) {
                // 兜底：被引用消息不在导出范围内，但 NT 给了带签名的 originImageUrl。
                // QQ 的 URL 会过期、可能跨域；用 onerror 让浏览器在加载失败时退回到「[图片]」文本。
                return format!(
                    "<img src=\"{}\" class=\"reply-content-thumb\" alt=\"引用图片\" loading=\"lazy\" onerror=\"this.replaceWith(document.createTextNode('[图片]'))\">",
                    escape_html(origin_url)
                );
            }
            escape_html(if text.is_empty() { "[图片]" } else { text })
        }
        Some("marketFace") => {
            let url = get_str(pe, "url").unwrap_or("");
            if !url.is_empty() {
                let alt = escape_html(get_str(pe, "faceName").unwrap_or("表情"));
                return format!(
                    "<img src=\"{}\" class=\"reply-content-emoji\" alt=\"{alt}\" loading=\"lazy\">",
                    escape_html(url)
                );
            }
            escape_html(if text.is_empty() { "[表情]" } else { text })
        }
        Some("face") => {
            // 标准小表情：parser 给到 faceIndex，翻译成"/微笑"这种友好名，
            // 与主消息流里的 renderFaceElement 行为一致。
            let id = match pe.get("faceIndex") {
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::String(s)) => s.clone(),
                _ => String::new(),
            };
            let friendly = if id.is_empty() {
                String::new()
            } else {
                (ctx.get_face_name)(&id)
            };
            let label = if !friendly.is_empty() {
                friendly
            } else if !text.is_empty() {
                text.to_owned()
            } else {
                "[表情]".to_owned()
            };
            escape_html(&label)
        }
        Some("video") => {
            // 短卡片里塞不下播放器，给个 🎬 + 文件名 / 占位。
            let label = get_str(pe, "fileName")
                .filter(|s| !s.is_empty())
                .unwrap_or(if text.is_empty() { "[视频]" } else { text });
            format!(
                "<span class=\"reply-content-attachment\">🎬 {}</span>",
                escape_html(label)
            )
        }
        Some("audio") => {
            let label = if text.is_empty() { "[语音]" } else { text };
            format!(
                "<span class=\"reply-content-attachment\">🎵 {}</span>",
                escape_html(label)
            )
        }
        Some("file") => {
            let label = get_str(pe, "fileName")
                .filter(|s| !s.is_empty())
                .unwrap_or(if text.is_empty() { "[文件]" } else { text });
            format!(
                "<span class=\"reply-content-attachment\">📎 {}</span>",
                escape_html(label)
            )
        }
        _ => escape_html(text),
    }
}

/// 把整组 previewElements 串接成 reply 卡片的正文 HTML。空数组返回空串，
/// 调用方据此决定是否走老路径（用 `data.content` 文本拼接）。
#[must_use]
pub fn render_reply_preview_elements(
    elements: &[Value],
    ctx: &ReplyPreviewRenderContext<'_>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for pe in elements {
        let piece = render_reply_preview_element(pe, ctx);
        if !piece.is_empty() {
            parts.push(piece);
        }
    }
    parts.join("")
}
