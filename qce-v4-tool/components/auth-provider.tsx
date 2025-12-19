'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import AuthManager from '@/lib/auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'redirecting'>('checking')

  useEffect(() => {
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

    // 已认证，初始化 fetch 拦截器
    authManager.initialize()
    // 短暂延迟确保过渡流畅
    setTimeout(() => setAuthState('authenticated'), 100)
  }, [pathname])

  return (
    <AnimatePresence mode="wait">
      {authState === 'checking' && (
        <motion.div
          key="checking"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center z-50"
        >
          <div className="flex flex-col items-center gap-6">
            <div className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              QQ Chat Exporter
            </div>
            <div className="w-6 h-6 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-600 dark:border-t-neutral-300 rounded-full animate-spin" />
          </div>
        </motion.div>
      )}
      
      {authState === 'redirecting' && (
        <motion.div
          key="redirecting"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center z-50"
        >
          <div className="flex flex-col items-center gap-6">
            <div className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              QQ Chat Exporter
            </div>
            <div className="w-6 h-6 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-600 dark:border-t-neutral-300 rounded-full animate-spin" />
          </div>
        </motion.div>
      )}
      
      {authState === 'authenticated' && (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
