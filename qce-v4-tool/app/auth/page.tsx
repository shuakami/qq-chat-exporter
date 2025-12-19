'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, X, Eye, EyeOff, Lock, ExternalLink } from 'lucide-react'
import AuthManager from '@/lib/auth'

export default function AuthPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const authManager = AuthManager.getInstance()
    if (authManager.isAuthenticated()) {
      window.location.href = '/qce-v4-tool'
    } else {
      setTimeout(() => setIsReady(true), 600)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) {
      setError('请输入访问令牌')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })

      const data = await response.json()

      if (data.success) {
        const authManager = AuthManager.getInstance()
        authManager.setToken(token.trim())
        window.location.href = '/qce-v4-tool'
      } else {
        setError(data.error?.message || '令牌验证失败')
      }
    } catch {
      setError('无法连接到服务器，请确保 NapCat 正在运行')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-4">
      <AnimatePresence mode="wait">
        {!isReady ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              QQ Chat Exporter
            </div>
            <div className="w-6 h-6 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-600 dark:border-t-neutral-300 rounded-full animate-spin" />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className="w-full max-w-md"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">访问验证</h1>
              <p className="text-neutral-500 dark:text-neutral-400 mt-2">请输入访问令牌以继续使用</p>
            </div>

            {/* Form Card */}
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 shadow-sm">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    访问令牌
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="粘贴您的访问令牌"
                      className="w-full pl-10 pr-12 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-800 focus:border-neutral-400 dark:focus:border-neutral-600 focus:outline-none transition-colors text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
                    >
                      {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 text-sm"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      验证并进入
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <button
                onClick={() => setShowHelp(true)}
                className="w-full mt-4 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
              >
                找不到令牌？
              </button>
            </div>

            {/* Footer */}
            <div className="mt-6 text-center">
              <a
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                QQ Chat Exporter
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {showHelp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowHelp(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-neutral-900 rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100">如何获取令牌</h3>
                <button
                  onClick={() => setShowHelp(false)}
                  className="p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-5">
                <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  令牌是一串随机字符，用来验证你的身份。每次启动 NapCat 时会自动生成一个新的。
                </p>

                <div className="space-y-3">
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">去哪找？</p>
                  <p className="text-neutral-600 dark:text-neutral-400 text-sm leading-relaxed">
                    打开 NapCat 的黑色控制台窗口，往上翻一翻，找到带有 <span className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-700 dark:text-neutral-300">[QCE] Token:</span> 的那一行，后面那串字符就是了。
                  </p>
                </div>

                {/* Console Example */}
                <div className="rounded-xl bg-neutral-900 dark:bg-neutral-950 p-4 font-mono text-xs overflow-x-auto">
                  <div className="text-neutral-400">[QCE] QQChatExporter v5.0.0</div>
                  <div className="text-green-400">[QCE] Token: WgZt3v*UMTqT#i!qleEO!76n02Y^ns$X</div>
                  <div className="text-neutral-500">[QCE] Web界面: http://127.0.0.1:40653/qce-v4-tool</div>
                </div>

                <p className="text-neutral-400 dark:text-neutral-500 text-xs">
                  复制 Token 那行冒号后面的内容，粘贴到输入框即可。
                </p>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                <button
                  onClick={() => setShowHelp(false)}
                  className="w-full py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                  知道了
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
