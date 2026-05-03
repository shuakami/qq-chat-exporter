import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionName } from '../../lib/api/sessionNameResolver.js';

const FRIEND = 1;
const GROUP = 2;
const TEMP = 100;
const SERVICE = 118;

const FAST = { timeoutMs: 200 };

test('sessionNameResolver: 群聊优先 GroupApi.getGroups', async () => {
    const name = await resolveSessionName(
        { chatType: GROUP, peerUid: '8888' },
        {
            GroupApi: {
                getGroups: async () => [
                    { groupCode: '8888', groupName: '测试群' },
                    { groupCode: '7777', groupName: '别的群' },
                ],
            },
        },
        FAST,
    );
    assert.equal(name, '测试群');
});

test('sessionNameResolver: 群聊找不到时兜底为「群聊 <peerUid>」', async () => {
    const name = await resolveSessionName(
        { chatType: GROUP, peerUid: '8888' },
        { GroupApi: { getGroups: async () => [] } },
        FAST,
    );
    assert.equal(name, '群聊 8888');
});

test('sessionNameResolver: 群聊 GroupApi 抛异常也兜底为「群聊 <peerUid>」', async () => {
    const name = await resolveSessionName(
        { chatType: GROUP, peerUid: '8888' },
        {
            GroupApi: {
                getGroups: async () => {
                    throw new Error('rpc broken');
                },
            },
        },
        FAST,
    );
    assert.equal(name, '群聊 8888');
});

test('sessionNameResolver: 好友优先 FriendApi.getBuddy', async () => {
    const name = await resolveSessionName(
        { chatType: FRIEND, peerUid: 'u_abc' },
        {
            FriendApi: {
                getBuddy: async () => [
                    { coreInfo: { uid: 'u_abc', remark: '老王', nick: 'wang' } },
                ],
            },
        },
        FAST,
    );
    assert.equal(name, '老王');
});

test('sessionNameResolver: 好友 remark 缺失时回退到 nick', async () => {
    const name = await resolveSessionName(
        { chatType: FRIEND, peerUid: 'u_abc' },
        {
            FriendApi: {
                getBuddy: async () => [
                    { coreInfo: { uid: 'u_abc', nick: 'wang' } },
                ],
            },
        },
        FAST,
    );
    assert.equal(name, 'wang');
});

test('sessionNameResolver: 临时会话 (chatType=100) 找不到好友时再试 UserApi.getUserDetailInfo', async () => {
    let detailCalled = 0;
    const name = await resolveSessionName(
        { chatType: TEMP, peerUid: 'u_temp' },
        {
            FriendApi: { getBuddy: async () => [] },
            UserApi: {
                getUserDetailInfo: async (uid: string) => {
                    detailCalled++;
                    assert.equal(uid, 'u_temp');
                    return { nick: '陌生人小明' };
                },
            },
        },
        FAST,
    );
    assert.equal(name, '陌生人小明');
    assert.equal(detailCalled, 1);
});

test('sessionNameResolver: 服务号 (chatType=118) 也走 UserApi 兜底', async () => {
    const name = await resolveSessionName(
        { chatType: SERVICE, peerUid: 'u_service' },
        {
            FriendApi: { getBuddy: async () => [] },
            UserApi: {
                getUserDetailInfo: async () => ({
                    simpleInfo: { coreInfo: { remark: 'QQ官方', nick: 'QQ' } },
                }),
            },
        },
        FAST,
    );
    assert.equal(name, 'QQ官方');
});

test('sessionNameResolver: 全部失败时返回 fallback (默认 peer.peerUid)', async () => {
    const name = await resolveSessionName(
        { chatType: TEMP, peerUid: 'u_unknown' },
        {
            FriendApi: { getBuddy: async () => [] },
            UserApi: { getUserDetailInfo: async () => null },
        },
        FAST,
    );
    assert.equal(name, 'u_unknown');
});

test('sessionNameResolver: apis 整体为 undefined / null 也安全降级', async () => {
    const a = await resolveSessionName(
        { chatType: FRIEND, peerUid: 'u_x' },
        undefined,
        FAST,
    );
    assert.equal(a, 'u_x');

    const b = await resolveSessionName(
        { chatType: GROUP, peerUid: '999' },
        null,
        FAST,
    );
    assert.equal(b, '群聊 999');
});

test('sessionNameResolver: 单聊 FriendApi 抛异常时仍能继续走 UserApi', async () => {
    const name = await resolveSessionName(
        { chatType: TEMP, peerUid: 'u_t' },
        {
            FriendApi: {
                getBuddy: async () => {
                    throw new Error('boom');
                },
            },
            UserApi: { getUserDetailInfo: async () => ({ nick: '小红' }) },
        },
        FAST,
    );
    assert.equal(name, '小红');
});

test('sessionNameResolver: 整体超时时返回 fallback', async () => {
    const name = await resolveSessionName(
        { chatType: FRIEND, peerUid: 'u_slow' },
        {
            FriendApi: {
                getBuddy: () =>
                    new Promise((r) => setTimeout(() => r([]), 1000)),
            },
        },
        { timeoutMs: 50 },
    );
    assert.equal(name, 'u_slow');
});
