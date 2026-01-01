import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { once } from 'events';
import type { CleanMessage } from '../parser/SimpleMessageParser.js';
import {
    renderTemplate,
    MODERN_CSS,
    MODERN_TOOLBAR_HTML,
    MODERN_FOOTER_HTML,
    MODERN_SINGLE_SCRIPTS_HTML,
    MODERN_SINGLE_HTML_TOP_TEMPLATE,
    MODERN_SINGLE_HTML_BOTTOM_TEMPLATE,
    MODERN_CHUNKED_INDEX_HTML_TEMPLATE,
    MODERN_CHUNKED_APP_JS
} from './ModernHtmlTemplates.js';

/**
 * HTML导出选项
 */
export interface HtmlExportOptions {
    outputPath: string;
    includeResourceLinks?: boolean;
    includeSystemMessages?: boolean;
    encoding?: string; // 建议使用 'utf8'
}

/**
 * Chunked 导出选项
 */
export interface ChunkedHtmlExportOptions {
    /**
     * 资源与数据目录名（相对于 outputPath 所在目录）
     * 默认：
     * - assetsDirName = 'assets'
     * - dataDirName   = 'data'
     * - chunksDirName = 'chunks'
     * - indexDirName  = 'index'
     */
    assetsDirName?: string;
    dataDirName?: string;
    chunksDirName?: string;
    indexDirName?: string;

    /**
     * 分块策略
     * - maxMessagesPerChunk: 每个 chunk 最大消息数（默认 2000）
     * - maxChunkBytes: chunk 文件软限制（默认 50MB）
     */
    maxMessagesPerChunk?: number;
    maxChunkBytes?: number;

    /**
     * 全文搜索索引（Chunk 级 Bloom Filter）
     * - enableTextBloom: 是否生成文本 Bloom（默认 true）
     * - bloomTextBits / bloomTextHashes: Bloom 参数（默认 16384 bits / 6 hashes）
     * - bloomSenderBits / bloomSenderHashes: sender Bloom 参数（默认 2048 bits / 4 hashes）
     * - bloomMaxCharsPerMessage: 单条消息用于 Bloom 的最大字符数（默认 8192）
     */
    enableTextBloom?: boolean;
    bloomTextBits?: number;
    bloomTextHashes?: number;
    bloomSenderBits?: number;
    bloomSenderHashes?: number;
    bloomMaxCharsPerMessage?: number;

    /**
     * message.text 存储长度（用于 viewer 端 message-level 快速 contains）
     * - 默认 4096
     * - 若被截断，会写入 textTruncated=true，viewer 会在必要时回退用 html.toLowerCase().includes(term) 兜底，保证不漏
     */
    storeTextMaxChars?: number;

    /**
     * msgId 索引（用于 reply 跳转跨 chunk）
     * - bucketCount: 分桶数量（默认 64）
     * - viewer 会按需加载 bucket 文件（JSONP），不需要一次性加载全量 mapping
     */
    msgIdIndexBucketCount?: number;

    /**
     * 是否输出 manifest.json（默认 true）
     * - manifest.js 总是输出（file:// 下无需 fetch）
     */
    writeManifestJson?: boolean;
}

/**
 * Chunked 导出结果
 */
export interface ChunkedHtmlExportResult {
    outputDir: string;
    indexHtmlPath: string;
    manifestJsPath: string;
    manifestJsonPath?: string;
    chunkCount: number;
    totalMessages: number;
    copiedResources: string[];
}

/**
 * 聊天信息接口
 */
interface ChatInfo {
    name: string;
    type: 'private' | 'group';
    avatar?: string;
    selfUid?: string;
    selfUin?: string;
    selfName?: string;
}

/** 内部资源任务结构 */
type ResourceTask = {
    type: string;              // image / video / audio / file / ...
    fileName: string;
    localPath: string;
    url?: string;
};

/**
 * 现代化HTML导出器
 */
export class ModernHtmlExporter {
    private readonly options: HtmlExportOptions;
    private currentChatInfo?: ChatInfo;
    private lastRenderedDate?: string;

    /**
     * 资源引用基础路径（URL 相对前缀）
     * - 单文件导出使用 './resources'（资源目录与 HTML 同级，便于独立移动）
     * - Chunked 方案使用 'resources'（无 ./ 前缀）
     * 
     * 修复 Issue #213: 自定义路径导出时图片无法显示的问题
     * 原因：之前使用 '../resources' 假设 HTML 在 exports 子目录，资源在父目录
     * 现在：资源目录与 HTML 文件同级，确保导出文件可独立移动
     */
    private resourceBaseHref: string = './resources';

    constructor(options: HtmlExportOptions) {
        this.options = {
            includeResourceLinks: true,
            includeSystemMessages: true,
            encoding: 'utf8', // 更稳妥的 Node 编码常量
            ...options
        };
    }

    /**
     * 导出聊天记录为HTML（保持原签名，内部走流式）
     */
    async export(messages: CleanMessage[], chatInfo: ChatInfo): Promise<void> {
        // 若上游可以改造成 (Async)Iterable，这里可直接传入以实现端到端流式
        await this.exportFromIterable(messages, chatInfo);
    }

    /**
     * 新增：Chunked Viewer 导出（可选接口）
     * - 输出：index.html + assets/ + data/manifest(.js/.json) + data/chunks/*.js + data/index/msgid_bXX.js
     * - 特性：Streaming 写入、分块、索引、资源复制并发受限，避免 OOM
     */
    async exportChunked(messages: CleanMessage[], chatInfo: ChatInfo, options?: ChunkedHtmlExportOptions): Promise<ChunkedHtmlExportResult> {
        return await this.exportChunkedFromIterable(messages, chatInfo, options);
    }

