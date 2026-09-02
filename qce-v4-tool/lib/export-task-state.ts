import type { ExportTask, RoamingScanSummary } from "../types/api"

export type ExportTaskUpdate = {
  taskId: string
  progress?: number
  status: ExportTask["status"]
  message?: string
  messageCount?: number
  error?: string
  fileName?: string
  downloadUrl?: string
  completedAt?: string
  isZipExport?: boolean
  originalFilePath?: string
  filePath?: string
  taskKind?: "standard_export" | "roaming_export"
  roamingScan?: RoamingScanSummary
}

export function isActiveExportTaskStatus(status: ExportTask["status"]): boolean {
  return status === "queued" || status === "pending" || status === "running"
}

function isTerminalExportTaskStatus(status: ExportTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function activeExportTaskStatusRank(status: ExportTask["status"]): number | undefined {
  if (status === "queued") return 0
  if (status === "pending") return 1
  if (status === "running") return 2
  return undefined
}

/** Keep lifecycle updates monotonic when REST and WebSocket delivery races. */
function shouldRejectLifecycleRegression(
  current: ExportTask["status"],
  incoming: ExportTask["status"],
): boolean {
  if (isTerminalExportTaskStatus(current)) return incoming !== current
  const currentRank = activeExportTaskStatusRank(current)
  const incomingRank = activeExportTaskStatusRank(incoming)
  return currentRank !== undefined && incomingRank !== undefined && incomingRank < currentRank
}

export type ExportTaskResync = {
  taskId: string
  status: string
  progress: number
  messageCount: number
  error?: string
  taskKind?: "standard_export" | "roaming_export"
  roamingScan?: RoamingScanSummary
}

export function mergeExportTaskUpdate(task: ExportTask, data: ExportTaskUpdate): ExportTask {
  if (shouldRejectLifecycleRegression(task.status, data.status)) {
    return task
  }
  return {
    ...task,
    ...(data.progress !== undefined && { progress: data.progress }),
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
    ...(data.taskKind !== undefined && { taskKind: data.taskKind }),
    ...(data.roamingScan !== undefined && { roamingScan: data.roamingScan }),
  }
}

/**
 * Apply a WebSocket update that arrived while a task-list request was in
 * flight. The REST task supplies authoritative identity/configuration fields;
 * the newer event supplies lifecycle progress. A stale running event must not
 * revive a terminal REST task.
 */
export function mergePendingExportTaskUpdate(
  remote: ExportTask,
  pending?: ExportTask,
): ExportTask {
  if (!pending) return remote
  return mergeExportTaskUpdate(remote, {
    taskId: pending.id,
    status: pending.status,
    progress: pending.progress,
    message: pending.progressMessage ?? pending.message,
    messageCount: pending.messageCount,
    error: pending.error,
    fileName: pending.fileName,
    filePath: pending.filePath,
    downloadUrl: pending.downloadUrl,
    completedAt: pending.completedAt,
    isZipExport: pending.isZipExport,
    originalFilePath: pending.originalFilePath,
    taskKind: pending.taskKind,
    roamingScan: pending.roamingScan,
  })
}

/** Merge a possibly stale WebSocket resync snapshot into an existing task. */
export function mergeExportTaskResync(
  task: ExportTask,
  remote: ExportTaskResync,
): ExportTask {
  const knownStatuses: ExportTask["status"][] = [
    "queued",
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]
  const remoteStatus = knownStatuses.includes(remote.status as ExportTask["status"])
    ? remote.status as ExportTask["status"]
    : task.status
  if (shouldRejectLifecycleRegression(task.status, remoteStatus)) {
    return task
  }

  const nextProgress = Number.isFinite(remote.progress) ? remote.progress : task.progress
  const nextMessageCount = Number.isFinite(remote.messageCount)
    ? remote.messageCount
    : task.messageCount
  const nextError = remote.error ?? task.error
  const nextTaskKind = remote.taskKind ?? task.taskKind
  const nextRoamingScan = remote.roamingScan ?? task.roamingScan

  if (
    remoteStatus === task.status &&
    nextProgress === task.progress &&
    nextMessageCount === task.messageCount &&
    nextError === task.error &&
    nextTaskKind === task.taskKind &&
    nextRoamingScan === task.roamingScan
  ) {
    return task
  }

  return {
    ...task,
    status: remoteStatus,
    progress: nextProgress,
    messageCount: nextMessageCount,
    error: nextError,
    taskKind: nextTaskKind,
    roamingScan: nextRoamingScan,
  }
}

export function mergeRemoteExportTasks(
  current: ExportTask[],
  remote: ExportTask[],
  preserveMissingTaskIds: ReadonlySet<string> = new Set(),
): ExportTask[] {
  const currentById = new Map(current.map((task) => [task.id, task]))
  const remoteIds = new Set(remote.map((task) => task.id))
  const locallyCreatedWhileLoading = current.filter(
    (task) => preserveMissingTaskIds.has(task.id) && !remoteIds.has(task.id),
  )
  const mergedRemote = remote.map((task) => {
    const local = currentById.get(task.id)
    if (local && shouldRejectLifecycleRegression(local.status, task.status)) {
      return local
    }
    return {
      ...task,
      progressMessage: task.progressMessage ?? task.message,
      taskKind: task.taskKind ?? local?.taskKind,
      roamingScan: task.roamingScan ?? local?.roamingScan,
    }
  })
  // A GET /api/tasks response represents the server snapshot from when that
  // request started. Do not let it remove a local task created while the
  // request was in flight; a later refresh/WS event will reconcile that task.
  return [...locallyCreatedWhileLoading, ...mergedRemote]
}

export function getExportTaskStats(tasks: readonly ExportTask[]) {
  let running = 0
  let completed = 0
  let failed = 0
  for (const task of tasks) {
    if (isActiveExportTaskStatus(task.status)) running += 1
    else if (task.status === "completed") completed += 1
    else if (task.status === "failed") failed += 1
  }
  return { total: running + completed + failed, running, completed, failed }
}

/** Preserve progress that can arrive over WebSocket before the create request resolves. */
export function mergeCreatedExportTask(created: ExportTask, existing?: ExportTask): ExportTask {
  if (!existing) return created
  return {
    ...created,
    status: existing.status,
    progress: existing.progress,
    messageCount: existing.messageCount ?? created.messageCount,
    progressMessage: existing.progressMessage ?? created.progressMessage,
    error: existing.error ?? created.error,
    fileName: existing.fileName ?? created.fileName,
    filePath: existing.filePath ?? created.filePath,
    downloadUrl: existing.downloadUrl ?? created.downloadUrl,
    completedAt: existing.completedAt ?? created.completedAt,
    isZipExport: existing.isZipExport ?? created.isZipExport,
    originalFilePath: existing.originalFilePath ?? created.originalFilePath,
    resourceSummary: existing.resourceSummary ?? created.resourceSummary,
    taskKind: existing.taskKind ?? created.taskKind,
    roamingScan: existing.roamingScan ?? created.roamingScan,
  }
}
