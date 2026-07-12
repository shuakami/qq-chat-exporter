"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { CheckCircle2, XCircle, Users, User, FolderOpen, HelpCircle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Loader } from "@/components/ui/loader"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toggleSkipResourceType, type SkipDownloadResourceType } from "@/lib/skip-resource-types"
import { EXPORT_OPTION_TOOLTIPS } from "@/lib/export-option-tooltips"

const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const PILL_TEXTAREA =
  "px-3.5 py-2.5 rounded-[18px] border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"

export interface BatchExportItem {
  type: 'group' | 'friend'
  id: string
  name: string
  chatType: number
  peerUid: string
  avatarUrl?: string
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
  /** Issue #311: 自包含 HTML（资源 base64 内联）。 */
  embedResourcesAsDataUri: boolean
  includeSystemMessages: boolean
  filterPureImageMessages: boolean
  preferGroupMemberName: boolean
  /** Issue #341: 仅保留元数据、跳过下载的资源类型 */
  skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>
  outputDir: string
  keywords: string
  excludeUserUins: string
  useNameInFileName: boolean
  /** Issue #134: 友好文件名格式 `<名称>(<QQ号>).<扩展名>` */
  useFriendlyFileName?: boolean
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
  // Issue #311: 自包含 HTML
  const [embedResourcesAsDataUri, setEmbedResourcesAsDataUri] = useState(false)
  const [includeSystemMessages, setIncludeSystemMessages] = useState(true)
  const [filterPureImageMessages, setFilterPureImageMessages] = useState(false) // HTML默认false
  const [preferGroupMemberName, setPreferGroupMemberName] = useState(true)
  // Issue #344：批量导出也支持按资源类型逐项跳过下载。
  const [skipDownloadResourceTypes, setSkipDownloadResourceTypes] = useState<SkipDownloadResourceType[] | undefined>(undefined)
  const [outputDir, setOutputDir] = useState('')
  const [keywords, setKeywords] = useState('')
  const [excludeUserUins, setExcludeUserUins] = useState('')
  const [useNameInFileName, setUseNameInFileName] = useState(true)
  // Issue #134: 友好文件名格式
  const [useFriendlyFileName, setUseFriendlyFileName] = useState(false)
  
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
      setEmbedResourcesAsDataUri(false) // Issue #311
      setIncludeSystemMessages(true)
      setFilterPureImageMessages(false)
      setPreferGroupMemberName(true)
      setSkipDownloadResourceTypes(undefined)
      setOutputDir('')
      setKeywords('')
      setExcludeUserUins('')
      setUseNameInFileName(true)
      setUseFriendlyFileName(false)
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
      setEmbedResourcesAsDataUri(false) // Issue #311: 仅 HTML 可用
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
      embedResourcesAsDataUri,
      includeSystemMessages,
      filterPureImageMessages,
      preferGroupMemberName,
      ...(!filterPureImageMessages && skipDownloadResourceTypes && skipDownloadResourceTypes.length > 0 && {
        skipDownloadResourceTypes,
      }),
      outputDir,
      keywords,
      excludeUserUins,
      useNameInFileName,
      useFriendlyFileName
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
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">批量导出聊天记录</DialogTitle>

