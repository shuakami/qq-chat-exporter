'use client'

import { useEffect } from 'react'
import AuthManager from '@/lib/auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 在客户端初始化认证
    const authManager = AuthManager.getInstance()
    authManager.initialize()
  }, [])

  return <>{children}</>
}