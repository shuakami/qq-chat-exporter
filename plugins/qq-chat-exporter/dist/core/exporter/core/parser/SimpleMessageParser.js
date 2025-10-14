/**
 * 简化消息解析器
 */
import path from 'path';
import { NTMsgType } from 'NapCatQQ/src/core/types.js';
/* ------------------------------ 内部高性能工具 ------------------------------ */
/** 并发限流 map（保持顺序） */
async function mapLimit(arr, limit, mapper) {
    const len = arr.length;
    const out = new Array(len);
    if (len === 0)
        return out;
    const workers = Math.min((limit >>> 0) || 1, len);
    let next = 0;
    async function worker() {
        while (true) {
            const i = next++;
            if (i >= len)
                break;
            out[i] = await mapper(arr[i], i);
        }
    }
    const tasks = new Array(workers);
    for (let i = 0; i < workers; i++)
        tasks[i] = worker();
    await Promise.all(tasks);
    return out;
}
function resolveConcurrency() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const os = require('os');
        const cores = (os?.cpus?.() || []).length || 4;
        return Math.max(4, Math.min(32, cores * 2));
    }
    catch {
        return 8;
    }
}
/** 让出事件循环 */
function yieldToEventLoop() {
    return new Promise((resolve) => {
        if (typeof setImmediate === 'function')
            setImmediate(resolve);
        else
            setTimeout(resolve, 0);
    });
}
/** Chunked 字符串构建器 */
class ChunkedBuilder {
    chunks = [];
    push(s) {
        if (s)
            this.chunks.push(s);
    }
    toString() {
        return this.chunks.join('');
    }
    clear() {
        this.chunks.length = 0;
    }
}
const NEED_ESCAPE_RE = /[&<>"']/;
function escapeHtmlFast(text) {
    if (!text)
        return '';
    if (!NEED_ESCAPE_RE.test(text))
        return text;
    const len = text.length;
    let out = '';
    let last = 0;
    for (let i = 0; i < len; i++) {
        const c = text.charCodeAt(i);
        let rep = null;
        if (c === 38)
            rep = '&amp;';
        else if (c === 60)
            rep = '&lt;';
        else if (c === 62)
            rep = '&gt;';
        else if (c === 34)
            rep = '&quot;';
        else if (c === 39)
            rep = '&#39;';
        if (rep) {
            if (i > last)
                out += text.slice(last, i);
            out += rep;
            last = i + 1;
        }
    }
    if (last < len)
        out += text.slice(last);
    return out;
}
/** RFC3339（UTC）格式化工具 */
function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}
function pad3(n) {
    if (n >= 100)
        return '' + n;
    if (n >= 10)
        return '0' + n;
    return '00' + n;
}
function pad4(n) {
    if (n >= 1000)
        return '' + n;
    if (n >= 100)
        return '0' + n;
    if (n >= 10)
        return '00' + n;
    return '000' + n;
}
function rfc3339FromMillis(ms) {
    const d = new Date(ms);
    return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${pad3(d.getUTCMilliseconds())}Z`;
}
function rfc3339FromUnixSeconds(sec) {
    try {
        if (typeof sec === 'bigint') {
            const n = Number(sec * 1000n);
            return Number.isFinite(n) ? rfc3339FromMillis(n) : '1970-01-01T00:00:00.000Z';
        }
        const n = typeof sec === 'string' ? parseInt(sec, 10) : sec;
        if (!Number.isFinite(n))
            return '1970-01-01T00:00:00.000Z';
        return rfc3339FromMillis(Math.trunc(n * 1000));
    }
    catch {
        return '1970-01-01T00:00:00.000Z';
    }
}
function millisFromUnixSeconds(sec) {
    try {
        if (typeof sec === 'bigint') {
            const n = Number(sec * 1000n);
            return Number.isFinite(n) ? n : 0;
        }
        const n = typeof sec === 'string' ? parseInt(sec, 10) : sec;
        return Number.isFinite(n) ? Math.trunc(n * 1000) : 0;
    }
    catch {
        return 0;
    }
}
let fastJsonParse = (s) => JSON.parse(s);
(function tryLoadSimdJson() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = typeof require !== 'undefined' ? require('simdjson') : null;
        if (mod && typeof mod.parse === 'function') {
            fastJsonParse = (s) => mod.parse(s);
        }
    }
    catch {
        // 静默降级
    }
})();
const DEFAULT_SIMPLE_OPTIONS = {
    concurrency: resolveConcurrency(),
    progressEvery: 100,
    yieldEvery: 1000,
    html: 'full'
};
/* ---------------------------------- 主类 ---------------------------------- */
export class SimpleMessageParser {
    options;
    onProgress;
    concurrency;
    constructor(opts = {}) {
        this.options = { ...DEFAULT_SIMPLE_OPTIONS, ...opts };
        this.onProgress = opts.onProgress;
        this.concurrency = this.options.concurrency ?? resolveConcurrency();
    }
    /**
     * 解析消息列表（高并发 + 有序输出）
     */
    async parseMessages(messages) {
        const total = messages.length;
        let processed = 0;
        const results = await mapLimit(messages, this.concurrency, async (message, idx) => {
            try {
                const cm = await this.parseMessage(message);
                processed++;
                if (this.onProgress) {
                    this.onProgress(processed, total);
                }
                else if (processed % this.options.progressEvery === 0) {
                    console.log(`[SimpleMessageParser] 已解析 ${processed}/${total}`);
                }
                if (this.options.yieldEvery > 0 && (idx + 1) % this.options.yieldEvery === 0) {
                    await yieldToEventLoop();
                }
                return cm;
            }
            catch (error) {
                console.error('解析消息失败:', error, message?.msgId);
                return this.createErrorMessage(message, error);
            }
        });
        return results;
    }
    /**
     * 【流式版本】解析消息生成器 - 逐条解析并yield，实现低内存占用
     * 适用于大量消息的场景，配合流式导出可实现全程低内存
     */
    async *parseMessagesStream(messages, resourceMap) {
        const total = messages.length;
        let processed = 0;
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (!message)
                continue; // 跳过undefined元素
            try {
                const cleanMessage = await this.parseMessage(message);
                // 如果提供了resourceMap，立即更新这条消息的资源路径
                if (resourceMap && resourceMap.has(message.msgId)) {
                    const resources = resourceMap.get(message.msgId);
                    if (resources && cleanMessage.content.elements) {
                        this.updateSingleMessageResourcePaths(cleanMessage, resources);
                    }
                }
                processed++;
                if (this.onProgress) {
                    this.onProgress(processed, total);
                }
                else if (processed % this.options.progressEvery === 0) {
                    console.log(`[SimpleMessageParser] 已解析 ${processed}/${total}`);
                }
                if (this.options.yieldEvery > 0 && (i + 1) % this.options.yieldEvery === 0) {
                    await yieldToEventLoop();
                }
                yield cleanMessage;
            }
            catch (error) {
                console.error('解析消息失败:', error, message.msgId);
                yield this.createErrorMessage(message, error);
            }
        }
    }
    /**
     * 解析单条消息（公开）
     */
    async parseSingleMessage(message) {
        return this.parseMessage(message);
    }
    /**
     * 解析单条消息（内部）
     */
    async parseMessage(message) {
        const tsMs = millisFromUnixSeconds(message.msgTime);
        const timestamp = tsMs > 0 ? tsMs : Date.now();
        // 群名片 > 好友备注 > 昵称 > QQ号 > UID
        const senderName = message.sendMemberName ||
            message.sendRemarkName ||
            message.sendNickName ||
            message.senderUin ||
            message.senderUid ||
            '未知用户';
        const content = await this.parseMessageContent(message);
        const cleanMessage = {
            id: message.msgId,
            seq: message.msgSeq,
            timestamp,
            // RFC3339（UTC）
            time: rfc3339FromMillis(timestamp),
            sender: {
                uid: message.senderUid,
                uin: message.senderUin,
                name: senderName,
                remark: message.sendRemarkName || undefined
            },
            type: this.getMessageTypeString(message.msgType),
            content,
            recalled: message.recallTime !== '0',
            system: this.isSystemMessage(message)
        };
        return cleanMessage;
    }
    getMessageTypeString(msgType) {
        switch (msgType) {
            case NTMsgType.KMSGTYPEMIX:
            case NTMsgType.KMSGTYPENULL:
                return 'text';
            case NTMsgType.KMSGTYPEFILE:
                return 'file';
            case NTMsgType.KMSGTYPEVIDEO:
                return 'video';
            case NTMsgType.KMSGTYPEPTT:
                return 'audio';
            case NTMsgType.KMSGTYPEREPLY:
                return 'reply';
            case NTMsgType.KMSGTYPEMULTIMSGFORWARD:
                return 'forward';
            case NTMsgType.KMSGTYPEGRAYTIPS:
                return 'system';
            case NTMsgType.KMSGTYPESTRUCT:
            case NTMsgType.KMSGTYPEARKSTRUCT:
                return 'json';
            default:
                return `type_${msgType}`;
        }
    }
    /**
     * 单趟解析消息内容
     */
    async parseMessageContent(message) {
        const elements = message.elements || [];
        const parsedElements = new Array(elements.length);
        const resources = [];
        const textB = new ChunkedBuilder();
        const htmlB = new ChunkedBuilder();
        const htmlEnabled = this.options.html !== 'none';
        let count = 0;
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            const parsed = await this.parseElement(element);
            if (!parsed)
                continue;
            parsedElements[count++] = parsed;
            // 资源抽取
            const resource = this.extractResource(parsed);
            if (resource)
                resources.push(resource);
            // 文本/HTML
            const { text, html } = this.elementToText(parsed, htmlEnabled);
            textB.push(text);
            if (htmlEnabled)
                htmlB.push(html);
        }
        // 压缩 parsedElements 实际长度
        parsedElements.length = count;
        return {
            text: textB.toString().trim(),
            html: htmlEnabled ? htmlB.toString().trim() : '',
            elements: parsedElements,
            resources
        };
    }
    /**
     * 元素解析（尽量同步，无额外中间对象）
     */
    async parseElement(element) {
        // 文本
        if (element.textElement) {
            return {
                type: 'text',
                data: { text: element.textElement.content || '' }
            };
        }
        // 表情
        if (element.faceElement) {
            return {
                type: 'face',
                data: {
                    id: element.faceElement.faceIndex,
                    name: `表情${element.faceElement.faceIndex}`
                }
            };
        }
        // 商城表情
        if (element.marketFaceElement) {
            const emojiId = element.marketFaceElement.emojiId || '';
            const key = element.marketFaceElement.key || '';
            const url = emojiId ? this.generateMarketFaceUrl(emojiId) : '';
            return {
                type: 'market_face',
                data: {
                    name: element.marketFaceElement.faceName || '商城表情',
                    tabName: element.marketFaceElement.tabName || '',
                    key,
                    emojiId,
                    emojiPackageId: element.marketFaceElement.emojiPackageId,
                    url
                }
            };
        }
        // 图片
        if (element.picElement) {
            return {
                type: 'image',
                data: {
                    filename: element.picElement.fileName || '图片',
                    size: this.parseSizeString(element.picElement.fileSize),
                    width: element.picElement.picWidth,
                    height: element.picElement.picHeight,
                    md5: element.picElement.md5HexStr,
                    url: element.picElement.originImageUrl || ''
                }
            };
        }
        // 文件
        if (element.fileElement) {
            return {
                type: 'file',
                data: {
                    filename: element.fileElement.fileName || '文件',
                    size: this.parseSizeString(element.fileElement.fileSize),
                    md5: element.fileElement.fileMd5
                }
            };
        }
        // 视频
        if (element.videoElement) {
            return {
                type: 'video',
                data: {
                    filename: element.videoElement.fileName || '视频',
                    size: this.parseSizeString(element.videoElement.fileSize),
                    duration: element.videoElement.duration || 0,
                    thumbSize: this.parseSizeString(element.videoElement.thumbSize)
                }
            };
        }
        // 语音
        if (element.pttElement) {
            return {
                type: 'audio',
                data: {
                    filename: element.pttElement.fileName || '语音',
                    size: this.parseSizeString(element.pttElement.fileSize),
                    duration: element.pttElement.duration || 0
                }
            };
        }
        // 回复
        if (element.replyElement) {
            const replyData = this.extractReplyContent(element.replyElement);
            return {
                type: 'reply',
                data: {
                    messageId: replyData.messageId,
                    senderUin: replyData.senderUin,
                    senderName: replyData.senderName,
                    content: replyData.content,
                    timestamp: replyData.timestamp
                }
            };
        }
        // 转发
        if (element.multiForwardMsgElement) {
            return {
                type: 'forward',
                data: {
                    title: '转发消息',
                    resId: element.multiForwardMsgElement.resId || '',
                    summary: element.multiForwardMsgElement.xmlContent || ''
                }
            };
        }
        // JSON 卡片
        if (element.arkElement) {
            const jsonContent = element.arkElement.bytesData || '{}';
            const parsedJson = this.parseJsonContent(jsonContent);
            return {
                type: 'json',
                data: {
                    content: jsonContent,
                    title: parsedJson.title || 'JSON消息',
                    description: parsedJson.description,
                    url: parsedJson.url,
                    preview: parsedJson.preview,
                    appName: parsedJson.appName,
                    summary: parsedJson.title || parsedJson.description || 'JSON消息'
                }
            };
        }
        // 位置
        if (element.shareLocationElement) {
            return {
                type: 'location',
                data: {
                    title: '位置消息',
                    summary: '分享了位置'
                }
            };
        }
        // 小灰条（系统提示）
        if (element.grayTipElement) {
            return this.parseGrayTipElement(element.grayTipElement);
        }
        // 未知类型
        console.warn(`[SimpleMessageParser] 未知消息元素类型: ${element.elementType}`, element);
        return {
            type: 'system',
            data: {
                elementType: element.elementType,
                summary: this.getSystemMessageSummary(element),
                text: this.getSystemMessageSummary(element)
            }
        };
    }
    extractResource(element) {
        if (!['image', 'file', 'video', 'audio'].includes(element.type))
            return null;
        const d = element.data || {};
        return {
            type: element.type,
            filename: d.filename || '未知',
            size: d.size || 0,
            url: d.url,
            width: d.width,
            height: d.height,
            duration: d.duration
        };
    }
    elementToText(element, htmlEnabled) {
        switch (element.type) {
            case 'text': {
                const t = element.data.text || '';
                return { text: t, html: htmlEnabled ? escapeHtmlFast(t) : '' };
            }
            case 'face': {
                const t = `[表情${element.data.id}]`;
                return { text: t, html: htmlEnabled ? t : '' };
            }
            case 'market_face': {
                const t = `[${element.data.name || '表情'}]`;
                return { text: t, html: htmlEnabled ? t : '' };
            }
            case 'image': {
                const t = `[图片:${element.data.filename}]`;
                return { text: t, html: htmlEnabled ? `<img alt="${escapeHtmlFast(element.data.filename)}" class="image">` : '' };
            }
            case 'file': {
                const t = `[文件:${element.data.filename}]`;
                return { text: t, html: htmlEnabled ? `<span class="file">${escapeHtmlFast(t)}</span>` : '' };
            }
            case 'video': {
                const t = `[视频:${element.data.filename}]`;
                return { text: t, html: htmlEnabled ? `<span class="video">${escapeHtmlFast(t)}</span>` : '' };
            }
            case 'audio': {
                const t = `[语音:${element.data.duration}秒]`;
                return { text: t, html: htmlEnabled ? `<span class="audio">${escapeHtmlFast(t)}</span>` : '' };
            }
            case 'reply': {
                const t = `[回复消息]`;
                return { text: t, html: htmlEnabled ? `<div class="reply">${t}</div>` : '' };
            }
            case 'forward': {
                const t = `[转发消息]`;
                return { text: t, html: htmlEnabled ? `<div class="forward">${t}</div>` : '' };
            }
            case 'location': {
                const t = `[位置消息]`;
                return { text: t, html: htmlEnabled ? `<div class="location">${t}</div>` : '' };
            }
            case 'json': {
                const t = `[JSON消息]`;
                return { text: t, html: htmlEnabled ? `<div class="json">${t}</div>` : '' };
            }
            case 'system': {
                const t = element.data.text || element.data.summary || '系统消息';
                return { text: t, html: htmlEnabled ? `<div class="system">${escapeHtmlFast(t)}</div>` : '' };
            }
            default: {
                const rawText = element.data.text || element.data.summary || element.data.content || '';
                return { text: rawText, html: htmlEnabled ? (rawText ? `<span>${escapeHtmlFast(rawText)}</span>` : '') : '' };
            }
        }
    }
    parseSizeString(size) {
        if (typeof size === 'number')
            return size;
        if (typeof size === 'string') {
            const n = parseInt(size, 10);
            return Number.isFinite(n) ? n : 0;
        }
        return 0;
    }
    isSystemMessage(message) {
        return message.msgType === NTMsgType.KMSGTYPEGRAYTIPS;
    }
    createErrorMessage(message, error) {
        const tsMs = millisFromUnixSeconds(message.msgTime);
        const timestamp = tsMs > 0 ? tsMs : Date.now();
        const senderName = message.sendMemberName ||
            message.sendRemarkName ||
            message.sendNickName ||
            message.senderUin ||
            message.senderUid ||
            '未知用户';
        const errMsg = (error && (error.message || error.toString?.())) || 'Unknown';
        return {
            id: message.msgId,
            seq: message.msgSeq,
            timestamp,
            time: rfc3339FromMillis(timestamp),
            sender: {
                uid: message.senderUid,
                uin: message.senderUin,
                name: senderName
            },
            type: 'error',
            content: {
                text: `[解析失败: ${errMsg}]`,
                html: `<span class="error">[解析失败: ${escapeHtmlFast(errMsg)}]</span>`,
                elements: [],
                resources: []
            },
            recalled: false,
            system: false
        };
    }
    /** @deprecated 使用 isPureMediaMessage 代替 */
    isPureImageMessage(message) {
        return this.isPureMediaMessage(message);
    }
    isPureMediaMessage(message) {
        const els = message.content.elements || [];
        const hasMedia = els.some((e) => ['image', 'video', 'audio', 'file', 'face'].includes(e.type));
        if (!hasMedia)
            return false;
        const textEls = els.filter((e) => e.type === 'text');
        const allTextCQOnly = textEls.length > 0 && textEls.every((e) => this.isOnlyCQCode(e.data?.text || ''));
        const nonTextEls = els.filter((e) => !['text', 'reply', 'forward', 'json', 'location', 'system'].includes(e.type));
        return els.length > 0 && hasMedia && (els.length === nonTextEls.length || allTextCQOnly);
    }
    hasRealTextContent(message) {
        const textEls = message.content.elements.filter((e) => e.type === 'text');
        for (let i = 0; i < textEls.length; i++) {
            const t = textEls[i].data?.text || '';
            if (t.trim().length > 0 && !this.isOnlyCQCode(t))
                return true;
        }
        return false;
    }
    isOnlyCQCode(text) {
        if (!text || text.trim().length === 0)
            return true;
        // 移除所有 CQ 码，检测是否还有实际文字
        const without = text.replace(/\[CQ:[^\]]+\]/g, '').trim();
        return without.length === 0;
    }
    filterMessages(messages, includePureImages = true) {
        if (includePureImages)
            return messages;
        return messages.filter((m) => !this.isPureMediaMessage(m));
    }
    calculateStatistics(messages) {
        const stats = {
            total: messages.length,
            byType: {},
            bySender: {},
            resources: {
                total: 0,
                byType: {},
                totalSize: 0
            },
            timeRange: {
                start: '',
                end: '',
                durationDays: 0
            }
        };
        if (messages.length === 0)
            return stats;
        // 时间范围
        const ts = messages.map((m) => m.timestamp).filter((t) => t > 0).sort((a, b) => a - b);
        if (ts.length > 0) {
            const start = new Date(ts[0]);
            const end = new Date(ts[ts.length - 1]);
            stats.timeRange = {
                start: start.toISOString(),
                end: end.toISOString(),
                durationDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
            };
        }
        // 统计
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (!m || !m.content)
                continue;
            // 类型
            stats.byType[m.type] = (stats.byType[m.type] || 0) + 1;
            // 发送者
            const senderKey = m.sender?.name || m.sender?.uid || '未知用户';
            if (!stats.bySender[senderKey]) {
                stats.bySender[senderKey] = {
                    uid: m.sender?.uid || 'unknown',
                    count: 0
                };
            }
            stats.bySender[senderKey].count++;
            // 资源
            const res = m.content.resources || [];
            for (let j = 0; j < res.length; j++) {
                const r = res[j];
                stats.resources.total++;
                const t = r.type || 'unknown';
                stats.resources.byType[t] = (stats.resources.byType[t] || 0) + 1;
                stats.resources.totalSize += r.size || 0;
            }
        }
        return stats;
    }
    async updateResourcePaths(messages, resourceMap) {
        for (let mi = 0; mi < messages.length; mi++) {
            const message = messages[mi];
            const resources = resourceMap.get(message.id);
            if (resources && resources.length > 0) {
                this.updateSingleMessageResourcePaths(message, resources);
            }
        }
    }
    /**
     * 更新单条消息的资源路径（私有方法，供批量和流式使用）
     */
    updateSingleMessageResourcePaths(message, resources) {
        // 更新 message.content.resources
        const resArr = message.content.resources;
        const n = Math.min(resArr.length, resources.length);
        for (let i = 0; i < n; i++) {
            const info = resources[i];
            if (info && info.localPath) {
                const fileName = path.basename(info.localPath);
                const typeDir = info.type + 's'; // image -> images, video -> videos
                // 修复 Issue #30: 保留类型子目录，让导出器能正确找到文件
                resArr[i].localPath = `${typeDir}/${fileName}`;
                resArr[i].url = `resources/${typeDir}/${fileName}`;
                resArr[i].type = info.type;
            }
        }
        // 更新 elements 中的 URL
        const els = message.content.elements;
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (!el.data || typeof el.data !== 'object')
                continue;
            // 修复：大小写兼容匹配 - 支持 filename 和 fileName
            const elementFilename = el.data.filename || el.data.fileName;
            const found = resources.find((r) => r.fileName === elementFilename ||
                r.fileName === el.data.filename ||
                r.fileName === el.data.fileName);
            if (found && found.localPath) {
                const fileName = path.basename(found.localPath);
                const typeDir = found.type + 's'; // image -> images, video -> videos
                // 修复 Issue #30: 保留类型子目录，让导出器能正确找到文件
                el.data.localPath = `${typeDir}/${fileName}`;
                if (el.type === 'image' || el.type === 'video' || el.type === 'audio' || el.type === 'file') {
                    el.data.url = `resources/${typeDir}/${fileName}`;
                }
            }
        }
    }
    parseJsonContent(jsonString) {
        try {
            const json = fastJsonParse(jsonString);
            const result = {};
            // 标题
            if (json.prompt)
                result.title = json.prompt;
            else if (json.meta?.detail_1?.title)
                result.title = json.meta.detail_1.title;
            else if (json.meta?.news?.title)
                result.title = json.meta.news.title;
            // 描述
            if (json.meta?.detail_1?.desc)
                result.description = json.meta.detail_1.desc;
            else if (json.meta?.news?.desc)
                result.description = json.meta.news.desc;
            // URL
            if (json.meta?.detail_1?.qqdocurl)
                result.url = json.meta.detail_1.qqdocurl;
            else if (json.meta?.detail_1?.url)
                result.url = json.meta.detail_1.url;
            else if (json.meta?.news?.jumpUrl)
                result.url = json.meta.news.jumpUrl;
            // 预览图
            if (json.meta?.detail_1?.preview)
                result.preview = json.meta.detail_1.preview;
            else if (json.meta?.news?.preview)
                result.preview = json.meta.news.preview;
            // 应用名称
            if (json.meta?.detail_1?.title && json.app)
                result.appName = json.meta.detail_1.title;
            else if (json.app === 'com.tencent.miniapp_01')
                result.appName = '小程序';
            return result;
        }
        catch (error) {
            console.warn('[SimpleMessageParser] JSON解析失败:', error);
            return {};
        }
    }
    extractReplyContent(replyElement) {
        const result = {
            messageId: replyElement.replayMsgId || replyElement.replayMsgSeq || '0',
            senderUin: replyElement.senderUin || '',
            senderName: replyElement.senderUinStr || '',
            content: '引用消息',
            timestamp: 0
        };
        if (replyElement.sourceMsgText) {
            result.content = replyElement.sourceMsgText;
        }
        else if (replyElement.sourceMsgTextElems && replyElement.sourceMsgTextElems.length > 0) {
            const parts = [];
            for (let i = 0; i < replyElement.sourceMsgTextElems.length; i++) {
                const e = replyElement.sourceMsgTextElems[i];
                if (e?.textElement?.content)
                    parts.push(e.textElement.content);
            }
            if (parts.length > 0)
                result.content = parts.join('');
        }
        else if (replyElement.referencedMsg && replyElement.referencedMsg.msgBody) {
            result.content = replyElement.referencedMsg.msgBody;
        }
        if (replyElement.senderNick)
            result.senderName = replyElement.senderNick;
        if (replyElement.replayMsgTime)
            result.timestamp = replyElement.replayMsgTime;
        return result;
    }
    generateMarketFaceUrl(emojiId) {
        if (emojiId.length < 2)
            return '';
        const prefix = emojiId.substring(0, 2);
        return `https://gxh.vip.qq.com/club/item/parcel/item/${prefix}/${emojiId}/raw300.gif`;
    }
    parseGrayTipElement(grayTip) {
        const subType = grayTip.subElementType;
        let summary = '系统消息';
        let text = '';
        try {
            if (subType === 1 && grayTip.revokeElement) {
                const revokeInfo = grayTip.revokeElement;
                const operatorName = revokeInfo.operatorName || '用户';
                const originalSenderName = revokeInfo.origMsgSenderName || '用户';
                if (revokeInfo.isSelfOperate) {
                    text = `${operatorName} 撤回了一条消息`;
                }
                else if (operatorName === originalSenderName) {
                    text = `${operatorName} 撤回了一条消息`;
                }
                else {
                    text = `${operatorName} 撤回了 ${originalSenderName} 的消息`;
                }
                if (revokeInfo.wording)
                    text = revokeInfo.wording;
                summary = text;
            }
            else if (subType === 4 && grayTip.groupElement) {
                text = grayTip.groupElement.content || '群聊更新';
                summary = text;
            }
            else if (subType === 17 && grayTip.jsonGrayTipElement) {
                const jsonContent = grayTip.jsonGrayTipElement.jsonStr || '{}';
                try {
                    const parsed = fastJsonParse(jsonContent);
                    text = parsed.prompt || parsed.content || '系统提示';
                }
                catch {
                    text = '系统提示';
                }
                summary = text;
            }
            else if (grayTip.aioOpGrayTipElement) {
                const aioOp = grayTip.aioOpGrayTipElement;
                if (aioOp.operateType === 1) {
                    const fromUser = aioOp.peerName || '用户';
                    const toUser = aioOp.targetName || '用户';
                    text = `${fromUser} 拍了拍 ${toUser}`;
                    if (aioOp.suffix)
                        text += ` ${aioOp.suffix}`;
                }
                else {
                    text = aioOp.content || '互动消息';
                }
                summary = text;
            }
            else {
                const content = grayTip.content || grayTip.text || grayTip.wording;
                if (content) {
                    text = content;
                    summary = content;
                }
                else {
                    text = `系统提示 (类型: ${subType})`;
                    summary = text;
                }
            }
        }
        catch (error) {
            console.warn('[SimpleMessageParser] 解析灰条消息失败:', error, grayTip);
            text = '系统消息';
            summary = text;
        }
        return {
            type: 'system',
            data: {
                subType,
                text,
                summary,
                originalData: grayTip
            }
        };
    }
    getSystemMessageSummary(element) {
        const t = element.elementType;
        switch (t) {
            case 8:
                return '系统提示消息';
            case 9:
                return '文件传输消息';
            case 10:
                return '语音通话消息';
            case 11:
                return '视频通话消息';
            case 12:
                return '红包消息';
            case 13:
                return '转账消息';
            default:
                return `系统消息 (类型: ${t})`;
        }
    }
}
