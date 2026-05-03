import path from 'path';

/**
 * issue #128 子项汇总：被引用消息（reply 卡片）里的预览元素，统一从这里渲染。
 *
 * 解析阶段（SimpleMessageParser.extractReplyContent）会把 referencedMessage
 * 的每一个子元素塞进 `previewElements`，类型可能是 text / image / face /
 * marketFace / video / audio / file。后续 backfillReplyPreviewLocalPaths 又
 * 跑一遍，把图片片段的 `localPath` 拉齐。导出阶段需要把这套结构化数据
 * 渲染成 reply 卡片正文 HTML。
 *
 * 该模块只负责字符串拼接，不持有 IO 状态，行为靠注入的 ctx 控制：
 *   - escapeHtml：HTML escape，必须由调用方提供，不在这里再造一份。
 *   - lookupDataUri：自包含模式下把资源拉成 data URI；返回 null 则走相对路径。
 *   - getFaceName：QQ 标准小表情 ID -> 友好名（"/微笑"、"/奋斗" 等）。
 *   - resourceBaseHref：相对资源根（一般是 'resources'）。
 */
export interface ReplyPreviewRenderContext {
    resourceBaseHref: string;
    escapeHtml: (s: string) => string;
    lookupDataUri: (kind: 'images' | 'videos' | 'audios' | 'files', baseName: string) => string | null | undefined;
    getFaceName: (id: string | number) => string;
}

/**
 * 渲染单个 previewElement。返回 HTML 片段（已 escape）；类型未知或字段缺失
 * 时回退到原始 text 文案，至少不会让正文变空白。
 */
export function renderReplyPreviewElement(pe: unknown, ctx: ReplyPreviewRenderContext): string {
    if (!pe || typeof pe !== 'object') return '';
    const e = pe as {
        type?: string;
        text?: string;
        localPath?: string;
        originUrl?: string;
        url?: string;
        md5?: string;
        fileName?: string;
        faceIndex?: number | string;
        faceName?: string;
    };
    const text = typeof e.text === 'string' ? e.text : '';

    switch (e.type) {
        case 'image': {
            const localPath = typeof e.localPath === 'string' ? e.localPath : '';
            if (localPath) {
                const baseName = path.basename(localPath);
                const dataUri = ctx.lookupDataUri('images', baseName);
                const imgSrc = dataUri || `${ctx.resourceBaseHref}/${localPath}`;
                return `<img src="${imgSrc}" class="reply-content-thumb" alt="引用图片" loading="lazy">`;
            }
            if (typeof e.originUrl === 'string' && e.originUrl) {
                // 兜底：被引用消息不在导出范围内，但 NT 给了带签名的 originImageUrl。
                // QQ 的 URL 会过期、可能跨域；用 onerror 让浏览器在加载失败时退回到「[图片]」文本。
                return `<img src="${ctx.escapeHtml(e.originUrl)}" class="reply-content-thumb" alt="引用图片" loading="lazy" onerror="this.replaceWith(document.createTextNode('[图片]'))">`;
            }
            return ctx.escapeHtml(text || '[图片]');
        }
        case 'marketFace': {
            const url = typeof e.url === 'string' ? e.url : '';
            if (url) {
                const alt = ctx.escapeHtml(e.faceName || '表情');
                return `<img src="${ctx.escapeHtml(url)}" class="reply-content-emoji" alt="${alt}" loading="lazy">`;
            }
            return ctx.escapeHtml(text || '[表情]');
        }
        case 'face': {
            // 标准小表情：parser 给到 faceIndex，这里翻译成"/微笑"这种友好名，
            // 跟主消息流里的 renderFaceElement 行为一致，免得 reply 卡片里挂着
            // 没人看得懂的「[表情341]」。
            const id = e.faceIndex !== undefined && e.faceIndex !== null ? String(e.faceIndex) : '';
            const friendly = id ? ctx.getFaceName(id) : '';
            return ctx.escapeHtml(friendly || text || '[表情]');
        }
        case 'video': {
            // 短卡片里塞不下播放器，给个 🎬 + 文件名 / 占位。
            const label = e.fileName || text || '[视频]';
            return `<span class="reply-content-attachment">🎬 ${ctx.escapeHtml(String(label))}</span>`;
        }
        case 'audio': {
            const label = text || '[语音]';
            return `<span class="reply-content-attachment">🎵 ${ctx.escapeHtml(String(label))}</span>`;
        }
        case 'file': {
            const label = e.fileName || text || '[文件]';
            return `<span class="reply-content-attachment">📎 ${ctx.escapeHtml(String(label))}</span>`;
        }
        case 'text':
        default:
            return ctx.escapeHtml(text);
    }
}

/**
 * 把整组 previewElements 串接成 reply 卡片的正文 HTML。空数组返回空串，
 * 调用方据此决定是否走老路径（用 data.content 文本拼接）。
 */
export function renderReplyPreviewElements(elements: unknown[], ctx: ReplyPreviewRenderContext): string {
    if (!Array.isArray(elements) || elements.length === 0) return '';
    const parts: string[] = [];
    for (const pe of elements) {
        const piece = renderReplyPreviewElement(pe, ctx);
        if (piece) parts.push(piece);
    }
    return parts.join('');
}
