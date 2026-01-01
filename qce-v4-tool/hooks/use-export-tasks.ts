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

      // 判断是否使用流式导出模式
      const useStreamingMode = form.streamingZipMode === true
      const isJsonFormat = form.format === 'JSON'

      const requestBody: CreateTaskRequest = {
        peer: {
          chatType: form.chatType,
          peerUid: form.peerUid,
          guildId: "",
        },
        sessionName: form.sessionName,
        format: useStreamingMode 
          ? (isJsonFormat ? 'STREAMING_JSONL' : 'STREAMING_ZIP') 
          : form.format,
        filter: {
          ...(form.startTime && { startTime: Math.floor(new Date(form.startTime).getTime() / 1000) }),
          ...(form.endTime && { endTime: Math.floor(new Date(form.endTime).getTime() / 1000) }),
          ...(form.keywords && { keywords: form.keywords.split(",").map((k) => k.trim()) }),
          ...(form.excludeUserUins && { excludeUserUins: form.excludeUserUins.split(",").map((u) => u.trim()).filter(u => u) }),
          includeRecalled: form.includeRecalled,
        },
        options: {
          batchSize: useStreamingMode ? 3000 : 5000, // 流式模式使用较小批次
          includeResourceLinks: true,
          includeSystemMessages: form.includeSystemMessages,
          filterPureImageMessages: form.filterPureImageMessages,
          prettyFormat: true,
          exportAsZip: form.exportAsZip,
          embedAvatarsAsBase64: form.embedAvatarsAsBase64,
          // Issue #192: 传递自定义导出路径
          ...(form.outputDir?.trim() && { outputDir: form.outputDir.trim() }),
          // Issue #216: 传递是否在文件名中包含聊天名称
          ...(form.useNameInFileName && { useNameInFileName: true }),
        },
      }

      // 根据模式和格式选择不同的API端点
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
      filePath?: string
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
              ...(additionalData?.filePath && { filePath: additionalData.filePath }),
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
    message?: string
    messageCount?: number
    error?: string
    fileName?: string
    downloadUrl?: string
    completedAt?: string
    isZipExport?: boolean
    originalFilePath?: string
    filePath?: string
  }) => {
    console.log('[QCE] handleWebSocketProgress received:', {
      taskId: data.taskId,
      status: data.status,
      filePath: data.filePath,
      fileName: data.fileName,
      hasFilePath: !!data.filePath
    })
    
    // Update task with all available data including messageCount and message
    setTasks((prev) =>
      prev.map((task) =>
        task.id === data.taskId 
          ? { 
              ...task, 
              progress: data.progress, 
              status: data.status,
              ...(data.messageCount !== undefined && { messageCount: data.messageCount }),
              ...(data.message && { progressMessage: data.message }),
              ...(data.error && { error: data.error }),
              ...(data.fileName && { fileName: data.fileName }),
              ...(data.filePath && { filePath: data.filePath }),
              ...(data.downloadUrl && { downloadUrl: data.downloadUrl }),
              ...(data.completedAt && { completedAt: data.completedAt }),
            }
          : task
      )
    )

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
      // 注意：优先通过文件名判断，因为任务创建时 format 可能存的是原始格式
      const isStreamingJsonl = data.fileName?.includes('_chunked_jsonl') || data.fileName?.includes('chunked_jsonl')
      const isStreamingZip = data.fileName?.includes('_streaming.zip') || data.fileName?.endsWith('_streaming.zip')
      
      const completedTask = tasks.find(t => t.id === data.taskId)
      const taskFormat = completedTask?.format?.toUpperCase() || ''
      const isHtmlExport = taskFormat === 'HTML' && !isStreamingZip
      
      console.log('[QCE] Task completed:', { 
        taskId: data.taskId, 
        fileName: data.fileName, 
        filePath: data.filePath,
        isStreamingJsonl, 
        isStreamingZip, 
        isHtmlExport,
        taskFormat
      })

      // 如果是流式JSONL导出，显示使用说明
      if (isStreamingJsonl && data.filePath) {
        onNotificationRef.current?.({
          type: 'success',
          title: 'JSONL 分块导出完成',
          message: '大规模数据已分块保存，点击查看使用方法',
          actions: [
            {
              label: '查看使用方法',
              onClick: () => {
                // 触发显示JSONL帮助模态框的事件
                window.dispatchEvent(new CustomEvent('show-jsonl-help', { detail: { filePath: data.filePath } }))
              }
            },
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
            }
          ]
        })
      }
      // 如果是流式ZIP导出，显示使用说明
      else if (isStreamingZip && data.filePath) {
        onNotificationRef.current?.({
          type: 'success',
          title: '流式 ZIP 导出完成',
          message: '大规模数据已打包完成，点击查看使用方法',
          actions: [
            {
              label: '查看使用方法',
              onClick: () => {
                // 触发显示流式ZIP帮助模态框的事件
                window.dispatchEvent(new CustomEvent('show-streaming-zip-help', { detail: { filePath: data.filePath } }))
              }
            },
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
            }
          ]
        })
      }
      // 如果是HTML导出（非ZIP），显示使用提示
      else if (isHtmlExport && data.isZipExport !== true && data.filePath) {
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