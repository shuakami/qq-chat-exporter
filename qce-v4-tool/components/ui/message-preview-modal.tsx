"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  MessageSquare,
  Calendar as CalendarIcon,
  Clock,
  Search,
  FileText,
  Image,
  Music,
  Video,
  File,
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
  anonymousExtInfo?: any
  roleInfo?: any
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

const MESSAGE_TYPES = {
  text: { icon: MessageSquare, label: "文本", color: "blue" },
  image: { icon: Image, label: "图片", color: "green" },
  voice: { icon: Music, label: "语音", color: "purple" },
  video: { icon: Video, label: "视频", color: "red" },
  file: { icon: File, label: "文件", color: "orange" },
}

export function MessagePreviewModal({ open, onClose, chat, onExport }: MessagePreviewModalProps) {
  const [messages, setMessages] = useState<Message[]>([]) // 当前页的消息
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [searchQuery, setSearchQuery] = useState("") // 恢复搜索功能
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // 流式搜索状态
  const [useStreamMode, setUseStreamMode] = useState(false)
  const [searchProgress, setSearchProgress] = useState<string>("")
  
  // 固定的filter，避免每次请求endTime都变化导致缓存失效
  const [currentFilter, setCurrentFilter] = useState<{ startTime: number; endTime: number } | null>(null)
  
  const MESSAGES_PER_PAGE = 50
  
  // 流式搜索Hook
  const streamSearch = useStreamSearch({
    onProgress: (progress: SearchProgress) => {
      if (progress.status === 'searching') {
        setSearchProgress(`正在搜索... 已处理 ${progress.processedCount} 条消息，找到 ${progress.matchedCount} 条匹配`)
        if (progress.matchedCount > 0) {
          setLoading(false)
        }
      } else if (progress.status === 'completed') {
        setSearchProgress(`搜索完成！共找到 ${progress.matchedCount} 条匹配（已搜索 ${progress.processedCount} 条）`)
        setLoading(false)
      }
    },
    onComplete: (results: any[]) => {
      console.log('[MessagePreview] 流式搜索完成，共', results.length, '条结果')
      setLoading(false)
    },
    onError: (err: string) => {
      setError(err)
      setLoading(false)
      setSearchProgress("")
    }
  })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const fetchMessages = async (page: number, filter?: any) => {
    if (!chat) return

    setLoading(true)
    setError(null)

    try {
      // 使用固定的filter或创建新的filter（避免每次Date.now()导致缓存失效）
      let finalFilter = currentFilter
      if (!finalFilter) {
        // 只在没有currentFilter时才创建新的
        finalFilter = {
          startTime: filter?.startTime || 0,
          endTime: filter?.endTime || Date.now()
        }
        setCurrentFilter(finalFilter)
      } else if (filter && (filter.startTime !== undefined || filter.endTime !== undefined)) {
        // 明确传入了时间范围，更新filter
        finalFilter = {
          startTime: filter.startTime !== undefined ? filter.startTime : finalFilter.startTime,
          endTime: filter.endTime !== undefined ? filter.endTime : finalFilter.endTime
        }
        setCurrentFilter(finalFilter)
      }

      const requestBody = {
        peer: chat.peer,
        page,
        limit: MESSAGES_PER_PAGE,
        filter: finalFilter
      }

      const response = await fetch('/api/messages/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error?.message || '获取消息失败')
      }

      const data: MessagePreviewResponse = result.data
      setMessages(data.messages || [])
      setTotalCount(data.totalCount || 0)
      setTotalPages(data.totalPages || 1)
      setHasNext(data.hasNext || false)
      
    } catch (err) {
      console.error('获取消息失败:', err)
      setError(err instanceof Error ? err.message : '获取消息失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      handleTimeRangeChange()
      return
    }
    
    if (!chat) return
    
    console.log('[MessagePreview] 启动流式搜索:', searchQuery)
    
    setUseStreamMode(true)
    setLoading(true)
    setMessages([])
    setSearchProgress("正在连接...")
    
    const filter = {
      startTime: startDate ? new Date(startDate).getTime() : 0,
      endTime: endDate ? (new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1) : Date.now()
    }
    
    streamSearch.startSearch({
      peer: chat.peer,
      filter,
      searchQuery: searchQuery.trim()
    })
  }
  
  const handleTimeRangeChange = () => {
    const filter = {
      startTime: startDate ? new Date(startDate).getTime() : 0,
      endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : Date.now()
    }
    setCurrentPage(1)
    setUseStreamMode(false)
    setCurrentFilter(filter)  // 重置filter
    fetchMessages(1, filter)
  }
  
  useEffect(() => {
    if (useStreamMode && streamSearch.results.length > 0) {
      const sorted = [...streamSearch.results].sort((a, b) => Number(b.msgTime) - Number(a.msgTime))
      setMessages(sorted)
      setTotalCount(sorted.length)
      // 搜索模式下不分页，全部显示
      setTotalPages(1)
      setCurrentPage(1)
    }
  }, [streamSearch.results, useStreamMode, MESSAGES_PER_PAGE])

  const handleExportWithTimeRange = () => {
    if (onExport && chat) {
      const timeRange = {
        startTime: startDate ? Math.floor(new Date(startDate).getTime() / 1000) : undefined,
        endTime: endDate ? Math.floor((new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1) / 1000) : undefined
      }
      onExport(chat.peer, timeRange)
      onClose()
    }
  }

  const getMessageType = (elements: any[]) => {
    if (!elements || elements.length === 0) return 'text'
    
    const element = elements[0]
    if (element.picElement) return 'image'
    if (element.pttElement) return 'voice'
    if (element.videoElement) return 'video'
    if (element.fileElement) return 'file'
    return 'text'
  }

  const formatMessageContent = (elements: any[]) => {
    if (!elements || elements.length === 0) return '空消息'
    
    let content = ''
    for (const element of elements) {
      if (element.textElement) {
        content += element.textElement.content || ''
      } else if (element.picElement) {
        content += '[图片]'
      } else if (element.pttElement) {
        content += '[语音]'
      } else if (element.videoElement) {
        content += '[视频]'
      } else if (element.fileElement) {
        content += `[文件: ${element.fileElement.fileName || '未知文件'}]`
      } else if (element.faceElement) {
        content += '[表情]'
      } else if (element.atElement) {
        content += `@${element.atElement.atNtName || element.atElement.atUid}`
      } else if (element.replyElement) {
        content += '[回复消息]'
      } else {
        content += '[未知消息类型]'
      }
    }
    return content || '空消息'
  }

  const formatMessageTime = (timestamp: number) => {
    return format(new Date(timestamp * 1000), 'MM-dd HH:mm')
  }

  const getSenderName = (message: Message) => {
    return message.sendMemberName || message.sendNickName || `用户${message.senderUin}`
  }

  const getSenderAvatar = (message: Message) => {
    if (chat?.type === 'group') {
      return `https://q1.qlogo.cn/g?b=qq&nk=${message.senderUin}&s=40`
    }
    return `https://q1.qlogo.cn/g?b=qq&nk=${message.senderUin}&s=40`
  }


  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    // 翻页时不传filter，使用已保存的currentFilter
    fetchMessages(page)
  }

  // 打开对话框时初始化
  useEffect(() => {
    if (open && chat) {
      setMessages([])
      setCurrentPage(1)
      setTotalPages(1)
      setTotalCount(0)
      setHasNext(false)
      setSearchQuery("")
      setStartDate("")
      setEndDate("")
      setError(null)
      fetchMessages(1)
    }
  }, [open, chat])

  if (!chat) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex flex-col h-full p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-3">
            {chat.type === 'group' ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
            <span>{chat.name}</span>
            <Badge variant="secondary" className="ml-auto">
              {chat.type === 'group' ? '群组' : '好友'}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            预览最近的聊天记录，选择时间范围后可以直接导出
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col h-[calc(90vh-120px)]">
          {/* 控制栏 - 优化布局 */}
          <div className="px-6 py-4 border-b bg-gray-50 space-y-3">
            {/* 第一行：时间筛选 */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                  <label className="text-sm font-medium text-gray-700">时间范围:</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-neutral-300 focus:border-neutral-400"
                    placeholder="开始日期"
                  />
                  <span className="text-gray-400">至</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-neutral-300 focus:border-neutral-400"
                    placeholder="结束日期"
                  />
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleTimeRangeChange}
                  disabled={!startDate && !endDate}
                  className="px-4"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  应用筛选
                </Button>
                
                {(startDate || endDate) && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setStartDate("")
                      setEndDate("")
                      setCurrentPage(1)
                      fetchMessages(1)
                    }}
                    className="px-3"
                  >
                    <X className="w-3 h-3 mr-1" />
                    清除
                  </Button>
                )}
              </div>
            </div>

            {/* 第二行：搜索和操作 */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {/* 搜索框 - 服务端搜索 */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300 px-3 py-2 focus-within:ring-1 focus-within:ring-neutral-300 focus-within:border-neutral-400">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜索所有消息..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="border-0 outline-none text-sm w-60 bg-transparent"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery("")
                          setUseStreamMode(false)
                          setSearchProgress("")
                          setCurrentPage(1)
                          const filter = {
                            startTime: startDate ? new Date(startDate).getTime() : undefined,
                            endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
                          }
                          fetchMessages(1, filter)
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSearch}
                    disabled={loading || !searchQuery.trim()}
                    className="px-3"
                  >
                    {streamSearch.searching ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        搜索中...
                      </>
                    ) : (
                      '搜索'
                    )}
                  </Button>
                  
                  {/* 取消搜索按钮 */}
                  {streamSearch.searching && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => streamSearch.cancelSearch()}
                      className="px-3"
                    >
                      取消
                    </Button>
                  )}
                </div>
                
                {/* 搜索进度 */}
                {searchProgress && (
                  <div className="text-xs text-muted-foreground px-3 py-1 bg-blue-50 rounded">
                    {searchProgress}
                  </div>
                )}
                
                {/* 消息统计 */}
                <Badge variant="outline" className="text-xs px-3 py-1">
                  <span>共 <span className="font-medium">{totalCount.toLocaleString()}</span> 条消息</span>
                  {hasNext && (
                    <span className="ml-2 text-blue-600">（可能还有更多）</span>
                  )}
                </Badge>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPage(1)
                    const filter = {
                      startTime: startDate ? new Date(startDate).getTime() : undefined,
                      endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
                    }
                    fetchMessages(1, filter)
                  }}
                  disabled={loading}
                  className="px-4"
                >
                  <RefreshCw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />
                  刷新
                </Button>
                {onExport && (
                  <Button size="sm" onClick={handleExportWithTimeRange} className="px-4">
                    <Download className="w-3 h-3 mr-1" />
                    导出聊天记录
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 消息列表 */}
          <ScrollArea className="flex-1 px-6">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm text-gray-600">正在加载消息...</span>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="text-red-600 text-sm mb-2">加载失败: {error}</div>
                <Button variant="outline" size="sm" onClick={() => {
                  setCurrentPage(1)
                  const filter = {
                    startTime: startDate ? new Date(startDate).getTime() : undefined,
                    endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
                  }
                  fetchMessages(1, filter)
                }}>
                  重试
                </Button>
              </div>
            )}

            {!loading && !error && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8">
                <MessageSquare className="w-12 h-12 text-gray-300 mb-2" />
                <div className="text-sm text-gray-600">{searchQuery ? '没有找到匹配的消息' : '暂无消息'}</div>
                {searchQuery && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => {
                    setSearchQuery("")
                    setUseStreamMode(false)
                    setSearchProgress("")
                    setCurrentPage(1)
                    const filter = {
                      startTime: startDate ? new Date(startDate).getTime() : undefined,
                      endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
                    }
                    fetchMessages(1, filter)
                  }}>
                    清除搜索
                  </Button>
                )}
              </div>
            )}

            {!loading && !error && messages.length > 0 && (
              <div className="space-y-3 py-4">
                {messages.map((message, index) => {
                  const messageType = getMessageType(message.elements)
                  const TypeIcon = MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES]?.icon || MessageSquare
                  const content = formatMessageContent(message.elements)
                  const isFromSelf = message.sendType === 1

                  return (
                    <div
                      key={`${message.msgId}-${index}`}
                      className={cn(
                        "flex gap-3 p-3 rounded-lg",
                        isFromSelf ? "bg-blue-50 ml-12" : "bg-gray-50 mr-12"
                      )}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarImage src={getSenderAvatar(message)} />
                        <AvatarFallback>
                          {getSenderName(message).charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {getSenderName(message)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatMessageTime(message.msgTime)}
                          </span>
                          <TypeIcon className="w-3 h-3 text-gray-400" />
                        </div>
                        <div className="text-sm text-gray-800 break-words">
                          {content}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {/* <div ref={messagesEndRef} /> */}
              </div>
            )}
          </ScrollArea>

          {/* 分页控制 - 仅在非搜索模式下显示 */}
          {!useStreamMode && totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
              <div className="text-sm text-gray-600">
                显示第 {((currentPage - 1) * MESSAGES_PER_PAGE) + 1} - {Math.min(currentPage * MESSAGES_PER_PAGE, totalCount)} 条，
                共 {totalCount} 条
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="px-3"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                
                <div className="flex items-center gap-1 text-sm">
                  <span className="text-gray-600">第</span>
                  <span className="font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    {currentPage}
                  </span>
                  <span className="text-gray-600">/ {totalPages} 页</span>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  className="px-3"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
