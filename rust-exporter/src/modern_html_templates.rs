//! 现代化 HTML 导出模板（对应 TS `ModernHtmlTemplates.ts`）。
//!
//! TS 侧把 CSS / HTML / JS 模板作为超长字符串常量内嵌在源码中；Rust 侧
//! 将它们原样抽取到 `assets/` 目录，通过 `include_str!` 在编译期嵌入，
//! 保证输出与 TS 版本字节级一致，同时避免 3000+ 行字符串字面量污染源码。

/// 主 CSS（单文件与 chunked viewer 共用）。
pub const MODERN_CSS: &str = include_str!("../assets/modern_css.css");

/// 底部胶囊工具栏 HTML。
pub const MODERN_TOOLBAR_HTML: &str = include_str!("../assets/modern_toolbar.html");

/// 页脚 HTML。
pub const MODERN_FOOTER_HTML: &str = include_str!("../assets/modern_footer.html");

/// 单文件模式内联脚本主体（不含 `<script>` 包裹外的运行期开关）。
pub const MODERN_SINGLE_APP_JS: &str = include_str!("../assets/modern_single_app.js");

/// 单文件模式脚本 HTML（lucide CDN + 内联脚本）。
pub const MODERN_SINGLE_SCRIPTS_HTML: &str = include_str!("../assets/modern_single_scripts.html");

/// 单文件模式 HTML 文档头模板。
pub const MODERN_SINGLE_HTML_TOP_TEMPLATE: &str = include_str!("../assets/modern_single_top.html");

/// 单文件模式 HTML 文档尾模板。
pub const MODERN_SINGLE_HTML_BOTTOM_TEMPLATE: &str =
    include_str!("../assets/modern_single_bottom.html");

/// Chunked viewer 首页（index.html）模板。
pub const MODERN_CHUNKED_INDEX_HTML_TEMPLATE: &str =
    include_str!("../assets/modern_chunked_index.html");

/// Chunked viewer 应用脚本（assets/app.js）。
pub const MODERN_CHUNKED_APP_JS: &str = include_str!("../assets/modern_chunked_app.js");

/// 模板渲染：替换 `{{KEY}}` 占位符（对应 TS `renderTemplate`）。
///
/// 与 TS 语义一致：占位符名为 `\w+`，未提供的键替换为空串。
#[must_use]
pub fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            // 尝试匹配 {{\w+}}
            let start = i + 2;
            let mut j = start;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            if j > start && j + 1 < bytes.len() && bytes[j] == b'}' && bytes[j + 1] == b'}' {
                let key = &template[start..j];
                if let Some((_, value)) = vars.iter().find(|(k, _)| *k == key) {
                    out.push_str(value);
                }
                i = j + 2;
                continue;
            }
        }
        // 按字符推进，避免切断多字节 UTF-8
        let ch_len = utf8_char_len(bytes[i]);
        out.push_str(&template[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// 计算 UTF-8 首字节对应的字符字节长度。
const fn utf8_char_len(first: u8) -> usize {
    if first < 0x80 {
        1
    } else if first < 0xE0 {
        2
    } else if first < 0xF0 {
        3
    } else {
        4
    }
}
