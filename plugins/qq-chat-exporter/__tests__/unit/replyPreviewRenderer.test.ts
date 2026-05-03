import test from 'node:test';
import assert from 'node:assert/strict';
import {
    renderReplyPreviewElement,
    renderReplyPreviewElements,
    type ReplyPreviewRenderContext,
} from '../../lib/core/exporter/replyPreviewRenderer.js';

/**
 * 简化版 escapeHtml：只处理 reply 渲染里实际会出现的几种危险字符。
 * 真实实现来自 ModernHtmlExporter.escapeHtml，行为对得上即可。
 */
function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const baseCtx: ReplyPreviewRenderContext = {
    resourceBaseHref: 'resources',
    escapeHtml,
    lookupDataUri: () => undefined,
    getFaceName: (id) => {
        const map: Record<string, string> = {
            '0': '/微笑',
            '341': '/奋斗',
            '14': '/惊讶',
        };
        return map[String(id)] || `/表情${id}`;
    },
};

test('renderReplyPreviewElement: image 有 localPath 时输出 <img>，src 走相对路径', () => {
    const html = renderReplyPreviewElement(
        { type: 'image', localPath: 'images/abc.jpg', md5: 'abc' },
        baseCtx,
    );
    assert.match(html, /<img\s+src="resources\/images\/abc\.jpg"/);
    assert.match(html, /class="reply-content-thumb"/);
    assert.match(html, /loading="lazy"/);
});

