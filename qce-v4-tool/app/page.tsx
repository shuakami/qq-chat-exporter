"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/components/ui/toast"
import { TaskWizard } from "@/components/ui/task-wizard"
import { ScheduledExportWizard } from "@/components/ui/scheduled-export-wizard"
import { ExecutionHistoryModal } from "@/components/ui/execution-history-modal"
import { MessagePreviewModal } from "@/components/ui/message-preview-modal"
import { BatchExportDialog, type BatchExportItem, type BatchExportConfig } from "@/components/ui/batch-export-dialog"
import { SessionList } from "@/components/ui/session-list"
import { ScheduledBackupMergeDialog } from "@/components/ui/scheduled-backup-merge-dialog"
import { GroupEssenceModal } from "@/components/ui/group-essence-modal"
import { GroupFilesModal } from "@/components/ui/group-files-modal"
import { SettingsPanel } from "@/components/ui/settings-panel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Download,
  RefreshCw,
  X,
  Star,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Zap,
  History,
  MessageCircle,
  Users,
  User,
  CalendarDays,
  FileText,
  Clock,
  Filter,
  SortAsc,
  SortDesc,
  Copy,
  CheckCircle,
  Smile,
  Package,
  Sticker,
  Layers,
  Combine,
  FolderOpen,
  Image,
  Video,
  Music,
  File,
  HardDrive,
  Database,
  HelpCircle,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
} from "lucide-react"
import type { CreateTaskForm, CreateScheduledExportForm } from "@/types/api"
import { useQCE } from "@/hooks/use-qce"
import { useScheduledExports } from "@/hooks/use-scheduled-exports"
import { useChatHistory } from "@/hooks/use-chat-history"
import { useStickerPacks } from "@/hooks/use-sticker-packs"
import { useResourceIndex } from "@/hooks/use-resource-index"

import { ThemeToggle } from "@/components/qce-dashboard/theme-toggle"

import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { DUR, EASE, makeStagger } from "@/components/qce-dashboard/animations"

