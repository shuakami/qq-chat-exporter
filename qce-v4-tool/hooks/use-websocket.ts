import { useCallback, useEffect, useState, useRef } from "react"
import type {
  WebSocketMessage,
  ExportProgressMessage,
  NotificationMessage,
  WebSocketProgressMessage,
  WebSocketTaskResyncMessage,
  ExportTask,
} from "@/types/api"

interface UseWebSocketProps {
  onMessage?: (data: WebSocketMessage) => void
  onExportProgress?: (data: ExportProgressMessage['data']) => void
  onProgressUpdate?: (data: WebSocketProgressMessage['data']) => void
  onNotification?: (data: NotificationMessage['data']) => void
  /**
   * Issue #144: 服务端在 WebSocket 一连上就推一份当前内存里的任务状态
   * 全量。前端拿到后可以立刻把任务列表里的 status / progress 对齐，无需
   * 等下一条 export_progress 才有反应。
   */
  onTaskResync?: (data: WebSocketTaskResyncMessage['data']) => void
  onTaskCancelled?: (data: ExportTask) => void
  onError?: (error: string | null) => void
}

const BASE_RECONNECT_MS = 2000
const MAX_RECONNECT_MS = 30000

export function useWebSocket({
  onMessage,
  onExportProgress,
  onProgressUpdate,
  onNotification,
  onTaskResync,
  onTaskCancelled,
  onError,
}: UseWebSocketProps = {}) {
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  // 重连状态：指数退避 + 断线期间只打一条日志，避免服务未启动时刷屏。
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const failureLogged = useRef(false)
  const unmounted = useRef(false)
  
  // Use refs to store the latest callback functions to avoid recreating connect function
  const callbacksRef = useRef({
    onMessage,
    onExportProgress,
    onProgressUpdate,
    onNotification,
    onTaskResync,
    onTaskCancelled,
    onError,
  })
  
  // Update the ref whenever callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onExportProgress,
      onProgressUpdate,
      onNotification,
      onTaskResync,
      onTaskCancelled,
      onError,
    }
  }, [onMessage, onExportProgress, onProgressUpdate, onNotification, onTaskResync, onTaskCancelled, onError])

  const connect = useCallback(() => {
    // Don't create new connection if one already exists
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const websocket = new WebSocket(`${wsProtocol}//${window.location.host}`)

    websocket.onopen = () => {
      console.log("[QCE] WebSocket connected")
      reconnectAttempts.current = 0
      failureLogged.current = false
      setConnected(true)
      callbacksRef.current.onError?.(null)
    }

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // Call generic message handler
        callbacksRef.current.onMessage?.(data)

        // Handle specific message types
        if (data.type === "notification" && data.data?.message === "WebSocket连接成功") {
          setConnected(true)
          callbacksRef.current.onError?.(null)
          callbacksRef.current.onNotification?.(data.data)
        } else if (data.type === "exportProgress") {
          // Legacy progress message
          callbacksRef.current.onExportProgress?.(data.data)
        } else if (data.type === "export_progress" || data.type === "export_complete" || data.type === "export_error") {
          // New progress message format
          callbacksRef.current.onProgressUpdate?.(data.data)
        } else if (data.type === "task_resync") {
          // Issue #144: 服务端 WebSocket 连上后下发的任务状态全量同步
          callbacksRef.current.onTaskResync?.(data.data)
        } else if (data.type === "task_cancelled") {
          callbacksRef.current.onTaskCancelled?.(data.data)
        } else if (data.type === "notification") {
          callbacksRef.current.onNotification?.(data.data)
        }
      } catch (err) {
        console.error("[QCE] WebSocket message parse error:", err)
      }
    }

    websocket.onerror = () => {
      setConnected(false)
      callbacksRef.current.onError?.("WebSocket连接失败")
      if (!failureLogged.current) {
        console.warn("[QCE] WebSocket 连接失败，将自动重连")
        failureLogged.current = true
      }
    }

    websocket.onclose = () => {
      setConnected(false)
      if (unmounted.current) {
        return
      }
      // 指数退避重连（上限 30s），持续断开时不再逐次刷日志。
      const delay = Math.min(
        BASE_RECONNECT_MS * 2 ** reconnectAttempts.current,
        MAX_RECONNECT_MS,
      )
      reconnectAttempts.current += 1
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      reconnectTimer.current = setTimeout(() => {
        connect()
      }, delay)
    }

    setWs(websocket)
  }, [ws])

  const disconnect = useCallback(() => {
    if (ws) {
      ws.close()
      setWs(null)
      setConnected(false)
    }
  }, [ws])

  const sendMessage = useCallback((message: any) => {
    if (ws && connected) {
      ws.send(JSON.stringify(message))
    }
  }, [ws, connected])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      if (ws) {
        ws.close()
      }
    }
    // Only run once on mount
  }, [])

  return {
    connected,
    connect,
    disconnect,
    sendMessage,
  }
}