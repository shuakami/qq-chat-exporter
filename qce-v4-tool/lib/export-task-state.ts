import type { ExportTask } from "../types/api"

export type ExportTaskUpdate = {
  taskId: string
  progress: number
  status: "running" | "completed" | "failed" | "cancelled"
  message?: string
  messageCount?: number
  error?: string
  fileName?: string
  downloadUrl?: string
  completedAt?: string
  isZipExport?: boolean
  originalFilePath?: string
  filePath?: string
}

const FETCH_STAGE_PLATEAU = 50
const FETCH_STAGE_HINT = "仍在持续获取消息；此处 50% 表示“消息抓取阶段”，不是总任务完成度"

function isFetchStagePlateau(
  status: ExportTask["status"],
  progress: number,
  messageCount?: number,
  message?: string,
): boolean {
  if (status !== "running" || progress !== FETCH_STAGE_PLATEAU) return false
  if (messageCount === undefined || messageCount <= 0) return false
  return !message || /已获取|正在获取|获取消息/.test(message)
}

function buildProgressMessage(
  status: ExportTask["status"],
  progress: number,
  messageCount?: number,
  message?: string,
): string | undefined {
  if (!isFetchStagePlateau(status, progress, messageCount, message)) return message

  const base = message?.trim() || `已获取 ${messageCount!.toLocaleString("zh-CN")} 条消息`
  if (base.includes(FETCH_STAGE_HINT)) return base
  return `${base}（${FETCH_STAGE_HINT}）`
}

function normalizeRemoteTask(task: ExportTask): ExportTask {
  const progressMessage = buildProgressMessage(
    task.status,
    task.progress,
    task.messageCount,
    task.progressMessage,
  )
  if (progressMessage === task.progressMessage) return task
  return { ...task, progressMessage }
}

export function mergeExportTaskUpdate(task: ExportTask, data: ExportTaskUpdate): ExportTask {
  if (task.status === "cancelled" && data.status !== "cancelled") return task

  const progressMessage = buildProgressMessage(
    data.status,
    data.progress,
    data.messageCount,
    data.message,
  )

  return {
    ...task,
    progress: data.progress,
    status: data.status,
    ...(data.messageCount !== undefined && { messageCount: data.messageCount }),
    ...(progressMessage !== undefined && { progressMessage }),
    ...(data.error !== undefined && { error: data.error }),
    ...(data.fileName !== undefined && { fileName: data.fileName }),
    ...(data.filePath !== undefined && { filePath: data.filePath }),
    ...(data.downloadUrl !== undefined && { downloadUrl: data.downloadUrl }),
    ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
    ...(data.isZipExport !== undefined && { isZipExport: data.isZipExport }),
    ...(data.originalFilePath !== undefined && { originalFilePath: data.originalFilePath }),
  }
}

export function mergeRemoteExportTasks(
  current: ExportTask[],
  remote: ExportTask[],
): ExportTask[] {
  const currentById = new Map(current.map((task) => [task.id, task]))
  return remote.map((task) => {
    const local = currentById.get(task.id)
    if (local?.status === "cancelled" && task.status !== "cancelled") return local
    return normalizeRemoteTask(task)
  })
}