    /**
     * 新增：从 Iterable/AsyncIterable 进行 Chunked 导出（最低内存占用）
     */
    async exportChunkedFromIterable(
        messages: Iterable<CleanMessage> | AsyncIterable<CleanMessage>,
        chatInfo: ChatInfo,
        options: ChunkedHtmlExportOptions = {}
    ): Promise<ChunkedHtmlExportResult> {
        const encoding = (this.options.encoding || 'utf8') as BufferEncoding;

        const outputDir = path.dirname(this.options.outputPath);
        await fsp.mkdir(outputDir, { recursive: true });

        // dirs
        const assetsDirName = options.assetsDirName || 'assets';
        const dataDirName = options.dataDirName || 'data';
        const chunksDirName = options.chunksDirName || 'chunks';
        const indexDirName = options.indexDirName || 'index';

        const assetsDir = path.join(outputDir, assetsDirName);
        const dataDir = path.join(outputDir, dataDirName);
        const chunksDir = path.join(dataDir, chunksDirName);
        const indexDir = path.join(dataDir, indexDirName);

        await Promise.all([
            fsp.mkdir(assetsDir, { recursive: true }),
            fsp.mkdir(dataDir, { recursive: true }),
            fsp.mkdir(chunksDir, { recursive: true }),
            fsp.mkdir(indexDir, { recursive: true }),
        ]);

        // write assets (style.css + app.js)
        await fsp.writeFile(path.join(assetsDir, 'style.css'), MODERN_CSS, encoding);
        await fsp.writeFile(path.join(assetsDir, 'app.js'), MODERN_CHUNKED_APP_JS, encoding);

        // resource dirs
        if (this.options.includeResourceLinks) {
            const resourceTypes = ['images', 'videos', 'audios', 'files'];
            await Promise.all(
                resourceTypes.map(type =>
                    fsp.mkdir(path.join(outputDir, 'resources', type), { recursive: true })
                )
            );
        }

        // concurrency for resource copy
        const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
        const running: Promise<void>[] = [];
        const copiedResources: string[] = [];
        let copiedCount = 0;

        const scheduleCopy = (task: () => Promise<string | null>) => {
            const p = (async () => {
                try {
                    const resourcePath = await task();
                    if (resourcePath) copiedResources.push(resourcePath);
                    copiedCount++;
                } catch (e) {
                    console.error(`[ModernHtmlExporter][Chunked] 复制资源失败:`, e);
                }
            })();

            p.finally(() => {
                const idx = running.indexOf(p);
                if (idx >= 0) running.splice(idx, 1);
            });

            running.push(p);
            return p;
        };

        // chunk options
        const maxMessagesPerChunk = Math.max(100, options.maxMessagesPerChunk || 2000);
        const maxChunkBytes = Math.max(1 * 1024 * 1024, options.maxChunkBytes || (50 * 1024 * 1024)); // 50MB
        const enableTextBloom = options.enableTextBloom !== false; // default true
        const bloomTextBits = Math.max(2048, options.bloomTextBits || 16384);
        const bloomTextHashes = Math.max(2, options.bloomTextHashes || 6);
        const bloomSenderBits = Math.max(512, options.bloomSenderBits || 2048);
        const bloomSenderHashes = Math.max(2, options.bloomSenderHashes || 4);
        const bloomMaxCharsPerMessage = Math.max(256, options.bloomMaxCharsPerMessage || 8192);
        const storeTextMaxChars = Math.max(256, options.storeTextMaxChars || 4096);
        const msgIdIndexBucketCount = Math.max(8, Math.min(256, options.msgIdIndexBucketCount || 64));
        const writeManifestJson = options.writeManifestJson !== false; // default true

        // manifest structures
        const chunksMeta: any[] = [];
        const sendersByUid: Map<string, { names: Set<string>, displayName: string, count: number }> = new Map();

        let totalMessages = 0;
        let firstTime: Date | null = null;
        let lastTime: Date | null = null;
        let minDateKey: string | null = null;
        let maxDateKey: string | null = null;

        // msgId index bucket streams
        const bucketStreams: fs.WriteStream[] = [];
        const bucketFirst: boolean[] = [];
        const bucketFilePrefix = 'msgid_b';
        const bucketFileExt = '.js';

        const openBucketStreams = async () => {
            for (let i = 0; i < msgIdIndexBucketCount; i++) {
                const hex = i.toString(16).padStart(2, '0');
                const fileName = `${bucketFilePrefix}${hex}${bucketFileExt}`;
                const absPath = path.join(indexDir, fileName);
                const ws = fs.createWriteStream(absPath, { encoding, flags: 'w' });
                ws.on('error', (e) => console.error('[ModernHtmlExporter][Chunked] msgid index 写入错误:', e));
                bucketStreams.push(ws);
                bucketFirst.push(true);
                await this.writeChunk(ws, `window.__QCE_MSGID_INDEX__ && window.__QCE_MSGID_INDEX__(${String(i)}, [\n`);
            }
        };

        const closeBucketStreams = async () => {
            const tasks: Promise<void>[] = [];
            for (let i = 0; i < bucketStreams.length; i++) {
                const ws = bucketStreams[i];
                tasks.push((async () => {
                    await this.writeChunk(ws, `\n]);\n`);
                    ws.end();
                    await once(ws, 'finish');
                })());
            }
            await Promise.all(tasks);
        };

        const hashToBucket = (msgId: string) => {
            // same as viewer: FNV1a32 % bucketCount
            const h = fnv1a32(msgId, 0x811c9dc5);
            return (h % msgIdIndexBucketCount) >>> 0;
        };

        // chunk writer state
        let chunkIndex = 0;
        let chunkId = '';
        let chunkWs: fs.WriteStream | null = null;
        let chunkCount = 0;
        let chunkBytes = 0;
        let chunkStartTs = 0;
        let chunkEndTs = 0;
        let chunkStartDate = '';
        let chunkEndDate = '';
        let chunkFirstMsgId = '';
        let chunkLastMsgId = '';

        let textBloom: BloomFilter | null = null;
        let senderBloom: BloomFilter | null = null;
        let textBloomIncomplete = false;

        let isFirstRecordInChunk = true;

        const chunkFileRel = (id: string) => {
            // URL path must use posix separators
            return path.posix.join(dataDirName, chunksDirName, `${id}.js`);
        };

        const bucketFileRel = (bucket: number) => {
            const hex = bucket.toString(16).padStart(2, '0');
            return path.posix.join(dataDirName, indexDirName, `${bucketFilePrefix}${hex}${bucketFileExt}`);
        };

        const startChunk = async () => {
            chunkIndex++;
            chunkId = `c${String(chunkIndex).padStart(6, '0')}`;
            const absPath = path.join(chunksDir, `${chunkId}.js`);
            chunkWs = fs.createWriteStream(absPath, { encoding, flags: 'w' });
            chunkWs.on('error', (e) => console.error('[ModernHtmlExporter][Chunked] chunk 写入错误:', e));
            chunkCount = 0;
            chunkBytes = 0;
            chunkStartTs = 0;
            chunkEndTs = 0;
            chunkStartDate = '';
            chunkEndDate = '';
            chunkFirstMsgId = '';
            chunkLastMsgId = '';
            isFirstRecordInChunk = true;

            textBloomIncomplete = false;
            textBloom = enableTextBloom ? new BloomFilter(bloomTextBits, bloomTextHashes) : null;
            senderBloom = new BloomFilter(bloomSenderBits, bloomSenderHashes);

            await this.writeChunk(chunkWs, `window.__QCE_CHUNK__ && window.__QCE_CHUNK__({id:${JSON.stringify(chunkId)},messages:[\n`);
            chunkBytes += Buffer.byteLength(`window.__QCE_CHUNK__ && window.__QCE_CHUNK__({id:${JSON.stringify(chunkId)},messages:[\n`, encoding);
        };

        const finishChunk = async () => {
            if (!chunkWs) return;
            await this.writeChunk(chunkWs, `\n]});\n`);
            chunkBytes += Buffer.byteLength(`\n]});\n`, encoding);
            chunkWs.end();
            await once(chunkWs, 'finish');

            // meta
            const meta = {
                id: chunkId,
                file: chunkFileRel(chunkId),
                count: chunkCount,
                startTs: chunkStartTs,
                endTs: chunkEndTs,
                startDate: chunkStartDate,
                endDate: chunkEndDate,
                textBloom: textBloom ? textBloom.toBase64() : '',
                textBloomIncomplete: textBloomIncomplete,
                senderBloom: senderBloom ? senderBloom.toBase64() : '',
                firstMsgId: chunkFirstMsgId,
                lastMsgId: chunkLastMsgId,
                bytes: chunkBytes
            };
            chunksMeta.push(meta);

            chunkWs = null;
            textBloom = null;
            senderBloom = null;
        };

        // prepare bucket streams
        await openBucketStreams();

        // setup exporter state
        this.currentChatInfo = chatInfo;
        this.lastRenderedDate = undefined;

        // For chunked viewer, resource href base should be "resources"
        const oldResourceBaseHref = this.resourceBaseHref;
        this.resourceBaseHref = 'resources';

        try {
            // stream process messages
            for await (const message of this.toAsyncIterable(messages)) {
                if (!this.options.includeSystemMessages && this.isSystemMessage(message)) continue;

                const t = this.safeToDate((message as any)?.timestamp || message?.time);
                const ts = t ? t.getTime() : 0;
                const dateInfo = this.getMessageDateInfo(message);
                const dateKey = dateInfo?.key || '';

                // global stats
                if (t) {
                    if (!firstTime || t < firstTime) firstTime = t;
                    if (!lastTime || t > lastTime) lastTime = t;
                }
                if (dateKey) {
                    if (!minDateKey || dateKey < minDateKey) minDateKey = dateKey;
                    if (!maxDateKey || dateKey > maxDateKey) maxDateKey = dateKey;
                }

                // sender stats
                const senderUid = String((message as any)?.sender?.uid || (message as any)?.sender?.uin || '');
                const senderName = this.getDisplayName(message);
                const senderNameLower = senderName ? senderName.toLowerCase() : '';
                if (senderUid) {
                    if (!sendersByUid.has(senderUid)) {
                        sendersByUid.set(senderUid, { names: new Set(), displayName: senderName, count: 0 });
                    }
                    const info = sendersByUid.get(senderUid)!;
                    info.names.add(senderName);
                    info.count++;
                    if (!info.displayName) info.displayName = senderName;
                }

                // ensure chunk
                if (!chunkWs) await startChunk();

                // set chunk boundary stats
                if (chunkCount === 0) {
                    chunkStartTs = ts;
                    chunkStartDate = dateKey;
                    chunkFirstMsgId = `msg-${message.id}`;
                }
                chunkEndTs = ts;
                chunkEndDate = dateKey;
                chunkLastMsgId = `msg-${message.id}`;

                // render HTML
                const html = this.renderMessage(message);

                // extract plain text
                const plain = this.extractPlainText(message);
                const plainLowerFull = plain ? plain.toLowerCase() : '';
                const storedText = plainLowerFull.slice(0, storeTextMaxChars);
                const textTruncated = plainLowerFull.length > storeTextMaxChars;

                // bloom update
                if (senderBloom && senderUid) (senderBloom as BloomFilter).add(senderUid);
                if (enableTextBloom && textBloom) {
                    const bloomText = (plainLowerFull + ' ' + senderNameLower);
                    const bloomSlice = bloomText.slice(0, bloomMaxCharsPerMessage);
                    if (bloomText.length > bloomMaxCharsPerMessage) textBloomIncomplete = true;
                    this.addTextToBloom(textBloom, bloomSlice);
                }

                // write msgId -> chunkId mapping (bucketed)
                const domMsgId = `msg-${message.id}`;
                const b = hashToBucket(domMsgId);
                const bws = bucketStreams[b];
                if (bws) {
                    const pair = JSON.stringify([domMsgId, chunkId]);
                    const sep = bucketFirst[b] ? '' : ',\n';
                    bucketFirst[b] = false;
                    await this.writeChunk(bws, sep + pair);
                }

                // build record
                const record = {
                    id: domMsgId,
                    ts,
                    date: dateKey,
                    uid: senderUid,
                    name: senderName,
                    nameLower: senderNameLower,
                    text: storedText,
                    textTruncated: textTruncated,
                    html
                };

                const json = JSON.stringify(record);
                const prefix = isFirstRecordInChunk ? '' : ',\n';
                isFirstRecordInChunk = false;

                await this.writeChunk(chunkWs!, prefix + json);
                chunkBytes += Buffer.byteLength(prefix + json, encoding);

                totalMessages++;
                chunkCount++;

                // resource copy
                if (this.options.includeResourceLinks) {
                    for (const res of this.iterResources(message)) {
                        while (running.length >= concurrency) await Promise.race(running);
                        scheduleCopy(() => this.copyResourceFileStream(res, outputDir));
                    }
                }

                // rotate chunk
                if (chunkCount >= maxMessagesPerChunk || chunkBytes >= maxChunkBytes) {
                    await finishChunk();
                }
            }

            // final flush
            if (chunkWs) await finishChunk();

            // wait resource copies
            await Promise.all(running);

            // close bucket index streams
            await closeBucketStreams();

            // build manifest
            const exportTimeIso = new Date().toISOString();
            const timeRangeText = firstTime && lastTime
                ? `${firstTime.toLocaleDateString('zh-CN')} 至 ${lastTime.toLocaleDateString('zh-CN')}`
                : '--';

            const senders = Array.from(sendersByUid.entries()).map(([uid, info]) => ({
                uid,
                displayName: info.displayName || uid,
                aliases: Array.from(info.names),
                count: info.count || 0
            }));

            const manifest = {
                format: 'qce-modern-html-chunked',
                version: 1,
                exportTime: exportTimeIso,
                chat: {
                    name: chatInfo.name,
                    type: chatInfo.type,
                    avatar: chatInfo.avatar,
                    selfUid: chatInfo.selfUid,
                    selfUin: chatInfo.selfUin,
                    selfName: chatInfo.selfName
                },
                stats: {
                    totalMessages,
                    firstTime: firstTime ? firstTime.toISOString() : null,
                    lastTime: lastTime ? lastTime.toISOString() : null,
                    timeRangeText,
                    minDateKey: minDateKey || null,
                    maxDateKey: maxDateKey || null
                },
                chunking: {
                    maxMessagesPerChunk,
                    maxChunkBytes
                },
                bloom: {
                    textBits: bloomTextBits,
                    textHashes: bloomTextHashes,
                    senderBits: bloomSenderBits,
                    senderHashes: bloomSenderHashes
                },
                msgidIndex: {
                    bucketCount: msgIdIndexBucketCount,
                    dir: path.posix.join(dataDirName, indexDirName),
                    filePrefix: bucketFilePrefix,
                    fileExt: bucketFileExt
                },
                paths: {
                    assetsDir: assetsDirName,
                    dataDir: dataDirName,
                    chunksDir: path.posix.join(dataDirName, chunksDirName),
                    indexDir: path.posix.join(dataDirName, indexDirName),
                    resourcesDir: 'resources'
                },
                senders,
                chunks: chunksMeta
            };

            // write manifest.js (JSONP)
            const manifestJsPath = path.join(dataDir, 'manifest.js');
            const manifestJsonPath = path.join(dataDir, 'manifest.json');

            await fsp.writeFile(manifestJsPath, `window.__QCE_MANIFEST__ && window.__QCE_MANIFEST__(${JSON.stringify(manifest)});\n`, encoding);
            if (writeManifestJson) {
                await fsp.writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), encoding);
            }

