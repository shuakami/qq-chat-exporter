'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink, Copy, Check } from 'lucide-react'
import { BuildFooter } from '@/components/ui/build-footer'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [errorData, setErrorData] = useState({
    message: '',
    digest: '',
    stack: '',
    url: '',
    userAgent: '',
    time: '',
  })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setErrorData({
      message: error.message || '未知错误',
      digest: error.digest || '',
      stack: error.stack || '',
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      time: new Date().toISOString(),
    })
    console.error('应用错误:', error)
  }, [error])

  const detail = errorData.digest
    ? `${errorData.message}\n\ndigest: ${errorData.digest}`
    : errorData.message

  const handleCopy = () => {
    navigator.clipboard.writeText(detail).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleReport = () => {
    const title = encodeURIComponent(`[BUG] 应用错误: ${errorData.message.slice(0, 50)}`)
    const body = encodeURIComponent(`## 错误信息

\`\`\`
${errorData.message}
\`\`\`

## 错误详情

- **错误摘要**: ${errorData.digest || '无'}
- **时间**: ${errorData.time}
- **URL**: ${errorData.url}

## 堆栈跟踪

\`\`\`
${errorData.stack || '无'}
\`\`\`

## 环境信息

- **浏览器**: ${errorData.userAgent}
- **QCE 版本**: v${process.env.QCE_VERSION || 'unknown'}
`)

    window.open(
      `https://github.com/shuakami/qq-chat-exporter/issues/new?title=${title}&body=${body}&labels=bug`,
      '_blank'
    )
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#fbfbfb] dark:bg-neutral-950 text-[#111111] dark:text-neutral-100 font-sans">
      <main className="flex-1 flex flex-col items-start justify-center max-w-lg w-full mx-auto px-8 pb-32">
        <h1 className="text-[20px] font-medium text-[#111111] dark:text-neutral-100 mb-3">出了点问题</h1>
        <p className="text-[14px] text-[#737373] dark:text-neutral-400 mb-8 leading-relaxed">
          应用遇到了意外错误。
          <br />
          请尝试刷新页面。
        </p>

        {errorData.message && (
          <div className="w-full bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4 mb-8">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">Error details</div>
              <button
                onClick={handleCopy}
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors p-1 -mr-1"
                title="复制错误信息"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[13px] text-[#444444] dark:text-neutral-300 leading-relaxed break-all font-mono whitespace-pre-wrap">
              {detail}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-4 text-[13px] font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-black/10 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white rounded-full transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重试
          </button>
          <button
            onClick={handleReport}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-4 text-[13px] font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            反馈问题
          </button>
        </div>
      </main>

      <BuildFooter />
    </div>
  )
}
