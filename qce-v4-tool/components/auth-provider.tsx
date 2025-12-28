'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import AuthManager from '@/lib/auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'redirecting'>('checking')
  const [isMounted, setIsMounted] = useState(false)

  // 确保组件在客户端挂载后再渲染，避免 hydration 不匹配
  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

    // 如果是 auth 页面，不需要认证检查
    if (pathname === '/auth' || pathname === '/qce-v4-tool/auth') {
      setAuthState('authenticated')
      return
    }

    // 在客户端初始化认证
    const authManager = AuthManager.getInstance()
    
    // 检查是否已认证
    if (!authManager.isAuthenticated()) {
      // 未认证，显示重定向状态后跳转
      setAuthState('redirecting')
      setTimeout(() => {
        window.location.href = '/qce-v4-tool/auth'
      }, 300)
      return
    }

    // 有本地 token，但需要向后端验证其有效性
    // 这解决了：用户先用独立模式（任意token通过）后用完整模式的问题
    const validateToken = async () => {
      try {
        const response = await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: authManager.getToken() })
        })
        
        const data = await response.json()
        
        if (data.success) {
          // token 有效，初始化 fetch 拦截器
          authManager.initialize()
          setAuthState('authenticated')
        } else {
          // token 无效（可能是独立模式遗留的假token），清除并重定向
          authManager.clearToken()
          setAuthState('redirecting')
          setTimeout(() => {
            window.location.href = '/qce-v4-tool/auth'
          }, 300)
        }
      } catch {
        // 网络错误时，假设后端未启动，允许继续（fetch拦截器会处理后续401）
        authManager.initialize()
        setAuthState('authenticated')
      }
    }
    
    validateToken()
  }, [pathname, isMounted])

  // 服务端渲染和初始客户端渲染时显示简单的加载状态
  // 避免使用 AnimatePresence 导致的 DOM 操作问题
  if (!isMounted || authState === 'checking' || authState === 'redirecting') {
    return (
      <div className="fixed inset-0 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-6">
          <div className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            QQ Chat Exporter
          </div>
          <div className="w-6 h-6 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-600 dark:border-t-neutral-300 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
