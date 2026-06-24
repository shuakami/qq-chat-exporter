/**
 * Issue #446: 导出任务需要能被「停止」。BatchMessageFetcher 暴露 cancel() / isCancelled()，
 * 分页抓取在每批之间检查取消标记并提前结束；同时确认取消标记不会被下一批次清掉，
 * 且新一轮抓取会从未取消状态重新开始。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BatchMessageFetcher } from '../../lib/core/fetcher/BatchMessageFetcher.js';
import { createMockCore } from '../helpers/MockNapCatCore.js';

function makeFetcher(): BatchMessageFetcher {
    const core = createMockCore();
    return new BatchMessageFetcher(core as any, { batchSize: 100, timeout: 5000, retryCount: 0, retryInterval: 1 });
}

const peer: any = { chatType: 2, peerUid: '10001', guildId: '' };

/** 让 fetchMessages 永远返回一条消息且 hasMore=true，模拟一个抓不完的大群。 */
function stubInfinite(fetcher: BatchMessageFetcher): () => number {
    let produced = 0;
    (fetcher as any).fetchMessages = async () => {
        produced++;
        return {
            messages: [{ msgId: String(produced), msgTime: '1700000000' }],
            hasMore: true,
            actualCount: 1,
            fetchTime: 1,
        };
    };
    return () => produced;
}

test('cancel() / isCancelled() reflect cancellation state (#446)', () => {
    const fetcher = makeFetcher();
    assert.equal(fetcher.isCancelled(), false);
    fetcher.cancel();
    assert.equal(fetcher.isCancelled(), true);
});

test('fetchAllMessagesInTimeRange stops after cancel() (#446)', async () => {
    const fetcher = makeFetcher();
    stubInfinite(fetcher);

    let received = 0;
    for await (const batch of fetcher.fetchAllMessagesInTimeRange(peer, 0, Date.now())) {
        received += batch.length;
        if (received === 2) {
            fetcher.cancel();
        }
        if (received >= 50) break; // 安全阀：取消若失效则在这里兜底
    }

    assert.equal(fetcher.isCancelled(), true);
    assert.ok(received < 50, `取消后抓取应尽快停止，实际收到 ${received} 批`);
    assert.equal(received, 2, '取消应在当前批次结束后立即停止后续抓取');
});

test('a fresh fetch resets cancellation so prior cancel does not block it (#446)', async () => {
    const fetcher = makeFetcher();
    stubInfinite(fetcher);

    // 先取消一次。
    fetcher.cancel();
    assert.equal(fetcher.isCancelled(), true);

    // 新一轮抓取应从未取消状态开始，至少能产出一批。
    let received = 0;
    for await (const batch of fetcher.fetchAllMessagesInTimeRange(peer, 0, Date.now())) {
        received += batch.length;
        fetcher.cancel();
        if (received >= 50) break;
    }
    assert.ok(received >= 1, '新一轮抓取不应被上一轮的取消标记直接挡死');
    assert.ok(received < 50, '随后再次取消仍应能停止');
});
