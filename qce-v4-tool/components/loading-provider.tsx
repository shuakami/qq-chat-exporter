"use client"

import { createContext, useContext, useState } from "react"

interface LoadingContextType {
  isLoading: boolean
  setLoading: (loading: boolean) => void
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined)

export function useLoading() {
  const context = useContext(LoadingContext)
  if (context === undefined) {
    throw new Error("useLoading must be used within a LoadingProvider")
  }
  return context
}

/**
 * 加载态上下文。启动遮罩由 `AuthProvider` 统一负责（认证校验期间显示，
 * 校验完成即淡出）；这里不再渲染第二个首访 splash，避免出现「大 / 小两个
 * 遮罩、跳动两次」。
 */
export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false)

  return (
    <LoadingContext.Provider value={{ isLoading, setLoading: setIsLoading }}>
      {children}
    </LoadingContext.Provider>
  )
}
