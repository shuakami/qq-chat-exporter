import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  APIResponse,
  CreateTaskForm,
  CreateTaskResponse,
  ExportTask,
  TasksResponse,
} from "@/types/api"
import { toast, type ToastAction } from "@/components/ui/toast"
import {
  mergeCreatedExportTask,
  mergeExportTaskResync,
  mergeExportTaskUpdate,
  mergePendingExportTaskUpdate,
  mergeRemoteExportTasks,
  type ExportTaskResync,
  type ExportTaskUpdate,
} from "@/lib/export-task-state"
import { useApi } from "./use-api"
import { buildExportRequest } from "@/lib/export-request"

const GITHUB_URL = "https://github.com/shuakami/qq-chat-exporter"

type TaskStatus = "running" | "completed" | "failed" | "cancelled"

type ProgressPayload = ExportTaskUpdate

export interface UseExportTasksProps {
  onNotification?: (notification: {
    type: "success" | "error" | "info"
    title: string
    message: string
    actions?: Array<{
      label: string
      onClick: () => void
      variant?: "default" | "destructive"
    }>
  }) => void
}

function isStreamingJsonlFile(fileName?: string) {
  if (!fileName) return false
  return fileName.includes("_chunked_jsonl") || fileName.includes("chunked_jsonl")
}

function isStreamingZipFile(fileName?: string) {
  if (!fileName) return false
  return fileName.includes("_streaming.zip") || fileName.endsWith("_streaming.zip")
}

function buildRunningToastDescription(task: ExportTask, data?: ProgressPayload) {
  return data?.message || task.progressMessage || (task.taskKind === "roaming_export"
    ? "漫游任务已创建，正在等待扫描进度"
    : "导出任务已创建，正在等待进度更新")
}

function buildCompletedToastDescription(task: ExportTask, data: ProgressPayload): ReactNode {
  const fileName = data.fileName || task.fileName
  const isStreamingJsonl = isStreamingJsonlFile(fileName)
  const isStreamingZip = isStreamingZipFile(fileName)
  const isZipExport = data.isZipExport ?? task.isZipExport
  const originalFilePath = data.originalFilePath ?? task.originalFilePath
  const isHtmlExport = task.format?.toUpperCase() === "HTML" && !isStreamingZip
  const isPartialRoaming = task.taskKind === "roaming_export" && task.roamingScan?.partial === true

  let prefix = ""
  if (isStreamingJsonl) {
    prefix = "分块导出已完成。"
  } else if (isStreamingZip) {
    prefix = "流式 ZIP 导出已完成。"
  } else if (isHtmlExport && isZipExport !== true) {
    prefix = "请在导出目录直接打开 HTML 文件。"
  } else if (isZipExport === true && originalFilePath) {
    prefix = "ZIP 导出已完成。"
  }

  return createElement(
    Fragment,
    null,
    isPartialRoaming
      ? "漫游扫描已完成，但结果可能不完整；请到任务页查看停止原因和扫描说明。 "
      : null,
    prefix ? `${prefix} ` : null,
    "如果有帮助到你，给我点个 ",
    createElement(
      "a",
      {
        href: GITHUB_URL,
        target: "_blank",
        rel: "noreferrer",
        className: "underline underline-offset-4",
      },
      "Star",
    ),
    " 吧喵",
  )
}

function buildFailedToastDescription(task: ExportTask, data?: ProgressPayload) {
  return data?.error || task.error || data?.message || "导出失败，请稍后重试"
}

function createFallbackTask(data: ProgressPayload): ExportTask {
  return {
    id: data.taskId,
    peer: {
      chatType: 0,
      peerUid: "",
      guildId: "",
    },
    sessionName: "导出任务",
    status: data.status,
    progress: data.progress ?? (data.status === "completed" ? 100 : 0),
    format: "",
    messageCount: data.messageCount,
    progressMessage: data.message,
    error: data.error,
    fileName: data.fileName,
    filePath: data.filePath,
    downloadUrl: data.downloadUrl,
    createdAt: new Date().toISOString(),
    completedAt: data.completedAt,
    isZipExport: data.isZipExport,
    originalFilePath: data.originalFilePath,
    taskKind: data.taskKind,
    roamingScan: data.roamingScan,
  }
}

