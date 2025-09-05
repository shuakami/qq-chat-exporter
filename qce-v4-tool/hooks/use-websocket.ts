import { useCallback, useEffect, useState, useRef } from "react"
import type { WebSocketMessage, ExportProgressMessage, NotificationMessage, WebSocketProgressMessage } from "@/types/api"

interface UseWebSocketProps {
  onMessage?: (data: WebSocketMessage) => void
  onExportProgress?: (data: ExportProgressMessage['data']) => void
  onProgressUpdate?: (data: WebSocketProgressMessage['data']) => void
  onNotification?: (data: NotificationMessage['data']) => void
  onError?: (error: string | null) => void
}

export function useWebSocket({
  onMessage,
  onExportProgress,
  onProgressUpdate,
  onNotification,
  onError,
}: UseWebSocketProps = {}) {
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  
  // Use refs to store the latest callback functions to avoid recreating connect function
  const callbacksRef = useRef({
    onMessage,
    onExportProgress,
    onProgressUpdate,
    onNotification,
    onError,
  })
  
  // Update the ref whenever callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onMessage,
      onExportProgress,
      onProgressUpdate,
      onNotification,
      onError,
    }
  }, [onMessage, onExportProgress, onProgressUpdate, onNotification, onError])

  const connect = useCallback(() => {
    // Don't create new connection if one already exists
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    const websocket = new WebSocket("ws://localhost:40653")

    websocket.onopen = () => {
      console.log("[QCE] WebSocket connected")
      setConnected(true)
      callbacksRef.current.onError?.(null)
    }

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log("[QCE] WebSocket message:", data)

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
        } else if (data.type === "notification") {
          callbacksRef.current.onNotification?.(data.data)
        }
      } catch (err) {
        console.error("[QCE] WebSocket message parse error:", err)
      }
    }

    websocket.onerror = (error) => {
      console.error("[QCE] WebSocket error:", error)
      setConnected(false)
      callbacksRef.current.onError?.("WebSocket连接失败")
    }

    websocket.onclose = () => {
      console.log("[QCE] WebSocket disconnected")
      setConnected(false)
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        connect()
      }, 5000)
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
    connect()
    return () => {
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