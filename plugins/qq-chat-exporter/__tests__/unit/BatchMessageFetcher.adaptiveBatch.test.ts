import test from 'node:test';
import assert from 'node:assert/strict';

import { BatchMessageFetcher } from '../../lib/core/fetcher/BatchMessageFetcher.js';
import { ErrorType, SystemError } from '../../lib/types/index.js';
import { createMockCore } from '../helpers/MockNapCatCore.js';

/**
 * Issue #305 / #316：QQ NT 端在大批量条数下偶发慢，BatchMessageFetcher 的
 * Promise.race 会在 timeout 触发 TIMEOUT_ERROR。原本下次重试还用同样的 batchSize
 * 大概率再次超时。这里验证：
 *   - 每碰到一次超时，下一次重试前 batchSize 会折半；
 *   - 折半下限为 MIN_BATCH_SIZE_ON_TIMEOUT = 200；
 *   - 非超时类错误不会触发缩小；
 *   - 缩小到 200 之后再超时也不会继续往下减。
 *
 * 这里通过 `as any` 直接访问 `callWithRetry`，避免在测试里铺一整套 NapCat
 * MsgApi 的 happy/sad path mock。
 */

interface PrivateFetcher {
    config: { batchSize: number; timeout: number; retryCount: number; retryInterval: number };
    callWithRetry<T>(apiCall: () => Promise<T>): Promise<T>;
}

function makeFetcher(): PrivateFetcher {
    const core = createMockCore();
    const fetcher = new BatchMessageFetcher(core as any, {
        batchSize: 5000,
        // timeout 实际不参与逻辑，因为 apiCall 自己抛 SystemError；保留一个不会触发的 5s。
        timeout: 5000,
        retryCount: 3,
        retryInterval: 1,
    });
    return fetcher as unknown as PrivateFetcher;
}

function timeoutError(): SystemError {
    return new SystemError({
        type: ErrorType.TIMEOUT_ERROR,
        message: 'API调用超时 (mock)',
        timestamp: new Date(),
    });
}

function apiError(): SystemError {
    return new SystemError({
        type: ErrorType.API_ERROR,
        message: 'mock api error',
        timestamp: new Date(),
    });
}

test('TIMEOUT_ERROR 每次都会把下次重试的 batchSize 折半（不低于 200）', async () => {
    const fetcher = makeFetcher();
    assert.equal(fetcher.config.batchSize, 5000);

    const observedBatchSizes: number[] = [];
    await assert.rejects(
        fetcher.callWithRetry(async () => {
            observedBatchSizes.push(fetcher.config.batchSize);
            throw timeoutError();
        }),
        (err: unknown) => err instanceof SystemError && err.type === ErrorType.TIMEOUT_ERROR,
    );

    // retryCount=3 表示总共 4 次尝试。前 3 次失败后会缩小，第 4 次失败后直接 break。
    // 5000 -> 2500 -> 1250 -> 625，最终一次尝试用 625。
    assert.deepEqual(observedBatchSizes, [5000, 2500, 1250, 625]);
    assert.equal(fetcher.config.batchSize, 625);
});

test('非超时类错误不会触发自适应缩小', async () => {
    const fetcher = makeFetcher();
    const observedBatchSizes: number[] = [];

    await assert.rejects(
        fetcher.callWithRetry(async () => {
            observedBatchSizes.push(fetcher.config.batchSize);
            throw apiError();
        }),
        (err: unknown) => err instanceof SystemError && err.type === ErrorType.API_ERROR,
    );

    assert.deepEqual(observedBatchSizes, [5000, 5000, 5000, 5000]);
    assert.equal(fetcher.config.batchSize, 5000);
});

test('batchSize 已经接近下限时不会跌破 200', async () => {
    const fetcher = makeFetcher();
    fetcher.config.batchSize = 250;

    const observedBatchSizes: number[] = [];
    await assert.rejects(
        fetcher.callWithRetry(async () => {
            observedBatchSizes.push(fetcher.config.batchSize);
            throw timeoutError();
        }),
        (err: unknown) => err instanceof SystemError && err.type === ErrorType.TIMEOUT_ERROR,
    );

    // 250 -> 200（floor）-> 200（已到下限不再缩）-> 200。
    assert.deepEqual(observedBatchSizes, [250, 200, 200, 200]);
    assert.equal(fetcher.config.batchSize, 200);
});

test('文本里带 timeout / API调用超时 也会按超时识别', async () => {
    const fetcher = makeFetcher();
    fetcher.config.batchSize = 1000;

    await assert.rejects(
        fetcher.callWithRetry(async () => {
            throw new Error('underlying socket timeout');
        }),
    );

    // 1000 -> 500 -> 250 -> 200（不会跌破下限）。
    assert.equal(fetcher.config.batchSize, 200);
});

test('成功调用不会再次改动 batchSize', async () => {
    const fetcher = makeFetcher();
    let attempts = 0;
    const result = await fetcher.callWithRetry(async () => {
        attempts++;
        return 'ok';
    });

    assert.equal(result, 'ok');
    assert.equal(attempts, 1);
    assert.equal(fetcher.config.batchSize, 5000);
});