        <div className="flex-1 flex min-h-0 w-full">
          {/* 左侧 - 选中的会话列表 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col pt-12 pl-12 pr-8 pb-6">
            <h1 className="text-[20px] font-semibold text-foreground mb-2">批量导出聊天记录</h1>
            <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">已选择 {items.length} 个会话进行批量导出。</p>
            
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full rounded-2xl p-2 bg-black/[0.02] dark:bg-white/[0.03]">
                <div className="space-y-1">
                  {items.map((item, idx) => (
                    <div 
                      key={`${item.type}_${item.id}`} 
                      className={[
                        "flex items-center gap-3 p-3 rounded-xl transition-all",
                        progress.current === idx && progress.status === 'running' 
                          ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700" 
                          : "hover:bg-muted/50"
                      ].join(" ")}
                    >
                      {/* 头像 + 状态角标 */}
                      <div className="relative flex-shrink-0">
                        <Avatar className="w-9 h-9">
                          {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt={item.name} />}
                          <AvatarFallback className="text-[13px]">
                            {item.name ? item.name.slice(0, 1) : item.type === 'group' ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                          </AvatarFallback>
                        </Avatar>
                        {progress.status !== 'idle' && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-background">
                            {progress.results[idx]?.status === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : progress.results[idx]?.status === 'failed' ? (
                              <XCircle className="w-4 h-4 text-red-500" />
                            ) : progress.current === idx && progress.status === 'running' ? (
                              <Loader size={14} className="text-blue-500" />
                            ) : null}
                          </span>
                        )}
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <p className={[
                          "font-medium text-sm truncate",
                          progress.current === idx && progress.status === 'running' ? 'text-blue-900 dark:text-blue-100' : 'text-foreground'
                        ].join(" ")}>
                          {item.name}
                        </p>
                        {progress.results[idx]?.error && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate">{progress.results[idx].error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* 右侧 - 配置选项 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-10 xl:px-12 pt-12 pb-8">
            <div className="w-full max-w-[760px] mx-auto space-y-10">
              {/* 导出格式 */}
              <section>
                <h2 className={SECTION_TITLE}>导出格式</h2>
                <div className="inline-flex items-center flex-wrap gap-1 p-1 rounded-[20px] bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                  {(["HTML", "JSON", "TXT", "EXCEL"] as const).map((fmt) => {
                    const active = format === fmt
                    return (
                      <button
                        key={fmt}
                        type="button"
                        disabled={isExporting}
                        className={[
                          "px-5 h-[30px] text-[13px] font-medium rounded-full transition-all",
                          active
                            ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                            : "text-muted-foreground hover:text-foreground"
                        ].join(" ")}
                        onClick={() => !isExporting && setFormat(fmt)}
                      >
                        {fmt}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 时间范围 */}
              <section>
                <h2 className={SECTION_TITLE + " flex items-center gap-1.5"}>
                  时间范围
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-[14px] h-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors outline-none cursor-pointer" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[250px]">
                      {EXPORT_OPTION_TOOLTIPS.allMessages}
                    </TooltipContent>
                  </Tooltip>
                </h2>
                <div className="space-y-4">
                  <div className="inline-flex items-center flex-wrap gap-1 p-1 rounded-[20px] bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                    {[
                      { value: 'all', label: '全部消息' },
                      { value: 'recent', label: '最近 3 个月' },
                      { value: 'custom', label: '自定义' }
                    ].map((option) => {
                      const active = timeRange === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={isExporting}
                          className={[
                            "px-5 h-[30px] text-[13px] font-medium rounded-full transition-all",
                            active
                              ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                              : "text-muted-foreground hover:text-foreground"
                          ].join(" ")}
                          onClick={() => !isExporting && setTimeRange(option.value as 'all' | 'recent' | 'custom')}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                  {timeRange === 'custom' && (
                    <div className="space-y-2">
                      <DateRangePicker
                        startTime={customStartDate}
                        endTime={customEndDate}
                        onChange={(start, end) => { setCustomStartDate(start); setCustomEndDate(end) }}
                      />
                      {dateError && <div className="text-[13px] text-red-600 dark:text-red-400">{dateError}</div>}
                    </div>
                  )}
                </div>
              </section>

              {/* 高级选项 */}
              <section>
                <h2 className={SECTION_TITLE}>高级选项</h2>
                <div className="space-y-6">
                {/* 开关选项（分组卡片） */}
                {(() => {
                  const allOptions = [
                    { id: "streamingZipMode", checked: streamingZipMode, set: setStreamingZipMode, title: "流式导出（超大消息量专用）", desc: format === "HTML" ? "专为50万+消息量设计，全程流式处理防止内存溢出。输出ZIP格式。" : "专为50万+消息量设计，全程流式处理防止内存溢出。输出分块JSONL格式。", tip: EXPORT_OPTION_TOOLTIPS.streaming, visible: format === "HTML" || format === "JSON", highlight: true, group: "性能与处理" },
                    { id: "includeSystemMessages", checked: includeSystemMessages, set: setIncludeSystemMessages, title: "包含系统消息", desc: "包含入群通知、撤回提示等系统提示消息", tip: EXPORT_OPTION_TOOLTIPS.includeSystemMessages, visible: true, highlight: false, group: "导出内容" },
                    { id: "filterPureImageMessages", checked: filterPureImageMessages, set: setFilterPureImageMessages, title: "快速导出（跳过资源下载）", desc: "保留所有消息记录，但不下载图片/视频/音频等资源文件，大幅加快导出速度", tip: EXPORT_OPTION_TOOLTIPS.quickExport, visible: true, highlight: false, group: "导出内容" },
                    // Issue #344：分别控制图片 / 视频 / 音频 / 文件四种资源是否参与下载。
                    { id: "skipFileDownloadOnly", checked: !!skipDownloadResourceTypes?.includes('file'), set: (v: boolean) => setSkipDownloadResourceTypes((curr) => toggleSkipResourceType(curr, 'file', v)), title: "仅保留文件元数据，不下载文件", desc: "图片 / 视频 / 音频仍正常下载；只有文件类资源（群文件、聊天发送的文档等）只保留文件名、大小、MD5 等元信息。", tip: EXPORT_OPTION_TOOLTIPS.fileMetadataOnly, visible: !filterPureImageMessages, highlight: false, group: "导出内容" },
                    { id: "skipImageDownload", checked: !!skipDownloadResourceTypes?.includes('image'), set: (v: boolean) => setSkipDownloadResourceTypes((curr) => toggleSkipResourceType(curr, 'image', v)), title: "不下载图片", desc: "批量导出时跳过图片，HTML 中以占位形式显示。需要保留图片可关闭此项。", tip: EXPORT_OPTION_TOOLTIPS.skipImages, visible: !filterPureImageMessages, highlight: false, group: "导出内容" },
                    { id: "skipVideoDownload", checked: !!skipDownloadResourceTypes?.includes('video'), set: (v: boolean) => setSkipDownloadResourceTypes((curr) => toggleSkipResourceType(curr, 'video', v)), title: "不下载视频", desc: "批量导出时跳过视频，避免长时间或群聊导出时占用大量带宽和磁盘空间。", tip: EXPORT_OPTION_TOOLTIPS.skipVideos, visible: !filterPureImageMessages, highlight: false, group: "导出内容" },
                    { id: "skipAudioDownload", checked: !!skipDownloadResourceTypes?.includes('audio'), set: (v: boolean) => setSkipDownloadResourceTypes((curr) => toggleSkipResourceType(curr, 'audio', v)), title: "不下载语音", desc: "批量导出时跳过 SILK / AMR 等语音消息。对只想保留文字记录的场景很有用。", tip: EXPORT_OPTION_TOOLTIPS.skipAudio, visible: !filterPureImageMessages, highlight: false, group: "导出内容" },
                    { id: "preferGroupMemberName", checked: preferGroupMemberName, set: setPreferGroupMemberName, title: "优先使用群成员名称", desc: "群聊导出时优先使用群名片或群内名称。关闭后会改用 QQ 昵称或 QQ 号。这个选项仅对群聊生效。", tip: EXPORT_OPTION_TOOLTIPS.preferGroupMemberName, visible: true, highlight: false, group: "导出内容" },
                    { id: "exportAsZip", checked: exportAsZip, set: setExportAsZip, title: "导出为ZIP压缩包", desc: "将HTML文件和资源文件打包为ZIP格式（仅HTML格式可用）", tip: EXPORT_OPTION_TOOLTIPS.exportAsZip, visible: format === "HTML" && !streamingZipMode, highlight: false, group: "性能与处理" },
                    {
                      id: "useNameInFileName",
                      checked: useNameInFileName,
                      // Issue #134: 与友好命名互斥，避免输出双重前缀。
                      set: (v: boolean) => { setUseNameInFileName(v); if (v) setUseFriendlyFileName(false); },
                      title: "文件名包含聊天名称",
                      desc: "导出文件名中包含聊天对象的名称，方便识别",
                      tip: EXPORT_OPTION_TOOLTIPS.includeChatName,
                      visible: true,
                      highlight: false,
                      group: "文件命名",
                    },
                    {
                      // Issue #134: 友好命名 `名称(QQ号).<ext>`
                      id: "useFriendlyFileName",
                      checked: useFriendlyFileName,
                      set: (v: boolean) => { setUseFriendlyFileName(v); if (v) setUseNameInFileName(false); },
                      title: "使用友好命名（名称(QQ号).html）",
                      desc: "导出文件名使用 `名称(QQ号).<扩展名>` 格式，去掉前缀与时间戳；同名碰撞时自动追加 `_<日期>_<时间>` 后缀。与「文件名包含聊天名称」互斥。",
                      tip: EXPORT_OPTION_TOOLTIPS.friendlyFileName,
                      visible: true,
                      highlight: false,
                      group: "文件命名",
                    },
                    { id: "embedAvatarsAsBase64", checked: embedAvatarsAsBase64, set: setEmbedAvatarsAsBase64, title: "嵌入头像为Base64", desc: "将发送者头像以Base64格式嵌入JSON文件（仅JSON格式可用，会增加文件大小）", tip: EXPORT_OPTION_TOOLTIPS.embedAvatars, visible: format === "JSON", highlight: false, group: "导出内容" },
                    // Issue #311: 自包含 HTML
                    { id: "embedResourcesAsDataUri", checked: embedResourcesAsDataUri, set: setEmbedResourcesAsDataUri, title: "生成自包含 HTML", desc: "将图片、语音、视频、小于 50 MB 的文件以 base64 内联到单个 HTML中，不再产出 resources 目录。适合需要单独发送的场景。", tip: EXPORT_OPTION_TOOLTIPS.selfContainedHtml, visible: format === "HTML" && !exportAsZip && !streamingZipMode, highlight: false, group: "导出内容" }
                  ].filter((opt) => opt.visible)
                  return ["导出内容", "文件命名", "性能与处理"]
                    .map((groupName) => ({ groupName, opts: allOptions.filter((o) => o.group === groupName) }))
                    .filter(({ opts }) => opts.length > 0)
                    .map(({ groupName, opts }) => (
                      <div key={groupName} className="space-y-2.5">
                        <h3 className="text-[12px] font-medium text-muted-foreground pl-1">{groupName}</h3>
                        <div className="bg-neutral-50/50 dark:bg-white/[0.03] rounded-2xl border border-neutral-100/80 dark:border-white/[0.06] overflow-hidden divide-y divide-neutral-100/80 dark:divide-white/[0.06]">
                          {opts.map((opt) => (
                            <div
                              key={opt.id}
                              className={["flex items-center justify-between gap-6 group p-4 transition-colors", isExporting ? "opacity-50" : ""].join(" ")}
                            >
                              <div className="flex flex-col gap-0.5 flex-1 pr-4">
                                <div className="flex items-center gap-1.5">
                                  <div className={`text-[13px] font-medium ${opt.highlight ? 'text-orange-700 dark:text-orange-400' : 'text-foreground'}`}>{opt.title}</div>
                                  {opt.tip && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <HelpCircle className="w-[14px] h-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors outline-none cursor-pointer" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6} className="max-w-[280px]">
                                        {opt.tip}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                <div className={`text-[12px] leading-snug mt-0.5 ${opt.highlight ? 'text-orange-600/90 dark:text-orange-500/90' : 'text-muted-foreground'}`}>{opt.desc}</div>
                              </div>
                              <div className="flex-shrink-0">
                                <Switch checked={opt.checked} disabled={isExporting} onCheckedChange={(v) => opt.set(v)} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                })()}

                  <div className="space-y-2.5">
                    <label className="block text-[12px] font-medium text-muted-foreground pl-1">导出路径</label>
                    <div className="flex gap-2">
                      <Input placeholder="留空使用默认路径，或输入自定义路径如 D:\exports" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} disabled={isExporting} className={PILL_INPUT + " flex-1"} />
                      <Button variant="outline" size="icon" disabled={isExporting} className="rounded-full shrink-0" title="选择文件夹"><FolderOpen className="w-4 h-4" /></Button>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <label className="block text-[12px] font-medium text-muted-foreground pl-1">关键词过滤</label>
                    <Textarea placeholder="用逗号分隔多个关键词，如：重要,会议,通知" value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={isExporting} rows={2} className={PILL_TEXTAREA + " w-full"} />
                  </div>

                  <div className="space-y-2.5">
                    <label className="block text-[12px] font-medium text-muted-foreground pl-1">排除用户</label>
                    <Textarea placeholder="用逗号分隔多个QQ号，如：123456789,987654321" value={excludeUserUins} onChange={(e) => setExcludeUserUins(e.target.value)} disabled={isExporting} rows={2} className={PILL_TEXTAREA + " w-full"} />
                  </div>
                </div>
              </section>

              {/* 导出进度 */}
              {progress.status === 'running' && (
                <div className="space-y-4 p-5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Loader size={16} className="text-[#317CFF]" />
                      <div>
                        <h4 className="text-[13px] font-medium text-foreground">正在导出</h4>
                        <p className="text-[12px] text-muted-foreground">{progress.current + 1} / {progress.total} 个会话</p>
                      </div>
                    </div>
                    <div className="text-[15px] font-semibold text-foreground tabular-nums">{progress.total > 0 ? Math.round(((progress.current + 1) / progress.total) * 100) : 0}%</div>
                  </div>
                  <Progress value={progress.total > 0 ? ((progress.current + 1) / progress.total) * 100 : 0} className="h-2" />
                  <div className="text-[12px] text-muted-foreground truncate"><span className="font-medium">当前：</span>{progress.currentItem}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {progress.status === 'running' ? (
              <span className="text-foreground">正在导出 {progress.current + 1}/{progress.total} 个会话...</span>
            ) : progress.status === 'completed' ? (
              <span className="text-foreground">导出完成</span>
            ) : (
              <span className="text-foreground">配置就绪，将导出 {items.length} 个会话</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleClose} disabled={isExporting} className="rounded-full text-[13px] h-8">
              {isExporting ? '导出中...' : progress.status === 'completed' ? '关闭' : '取消'}
            </Button>
            {progress.status !== 'completed' && (
              <Button onClick={handleExport} disabled={isExporting || (timeRange === 'custom' && (!customStartDate || !customEndDate || !!dateError))} className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]">
                {isExporting ? '导出中...' : '开始批量导出'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
