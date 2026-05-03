import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGroupSystemNotify } from '../../lib/api/groupSystemNotify.js';

test('groupSystemNotify: 把 OneBot get_group_system_msg 输出拍平成 camelCase', () => {
    const raw = {
        join_requests: [
            {
                request_id: 100001,
                invitor_uin: 10000,
                invitor_nick: '申请人',
                requester_nick: '申请人',
                group_id: 123456,
                group_name: '测试群',
                message: '我是xxx',
                checked: false,
                actor: 0,
            },
        ],
        invited_requests: [
            {
                request_id: 100002,
                invitor_uin: 20000,
                invitor_nick: '被邀人',
                requester_nick: '被邀人',
                group_id: 123456,
                group_name: '测试群',
                message: '',
                checked: true,
                actor: 30000,
            },
        ],
        InvitedRequest: [],
    };

    const result = normalizeGroupSystemNotify(raw);

    assert.equal(result.totalCount, 2);
    assert.equal(result.joinRequests.length, 1);
    assert.equal(result.invitedRequests.length, 1);

    const join = result.joinRequests[0]!;
    assert.equal(join.requestId, 100001);
    assert.equal(join.kind, 'join');
    assert.equal(join.groupId, '123456');
    assert.equal(join.groupName, '测试群');
    assert.equal(join.requesterUin, 10000);
    assert.equal(join.requesterNick, '申请人');
    assert.equal(join.message, '我是xxx');
    assert.equal(join.checked, false);

    const invited = result.invitedRequests[0]!;
    assert.equal(invited.requestId, 100002);
    assert.equal(invited.kind, 'invited');
    assert.equal(invited.actorUin, 30000);
    assert.equal(invited.checked, true);
});

test('groupSystemNotify: 没有 join_requests 字段时返回空数组', () => {
    const result = normalizeGroupSystemNotify({});
    assert.deepEqual(result, { joinRequests: [], invitedRequests: [], totalCount: 0 });
});

test('groupSystemNotify: 完全无效的输入（null / 字符串 / undefined）安全降级', () => {
    for (const raw of [null, undefined, '', 0, 'foo', 42, []] as const) {
        const result = normalizeGroupSystemNotify(raw as unknown);
        assert.equal(result.totalCount, 0);
        assert.equal(result.joinRequests.length, 0);
        assert.equal(result.invitedRequests.length, 0);
    }
});

test('groupSystemNotify: invited_requests 缺失时回退用 InvitedRequest（驼峰兼容）', () => {
    const raw = {
        InvitedRequest: [
            {
                request_id: 200001,
                group_id: '789012',
                group_name: '另一个群',
                invitor_uin: '40000',
                invitor_nick: '邀请人',
            },
        ],
    };
    const result = normalizeGroupSystemNotify(raw);
    assert.equal(result.invitedRequests.length, 1);
    assert.equal(result.invitedRequests[0]!.requestId, 200001);
    assert.equal(result.invitedRequests[0]!.groupId, '789012');
    assert.equal(result.invitedRequests[0]!.invitorUin, 40000);
});

test('groupSystemNotify: 同时有 invited_requests 和 InvitedRequest 时只取 invited_requests，不重复', () => {
    const raw = {
        invited_requests: [
            { request_id: 1, group_id: 1, invitor_uin: 1 },
        ],
        InvitedRequest: [
            { request_id: 1, group_id: 1, invitor_uin: 1 },
        ],
    };
    const result = normalizeGroupSystemNotify(raw);
    assert.equal(result.invitedRequests.length, 1);
});

test('groupSystemNotify: string / number 字段都能正确转换', () => {
    const raw = {
        join_requests: [
            {
                request_id: '300001',
                invitor_uin: '50000',
                group_id: 999000,
                group_name: 'mixed types',
                checked: 'true', // 不是真 true
            },
        ],
    };
    const result = normalizeGroupSystemNotify(raw);
    assert.equal(result.joinRequests[0]!.requestId, 300001);
    assert.equal(result.joinRequests[0]!.requesterUin, 50000);
    assert.equal(result.joinRequests[0]!.groupId, '999000');
    // checked 必须是严格 boolean true 才算已处理
    assert.equal(result.joinRequests[0]!.checked, false);
});

test('groupSystemNotify: 字段类型异常不抛错（防御 NapCat 升级）', () => {
    const raw = {
        join_requests: [
            { request_id: NaN, invitor_uin: undefined, group_id: null, message: 42 },
            { request_id: Infinity, group_id: { weird: 'object' } },
        ],
    };
    const result = normalizeGroupSystemNotify(raw);
    assert.equal(result.joinRequests.length, 2);
    // 异常数字降级为 0
    assert.equal(result.joinRequests[0]!.requestId, 0);
    assert.equal(result.joinRequests[0]!.requesterUin, 0);
    // null / object 降级为空字符串
    assert.equal(result.joinRequests[0]!.groupId, '');
    assert.equal(result.joinRequests[1]!.groupId, '');
    // number message 转成字符串
    assert.equal(result.joinRequests[0]!.message, '42');
});
