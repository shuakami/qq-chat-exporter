import { expect, test } from "@playwright/test"

import { buildExportRequest, exportTaskPlanToForm } from "@/lib/export-request"
import {
  getExportTaskStats,
  isActiveExportTaskStatus,
  mergeCreatedExportTask,
  mergeExportTaskResync,
  mergeExportTaskUpdate,
  mergePendingExportTaskUpdate,
  mergeRemoteExportTasks,
} from "@/lib/export-task-state"
import {
  normalizeExportTaskPlan,
  type ExportTaskPlan,
} from "@/types/export-task-plans"

function makePlan(overrides: Partial<ExportTaskPlan> = {}): ExportTaskPlan {
  return normalizeExportTaskPlan({
    id: "plan_1",
    name: "学校群备份",
    sourceMode: "fixed",
    fixedGroups: [{ groupCode: "123", groupName: "测试群" }],
    tags: [],
    format: "JSON",
    options: {
      includeResourceLinks: true,
      includeSystemMessages: true,
      filterPureImageMessages: false,
      preferGroupMemberName: true,
      includeRecalled: true,
      debugExport: true,
      streamingZipMode: false,
      exportAsZip: false,
      embedAvatarsAsBase64: true,
      embedResourcesAsDataUri: false,
      skipDownloadResourceTypes: ["video", "audio"],
      useNameInFileName: true,
      useFriendlyFileName: true,
      keywords: "通知, 会议",
      excludeUserUins: "10001",
      includeUserUins: "10002, 10003",
    },
    outputDir: "D:\\exports",
    incremental: false,
    timeRangeType: "all",
    batchSize: 20,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  })
}

test.describe("shared export request builder", () => {
  test("keeps filters and advanced options for reusable task plans", () => {
    const plan = makePlan()
    const form = exportTaskPlanToForm(plan, { groupCode: "123", groupName: "测试群" }, 1_700_000_000)
    const request = buildExportRequest(form)

    expect(request.endpoint).toBe("/api/messages/export")
    expect(request.body.filter).toMatchObject({
      keywords: ["通知", "会议"],
      excludeUserUins: ["10001"],
      includeUserUins: ["10002", "10003"],
      includeRecalled: true,
    })
    expect(request.body.options).toMatchObject({
      includeResourceLinks: true,
      includeSystemMessages: true,
      filterPureImageMessages: false,
      embedAvatarsAsBase64: true,
      preferGroupMemberName: true,
      debugExport: true,
      outputDir: "D:\\exports",
      useNameInFileName: true,
      useFriendlyFileName: true,
      skipDownloadResourceTypes: ["video", "audio"],
    })
  })

  test("selects the matching streaming endpoint", () => {
    const json = buildExportRequest({
      ...exportTaskPlanToForm(makePlan(), { groupCode: "123", groupName: "测试群" }),
      streamingZipMode: true,
    })
    expect(json.endpoint).toBe("/api/messages/export-streaming-jsonl")
    expect(json.body.format).toBe("STREAMING_JSONL")
    expect(json.body.options.batchSize).toBe(3000)

    const html = buildExportRequest({
      ...exportTaskPlanToForm(makePlan({ format: "HTML" }), { groupCode: "123", groupName: "测试群" }),
      streamingZipMode: true,
    })
    expect(html.endpoint).toBe("/api/messages/export-streaming-zip")
    expect(html.body.format).toBe("STREAMING_ZIP")
  })

  test("keeps every regular export format on the standard endpoint", () => {
    for (const format of ["JSON", "HTML", "TXT", "EXCEL"] as const) {
      const request = buildExportRequest(
        exportTaskPlanToForm(makePlan({ format }), { groupCode: "123", groupName: "测试群" }),
      )
      expect(request.endpoint).toBe("/api/messages/export")
      expect(request.body.format).toBe(format)
    }
  })

  test("routes bounded roaming exports through the task endpoint without changing timestamp units", () => {
    const request = buildExportRequest({
      ...exportTaskPlanToForm(makePlan({ format: "HTML" }), { groupCode: "123", groupName: "测试群" }),
      historySource: "roaming",
      chatType: 1,
      peerUid: "u_fixture_peer",
      peerUin: "10001",
      sessionName: "漫游测试会话",
      keywords: "不会被误传给不支持的漫游管线",
      startTime: "2023-01-01T00:00:00.000Z",
      endTime: "2023-12-31T23:59:59.000Z",
    })

    expect(request.endpoint).toBe("/api/messages/roaming/export")
    expect(request.body.peer).toEqual({
      chatType: 1,
      peerUid: "u_fixture_peer",
      peerUin: "10001",
      guildId: "",
    })
    expect(request.body.filter.startTime).toBe(1_672_531_200)
    expect(request.body.filter.endTime).toBe(1_704_067_199)
    expect(request.body.filter.keywords).toBeUndefined()
    expect(request.body.roaming).toEqual({
      maxMessages: 50_000,
      maxSequenceQueries: 50_000,
    })
  })

  test("includes the final minute selected by the roaming date picker", () => {
    const request = buildExportRequest({
      ...exportTaskPlanToForm(makePlan(), { groupCode: "123", groupName: "测试群" }),
      historySource: "roaming",
      chatType: 1,
      peerUid: "u_fixture_peer",
      peerUin: "10001",
      sessionName: "漫游测试会话",
      startTime: "2023-01-01T00:00",
      endTime: "2023-01-01T23:59",
    })

    expect(request.body.filter.endTime! - request.body.filter.startTime!).toBe(86_399)
  })
})

