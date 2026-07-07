use std::sync::OnceLock;

use regex::Regex;

/// 抠出的 multiForwardMsg 卡片可视信息。
#[derive(Debug, Clone, Default)]
pub struct MultiForwardXmlInfo {
    /// 卡片头部文本，如 "群聊的聊天记录"。
    pub header: String,
    /// 卡片中部可见的若干预览行（已 unescape，去除前后空白）。
    pub preview_lines: Vec<String>,
    /// 卡片底部统计行，如 "查看N条转发消息"；解析不到时为空字符串。
    pub summary: String,
    /// 若解析过程中能从 summary 中抠到数字则填上，否则为 0。
    pub message_count: usize,
}

/// size 属性是 QQ 客户端区分卡片层级用的：34 = header，26 = body（preview 行）。
const HEADER_SIZE: &str = "34";

fn title_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<title\b([^>]*)>(.*?)</title>").expect("valid regex"))
}

fn summary_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<summary\b[^>]*>(.*?)</summary>").expect("valid regex"))
}

fn hex_ncr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"&#x([0-9A-Fa-f]+);").expect("valid regex"))
}

fn dec_ncr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"&#(\d+);").expect("valid regex"))
}

/// unescape XML 实体；QQ 这边只会用到 5 个标准 entity，外加 numeric character reference。
fn unescape_xml_entities(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }
    let step1 = hex_ncr_re().replace_all(input, |caps: &regex::Captures<'_>| {
        u32::from_str_radix(&caps[1], 16)
            .ok()
            .and_then(char::from_u32)
            .map_or_else(String::new, |c| c.to_string())
    });
    let step2 = dec_ncr_re().replace_all(&step1, |caps: &regex::Captures<'_>| {
        caps[1]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map_or_else(String::new, |c| c.to_string())
    });
    step2
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn extract_attribute(raw_attrs: &str, name: &str) -> String {
    let pattern = format!(r#"\b{name}\s*=\s*"([^"]*)""#);
    match Regex::new(&pattern) {
        Ok(re) => re
            .captures(raw_attrs)
            .map_or_else(String::new, |c| c[1].to_string()),
        Err(_) => String::new(),
    }
}

/// 判断给定字符串是否疑似 multiForwardMsg 的 XML 卡片。
///
/// 用最严格的特征：必须出现 `<msg` 头 + `multiMsgFlag` 或 `viewMultiMsg`。
#[allow(dead_code)]
pub fn looks_like_multi_forward_xml(s: Option<&str>) -> bool {
    let Some(s) = s else { return false };
    let trimmed = s.trim();
    if !trimmed.starts_with('<') {
        return false;
    }
    static MSG_RE: OnceLock<Regex> = OnceLock::new();
    static FLAG_RE: OnceLock<Regex> = OnceLock::new();
    let msg_re = MSG_RE.get_or_init(|| Regex::new(r"(?i)<msg\b").expect("valid regex"));
    let flag_re =
        FLAG_RE.get_or_init(|| Regex::new(r"(?i)multiMsgFlag\s*=|viewMultiMsg").expect("valid regex"));
    msg_re.is_match(trimmed) && flag_re.is_match(trimmed)
}

/// 抠 QQ multiForwardMsg 卡片 XML 的可视部分。
///
/// 解析失败时返回空 info（header / previewLines / summary 全空），调用方应当回退到
/// generic placeholder。
pub fn parse_multi_forward_xml(xml: Option<&str>) -> MultiForwardXmlInfo {
    let mut info = MultiForwardXmlInfo::default();
    let Some(xml) = xml else { return info };
    if xml.is_empty() {
        return info;
    }

    let mut raw_titles: Vec<(String, String)> = Vec::new();
    for caps in title_re().captures_iter(xml) {
        let attrs = caps.get(1).map_or("", |m| m.as_str()).to_string();
        let text = unescape_xml_entities(caps.get(2).map_or("", |m| m.as_str()))
            .trim()
            .to_string();
        raw_titles.push((attrs, text));
        if raw_titles.len() > 32 {
            break; // 防止恶意 XML 撑爆解析
        }
    }

    if !raw_titles.is_empty() {
        // 按 size 区分：先尝试取第一条 size="34" 当 header，其余当预览。
        // 没有 size 标注时退化为「第一条 = header，其余 = preview」。
        let header_idx = raw_titles
            .iter()
            .position(|(attrs, _)| extract_attribute(attrs, "size") == HEADER_SIZE)
            .unwrap_or(0);
        info.header = raw_titles[header_idx].1.clone();
        for (idx, (_, text)) in raw_titles.iter().enumerate() {
            if idx == header_idx || text.is_empty() {
                continue;
            }
            info.preview_lines.push(text.clone());
            if info.preview_lines.len() >= 16 {
                break;
            }
        }
    }

    if let Some(caps) = summary_re().captures(xml) {
        info.summary = unescape_xml_entities(caps.get(1).map_or("", |m| m.as_str()))
            .trim()
            .to_string();
        static NUM_RE: OnceLock<Regex> = OnceLock::new();
        let num_re = NUM_RE.get_or_init(|| Regex::new(r"(\d+)").expect("valid regex"));
        if let Some(num) = num_re.captures(&info.summary) {
            if let Ok(n) = num[1].parse::<usize>() {
                info.message_count = n;
            }
        }
    }

    info
}
