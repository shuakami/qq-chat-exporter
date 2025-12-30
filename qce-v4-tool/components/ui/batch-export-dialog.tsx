"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { FileText, Calendar, Download, CheckCircle2, XCircle, Loader2, Users, User, Package, FolderOpen } from "lucide-react"
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
  format: 'HTML' | 'TXT' | 'JSON' | 'EXCEL'
  timeRange: 'all' | 'recent' | 'custom'
  customStartDate?: string
  customEndDate?: string
  // 高级选项
  streamingZipMode: boolean
  exportAsZip: boolean
  embedAvatarsAsBase64: boolean
  includeSystemMessages: boolean
  filterPureImageMessages: boolean
  outputDir: string
  keywords: string
  excludeUserUins: string
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
  const [format, setFormat] = useState<'HTML' | 'TXT' | 'JSON' | 'EXCEL'>('HTML')
  const [timeRange, setTimeRange] = useState<'all' | 'recent' | 'custom'>('all')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  
  // 高级选项状态
  const [streamingZipMode, setStreamingZipMode] = useState(false)
  const [exportAsZip, setExportAsZip] = useState(false)
  const [embedAvatarsAsBase64, setEmbedAvatarsAsBase64] = useState(false)
  const [includeSystemMessages, setIncludeSystemMessages] = useState(true)
  const [filterPureImageMessages, setFilterPureImageMessages] = useState(false) // HTML默认false
  const [outputDir, setOutputDir] = useState('')
  const [keywords, setKeywords] = useState('')
  const [excludeUserUins, setExcludeUserUins] = useState('')
  
  const [progress, setProgress] = useState<BatchExportProgress>({
    current: 0,
    total: 0,
    currentItem: '',
    status: 'idle',
    results: []
  })

  // 对话框打开时重置所有状态
  useEffect(() => {
    if (open) {
      setFormat('HTML')
      setTimeRange('all')
      setCustomStartDate('')
      setCustomEndDate('')
      setDateError(null)
      setIsExporting(false)
      setStreamingZipMode(false)
      setExportAsZip(false)
      setEmbedAvatarsAsBase64(false)
      setIncludeSystemMessages(true)
      setFilterPureImageMessages(false)
      setOutputDir('')
      setKeywords('')
      setExcludeUserUins('')
      setProgress({
        current: 0,
        total: items.length,
        currentItem: '',
        status: 'idle',
        results: items.map(item => ({ name: item.name, status: 'pending' }))
      })
    }
  }, [open, items])

  // 格式改变时自动调整filterPureImageMessages默认值，并重置格式专有选项
  useEffect(() => {
    if (format === 'HTML') {
      setFilterPureImageMessages(false)
    } else if (format === 'JSON' || format === 'TXT') {
      setFilterPureImageMessages(true)
    }
    // 重置格式专有选项
    if (format !== 'HTML') {
      setExportAsZip(false)
      if (format !== 'JSON') {
        setStreamingZipMode(false)
      }
    }
    if (format !== 'JSON') {
      setEmbedAvatarsAsBase64(false)
    }
  }, [format])


  useEffect(() => {
    if (timeRange !== 'custom') {
      setDateError(null)
      return
    }
    if (customStartDate && customEndDate) {
      const start = new Date(customStartDate)
      const end = new Date(customEndDate)
      if (end < start) {
        setDateError('结束日期不能早于起始日期')
      } else {
        setDateError(null)
      }
    } else {
      setDateError(null)
    }
  }, [timeRange, customStartDate, customEndDate])

  const handleExport = async () => {
    if (timeRange === 'custom') {
      if (!customStartDate || !customEndDate) {
        setDateError('请选择开始和结束时间')
        return
      }
      const start = new Date(customStartDate)
      const end = new Date(customEndDate)
      if (end < start) {
        setDateError('结束日期不能早于起始日期')
        return
      }
    }

    setDateError(null)
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
      streamingZipMode,
      exportAsZip,
      embedAvatarsAsBase64,
      includeSystemMessages,
      filterPureImageMessages,
      outputDir,
      keywords,
      excludeUserUins
    }

    try {
      await onExport(config)
      setProgress(prev => ({ ...prev, status: 'completed' }))
    } catch (error) {
      setProgress(prev => ({ ...prev, status: 'failed' }))
    } finally {
      setIsExporting(false)
    }
  }

  const handleClose = () => {
    if (!isExporting) {
      onOpenChange(false)
    }
  }


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        overlayClassName="bg-white/60 dark:bg-neutral-950/60 backdrop-blur-xl"
        className="flex flex-col h-full p-0"
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
              <p className="text-sm text-neutral-600 dark:text-neutral-400">已选择 {items.length} 个会话进行批量导出</p>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full rounded-2xl border border-neutral-200 dark:border-neutral-700 p-2 bg-white/70 dark:bg-neutral-800/70">
                <div className="space-y-1">
                  {items.map((item, idx) => (
                    <div 
                      key={`${item.type}_${item.id}`} 
                      className={[
                        "flex items-center gap-3 p-3 rounded-xl transition-all",
                        progress.current === idx && progress.status === 'running' 
                          ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700" 
                          : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                      ].join(" ")}
                    >
                      {/* 状态图标 */}
                      <div className="flex-shrink-0">
                        {progress.status === 'idle' ? (
                          <div className="w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center text-xs font-medium text-neutral-600 dark:text-neutral-300">
                            {idx + 1}
                          </div>
                        ) : progress.results[idx]?.status === 'success' ? (
                          <CheckCircle2 className="w-6 h-6 text-green-500" />
                        ) : progress.results[idx]?.status === 'failed' ? (
                          <XCircle className="w-6 h-6 text-red-500" />
                        ) : progress.current === idx && progress.status === 'running' ? (
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center text-xs font-medium text-neutral-400 dark:text-neutral-500">
                            {idx + 1}
                          </div>
                        )}
                      </div>


                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={item.type === 'group' ? 'default' : 'secondary'} className="text-xs">
                            {item.type === 'group' ? (
                              <><Users className="w-3 h-3 mr-1" />群组</>
                            ) : (
                              <><User className="w-3 h-3 mr-1" />好友</>
                            )}
                          </Badge>
                        </div>
                        <p className={[
                          "font-medium text-sm truncate",
                          progress.current === idx && progress.status === 'running' ? 'text-blue-900 dark:text-blue-100' : 'text-neutral-900 dark:text-neutral-100'
                        ].join(" ")}>
                          {item.name}
                        </p>
                        {progress.results[idx]?.error && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1 truncate">{progress.results[idx].error}</p>
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
              <p className="text-sm text-neutral-600 dark:text-neutral-400">设置导出格式、时间范围和其他选项</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-6">
              {/* 导出格式 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">导出格式</Label>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">选择最适合您需求的格式</p>
                </div>
                <div className="space-y-3">
                  {(["JSON", "HTML", "TXT", "EXCEL"] as const).map((fmt) => {
                    const desc = fmt === "JSON" ? "结构化数据，保留完整信息" : fmt === "HTML" ? "网页格式，适合直接查看与打印" : fmt === "EXCEL" ? "Excel格式，便于数据分析" : "纯文本，兼容性最好"
                    const chip = fmt === "JSON" ? "结构化" : fmt === "HTML" ? "推荐" : fmt === "EXCEL" ? "数据分析" : "兼容"
                    const chipClass = fmt === "JSON" ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300" : fmt === "HTML" ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400" : fmt === "EXCEL" ? "bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400" : "bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400"
                    const active = format === fmt
                    return (
                      <div key={fmt} className={["relative cursor-pointer rounded-2xl border-2 p-4 transition-all", active ? "border-blue-500 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/30 shadow-sm" : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600", isExporting ? "opacity-50 cursor-not-allowed" : ""].join(" ")} onClick={() => !isExporting && setFormat(fmt)}>
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-blue-600 dark:text-blue-400" : "text-neutral-500 dark:text-neutral-400"}><FileText className="w-5 h-5" /></div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{fmt}</h3>
                              <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>{chip}</span>
                            </div>
                            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{desc}</p>
                          </div>
                          {active && <div className="w-2 h-2 bg-blue-600 dark:bg-blue-500 rounded-full" />}
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
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">选择要导出的时间范围</p>
                </div>
                <div className="space-y-3">
                  {[
                    { value: 'all', label: '全部消息', desc: '导出所有历史聊天记录' },
                    { value: 'recent', label: '最近 3 个月', desc: '仅导出最近 3 个月的聊天记录' },
                    { value: 'custom', label: '自定义时间范围', desc: '手动指定开始和结束时间' }
                  ].map((option) => {
                    const active = timeRange === option.value
                    return (
                      <div key={option.value} className={["relative cursor-pointer rounded-2xl border-2 p-4 transition-all", active ? "border-blue-500 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/30 shadow-sm" : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600", isExporting ? "opacity-50 cursor-not-allowed" : ""].join(" ")} onClick={() => !isExporting && setTimeRange(option.value as 'all' | 'recent' | 'custom')}>
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-blue-600 dark:text-blue-400" : "text-neutral-500 dark:text-neutral-400"}><Calendar className="w-5 h-5" /></div>
                          <div className="flex-1">
                            <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{option.label}</h3>
                            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{option.desc}</p>
                          </div>
                          {active && <div className="w-2 h-2 bg-blue-600 dark:bg-blue-500 rounded-full" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {timeRange === 'custom' && (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="batch-start-date">开始时间</Label>
                      <Input id="batch-start-date" type="datetime-local" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} disabled={isExporting} className="font-mono rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="batch-end-date">结束时间</Label>
                      <Input id="batch-end-date" type="datetime-local" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} disabled={isExporting} className="font-mono rounded-xl" />
                    </div>
                    {dateError && <div className="col-span-2 text-sm text-red-600 dark:text-red-400">{dateError}</div>}
                  </div>
                )}
              </div>


              {/* 高级选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">高级选项</Label>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">自定义导出内容的详细设置</p>
                </div>

                {/* 自定义导出路径 */}
                <div className="space-y-2">
                  <Label htmlFor="batch-output-dir" className="text-sm">导出路径（可选）</Label>
                  <div className="flex gap-2">
                    <Input id="batch-output-dir" placeholder="留空使用默认路径，或输入自定义路径如 D:\exports" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} disabled={isExporting} className="rounded-xl font-mono text-sm flex-1" />
                    <Button variant="outline" size="icon" disabled={isExporting} className="rounded-xl shrink-0" title="选择文件夹"><FolderOpen className="w-4 h-4" /></Button>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">默认保存到用户目录下的 .qq-chat-exporter/exports 文件夹</p>
                </div>

                {/* 关键词过滤 */}
                <div className="space-y-2">
                  <Label htmlFor="batch-keywords" className="text-sm">关键词过滤（可选）</Label>
                  <Textarea id="batch-keywords" placeholder="用逗号分隔多个关键词，如：重要,会议,通知" value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={isExporting} rows={2} className="rounded-xl" />
                </div>

                {/* 排除用户 */}
                <div className="space-y-2">
                  <Label htmlFor="batch-exclude-users" className="text-sm">排除用户（可选）</Label>
                  <Textarea id="batch-exclude-users" placeholder="用逗号分隔多个QQ号，如：123456789,987654321" value={excludeUserUins} onChange={(e) => setExcludeUserUins(e.target.value)} disabled={isExporting} rows={2} className="rounded-xl" />
                </div>


                {/* 复选框选项 */}
                <div className="space-y-3">
                  {[
                    { id: "streamingZipMode", checked: streamingZipMode, set: setStreamingZipMode, title: "流式导出（超大消息量专用）", desc: format === "HTML" ? "专为50万+消息量设计，全程流式处理防止内存溢出。输出ZIP格式。" : "专为50万+消息量设计，全程流式处理防止内存溢出。输出分块JSONL格式。", visible: format === "HTML" || format === "JSON", highlight: true },
                    { id: "includeSystemMessages", checked: includeSystemMessages, set: setIncludeSystemMessages, title: "包含系统消息", desc: "包含入群通知、撤回提示等系统提示消息", visible: true, highlight: false },
                    { id: "filterPureImageMessages", checked: filterPureImageMessages, set: setFilterPureImageMessages, title: "快速导出（跳过资源下载）", desc: "保留所有消息记录，但不下载图片/视频/音频等资源文件，大幅加快导出速度", visible: true, highlight: false },
                    { id: "exportAsZip", checked: exportAsZip, set: setExportAsZip, title: "导出为ZIP压缩包", desc: "将HTML文件和资源文件打包为ZIP格式（仅HTML格式可用）", visible: format === "HTML" && !streamingZipMode, highlight: false },
                    { id: "embedAvatarsAsBase64", checked: embedAvatarsAsBase64, set: setEmbedAvatarsAsBase64, title: "嵌入头像为Base64", desc: "将发送者头像以Base64格式嵌入JSON文件（仅JSON格式可用，会增加文件大小）", visible: format === "JSON", highlight: false }
                  ].filter((opt) => opt.visible).map((opt) => (
                    <div key={opt.id} className={["relative cursor-pointer rounded-2xl border p-4 transition-all", opt.highlight && opt.checked ? "border-orange-400 dark:border-orange-600 bg-orange-50/50 dark:bg-orange-950/30 ring-1 ring-orange-200 dark:ring-orange-800" : opt.highlight ? "border-orange-200 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-950/20 hover:border-orange-300 dark:hover:border-orange-700" : opt.checked ? "border-neutral-300 dark:border-neutral-600 bg-neutral-50/50 dark:bg-neutral-800/50" : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600", isExporting ? "opacity-50 cursor-not-allowed" : ""].join(" ")} onClick={() => !isExporting && opt.set(!opt.checked)}>
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 pt-0.5">
                          <div className={["w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all", opt.checked ? (opt.highlight ? "border-orange-500 bg-orange-500" : "border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100") : (opt.highlight ? "border-orange-300 dark:border-orange-600" : "border-neutral-300 dark:border-neutral-600")].join(" ")}>
                            {opt.checked && <svg className={`w-3 h-3 ${opt.highlight ? 'text-white' : 'text-white dark:text-neutral-900'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                          </div>
                        </div>
                        <div className="flex-1">
                          <h4 className={`font-medium text-sm ${opt.highlight ? 'text-orange-700 dark:text-orange-400' : 'text-neutral-900 dark:text-neutral-100'}`}>{opt.title}</h4>
                          <p className={`text-sm mt-1 leading-relaxed ${opt.highlight ? 'text-orange-600 dark:text-orange-500' : 'text-neutral-600 dark:text-neutral-400'}`}>{opt.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>


              {/* 导出进度 */}
              {progress.status === 'running' && (
                <div className="space-y-4 p-6 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h4 className="font-medium text-blue-900 dark:text-blue-100">正在导出</h4>
                        <p className="text-sm text-blue-700 dark:text-blue-300">{progress.current + 1} / {progress.total} 个会话</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{progress.total > 0 ? Math.round(((progress.current + 1) / progress.total) * 100) : 0}%</div>
                    </div>
                  </div>
                  <Progress value={progress.total > 0 ? ((progress.current + 1) / progress.total) * 100 : 0} className="h-3" />
                  <div className="text-sm text-blue-700 dark:text-blue-300"><span className="font-medium">当前:</span> {progress.currentItem}</div>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200 dark:border-neutral-700">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            {progress.status === 'running' ? (
              <span className="text-blue-600 dark:text-blue-400">⏳ 正在导出 {progress.current + 1}/{progress.total} 个会话...</span>
            ) : progress.status === 'completed' ? (
              <span className="text-green-600 dark:text-green-400">✓ 导出完成</span>
            ) : (
              <span className="text-green-600 dark:text-green-400">✓ 准备就绪，将导出 {items.length} 个会话</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleClose} disabled={isExporting} className="rounded-full">
              {isExporting ? '导出中...' : progress.status === 'completed' ? '关闭' : '取消'}
            </Button>
            {progress.status !== 'completed' && (
              <Button onClick={handleExport} disabled={isExporting || (timeRange === 'custom' && (!customStartDate || !customEndDate || !!dateError))} className="bg-blue-600 hover:bg-blue-700 rounded-full">
                {isExporting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />导出中...</>) : (<><Download className="w-4 h-4 mr-2" />开始批量导出</>)}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}