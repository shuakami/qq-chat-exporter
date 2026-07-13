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
