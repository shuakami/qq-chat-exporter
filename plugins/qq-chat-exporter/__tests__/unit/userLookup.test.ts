import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupUserByUin } from '../../lib/api/userLookup.js';

function recorder() {
    const warns: Array<{ msg: string; err?: unknown }> = [];
    const debugs: Array<{ msg: string; err?: unknown }> = [];
    return {
        warns,
        debugs,
        logger: {
            logWarn: (msg: string, err?: unknown) => warns.push({ msg, err }),
            logDebug: (msg: string, err?: unknown) => debugs.push({ msg, err }),
        },
    };
}

test('userLookup: 非数字 uin 直接返回 found=false', async () => {
    const r = await lookupUserByUin('abc', { getUidByUinV2: async () => 'never' }, null);
    assert.equal(r.found, false);
    assert.match(r.reason || '', /4-12 位/);
});

test('userLookup: 太短 uin 直接返回 found=false', async () => {
    const r = await lookupUserByUin('123', { getUidByUinV2: async () => 'never' }, null);
    assert.equal(r.found, false);
});

test('userLookup: 太长 uin 直接返回 found=false', async () => {
    const r = await lookupUserByUin('1234567890123', null, null);
    assert.equal(r.found, false);
});

test('userLookup: 旧版 NapCat 缺 getUidByUinV2 时降级到 found=false（issue #353 回归）', async () => {
    const r = await lookupUserByUin('123456', {}, null);
    assert.equal(r.found, false);
    assert.match(r.reason || '', /getUidByUinV2/);
});

test('userLookup: getUidByUinV2 返回空时报「未找到」', async () => {
    const r = await lookupUserByUin('123456', { getUidByUinV2: async () => '' }, null);
    assert.equal(r.found, false);
    assert.match(r.reason || '', /未在本机/);
});

test('userLookup: getUidByUinV2 抛异常不上传，落到「未找到」', async () => {
    const rec = recorder();
    const r = await lookupUserByUin(
        '123456',
        { getUidByUinV2: async () => { throw new Error('boom'); } },
        null,
        rec.logger,
    );
    assert.equal(r.found, false);
    assert.equal(rec.warns.length, 1);
    assert.match(rec.warns[0]!.msg, /boom|抛异常/);
});

test('userLookup: 成功路径 — 返回 uid + nick + avatarUrl', async () => {
    const r = await lookupUserByUin(
        '10001',
        {
            getUidByUinV2: async (uin) => `u_${uin}`,
            getUserDetailInfo: async () => ({ nick: '张三', remark: '老张' }),
        },
        null,
    );
    assert.equal(r.found, true);
    assert.equal(r.uid, 'u_10001');
    assert.equal(r.nick, '张三');
    assert.equal(r.remark, '老张');
    assert.match(r.avatarUrl || '', /q1\.qlogo\.cn.*nk=10001/);
    assert.equal(r.isFriend, false);
});

test('userLookup: 成功路径但 getUserDetailInfo 失败时仍返回 found=true', async () => {
    const rec = recorder();
    const r = await lookupUserByUin(
        '10001',
        {
            getUidByUinV2: async () => 'u_10001',
            getUserDetailInfo: async () => { throw new Error('销号了'); },
        },
        null,
        rec.logger,
    );
    assert.equal(r.found, true);
    assert.equal(r.uid, 'u_10001');
    assert.equal(r.nick, undefined);
    assert.equal(rec.debugs.length, 1);
});

test('userLookup: 已加好友时 isFriend=true（按 uid 命中）', async () => {
    const r = await lookupUserByUin(
        '10001',
        { getUidByUinV2: async () => 'u_10001' },
        {
            getBuddyV2ExWithCate: async () => [
                { buddyList: [{ uid: 'u_10001', uin: '10001' }] },
            ],
        },
    );
    assert.equal(r.found, true);
    assert.equal(r.isFriend, true);
});

test('userLookup: 已加好友（嵌套 coreInfo 结构）isFriend=true', async () => {
    const r = await lookupUserByUin(
        '10001',
        { getUidByUinV2: async () => 'u_10001' },
        {
            getBuddyV2ExWithCate: async () => [
                { buddyList: [{ coreInfo: { uid: 'u_10001', uin: '10001' } }] },
            ],
        },
    );
    assert.equal(r.found, true);
    assert.equal(r.isFriend, true);
});

test('userLookup: 不在好友列表（销号 / 已删除）isFriend=false', async () => {
    const r = await lookupUserByUin(
        '10001',
        { getUidByUinV2: async () => 'u_10001' },
        {
            getBuddyV2ExWithCate: async () => [
                { buddyList: [{ uid: 'u_99999', uin: '99999' }] },
            ],
        },
    );
    assert.equal(r.found, true);
    assert.equal(r.isFriend, false);
});

test('userLookup: 好友列表读取失败不阻塞主流程', async () => {
    const rec = recorder();
    const r = await lookupUserByUin(
        '10001',
        { getUidByUinV2: async () => 'u_10001' },
        { getBuddyV2ExWithCate: async () => { throw new Error('网络抖动'); } },
        rec.logger,
    );
    assert.equal(r.found, true);
    assert.equal(r.uid, 'u_10001');
    assert.equal(r.isFriend, false);
    assert.equal(rec.debugs.length, 1);
});

test('userLookup: detail 走 simpleInfo.coreInfo 嵌套字段也能取到 nick', async () => {
    const r = await lookupUserByUin(
        '10001',
        {
            getUidByUinV2: async () => 'u_10001',
            getUserDetailInfo: async () => ({
                simpleInfo: { coreInfo: { nick: '小明', remark: '同事' } },
            }),
        },
        null,
    );
    assert.equal(r.found, true);
    assert.equal(r.nick, '小明');
    assert.equal(r.remark, '同事');
});
