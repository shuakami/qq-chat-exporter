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
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

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
  const [allMessages, setAllMessages] = useState<Message[]>([]) // 存储所有消息
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([]) // 过滤后的消息
  const [displayMessages, setDisplayMessages] = useState<Message[]>([]) // 当前页显示的消息
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [searchQuery, setSearchQuery] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const MESSAGES_PER_PAGE = 50

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const fetchAllMessages = async (filter?: any) => {
    if (!chat) return

    setLoading(true)
    setError(null)

    try {
      const requestBody = {
        peer: chat.peer,
        page: 1,
        limit: 999999, // 获取所有消息
        filter: {
          startTime: filter?.startTime || 0,
          endTime: filter?.endTime || Date.now()
        }
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
      setAllMessages(data.messages || [])
      
    } catch (err) {
      console.error('获取消息失败:', err)
      setError(err instanceof Error ? err.message : '获取消息失败')
    } finally {
      setLoading(false)
    }
  }

  const handleTimeRangeChange = () => {
    const filter = {
      startTime: startDate ? new Date(startDate).getTime() : undefined,
      endTime: endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined
    }
    fetchAllMessages(filter)
    setCurrentPage(1) // 重置到第一页
  }

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


  // 当搜索条件或分页改变时，重新过滤消息
  useEffect(() => {
    let filtered = [...allMessages]
    
    // 应用搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(message => {
        const content = formatMessageContent(message.elements).toLowerCase()
        const senderName = getSenderName(message).toLowerCase()
        return content.includes(query) || senderName.includes(query)
      })
    }
    
    setFilteredMessages(filtered)
    
    // 计算分页
    const totalPages = Math.ceil(filtered.length / MESSAGES_PER_PAGE)
    setTotalPages(totalPages)
    
    // 如果当前页超出范围，重置到第一页
    const actualCurrentPage = currentPage > totalPages ? 1 : currentPage
    if (actualCurrentPage !== currentPage) {
      setCurrentPage(actualCurrentPage)
      return // 避免在这次渲染中设置显示消息
    }
    
    // 计算当前页显示的消息
    const startIndex = (actualCurrentPage - 1) * MESSAGES_PER_PAGE
    const endIndex = startIndex + MESSAGES_PER_PAGE
    setDisplayMessages(filtered.slice(startIndex, endIndex))
  }, [allMessages, searchQuery, currentPage, MESSAGES_PER_PAGE])

  // 分页改变时的处理函数
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  useEffect(() => {
    if (open && chat) {
      setAllMessages([])
      setFilteredMessages([])
      setDisplayMessages([])
      setCurrentPage(1)
      setTotalPages(1)
      setStartDate("")
      setEndDate("")
      setSearchQuery("")
      setError(null)
      fetchAllMessages()
    }
  }, [open, chat])

  if (!chat) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] p-0">
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
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="开始日期"
                  />
                  <span className="text-gray-400">至</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                      fetchAllMessages()
                      setCurrentPage(1)
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
                {/* 搜索框 */}
                <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索消息内容或发送者..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="border-0 outline-none text-sm w-80 bg-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {/* 消息统计 */}
                <Badge variant="outline" className="text-xs px-3 py-1">
                  {searchQuery ? (
                    <span>找到 <span className="font-medium text-blue-600">{filteredMessages.length}</span> / {allMessages.length} 条消息</span>
                  ) : (
                    <span>共 <span className="font-medium">{allMessages.length.toLocaleString()}</span> 条消息</span>
                  )}
                </Badge>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    fetchAllMessages()
                    setCurrentPage(1)
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
            {loading && allMessages.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm text-gray-600">正在加载消息...</span>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="text-red-600 text-sm mb-2">加载失败: {error}</div>
                <Button variant="outline" size="sm" onClick={() => {
                  fetchAllMessages()
                  setCurrentPage(1)
                }}>
                  重试
                </Button>
              </div>
            )}

            {!loading && !error && displayMessages.length === 0 && allMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8">
                <MessageSquare className="w-12 h-12 text-gray-300 mb-2" />
                <div className="text-sm text-gray-600">暂无消息</div>
              </div>
            )}

            {!loading && !error && displayMessages.length === 0 && allMessages.length > 0 && (
              <div className="flex flex-col items-center justify-center py-8">
                <Search className="w-12 h-12 text-gray-300 mb-2" />
                <div className="text-sm text-gray-600">没有找到匹配的消息</div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setSearchQuery("")}>
                  清除搜索
                </Button>
              </div>
            )}

            {displayMessages.length > 0 && (
              <div className="space-y-3 py-4">
                {displayMessages.map((message, index) => {
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

          {/* 分页控制 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
              <div className="text-sm text-gray-600">
                显示第 {((currentPage - 1) * MESSAGES_PER_PAGE) + 1} - {Math.min(currentPage * MESSAGES_PER_PAGE, filteredMessages.length)} 条，
                共 {filteredMessages.length} 条消息
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
