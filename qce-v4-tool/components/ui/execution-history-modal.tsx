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
            className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.3 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
              <div>
                <h2 className="text-lg font-semibold text-foreground">执行历史</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{taskName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadHistory}
                  disabled={loading}
                  className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="w-6 h-6 text-muted-foreground/60 animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">暂无执行记录</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <motion.div
                      key={item.id}
                      className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-muted/30 overflow-hidden"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {/* Main Row */}
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      >
                        {/* Status Indicator */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          item.status === 'success' ? 'bg-muted-foreground/60' :
                          item.status === 'failed' ? 'bg-foreground' :
                          'bg-muted-foreground/40'
                        }`} />
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-foreground font-medium">
                              {new Date(item.executedAt).toLocaleDateString('zh-CN', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-muted-foreground">{formatDuration(item.duration)}</span>
                            {item.messageCount !== undefined && item.messageCount > 0 && (
                              <>
                                <span className="text-muted-foreground/60">·</span>
                                <span className="text-muted-foreground">{item.messageCount.toLocaleString()} 条</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Status Text */}
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          item.status === 'success' ? 'bg-muted text-muted-foreground' :
                          item.status === 'failed' ? 'bg-muted text-foreground/80' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '部分'}
                        </span>

                        <ChevronRight className={`w-4 h-4 text-muted-foreground/40 transition-transform ${
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
                            <div className="px-4 pb-3 pt-1 space-y-2 text-sm border-t border-black/[0.06] dark:border-white/[0.06]">
                              {item.fileSize && (
                                <div className="flex justify-between text-muted-foreground">
                                  <span>文件大小</span>
                                  <span>{formatFileSize(item.fileSize)}</span>
                                </div>
                              )}
                              {item.filePath && (
                                <div className="text-muted-foreground">
                                  <span className="block mb-1">文件路径</span>
                                  <code className="block text-xs bg-muted px-2 py-1.5 rounded font-mono break-all select-all">
                                    {item.filePath}
                                  </code>
                                </div>
                              )}
                              {item.error && (
                                <div className="text-foreground/80 bg-muted px-3 py-2 rounded">
                                  <div className="flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
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
            <div className="px-6 py-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  共 {history.length} 条记录
                </span>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
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
