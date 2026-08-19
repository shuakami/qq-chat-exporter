import type { CreateTaskForm, CreateTaskRequest } from "@/types/api"
import type { ExportTaskPlan } from "@/types/export-task-plans"

export interface BuiltExportRequest {
  endpoint: string
  body: CreateTaskRequest
}

function splitCsv(value?: string): string[] | undefined {
  if (!value) return undefined
  const items = value.split(",").map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

/** 单次、批量和可复用导出任务共用的请求构造。 */
export function buildExportRequest(form: CreateTaskForm): BuiltExportRequest {
  const useStreamingMode = form.streamingZipMode === true
  const isJsonFormat = form.format === "JSON"
  const keywords = splitCsv(form.keywords)
  const excludeUserUins = splitCsv(form.excludeUserUins)
  const includeUserUins = splitCsv(form.includeUserUins)

  const body: CreateTaskRequest = {
    peer: {
      chatType: form.chatType,
      peerUid: form.peerUid,
      ...(form.peerUin && { peerUin: form.peerUin }),
      guildId: "",
    },
    sessionName: form.sessionName,
    format: useStreamingMode
      ? (isJsonFormat ? "STREAMING_JSONL" : "STREAMING_ZIP")
      : form.format,
    filter: {
      ...(form.startTime && { startTime: Math.floor(new Date(form.startTime).getTime() / 1000) }),
      ...(form.endTime && { endTime: Math.floor(new Date(form.endTime).getTime() / 1000) }),
      ...(keywords && { keywords }),
      ...(excludeUserUins && { excludeUserUins }),
      ...(includeUserUins && { includeUserUins }),
      includeRecalled: form.includeRecalled,
    },
    options: {
      batchSize: useStreamingMode ? 3000 : 5000,
      includeResourceLinks: form.includeResourceLinks ?? true,
      includeSystemMessages: form.includeSystemMessages,
      filterPureImageMessages: form.filterPureImageMessages,
      prettyFormat: true,
      exportAsZip: form.exportAsZip,
      embedAvatarsAsBase64: form.embedAvatarsAsBase64,
      embedResourcesAsDataUri: form.embedResourcesAsDataUri,
      preferGroupMemberName: form.preferGroupMemberName ?? true,
      debugExport: form.debugExport ?? false,
      ...(form.outputDir?.trim() && { outputDir: form.outputDir.trim() }),
      ...(form.useNameInFileName && { useNameInFileName: true }),
      ...(form.useFriendlyFileName && { useFriendlyFileName: true }),
      ...(Array.isArray(form.skipDownloadResourceTypes) && form.skipDownloadResourceTypes.length > 0 && {
        skipDownloadResourceTypes: form.skipDownloadResourceTypes,
      }),
    },
  }

  const endpoint = useStreamingMode
    ? (isJsonFormat ? "/api/messages/export-streaming-jsonl" : "/api/messages/export-streaming-zip")
    : "/api/messages/export"

  return { endpoint, body }
}

function secondsToIso(seconds?: number): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString()
}

export function exportTaskPlanToForm(
  plan: ExportTaskPlan,
  group: { groupCode: string; groupName: string },
  nowSeconds = Math.floor(Date.now() / 1000),
): CreateTaskForm {
  const incrementalFrom = plan.incremental ? plan.progress?.[group.groupCode] : undefined
  let startTime = incrementalFrom
  let endTime: number | undefined

  if (startTime === undefined && !plan.incremental) {
    if (plan.timeRangeType === "recent-3-months") {
      const start = new Date(nowSeconds * 1000)
      start.setMonth(start.getMonth() - 3)
      startTime = Math.floor(start.getTime() / 1000)
      endTime = nowSeconds
    } else if (plan.timeRangeType === "last-7-days") {
      startTime = nowSeconds - 7 * 86_400
      endTime = nowSeconds
    } else if (plan.timeRangeType === "last-30-days") {
      startTime = nowSeconds - 30 * 86_400
      endTime = nowSeconds
    } else if (plan.timeRangeType === "custom" && plan.customTimeRange) {
      startTime = plan.customTimeRange.startTime
      endTime = plan.customTimeRange.endTime
    }
  }

  return {
    chatType: 2,
    peerUid: group.groupCode,
    peerUin: group.groupCode,
    sessionName: group.groupName || group.groupCode,
    format: plan.format,
    startTime: secondsToIso(startTime),
    endTime: secondsToIso(endTime),
    keywords: plan.options.keywords,
    excludeUserUins: plan.options.excludeUserUins,
    includeUserUins: plan.options.includeUserUins,
    includeRecalled: plan.options.includeRecalled,
    includeResourceLinks: plan.options.includeResourceLinks,
    includeSystemMessages: plan.options.includeSystemMessages,
    filterPureImageMessages: plan.options.filterPureImageMessages,
    exportAsZip: plan.options.exportAsZip,
    embedAvatarsAsBase64: plan.options.embedAvatarsAsBase64,
    embedResourcesAsDataUri: plan.options.embedResourcesAsDataUri,
    streamingZipMode: plan.options.streamingZipMode,
    outputDir: plan.outputDir,
    useNameInFileName: plan.options.useNameInFileName,
    useFriendlyFileName: plan.options.useFriendlyFileName,
    preferGroupMemberName: plan.options.preferGroupMemberName,
    debugExport: plan.options.debugExport,
    skipDownloadResourceTypes: plan.options.skipDownloadResourceTypes,
  }
}
