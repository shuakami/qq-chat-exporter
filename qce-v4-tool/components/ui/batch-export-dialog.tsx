"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { X, FileText, Calendar, Download, CheckCircle2, XCircle, Loader2, Users, User, Settings, Package } from "lucide-react"
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
      <DialogContent
        overlayClassName="bg-white/60 backdrop-blur-xl"
        className="max-w-6xl 2xl:max-w-[1400px] h-[80vh] flex flex-col p-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            批量导出聊天记录
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-8 min-h-0 px-6 py-6">
          {/* 左侧 - 选中的会话列表 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">选中的会话</h3>
              <p className="text-sm text-neutral-600">已选择 {items.length} 个会话进行批量导出</p>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full rounded-2xl border border-neutral-200 p-2 bg-white/70">
                <div className="space-y-1">
                  {items.map((item, idx) => (
                    <div 
                      key={`${item.type}_${item.id}`} 
                      className={[
                        "flex items-center gap-3 p-3 rounded-xl transition-all",
                        progress.current === idx && progress.status === 'running' 
                          ? "bg-blue-50 border border-blue-200" 
                          : "hover:bg-neutral-50"
                      ].join(" ")}
                    >
                      {/* 状态图标 */}
                      <div className="flex-shrink-0">
                        {progress.status === 'idle' || progress.status === 'completed' ? (
                          <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-xs font-medium text-neutral-600">
                            {idx + 1}
                          </div>
                        ) : (
                          <>
                            {progress.results[idx]?.status === 'success' && (
                              <CheckCircle2 className="w-6 h-6 text-green-500" />
                            )}
                            {progress.results[idx]?.status === 'failed' && (
                              <XCircle className="w-6 h-6 text-red-500" />
                            )}
                            {progress.results[idx]?.status === 'pending' && (
                              <div className="w-6 h-6 flex items-center justify-center">
                                {progress.current === idx ? (
                                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-xs font-medium text-neutral-400">
                                    {idx + 1}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge 
                            variant={item.type === 'group' ? 'default' : 'secondary'} 
                            className="text-xs"
                          >
                            {item.type === 'group' ? (
                              <>
                                <Users className="w-3 h-3 mr-1" />
                                群组
                              </>
                            ) : (
                              <>
                                <User className="w-3 h-3 mr-1" />
                                好友
                              </>
                            )}
                          </Badge>
                        </div>
                        <p className={[
                          "font-medium text-sm truncate",
                          progress.current === idx && progress.status === 'running' ? 'text-blue-900' : 'text-neutral-900'
                        ].join(" ")}>
                          {item.name}
                        </p>
                        {progress.results[idx]?.error && (
                          <p className="text-xs text-red-600 mt-1 truncate">
                            {progress.results[idx].error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          <Separator orientation="vertical" className="h-full" />

          {/* 右侧 - 配置选项 */}
          <div className="w-3/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">配置导出选项</h3>
              <p className="text-sm text-neutral-600">设置导出格式、时间范围和其他选项</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-6">
              {/* 导出格式 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">导出格式</Label>
                  <p className="text-sm text-neutral-600 mt-1">选择最适合您需求的格式</p>
                </div>

                <div className="space-y-3">
                  {(["JSON", "HTML", "TXT", "EXCEL"] as const).map((fmt) => {
                    const desc =
                      fmt === "JSON"
                        ? "结构化数据，保留完整信息"
                        : fmt === "HTML"
                        ? "网页格式，适合直接查看与打印"
                        : fmt === "EXCEL"
                        ? "Excel格式，便于数据分析"
                        : "纯文本，兼容性最好"
                    const chip =
                      fmt === "JSON" ? "结构化" : fmt === "HTML" ? "推荐" : fmt === "EXCEL" ? "数据分析" : "兼容"
                    const chipClass =
                      fmt === "JSON" ? "bg-neutral-100 text-neutral-600" : fmt === "HTML" ? "bg-blue-100 text-blue-600" : fmt === "EXCEL" ? "bg-purple-100 text-purple-600" : "bg-green-100 text-green-600"
                    const active = format === fmt
                    return (
                      <div
                        key={fmt}
                        className={[
                          "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                          active ? "border-blue-500 bg-blue-50/50 shadow-sm" : "border-neutral-200 hover:border-neutral-300",
                          isExporting ? "opacity-50 cursor-not-allowed" : ""
                        ].join(" ")}
                        onClick={() => !isExporting && setFormat(fmt)}
                      >
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-blue-600" : "text-neutral-500"}>
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-neutral-900">{fmt}</h3>
                              <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>{chip}</span>
                            </div>
                            <p className="text-sm text-neutral-600 mt-1">{desc}</p>
                          </div>
                          {active && <div className="w-2 h-2 bg-blue-600 rounded-full" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 时间范围 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">时间范围（可选）</Label>
                  <p className="text-sm text-neutral-600 mt-1">选择要导出的时间范围</p>
                </div>

                <div className="space-y-3">
                  {[
                    { value: 'all', label: '全部消息', desc: '导出所有历史聊天记录' },
                    { value: 'recent', label: '最近 3 个月', desc: '仅导出最近 3 个月的聊天记录' },
                    { value: 'custom', label: '自定义时间范围', desc: '手动指定开始和结束时间' }
                  ].map((option) => {
                    const active = timeRange === option.value
                    return (
                      <div
                        key={option.value}
                        className={[
                          "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                          active ? "border-blue-500 bg-blue-50/50 shadow-sm" : "border-neutral-200 hover:border-neutral-300",
                          isExporting ? "opacity-50 cursor-not-allowed" : ""
                        ].join(" ")}
                        onClick={() => !isExporting && setTimeRange(option.value as 'all' | 'recent' | 'custom')}
                      >
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-blue-600" : "text-neutral-500"}>
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <h3 className="font-medium text-neutral-900">{option.label}</h3>
                            <p className="text-sm text-neutral-600 mt-1">{option.desc}</p>
                          </div>
                          {active && <div className="w-2 h-2 bg-blue-600 rounded-full" />}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 自定义时间范围 */}
                {timeRange === 'custom' && (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="batch-start-date">开始时间</Label>
                      <Input
                        id="batch-start-date"
                        type="datetime-local"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        disabled={isExporting}
                        className="font-mono rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="batch-end-date">结束时间</Label>
                      <Input
                        id="batch-end-date"
                        type="datetime-local"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        disabled={isExporting}
                        className="font-mono rounded-xl"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 高级选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">高级选项</Label>
                  <p className="text-sm text-neutral-600 mt-1">自定义导出内容的详细设置</p>
                </div>

                <div
                  className={[
                    "relative cursor-pointer rounded-2xl border p-4 transition-all",
                    downloadMedia ? "border-neutral-300 bg-neutral-50/50" : "border-neutral-200 hover:border-neutral-300",
                    isExporting ? "opacity-50 cursor-not-allowed" : ""
                  ].join(" ")}
                  onClick={() => !isExporting && setDownloadMedia(!downloadMedia)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 pt-0.5">
                      <div className={[
                        "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                        downloadMedia 
                          ? "border-neutral-900 bg-neutral-900" 
                          : "border-neutral-300 hover:border-neutral-400"
                      ].join(" ")}>
                        {downloadMedia && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-neutral-900 text-sm">下载媒体文件</h4>
                      <p className="text-neutral-600 text-sm mt-1 leading-relaxed">
                        同时下载聊天记录中的图片、视频、音频等媒体文件
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 导出进度 */}
              {isExporting && (
                <div className="space-y-4 p-6 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-blue-900">正在导出</h4>
                        <p className="text-sm text-blue-700">
                          {progress.current + 1} / {progress.total} 个会话
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-900">
                        {Math.round((progress.current / progress.total) * 100)}%
                      </div>
                    </div>
                  </div>
                  
                  <Progress 
                    value={(progress.current / progress.total) * 100} 
                    className="h-3"
                  />
                  
                  <div className="text-sm text-blue-700">
                    <span className="font-medium">当前:</span> {progress.currentItem}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <div className="text-sm text-neutral-500">
            {isExporting ? (
              <span className="text-blue-600">
                ⏳ 正在导出 {progress.current + 1}/{progress.total} 个会话...
              </span>
            ) : (
              <span className="text-green-600">
                ✓ 准备就绪，将导出 {items.length} 个会话
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={handleClose} 
              disabled={isExporting}
              className="rounded-full"
            >
              {isExporting ? '导出中...' : '取消'}
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting || (timeRange === 'custom' && (!customStartDate || !customEndDate))}
              className="bg-blue-600 hover:bg-blue-700 rounded-full"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  开始批量导出
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

