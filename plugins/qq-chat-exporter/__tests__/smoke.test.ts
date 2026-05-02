/**
 * Smoke test - the cheapest possible check that the test harness wires up.
 *
 * Run with `npm test` from inside `plugins/qq-chat-exporter/`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMockCore } from './helpers/MockNapCatCore.js';
import { installBridge, uninstallBridge } from './helpers/installBridge.js';
import { conversation, msg, privatePeer } from './fixtures/builders.js';

test('bridge install/uninstall roundtrip', async () => {
    const core = createMockCore();
    installBridge({ core });
    assert.equal(globalThis.__NAPCAT_BRIDGE__?.core, core);
    uninstallBridge();
    assert.equal(globalThis.__NAPCAT_BRIDGE__, undefined);
});

test('overlay MsgApi proxies through to mock core', async () => {
    const fixture = conversation(privatePeer('u_alice'))
        .add(msg().sender({ uid: 'u_alice' }).text('hi').build())
        .add(msg().sender({ uid: 'u_alice' }).text('there').build())
        .build();

    const core = createMockCore({ conversations: [fixture] });
    installBridge({ core });
    try {
        const overlay = await import('NapCatQQ/src/core/apis/msg.js' as string);
        const result = await overlay.MsgApi.getAioFirstViewLatestMsgs(fixture.peer, 10);
        assert.equal(result.msgList.length, 2);
        assert.equal(result.msgList[0].msgId, fixture.messages[1].msgId);
    } finally {
        uninstallBridge();
    }
});
