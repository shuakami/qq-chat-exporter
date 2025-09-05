import { useCallback } from "react"
import type { APIResponse } from "@/types/api"

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