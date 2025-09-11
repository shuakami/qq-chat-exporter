"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Textarea } from "./textarea"
import { Label } from "./label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"
import { Badge } from "./badge"
import { Separator } from "./separator"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import { ArrowLeft, ArrowRight, CheckCircle, Clock, FileText, Users, User, Search, Loader2, ChevronDown, RefreshCw, Settings } from "lucide-react"
import { useSearch } from "@/hooks/use-search"
import type { CreateTaskForm, Group, Friend } from "@/types/api"

interface TaskWizardProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (form: CreateTaskForm) => Promise<boolean>
  isLoading: boolean
  prefilledData?: Partial<CreateTaskForm>
  groups?: Group[]
  friends?: Friend[]
  onLoadData?: () => void
}


export function TaskWizard({ isOpen, onClose, onSubmit, isLoading, prefilledData, groups = [], friends = [], onLoadData }: TaskWizardProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedTarget, setSelectedTarget] = useState<Group | Friend | null>(null)
  const [showTargetSelector, setShowTargetSelector] = useState(false) // 控制是否显示目标选择器
  const listRef = useRef<HTMLDivElement>(null)
  
  const [form, setForm] = useState<CreateTaskForm>({
    chatType: 2,
    peerUid: "",
    sessionName: "",
    format: "JSON",
    startTime: "",
    endTime: "",
    keywords: "",
    includeRecalled: false,
  })

  const { groupSearch, friendSearch } = useSearch()

  // Update form when prefilled data changes
  React.useEffect(() => {
    if (prefilledData && isOpen) {
      setForm({
        chatType: prefilledData.chatType || 2,
        peerUid: prefilledData.peerUid || "",
        sessionName: prefilledData.sessionName || "",
        format: prefilledData.format || "JSON",
        startTime: prefilledData.startTime || "",
        endTime: prefilledData.endTime || "",
        keywords: prefilledData.keywords || "",
        includeRecalled: prefilledData.includeRecalled || false,
      })
    }
  }, [prefilledData, isOpen])

  // Auto-select target when prefilled data is provided
  React.useEffect(() => {
    if (prefilledData?.peerUid && isOpen) {
      const targetList = prefilledData.chatType === 2 ? groups : friends
      const found = targetList.find(target => {
        if (prefilledData.chatType === 2) {
          return 'groupCode' in target && target.groupCode === prefilledData.peerUid
        } else {
          return 'uid' in target && target.uid === prefilledData.peerUid
        }
      })
      
      if (found) {
        setSelectedTarget(found)
        setShowTargetSelector(false) // 有预填充数据时不显示选择器
      }
    } else if (isOpen && !prefilledData?.peerUid) {
      setSelectedTarget(null)
      setShowTargetSelector(true) // 没有预填充数据时显示选择器
    }
  }, [prefilledData, groups, friends, isOpen])

  // Auto-load data when dialog opens
  React.useEffect(() => {
    if (isOpen && onLoadData) {
      // 自动加载好友和群组数据
      console.log("[TaskWizard] Auto-loading chat data...")
      onLoadData()
    }
  }, [isOpen, onLoadData])

  // Initialize search data when groups/friends data is available
  React.useEffect(() => {
    if (isOpen && groups.length > 0 && groupSearchRef.current.allData.length === 0) {
      console.log("[TaskWizard] Initializing group search data...")
      groupSearchRef.current.load(1, 999)
    }
    if (isOpen && friends.length > 0 && friendSearchRef.current.allData.length === 0) {
      console.log("[TaskWizard] Initializing friend search data...")
      friendSearchRef.current.load(1, 999)
    }
  }, [isOpen, groups.length, friends.length])

  // Reset form when dialog opens/closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedTarget(null)
      setSearchTerm("")
      setShowTargetSelector(true)
      // 清空搜索定时器
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
      groupSearchRef.current.clear()
      friendSearchRef.current.clear()
      setForm({
        chatType: 2,
        peerUid: "",
        sessionName: "",
        format: "JSON",
        startTime: "",
        endTime: "",
        keywords: "",
        includeRecalled: false,
      })
    }
  }, [isOpen])

  // Handle selection of group or friend
  const handleSelectTarget = (target: Group | Friend) => {
    setSelectedTarget(target)
    setShowTargetSelector(false) // 选择后关闭选择器
    
    if ('groupCode' in target) {
      // It's a Group
      setForm(prev => ({
        ...prev,
        chatType: 2,
        peerUid: target.groupCode,
        sessionName: target.groupName
      }))
    } else {
      // It's a Friend
      setForm(prev => ({
        ...prev,
        chatType: 1,
        peerUid: target.uid,
        sessionName: target.remark || target.nick
      }))
    }
  }

  // 移除自动加载逻辑，避免无限循环
  
  // 使用ref存储搜索定时器和当前状态
  const searchTimerRef = useRef<NodeJS.Timeout>()
  const currentChatTypeRef = useRef(form.chatType)
  const groupSearchRef = useRef(groupSearch)
  const friendSearchRef = useRef(friendSearch)
  
  // 更新refs
  useEffect(() => {
    currentChatTypeRef.current = form.chatType
    groupSearchRef.current = groupSearch  
    friendSearchRef.current = friendSearch
  })
  
  // 处理搜索输入 - 简化版本，只更新searchTerm状态
  const handleSearchInput = useCallback((value: string) => {
    setSearchTerm(value)
    
    // 清除之前的定时器
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    
    // 设置新的定时器来触发搜索hook的搜索（如果有数据的话）
    searchTimerRef.current = setTimeout(() => {
      // 如果搜索hook有数据，也同时更新它的搜索状态
      if (groupSearchRef.current.allData.length > 0) {
        groupSearchRef.current.search(value)
      }
      if (friendSearchRef.current.allData.length > 0) {
        friendSearchRef.current.search(value)
      }
    }, 300)
  }, [])
  
  // 清理定时器
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [])

  // Get display targets (either search results or default data)
  const getDisplayTargets = () => {
    const currentSearchState = form.chatType === 2 ? groupSearch : friendSearch
    const defaultData = form.chatType === 2 ? groups : friends
    
    // 如果有搜索关键词，需要进行过滤
    if (searchTerm.trim()) {
      // 优先使用搜索hook的结果
      if (currentSearchState.allData.length > 0) {
        return currentSearchState.results
      }
      
      // 如果搜索hook没有数据，直接对默认数据进行前端过滤
      return defaultData.filter(item => {
        if (form.chatType === 2) {
          const group = item as Group
          return group.groupName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 group.groupCode.includes(searchTerm)
        } else {
          const friend = item as Friend
          return friend.nick.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 (friend.remark && friend.remark.toLowerCase().includes(searchTerm.toLowerCase())) ||
                 friend.uid.includes(searchTerm)
        }
      })
    }
    
    // 没有搜索关键词时，使用搜索hook数据或默认数据
    if (currentSearchState.allData.length > 0) {
      return currentSearchState.allData
    }
    
    return defaultData
  }

  // Handle scroll for infinite loading
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget
    const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 50
    
    const currentSearchState = currentChatTypeRef.current === 2 ? groupSearchRef.current : friendSearchRef.current
    
    // 只有在使用搜索hook数据且有更多数据可加载时才触发
    if (isNearBottom && currentSearchState.allData.length > 0 && currentSearchState.hasMore && !currentSearchState.loading) {
      if (currentChatTypeRef.current === 2) {
        groupSearchRef.current.loadMore()
      } else {
        friendSearchRef.current.loadMore()
      }
    }
  }, [])

  const handleSubmit = async () => {
    const success = await onSubmit(form)
    if (success) {
      onClose()
    }
  }

  const handleChangeTarget = useCallback(() => {
    setShowTargetSelector(true)
    setSelectedTarget(null)
    setSearchTerm("")
    // 清空搜索定时器
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    groupSearchRef.current.clear()
    friendSearchRef.current.clear()
  }, [])

  const canSubmit = () => {
    return selectedTarget !== null && form.sessionName.trim() !== ""
  }

  // 渲染左侧目标选择区域
  const renderTargetSelector = () => {
    const displayTargets = getDisplayTargets()
    const currentSearchState = form.chatType === 2 ? groupSearch : friendSearch

    return (
      <div className="space-y-4">
        {/* 聊天类型选择 */}
        <div>
          <Label className="text-base font-medium mb-3 block">选择聊天类型</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={form.chatType === 1 ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm(prev => ({ ...prev, chatType: 1 }))
                setSearchTerm("")
                // 清空搜索定时器
                if (searchTimerRef.current) {
                  clearTimeout(searchTimerRef.current)
                }
                // 清空搜索，显示所有好友
                friendSearchRef.current.search("")
              }}
              className="justify-start"
            >
              <User className="w-4 h-4 mr-2" />
              好友聊天
            </Button>
            <Button
              variant={form.chatType === 2 ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm(prev => ({ ...prev, chatType: 2 }))
                setSearchTerm("")
                // 清空搜索定时器
                if (searchTimerRef.current) {
                  clearTimeout(searchTimerRef.current)
                }
                // 清空搜索，显示所有群组
                groupSearchRef.current.search("")
              }}
              className="justify-start"
            >
              <Users className="w-4 h-4 mr-2" />
              群组聊天
            </Button>
          </div>
        </div>

        {/* 加载数据按钮和搜索框 */}
        <div className="space-y-2">
          {/* 加载数据按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (currentChatTypeRef.current === 2) {
                  groupSearchRef.current.load(1, 999)
                } else {
                  friendSearchRef.current.load(1, 999)
                }
              }}
              disabled={currentSearchState.loading}
              className="flex-shrink-0"
            >
              {currentSearchState.loading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              加载{form.chatType === 1 ? '好友' : '群组'}
            </Button>
            {currentSearchState.allData.length > 0 && (
              <span className="text-xs text-neutral-500">
                已加载 {currentSearchState.allData.length} 个
              </span>
            )}
          </div>
          
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder={form.chatType === 1 ? "搜索好友昵称、备注..." : "搜索群组名称、群号..."}
              value={searchTerm}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* 目标列表 */}
        <div 
          ref={listRef}
          className="max-h-96 overflow-y-auto space-y-1 border rounded-lg p-2"
          onScroll={handleScroll}
        >
          {/* 加载状态 */}
          {currentSearchState.loading && displayTargets.length === 0 && (
            <div className="text-center py-8 text-neutral-500">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              <p className="text-sm">搜索中...</p>
            </div>
          )}

          {/* 搜索错误 */}
          {currentSearchState.error && (
            <div className="text-center py-8 text-red-500">
              <p className="text-sm">{currentSearchState.error}</p>
            </div>
          )}

          {/* 空状态 */}
          {!currentSearchState.loading && !currentSearchState.error && displayTargets.length === 0 && (
            <div className="text-center py-8 text-neutral-500">
              <div className="mb-2">
                {form.chatType === 1 ? (
                  <User className="w-8 h-8 mx-auto text-neutral-300" />
                ) : (
                  <Users className="w-8 h-8 mx-auto text-neutral-300" />
                )}
              </div>
              <p className="text-sm">
                {searchTerm.trim() 
                  ? `没有找到匹配"${searchTerm}"的${form.chatType === 1 ? '好友' : '群组'}`
                  : `暂无${form.chatType === 1 ? '好友' : '群组'}数据`
                }
              </p>
              {!searchTerm.trim() && currentSearchState.allData.length === 0 && (
                <p className="text-xs text-neutral-400 mt-1">
                  点击上方按钮加载数据
                </p>
              )}
            </div>
          )}

          {/* 目标列表 */}
          {displayTargets.map((target) => {
            const isGroup = 'groupCode' in target
            const id = isGroup ? target.groupCode : target.uid
            const name = isGroup ? target.groupName : (target.remark || target.nick)
            const avatarUrl = target.avatarUrl
            const isSelected = selectedTarget && (
              isGroup ? 'groupCode' in selectedTarget && (selectedTarget as Group).groupCode === id
                     : 'uid' in selectedTarget && (selectedTarget as Friend).uid === id
            )
            
            return (
              <div
                key={id}
                className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                  isSelected 
                    ? "ring-2 ring-blue-500 bg-blue-50" 
                    : "hover:bg-neutral-50"
                }`}
                onClick={() => handleSelectTarget(target)}
              >
                <Avatar className="w-6 h-6">
                  <AvatarImage src={avatarUrl} alt={name} />
                  <AvatarFallback className="text-xs">
                    {name[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{name}</p>
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    {isGroup ? (
                      <>
                        <Users className="w-3 h-3" />
                        <span>{target.memberCount} 成员</span>
                      </>
                    ) : (
                      <>
                        <div className={`w-2 h-2 rounded-full ${
                          target.isOnline ? 'bg-green-500' : 'bg-neutral-300'
                        }`} />
                        <span>{target.isOnline ? '在线' : '离线'}</span>
                      </>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                )}
              </div>
            )
          })}

          {/* 加载更多指示器 */}
          {currentSearchState.allData.length > 0 && currentSearchState.hasMore && (
            <div className="text-center py-2">
              {currentSearchState.loading ? (
                <div className="flex items-center justify-center gap-2 text-neutral-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-neutral-400">
                  <ChevronDown className="w-4 h-4" />
                  <span className="text-sm">向下滚动加载更多</span>
                </div>
              )}
            </div>
          )}

          {/* 数据统计 */}
          {currentSearchState.allData.length > 0 && displayTargets.length > 0 && (
            <div className="text-center py-2 text-xs text-neutral-500 border-t">
              {searchTerm.trim() ? (
                <>
                  搜索结果：{displayTargets.length} 个
                  {currentSearchState.allData.length !== displayTargets.length && (
                    <span>（共 {currentSearchState.allData.length} 个）</span>
                  )}
                </>
              ) : (
                <>
                  已加载 {currentSearchState.allData.length} 个
                  {currentSearchState.totalCount > 0 && currentSearchState.totalCount !== currentSearchState.allData.length && (
                    <span>，共 {currentSearchState.totalCount} 个</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 渲染右侧配置区域
  const renderConfigPanel = () => {
    return (
      <div className="space-y-6">
        {/* 选中的目标信息 */}
        {selectedTarget && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-blue-900 mb-2">
                  已选择{form.chatType === 1 ? '好友' : '群组'}
                </h3>
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={selectedTarget.avatarUrl} alt={
                      'groupName' in selectedTarget ? selectedTarget.groupName : selectedTarget.nick
                    } />
                    <AvatarFallback className="text-sm">
                      {('groupName' in selectedTarget ? selectedTarget.groupName : selectedTarget.nick)[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {'groupName' in selectedTarget ? selectedTarget.groupName : (selectedTarget.remark || selectedTarget.nick)}
                    </p>
                    <p className="text-xs text-blue-700">
                      {'groupName' in selectedTarget ? 
                        `${selectedTarget.memberCount}/${selectedTarget.maxMember} 成员` : 
                        `${selectedTarget.isOnline ? '在线' : '离线'}`
                      }
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleChangeTarget}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    更换
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 任务名称 */}
        <div className="space-y-2">
          <Label htmlFor="sessionName">任务名称</Label>
          <Input
            id="sessionName"
            placeholder="为这个导出任务起个名字"
            value={form.sessionName}
            onChange={(e) => setForm(prev => ({ ...prev, sessionName: e.target.value }))}
          />
        </div>

        <Separator />

        {/* 导出格式 */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">导出格式</Label>
            <p className="text-sm text-neutral-600 mt-1">选择最适合您需求的格式</p>
          </div>
          
          <div className="space-y-3">
            {/* JSON 格式 */}
            <div 
              className={`relative cursor-pointer rounded-lg border-2 p-4 transition-all hover:shadow-md ${
                form.format === 'JSON' 
                  ? 'border-primary bg-primary/5 shadow-sm' 
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
              onClick={() => setForm(prev => ({ ...prev, format: 'JSON' }))}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 mt-0.5 ${form.format === 'JSON' ? 'text-primary' : 'text-neutral-500'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-neutral-900">JSON</h3>
                    <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded">结构化</span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">适合程序处理的结构化数据格式，保留完整信息</p>
                </div>
                {form.format === 'JSON' && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                )}
              </div>
            </div>

            {/* HTML 格式 */}
            <div 
              className={`relative cursor-pointer rounded-lg border-2 p-4 transition-all hover:shadow-md ${
                form.format === 'HTML' 
                  ? 'border-primary bg-primary/5 shadow-sm' 
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
              onClick={() => setForm(prev => ({ ...prev, format: 'HTML' }))}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 mt-0.5 ${form.format === 'HTML' ? 'text-primary' : 'text-neutral-500'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-neutral-900">HTML</h3>
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">推荐</span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">网页格式，便于浏览器查看和打印，支持富文本显示</p>
                </div>
                {form.format === 'HTML' && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                )}
              </div>
            </div>

            {/* TXT 格式 */}
            <div 
              className={`relative cursor-pointer rounded-lg border-2 p-4 transition-all hover:shadow-md ${
                form.format === 'TXT' 
                  ? 'border-primary bg-primary/5 shadow-sm' 
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
              onClick={() => setForm(prev => ({ ...prev, format: 'TXT' }))}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 mt-0.5 ${form.format === 'TXT' ? 'text-primary' : 'text-neutral-500'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-neutral-900">TXT</h3>
                    <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded">兼容</span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">纯文本格式，兼容性最好，任何设备都能打开</p>
                </div>
                {form.format === 'TXT' && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 时间范围 */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">时间范围（可选）</Label>
            <p className="text-sm text-neutral-600 mt-1">留空则导出全部历史记录</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime" className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                开始时间
              </Label>
              <Input
                id="startTime"
                type="datetime-local"
                placeholder="年/月/日 --:--"
                value={form.startTime}
                onChange={(e) => setForm(prev => ({ ...prev, startTime: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime" className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                结束时间
              </Label>
              <Input
                id="endTime"
                type="datetime-local"
                placeholder="年/月/日 --:--"
                value={form.endTime}
                onChange={(e) => setForm(prev => ({ ...prev, endTime: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>
        </div>

        {/* 关键词过滤 */}
        <div className="space-y-2">
          <Label htmlFor="keywords">关键词过滤（可选）</Label>
          <Textarea
            id="keywords"
            placeholder="用逗号分隔多个关键词，如：重要,会议,通知"
            value={form.keywords}
            onChange={(e) => setForm(prev => ({ ...prev, keywords: e.target.value }))}
            rows={3}
          />
        </div>
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            创建导出任务
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 flex gap-6 min-h-0">
          {/* 左侧：目标选择 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-1">选择导出目标</h3>
              <p className="text-sm text-neutral-600">
                选择要导出聊天记录的群组或好友
              </p>
            </div>
            
            <div className="flex-1 overflow-hidden">
              {showTargetSelector || !selectedTarget ? renderTargetSelector() : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-600 mb-3" />
                    <p className="text-sm text-neutral-600">
                      已选择目标，请在右侧配置导出选项
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleChangeTarget}
                      className="mt-2"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      重新选择
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 分隔线 */}
          <Separator orientation="vertical" className="h-full" />
          
          {/* 右侧：配置选项 */}
          <div className="w-3/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-1">配置导出选项</h3>
              <p className="text-sm text-neutral-600">
                设置导出格式、时间范围和过滤条件
              </p>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {selectedTarget ? renderConfigPanel() : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-neutral-500">
                    <FileText className="w-12 h-12 mx-auto text-neutral-300 mb-3" />
                    <p className="text-sm">
                      请先在左侧选择要导出的群组或好友
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* 底部按钮 */}
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          <div className="text-sm text-neutral-500">
            {selectedTarget && form.sessionName.trim() ? (
              <span className="text-green-600">✓ 准备就绪，可以创建任务</span>
            ) : (
              <span>请完成所有必填项</span>
            )}
          </div>
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={!canSubmit() || isLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  创建任务
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}