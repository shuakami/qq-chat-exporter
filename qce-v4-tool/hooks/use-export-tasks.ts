import { useState, useCallback, useEffect, useRef } from "react"
import type { ExportTask, CreateTaskForm, CreateTaskRequest, TasksResponse, CreateTaskResponse, APIResponse } from "@/types/api"
import { useApi } from "./use-api"

export interface UseExportTasksProps {
  onNotification?: (notification: { 
    type: 'success' | 'error' | 'info', 
    title: string, 
    message: string,
    actions?: Array<{
      label: string
      onClick: () => void
      variant?: 'default' | 'destructive'
    }>
  }) => void
}

export function useExportTasks(props?: UseExportTasksProps) {
  const [tasks, setTasks] = useState<ExportTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadTime, setLastLoadTime] = useState<number>(0)
  const { apiCall, downloadFile } = useApi()
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const onNotificationRef = useRef(props?.onNotification)
  
  // Update notification callback ref when props change
  useEffect(() => {
    onNotificationRef.current = props?.onNotification
  }, [props?.onNotification])

  // Load all tasks from server
  const loadTasks = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true)
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        setTasks(response.data.tasks)
        setLastLoadTime(Date.now())
        return true
      } else {
        setError(response.error?.message || "获取任务列表失败")
        return false
      }
    } catch (err) {
      const errorMessage = `获取任务列表失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Load tasks error:", err)
      return false
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  // Silent refresh tasks (without loading state for polling)
  const refreshTasks = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall("/api/tasks") as APIResponse<TasksResponse>

      if (response.success && response.data) {
        setTasks(response.data.tasks)
        setLastLoadTime(Date.now())
        return true
      } else {
        // Don't show error for silent refresh
        console.warn("[QCE] Silent refresh failed:", response.error?.message || "获取任务列表失败")
        return false
      }
    } catch (err) {
      // Don't show error for silent refresh
      console.warn("[QCE] Silent refresh error:", err instanceof Error ? err.message : "未知错误")
      return false
    }
  }, [apiCall])

  // Delete a specific task
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}`, {
        method: "DELETE",
      })

      if (response.success) {
        setTasks((prev) => prev.filter((task) => task.id !== taskId))
        return true
      } else {
        setError(response.error?.message || "删除任务失败")
        return false
      }
    } catch (err) {
      const errorMessage = `删除任务失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Delete task error:", err)
      return false
    }
  }, [apiCall])

  const createTask = useCallback(async (form: CreateTaskForm): Promise<boolean> => {
    if (!form.peerUid || !form.sessionName) {
      setError("请填写完整信息")
      return false
    }

    try {
      setLoading(true)
      setError(null)

      const requestBody: CreateTaskRequest = {
        peer: {
          chatType: form.chatType,
          peerUid: form.peerUid,
          guildId: "",
        },
        sessionName: form.sessionName,
        format: form.format,
        filter: {
          ...(form.startTime && { startTime: Math.floor(new Date(form.startTime).getTime() / 1000) }),
          ...(form.endTime && { endTime: Math.floor(new Date(form.endTime).getTime() / 1000) }),
          ...(form.keywords && { keywords: form.keywords.split(",").map((k) => k.trim()) }),
          includeRecalled: form.includeRecalled,
        },
        options: {
          batchSize: 5000,
          includeResourceLinks: true,
          includeSystemMessages: form.includeSystemMessages,
          filterPureImageMessages: form.filterPureImageMessages,
          prettyFormat: true,
          exportAsZip: form.exportAsZip,
        },
      }

      const response = await apiCall("/api/messages/export", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }) as APIResponse<CreateTaskResponse>

      if (response.success && response.data) {
        const newTask: ExportTask = {
          id: response.data.taskId || `task_${Date.now()}`,
          peer: requestBody.peer,
          sessionName: form.sessionName,
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
        }

        setTasks((prev) => [newTask, ...prev])
        return true
      }
      return false
    } catch (err) {
      const errorMessage = `创建任务失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Create task error:", err)
      return false
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  // Update task progress (called from WebSocket messages)
  const updateTaskProgress = useCallback((
    taskId: string, 
    progress: number, 
    status: "running" | "completed" | "failed",
    additionalData?: {
      error?: string
      fileName?: string
      downloadUrl?: string
      completedAt?: string
    }
  ) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId 
          ? { 
              ...task, 
              progress, 
              status,
              ...(additionalData?.error && { error: additionalData.error }),
              ...(additionalData?.fileName && { fileName: additionalData.fileName }),
              ...(additionalData?.downloadUrl && { downloadUrl: additionalData.downloadUrl }),
              ...(additionalData?.completedAt && { completedAt: additionalData.completedAt }),
            }
          : task
      )
    )
  }, [])

  // Handle WebSocket progress messages
  const handleWebSocketProgress = useCallback((data: {
    taskId: string
    progress: number
    status: "running" | "completed" | "failed"
    error?: string
    fileName?: string
    downloadUrl?: string
    completedAt?: string
    isZipExport?: boolean
    originalFilePath?: string
    filePath?: string
  }) => {
    updateTaskProgress(data.taskId, data.progress, data.status, {
      error: data.error,
      fileName: data.fileName,
      downloadUrl: data.downloadUrl,
      completedAt: data.completedAt,
    })

    // 更新任务的isZipExport和originalFilePath
    if (data.status === "completed") {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === data.taskId
            ? { 
                ...task, 
                ...(data.isZipExport !== undefined && { isZipExport: data.isZipExport }),
                ...(data.originalFilePath !== undefined && { originalFilePath: data.originalFilePath })
              }
            : task
        )
      )

      // 获取任务信息以判断格式
      const completedTask = tasks.find(t => t.id === data.taskId)
      const isHtmlExport = completedTask?.format?.toUpperCase() === 'HTML'

      // 如果是HTML导出（非ZIP），显示使用提示
      if (isHtmlExport && data.isZipExport !== true && data.filePath) {
        onNotificationRef.current?.({
          type: 'info',
          title: 'HTML导出完成',
          message: '请在导出目录直接打开HTML文件，图片才能正常显示',
          actions: [
            {
              label: '打开文件位置',
              onClick: async () => {
                try {
                  await apiCall(`/api/open-file-location`, {
                    method: 'POST',
                    body: JSON.stringify({ filePath: data.filePath })
                  })
                } catch (err) {
                  console.error('打开文件位置失败:', err)
                }
              }
            },
            {
              label: '我知道了',
              onClick: () => {
                // 关闭通知
              }
            }
          ]
        })
      }
      // 如果是ZIP导出且有原始文件路径，显示通知询问是否删除
      else if (data.isZipExport === true && data.originalFilePath) {
        onNotificationRef.current?.({
          type: 'success',
          title: 'ZIP导出完成力',
          message: '是否删除原始HTML文件和资源文件？',
          actions: [
            {
              label: '删除原文件',
              variant: 'destructive',
              onClick: async () => {
                try {
                  const response = await apiCall(`/api/tasks/${data.taskId}/original-files`, {
                    method: "DELETE",
                  })
                  if (response.success) {
                    setTasks((prev) =>
                      prev.map((task) =>
                        task.id === data.taskId 
                          ? { ...task, originalFilePath: undefined }
                          : task
                      )
                    )
                    onNotificationRef.current?.({
                      type: 'success',
                      title: '删除成功',
                      message: '原始文件已删除'
                    })
                  } else {
                    onNotificationRef.current?.({
                      type: 'error',
                      title: '删除失败',
                      message: '删除原始文件失败'
                    })
                  }
                } catch (err) {
                  onNotificationRef.current?.({
                    type: 'error',
                    title: '删除失败',
                    message: err instanceof Error ? err.message : "未知错误"
                  })
                }
              }
            },
            {
              label: '保留原文件',
              onClick: () => {
                // 仅关闭通知，不做任何操作
              }
            }
          ]
        })
      }
    }
  }, [updateTaskProgress, apiCall, setTasks, tasks])

  const downloadTask = useCallback(async (task: ExportTask) => {
    if (!task.fileName) return

    try {
      await downloadFile(task.fileName)
    } catch (err) {
      const errorMessage = `下载失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Download error:", err)
    }
  }, [downloadFile])

  const deleteOriginalFiles = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await apiCall(`/api/tasks/${taskId}/original-files`, {
        method: "DELETE",
      })

      if (response.success) {
        // 更新任务状态，移除originalFilePath
        setTasks((prev) =>
          prev.map((task) =>
            task.id === taskId 
              ? { ...task, originalFilePath: undefined }
              : task
          )
        )
        return true
      } else {
        setError(response.error?.message || "删除原始文件失败")
        return false
      }
    } catch (err) {
      const errorMessage = `删除原始文件失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Delete original files error:", err)
      return false
    }
  }, [apiCall])

  const getTaskStats = useCallback(() => {
    return {
      total: tasks.length,
      running: tasks.filter((t) => t.status === "running").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
    }
  }, [tasks])

  // Check if data is stale (older than 30 seconds)
  const isDataStale = useCallback(() => {
    return lastLoadTime > 0 && Date.now() - lastLoadTime > 30000
  }, [lastLoadTime])

  // Auto-polling for running tasks (silent refresh)
  useEffect(() => {
    const hasRunningTasks = tasks.some(task => task.status === "running")
    
    // Clear existing timer
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }

    // Start polling only if there are running tasks
    if (hasRunningTasks && tasks.length > 0) {
      pollingTimerRef.current = setInterval(() => {
        refreshTasks()
      }, 8000) // Poll every 8 seconds for silent refresh
    }

    // Cleanup on unmount or when dependencies change
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
  }
}