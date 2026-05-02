import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ResourceHandler } from '../../lib/core/resource/ResourceHandler.js';
import { ResourceStatus } from '../../lib/types/index.js';

/**
 * Issue #285 — 导出语音 .amr 文件实际上是 SILK 编码，导致下游播放器解码失败。
 *
 * 这里只测内部纯函数 normalizeAudioFileExtension，不依赖 NapCatCore 运行时。
 */

function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function newHandler(): any {
    return Object.create(ResourceHandler.prototype);
}

function makeResourceInfo(fileName: string, mime = 'audio/wav') {
    return {
        type: 'audio',
        originalUrl: '',
        fileName,
        fileSize: 0,
        mimeType: mime,
        md5: '',
        accessible: true,
        checkedAt: new Date(),
        status: ResourceStatus.DOWNLOADED,
        downloadAttempts: 0,
    };
}

test('SILK 文件以 .amr 扩展名落盘时被改为 .silk', () => {
    const t = tmpDir('qce-audio-silk-');
    try {
        const wrongPath = path.join(t.dir, 'voice_001.amr');
        // SILK_V3 magic
        fs.writeFileSync(wrongPath, Buffer.concat([
            Buffer.from('#!SILK_V3'),
            Buffer.alloc(8, 0xAA),
        ]));

        const handler = newHandler();
        const info = makeResourceInfo('voice_001.amr', 'audio/amr');
        const finalPath: string = handler.normalizeAudioFileExtension(wrongPath, info);

        assert.equal(path.extname(finalPath), '.silk');
        assert.ok(fs.existsSync(finalPath));
        assert.equal(fs.existsSync(wrongPath), false);
        assert.equal(info.fileName, 'voice_001.silk');
        assert.equal(info.mimeType, 'audio/silk');
    } finally {
        t.cleanup();
    }
});

test('SILK 头带 0x02 前缀的也能识别', () => {
    const t = tmpDir('qce-audio-silk2-');
    try {
        const wrongPath = path.join(t.dir, 'voice_002.amr');
        fs.writeFileSync(wrongPath, Buffer.concat([
            Buffer.from([0x02]),
            Buffer.from('#!SILK_V3'),
            Buffer.alloc(8, 0x55),
        ]));

        const handler = newHandler();
        const info = makeResourceInfo('voice_002.amr');
        const finalPath: string = handler.normalizeAudioFileExtension(wrongPath, info);
        assert.equal(path.extname(finalPath), '.silk');
        assert.equal(info.fileName, 'voice_002.silk');
    } finally {
        t.cleanup();
    }
});

test('真正的 AMR 文件保持 .amr 扩展名不变', () => {
    const t = tmpDir('qce-audio-amr-');
    try {
        const correctPath = path.join(t.dir, 'voice_003.amr');
        fs.writeFileSync(correctPath, Buffer.concat([
            Buffer.from('#!AMR\n'),
            Buffer.alloc(16, 0x12),
        ]));

        const handler = newHandler();
        const info = makeResourceInfo('voice_003.amr');
        const finalPath: string = handler.normalizeAudioFileExtension(correctPath, info);
        assert.equal(finalPath, correctPath);
        assert.equal(info.fileName, 'voice_003.amr');
        // mime 会被同步刷为 audio/amr
        assert.equal(info.mimeType, 'audio/amr');
    } finally {
        t.cleanup();
    }
});

test('AMR-WB 头识别为 .amr', () => {
    const t = tmpDir('qce-audio-amrwb-');
    try {
        const correctPath = path.join(t.dir, 'voice_004.amr');
        fs.writeFileSync(correctPath, Buffer.concat([
            Buffer.from('#!AMR-WB\n'),
            Buffer.alloc(16, 0x21),
        ]));
        const handler = newHandler();
        const info = makeResourceInfo('voice_004.amr');
        const finalPath: string = handler.normalizeAudioFileExtension(correctPath, info);
        assert.equal(finalPath, correctPath);
        assert.equal(info.mimeType, 'audio/amr');
    } finally {
        t.cleanup();
    }
});

test('MP3 文件被错误命名为 .amr 时改为 .mp3', () => {
    const t = tmpDir('qce-audio-mp3-');
    try {
        const wrongPath = path.join(t.dir, 'voice_005.amr');
        // ID3 头
        fs.writeFileSync(wrongPath, Buffer.concat([
            Buffer.from('ID3'),
            Buffer.alloc(16, 0),
        ]));
        const handler = newHandler();
        const info = makeResourceInfo('voice_005.amr');
        const finalPath: string = handler.normalizeAudioFileExtension(wrongPath, info);
        assert.equal(path.extname(finalPath), '.mp3');
        assert.equal(info.fileName, 'voice_005.mp3');
        assert.equal(info.mimeType, 'audio/mpeg');
    } finally {
        t.cleanup();
    }
});

test('未知字节保持原扩展名不变', () => {
    const t = tmpDir('qce-audio-unknown-');
    try {
        const filePath = path.join(t.dir, 'voice_006.amr');
        fs.writeFileSync(filePath, Buffer.alloc(16, 0));
        const handler = newHandler();
        const info = makeResourceInfo('voice_006.amr');
        const finalPath: string = handler.normalizeAudioFileExtension(filePath, info);
        assert.equal(finalPath, filePath);
        assert.equal(info.fileName, 'voice_006.amr');
    } finally {
        t.cleanup();
    }
});
