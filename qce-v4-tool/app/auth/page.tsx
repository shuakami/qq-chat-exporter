'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, X, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import AuthManager from '@/lib/auth'
import { Loader } from '@/components/ui/loader'
import { BuildFooter } from '@/components/ui/build-footer'

export default function AuthPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [isReady, setIsReady] = useState(false)
  // Issue #287: 支持从 URL `?token=` 参数自动填入并一键登录，
  // 配合后端启动时打印的「一键登录」链接，省掉手动从 security.json 复制 token。
  const [autoFromUrl, setAutoFromUrl] = useState(false)
  const submittedFromUrlRef = useRef(false)

  // Token 校验逻辑独立出来，URL 自动登录和表单提交都走同一条。
  // 'ok' 验证通过 / 'rejected' 令牌被明确拒绝 / 'unreachable' 服务器暂时不可用（可重试）。
  const verifyAndStoreToken = async (
    rawToken: string
  ): Promise<'ok' | 'rejected' | 'unreachable'> => {
    try {
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      })

      if (response.status >= 500) {
        setError('服务器暂时不可用，请稍后重试')
        return 'unreachable'
      }

      const data = await response.json()
      if (data.success) {
        AuthManager.getInstance().setToken(rawToken)
        return 'ok'
      }
      setError(data.error?.message || '令牌验证失败')
      return 'rejected'
    } catch {
      setError('无法连接到服务器，请确保 NapCat 正在运行')
      return 'unreachable'
    }
  }

  // 一键登录链接可能在服务器刚启动、还没完全就绪时被打开，
  // 此时验证请求会瞬时失败；对「不可达」类失败退避重试几次再回退到表单。
  const verifyWithRetry = async (rawToken: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await verifyAndStoreToken(rawToken)
      if (result === 'ok') return true
      if (result === 'rejected') return false
      await new Promise((r) => setTimeout(r, 600 + attempt * 400))
    }
    return false
  }

  useEffect(() => {
    // 先把 URL 里的 ?token= 剥掉再做任何跳转，避免任何分支（包括已登录直接跳）
    // 把带 token 的 URL 留在浏览器历史 / 地址栏里。
    let urlToken: string | null = null
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      urlToken = params.get('token')
      if (urlToken) {
        params.delete('token')
        const newUrl =
          window.location.pathname +
          (params.toString() ? '?' + params.toString() : '') +
          window.location.hash
        window.history.replaceState({}, '', newUrl)
      }
    }

    // URL 带 token 时优先用它重新验证，不走本地已存 token 的短路跳转：
    // 本地存的可能是重启前的旧 token，直接跳 /qce 会被 401 弹回本页（此时 URL 里的 token 已丢）。
    const authManager = AuthManager.getInstance()
    if (!urlToken && authManager.isAuthenticated()) {
      window.location.href = '/qce'
      return
    }

    if (urlToken && !submittedFromUrlRef.current) {
      submittedFromUrlRef.current = true
      setToken(urlToken)
      setAutoFromUrl(true)
      setIsReady(true)
      setLoading(true)
      // 给一帧时间渲染「检测到一键登录链接」提示，再发请求。
      setTimeout(async () => {
        const ok = await verifyWithRetry(urlToken!)
        if (ok) {
          window.location.href = '/qce'
        } else {
          // URL token 失效（比如换了 security.json）就退回手动表单。
          setAutoFromUrl(false)
          setLoading(false)
        }
      }, 100)
      return
    }

    setTimeout(() => setIsReady(true), 400)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) {
      setError('请输入访问令牌')
      return
    }

    setLoading(true)
    setError('')

    const ok = (await verifyAndStoreToken(token.trim())) === 'ok'
    if (ok) {
      window.location.href = '/qce'
      return
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#fbfbfb] dark:bg-neutral-950 text-[#111111] dark:text-neutral-100 font-sans">
      <main className="flex-1 flex flex-col items-start justify-center max-w-lg w-full mx-auto px-8 pb-32">
        <AnimatePresence mode="wait">
          {!isReady ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <Loader size={16} className="text-neutral-400" />
              <span className="text-[14px] text-[#737373] dark:text-neutral-400">QQ Chat Exporter</span>
            </motion.div>
          ) : (
            <motion.div
              key="content"
              className="w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35 }}
            >
              <h1 className="text-[20px] font-medium text-[#111111] dark:text-neutral-100 mb-3">访问验证</h1>
              <p className="text-[14px] text-[#737373] dark:text-neutral-400 mb-8 leading-relaxed">
                请输入访问令牌以继续使用。
                <br />
                令牌会在 QCE 启动时打印在控制台里。
              </p>

              {/* Issue #287: 当 URL 带 ?token= 时显示自动登录条幅，让用户清楚状态 */}
              {autoFromUrl && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mb-6 px-4 py-3 rounded-xl bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)] text-[13px] text-neutral-600 dark:text-neutral-300 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                  <span>已从一键登录链接读取访问令牌，正在验证...</span>
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="w-full space-y-4">
                <div className="relative w-full">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="粘贴您的访问令牌"
                    className="w-full h-10 pl-4 pr-11 rounded-xl bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)] text-[14px] text-[#111111] dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none focus:border-black/15 dark:focus:border-white/20 transition-colors"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[13px] text-red-600 dark:text-red-400"
                  >
                    {error}
                  </motion.p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-4 text-[13px] font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-black/10 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader size={14} className="text-neutral-400" />
                    ) : (
                      <>
                        验证并进入
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHelp(true)}
                    className="inline-flex items-center justify-center h-8 px-4 text-[13px] font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all"
                  >
                    找不到令牌？
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <BuildFooter />

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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-50 overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.06]">
                <h3 className="font-medium text-[14px] text-foreground">如何获取令牌</h3>
                <button
                  onClick={() => setShowHelp(false)}
                  className="p-1.5 rounded-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                <p className="text-muted-foreground text-[14px] leading-relaxed">
                  令牌是一串随机字符，用来验证你的身份。每次启动 NapCat / QCE 时会自动生成一个新的。
                </p>

                {/* Issue #287: 一键登录是 Framework 用户最省心的入口，先讲它 */}
                <div className="space-y-3">
                  <p className="text-[13px] font-medium text-foreground">最快的方式：用一键登录链接（推荐）</p>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    QCE 启动后会在控制台打印一条「一键登录」链接，复制到浏览器打开即可，本页会自动读取并完成验证。
                  </p>
                  <div className="rounded-lg bg-neutral-900 dark:bg-neutral-950 p-4 font-mono text-xs overflow-x-auto leading-relaxed">
                    <div className="text-neutral-400">[QCE] QQChatExporter v5.x.x</div>
                    <div className="text-green-400">[QCE] Token: WgZt3v*UMTqT#i!qleEO!76n02Y^ns$X</div>
                    <div className="text-neutral-500">[QCE] Web界面: http://127.0.0.1:40653/qce</div>
                    <div className="text-green-400">[QCE] 一键登录: http://127.0.0.1:40653/qce/auth?token=...</div>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
                  <p className="text-[13px] font-medium text-foreground">从控制台手动复制</p>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    打开 QCE 控制台窗口，往上翻一翻，找到带有 <span className="font-mono bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded text-foreground">[QCE] Token:</span> 的那一行，后面那串字符就是 Token。
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
                  <p className="text-[13px] font-medium text-foreground">从 security.json 找（Framework 模式）</p>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    Framework 模式下控制台不一定常驻，可以按 <span className="font-mono bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded text-foreground">Win + R</span> 输入：
                  </p>
                  <div className="rounded-lg bg-neutral-900 dark:bg-neutral-950 p-3 font-mono text-xs overflow-x-auto">
                    <span className="text-green-400">%USERPROFILE%\.qq-chat-exporter</span>
                  </div>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    打开里面的 <span className="font-mono bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded text-foreground">security.json</span>，找到 <span className="font-mono bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded text-foreground">accessToken</span> 字段，复制对应的字符串值即可。
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
                  <p className="text-[13px] font-medium text-foreground">Token 突然不能用了？</p>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    QQ 大版本更新或重新登录后，QCE 通常需要重启才能继续工作。重启后再用最新打印的 Token / 一键登录链接登录即可，老的 Token 会失效。
                  </p>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
                <button
                  onClick={() => setShowHelp(false)}
                  className="w-full py-2.5 rounded-full text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
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
