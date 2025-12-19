/**
 * JSON 导出模板与基础字符串工具
 * 目标：
 * - 将“文件结构”与“导出逻辑”解耦
 * - 用模板字符串封装 JSON 文件骨架，便于后续扩展（如 chunked JSONL）
 * - 保持现有 JsonExporter 的输出格式不变（默认 single-json）
 */

export interface JsonStreamContext {
    pretty: boolean;
    /** 单级缩进字符串，例如 '  ' */
    indentUnit: string;
    /** 换行符；当 pretty=false 时为 '' */
    nl: string;
}

export function createJsonStreamContext(pretty: boolean, indentUnit: string = '  '): JsonStreamContext {
    return {
        pretty,
        indentUnit,
        nl: pretty ? '\n' : ''
    };
}

export function indent(ctx: JsonStreamContext, level: number): string {
    if (!ctx.pretty) return '';
    if (level <= 0) return '';
    return ctx.indentUnit.repeat(level);
}

/** chunked-jsonl 默认目录/文件约定 */
export const DEFAULT_CHUNKS_DIR_NAME = 'chunks';
export const DEFAULT_MANIFEST_FILE_NAME = 'manifest.json';
export const DEFAULT_AVATARS_FILE_NAME = 'avatars.json';

/** 统一 chunk 文件命名：c000001.jsonl */
export function formatChunkFileName(index: number, ext: string = '.jsonl'): string {
    const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
    const num = String(index).padStart(6, '0');
    return `c${num}${cleanExt}`;
}

/**
 * 用于“单文件 JSON”导出的模板（保持 JsonExporter 现有输出格式不变）
 * 注意：
 * - 这里故意不对 metadata/chatInfo/statistics 做 pretty stringify（与旧逻辑一致）
 * - messages 数组由调用方流式写入
 */
export const JsonSingleFileTemplates = {
    begin(
        metadata: any,
        chatInfo: any,
        statistics: any,
        ctx: JsonStreamContext
    ): string {
        const nl = ctx.nl;
        const i1 = indent(ctx, 1);

        return `{${nl}` +
            `${i1}"metadata":${JSON.stringify(metadata)},${nl}` +
            `${i1}"chatInfo":${JSON.stringify(chatInfo)},${nl}` +
            `${i1}"statistics":${JSON.stringify(statistics)},${nl}` +
            `${i1}"messages":[${nl}`;
    },

    messagesArrayEnd(ctx: JsonStreamContext): string {
        const nl = ctx.nl;
        const i1 = indent(ctx, 1);
        return `${nl}${i1}]`;
    },

    avatarsBegin(ctx: JsonStreamContext): string {
        const nl = ctx.nl;
        const i1 = indent(ctx, 1);
        return `,${nl}${i1}"avatars":{${nl}`;
    },

    avatarEntry(
        uin: string,
        base64: string,
        isLast: boolean,
        ctx: JsonStreamContext
    ): string {
        const nl = ctx.nl;
        const i2 = indent(ctx, 2);
        const comma = isLast ? '' : ',';
        return `${i2}${JSON.stringify(uin)}:${JSON.stringify(base64)}${comma}${nl}`;
    },

    avatarsEnd(ctx: JsonStreamContext): string {
        const i1 = indent(ctx, 1);
        return `${i1}}`;
    },

    exportOptionsField(exportOptions: any, ctx: JsonStreamContext): string {
        const nl = ctx.nl;
        const i1 = indent(ctx, 1);
        return `,${nl}${i1}"exportOptions":${JSON.stringify(exportOptions)}`;
    },

    end(ctx: JsonStreamContext): string {
        const nl = ctx.nl;
        return `${nl}}${nl}`;
    }
};

/**
 * 通用 JSON 文件渲染（小文件：manifest 等）
 */
export function renderJsonFile(data: any, pretty: boolean, indentSize: number): string {
    if (pretty) return JSON.stringify(data, null, indentSize);
    return JSON.stringify(data);
}

/**
 * 用于“流式写 JSON 对象”（例如输出 avatars.json）的模板
 * - 只负责骨架，不持有对象，不做 OOM 风险的 JSON.stringify(Object.fromEntries(...))
 */
export const JsonObjectStreamTemplates = {
    begin(ctx: JsonStreamContext): string {
        return `{${ctx.nl}`;
    },
    entry(key: string, valueJson: string, isLast: boolean, ctx: JsonStreamContext): string {
        const nl = ctx.nl;
        const i1 = indent(ctx, 1);
        const comma = isLast ? '' : ',';
        return `${i1}${JSON.stringify(key)}:${valueJson}${comma}${nl}`;
    },
    end(ctx: JsonStreamContext): string {
        return `}${ctx.nl}`;
    }
};
