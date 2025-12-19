/**
 * JSON 导出：流式写入工具
 * 目标：
 * - 统一处理 backpressure（drain），避免 write 缓冲累积导致内存飙升/OOM
 * - 在不引入第三方依赖的情况下，提供可复用的“绝对流式”写入能力
 */

import { once } from 'events';

export function normalizeEncoding(encoding: string): BufferEncoding {
    const e = (encoding || '').toLowerCase();
    if (e === 'utf-8' || e === 'utf8') return 'utf8';
    if (e === 'utf16le' || e === 'utf-16le') return 'utf16le';
    if (e === 'latin1') return 'latin1';
    if (e === 'base64') return 'base64';
    if (e === 'ascii') return 'ascii';
    if (e === 'ucs2' || e === 'ucs-2') return 'ucs2';
    if (e === 'hex') return 'hex';
    // 兜底：交给 Node 尝试
    return encoding as BufferEncoding;
}

/**
 * 写入并处理 backpressure：
 * - stream.write 返回 false 时等待 drain
 */
export async function writeToStream(stream: NodeJS.WritableStream, chunk: string | Buffer): Promise<void> {
    if (!stream.write(chunk)) {
        await once(stream as any, 'drain');
    }
}

/**
 * 结束写流并等待 close/finish，确保文件句柄释放（Windows 下尤其重要）
 */
export async function endWriteStream(stream: NodeJS.WritableStream): Promise<void> {
    if (!stream) return;

    // 如果没有 end 方法，直接返回
    const endFn = (stream as any).end;
    if (typeof endFn !== 'function') return;

    await new Promise<void>((resolve, reject) => {
        const onError = (err: any) => {
            cleanup();
            reject(err);
        };

        const onDone = () => {
            cleanup();
            resolve();
        };

        const cleanup = () => {
            stream.removeListener('error', onError);
            stream.removeListener('close', onDone);
            stream.removeListener('finish', onDone);
        };

        stream.once('error', onError);
        stream.once('close', onDone);
        stream.once('finish', onDone);

        endFn.call(stream);
    });
}

/**
 * 微任务/宏任务让出执行权，避免长循环阻塞事件循环
 *（导出大文件时可选使用）
 */
export async function yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
        setImmediate(() => resolve());
    });
}

/**
 * 小缓冲写入器（避免每条消息都触发一次 stream.write 调用）
 * - 仍然是绝对流式：缓冲区大小可控（默认 1MB）
 * - 仍然 backpressure 友好：flush 走 writeToStream
 */
export class BufferedTextWriter {
    private parts: string[] = [];
    private length = 0;

    constructor(
        private readonly stream: NodeJS.WritableStream,
        private readonly flushThresholdChars: number = 1024 * 1024
    ) {}

    /**
     * 写入文本；当缓冲达到阈值时会触发 flush，并返回 Promise
     * - 不触发 flush 时返回 void（避免每次都创建 Promise）
     */
    write(text: string): void | Promise<void> {
        if (!text) return;

        this.parts.push(text);
        this.length += text.length;

        if (this.length >= this.flushThresholdChars) {
            return this.flush();
        }

        return;
    }

    async flush(): Promise<void> {
        if (this.length <= 0) return;

        const data = this.parts.join('');
        this.parts = [];
        this.length = 0;

        await writeToStream(this.stream, data);
    }

    async end(): Promise<void> {
        await this.flush();
        await endWriteStream(this.stream);
    }
}
