'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ExternalLink, Copy, Check, Bug } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [errorDetails, setErrorDetails] = useState('')

  useEffect(() => {
    const details = [
      `错误信息: ${error.message}`,
      `错误摘要: ${error.digest || '无'}`,
      `堆栈跟踪:\n${error.stack || '无'}`,
      `时间: ${new Date().toISOString()}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    ].join('\n\n')
    setErrorDetails(details)
    console.error('全局错误:', error)
  }, [error])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
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
    const issueTitle = encodeURIComponent(`[BUG] 全局错误: ${error.message.slice(0, 50)}`)
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
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{ width: '100%', maxWidth: '512px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                backgroundColor: '#fef2f2',
                marginBottom: '16px'
              }}>
                <AlertTriangle style={{ width: '32px', height: '32px', color: '#ef4444' }} />
              </div>
              <h1 style={{
                fontSize: '24px',
                fontWeight: 600,
                color: '#171717',
                margin: '0 0 8px 0'
              }}>
                出了点问题
              </h1>
              <p style={{
                fontSize: '14px',
                color: '#737373',
                margin: 0
              }}>
                应用遇到了严重错误，请尝试刷新页面
              </p>
            </div>

            {/* Error Card */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '16px',
              border: '1px solid #e5e5e5',
              overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}>
              {/* Error Message */}
              <div style={{
                padding: '24px',
                borderBottom: '1px solid #f5f5f5'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{
                    flexShrink: 0,
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Bug style={{ width: '16px', height: '16px', color: '#ef4444' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: '14px',
                      fontWeight: 500,
                      color: '#404040',
                      margin: '0 0 4px 0'
                    }}>
                      错误信息
                    </p>
                    <p style={{
                      fontSize: '14px',
                      color: '#525252',
                      margin: 0,
                      wordBreak: 'break-word'
                    }}>
                      {error.message || '未知错误'}
                    </p>
                    {error.digest && (
                      <p style={{
                        fontSize: '12px',
                        color: '#a3a3a3',
                        margin: '8px 0 0 0',
                        fontFamily: 'monospace'
                      }}>
                        摘要: {error.digest}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ padding: '24px' }}>
                <button
                  onClick={reset}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: '#171717',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    marginBottom: '12px'
                  }}
                >
                  <RefreshCw style={{ width: '16px', height: '16px' }} />
                  重试
                </button>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      backgroundColor: '#fff',
                      color: '#404040',
                      fontSize: '14px',
                      fontWeight: 500,
                      border: '1px solid #e5e5e5',
                      cursor: 'pointer'
                    }}
                  >
                    {copied ? (
                      <>
                        <Check style={{ width: '16px', height: '16px', color: '#22c55e' }} />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy style={{ width: '16px', height: '16px' }} />
                        复制错误
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleReportIssue}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      backgroundColor: '#fff',
                      color: '#404040',
                      fontSize: '14px',
                      fontWeight: 500,
                      border: '1px solid #e5e5e5',
                      cursor: 'pointer'
                    }}
                  >
                    <ExternalLink style={{ width: '16px', height: '16px' }} />
                    反馈问题
                  </button>
                </div>
              </div>
            </div>

            {/* Help Text */}
            <div style={{ marginTop: '24px', textAlign: 'center' }}>
              <p style={{
                fontSize: '14px',
                color: '#737373',
                margin: '0 0 8px 0'
              }}>
                如果问题持续出现，请尝试清除浏览器缓存
              </p>
              <a
                href="https://github.com/shuakami/qq-chat-exporter/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                  color: '#a3a3a3',
                  textDecoration: 'none'
                }}
              >
                <ExternalLink style={{ width: '14px', height: '14px' }} />
                查看已知问题
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
