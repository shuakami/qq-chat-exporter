/**
 * 消息解析器
 */
import { RawMessage, MessageElement, ElementType, NTMsgType } from 'NapCatQQ/src/core/index.js';
import { SystemError, ErrorType, ResourceInfo, ResourceStatus } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { OneBotMsgApi } from 'NapCatQQ/src/onebot/api/msg.js';
/* ------------------------------ 内部高性能工具 ------------------------------ */
/** 并发限流 map（保持顺序的结果数组） */
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
/** 自适应并发度 */
function resolveConcurrency() {
    try {
        // Node 环境
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const os = require('os');
        const cores = (os?.cpus?.() || []).length || 4;
        // 2x 核心，最多 32，最少 4
        return Math.max(4, Math.min(32, cores * 2));
    }
    catch {
        // 浏览器/未知环境
        return 8;
    }
}
/** 让出事件循环，防止长时间 CPU 占用导致“卡住”观感 */
function yieldToEventLoop() {
    return new Promise((resolve) => {
        if (typeof setImmediate === 'function')
            setImmediate(resolve);
        else
            setTimeout(resolve, 0);
    });
}
/** Promise 超时包装（超时返回 null，不抛异常） */
async function withTimeout(p, ms) {
    if (!ms || ms <= 0 || !Number.isFinite(ms)) {
        try {
            return await p;
        }
        catch {
            return null;
        }
    }
    let timer = null;
    return new Promise((resolve) => {
        const done = (v) => {
            if (timer)
                clearTimeout(timer);
            resolve(v);
        };
        timer = setTimeout(() => done(null), ms);
        p.then((v) => done(v)).catch(() => done(null));
    });
}
/** 高性能字符串分块构建器，避免 O(n^2) 级别的拼接 */
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
/** HTML 高性能转义（按需触发，一次扫描） */
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
        // & < > " '
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
/** RFC3339/ISO8601（UTC）格式化工具：毫秒 */
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
    const Y = d.getUTCFullYear();
    const M = d.getUTCMonth() + 1;
    const D = d.getUTCDate();
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const s = d.getUTCSeconds();
    const ms3 = d.getUTCMilliseconds();
    return `${pad4(Y)}-${pad2(M)}-${pad2(D)}T${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms3)}Z`;
}
/** 秒级 Unix（string/number/bigint） -> RFC3339（UTC） */
function rfc3339FromUnixSeconds(sec) {
    try {
        if (typeof sec === 'bigint') {
            const n = Number(sec * 1000n);
            return Number.isFinite(n) ? rfc3339FromMillis(n) : '1970-01-01T00:00:00.000Z';
        }
        const n = typeof sec === 'string'
            ? Math.trunc(parseInt(sec, 10) * 1000)
            : Math.trunc(sec * 1000);
        return rfc3339FromMillis(n);
    }
    catch {
        return '1970-01-01T00:00:00.000Z';
    }
}
/** 安全的秒 -> Date */
function dateFromUnixSeconds(sec) {
    try {
        if (typeof sec === 'bigint') {
            const n = Number(sec * 1000n);
            return Number.isFinite(n) ? new Date(n) : new Date(0);
        }
        const n = typeof sec === 'string' ? parseInt(sec, 10) : sec;
        if (!Number.isFinite(n))
            return new Date(0);
        return new Date(Math.trunc(n * 1000));
    }
    catch {
        return new Date(0);
    }
}
let fastJsonParse = (s) => JSON.parse(s);
(function tryLoadSimdJson() {
    try {
        // Node/CommonJS
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = typeof require !== 'undefined' ? require('simdjson') : null;
        if (mod && typeof mod.parse === 'function') {
            fastJsonParse = (s) => mod.parse(s);
        }
    }
    catch {
        // ESM 或不可用环境下静默降级到原生
    }
})();
/** 默认解析器配置（含新增默认） */
const DEFAULT_PARSER_CONFIG = {
    includeResourceLinks: true,
    includeSystemMessages: true,
    parseMarketFace: true,
    parseCardMessages: true,
    parseMultiForward: true,
    fetchUserInfo: false,
    timeFormat: 'YYYY-MM-DD HH:mm:ss',
    maxTextLength: 50000,
    debugMode: false,
    obParseTimeoutMs: 400,
    quickReply: true,
    obMode: 'prefer-native',
    fallback: 'native',
    html: 'full',
    rawStrategy: 'string',
    progressEvery: 100,
    yieldEvery: 1000,
    suppressFallbackWarn: true,
    stopOnAbort: true
};
/* ---------------------------------- 主解析器 ---------------------------------- */
export class MessageParser {
    core;
    config;
    oneBotMsgApi;
    /** 用户信息缓存 */
    userInfoCache = new Map();
    /** 表情映射缓存 */
    faceMap = new Map();
    /** 并发度（内部自适应，可被配置覆盖） */
    concurrency;
    constructor(core, config = {}) {
        this.core = core;
        this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
        this.concurrency = this.config.concurrency ?? resolveConcurrency();
        // 仅需转换器
        this.oneBotMsgApi = new OneBotMsgApi(null, core);
        this.initializeFaceMap();
    }
    /**
     * 解析消息列表（高并发 + 有序输出 + 超时快回退 + 让步）
     * - 自动跳过空消息与（可选）系统消息
     * - OB 与原生两路可切换
     */
    async parseMessages(messages) {
        const total = messages.length;
        const start = Date.now();
        let processed = 0;
        this.log(`开始使用解析器处理 ${total} 条消息... 并发=${this.concurrency} 模式=${this.config.obMode}`);
        const preferNative = this.config.obMode === 'native-only' || this.config.obMode === 'prefer-native';
        const obOnly = this.config.obMode === 'ob-only';
        const results = await mapLimit(messages, this.concurrency, async (message, idx) => {
            try {
                if (this.config.signal?.aborted && this.config.stopOnAbort)
                    return null;
                if (!message || !message.msgId)
                    return null;
                if (!this.config.includeSystemMessages && this.isSystemMessage(message))
                    return null;
                const t0 = Date.now();
                let parsed = null;
                if (preferNative) {
                    // 原生优先：完全本地解析，不走 OneBot
                    parsed = await this.parseMessage(message);
                }
                else {
                    // 先尝试 OneBot（带超时 + quick_reply）
                    const obPromise = this.oneBotMsgApi.parseMessageV2(message, this.config.parseMultiForward, !this.config.includeResourceLinks, this.config.quickReply // 快速模式，避免重型引用抓取
                    );
                    const ob11Result = await withTimeout(obPromise, this.config.obParseTimeoutMs);
                    if (ob11Result && ob11Result.arrayMsg) {
                        parsed = this.convertOB11MessageToParsedMessage(ob11Result.arrayMsg, message, Date.now() - t0);
                    }
                    else if (obOnly) {
                        // OB-only 模式：只要 OB 失败就走最轻的 fallback（不再卡死）
                        if (!this.config.suppressFallbackWarn) {
                            this.log(`OneBot解析失败/超时（OB-only），使用 basic fallback: ${message.msgId}`, 'warn');
                        }
                        parsed = this.createFallbackMessage(message);
                    }
                    else {
                        // prefer-ob 但失败 => 原生回退
                        if (!this.config.suppressFallbackWarn) {
                            this.log(`OneBot解析失败/超时，回退到本地解析: ${message.msgId}`, 'warn');
                        }
                        parsed = await this.parseMessage(message);
                    }
                }
                // 进度（按配置节流）
                processed++;
                if (this.config.onProgress) {
                    this.config.onProgress(processed, total);
                }
                else if (processed % this.config.progressEvery === 0) {
                    this.log(`已解析 ${processed}/${total} 条消息`);
                }
                // 周期性让出事件循环
                if (this.config.yieldEvery > 0 && (idx + 1) % this.config.yieldEvery === 0) {
                    await yieldToEventLoop();
                }
                return parsed;
            }
            catch (err) {
                this.log(`解析消息失败 (${message?.msgId || 'unknown'}): ${err}`, 'error');
                return message ? this.createErrorMessage(message, err) : null;
            }
        });
        // 压紧输出（保持原有顺序，剔除 null）
        const out = [];
        for (let i = 0; i < results.length; i++) {
            const v = results[i];
            if (v)
                out.push(v);
        }
        const duration = Date.now() - start;
        this.log(`消息解析完成，共 ${out.length} 条，耗时 ${duration}ms`);
        return out;
    }
    /**
     * 将 OneBot 消息转换为 ParsedMessage 格式（单趟处理 + 可选产出 HTML/RAW）
     */
    convertOB11MessageToParsedMessage(ob11Msg, rawMsg, elapsedMs = 0) {
        const content = {
            text: ob11Msg.raw_message || '',
            html: '',
            raw: this.config.rawStrategy === 'string' ? JSON.stringify(ob11Msg.message) : '',
            mentions: [],
            resources: [],
            emojis: [],
            special: []
        };
        const checkedAt = new Date(); // 复用同一时间戳，减少 Date 分配
        // 单趟扫描 OB11 段
        if (Array.isArray(ob11Msg.message)) {
            for (let i = 0; i < ob11Msg.message.length; i++) {
                const seg = ob11Msg.message[i];
                this.processOB11Segment(seg, content, checkedAt);
            }
        }
        if (this.config.html !== 'none') {
            content.html = this.generateHtmlFromOB11(ob11Msg.message);
        }
        return {
            messageId: rawMsg.msgId,
            messageSeq: rawMsg.msgSeq,
            msgRandom: rawMsg.msgRandom,
            timestamp: dateFromUnixSeconds(rawMsg.msgTime),
            sender: {
                uid: rawMsg.senderUid,
                uin: rawMsg.senderUin,
                name: rawMsg.sendNickName || rawMsg.sendRemarkName,
                avatar: undefined,
                role: undefined
            },
            receiver: {
                uid: rawMsg.peerUid,
                type: rawMsg.chatType === 2 ? 'group' : 'private'
            },
            messageType: rawMsg.msgType,
            isSystemMessage: this.isSystemMessage(rawMsg),
            isRecalled: this.isRecalledMessage(rawMsg),
            isTempMessage: false,
            stats: {
                elementCount: rawMsg.elements?.length || 0,
                resourceCount: content.resources.length,
                textLength: content.text.length,
                processingTime: elapsedMs
            },
            content,
            rawMessage: rawMsg
        };
    }
    /**
     * 处理 OneBot 段（极简分支 + 复用日期对象）
     */
    processOB11Segment(segment, content, checkedAt) {
        switch (segment.type) {
            case 'text':
                // 文本内容已在 raw_message 中
                break;
            case 'at': {
                const isAll = segment.data.qq === 'all';
                content.mentions.push({
                    uid: isAll ? 'all' : segment.data.qq,
                    name: segment.data.name,
                    type: isAll ? 'all' : 'user'
                });
                break;
            }
            case 'image': {
                content.resources.push({
                    type: 'image',
                    fileName: segment.data.file || 'unknown.jpg',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'image/jpeg',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt
                });
                break;
            }
            case 'file': {
                content.resources.push({
                    type: 'file',
                    fileName: segment.data.file || 'unknown',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'application/octet-stream',
                    md5: segment.data.file_id,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt
                });
                break;
            }
            case 'video': {
                content.resources.push({
                    type: 'video',
                    fileName: segment.data.file || 'unknown.mp4',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'video/mp4',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt
                });
                break;
            }
            case 'voice': {
                content.resources.push({
                    type: 'audio',
                    fileName: segment.data.file || 'unknown.amr',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'audio/amr',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt
                });
                break;
            }
            case 'face': {
                const id = segment.data.id;
                content.emojis.push({
                    id,
                    name: this.faceMap.get(id) || `表情${id}`,
                    url: undefined,
                    type: 'face'
                });
                break;
            }
            case 'reply': {
                if (!content.reply) {
                    content.reply = {
                        messageId: segment.data.id,
                        senderName: undefined,
                        content: '引用消息',
                        elements: []
                    };
                }
                break;
            }
            default:
                content.special.push({
                    type: segment.type,
                    data: segment.data,
                    description: `${segment.type}类型消息`
                });
                break;
        }
    }
    /**
     * 从 OneBot 消息生成 HTML（单趟）
     */
    generateHtmlFromOB11(message) {
        if (this.config.html === 'none')
            return '';
        if (!Array.isArray(message))
            return '';
        const b = new ChunkedBuilder();
        for (let i = 0; i < message.length; i++) {
            const seg = message[i];
            switch (seg.type) {
                case 'text':
                    b.push(escapeHtmlFast(seg.data.text));
                    break;
                case 'at':
                    b.push(`<span class="at">@${seg.data.qq === 'all' ? '全体成员' : seg.data.qq}</span>`);
                    break;
                case 'image':
                    b.push(`<img src="${seg.data.url || ''}" alt="图片" />`);
                    break;
                case 'face':
                    b.push(`<span class="emoji">[表情:${seg.data.id}]</span>`);
                    break;
                case 'file':
                    b.push(`<span class="file">[文件:${seg.data.file}]</span>`);
                    break;
                case 'video':
                    b.push(`<span class="video">[视频:${seg.data.file}]</span>`);
                    break;
                case 'voice':
                    b.push(`<span class="voice">[语音]</span>`);
                    break;
                case 'reply':
                    b.push(`<span class="reply">[回复消息]</span>`);
                    break;
                default:
                    b.push(`<span class="special">[${seg.type}]</span>`);
                    break;
            }
        }
        return b.toString();
    }
    /** 兼容旧名方法（内部调用高性能实现） */
    escapeHtml(text) {
        return escapeHtmlFast(text);
    }
    /**
     * 解析单条消息（原生路径，完全本地，无 OB 调用）
     */
    async parseMessage(message) {
        const start = Date.now();
        try {
            const sender = await this.parseSenderInfo(message);
            const receiver = this.parseReceiverInfo(message);
            const content = await this.parseMessageContent(message.elements || []);
            const stats = {
                elementCount: (message.elements && message.elements.length) || 0,
                resourceCount: content.resources.length,
                textLength: content.text.length,
                processingTime: Date.now() - start
            };
            return {
                messageId: message.msgId,
                messageSeq: message.msgSeq,
                msgRandom: message.msgRandom,
                timestamp: dateFromUnixSeconds(message.msgTime),
                sender,
                receiver,
                messageType: message.msgType,
                isSystemMessage: this.isSystemMessage(message),
                isRecalled: this.isRecalledMessage(message),
                isTempMessage: this.isTempMessage(message),
                content,
                stats,
                rawMessage: message
            };
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '解析消息失败',
                details: error,
                timestamp: new Date(),
                context: { messageId: message.msgId }
            });
        }
    }
    /**
     * 解析消息内容（单趟 + 分块构建 + 可选 HTML/RAW）
     */
    async parseMessageContent(elements) {
        const textB = new ChunkedBuilder();
        const htmlB = new ChunkedBuilder();
        const rawB = new ChunkedBuilder();
        const mentions = [];
        const resources = [];
        const emojis = [];
        const special = [];
        let reply;
        let location;
        let card;
        let multiForward;
        let calendar;
        const checkedAt = new Date();
        const ctxText = (t, h) => {
            textB.push(t);
            if (this.config.html !== 'none')
                htmlB.push(h);
        };
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            const elementType = element.elementType;
            if (this.config.rawStrategy === 'string') {
                rawB.push(JSON.stringify(element));
                rawB.push('\n');
            }
            try {
                switch (elementType) {
                    case ElementType.TEXT:
                        if (element.textElement) {
                            const content = element.textElement.content || '';
                            ctxText(content, escapeHtmlFast(content));
                        }
                        break;
                    case ElementType.PIC:
                        if (element.picElement) {
                            const pic = element.picElement;
                            const resource = {
                                type: 'image',
                                fileName: pic.fileName || 'image.jpg',
                                fileSize: parseInt(pic.fileSize?.toString() || '0', 10),
                                originalUrl: pic.originImageUrl || '',
                                md5: pic.md5HexStr || '',
                                accessible: !!pic.originImageUrl,
                                checkedAt
                            };
                            resources.push(resource);
                            const altText = `[图片${pic.fileName ? `: ${pic.fileName}` : ''}]`;
                            if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                                ctxText(altText, `<img src="${resource.originalUrl}" alt="${pic.fileName}" class="message-image" />`);
                            }
                            else {
                                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
                            }
                        }
                        break;
                    case ElementType.VIDEO:
                        if (element.videoElement) {
                            const video = element.videoElement;
                            const resource = {
                                type: 'video',
                                fileName: video.fileName || 'video.mp4',
                                fileSize: parseInt(video.fileSize?.toString() || '0', 10),
                                originalUrl: '',
                                md5: video.fileUuid || '',
                                accessible: false,
                                checkedAt
                            };
                            resources.push(resource);
                            const altText = `[视频${video.fileName ? `: ${video.fileName}` : ''}]`;
                            if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                                ctxText(altText, `<video src="${resource.originalUrl}" controls class="message-video">${altText}</video>`);
                            }
                            else {
                                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
                            }
                        }
                        break;
                    case ElementType.PTT:
                        if (element.pttElement) {
                            const ptt = element.pttElement;
                            const resource = {
                                type: 'audio',
                                fileName: ptt.fileName || 'audio.wav',
                                fileSize: parseInt(ptt.fileSize?.toString() || '0', 10),
                                originalUrl: '',
                                md5: ptt.md5HexStr || '',
                                accessible: false,
                                checkedAt
                            };
                            resources.push(resource);
                            const duration = ptt.duration ? `${Math.round(ptt.duration)}秒` : '';
                            const altText = `[语音${duration ? ` ${duration}` : ''}]`;
                            if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                                ctxText(altText, `<audio src="${resource.originalUrl}" controls class="message-audio">${altText}</audio>`);
                            }
                            else {
                                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
                            }
                        }
                        break;
                    case ElementType.FILE:
                        if (element.fileElement) {
                            const file = element.fileElement;
                            const resource = {
                                type: 'file',
                                fileName: file.fileName || 'file',
                                fileSize: parseInt(file.fileSize?.toString() || '0', 10),
                                originalUrl: '',
                                md5: file.fileMd5 || '',
                                accessible: false,
                                checkedAt
                            };
                            resources.push(resource);
                            const altText = `[文件: ${resource.fileName}]`;
                            if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                                ctxText(altText, `<a href="${resource.originalUrl}" class="message-file" download="${resource.fileName}">${altText}</a>`);
                            }
                            else {
                                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
                            }
                        }
                        break;
                    case ElementType.FACE:
                        if (element.faceElement) {
                            const face = element.faceElement;
                            const faceId = face.faceIndex?.toString() || '';
                            const faceName = face.faceText || this.faceMap.get(faceId) || `表情${faceId}`;
                            emojis.push({ id: faceId, name: faceName, type: 'face' });
                            const faceText = `[${faceName}]`;
                            ctxText(faceText, (this.config.html !== 'none') ? `<span class="emoji face" data-id="${faceId}">${faceText}</span>` : '');
                        }
                        break;
                    case ElementType.MFACE:
                        if (element.marketFaceElement && this.config.parseMarketFace) {
                            const marketFace = element.marketFaceElement;
                            const faceName = marketFace.faceName || '超级表情';
                            const emojiId = marketFace.emojiId || '';
                            emojis.push({ id: emojiId, name: faceName, url: undefined, type: 'market' });
                            const faceText = `[${faceName}]`;
                            ctxText(faceText, (this.config.html !== 'none') ? `<span class="emoji market-face">${faceText}</span>` : '');
                        }
                        break;
                    case ElementType.REPLY:
                        if (element.replyElement) {
                            // 原生路径不额外抓取被引用正文，保持轻量
                            reply = await this.parseReplyElement(element);
                            const replyText = `[回复 ${reply?.senderName}: ${reply?.content}]`;
                            ctxText(`${replyText}\n`, (this.config.html !== 'none')
                                ? `<div class="reply">[回复 ${escapeHtmlFast(reply?.senderName || '')}: ${escapeHtmlFast(reply?.content || '')}]</div>`
                                : '');
                        }
                        break;
                    case ElementType.ARK:
                        if (element.arkElement && this.config.parseCardMessages) {
                            card = await this.parseArkElement(element);
                            const t = `[卡片消息: ${card?.title}]`;
                            ctxText(t, (this.config.html !== 'none') ? `<div class="card">[卡片消息: ${escapeHtmlFast(card?.title || '')}]</div>` : '');
                        }
                        break;
                    case ElementType.MULTIFORWARD:
                        if (element.multiForwardMsgElement && this.config.parseMultiForward) {
                            multiForward = await this.parseMultiForwardElement(element);
                            const t = `[合并转发: ${multiForward?.title}]`;
                            ctxText(t, (this.config.html !== 'none') ? `<div class="multi-forward">[合并转发: ${escapeHtmlFast(multiForward?.title || '')}]</div>` : '');
                        }
                        break;
                    case ElementType.SHARELOCATION:
                        if (element.shareLocationElement) {
                            location = await this.parseLocationElement(element);
                            const t = `[位置: ${location?.title || location?.address}]`;
                            ctxText(t, (this.config.html !== 'none') ? `<div class="location">[位置: ${escapeHtmlFast(location?.title || location?.address || '')}]</div>` : '');
                        }
                        break;
                    case ElementType.CALENDAR:
                        if (element.calendarElement) {
                            calendar = await this.parseCalendarElement(element);
                            const t = `[日历: ${calendar?.title}]`;
                            ctxText(t, (this.config.html !== 'none') ? `<div class="calendar">[日历: ${escapeHtmlFast(calendar?.title || '')}]</div>` : '');
                        }
                        break;
                    case ElementType.MARKDOWN:
                        if (element.markdownElement) {
                            const md = element.markdownElement.content || '';
                            ctxText(md, (this.config.html !== 'none') ? `<div class="markdown">${escapeHtmlFast(md)}</div>` : '');
                        }
                        break;
                    case ElementType.GreyTip:
                        if (element.grayTipElement) {
                            const gt = element.grayTipElement.subElementType?.toString() || '系统消息';
                            const t = `[${gt}]`;
                            ctxText(t, (this.config.html !== 'none') ? `<div class="system-message">[${escapeHtmlFast(gt)}]</div>` : '');
                        }
                        break;
                    default: {
                        const specialInfo = await this.parseSpecialElement(element);
                        if (specialInfo) {
                            special.push(specialInfo);
                            const d = `[${specialInfo.description}]`;
                            ctxText(d, (this.config.html !== 'none') ? `<div class="special">[${escapeHtmlFast(specialInfo.description)}]</div>` : '');
                        }
                        break;
                    }
                }
            }
            catch (error) {
                this.log(`解析元素失败 (type: ${elementType}): ${error}`, 'warn');
                special.push({
                    type: `error_${elementType}`,
                    data: element,
                    description: `解析失败的元素 (${ElementType[elementType] || elementType})`
                });
                const errT = `[解析失败的消息元素]`;
                ctxText(errT, (this.config.html !== 'none') ? `<span class="parse-error">[解析失败的消息元素]</span>` : '');
            }
        }
        // 解析 @
        const atResults = this.parseAtMentions(textB.toString());
        for (let i = 0; i < atResults.length; i++) {
            const at = atResults[i];
            if (at) {
                mentions.push(at);
            }
        }
        return {
            text: textB.toString().trim(),
            html: this.config.html !== 'none' ? htmlB.toString().trim() : '',
            raw: this.config.rawStrategy === 'string' ? rawB.toString().trim() : '',
            mentions,
            reply,
            resources,
            emojis,
            location,
            card,
            multiForward,
            calendar,
            special
        };
    }
    /** 普通表情/超级表情等已内联在 parseMessageContent */
    async parseReplyElement(element) {
        if (!element.replyElement)
            return undefined;
        const reply = element.replyElement;
        return {
            messageId: reply.sourceMsgIdInRecords || '',
            senderName: reply.senderUidStr || '',
            content: this.extractReplyContent(reply),
            elements: []
        };
    }
    async parseArkElement(element) {
        if (!element.arkElement || !this.config.parseCardMessages)
            return undefined;
        const ark = element.arkElement;
        try {
            const data = fastJsonParse(ark.bytesData || '{}');
            return {
                title: data.prompt || data.title || '卡片消息',
                content: data.desc || data.summary || '',
                url: data.url || data.jumpUrl || '',
                preview: data.preview || '',
                type: 'ark'
            };
        }
        catch (error) {
            this.log(`解析ARK卡片失败: ${error}`, 'warn');
            return {
                title: '卡片消息',
                content: ark.bytesData || '',
                url: '',
                preview: '',
                type: 'ark'
            };
        }
    }
    async parseMultiForwardElement(element) {
        if (!element.multiForwardMsgElement || !this.config.parseMultiForward)
            return undefined;
        const mf = element.multiForwardMsgElement;
        return {
            title: mf.xmlContent || '聊天记录',
            summary: '合并转发的聊天记录',
            messageCount: 0,
            senderNames: []
        };
    }
    async parseLocationElement(_element) {
        // 结构未完全公开，保持占位语义不变
        return {
            latitude: 0,
            longitude: 0,
            title: '位置信息',
            address: ''
        };
    }
    async parseCalendarElement(element) {
        if (!element.calendarElement)
            return undefined;
        const calendar = element.calendarElement;
        return {
            title: '日历事件',
            startTime: new Date(),
            description: JSON.stringify(calendar)
        };
    }
    async parseSpecialElement(element) {
        const t = element.elementType;
        const name = ElementType[t] || `UNKNOWN_${t}`;
        return {
            type: name,
            data: element,
            description: `${name}消息`
        };
    }
    AT_REGEX = /@[\w\u4e00-\u9fa5]+/g;
    parseAtMentions(text) {
        const mentions = [];
        if (!text)
            return mentions;
        if (text.includes('@全体成员') || text.includes('@everyone')) {
            mentions.push({ uid: 'all', name: '全体成员', type: 'all' });
        }
        const matches = text.match(this.AT_REGEX);
        if (matches) {
            for (let i = 0; i < matches.length; i++) {
                const name = matches[i].substring(1);
                mentions.push({ uid: 'unknown', name, type: 'user' });
            }
        }
        return mentions;
    }
    async parseSenderInfo(message) {
        const uid = message.senderUid || message.peerUid;
        let userInfo = null;
        if (this.config.fetchUserInfo && uid) {
            userInfo = this.userInfoCache.get(uid);
            if (!userInfo) {
                try {
                    userInfo = await this.core.apis.UserApi.getUserDetailInfo(uid, false);
                    if (userInfo)
                        this.userInfoCache.set(uid, userInfo);
                }
                catch (error) {
                    this.log(`获取用户信息失败 (${uid}): ${error}`, 'warn');
                }
            }
        }
        return {
            uid,
            uin: message.senderUin || userInfo?.uin,
            name: message.sendNickName || userInfo?.nick || undefined,
            avatar: userInfo?.avatarUrl,
            role: undefined
        };
    }
    parseReceiverInfo(message) {
        if (message.chatType === 1) {
            return { uid: message.peerUid, name: undefined, type: 'private' };
        }
        else if (message.chatType === 2) {
            return { uid: message.peerUid, name: undefined, type: 'group' };
        }
        return undefined;
    }
    isSystemMessage(message) {
        return (message.msgType === NTMsgType.KMSGTYPEGRAYTIPS ||
            (message.elements && message.elements.length === 1 && message.elements[0]?.elementType === ElementType.GreyTip));
    }
    isRecalledMessage(message) {
        return message.recallTime !== '0' && message.recallTime !== undefined;
    }
    isTempMessage(message) {
        return message.chatType === 100;
    }
    extractReplyContent(replyElement) {
        try {
            const elements = replyElement.sourceMsgElements || [];
            const b = new ChunkedBuilder();
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.textElement)
                    b.push(el.textElement.content || '');
                else if (el.picElement)
                    b.push('[图片]');
                else if (el.videoElement)
                    b.push('[视频]');
                else if (el.pttElement)
                    b.push('[语音]');
                else if (el.fileElement)
                    b.push(`[文件: ${el.fileElement.fileName || ''}]`);
            }
            const s = b.toString().trim();
            return s || '原消息';
        }
        catch {
            return '原消息';
        }
    }
    createFallbackMessage(message) {
        const timestamp = dateFromUnixSeconds(message.msgTime);
        // 提取文本
        let textContent = '';
        if (message.elements && message.elements.length > 0) {
            const b = new ChunkedBuilder();
            for (let i = 0; i < message.elements.length; i++) {
                const e = message.elements[i];
                if (e.textElement)
                    b.push(e.textElement?.content || '');
            }
            textContent = b.toString().trim();
            if (!textContent) {
                const b2 = new ChunkedBuilder();
                for (let i = 0; i < message.elements.length; i++) {
                    const e = message.elements[i];
                    if (e.picElement)
                        b2.push('[图片]');
                    else if (e.videoElement)
                        b2.push('[视频]');
                    else if (e.fileElement)
                        b2.push('[文件]');
                    else if (e.pttElement)
                        b2.push('[语音]');
                    else if (e.faceElement)
                        b2.push('[表情]');
                    else if (e.marketFaceElement)
                        b2.push('[表情包]');
                    else if (e.replyElement)
                        b2.push('[回复]');
                    else
                        b2.push('[消息]');
                }
                textContent = b2.toString() || '[消息内容]';
            }
        }
        return {
            messageId: message.msgId,
            messageSeq: message.msgSeq,
            msgRandom: message.msgRandom,
            timestamp,
            sender: {
                uid: message.senderUid || '0',
                uin: message.senderUin || '0',
                name: message.sendNickName || message.sendRemarkName || '未知用户'
            },
            receiver: {
                uid: message.peerUid,
                type: message.chatType === 2 ? 'group' : 'private'
            },
            messageType: message.msgType,
            isSystemMessage: this.isSystemMessage(message),
            isRecalled: this.isRecalledMessage(message),
            isTempMessage: false,
            content: {
                text: textContent,
                html: this.config.html !== 'none' ? escapeHtmlFast(textContent) : '',
                raw: this.config.rawStrategy === 'string' ? JSON.stringify(message.elements || []) : '',
                mentions: [],
                resources: [],
                emojis: [],
                special: []
            },
            stats: {
                elementCount: message.elements?.length || 0,
                resourceCount: 0,
                textLength: textContent.length,
                processingTime: 0
            },
            rawMessage: message
        };
    }
    createErrorMessage(originalMessage, error) {
        return {
            messageId: originalMessage.msgId,
            messageSeq: originalMessage.msgSeq,
            timestamp: dateFromUnixSeconds(originalMessage.msgTime),
            sender: {
                uid: originalMessage.senderUid || 'unknown',
                name: originalMessage.sendNickName || '未知用户'
            },
            messageType: originalMessage.msgType,
            isSystemMessage: false,
            isRecalled: false,
            isTempMessage: false,
            content: {
                text: '[消息解析失败]',
                html: this.config.html !== 'none' ? '<span class="error">[消息解析失败]</span>' : '',
                raw: this.config.rawStrategy === 'string' ? JSON.stringify(originalMessage) : '',
                mentions: [],
                resources: [],
                emojis: [],
                special: [
                    {
                        type: 'error',
                        data: error,
                        description: '消息解析失败'
                    }
                ]
            },
            stats: {
                elementCount: 0,
                resourceCount: 0,
                textLength: 0,
                processingTime: 0
            },
            rawMessage: originalMessage
        };
    }
    initializeFaceMap() {
        this.faceMap.set('0', '微笑');
        this.faceMap.set('1', '撇嘴');
        this.faceMap.set('2', '色');
        this.faceMap.set('3', '发呆');
        this.faceMap.set('4', '得意');
        this.faceMap.set('5', '流泪');
        this.faceMap.set('6', '害羞');
        this.faceMap.set('7', '闭嘴');
        this.faceMap.set('8', '睡');
        this.faceMap.set('9', '大哭');
        this.faceMap.set('10', '尴尬');
        // ...更多表情映射
    }
    log(message, level = 'info') {
        if (!this.config.debugMode && level === 'debug')
            return;
        const prefix = '[MessageParser]';
        switch (level) {
            case 'debug':
                console.debug(`${prefix} ${message}`);
                break;
            case 'info':
                console.log(`${prefix} ${message}`);
                break;
            case 'warn':
                if (!this.config.suppressFallbackWarn) {
                    console.warn(`${prefix} ${message}`);
                }
                break;
            case 'error':
                console.error(`${prefix} ${message}`);
                break;
        }
    }
    clearCache() {
        this.userInfoCache.clear();
        this.log('缓存已清除');
    }
    getStats() {
        return {
            userCacheSize: this.userInfoCache.size,
            faceMappingSize: this.faceMap.size
        };
    }
}
//# sourceMappingURL=MessageParser.js.map