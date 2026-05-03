import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chooseReplyJumpTarget,
    formatReplyTimestamp,
    pickReplyRenderHints,
} from '../../lib/core/exporter/replyRender.js';

test('chooseReplyJumpTarget: 优先 referencedMessageId（parser 真实写入字段）', () => {
    assert.equal(
        chooseReplyJumpTarget({
            referencedMessageId: '7000000001',
            replyMsgId: '7000000002',
            msgId: '7000000003',
        }),
        '7000000001',
    );
});

test('chooseReplyJumpTarget: 没 referencedMessageId 落到 replyMsgId', () => {
    assert.equal(
        chooseReplyJumpTarget({
            replyMsgId: '7000000002',
            msgId: '7000000003',
        }),
        '7000000002',
    );
});

test('chooseReplyJumpTarget: 全是 0 / 空，返回 null', () => {
    assert.equal(
        chooseReplyJumpTarget({
            referencedMessageId: '0',
            replyMsgId: '',
            msgId: '   ',
        }),
        null,
    );
});

test('chooseReplyJumpTarget: 空对象 / null / undefined 全都安全', () => {
    assert.equal(chooseReplyJumpTarget({}), null);
    assert.equal(chooseReplyJumpTarget(null), null);
    assert.equal(chooseReplyJumpTarget(undefined), null);
});

test('chooseReplyJumpTarget: 数字会被转成 string', () => {
    assert.equal(
        chooseReplyJumpTarget({ referencedMessageId: 1234567890 as any }),
        '1234567890',
    );
});

test('formatReplyTimestamp: 秒级 epoch number', () => {
    // 2024-06-15 12:34:00 UTC = 1718454840
    assert.equal(formatReplyTimestamp(1718454840), '06-15 12:34');
});

test('formatReplyTimestamp: 毫秒级 epoch number 自动识别', () => {
    // 2024-06-15 12:34:00 UTC = 1718454840000
    assert.equal(formatReplyTimestamp(1718454840000), '06-15 12:34');
});

test('formatReplyTimestamp: 全数字字符串按数字处理', () => {
    assert.equal(formatReplyTimestamp('1718454840'), '06-15 12:34');
    assert.equal(formatReplyTimestamp('1718454840000'), '06-15 12:34');
});

test('formatReplyTimestamp: ISO string', () => {
    assert.equal(formatReplyTimestamp('2024-06-15T12:34:00Z'), '06-15 12:34');
});

test('formatReplyTimestamp: 0 / 负数 / 空 / null / undefined / 非法字符串 都返回空', () => {
    assert.equal(formatReplyTimestamp(0), '');
    assert.equal(formatReplyTimestamp(-1), '');
    assert.equal(formatReplyTimestamp(''), '');
    assert.equal(formatReplyTimestamp('   '), '');
    assert.equal(formatReplyTimestamp(null), '');
    assert.equal(formatReplyTimestamp(undefined), '');
    assert.equal(formatReplyTimestamp('not a date'), '');
    assert.equal(formatReplyTimestamp(NaN), '');
});

test('pickReplyRenderHints: 真实场景组合', () => {
    const hints = pickReplyRenderHints({
        referencedMessageId: '7000000001',
        timestamp: 1718454840,
    });
    assert.equal(hints.jumpTarget, '7000000001');
    assert.equal(hints.formattedTime, '06-15 12:34');
});

test('pickReplyRenderHints: 没 timestamp 时 fallback 到 time 字段', () => {
    const hints = pickReplyRenderHints({
        referencedMessageId: '7000000001',
        time: '2024-06-15T12:34:00Z',
    });
    assert.equal(hints.jumpTarget, '7000000001');
    assert.equal(hints.formattedTime, '06-15 12:34');
});

test('pickReplyRenderHints: 全空安全 fallback', () => {
    const hints = pickReplyRenderHints({});
    assert.equal(hints.jumpTarget, null);
    assert.equal(hints.formattedTime, '');
});
