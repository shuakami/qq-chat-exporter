import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { StickerPackExporter } from '../../lib/core/sticker/StickerPackExporter.js';

/**
 * Issue #313 — QQ 收藏 / 商城表情包导出时按 magic bytes 校正扩展名。
 *
 * QQ 客户端把收藏表情统一以 `.jpg` 落到本地缓存，但里面可能是 GIF / PNG / WebP，
 * 早期实现直接把 `.jpg` 当作输出扩展名，导致下游软件按 jpg 解码后显示「损坏」。
 * 这里只测两个内部纯函数（不依赖 NapCat 运行时）：
 *   - detectFileExtensionByMagic：按头 12 字节识别
 *   - normalizeStickerExtension：识别成功且不一致时改名
 */

function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function newExporter(): any {
    // 这里不需要 NapCatCore 的真实功能，只用 prototype 方法即可。
    return Object.create(StickerPackExporter.prototype);
}

test('detectFileExtensionByMagic 把 GIF87a 识别为 .gif', () => {
    const t = tmpDir('qce-sticker-ext-gif-');
    try {
        const file = path.join(t.dir, 'a.jpg');
        fs.writeFileSync(file, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]));
        const exp = newExporter();
        assert.equal(exp.detectFileExtensionByMagic(file), '.gif');
    } finally {
        t.cleanup();
    }
});

test('detectFileExtensionByMagic 把 PNG 识别为 .png', () => {
    const t = tmpDir('qce-sticker-ext-png-');
    try {
        const file = path.join(t.dir, 'a.bin');
        fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        const exp = newExporter();
        assert.equal(exp.detectFileExtensionByMagic(file), '.png');
    } finally {
        t.cleanup();
    }
});

test('detectFileExtensionByMagic 把 JPEG 识别为 .jpg', () => {
    const t = tmpDir('qce-sticker-ext-jpg-');
    try {
        const file = path.join(t.dir, 'a.gif');
        fs.writeFileSync(file, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]));
        const exp = newExporter();
        assert.equal(exp.detectFileExtensionByMagic(file), '.jpg');
    } finally {
        t.cleanup();
    }
});

test('detectFileExtensionByMagic 把 RIFF/WEBP 识别为 .webp', () => {
    const t = tmpDir('qce-sticker-ext-webp-');
    try {
        const file = path.join(t.dir, 'a.jpg');
        fs.writeFileSync(file, Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50
        ]));
        const exp = newExporter();
        assert.equal(exp.detectFileExtensionByMagic(file), '.webp');
    } finally {
        t.cleanup();
    }
});

test('detectFileExtensionByMagic 对未知字节返回 null', () => {
    const t = tmpDir('qce-sticker-ext-unknown-');
    try {
        const file = path.join(t.dir, 'a.bin');
        fs.writeFileSync(file, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        const exp = newExporter();
        assert.equal(exp.detectFileExtensionByMagic(file), null);
    } finally {
        t.cleanup();
    }
});

test('normalizeStickerExtension 把误标为 .jpg 的 GIF 改名为 .gif', async () => {
    const t = tmpDir('qce-sticker-norm-');
    try {
        const wrongPath = path.join(t.dir, 'sticker_001.jpg');
        // 写入 GIF89a magic
        fs.writeFileSync(wrongPath, Buffer.from([
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00
        ]));
        const exp = newExporter();
        const finalPath: string = await exp.normalizeStickerExtension(wrongPath);
        assert.equal(path.extname(finalPath), '.gif');
        assert.ok(fs.existsSync(finalPath));
        assert.equal(fs.existsSync(wrongPath), false);
    } finally {
        t.cleanup();
    }
});

test('normalizeStickerExtension 当扩展名已经正确时保持不变', async () => {
    const t = tmpDir('qce-sticker-noop-');
    try {
        const correctPath = path.join(t.dir, 'sticker_002.png');
        fs.writeFileSync(correctPath, Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]));
        const exp = newExporter();
        const finalPath: string = await exp.normalizeStickerExtension(correctPath);
        assert.equal(finalPath, correctPath);
        assert.ok(fs.existsSync(correctPath));
    } finally {
        t.cleanup();
    }
});
