import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResourceSummaryMessage } from '../../lib/utils/resourceSummary.js';

/**
 * Issue #363 — 资源摘要文案契约测试。
 *
 * 这条文案会直接出现在任务完成消息里，所以约束几个稳定属性：
 *   1. 没资源时返回 null（不在 UI 上多嘴）；
 *   2. 全部成功时只给数字，不带 Rkey / 重试这种容易吓到人的解释；
 *   3. 有失败时一定带：本次数字、Rkey 解释、重试指引。
 */

test('attempted=0 时返回 null', () => {
    assert.equal(buildResourceSummaryMessage(null), null);
    assert.equal(buildResourceSummaryMessage(undefined), null);
    assert.equal(
        buildResourceSummaryMessage({
            attempted: 0,
            alreadyAvailable: 0,
            downloaded: 0,
            failed: 0,
            skipped: 0,
            failedSamples: [],
        }),
        null,
    );
});

test('全部成功时只展示比例，不出现 Rkey / 重试', () => {
    const msg = buildResourceSummaryMessage({
        attempted: 10,
        alreadyAvailable: 4,
        downloaded: 6,
        failed: 0,
        skipped: 0,
        failedSamples: [],
    });
    assert.ok(msg);
    assert.match(msg!, /资源 10\/10/);
    assert.doesNotMatch(msg!, /Rkey/);
    assert.doesNotMatch(msg!, /重试/);
});

test('包含失败时同时给出数字、Rkey 解释和重试建议', () => {
    const msg = buildResourceSummaryMessage({
        attempted: 12,
        alreadyAvailable: 3,
        downloaded: 5,
        failed: 4,
        skipped: 0,
        failedSamples: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
    });
    assert.ok(msg);
    // 用户最先想看到的：本次到底有几个没下到
    assert.match(msg!, /失败 4/);
    // 含部分样本（前 3 条 + 等）
    assert.match(msg!, /a\.jpg/);
    assert.match(msg!, /b\.jpg/);
    assert.match(msg!, /c\.jpg/);
    assert.doesNotMatch(msg!, /d\.jpg/, '只展示前 3 个样本');
    assert.match(msg!, / 等/);
    // 必备的解释和指引
    assert.match(msg!, /Rkey/);
    assert.match(msg!, /重试|点开/);
});

test('skipped 计数与失败计数互不干扰', () => {
    const onlySkipped = buildResourceSummaryMessage({
        attempted: 5,
        alreadyAvailable: 0,
        downloaded: 0,
        failed: 0,
        skipped: 5,
        failedSamples: [],
    });
    assert.ok(onlySkipped);
    assert.match(onlySkipped!, /跳过 5/);
    assert.doesNotMatch(onlySkipped!, /失败/);
    assert.doesNotMatch(onlySkipped!, /Rkey/);

    const skippedAndFailed = buildResourceSummaryMessage({
        attempted: 8,
        alreadyAvailable: 1,
        downloaded: 1,
        failed: 4,
        skipped: 2,
        failedSamples: ['x'],
    });
    assert.ok(skippedAndFailed);
    assert.match(skippedAndFailed!, /跳过 2/);
    assert.match(skippedAndFailed!, /失败 4/);
    assert.match(skippedAndFailed!, /Rkey/);
});

test('失败 ≤ 3 条时不出现「等」字', () => {
    const msg = buildResourceSummaryMessage({
        attempted: 5,
        alreadyAvailable: 1,
        downloaded: 1,
        failed: 3,
        skipped: 0,
        failedSamples: ['p1.png', 'p2.png', 'p3.png'],
    });
    assert.ok(msg);
    assert.match(msg!, /p1\.png/);
    assert.match(msg!, /p2\.png/);
    assert.match(msg!, /p3\.png/);
    // 只有 3 条样本，不应缀「等」
    const segment = msg!.match(/含 [^）]+/)![0];
    assert.doesNotMatch(segment, / 等/, segment);
});