export default function QCEDashboard() {
  const [activeTab, setActiveTabState] = useState("overview")
  const [isTaskWizardOpen, setIsTaskWizardOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<Partial<CreateTaskForm> | undefined>()
  const [isScheduledExportWizardOpen, setIsScheduledExportWizardOpen] = useState(false)
  const [selectedScheduledPreset, setSelectedScheduledPreset] = useState<Partial<CreateScheduledExportForm> | undefined>()
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<{id: string, name: string} | null>(null)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [previewingChat, setPreviewingChat] = useState<{
    type: 'group' | 'friend',
    id: string,
    name: string,
    peer: { chatType: number, peerUid: string }
  } | null>(null)
  const [isFilePathModalOpen, setIsFilePathModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ filePath: string; sessionName: string; fileName: string; size?: number } | null>(null)
  
  // 群精华消息模态框状态
  const [isEssenceModalOpen, setIsEssenceModalOpen] = useState(false)
  const [essenceGroup, setEssenceGroup] = useState<{ groupCode: string; groupName: string } | null>(null)
  
  // 群文件/群相册模态框状态
  const [isGroupFilesModalOpen, setIsGroupFilesModalOpen] = useState(false)
  const [groupFilesTarget, setGroupFilesTarget] = useState<{ groupCode: string; groupName: string } | null>(null)
  
  // 批量导出模式状态
  const [batchMode, setBatchMode] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [isBatchExportDialogOpen, setIsBatchExportDialogOpen] = useState(false)
  
  // 定时备份合并状态
  const [isScheduledMergeDialogOpen, setIsScheduledMergeDialogOpen] = useState(false)
  const [scheduledTasks, setScheduledTasks] = useState<Array<any>>([])
  const [loadingScheduledTasks, setLoadingScheduledTasks] = useState(false)
  
  // 聊天记录筛选状态
  const [historyFilter, setHistoryFilter] = useState<'all' | 'group' | 'friend'>('all')
  const [historyFormatFilter, setHistoryFormatFilter] = useState<'all' | 'html' | 'json' | 'zip' | 'jsonl'>('all')
  const [historyViewMode, setHistoryViewMode] = useState<'list' | 'gallery'>('list')
  const [previewResource, setPreviewResource] = useState<{ type: string; url: string; name: string } | null>(null)
  
  // 大规模导出帮助模态框状态
  const [showJsonlHelp, setShowJsonlHelp] = useState(false)
  const [showStreamingZipHelp, setShowStreamingZipHelp] = useState(false)
  const [showHtmlHelp, setShowHtmlHelp] = useState(false)
  const [showJsonHelp, setShowJsonHelp] = useState(false)
  const [showExportHelpMenu, setShowExportHelpMenu] = useState(false)
  const [helpFilePath, setHelpFilePath] = useState<string>('')
  
  // GitHub stars
  const [githubStars, setGithubStars] = useState<number | null>(null)
  
  // 定时导出筛选状态
  const [scheduledFilter, setScheduledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  
  // 表情包筛选状态
  const [stickerFilter, setStickerFilter] = useState<'all' | 'favorite' | 'market' | 'system'>('all')
  
  // 新手引导状态
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [highlightedNav, setHighlightedNav] = useState<string | null>(null)
  
  // 侧边栏状态
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false)
  
  const tasksLoadedRef = useRef(false)
  const scheduledExportsLoadedRef = useRef(false)
  const chatHistoryLoadedRef = useRef(false)
  const stickerPacksLoadedRef = useRef(false)

  // 是否偏好降级动画
  const reduceMotion = useReducedMotion() ?? false

  const setActiveTab = (tabId: string) => {
    setActiveTabState(tabId)
    if (typeof window !== "undefined") {
      localStorage.setItem("qce-active-tab", tabId)
    }
    // On mobile, close sidebar when navigating
    setSidebarMobileOpen(false)
  }

  useEffect(() => {
      if (typeof window !== "undefined") {
        const savedTab = localStorage.getItem("qce-active-tab")
        if (savedTab && ["overview", "sessions", "tasks", "scheduled", "history", "stickers", "settings", "about"].includes(savedTab)) {
          setActiveTabState(savedTab)
        }
        // 检查是否需要显示新手引导
        const hasSeenOnboarding = localStorage.getItem("qce-onboarding-completed")
        if (!hasSeenOnboarding) {
          setShowOnboarding(true)
        }
        // Restore sidebar state
        const savedSidebar = localStorage.getItem("qce-sidebar-open")
        if (savedSidebar !== null) {
          setSidebarOpen(savedSidebar === "true")
        }
        // Detect mobile
        if (window.innerWidth < 768) {
          setSidebarOpen(false)
        }
      }
  }, [])

  // Save sidebar state
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("qce-sidebar-open", String(sidebarOpen))
    }
  }, [sidebarOpen])

  // 监听大规模导出帮助模态框事件
  useEffect(() => {
    const handleJsonlHelp = (e: CustomEvent<{ filePath: string }>) => {
      setHelpFilePath(e.detail.filePath)
      setShowJsonlHelp(true)
    }
    const handleStreamingZipHelp = (e: CustomEvent<{ filePath: string }>) => {
      setHelpFilePath(e.detail.filePath)
      setShowStreamingZipHelp(true)
    }
    
    window.addEventListener('show-jsonl-help', handleJsonlHelp as EventListener)
    window.addEventListener('show-streaming-zip-help', handleStreamingZipHelp as EventListener)
    
    return () => {
      window.removeEventListener('show-jsonl-help', handleJsonlHelp as EventListener)
      window.removeEventListener('show-streaming-zip-help', handleStreamingZipHelp as EventListener)
    }
  }, [])

  // 获取 GitHub stars
  useEffect(() => {
    const fetchStars = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/shuakami/qq-chat-exporter')
        if (res.ok) {
          const data = await res.json()
          setGithubStars(data.stargazers_count)
        }
      } catch {
        // 静默失败
      }
    }
    fetchStars()
  }, [])

  const addNotification = useCallback((
    type: 'success' | 'error' | 'info',
    title: string,
    message: string,
    actions?: Array<{
      label: string
      onClick: () => void
      variant?: 'default' | 'destructive'
      keepOpen?: boolean
    }>,
    duration?: number
  ) => {
    const showToast = type === 'success'
      ? toast.success
      : type === 'error'
        ? toast.error
        : toast.info

    return showToast(title, {
      description: message,
      actions,
      duration: duration === 0 ? Number.POSITIVE_INFINITY : duration,
    })
  }, [])

  const removeNotification = useCallback((id: string) => {
    toast.dismiss(id)
  }, [])

  const showDeleteConfirmationToast = useCallback((
    title: string,
    description: string,
    onConfirmDelete: () => Promise<void>,
  ) => {
    let toastId = ""

    toastId = toast.error(title, {
      description,
      duration: Number.POSITIVE_INFINITY,
      actions: [
        {
          label: "确认删除",
          onClick: () => {
            void toast.promise(
              onConfirmDelete,
              {
                loading: "正在删除...",
                success: "已删除",
                error: (err) => err instanceof Error ? err.message : "删除失败",
              },
              {
                id: toastId,
                description: undefined,
                actions: undefined,
                duration: 3200,
              }
            )
          },
          variant: "destructive",
        },
      ],
    })
  }, [])

  const {
    systemInfo,
    refreshSystemInfo,
    wsConnected,
    groups,
    friends,
    loadChatData,
    tasks,
    loadTasks,
    deleteTask,
    createTask,
    downloadTask,
    getTaskStats,
    isTaskDataStale,
    isLoading,
    error,
    setError,
    exportGroupAvatars,
    avatarExportLoading,
    isJsonlExport,
    openTaskFileLocation,
  } = useQCE({
    onNotification: (notification) => {
      addNotification(
        notification.type,
        notification.title,
        notification.message,
        notification.actions
      )
    }
  })

  // 导出群成员头像
  const handleExportGroupAvatars = async (groupCode: string, groupName: string) => {
    const loadingId = addNotification('info', '正在导出', `正在导出群"${groupName}"的成员头像...`)
    
    try {
      const result = await exportGroupAvatars(groupCode)
      removeNotification(loadingId)
      
      if (result) {
        addNotification(
          'success',
          '导出成功',
          `已导出 ${result.successCount} 个头像\n文件: ${result.fileName}`,
          [
            {
              label: '打开文件位置',
              onClick: () => openFileLocation(result.filePath)
            }
          ],
          0
        )
      } else {
        addNotification('error', '导出失败', '导出群头像失败')
      }
    } catch (error) {
      removeNotification(loadingId)
      addNotification('error', '导出失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  // 打开群精华消息模态框
  const handleOpenEssenceModal = (groupCode: string, groupName: string) => {
    setEssenceGroup({ groupCode, groupName })
    setIsEssenceModalOpen(true)
  }

  // 关闭群精华消息模态框
  const handleCloseEssenceModal = () => {
    setIsEssenceModalOpen(false)
    setEssenceGroup(null)
  }

  // 打开群文件/群相册模态框
  const handleOpenGroupFilesModal = (groupCode: string, groupName: string) => {
    setGroupFilesTarget({ groupCode, groupName })
    setIsGroupFilesModalOpen(true)
  }

  // 关闭群文件/群相册模态框
  const handleCloseGroupFilesModal = () => {
    setIsGroupFilesModalOpen(false)
    setGroupFilesTarget(null)
  }

  // 打开文件位置
  const openFileLocation = async (filePath?: string) => {
    console.log('[QCE] openFileLocation called with:', { filePath, hasFilePath: !!filePath })
    
    if (!filePath) {
      addNotification('error', '打开失败', '文件路径不存在')
      return
    }
    
    try {
      const response = await fetch('/api/open-file-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      })
      
      const data = await response.json()
      if (!data.success) {
        const msg = typeof data.error === 'string' ? data.error : data.error?.message || '未知错误'
        addNotification('error', '打开失败', msg)
      }
    } catch (error) {
      console.error('[QCE] Open file location error:', error)
      addNotification('error', '打开失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  // 打开导出目录
  const openExportDirectory = async () => {
    try {
      const response = await fetch('/api/open-export-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      const data = await response.json()
      if (!data.success) {
        const msg = typeof data.error === 'string' ? data.error : data.error?.message || '未知错误'
        addNotification('error', '打开失败', msg)
      }
    } catch (error) {
      console.error('[QCE] Open export directory error:', error)
      addNotification('error', '打开失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  const {
    scheduledExports,
    loading: scheduledLoading,
    error: scheduledError,
    loadScheduledExports,
    createScheduledExport,
    updateScheduledExport,
    deleteScheduledExport,
    triggerScheduledExport,
    toggleScheduledExport,
    getExecutionHistory,
    getStats: getScheduledStats,
    setError: setScheduledError,
  } = useScheduledExports()

  const {
    files: chatHistoryFiles,
    loading: chatHistoryLoading,
    error: chatHistoryError,
    loadChatHistory,
    getStats: getChatHistoryStats,
    deleteFile: deleteChatHistoryFile,
    downloadFile: downloadChatHistoryFile,
    setError: setChatHistoryError,
  } = useChatHistory()

  const {
    packs: stickerPacks,
    exportRecords: stickerExportRecords,
    loading: stickerPacksLoading,
    error: stickerPacksError,
    loadStickerPacks,
    loadExportRecords: loadStickerExportRecords,
    exportStickerPack,
    exportAllStickerPacks,
    getStats: getStickerPacksStats,
    setError: setStickerPacksError,
  } = useStickerPacks()

  const {
    index: resourceIndex,
    resourceFiles,
    resourceFilesTotal,
    resourceFilesHasMore,
    loading: resourceIndexLoading,
    filesLoading: resourceFilesLoading,
    error: resourceIndexError,
    loadResourceIndex,
    loadResourceFiles,
    formatSize: formatResourceSize,
    getStats: getResourceStats,
    setError: setResourceIndexError,
  } = useResourceIndex()

  const resourceIndexLoadedRef = useRef(false)
  const [historySubTab, setHistorySubTab] = useState<'records' | 'gallery'>('records')
  const [galleryType, setGalleryType] = useState<'all' | 'images' | 'videos' | 'audios' | 'files'>('all')
  const [galleryPage, setGalleryPage] = useState(1)

  const handleOpenTaskWizard = (preset?: Partial<CreateTaskForm>) => {
    setSelectedPreset(preset)
    setIsTaskWizardOpen(true)
  }

  const handlePreviewChat = (
    type: 'group' | 'friend',
    id: string,
    name: string,
    peer: { chatType: number, peerUid: string }
  ) => {
    setPreviewingChat({ type, id, name, peer })
    setIsPreviewModalOpen(true)
  }

  const handleCloseTaskWizard = () => {
    setIsTaskWizardOpen(false)
    setSelectedPreset(undefined)
  }

  const handleOpenScheduledExportWizard = (preset?: Partial<CreateScheduledExportForm>) => {
    setSelectedScheduledPreset(preset)
    setIsScheduledExportWizardOpen(true)
  }

  const handleCloseScheduledExportWizard = () => {
    setIsScheduledExportWizardOpen(false)
    setSelectedScheduledPreset(undefined)
  }

  const handleOpenHistoryModal = (taskId: string, taskName: string) => {
    setSelectedHistoryTask({ id: taskId, name: taskName })
    setIsHistoryModalOpen(true)
  }

  const handleCloseHistoryModal = () => {
    setIsHistoryModalOpen(false)
    setSelectedHistoryTask(null)
  }

  const handleOpenFilePathModal = (filePath: string, sessionName: string, fileName: string, size?: number) => {
    setSelectedFile({ filePath, sessionName, fileName, size })
    setIsFilePathModalOpen(true)
  }

  const handleCloseFilePathModal = () => {
    setIsFilePathModalOpen(false)
    setSelectedFile(null)
  }

  const handleExportStickerPack = async (packId: string, packName: string) => {
    const loadingId = addNotification('info', '正在导出', `正在导出表情包"${packName}"...`)
    
    try {
      const result = await exportStickerPack(packId)
      removeNotification(loadingId)
      
      if (result) {
        const exportPath = result.exportPath || '未知路径'
        addNotification(
          'success', 
          '导出成功', 
          `表情包"${packName}"已导出\n${exportPath}`
        )
        // 刷新列表和导出记录
        stickerPacksLoadedRef.current = false
        await Promise.all([loadStickerPacks(), loadStickerExportRecords()])
        stickerPacksLoadedRef.current = true
        // 滚动到导出记录区域
        setTimeout(() => {
          const exportHistoryElement = document.getElementById('sticker-export-history')
          if (exportHistoryElement) {
            exportHistoryElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 500)
      } else {
        addNotification('error', '导出失败', `表情包"${packName}"导出失败`)
      }
    } catch (error) {
      removeNotification(loadingId)
      addNotification('error', '导出失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  const handleExportAllStickerPacks = async () => {
    const loadingId = addNotification('info', '正在导出', '正在导出所有表情包...')
    
    try {
      const result = await exportAllStickerPacks()
      removeNotification(loadingId)
      
      if (result) {
        const exportPath = result.exportPath || '未知路径'
        const packCount = result.packCount || 0
        addNotification(
          'success', 
          '导出成功', 
          `已导出 ${packCount} 个表情包\n${exportPath}`
        )
        // 刷新列表和导出记录
        stickerPacksLoadedRef.current = false
        await Promise.all([loadStickerPacks(), loadStickerExportRecords()])
        stickerPacksLoadedRef.current = true
        // 滚动到导出记录区域
        setTimeout(() => {
          const exportHistoryElement = document.getElementById('sticker-export-history')
          if (exportHistoryElement) {
            exportHistoryElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 500)
      } else {
        addNotification('error', '导出失败', '表情包导出失败')
      }
    } catch (error) {
      removeNotification(loadingId)
      addNotification('error', '导出失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  // 任务列表加载（首页和任务页都需要）
  useEffect(() => {
    if ((activeTab === "tasks" || activeTab === "overview") && !tasksLoadedRef.current) {
      tasksLoadedRef.current = true
      loadTasks().catch(() => {
        tasksLoadedRef.current = false
      })
    }
  }, [activeTab, loadTasks])
  
  // 定时导出加载
  useEffect(() => {
    if (activeTab === "scheduled" && !scheduledExportsLoadedRef.current) {
      scheduledExportsLoadedRef.current = true
      loadScheduledExports().catch(() => {
        scheduledExportsLoadedRef.current = false
      })
    }
  }, [activeTab])
  
  // 聊天历史加载
  useEffect(() => {
    if (activeTab === "history" && !chatHistoryLoadedRef.current) {
      chatHistoryLoadedRef.current = true
      loadChatHistory().catch(() => {
        chatHistoryLoadedRef.current = false
      })
    }
  }, [activeTab])
  
  // 表情包加载
  useEffect(() => {
    if (activeTab === "stickers" && !stickerPacksLoadedRef.current) {
      stickerPacksLoadedRef.current = true
      Promise.all([
        loadStickerPacks(),
        loadStickerExportRecords()
      ]).catch((error) => {
        console.error('[QCE] 加载表情包数据失败:', error)
        stickerPacksLoadedRef.current = false
      })
    }
  }, [activeTab])

  // 资源索引加载（与聊天记录一起加载）
  useEffect(() => {
    if (activeTab === "history" && !resourceIndexLoadedRef.current) {
      resourceIndexLoadedRef.current = true
      loadResourceIndex().catch((error) => {
        console.error('[QCE] 加载资源索引失败:', error)
        resourceIndexLoadedRef.current = false
      })
    }
  }, [activeTab])
  
  const handleLoadTasks = async () => {
    tasksLoadedRef.current = false
    try {
      await loadTasks()
      tasksLoadedRef.current = true
    } catch {
      tasksLoadedRef.current = false
    }
  }

  const handleLoadScheduledExports = async () => {
    scheduledExportsLoadedRef.current = false
    try {
      await loadScheduledExports()
      scheduledExportsLoadedRef.current = true
    } catch {
      scheduledExportsLoadedRef.current = false
    }
  }

  const handleLoadChatHistory = async () => {
    chatHistoryLoadedRef.current = false
    await loadChatHistory()
    chatHistoryLoadedRef.current = true
  }

  const handleCreateTask = async (form: CreateTaskForm) => {
    const success = await createTask(form)
    if (success) {
      tasksLoadedRef.current = false
    }
    return success
  }

  const handleCreateScheduledExport = async (form: CreateScheduledExportForm) => {
    const success = await createScheduledExport(form)
    if (success) {
      // Immediately reload the list after successful creation
      await loadScheduledExports()
    }
    return success
  }

  // 批量模式处理函数
  const handleToggleBatchMode = () => {
    setBatchMode(!batchMode)
    if (batchMode) {
      // 退出批量模式时清空选择
      setSelectedItems(new Set())
    }
  }

  const handleSelectAll = (filteredIds?: Set<string>) => {
    if (filteredIds) {
      setSelectedItems(filteredIds)
    } else {
      const allIds = new Set<string>()
      groups.forEach(g => allIds.add(`group_${g.groupCode}`))
      friends.forEach(f => allIds.add(`friend_${f.uid}`))
      setSelectedItems(allIds)
    }
  }

  const handleClearSelection = () => {
    setSelectedItems(new Set())
  }

  /**
   * Issue #344: 区间多选 / 分类全选用的批量增删入口。
   * - mode = 'add' 把 ids 全部加进当前选区；
   * - mode = 'remove' 把 ids 全部从当前选区移除。
   * 不替换其它已选项，避免按「全选群」会清掉用户手挑的好友。
   */
  const handleSelectMany = (ids: Set<string>, mode: 'add' | 'remove') => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (mode === 'add') {
        ids.forEach((id) => next.add(id))
      } else {
        ids.forEach((id) => next.delete(id))
      }
      return next
    })
  }

  const handleToggleItem = (type: 'group' | 'friend', id: string) => {
    const itemId = `${type}_${id}`
    const newSet = new Set(selectedItems)
    if (newSet.has(itemId)) {
      newSet.delete(itemId)
    } else {
      newSet.add(itemId)
    }
    setSelectedItems(newSet)
  }

  const handleOpenBatchExportDialog = () => {
    if (selectedItems.size === 0) return
    setIsBatchExportDialogOpen(true)
  }

  // 获取批量导出的项目列表
  const getBatchExportItems = (): BatchExportItem[] => {
    const items: BatchExportItem[] = []
    
    selectedItems.forEach(itemId => {
      const [type, ...idParts] = itemId.split('_')
      const id = idParts.join('_') // 重新组合ID部分
      
      if (type === 'group') {
        const group = groups.find(g => g.groupCode === id)
        if (group) {
          items.push({
            type: 'group',
            id: group.groupCode,
            name: group.groupName,
            chatType: 2,
            peerUid: group.groupCode
          })
        }
      } else if (type === 'friend') {
        const friend = friends.find(f => f.uid === id)
        if (friend) {
          // Issue #364: 合并自最近联系人的特殊会话（QQ Bot / 服务号 / 临时会话）
          // 会带上原始 chatType，避免在导出请求里被强制覆写为 1。
          items.push({
            type: 'friend',
            id: friend.uid,
            name: friend.remark || friend.nick,
            chatType: friend.chatType ?? 1,
            peerUid: friend.uid
          })
        }
      }
    })
    
    return items
  }

  // 批量导出处理函数
  const handleBatchExport = async (config: BatchExportConfig) => {
    const items = getBatchExportItems()
    const results: Array<{ name: string; status: 'success' | 'failed'; error?: string }> = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      
      try {
        // 构建导出表单
        let startTime: string | undefined
        let endTime: string | undefined
        
        if (config.timeRange === 'recent') {
          const now = new Date()
          const threeMonthsAgo = new Date()
          threeMonthsAgo.setMonth(now.getMonth() - 3)
          startTime = threeMonthsAgo.toISOString()
          endTime = now.toISOString()
        } else if (config.timeRange === 'custom') {
          if (config.customStartDate) {
            startTime = new Date(config.customStartDate).toISOString()
          }
          if (config.customEndDate) {
            const endDate = new Date(config.customEndDate)
            endDate.setHours(23, 59, 59, 999)
            endTime = endDate.toISOString()
          }
        }

        const form: CreateTaskForm = {
          chatType: item.chatType,
          peerUid: item.peerUid,
          sessionName: item.name,
          format: config.format,
          startTime,
          endTime,
          includeRecalled: false,
          includeSystemMessages: config.includeSystemMessages,
          filterPureImageMessages: config.filterPureImageMessages,
          // 高级选项
          streamingZipMode: config.streamingZipMode,
          exportAsZip: config.exportAsZip,
          embedAvatarsAsBase64: config.embedAvatarsAsBase64,
          // Issue #311: 自包含 HTML
          embedResourcesAsDataUri: config.embedResourcesAsDataUri,
          preferGroupMemberName: config.preferGroupMemberName,
          outputDir: config.outputDir,
          keywords: config.keywords,
          excludeUserUins: config.excludeUserUins,
          useNameInFileName: config.useNameInFileName,
          // Issue #134: 友好文件名格式
          useFriendlyFileName: config.useFriendlyFileName,
          // Issue #341
          ...(Array.isArray(config.skipDownloadResourceTypes) && config.skipDownloadResourceTypes.length > 0 && {
            skipDownloadResourceTypes: config.skipDownloadResourceTypes,
          }),
        }

        // 调用单个导出 API
        const success = await createTask(form)
        
        if (success) {
          results.push({ name: item.name, status: 'success' })
        } else {
          results.push({ name: item.name, status: 'failed', error: '导出失败' })
        }
      } catch (error) {
        results.push({ 
          name: item.name, 
          status: 'failed', 
          error: error instanceof Error ? error.message : '未知错误' 
        })
      }

      // 添加短暂延迟，避免请求过快
      if (i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    // 导出完成，退出批量模式，清空选择
    setBatchMode(false)
    setSelectedItems(new Set())
    setIsBatchExportDialogOpen(false)

    // 刷新任务列表
    tasksLoadedRef.current = false

    // 显示通知，带跳转按钮
    const successCount = results.filter(r => r.status === 'success').length
    const failedCount = results.filter(r => r.status === 'failed').length
    const goToTasksAction = { label: '查看任务', onClick: () => setActiveTab('tasks') }
    
    if (failedCount === 0) {
      addNotification('success', '批量导出完成', `成功创建 ${successCount} 个导出任务`, [goToTasksAction], 8000)
    } else if (successCount === 0) {
      addNotification('error', '批量导出失败', `所有 ${failedCount} 个任务都失败了`, [goToTasksAction], 8000)
    } else {
      addNotification('info', '批量导出部分完成', `成功 ${successCount} 个，失败 ${failedCount} 个`, [goToTasksAction], 8000)
    }
  }

  // 加载定时备份任务
  const loadScheduledBackups = async () => {
    setLoadingScheduledTasks(true)
    try {
      const response = await fetch('/api/merge-resources/available-tasks')
      const data = await response.json()
      if (data.success) {
        setScheduledTasks(data.data.scheduledTasks || [])
      }
    } catch (error) {
      console.error('加载定时备份失败:', error)
      addNotification('error', '加载失败', '无法获取定时备份列表')
    } finally {
      setLoadingScheduledTasks(false)
    }
  }

  // 打开定时备份合并对话框
  const handleOpenScheduledMergeDialog = async () => {
    await loadScheduledBackups()
    setIsScheduledMergeDialogOpen(true)
  }

  // 执行定时备份合并
  const handleScheduledMerge = async (config: {
    sourceTaskIds: string[]  // 文件名列表
    deleteSourceFiles: boolean
    deduplicateMessages: boolean
  }) => {
    const loadingId = addNotification('info', '正在合并', '合并任务已开始，请稍候...')
    
    try {
      const response = await fetch('/api/merge-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      
      const data = await response.json()
      
      if (data.success) {
        const result = data.data.result
        removeNotification(loadingId)
        
        // 构建简洁的成功消息
        const message = `成功合并 ${result.sourceCount} 个备份文件，共 ${result.totalMessages} 条消息${result.deduplicatedMessages > 0 ? `（去重 ${result.deduplicatedMessages} 条）` : ''}\n\n已生成 JSON${result.htmlPath ? ' 和 HTML' : ''} 文件`
        
        addNotification(
          'success',
          '合并完成',
          message,
          [
            {
              label: '打开文件位置',
              onClick: async () => {
                try {
                  await fetch('/api/open-file-location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: result.jsonPath })
                  })
                } catch (error) {
                  console.error('打开文件位置失败:', error)
                }
              }
            }
          ],
          0 // 不自动关闭，需要用户手动关闭
        )
        setIsScheduledMergeDialogOpen(false)
      } else {
        removeNotification(loadingId)
        addNotification('error', '合并失败', data.error?.message || '未知错误')
      }
    } catch (error) {
      removeNotification(loadingId)
      addNotification('error', '合并失败', error instanceof Error ? error.message : '网络错误')
    }
  }

  useEffect(() => {
    if (activeTab === "sessions" && groups.length === 0 && friends.length === 0) {
      loadChatData()
    }
  }, [activeTab, groups.length, friends.length, loadChatData])

  useEffect(() => {
    if (!error) return
    toast.error("发生错误", { description: error })
    setError(null)
  }, [error, setError])

  useEffect(() => {
    if (!scheduledError) return
    toast.error("定时任务错误", { description: scheduledError })
    setScheduledError(null)
  }, [scheduledError, setScheduledError])

  useEffect(() => {
    if (!chatHistoryError) return
    toast.error("聊天记录错误", { description: chatHistoryError })
    setChatHistoryError(null)
  }, [chatHistoryError, setChatHistoryError])

  useEffect(() => {
    if (!stickerPacksError) return
    toast.error("表情包错误", { description: stickerPacksError })
    setStickerPacksError(null)
  }, [stickerPacksError, setStickerPacksError])

  useEffect(() => {
    if (!resourceIndexError) return
    toast.error("资源索引错误", { description: resourceIndexError })
    setResourceIndexError(null)
  }, [resourceIndexError, setResourceIndexError])

  const getStatusText = (status: string) => {
    switch (status) {
      case "running": return "进行中"
      case "completed": return "已完成"
      case "failed": return "失败"
      default: return "等待中"
    }
  }

  // 级联动画 variants（受 reduced-motion 影响）
  // 对于大列表（超过50项），禁用 stagger 动画以提升性能
  const hasLargeList = groups.length > 50 || friends.length > 50
  const STAG = useMemo(() => makeStagger(reduceMotion || hasLargeList ? 0 : 0.06, reduceMotion || hasLargeList), [reduceMotion, hasLargeList])
  const SIDEBAR_WIDTH = 240
  const sidebarTransition = useMemo(
    () => reduceMotion
      ? { duration: DUR.fast, ease: EASE.out }
      : { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 },
    [reduceMotion],
  )
  const sidebarContentTransition = useMemo(
    () => reduceMotion
      ? { duration: DUR.fast, ease: EASE.out }
      : { type: "spring" as const, stiffness: 320, damping: 32, mass: 0.82, delay: 0.03 },
    [reduceMotion],
  )
  const onboardingTransition = useMemo(
    () => reduceMotion
      ? { duration: DUR.fast, ease: EASE.out }
      : { type: "spring" as const, stiffness: 340, damping: 28, mass: 0.84 },
    [reduceMotion],
  )

  const getAnchoredOnboardingPosition = useCallback((targetId: string, width: number) => {
    if (typeof window === "undefined") return null
    const targetEl = document.getElementById(targetId)
    if (!targetEl) return null

    const rect = targetEl.getBoundingClientRect()
    const gutter = 16
    const left = Math.min(
      Math.max(rect.right + 16, gutter),
      window.innerWidth - width - gutter,
    )
    const top = Math.min(
      Math.max(rect.top + rect.height / 2 - 64, gutter),
      window.innerHeight - 164,
    )

    return { left, top }
  }, [])

  const getBottomOnboardingPosition = useCallback((width: number) => {
    if (typeof window === "undefined") return null
    const gutter = 16
    return {
      left: Math.max((window.innerWidth - width) / 2, gutter),
      top: Math.max(window.innerHeight - 168, gutter),
    }
  }, [])

  // Navigation items configuration
  const navItems = [
    { id: "overview", label: "概览", icon: Activity },
    { id: "sessions", label: "会话", icon: MessageCircle },
    { id: "tasks", label: "任务", icon: Zap },
    { id: "scheduled", label: "定时导出", icon: Clock },
    { id: "history", label: "聊天记录", icon: History },
    { id: "stickers", label: "表情包", icon: Smile },
  ]

  const navItemsBottom = [
    { id: "settings", label: "设置", icon: Settings },
    { id: "about", label: "关于", icon: HelpCircle },
  ]

  // Page titles mapping
  const pageTitles: Record<string, string> = {
    overview: "概览",
    sessions: "会话",
    tasks: "任务",
    scheduled: "定时导出",
    history: "聊天记录",
    stickers: "表情包",
    settings: "设置",
    about: "关于",
  }
  const onboardingPanelClass = "relative overflow-hidden rounded-[24px] border border-black/[0.08] bg-background/95 px-5 py-4 text-foreground shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/[0.08]"
  const onboardingPrimaryButtonClass = "w-full rounded-full border border-black/[0.08] bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/88 dark:border-white/[0.08]"
  const onboardingSecondaryButtonClass = "w-full rounded-full px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"

  return (
    <div className="flex h-screen w-full bg-background font-sans antialiased overflow-hidden">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarMobileOpen && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(10px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={sidebarTransition}
            className="fixed inset-0 z-40 bg-black/24 md:hidden"
            onClick={() => setSidebarMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {(sidebarOpen || sidebarMobileOpen) && (
          <motion.div
            initial={{ width: 0, opacity: 0, x: reduceMotion ? 0 : -18, scaleX: 0.985, filter: "blur(10px)" }}
            animate={{ width: SIDEBAR_WIDTH, opacity: 1, x: 0, scaleX: 1, filter: "blur(0px)" }}
            exit={{ width: 0, opacity: 0, x: reduceMotion ? 0 : -24, scaleX: 0.98, filter: "blur(12px)" }}
            transition={sidebarTransition}
            className={`h-full flex flex-col flex-shrink-0 overflow-hidden select-none ${
              sidebarMobileOpen ? 'fixed left-0 top-0 z-50 bg-background/95 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl' : 'relative'
            }`}
          >
            <motion.div
              initial={{ opacity: 0, x: reduceMotion ? 0 : -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduceMotion ? 0 : -12 }}
              transition={sidebarContentTransition}
              className="w-[240px] h-full flex flex-col"
            >
              {/* Sidebar header */}
              <div className="flex items-center px-4 h-14 flex-shrink-0">
                {systemInfo?.napcat.selfInfo ? (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="w-7 h-7 flex-shrink-0 rounded-full">
                      <AvatarImage src={`http://q.qlogo.cn/g?b=qq&nk=${systemInfo.napcat.selfInfo.uin}&s=100`} className="rounded-full" />
                      <AvatarFallback className="text-[11px] rounded-full">{systemInfo.napcat.selfInfo.nick?.[0] || 'Q'}</AvatarFallback>
                    </Avatar>
                    <span className="text-[13px] font-semibold text-foreground truncate">{systemInfo.napcat.selfInfo.nick}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-black/[0.04] dark:bg-white/[0.06] animate-pulse" />
                    <div className="w-20 h-3.5 bg-black/[0.04] dark:bg-white/[0.06] rounded animate-pulse" />
                  </div>
                )}
              </div>

              {/* Main nav */}
              <motion.div
                className="flex-1 overflow-y-auto px-2 py-1"
                variants={STAG.container}
                initial="initial"
                animate="animate"
              >
                <div className="space-y-0.5">
                  {navItems.map((item) => {
                    const isActive = activeTab === item.id
                    const Icon = item.icon
                    return (
                      <motion.button
                        key={item.id}
                        variants={STAG.item}
                        id={`nav-${item.id}`}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-2.5 px-2 py-[6px] text-[13px] font-medium rounded-md transition-colors ${
                          isActive 
                            ? "text-foreground bg-black/[0.05] dark:bg-white/[0.05]" 
                            : "text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        } ${highlightedNav === item.id ? "ring-2 ring-black/10 dark:ring-white/14 ring-offset-2 ring-offset-background" : ""}`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.id === "tasks" && getTaskStats().running > 0 && (
                          <span className="ml-auto text-[11px] text-blue-600 dark:text-blue-400 font-medium tabular-nums">
                            {getTaskStats().running}
                          </span>
                        )}
                      </motion.button>
                    )
                  })}
                </div>

                <div className="mt-4 mb-1 px-2">
                  <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">系统</span>
                </div>
                <div className="space-y-0.5">
                  {navItemsBottom.map((item) => {
                    const isActive = activeTab === item.id
                    const Icon = item.icon
                    return (
                      <motion.button
                        key={item.id}
                        variants={STAG.item}
                        id={`nav-${item.id}`}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-2.5 px-2 py-[6px] text-[13px] font-medium rounded-md transition-colors ${
                          isActive 
                            ? "text-foreground bg-black/[0.05] dark:bg-white/[0.05]" 
                            : "text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </motion.button>
                    )
                  })}
                </div>
              </motion.div>

              {/* Sidebar footer */}
              <div className="flex-shrink-0 px-2 pb-2 space-y-1">
                <div className="flex items-center justify-between px-2 py-1">
                  <a
                    href="https://sdjz.wiki/post/qce%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1"
                  >
                    文档
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="flex items-center gap-1.5">
                    <ThemeToggle />
                    <a
                      href="https://github.com/shuakami/qq-chat-exporter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[12px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      {githubStars !== null ? (githubStars >= 1000 ? `${(githubStars / 1000).toFixed(1)}k` : githubStars) : ''}
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden sm:m-2 sm:rounded-xl sm:border sm:border-black/[0.05] sm:shadow-[0_2px_8px_rgba(0,0,0,0.015)] bg-card dark:border-white/[0.06]">
        {/* Page header bar */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] px-4 h-12">
          <div className="flex items-center gap-2 text-[14px]">
            <button
              onClick={() => {
                if (window.innerWidth < 768) {
                  setSidebarMobileOpen(!sidebarMobileOpen)
                } else {
                  setSidebarOpen(!sidebarOpen)
                }
              }}
              className="p-1 -ml-1 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <span className="font-medium text-muted-foreground">QCE</span>
            <span className="text-muted-foreground/30">/</span>
            <span className="font-semibold text-foreground">{pageTitles[activeTab] || activeTab}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Page-specific actions */}

            {activeTab === "sessions" && (
              <>
                <Button size="sm" variant="ghost" className="h-8 text-[13px] rounded-full px-2" onClick={loadChatData} disabled={isLoading}>
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
                {!batchMode && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[13px] rounded-full px-2.5"
                    onClick={handleToggleBatchMode}
                  >
                    批量导出
                  </Button>
                )}
              </>
            )}
            {activeTab === "tasks" && (
              <>
                <div className="relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[13px] rounded-full px-2"
                    onClick={() => setShowExportHelpMenu(!showExportHelpMenu)}
                  >
                    <HelpCircle className="w-4 h-4" />
                  </Button>
                  <AnimatePresence>
                    {showExportHelpMenu && (
                      <>
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="fixed inset-0 z-40"
                          onClick={() => setShowExportHelpMenu(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.97 }}
                          transition={{ duration: 0.12 }}
                          className="absolute right-0 top-full mt-1 w-56 bg-card rounded-lg border border-black/[0.06] dark:border-white/[0.06] shadow-lg z-50 overflow-hidden"
                        >
                          <div className="p-1">
                            <button
                              className="w-full px-3 py-2 text-left text-[13px] rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                              onClick={() => { setShowExportHelpMenu(false); setShowHtmlHelp(true); }}
                            >
                              <div className="font-medium text-foreground">HTML 导出</div>
                              <div className="text-[11px] text-muted-foreground/60">可视化聊天记录</div>
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-[13px] rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                              onClick={() => { setShowExportHelpMenu(false); setShowJsonHelp(true); }}
                            >
                              <div className="font-medium text-foreground">JSON 导出</div>
                              <div className="text-[11px] text-muted-foreground/60">结构化数据格式</div>
                            </button>
                            <div className="my-0.5 border-t border-black/[0.04] dark:border-white/[0.04]" />
                            <button
                              className="w-full px-3 py-2 text-left text-[13px] rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                              onClick={() => { setShowExportHelpMenu(false); setShowStreamingZipHelp(true); }}
                            >
                              <div className="font-medium text-foreground">流式 ZIP</div>
                              <div className="text-[11px] text-muted-foreground/60">大规模 HTML 分块打包</div>
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-[13px] rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                              onClick={() => { setShowExportHelpMenu(false); setShowJsonlHelp(true); }}
                            >
                              <div className="font-medium text-foreground">JSONL 分块</div>
                              <div className="text-[11px] text-muted-foreground/60">大规模数据处理</div>
                            </button>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
                <Button size="sm" variant="ghost" className="h-8 text-[13px] rounded-full px-2" onClick={handleLoadTasks} disabled={isLoading}>
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button size="sm" className="h-8 text-[13px] rounded-full px-2.5" onClick={() => handleOpenTaskWizard()}>
                  新建任务
                </Button>
              </>
            )}
            {activeTab === "scheduled" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[13px] rounded-full px-2"
                  onClick={handleLoadScheduledExports}
                  disabled={scheduledLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${scheduledLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[13px] rounded-full px-2.5"
                  onClick={handleOpenScheduledMergeDialog}
                  disabled={loadingScheduledTasks}
                >
                  <Combine className="w-4 h-4 mr-1" />
                  合并
                </Button>
                <Button size="sm" className="h-8 text-[13px] rounded-full px-2.5" onClick={() => handleOpenScheduledExportWizard()}>
                  新建定时任务
                </Button>
              </>
            )}
            {activeTab === "history" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[13px] rounded-full px-2"
                onClick={async () => {
                  chatHistoryLoadedRef.current = false
                  resourceIndexLoadedRef.current = false
                  await Promise.all([handleLoadChatHistory(), loadResourceIndex()])
                  chatHistoryLoadedRef.current = true
                  resourceIndexLoadedRef.current = true
                }}
                disabled={chatHistoryLoading || resourceIndexLoading}
              >
                <RefreshCw className={`w-4 h-4 ${(chatHistoryLoading || resourceIndexLoading) ? 'animate-spin' : ''}`} />
              </Button>
            )}
            {activeTab === "stickers" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[13px] rounded-full px-2"
                  onClick={async () => {
                    stickerPacksLoadedRef.current = false
                    try {
                      await Promise.all([loadStickerPacks(), loadStickerExportRecords()])
                      stickerPacksLoadedRef.current = true
                    } catch (error) {
                      console.error('[QCE] 刷新表情包失败:', error)
                      stickerPacksLoadedRef.current = false
                    }
                  }}
                  disabled={stickerPacksLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${stickerPacksLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-[13px] rounded-full px-2.5"
                  onClick={handleExportAllStickerPacks}
                  disabled={stickerPacksLoading || stickerPacks.length === 0}
                >
                  <Download className="w-4 h-4 mr-1" />
                  导出所有
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto">
          <>
            {/* ==================== OVERVIEW ==================== */}
            {activeTab === "overview" && (
              <div className="p-6 space-y-6">
                {/* User info card */}
                {systemInfo?.napcat.selfInfo && (
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12 rounded-full">
                      <AvatarImage src={`http://q.qlogo.cn/g?b=qq&nk=${systemInfo.napcat.selfInfo.uin}&s=100`} className="rounded-full" />
                      <AvatarFallback className="rounded-full text-sm">{systemInfo.napcat.selfInfo.nick?.[0] || 'Q'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{systemInfo.napcat.selfInfo.nick}</h2>
                      <div className="flex items-center gap-2 mt-0.5 text-sm text-muted-foreground">
                        <span>QQ {systemInfo.napcat.selfInfo.uin}</span>
                        <span className="text-muted-foreground/30">·</span>
                        {systemInfo?.napcat.workingEnv && (
                          <>
                            <span>{systemInfo.napcat.workingEnv === 'framework' ? 'Framework' : systemInfo.napcat.workingEnv === 'shell' ? 'Shell' : '未知'}</span>
                            <span className="text-muted-foreground/30">·</span>
                          </>
                        )}
                        <span>{wsConnected ? "已连接" : "未连接"}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span>{systemInfo?.napcat.online ? "QQ在线" : "QQ离线"}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4">
                    <div className="text-sm text-muted-foreground">导出任务</div>
                    <div className="text-2xl font-semibold tracking-tight mt-1">{getTaskStats().total}</div>
                    <div className="text-xs text-muted-foreground/60 mt-1">
                      进行中 {getTaskStats().running} · 完成 {getTaskStats().completed}
                    </div>
                  </div>
                  <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4">
                    <div className="text-sm text-muted-foreground">群组</div>
                    <div className="text-2xl font-semibold tracking-tight mt-1">{groups.length}</div>
                  </div>
                  <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4">
                    <div className="text-sm text-muted-foreground">好友</div>
                    <div className="text-2xl font-semibold tracking-tight mt-1">{friends.length}</div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-3">
                  <Button onClick={() => handleOpenTaskWizard()} className="rounded-full">
                    新建任务
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab("sessions")} className="rounded-full">
                    浏览会话
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab("tasks")} className="rounded-full">
                    查看任务
                  </Button>
                </div>

                {/* Recent tasks */}
                {tasks.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-foreground">最近任务</h3>
                      <button
                        onClick={() => setActiveTab("tasks")}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        查看全部
                      </button>
                    </div>
                    <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] divide-y divide-black/[0.04] dark:divide-white/[0.04] overflow-hidden">
                      {tasks.slice(0, 5).map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="min-w-0 flex-1 flex items-center gap-3">
                            <span className="text-sm font-medium text-foreground truncate">{task.sessionName}</span>
                            <Badge
                              className={`text-[11px] px-1.5 py-0 rounded-full border-0 ${
                                task.status === "completed"
                                  ? "text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/40"
                                  : task.status === "running"
                                  ? "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40"
                                  : task.status === "failed"
                                  ? "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40"
                                  : ""
                              }`}
                            >
                              {getStatusText(task.status)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{task.format}</span>
                            <span className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleDateString()}</span>
                            {task.messageCount !== undefined && task.messageCount > 0 && (
                              <span className="text-xs text-muted-foreground">{task.messageCount.toLocaleString()} 条</span>
                            )}
                          </div>
                          <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                            {task.status === "running" && (
                              <>
                                <Progress value={task.progress} shimmer={true} className="w-20 h-1.5 rounded-full" />
                                <span className="text-xs text-muted-foreground font-medium tabular-nums">{task.progress}%</span>
                              </>
                            )}
                            {task.status === "completed" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-8 rounded-lg px-2" onClick={() => openFileLocation(task.filePath)} title="打开文件位置">
                                  <FolderOpen className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 rounded-lg px-2" onClick={() => downloadTask(task)} title={isJsonlExport(task) ? "打开文件夹" : "下载"}>
                                  {isJsonlExport(task) ? <FolderOpen className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== SESSIONS ==================== */}
            {activeTab === "sessions" && (
              <div className="p-5 space-y-4">
                {batchMode && (
                  <div className="text-[13px] text-muted-foreground px-1">
                    已选择 {selectedItems.size} 个会话
                  </div>
                )}
                <SessionList
                  groups={groups}
                  friends={friends}
                  isLoading={isLoading}
                  batchMode={batchMode}
                  selectedItems={selectedItems}
                  avatarExportLoading={avatarExportLoading}
                  onRefresh={loadChatData}
                  onToggleBatchMode={handleToggleBatchMode}
                  onSelectAll={handleSelectAll}
                  onClearSelection={handleClearSelection}
                  onToggleItem={handleToggleItem}
                  onSelectMany={handleSelectMany}
                  onOpenBatchExportDialog={handleOpenBatchExportDialog}
                  onPreviewChat={handlePreviewChat}
                  onOpenTaskWizard={handleOpenTaskWizard}
                  onExportGroupAvatars={handleExportGroupAvatars}
                  onOpenEssenceModal={handleOpenEssenceModal}
                  onOpenGroupFilesModal={handleOpenGroupFilesModal}
                />
              </div>
            )}

            {/* ==================== TASKS ==================== */}
            {activeTab === "tasks" && (
              <div className="p-6 space-y-1">
                {tasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Zap className="w-8 h-8 text-muted-foreground/20 mb-3" />
                    <p className="text-sm text-foreground font-medium">暂无导出任务</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">从「会话」中选择一个会话来创建任务</p>
                  </div>
                ) : (
                  tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between px-4 py-3.5 text-sm rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground truncate">{task.sessionName}</span>
                          <Badge
                            className={`text-[11px] px-1.5 py-0 rounded-full border-0 ${
                              task.status === "completed"
                                ? "text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/40"
                                : task.status === "running"
                                ? "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40"
                                : task.status === "failed"
                                ? "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40"
                                : ""
                            }`}
                          >
                            {getStatusText(task.status)}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground/50">
                          <span className="font-mono">{task.peer?.peerUid}</span>
                          <span>{task.format}</span>
                          <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                          {task.messageCount !== undefined && task.messageCount > 0 && (
                            <span>{task.messageCount.toLocaleString()} 条消息</span>
                          )}
                          {(task.startTime || task.endTime) && (
                            <span className="font-medium">
                              {task.startTime && task.endTime
                                ? `${new Date(task.startTime * 1000).toLocaleDateString()} ~ ${new Date(task.endTime * 1000).toLocaleDateString()}`
                                : task.startTime
                                ? `从 ${new Date(task.startTime * 1000).toLocaleDateString()}`
                                : `到 ${new Date(task.endTime! * 1000).toLocaleDateString()}`}
                            </span>
                          )}
                          {task.status === "running" && task.progressMessage && (
                            <span className="text-muted-foreground/40">{task.progressMessage}</span>
                          )}
                        </div>

                        {/* Running progress inline */}
                        {task.status === "running" && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <Progress
                              value={task.progress}
                              shimmer={true}
                              className="h-1.5 rounded-full flex-1 max-w-[240px]"
                            />
                            <span className="text-xs font-medium text-muted-foreground/50 tabular-nums">{task.progress}%</span>
                          </div>
                        )}

                        {/* Error */}
                        {task.error && (
                          <div className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                            {task.error}
                          </div>
                        )}
                      </div>

                      <div className="ml-3 flex items-center gap-1.5 flex-shrink-0">
                        {task.status === "completed" && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 rounded-full p-0"
                              onClick={() => openFileLocation(task.filePath)}
                              title="打开文件位置"
                            >
                              <FolderOpen className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 rounded-full p-0"
                              onClick={() => downloadTask(task)}
                              title={isJsonlExport(task) ? "打开文件夹" : "下载"}
                            >
                              {isJsonlExport(task) ? <FolderOpen className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                            </Button>
                          </>
                        )}
                        {(task.status === "completed" || task.status === "failed") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-full p-0 text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => {
                              showDeleteConfirmationToast(`删除任务「${task.sessionName}」？`, "此操作不可撤销", async () => {
                                const success = await deleteTask(task.id)
                                if (!success) throw new Error("删除失败")
                                tasksLoadedRef.current = false
                              })
                            }}
                            title="删除"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ==================== SCHEDULED ==================== */}
            {activeTab === "scheduled" && (
              <div className="p-5 space-y-4">
                {/* Filter Tabs */}
                {scheduledExports.length > 0 && (
                  <div className="flex items-center gap-0.5 px-1">
                    {[
                      { id: 'all', label: `全部 ${getScheduledStats().total}` },
                      { id: 'enabled', label: `启用 ${getScheduledStats().enabled}` },
                      { id: 'disabled', label: `禁用 ${getScheduledStats().disabled}` },
                    ].map(tab => {
                      const isActive = scheduledFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setScheduledFilter(tab.id as typeof scheduledFilter)}
                          className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                            isActive 
                              ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium' 
                              : 'text-muted-foreground/60 hover:text-muted-foreground'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* List */}
                {scheduledExports.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Clock className="w-8 h-8 text-muted-foreground/20 mb-3" />
                    <p className="text-[13px] text-foreground font-medium">暂无定时导出任务</p>
                    <p className="text-[12px] text-muted-foreground/60 mt-1">点击右上角「新建定时任务」开始</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {scheduledExports
                      .filter(se => scheduledFilter === 'all' || (scheduledFilter === 'enabled' ? se.enabled : !se.enabled))
                      .map((scheduledExport) => (
                      <div
                        key={scheduledExport.id}
                        className="group flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            scheduledExport.enabled ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'
                          }`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-foreground truncate">
                                {scheduledExport.name}
                              </span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                scheduledExport.enabled 
                                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' 
                                  : 'bg-black/[0.04] dark:bg-white/[0.04] text-muted-foreground/50'
                              }`}>
                                {scheduledExport.enabled ? "启用" : "禁用"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground/50">
                              <span>
                                {scheduledExport.scheduleType === "daily" && "每天"}
                                {scheduledExport.scheduleType === "weekly" && "每周"}
                                {scheduledExport.scheduleType === "monthly" && "每月"}
                                {scheduledExport.scheduleType === "custom" && "自定义"}
                              </span>
                              <span className="text-muted-foreground/20">·</span>
                              <span>
                                {scheduledExport.scheduleType === "custom" && scheduledExport.cronExpression
                                  ? scheduledExport.cronExpression
                                  : scheduledExport.executeTime}
                              </span>
                              {scheduledExport.nextRun && (
                                <>
                                  <span className="text-muted-foreground/20">·</span>
                                  <span>
                                    下次 {new Date(scheduledExport.nextRun).toLocaleString("zh-CN", {
                                      month: "numeric",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="px-2 py-1 text-[11px] text-muted-foreground/50 hover:text-foreground rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                            onClick={() => toggleScheduledExport(scheduledExport.id, !scheduledExport.enabled)}
                          >
                            {scheduledExport.enabled ? "禁用" : "启用"}
                          </button>
                          <button
                            className="px-2 py-1 text-[11px] text-muted-foreground/50 hover:text-foreground rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                            onClick={() => triggerScheduledExport(scheduledExport.id)}
                          >
                            执行
                          </button>
                          <button
                            className="px-2 py-1 text-[11px] text-muted-foreground/50 hover:text-foreground rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                            onClick={() => handleOpenHistoryModal(scheduledExport.id, scheduledExport.name)}
                          >
                            历史
                          </button>
                          <button
                            className="p-1 text-muted-foreground/30 hover:text-red-500 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            onClick={() => {
                              showDeleteConfirmationToast(`删除定时任务「${scheduledExport.name}」？`, "此操作不可撤销", async () => {
                                const success = await deleteScheduledExport(scheduledExport.id)
                                if (!success) throw new Error("删除失败")
                                await loadScheduledExports()
                              })
                            }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ==================== HISTORY ==================== */}
            {activeTab === "history" && (
              <div className="p-5 space-y-4">
                {/* Stats line */}
                <div className="text-[12px] text-muted-foreground/50 px-1">
                  {getChatHistoryStats().total} 个文件
                  {resourceIndex && ` · ${resourceIndex.summary.totalResources.toLocaleString()} 资源 · ${formatResourceSize(resourceIndex.summary.totalSize)}`}
                </div>

                {/* Sub Tabs */}
                <div className="flex items-center gap-0.5 px-1">
                  <button
                    onClick={() => setHistorySubTab('records')}
                    className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                      historySubTab === 'records'
                        ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium'
                        : 'text-muted-foreground/60 hover:text-muted-foreground'
                    }`}
                  >
                    记录列表
                  </button>
                  <button
                    onClick={() => {
                      setHistorySubTab('gallery')
                      if (resourceFiles.length === 0) {
                        loadResourceFiles(galleryType, 1, 50)
                      }
                    }}
                    className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                      historySubTab === 'gallery'
                        ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium'
                        : 'text-muted-foreground/60 hover:text-muted-foreground'
                    }`}
                  >
                    资源画廊
                  </button>
                </div>

                {/* Records View */}
                {historySubTab === 'records' && (
                  <>
                    {/* Filters Row */}
                    {chatHistoryFiles.length > 0 && (
                      <div className="flex items-center justify-between gap-4 flex-wrap px-1">
                        <div className="flex items-center gap-0.5">
                          {[
                            { id: 'all', label: '全部' },
                            { id: 'group', label: '群组' },
                            { id: 'friend', label: '好友' },
                          ].map(tab => {
                            const isActive = (historyFilter || 'all') === tab.id;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => setHistoryFilter(tab.id as 'all' | 'group' | 'friend')}
                                className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                                  isActive 
                                    ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium' 
                                    : 'text-muted-foreground/50 hover:text-muted-foreground'
                                }`}
                              >
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[
                            { id: 'all', label: '全部格式' },
                            { id: 'html', label: 'HTML' },
                            { id: 'json', label: 'JSON' },
                            { id: 'zip', label: 'ZIP' },
                            { id: 'jsonl', label: 'JSONL' },
                          ].map(tab => {
                            const isActive = (historyFormatFilter || 'all') === tab.id;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => setHistoryFormatFilter(tab.id as 'all' | 'html' | 'json' | 'zip' | 'jsonl')}
                                className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                                  isActive 
                                    ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium' 
                                    : 'text-muted-foreground/50 hover:text-muted-foreground'
                                }`}
                              >
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Empty State */}
                    {chatHistoryFiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <MessageCircle className="w-8 h-8 text-muted-foreground/20 mb-3" />
                        <p className="text-[13px] text-foreground font-medium">暂无聊天记录</p>
                        <p className="text-[12px] text-muted-foreground/60 mt-1">完成导出任务后，记录将在此处显示</p>
                      </div>
                    ) : (
                      /* Flat file list */
                      <div className="space-y-0.5">
                        {chatHistoryFiles
                          .filter(file => {
                            if (historyFilter === 'group' && file.chatType !== 'group') return false;
                            if (historyFilter === 'friend' && file.chatType === 'group') return false;
                            if (historyFormatFilter && historyFormatFilter !== 'all') {
                              const ext = file.fileName.toLowerCase().split('.').pop();
                              const isHtml = ext === 'html' || ext === 'htm';
                              const isJson = ext === 'json';
                              const isZip = ext === 'zip';
                              const isJsonl = file.fileName.includes('_chunked_jsonl');
                              if (historyFormatFilter === 'html' && !isHtml) return false;
                              if (historyFormatFilter === 'json' && !isJson) return false;
                              if (historyFormatFilter === 'zip' && !isZip) return false;
                              if (historyFormatFilter === 'jsonl' && !isJsonl) return false;
                            }
                            return true;
                          })
                          .map((file) => {
                            const avatarUrl = file.chatType === 'group' 
                              ? `https://p.qlogo.cn/gh/${file.chatId}/${file.chatId}/640/`
                              : `https://q1.qlogo.cn/g?b=qq&nk=${file.chatId}&s=640`;
                            
                            const ext = file.fileName.toLowerCase().split('.').pop();
                            const isJsonl = file.fileName.includes('_chunked_jsonl');
                            const formatLabel = isJsonl ? 'JSONL' : ext === 'html' || ext === 'htm' ? 'HTML' : ext === 'json' ? 'JSON' : ext === 'zip' ? 'ZIP' : ext?.toUpperCase();
                            
                            const resourceInfo = resourceIndex?.exports.find(e => 
                              e.fileName === file.fileName || 
                              e.fileName === file.fileName.replace(/\.(html|json)$/i, '')
                            );
                            
                            return (
                              <div
                                key={file.fileName}
                                className="group flex items-center px-3 py-3 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                                onClick={() => handleOpenFilePathModal(file.filePath, file.displayName || file.sessionName || file.chatId, file.fileName, file.size)}
                              >
                                <Avatar className="w-9 h-9 rounded-full border border-black/[0.04] dark:border-white/[0.04] flex-shrink-0 mr-3">
                                  <AvatarImage src={avatarUrl} className="rounded-full" />
                                  <AvatarFallback className="rounded-full bg-black/[0.02] dark:bg-white/[0.04] text-muted-foreground/40">
                                    {file.chatType === 'group' ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <span className="text-[13px] font-medium text-foreground truncate block">
                                    {file.displayName || file.sessionName || file.chatId}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 ml-3 flex-shrink-0 text-[11px] text-muted-foreground/40">
                                  {file.messageCount !== undefined && file.messageCount > 0 && (
                                    <span>{file.messageCount} 条</span>
                                  )}
                                  {resourceInfo && resourceInfo.resourceCount > 0 && (
                                    <span>{resourceInfo.resourceCount} 资源</span>
                                  )}
                                  <span>{new Date(file.createTime).toLocaleDateString()}</span>
                                  <span className="text-[10px] font-medium bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 rounded text-muted-foreground/50">
                                    {formatLabel}
                                  </span>
                                </div>
                                <button
                                  className="p-1 ml-1 rounded-md text-muted-foreground/20 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    showDeleteConfirmationToast(`删除这条记录？`, file.displayName || file.sessionName || file.chatId, async () => {
                                      const success = await deleteChatHistoryFile(file.fileName);
                                      if (!success) throw new Error("删除失败");
                                      chatHistoryLoadedRef.current = false;
                                    })
                                  }}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}

                {/* Gallery View */}
                {historySubTab === 'gallery' && (
                  <div className="space-y-4">
                    {/* Gallery Type Filter */}
                    <div className="flex items-center gap-0.5 px-1">
                      {[
                        { id: 'all', label: '全部' },
                        { id: 'images', label: '图片' },
                        { id: 'videos', label: '视频' },
                        { id: 'audios', label: '音频' },
                        { id: 'files', label: '文件' },
                      ].map(tab => {
                        const isActive = galleryType === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => {
                              setGalleryType(tab.id as typeof galleryType)
                              setGalleryPage(1)
                              loadResourceFiles(tab.id as typeof galleryType, 1, 50)
                            }}
                            className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                              isActive 
                                ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium' 
                                : 'text-muted-foreground/60 hover:text-muted-foreground'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                      <span className="text-[11px] text-muted-foreground/40 ml-2">
                        {resourceFilesTotal} 个
                      </span>
                    </div>

                    {/* Loading */}
                    {resourceFilesLoading && resourceFiles.length === 0 && (
                      <div className="flex items-center justify-center py-20">
                        <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground/40" />
                        <span className="ml-2 text-muted-foreground/50 text-[13px]">加载中...</span>
                      </div>
                    )}

                    {/* Gallery Grid */}
                    {resourceFiles.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                        {resourceFiles.map((file, idx) => (
                          <div
                            key={`${file.fileName}-${idx}`}
                            className="relative aspect-square rounded-lg overflow-hidden bg-black/[0.02] dark:bg-white/[0.02] cursor-pointer group hover:ring-2 hover:ring-black/[0.08] dark:hover:ring-white/[0.08] transition-all"
                            onClick={() => setPreviewResource({ type: file.type, url: file.url, name: file.fileName })}
                          >
                            {file.type === 'image' ? (
                              <img
                                src={file.url}
                                alt={file.fileName}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : file.type === 'video' ? (
                              <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                                <Video className="w-8 h-8 text-white/60" />
                              </div>
                            ) : file.type === 'audio' ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Music className="w-8 h-8 text-muted-foreground/30" />
                              </div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <File className="w-8 h-8 text-muted-foreground/30" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Load More */}
                    {resourceFilesHasMore && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[12px] rounded-md"
                          onClick={() => {
                            const nextPage = galleryPage + 1
                            setGalleryPage(nextPage)
                            loadResourceFiles(galleryType, nextPage, 50, true)
                          }}
                          disabled={resourceFilesLoading}
                        >
                          {resourceFilesLoading ? '加载中...' : '加载更多'}
                        </Button>
                      </div>
                    )}

                    {/* Empty */}
                    {!resourceFilesLoading && resourceFiles.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Image className="w-8 h-8 text-muted-foreground/20 mb-3" />
                        <p className="text-[13px] text-foreground font-medium">暂无资源</p>
                        <p className="text-[12px] text-muted-foreground/60 mt-1">导出聊天记录后，资源将显示在这里</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Resource Preview Modal */}
                <AnimatePresence>
                  {previewResource && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
                      onClick={() => setPreviewResource(null)}
                    >
                      <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-white/80 text-sm truncate max-w-md">{previewResource.name}</p>
                        <div className="flex items-center gap-2">
                          <button
                            className="p-2.5 rounded-full bg-background/10 text-white hover:bg-background/20 transition-colors"
                            onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                const response = await fetch(previewResource.url)
                                const blob = await response.blob()
                                const url = window.URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = previewResource.name
                                document.body.appendChild(a)
                                a.click()
                                document.body.removeChild(a)
                                window.URL.revokeObjectURL(url)
                              } catch (err) {
                                console.error('下载失败:', err)
                              }
                            }}
                            title="下载"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => setPreviewResource(null)}
                            className="p-2.5 rounded-full bg-background/10 text-white hover:bg-background/20 transition-colors"
                            title="关闭"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </motion.div>

                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className="max-w-[95vw] max-h-[85vh] flex items-center justify-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {previewResource.type === 'image' ? (
                          <img
                            src={previewResource.url}
                            alt={previewResource.name}
                            className="max-w-full max-h-[85vh] object-contain rounded-lg cursor-zoom-in"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(previewResource.url, '_blank')
                            }}
                          />
                        ) : previewResource.type === 'video' ? (
                          <video
                            src={previewResource.url}
                            controls
                            autoPlay
                            className="max-w-full max-h-[85vh] rounded-lg"
                          />
                        ) : previewResource.type === 'audio' ? (
                          <div className="p-10 flex flex-col items-center justify-center bg-background/5 backdrop-blur rounded-2xl border border-white/10">
                            <Music className="w-16 h-16 text-white/40 mb-6" />
                            <p className="text-white/70 mb-6 text-center max-w-xs truncate">{previewResource.name}</p>
                            <audio src={previewResource.url} controls autoPlay className="w-80" />
                          </div>
                        ) : (
                          <div className="p-10 flex flex-col items-center justify-center bg-background/5 backdrop-blur rounded-2xl border border-white/10">
                            <File className="w-16 h-16 text-white/40 mb-6" />
                            <p className="text-white/70 mb-6 text-center max-w-xs truncate">{previewResource.name}</p>
                            <button
                              onClick={async () => {
                                try {
                                  const response = await fetch(previewResource.url)
                                  const blob = await response.blob()
                                  const url = window.URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = previewResource.name
                                  document.body.appendChild(a)
                                  a.click()
                                  document.body.removeChild(a)
                                  window.URL.revokeObjectURL(url)
                                } catch (err) {
                                  console.error('下载失败:', err)
                                }
                              }}
                              className="px-6 py-3 bg-background text-foreground rounded-xl hover:bg-muted transition-colors font-medium flex items-center gap-2"
                            >
                              <Download className="w-4 h-4" />
                              下载文件
                            </button>
                          </div>
                        )}
                      </motion.div>

                      <motion.p 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-xs"
                      >
                        {previewResource.type === 'image' ? '点击图片在新窗口打开原图' : '按 ESC 或点击空白处关闭'}
                      </motion.p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ==================== STICKERS ==================== */}
            {activeTab === "stickers" && (
              <div className="p-5 space-y-4">
                {/* Filter Tabs */}
                {stickerPacks.length > 0 && (
                  <div className="flex items-center gap-0.5 px-1">
                    {[
                      { id: 'all', label: `全部 ${getStickerPacksStats().total}` },
                      { id: 'favorite', label: `收藏 ${getStickerPacksStats().favorite_emoji}` },
                      { id: 'market', label: `市场 ${getStickerPacksStats().market_pack}` },
                      { id: 'system', label: `系统 ${getStickerPacksStats().system_pack}` },
                    ].map(tab => {
                      const isActive = stickerFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setStickerFilter(tab.id as typeof stickerFilter)}
                          className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                            isActive 
                              ? 'bg-black/[0.05] dark:bg-white/[0.05] text-foreground font-medium' 
                              : 'text-muted-foreground/60 hover:text-muted-foreground'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sticker Packs List */}
                {stickerPacks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Smile className="w-8 h-8 text-muted-foreground/20 mb-3" />
                    <p className="text-[13px] text-foreground font-medium">暂无表情包</p>
                    <p className="text-[12px] text-muted-foreground/60 mt-1">点击刷新按钮加载表情包数据</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {stickerPacks
                      .filter(pack => {
                        if (stickerFilter === 'all') return true;
                        if (stickerFilter === 'favorite') return pack.packType === 'favorite_emoji';
                        if (stickerFilter === 'market') return pack.packType === 'market_pack';
                        if (stickerFilter === 'system') return pack.packType === 'system_pack';
                        return true;
                      })
                      .map((pack) => (
                        <div
                          key={pack.packId}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors group"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-[13px] font-medium text-foreground truncate">
                              {pack.packName}
                            </span>
                            <span className="text-[11px] text-muted-foreground/40 flex-shrink-0">
                              {pack.stickerCount} 个
                            </span>
                            <span className="text-[10px] text-muted-foreground/40 bg-black/[0.03] dark:bg-white/[0.03] px-1.5 py-0.5 rounded flex-shrink-0">
                              {pack.packType === 'favorite_emoji' ? '收藏' : 
                               pack.packType === 'market_pack' ? '市场' : '系统'}
                            </span>
                          </div>
                          <button
                            className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors flex-shrink-0 ml-4 opacity-0 group-hover:opacity-100"
                            onClick={() => handleExportStickerPack(pack.packId, pack.packName)}
                            disabled={stickerPacksLoading}
                          >
                            导出
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                {/* Export History */}
                {stickerExportRecords.length > 0 && (
                  <div id="sticker-export-history" className="space-y-2 pt-2">
                    <h3 className="text-[12px] font-medium text-muted-foreground/50 px-1">导出记录</h3>
                    <div className="space-y-0.5">
                      {stickerExportRecords.slice(0, 5).map((record) => (
                        <div
                          key={record.id}
                          className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-foreground truncate">
                                {record.packName || '全部导出'}
                              </span>
                              {!record.success && (
                                <span className="text-[10px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                                  失败
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground/40">
                              <span>{record.stickerCount} 个表情</span>
                              <span className="text-muted-foreground/20">·</span>
                              <span>{new Date(record.exportTime).toLocaleDateString()}</span>
                            </div>
                          </div>
                          {record.success && record.exportPath && (
                            <button
                              className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                              onClick={() => {
                                navigator.clipboard.writeText(record.exportPath)
                                addNotification('success', '已复制', '路径已复制到剪贴板')
                              }}
                            >
                              复制路径
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== SETTINGS ==================== */}
            {activeTab === "settings" && (
              <SettingsPanel />
            )}

            {/* ==================== ABOUT ==================== */}
            {activeTab === "about" && (
              <div className="p-6 max-w-2xl space-y-8">
                <div className="space-y-4">
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight text-foreground">QQ 聊天记录导出工具</h1>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    简单高效的聊天记录导出解决方案
                  </p>
                </div>

                {/* NapCat Tribute */}
                <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-5 flex items-start gap-6">
                  <div className="space-y-3 flex-1">
                    <h2 className="text-base font-medium text-foreground">致谢 NapCat</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      感谢 NapCat 提供了访问 QQ 客户端数据的能力，让我们能够读取和导出聊天记录。
                    </p>
                  </div>
                  <img 
                    src="https://napneko.github.io/assets/logos/napcat_8.png" 
                    alt="NapCat" 
                    className="w-24 h-36 object-contain flex-shrink-0"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <Button 
                    onClick={() => window.open('https://github.com/shuakami/qq-chat-exporter', '_blank')}
                    className="rounded-full"
                  >
                    <Star className="w-4 h-4 mr-1.5" />
                    Star on GitHub
                  </Button>
                  <Button 
                    onClick={() => window.open('https://napneko.github.io/', '_blank')}
                    variant="outline"
                    className="rounded-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-1.5" />
                    了解 NapCat
                  </Button>
                </div>

                {/* Legal */}
                <div className="space-y-3 pt-5 border-t border-black/[0.06] dark:border-white/[0.06]">
                  <h3 className="text-base font-medium text-foreground">使用声明</h3>
                  <div className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                    <p>
                      本工具仅供学习和个人使用，请勿用于商业用途。请遵守相关法律法规和平台服务条款。
                    </p>
                    <p>
                      <strong>反倒卖声明：</strong>本项目完全开源免费，任何个人或组织不得将此工具进行商业销售或倒卖。
                    </p>
                    <p className="text-muted-foreground/60">
                      如果这个工具对你有帮助，请在 GitHub 上给我们一个 Star ⭐
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        </div>
      </div>

      {/* Modals */}
      <TaskWizard
        isOpen={isTaskWizardOpen}
        onClose={handleCloseTaskWizard}
        onSubmit={handleCreateTask}
        isLoading={isLoading}
        prefilledData={selectedPreset}
        groups={groups}
        friends={friends}
        onLoadData={loadChatData}
        onPreview={(chat) => {
          setPreviewingChat(chat)
          setIsPreviewModalOpen(true)
        }}
        onExportAvatars={handleExportGroupAvatars}
        avatarExportLoading={avatarExportLoading}
      />

      <ScheduledExportWizard
        isOpen={isScheduledExportWizardOpen}
        onClose={handleCloseScheduledExportWizard}
        onSubmit={async (form) => {
          await createScheduledExport(form)
          return true
        }}
        isLoading={scheduledLoading}
        prefilledData={selectedScheduledPreset}
        groups={groups}
        friends={friends}
        onLoadData={loadChatData}
      />

      {selectedHistoryTask && (
        <ExecutionHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={handleCloseHistoryModal}
          scheduledExportId={selectedHistoryTask.id}
          taskName={selectedHistoryTask.name}
          onGetHistory={getExecutionHistory}
        />
      )}

      <MessagePreviewModal
        open={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        chat={previewingChat}
        onExport={(peer, timeRange) => {
          handleOpenTaskWizard({
            chatType: peer.chatType,
            peerUid: peer.peerUid,
            sessionName: previewingChat?.name,
            startTime: timeRange?.startTime?.toString(),
            endTime: timeRange?.endTime?.toString()
          })
        }}
      />

      <BatchExportDialog
        open={isBatchExportDialogOpen}
        onOpenChange={setIsBatchExportDialogOpen}
        items={getBatchExportItems()}
        onExport={handleBatchExport}
      />

      <ScheduledBackupMergeDialog
        open={isScheduledMergeDialogOpen}
        onOpenChange={setIsScheduledMergeDialogOpen}
        scheduledTasks={scheduledTasks}
        onMerge={handleScheduledMerge}
      />

      {/* 群精华消息模态框 */}
      {essenceGroup && (
        <GroupEssenceModal
          isOpen={isEssenceModalOpen}
          onClose={handleCloseEssenceModal}
          groupCode={essenceGroup.groupCode}
          groupName={essenceGroup.groupName}
          onOpenFileLocation={openFileLocation}
          onNotification={addNotification}
        />
      )}

      {/* 群文件/群相册模态框 */}
      {groupFilesTarget && (
        <GroupFilesModal
          isOpen={isGroupFilesModalOpen}
          onClose={handleCloseGroupFilesModal}
          groupCode={groupFilesTarget.groupCode}
          groupName={groupFilesTarget.groupName}
          onNotification={addNotification}
        />
      )}

      {/* 聊天记录预览模态框 */}
      <AnimatePresence>
        {isFilePathModalOpen && selectedFile && (() => {
          const fileName = selectedFile.fileName.toLowerCase()
          const isHtml = fileName.endsWith('.html') || fileName.endsWith('.htm')
          const isJson = fileName.endsWith('.json')
          const isZip = fileName.endsWith('.zip')
          const isJsonl = fileName.includes('_chunked_jsonl') || fileName.includes('jsonl')
          const fileSize = selectedFile.size || 0
          const isLargeFile = fileSize > 15 * 1024 * 1024
          const canPreview = (isHtml || isJson) && !isLargeFile && !isZip && !isJsonl
          
          const formatSize = (bytes: number) => {
            if (bytes === 0) return '0 B'
            const sizes = ['B', 'KB', 'MB', 'GB']
            const i = Math.floor(Math.log(bytes) / Math.log(1024))
            return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i]
          }

          return (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-50"
                onClick={() => setIsFilePathModalOpen(false)}
              />
              {canPreview ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-4 bg-background rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
                >
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{selectedFile.sessionName}</span>
                      <Badge variant="outline" className="text-xs">HTML</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        onClick={() => {
                          const link = document.createElement('a')
                          link.href = `/api/exports/files/${selectedFile.fileName}`
                          link.download = selectedFile.fileName
                          link.click()
                        }}
                      >
                        <Download className="w-4 h-4 mr-1.5" />
                        下载
                      </Button>
                      <button
                        onClick={() => setIsFilePathModalOpen(false)}
                        className="p-2 text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <iframe
                      src={`/api/exports/files/${selectedFile.fileName}/preview`}
                      className="w-full h-full border-0"
                      title={`预览 ${selectedFile.sessionName}`}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-background rounded-2xl shadow-2xl z-50 overflow-hidden"
                >
                  <div className="p-8 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
                      {isZip ? <Package className="w-8 h-8 text-muted-foreground/70" /> :
                       isJsonl ? <Database className="w-8 h-8 text-muted-foreground/70" /> :
                       <FileText className="w-8 h-8 text-muted-foreground/70" />}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {selectedFile.sessionName}
                    </h3>
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <Badge variant="outline">
                        {isZip ? 'ZIP' : isJsonl ? 'JSONL' : isJson ? 'JSON' : 'FILE'}
                      </Badge>
                      {fileSize > 0 && (
                        <span className="text-sm text-muted-foreground">{formatSize(fileSize)}</span>
                      )}
                    </div>
                    
                    <p className="text-muted-foreground mb-6">
                      {isZip || isJsonl ? (
                        '此格式不支持在线预览，请下载后查看'
                      ) : isLargeFile ? (
                        '文件较大，建议下载后用专业编辑器打开'
                      ) : (
                        '此格式不支持在线预览'
                      )}
                    </p>

                    <div className="space-y-3">
                      <Button
                        className="w-full rounded-xl"
                        onClick={() => {
                          const link = document.createElement('a')
                          link.href = `/api/exports/files/${selectedFile.fileName}`
                          link.download = selectedFile.fileName
                          link.click()
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        下载文件
                      </Button>
                      
                      {(isJson || isJsonl || isLargeFile) && (
                        <div className="pt-3 border-t border-border">
                          <p className="text-xs text-muted-foreground/70 mb-3">推荐使用以下编辑器打开</p>
                          <div className="flex gap-2 justify-center">
                            <a
                              href="https://code.visualstudio.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                              VS Code
                            </a>
                            <a
                              href="https://zed.dev/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                              Zed
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="px-6 py-4 border-t border-border bg-muted">
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => setIsFilePathModalOpen(false)}
                    >
                      关闭
                    </Button>
                  </div>
                </motion.div>
              )}
            </>
          )
        })()}
      </AnimatePresence>

      {/* HTML 导出帮助模态框 */}
      <AnimatePresence>
        {showHtmlHelp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowHtmlHelp(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-background rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h3 className="font-medium text-foreground">HTML 导出</h3>
                  <p className="text-xs text-muted-foreground">可视化聊天记录</p>
                </div>
                <button
                  onClick={() => setShowHtmlHelp(false)}
                  className="p-2 text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">适合什么场景？</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    HTML 格式导出的聊天记录可以直接用浏览器打开查看，保留原始的对话样式，适合回顾和分享。
                  </p>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">怎么用？</h4>
                  <ol className="text-sm text-muted-foreground space-y-2">
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">1.</span>
                      <span>导出完成后，在导出目录找到 .html 文件</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">2.</span>
                      <span>双击用浏览器打开即可查看</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">3.</span>
                      <span>图片等资源在同目录的 resources 文件夹</span>
                    </li>
                  </ol>
                </div>

                <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 dark:bg-amber-950/30 dark:border-amber-900/60">
                  <p className="text-xs text-amber-700 dark:text-amber-200">
                    注意：不要单独移动 HTML 文件，需要和 resources 文件夹放在一起，图片才能正常显示。
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border bg-muted">
                <Button className="w-full" onClick={() => setShowHtmlHelp(false)}>
                  知道了
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* JSON 导出帮助模态框 */}
      <AnimatePresence>
        {showJsonHelp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowJsonHelp(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-background rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h3 className="font-medium text-foreground">JSON 导出</h3>
                  <p className="text-xs text-muted-foreground">结构化数据格式</p>
                </div>
                <button
                  onClick={() => setShowJsonHelp(false)}
                  className="p-2 text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">适合什么场景？</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    JSON 是通用的数据格式，适合程序处理、数据分析、导入其他工具或二次开发。
                  </p>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">可以做什么？</h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>用 Python、Node.js 等脚本分析聊天数据</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>导入数据库做统计查询</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>转换成其他格式（如 Excel、CSV）</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>作为 AI 训练语料</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-muted border border-border">
                  <p className="text-xs text-muted-foreground">
                    JSON 文件可以用任何文本编辑器打开查看，推荐使用 VS Code 等支持语法高亮的编辑器。
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border bg-muted">
                <Button className="w-full" onClick={() => setShowJsonHelp(false)}>
                  知道了
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* JSONL 分块导出帮助模态框 */}
      <AnimatePresence>
        {showJsonlHelp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowJsonlHelp(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-background rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h3 className="font-medium text-foreground">JSONL 分块导出</h3>
                  <p className="text-xs text-muted-foreground">适合大规模数据处理</p>
                </div>
                <button
                  onClick={() => setShowJsonlHelp(false)}
                  className="p-2 text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">这是什么？</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    JSONL（JSON Lines）格式把聊天记录拆成多个小文件，每个文件包含几千条消息。适合处理几十万甚至上百万条消息的超大群聊。
                  </p>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">文件结构</h4>
                  <div className="rounded-xl bg-neutral-900 p-4 font-mono text-xs text-neutral-300 overflow-x-auto">
                    <div className="text-muted-foreground">导出目录/</div>
                    <div className="pl-4">├── chunk_001.jsonl</div>
                    <div className="pl-4">├── chunk_002.jsonl</div>
                    <div className="pl-4">├── chunk_003.jsonl</div>
                    <div className="pl-4 text-muted-foreground">└── ...</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">怎么用？</h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>用 Python、Node.js 等脚本逐行读取处理</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>导入数据库做分析统计</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-muted-foreground/70">•</span>
                      <span>训练 AI 模型的语料数据</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-muted border border-border">
                  <p className="text-xs text-muted-foreground">
                    每个 .jsonl 文件的每一行都是一条独立的 JSON 消息，可以流式读取，不用一次性加载到内存。
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border bg-muted flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (helpFilePath) {
                      openFileLocation(helpFilePath)
                    } else {
                      openExportDirectory()
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  {helpFilePath ? '打开文件位置' : '打开导出目录'}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => setShowJsonlHelp(false)}
                >
                  知道了
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 流式 ZIP 导出帮助模态框 */}
      <AnimatePresence>
        {showStreamingZipHelp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowStreamingZipHelp(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-background rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h3 className="font-medium text-foreground">流式 HTML ZIP 导出</h3>
                  <p className="text-xs text-muted-foreground">分块 HTML + 资源打包</p>
                </div>
                <button
                  onClick={() => setShowStreamingZipHelp(false)}
                  className="p-2 text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">这是什么？</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    流式 ZIP 把聊天记录导出成分块的 HTML 格式，每块约 2000 条消息，然后连同图片等资源一起打包成 ZIP。适合超大群聊，边导出边写入，不会爆内存。
                  </p>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">ZIP 里有什么？</h4>
                  <div className="rounded-xl bg-neutral-900 p-4 font-mono text-xs text-neutral-300 overflow-x-auto">
                    <div className="text-muted-foreground">xxx_streaming.zip/</div>
                    <div className="pl-4">├── index.html <span className="text-muted-foreground">（主页面，直接打开）</span></div>
                    <div className="pl-4">├── assets/ <span className="text-muted-foreground">（样式和脚本）</span></div>
                    <div className="pl-4">├── data/</div>
                    <div className="pl-8">├── manifest.js <span className="text-muted-foreground">（清单）</span></div>
                    <div className="pl-8">├── chunks/ <span className="text-muted-foreground">（分块消息）</span></div>
                    <div className="pl-8 text-muted-foreground">└── index/ （消息索引）</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">怎么用？</h4>
                  <ol className="text-sm text-muted-foreground space-y-2">
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">1.</span>
                      <span>解压 ZIP 文件到任意文件夹</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">2.</span>
                      <span>双击打开 index.html</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-medium text-muted-foreground">3.</span>
                      <span>页面会自动加载分块数据，支持搜索和跳转</span>
                    </li>
                  </ol>
                </div>

                <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 dark:bg-amber-950/30 dark:border-amber-900/60">
                  <p className="text-xs text-amber-700 dark:text-amber-200">
                    注意：必须解压后才能正常查看，不要直接在压缩软件里打开 HTML。
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-border bg-muted flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (helpFilePath) {
                      openFileLocation(helpFilePath)
                    } else {
                      openExportDirectory()
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  {helpFilePath ? '打开文件位置' : '打开导出目录'}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => setShowStreamingZipHelp(false)}
                >
                  知道了
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>



      {/* 新手引导 */}
      {showOnboarding && (() => {
        // step 0: 欢迎模态框
        // step 1: 指向「会话」
        // step 2: 在会话页，提示点击导出按钮
        // step 3: 指向「任务」看进度
        // step 4: 指向「聊天记录」查看文件
        
        // 欢迎模态框
        if (onboardingStep === 0) {
          return (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={onboardingTransition}
                className="fixed inset-0 z-[100] bg-black/34 backdrop-blur-md" 
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.96, y: 18, filter: "blur(16px)" }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                transition={onboardingTransition}
                className="fixed left-1/2 top-1/2 z-[101] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-black/[0.08] bg-background/95 p-6 shadow-[0_28px_110px_rgba(15,23,42,0.28)] backdrop-blur-2xl dark:border-white/[0.08]"
              >
                <h2 className="text-xl font-medium text-foreground mb-2">欢迎使用</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  QQ Chat Exporter 可以导出你的聊天记录。<br/>
                  花 30 秒了解一下基本操作？
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      localStorage.setItem("qce-onboarding-completed", "true")
                      setShowOnboarding(false)
                      setHighlightedNav(null)
                    }}
                    className="flex-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    跳过
                  </button>
                  <button
                    onClick={() => { setOnboardingStep(1); setHighlightedNav("sessions"); }}
                    className="flex-1 rounded-full border border-black/[0.08] bg-foreground py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/88 dark:border-white/[0.08]"
                  >
                    开始
                  </button>
                </div>
              </motion.div>
            </>
          )
        }
        
        // 指向「会话」
        if (onboardingStep === 1) {
          const position = getAnchoredOnboardingPosition('nav-sessions', 280)
          const targetEl = typeof document !== 'undefined' ? document.getElementById('nav-sessions') : null
          if (!position || !targetEl) return null
          
          return (
            <motion.div 
              className="fixed z-[100]"
              initial={{ opacity: 0, scale: 0.96, y: 12, filter: "blur(12px)" }}
              animate={{ left: position.left, top: position.top, opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              transition={onboardingTransition}
            >
              <div className={onboardingPanelClass} style={{ width: 280 }}>
                <p className="text-sm font-medium mb-1">第 1 步：打开会话列表</p>
                <p className="text-muted-foreground text-xs mb-3">点击「会话」查看所有群聊和好友</p>
                <button
                  onClick={() => {
                    targetEl?.click()
                    setOnboardingStep(2)
                    setHighlightedNav(null)
                  }}
                  className={onboardingPrimaryButtonClass}
                >
                  点击前往
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                    setHighlightedNav(null)
                  }}
                  className={`${onboardingSecondaryButtonClass} mt-2`}
                >
                  跳过引导
                </button>
              </div>
            </motion.div>
          )
        }
        
        // 在会话页，提示点击导出
        if (onboardingStep === 2 && activeTab === 'sessions') {
          const position = getBottomOnboardingPosition(340)
          if (!position) return null

          return (
            <motion.div
              className="fixed z-[100]"
              initial={{ opacity: 0, scale: 0.96, y: 18, filter: "blur(12px)" }}
              animate={{ left: position.left, top: position.top, opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              transition={onboardingTransition}
            >
              <div className={onboardingPanelClass} style={{ width: 340 }}>
                <p className="text-sm font-medium mb-1">第 2 步：选择并导出</p>
                <p className="text-muted-foreground text-xs mb-3">
                  在列表中找到想导出的群聊或好友，点击右侧的「导出」按钮
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                    setHighlightedNav(null)
                  }}
                    className="flex-1 rounded-full px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    我知道了
                  </button>
                  <button
                    onClick={() => { setOnboardingStep(3); setHighlightedNav("tasks"); }}
                    className="flex-1 rounded-full border border-black/[0.08] bg-foreground px-4 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/88 dark:border-white/[0.08]"
                  >
                    下一步
                  </button>
                </div>
              </div>
            </motion.div>
          )
        }
        
        // 指向「任务」看进度
        if (onboardingStep === 3) {
          const position = getAnchoredOnboardingPosition('nav-tasks', 280)
          if (!position) return null
          
          return (
            <motion.div 
              className="fixed z-[100]"
              initial={{ opacity: 0, scale: 0.96, y: 12, filter: "blur(12px)" }}
              animate={{ left: position.left, top: position.top, opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              transition={onboardingTransition}
            >
              <div className={onboardingPanelClass} style={{ width: 280 }}>
                <p className="text-sm font-medium mb-1">第 3 步：查看导出进度</p>
                <p className="text-muted-foreground text-xs mb-3">
                  在「任务」页面可以看到导出进度和状态
                </p>
                <button
                  onClick={() => { setOnboardingStep(4); setHighlightedNav("history"); }}
                  className={onboardingPrimaryButtonClass}
                >
                  下一步
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                    setHighlightedNav(null)
                  }}
                  className={`${onboardingSecondaryButtonClass} mt-2`}
                >
                  跳过引导
                </button>
              </div>
            </motion.div>
          )
        }
        
        // 指向「聊天记录」查看文件
        if (onboardingStep === 4) {
          const position = getAnchoredOnboardingPosition('nav-history', 300)
          if (!position) return null
          
          return (
            <motion.div 
              className="fixed z-[100]"
              initial={{ opacity: 0, scale: 0.96, y: 12, filter: "blur(12px)" }}
              animate={{ left: position.left, top: position.top, opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              transition={onboardingTransition}
            >
              <div className={onboardingPanelClass} style={{ width: 300 }}>
                <p className="text-sm font-medium mb-1">第 4 步：查看导出文件</p>
                <p className="text-muted-foreground text-xs mb-3">
                  导出完成后，在「聊天记录」可以查看、下载、预览所有文件
                </p>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                    setHighlightedNav(null)
                  }}
                  className={onboardingPrimaryButtonClass}
                >
                  完成
                </button>
              </div>
            </motion.div>
          )
        }
        
        return null
      })()}
    </div>
  )
}
