/**
 * Issue #445: 一键执行所有定时（自动）导出任务。
 *
 * 验证 triggerAllScheduledExports：
 *   1. 默认只触发已启用的任务，跳过未启用的；
 *   2. includeDisabled=true 时连同未启用任务一起触发；
 *   3. 立即返回被排入执行的任务列表，实际执行在后台串行进行；
 *   4. 单个任务执行抛错不影响其余任务。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ScheduledExportManager, ScheduledExportConfig } from '../../lib/core/scheduler/ScheduledExportManager.js';

function makeTask(id: string, enabled: boolean): ScheduledExportConfig {
    const now = new Date();
    return {
        id,
        name: `任务-${id}`,
        peer: { chatType: 2, peerUid: id, guildId: '' },
        scheduleType: 'daily',
        executeTime: '08:00',
        timeRangeType: 'yesterday',
        format: 'JSON',
        options: {},
        enabled,
        createdAt: now,
        updatedAt: now
    } as ScheduledExportConfig;
}

function newManager(): ScheduledExportManager {
    return new ScheduledExportManager({} as any, {} as any, {} as any);
}

const flush = () => new Promise((r) => setTimeout(r, 20));

test('triggerAllScheduledExports only triggers enabled tasks by default (#445)', async () => {
    const mgr = newManager();
    const executed: string[] = [];
    (mgr as any).executeExportTask = async (task: ScheduledExportConfig) => {
        executed.push(task.id);
        return { id: 'h', scheduledExportId: task.id, executedAt: new Date(), status: 'success', duration: 1 };
    };
    (mgr as any).scheduledTasks = new Map([
        ['a', makeTask('a', true)],
        ['b', makeTask('b', false)],
        ['c', makeTask('c', true)]
    ]);

    const triggered = mgr.triggerAllScheduledExports();
    assert.deepEqual(triggered.map((t) => t.id).sort(), ['a', 'c']);
    assert.deepEqual(triggered.find((t) => t.id === 'a')?.name, '任务-a');

    await flush();
    assert.deepEqual(executed.sort(), ['a', 'c'], 'only enabled tasks should be executed');
});

test('triggerAllScheduledExports includes disabled tasks when requested (#445)', async () => {
    const mgr = newManager();
    const executed: string[] = [];
    (mgr as any).executeExportTask = async (task: ScheduledExportConfig) => {
        executed.push(task.id);
        return { id: 'h', scheduledExportId: task.id, executedAt: new Date(), status: 'success', duration: 1 };
    };
    (mgr as any).scheduledTasks = new Map([
        ['a', makeTask('a', true)],
        ['b', makeTask('b', false)]
    ]);

    const triggered = mgr.triggerAllScheduledExports({ includeDisabled: true });
    assert.deepEqual(triggered.map((t) => t.id).sort(), ['a', 'b']);

    await flush();
    assert.deepEqual(executed.sort(), ['a', 'b']);
});

test('a failing task does not abort the rest of the queue (#445)', async () => {
    const mgr = newManager();
    const executed: string[] = [];
    (mgr as any).executeExportTask = async (task: ScheduledExportConfig) => {
        executed.push(task.id);
        if (task.id === 'a') throw new Error('boom');
        return { id: 'h', scheduledExportId: task.id, executedAt: new Date(), status: 'success', duration: 1 };
    };
    (mgr as any).scheduledTasks = new Map([
        ['a', makeTask('a', true)],
        ['b', makeTask('b', true)]
    ]);

    const triggered = mgr.triggerAllScheduledExports();
    assert.equal(triggered.length, 2);

    await flush();
    assert.deepEqual(executed.sort(), ['a', 'b'], 'both tasks should run even if the first throws');
});
