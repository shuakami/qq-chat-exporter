/**
 * SILK → MP3 转码器（issue #306）
 *
 * QQ 把语音消息以 SILK V3 编码缓存到本地，扩展名却挂着 `.amr`。silk-wasm
 * 能把 SILK 解成 16-bit PCM，再用 lamejs 把 PCM 编成 MP3，导出后浏览器
 * （Chrome / Edge / Safari / Firefox）都能直接 `<audio>` 播放。
 *
 * 这个模块只做「读 SILK 字节 → 写 MP3 字节」，不负责文件名 / 缓存目录管理。
 * 调用方（ResourceHandler）拿到 MP3 buffer 后自己决定写到哪、命名什么。
 *
 * 设计目标：
 * - 不抛异常：silk-wasm 解码失败、lamejs 加载失败时返回 null，让调用方
 *   保持 SILK 原文件不动。
 * - 不内嵌 ffmpeg：纯 JS / WASM 实现，跨平台一致。
 */

import fs from 'node:fs';

/** SILK V3 magic：`#!SILK_V3`，可能前面多一个 0x02 字节。 */
const SILK_MAGIC = Buffer.from('#!SILK_V3');

export interface SilkTranscodeOptions {
    /** 解码采样率（Hz）。SILK 支持 8/12/16/24/32/44.1/48 kHz，QQ 端常用 24 kHz。 */
    sampleRate?: number;
    /** MP3 输出码率（kbps）。语音消息 64 已经够。 */
    bitrateKbps?: number;
    /** 出错时是否吞掉异常并返回 null。默认 true。 */
    silent?: boolean;
}

export interface SilkTranscodeResult {
    /** 编好的 MP3 数据。 */
    mp3: Buffer;
    /** SILK 中标注的语音时长（毫秒）。silk-wasm 解码完会带回来。 */
    durationMs: number;
}

/**
 * 判断字节流是否是 SILK V3。
 *
 * 不依赖 silk-wasm 自带的 isSilk，避免在调用方需要「判断文件是否值得转码」时
 * 还要 import 整个 wasm。
 */
export function isSilkBuffer(buf: Buffer | Uint8Array): boolean {
    if (!buf || buf.length < SILK_MAGIC.length) return false;
    if (buf.length >= SILK_MAGIC.length &&
        Buffer.from(buf.buffer, buf.byteOffset, SILK_MAGIC.length).equals(SILK_MAGIC)) {
        return true;
    }
    if (buf.length >= SILK_MAGIC.length + 1 && buf[0] === 0x02 &&
        Buffer.from(buf.buffer, buf.byteOffset + 1, SILK_MAGIC.length).equals(SILK_MAGIC)) {
        return true;
    }
    return false;
}

/**
 * 把 PCM s16le 字节流交给 lamejs，分块编码出 MP3。
 *
 * lamejs 的 `Mp3Encoder` 一次只能吃 ≤1152 个 sample（mono）或 ≤576（stereo）。
 * 这里按 1152 切片，最后 flush 一次。
 */
function encodePcmToMp3(
    pcm: Int16Array,
    sampleRate: number,
    bitrateKbps: number,
    Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
        encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
        flush(): Uint8Array;
    }
): Buffer {
    const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
    const chunkSize = 1152;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < pcm.length; i += chunkSize) {
        const slice = pcm.subarray(i, Math.min(i + chunkSize, pcm.length));
        const encoded = encoder.encodeBuffer(slice);
        if (encoded && encoded.length > 0) parts.push(encoded);
    }
    const tail = encoder.flush();
    if (tail && tail.length > 0) parts.push(tail);
    return Buffer.concat(parts.map(u => Buffer.from(u.buffer, u.byteOffset, u.byteLength)));
}

/**
 * SILK Buffer → MP3 Buffer。
 *
 * 失败时（silk-wasm 解码报错、lamejs 加载失败、PCM 长度为 0 等）默认返回
 * `null`，调用方应回退到保留原始 SILK 文件。
 */
export async function transcodeSilkBufferToMp3(
    silkBuffer: Buffer,
    options: SilkTranscodeOptions = {}
): Promise<SilkTranscodeResult | null> {
    const { sampleRate = 24000, bitrateKbps = 64, silent = true } = options;

    if (!silkBuffer || silkBuffer.length === 0) return null;
    if (!isSilkBuffer(silkBuffer)) return null;

    let decoded: { data: Uint8Array; duration: number };
    try {
        const silkMod: any = await import('silk-wasm');
        const decode = silkMod.decode ?? silkMod.default?.decode;
        if (typeof decode !== 'function') {
            if (!silent) throw new Error('silk-wasm 缺少 decode 导出');
            return null;
        }
        decoded = await decode(silkBuffer, sampleRate);
    } catch (err) {
        if (!silent) throw err;
        return null;
    }

    if (!decoded?.data || decoded.data.byteLength === 0) return null;

    // PCM s16le：把 byte 视为 Int16。注意 byteOffset 对齐（Buffer.from 复制保险一些）。
    const pcmBytes = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    const pcmInt16 = new Int16Array(
        pcmBytes.buffer,
        pcmBytes.byteOffset,
        Math.floor(pcmBytes.byteLength / 2)
    );

    let mp3: Buffer;
    try {
        const lameMod: any = await import('@breezystack/lamejs');
        const Mp3Encoder = lameMod.Mp3Encoder ?? lameMod.default?.Mp3Encoder;
        if (typeof Mp3Encoder !== 'function') {
            if (!silent) throw new Error('lamejs 缺少 Mp3Encoder 导出');
            return null;
        }
        mp3 = encodePcmToMp3(pcmInt16, sampleRate, bitrateKbps, Mp3Encoder);
    } catch (err) {
        if (!silent) throw err;
        return null;
    }

    if (!mp3 || mp3.length === 0) return null;

    return { mp3, durationMs: decoded.duration ?? 0 };
}

/**
 * 直接把磁盘上的 SILK 文件转成 MP3 文件。
 *
 * 成功时返回 mp3 路径与时长；失败时返回 null（不删除原始 SILK）。
 */
export async function transcodeSilkFileToMp3(
    silkPath: string,
    mp3Path: string,
    options: SilkTranscodeOptions = {}
): Promise<{ mp3Path: string; durationMs: number } | null> {
    let silkBuffer: Buffer;
    try {
        silkBuffer = await fs.promises.readFile(silkPath);
    } catch {
        return null;
    }

    const result = await transcodeSilkBufferToMp3(silkBuffer, options);
    if (!result) return null;

    try {
        await fs.promises.writeFile(mp3Path, result.mp3);
    } catch (err) {
        if (!options.silent && options.silent !== undefined) throw err;
        return null;
    }

    return { mp3Path, durationMs: result.durationMs };
}
