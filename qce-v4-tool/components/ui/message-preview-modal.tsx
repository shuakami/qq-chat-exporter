"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Loader } from "@/components/ui/loader"
import {
  MessageSquare,
  Calendar as CalendarIcon,
  Search,
  Users,
  User,
  RefreshCw,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useStreamSearch, type SearchProgress } from "@/lib/useStreamSearch"

interface MessagePreviewModalProps {
  open: boolean
  onClose: () => void
  chat: {
    type: 'group' | 'friend'
    id: string
    name: string
    peer: { chatType: number, peerUid: string }
  } | null
  onExport?: (peer: any, timeRange?: { startTime?: number, endTime?: number }) => void
}

interface Message {
  msgId: string
  msgSeq: number
  msgTime: number
  senderUid: string
  senderUin: string
  elements: any[]
  peerUin: string
  chatType: number
  sendType: number
  subMsgType: number
  sendMemberName?: string
  sendNickName?: string
}

interface MessagePreviewResponse {
  messages: Message[]
  totalCount: number
  currentPage: number
  totalPages: number
  hasNext: boolean
  fetchedAt: string
}

export function MessagePreviewModal({ open, onClose, chat, onExport }: MessagePreviewModalProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [timeRangeError, setTimeRangeError] = useState<string | null>(null)
  const [useStreamMode, setUseStreamMode] = useState(false)
  const [searchProgress, setSearchProgress] = useState("")
  const [currentFilter, setCurrentFilter] = useState<{ startTime: number; endTime: number } | null>(null)
  
  const MESSAGES_PER_PAGE = 50
  
  const streamSearch = useStreamSearch({
    onProgress: (progress: SearchProgress) => {
      if (progress.status === 'searching') {
        setSearchProgress(`搜索中... ${progress.matchedCount} 条匹配`)
        if (progress.matchedCount > 0) setLoading(false)
      } else if (progress.status === 'completed') {
        setSearchProgress(`找到 ${progress.matchedCount} 条`)
        setLoading(false)
      }
    },
    onComplete: () => setLoading(false),
    onError: (err: string) => {
      setError(err)
      setLoading(false)
      setSearchProgress("")
    }
  })

  const validateTimeRange = (startValue: string, endValue: string): boolean => {
    if (startValue && endValue) {
      if (new Date(endValue) < new Date(startValue)) {
        setTimeRangeError('结束日期不能早于起始日期')
        return false
      }
    }
    setTimeRangeError(null)
    return true
  }

  const fetchMessages = async (page: number, filter?: any) => {
    if (!chat) return
    setLoading(true)
    setError(null)

    try {
      let finalFilter = currentFilter
      if (!finalFilter) {
        finalFilter = { startTime: filter?.startTime || 0, endTime: filter?.endTime || Date.now() }
        setCurrentFilter(finalFilter)
      } else if (filter) {
        finalFilter = {
          startTime: filter.startTime ?? finalFilter.startTime,
          endTime: filter.endTime ?? finalFilter.endTime
        }
        setCurrentFilter(finalFilter)
      }

      const response = await fetch('/api/messages/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: chat.peer, page, limit: MESSAGES_PER_PAGE, filter: finalFilter })
      })

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      const result = await response.json()
      if (!result.success) throw new Error(result.error?.message || '获取消息失败')

      const data: MessagePreviewResponse = result.data
      setMessages(data.messages || [])
      setTotalCount(data.totalCount || 0)
      setTotalPages(data.totalPages || 1)
      setHasNext(data.hasNext || false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取消息失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    if (!searchQuery.trim()) { handleTimeRangeChange(); return }
    if (!chat) return
    
    setUseStreamMode(true)
    setLoading(true)
    setMessages([])
    setSearchProgress("连接中...")
    
    streamSearch.startSearch({
      peer: chat.peer,
      filter: {
        startTime: startDate ? new Date(startDate).getTime() : 0,
        endTime: endDate ? (new Date(endDate).getTime() + 86400000 - 1) : Date.now()
      },
      searchQuery: searchQuery.trim()
    })
  }
  
  const handleTimeRangeChange = () => {
    if (!validateTimeRange(startDate, endDate) || (!startDate && !endDate)) return
    const filter = {
      startTime: startDate ? new Date(startDate).getTime() : 0,
      endTime: endDate ? new Date(endDate).getTime() + 86400000 - 1 : Date.now()
    }
    setCurrentPage(1)
    setUseStreamMode(false)
    setCurrentFilter(filter)
    fetchMessages(1, filter)
  }
  
  useEffect(() => {
    if (useStreamMode && streamSearch.results.length > 0) {
      const sorted = [...streamSearch.results].sort((a, b) => Number(b.msgTime) - Number(a.msgTime))
      setMessages(sorted)
      setTotalCount(sorted.length)
      setTotalPages(1)
      setCurrentPage(1)
    }
  }, [streamSearch.results, useStreamMode])

  const handleExportWithTimeRange = () => {
    if (!validateTimeRange(startDate, endDate)) return
    if (onExport && chat) {
      onExport(chat.peer, {
        startTime: startDate ? Math.floor(new Date(startDate).getTime() / 1000) : undefined,
        endTime: endDate ? Math.floor((new Date(endDate).getTime() + 86400000 - 1) / 1000) : undefined
      })
      onClose()
    }
  }

  const formatMessageContent = (elements: any[]) => {
    if (!elements?.length) return '空消息'
    let content = ''
    for (const el of elements) {
      if (el.textElement) content += el.textElement.content || ''
      else if (el.picElement) content += '[图片]'
      else if (el.pttElement) content += '[语音]'
      else if (el.videoElement) content += '[视频]'
      else if (el.fileElement) content += `[文件]`
      else if (el.faceElement) content += '[表情]'
      else if (el.atElement) content += `@${el.atElement.atNtName || '某人'}`
      else if (el.replyElement) content += '[回复]'
    }
    return content || '空消息'
  }

  useEffect(() => {
    if (open && chat) {
      setMessages([])
      setCurrentPage(1)
      setTotalPages(1)
      setTotalCount(0)
      setSearchQuery("")
      setStartDate("")
      setEndDate("")
      setTimeRangeError(null)
      setError(null)
      setCurrentFilter(null)
      fetchMessages(1)
    }
  }, [open, chat])

  /**
   * Issue #300: 这个预览弹窗本身是 framer-motion 自定义模态，z-index 在更外层 Radix
   * Dialog 之上，但 Radix 在它自己的 `<body>` 上挂了 `pointer-events: none` 来禁用底
   * 层交互。结果就是任务向导里的 Dialog 还开着时打开预览，预览本身和它 fixed 子树
   * 也被一起禁掉了点击。
   *
   * 这里在弹窗显示期间强制把 body 的 pointer-events 改回 auto，关闭后恢复成原样。
   * 不动 Radix 自己的 modal=true 行为，只覆盖最末端的 body 状态，避免影响其它依赖
   * Radix 屏蔽底层交互的弹层。
   */
  useEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    const body = document.body
    const previous = body.style.pointerEvents
    body.style.pointerEvents = 'auto'
    return () => {
      // 关闭时优先恢复打开前的值；遇到 Radix 把 body 的 inline 样式整个清掉的情况
      // （previous 为空字符串）就保持空字符串，让浏览器回到默认值。
      body.style.pointerEvents = previous
    }
  }, [open])

  if (!chat) return null

  return (
    <AnimatePresence>
      {open && (
      <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-background/80 z-[110]"
        onClick={onClose}
      />

      {/* Fullscreen modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-4 z-[111] flex flex-col bg-card rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.12)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.4)] overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 rounded-full">
              <AvatarImage src={chat.type === 'group' 
                ? `https://p.qlogo.cn/gh/${chat.id}/${chat.id}/40`
                : `https://q1.qlogo.cn/g?b=qq&nk=${chat.id}&s=40`
              } />
              <AvatarFallback className="bg-muted text-muted-foreground rounded-full">
                {chat.type === 'group' ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">{chat.name}</h2>
              <p className="text-xs text-muted-foreground">
                {chat.type === 'group' ? '群聊' : '好友'} · {totalCount.toLocaleString()} 条消息
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters - single compact row */}
        <div className="px-6 py-3 flex items-center gap-3 flex-shrink-0 border-b border-black/[0.06] dark:border-white/[0.06] flex-wrap">
          {/* Time range */}
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); validateTimeRange(e.target.value, endDate) }}
              className="px-2.5 py-1 text-xs bg-transparent text-foreground rounded-full border border-black/[0.06] dark:border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
            <span className="text-muted-foreground/40 text-xs">—</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); validateTimeRange(startDate, e.target.value) }}
              className="px-2.5 py-1 text-xs bg-transparent text-foreground rounded-full border border-black/[0.06] dark:border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleTimeRangeChange}
              disabled={(!startDate && !endDate) || !!timeRangeError}
              className="rounded-full h-7 text-xs px-3"
            >
              筛选
            </Button>
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); setTimeRangeError(null); setCurrentFilter(null); fetchMessages(1) }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                清除
              </button>
            )}
            {timeRangeError && <span className="text-xs text-red-500">{timeRangeError}</span>}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-black/[0.06] dark:bg-white/[0.06]" />

          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-full border border-black/[0.06] dark:border-white/[0.06] focus-within:ring-1 focus-within:ring-foreground/20">
              <Search className="w-3.5 h-3.5 text-muted-foreground/60" />
              <input
                type="text"
                placeholder="搜索消息内容..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/60"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setUseStreamMode(false); setSearchProgress(""); fetchMessages(1) }}>
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            <Button size="sm" onClick={handleSearch} disabled={loading || !searchQuery.trim()} className="rounded-full h-7 text-xs px-3">
              {streamSearch.searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '搜索'}
            </Button>
            {streamSearch.searching && (
              <Button size="sm" variant="ghost" onClick={() => streamSearch.cancelSearch()} className="rounded-full h-7 text-xs px-3">取消</Button>
            )}
            {searchProgress && <Badge variant="secondary" className="text-xs rounded-full">{searchProgress}</Badge>}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-4">
            {loading && (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader size={20} className="text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">加载中...</p>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center py-20">
                <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={() => fetchMessages(1)} className="rounded-full">重试</Button>
              </div>
            )}

            {!loading && !error && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <p className="text-sm text-muted-foreground">{searchQuery ? '没有找到匹配的消息' : '暂无消息'}</p>
              </div>
            )}

            {!loading && !error && messages.length > 0 && (
              <div className="space-y-1">
                {messages.map((msg, idx) => {
                  const isFromSelf = msg.sendType === 1
                  return (
                    <div
                      key={`${msg.msgId}-${idx}`}
                      className={cn(
                        "flex gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
                        isFromSelf && "bg-black/[0.02] dark:bg-white/[0.02]"
                      )}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0 rounded-full">
                        <AvatarImage src={`https://q1.qlogo.cn/g?b=qq&nk=${msg.senderUin}&s=40`} />
                        <AvatarFallback className="text-xs bg-muted text-muted-foreground rounded-full">
                          {(msg.sendMemberName || msg.sendNickName || '?')[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {msg.sendMemberName || msg.sendNickName || `用户${msg.senderUin}`}
                          </span>
                          <span className="text-xs text-muted-foreground/50">
                            {format(new Date(msg.msgTime * 1000), 'MM-dd HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/80 break-words leading-relaxed">
                          {formatMessageContent(msg.elements)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between flex-shrink-0">
          {/* Pagination */}
          {!useStreamMode && totalPages > 1 ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setCurrentPage(p => p - 1); fetchMessages(currentPage - 1) }}
                disabled={currentPage <= 1 || loading}
                className="rounded-full h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setCurrentPage(p => p + 1); fetchMessages(currentPage + 1) }}
                disabled={currentPage >= totalPages || loading}
                className="rounded-full h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div />
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchMessages(currentPage)}
              disabled={loading}
              className="rounded-full h-8 text-xs px-4"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
              刷新
            </Button>
            {onExport && (
              <Button size="sm" onClick={handleExportWithTimeRange} className="rounded-full h-8 text-xs px-4">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                导出
              </Button>
            )}
          </div>
        </div>
      </motion.div>
      </>
      )}
    </AnimatePresence>
  )
}
