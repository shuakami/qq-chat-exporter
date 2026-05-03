/**
 * Issue #311: 自包含 HTML 导出测试。
 *
 * 验证 `embedResourcesAsDataUri=true` 时：
 *   1. 不创建 `resources/` 目录
 *   2. <img>/<audio>/<video>/<a> 的 src/href 改为 `data:<mime>;base64,...`
 *   3. 超过 `maxEmbedFileSizeBytes` 的资源回退为相对路径
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ModernHtmlExporter } from '../../lib/core/exporter/ModernHtmlExporter.js';
import { createTempDir } from '../helpers/tempDir.js';
import { silenceConsole } from '../helpers/silenceConsole.js';

// 1×1 透明 PNG
const PNG_BYTES = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
    '890000000d49444154789c63600000000200015e2bb1f80000000049454e44ae' +
    '426082',
    'hex'
);

let console_!: ReturnType<typeof silenceConsole>;
let tmp!: ReturnType<typeof createTempDir>;
let originalUserProfile: string | undefined;

test.beforeEach(() => {
    console_ = silenceConsole();
    tmp = createTempDir();
    originalUserProfile = process.env['USERPROFILE'];
    process.env['USERPROFILE'] = tmp.path;
});

test.afterEach(() => {
    if (originalUserProfile === undefined) {
        delete process.env['USERPROFILE'];
    } else {
        process.env['USERPROFILE'] = originalUserProfile;
    }
    tmp.cleanup();
    console_.restore();
});

interface ScenarioOptions {
    fileBytes: Buffer;
    fileName: string;
    typeDir: 'images' | 'audios' | 'videos' | 'files';
    embed: boolean;
    maxEmbedFileSizeBytes?: number;
}

async function runEmbedScenario(opts: ScenarioOptions): Promise<{ html: string; outputDir: string }> {
    // 把资源写到 ResourceHandler 默认目录
    const resourceDir = path.join(tmp.path, '.qq-chat-exporter', 'resources', opts.typeDir);
    fs.mkdirSync(resourceDir, { recursive: true });
    const onDiskName = `abc123_${opts.fileName}`;
    fs.writeFileSync(path.join(resourceDir, onDiskName), opts.fileBytes);

    const outputDir = path.join(tmp.path, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'chat.html');

    const elementType = opts.typeDir === 'images'
        ? 'image'
        : opts.typeDir === 'audios'
            ? 'audio'
            : opts.typeDir === 'videos'
                ? 'video'
                : 'file';

    const message: any = {
        id: 'm_1',
        timestamp: Date.now(),
        sender: { id: 'u_alice', uin: '11111', name: 'Alice' },
        chatType: 1,
        peer: { peerUid: 'u_alice' },
        content: {
            elements: [
                {
                    type: elementType,
                    data: { filename: opts.fileName, url: '' }
                }
            ]
        }
    };

    const exporter = new ModernHtmlExporter({
        outputPath,
        includeResourceLinks: true,
        includeSystemMessages: true,
        embedResourcesAsDataUri: opts.embed,
        ...(opts.maxEmbedFileSizeBytes !== undefined
            ? { maxEmbedFileSizeBytes: opts.maxEmbedFileSizeBytes }
            : {})
    });

    async function* iter() {
        yield message;
    }

    await exporter.exportFromIterable(iter(), { name: 'Alice', type: 'private' });

    const html = fs.readFileSync(outputPath, 'utf8');
    return { html, outputDir };
}

test('embedResourcesAsDataUri=true: image is inlined as data URI and resources/ dir is not created', async () => {
    const { html, outputDir } = await runEmbedScenario({
        fileBytes: PNG_BYTES,
        fileName: 'screenshot.png',
        typeDir: 'images',
        embed: true
    });

    assert.match(html, /src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    assert.ok(!html.includes('./resources/images/screenshot.png'),
        'inlined HTML should not reference external resources/');
    assert.ok(!fs.existsSync(path.join(outputDir, 'resources')),
        'resources/ directory should not be created in inline mode');
});

test('embedResourcesAsDataUri=false: image stays as external relative path', async () => {
    const { html, outputDir } = await runEmbedScenario({
        fileBytes: PNG_BYTES,
        fileName: 'screenshot.png',
        typeDir: 'images',
        embed: false
    });

    assert.ok(!/src="data:image\/png;base64,/.test(html),
        'plain mode must not produce data URIs');
    assert.match(html, /src="\.\/resources\/images\/screenshot\.png"/);
    assert.ok(fs.existsSync(path.join(outputDir, 'resources', 'images', 'screenshot.png')),
        'resources/images/screenshot.png should be copied');
});

test('embedResourcesAsDataUri=true with size limit smaller than file falls back to relative path', async () => {
    const { html } = await runEmbedScenario({
        fileBytes: PNG_BYTES,
        fileName: 'screenshot.png',
        typeDir: 'images',
        embed: true,
        // 单个资源上限 10 字节，小于真实 PNG 大小
        maxEmbedFileSizeBytes: 10
    });

    assert.ok(!/src="data:image\/png;base64,/.test(html),
        'oversize file should fall back to external link, not inline');
    assert.match(html, /src="\.\/resources\/images\/screenshot\.png"/);
});

test('embedResourcesAsDataUri=true: audio file is inlined as data URI with audio MIME', async () => {
    const silkBytes = Buffer.from('SILK_FAKE_BYTES_FOR_TEST_PURPOSES', 'utf8');
    const { html } = await runEmbedScenario({
        fileBytes: silkBytes,
        fileName: 'voice.silk',
        typeDir: 'audios',
        embed: true
    });

    assert.match(html, /<audio src="data:audio\/silk;base64,[A-Za-z0-9+/=]+"/);
});
