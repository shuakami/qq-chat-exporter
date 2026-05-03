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
  Users, User, Search, Loader2, ChevronDown, RefreshCw, Settings, Eye, FileText, CheckCircle, X, UserMinus, UserPlus, Check
} from "lucide-react"
import { useSearch } from "@/hooks/use-search"
import type { CreateTaskForm, Group, Friend, GroupMember } from "@/types/api"
import { Checkbox } from "./checkbox"
import { toggleSkipResourceType } from "@/lib/skip-resource-types"

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
  
  // 群成员选择器状态：mode 表示当前选择器是给「排除」还是「仅导出」面板用的，
  // null 表示未展开。Issue #369 把同一份选择器复用给两个目标字段。
  const [memberSelectorMode, setMemberSelectorMode] = useState<'exclude' | 'include' | null>(null)
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
    includeUserUins: "",
    includeRecalled: false,
    includeSystemMessages: true,
    filterPureImageMessages: true, // JSON/TXT默认启用
    exportAsZip: false,
    embedAvatarsAsBase64: false,
    embedResourcesAsDataUri: false, // Issue #311: 自包含 HTML
    streamingZipMode: false, // 流式ZIP导出模式
    outputDir: "", // Issue #192: 自定义导出路径
    useNameInFileName: false, // Issue #216: 文件名包含聊天名称
    useFriendlyFileName: false, // Issue #134: 友好文件名格式 `<名称>(<QQ号>).<扩展名>`
    preferGroupMemberName: true, // Issue #358: 群聊优先使用群成员名称
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
        includeUserUins: prefilledData.includeUserUins || "",
        includeRecalled: prefilledData.includeRecalled || false,
        includeSystemMessages:
          prefilledData.includeSystemMessages !== undefined ? prefilledData.includeSystemMessages : true,
        filterPureImageMessages: prefilledData.filterPureImageMessages !== undefined 
          ? prefilledData.filterPureImageMessages 
          : defaultFilter,
        exportAsZip: prefilledData.exportAsZip || false,
        embedAvatarsAsBase64: prefilledData.embedAvatarsAsBase64 || false,
        embedResourcesAsDataUri: prefilledData.embedResourcesAsDataUri || false, // Issue #311
        streamingZipMode: prefilledData.streamingZipMode || false,
        outputDir: prefilledData.outputDir || "",  // Issue #192
        useNameInFileName: prefilledData.useNameInFileName || false,  // Issue #216
        useFriendlyFileName: prefilledData.useFriendlyFileName || false,  // Issue #134
        preferGroupMemberName: prefilledData.preferGroupMemberName !== undefined ? prefilledData.preferGroupMemberName : true,
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
        includeUserUins: "",
        includeRecalled: false,
        includeSystemMessages: true,
        filterPureImageMessages: true, // JSON默认启用
        exportAsZip: false,
        embedAvatarsAsBase64: false,
        embedResourcesAsDataUri: false, // Issue #311
        streamingZipMode: false,
        outputDir: "", // Issue #192: 重置自定义导出路径
        useNameInFileName: false, // Issue #216: 重置文件名包含聊天名称
        useFriendlyFileName: false, // Issue #134: 重置友好文件名格式
        preferGroupMemberName: true, // Issue #358: 重置群成员名称选项
      })
    }
  }, [isOpen])

  const handleSelectTarget = (target: Group | Friend) => {
    setSelectedTarget(target)
    setShowTargetSelector(false)
    // 切换会话目标时把上一群的成员缓存清掉，下一次打开成员选择器再拉新数据。
    setGroupMembers([])
    setSelectedMemberUins(new Set())
    setMemberSelectorMode(null)
    if ("groupCode" in target) {
      setForm((p) => ({ ...p, chatType: 2, peerUid: target.groupCode, sessionName: target.groupName }))
    } else {
      // Issue #364: 合并自最近联系人的特殊会话（QQ Bot / 服务号 / 临时会话）会
      // 携带原始 chatType，按其透传，避免被覆写为普通好友（chatType=1）。
      setForm((p) => ({
        ...p,
        chatType: target.chatType ?? 1,
        peerUid: target.uid,
        sessionName: target.remark || target.nick,
      }))
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

  // 切换群成员选择器展开/收起。mode 决定面板服务于哪一个字段。
  // 同一时间只展开一个面板：再点同一按钮收起，点另一按钮则切换面板内容。
  const handleOpenMemberSelector = useCallback((mode: 'exclude' | 'include') => {
    if (!(selectedTarget && "groupCode" in selectedTarget)) return
    if (memberSelectorMode === mode) {
      setMemberSelectorMode(null)
      return
    }
    const currentRaw = mode === 'include' ? form.includeUserUins : form.excludeUserUins
    const currentUins = currentRaw?.split(',').map(s => s.trim()).filter(Boolean) || []
    setSelectedMemberUins(new Set(currentUins))
    setMemberSearchTerm("")
    // 每次打开都按当前选中的群拉一次成员，避免在向导里换群以后还在用上一群的列表（Codex 在 #412 复盘时指出）。
    fetchGroupMembers(selectedTarget.groupCode)
    setMemberSelectorMode(mode)
  }, [selectedTarget, form.includeUserUins, form.excludeUserUins, fetchGroupMembers, memberSelectorMode])

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

  // 确认选择的成员，根据当前面板写入 include 或 exclude 字段
  const confirmMemberSelection = useCallback(() => {
    const uins = Array.from(selectedMemberUins).join(',')
    setForm(p => memberSelectorMode === 'include'
      ? { ...p, includeUserUins: uins }
      : { ...p, excludeUserUins: uins })
    setMemberSelectorMode(null)
  }, [selectedMemberUins, memberSelectorMode])

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

  // 渲染折叠式群成员选择器面板。include 与 exclude 共用同一份 UI，由 mode 控制可见性，
  // 只有 mode 与外层匹配时才展开，确认按钮的写入逻辑见 confirmMemberSelection。
  const renderMemberSelectorPanel = (mode: 'exclude' | 'include') => (
    <div className={`overflow-hidden transition-all duration-300 ease-in-out ${memberSelectorMode === mode ? "max-h-[350px] opacity-100" : "max-h-0 opacity-0"}`}>
      <div className="border border-black/[0.06] dark:border-white/[0.06] rounded-xl p-3 space-y-2 bg-muted/50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            placeholder="搜索昵称、群名片或QQ号..."
            value={memberSearchTerm}
            onChange={(e) => setMemberSearchTerm(e.target.value)}
            className="pl-9 h-8 text-sm rounded-full bg-card"
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
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
        <div className="max-h-[180px] overflow-y-auto border border-black/[0.06] dark:border-white/[0.06] rounded-lg bg-card">
          {membersLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/60" />
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">
              {memberSearchTerm ? "没有找到匹配的成员" : "暂无群成员数据"}
            </div>
          ) : (
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {filteredMembers.slice(0, 50).map((member) => {
                const uin = member.uin || member.uid
                const isSelected = selectedMemberUins.has(uin)
                const displayName = member.cardName || member.nick
                const roleNum = typeof member.role === 'number' ? member.role : 0
                const isOwner = roleNum === 4 || member.role === 'owner'
                const isAdmin = roleNum === 3 || member.role === 'admin'
                return (
                  <div
                    key={uin}
                    onClick={() => toggleMemberSelection(uin)}
                    className={`flex items-center gap-2 p-2 cursor-pointer hover:bg-muted transition-colors ${
                      isSelected ? "bg-blue-50 dark:bg-blue-950/50" : ""
                    }`}
                  >
                    <Checkbox checked={isSelected} className="w-4 h-4" />
                    <Avatar className="w-6 h-6 rounded-full">
                      <AvatarImage src={member.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`} />
                      <AvatarFallback className="text-xs">{displayName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate flex items-center gap-1">
                        {displayName}
                        {isOwner && <Badge variant="secondary" className="text-[10px] px-1 py-0">群主</Badge>}
                        {isAdmin && <Badge variant="secondary" className="text-[10px] px-1 py-0">管理</Badge>}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 truncate">
                        {uin}
                      </p>
                    </div>
                    {isSelected && <Check className="w-3 h-3 text-blue-600 flex-shrink-0" />}
                  </div>
                )
              })}
              {filteredMembers.length > 50 && (
                <div className="p-2 text-center text-xs text-muted-foreground/60">
                  仅显示前50个结果，请使用搜索缩小范围
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          onClick={confirmMemberSelection}
          size="sm"
          className={`w-full h-7 text-xs rounded-full ${mode === 'include' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          确认选择 ({selectedMemberUins.size})
        </Button>
      </div>
    </div>
  )

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
          <div className="space-y-3 p-4 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl bg-muted/50">
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
            <p className="text-xs text-muted-foreground">
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
            {s.allData.length > 0 && <span className="text-xs text-muted-foreground">已加载 {s.allData.length} 个</span>}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
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
          className="max-h-96 overflow-y-auto space-y-1 border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-2 bg-card/70"
          onScroll={handleScroll}
        >
          {s.loading && displayTargets.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
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
            <div className="text-center py-10 text-muted-foreground">
              <div className="mb-2">
                {form.chatType === 1 ? (
                  <User className="w-8 h-8 mx-auto text-muted-foreground/40" />
                ) : (
                  <Users className="w-8 h-8 mx-auto text-muted-foreground/40" />
                )}
              </div>
              <p className="text-sm">
                {searchTerm.trim()
                  ? `没有找到匹配 "${searchTerm}" 的${form.chatType === 1 ? "好友" : "群组"}`
                  : `暂无${form.chatType === 1 ? "好友" : "群组"}数据`}
              </p>
              {!searchTerm.trim() && s.allData.length === 0 && (
                <p className="text-xs text-muted-foreground/60 mt-1">点击上方按钮加载数据</p>
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
                  isSelected ? "ring-1 ring-foreground/20 bg-muted border-black/[0.06] dark:border-white/[0.06]" : "hover:bg-muted"
                ].join(" ")}
                onClick={() => handleSelectTarget(target)}
              >
                <Avatar className="w-7 h-7 rounded-full">
                  <AvatarImage src={avatarUrl} alt={name} />
                  <AvatarFallback className="rounded-full text-xs">{name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{name}</p>
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
                {isSelected && <CheckCircle className="w-4 h-4 text-blue-600" />}
              </div>
            )
          })}

          {s.allData.length > 0 && s.hasMore && (
            <div className="text-center py-2">
              {s.loading ? (
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 text-muted-foreground/60">
                  <ChevronDown className="w-4 h-4" />
                  <span className="text-sm">向下滚动加载更多</span>
                </div>
              )}
            </div>
          )}

          {s.allData.length > 0 && displayTargets.length > 0 && (
            <div className="text-center py-2 text-xs text-muted-foreground border-t border-black/[0.06] dark:border-white/[0.06]">
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
          <div className="p-4 rounded-2xl border border-black/[0.06] dark:border-white/[0.06] bg-card/70">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-foreground mb-2">已选择 {form.chatType === 1 ? "好友" : "群组"}</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8 rounded-full">
                    <AvatarImage
                      src={selectedTarget.avatarUrl}
                      alt={"groupName" in selectedTarget ? selectedTarget.groupName : selectedTarget.nick}
                    />
                    <AvatarFallback className="rounded-full text-sm">
                      {("groupName" in selectedTarget ? selectedTarget.groupName : selectedTarget.nick)[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {"groupName" in selectedTarget
                        ? selectedTarget.groupName
                        : selectedTarget.remark || selectedTarget.nick}
                    </p>
                    <p className="text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground mt-1">选择最适合您需求的格式</p>
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
              const chipClass = "bg-muted text-muted-foreground"
              const active = form.format === fmt
              return (
                <div
                  key={fmt}
                  className={[
                    "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                    active ? "border-blue-500 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 shadow-sm" : "border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.12]"
                  ].join(" ")}
                  onClick={() => setForm((p) => ({ ...p, format: fmt }))}
                >
                  <div className="flex items-start gap-3">
                    <div className={active ? "text-blue-600 dark:text-blue-500" : "text-muted-foreground"}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground">{fmt}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>{chip}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
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
            <p className="text-sm text-muted-foreground mt-1">留空则导出全部历史记录</p>
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
                onClick={() => handleOpenMemberSelector('exclude')}
                className="text-xs h-7 text-blue-600 hover:text-blue-700"
              >
                <UserMinus className="w-3 h-3 mr-1" />
                {memberSelectorMode === 'exclude' ? "收起" : "从群成员选择"}
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform duration-200 ${memberSelectorMode === 'exclude' ? "rotate-180" : ""}`} />
              </Button>
            )}
          </div>
          
          {renderMemberSelectorPanel('exclude')}

          <Textarea
            id="excludeUserUins"
            placeholder="用逗号分隔多个QQ号，如：123456789,987654321&#10;这些用户的消息将被过滤掉（适合过滤机器人）"
            value={form.excludeUserUins || ""}
            onChange={(e) => setForm((p) => ({ ...p, excludeUserUins: e.target.value }))}
            rows={2}
            className="rounded-2xl"
          />
          {form.excludeUserUins && (
            <p className="text-xs text-muted-foreground">
              已选择 {form.excludeUserUins.split(',').filter(s => s.trim()).length} 个用户
            </p>
          )}
        </div>

        {/* Issue #369：仅导出指定 QQ 号的消息（与排除互不冲突；同一 QQ 同时出现时，排除优先生效） */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="includeUserUins">仅导出这些用户的消息（可选）</Label>
            {selectedTarget && "groupCode" in selectedTarget && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenMemberSelector('include')}
                className="text-xs h-7 text-emerald-600 hover:text-emerald-700"
              >
                <UserPlus className="w-3 h-3 mr-1" />
                {memberSelectorMode === 'include' ? "收起" : "从群成员选择"}
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform duration-200 ${memberSelectorMode === 'include' ? "rotate-180" : ""}`} />
              </Button>
            )}
          </div>

          {renderMemberSelectorPanel('include')}

          <Textarea
            id="includeUserUins"
            placeholder="用逗号分隔多个QQ号，如：123456789,987654321&#10;留空表示不限制；填写后只会导出这些用户的消息"
            value={form.includeUserUins || ""}
            onChange={(e) => setForm((p) => ({ ...p, includeUserUins: e.target.value }))}
            rows={2}
            className="rounded-2xl"
          />
          {form.includeUserUins && (
            <p className="text-xs text-muted-foreground">
              已选择 {form.includeUserUins.split(',').filter(s => s.trim()).length} 个用户
            </p>
          )}
        </div>

        {/* 高级选项 */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">高级选项</Label>
            <p className="text-sm text-muted-foreground mt-1">自定义导出内容的详细设置</p>
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
            <p className="text-xs text-muted-foreground">
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
              // Issue #344：仅保留文件元数据，不下载文件
              {
                id: "skipFileDownloadOnly",
                checked: !!form.skipDownloadResourceTypes?.includes('file'),
                set: (v: boolean) => setForm((p) => ({
                  ...p,
                  skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'file', v),
                })),
                title: "仅保留文件元数据，不下载文件",
                desc: "图片 / 视频 / 音频仍正常下载；只有文件类资源（群文件、聊天发送的文档等）只保留文件名、大小、MD5 等元信息。适合不需要本地副本的备份场景。",
                visible: !form.filterPureImageMessages
              },
              // Issue #344：按资源类型逐项跳过，让用户在不开启「快速导出」的前提下也能精确控制要不要下载图片 / 视频 / 音频。
              {
                id: "skipImageDownload",
                checked: !!form.skipDownloadResourceTypes?.includes('image'),
                set: (v: boolean) => setForm((p) => ({
                  ...p,
                  skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'image', v),
                })),
                title: "不下载图片",
                desc: "导出时跳过图片资源的下载，HTML 中以占位形式显示，JSON / TXT 仅保留消息文本与元数据。需要保留图片可关闭此项。",
                visible: !form.filterPureImageMessages
              },
              {
                id: "skipVideoDownload",
                checked: !!form.skipDownloadResourceTypes?.includes('video'),
                set: (v: boolean) => setForm((p) => ({
                  ...p,
                  skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'video', v),
                })),
                title: "不下载视频",
                desc: "导出时跳过视频资源的下载。视频文件通常体积较大，长时间或群聊导出时容易占用大量带宽和磁盘空间。",
                visible: !form.filterPureImageMessages
              },
              {
                id: "skipAudioDownload",
                checked: !!form.skipDownloadResourceTypes?.includes('audio'),
                set: (v: boolean) => setForm((p) => ({
                  ...p,
                  skipDownloadResourceTypes: toggleSkipResourceType(p.skipDownloadResourceTypes, 'audio', v),
                })),
                title: "不下载语音",
                desc: "导出时跳过 SILK / AMR 等语音消息的下载。对只想保留文字记录的备份场景很有用。",
                visible: !form.filterPureImageMessages
              },
              {
                id: "preferGroupMemberName",
                checked: form.preferGroupMemberName ?? true,
                set: (v: boolean) => setForm((p) => ({ ...p, preferGroupMemberName: v })),
                title: "优先使用群成员名称",
                desc: "群聊导出时优先使用群名片或群内名称。关闭后会改用 QQ 昵称或 QQ 号。",
                visible: form.chatType === 2
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
                set: (v: boolean) =>
                  setForm((p) => ({
                    ...p,
                    useNameInFileName: v,
                    // 两种命名互斥：选上带名称后关掉友好命名，避免不一致。
                    useFriendlyFileName: v ? false : p.useFriendlyFileName,
                  })),
                title: "文件名包含聊天名称",
                desc: "在导出文件名中包含群名或好友昵称，方便批量导出后识别文件",
                visible: true
              },
              {
                // Issue #134: 友好文件名格式
                id: "useFriendlyFileName",
                checked: form.useFriendlyFileName || false,
                set: (v: boolean) =>
                  setForm((p) => ({
                    ...p,
                    useFriendlyFileName: v,
                    useNameInFileName: v ? false : p.useNameInFileName,
                  })),
                title: "使用友好命名（名称(QQ号).html）",
                desc: "导出文件名使用 `名称(QQ号).<扩展名>` 格式，去掉 friend_/group_ 前缀与时间戳。多次导出同一会话同名碰撞时，会自动追加 `_<日期>_<时间>` 后缀避免覆盖。启用后与「文件名包含聊天名称」互斥。",
                visible: true
              },
              {
                id: "embedAvatarsAsBase64",
                checked: form.embedAvatarsAsBase64 || false,
                set: (v: boolean) => setForm((p) => ({ ...p, embedAvatarsAsBase64: v })),
                title: "嵌入头像为Base64",
                desc: "将发送者头像以Base64格式嵌入JSON文件（仅JSON格式可用，会增加文件大小）",
                visible: form.format === "JSON"
              },
              {
                // Issue #311: 自包含 HTML
                id: "embedResourcesAsDataUri",
                checked: form.embedResourcesAsDataUri || false,
                set: (v: boolean) => setForm((p) => ({ ...p, embedResourcesAsDataUri: v })),
                title: "生成自包含 HTML",
                desc: "将图片、语音、视频、小于 50 MB 的文件以 base64 内联到单个 HTML文件中，不再产出 resources 目录。适合需要单独发送 / 在手机上丢进文件传输查看的场景。资源较多时 HTML 体积会明显增大。",
                visible: form.format === "HTML" && !form.exportAsZip && !form.streamingZipMode
              }
            ].filter((opt) => opt.visible).map((opt) => (
              <div
                key={opt.id}
                className={[
                  "relative cursor-pointer rounded-2xl border p-4 transition-all",
                  (opt as any).highlight && opt.checked 
                    ? "border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-200 dark:ring-blue-800" 
                    : (opt as any).highlight 
                      ? "border-black/[0.08] dark:border-white/[0.08] bg-muted/30 hover:border-blue-300 dark:hover:border-blue-700"
                      : opt.checked 
                        ? "border-foreground/20 bg-muted" 
                        : "border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.12]"
                ].join(" ")}
                onClick={() => opt.set(!opt.checked)}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 pt-0.5">
                    <div className={[
                      "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                      opt.checked 
                        ? (opt as any).highlight ? "border-blue-500 bg-blue-500" : "border-foreground bg-foreground"
                        : (opt as any).highlight ? "border-muted-foreground/40 hover:border-muted-foreground/60" : "border-muted-foreground/40 hover:border-muted-foreground/60"
                    ].join(" ")}>
                      {opt.checked && (
                        <svg className={`w-3 h-3 ${(opt as any).highlight ? 'text-white' : 'text-background'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className={`font-medium text-sm ${(opt as any).highlight ? 'text-blue-700 dark:text-blue-400' : 'text-foreground'}`}>{opt.title}</h4>
                    <p className={`text-sm mt-1 leading-relaxed ${(opt as any).highlight ? 'text-blue-600 dark:text-blue-500' : 'text-muted-foreground'}`}>{opt.desc}</p>
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
        overlayClassName="bg-background/60 backdrop-blur-xl"
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
              <p className="text-sm text-muted-foreground">选择要导出聊天记录的群组或好友</p>
            </div>
            <div className="flex-1 overflow-hidden">
              {showTargetSelector || !selectedTarget ? (
                renderTargetSelector()
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <CheckCircle className="w-12 h-12 mx-auto text-blue-500 mb-3" />
                    <p className="text-sm text-muted-foreground">已选择目标，请在右侧配置导出选项</p>
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
              <p className="text-sm text-muted-foreground">设置导出格式、时间范围和过滤条件</p>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">{selectedTarget ? renderConfigPanel() : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm">请先在左侧选择要导出的群组或好友</p>
                </div>
              </div>
            )}</div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="text-sm text-muted-foreground">
            {canSubmit() ? <span className="text-foreground">准备就绪</span> : <span>请完成所有必填项</span>}
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
