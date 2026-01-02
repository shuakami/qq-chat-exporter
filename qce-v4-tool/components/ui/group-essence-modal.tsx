"use client"

import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  X,
  RefreshCw,
  Download,
  Star,
  Clock,
  Copy,
  CheckCircle
} from "lucide-react"
import { useGroupEssence } from "@/hooks/use-group-essence"
import type { EssenceMessage } from "@/types/api"

interface GroupEssenceModalProps {
  isOpen: boolean
  onClose: () => void
  groupCode: string
  groupName: string
  onOpenFileLocation?: (filePath: string) => void
  onNotification?: (type: 'success' | 'error' | 'info', title: string, message: string) => void
}

export function GroupEssenceModal({ 
  isOpen, 
  onClose, 
  groupCode,
  groupName,
  onOpenFileLocation,
  onNotification
}: GroupEssenceModalProps) {
  const {
    messages,
    loading,
    exporting,
    error,
    loadEssenceMessages,
    exportEssenceMessages,
    clearMessages
  } = useGroupEssence()

  const [exportFormat, setExportFormat] = useState<'json' | 'html'>('html')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen && groupCode) {
      loadEssenceMessages(groupCode)
      setLastExportPath(null)
    }
    return () => {
      if (!isOpen) {
        clearMessages()
        setLastExportPath(null)
      }
    }
  }, [isOpen, groupCode])

  const handleExport = async () => {
    const result = await exportEssenceMessages(groupCode, exportFormat)
    if (result) {
      setLastExportPath(result.filePath)
      onNotification?.('success', '导出成功', `已导出 ${result.totalCount} 条精华消息`)
    } else if (error) {
      onNotification?.('error', '导出失败', error)
    }
  }

  const handleCopyPath = async () => {
    if (lastExportPath) {
      await navigator.clipboard.writeText(lastExportPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div 
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          
          {/* Modal */}
          <motion.div
            className="relative w-full max-w-3xl max-h-[85vh] mx-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.3 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">群精华消息</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">{groupName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadEssenceMessages(groupCode)}
                  disabled={loading}
                  className="p-2 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
                  title="刷新"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="w-6 h-6 text-neutral-300 dark:text-neutral-600 animate-spin" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="text-red-500 mb-2">加载失败</div>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm">{error}</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Star className="w-10 h-10 text-neutral-200 dark:text-neutral-700 mb-3" />
                  <p className="text-neutral-500 dark:text-neutral-400">该群暂无精华消息</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg, index) => (
                    <EssenceMessageCard 
                      key={`${msg.msgSeq}-${index}`} 
                      message={msg} 
                      formatTime={formatTime}
                      onImageClick={setPreviewImage}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Export Path Display */}
            {lastExportPath && (
              <div className="px-6 py-3 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 flex-shrink-0">导出路径:</span>
                  <code className="flex-1 text-xs bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded font-mono truncate text-neutral-700 dark:text-neutral-300">
                    {lastExportPath}
                  </code>
                  <button
                    onClick={handleCopyPath}
                    className="p-1.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors flex-shrink-0"
                    title="复制路径"
                  >
                    {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => onOpenFileLocation?.(lastExportPath)}
                    className="text-xs px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors flex-shrink-0"
                  >
                    打开
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    共 {messages.length} 条精华消息
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">格式:</span>
                    <select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'json' | 'html')}
                      className="text-sm px-2 py-1 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                    >
                      <option value="html">HTML</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                  >
                    关闭
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={exporting || messages.length === 0}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    导出
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Image Preview */}
          <AnimatePresence>
            {previewImage && (
              <motion.div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPreviewImage(null)}
              >
                <motion.img
                  src={previewImage}
                  alt="预览"
                  className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface EssenceMessageCardProps {
  message: EssenceMessage
  formatTime: (timestamp: number) => string
  onImageClick: (url: string) => void
}

function EssenceMessageCard({ message, formatTime, onImageClick }: EssenceMessageCardProps) {
  return (
    <motion.div
      className="rounded-xl border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-800/50 overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-50 dark:border-neutral-700/50">
        <img
          src={`https://q1.qlogo.cn/g?b=qq&nk=${message.senderUin}&s=40`}
          alt="头像"
          className="w-10 h-10 rounded-full object-cover"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {message.senderNick}
            </span>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              ({message.senderUin})
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            <Clock className="w-3 h-3" />
            <span>{formatTime(message.senderTime)}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {message.content.map((item, idx) => {
          if (item.type === 'text' && item.text) {
            return (
              <p key={idx} className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
                {item.text}
              </p>
            )
          } else if (item.type === 'image' && item.url) {
            return (
              <img
                key={idx}
                src={item.url}
                alt="图片"
                className="max-w-full max-h-64 rounded-lg mt-2 cursor-pointer hover:opacity-90 transition-opacity"
                loading="lazy"
                onClick={() => onImageClick(item.url!)}
              />
            )
          }
          return null
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-50 dark:bg-neutral-800/80 text-xs text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-1">
          <Star className="w-3 h-3 text-amber-500" />
          <span>由 {message.addDigestNick} 设为精华</span>
        </div>
        <span>{formatTime(message.addDigestTime)}</span>
      </div>
    </motion.div>
  )
}
