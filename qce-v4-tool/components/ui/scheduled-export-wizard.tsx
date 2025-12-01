"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Label } from "./label"
import { Switch } from "./switch"
import { Separator } from "./separator"
import { Badge } from "./badge"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import { Checkbox } from "./checkbox"
import {
  Settings, Clock, Calendar, FileText, AlertCircle, CheckCircle,
  RefreshCw, Play, Search, ChevronDown, X, Users, User, Package, Loader2
} from "lucide-react"
import type { CreateScheduledExportForm, Group, Friend } from "@/types/api"
import { useSearch } from "@/hooks/use-search"

interface ScheduledExportWizardProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (form: CreateScheduledExportForm) => Promise<boolean>
  isLoading: boolean
  prefilledData?: Partial<CreateScheduledExportForm>
  groups?: Group[]
  friends?: Friend[]
  onLoadData?: () => void
}

interface SelectedTarget {
  type: 'group' | 'friend'
  id: string
  name: string
  chatType: number
  peerUid: string
  avatarUrl?: string
}

export function ScheduledExportWizard({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  prefilledData,
  groups = [],
  friends = [],
  onLoadData,
}: ScheduledExportWizardProps) {
  // 基础配置表单
  const [baseForm, setBaseForm] = useState({
    namePrefix: "",
    scheduleType: "daily" as "daily" | "weekly" | "monthly" | "custom",
    executeTime: "02:00",
    timeRangeType: "yesterday" as "yesterday" | "last-week" | "last-month" | "last-7-days" | "last-30-days" | "custom",
    cronExpression: "",
    customTimeRange: undefined as { startTime: number; endTime: number } | undefined,
    format: "HTML" as "HTML" | "JSON" | "TXT",
    enabled: true,
    outputDir: "",
    includeResourceLinks: true,
    includeSystemMessages: true,
    filterPureImageMessages: false,
  })

  // 选中的目标
  const [selectedTargets, setSelectedTargets] = useState<SelectedTarget[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [currentChatType, setCurrentChatType] = useState<1 | 2>(2)
  const [showTargetSelector, setShowTargetSelector] = useState(true)
  
  // 搜索相关
  const { groupSearch, friendSearch } = useSearch()
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<NodeJS.Timeout>()
  const groupSearchRef = useRef(groupSearch)
  const friendSearchRef = useRef(friendSearch)
  const currentChatTypeRef = useRef(currentChatType)

  // 格式改变时自动调整filterPureImageMessages默认值
  useEffect(() => {
    if (baseForm.format === 'HTML') {
      setBaseForm(p => ({ ...p, filterPureImageMessages: false }))
    } else if (baseForm.format === 'JSON' || baseForm.format === 'TXT') {
      setBaseForm(p => ({ ...p, filterPureImageMessages: true }))
    }
  }, [baseForm.format])

  // 初始化搜索引用
  useEffect(() => {
    groupSearchRef.current = groupSearch
    friendSearchRef.current = friendSearch
    currentChatTypeRef.current = currentChatType
  })

  // 预填充数据处理
  useEffect(() => {
    if (prefilledData && isOpen) {
      const format = (prefilledData.format as "HTML" | "JSON" | "TXT") || "HTML"
      // 根据format设置filterPureImageMessages的默认值
      const defaultFilter = format === 'JSON' || format === 'TXT' ? true : false
      
      setBaseForm({
        namePrefix: prefilledData.name || "",
        scheduleType: prefilledData.scheduleType || "daily",
        executeTime: prefilledData.executeTime || "02:00",
        timeRangeType: prefilledData.timeRangeType || "yesterday",
        cronExpression: prefilledData.cronExpression || "",
        customTimeRange: prefilledData.customTimeRange,
        format: format,
        enabled: prefilledData.enabled !== false,
        outputDir: prefilledData.outputDir || "",
        includeResourceLinks: prefilledData.includeResourceLinks !== undefined ? prefilledData.includeResourceLinks : true,
        includeSystemMessages: prefilledData.includeSystemMessages !== undefined ? prefilledData.includeSystemMessages : true,
        filterPureImageMessages: prefilledData.filterPureImageMessages !== undefined 
          ? prefilledData.filterPureImageMessages 
          : defaultFilter,
      })

      // 如果有预填充的目标，添加到选中列表
      if (prefilledData.peerUid && prefilledData.sessionName) {
        const target: SelectedTarget = {
          type: prefilledData.chatType === 1 ? 'friend' : 'group',
          id: prefilledData.peerUid,
          name: prefilledData.sessionName,
          chatType: prefilledData.chatType || 2,
          peerUid: prefilledData.peerUid,
        }
        setSelectedTargets([target])
        setShowTargetSelector(false)
      }
    }
  }, [prefilledData, isOpen])

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      setBaseForm({
        namePrefix: "",
        scheduleType: "daily",
        executeTime: "02:00",
        timeRangeType: "yesterday",
        cronExpression: "",
        customTimeRange: undefined,
        format: "HTML",
        enabled: true,
        outputDir: "",
        includeResourceLinks: true,
        includeSystemMessages: true,
        filterPureImageMessages: false,
      })
      setSelectedTargets([])
      setSearchTerm("")
      setCurrentChatType(2)
      setShowTargetSelector(true)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      groupSearchRef.current.clear()
      friendSearchRef.current.clear()
    }
  }, [isOpen])

  // 自动加载数据
  useEffect(() => {
    if (isOpen && onLoadData) {
      if (groups.length === 0 && friends.length === 0) onLoadData()
    }
  }, [isOpen, onLoadData, groups.length, friends.length])

  // 初始化搜索数据
  useEffect(() => {
    if (isOpen && groups.length > 0 && groupSearchRef.current.allData.length === 0) {
      groupSearchRef.current.load(1, 999)
    }
    if (isOpen && friends.length > 0 && friendSearchRef.current.allData.length === 0) {
      friendSearchRef.current.load(1, 999)
    }
  }, [isOpen, groups.length, friends.length])

  // 清理定时器
  useEffect(() => () => searchTimerRef.current && clearTimeout(searchTimerRef.current), [])

  // 批量提交处理
  const handleSubmit = async () => {
    let successCount = 0
    
    for (const target of selectedTargets) {
      const taskForm: CreateScheduledExportForm = {
        name: baseForm.namePrefix ? `${baseForm.namePrefix}-${target.name}` : target.name,
        chatType: target.chatType,
        peerUid: target.peerUid,
        sessionName: target.name,
        scheduleType: baseForm.scheduleType,
        cronExpression: baseForm.cronExpression,
        executeTime: baseForm.executeTime,
        timeRangeType: baseForm.timeRangeType,
        customTimeRange: baseForm.customTimeRange,
        format: baseForm.format,
        enabled: baseForm.enabled,
        outputDir: baseForm.outputDir,
        includeResourceLinks: baseForm.includeResourceLinks,
        includeSystemMessages: baseForm.includeSystemMessages,
        filterPureImageMessages: baseForm.filterPureImageMessages,
      }
      
      try {
        const success = await onSubmit(taskForm)
        if (success) successCount++
      } catch (error) {
        console.error(`创建定时任务失败: ${target.name}`, error)
      }
    }
    
    if (successCount > 0) {
      onClose()
    }
  }

  const canSubmit = () => selectedTargets.length > 0 && (baseForm.namePrefix.trim() !== "" || selectedTargets.length === 1)

  // 搜索处理
  const handleSearchInput = useCallback((value: string) => {
    setSearchTerm(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      if (groupSearchRef.current.allData.length > 0) groupSearchRef.current.search(value)
      if (friendSearchRef.current.allData.length > 0) friendSearchRef.current.search(value)
    }, 300)
  }, [])

  // 获取显示的目标列表
  const getDisplayTargets = () => {
    const s = currentChatType === 2 ? groupSearch : friendSearch
    const defaultData = currentChatType === 2 ? groups : friends
    if (searchTerm.trim()) {
      if (s.allData.length > 0) return s.results
      return defaultData.filter((item) => {
        if (currentChatType === 2) {
          const g = item as Group
          return g.groupName.toLowerCase().includes(searchTerm.toLowerCase()) || g.groupCode.includes(searchTerm)
        } else {
          const f = item as Friend
          return (
            f.nick.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (f.remark && f.remark.toLowerCase().includes(searchTerm.toLowerCase())) ||
            f.uid.includes(searchTerm)
          )
        }
      })
    }
    if (s.allData.length > 0) return s.allData
    return defaultData
  }

  // 滚动加载更多
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
    const s = currentChatTypeRef.current === 2 ? groupSearchRef.current : friendSearchRef.current
    if (isNearBottom && s.allData.length > 0 && s.hasMore && !s.loading) {
      currentChatTypeRef.current === 2 ? groupSearchRef.current.loadMore() : friendSearchRef.current.loadMore()
    }
  }, [])

  // 切换目标选择
  const handleToggleTarget = (target: Group | Friend) => {
    const isGroup = "groupCode" in target
    const id = isGroup ? target.groupCode : target.uid
    const name = isGroup ? target.groupName : target.remark || target.nick
    
    const selectedTarget: SelectedTarget = {
      type: isGroup ? 'group' : 'friend',
      id,
      name,
      chatType: isGroup ? 2 : 1,
      peerUid: id,
      avatarUrl: target.avatarUrl,
    }
    
    const isSelected = selectedTargets.some(t => t.id === id && t.type === selectedTarget.type)
    
    if (isSelected) {
      setSelectedTargets(prev => prev.filter(t => !(t.id === id && t.type === selectedTarget.type)))
    } else {
      setSelectedTargets(prev => [...prev, selectedTarget])
    }
  }

  // 移除选中的目标
  const handleRemoveTarget = (targetId: string, targetType: 'group' | 'friend') => {
    setSelectedTargets(prev => prev.filter(t => !(t.id === targetId && t.type === targetType)))
  }

  const getScheduleDescription = () => {
    const time = baseForm.executeTime
    switch (baseForm.scheduleType) {
      case "daily":
        return `每天 ${time} 执行`
      case "weekly":
        return `每周一 ${time} 执行`
      case "monthly":
        return `每月1号 ${time} 执行`
      case "custom":
        return baseForm.cronExpression ? `自定义: ${baseForm.cronExpression}` : "自定义调度"
      default:
        return `每天 ${time} 执行`
    }
  }

  const getTimeRangeDescription = () => {
    switch (baseForm.timeRangeType) {
      case "yesterday":
        return "昨天（00:00-23:59）"
      case "last-week":
        return "上周（完整一周）"
      case "last-month":
        return "上月（完整一月）"
      case "last-7-days":
        return "最近7天"
      case "last-30-days":
        return "最近30天"
      case "custom":
        return "自定义时间范围"
      default:
        return "昨天（00:00-23:59）"
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        overlayClassName="bg-white/60 backdrop-blur-xl"
        className="flex flex-col h-full p-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            批量创建定时导出任务
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-8 min-h-0 px-6 py-6">
          {/* 左侧 - 目标选择 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">选择导出目标</h3>
              <p className="text-sm text-neutral-600">选择要创建定时任务的群组或好友</p>
            </div>
            
            {showTargetSelector ? (
              <div className="flex-1 overflow-hidden space-y-4">
                {/* 类型切换 */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">选择聊天类型</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={currentChatType === 1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setCurrentChatType(1)
                        setSearchTerm("")
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                        friendSearchRef.current.search("")
                      }}
                      className="justify-center rounded-full"
                    >
                      <User className="w-4 h-4 mr-2" />
                      好友聊天
                    </Button>
                    <Button
                      variant={currentChatType === 2 ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setCurrentChatType(2)
                        setSearchTerm("")
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                        groupSearchRef.current.search("")
                      }}
                      className="justify-center rounded-full"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      群组聊天
                    </Button>
                  </div>
                </div>

                {/* 加载 & 搜索 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentChatTypeRef.current === 2) groupSearchRef.current.load(1, 999)
                        else friendSearchRef.current.load(1, 999)
                      }}
                      disabled={(currentChatType === 2 ? groupSearch : friendSearch).loading}
                      className="rounded-full"
                    >
                      {(currentChatType === 2 ? groupSearch : friendSearch).loading ? 
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : 
                        <RefreshCw className="w-3 h-3 mr-1" />
                      }
                      加载{currentChatType === 1 ? "好友" : "群组"}
                    </Button>
                    {(currentChatType === 2 ? groupSearch : friendSearch).allData.length > 0 && (
                      <span className="text-xs text-neutral-500">
                        已加载 {(currentChatType === 2 ? groupSearch : friendSearch).allData.length} 个
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <Input
                      placeholder={currentChatType === 1 ? "搜索好友昵称、备注..." : "搜索群组名称、群号..."}
                      value={searchTerm}
                      onChange={(e) => handleSearchInput(e.target.value)}
                      className="pl-10 rounded-full"
                    />
                  </div>
                </div>

                {/* 列表 */}
                <div
                  ref={listRef}
                  className="max-h-96 overflow-y-auto space-y-1 border border-neutral-200 rounded-2xl p-2 bg-white/70"
                  onScroll={handleScroll}
                >
                  {(currentChatType === 2 ? groupSearch : friendSearch).loading && getDisplayTargets().length === 0 && (
                    <div className="text-center py-10 text-neutral-500">
                      <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
                      <p className="text-sm">搜索中...</p>
                    </div>
                  )}

                  {!((currentChatType === 2 ? groupSearch : friendSearch).loading) && getDisplayTargets().length === 0 && (
                    <div className="text-center py-10 text-neutral-500">
                      <div className="mb-2">
                        {currentChatType === 1 ? (
                          <User className="w-8 h-8 mx-auto text-neutral-300" />
                        ) : (
                          <Users className="w-8 h-8 mx-auto text-neutral-300" />
                        )}
                      </div>
                      <p className="text-sm">
                        {searchTerm.trim()
                          ? `没有找到匹配 "${searchTerm}" 的${currentChatType === 1 ? "好友" : "群组"}`
                          : `暂无${currentChatType === 1 ? "好友" : "群组"}数据`}
                      </p>
                      {!searchTerm.trim() && (currentChatType === 2 ? groupSearch : friendSearch).allData.length === 0 && (
                        <p className="text-xs text-neutral-400 mt-1">点击上方按钮加载数据</p>
                      )}
                    </div>
                  )}

                  {getDisplayTargets().map((target) => {
                    const isGroup = "groupCode" in target
                    const id = isGroup ? target.groupCode : target.uid
                    const name = isGroup ? target.groupName : target.remark || target.nick
                    const avatarUrl = target.avatarUrl
                    const isSelected = selectedTargets.some(t => t.id === id && t.type === (isGroup ? 'group' : 'friend'))

                    return (
                      <div
                        key={id}
                        className={[
                          "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all",
                          "border border-transparent mt-2",
                          isSelected ? "bg-blue-50/50" : "hover:bg-neutral-50"
                        ].join(" ")}
                        onClick={() => handleToggleTarget(target)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onChange={() => {}}
                          className="pointer-events-none"
                        />
                        <Avatar className="w-7 h-7 rounded-xl">
                          <AvatarImage src={avatarUrl} alt={name} />
                          <AvatarFallback className="rounded-xl text-xs">{name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{name}</p>
                          <div className="flex items-center gap-2 text-xs text-neutral-500">
                            {isGroup ? (
                              <>
                                <Users className="w-3 h-3" />
                                <span>{(target as Group).memberCount} 成员</span>
                              </>
                            ) : (
                              <>
                                <span
                                  className={`inline-block w-2 h-2 rounded-full ${
                                    (target as Friend).isOnline ? "bg-green-500" : "bg-neutral-300"
                                  }`}
                                />
                                <span>{(target as Friend).isOnline ? "在线" : "离线"}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedTargets.length > 0 && (
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-sm text-neutral-600">
                      已选择 {selectedTargets.length} 个会话
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTargetSelector(false)}
                      className="rounded-full"
                    >
                      下一步
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto space-y-1 rounded-2xl border border-neutral-200 p-2 bg-white/70">
                    {selectedTargets.map((target, idx) => (
                      <div 
                        key={`${target.type}_${target.id}`} 
                        className="flex items-center gap-3 p-3 rounded-xl bg-blue-50/50 border border-blue-200"
                      >
                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">
                          {idx + 1}
                        </div>
                        <Avatar className="w-8 h-8 rounded-xl">
                          <AvatarImage src={target.avatarUrl} alt={target.name} />
                          <AvatarFallback className="rounded-xl text-sm">{target.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge 
                              variant={target.type === 'group' ? 'default' : 'secondary'} 
                              className="text-xs"
                            >
                              {target.type === 'group' ? (
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
                          <p className="font-medium text-sm text-blue-900 truncate">
                            {target.name}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveTarget(target.id, target.type)}
                          className="h-6 w-6 p-0 rounded-full"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                </div>
                
                <div className="flex justify-between items-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTargetSelector(true)}
                    className="rounded-full"
                  >
                    重新选择
                  </Button>
                  <span className="text-sm text-neutral-600">
                    共 {selectedTargets.length} 个会话
                  </span>
                </div>
              </div>
            )}
          </div>

          <Separator orientation="vertical" className="h-full" />

          {/* 右侧 - 配置选项 */}
          <div className="w-3/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">配置定时任务</h3>
              <p className="text-sm text-neutral-600">设置调度规则、导出格式和其他选项</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-6">
              {/* 任务名称前缀 */}
              <div className="space-y-2">
                <Label htmlFor="namePrefix">任务名称前缀（可选）</Label>
                <Input
                  id="namePrefix"
                  placeholder="例如：每日备份"
                  value={baseForm.namePrefix}
                  onChange={(e) => setBaseForm(p => ({ ...p, namePrefix: e.target.value }))}
                  className="rounded-xl"
                />
                <p className="text-xs text-neutral-500">
                  {selectedTargets.length > 1 
                    ? `将为每个会话创建任务，格式：${baseForm.namePrefix || "任务名称"}-会话名称`
                    : "留空则使用会话名称作为任务名称"
                  }
                </p>
              </div>

              {/* 调度设置 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">调度设置</Label>
                  <p className="text-sm text-neutral-600 mt-1">设置任务执行的时间规则</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>调度类型</Label>
                    <Select 
                      value={baseForm.scheduleType} 
                      onValueChange={(v: any) => setBaseForm(p => ({ ...p, scheduleType: v }))}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">每天执行</SelectItem>
                        <SelectItem value="weekly">每周执行（周一）</SelectItem>
                        <SelectItem value="monthly">每月执行（1号）</SelectItem>
                        <SelectItem value="custom">自定义（cron表达式）</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {baseForm.scheduleType === "custom" ? (
                    <div className="space-y-2">
                      <Label>Cron 表达式</Label>
                      <Input
                        placeholder="0 2 * * * (分 时 日 月 周)"
                        value={baseForm.cronExpression}
                        onChange={(e) => setBaseForm(p => ({ ...p, cronExpression: e.target.value }))}
                        className="rounded-xl"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>执行时间</Label>
                      <Input
                        type="time"
                        value={baseForm.executeTime}
                        onChange={(e) => setBaseForm(p => ({ ...p, executeTime: e.target.value }))}
                        className="rounded-xl"
                      />
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-2xl border border-green-200 bg-green-50">
                  <p className="text-sm text-green-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {getScheduleDescription()}
                  </p>
                </div>
              </div>

              {/* 导出设置 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">导出设置</Label>
                  <p className="text-sm text-neutral-600 mt-1">设置导出格式和时间范围</p>
                </div>

                <div className="space-y-3">
                  {/* 导出格式 */}
                  {(["HTML", "JSON", "TXT", "EXCEL"] as const).map((fmt) => {
                    const active = baseForm.format === fmt
                    const chip =
                      fmt === "HTML" ? { txt: "推荐", cls: "bg-blue-100 text-blue-600" } :
                      fmt === "JSON" ? { txt: "结构化", cls: "bg-neutral-100 text-neutral-600" } :
                      fmt === "EXCEL" ? { txt: "数据分析", cls: "bg-purple-100 text-purple-600" } :
                      { txt: "兼容", cls: "bg-green-100 text-green-600" }
                    const desc =
                      fmt === "HTML" ? "网页格式，便于浏览器查看和打印" :
                      fmt === "JSON" ? "适合程序处理的结构化数据格式" :
                      fmt === "EXCEL" ? "Excel格式，便于数据分析和统计" :
                      "纯文本格式，兼容性最好"
                    return (
                      <div
                        key={fmt}
                        className={[
                          "relative cursor-pointer rounded-2xl border-2 p-3 transition-all",
                          active ? "border-blue-500 bg-blue-50/50 shadow-sm" : "border-neutral-200 hover:border-neutral-300"
                        ].join(" ")}
                        onClick={() => setBaseForm(p => ({ ...p, format: fmt }))}
                      >
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-blue-600" : "text-neutral-500"}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-neutral-900 text-sm">{fmt}</h4>
                              <span className={`text-xs px-2 py-0.5 rounded ${chip.cls}`}>{chip.txt}</span>
                            </div>
                            <p className="text-xs text-neutral-600 mt-1">{desc}</p>
                          </div>
                          {active && <div className="w-2 h-2 bg-blue-600 rounded-full" />}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2">
                  <Label>时间范围</Label>
                  <Select 
                    value={baseForm.timeRangeType} 
                    onValueChange={(v: any) => setBaseForm(p => ({ ...p, timeRangeType: v }))}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yesterday">昨天</SelectItem>
                      <SelectItem value="last-week">上周</SelectItem>
                      <SelectItem value="last-month">上月</SelectItem>
                      <SelectItem value="last-7-days">最近7天</SelectItem>
                      <SelectItem value="last-30-days">最近30天</SelectItem>
                      <SelectItem value="custom">自定义范围</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {baseForm.timeRangeType === "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>相对开始时间（秒）</Label>
                      <Input
                        type="number"
                        placeholder="-86400 (昨天开始)"
                        value={baseForm.customTimeRange?.startTime ?? ""}
                        onChange={(e) =>
                          setBaseForm(p => ({
                            ...p,
                            customTimeRange: { 
                              startTime: parseInt(e.target.value) || 0, 
                              endTime: p.customTimeRange?.endTime || 0 
                            }
                          }))
                        }
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>相对结束时间（秒）</Label>
                      <Input
                        type="number"
                        placeholder="0 (现在)"
                        value={baseForm.customTimeRange?.endTime ?? ""}
                        onChange={(e) =>
                          setBaseForm(p => ({
                            ...p,
                            customTimeRange: { 
                              startTime: p.customTimeRange?.startTime || 0, 
                              endTime: parseInt(e.target.value) || 0 
                            }
                          }))
                        }
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-2xl border border-blue-200 bg-blue-50">
                  <p className="text-sm text-blue-800">将导出：{getTimeRangeDescription()}</p>
                </div>
              </div>

              {/* 高级选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">高级选项</Label>
                  <p className="text-sm text-neutral-600 mt-1">自定义导出内容的详细设置</p>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      id: "includeResourceLinks",
                      checked: baseForm.includeResourceLinks,
                      set: (v: boolean) => setBaseForm(p => ({ ...p, includeResourceLinks: v })),
                      title: "包含资源链接",
                      desc: "在导出中包含图片、文件等资源的下载链接"
                    },
                    {
                      id: "includeSystemMessages",
                      checked: baseForm.includeSystemMessages,
                      set: (v: boolean) => setBaseForm(p => ({ ...p, includeSystemMessages: v })),
                      title: "包含系统消息",
                      desc: "包含入群通知、撤回提示等系统提示消息"
                    },
                    {
                      id: "filterPureImageMessages",
                      checked: baseForm.filterPureImageMessages,
                      set: (v: boolean) => setBaseForm(p => ({ ...p, filterPureImageMessages: v })),
                      title: "仅导出纯文字消息（不下载资源）",
                      desc: "仅保留纯文字消息，过滤掉图片/视频/音频/文件等多媒体消息，且不下载任何资源，大幅加快导出速度"
                    }
                  ].map((opt) => (
                    <div
                      key={opt.id}
                      className={[
                        "relative cursor-pointer rounded-2xl border p-4 transition-all",
                        opt.checked ? "border-neutral-300 bg-neutral-50/50" : "border-neutral-200 hover:border-neutral-300"
                      ].join(" ")}
                      onClick={() => opt.set(!opt.checked)}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 pt-0.5">
                          <div className={[
                            "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                            opt.checked 
                              ? "border-neutral-900 bg-neutral-900" 
                              : "border-neutral-300 hover:border-neutral-400"
                          ].join(" ")}>
                            {opt.checked && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-neutral-900 text-sm">{opt.title}</h4>
                          <p className="text-neutral-600 text-sm mt-1 leading-relaxed">{opt.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 其他选项 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="enabled"
                    checked={baseForm.enabled}
                    onCheckedChange={(checked) => setBaseForm(p => ({ ...p, enabled: checked }))}
                  />
                  <Label htmlFor="enabled" className="flex items-center gap-2">
                    启用任务
                    <Badge variant={baseForm.enabled ? "default" : "secondary"}>
                      {baseForm.enabled ? "已启用" : "已禁用"}
                    </Badge>
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label>输出目录（可选）</Label>
                  <Input
                    placeholder="留空使用默认目录"
                    value={baseForm.outputDir}
                    onChange={(e) => setBaseForm(p => ({ ...p, outputDir: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <div className="text-sm text-neutral-500">
            {canSubmit() ? (
              <span className="text-green-600 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                准备就绪，将为 {selectedTargets.length} 个会话创建定时任务
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                请选择至少一个会话，然后填写任务名称前缀
              </span>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full">
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit() || isLoading}
              className="bg-blue-600 hover:bg-blue-700 rounded-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  批量创建任务
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}