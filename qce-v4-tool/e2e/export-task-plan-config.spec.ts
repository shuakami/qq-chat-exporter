import { expect, test } from "@playwright/test"

import { buildExportRequest, exportTaskPlanToForm } from "@/lib/export-request"
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
