import { Fragment, createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type {
  APIResponse,
  CreateTaskForm,
  CreateTaskRequest,
  CreateTaskResponse,
  ExportTask,
  TasksResponse,
} from "@/types/api"
import { toast, type ToastAction } from "@/components/ui/toast"
import { useApi } from "./use-api"

const GITHUB_URL = "https://github.com/shuakami/qq-chat-exporter"

type TaskStatus = "running" | "completed" | "failed"

type ProgressPayload = {
  taskId: string
  progress: number
  status: TaskStatus
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

function buildCreateToastDescription(form: CreateTaskForm) {
  const sessionSourceLabel = form.sessionSource === "database" ? "本地数据库" : "在线接口"
  const targetLabel = form.sessionName || form.peerUid
  return `正在为 ${targetLabel} 创建导出任务，数据来源：${sessionSourceLabel}`
}

function buildRunningToastDescription(task: ExportTask, data?: ProgressPayload) {
  return data?.message || task.progressMessage || "导出任务已创建，正在等待进度更新"
}

function buildCompletedToastDescription(task: ExportTask, data: ProgressPayload): ReactNode {
  const fileName = data.fileName || task.fileName
  const isStreamingJsonl = isStreamingJsonlFile(fileName)
  const isStreamingZip = isStreamingZipFile(fileName)
  const isZipExport = data.isZipExport ?? task.isZipExport
  const originalFilePath = data.originalFilePath ?? task.originalFilePath
  const isHtmlExport = task.format?.toUpperCase() === "HTML" && !isStreamingZip

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
    progress: data.progress,
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
  }
}

function mergeTask(task: ExportTask, data: ProgressPayload): ExportTask {
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

export function useExportTasks(_props?: UseExportTasksProps) {
  const [tasks, setTasks] = useState<ExportTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadTime, setLastLoadTime] = useState<number>(0)
  const { apiCall, downloadFile } = useApi()
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const taskToastIdsRef = useRef(new Map<string, string>())
  const tasksRef = useRef<ExportTask[]>([])

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

  const syncTaskToast = useCallback((task: ExportTask, data?: ProgressPayload) => {
    let toastId = taskToastIdsRef.current.get(task.id)

    if (!toastId) {
      toastId = toast.loading("正在导出", {
        description: buildRunningToastDescription(task, data),
        duration: Infinity,
      })
      taskToastIdsRef.current.set(task.id, toastId)
    }

    if (task.status === "completed") {
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

      toast.update(toastId, {
        type: "success",
        title: "导出完成~",
        description: buildCompletedToastDescription(task, payload),
        actions,
        duration: actions.length > 0 ? Infinity : 8000,
      })
      return
    }

    if (task.status === "failed") {
      toast.update(toastId, {
        type: "error",
        title: "导出失败",
        description: buildFailedToastDescription(task, data),
        actions: undefined,
        duration: 8000,
      })
      return
    }

    toast.update(toastId, {
      type: "loading",
      title: "正在导出",
      description: buildRunningToastDescription(task, data),
      actions: undefined,
      duration: Infinity,
    })
  }, [buildCompletedActions])

  const loadTasks = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true)
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        setTasks(response.data.tasks)
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
  }, [apiCall])

  const refreshTasks = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        setTasks(response.data.tasks)
        setLastLoadTime(Date.now())
        return true
      }

      console.warn("[QCE] Silent refresh failed:", response.error?.message || "获取任务列表失败")
      return false
    } catch (err) {
      console.warn("[QCE] Silent refresh error:", err instanceof Error ? err.message : "未知错误")
      return false
    }
  }, [apiCall])

  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}`, {
        method: "DELETE",
      })

      if (response.success) {
        dismissTaskToast(taskId)
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
  }, [apiCall, dismissTaskToast])

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

      const sessionSource = form.sessionSource ?? "api"
      const useStreamingMode = sessionSource !== "database" && form.streamingZipMode === true
      const isJsonFormat = form.format === "JSON"

      const requestBody: CreateTaskRequest = {
        peer: {
          chatType: form.chatType,
          peerUid: form.peerUid,
          guildId: "",
        },
        sessionName: form.sessionName,
        sessionSource,
        format: useStreamingMode
          ? (isJsonFormat ? "STREAMING_JSONL" : "STREAMING_ZIP")
          : form.format,
        filter: {
          ...(form.startTime && { startTime: Math.floor(new Date(form.startTime).getTime() / 1000) }),
          ...(form.endTime && { endTime: Math.floor(new Date(form.endTime).getTime() / 1000) }),
          ...(form.keywords && { keywords: form.keywords.split(",").map((keyword) => keyword.trim()) }),
          ...(form.excludeUserUins && {
            excludeUserUins: form.excludeUserUins.split(",").map((uin) => uin.trim()).filter(Boolean),
          }),
          includeRecalled: form.includeRecalled,
        },
        options: {
          batchSize: useStreamingMode ? 3000 : 5000,
          includeResourceLinks: true,
          includeSystemMessages: form.includeSystemMessages,
          filterPureImageMessages: form.filterPureImageMessages,
          prettyFormat: true,
          exportAsZip: form.exportAsZip,
          embedAvatarsAsBase64: form.embedAvatarsAsBase64,
          ...(form.outputDir?.trim() && { outputDir: form.outputDir.trim() }),
          ...(form.useNameInFileName && { useNameInFileName: true }),
        },
      }

      let apiEndpoint = "/api/messages/export"
      if (useStreamingMode) {
        apiEndpoint = isJsonFormat
          ? "/api/messages/export-streaming-jsonl"
          : "/api/messages/export-streaming-zip"
      }

      const response = await apiCall(apiEndpoint, {
        method: "POST",
        body: JSON.stringify(requestBody),
      }) as APIResponse<CreateTaskResponse>

      if (response.success && response.data) {
        const taskId = response.data.taskId || `task_${Date.now()}`
        const newTask: ExportTask = {
          id: taskId,
          peer: requestBody.peer,
          sessionName: form.sessionName,
          sessionSource,
          status: "running",
          progress: 0,
          format: form.format,
          startTime: form.startTime ? Math.floor(new Date(form.startTime).getTime() / 1000) : undefined,
          endTime: form.endTime ? Math.floor(new Date(form.endTime).getTime() / 1000) : undefined,
          keywords: form.keywords || undefined,
          includeRecalled: form.includeRecalled,
          messageCount: response.data.messageCount,
          fileName: response.data.fileName,
          downloadUrl: response.data.downloadUrl,
          createdAt: new Date().toISOString(),
          progressMessage: "导出任务已创建，正在等待进度更新",
        }

        const existingToastId = taskToastIdsRef.current.get(taskId)
        const toastId = existingToastId || creatingToastId

        if (existingToastId && existingToastId !== creatingToastId) {
          toast.dismiss(creatingToastId)
        }

        taskToastIdsRef.current.set(taskId, toastId)
        toast.update(toastId, {
          type: "loading",
          title: "正在导出",
          description: "导出任务已创建，正在等待进度更新",
          duration: Infinity,
        })

        setTasks((prev) => [newTask, ...prev])
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
  }, [apiCall])

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
      const next = prev.map((task) => task.id === taskId ? mergeTask(task, payload) : task)
      tasksRef.current = next
      return next
    })
  }, [])

  const handleWebSocketProgress = useCallback((data: ProgressPayload) => {
    console.log("[QCE] handleWebSocketProgress received:", {
      taskId: data.taskId,
      status: data.status,
      filePath: data.filePath,
      fileName: data.fileName,
      hasFilePath: !!data.filePath,
    })

    let updatedTask: ExportTask | undefined

    setTasks((prev) => {
      const next = prev.map((task) => {
        if (task.id !== data.taskId) return task
        const nextTask = mergeTask(task, data)
        updatedTask = nextTask
        return nextTask
      })
      tasksRef.current = next
      return next
    })

    const resolvedTask = updatedTask
      || tasksRef.current.find((task) => task.id === data.taskId)
      || createFallbackTask(data)

    syncTaskToast(resolvedTask, data)
  }, [syncTaskToast])

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
      await downloadFile(task.fileName)
    } catch (err) {
      const errorMessage = `下载失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Download error:", err)
    }
  }, [downloadFile, isJsonlExport, openTaskFileLocation])

  const deleteOriginalFiles = useCallback(async (taskId: string): Promise<boolean> => {
    return deleteOriginalFilesInternal(taskId)
  }, [deleteOriginalFilesInternal])

  const getTaskStats = useCallback(() => {
    return {
      total: tasks.length,
      running: tasks.filter((task) => task.status === "running").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    }
  }, [tasks])

  const isDataStale = useCallback(() => {
    return lastLoadTime > 0 && Date.now() - lastLoadTime > 30000
  }, [lastLoadTime])

  useEffect(() => {
    const hasRunningTasks = tasks.some((task) => task.status === "running")

    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }

    if (hasRunningTasks && tasks.length > 0) {
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
  }, [tasks, refreshTasks])

  return {
    tasks,
    loading,
    error,
    lastLoadTime,
    loadTasks,
    refreshTasks,
    deleteTask,
    createTask,
    updateTaskProgress,
    handleWebSocketProgress,
    downloadTask,
    deleteOriginalFiles,
    getTaskStats,
    isDataStale,
    setError,
    isJsonlExport,
    openTaskFileLocation,
  }
}
