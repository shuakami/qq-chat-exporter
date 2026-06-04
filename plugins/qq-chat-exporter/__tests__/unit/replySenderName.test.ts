/**
 * Issue #296：JSON 等导出里「回复 XXX」的发件人错位。
 * 这里覆盖被引用消息发件人显示名的解析优先级与兜底，确保发件人跟随被引用消息本身，
 * 而不是退化成 reply 元素自带的 u_xxx uid，或对不上引用内容的另一个人。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplySenderName } from '../../lib/core/parser/replySenderName.js';

describe('resolveReplySenderName', () => {
    it('群聊默认用昵称（不优先群名片）', () => {
        const name = resolveReplySenderName(
            { memberName: '群名片', remark: '备注', nickname: '昵称', uin: '10001', uidStr: 'u_a' },
            { isGroupChat: true, preferGroupMemberName: false },
        );
        assert.equal(name, '昵称');
    });

    it('群聊 + 优先群名片：群名片 > 备注 > 昵称', () => {
        assert.equal(
            resolveReplySenderName(
                { memberName: '群名片', remark: '备注', nickname: '昵称' },
                { isGroupChat: true, preferGroupMemberName: true },
            ),
            '群名片',
        );
        assert.equal(
            resolveReplySenderName(
                { memberName: '', remark: '备注', nickname: '昵称' },
                { isGroupChat: true, preferGroupMemberName: true },
            ),
            '备注',
        );
    });

    it('私聊用备注 > 昵称', () => {
        assert.equal(
            resolveReplySenderName(
                { remark: '备注', nickname: '昵称', uin: '10001' },
                { isGroupChat: false, preferGroupMemberName: false },
            ),
            '备注',
        );
        assert.equal(
            resolveReplySenderName(
                { remark: '', nickname: '昵称', uin: '10001' },
                { isGroupChat: false, preferGroupMemberName: false },
            ),
            '昵称',
        );
    });

    it('没有任何可读名时回退到 QQ 号，而不是 u_xxx uid', () => {
        const name = resolveReplySenderName(
            { memberName: '', remark: '', nickname: '', uin: '10001', uidStr: 'u_abcdef' },
            { isGroupChat: true, preferGroupMemberName: false },
        );
        assert.equal(name, '10001');
    });

    it('连 QQ 号都没有才回退到 uid 字符串', () => {
        const name = resolveReplySenderName(
            { uin: '', uidStr: 'u_abcdef' },
            { isGroupChat: false, preferGroupMemberName: false },
        );
        assert.equal(name, 'u_abcdef');
    });

    it('全部为空时返回空字符串，不抛异常', () => {
        assert.equal(resolveReplySenderName({}, { isGroupChat: true, preferGroupMemberName: true }), '');
    });

    it('两个人互相回复时，发件人按各自被引用消息解析，互不串味', () => {
        // 被引用消息来自 bytecategory，则即便是 gfwrev 发的回复，预览发件人也应是 bytecategory
        const referenced = resolveReplySenderName(
            { nickname: 'bytecategory', uin: '19031218', uidStr: 'u_byte' },
            { isGroupChat: true, preferGroupMemberName: false },
        );
        assert.equal(referenced, 'bytecategory');
        assert.notEqual(referenced, 'gfwrev');
    });
});
