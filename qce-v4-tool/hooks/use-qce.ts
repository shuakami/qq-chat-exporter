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

    // Tasks
    tasks: exportTasks.tasks,
    loadTasks: exportTasks.loadTasks,
    deleteTask: exportTasks.deleteTask,
    createTask: exportTasks.createTask,
    downloadTask: exportTasks.downloadTask,
    deleteOriginalFiles: exportTasks.deleteOriginalFiles,
    getTaskStats: exportTasks.getTaskStats,
    isTaskDataStale: exportTasks.isDataStale,

    // Global States
    isLoading,
    error: hasError,
    setError: exportTasks.setError,
  }
}