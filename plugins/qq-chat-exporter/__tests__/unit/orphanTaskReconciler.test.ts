import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reconcileOrphanedTask,
    buildTaskResyncPayload,
    ORPHAN_TASK_ERROR_MESSAGE,
} from '../../lib/api/orphanTaskReconciler.js';

test('reconcileOrphanedTask: running -> failed 并填默认 error', () => {
    const r = reconcileOrphanedTask({ status: 'running' });
    assert.equal(r.status, 'failed');
    assert.equal(r.wasOrphan, true);
    assert.equal(r.error, ORPHAN_TASK_ERROR_MESSAGE);
});

test('reconcileOrphanedTask: pending 也按孤儿处理', () => {
    const r = reconcileOrphanedTask({ status: 'pending' });
    assert.equal(r.status, 'failed');
    assert.equal(r.wasOrphan, true);
    assert.equal(r.error, ORPHAN_TASK_ERROR_MESSAGE);
});

test('reconcileOrphanedTask: 已经写过自定义 error 的 running 任务，error 保留', () => {
    const r = reconcileOrphanedTask({ status: 'running', error: '上次中断的具体原因' });
    assert.equal(r.status, 'failed');
    assert.equal(r.wasOrphan, true);
    assert.equal(r.error, '上次中断的具体原因');
});

test('reconcileOrphanedTask: completed / failed / paused / cancelled 全部保留原状', () => {
    for (const s of ['completed', 'failed', 'paused', 'cancelled']) {
        const r = reconcileOrphanedTask({ status: s });
        assert.equal(r.status, s);
        assert.equal(r.wasOrphan, false);
    }
});

test('reconcileOrphanedTask: 未知状态值不动它', () => {
    const r = reconcileOrphanedTask({ status: 'archived' });
    assert.equal(r.status, 'archived');
    assert.equal(r.wasOrphan, false);
});

test('buildTaskResyncPayload: 标准字段正常映射', () => {
    const out = buildTaskResyncPayload([
        {
            taskId: 'a',
            status: 'running',
            progress: 42,
            messageCount: 1234,
        },
        {
            taskId: 'b',
            status: 'completed',
            progress: 100,
            messageCount: 9999,
            error: undefined,
        },
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
        taskId: 'a',
        status: 'running',
        progress: 42,
        messageCount: 1234,
        error: undefined,
    });
    assert.equal(out[1].taskId, 'b');
    assert.equal(out[1].status, 'completed');
});

test('buildTaskResyncPayload: 缺 taskId / 非 string 直接丢弃', () => {
    const out = buildTaskResyncPayload([
        { taskId: '', status: 'running', progress: 0, messageCount: 0 } as any,
        { status: 'running', progress: 0, messageCount: 0 } as any,
        { taskId: 123 as any, status: 'running', progress: 0, messageCount: 0 } as any,
        { taskId: 'ok', status: 'running', progress: 0, messageCount: 0 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].taskId, 'ok');
});

test('buildTaskResyncPayload: 非数字 progress / messageCount 兜底为 0', () => {
    const out = buildTaskResyncPayload([
        {
            taskId: 'x',
            status: 'running',
            progress: NaN as any,
            messageCount: 'abc' as any,
        },
    ]);
    assert.equal(out[0].progress, 0);
    assert.equal(out[0].messageCount, 0);
});

test('buildTaskResyncPayload: 空数组返回空数组', () => {
    assert.deepEqual(buildTaskResyncPayload([]), []);
});

test('buildTaskResyncPayload: error 空字符串视为没 error', () => {
    const out = buildTaskResyncPayload([
        { taskId: 'x', status: 'failed', progress: 0, messageCount: 0, error: '' },
    ]);
    assert.equal(out[0].error, undefined);
});