test.describe("export task creation races", () => {
  test("keeps a terminal WebSocket update that arrived before the create response", () => {
    const created = {
      id: "roaming_fixture",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "漫游测试会话",
      status: "running" as const,
      progress: 0,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
      taskKind: "roaming_export" as const,
      roamingScan: {
        bounded: true as const,
        calendarAdvisory: true as const,
        requestedDays: 31,
        probedDays: 0,
        scannedDays: 0,
        calendarQueries: 0,
        anchorDays: 0,
        exactQueries: 0,
        latestQueries: 0,
        sequenceQueries: 0,
        emptySequenceQueries: 0,
        gapCount: 0,
        mismatchedAnchors: 0,
        unresolvedAnchors: 0,
        untimestampedMessages: 0,
        rawMessagesSeen: 0,
        messageCount: 0,
        maxMessages: 50_000,
        maxSequenceQueries: 50_000,
        closingAnchorFound: false,
        partial: false,
        stopReason: "running",
        serverCompletenessProven: false as const,
      },
    }
    const websocketTerminal = {
      ...created,
      peer: { chatType: 0, peerUid: "", guildId: "" },
      sessionName: "导出任务",
      status: "completed" as const,
      progress: 100,
      messageCount: 42,
      roamingScan: undefined,
      completedAt: "2026-09-02T00:00:01.000Z",
    }

    const merged = mergeCreatedExportTask(created, websocketTerminal)
    expect(merged.status).toBe("completed")
    expect(merged.progress).toBe(100)
    expect(merged.messageCount).toBe(42)
    expect(merged.peer).toEqual(created.peer)
    expect(merged.sessionName).toBe(created.sessionName)
    expect(merged.taskKind).toBe("roaming_export")
    expect(merged.roamingScan).toEqual(created.roamingScan)

    const terminalWithoutSummary = mergeExportTaskUpdate(created, {
      taskId: created.id,
      status: "completed",
      progress: 100,
      messageCount: 42,
    })
    expect(terminalWithoutSummary.taskKind).toBe("roaming_export")
    expect(terminalWithoutSummary.roamingScan).toEqual(created.roamingScan)

    const refreshedWithoutSummary = mergeRemoteExportTasks(
      [terminalWithoutSummary],
      [{ ...terminalWithoutSummary, taskKind: undefined, roamingScan: undefined }],
    )
    expect(refreshedWithoutSummary[0].taskKind).toBe("roaming_export")
    expect(refreshedWithoutSummary[0].roamingScan).toEqual(created.roamingScan)

    const finalScan = {
      ...created.roamingScan,
      scannedDays: 31,
      partial: true,
      stopReason: "closing_anchor_not_found",
    }
    const enriched = mergeExportTaskUpdate(merged, {
      taskId: created.id,
      status: "completed",
      taskKind: "roaming_export",
      roamingScan: finalScan,
    })
    expect(enriched.taskKind).toBe("roaming_export")
    expect(enriched.roamingScan).toEqual(finalScan)
  })

  test("terminal events without progress do not erase the last known value", () => {
    const task = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "running" as const,
      progress: 37,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }

    const merged = mergeExportTaskUpdate(task, {
      taskId: task.id,
      status: "cancelled",
      message: "任务已停止",
    })
    expect(merged.progress).toBe(37)
    expect(merged.status).toBe("cancelled")
  })

  test("late running progress cannot revive a terminal task", () => {
    const task = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "completed" as const,
      progress: 100,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }

    const merged = mergeExportTaskUpdate(task, {
      taskId: task.id,
      status: "running",
      progress: 38,
    })
    expect(merged).toBe(task)
  })

  test("a terminal task cannot be replaced by a different terminal result", () => {
    const completed = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "completed" as const,
      progress: 100,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }
    const failed = { ...completed, status: "failed" as const, progress: 80 }

    expect(mergeExportTaskUpdate(completed, {
      taskId: completed.id,
      status: "failed",
      progress: 80,
    })).toBe(completed)
    expect(mergeExportTaskUpdate(failed, {
      taskId: failed.id,
      status: "completed",
      progress: 100,
    })).toBe(failed)
    expect(mergeRemoteExportTasks([completed], [failed])).toEqual([completed])
  })

  test("queued is active but cannot regress running or revive terminal tasks", () => {
    const queued = {
      id: "queued_fixture",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "排队任务",
      status: "queued" as const,
      progress: 0,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }
    const pending = { ...queued, status: "pending" as const, progress: 10 }
    const running = { ...queued, status: "running" as const, progress: 20 }
    const completed = { ...queued, status: "completed" as const, progress: 100 }

    expect(isActiveExportTaskStatus(queued.status)).toBe(true)
    expect(getExportTaskStats([queued, running, completed])).toEqual({
      total: 3,
      running: 2,
      completed: 1,
      failed: 0,
    })
    expect(mergeExportTaskUpdate(pending, { taskId: pending.id, status: "queued", progress: 0 })).toBe(pending)
    expect(mergeExportTaskUpdate(running, { taskId: running.id, status: "queued", progress: 0 })).toBe(running)
    expect(mergeExportTaskUpdate(completed, { taskId: completed.id, status: "queued", progress: 0 })).toBe(completed)
    expect(mergeExportTaskResync(completed, {
      taskId: completed.id,
      status: "queued",
      progress: 0,
      messageCount: 0,
    })).toBe(completed)
    expect(mergeRemoteExportTasks([completed], [queued])).toEqual([completed])
  })

  test("a stale task-list refresh cannot revive a terminal task", () => {
    const completed = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "completed" as const,
      progress: 100,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }
    const staleRunning = {
      ...completed,
      status: "running" as const,
      progress: 38,
    }

    expect(mergeRemoteExportTasks([completed], [staleRunning])).toEqual([completed])
  })

  test("a stale WebSocket resync cannot revive a terminal task", () => {
    const completed = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "completed" as const,
      progress: 100,
      messageCount: 42,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }

    const merged = mergeExportTaskResync(completed, {
      taskId: completed.id,
      status: "running",
      progress: 38,
      messageCount: 10,
    })

    expect(merged).toBe(completed)
  })

  test("a pending terminal WebSocket event wins over an in-flight REST snapshot", () => {
    const staleRunning = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "running" as const,
      progress: 38,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }
    const pendingCompleted = {
      ...staleRunning,
      status: "completed" as const,
      progress: 100,
      messageCount: 42,
      completedAt: "2026-09-02T00:00:01.000Z",
    }

    const merged = mergePendingExportTaskUpdate(staleRunning, pendingCompleted)
    expect(merged.status).toBe("completed")
    expect(merged.progress).toBe(100)
    expect(merged.messageCount).toBe(42)

    // The inverse race is also safe: stale running progress cannot revive a
    // terminal task returned by REST.
    expect(mergePendingExportTaskUpdate(pendingCompleted, staleRunning)).toEqual(
      pendingCompleted,
    )
  })

  test("a pending lifecycle event wins over an older queued REST snapshot", () => {
    const queued = {
      id: "fixture_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "测试会话",
      status: "queued" as const,
      progress: 0,
      format: "JSON",
      createdAt: "2026-09-02T00:00:00.000Z",
    }
    const waitingForHistory = {
      ...queued,
      status: "pending" as const,
      progressMessage: "已取得导出名额，正在等待历史查询...",
    }

    expect(mergePendingExportTaskUpdate(queued, waitingForHistory)).toEqual(
      waitingForHistory,
    )
  })

  test("a task created after a task-list request began survives its stale response", () => {
    const createdWhileLoading = {
      id: "new_local_task",
      peer: { chatType: 1, peerUid: "u_fixture_peer", guildId: "" },
      sessionName: "刚创建的任务",
      status: "running" as const,
      progress: 0,
      format: "JSON",
      createdAt: "2026-09-02T00:00:01.000Z",
    }

    // The old response was requested before this id existed, so an empty
    // remote snapshot cannot authoritatively delete the newly created task.
    expect(
      mergeRemoteExportTasks(
        [createdWhileLoading],
        [],
        new Set([createdWhileLoading.id]),
      ),
    ).toEqual([createdWhileLoading])

    // Without the in-flight protection, a later authoritative empty refresh
    // still removes a task that is no longer present on the server.
    expect(mergeRemoteExportTasks([createdWhileLoading], [])).toEqual([])
  })
})

