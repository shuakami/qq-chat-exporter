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
  Users, User, Search, Loader2, ChevronDown, RefreshCw, Settings, Eye, FileText, CheckCircle, X, UserMinus, Check
} from "lucide-react"
import { useSearch } from "@/hooks/use-search"
import type { CreateTaskForm, Group, Friend, GroupMember } from "@/types/api"
import { Checkbox } from "./checkbox"

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
  onExportAvatars?: (groupCode: string, groupName: string) => void
  avatarExportLoading?: string | null
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
  onPreview,
  onExportAvatars,
  avatarExportLoading
}: TaskWizardProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedTarget, setSelectedTarget] = useState<Group | Friend | null>(null)
  const [showTargetSelector, setShowTargetSelector] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  
  // 手动输入QQ号模式（Issue #226）
  const [manualInputMode, setManualInputMode] = useState(false)
  const [manualQQNumber, setManualQQNumber] = useState("")
  const [manualSessionName, setManualSessionName] = useState("")
  
  // 群成员选择器状态
  const [showMemberSelector, setShowMemberSelector] = useState(false)
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [selectedMemberUins, setSelectedMemberUins] = useState<Set<string>>(new Set())
  const [memberSearchTerm, setMemberSearchTerm] = useState("")

  const [form, setForm] = useState<CreateTaskForm>({
    chatType: 2,
    peerUid: "",
    sessionName: "",
    format: "JSON",
    startTime: "",
    endTime: "",
    keywords: "",
    excludeUserUins: "",
    includeRecalled: false,
    includeSystemMessages: true,
    filterPureImageMessages: true, // JSON/TXT默认启用
    exportAsZip: false,
    embedAvatarsAsBase64: false,
    streamingZipMode: false, // 流式ZIP导出模式
    outputDir: "", // Issue #192: 自定义导出路径
    useNameInFileName: false, // Issue #216: 文件名包含聊天名称
  })

  const { groupSearch, friendSearch } = useSearch()

  // 格式改变时自动调整filterPureImageMessages默认值
  useEffect(() => {
    if (form.format === 'HTML') {
      setForm(p => ({ ...p, filterPureImageMessages: false }))
    } else if (form.format === 'JSON' || form.format === 'TXT') {
      setForm(p => ({ ...p, filterPureImageMessages: true }))
    }
  }, [form.format])

  // ----- sync prefilled
  useEffect(() => {
    if (prefilledData && isOpen) {
      const format = prefilledData.format || "JSON"
      // 根据format设置filterPureImageMessages的默认值
      const defaultFilter = format === 'JSON' || format === 'TXT' ? true : false
      
      setForm({
        chatType: prefilledData.chatType || 2,
        peerUid: prefilledData.peerUid || "",
        sessionName: prefilledData.sessionName || "",
        format: format,
        startTime: prefilledData.startTime || "",
        endTime: prefilledData.endTime || "",
        keywords: prefilledData.keywords || "",
        excludeUserUins: prefilledData.excludeUserUins || "",
        includeRecalled: prefilledData.includeRecalled || false,
        includeSystemMessages:
          prefilledData.includeSystemMessages !== undefined ? prefilledData.includeSystemMessages : true,
        filterPureImageMessages: prefilledData.filterPureImageMessages !== undefined 
          ? prefilledData.filterPureImageMessages 
          : defaultFilter,
        exportAsZip: prefilledData.exportAsZip || false,
        embedAvatarsAsBase64: prefilledData.embedAvatarsAsBase64 || false,
        streamingZipMode: prefilledData.streamingZipMode || false,
        outputDir: prefilledData.outputDir || "",  // Issue #192
        useNameInFileName: prefilledData.useNameInFileName || false,  // Issue #216
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
      groupSearchRef.current.load()
    }
    if (isOpen && friends.length > 0 && friendSearchRef.current.allData.length === 0) {
      friendSearchRef.current.load()
    }
  }, [isOpen, groups.length, friends.length])

  useEffect(() => {
    if (!isOpen) {
      setSelectedTarget(null)
      setSearchTerm("")
      setShowTargetSelector(true)
      setManualInputMode(false)
      setManualQQNumber("")
      setManualSessionName("")
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
        excludeUserUins: "",
        includeRecalled: false,
        includeSystemMessages: true,
        filterPureImageMessages: true, // JSON默认启用
        exportAsZip: false,
        embedAvatarsAsBase64: false,
        streamingZipMode: false,
        outputDir: "", // Issue #192: 重置自定义导出路径
        useNameInFileName: false, // Issue #216: 重置文件名包含聊天名称
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

  // 获取群成员列表
  const fetchGroupMembers = useCallback(async (groupCode: string) => {
    setMembersLoading(true)
    try {
      const res = await fetch(`/api/groups/${groupCode}/members`)
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setGroupMembers(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch group members:', error)
    } finally {
      setMembersLoading(false)
    }
  }, [])

  // 切换群成员选择器展开/收起
  const handleOpenMemberSelector = useCallback(() => {
    if (selectedTarget && "groupCode" in selectedTarget) {
      if (!showMemberSelector) {
        // 展开时：从当前 excludeUserUins 恢复已选中的成员
        const currentUins = form.excludeUserUins?.split(',').map(s => s.trim()).filter(Boolean) || []
        setSelectedMemberUins(new Set(currentUins))
        setMemberSearchTerm("")
        fetchGroupMembers(selectedTarget.groupCode)
      }
      setShowMemberSelector(!showMemberSelector)
    }
  }, [selectedTarget, form.excludeUserUins, fetchGroupMembers, showMemberSelector])

  // 切换成员选中状态
  const toggleMemberSelection = useCallback((uin: string) => {
    setSelectedMemberUins(prev => {
      const next = new Set(prev)
      if (next.has(uin)) {
        next.delete(uin)
      } else {
        next.add(uin)
      }
      return next
    })
  }, [])

  // 确认选择的成员
  const confirmMemberSelection = useCallback(() => {
    const uins = Array.from(selectedMemberUins).join(',')
    setForm(p => ({ ...p, excludeUserUins: uins }))
    setShowMemberSelector(false)
  }, [selectedMemberUins])

  // 过滤群成员
  const filteredMembers = groupMembers.filter(member => {
    if (!memberSearchTerm.trim()) return true
    const term = memberSearchTerm.toLowerCase()
    return (
      member.nick.toLowerCase().includes(term) ||
      (member.cardName && member.cardName.toLowerCase().includes(term)) ||
      (member.uin && member.uin.includes(term))
    )
  })

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
    setManualInputMode(false)
    setManualQQNumber("")
    setManualSessionName("")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    groupSearchRef.current.clear()
    friendSearchRef.current.clear()
  }, [])

  // 手动输入QQ号确认（Issue #226）
  const handleManualInputConfirm = useCallback(() => {
    const qqNumber = manualQQNumber.trim()
    if (!qqNumber) return
    
    // 设置表单数据
    setForm((p) => ({
      ...p,
      chatType: 1, // 私聊
      peerUid: qqNumber,
      sessionName: manualSessionName.trim() || `好友 ${qqNumber}`
    }))
    
    // 创建一个虚拟的 Friend 对象用于显示
    const virtualFriend: Friend = {
      uid: qqNumber,
      uin: qqNumber,
      nick: manualSessionName.trim() || `好友 ${qqNumber}`,
      remark: manualSessionName.trim() || null,
      avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${qqNumber}&s=640`,
      isOnline: false,
      status: 0,
      categoryId: 1
    }
    
    setSelectedTarget(virtualFriend)
    setShowTargetSelector(false)
    setManualInputMode(false)
  }, [manualQQNumber, manualSessionName])

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
              variant={form.chatType === 1 && !manualInputMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm((p) => ({ ...p, chatType: 1 }))
                setSearchTerm("")
                setManualInputMode(false)
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                friendSearchRef.current.search("")
              }}
              className="justify-center rounded-full"
            >
              <User className="w-4 h-4 mr-2" />
              好友聊天
            </Button>
            <Button
              variant={form.chatType === 2 && !manualInputMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setForm((p) => ({ ...p, chatType: 2 }))
                setSearchTerm("")
                setManualInputMode(false)
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                groupSearchRef.current.search("")
              }}
              className="justify-center rounded-full"
            >
              <Users className="w-4 h-4 mr-2" />
              群组聊天
            </Button>
          </div>
          {/* 手动输入QQ号选项（Issue #226） */}
          <Button
            variant={manualInputMode ? "default" : "ghost"}
            size="sm"
            onClick={() => setManualInputMode(!manualInputMode)}
            className="w-full mt-2 justify-center rounded-full text-xs"
          >
            {manualInputMode ? <X className="w-3 h-3 mr-1" /> : <User className="w-3 h-3 mr-1" />}
            {manualInputMode ? "取消手动输入" : "手动输入QQ号"}
          </Button>
        </div>

        {/* 手动输入QQ号面板（Issue #226） */}
        {manualInputMode ? (
          <div className="space-y-3 p-4 border border-blue-200 dark:border-blue-800 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30">
            <div className="space-y-2">
              <Label htmlFor="manualQQ" className="text-sm">QQ号码</Label>
              <Input
                id="manualQQ"
                placeholder="输入要导出的QQ号"
                value={manualQQNumber}
                onChange={(e) => setManualQQNumber(e.target.value.replace(/\D/g, ''))}
                className="rounded-xl font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manualName" className="text-sm">备注名称（可选）</Label>
              <Input
                id="manualName"
                placeholder="给这个聊天起个名字"
                value={manualSessionName}
                onChange={(e) => setManualSessionName(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <Button
              onClick={handleManualInputConfirm}
              disabled={!manualQQNumber.trim()}
              className="w-full rounded-full bg-blue-600 hover:bg-blue-700"
              size="sm"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              确认
            </Button>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              适用于好友列表中未显示的用户，如超过1000人限制的好友
            </p>
          </div>
        ) : (
          <>
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
              disabled={s.loading}
              className="rounded-full"
            >
              {s.loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              加载{form.chatType === 1 ? "好友" : "群组"}
            </Button>
            {s.allData.length > 0 && <span className="text-xs text-neutral-500 dark:text-neutral-400">已加载 {s.allData.length} 个</span>}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 dark:text-neutral-500" />
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
          className="max-h-96 overflow-y-auto space-y-1 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-2 bg-white/70 dark:bg-neutral-900/70"
          onScroll={handleScroll}
        >
          {s.loading && displayTargets.length === 0 && (
            <div className="text-center py-10 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              <p className="text-sm">搜索中...</p>
            </div>
          )}

          {s.error && (
            <div className="text-center py-10 text-red-600 dark:text-red-400 text-sm">
              {s.error}
            </div>
          )}

          {!s.loading && !s.error && displayTargets.length === 0 && (
            <div className="text-center py-10 text-neutral-500 dark:text-neutral-400">
              <div className="mb-2">
                {form.chatType === 1 ? (
                  <User className="w-8 h-8 mx-auto text-neutral-300 dark:text-neutral-600" />
                ) : (
                  <Users className="w-8 h-8 mx-auto text-neutral-300 dark:text-neutral-600" />
                )}
              </div>
              <p className="text-sm">
                {searchTerm.trim()
                  ? `没有找到匹配 "${searchTerm}" 的${form.chatType === 1 ? "好友" : "群组"}`
                  : `暂无${form.chatType === 1 ? "好友" : "群组"}数据`}
              </p>
              {!searchTerm.trim() && s.allData.length === 0 && (
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">点击上方按钮加载数据</p>
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
                  isSelected ? "ring-1 ring-neutral-300 dark:ring-neutral-600 bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                ].join(" ")}
                onClick={() => handleSelectTarget(target)}
              >
                <Avatar className="w-7 h-7 rounded-xl">
                  <AvatarImage src={avatarUrl} alt={name} />
                  <AvatarFallback className="rounded-xl text-xs">{name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{name}</p>
                  <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
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
                <div className="flex items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 text-neutral-400 dark:text-neutral-500">
                  <ChevronDown className="w-4 h-4" />
                  <span className="text-sm">向下滚动加载更多</span>
                </div>
              )}
            </div>
          )}

          {s.allData.length > 0 && displayTargets.length > 0 && (
            <div className="text-center py-2 text-xs text-neutral-500 dark:text-neutral-400 border-t dark:border-neutral-700">
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
          </>
        )}
      </div>
    )
  }

  const renderConfigPanel = () => {
    return (
      <div className="space-y-6">
        {selectedTarget && (
          <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/70">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100 mb-2">已选择 {form.chatType === 1 ? "好友" : "群组"}</h3>
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
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
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
                    {onExportAvatars && form.chatType === 2 && "groupCode" in selectedTarget && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        disabled={avatarExportLoading === selectedTarget.groupCode}
                        onClick={() => onExportAvatars(selectedTarget.groupCode, selectedTarget.groupName)}
                      >
                        {avatarExportLoading === selectedTarget.groupCode ? '导出中...' : '导出头像'}
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
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">选择最适合您需求的格式</p>
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
                fmt === "JSON" ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300" : fmt === "HTML" ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400" : fmt === "EXCEL" ? "bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400" : "bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400"
              const active = form.format === fmt
              return (
                <div
                  key={fmt}
                  className={[
                    "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                    active ? "border-blue-500 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 shadow-sm" : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                  ].join(" ")}
                  onClick={() => setForm((p) => ({ ...p, format: fmt }))}
                >
                  <div className="flex items-start gap-3">
                    <div className={active ? "text-blue-600 dark:text-blue-500" : "text-neutral-500 dark:text-neutral-400"}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{fmt}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>{chip}</span>
                      </div>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{desc}</p>
                    </div>
                    {active && <div className="w-2 h-2 bg-blue-600 dark:bg-blue-500 rounded-full" />}
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
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">留空则导出全部历史记录</p>
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

        {/* 排除用户 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="excludeUserUins">排除用户（可选）</Label>
            {selectedTarget && "groupCode" in selectedTarget && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleOpenMemberSelector}
                className="text-xs h-7 text-blue-600 hover:text-blue-700"
              >
                <UserMinus className="w-3 h-3 mr-1" />
                {showMemberSelector ? "收起" : "从群成员选择"}
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform duration-200 ${showMemberSelector ? "rotate-180" : ""}`} />
              </Button>
            )}
          </div>
          
          {/* 折叠式群成员选择器 */}
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showMemberSelector ? "max-h-[350px] opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="border dark:border-neutral-700 rounded-xl p-3 space-y-2 bg-neutral-50/50 dark:bg-neutral-900/50">
              {/* 搜索框 */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                <Input
                  placeholder="搜索昵称、群名片或QQ号..."
                  value={memberSearchTerm}
                  onChange={(e) => setMemberSearchTerm(e.target.value)}
                  className="pl-9 h-8 text-sm rounded-full bg-white dark:bg-neutral-800"
                />
              </div>
              
              {/* 已选数量 */}
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>已选择 {selectedMemberUins.size} 个成员</span>
                {selectedMemberUins.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMemberUins(new Set())}
                    className="h-5 px-2 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    清空
                  </Button>
                )}
              </div>
              
              {/* 成员列表 */}
              <div className="max-h-[180px] overflow-y-auto border dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800">
                {membersLoading ? (
                  <div className="flex items-center justify-center h-20">
                    <Loader2 className="w-5 h-5 animate-spin text-neutral-400 dark:text-neutral-500" />
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="flex items-center justify-center h-20 text-neutral-500 dark:text-neutral-400 text-xs">
                    {memberSearchTerm ? "没有找到匹配的成员" : "暂无群成员数据"}
                  </div>
                ) : (
                  <div className="divide-y dark:divide-neutral-700">
                    {filteredMembers.slice(0, 50).map((member) => {
                      const uin = member.uin || member.uid
                      const isSelected = selectedMemberUins.has(uin)
                      const displayName = member.cardName || member.nick
                      // 处理 role: 4=owner, 3=admin, 其他=member
                      const roleNum = typeof member.role === 'number' ? member.role : 0
                      const isOwner = roleNum === 4 || member.role === 'owner'
                      const isAdmin = roleNum === 3 || member.role === 'admin'
                      return (
                        <div
                          key={uin}
                          onClick={() => toggleMemberSelection(uin)}
                          className={`flex items-center gap-2 p-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors ${
                            isSelected ? "bg-blue-50 dark:bg-blue-950/50" : ""
                          }`}
                        >
                          <Checkbox checked={isSelected} className="w-4 h-4" />
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={member.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`} />
                            <AvatarFallback className="text-xs">{displayName[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate flex items-center gap-1">
                              {displayName}
                              {isOwner && <Badge variant="secondary" className="text-[10px] px-1 py-0">群主</Badge>}
                              {isAdmin && <Badge variant="secondary" className="text-[10px] px-1 py-0">管理</Badge>}
                            </p>
                            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 truncate">
                              {uin}
                            </p>
                          </div>
                          {isSelected && <Check className="w-3 h-3 text-blue-600 flex-shrink-0" />}
                        </div>
                      )
                    })}
                    {filteredMembers.length > 50 && (
                      <div className="p-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
                        仅显示前50个结果，请使用搜索缩小范围
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* 确认按钮 */}
              <Button 
                onClick={confirmMemberSelection} 
                size="sm"
                className="w-full h-7 text-xs rounded-full bg-blue-600 hover:bg-blue-700"
              >
                确认选择 ({selectedMemberUins.size})
              </Button>
            </div>
          </div>
          
          <Textarea
            id="excludeUserUins"
            placeholder="用逗号分隔多个QQ号，如：123456789,987654321&#10;这些用户的消息将被过滤掉（适合过滤机器人）"
            value={form.excludeUserUins || ""}
            onChange={(e) => setForm((p) => ({ ...p, excludeUserUins: e.target.value }))}
            rows={2}
            className="rounded-2xl"
          />
          {form.excludeUserUins && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              已选择 {form.excludeUserUins.split(',').filter(s => s.trim()).length} 个用户
            </p>
          )}
        </div>

        {/* 高级选项 */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">高级选项</Label>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">自定义导出内容的详细设置</p>
          </div>

          {/* Issue #192: 自定义导出路径 */}
          <div className="space-y-2">
            <Label htmlFor="outputDir">导出路径（可选）</Label>
            <Input
              id="outputDir"
              placeholder="留空使用默认路径，或输入自定义路径如 D:\exports"
              value={form.outputDir || ""}
              onChange={(e) => setForm((p) => ({ ...p, outputDir: e.target.value }))}
              className="rounded-xl font-mono text-sm"
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              默认保存到用户目录下的 .qq-chat-exporter/exports 文件夹
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                id: "streamingZipMode",
                checked: form.streamingZipMode || false,
                set: (v: boolean) => setForm((p) => ({ ...p, streamingZipMode: v })),
                title: "流式导出（超大消息量专用）",
                desc: form.format === "HTML" 
                  ? "专为50万+消息量设计，全程流式处理防止内存溢出。输出ZIP格式，适合导出超大群聊记录。"
                  : "专为50万+消息量设计，全程流式处理防止内存溢出。输出分块JSONL格式，适合导出超大群聊记录。",
                visible: form.format === "HTML" || form.format === "JSON",
                highlight: true
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
                title: "快速导出（跳过资源下载）",
                desc: "保留所有消息记录，但不下载图片/视频/音频等资源文件，大幅加快导出速度",
                visible: true
              },
              {
                id: "exportAsZip",
                checked: form.exportAsZip || false,
                set: (v: boolean) => setForm((p) => ({ ...p, exportAsZip: v })),
                title: "导出为ZIP压缩包",
                desc: "将HTML文件和资源文件打包为ZIP格式（仅HTML格式可用）",
                visible: form.format === "HTML" && !form.streamingZipMode
              },
              {
                id: "useNameInFileName",
                checked: form.useNameInFileName || false,
                set: (v: boolean) => setForm((p) => ({ ...p, useNameInFileName: v })),
                title: "文件名包含聊天名称",
                desc: "在导出文件名中包含群名或好友昵称，方便批量导出后识别文件",
                visible: true
              },
              {
                id: "embedAvatarsAsBase64",
                checked: form.embedAvatarsAsBase64 || false,
                set: (v: boolean) => setForm((p) => ({ ...p, embedAvatarsAsBase64: v })),
                title: "嵌入头像为Base64",
                desc: "将发送者头像以Base64格式嵌入JSON文件（仅JSON格式可用，会增加文件大小）",
                visible: form.format === "JSON"
              }
            ].filter((opt) => opt.visible).map((opt) => (
              <div
                key={opt.id}
                className={[
                  "relative cursor-pointer rounded-2xl border p-4 transition-all",
                  (opt as any).highlight && opt.checked 
                    ? "border-orange-400 dark:border-orange-600 bg-orange-50/50 dark:bg-orange-950/30 ring-1 ring-orange-200 dark:ring-orange-800" 
                    : (opt as any).highlight 
                      ? "border-orange-200 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-950/20 hover:border-orange-300 dark:hover:border-orange-700"
                      : opt.checked 
                        ? "border-neutral-300 dark:border-neutral-600 bg-neutral-50/50 dark:bg-neutral-800/50" 
                        : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                ].join(" ")}
                onClick={() => opt.set(!opt.checked)}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 pt-0.5">
                    <div className={[
                      "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                      opt.checked 
                        ? (opt as any).highlight ? "border-orange-500 bg-orange-500" : "border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100"
                        : (opt as any).highlight ? "border-orange-300 dark:border-orange-600 hover:border-orange-400 dark:hover:border-orange-500" : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500"
                    ].join(" ")}>
                      {opt.checked && (
                        <svg className={`w-3 h-3 ${(opt as any).highlight ? 'text-white' : 'text-white dark:text-neutral-900'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className={`font-medium text-sm ${(opt as any).highlight ? 'text-orange-700 dark:text-orange-400' : 'text-neutral-900 dark:text-neutral-100'}`}>{opt.title}</h4>
                    <p className={`text-sm mt-1 leading-relaxed ${(opt as any).highlight ? 'text-orange-600 dark:text-orange-500' : 'text-neutral-600 dark:text-neutral-400'}`}>{opt.desc}</p>
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
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        fullScreen
        overlayClassName="bg-white/60 dark:bg-neutral-950/60 backdrop-blur-xl"
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
              <p className="text-sm text-neutral-600 dark:text-neutral-400">选择要导出聊天记录的群组或好友</p>
            </div>
            <div className="flex-1 overflow-hidden">
              {showTargetSelector || !selectedTarget ? (
                renderTargetSelector()
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-600 dark:text-green-500 mb-3" />
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">已选择目标，请在右侧配置导出选项</p>
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
              <p className="text-sm text-neutral-600 dark:text-neutral-400">设置导出格式、时间范围和过滤条件</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">{selectedTarget ? renderConfigPanel() : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-neutral-500 dark:text-neutral-400">
                  <FileText className="w-12 h-12 mx-auto text-neutral-300 dark:text-neutral-600 mb-3" />
                  <p className="text-sm">请先在左侧选择要导出的群组或好友</p>
                </div>
              </div>
            )}</div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-6 py-4 border-t dark:border-neutral-800">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            {canSubmit() ? <span className="text-green-600 dark:text-green-500">✓ 准备就绪，可以创建任务</span> : <span>请完成所有必填项</span>}
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

    </>
  )
}
