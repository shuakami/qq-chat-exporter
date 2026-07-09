"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Label } from "./label"
import { Switch } from "./switch"
import { Badge } from "./badge"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import { Checkbox } from "./checkbox"
import {
  Settings, Clock, Calendar, FileText, AlertCircle, CheckCircle,
  RefreshCw, Play, Search, ChevronDown, X, Users, User, Package
} from "lucide-react"
import { Loader } from "@/components/ui/loader"
import type { CreateScheduledExportForm, Group, Friend } from "@/types/api"
import { useSearch } from "@/hooks/use-search"
import { toggleSkipResourceType, type SkipDownloadResourceType } from "@/lib/skip-resource-types"

// 统一的药丸输入样式（与新版模态框 UI 对齐）
const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"

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
    preferGroupMemberName: true,
    // Issue #344：定时导出也支持按资源类型逐项跳过下载。
    skipDownloadResourceTypes: undefined as SkipDownloadResourceType[] | undefined,
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
        preferGroupMemberName: prefilledData.preferGroupMemberName !== undefined ? prefilledData.preferGroupMemberName : true,
        skipDownloadResourceTypes: Array.isArray(prefilledData.skipDownloadResourceTypes) && prefilledData.skipDownloadResourceTypes.length > 0
          ? (prefilledData.skipDownloadResourceTypes as SkipDownloadResourceType[])
          : undefined,
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
        preferGroupMemberName: true,
        skipDownloadResourceTypes: undefined,
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
      groupSearchRef.current.load()
    }
    if (isOpen && friends.length > 0 && friendSearchRef.current.allData.length === 0) {
      friendSearchRef.current.load()
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
        preferGroupMemberName: baseForm.preferGroupMemberName,
        ...(!baseForm.filterPureImageMessages && baseForm.skipDownloadResourceTypes && baseForm.skipDownloadResourceTypes.length > 0 && {
          skipDownloadResourceTypes: baseForm.skipDownloadResourceTypes,
        }),
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

    // Issue #364: 来自最近联系人合并的特殊会话（QQ Bot / 服务号 / 临时会话）
    // 携带原始 chatType，按其透传，避免被覆写为普通好友（chatType=1）。
    const friendChatType = !isGroup ? (target as Friend).chatType ?? 1 : 1
    const selectedTarget: SelectedTarget = {
      type: isGroup ? 'group' : 'friend',
      id,
      name,
      chatType: isGroup ? 2 : friendChatType,
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
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">批量创建定时导出任务</DialogTitle>

        <div className="flex-1 flex gap-8 min-h-0 pl-12 pr-8 pt-12 pb-6">
          {/* 左侧 - 目标选择 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col">
            <div className="mb-6">
              <h1 className="text-[20px] font-semibold text-foreground mb-2">批量创建定时任务</h1>
              <p className="text-[13px] text-muted-foreground leading-relaxed">选择要创建定时任务的群组或好友，右侧配置调度规则。</p>
            </div>
            
            {showTargetSelector ? (
              <div className="flex-1 overflow-hidden space-y-4">
                {/* 类型切换 */}
                <div>
                  <div className="flex gap-1 p-0.5 rounded-full bg-black/[0.03] dark:bg-white/[0.04]">
                    {[
                      { key: 1 as const, label: '好友', onClick: () => {
                        setCurrentChatType(1)
                        setSearchTerm("")
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                        friendSearchRef.current.search("")
                      }},
                      { key: 2 as const, label: '群组', onClick: () => {
                        setCurrentChatType(2)
                        setSearchTerm("")
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                        groupSearchRef.current.search("")
                      }},
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        onClick={tab.onClick}
                        className={[
                          "flex-1 px-3 py-1.5 text-[13px] font-medium rounded-full transition-all text-center",
                          currentChatType === tab.key
                            ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                            : "text-muted-foreground hover:text-foreground"
                        ].join(" ")}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 加载 & 搜索 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentChatTypeRef.current === 2) groupSearchRef.current.load()
                        else friendSearchRef.current.load()
                      }}
                      disabled={(currentChatType === 2 ? groupSearch : friendSearch).loading}
                      className="rounded-full"
                    >
                      {(currentChatType === 2 ? groupSearch : friendSearch).loading ? 
                        <Loader size={12} className="mr-1" /> : 
                        <RefreshCw className="w-3 h-3 mr-1" />
                      }
                      加载{currentChatType === 1 ? "好友" : "群组"}
                    </Button>
                    {(currentChatType === 2 ? groupSearch : friendSearch).allData.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        已加载 {(currentChatType === 2 ? groupSearch : friendSearch).allData.length} 个
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
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
                  className="max-h-96 overflow-y-auto space-y-1 rounded-2xl p-2 bg-card/70"
                  onScroll={handleScroll}
                >
                  {(currentChatType === 2 ? groupSearch : friendSearch).loading && getDisplayTargets().length === 0 && (
                    <div className="text-center py-10 text-muted-foreground">
                      <Loader size={24} className="mx-auto mb-2" />
                      <p className="text-sm">搜索中...</p>
                    </div>
                  )}

                  {!((currentChatType === 2 ? groupSearch : friendSearch).loading) && getDisplayTargets().length === 0 && (
                    <div className="text-center py-10 text-muted-foreground">
                      <div className="mb-2">
                        {currentChatType === 1 ? (
                          <User className="w-8 h-8 mx-auto text-muted-foreground/30" />
                        ) : (
                          <Users className="w-8 h-8 mx-auto text-muted-foreground/30" />
                        )}
                      </div>
                      <p className="text-sm">
                        {searchTerm.trim()
                          ? `没有找到匹配 "${searchTerm}" 的${currentChatType === 1 ? "好友" : "群组"}`
                          : `暂无${currentChatType === 1 ? "好友" : "群组"}数据`}
                      </p>
                      {!searchTerm.trim() && (currentChatType === 2 ? groupSearch : friendSearch).allData.length === 0 && (
                        <p className="text-xs text-muted-foreground/60 mt-1">点击上方按钮加载数据</p>
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
                          isSelected ? "bg-blue-50/50 dark:bg-blue-900/30" : "hover:bg-muted/50"
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
                          <p className="font-medium text-sm truncate text-foreground">{name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {isGroup ? (
                              <>
                                <Users className="w-3 h-3" />
                                <span>{(target as Group).memberCount} 成员</span>
                              </>
                            ) : (target as Friend).isSpecial ? (
                              <>
                                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                  {(target as Friend).specialKind === "service"
                                    ? "服务号"
                                    : (target as Friend).specialKind === "temp"
                                      ? "临时会话"
                                      : (target as Friend).specialKind === "notify"
                                        ? "通知"
                                        : "其他"}
                                </span>
                                <span className="text-muted-foreground/70">
                                  chatType={(target as Friend).chatType}
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  className={`inline-block w-2 h-2 rounded-full ${
                                    (target as Friend).isOnline ? "bg-green-500" : "bg-muted-foreground/30"
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
                    <span className="text-sm text-muted-foreground">
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
                <div className="h-full overflow-y-auto space-y-1 rounded-2xl p-2 bg-card/70">
                    {selectedTargets.map((target, idx) => (
                      <div 
                        key={`${target.type}_${target.id}`} 
                        className="flex items-center gap-3 p-3 rounded-xl bg-blue-50/50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                      >
                        <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-medium text-blue-600 dark:text-blue-300">
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
                          <p className="font-medium text-sm text-blue-900 dark:text-blue-200 truncate">
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
                  <span className="text-sm text-muted-foreground">
                    共 {selectedTargets.length} 个会话
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 右侧 - 配置选项 */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-2 space-y-10">
              {/* 基础配置 */}
              <section>
                <h2 className={SECTION_TITLE}>基础配置</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[13px] font-medium text-foreground/80">任务名称前缀</label>
                    <Input
                      id="namePrefix"
                      placeholder="例如：每日备份"
                      value={baseForm.namePrefix}
                      onChange={(e) => setBaseForm(p => ({ ...p, namePrefix: e.target.value }))}
                      className={PILL_INPUT + " w-full"}
                    />
                    <p className="text-xs text-muted-foreground">
                      {selectedTargets.length > 1 
                        ? `将为每个会话创建任务，格式：${baseForm.namePrefix || "任务名称"}-会话名称`
                        : "留空则使用会话名称作为任务名称"
                      }
                    </p>
                  </div>
                </div>
              </section>

              {/* 调度设置 */}
              <section>
                <h2 className={SECTION_TITLE}>调度设置</h2>
                <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[13px] font-medium text-foreground/80">调度类型</label>
                    <Select 
                      value={baseForm.scheduleType} 
                      onValueChange={(v: any) => setBaseForm(p => ({ ...p, scheduleType: v }))}
                    >
                      <SelectTrigger className={PILL_INPUT + " w-full"}>
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
                      <label className="text-[13px] font-medium text-foreground/80">Cron 表达式</label>
                      <Input
                        placeholder="0 2 * * * (分 时 日 月 周)"
                        value={baseForm.cronExpression}
                        onChange={(e) => setBaseForm(p => ({ ...p, cronExpression: e.target.value }))}
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[13px] font-medium text-foreground/80">执行时间</label>
                      <Input
                        type="time"
                        value={baseForm.executeTime}
                        onChange={(e) => setBaseForm(p => ({ ...p, executeTime: e.target.value }))}
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[13px] text-muted-foreground px-1">
                  <Calendar className="w-4 h-4 text-[#317CFF]" />
                  {getScheduleDescription()}
                </div>
                </div>
              </section>

              {/* 导出设置 */}
              <section>
                <h2 className={SECTION_TITLE}>导出设置</h2>
                <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-foreground/80">导出格式</label>
                  <div className="flex items-center flex-wrap gap-1 p-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                  {(["HTML", "JSON", "TXT", "EXCEL"] as const).map((fmt) => {
                    const active = baseForm.format === fmt
                    return (
                      <button
                        key={fmt}
                        type="button"
                        className={[
                          "px-4 py-1.5 text-[13px] font-medium rounded-full transition-all",
                          active
                            ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                            : "text-muted-foreground hover:text-foreground"
                        ].join(" ")}
                        onClick={() => setBaseForm(p => ({ ...p, format: fmt }))}
                      >
                        {fmt}
                      </button>
                    )
                  })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-foreground/80">时间范围</label>
                  <Select 
                    value={baseForm.timeRangeType} 
                    onValueChange={(v: any) => setBaseForm(p => ({ ...p, timeRangeType: v }))}
                  >
                    <SelectTrigger className={PILL_INPUT + " w-full"}>
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
                      <label className="text-[13px] font-medium text-foreground/80">相对开始时间（秒）</label>
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
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[13px] font-medium text-foreground/80">相对结束时间（秒）</label>
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
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-[13px] text-muted-foreground px-1">
                  <Clock className="w-4 h-4 text-[#317CFF]" />
                  将导出：{getTimeRangeDescription()}
                </div>
                </div>
              </section>

              {/* 高级选项 */}
              <section>
                <h2 className={SECTION_TITLE}>高级选项</h2>
                <div className="space-y-2.5">
                  <h3 className="text-[12px] font-medium text-muted-foreground pl-1">导出内容</h3>
                  <div className="bg-neutral-50/50 dark:bg-white/[0.03] rounded-2xl border border-neutral-100/80 dark:border-white/[0.06] overflow-hidden divide-y divide-neutral-100/80 dark:divide-white/[0.06]">
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
                      title: "快速导出（跳过资源下载）",
                      desc: "保留所有消息记录，但不下载图片/视频/音频等资源文件，大幅加快导出速度",
                      visible: true,
                    },
                    // Issue #344：定时导出也支持分别控制图片 / 视频 / 音频 / 文件是否参与下载。
                    {
                      id: "skipFileDownloadOnly",
                      checked: !!baseForm.skipDownloadResourceTypes?.includes('file'),
                      set: (v: boolean) => setBaseForm(p => ({ ...p, skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'file', v) })),
                      title: "仅保留文件元数据，不下载文件",
                      desc: "图片 / 视频 / 音频仍正常下载；只有文件类资源（群文件、聊天发送的文档等）只保留文件名、大小、MD5 等元信息。",
                      visible: !baseForm.filterPureImageMessages,
                    },
                    {
                      id: "skipImageDownload",
                      checked: !!baseForm.skipDownloadResourceTypes?.includes('image'),
                      set: (v: boolean) => setBaseForm(p => ({ ...p, skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'image', v) })),
                      title: "不下载图片",
                      desc: "定时导出时跳过图片资源的下载。适用于只需定期备份文本记录、不在意图片的场景。",
                      visible: !baseForm.filterPureImageMessages,
                    },
                    {
                      id: "skipVideoDownload",
                      checked: !!baseForm.skipDownloadResourceTypes?.includes('video'),
                      set: (v: boolean) => setBaseForm(p => ({ ...p, skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'video', v) })),
                      title: "不下载视频",
                      desc: "定时导出时跳过视频资源，避免定时任务下载大量视频占用带宽和磁盘。",
                      visible: !baseForm.filterPureImageMessages,
                    },
                    {
                      id: "skipAudioDownload",
                      checked: !!baseForm.skipDownloadResourceTypes?.includes('audio'),
                      set: (v: boolean) => setBaseForm(p => ({ ...p, skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'audio', v) })),
                      title: "不下载语音",
                      desc: "定时导出时跳过 SILK / AMR 语音消息。对只需要文字记录的备份场景很有用。",
                      visible: !baseForm.filterPureImageMessages,
                    },
                    {
                      id: "preferGroupMemberName",
                      checked: baseForm.preferGroupMemberName,
                      set: (v: boolean) => setBaseForm(p => ({ ...p, preferGroupMemberName: v })),
                      title: "优先使用群成员名称",
                      desc: "群聊导出时优先使用群名片或群内名称。关闭后会改用 QQ 昵称或 QQ 号。这个选项仅对群聊生效。",
                      visible: true,
                    }
                  ].filter((opt) => (opt as any).visible !== false).map((opt) => (
                    <div
                      key={opt.id}
                      className="flex items-center justify-between gap-6 group p-4 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5 flex-1 pr-4">
                        <div className="text-[13px] font-medium text-foreground">{opt.title}</div>
                        {opt.desc && (
                          <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">{opt.desc}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <Switch checked={opt.checked} onCheckedChange={(v) => opt.set(v)} />
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </section>

              {/* 其他选项 */}
              <section>
                <h2 className={SECTION_TITLE}>其他选项</h2>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-foreground">启用任务</div>
                      <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        {baseForm.enabled ? "创建后立即按计划执行" : "创建后暂不执行，可稍后手动启用"}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Switch
                        checked={baseForm.enabled}
                        onCheckedChange={(checked) => setBaseForm(p => ({ ...p, enabled: checked }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="text-[13px] font-medium text-foreground/80">输出目录</label>
                    <Input
                      placeholder="留空使用默认目录"
                      value={baseForm.outputDir}
                      onChange={(e) => setBaseForm(p => ({ ...p, outputDir: e.target.value }))}
                      className={PILL_INPUT + " w-full"}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {canSubmit() ? (
              <span className="text-foreground">配置就绪，将为 {selectedTargets.length} 个会话创建定时任务</span>
            ) : (
              <span>请选择会话并填写任务名称前缀</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit() || isLoading}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {isLoading ? "创建中..." : "批量创建任务"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
