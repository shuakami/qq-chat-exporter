import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyChatTypeBinary,
    getChatTypePrefix,
    isPrivateLikeChatType,
} from '../../lib/api/chatTypeClassification.js';

test('chatTypeClassification: chatType=2 是群聊', () => {
    assert.equal(isPrivateLikeChatType(2), false);
    assert.equal(getChatTypePrefix(2), 'group');
    assert.equal(classifyChatTypeBinary(2), 'group');
});

test('chatTypeClassification: chatType=1 是好友（单聊）', () => {
    assert.equal(isPrivateLikeChatType(1), true);
    assert.equal(getChatTypePrefix(1), 'friend');
    assert.equal(classifyChatTypeBinary(1), 'private');
});

test('chatTypeClassification: chatType=100 临时会话按单聊处理（issue #365）', () => {
    assert.equal(isPrivateLikeChatType(100), true);
    assert.equal(getChatTypePrefix(100), 'friend');
    assert.equal(classifyChatTypeBinary(100), 'private');
});

test('chatTypeClassification: 服务号 / 公众账号 (118 / 201) 也按单聊处理', () => {
    for (const t of [118, 201]) {
        assert.equal(isPrivateLikeChatType(t), true);
        assert.equal(getChatTypePrefix(t), 'friend');
        assert.equal(classifyChatTypeBinary(t), 'private');
    }
});

test('chatTypeClassification: 频道 / 频道私聊 (4 / 9 / 16) 也按单聊处理', () => {
    for (const t of [4, 9, 16]) {
        assert.equal(isPrivateLikeChatType(t), true);
        assert.equal(getChatTypePrefix(t), 'friend');
        assert.equal(classifyChatTypeBinary(t), 'private');
    }
});

test('chatTypeClassification: 通知类 (132 / 133 / 134) 也按单聊处理', () => {
    for (const t of [132, 133, 134]) {
        assert.equal(isPrivateLikeChatType(t), true);
        assert.equal(getChatTypePrefix(t), 'friend');
        assert.equal(classifyChatTypeBinary(t), 'private');
    }
});

test('chatTypeClassification: undefined / null 兜底为单聊（不让分支裸奔）', () => {
    assert.equal(isPrivateLikeChatType(undefined), true);
    assert.equal(isPrivateLikeChatType(null), true);
    assert.equal(getChatTypePrefix(undefined), 'friend');
    assert.equal(classifyChatTypeBinary(null), 'private');
});

test('chatTypeClassification: 字符串数字也能正确归类（防御性）', () => {
    // 实际 chatType 都是 number，但 JSON 反序列化偶发会出现字符串场景。
    // 这里只覆盖最常见的 "2" / "100"。
    assert.equal(isPrivateLikeChatType(Number('2')), false);
    assert.equal(isPrivateLikeChatType(Number('100')), true);
});
