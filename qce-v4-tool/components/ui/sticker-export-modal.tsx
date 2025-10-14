"use client"

import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Progress } from "./progress"
import { Badge } from "./badge"
import { 
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  FolderOpen,
  Package,
  Smile
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface StickerExportModalProps {
  isOpen: boolean
  onClose: () => void
  exportType: 'single' | 'all'
  packName?: string
  onConfirm: () => Promise<{
    success: boolean
    packCount: number
    stickerCount: number
    exportPath: string
    error?: string
  } | null>
}

export function StickerExportModal({ 
  isOpen, 
  onClose, 
  exportType,
  packName,
  onConfirm
}: StickerExportModalProps) {
  const [status, setStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<{
    packCount: number
    stickerCount: number
    exportPath: string
    error?: string
  } | null>(null)

  const handleExport = async () => {
    setStatus('exporting')
    
    try {
      const exportResult = await onConfirm()
      
      if (exportResult?.success) {
        setResult({
          packCount: exportResult.packCount,
          stickerCount: exportResult.stickerCount,
          exportPath: exportResult.exportPath
        })
        setStatus('success')
      } else {
        setResult({
          packCount: 0,
          stickerCount: 0,
          exportPath: '',
          error: exportResult?.error || '导出失败'
        })
        setStatus('error')
      }
    } catch (error) {
      setResult({
        packCount: 0,
        stickerCount: 0,
        exportPath: '',
        error: error instanceof Error ? error.message : '导出失败'
      })
      setStatus('error')
    }
  }

  const handleClose = () => {
    setStatus('idle')
    setResult(null)
    onClose()
  }

  const openFolder = () => {
    if (result?.exportPath) {
      // 在Electron环境下可以直接打开文件夹
      // 这里只是显示路径，用户可以手动打开
      navigator.clipboard.writeText(result.exportPath)
      alert('导出路径已复制到剪贴板')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="flex flex-col h-full bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {exportType === 'all' ? '导出所有表情包' : `导出 ${packName}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <AnimatePresence mode="wait">
            {/* Idle State */}
            {status === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center space-y-4"
              >
                <div>
                  <p className="text-neutral-700 font-medium">
                    {exportType === 'all' ? '确定要导出所有表情包吗？' : `确定要导出"${packName}"吗？`}
                  </p>
                  <p className="text-sm text-neutral-500 mt-2">
                    {exportType === 'all' 
                      ? '将导出所有类型的表情包，包括收藏表情、市场表情包和系统表情包'
                      : '将导出该表情包中的所有表情文件'}
                  </p>
                </div>
                <div className="flex gap-3 justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleExport}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    开始导出
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Exporting State */}
            {status === 'exporting' && (
              <motion.div
                key="exporting"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center space-y-4"
              >
                <div>
                  <p className="text-neutral-700 font-medium">正在导出表情包...</p>
                  <p className="text-sm text-neutral-500 mt-2">
                    请稍候，正在处理表情文件
                  </p>
                </div>
                <div className="space-y-2">
                  <Progress value={undefined} className="h-2" />
                </div>
              </motion.div>
            )}

            {/* Success State */}
            {status === 'success' && result && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center space-y-4"
              >
                <div>
                  <p className="text-neutral-900 font-semibold text-lg">✓ 导出成功</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-center gap-2 text-neutral-600">
                      <Package className="w-4 h-4" />
                      <span>已导出 <span className="font-semibold text-neutral-900">{result.packCount}</span> 个表情包</span>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-neutral-600">
                      <Smile className="w-4 h-4" />
                      <span>共 <span className="font-semibold text-neutral-900">{result.stickerCount}</span> 个表情</span>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-neutral-50 rounded-lg">
                    <p className="text-xs text-neutral-500 mb-1">导出路径</p>
                    <p className="text-sm text-neutral-700 font-mono break-all">
                      {result.exportPath}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={openFolder}
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    复制路径
                  </Button>
                  <Button onClick={handleClose}>
                    完成
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Error State */}
            {status === 'error' && result && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center space-y-4"
              >
                <div>
                  <p className="text-neutral-900 font-semibold text-lg">✗ 导出失败</p>
                  <div className="mt-3 p-3 bg-red-50 rounded-lg">
                    <p className="text-sm text-red-700">
                      {result.error || '未知错误'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                  >
                    关闭
                  </Button>
                  <Button onClick={handleExport}>
                    重试
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}


