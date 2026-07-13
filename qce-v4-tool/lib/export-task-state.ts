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

export function mergeExportTaskUpdate(task: ExportTask, data: ExportTaskUpdate): ExportTask {
  if (task.status === "cancelled" && data.status !== "cancelled") return task
  return {
    ...task,
    progress: data.progress,
    status: data.status,
    ...(data.messageCount !== undefined && { messageCount: data.messageCount }),
    ...(data.message !== undefined && { progressMessage: data.message }),
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
    return local?.status === "cancelled" && task.status !== "cancelled" ? local : task
  })
}
