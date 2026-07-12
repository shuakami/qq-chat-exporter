import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import {
    bridgeJsonReplacer,
    createNapCatBridge
} from '../../runtime/rustBridge.mjs';

async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return address.port;
}

test('bridge JSON preserves nested Map, Set and bigint values', () => {
    const serialized = JSON.stringify({
        infos: new Map([['u_1', { uin: 10001n }]]),
        roles: new Set(['owner', 'admin'])
    }, bridgeJsonReplacer);
    assert.deepEqual(JSON.parse(serialized), {
        infos: { u_1: { uin: '10001' } },
        roles: ['owner', 'admin']
    });
});

test('bridge exposes raw NapCat services with the original arguments', async () => {
    const calls: unknown[][] = [];
    const groupCalls: unknown[][] = [];
    const core = {
        context: {
            session: {
                getMsgService: () => ({
                    fetchFavEmojiList: async (...args: unknown[]) => {
                        calls.push(args);
                        return {
                            emojiInfoList: new Map([
                                ['emoji_1', { eId: 'emoji_1', emoId: 1 }]
                            ])
                        };
                    }
                }),
                getGroupService: () => ({
                    getAllMemberList: async (...args: unknown[]) => {
                        groupCalls.push(args);
                        return {
                            result: {
                                infos: new Map([
                                    ['u_1', { uin: '10001', nick: 'one' }]
                                ])
                            }
                        };
                    }
                })
            }
        },
        apis: {}
    };
    const port = await freePort();
    const bridge = await createNapCatBridge(core, port);
    try {
        const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'MsgService.fetchFavEmojiList',
                params: ['', 1000, true, true]
            })
        });
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.deepEqual(calls, [['', 1000, true, true]]);
        assert.deepEqual(body.result.emojiInfoList, {
            emoji_1: { eId: 'emoji_1', emoId: 1 }
        });

        const groupResponse = await fetch(`http://127.0.0.1:${port}/rpc`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'GroupService.getAllMemberList',
                params: ['960420904', true]
            })
        });
        const groupBody = await groupResponse.json();
        assert.equal(groupBody.ok, true);
        assert.deepEqual(groupCalls, [['960420904', true]]);
        assert.deepEqual(groupBody.result.result.infos, {
            u_1: { uin: '10001', nick: 'one' }
        });
    } finally {
        await bridge.stop();
    }
});
