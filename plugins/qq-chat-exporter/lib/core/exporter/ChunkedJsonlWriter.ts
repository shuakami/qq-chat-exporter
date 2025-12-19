/**
 * chunked-jsonl 写入器
 * - 负责把 JSONL 数据按消息数/字节数切分为多个 chunk 文件
 * - 提供 chunk 元信息（startTs/endTs/count/bytes/path）
 * - 全程 backpressure 友好，避免 write 缓冲导致 OOM
 */

import fs from 'fs';
import path from 'path';
import { BufferedTextWriter, normalizeEncoding } from './JsonStreamUtils.js';

export interface ChunkedJsonlChunkInfo {
    /** 从 1 开始 */
    index: number;
    /** 文件名，例如 c000001.jsonl */
    fileName: string;
    /** 相对路径（用于 manifest 里引用），例如 chunks/c000001.jsonl */
    relativePath: string;
    /** chunk 开始时间（ISO），可能为空字符串 */
    start: string;
    /** chunk 结束时间（ISO），可能为空字符串 */
    end: string;
    /** chunk 消息数 */
    count: number;
    /** chunk 写入字节数（近似=写入内容的字节数） */
    bytes: number;
    /** chunk 开始时间戳（ms） */
    startTsMs?: number;
    /** chunk 结束时间戳（ms） */
    endTsMs?: number;
}

export interface ChunkedJsonlWriterOptions {
    /** chunk 输出目录（绝对路径） */
    chunksDir: string;
    /** manifest 引用用的 chunks 相对目录名（默认 'chunks'） */
    chunksDirNameForManifest: string;
    /** 写入编码 */
    encoding: string;
    /** 每个 chunk 最多消息数，0=不限 */
    maxMessages: number;
    /** 每个 chunk 最大字节数，0=不限 */
    maxBytes: number;
    /** chunk 文件命名函数（只返回文件名，不含目录） */
    getChunkFileName: (index: number) => string;
    /** 内部写入缓冲（字符数阈值，默认 1MB） */
    writerBufferChars?: number;
}

export class ChunkedJsonlWriter {
    private readonly opts: ChunkedJsonlWriterOptions;
    private readonly encoding: BufferEncoding;

    private chunks: ChunkedJsonlChunkInfo[] = [];

    private currentStream: fs.WriteStream | null = null;
    private currentWriter: BufferedTextWriter | null = null;

    private currentIndex = 0;
    private currentFileName: string | null = null;

    private currentCount = 0;
    private currentBytes = 0;
    private currentStartTs: number | null = null;
    private currentEndTs: number | null = null;

    constructor(options: ChunkedJsonlWriterOptions) {
        this.opts = options;
        this.encoding = normalizeEncoding(options.encoding);
        fs.mkdirSync(this.opts.chunksDir, { recursive: true });
    }

    /**
     * 写入一条 JSONL 行（会自动补齐 \\n）
     * @param rawLine 不包含或包含换行均可
     * @param tsMs 消息时间戳（ms），用于 chunk 元信息；不提供则留空
     */
    async writeLine(rawLine: string, tsMs: number | null): Promise<void> {
        const line = rawLine.endsWith('\n') ? rawLine : (rawLine + '\n');
        const lineBytes = Buffer.byteLength(line, this.encoding);

        await this.rotateIfNeeded(lineBytes);

        // 更新 chunk 时间范围
        if (tsMs !== null && tsMs > 0) {
            if (this.currentStartTs === null || tsMs < this.currentStartTs) this.currentStartTs = tsMs;
            if (this.currentEndTs === null || tsMs > this.currentEndTs) this.currentEndTs = tsMs;
        }

        if (!this.currentStream || !this.currentWriter) {
            // 保险：理论上 rotateIfNeeded 会 open
            this.openNewChunk();
        }

        const maybeFlush = this.currentWriter!.write(line);
        if (maybeFlush) await maybeFlush;

        this.currentCount += 1;
        this.currentBytes += lineBytes;
    }

    async finalize(): Promise<void> {
        await this.closeCurrentChunk();
    }

    getChunks(): ChunkedJsonlChunkInfo[] {
        return this.chunks;
    }

    getTotalBytes(): number {
        return this.chunks.reduce((acc, c) => acc + (c.bytes || 0), 0);
    }

    private async rotateIfNeeded(nextLineBytes: number): Promise<void> {
        if (!this.currentStream) {
            this.openNewChunk();
            return;
        }

        // 按消息数切分：写入前判断
        if (this.opts.maxMessages > 0 && this.currentCount >= this.opts.maxMessages) {
            await this.closeCurrentChunk();
            this.openNewChunk();
            return;
        }

        // 按字节数切分：写入前判断（如果当前 chunk 已有内容，且写入会超）
        if (this.opts.maxBytes > 0 && this.currentCount > 0 && (this.currentBytes + nextLineBytes) > this.opts.maxBytes) {
            await this.closeCurrentChunk();
            this.openNewChunk();
            return;
        }
    }

    private openNewChunk(): void {
        this.currentIndex = this.chunks.length + 1;
        this.currentFileName = this.opts.getChunkFileName(this.currentIndex);

        const filePath = path.join(this.opts.chunksDir, this.currentFileName);
        this.currentStream = fs.createWriteStream(filePath, { encoding: this.encoding });

        const bufChars = this.opts.writerBufferChars ?? 1024 * 1024;
        this.currentWriter = new BufferedTextWriter(this.currentStream, bufChars);

        this.currentCount = 0;
        this.currentBytes = 0;
        this.currentStartTs = null;
        this.currentEndTs = null;
    }

    private async closeCurrentChunk(): Promise<void> {
        if (!this.currentStream || !this.currentFileName || !this.currentWriter) return;

        await this.currentWriter.end();

        const startIso = this.currentStartTs ? new Date(this.currentStartTs).toISOString() : '';
        const endIso = this.currentEndTs ? new Date(this.currentEndTs).toISOString() : '';

        const relativePath = `${this.opts.chunksDirNameForManifest}/${this.currentFileName}`.replace(/\\/g, '/');

        this.chunks.push({
            index: this.currentIndex,
            fileName: this.currentFileName,
            relativePath,
            start: startIso,
            end: endIso,
            count: this.currentCount,
            bytes: this.currentBytes,
            startTsMs: this.currentStartTs ?? undefined,
            endTsMs: this.currentEndTs ?? undefined
        });

        this.currentStream = null;
        this.currentWriter = null;
        this.currentFileName = null;

        this.currentCount = 0;
        this.currentBytes = 0;
        this.currentStartTs = null;
        this.currentEndTs = null;
    }
}
