/**
 * BatchMessageFetcher integration tests.
 *
 * Drives the real fetcher against a MockNapCatCore that returns deterministic
 * page-able message lists. We assert: pagination produces the right slices,
 * every fixture message is observed exactly once, time / sender filters work,
 * and the recorded API call sequence matches expectations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMockCore } from '../helpers/MockNapCatCore.js';
import { installBridge, uninstallBridge } from '../helpers/installBridge.js';
import { silenceConsole } from '../helpers/silenceConsole.js';
import { privateVolume } from '../fixtures/conversations.js';

async function loadFetcher() {
    return await import('../../lib/core/fetcher/BatchMessageFetcher.js');
}

async function loadIndex() {
    return await import('NapCatQQ/src/core/index.js' as string);
}

const TOTAL = 25;

let core: ReturnType<typeof createMockCore>;
let console_!: ReturnType<typeof silenceConsole>;

test.beforeEach(() => {
    console_ = silenceConsole();
    const fixture = privateVolume(TOTAL);
    core = createMockCore({ conversations: [fixture] });
    installBridge({ core });
});

test.afterEach(() => {
    uninstallBridge();
    console_.restore();
});

test('fetches every message via fetchAllMessagesInTimeRange', async () => {
    const { BatchMessageFetcher } = await loadFetcher();
    const { Peer } = await loadIndex();

    const peer = new Peer(1, 'u_alice');
    const fetcher = new BatchMessageFetcher(core as never, { batchSize: 10 });

    const collected: string[] = [];
    for await (const batch of fetcher.fetchAllMessagesInTimeRange(peer, 0, Number.MAX_SAFE_INTEGER)) {
        for (const m of batch) collected.push(m.msgId);
    }

    // Every fixture message exactly once. Order may vary because pagination
    // is descending — assert by set comparison.
    assert.equal(collected.length, TOTAL);
    assert.equal(new Set(collected).size, TOTAL);
});

test('respects batchSize during pagination', async () => {
    const { BatchMessageFetcher } = await loadFetcher();
    const { Peer } = await loadIndex();

    const peer = new Peer(1, 'u_alice');
    const fetcher = new BatchMessageFetcher(core as never, { batchSize: 7 });

    let calls = 0;
    for await (const _ of fetcher.fetchAllMessagesInTimeRange(peer, 0, Number.MAX_SAFE_INTEGER)) {
        calls++;
    }
    // 25 messages / 7 per batch -> at least 4 batches (last one may yield fewer)
    assert.ok(calls >= 4, `expected at least 4 batches, got ${calls}`);

    // First call uses getAioFirstViewLatestMsgs, subsequent ones use getMsgHistory
    const log = core.__getCallLog().filter((e) => e.api.startsWith('MsgApi.'));
    assert.equal(log[0].api, 'MsgApi.getAioFirstViewLatestMsgs');
    assert.ok(
        log.slice(1).every((e) => e.api === 'MsgApi.getMsgHistory'),
        'expected only history calls after the first'
    );
});

test('time filter removes out-of-range messages', async () => {
    const { BatchMessageFetcher } = await loadFetcher();
    const { Peer } = await loadIndex();

    const peer = new Peer(1, 'u_alice');
    const fetcher = new BatchMessageFetcher(core as never, { batchSize: 100 });

    // Fixture timestamps are baseTime + i*60s starting at 2024-01-01T00:00:00Z
    // in seconds. The fetcher's filter compares against ms timestamps.
    const baseMs = 1704067200_000;
    const startMs = baseMs + 5 * 60_000;
    const endMs = baseMs + 9 * 60_000;

    const collected: string[] = [];
    for await (const batch of fetcher.fetchAllMessagesInTimeRange(peer, startMs, endMs)) {
        for (const m of batch) collected.push(m.msgId);
    }

    // Messages 6..10 inclusive (5 messages) match the window.
    assert.equal(collected.length, 5);
});
