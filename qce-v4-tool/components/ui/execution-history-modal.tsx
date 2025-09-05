"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Badge } from "./badge"
import { ScrollArea } from "./scroll-area"
import { 
  CheckCircle,
  AlertCircle,
  Clock,
  X,
  RefreshCw,
  FileText,
  Calendar,
  Timer
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

  // Load history when modal opens
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      case 'partial':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      default:
        return <Clock className="w-4 h-4 text-neutral-400" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success':
        return '成功'
      case 'failed':
        return '失败'
      case 'partial':
        return '部分成功'
      default:
        return '未知'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 text-green-700 border-green-200'
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200'
      case 'partial':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200'
      default:
        return 'bg-neutral-50 text-neutral-700 border-neutral-200'
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="w-5 h-5" />
            执行历史 - {taskName}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header Actions */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-neutral-600">
              共 {history.length} 条执行记录
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              disabled={loading}
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              刷新
            </Button>
          </div>

          {/* History List */}
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 text-neutral-300 mx-auto mb-2 animate-spin" />
                  <p className="text-neutral-500">加载执行历史中...</p>
                </div>
              </div>
            ) : history.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
                  <p className="text-neutral-500 mb-2">暂无执行历史</p>
                  <p className="text-sm text-neutral-400">任务还未执行过</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <div 
                    key={item.id}
                    className="flex items-start gap-3 p-3 border border-neutral-200 rounded-lg hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
                  >
                    {/* Status Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {getStatusIcon(item.status)}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0">
                      {/* Header Row */}
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={`text-xs px-2 py-0.5 border ${getStatusColor(item.status)}`}>
                          {getStatusText(item.status)}
                        </Badge>
                        <div className="flex items-center gap-1 text-sm text-neutral-600">
                          <Calendar className="w-3 h-3" />
                          <span>{new Date(item.executedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-neutral-600">
                          <Clock className="w-3 h-3" />
                          <span>耗时 {formatDuration(item.duration)}</span>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          {item.messageCount !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-neutral-500">消息数量:</span>
                              <span className="font-medium">{item.messageCount.toLocaleString()} 条</span>
                            </div>
                          )}
                          {item.fileSize && (
                            <div className="flex justify-between">
                              <span className="text-neutral-500">文件大小:</span>
                              <span className="font-medium">{formatFileSize(item.fileSize)}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-1">
                          {item.filePath && (
                            <div className="text-xs">
                              <span className="text-neutral-500">文件路径:</span>
                              <div className="mt-1 font-mono text-xs bg-neutral-100 px-2 py-1 rounded break-all select-all">
                                {item.filePath}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Error Message */}
                      {item.error && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <span className="break-all">{item.error}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
        
        {/* Footer */}
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}