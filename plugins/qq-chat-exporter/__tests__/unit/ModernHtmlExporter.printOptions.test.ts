/**
 * Issue #467: 单文件 HTML 导出新增两个打印 / PDF 友好开关：
 *   - showSearchBar：是否显示底部胶囊式搜索/工具栏；
 *   - enableVirtualScroll：是否启用虚拟滚动。
 * 都默认开启，关闭后分别隐藏工具栏、让所有消息留在 DOM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ModernHtmlExporter, HtmlExportOptions } from '../../lib/core/exporter/ModernHtmlExporter.js';
import { createTempDir } from '../helpers/tempDir.js';
import { silenceConsole } from '../helpers/silenceConsole.js';

let console_!: ReturnType<typeof silenceConsole>;
let tmp!: ReturnType<typeof createTempDir>;

test.beforeEach(() => {
    console_ = silenceConsole();
    tmp = createTempDir();
});

test.afterEach(() => {
    tmp.cleanup();
    console_.restore();
});

async function renderHtml(extraOptions: Partial<HtmlExportOptions> = {}): Promise<string> {
    const outputDir = path.join(tmp.path, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'chat.html');
    const exporter = new ModernHtmlExporter({
        outputPath,
        includeResourceLinks: true,
        includeSystemMessages: true,
        ...extraOptions
    });
    const message: any = {
        id: 'm_1',
        timestamp: Date.now(),
        sender: { id: 'u_1', uin: '10001', name: '张三' },
        chatType: 1,
        peer: { peerUid: 'u_1' },
        content: { elements: [{ type: 'text', data: { text: '你好' } }] }
    };
    async function* iter() { yield message; }
    await exporter.exportFromIterable(iter(), { name: 'Alice', type: 'private' });
    return fs.readFileSync(outputPath, 'utf8');
}

test('defaults keep the toolbar visible and virtual scroll enabled (#467)', async () => {
    const html = await renderHtml();
    assert.ok(html.includes('<div class="toolbar">'), 'toolbar should render by default');
    assert.ok(!html.includes('<div class="toolbar" style="display:none">'), 'toolbar should not be hidden by default');
    assert.ok(html.includes('window.__QCE_ENABLE_VIRTUAL_SCROLL = true'), 'virtual scroll enabled by default');
});

test('showSearchBar=false hides the capsule toolbar (#467)', async () => {
    const html = await renderHtml({ showSearchBar: false });
    assert.ok(html.includes('<div class="toolbar" style="display:none">'), 'toolbar should be hidden');
    assert.ok(!html.includes('<div class="toolbar">'), 'no visible toolbar element should remain');
});

test('enableVirtualScroll=false disables virtual scrolling (#467)', async () => {
    const html = await renderHtml({ enableVirtualScroll: false });
    assert.ok(html.includes('window.__QCE_ENABLE_VIRTUAL_SCROLL = false'), 'virtual scroll should be disabled');
    // 渲染脚本中的开关判断仍在，只是运行期被关掉。
    assert.ok(html.includes('window.__QCE_ENABLE_VIRTUAL_SCROLL !== false && messageBlocks.length > 100'),
        'virtual scroll init should be gated on the runtime flag');
});
