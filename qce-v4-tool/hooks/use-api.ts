import { useCallback } from "react"
import type { APIResponse } from "@/types/api"
import AuthManager from "@/lib/auth"

const API_BASE = "http://localhost:40653"

export function useApi() {
  const apiCall = useCallback(async <T,>(endpoint: string, options?: RequestInit): Promise<APIResponse<T>> => {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...options?.headers,
      },
      ...options,
    })

    // 如果返回401或403，清除token并重定向（双重保险）
    if (response.status === 401 || response.status === 403) {
      const authManager = AuthManager.getInstance()
      authManager.clearToken()
      window.location.href = '/qce-v4-tool/auth'
      const data = await response.json()
      throw new Error(data.error?.message || `HTTP ${response.status}`)
    }

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`)
    }

    return data
  }, [])

  const downloadFile = useCallback(async (fileName: string) => {
    const response = await fetch(`${API_BASE}/downloads/${fileName}`)
    if (response.ok) {
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  }, [])

  return {
    apiCall,
    downloadFile,
  }
}