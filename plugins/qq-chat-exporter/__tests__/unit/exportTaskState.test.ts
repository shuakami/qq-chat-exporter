import test from "node:test"
import assert from "node:assert/strict"

import {
    mergeExportTaskUpdate,
    mergeRemoteExportTasks,
} from "../../../../qce-v4-tool/lib/export-task-state.js"
import type { ExportTask } from "../../../../qce-v4-tool/types/api.js"

function task(status: ExportTask["status"], progress = 50): ExportTask {
    return {
        id: "task-1",
        peer: { chatType: 2, peerUid: "group-1", guildId: "" },
        sessionName: "测试群",
        status,
        progress,
        format: "HTML",
        createdAt: "2026-07-13T00:00:00.000Z",
    }
}

test("cancelled task ignores late running and completed progress", () => {
    const cancelled = task("cancelled")
    assert.equal(
        mergeExportTaskUpdate(cancelled, {
            taskId: cancelled.id,
            progress: 80,
            status: "running",
        }),
        cancelled,
    )
    assert.equal(
        mergeExportTaskUpdate(cancelled, {
            taskId: cancelled.id,
            progress: 100,
            status: "completed",
        }),
        cancelled,
    )
})

test("stale polling response cannot revive a locally cancelled task", () => {
    const cancelled = task("cancelled")
    const merged = mergeRemoteExportTasks(
        [cancelled],
        [{ ...cancelled, status: "running", progress: 75 }],
    )
    assert.equal(merged[0], cancelled)
})

test("50 percent fetch plateau explains that the task is still active", () => {
    const running = task("running")
    const merged = mergeExportTaskUpdate(running, {
        taskId: running.id,
        progress: 50,
        status: "running",
        message: "已获取 120000 条消息...",
        messageCount: 120000,
    })

    assert.equal(merged.progress, 50)
    assert.equal(merged.messageCount, 120000)
    assert.match(merged.progressMessage ?? "", /仍在持续获取消息/)
    assert.match(merged.progressMessage ?? "", /不是总任务完成度/)
})

test("polling task at fetch plateau receives the same progress explanation", () => {
    const running = task("running")
    const [merged] = mergeRemoteExportTasks([], [{
        ...running,
        messageCount: 240000,
        progressMessage: "已获取 240000 条消息...",
    }])

    assert.match(merged.progressMessage ?? "", /50%/)
    assert.match(merged.progressMessage ?? "", /不是总任务完成度/)
})

test("non-fetch progress messages are unchanged", () => {
    const running = task("running", 60)
    const merged = mergeExportTaskUpdate(running, {
        taskId: running.id,
        progress: 60,
        status: "running",
        message: "正在解析消息...",
        messageCount: 120000,
    })

    assert.equal(merged.progressMessage, "正在解析消息...")
})