            // write index.html (viewer shell) AFTER stats computed
            const metadata = {
                messageCount: totalMessages,
                chatName: chatInfo.name,
                chatType: chatInfo.type,
                exportTime: exportTimeIso,
                mode: 'chunked'
            };

            const headerHtml = this.generateHeader(chatInfo, { totalMessages: totalMessages }, timeRangeText);
            const indexHtml = renderTemplate(MODERN_CHUNKED_INDEX_HTML_TEMPLATE, {
                METADATA_JSON: JSON.stringify(metadata),
                CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
                TOOLBAR: MODERN_TOOLBAR_HTML,
                HEADER: headerHtml,
                FOOTER: MODERN_FOOTER_HTML
            });

            await fsp.writeFile(this.options.outputPath, indexHtml, encoding);

            // 导出完成，静默处理

            return {
                outputDir,
                indexHtmlPath: this.options.outputPath,
                manifestJsPath,
                manifestJsonPath: writeManifestJson ? manifestJsonPath : undefined,
                chunkCount: chunksMeta.length,
                totalMessages,
                copiedResources
            };

        } catch (error) {
            console.error(`[ModernHtmlExporter][Chunked] 导出发生错误:`, error);
            throw error;
        } finally {
            // restore
            this.resourceBaseHref = oldResourceBaseHref;
            // close bucket streams if something went wrong
            for (const ws of bucketStreams) {
                try { ws.destroy(); } catch { /* noop */ }
            }
        }
    }

    /**
     * 从 Iterable/AsyncIterable 流式导出，最低内存占用
     */
    async exportFromIterable(
        messages: Iterable<CleanMessage> | AsyncIterable<CleanMessage>,
        chatInfo: ChatInfo
    ): Promise<string[]> {
        const outputDir = path.dirname(this.options.outputPath);
        await fsp.mkdir(outputDir, { recursive: true });
        const ws = fs.createWriteStream(this.options.outputPath, {
            encoding: (this.options.encoding || 'utf8') as BufferEncoding,
            flags: 'w'
        });

        this.currentChatInfo = chatInfo;
        this.lastRenderedDate = undefined;

        // 捕获写入流错误
        const onError = (error: unknown) => {
            console.error('[ModernHtmlExporter] 写入流错误:', error);
            try { ws.destroy(); } catch { /* noop */ }
        };

        ws.on('error', onError);

        let totalMessages = 0;
        let firstTime: Date | null = null;
        let lastTime: Date | null = null;

        let copiedCount = 0;
        const copiedResources: string[] = [];

        // 资源复制并发限制（根据 CPU 数量自适应，范围 [2, 8]）
        const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
        const running: Promise<void>[] = [];

        const scheduleCopy = (task: () => Promise<string | null>) => {
            const p = (async () => {
                try {
                    const resourcePath = await task();
                    if (resourcePath) {
                        copiedResources.push(resourcePath);
                    }
                    copiedCount++;
                } catch (e) {
                    console.error(`[ModernHtmlExporter] 复制资源失败:`, e);
                }
            })();

            // 完成后从运行集中移除
            p.finally(() => {
                const idx = running.indexOf(p);
                if (idx >= 0) running.splice(idx, 1);
            });

            running.push(p);
            return p;
        };

        // 若需要资源目录，预先创建
        if (this.options.includeResourceLinks) {
            const resourceTypes = ['images', 'videos', 'audios', 'files'];
            await Promise.all(
                resourceTypes.map(type =>
                    fsp.mkdir(path.join(outputDir, 'resources', type), { recursive: true })
                )
            );
        }

        try {
            const exportTimeIso = new Date().toISOString();
            const metadata = {
                messageCount: 0,
                chatName: chatInfo.name,
                chatType: chatInfo.type,
                exportTime: exportTimeIso
            };

            // 1) 写入文档头与样式/脚本 + 头部信息(占位)
            const topHtml = renderTemplate(MODERN_SINGLE_HTML_TOP_TEMPLATE, {
                METADATA_JSON: JSON.stringify(metadata),
                CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
                STYLES: this.generateStyles(),
                SCRIPTS: this.generateScripts(),
                TOOLBAR: this.generateToolbar(),
                HEADER: this.generateHeader(chatInfo, { totalMessages: '--' }, '--')
            });

            await this.writeChunk(ws, topHtml);

            // 2) 单次遍历：一边渲染消息写入，一边调度资源复制
            for await (const message of this.toAsyncIterable(messages)) {
                // 统计时间范围（首/尾）
                const t = this.safeToDate((message as any)?.timestamp || message?.time);
                if (t) {
                    if (!firstTime || t < firstTime) firstTime = t;
                    if (!lastTime || t > lastTime) lastTime = t;
                }

                // 是否跳过系统消息
                if (!this.options.includeSystemMessages && this.isSystemMessage(message)) {
                    continue;
                }

                // 渲染并写入单条消息（小字符串，立即写出，避免累积）
                const chunk = this.renderMessage(message);
                await this.writeChunk(ws, chunk + '\n');
                totalMessages++;

                // 并发受限地复制资源（仅当启用本地资源）
                if (this.options.includeResourceLinks) {
                    for (const res of this.iterResources(message)) {
                        // 控制并发：超出并发上限时，等待任一任务完成
                        while (running.length >= concurrency) {
                            await Promise.race(running);
                        }
                        scheduleCopy(() => this.copyResourceFileStream(res, outputDir));
                    }
                }
            }

            // 等待剩余资源拷贝任务完成
            await Promise.all(running);

            // 3) 收尾：关闭消息区域 + 页脚 + 占位数据回填脚本 + 模态框 + 结束
            const timeRangeText = firstTime && lastTime
                ? `${firstTime.toLocaleDateString('zh-CN')} 至 ${lastTime.toLocaleDateString('zh-CN')}`
                : '--';

            // 使用安全的 JSON 转义注入文本
            const timeRangeJs = JSON.stringify(timeRangeText);

            const bottomHtml = renderTemplate(MODERN_SINGLE_HTML_BOTTOM_TEMPLATE, {
                FOOTER: this.generateFooter(),
                TOTAL_MESSAGES: String(totalMessages),
                TIME_RANGE_JS: timeRangeJs
            });

            await this.writeChunk(ws, bottomHtml);

            // 正常结束写入
            ws.end();
            await once(ws, 'finish');

            // 更新元数据注释中的消息数量
            await this.updateMetadata(totalMessages);

            // 导出完成，静默处理

            return copiedResources;

        } catch (error) {
            // 确保流被关闭
            try { ws.destroy(); } catch { /* noop */ }
            console.error(`[ModernHtmlExporter] 导出发生错误:`, error);
            throw error;
        }
    }

    /* ------------------------ 工具方法：流式写入 ------------------------ */

    private async writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
        // 遵循 backpressure：write 返回 false 则等待 'drain'
        if (!stream.write(chunk)) {
            await once(stream, 'drain');
        }
    }

    private toAsyncIterable<T>(src: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
        if ((src as any)[Symbol.asyncIterator]) {
            return src as AsyncIterable<T>;
        }
        const it = src as Iterable<T>;
        return (async function* () {
            for (const item of it) yield item;
        })();
    }

    private safeToDate(input: unknown): Date | null {
        if (!input) return null;
        const d = new Date(input as any);
        return isNaN(d.getTime()) ? null : d;
    }

    /* ------------------------ 资源复制（流式 + 并发受限） ------------------------ */

    private *iterResources(message: CleanMessage): Iterable<ResourceTask> {
        const c = (message as any)?.content;

        // 自带 resources 数组
        if (c?.resources && Array.isArray(c.resources)) {
            for (const r of c.resources) {
                const localPath = (r as any)?.localPath;
                if (localPath && this.isValidResourcePath(localPath)) {
                    yield {
                        type: ((r as any)?.type || 'file') as string,
                        fileName: path.basename(localPath),
                        localPath,
                        url: (r as any)?.url
                    };
                }
            }
        }

        // elements 中的资源元素
        if (c?.elements && Array.isArray(c.elements)) {
            for (const el of c.elements as any[]) {
                const data = el?.data;
                const elType = el?.type || 'file';
                
                // 优先使用有效的 localPath
                if (data && typeof data === 'object' && data.localPath && this.isValidResourcePath(data.localPath)) {
                    yield {
                        type: elType as string,
                        fileName: path.basename(data.localPath),
                        localPath: data.localPath,
                        url: data.url
                    };
                }
                // 如果没有有效的 localPath，但有 filename/md5，也尝试处理（用于流式导出）
                else if (data && typeof data === 'object' && (data.filename || data.md5)) {
                    const fileName = data.filename || (data.md5 ? `${data.md5}.jpg` : null);
                    if (fileName) {
                        yield {
                            type: elType as string,
                            fileName: fileName,
                            localPath: '', // 空路径，copyResourceFileStream 会从 ResourceHandler 目录查找
                            url: data.url
                        };
                    }
                }
            }
        }
    }

    /**
     * 更新HTML文件中的元数据注释
     */
    private async updateMetadata(messageCount: number): Promise<void> {
        try {
            // 读取HTML文件内容
            const content = await fsp.readFile(this.options.outputPath, 'utf8');

            // 查找并替换元数据注释
            const metadataRegex = /<!-- QCE_METADATA: \{[^}]+\} -->/;
            const match = content.match(metadataRegex);

            if (match) {
                // 提取现有元数据
                const metadataStr = match[0].match(/\{[^}]+\}/)?.[0];
                if (metadataStr) {
                    const metadata = JSON.parse(metadataStr);
                    metadata.messageCount = messageCount;

                    // 生成新的元数据注释
                    const newMetadataComment = `<!-- QCE_METADATA: ${JSON.stringify(metadata)} -->`;

                    // 替换旧的元数据注释
                    const newContent = content.replace(metadataRegex, newMetadataComment);

                    // 写回文件
                    await fsp.writeFile(this.options.outputPath, newContent, 'utf8');
                }
            }

        } catch (error) {
            // 静默处理元数据更新失败
            // 不抛出错误，不影响导出流程
        }
    }

    private async copyResourceFileStream(resource: ResourceTask, outputDir: string): Promise<string | null> {
        try {
            let sourceAbsolutePath = '';
            let sourceExists = false;
            
            // 如果有有效的 localPath，先尝试使用它
            if (resource.localPath && resource.localPath.trim() !== '') {
                sourceAbsolutePath = this.resolveResourcePath(resource.localPath);
                sourceExists = await this.fileExists(sourceAbsolutePath);
                // 确保不是目录
                if (sourceExists) {
                    const stat = await fsp.stat(sourceAbsolutePath);
                    if (stat.isDirectory()) {
                        sourceExists = false;
                    }
                }
            }
            
            // 如果原始路径不存在或无效，尝试从 ResourceHandler 的资源目录查找
            if (!sourceExists && resource.fileName) {
                const typeDir = this.normalizeTypeDir(resource.type);
                const resourceHandlerDir = path.join(
                    process.env['USERPROFILE'] || process.cwd(),
                    '.qq-chat-exporter',
                    'resources',
                    typeDir
                );
                
                // 尝试通过文件名查找（支持带 md5 前缀的文件名）
                if (await this.fileExists(resourceHandlerDir)) {
                    const files = await fsp.readdir(resourceHandlerDir);
                    const baseName = resource.fileName.toLowerCase();
                    
                    // 查找匹配的文件（可能有 md5 前缀）
                    const matchedFile = files.find(f => {
                        const fLower = f.toLowerCase();
                        return fLower === baseName || fLower.endsWith('_' + baseName);
                    });
                    
                    if (matchedFile) {
                        sourceAbsolutePath = path.join(resourceHandlerDir, matchedFile);
                        sourceExists = await this.fileExists(sourceAbsolutePath);
                    }
                }
            }
            
            if (!sourceExists) {
                // 静默跳过，不打印警告（资源可能确实不存在）
                return null;
            }

            // 目标路径（按 HTML 中引用规则）
            const typeDir = this.normalizeTypeDir(resource.type); // image -> images
            const targetRelativePath = path.join('resources', typeDir, resource.fileName);
            const targetAbsolutePath = path.join(outputDir, targetRelativePath);

            // 文件已存在则跳过（以磁盘为真，避免维护超大 Set）
            const exists = await this.fileExists(targetAbsolutePath);
            if (exists) return targetRelativePath.replace(/\\/g, '/');

            // 确保父目录存在（理论上已创建，这里兜底）
            await fsp.mkdir(path.dirname(targetAbsolutePath), { recursive: true });

            // 使用 pipeline 流式复制，内存占用极小
            await pipeline(
                fs.createReadStream(sourceAbsolutePath),
                fs.createWriteStream(targetAbsolutePath)
            );

            return targetRelativePath.replace(/\\/g, '/');

        } catch (error) {
            console.error(`[ModernHtmlExporter] 复制资源文件失败:`, {
                resource,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    private normalizeTypeDir(type: string): string {
        // 仅特定类型收敛到约定目录，其他一律归档至 files
        switch (type) {
            case 'image': return 'images';
            case 'video': return 'videos';
            case 'audio': return 'audios';
            case 'file':  return 'files';
            default:      return 'files';
        }
    }

    private async fileExists(p: string): Promise<boolean> {
        try {
            await fsp.access(p);
            return true;
        } catch {
            return false;
        }
    }

    /* ------------------------ 原有 HTML 片段生成（已解耦到模板） ------------------------ */

    private generateStyles(): string {
        return `<style>\n${MODERN_CSS}\n</style>\n`;
    }

    private generateScripts(): string {
        // 保持原结构：lucide CDN + 内联脚本
        return MODERN_SINGLE_SCRIPTS_HTML;
    }

    /**
     * 生成Toolbar（底部胶囊）
     */
    private generateToolbar(): string {
        return MODERN_TOOLBAR_HTML;
    }

    /**
     * Hero Section（左对齐，Apple风格）
     */
    private generateHeader(chatInfo: ChatInfo, stats: { totalMessages: number | string }, timeRange: string | null): string {
        const currentTime = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).replace(/\//g, '/');
        const total = typeof stats.totalMessages === 'number' ? String(stats.totalMessages) : (stats.totalMessages || '--');
        const range = timeRange ?? '--';
        return `<div class="hero">
        <h1 class="hero-title">${this.escapeHtml(chatInfo.name)}</h1>
        <p class="hero-subtitle">聊天记录</p>
        <div class="hero-meta">
            <div class="meta-item">
                <span class="meta-label">导出时间</span>
                <span class="meta-value">${currentTime}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">消息总数</span>
                <span class="meta-value" id="info-total">${this.escapeHtml(total)}</span>
        </div>
            <div class="meta-item">
                <span class="meta-label">时间范围</span>
                <span class="meta-value" id="info-range">${this.escapeHtml(range)}</span>
                </div>
            </div>
        </div>`;
    }

    /**
     * 渲染单条消息（Apple风格带气泡角）
     */
    private renderMessage(message: CleanMessage): string {
        // 系统消息
        if (this.isSystemMessage(message)) {
            const content = this.parseMessageContent(message);
            const dateInfo = this.getMessageDateInfo(message);
            const dateKey = dateInfo?.key || '';
            const dateLabel = dateInfo ? this.formatDateLabel(dateInfo.date) : '';
            let dateMarker = '';
            if (dateKey && this.lastRenderedDate !== dateKey) {
                this.lastRenderedDate = dateKey;
                dateMarker = `<div class="date-divider" data-date="${dateKey}" data-label="${this.escapeHtml(dateLabel)}" id="date-${dateKey}">
                    ${this.escapeHtml(dateLabel)}
                </div>`;
            }
            return `<div class="message-block" data-date="${dateKey}">
                ${dateMarker}
                <div class="system-message-container" style="text-align: center; margin: 12px 0;">
                    ${content}
                    <div style="color: #999; font-size: 10px; margin-top: 2px;">${this.formatTime((message as any)?.time)}</div>
                </div>
            </div>`;
        }

        // 普通消息
        const dateInfo = this.getMessageDateInfo(message);
        const dateKey = dateInfo?.key || '';
        const dateLabel = dateInfo ? this.formatDateLabel(dateInfo.date) : '';
        let dateMarker = '';

        if (dateKey && this.lastRenderedDate !== dateKey) {
            this.lastRenderedDate = dateKey;
            dateMarker = `<div class="date-divider" data-date="${dateKey}" data-label="${this.escapeHtml(dateLabel)}" id="date-${dateKey}">
                ${this.escapeHtml(dateLabel)}
            </div>`;
        }

        const isSelf = this.isSelfMessage(message);
        const cssClass = isSelf ? 'self' : 'other';
        const avatarContent = this.generateAvatarHtml(
            (message as any)?.sender?.uin,
            (message as any)?.sender?.name
        );
        const content = this.parseMessageContent(message);

        // 获取发送者 UID 用于筛选（支持同一用户不同群名片整合）
        const senderUid = (message as any)?.sender?.uid || (message as any)?.sender?.uin || '';
        return `
        <div class="message-block" data-date="${dateKey}">
            ${dateMarker}
            <div class="message ${cssClass}" data-date="${dateKey}" data-sender-uid="${this.escapeHtml(senderUid)}" id="msg-${(message as any).id}">
                <div class="avatar">${avatarContent}</div>
                <div class="message-wrapper">
                    <div class="message-header">
                        <span class="sender">${this.escapeHtml(this.getDisplayName(message))}</span>
                        <span class="time">${this.formatTime((message as any)?.time)}</span>
                    </div>
                    <div class="message-bubble">
                        <div class="content">${content}</div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    private isSystemMessage(message: CleanMessage): boolean {
        return (message as any)?.type === 'system' ||
               !!((message as any)?.content?.elements && (message as any).content.elements.some((el: any) => el?.type === 'system'));
    }

    /**
     * 解析消息内容（按元素渲染）
     */
    private parseMessageContent(message: CleanMessage): string {
        const elements = (message as any)?.content?.elements;
        if (!elements || elements.length === 0) {
            return `<span class="text-content">${this.escapeHtml((message as any)?.content?.text || '[空消息]')}</span>`;
        }

        let result = '';
        for (const element of elements as any[]) {
            switch (element?.type) {
                case 'text':
                    result += this.renderTextElement(element.data);
                    break;
                case 'image':
                    result += this.renderImageElement(element.data);
                    break;
                case 'audio':
                    result += this.renderAudioElement(element.data);
                    break;
                case 'video':
                    result += this.renderVideoElement(element.data);
                    break;
                case 'file':
                    result += this.renderFileElement(element.data);
                    break;
                case 'face':
                    result += this.renderFaceElement(element.data);
                    break;
                case 'market_face':
                    result += this.renderMarketFaceElement(element.data);
                    break;
                case 'reply':
                    result += this.renderReplyElement(element.data);
                    break;
                case 'json':
                    result += this.renderJsonElement(element.data);
                    break;
                case 'forward':
                    result += this.renderForwardElement(element.data);
                    break;
                case 'system':
                    result += this.renderSystemElement(element.data);
                    break;
                case 'location':
                    result += this.renderLocationElement(element.data);
                    break;
                default:
                    const rawText = element?.data?.text || element?.data?.summary || element?.data?.content || '';
                    if (rawText) result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
            }
        }
        return result || `<span class="text-content">[空消息]</span>`;
    }

    /* ------------------------ 各类元素渲染 ------------------------ */

    private renderTextElement(data: any): string {
        const text = data?.text || '';
        return `<span class="text-content">${this.escapeHtml(text)}</span>`;
    }

    private renderImageElement(data: any): string {
        const filename = data?.filename || '图片';
        let src = '';

        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `${this.resourceBaseHref}/images/${path.basename(data.localPath)}`;
        }
        // 如果有 filename，尝试使用本地资源路径（用于分块导出模式）
        else if (data?.filename && this.options.includeResourceLinks) {
            src = `${this.resourceBaseHref}/images/${data.filename}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }

        if (src) {
            return `<div class="image-content"><img src="${src}" alt="${this.escapeHtml(filename)}" loading="lazy" onclick="showImageModal('${src}')"></div>`;
        }
        return `<span class="text-content">📷 ${this.escapeHtml(filename)}</span>`;
    }

    private renderAudioElement(data: any): string {
        const duration = data?.duration || 0;
        const filename = data?.filename || '语音';
        let src = '';

        // 优先使用localPath（导出后的本地资源，使用相对路径）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `${this.resourceBaseHref}/audios/${path.basename(data.localPath)}`;
        }
        // 如果有 filename，尝试使用本地资源路径（用于分块导出模式）
        else if (data?.filename && this.options.includeResourceLinks) {
            src = `${this.resourceBaseHref}/audios/${data.filename}`;
        }
        // 其次使用url，但要过滤掉本地文件系统路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉本地路径，只保留网络URL
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }

        if (src) {
            // AMR格式浏览器可能不支持，同时提供下载链接
            const isAmr = src.toLowerCase().endsWith('.amr');
            const audioTag = `<audio src="${src}" controls class="message-audio" preload="metadata">[语音:${duration}秒]</audio>`;
            const downloadLink = isAmr
                ? `<a href="${src}" download="${this.escapeHtml(filename)}" class="audio-download-link" title="浏览器可能不支持AMR格式，点击下载">下载语音</a>`
                : '';

            return `<div class="audio-wrapper">${audioTag}${downloadLink}</div>`;
        }
        return `<span class="text-content">🎤 [语音:${duration}秒]</span>`;
    }

    private renderVideoElement(data: any): string {
        const filename = data?.filename || '视频';
        let src = '';

        // 优先使用localPath（导出后的本地资源，使用相对路径）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `${this.resourceBaseHref}/videos/${path.basename(data.localPath)}`;
        }
        // 如果有 filename，尝试使用本地资源路径（用于分块导出模式）
        else if (data?.filename && this.options.includeResourceLinks) {
            src = `${this.resourceBaseHref}/videos/${data.filename}`;
        }
        // 其次使用url，但要过滤掉本地文件系统路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉本地路径，只保留网络URL
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }

        if (src) {
            return `<video src="${src}" controls class="message-video" preload="metadata">[视频: ${this.escapeHtml(filename)}]</video>`;
        }
        return `<span class="text-content">🎬 ${this.escapeHtml(filename)}</span>`;
    }

    private renderFileElement(data: any): string {
        const filename = data?.filename || '文件';
        let href = '';

        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            href = `${this.resourceBaseHref}/files/${path.basename(data.localPath)}`;
        }
        // 如果有 filename，尝试使用本地资源路径（用于分块导出模式）
        else if (data?.filename && this.options.includeResourceLinks) {
            href = `${this.resourceBaseHref}/files/${data.filename}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                href = url;
            }
        }

        if (href) {
            return `<a href="${href}" class="message-file" download="${this.escapeHtml(filename)}">📎 ${this.escapeHtml(filename)}</a>`;
        }
        return `<span class="text-content">📎 ${this.escapeHtml(filename)}</span>`;
    }

    private renderFaceElement(data: any): string {
        const id = data?.id || data?.faceId || '';
        const name = data?.name || this.getFaceNameById(id) || `表情${id}`;
        return `<span class="face-emoji">${this.escapeHtml(name)}</span>`;
    }

    /**
     * 根据QQ表情ID获取友好名称
     */
    private getFaceNameById(id: string | number): string {
        const faceMap: Record<string, string> = {
            '0': '/微笑', '1': '/撇嘴', '2': '/色', '3': '/发呆', '4': '/得意',
            '5': '/流泪', '6': '/害羞', '7': '/闭嘴', '8': '/睡', '9': '/大哭',
            '10': '/尴尬', '11': '/发怒', '12': '/调皮', '13': '/呲牙', '14': '/惊讶',
            '15': '/难过', '16': '/酷', '17': '/冷汗', '18': '/抓狂', '19': '/吐',
            '20': '/偷笑', '21': '/可爱', '22': '/白眼', '23': '/傲慢', '24': '/饥饿',
            '25': '/困', '26': '/惊恐', '27': '/流汗', '28': '/憨笑', '29': '/大兵',
            '30': '/奋斗', '31': '/咒骂', '32': '/疑问', '33': '/嘘', '34': '/晕',
            '35': '/折磨', '36': '/衰', '37': '/骷髅', '38': '/敲打', '39': '/再见',
            '40': '/擦汗', '41': '/抠鼻', '42': '/鼓掌', '43': '/糗大了', '44': '/坏笑',
            '45': '/左哼哼', '46': '/右哼哼', '47': '/哈欠', '48': '/鄙视', '49': '/委屈',
            '50': '/快哭了', '51': '/阴险', '52': '/亲亲', '53': '/吓', '54': '/可怜',
            '55': '/菜刀', '56': '/西瓜', '57': '/啤酒', '58': '/篮球', '59': '/乒乓',
            '60': '/咖啡', '61': '/饭', '62': '/猪头', '63': '/玫瑰', '64': '/凋谢',
            '65': '/示爱', '66': '/爱心', '67': '/心碎', '68': '/蛋糕', '69': '/闪电',
            '70': '/炸弹', '71': '/刀', '72': '/足球', '73': '/瓢虫', '74': '/便便',
            '75': '/月亮', '76': '/太阳', '77': '/礼物', '78': '/拥抱', '79': '/强',
            '80': '/弱', '81': '/握手', '82': '/胜利', '83': '/抱拳', '84': '/勾引',
            '85': '/拳头', '86': '/差劲', '87': '/爱你', '88': '/NO', '89': '/OK',
            '96': '/跳跳', '97': '/发抖', '98': '/怄火', '99': '/转圈',
            '100': '/磕头', '101': '/回头', '102': '/跳绳', '103': '/挥手', '104': '/激动',
            '105': '/街舞', '106': '/献吻', '107': '/左太极', '108': '/右太极',
            '109': '/闭眼', '110': '/流鼻涕', '111': '/惊喜', '112': '/骂人',
            '116': '/爱情', '117': '/飞吻', '118': '/跳跳', '120': '/颤抖',
            '121': '/怄火', '122': '/转圈', '123': '/磕头', '124': '/回头',
            '125': '/跳绳', '126': '/投降', '127': '/激动', '128': '/乱舞',
            '129': '/献吻', '173': '/嘿哈', '174': '/捂脸', '175': '/奸笑',
            '176': '/机智', '177': '/皱眉', '178': '/耶', '179': '/吃瓜',
            '180': '/加油', '181': '/汗', '182': '/天啊', '183': '/Emm',
            '184': '/社会社会', '185': '/旺柴', '186': '/好的', '187': '/打脸',
            '188': '/哇', '189': '/翻白眼', '190': '/666', '191': '/让我看看',
            '192': '/叹气', '193': '/苦涩', '194': '/裂开', '195': '/嘴唇',
            '196': '/爱心', '197': '/惊喜', '201': '/生气', '202': '/吃惊',
            '203': '/酸了', '204': '/太难了', '205': '/我想开了',
            '206': '/右上看', '207': '/嘿嘿嘿', '208': '/捂眼',
            '210': '/敬礼', '211': '/狗头', '212': '/吐舌', '214': '/哦',
            '215': '/请', '216': '/睁眼', '217': '/敲开心', '218': '/震惊',
            '219': '/让我康康', '220': '/摸鱼', '221': '/魔鬼笑',
            '222': '/哦哟', '223': '/傻眼', '224': '/抽烟', '225': '/笑哭',
            '226': '/汪汪', '227': '/汗', '228': '/打脸', '229': '/无语',
            '230': '/拥抱', '231': '/摸头', '232': '/加油', '233': '/震惊哭',
            '234': '/托腮', '235': '/我酸了', '236': '/快哭了',
            '237': '/吃糖', '238': '/生气', '260': '/拜托',
            '261': '/求你了', '262': '/好的', '263': '/我想开了',
            '264': '/比心', '265': '/啵啵', '266': '/蹭蹭', '267': '/拍手',
            '268': '/佛系', '269': '/喝奶茶', '270': '/吃糖', '271': '/Doge',
            '277': '/吃', '278': '/呆', '279': '/仔细分析', '280': '/加油',
            '281': '/崇拜', '282': '/比心', '283': '/庆祝', '284': '/生日快乐',
            '285': '/舔屏', '286': '/笑哭', '287': '/doge', '288': '/哈哈',
            '289': '/酸了', '290': '/汪汪', '291': '/哦呼', '292': '/喵喵',
            '293': '/求抱抱', '294': '/期待', '295': '/拜托了', '296': '/元气满满',
            '297': '/满分', '298': '/坏笑', '299': '/你真棒', '300': '/收到',
            '301': '/拒绝', '302': '/吃瓜', '303': '/嗯哼', '304': '/吃鲸',
            '305': '/汗', '306': '/无眼看', '307': '/敬礼', '308': '/面无表情',
            '309': '/摊手', '310': '/灵魂出窍', '311': '/脑阔疼',
            '312': '/沧桑', '313': '/捂脸哭', '314': '/笑cry', '315': '/无语凝噎',
            '316': '/@所有人', '317': '/裂开', '318': '/叹气', '319': '/摸鱼',
            '320': '/吃', '321': '/呐', '322': '/左看看', '323': '/右看看',
            '324': '/叹气', '325': '/我想开了', '326': '/无语', '327': '/问号',
            '328': '/怂', '329': '/犬', '330': '/坏笑', '331': '/喝奶茶',
            '332': '/吃瓜', '333': '/鬼脸', '334': '/震惊', '335': '/嘿嘿',
            '336': '/歪嘴', '337': '/狂笑', '338': '/嘻嘻', '339': '/扶墙',
            '340': '/捂脸', '341': '/奋斗', '342': '/白眼'
        };
        return faceMap[String(id)] || `/表情${id}`;
    }

    private renderMarketFaceElement(data: any): string {
        const name = data?.name || '商城表情';
        const url = data?.url || '';
        if (url) {
            return `<img src="${url}" alt="${this.escapeHtml(name)}" class="market-face" title="${this.escapeHtml(name)}">`;
        }
        return `<span class="text-content">[${this.escapeHtml(name)}]</span>`;
    }

    private renderReplyElement(data: any): string {
        const senderName = data?.senderName || '用户';
        const content = data?.content || data?.text || '引用消息';
        const replyMsgId = data?.replyMsgId || data?.msgId || '';
        const time = data?.time || data?.timestamp || '';

        // 格式化时间
        let timeStr = '';
        if (time) {
            const date = this.safeToDate(time);
            if (date) {
                timeStr = date.toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
            }
        }

        // 检查是否有图片
        let imageHtml = '';
        if (data?.imageUrl || data?.image) {
            const imgSrc = data?.imageUrl || data?.image;
            imageHtml = `<img src="${imgSrc}" class="reply-content-image" alt="引用图片">`;
        } else if (String(content).includes('[图片]') && data?.elements) {
            // 尝试从elements中找到图片
            const imgElement = data.elements.find((el: any) => el?.type === 'image');
            if (imgElement?.data?.localPath) {
                const imgSrc = `${this.resourceBaseHref}/images/${path.basename(imgElement.data.localPath)}`;
                imageHtml = `<img src="${imgSrc}" class="reply-content-image" alt="引用图片" loading="lazy">`;
            }
        }

        const dataAttr = replyMsgId ? `data-reply-to="msg-${replyMsgId}"` : '';
        const onClick = replyMsgId ? `onclick="scrollToMessage('msg-${replyMsgId}')"` : '';

        return `<div class="reply-content" ${dataAttr} ${onClick}>
            <div class="reply-content-header">
                <strong>${this.escapeHtml(senderName)}</strong>
                ${timeStr ? `<span class="reply-content-time">${this.escapeHtml(timeStr)}</span>` : ''}
            </div>
            <div class="reply-content-text">${this.escapeHtml(content)}</div>
            ${imageHtml}
        </div>`;
    }

    private renderJsonElement(data: any): string {
        const title = data?.title || data?.summary || 'JSON消息';
        const description = data?.description || '';
        const url = data?.url || '';
        return `<div class="json-card">
            <div class="json-title">${this.escapeHtml(title)}</div>
            ${description ? `<div class="json-description">${this.escapeHtml(description)}</div>` : ''}
            ${url ? `<a href="${url}" target="_blank" class="json-url">${this.escapeHtml(url)}</a>` : ''}
        </div>`;
    }

    private renderForwardElement(data: any): string {
        const title = data?.title || '聊天记录';
        const summary = data?.summary || data?.content || '查看转发消息';
        const preview = data?.preview || [];

        let previewHtml = '';
        if (Array.isArray(preview) && preview.length > 0) {
            previewHtml = preview.slice(0, 3).map((line: any) => {
                const text = typeof line === 'string' ? line : (line?.text || '');
                return this.escapeHtml(text);
            }).join('<br>');
        } else if (typeof summary === 'string') {
            // 尝试从summary中提取预览内容
            const lines = summary.split('\n').slice(0, 3);
            previewHtml = lines.map(l => this.escapeHtml(l)).join('<br>');
        }

        return `<div class="forward-card">
            <div class="forward-card-header">
                <svg class="forward-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>${this.escapeHtml(title)}</span>
            </div>
            <div class="forward-card-content">
                ${previewHtml || '点击查看转发的聊天记录'}
            </div>
            <div class="forward-card-footer">转发消息</div>
        </div>`;
    }

    private renderSystemElement(data: any): string {
        const text = data?.text || data?.content || '系统消息';
        return `<div class="system-message">${this.escapeHtml(text)}</div>`;
    }

    private renderLocationElement(data: any): string {
        const name = data?.name || '位置';
        const address = data?.address || '';
        const lat = data?.lat || data?.latitude || '';
        const lng = data?.lng || data?.longitude || '';

        let locationText = `📍 ${this.escapeHtml(name)}`;
        if (address) {
            locationText += ` - ${this.escapeHtml(address)}`;
        }
        if (lat && lng) {
            locationText += ` (${lat}, ${lng})`;
        }

        return `<span class="text-content">${locationText}</span>`;
    }

    private generateFooter(): string {
        return MODERN_FOOTER_HTML;
    }

    /* ------------------------ Chunked：全文检索文本提取（新增） ------------------------ */

    /**
     * 提取消息的纯文本用于索引/搜索（不影响原 HTML 渲染）
     * - 仅用于 Chunked 模式 message.text 与 Bloom 建索引
     */
    private extractPlainText(message: CleanMessage): string {
        const elements = (message as any)?.content?.elements;
        if (!elements || elements.length === 0) {
            return String((message as any)?.content?.text || '');
        }

        const parts: string[] = [];
        for (const el of elements as any[]) {
            const t = el?.type;
            const d = el?.data || {};
            switch (t) {
                case 'text':
                    if (d?.text) parts.push(String(d.text));
                    break;
                case 'image':
                    parts.push(`[图片${d?.filename ? ':' + d.filename : ''}]`);
                    break;
                case 'audio':
                    parts.push(`[语音${d?.duration ? ':' + d.duration + '秒' : ''}]`);
                    break;
                case 'video':
                    parts.push(`[视频${d?.filename ? ':' + d.filename : ''}]`);
                    break;
                case 'file':
                    parts.push(`[文件${d?.filename ? ':' + d.filename : ''}]`);
                    break;
                case 'face': {
                    const id = d?.id || d?.faceId || '';
                    const name = d?.name || this.getFaceNameById(id) || '';
                    if (name) parts.push(String(name));
                    break;
                }
                case 'market_face':
                    parts.push(`[${d?.name || '商城表情'}]`);
                    break;
                case 'reply':
                    if (d?.content) parts.push(String(d.content));
                    else if (d?.text) parts.push(String(d.text));
                    else parts.push('[回复]');
                    break;
                case 'json':
                    parts.push(`${d?.title || d?.summary || 'JSON'} ${d?.description || ''} ${d?.url || ''}`.trim());
                    break;
                case 'forward':
                    parts.push(`${d?.title || '转发'} ${d?.summary || d?.content || ''}`.trim());
                    break;
                case 'location':
                    parts.push(`${d?.name || '位置'} ${d?.address || ''}`.trim());
                    break;
                case 'system':
                    parts.push(`${d?.text || d?.content || '系统消息'}`.trim());
                    break;
                default: {
                    const rawText = d?.text || d?.summary || d?.content || '';
                    if (rawText) parts.push(String(rawText));
                }
            }
        }
        return parts.join(' ').trim();
    }

    private addTextToBloom(bloom: BloomFilter, textLower: string): void {
        if (!textLower) return;
        // ngrams 2 & 3
        const ngrams = [2, 3];
        for (const n of ngrams) {
            if (textLower.length < n) continue;
            for (let i = 0; i <= textLower.length - n; i++) {
                bloom.add(textLower.slice(i, i + n));
            }
        }
    }

    /* ------------------------ 基础工具 ------------------------ */

    private getDisplayName(message: CleanMessage): string {
        const s: any = (message as any)?.sender || {};
        if (s.remark) return String(s.remark);
        if (s.name) return String(s.name);
        if (s.uin) return String(s.uin);
        return s.uid || '未知用户';
    }

    private getMessageDateInfo(message: CleanMessage): { key: string; date: Date } | null {
        const rawTimestamp = (message as any)?.timestamp;
        const date = typeof rawTimestamp === 'number'
            ? new Date(rawTimestamp)
            : this.safeToDate((message as any)?.time);
        if (!date || isNaN(date.getTime())) return null;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return { key, date };
    }

    private formatDateLabel(date: Date): string {
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${weekdays[date.getDay()]}`;
    }

    private isSelfMessage(message: CleanMessage): boolean {
        const senderUid = (message as any)?.sender?.uid;
        const senderUin = (message as any)?.sender?.uin;
        if (this.currentChatInfo?.selfUid && senderUid && senderUid === this.currentChatInfo.selfUid) {
            return true;
        }
        if (this.currentChatInfo?.selfUin && senderUin && String(senderUin) === String(this.currentChatInfo.selfUin)) {
            return true;
        }
        return false;
    }

    private formatTime(time: any): string {
        const date = this.safeToDate(time);
        if (!date) return '';
        return date.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    private escapeHtml(text?: string): string {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private resolveResourcePath(resourcePath: string): string {
        // 已是绝对路径
        if (path.isAbsolute(resourcePath)) return resourcePath;
        // 资源根目录：跨平台 HOME 目录
        const resourceRoot = path.join(os.homedir(), '.qq-chat-exporter', 'resources');
        // 修复 Issue #30: 处理 images/xxx.jpg 格式的相对路径
        const resourceTypes = ['images/', 'videos/', 'audios/', 'files/'];
        for (const type of resourceTypes) {
            if (resourcePath.startsWith(type)) {
                return path.join(resourceRoot, resourcePath);
            }
        }
        // resources/ 相对路径
        if (resourcePath.startsWith('resources/')) {
            return path.resolve(resourceRoot, resourcePath.substring(10)); // 去掉 'resources/'
        }
        // 仅文件名：遍历资源类型目录
        const resourceTypeDirs = ['images', 'videos', 'audios', 'files'];
        for (const type of resourceTypeDirs) {
            const fullPath = path.join(resourceRoot, type, resourcePath);
            if (fs.existsSync(fullPath)) return fullPath;
        }
        // 默认回退
        return path.resolve(resourceRoot, resourcePath);
    }

    private isValidResourcePath(resourcePath: string): boolean {
        if (!resourcePath || typeof resourcePath !== 'string') return false;
        const trimmed = resourcePath.trim();

        // 修复 Issue #30: 允许 images/videos/audios/files 开头的相对路径
        const resourceTypePrefixes = ['images/', 'videos/', 'audios/', 'files/'];
        const hasValidPrefix = resourceTypePrefixes.some(prefix => trimmed.startsWith(prefix));

        return (
            trimmed !== '' &&
            (trimmed.startsWith('resources/') ||
                hasValidPrefix ||
                path.isAbsolute(trimmed) ||
                // 允许纯文件名（不含路径分隔符）
                (trimmed.length > 0 && !trimmed.includes('\\') && !trimmed.includes('/')))
        );
    }

    private generateAvatarHtml(uin?: string, name?: string): string {
        if (uin) {
            const avatarUrl = `http://q.qlogo.cn/g?b=qq&nk=${uin}&s=100`;
            const fallbackText = name ? name.charAt(0).toUpperCase() : uin.slice(-2);
            return `<img src="${avatarUrl}" alt="${this.escapeHtml(name || uin)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline-flex';" />
                    <span style="display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        } else {
            const fallbackText = name ? name.charAt(0).toUpperCase() : 'U';
            return `<span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        }
    }

    /* ------------------------ 公共方法（供流式导出使用） ------------------------ */

    /**
     * 生成 HTML 文档头部（用于流式导出）
     */
    public generateHtmlTop(chatInfo: ChatInfo, metadata: any): string {
        return renderTemplate(MODERN_SINGLE_HTML_TOP_TEMPLATE, {
            METADATA_JSON: JSON.stringify(metadata),
            CHAT_NAME_ESC: this.escapeHtml(chatInfo.name),
            STYLES: this.generateStyles(),
            SCRIPTS: this.generateScripts(),
            TOOLBAR: this.generateToolbar(),
            HEADER: this.generateHeader(chatInfo, { totalMessages: '--' }, '--')
        });
    }

    /**
     * 生成 HTML 文档尾部（用于流式导出）
     */
    public generateHtmlBottom(chatInfo: ChatInfo, stats: { totalMessages: number }, exportTime: string): string {
        const timeRangeText = '--'; // 流式导出时无法预知时间范围
        const timeRangeJs = JSON.stringify(timeRangeText);

        return renderTemplate(MODERN_SINGLE_HTML_BOTTOM_TEMPLATE, {
            FOOTER: this.generateFooter(),
            TOTAL_MESSAGES: String(stats.totalMessages),
            TIME_RANGE_JS: timeRangeJs
        });
    }

    /**
     * 渲染单条消息（公共方法，供流式导出使用）
     */
    public renderMessagePublic(message: CleanMessage): string {
        return this.renderMessage(message);
    }

    /**
     * 迭代消息中的资源（公共方法，供流式导出使用）
     */
    public *iterResourcesPublic(message: CleanMessage): Generator<{ type: string; localPath?: string; fileName?: string }> {
        yield* this.iterResources(message);
    }

    /**
     * 判断是否为系统消息（公共方法）
     */
    public isSystemMessagePublic(message: CleanMessage): boolean {
        return this.isSystemMessage(message);
    }
}

/* ------------------------ Bloom Filter & Hash（Chunked 模式使用） ------------------------ */

function fnv1a32(str: string, seed: number): number {
    let h = (seed >>> 0) || 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

class BloomFilter {
    private readonly bits: number;
    private readonly hashes: number;
    private readonly bytes: Uint8Array;

    constructor(bits: number, hashes: number) {
        this.bits = bits >>> 0;
        this.hashes = hashes >>> 0;
        this.bytes = new Uint8Array(Math.ceil(this.bits / 8));
    }

    add(token: string): void {
        if (!token) return;
        const h1 = fnv1a32(token, 0x811c9dc5);
        const h2 = fnv1a32(token, 0x811c9dc5 ^ 0x5bd1e995);
        for (let i = 0; i < this.hashes; i++) {
            const idx = (h1 + i * h2) % this.bits;
            const byteIndex = idx >>> 3;
            const mask = 1 << (idx & 7);
            this.bytes[byteIndex] |= mask;
        }
    }

    toBase64(): string {
        return Buffer.from(this.bytes).toString('base64');
    }
}
