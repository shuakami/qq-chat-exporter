"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  RefreshCw,
  Download,
  Star,
  Clock
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PillDropdown } from "@/components/ui/pill-dropdown"
import { Loader } from "@/components/ui/loader"
import { useGroupEssence } from "@/hooks/use-group-essence"
import type { EssenceMessage } from "@/types/api"

interface GroupEssenceModalProps {
  isOpen: boolean
  onClose: () => void
  groupCode: string
  groupName: string
  onOpenFileLocation?: (filePath: string) => void
  onNotification?: (type: 'success' | 'error' | 'info', title: string, message: string, actions?: Array<{ label: string; onClick: () => void }>, duration?: number) => void
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

  useEffect(() => {
    if (isOpen && groupCode) {
      loadEssenceMessages(groupCode)
    }
    return () => {
      if (!isOpen) {
        clearMessages()
      }
    }
  }, [isOpen, groupCode])

  const handleExport = async () => {
    const result = await exportEssenceMessages(groupCode, exportFormat)
    if (result) {
      onNotification?.(
        'success', 
        '导出成功', 
        `已导出 ${result.totalCount} 条精华消息\n${result.filePath}`,
        result.filePath ? [{ label: '打开位置', onClick: () => onOpenFileLocation?.(result.filePath) }] : undefined,
        0
      )
    } else if (error) {
      onNotification?.('error', '导出失败', error)
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <div className="flex items-start justify-between px-10 pt-10 pb-6 flex-shrink-0">
          <div>
            <DialogTitle className="text-[20px] font-semibold text-foreground">群精华消息</DialogTitle>
            <p className="text-[13px] text-muted-foreground mt-1.5">{groupName}</p>
          </div>
          <button
            onClick={() => loadEssenceMessages(groupCode)}
            disabled={loading}
            className="p-2 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            title="刷新"
          >
            {loading ? <Loader size={16} /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 min-h-0">
          <div className="max-w-[760px] mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader size={24} className="text-muted-foreground/60" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-red-500 mb-2">加载失败</div>
              <p className="text-muted-foreground text-sm">{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Star className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">该群暂无精华消息</p>
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
        </div>

        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted-foreground">共 {messages.length} 条</span>
            <PillDropdown
              value={exportFormat}
              onChange={(v) => setExportFormat(v)}
              align="start"
              options={[
                { value: 'html', label: 'HTML' },
                { value: 'json', label: 'JSON' },
              ]}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">关闭</Button>
            <Button
              onClick={handleExport}
              disabled={exporting || messages.length === 0}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {exporting ? <Loader size={16} className="mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              导出
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {previewImage && (
            <motion.div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80"
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
      </DialogContent>
    </Dialog>
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
      className="rounded-xl bg-card overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/[0.04] dark:border-white/[0.04]">
        <img
          src={`https://q1.qlogo.cn/g?b=qq&nk=${message.senderUin}&s=40`}
          alt="头像"
          className="w-10 h-10 rounded-full object-cover"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {message.senderNick}
            </span>
            <span className="text-xs text-muted-foreground/60">
              ({message.senderUin})
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
              <p key={idx} className="text-foreground/80 whitespace-pre-wrap break-words">
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
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Star className="w-3 h-3 text-amber-500" />
          <span>由 {message.addDigestNick} 设为精华</span>
        </div>
        <span>{formatTime(message.addDigestTime)}</span>
      </div>
    </motion.div>
  )
}
