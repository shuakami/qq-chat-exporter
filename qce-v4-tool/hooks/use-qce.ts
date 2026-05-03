import { useEffect } from "react"
import { useWebSocket } from "./use-websocket"
import { useSystemInfo } from "./use-system-info"
import { useChatData } from "./use-chat-data"
import { useExportTasks, type UseExportTasksProps } from "./use-export-tasks"

/**
 * Main QCE hook that combines all functionality
 * This is the primary hook for the QCE Dashboard
 */
export function useQCE(props?: { onNotification?: UseExportTasksProps['onNotification'] }) {
  const systemInfo = useSystemInfo()
  const chatData = useChatData()
  const exportTasks = useExportTasks({ onNotification: props?.onNotification })

  // WebSocket integration
  const websocket = useWebSocket({
    onExportProgress: (data) => {
      // Legacy progress message support
      const status = data.status as "running" | "completed" | "failed"
      exportTasks.updateTaskProgress(data.taskId, data.progress, status)
    },
    onProgressUpdate: (data) => {
      // New progress message format
      exportTasks.handleWebSocketProgress(data)
    },
    onTaskResync: (data) => {
      // Issue #144: 服务端在 WS 一连上就推一份当前任务状态全量；先把已
      // 知任务的 status / progress 用服务端真值对齐，再触发一次 REST 全
      // 量拉取，把可能新增 / 完成 / 失败的任务列表彻底刷一遍。
      exportTasks.applyTaskResync(data.tasks)
      exportTasks.loadTasks().catch((error) => {
        console.error("[QCE] task_resync 触发的 loadTasks 失败:", error)
      })
    },
    onError: (error) => {
      if (error) {
        console.error("[QCE] WebSocket error:", error)
      }
    },
  })

  // Load initial data
  useEffect(() => {
    systemInfo.loadSystemInfo()
  }, [systemInfo.loadSystemInfo])

  // Combined error state
  const hasError = systemInfo.error || chatData.error || exportTasks.error
  const isLoading = systemInfo.loading || chatData.loading || exportTasks.loading

  return {
    // System
    systemInfo: systemInfo.systemInfo,
    refreshSystemInfo: systemInfo.refreshSystemInfo,

    // WebSocket
    wsConnected: websocket.connected,

    // Chat Data
    groups: chatData.groups,
    friends: chatData.friends,
    loadChatData: chatData.loadAll,
    exportGroupAvatars: chatData.exportGroupAvatars,
    avatarExportLoading: chatData.avatarExportLoading,
    recentActivityMap: chatData.recentActivityMap,

    // Tasks
    tasks: exportTasks.tasks,
    loadTasks: exportTasks.loadTasks,
    deleteTask: exportTasks.deleteTask,
    createTask: exportTasks.createTask,
    downloadTask: exportTasks.downloadTask,
    deleteOriginalFiles: exportTasks.deleteOriginalFiles,
    getTaskStats: exportTasks.getTaskStats,
    isTaskDataStale: exportTasks.isDataStale,
    isJsonlExport: exportTasks.isJsonlExport,
    openTaskFileLocation: exportTasks.openTaskFileLocation,

    // Global States
    isLoading,
    error: hasError,
    setError: exportTasks.setError,
  }
}