test('renderReplyPreviewElement: image 命中 dataUri 时直接用 dataUri，不再拼相对路径', () => {
    const html = renderReplyPreviewElement(
        { type: 'image', localPath: 'images/abc.jpg' },
        {
            ...baseCtx,
            lookupDataUri: (kind, name) =>
                kind === 'images' && name === 'abc.jpg' ? 'data:image/jpeg;base64,Zm9v' : null,
        },
    );
    assert.match(html, /src="data:image\/jpeg;base64,Zm9v"/);
    assert.doesNotMatch(html, /resources\//);
});

test('renderReplyPreviewElement: image 没 localPath 但有 originUrl，落到带 onerror 兜底的 <img>', () => {
    const html = renderReplyPreviewElement(
        {
            type: 'image',
            originUrl: 'https://gchat.qpic.cn/gchatpic_new/123/abc',
        },
        baseCtx,
    );
    assert.match(html, /src="https:\/\/gchat\.qpic\.cn\/gchatpic_new\/123\/abc"/);
    assert.match(html, /onerror=/);
    assert.match(html, /\[图片\]/);
});

test('renderReplyPreviewElement: image 全无 localPath / originUrl，回退到 text 占位符', () => {
    const html = renderReplyPreviewElement(
        { type: 'image', text: '[图片]' },
        baseCtx,
    );
    assert.equal(html, '[图片]');
});

test('renderReplyPreviewElement: image originUrl 里的 " 会被 escape，避免 HTML 被截断', () => {
    const html = renderReplyPreviewElement(
        { type: 'image', originUrl: 'https://x.com/a"onerror="alert(1)' },
        baseCtx,
    );
    assert.match(html, /src="https:\/\/x\.com\/a&quot;onerror=&quot;alert\(1\)"/);
});

test('renderReplyPreviewElement: marketFace 有 url 输出 <img>，alt 走 faceName', () => {
    const html = renderReplyPreviewElement(
        {
            type: 'marketFace',
            url: 'https://qq.com/face/abc.png',
            faceName: '咖啡',
        },
        baseCtx,
    );
    assert.match(html, /<img\s+src="https:\/\/qq\.com\/face\/abc\.png"/);
    assert.match(html, /class="reply-content-emoji"/);
    assert.match(html, /alt="咖啡"/);
});

test('renderReplyPreviewElement: marketFace 没 url 时回退到文字', () => {
    const html = renderReplyPreviewElement(
        { type: 'marketFace', text: '[商城表情]' },
        baseCtx,
    );
    assert.equal(html, '[商城表情]');
});

test('renderReplyPreviewElement: face 走 getFaceName，把 [表情341] 翻译成 /奋斗', () => {
    const html = renderReplyPreviewElement(
        { type: 'face', faceIndex: 341, text: '[表情341]' },
        baseCtx,
    );
    assert.equal(html, '/奋斗');
});

test('renderReplyPreviewElement: face 表情 ID 是字符串也接得住', () => {
    const html = renderReplyPreviewElement(
        { type: 'face', faceIndex: '0', text: '[表情0]' },
        baseCtx,
    );
    assert.equal(html, '/微笑');
});

test('renderReplyPreviewElement: face 不在表里时回退到 getFaceName 默认串', () => {
    const html = renderReplyPreviewElement(
        { type: 'face', faceIndex: 9999, text: '[表情9999]' },
        baseCtx,
    );
    assert.equal(html, '/表情9999');
});

test('renderReplyPreviewElement: face 完全缺 faceIndex / text，最后兜底到 [表情]', () => {
    const html = renderReplyPreviewElement(
        { type: 'face' },
        baseCtx,
    );
    assert.equal(html, '[表情]');
});

test('renderReplyPreviewElement: video 给 fileName 时输出 🎬 + 文件名', () => {
    const html = renderReplyPreviewElement(
        { type: 'video', fileName: 'abc.mp4', text: '[视频]' },
        baseCtx,
    );
    assert.match(html, /<span class="reply-content-attachment">🎬 abc\.mp4<\/span>/);
});

test('renderReplyPreviewElement: video 没 fileName 时退到 text 占位符', () => {
    const html = renderReplyPreviewElement(
        { type: 'video', text: '[视频]' },
        baseCtx,
    );
    assert.match(html, /🎬 \[视频\]/);
});

test('renderReplyPreviewElement: audio 用 🎵 icon + text 占位符', () => {
    const html = renderReplyPreviewElement(
        { type: 'audio', text: '[语音]' },
        baseCtx,
    );
    assert.match(html, /<span class="reply-content-attachment">🎵 \[语音\]<\/span>/);
});

test('renderReplyPreviewElement: file 用 📎 icon + 文件名', () => {
    const html = renderReplyPreviewElement(
        { type: 'file', fileName: 'report.pdf', text: '[文件]' },
        baseCtx,
    );
    assert.match(html, /📎 report\.pdf/);
});

test('renderReplyPreviewElement: text 类型直接 escape 后输出', () => {
    const html = renderReplyPreviewElement(
        { type: 'text', text: '<script>alert(1)</script>' },
        baseCtx,
    );
    assert.equal(html, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderReplyPreviewElement: 未知 type 退化成 escape(text)', () => {
    const html = renderReplyPreviewElement(
        { type: 'unknown_xyz', text: '<b>hello</b>' },
        baseCtx,
    );
    assert.equal(html, '&lt;b&gt;hello&lt;/b&gt;');
});

test('renderReplyPreviewElement: null / undefined / 非对象输入返回空串，调用方直接拼接不会爆', () => {
    assert.equal(renderReplyPreviewElement(null, baseCtx), '');
    assert.equal(renderReplyPreviewElement(undefined, baseCtx), '');
    assert.equal(renderReplyPreviewElement('not an object', baseCtx), '');
    assert.equal(renderReplyPreviewElement(42, baseCtx), '');
});

test('renderReplyPreviewElements: 把多种类型按顺序拼接', () => {
    const html = renderReplyPreviewElements(
        [
            { type: 'text', text: '看这个：' },
            { type: 'image', localPath: 'images/x.jpg' },
            { type: 'face', faceIndex: 14, text: '[表情14]' },
        ],
        baseCtx,
    );
    assert.equal(
        html,
        '看这个：' +
            '<img src="resources/images/x.jpg" class="reply-content-thumb" alt="引用图片" loading="lazy">' +
            '/惊讶',
    );
});

test('renderReplyPreviewElements: 空数组 / 非数组 / 全是脏数据，结果是空串', () => {
    assert.equal(renderReplyPreviewElements([], baseCtx), '');
    assert.equal(
        renderReplyPreviewElements(null as unknown as unknown[], baseCtx),
        '',
    );
    assert.equal(
        renderReplyPreviewElements([null, undefined, 'x', 0, false] as unknown[], baseCtx),
        '',
    );
});
