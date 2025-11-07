"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"
import { Label } from "./label"
import { Badge } from "./badge"
import { Separator } from "./separator"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import {
  Users, User, Search, Loader2, ChevronDown, RefreshCw, Settings, Eye, FileText, CheckCircle, X
} from "lucide-react"
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
  onPreview?: (chat: {
    type: 'group' | 'friend',
    id: string,
    name: string,
    peer: { chatType: number, peerUid: string }
  }) => void
}

export function TaskWizard({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  prefilledData,
  groups = [],
  friends = [],
  onLoadData,
  onPreview
}: TaskWizardProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedTarget, setSelectedTarget] = useState<Group | Friend | null>(null)
  const [showTargetSelector, setShowTargetSelector] = useState(false)
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
    includeSystemMessages: true,
    filterPureImageMessages: false,
    exportAsZip: false,
  })

  const { groupSearch, friendSearch } = useSearch()

  // ----- sync prefilled
  useEffect(() => {
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
        includeSystemMessages:
          prefilledData.includeSystemMessages !== undefined ? prefilledData.includeSystemMessages : true,
        filterPureImageMessages: prefilledData.filterPureImageMessages || false,
        exportAsZip: prefilledData.exportAsZip || false,
      })
    }
  }, [prefilledData, isOpen])

  useEffect(() => {
    if (prefilledData?.peerUid && isOpen) {
      const targetList = prefilledData.chatType === 2 ? groups : friends
      const found = targetList.find((t) => {
        if (prefilledData.chatType === 2) return "groupCode" in t && t.groupCode === prefilledData.peerUid
        return "uid" in t && t.uid === prefilledData.peerUid
      })
      if (found) {
        setSelectedTarget(found)
        setShowTargetSelector(false)
      }
    } else if (isOpen && !prefilledData?.peerUid) {
      setSelectedTarget(null)
      setShowTargetSelector(true)
    }
  }, [prefilledData, groups, friends, isOpen])

  // auto load chat list
  useEffect(() => {
    if (isOpen && onLoadData) onLoadData()
  }, [isOpen, onLoadData])

  // init search data
  const groupSearchRef = useRef(groupSearch)
  const friendSearchRef = useRef(friendSearch)
  const searchTimerRef = useRef<NodeJS.Timeout>()
  const currentChatTypeRef = useRef(form.chatType)

  useEffect(() => {
    groupSearchRef.current = groupSearch
    friendSearchRef.current = friendSearch
    currentChatTypeRef.current = form.chatType
  })

  useEffect(() => {
    if (isOpen && groups.length > 0 && groupSearchRef.current.allData.length === 0) {
      groupSearchRef.current.load(1, 999)
    }
    if (isOpen && friends.length > 0 && friendSearchRef.current.allData.length === 0) {
      friendSearchRef.current.load(1, 999)
    }
  }, [isOpen, groups.length, friends.length])

  useEffect(() => {
    if (!isOpen) {
      setSelectedTarget(null)
      setSearchTerm("")
      setShowTargetSelector(true)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
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
        includeSystemMessages: true,
        filterPureImageMessages: false,
        exportAsZip: false,
      })
    }
  }, [isOpen])

  const handleSelectTarget = (target: Group | Friend) => {
    setSelectedTarget(target)
    setShowTargetSelector(false)
    if ("groupCode" in target) {
      setForm((p) => ({ ...p, chatType: 2, peerUid: target.groupCode, sessionName: target.groupName }))
    } else {
      setForm((p) => ({ ...p, chatType: 1, peerUid: target.uid, sessionName: target.remark || target.nick }))
    }
  }

  const handleSearchInput = useCallback((value: string) => {
    setSearchTerm(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      if (groupSearchRef.current.allData.length > 0) groupSearchRef.current.search(value)
      if (friendSearchRef.current.allData.length > 0) friendSearchRef.current.search(value)
    }, 300)
  }, [])

  useEffect(() => () => searchTimerRef.current && clearTimeout(searchTimerRef.current), [])

  const getDisplayTargets = () => {
    const s = form.chatType === 2 ? groupSearch : friendSearch
    const defaultData = form.chatType === 2 ? groups : friends
    if (searchTerm.trim()) {
      if (s.allData.length > 0) return s.results
      return defaultData.filter((item) => {
        if (form.chatType === 2) {
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

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
    const s = currentChatTypeRef.current === 2 ? groupSearchRef.current : friendSearchRef.current
    if (isNearBottom && s.allData.length > 0 && s.hasMore && !s.loading) {
      currentChatTypeRef.current === 2 ? groupSearchRef.current.loadMore() : friendSearchRef.current.loadMore()
    }
  }, [])

  const handleSubmit = async () => {
    const success = await onSubmit(form)
    if (success) onClose()
  }

  const handleChangeTarget = useCallback(() => {
    setShowTargetSelector(true)
    setSelectedTarget(null)
    setSearchTerm("")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    groupSearchRef.current.clear()
    friendSearchRef.current.clear()
  }, [])

  const canSubmit = () => selectedTarget !== null && form.sessionName.trim() !== ""

  // ---------------- UI pieces ----------------
  const renderTargetSelector = () => {
    const displayTargets = getDisplayTargets()
    const s = form.chatType === 2 ? groupSearch : friendSearch

    return (
      <div className="space-y-4">
        {/* 类型切换 */}
        <div>
          <Label className="text-sm font-medium mb-2 block">选择聊天类型</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={form.chatType === 1 ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm((p) => ({ ...p, chatType: 1 }))
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
              variant={form.chatType === 2 ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm((p) => ({ ...p, chatType: 2 }))
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
              disabled={s.loading}
              className="rounded-full"
            >
              {s.loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              加载{form.chatType === 1 ? "好友" : "群组"}
            </Button>
            {s.allData.length > 0 && <span className="text-xs text-neutral-500">已加载 {s.allData.length} 个</span>}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder={form.chatType === 1 ? "搜索好友昵称、备注..." : "搜索群组名称、群号..."}
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
          {s.loading && displayTargets.length === 0 && (
            <div className="text-center py-10 text-neutral-500">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              <p className="text-sm">搜索中...</p>
            </div>
          )}

          {s.error && (
            <div className="text-center py-10 text-red-600 text-sm">
              {s.error}
            </div>
          )}

          {!s.loading && !s.error && displayTargets.length === 0 && (
            <div className="text-center py-10 text-neutral-500">
              <div className="mb-2">
                {form.chatType === 1 ? (
                  <User className="w-8 h-8 mx-auto text-neutral-300" />
                ) : (
                  <Users className="w-8 h-8 mx-auto text-neutral-300" />
                )}
              </div>
              <p className="text-sm">
                {searchTerm.trim()
                  ? `没有找到匹配 "${searchTerm}" 的${form.chatType === 1 ? "好友" : "群组"}`
                  : `暂无${form.chatType === 1 ? "好友" : "群组"}数据`}
              </p>
              {!searchTerm.trim() && s.allData.length === 0 && (
                <p className="text-xs text-neutral-400 mt-1">点击上方按钮加载数据</p>
              )}
            </div>
          )}

          {displayTargets.map((target) => {
            const isGroup = "groupCode" in target
            const id = isGroup ? target.groupCode : target.uid
            const name = isGroup ? target.groupName : target.remark || target.nick
            const avatarUrl = target.avatarUrl
            const isSelected =
              !!selectedTarget &&
              (isGroup
                ? "groupCode" in selectedTarget && (selectedTarget as Group).groupCode === id
                : "uid" in selectedTarget && (selectedTarget as Friend).uid === id)

            return (
              <div
                key={id}
                className={[
                  "flex items-center gap-2 p-2 rounded-xl cursor-pointer transition",
                  "border border-transparent",
                  isSelected ? "ring-1 ring-neutral-300 bg-neutral-50 border-neutral-200" : "hover:bg-neutral-50"
                ].join(" ")}
                onClick={() => handleSelectTarget(target)}
              >
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
                {isSelected && <CheckCircle className="w-4 h-4 text-blue-600" />}
              </div>
            )
          })}

          {s.allData.length > 0 && s.hasMore && (
            <div className="text-center py-2">
              {s.loading ? (
                <div className="flex items-center justify-center gap-2 text-neutral-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 text-neutral-400">
                  <ChevronDown className="w-4 h-4" />
                  <span className="text-sm">向下滚动加载更多</span>
                </div>
              )}
            </div>
          )}

          {s.allData.length > 0 && displayTargets.length > 0 && (
            <div className="text-center py-2 text-xs text-neutral-500 border-t">
              {searchTerm.trim() ? (
                <>
                  搜索结果：{displayTargets.length} 个
                  {s.allData.length !== displayTargets.length && <span>（共 {s.allData.length} 个）</span>}
                </>
              ) : (
                <>
                  已加载 {s.allData.length} 个
                  {s.totalCount > 0 && s.totalCount !== s.allData.length && <span>，共 {s.totalCount} 个</span>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderConfigPanel = () => {
    return (
      <div className="space-y-6">
        {selectedTarget && (
          <div className="p-4 rounded-2xl border border-neutral-200 bg-white/70">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-neutral-900 mb-2">已选择 {form.chatType === 1 ? "好友" : "群组"}</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8 rounded-xl">
                    <AvatarImage
                      src={selectedTarget.avatarUrl}
                      alt={"groupName" in selectedTarget ? selectedTarget.groupName : selectedTarget.nick}
                    />
                    <AvatarFallback className="rounded-xl text-sm">
                      {("groupName" in selectedTarget ? selectedTarget.groupName : selectedTarget.nick)[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {"groupName" in selectedTarget
                        ? selectedTarget.groupName
                        : selectedTarget.remark || selectedTarget.nick}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {"groupName" in selectedTarget
                        ? `${selectedTarget.memberCount}/${selectedTarget.maxMember} 成员`
                        : `${selectedTarget.isOnline ? "在线" : "离线"}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {onPreview && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => {
                          const isGroup = "groupName" in selectedTarget
                          onPreview({
                            type: isGroup ? "group" : "friend",
                            id: isGroup ? selectedTarget.groupCode : selectedTarget.uid,
                            name: isGroup ? selectedTarget.groupName : selectedTarget.remark || selectedTarget.nick,
                            peer: { chatType: isGroup ? 2 : 1, peerUid: isGroup ? selectedTarget.groupCode : selectedTarget.uid }
                          })
                        }}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        预览
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="rounded-full" onClick={handleChangeTarget}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      更换
                    </Button>
                  </div>
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
            onChange={(e) => setForm((p) => ({ ...p, sessionName: e.target.value }))}
            className="rounded-xl"
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
            {(["JSON", "HTML", "TXT", "EXCEL"] as const).map((fmt) => {
              const desc =
                fmt === "JSON"
                  ? "结构化数据，保留完整信息"
                  : fmt === "HTML"
                  ? "网页格式，适合直接查看与打印"
                  : fmt === "EXCEL"
                  ? "Excel格式，便于数据分析"
                  : "纯文本，兼容性最好"
              const chip =
                fmt === "JSON" ? "结构化" : fmt === "HTML" ? "推荐" : fmt === "EXCEL" ? "数据分析" : "兼容"
              const chipClass =
                fmt === "JSON" ? "bg-neutral-100 text-neutral-600" : fmt === "HTML" ? "bg-blue-100 text-blue-600" : fmt === "EXCEL" ? "bg-purple-100 text-purple-600" : "bg-green-100 text-green-600"
              const active = form.format === fmt
              return (
                <div
                  key={fmt}
                  className={[
                    "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                    active ? "border-blue-500 bg-blue-50/50 shadow-sm" : "border-neutral-200 hover:border-neutral-300"
                  ].join(" ")}
                  onClick={() => setForm((p) => ({ ...p, format: fmt }))}
                >
                  <div className="flex items-start gap-3">
                    <div className={active ? "text-blue-600" : "text-neutral-500"}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-neutral-900">{fmt}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>{chip}</span>
                      </div>
                      <p className="text-sm text-neutral-600 mt-1">{desc}</p>
                    </div>
                    {active && <div className="w-2 h-2 bg-blue-600 rounded-full" />}
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
            <p className="text-sm text-neutral-600 mt-1">留空则导出全部历史记录</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">开始时间</Label>
              <Input
                id="startTime"
                type="datetime-local"
                placeholder="年/月/日 --:--"
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                className="font-mono rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">结束时间</Label>
              <Input
                id="endTime"
                type="datetime-local"
                placeholder="年/月/日 --:--"
                value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                className="font-mono rounded-xl"
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
            onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
            rows={3}
            className="rounded-2xl"
          />
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
                id: "includeRecalled",
                checked: form.includeRecalled,
                set: (v: boolean) => setForm((p) => ({ ...p, includeRecalled: v })),
                title: "包含已撤回的消息",
                desc: "包含那些已经被撤回但仍在记录中的消息",
                visible: true
              },
              {
                id: "includeSystemMessages",
                checked: form.includeSystemMessages,
                set: (v: boolean) => setForm((p) => ({ ...p, includeSystemMessages: v })),
                title: "包含系统消息",
                desc: "包含入群通知、撤回提示等系统提示消息",
                visible: true
              },
              {
                id: "filterPureImageMessages",
                checked: form.filterPureImageMessages,
                set: (v: boolean) => setForm((p) => ({ ...p, filterPureImageMessages: v })),
                title: "过滤纯多媒体消息",
                desc: "过滤掉只包含图片/视频/音频/文件/表情等没有文字的消息",
                visible: true
              },
              {
                id: "exportAsZip",
                checked: form.exportAsZip || false,
                set: (v: boolean) => setForm((p) => ({ ...p, exportAsZip: v })),
                title: "导出为ZIP压缩包",
                desc: "将HTML文件和资源文件打包为ZIP格式（仅HTML格式可用）",
                visible: form.format === "HTML"
              }
            ].filter((opt) => opt.visible).map((opt) => (
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
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        overlayClassName="bg-white/60 backdrop-blur-xl"
        className="flex flex-col h-full p-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            创建导出任务
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-8 min-h-0 px-6 py-6">
          {/* 左侧 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">选择导出目标</h3>
              <p className="text-sm text-neutral-600">选择要导出聊天记录的群组或好友</p>
            </div>
            <div className="flex-1 overflow-hidden">
              {showTargetSelector || !selectedTarget ? (
                renderTargetSelector()
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-600 mb-3" />
                    <p className="text-sm text-neutral-600">已选择目标，请在右侧配置导出选项</p>
                    <Button variant="outline" size="sm" onClick={handleChangeTarget} className="mt-2 rounded-full">
                      <RefreshCw className="w-3 h-3 mr-1" />
                      重新选择
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator orientation="vertical" className="h-full" />

          {/* 右侧 */}
          <div className="w-3/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">配置导出选项</h3>
              <p className="text-sm text-neutral-600">设置导出格式、时间范围和过滤条件</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">{selectedTarget ? renderConfigPanel() : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-neutral-500">
                  <FileText className="w-12 h-12 mx-auto text-neutral-300 mb-3" />
                  <p className="text-sm">请先在左侧选择要导出的群组或好友</p>
                </div>
              </div>
            )}</div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <div className="text-sm text-neutral-500">
            {canSubmit() ? <span className="text-green-600">✓ 准备就绪，可以创建任务</span> : <span>请完成所有必填项</span>}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full">取消</Button>
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
