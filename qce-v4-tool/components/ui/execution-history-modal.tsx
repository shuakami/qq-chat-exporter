"use client"

import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  CheckCircle,
  AlertCircle,
  Clock,
  X,
  RefreshCw,
  FileText,
  ChevronRight
} from "lucide-react"
import type { ScheduledExportHistory } from "@/types/api"

interface ExecutionHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  scheduledExportId: string
  taskName: string
  onGetHistory: (id: string, limit?: number) => Promise<ScheduledExportHistory[]>
}

export function ExecutionHistoryModal({ 
  isOpen, 
  onClose, 
  scheduledExportId, 
  taskName,
  onGetHistory 
}: ExecutionHistoryModalProps) {
  const [history, setHistory] = useState<ScheduledExportHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && scheduledExportId) {
      loadHistory()
    }
  }, [isOpen, scheduledExportId])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const historyData = await onGetHistory(scheduledExportId, 50)
      setHistory(historyData)
    } catch (error) {
      console.error('Failed to load execution history:', error)
      setHistory([])
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
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
            className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.3 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">执行历史</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{taskName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadHistory}
                  disabled={loading}
                  className="p-2 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
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
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-neutral-200 dark:text-neutral-700 mb-3" />
                  <p className="text-neutral-500 dark:text-neutral-400">暂无执行记录</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <motion.div
                      key={item.id}
                      className="rounded-xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/50 overflow-hidden"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {/* Main Row */}
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 transition-colors"
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      >
                        {/* Status Indicator */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          item.status === 'success' ? 'bg-neutral-400 dark:bg-neutral-500' :
                          item.status === 'failed' ? 'bg-neutral-800 dark:bg-neutral-300' :
                          'bg-neutral-300 dark:bg-neutral-600'
                        }`} />
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-neutral-900 dark:text-neutral-100 font-medium">
                              {new Date(item.executedAt).toLocaleDateString('zh-CN', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="text-neutral-400 dark:text-neutral-500">·</span>
                            <span className="text-neutral-500 dark:text-neutral-400">{formatDuration(item.duration)}</span>
                            {item.messageCount !== undefined && item.messageCount > 0 && (
                              <>
                                <span className="text-neutral-400 dark:text-neutral-500">·</span>
                                <span className="text-neutral-500 dark:text-neutral-400">{item.messageCount.toLocaleString()} 条</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Status Text */}
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          item.status === 'success' ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300' :
                          item.status === 'failed' ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300' :
                          'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                        }`}>
                          {item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '部分'}
                        </span>

                        <ChevronRight className={`w-4 h-4 text-neutral-300 dark:text-neutral-600 transition-transform ${
                          expandedId === item.id ? 'rotate-90' : ''
                        }`} />
                      </button>

                      {/* Expanded Details */}
                      <AnimatePresence>
                        {expandedId === item.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-3 pt-1 space-y-2 text-sm border-t border-neutral-100 dark:border-neutral-700">
                              {item.fileSize && (
                                <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                                  <span>文件大小</span>
                                  <span>{formatFileSize(item.fileSize)}</span>
                                </div>
                              )}
                              {item.filePath && (
                                <div className="text-neutral-600 dark:text-neutral-400">
                                  <span className="block mb-1">文件路径</span>
                                  <code className="block text-xs bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 rounded font-mono break-all select-all">
                                    {item.filePath}
                                  </code>
                                </div>
                              )}
                              {item.error && (
                                <div className="text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 px-3 py-2 rounded">
                                  <div className="flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5" />
                                    <span className="break-all text-xs">{item.error}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  共 {history.length} 条记录
                </span>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
