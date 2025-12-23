'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, RefreshCw, ExternalLink, Copy, Check, Bug } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [errorDetails, setErrorDetails] = useState('')

  useEffect(() => {
    // 收集错误详情
    const details = [
      `错误信息: ${error.message}`,
      `错误摘要: ${error.digest || '无'}`,
      `堆栈跟踪:\n${error.stack || '无'}`,
      `时间: ${new Date().toISOString()}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    ].join('\n\n')
    setErrorDetails(details)
    
    // 记录到控制台
    console.error('应用错误:', error)
  }, [error])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea')
      textarea.value = errorDetails
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleReportIssue = () => {
    const issueTitle = encodeURIComponent(`[BUG] 应用错误: ${error.message.slice(0, 50)}`)
    const issueBody = encodeURIComponent(`## 🐛 错误信息

\`\`\`
${error.message}
\`\`\`

## 📋 错误详情

\`\`\`
错误摘要: ${error.digest || '无'}
时间: ${new Date().toISOString()}
URL: ${typeof window !== 'undefined' ? window.location.href : ''}
\`\`\`

## 📜 堆栈跟踪

\`\`\`
${error.stack || '无'}
\`\`\`

## 💻 环境信息

- **浏览器**: ${typeof navigator !== 'undefined' ? navigator.userAgent : '未知'}
- **QCE 版本**: v5.0.x

## 🔄 复现步骤

1. 
2. 
3. 

## ✨ 期望结果

应用正常运行，不出现错误。
`)
    
    window.open(
      `https://github.com/shuakami/qq-chat-exporter/issues/new?title=${issueTitle}&body=${issueBody}&labels=bug`,
      '_blank'
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-4">
      <motion.div
        className="w-full max-w-lg"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-950/50 mb-4"
          >
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
          </motion.div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            出了点问题
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-2">
            应用遇到了意外错误，我们正在努力修复
          </p>
        </div>

        {/* Error Card */}
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-sm">
          {/* Error Message */}
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                <Bug className="w-4 h-4 text-red-500 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  错误信息
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 break-words">
                  {error.message || '未知错误'}
                </p>
                {error.digest && (
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2 font-mono">
                    摘要: {error.digest}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 space-y-3">
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>

            <div className="flex gap-3">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    复制错误
                  </>
                )}
              </button>

              <button
                onClick={handleReportIssue}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                反馈问题
              </button>
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            如果问题持续出现，请尝试刷新页面或清除浏览器缓存
          </p>
          <a
            href="https://github.com/shuakami/qq-chat-exporter/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            查看已知问题
          </a>
        </div>
      </motion.div>
    </div>
  )
}
