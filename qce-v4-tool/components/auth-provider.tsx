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
    //
    // Issue #346：在网络异常 / 中间代理抽风的场景下，POST /auth 可能：
    //   - 长时间 hang 住（CDN / 透明代理在等远端）
    //   - 直接 502 / 503 / 504（代理失败）
    //   - 返回 HTML 错误页，`response.json()` 抛异常
    //   - 返回 `{ success: false }` 但不是真的 token 失效
    // 老逻辑只要 `data.success` 不为 truthy 就清掉本地 token + 跳回 /auth，
    // 一次抽风用户就被踢出登录态。这里改成只有「后端明确告知 token 无效」
    // （HTTP 401 / 403）时才清 token，其它情况一律放行；如果 token 真的失效，
    // 紧接着的 `/api/*` 请求会被 fetch 拦截器以 401/403 兜住、再次跳回 /auth。
    const validateToken = async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: authManager.getToken() }),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (response.status === 401 || response.status === 403) {
          // 后端明确说 token 无效（典型来源：独立模式遗留的假 token、
          // security.json 被重写、或者用户的 IP 不在白名单里）。
          authManager.clearToken()
          setAuthState('redirecting')
          setTimeout(() => {
            window.location.href = '/qce-v4-tool/auth'
          }, 300)
          return
        }

        // 5xx / 非 JSON 响应 / `success !== true`：当作中间代理或后端临时故障，
        // 放过这次校验，让前端继续渲染。后续 API 真要 401/403 再走 fetch 拦截器。
        if (!response.ok) {
          console.warn('[QCE] /auth verify returned non-ok status', response.status)
        }

        authManager.initialize()
        setAuthState('authenticated')
      } catch (err) {
        clearTimeout(timeout)
        // 网络错误 / 超时 / abort：假设后端未启动或代理在抽风，允许继续。
        // fetch 拦截器会在后续 API 请求遇到 401/403 时正确清 token + 跳转。
        console.warn('[QCE] /auth verify failed, allowing continue:', err)
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
