import { useState, useCallback } from "react"
import type { EssenceMessage, EssenceMessagesResponse, EssenceExportResponse } from "@/types/api"
import { useApi } from "./use-api"

export function useGroupEssence() {
  const [messages, setMessages] = useState<EssenceMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { apiCall } = useApi()

  const loadEssenceMessages = useCallback(async (groupCode: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await apiCall<EssenceMessagesResponse>(`/api/groups/${groupCode}/essence`)

      if (response.success && response.data) {
        setMessages(response.data.messages || [])
        return response.data
      } else {
        throw new Error(response.error?.message || '获取精华消息失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误"
      setError(errorMessage)
      console.error("[QCE] Load essence messages error:", err)
      return null
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  const exportEssenceMessages = useCallback(async (
    groupCode: string,
    format: 'json' | 'html' = 'json'
  ): Promise<EssenceExportResponse | null> => {
    try {
      setExporting(true)
      setError(null)

      const response = await apiCall<EssenceExportResponse>(`/api/groups/${groupCode}/essence/export`, {
        method: 'POST',
        body: JSON.stringify({ format })
      })

      if (response.success && response.data) {
        return response.data
      } else {
        throw new Error(response.error?.message || '导出精华消息失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误"
      setError(errorMessage)
      console.error("[QCE] Export essence messages error:", err)
      return null
    } finally {
      setExporting(false)
    }
  }, [apiCall])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    loading,
    exporting,
    error,
    loadEssenceMessages,
    exportEssenceMessages,
    clearMessages,
    setError,
  }
}
