"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
import { motion, AnimatePresence } from "framer-motion"

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

  if (!chat) return null

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[85vh] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="w-12 h-12 ring-2 ring-neutral-100 dark:ring-neutral-700">
                    <AvatarImage src={chat.type === 'group' 
                      ? `https://p.qlogo.cn/gh/${chat.id}/${chat.id}/40`
                      : `https://q1.qlogo.cn/g?b=qq&nk=${chat.id}&s=40`
                    } />
                    <AvatarFallback className="bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                      {chat.type === 'group' ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{chat.name}</h2>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {chat.type === 'group' ? '群聊' : '好友'} · {totalCount.toLocaleString()} 条消息
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="px-6 py-4 bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-100 dark:border-neutral-800 space-y-3">
              {/* Time Range */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                  <CalendarIcon className="w-4 h-4" />
                  <span>时间:</span>
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); validateTimeRange(e.target.value, endDate) }}
                  className="px-3 py-1.5 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:focus:ring-neutral-600"
                />
                <span className="text-neutral-400">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); validateTimeRange(startDate, e.target.value) }}
                  className="px-3 py-1.5 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:focus:ring-neutral-600"
                />
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleTimeRangeChange}
                  disabled={(!startDate && !endDate) || !!timeRangeError}
                  className="rounded-lg"
                >
                  筛选
                </Button>
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(""); setEndDate(""); setTimeRangeError(null); setCurrentFilter(null); fetchMessages(1) }}
                    className="text-sm text-neutral-500 hover:text-neutral-300"
                  >
                    清除
                  </button>
                )}
                {timeRangeError && <span className="text-xs text-red-500">{timeRangeError}</span>}
              </div>

              {/* Search */}
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus-within:ring-2 focus-within:ring-neutral-200 dark:focus-within:ring-neutral-600">
                  <Search className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                  <input
                    type="text"
                    placeholder="搜索消息内容..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1 text-sm bg-transparent outline-none dark:text-neutral-200 dark:placeholder:text-neutral-500"
                  />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(""); setUseStreamMode(false); setSearchProgress(""); fetchMessages(1) }}>
                      <X className="w-4 h-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" />
                    </button>
                  )}
                </div>
                <Button size="sm" onClick={handleSearch} disabled={loading || !searchQuery.trim()} className="rounded-lg">
                  {streamSearch.searching ? <Loader2 className="w-4 h-4 animate-spin" /> : '搜索'}
                </Button>
                {streamSearch.searching && (
                  <Button size="sm" variant="ghost" onClick={() => streamSearch.cancelSearch()}>取消</Button>
                )}
                {searchProgress && <Badge variant="secondary" className="text-xs">{searchProgress}</Badge>}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-6">
                {loading && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 text-neutral-300 dark:text-neutral-600 animate-spin mb-3" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">加载中...</p>
                  </div>
                )}

                {error && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>
                    <Button variant="outline" size="sm" onClick={() => fetchMessages(1)}>重试</Button>
                  </div>
                )}

                {!loading && !error && messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <MessageSquare className="w-12 h-12 text-neutral-200 dark:text-neutral-700 mb-3" />
                    <p className="text-neutral-500 dark:text-neutral-400">{searchQuery ? '没有找到匹配的消息' : '暂无消息'}</p>
                  </div>
                )}

                {!loading && !error && messages.length > 0 && (
                  <div className="space-y-2">
                    {messages.map((msg, idx) => {
                      const isFromSelf = msg.sendType === 1
                      return (
                        <div
                          key={`${msg.msgId}-${idx}`}
                          className={cn(
                            "flex gap-3 p-3 rounded-xl transition-colors",
                            isFromSelf ? "bg-blue-50/50 dark:bg-blue-900/20 ml-8" : "bg-neutral-50 dark:bg-neutral-800/50 mr-8"
                          )}
                        >
                          <Avatar className="w-9 h-9 flex-shrink-0">
                            <AvatarImage src={`https://q1.qlogo.cn/g?b=qq&nk=${msg.senderUin}&s=40`} />
                            <AvatarFallback className="text-xs bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300">
                              {(msg.sendMemberName || msg.sendNickName || '?')[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                                {msg.sendMemberName || msg.sendNickName || `用户${msg.senderUin}`}
                              </span>
                              <span className="text-xs text-neutral-400 dark:text-neutral-500">
                                {format(new Date(msg.msgTime * 1000), 'MM-dd HH:mm')}
                              </span>
                            </div>
                            <p className="text-sm text-neutral-700 dark:text-neutral-300 break-words leading-relaxed">
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
            <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-between">
              {/* Pagination */}
              {!useStreamMode && totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setCurrentPage(p => p - 1); fetchMessages(currentPage - 1) }}
                    disabled={currentPage <= 1 || loading}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setCurrentPage(p => p + 1); fetchMessages(currentPage + 1) }}
                    disabled={currentPage >= totalPages || loading}
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
                  className="rounded-lg"
                >
                  <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
                  刷新
                </Button>
                {onExport && (
                  <Button size="sm" onClick={handleExportWithTimeRange} className="rounded-lg">
                    <Download className="w-4 h-4 mr-1.5" />
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
