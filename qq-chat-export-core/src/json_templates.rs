use serde::Serialize;

/// JSON 流式写出上下文。
#[derive(Debug, Clone)]
pub struct JsonStreamContext {
    /// 是否美化。
    pub pretty: bool,
    /// 单级缩进字符串（例如 `"  "`）。
    pub indent_unit: String,
    /// 换行符；`pretty=false` 时为空串。
    pub nl: &'static str,
}

/// 创建流式上下文（对应 TS `createJsonStreamContext`）。
#[must_use]
pub fn create_json_stream_context(pretty: bool, indent_unit: &str) -> JsonStreamContext {
    JsonStreamContext {
        pretty,
        indent_unit: indent_unit.to_owned(),
        nl: if pretty { "\n" } else { "" },
    }
}

/// 生成 `level` 级缩进（对应 TS `indent`）。
#[must_use]
pub fn indent(ctx: &JsonStreamContext, level: usize) -> String {
    if !ctx.pretty || level == 0 {
        return String::new();
    }
    ctx.indent_unit.repeat(level)
}

/// chunked-jsonl 默认 chunks 目录名。
pub const DEFAULT_CHUNKS_DIR_NAME: &str = "chunks";
/// chunked-jsonl 默认 manifest 文件名。
pub const DEFAULT_MANIFEST_FILE_NAME: &str = "manifest.json";
/// chunked-jsonl 默认 avatars 文件名。
pub const DEFAULT_AVATARS_FILE_NAME: &str = "avatars.json";

/// 统一 chunk 文件命名：`c000001.jsonl`（对应 TS `formatChunkFileName`）。
#[must_use]
pub fn format_chunk_file_name(index: usize, ext: &str) -> String {
    let clean_ext = if ext.starts_with('.') {
        ext.to_owned()
    } else {
        format!(".{ext}")
    };
    format!("c{index:06}{clean_ext}")
}

/// 单文件 JSON 模板（对应 TS `JsonSingleFileTemplates`）。
pub struct JsonSingleFileTemplates;

impl JsonSingleFileTemplates {
    /// JSON 开头：metadata / chatInfo / statistics 字段 + messages 数组开括号。
    ///
    /// 注意：与 TS 一致，metadata/chatInfo/statistics 故意不做 pretty stringify。
    pub fn begin<M: Serialize, C: Serialize, S: Serialize>(
        metadata: &M,
        chat_info: &C,
        statistics: &S,
        ctx: &JsonStreamContext,
    ) -> serde_json::Result<String> {
        let nl = ctx.nl;
        let i1 = indent(ctx, 1);
        Ok(format!(
            "{{{nl}{i1}\"metadata\":{},{nl}{i1}\"chatInfo\":{},{nl}{i1}\"statistics\":{},{nl}{i1}\"messages\":[{nl}",
            serde_json::to_string(metadata)?,
            serde_json::to_string(chat_info)?,
            serde_json::to_string(statistics)?,
        ))
    }

    /// messages 数组结束。
    #[must_use]
    pub fn messages_array_end(ctx: &JsonStreamContext) -> String {
        format!("{}{}]", ctx.nl, indent(ctx, 1))
    }

    /// avatars 字段开始。
    #[must_use]
    pub fn avatars_begin(ctx: &JsonStreamContext) -> String {
        format!(",{}{}\"avatars\":{{{}", ctx.nl, indent(ctx, 1), ctx.nl)
    }

    /// 单条 avatar 记录。
    pub fn avatar_entry(
        uin: &str,
        base64: &str,
        is_last: bool,
        ctx: &JsonStreamContext,
    ) -> serde_json::Result<String> {
        let comma = if is_last { "" } else { "," };
        Ok(format!(
            "{}{}:{}{comma}{}",
            indent(ctx, 2),
            serde_json::to_string(uin)?,
            serde_json::to_string(base64)?,
            ctx.nl
        ))
    }

    /// avatars 字段结束。
    #[must_use]
    pub fn avatars_end(ctx: &JsonStreamContext) -> String {
        format!("{}}}", indent(ctx, 1))
    }

    /// exportOptions 字段。
    pub fn export_options_field<E: Serialize>(
        export_options: &E,
        ctx: &JsonStreamContext,
    ) -> serde_json::Result<String> {
        Ok(format!(
            ",{}{}\"exportOptions\":{}",
            ctx.nl,
            indent(ctx, 1),
            serde_json::to_string(export_options)?
        ))
    }

    /// JSON 结束。
    #[must_use]
    pub fn end(ctx: &JsonStreamContext) -> String {
        format!("{}}}{}", ctx.nl, ctx.nl)
    }
}

/// 通用 JSON 文件渲染（小文件：manifest 等；对应 TS `renderJsonFile`）。
pub fn render_json_file<T: Serialize>(
    data: &T,
    pretty: bool,
    indent_size: usize,
) -> serde_json::Result<String> {
    if pretty {
        let indent_bytes = " ".repeat(indent_size);
        let mut out = Vec::new();
        let formatter = serde_json::ser::PrettyFormatter::with_indent(indent_bytes.as_bytes());
        let mut ser = serde_json::Serializer::with_formatter(&mut out, formatter);
        data.serialize(&mut ser)?;
        Ok(String::from_utf8(out).expect("serde_json produces valid UTF-8"))
    } else {
        serde_json::to_string(data)
    }
}

/// 流式写 JSON 对象骨架（对应 TS `JsonObjectStreamTemplates`，用于 avatars.json）。
pub struct JsonObjectStreamTemplates;

impl JsonObjectStreamTemplates {
    /// 对象开始。
    #[must_use]
    pub fn begin(ctx: &JsonStreamContext) -> String {
        format!("{{{}", ctx.nl)
    }

    /// 单条键值记录（value 已是 JSON 字面量）。
    pub fn entry(
        key: &str,
        value_json: &str,
        is_last: bool,
        ctx: &JsonStreamContext,
    ) -> serde_json::Result<String> {
        let comma = if is_last { "" } else { "," };
        Ok(format!(
            "{}{}:{value_json}{comma}{}",
            indent(ctx, 1),
            serde_json::to_string(key)?,
            ctx.nl
        ))
    }

    /// 对象结束。
    #[must_use]
    pub fn end(ctx: &JsonStreamContext) -> String {
        format!("}}{}", ctx.nl)
    }
}