export function useExportTasks(_props?: UseExportTasksProps) {
  const [tasks, setTasks] = useState<ExportTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadTime, setLastLoadTime] = useState<number>(0)
  const { apiCall, downloadFile } = useApi()
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const taskToastIdsRef = useRef(new Map<string, string>())
  const tasksRef = useRef<ExportTask[]>([])
  const pendingTaskUpdatesRef = useRef(new Map<string, ExportTask>())
  const deletedTaskTombstonesRef = useRef(new Set<string>())

  const isTaskDeleted = useCallback((taskId: string) => {
    return deletedTaskTombstonesRef.current.has(taskId)
  }, [])

  const rememberDeletedTask = useCallback((taskId: string) => {
    // Task ids are unique. Keep a bounded, session-long tombstone set so a
    // delayed native call (whose timeout may exceed a minute) cannot recreate
    // a task/toast after deletion. Set iteration order gives us a tiny FIFO.
    deletedTaskTombstonesRef.current.delete(taskId)
    deletedTaskTombstonesRef.current.add(taskId)
    while (deletedTaskTombstonesRef.current.size > 1024) {
      const oldest = deletedTaskTombstonesRef.current.values().next().value
      if (!oldest) break
      deletedTaskTombstonesRef.current.delete(oldest)
    }
  }, [])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const openFileLocation = useCallback(async (filePath?: string) => {
    if (!filePath) {
      toast.error("打开文件位置失败", {
        description: "文件路径不存在",
      })
      return false
    }

    try {
      await apiCall("/api/open-file-location", {
        method: "POST",
        body: JSON.stringify({ filePath }),
      })
      return true
    } catch (err) {
      toast.error("打开文件位置失败", {
        description: err instanceof Error ? err.message : "未知错误",
      })
      return false
    }
  }, [apiCall])

  const dismissTaskToast = useCallback((taskId: string) => {
    const toastId = taskToastIdsRef.current.get(taskId)
    if (!toastId) return

    toast.dismiss(toastId)
    taskToastIdsRef.current.delete(taskId)
  }, [])

  const deleteOriginalFilesInternal = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}/original-files`, {
        method: "DELETE",
      })

      if (response.success) {
        setTasks((prev) => {
          const next = prev.map((task) =>
            task.id === taskId
              ? { ...task, originalFilePath: undefined }
              : task,
          )
          tasksRef.current = next
          return next
        })
        return true
      }

      setError(response.error?.message || "删除原始文件失败")
      return false
    } catch (err) {
      const errorMessage = `删除原始文件失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Delete original files error:", err)
      return false
    }
  }, [apiCall])

  const buildCompletedActions = useCallback((task: ExportTask, data: ProgressPayload): ToastAction[] => {
    const actions: ToastAction[] = []
    const fileName = data.fileName || task.fileName
    const filePath = data.filePath || task.filePath
    const isStreamingJsonl = isStreamingJsonlFile(fileName)
    const isStreamingZip = isStreamingZipFile(fileName)
    const isZipExport = data.isZipExport ?? task.isZipExport
    const originalFilePath = data.originalFilePath ?? task.originalFilePath

    if (isStreamingJsonl && filePath) {
      actions.push({
        label: "查看使用方法",
        onClick: () => {
          window.dispatchEvent(new CustomEvent("show-jsonl-help", { detail: { filePath } }))
        },
      })
    }

    if (isStreamingZip && filePath) {
      actions.push({
        label: "查看使用方法",
        onClick: () => {
          window.dispatchEvent(new CustomEvent("show-streaming-zip-help", { detail: { filePath } }))
        },
      })
    }

    if (filePath) {
      actions.push({
        label: "打开文件位置",
        onClick: () => {
          void openFileLocation(filePath)
        },
      })
    }

    if (isZipExport === true && originalFilePath) {
      actions.push({
        label: "删除原文件",
        variant: "destructive",
        onClick: async () => {
          const success = await deleteOriginalFilesInternal(data.taskId)
          if (success) {
            toast.success("删除成功", {
              description: "原始文件已删除",
            })
          } else {
            toast.error("删除失败", {
              description: "删除原始文件失败",
            })
          }
        },
      })
    }

    return actions
  }, [deleteOriginalFilesInternal, openFileLocation])

  const completedToastIdsRef = useRef<Set<string>>(new Set())

  const syncTaskToast = useCallback((task: ExportTask, data?: ProgressPayload) => {
    let toastId = taskToastIdsRef.current.get(task.id)

    if (!toastId) {
      toastId = toast.loading("正在导出", {
        description: buildRunningToastDescription(task, data),
        duration: Infinity,
      })
      taskToastIdsRef.current.set(task.id, toastId)
    }

    const isCompleted = task.status === "completed" || data?.status === "completed"
    const isFailed = task.status === "failed" || data?.status === "failed"
    const isCancelled = task.status === "cancelled" || data?.status === "cancelled"

    if (isCancelled) {
      completedToastIdsRef.current.add(task.id)
      toast.update(toastId, {
        type: "info",
        title: "导出已停止",
        description: "任务已取消",
        actions: undefined,
        duration: 5000,
      })
      return
    }

    if (isCompleted) {
      completedToastIdsRef.current.add(task.id)
      const payload = data || {
        taskId: task.id,
        progress: task.progress,
        status: "completed" as const,
        messageCount: task.messageCount,
        fileName: task.fileName,
        filePath: task.filePath,
        downloadUrl: task.downloadUrl,
        completedAt: task.completedAt,
        isZipExport: task.isZipExport,
        originalFilePath: task.originalFilePath,
      }

      const actions = buildCompletedActions(task, payload)
      const isPartialRoaming = task.taskKind === "roaming_export" && task.roamingScan?.partial === true

      toast.update(toastId, {
        type: isPartialRoaming ? "warning" : "success",
        title: isPartialRoaming
          ? "导出完成（结果可能不完整）"
          : "导出完成",
        description: buildCompletedToastDescription(task, payload),
        actions,
        duration: actions.length > 0 ? Infinity : 8000,
      })
      return
    }

    if (isFailed) {
      completedToastIdsRef.current.add(task.id)
      toast.update(toastId, {
        type: "error",
        title: "导出失败",
        description: buildFailedToastDescription(task, data),
        actions: undefined,
        duration: 8000,
      })
      return
    }

    if (completedToastIdsRef.current.has(task.id)) return

    toast.update(toastId, {
      type: "loading",
      title: "正在导出",
      description: buildRunningToastDescription(task, data),
      actions: undefined,
      duration: Infinity,
    })
  }, [buildCompletedActions])

  const loadTasks = useCallback(async (): Promise<boolean> => {
    const taskIdsAtRequestStart = new Set(tasksRef.current.map((task) => task.id))
    try {
      setLoading(true)
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        const remoteTasks = response.data.tasks
          .filter((task) => !isTaskDeleted(task.id))
          .map((task) => {
            const pending = pendingTaskUpdatesRef.current.get(task.id)
            const merged = mergePendingExportTaskUpdate(task, pending)
            if (pending) pendingTaskUpdatesRef.current.delete(task.id)
            return merged
          })
        setTasks((prev) => {
          const tasksCreatedWhileLoading = new Set(
            prev
              .filter((task) => !taskIdsAtRequestStart.has(task.id))
              .map((task) => task.id),
          )
          const next = mergeRemoteExportTasks(prev, remoteTasks, tasksCreatedWhileLoading)
          tasksRef.current = next
          return next
        })
        setLastLoadTime(Date.now())
        return true
      }

      setError(response.error?.message || "获取任务列表失败")
      return false
    } catch (err) {
      const errorMessage = `获取任务列表失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Load tasks error:", err)
      return false
    } finally {
      setLoading(false)
    }
  }, [apiCall, isTaskDeleted])

  const refreshTasks = useCallback(async (): Promise<boolean> => {
    const taskIdsAtRequestStart = new Set(tasksRef.current.map((task) => task.id))
    try {
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        const remoteTasks = response.data.tasks
          .filter((task) => !isTaskDeleted(task.id))
          .map((task) => {
            const pending = pendingTaskUpdatesRef.current.get(task.id)
            const merged = mergePendingExportTaskUpdate(task, pending)
            if (pending) pendingTaskUpdatesRef.current.delete(task.id)
            return merged
          })
        setTasks((prev) => {
          const tasksCreatedWhileLoading = new Set(
            prev
              .filter((task) => !taskIdsAtRequestStart.has(task.id))
              .map((task) => task.id),
          )
          const next = mergeRemoteExportTasks(prev, remoteTasks, tasksCreatedWhileLoading)
          tasksRef.current = next
          return next
        })
        setLastLoadTime(Date.now())
        return true
      }

      console.warn("[QCE] Silent refresh failed:", response.error?.message || "获取任务列表失败")
      return false
    } catch (err) {
      console.warn("[QCE] Silent refresh error:", err instanceof Error ? err.message : "未知错误")
      return false
    }
  }, [apiCall, isTaskDeleted])

  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}`, {
        method: "DELETE",
      })

      if (response.success) {
        rememberDeletedTask(taskId)
        dismissTaskToast(taskId)
        completedToastIdsRef.current.delete(taskId)
        pendingTaskUpdatesRef.current.delete(taskId)
        setTasks((prev) => prev.filter((task) => task.id !== taskId))
        return true
      }

      setError(response.error?.message || "删除任务失败")
      return false
    } catch (err) {
      const errorMessage = `删除任务失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Delete task error:", err)
      return false
    }
  }, [apiCall, dismissTaskToast, rememberDeletedTask])

  // issue #446：停止一个运行中的导出任务。后端会打断分页抓取并把任务标记为 cancelled。
  const cancelTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
      }) as APIResponse<ExportTask>

      if (response.success) {
        const remoteTask = response.data
        const payload: ProgressPayload = {
          taskId,
          progress: remoteTask?.progress ?? tasksRef.current.find((task) => task.id === taskId)?.progress ?? 0,
          status: "cancelled",
          message: remoteTask?.progressMessage || "任务已停止",
          completedAt: remoteTask?.completedAt,
        }
        let cancelledTask: ExportTask | undefined
        setTasks((prev) => {
          const next = prev.map((task) => {
            if (task.id !== taskId) return task
            cancelledTask = remoteTask ? { ...task, ...remoteTask, status: "cancelled" } : mergeExportTaskUpdate(task, payload)
            return cancelledTask
          })
          tasksRef.current = next
          return next
        })
        const resolvedTask = cancelledTask || tasksRef.current.find((task) => task.id === taskId)
        if (resolvedTask) syncTaskToast(resolvedTask, payload)
        return true
      }

      setError(response.error?.message || "停止任务失败")
      return false
    } catch (err) {
      const errorMessage = `停止任务失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Cancel task error:", err)
      return false
    }
  }, [apiCall, syncTaskToast])

  const createTask = useCallback(async (form: CreateTaskForm): Promise<boolean> => {
    if (!form.peerUid || !form.sessionName) {
      setError("请填写完整信息")
      return false
    }

    const creatingToastId = toast.loading("创建中", {
      description: "正在创建导出任务...",
      duration: Infinity,
    })

    try {
      setLoading(true)
      setError(null)

      const { endpoint: apiEndpoint, body: requestBody } = buildExportRequest(form)

      const response = await apiCall(apiEndpoint, {
        method: "POST",
        body: JSON.stringify(requestBody),
      }) as APIResponse<CreateTaskResponse>

      if (response.success && response.data) {
        const taskId = response.data.taskId || `task_${Date.now()}`
        if (isTaskDeleted(taskId)) {
          // Another client may delete a very short task before this POST
          // response arrives. The task_deleted tombstone is authoritative.
          toast.dismiss(creatingToastId)
          pendingTaskUpdatesRef.current.delete(taskId)
          return true
        }
        const newTask: ExportTask = {
          id: taskId,
          peer: requestBody.peer,
          sessionName: form.sessionName,
          status: "running",
          progress: 0,
          format: form.format,
          startTime: response.data.startTime ?? (form.startTime ? Math.floor(new Date(form.startTime).getTime() / 1000) : undefined),
          endTime: response.data.endTime ?? (form.endTime ? Math.floor(new Date(form.endTime).getTime() / 1000) : undefined),
          keywords: form.historySource === "roaming" ? undefined : form.keywords || undefined,
          includeRecalled: form.includeRecalled,
          messageCount: response.data.messageCount,
          fileName: response.data.fileName,
          filePath: response.data.filePath,
          downloadUrl: response.data.downloadUrl,
          createdAt: new Date().toISOString(),
          taskKind: response.data.taskKind ?? (form.historySource === "roaming" ? "roaming_export" : "standard_export"),
          roamingScan: response.data.roamingScan,
          progressMessage: form.historySource === "roaming"
            ? "漫游任务已创建，正在等待扫描进度"
            : "导出任务已创建，正在等待进度更新",
        }

        const existingTask = tasksRef.current.find((task) => task.id === taskId)
          ?? pendingTaskUpdatesRef.current.get(taskId)
        const resolvedTask = mergeCreatedExportTask(newTask, existingTask)
        const existingToastId = taskToastIdsRef.current.get(taskId)
        const toastId = existingToastId || creatingToastId

        if (existingToastId && existingToastId !== creatingToastId) {
          toast.dismiss(creatingToastId)
        }

        taskToastIdsRef.current.set(taskId, toastId)
        if (!completedToastIdsRef.current.has(taskId)) {
          toast.update(toastId, {
            type: "loading",
            title: "正在导出",
            description: resolvedTask.progressMessage,
            duration: Infinity,
          })
        }

        setTasks((prev) => {
          const latest = prev.find((task) => task.id === taskId)
            ?? pendingTaskUpdatesRef.current.get(taskId)
          const next = [
            mergeCreatedExportTask(newTask, latest),
            ...prev.filter((task) => task.id !== taskId),
          ]
          pendingTaskUpdatesRef.current.delete(taskId)
          tasksRef.current = next
          return next
        })
        return true
      }

      const errorMessage = response.error?.message || "创建任务失败"
      setError(errorMessage)
      toast.update(creatingToastId, {
        type: "error",
        title: "创建失败",
        description: errorMessage,
        duration: 8000,
      })
      return false
    } catch (err) {
      const errorMessage = `创建任务失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Create task error:", err)
      toast.update(creatingToastId, {
        type: "error",
        title: "创建失败",
        description: errorMessage,
        duration: 8000,
      })
      return false
    } finally {
      setLoading(false)
    }
  }, [apiCall, isTaskDeleted])

  const updateTaskProgress = useCallback((
    taskId: string,
    progress: number,
    status: TaskStatus,
    additionalData?: {
      error?: string
      fileName?: string
      filePath?: string
      downloadUrl?: string
      completedAt?: string
    },
  ) => {
    const payload: ProgressPayload = {
      taskId,
      progress,
      status,
      ...(additionalData?.error !== undefined && { error: additionalData.error }),
      ...(additionalData?.fileName !== undefined && { fileName: additionalData.fileName }),
      ...(additionalData?.filePath !== undefined && { filePath: additionalData.filePath }),
      ...(additionalData?.downloadUrl !== undefined && { downloadUrl: additionalData.downloadUrl }),
      ...(additionalData?.completedAt !== undefined && { completedAt: additionalData.completedAt }),
    }

    setTasks((prev) => {
      const next = prev.map((task) => task.id === taskId ? mergeExportTaskUpdate(task, payload) : task)
      tasksRef.current = next
      return next
    })
  }, [])

  const handleWebSocketProgress = useCallback((data: ProgressPayload) => {
    if (isTaskDeleted(data.taskId)) return
    console.log("[QCE] handleWebSocketProgress received:", {
      taskId: data.taskId,
      status: data.status,
      hasFilePath: !!data.filePath,
    })

    let updatedTask: ExportTask | undefined
    const knownTask = tasksRef.current.find((task) => task.id === data.taskId)
    const eagerlyUpdatedTask = knownTask ? mergeExportTaskUpdate(knownTask, data) : undefined
    let pendingTask: ExportTask | undefined
    if (!knownTask) {
      const previousPending = pendingTaskUpdatesRef.current.get(data.taskId)
      pendingTask = previousPending
        ? mergeExportTaskUpdate(previousPending, data)
        : createFallbackTask(data)
      pendingTaskUpdatesRef.current.set(data.taskId, pendingTask)
    }

    setTasks((prev) => {
      const next = prev.map((task) => {
        if (task.id !== data.taskId) return task
        const nextTask = mergeExportTaskUpdate(task, data)
        updatedTask = nextTask
        return nextTask
      })
      if (updatedTask) pendingTaskUpdatesRef.current.delete(data.taskId)
      tasksRef.current = next
      return next
    })

    const resolvedTask = updatedTask
      || eagerlyUpdatedTask
      || pendingTask
      || createFallbackTask(data)

    syncTaskToast(resolvedTask, data)
    if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
      // 终态事件只带通用导出字段；立即拉取完整任务，避免短漫游任务在首次 8 秒
      // 轮询前结束后一直停留在创建响应的 0 天扫描摘要。
      void refreshTasks()
    }
  }, [isTaskDeleted, refreshTasks, syncTaskToast])

  const handleTaskCancelled = useCallback((task: ExportTask) => {
    const taskId = task.id
    if (!taskId || isTaskDeleted(taskId)) return
    handleWebSocketProgress({
      taskId,
      progress: task.progress ?? 0,
      status: "cancelled",
      message: task.progressMessage || "任务已停止",
      messageCount: task.messageCount,
      error: task.error,
      fileName: task.fileName,
      filePath: task.filePath,
      downloadUrl: task.downloadUrl,
      completedAt: task.completedAt,
      isZipExport: task.isZipExport,
      originalFilePath: task.originalFilePath,
      taskKind: task.taskKind,
      roamingScan: task.roamingScan,
    })
  }, [handleWebSocketProgress, isTaskDeleted])

  const handleTaskDeleted = useCallback((taskId: string) => {
    if (!taskId) return
    rememberDeletedTask(taskId)
    dismissTaskToast(taskId)
    completedToastIdsRef.current.delete(taskId)
    pendingTaskUpdatesRef.current.delete(taskId)
    setTasks((prev) => {
      const next = prev.filter((task) => task.id !== taskId)
      tasksRef.current = next
      return next
    })
  }, [dismissTaskToast, rememberDeletedTask])

  /**
   * Issue #144: WebSocket 一连上服务端就会推 task_resync。这里只把已知
   * 任务的 status / progress / messageCount / error 对齐到服务端的真值；
   * 新服务端同时携带 taskKind / roamingScan，旧服务端缺字段时保留本地摘要，
   * 避免「网页一直转圈但服务进程其实早跑完 / 早挂掉」的状态错位。
   *
   * 注意：服务端可能存在前端还没拉到的任务（多端同时操作时）。这种情
   * 况这里不会乱建 ExportTask 对象，而是交给紧随其后的 loadTasks 把完
   * 整字段一并取回，避免下载链接 / 文件名等字段缺失。
   */
  const applyTaskResync = useCallback((tasks: ExportTaskResync[]) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return

    setTasks((prev) => {
      const indexById = new Map<string, (typeof tasks)[number]>()
      for (const t of tasks) {
        if (t && typeof t.taskId === 'string') indexById.set(t.taskId, t)
      }

      let changed = false
      const next = prev.map((task) => {
        const remote = indexById.get(task.id)
        if (!remote) return task

        const merged = mergeExportTaskResync(task, remote)
        if (merged !== task) changed = true
        return merged
      })

      if (!changed) return prev
      tasksRef.current = next
      return next
    })
  }, [])

  const isJsonlExport = useCallback((task: ExportTask): boolean => {
    return task.fileName?.includes("_chunked_jsonl") || task.format === "STREAMING_JSONL"
  }, [])

  const openTaskFileLocation = useCallback(async (task: ExportTask): Promise<boolean> => {
    if (!task.filePath) {
      setError("文件路径不存在")
      return false
    }

    try {
      await apiCall("/api/open-file-location", {
        method: "POST",
        body: JSON.stringify({ filePath: task.filePath }),
      })
      return true
    } catch (err) {
      const errorMessage = `打开文件位置失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Open file location error:", err)
      return false
    }
  }, [apiCall])

  const downloadTask = useCallback(async (task: ExportTask) => {
    if (!task.fileName) return

    if (isJsonlExport(task)) {
      await openTaskFileLocation(task)
      return
    }

    try {
      await downloadFile(task.fileName, task.downloadUrl)
    } catch (err) {
      const errorMessage = `下载失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Download error:", err)
    }
  }, [downloadFile, isJsonlExport, openTaskFileLocation])

  const deleteOriginalFiles = useCallback(async (taskId: string): Promise<boolean> => {
    return deleteOriginalFilesInternal(taskId)
  }, [deleteOriginalFilesInternal])

  const taskStats = useMemo(() => {
    let running = 0
    let completed = 0
    let failed = 0
    for (const task of tasks) {
      if (task.status === "running") running += 1
      else if (task.status === "completed") completed += 1
      else if (task.status === "failed") failed += 1
    }
    return { total: running + completed + failed, running, completed, failed }
  }, [tasks])
  const getTaskStats = useCallback(() => taskStats, [taskStats])

  const isDataStale = useCallback(() => {
    return lastLoadTime > 0 && Date.now() - lastLoadTime > 30000
  }, [lastLoadTime])

  const hasRunningTasks = taskStats.running > 0

  // WebSocket 断线时进度只能靠轮询 /api/tasks 兜底，而轮询只更新任务列表、
  // 不碰 toast。这会导致任务实际早已完成，但「正在导出」toast 一直不消失。
  // 这里让 toast 状态跟随任务状态收敛：凡是还挂着 toast 且已进入终态的任务，
  // 补一次 syncTaskToast 把它更新为完成 / 失败 / 已停止。
  useEffect(() => {
    for (const task of tasks) {
      if (!taskToastIdsRef.current.has(task.id)) continue
      if (completedToastIdsRef.current.has(task.id)) continue
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        syncTaskToast(task)
      }
    }
  }, [tasks, syncTaskToast])

  useEffect(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }

    if (hasRunningTasks) {
      pollingTimerRef.current = setInterval(() => {
        void refreshTasks()
      }, 8000)
    }

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current)
        pollingTimerRef.current = null
      }
    }
  }, [hasRunningTasks, refreshTasks])

  return {
    tasks,
    loading,
    error,
    lastLoadTime,
    loadTasks,
    refreshTasks,
    deleteTask,
    cancelTask,
    createTask,
    updateTaskProgress,
    handleWebSocketProgress,
    handleTaskCancelled,
    handleTaskDeleted,
    applyTaskResync,
    downloadTask,
    deleteOriginalFiles,
    getTaskStats,
    isDataStale,
    setError,
    isJsonlExport,
    openTaskFileLocation,
  }
}
