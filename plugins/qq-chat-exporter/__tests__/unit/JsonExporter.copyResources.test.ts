/**
 * Issue #319: 验证 JsonExporter 在拿到 resourceMap 时会把已下载的资源
 * （包括聊天文件 type='file'）复制到导出目录的 resources/<typeDir>/，
 * 与 HTML 导出保持一致。
 *
 * 这条用例覆盖的是底层契约：只要调用方传入正确的 resourceMap，导出器
 * 就会把图片 / 视频 / 语音 / 文件落到 outputDir。`ScheduledExportManager`
 * 之前就是漏传 resourceMap 才导致定时 JSON 不会带文件。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { JsonExporter } from '../../lib/core/exporter/JsonExporter.js';
import { createMockCore } from '../helpers/MockNapCatCore.js';
import { installBridge, uninstallBridge } from '../helpers/installBridge.js';
import { silenceConsole } from '../helpers/silenceConsole.js';
import { createTempDir } from '../helpers/tempDir.js';

let console_!: ReturnType<typeof silenceConsole>;
let tmp!: ReturnType<typeof createTempDir>;

test.beforeEach(() => {
    console_ = silenceConsole();
    tmp = createTempDir();
});

test.afterEach(() => {
    uninstallBridge();
    tmp.cleanup();
    console_.restore();
});

test('JsonExporter with resourceMap copies file-type resources to <outputDir>/resources/files (#319)', async () => {
    const core = createMockCore({});
    installBridge({ core });

    // 模拟 ResourceHandler 落盘的源文件
    const sourceDir = path.join(tmp.path, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourceFile = path.join(sourceDir, 'group_doc.pdf');
    fs.writeFileSync(sourceFile, Buffer.from('PDF-DATA-FOR-TEST'));

    const sourceImage = path.join(sourceDir, 'group_pic.png');
    fs.writeFileSync(sourceImage, Buffer.from('PNG-DATA-FOR-TEST'));

    const outputDir = path.join(tmp.path, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'chat.json');

    const resourceMap = new Map<string, any[]>([
        [
            'msg_1',
            [
                {
                    type: 'file',
                    fileName: 'group_doc.pdf',
                    localPath: sourceFile,
                    fileSize: 17
                },
                {
                    type: 'image',
                    fileName: 'group_pic.png',
                    localPath: sourceImage,
                    fileSize: 17
                }
            ]
        ]
    ]);

    const exporter = new JsonExporter(
        {
            outputPath,
            includeResourceLinks: true,
            includeSystemMessages: true,
            filterPureImageMessages: false,
            prettyFormat: true,
            timeFormat: 'YYYY-MM-DD HH:mm:ss',
            encoding: 'utf-8',
            resourceMap
        },
        {},
        core as any
    );

    // 没有真实消息也走得通：BaseExporter.copyResourcesAlongsideExport 只看 resourceMap。
    await exporter.export([] as any, { name: 'Alice', type: 'private' } as any);

    const copiedFile = path.join(outputDir, 'resources', 'files', 'group_doc.pdf');
    const copiedImage = path.join(outputDir, 'resources', 'images', 'group_pic.png');
    assert.ok(fs.existsSync(copiedFile), 'group_doc.pdf should be copied to resources/files/');
    assert.ok(fs.existsSync(copiedImage), 'group_pic.png should be copied to resources/images/');
    assert.equal(
        fs.readFileSync(copiedFile, 'utf8'),
        'PDF-DATA-FOR-TEST',
        'copied file content matches source'
    );
});
