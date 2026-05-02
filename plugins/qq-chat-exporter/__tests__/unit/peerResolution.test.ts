import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeerUid } from '../../lib/api/peerResolution.js';

const PRIVATE = 1;
const GROUP = 2;

function recorder() {
    const lines: string[] = [];
    return { log: (msg: string) => lines.push(msg), lines };
}

test('peerResolution: 群聊直接返回 peerUid', async () => {
    const log = recorder();
    const out = await resolvePeerUid(
        { chatType: GROUP, peerUid: '12345' },
        { getUidByUinV2: async () => 'never' },
        log,
    );
    assert.equal(out, '12345');
    assert.equal(log.lines.length, 0);
});

test('peerResolution: peerUid 非纯数字直接返回原值', async () => {
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: 'u_AbCd123' },
        { getUidByUinV2: async () => 'never' },
    );
    assert.equal(out, 'u_AbCd123');
});

test('peerResolution: getUidByUinV2 返回有效 uid 时使用新值', async () => {
    const log = recorder();
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: '10001' },
        { getUidByUinV2: async (uin: string) => `u_${uin}_uid` },
        log,
    );
    assert.equal(out, 'u_10001_uid');
    assert.match(log.lines[0]!, /10001/);
});

test('peerResolution: getUidByUinV2 返回空字符串时降级到原 peerUid', async () => {
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: '10001' },
        { getUidByUinV2: async () => '' },
    );
    assert.equal(out, '10001');
});

test('peerResolution: getUidByUinV2 缺失时降级到原 peerUid（issue #353 回归）', async () => {
    const log = recorder();
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: '10001' },
        // 旧版 NapCat 上 UserApi 上根本没有 getUidByUinV2
        {},
        log,
    );
    assert.equal(out, '10001');
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0]!, /\u4e0d\u53ef\u7528/);
});

test('peerResolution: userApi 整体为 undefined 时降级到原 peerUid', async () => {
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: '10001' },
        undefined,
    );
    assert.equal(out, '10001');
});

test('peerResolution: getUidByUinV2 抛异常时不向上抛，降级到原 peerUid', async () => {
    const log = recorder();
    const out = await resolvePeerUid(
        { chatType: PRIVATE, peerUid: '10001' },
        {
            getUidByUinV2: async () => {
                throw new Error('boom');
            },
        },
        log,
    );
    assert.equal(out, '10001');
    assert.match(log.lines[0]!, /boom/);
});
