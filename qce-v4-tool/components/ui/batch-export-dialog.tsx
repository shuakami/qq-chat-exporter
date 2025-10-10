"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { X, FileText, Calendar, Download, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface BatchExportItem {
  type: 'group' | 'friend'
  id: string
  name: string
  chatType: number
  peerUid: string
}

interface BatchExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: BatchExportItem[]
  onExport: (config: BatchExportConfig) => Promise<void>
}

export interface BatchExportConfig {
  format: 'HTML' | 'TXT' | 'JSON'
  timeRange: 'all' | 'recent' | 'custom'
  customStartDate?: string
  customEndDate?: string
  downloadMedia: boolean
}

export interface BatchExportProgress {
  current: number
  total: number
  currentItem: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  results: Array<{
    name: string
    status: 'success' | 'failed' | 'pending'
    error?: string
  }>
}

export function BatchExportDialog({ open, onOpenChange, items, onExport }: BatchExportDialogProps) {
  const [format, setFormat] = useState<'HTML' | 'TXT' | 'JSON'>('HTML')
  const [timeRange, setTimeRange] = useState<'all' | 'recent' | 'custom'>('all')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [downloadMedia, setDownloadMedia] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<BatchExportProgress>({
    current: 0,
    total: items.length,
    currentItem: '',
    status: 'idle',
    results: items.map(item => ({ name: item.name, status: 'pending' }))
  })

  const handleExport = async () => {
    setIsExporting(true)
    setProgress({
      current: 0,
      total: items.length,
      currentItem: items[0]?.name || '',
      status: 'running',
      results: items.map(item => ({ name: item.name, status: 'pending' }))
    })

    const config: BatchExportConfig = {
      format,
      timeRange,
      customStartDate: timeRange === 'custom' ? customStartDate : undefined,
      customEndDate: timeRange === 'custom' ? customEndDate : undefined,
      downloadMedia
    }

    try {
      await onExport(config)
      setProgress(prev => ({ ...prev, status: 'completed' }))
    } catch (error) {
      setProgress(prev => ({ ...prev, status: 'failed' }))
    }
  }

  const handleClose = () => {
    if (!isExporting) {
      onOpenChange(false)
      // Reset state after dialog closes
      setTimeout(() => {
        setFormat('HTML')
        setTimeRange('all')
        setCustomStartDate('')
        setCustomEndDate('')
        setDownloadMedia(false)
        setIsExporting(false)
        setProgress({
          current: 0,
          total: items.length,
          currentItem: '',
          status: 'idle',
          results: items.map(item => ({ name: item.name, status: 'pending' }))
        })
      }, 200)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>批量导出聊天记录</DialogTitle>
          <DialogDescription>
            已选择 {items.length} 个会话，配置导出参数后开始批量导出
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* 选中的会话列表 */}
          <div className="space-y-2">
            <Label>选中的会话 ({items.length})</Label>
            <ScrollArea className="h-32 rounded-lg border border-neutral-200 p-2">
              <div className="space-y-1">
                {items.map((item, idx) => (
                  <div key={`${item.type}_${item.id}`} className="flex items-center gap-2 text-sm">
                    {progress.status === 'idle' || progress.status === 'completed' ? (
                      <span className="text-neutral-500">{idx + 1}.</span>
                    ) : (
                      <>
                        {progress.results[idx]?.status === 'success' && (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                        {progress.results[idx]?.status === 'failed' && (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        {progress.results[idx]?.status === 'pending' && (
                          <div className="w-4 h-4 flex items-center justify-center">
                            {progress.current === idx ? (
                              <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                            ) : (
                              <span className="text-xs text-neutral-400">{idx + 1}</span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <Badge variant={item.type === 'group' ? 'default' : 'secondary'} className="text-xs">
                      {item.type === 'group' ? '群组' : '好友'}
                    </Badge>
                    <span className={progress.current === idx && progress.status === 'running' ? 'font-semibold' : ''}>
                      {item.name}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* 导出格式 */}
          <div className="space-y-2">
            <Label htmlFor="batch-format">导出格式</Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as 'HTML' | 'TXT' | 'JSON')}
              disabled={isExporting}
            >
              <SelectTrigger id="batch-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HTML">HTML - 可视化网页</SelectItem>
                <SelectItem value="TXT">TXT - 纯文本</SelectItem>
                <SelectItem value="JSON">JSON - 结构化数据</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 时间范围 */}
          <div className="space-y-2">
            <Label htmlFor="batch-time-range">时间范围</Label>
            <Select
              value={timeRange}
              onValueChange={(v) => setTimeRange(v as 'all' | 'recent' | 'custom')}
              disabled={isExporting}
            >
              <SelectTrigger id="batch-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部消息</SelectItem>
                <SelectItem value="recent">最近 3 个月</SelectItem>
                <SelectItem value="custom">自定义时间范围</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 自定义时间范围 */}
          {timeRange === 'custom' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="batch-start-date">开始日期</Label>
                <Input
                  id="batch-start-date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  disabled={isExporting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-end-date">结束日期</Label>
                <Input
                  id="batch-end-date"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  disabled={isExporting}
                />
              </div>
            </div>
          )}

          {/* 导出进度 */}
          {isExporting && (
            <div className="space-y-2 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-blue-900">导出进度</span>
                <span className="text-blue-700">
                  {progress.current + 1} / {progress.total}
                </span>
              </div>
              <Progress 
                value={(progress.current / progress.total) * 100} 
                className="h-2"
              />
              <div className="text-xs text-blue-700">
                当前: {progress.currentItem}
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isExporting}
          >
            {isExporting ? '导出中...' : '取消'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || (timeRange === 'custom' && (!customStartDate || !customEndDate))}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                开始导出
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

