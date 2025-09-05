"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Label } from "./label"
import { Switch } from "./switch"
import { Separator } from "./separator"
import { Badge } from "./badge"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import {
  Settings, 
  Clock, 
  Calendar, 
  FileText, 
  AlertCircle, 
  CheckCircle,
  RefreshCw,
  Play,
  Search,
  ChevronDown,
  X
} from "lucide-react"
import type { CreateScheduledExportForm, Group, Friend } from "@/types/api"

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

export function ScheduledExportWizard({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading, 
  prefilledData,
  groups = [],
  friends = [],
  onLoadData
}: ScheduledExportWizardProps) {
  const [form, setForm] = useState<CreateScheduledExportForm>({
    name: "",
    chatType: 2,
    peerUid: "",
    sessionName: "",
    scheduleType: "daily",
    executeTime: "02:00",
    timeRangeType: "yesterday",
    format: "HTML",
    enabled: true,
  })

  const [searchTerm, setSearchTerm] = useState("")
  const [showTargetDropdown, setShowTargetDropdown] = useState(false)

  // Update form when prefilled data changes
  useEffect(() => {
    if (prefilledData && isOpen) {
      setForm({
        name: prefilledData.name || "",
        chatType: prefilledData.chatType || 2,
        peerUid: prefilledData.peerUid || "",
        sessionName: prefilledData.sessionName || "",
        scheduleType: prefilledData.scheduleType || "daily",
        cronExpression: prefilledData.cronExpression,
        executeTime: prefilledData.executeTime || "02:00",
        timeRangeType: prefilledData.timeRangeType || "yesterday",
        customTimeRange: prefilledData.customTimeRange,
        format: prefilledData.format || "HTML",
        enabled: prefilledData.enabled !== false,
        outputDir: prefilledData.outputDir,
      })
    }
  }, [prefilledData, isOpen])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setForm({
        name: "",
        chatType: 2,
        peerUid: "",
        sessionName: "",
        scheduleType: "daily",
        executeTime: "02:00",
        timeRangeType: "yesterday",
        format: "HTML",
        enabled: true,
      })
      setSearchTerm("")
      setShowTargetDropdown(false)
    }
  }, [isOpen])

  // Auto-load data when dialog opens
  useEffect(() => {
    if (isOpen && onLoadData) {
      // 如果没有群组和好友数据，自动加载
      if (groups.length === 0 && friends.length === 0) {
        console.log("[ScheduledExportWizard] Auto-loading chat data...")
        onLoadData()
      }
    }
  }, [isOpen, onLoadData, groups.length, friends.length])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (showTargetDropdown && !target.closest('[data-target-selector]')) {
        setShowTargetDropdown(false)
        setSearchTerm("")
      }
    }

    if (showTargetDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showTargetDropdown])

  const handleSubmit = async () => {
    const success = await onSubmit(form)
    if (success) {
      onClose()
    }
  }

  const canSubmit = () => {
    return form.name.trim() !== "" && form.peerUid.trim() !== "" && form.sessionName.trim() !== ""
  }

  // Filter targets based on search term
  const getFilteredTargets = () => {
    const targets = form.chatType === 2 ? groups : friends
    if (!searchTerm.trim()) {
      return targets
    }

    return targets.filter(target => {
      if (form.chatType === 2) {
        const group = target as Group
        return group.groupName.toLowerCase().includes(searchTerm.toLowerCase()) ||
               group.groupCode.includes(searchTerm)
      } else {
        const friend = target as Friend
        return friend.nick.toLowerCase().includes(searchTerm.toLowerCase()) ||
               (friend.remark && friend.remark.toLowerCase().includes(searchTerm.toLowerCase())) ||
               friend.uid.includes(searchTerm)
      }
    })
  }

  const handleSelectTarget = (target: Group | Friend) => {
    const id = 'groupCode' in target ? target.groupCode : target.uid
    const name = 'groupCode' in target ? target.groupName : (target.remark || target.nick)
    
    setForm(prev => ({
      ...prev,
      peerUid: id,
      sessionName: name
    }))
    setShowTargetDropdown(false)
    setSearchTerm("")
  }

  // Find selected target info
  const selectedTarget = form.peerUid ? 
    (form.chatType === 2 ? 
      groups.find(g => g.groupCode === form.peerUid) :
      friends.find(f => f.uid === form.peerUid)
    ) : null

  const getScheduleDescription = () => {
    const time = form.executeTime
    switch (form.scheduleType) {
      case 'daily':
        return `每天 ${time} 执行`
      case 'weekly':
        return `每周一 ${time} 执行`
      case 'monthly':
        return `每月1号 ${time} 执行`
      case 'custom':
        return form.cronExpression ? `自定义: ${form.cronExpression}` : '自定义调度'
      default:
        return `每天 ${time} 执行`
    }
  }

  const getTimeRangeDescription = () => {
    switch (form.timeRangeType) {
      case 'yesterday':
        return '昨天（00:00-23:59）'
      case 'last-week':
        return '上周（完整一周）'
      case 'last-month':
        return '上月（完整一月）'
      case 'last-7-days':
        return '最近7天'
      case 'last-30-days':
        return '最近30天'
      case 'custom':
        return '自定义时间范围'
      default:
        return '昨天（00:00-23:59）'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            创建定时导出任务
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <FileText className="w-5 h-5" />
              基本信息
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">任务名称</Label>
                <Input
                  id="name"
                  placeholder="例如：每日备份-工作群"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="sessionName">会话名称</Label>
                <Input
                  id="sessionName"
                  placeholder="群组或好友名称"
                  value={form.sessionName}
                  onChange={(e) => setForm(prev => ({ ...prev, sessionName: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>聊天类型</Label>
                <Select 
                  value={form.chatType.toString()} 
                  onValueChange={(value) => {
                    setForm(prev => ({ ...prev, chatType: parseInt(value), peerUid: "", sessionName: "" }))
                    setSearchTerm("")
                    setShowTargetDropdown(false)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">好友聊天</SelectItem>
                    <SelectItem value="2">群组聊天</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>目标会话</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onLoadData?.()}
                    disabled={isLoading}
                    className="h-6 px-2 text-xs"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3 mr-1" />
                        刷新
                      </>
                    )}
                  </Button>
                </div>
                <div className="relative" data-target-selector>
                  {/* Custom Select Button */}
                  <div
                    className={`flex items-center justify-between w-full px-3 py-2 text-sm bg-white border border-neutral-200 rounded-md cursor-pointer hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      isLoading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    onClick={() => !isLoading && setShowTargetDropdown(!showTargetDropdown)}
                  >
                    <span className={form.peerUid ? "text-neutral-900" : "text-neutral-500"}>
                      {form.peerUid ? (
                        selectedTarget ? (
                          'groupName' in selectedTarget ? selectedTarget.groupName : (selectedTarget.remark || selectedTarget.nick)
                        ) : form.sessionName
                      ) : (
                        (form.chatType === 2 ? groups.length === 0 : friends.length === 0) && !isLoading
                          ? `暂无${form.chatType === 1 ? '好友' : '群组'}数据，点击刷新加载`
                          : isLoading
                          ? "加载中..."
                          : `选择${form.chatType === 1 ? '好友' : '群组'}`
                      )}
                    </span>
                    <ChevronDown className="w-4 h-4 text-neutral-500" />
                  </div>

                  {/* Dropdown Menu */}
                  {showTargetDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-neutral-200 rounded-md shadow-lg max-h-64 overflow-hidden">
                      {/* Search Box */}
                      <div className="p-2 border-b border-neutral-200">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-400" />
                          <Input
                            placeholder={form.chatType === 1 ? "搜索好友昵称、备注..." : "搜索群组名称、群号..."}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-8"
                            autoFocus
                          />
                          {searchTerm && (
                            <button
                              onClick={() => setSearchTerm("")}
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Options List */}
                      <div className="max-h-48 overflow-y-auto">
                        {(form.chatType === 2 ? groups : friends).length === 0 ? (
                          <div className="p-4 text-center text-neutral-500">
                            <div className="space-y-2">
                              {isLoading ? (
                                <>
                                  <RefreshCw className="w-6 h-6 mx-auto animate-spin" />
                                  <p className="text-sm">正在加载{form.chatType === 1 ? '好友' : '群组'}列表...</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-sm">暂无{form.chatType === 1 ? '好友' : '群组'}数据</p>
                                  <button
                                    className="text-xs text-blue-600 hover:text-blue-700 underline"
                                    onClick={() => onLoadData?.()}
                                    type="button"
                                  >
                                    点击加载
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          getFilteredTargets().map((target) => {
                            const id = 'groupCode' in target ? target.groupCode : target.uid
                            const name = 'groupCode' in target ? target.groupName : (target.remark || target.nick)
                            const isSelected = form.peerUid === id
                            
                            return (
                              <div
                                key={id}
                                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-neutral-50 ${
                                  isSelected ? 'bg-blue-50 text-blue-900' : 'text-neutral-900'
                                }`}
                                onClick={() => handleSelectTarget(target)}
                              >
                                <Avatar className="w-6 h-6">
                                  <AvatarImage src={target.avatarUrl} alt={name} />
                                  <AvatarFallback className="text-xs">
                                    {name[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{name}</p>
                                  <p className="text-xs text-neutral-500 truncate">
                                    {form.chatType === 2 ? 
                                      `${(target as Group).memberCount} 成员` : 
                                      `QQ: ${(target as Friend).uin}`
                                    }
                                  </p>
                                </div>
                                {isSelected && (
                                  <CheckCircle className="w-4 h-4 text-blue-600" />
                                )}
                              </div>
                            )
                          })
                        )}
                        
                        {getFilteredTargets().length === 0 && searchTerm && (form.chatType === 2 ? groups : friends).length > 0 && (
                          <div className="p-4 text-center text-neutral-500">
                            <p className="text-sm">没有找到匹配"{searchTerm}"的{form.chatType === 1 ? '好友' : '群组'}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 选中的目标信息 */}
            {selectedTarget && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={selectedTarget.avatarUrl} alt={
                      'groupName' in selectedTarget ? selectedTarget.groupName : selectedTarget.nick
                    } />
                    <AvatarFallback className="text-sm">
                      {('groupName' in selectedTarget ? selectedTarget.groupName : selectedTarget.nick)[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm text-blue-900">
                      {'groupName' in selectedTarget ? selectedTarget.groupName : (selectedTarget.remark || selectedTarget.nick)}
                    </p>
                    <p className="text-xs text-blue-700">
                      {'groupName' in selectedTarget ? 
                        `${selectedTarget.memberCount} 成员` : 
                        `QQ: ${selectedTarget.uin}`
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* 调度设置 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <Clock className="w-5 h-5" />
              调度设置
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>调度类型</Label>
                <Select 
                  value={form.scheduleType} 
                  onValueChange={(value: any) => setForm(prev => ({ ...prev, scheduleType: value }))}
                >
                  <SelectTrigger>
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

              {form.scheduleType === 'custom' ? (
                <div className="space-y-2">
                  <Label>Cron表达式</Label>
                  <Input
                    placeholder="0 2 * * * (分 时 日 月 周)"
                    value={form.cronExpression || ""}
                    onChange={(e) => setForm(prev => ({ ...prev, cronExpression: e.target.value }))}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>执行时间</Label>
                  <Input
                    type="time"
                    value={form.executeTime}
                    onChange={(e) => setForm(prev => ({ ...prev, executeTime: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {getScheduleDescription()}
              </p>
            </div>
          </div>

          <Separator />

          {/* 导出设置 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <FileText className="w-5 h-5" />
              导出设置
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>时间范围</Label>
                <Select 
                  value={form.timeRangeType} 
                  onValueChange={(value: any) => setForm(prev => ({ ...prev, timeRangeType: value }))}
                >
                  <SelectTrigger>
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

              <div className="space-y-2">
                <Label>导出格式</Label>
                <Select 
                  value={form.format} 
                  onValueChange={(value) => setForm(prev => ({ ...prev, format: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HTML">HTML - 网页格式</SelectItem>
                    <SelectItem value="JSON">JSON - 结构化数据</SelectItem>
                    <SelectItem value="TXT">TXT - 纯文本格式</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.timeRangeType === 'custom' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>相对开始时间（秒）</Label>
                  <Input
                    type="number"
                    placeholder="-86400 (昨天开始)"
                    value={form.customTimeRange?.startTime || ""}
                    onChange={(e) => setForm(prev => ({ 
                      ...prev, 
                      customTimeRange: {
                        startTime: parseInt(e.target.value) || 0,
                        endTime: prev.customTimeRange?.endTime || 0
                      }
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>相对结束时间（秒）</Label>
                  <Input
                    type="number"
                    placeholder="0 (现在)"
                    value={form.customTimeRange?.endTime || ""}
                    onChange={(e) => setForm(prev => ({ 
                      ...prev, 
                      customTimeRange: {
                        startTime: prev.customTimeRange?.startTime || 0,
                        endTime: parseInt(e.target.value) || 0
                      }
                    }))}
                  />
                </div>
              </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                将导出：{getTimeRangeDescription()}
              </p>
            </div>
          </div>

          <Separator />

          {/* 其他选项 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">其他选项</h3>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={form.enabled}
                onCheckedChange={(checked) => setForm(prev => ({ ...prev, enabled: checked }))}
              />
              <Label htmlFor="enabled" className="flex items-center gap-2">
                启用任务
                <Badge variant={form.enabled ? "default" : "secondary"}>
                  {form.enabled ? "已启用" : "已禁用"}
                </Badge>
              </Label>
            </div>

            <div className="space-y-2">
              <Label>输出目录（可选）</Label>
              <Input
                placeholder="留空使用默认目录"
                value={form.outputDir || ""}
                onChange={(e) => setForm(prev => ({ ...prev, outputDir: e.target.value }))}
              />
            </div>
          </div>
        </div>
        
        {/* 底部按钮 */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-neutral-500">
            {canSubmit() ? (
              <span className="text-green-600 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                准备就绪，可以创建定时任务
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                请完成所有必填项
              </span>
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
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  创建定时任务
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}