/**
 * Issue #434: 嵌套合并转发（[聊天记录]里又套了一层[聊天记录]）应递归渲染成内层卡片，
 * 而不是只显示一行"[转发消息]"占位。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ModernHtmlExporter } from '../../lib/core/exporter/ModernHtmlExporter.js';
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

async function renderMessage(message: any): Promise<string> {
    const outputDir = path.join(tmp.path, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'chat.html');
    const exporter = new ModernHtmlExporter({
        outputPath,
        includeResourceLinks: true,
        includeSystemMessages: true
    });
    async function* iter() {
        yield message;
    }
    await exporter.exportFromIterable(iter(), { name: 'Alice', type: 'private' });
    return fs.readFileSync(outputPath, 'utf8');
}

test('nested merged-forward is rendered recursively as inner cards (#434)', async () => {
    // 外层转发里有一条子消息，这条子消息本身又是一层转发，里面装着两条最里层消息。
    const innerForward = {
        type: 'forward',
        data: {
            title: '聊天记录',
            messageCount: 2,
            messages: [
                { sender: { name: '深层用户甲' }, content: { text: '最里层消息一', elements: [{ type: 'text', data: { text: '最里层消息一' } }] } },
                { sender: { name: '深层用户乙' }, content: { text: '最里层消息二', elements: [{ type: 'text', data: { text: '最里层消息二' } }] } }
            ]
        }
    };

    const message: any = {
        id: 'm_1',
        timestamp: Date.now(),
        sender: { id: 'u_alice', uin: '11111', name: 'Alice' },
        chatType: 1,
        peer: { peerUid: 'u_alice' },
        content: {
            elements: [
                {
                    type: 'forward',
                    data: {
                        title: '聊天记录',
                        messageCount: 1,
                        messages: [
                            {
                                sender: { name: '中层用户' },
                                content: { text: '[转发消息: 2条]', elements: [innerForward] }
                            }
                        ]
                    }
                }
            ]
        }
    };

    const html = await renderMessage(message);

    // 最里层的发送者与消息内容必须出现，说明递归展开成功，而不是停在占位文本。
    assert.ok(html.includes('深层用户甲'), 'innermost sender 深层用户甲 should be rendered');
    assert.ok(html.includes('最里层消息一'), 'innermost message body should be rendered');
    assert.ok(html.includes('深层用户乙'), 'second innermost sender should be rendered');
    // 内层卡片应带 forward-card-nested 标记。
    assert.ok(html.includes('forward-card-nested'), 'nested forward card class should be present');
    // 占位文本"[转发消息: 2条]"被内层卡片替代，不应再作为正文出现。
    assert.ok(!html.includes('[转发消息: 2条]'), 'placeholder text should be replaced by the nested card');
});

test('forward render depth is capped to avoid runaway nesting (#434)', async () => {
    // 构造超过上限的深层嵌套，确保不抛错且能正常导出。
    const makeForward = (depth: number): any => {
        if (depth === 0) {
            return { sender: { name: '叶子' }, content: { text: '叶子消息', elements: [{ type: 'text', data: { text: '叶子消息' } }] } };
        }
        const child = makeForward(depth - 1);
        return {
            sender: { name: `第${depth}层` },
            content: {
                text: '[转发消息: 1条]',
                elements: [{ type: 'forward', data: { title: '聊天记录', messageCount: 1, messages: [child] } }]
            }
        };
    };

    const message: any = {
        id: 'm_deep',
        timestamp: Date.now(),
        sender: { id: 'u_alice', uin: '11111', name: 'Alice' },
        chatType: 1,
        peer: { peerUid: 'u_alice' },
        content: {
            elements: [
                { type: 'forward', data: { title: '聊天记录', messageCount: 1, messages: [makeForward(6)] } }
            ]
        }
    };

    const html = await renderMessage(message);
    // 不抛错即视为通过；浅层应渲染出来。
    assert.ok(html.includes('第6层') || html.includes('第5层'), 'shallow nesting levels should render');
});
