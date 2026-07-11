"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogTitle } from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"
import { DateRangePicker } from "./date-range-picker"
import { Label } from "./label"
import { Badge } from "./badge"
import { Avatar, AvatarImage, AvatarFallback } from "./avatar"
import {
  Users, User, Search, SearchX, ChevronDown, RefreshCw, Settings, Eye, CheckCircle, X, UserMinus, UserPlus, Check, HelpCircle
} from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip"
import { Loader } from "@/components/ui/loader"
import { useSearch } from "@/hooks/use-search"
import { useApi } from "@/hooks/use-api"
import type { CreateTaskForm, Group, Friend, GroupMember } from "@/types/api"
import { Checkbox } from "./checkbox"
import { Switch } from "./switch"
import { toggleSkipResourceType } from "@/lib/skip-resource-types"

// 统一的药丸输入样式（与新版模态框 UI 对齐：无边框、浅底、聚焦加深）
const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const PILL_TEXTAREA =
  "px-3.5 py-2.5 rounded-[18px] border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"

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
  /** Issue #340：独立模式下群相关 API 不可用，隐藏手动输入群号 */
  isStandalone?: boolean
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
  avatarExportLoading,
  isStandalone = false,
}: TaskWizardProps) {
  const { apiCall } = useApi()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedTarget, setSelectedTarget] = useState<Group | Friend | null>(null)
  const [showTargetSelector, setShowTargetSelector] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  
  // 手动输入 QQ 号 / 群号模式（Issue #226）：friend | group | null
  const [manualInputMode, setManualInputMode] = useState<'friend' | 'group' | null>(null)
  const [manualQQNumber, setManualQQNumber] = useState("")
  const [manualGroupCode, setManualGroupCode] = useState("")
  const [manualSessionName, setManualSessionName] = useState("")
  const [manualGroupLoading, setManualGroupLoading] = useState(false)
  const [manualGroupError, setManualGroupError] = useState<string | null>(null)
  
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
      setManualInputMode(null)
      setManualQQNumber("")
      setManualGroupCode("")
      setManualSessionName("")
      setManualGroupLoading(false)
      setManualGroupError(null)
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
      <div className="rounded-xl p-3 space-y-2 bg-muted/50">
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
        <div className="max-h-[180px] overflow-y-auto rounded-lg bg-card">
          {membersLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader size={20} className="text-muted-foreground/60" />
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
    setManualInputMode(null)
    setManualQQNumber("")
    setManualGroupCode("")
    setManualSessionName("")
    setManualGroupLoading(false)
    setManualGroupError(null)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    groupSearchRef.current.clear()
    friendSearchRef.current.clear()
  }, [])

  const openManualFriendInput = useCallback(() => {
    if (manualInputMode === 'friend') {
      setManualInputMode(null)
      return
    }
    setManualInputMode('friend')
    setForm((p) => ({ ...p, chatType: 1 }))
    setManualGroupError(null)
    setSearchTerm("")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }, [manualInputMode])

  const openManualGroupInput = useCallback(() => {
    if (manualInputMode === 'group') {
      setManualInputMode(null)
      return
    }
    setManualInputMode('group')
    setForm((p) => ({ ...p, chatType: 2 }))
    setManualGroupError(null)
    setSearchTerm("")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }, [manualInputMode])

  // 手动输入 QQ 号确认（Issue #226）
  const handleManualFriendInputConfirm = useCallback(() => {
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
    setManualInputMode(null)
  }, [manualQQNumber, manualSessionName])

  // 手动输入群号确认：调用 get_group_info 校验群是否存在
  const handleManualGroupInputConfirm = useCallback(async () => {
    const groupCode = manualGroupCode.trim()
    if (!groupCode) return

    setManualGroupLoading(true)
    setManualGroupError(null)
    try {
      const response = await apiCall<Group>(`/api/groups/${groupCode}`)
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || '群组不存在或无权访问')
      }

      const apiData = response.data
      const groupName = manualSessionName.trim() || apiData.groupName || `群聊 ${groupCode}`

      setForm((p) => ({
        ...p,
        chatType: 2,
        peerUid: groupCode,
        sessionName: groupName,
      }))

      const virtualGroup: Group = {
        groupCode,
        groupName,
        memberCount: apiData.memberCount ?? 0,
        maxMember: apiData.maxMember ?? 0,
        avatarUrl: apiData.avatarUrl || `https://p.qlogo.cn/gh/${groupCode}/${groupCode}/640/`,
      }

      setSelectedTarget(virtualGroup)
      setShowTargetSelector(false)
      setManualInputMode(null)
      setGroupMembers([])
      setSelectedMemberUins(new Set())
      setMemberSelectorMode(null)
    } catch (error) {
      setManualGroupError(error instanceof Error ? error.message : '群组不存在或无权访问')
    } finally {
      setManualGroupLoading(false)
    }
  }, [manualGroupCode, manualSessionName, apiCall])

  const canSubmit = () => selectedTarget !== null && form.sessionName.trim() !== ""

  // ---------------- UI pieces ----------------
  const renderTargetSelector = () => {
    const displayTargets = getDisplayTargets()
    const s = form.chatType === 2 ? groupSearch : friendSearch

    return (
      <div className="flex flex-col gap-4 h-full min-h-0">
        {/* 类型切换 - 4个按钮一行 */}
        <div>
          <div className={`flex gap-1 p-0.5 rounded-full bg-black/[0.03] dark:bg-white/[0.04] ${isStandalone ? '' : ''}`}>
            {[
              { key: 'friend', label: '好友', onClick: () => {
                setForm((p) => ({ ...p, chatType: 1 }))
                setManualInputMode(null)
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                friendSearchRef.current.search(searchTerm)
              }, active: form.chatType === 1 && !manualInputMode },
              { key: 'group', label: '群组', onClick: () => {
                setForm((p) => ({ ...p, chatType: 2 }))
                setManualInputMode(null)
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                groupSearchRef.current.search(searchTerm)
              }, active: form.chatType === 2 && !manualInputMode },
              { key: 'manual-friend', label: '输入QQ号', onClick: openManualFriendInput, active: manualInputMode === 'friend' },
              ...(!isStandalone ? [{ key: 'manual-group', label: '输入群号', onClick: openManualGroupInput, active: manualInputMode === 'group' }] : []),
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={tab.onClick}
                className={[
                  "flex-1 px-3 py-1.5 text-[13px] font-medium rounded-full transition-all text-center",
                  tab.active
                    ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    : "text-muted-foreground hover:text-foreground"
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 手动输入面板 */}
        {manualInputMode === 'friend' ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="manualQQ" className="text-[13px] text-muted-foreground">QQ号码</Label>
              <Input
                id="manualQQ"
                placeholder="输入要导出的QQ号"
                value={manualQQNumber}
                onChange={(e) => setManualQQNumber(e.target.value.replace(/\D/g, ''))}
                className="rounded-full h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manualName" className="text-[13px] text-muted-foreground">备注名称</Label>
              <Input
                id="manualName"
                placeholder="给这个聊天起个名字"
                value={manualSessionName}
                onChange={(e) => setManualSessionName(e.target.value)}
                className="rounded-full h-9"
              />
            </div>
            <Button
              onClick={handleManualFriendInputConfirm}
              disabled={!manualQQNumber.trim()}
              className="w-full rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90"
              size="sm"
            >
              确认
            </Button>
            <p className="text-xs text-muted-foreground/60">
              适用于好友列表中未显示的用户
            </p>
          </div>
        ) : manualInputMode === 'group' ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="manualGroup" className="text-[13px] text-muted-foreground">群号</Label>
              <Input
                id="manualGroup"
                placeholder="输入要导出的群号"
                value={manualGroupCode}
                onChange={(e) => {
                  setManualGroupCode(e.target.value.replace(/\D/g, ''))
                  setManualGroupError(null)
                }}
                className="rounded-full h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manualGroupName" className="text-[13px] text-muted-foreground">备注名称</Label>
              <Input
                id="manualGroupName"
                placeholder="给这个群聊起个名字"
                value={manualSessionName}
                onChange={(e) => setManualSessionName(e.target.value)}
                className="rounded-full h-9"
              />
            </div>
            {manualGroupError && (
              <p className="text-xs text-red-600 dark:text-red-400">{manualGroupError}</p>
            )}
            <Button
              onClick={handleManualGroupInputConfirm}
              disabled={!manualGroupCode.trim() || manualGroupLoading}
              className="w-full rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90"
              size="sm"
            >
              {manualGroupLoading ? '查询中...' : '确认'}
            </Button>
            <p className="text-xs text-muted-foreground/60">
              适用于群列表中未显示的群
            </p>
          </div>
        ) : (
          <>
        {/* 加载 & 搜索 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
              <Input
                placeholder={form.chatType === 1 ? "搜索好友昵称、备注..." : "搜索群组名称、群号..."}
                value={searchTerm}
                onChange={(e) => handleSearchInput(e.target.value)}
                className="pl-10 rounded-full h-9 border-0 bg-black/[0.03] dark:bg-white/[0.05] shadow-none focus-visible:ring-0 focus-visible:border-0"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                if (currentChatTypeRef.current === 2) groupSearchRef.current.load()
                else friendSearchRef.current.load()
              }}
              disabled={s.loading}
              className="rounded-full h-9 shrink-0"
            >
              {s.loading ? <Loader size={12} className="mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              加载{form.chatType === 1 ? "好友" : "群组"}
            </Button>
          </div>
          {s.allData.length > 0 && <span className="block px-1 text-xs text-muted-foreground">已加载 {s.allData.length} 个</span>}
        </div>

        {/* 列表 */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto space-y-1 rounded-2xl p-2 bg-card/70"
          onScroll={handleScroll}
        >
          {s.loading && displayTargets.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Loader size={24} className="mx-auto mb-2" />
              <p className="text-sm">搜索中...</p>
            </div>
          )}

          {s.error && (
            <div className="text-center py-10 text-red-600 dark:text-red-400 text-sm">
              {s.error}
            </div>
          )}

          {!s.loading && !s.error && displayTargets.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="mb-3 flex justify-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05]">
                  <SearchX className="w-5 h-5 text-muted-foreground/50" strokeWidth={1.75} />
                </div>
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
                      <span className="tabular-nums">{(target as Friend).uin}</span>
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
                  <Loader size={16} />
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
            <div className="flex justify-center pt-3 pb-1">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-black/[0.03] dark:bg-white/[0.05] text-[11px] text-muted-foreground/70 tabular-nums">
                {searchTerm.trim() ? (
                  s.allData.length !== displayTargets.length
                    ? `匹配 ${displayTargets.length} / ${s.allData.length}`
                    : `匹配 ${displayTargets.length} 个`
                ) : (
                  s.totalCount > 0 && s.totalCount !== s.allData.length
                    ? `已加载 ${s.allData.length} / ${s.totalCount}`
                    : `已加载 ${s.allData.length} 个`
                )}
              </span>
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
      <div className="space-y-10">
        {/* 基础配置 */}
        <section>
          <h2 className={SECTION_TITLE}>基础配置</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80">任务名称</label>
              <Input
                id="sessionName"
                placeholder="为这个导出任务起个名字"
                value={form.sessionName}
                onChange={(e) => setForm((p) => ({ ...p, sessionName: e.target.value }))}
                className={PILL_INPUT + " w-full"}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80">导出格式</label>
              <div className="flex items-center flex-wrap gap-1 p-1 rounded-[20px] bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                {(["JSON", "HTML", "TXT", "EXCEL"] as const).map((fmt) => {
                  const active = form.format === fmt
                  return (
                    <button
                      key={fmt}
                      type="button"
                      className={[
                        "px-5 h-[30px] text-[13px] font-medium rounded-full transition-all",
                        active
                          ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                          : "text-muted-foreground hover:text-foreground"
                      ].join(" ")}
                      onClick={() => setForm((p) => ({ ...p, format: fmt }))}
                    >
                      {fmt}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground/80 flex items-center gap-1.5">
                时间范围
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-[14px] h-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors outline-none cursor-pointer" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[250px]">
                    留空则导出全部记录
                  </TooltipContent>
                </Tooltip>
              </label>
              <DateRangePicker
                startTime={form.startTime}
                endTime={form.endTime}
                onChange={(start, end) => setForm((p) => ({ ...p, startTime: start, endTime: end }))}
              />
            </div>
          </div>
        </section>

        {/* 过滤条件 */}
        <section className="space-y-5">
          <h2 className={SECTION_TITLE + " !mb-0"}>过滤条件</h2>
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-foreground/80">关键词过滤</label>
            <Textarea
              id="keywords"
              placeholder="用逗号分隔多个关键词，如：重要,会议,通知"
              value={form.keywords}
              onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
              rows={3}
              className={PILL_TEXTAREA}
            />
          </div>

          {/* 屏蔽用户 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-foreground/80">屏蔽用户</label>
              {selectedTarget && "groupCode" in selectedTarget && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenMemberSelector('exclude')}
                  className="text-xs h-7 text-blue-600 hover:text-blue-700"
                >
                  {memberSelectorMode === 'exclude' ? "收起" : "从群成员选择"}
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
              className={PILL_TEXTAREA}
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
              <label className="text-[13px] font-medium text-foreground/80">仅保留用户</label>
              {selectedTarget && "groupCode" in selectedTarget && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenMemberSelector('include')}
                  className="text-xs h-7 text-emerald-600 hover:text-emerald-700"
                >
                  {memberSelectorMode === 'include' ? "收起" : "从群成员选择"}
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
              className={PILL_TEXTAREA}
            />
            {form.includeUserUins && (
              <p className="text-xs text-muted-foreground">
                已选择 {form.includeUserUins.split(',').filter(s => s.trim()).length} 个用户
              </p>
            )}
          </div>
        </section>

        <hr className="border-black/[0.06] dark:border-white/[0.08]" />

        {/* 高级选项 */}
        <section>
          <h2 className={SECTION_TITLE}>高级选项</h2>
          <div className="space-y-6">
          {(() => {
            const allOptions = [
              {
                id: "streamingZipMode",
                checked: form.streamingZipMode || false,
                set: (v: boolean) => setForm((p) => ({ ...p, streamingZipMode: v })),
                title: "流式导出（超大消息量专用）",
                desc: form.format === "HTML" 
                  ? "专为50万+消息量设计，全程流式处理防止内存溢出。输出ZIP格式，适合导出超大群聊记录。"
                  : "专为50万+消息量设计，全程流式处理防止内存溢出。输出分块JSONL格式，适合导出超大群聊记录。",
                tip: "普通导出会把全部消息放进内存再写文件，消息超多时可能卡死或崩溃；流式模式边读边写，内存占用恒定。十万条以下一般不需要开启。",
                visible: form.format === "HTML" || form.format === "JSON",
                highlight: true,
                group: "性能与处理"
              },
              {
                id: "includeSystemMessages",
                checked: form.includeSystemMessages,
                set: (v: boolean) => setForm((p) => ({ ...p, includeSystemMessages: v })),
                title: "包含系统消息",
                desc: "包含入群通知、撤回提示等系统提示消息",
                tip: "关闭后导出结果更干净，但会丢失撤回、入群、离群等上下文线索，事后无法补回。存档备份建议保持开启。",
                visible: true,
                group: "导出内容"
              },
              {
                id: "filterPureImageMessages",
                checked: form.filterPureImageMessages,
                set: (v: boolean) => setForm((p) => ({ ...p, filterPureImageMessages: v })),
                title: "快速导出（跳过资源下载）",
                desc: "保留所有消息记录，但不下载图片/视频/音频等资源文件，大幅加快导出速度",
                tip: "资源下载通常占导出总耗时的 90% 以上。只需要文字记录时开启此项，图片等会以占位符显示。",
                visible: true,
                group: "导出内容"
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
                tip: "群文件往往体积大且有过期风险，下载失败率高。开启后可避免卡在大文件上，事后仍可凭 MD5 校验手动补档。",
                visible: !form.filterPureImageMessages,
                group: "导出内容"
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
                tip: "图片通常是数量最多的资源。活跃群聊动辄数万张，跳过后导出时间和磁盘占用都能降一个量级。",
                visible: !form.filterPureImageMessages,
                group: "导出内容"
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
                tip: "单个视频动辄几十到几百 MB，是磁盘占用的大头。不确定时建议先跳过，有需要再单独重导。",
                visible: !form.filterPureImageMessages,
                group: "导出内容"
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
                tip: "语音需要额外转码才能在浏览器播放，耗时较长；另外部分年代久远的语音已无法从服务器拉取。",
                visible: !form.filterPureImageMessages,
                group: "导出内容"
              },
              {
                id: "preferGroupMemberName",
                checked: form.preferGroupMemberName ?? true,
                set: (v: boolean) => setForm((p) => ({ ...p, preferGroupMemberName: v })),
                title: "优先使用群成员名称",
                desc: "群聊导出时优先使用群名片或群内名称。关闭后会改用 QQ 昵称或 QQ 号。",
                tip: "群名片更贴近群内日常称呼，但成员退群后名片会丢失，此时会自动回退到 QQ 昵称。",
                visible: form.chatType === 2,
                group: "导出内容"
              },
              {
                id: "exportAsZip",
                checked: form.exportAsZip || false,
                set: (v: boolean) => setForm((p) => ({ ...p, exportAsZip: v })),
                title: "导出为ZIP压缩包",
                desc: "将HTML文件和资源文件打包为ZIP格式（仅HTML格式可用）",
                tip: "HTML 导出默认是一个页面加一个 resources 目录，直接发送给别人容易漏文件；打包成单个 ZIP 更便于传输和归档。",
                visible: form.format === "HTML" && !form.streamingZipMode,
                group: "性能与处理"
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
                tip: "关闭后文件名只剩会话 ID 和时间戳，批量导出后很难分辨哪个文件对应哪个会话。",
                visible: true,
                group: "文件命名"
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
                tip: "适合反复覆盖式备份：文件名稳定不变，同步盘/网盘不会因时间戳变化而重复上传。",
                visible: true,
                group: "文件命名"
              },
              {
                id: "embedAvatarsAsBase64",
                checked: form.embedAvatarsAsBase64 || false,
                set: (v: boolean) => setForm((p) => ({ ...p, embedAvatarsAsBase64: v })),
                title: "嵌入头像为Base64",
                desc: "将发送者头像以Base64格式嵌入JSON文件（仅JSON格式可用，会增加文件大小）",
                tip: "默认只存头像 URL，离线或头像更换后就看不到原图；嵌入后数据永久自包含，代价是文件变大。",
                visible: form.format === "JSON",
                group: "导出内容"
              },
              {
                // Issue #311: 自包含 HTML
                id: "embedResourcesAsDataUri",
                checked: form.embedResourcesAsDataUri || false,
                set: (v: boolean) => setForm((p) => ({ ...p, embedResourcesAsDataUri: v })),
                title: "生成自包含 HTML",
                desc: "将图片、语音、视频、小于 50 MB 的文件以 base64 内联到单个 HTML文件中，不再产出 resources 目录。适合需要单独发送 / 在手机上丢进文件传输查看的场景。资源较多时 HTML 体积会明显增大。",
                tip: "base64 内联会使体积膨胀约 33%，消息量很大时浏览器打开会变慢；只建议在需要单文件分享时使用。",
                visible: form.format === "HTML" && !form.exportAsZip && !form.streamingZipMode,
                group: "导出内容"
              }
            ].filter((opt) => opt.visible)
            return ["导出内容", "文件命名", "性能与处理"]
              .map((groupName) => ({ groupName, opts: allOptions.filter((o) => o.group === groupName) }))
              .filter(({ opts }) => opts.length > 0)
              .map(({ groupName, opts }) => (
                <div key={groupName} className="space-y-2.5">
                  <h3 className="text-[12px] font-medium text-muted-foreground pl-1">{groupName}</h3>
                  <div className="bg-neutral-50/50 dark:bg-white/[0.03] rounded-2xl border border-neutral-100/80 dark:border-white/[0.06] overflow-hidden divide-y divide-neutral-100/80 dark:divide-white/[0.06]">
                    {opts.map((opt) => (
                      <div
                        key={opt.id}
                        className="flex items-center justify-between gap-6 group p-4 transition-colors"
                      >
                        <div className="flex flex-col gap-0.5 flex-1 pr-4">
                          <div className="flex items-center gap-1.5">
                            <div className="text-[13px] font-medium text-foreground">{opt.title}</div>
                            {opt.tip && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <HelpCircle className="w-[14px] h-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors outline-none cursor-pointer" />
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6} className="max-w-[280px]">
                                  {opt.tip}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
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
              ))
          })()}

          {/* Issue #192: 自定义导出路径 */}
          <div className="space-y-2.5">
            <label className="block text-[12px] font-medium text-muted-foreground pl-1">自定义存储路径</label>
            <Input
              id="outputDir"
              placeholder="默认: .qq-chat-exporter/exports"
              value={form.outputDir || ""}
              onChange={(e) => setForm((p) => ({ ...p, outputDir: e.target.value }))}
              className={PILL_INPUT + " w-full"}
            />
          </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">创建导出任务</DialogTitle>

        <div className="flex-1 flex min-h-0 w-full">
          {/* 左侧 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col pt-12 pl-12 pr-8 pb-6">
            <h1 className="text-[20px] font-semibold text-foreground mb-2">创建导出任务</h1>
            <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">配置您的导出偏好，确认无误后即可开始导出。</p>

            <div className="flex-1 min-h-0 overflow-hidden">
              {showTargetSelector || !selectedTarget ? (
                renderTargetSelector()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <CheckCircle className="w-12 h-12 text-[#317CFF] mb-4" />
                  <p className="text-[15px] font-medium text-foreground mb-1">
                    已选中 1 个{form.chatType === 1 ? "好友" : "群组"}
                  </p>
                  <p className="text-[13px] text-muted-foreground mb-6 max-w-[220px] truncate">
                    {"groupName" in selectedTarget
                      ? selectedTarget.groupName
                      : selectedTarget.remark || selectedTarget.nick}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleChangeTarget} className="rounded-full text-[13px]">
                      重新选择
                    </Button>
                    {onPreview && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full text-[13px]"
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
                        预览
                      </Button>
                    )}
                    {onExportAvatars && form.chatType === 2 && "groupCode" in selectedTarget && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full text-[13px]"
                        disabled={avatarExportLoading === selectedTarget.groupCode}
                        onClick={() => onExportAvatars(selectedTarget.groupCode, selectedTarget.groupName)}
                      >
                        {avatarExportLoading === selectedTarget.groupCode ? '导出中...' : '导出头像'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右侧 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-10 xl:px-12 pt-12 pb-8">
            <div className="w-full max-w-[760px] mx-auto">
              {selectedTarget ? renderConfigPanel() : (
                <div className="flex items-center justify-center h-full min-h-[300px]">
                  <div className="text-center text-muted-foreground">
                    <p className="text-sm">请先在左侧选择要导出的群组或好友</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {canSubmit() ? <span className="text-foreground">配置就绪</span> : <span>请完成所有必填项</span>}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">取消</Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit() || isLoading}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {isLoading ? '创建中...' : '创建任务'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    </>
  )
}
