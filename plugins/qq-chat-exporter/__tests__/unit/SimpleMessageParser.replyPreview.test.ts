/**
 * issue #128 子项：reply 元素的 previewElements 字段。
 *
 * 这里只覆盖 backfillReplyPreviewLocalPaths 的行为：在所有消息的资源
 * 路径已经被写好之后，回头把 reply 元素引用到的图片也补上 localPath。
 *
 * extractReplyContent 自身需要 NapCat overlay 的 messageMap 上下文，跨进程
 * mock 比较重，所以这里直接构造 CleanMessage 列表 + 手工填好 elements 来
 * 校验 backfill 的匹配规则（md5 优先、其次顺序、缺失留空）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SimpleMessageParser, type CleanMessage } from '../../lib/core/parser/SimpleMessageParser.js';

function makeImageMessage(id: string, images: Array<{ md5: string; localPath: string }>): CleanMessage {
    return {
        id,
        seq: id,
        timestamp: 1700000000,
        time: '2023-11-14T22:13:20Z',
        sender: { uid: 'u_1', name: 'A' },
        type: 'normal',
        content: {
            text: '',
            html: '',
            elements: images.map((img) => ({
                type: 'image',
                data: { filename: 'pic', md5: img.md5, localPath: img.localPath, url: `resources/${img.localPath}` },
            })),
            resources: [],
            mentions: [],
        },
        recalled: false,
        system: false,
    };
}

function makeReplyMessage(
    id: string,
    referencedMessageId: string,
    previewElements: any[],
): CleanMessage {
    return {
        id,
        seq: id,
        timestamp: 1700000001,
        time: '2023-11-14T22:13:21Z',
        sender: { uid: 'u_2', name: 'B' },
        type: 'normal',
        content: {
            text: '[图片]',
            html: '',
            elements: [
                {
                    type: 'reply',
                    data: {
                        messageId: id,
                        referencedMessageId,
                        senderName: 'A',
                        content: '[图片]',
                        timestamp: 1700000000,
                        previewElements,
                    },
                },
            ],
            resources: [],
            mentions: [],
        },
        recalled: false,
        system: false,
    };
}

test('backfillReplyPreviewLocalPaths: md5 命中时把 localPath 拉过来', () => {
    const parser = new SimpleMessageParser();
    const original = makeImageMessage('100', [
        { md5: 'aaa', localPath: 'images/aaa.jpg' },
    ]);
    const reply = makeReplyMessage('101', '100', [
        { type: 'image', text: '[图片]', md5: 'aaa', originUrl: 'http://q.qq/aaa', fileName: 'a.jpg' },
    ]);
    parser.backfillReplyPreviewLocalPaths([original, reply]);
    const previewElements = (reply.content.elements[0]!.data as any).previewElements;
    assert.equal(previewElements[0].localPath, 'images/aaa.jpg');
});

test('backfillReplyPreviewLocalPaths: md5 缺失时按顺序匹配', () => {
    const parser = new SimpleMessageParser();
    const original = makeImageMessage('100', [
        { md5: 'aaa', localPath: 'images/aaa.jpg' },
        { md5: 'bbb', localPath: 'images/bbb.jpg' },
    ]);
    const reply = makeReplyMessage('101', '100', [
        { type: 'text', text: 'hi' },
        { type: 'image', text: '[图片]' },
        { type: 'image', text: '[图片]' },
    ]);
    parser.backfillReplyPreviewLocalPaths([original, reply]);
    const previewElements = (reply.content.elements[0]!.data as any).previewElements;
    // text 不动
    assert.equal(previewElements[0].localPath, undefined);
    // 第一个 image 拿 fallbackIdx=0 的 localPath
    assert.equal(previewElements[1].localPath, 'images/aaa.jpg');
    // 第二个 image 拿 fallbackIdx=1 的 localPath（注意 fallbackIdx 在每个 image 后都自增）
    assert.equal(previewElements[2].localPath, 'images/bbb.jpg');
});

test('backfillReplyPreviewLocalPaths: 引用消息不在导出范围内时不写 localPath', () => {
    const parser = new SimpleMessageParser();
    const reply = makeReplyMessage('101', '999', [
        { type: 'image', text: '[图片]', md5: 'xxx', originUrl: 'http://q.qq/xxx' },
    ]);
    parser.backfillReplyPreviewLocalPaths([reply]);
    const previewElements = (reply.content.elements[0]!.data as any).previewElements;
    assert.equal(previewElements[0].localPath, undefined);
    // originUrl 仍然保留，让 HTML 端走 onerror 兜底
    assert.equal(previewElements[0].originUrl, 'http://q.qq/xxx');
});

test('backfillReplyPreviewLocalPaths: previewElements 缺失或非数组时不爆', () => {
    const parser = new SimpleMessageParser();
    const reply: CleanMessage = makeReplyMessage('101', '100', []);
    (reply.content.elements[0]!.data as any).previewElements = null;
    const original = makeImageMessage('100', [{ md5: 'aaa', localPath: 'images/aaa.jpg' }]);
    parser.backfillReplyPreviewLocalPaths([original, reply]);
    // 不抛异常即可
    assert.equal((reply.content.elements[0]!.data as any).previewElements, null);
});

test('backfillReplyPreviewLocalPaths: 空 messages 列表直接 no-op', () => {
    const parser = new SimpleMessageParser();
    parser.backfillReplyPreviewLocalPaths([]);
    // 不抛异常即可
    assert.ok(true);
});

test('backfillReplyPreviewLocalPaths: 原消息没图片资源时不动 reply', () => {
    const parser = new SimpleMessageParser();
    const original: CleanMessage = makeImageMessage('100', []);
    // 故意把 elements 都搞掉，确保不会 build 出 imagesByMsgId
    original.content.elements = [{ type: 'text', data: { content: 'hi' } }];
    const reply = makeReplyMessage('101', '100', [
        { type: 'image', text: '[图片]', md5: 'aaa' },
    ]);
    parser.backfillReplyPreviewLocalPaths([original, reply]);
    const previewElements = (reply.content.elements[0]!.data as any).previewElements;
    assert.equal(previewElements[0].localPath, undefined);
});