test.describe("reusable task time ranges and compatibility", () => {
  test("normalizes old localStorage plans without losing progress", () => {
    const legacy = {
      ...makePlan(),
      options: {
        includeResourceLinks: false,
        includeSystemMessages: false,
        filterPureImageMessages: true,
        preferGroupMemberName: false,
      },
      progress: { "123": 1_690_000_000 },
    } as unknown as ExportTaskPlan

    const normalized = normalizeExportTaskPlan(legacy)
    expect(normalized.progress).toEqual({ "123": 1_690_000_000 })
    expect(normalized.options.includeResourceLinks).toBe(false)
    expect(normalized.options.includeRecalled).toBe(false)
    expect(normalized.options.streamingZipMode).toBe(false)
    expect(normalized.options.useFriendlyFileName).toBe(false)
  })

  test("uses the saved cursor for subsequent incremental runs", () => {
    const plan = makePlan({
      incremental: true,
      progress: { "123": 1_690_000_000 },
    })
    const request = buildExportRequest(
      exportTaskPlanToForm(plan, { groupCode: "123", groupName: "测试群" }, 1_700_000_000),
    )
    expect(request.body.filter.startTime).toBe(1_690_000_000)
    expect(request.body.filter.endTime).toBeUndefined()
  })

  test("exports full history on the first incremental run", () => {
    const request = buildExportRequest(
      exportTaskPlanToForm(
        makePlan({ incremental: true, progress: undefined }),
        { groupCode: "123", groupName: "测试群" },
        1_700_000_000,
      ),
    )
    expect(request.body.filter.startTime).toBeUndefined()
    expect(request.body.filter.endTime).toBeUndefined()
  })

  test("supports recent three months and custom ranges", () => {
    const now = Math.floor(new Date("2026-08-19T12:00:00.000Z").getTime() / 1000)
    const recent = buildExportRequest(
      exportTaskPlanToForm(
        makePlan({ timeRangeType: "recent-3-months" }),
        { groupCode: "123", groupName: "测试群" },
        now,
      ),
    )
    expect(recent.body.filter.endTime).toBe(now)
    expect(new Date(recent.body.filter.startTime! * 1000).toISOString()).toBe("2026-05-19T12:00:00.000Z")

    const custom = buildExportRequest(
      exportTaskPlanToForm(
        makePlan({
          timeRangeType: "custom",
          customTimeRange: { startTime: 1_650_000_000, endTime: 1_660_000_000 },
        }),
        { groupCode: "123", groupName: "测试群" },
        now,
      ),
    )
    expect(custom.body.filter.startTime).toBe(1_650_000_000)
    expect(custom.body.filter.endTime).toBe(1_660_000_000)

    for (const [timeRangeType, seconds] of [["last-7-days", 7 * 86_400], ["last-30-days", 30 * 86_400]] as const) {
      const legacyRange = buildExportRequest(
        exportTaskPlanToForm(
          makePlan({ timeRangeType }),
          { groupCode: "123", groupName: "测试群" },
          now,
        ),
      )
      expect(legacyRange.body.filter.startTime).toBe(now - seconds)
      expect(legacyRange.body.filter.endTime).toBe(now)
    }
  })
})
