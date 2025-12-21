"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { TaskWizard } from "@/components/ui/task-wizard"
import { ScheduledExportWizard } from "@/components/ui/scheduled-export-wizard"
import { ExecutionHistoryModal } from "@/components/ui/execution-history-modal"
import { MessagePreviewModal } from "@/components/ui/message-preview-modal"
import { BatchExportDialog, type BatchExportItem, type BatchExportConfig } from "@/components/ui/batch-export-dialog"
import { ScheduledBackupMergeDialog } from "@/components/ui/scheduled-backup-merge-dialog"
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
  AlertCircle,
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
} from "lucide-react"
import type { CreateTaskForm, CreateScheduledExportForm } from "@/types/api"
import { useQCE } from "@/hooks/use-qce"
import { useScheduledExports } from "@/hooks/use-scheduled-exports"
import { useChatHistory } from "@/hooks/use-chat-history"
import { useStickerPacks } from "@/hooks/use-sticker-packs"
import { useResourceIndex } from "@/hooks/use-resource-index"

import { ThemeToggle } from "@/components/qce-dashboard/theme-toggle"
// ✨ 动效核心：统一的 Bezier 曲线与时长
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { EASE, DUR, makeStagger, hoverLift, fadeSlide, toastAnim, statusPulse } from "@/components/qce-dashboard/animations"

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
  const [showStarToast, setShowStarToast] = useState(false)
  const [isFilePathModalOpen, setIsFilePathModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ filePath: string; sessionName: string; fileName: string; size?: number } | null>(null)
  const [notifications, setNotifications] = useState<Array<{
    id: string
    type: 'success' | 'error' | 'info'
    title: string
    message: string
    actions?: Array<{
      label: string
      onClick: () => void
      variant?: 'default' | 'destructive'
    }>
  }>>([])
  
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
  
  const tasksLoadedRef = useRef(false)
  const scheduledExportsLoadedRef = useRef(false)
  const chatHistoryLoadedRef = useRef(false)
  const stickerPacksLoadedRef = useRef(false)
  const previousTasksRef = useRef<typeof tasks>([])  // 跟踪任务状态变化

  // 是否偏好降级动画
  const reduceMotion = useReducedMotion() ?? false

  const setActiveTab = (tabId: string) => {
    setActiveTabState(tabId)
    if (typeof window !== "undefined") {
      localStorage.setItem("qce-active-tab", tabId)
    }
  }

  useEffect(() => {
      if (typeof window !== "undefined") {
        const savedTab = localStorage.getItem("qce-active-tab")
        if (savedTab && ["overview", "sessions", "tasks", "scheduled", "history", "stickers", "about"].includes(savedTab)) {
          setActiveTabState(savedTab)
        }
        // 检查是否需要显示新手引导
        const hasSeenOnboarding = localStorage.getItem("qce-onboarding-completed")
        if (!hasSeenOnboarding) {
          setShowOnboarding(true)
        }
      }
  }, [])

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
  } = useQCE({
    onNotification: (notification) => {
      setNotifications(prev => [...prev, { id: Date.now().toString(), ...notification }])
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
        addNotification('error', '打开失败', data.error || '未知错误')
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
        addNotification('error', '打开失败', data.error || '未知错误')
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

  const addNotification = (type: 'success' | 'error' | 'info', title: string, message: string, actions?: Array<{ label: string; onClick: () => void; variant?: 'default' | 'destructive' }>, duration?: number) => {
    const id = Date.now().toString()
    setNotifications(prev => [...prev, { id, type, title, message, actions }])
    const autoCloseDuration = duration ?? 5000
    if (autoCloseDuration > 0) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id))
      }, autoCloseDuration)
    }
    return id
  }

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
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

  const handleSelectAll = () => {
    const allIds = new Set<string>()
    groups.forEach(g => allIds.add(`group_${g.groupCode}`))
    friends.forEach(f => allIds.add(`friend_${f.uid}`))
    setSelectedItems(allIds)
  }

  const handleClearSelection = () => {
    setSelectedItems(new Set())
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
          items.push({
            type: 'friend',
            id: friend.uid,
            name: friend.remark || friend.nick,
            chatType: 1,
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
          includeSystemMessages: true,
          filterPureImageMessages: !config.downloadMedia,
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

    // 显示通知
    const successCount = results.filter(r => r.status === 'success').length
    const failedCount = results.filter(r => r.status === 'failed').length
    
    if (failedCount === 0) {
      addNotification('success', '批量导出完成', `成功创建 ${successCount} 个导出任务`)
    } else if (successCount === 0) {
      addNotification('error', '批量导出失败', `所有 ${failedCount} 个任务都失败了`)
    } else {
      addNotification('info', '批量导出部分完成', `成功 ${successCount} 个，失败 ${failedCount} 个`)
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

  // 监听任务完成，显示 Star toast
  useEffect(() => {
    const previousTasks = previousTasksRef.current
    const currentTasks = tasks

    const newlyCompletedTasks = currentTasks.filter(currentTask => {
      const previousTask = previousTasks.find(prevTask => prevTask.id === currentTask.id)
      return currentTask.status === "completed" && previousTask && previousTask.status !== "completed"
    })

    if (newlyCompletedTasks.length > 0) {
      setShowStarToast(true)
      setTimeout(() => setShowStarToast(false), 10000)
    }

    previousTasksRef.current = currentTasks
  }, [tasks])

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-sidebar to-background dark:bg-background dark:from-background dark:to-background">
      {/* Header */}
      <motion.div
        className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b border-border"
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: DUR.normal, ease: EASE.out } }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between h-16">
          {/* Navigation */}
          <nav className="flex gap-8">
            {[
              ["overview", "概览"],
              ["sessions", "会话"],
              ["tasks", "任务"],
              ["scheduled", "定时"],
              ["history", "聊天记录"],
              ["stickers", "表情包"],
              ["about", "关于"]
            ].map(([id, label]) => (
              <motion.button
                key={id}
                id={`nav-${id}`}
                onClick={() => setActiveTab(id)}
                className={`text-sm transition-all duration-300 ${
                  activeTab === id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                whileTap={{ scale: 0.98, transition: { duration: DUR.fast, ease: EASE.inOut } }}
              >
                <span
                  className={`inline-block pb-1 border-b ${
                    activeTab === id ? "border-foreground" : "border-transparent"
                  } transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]`}
                >
                  {label}
                </span>
              </motion.button>
            ))}
            <motion.a
              href="https://sdjz.wiki/post/qce%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center gap-1"
              whileTap={{ scale: 0.98, transition: { duration: DUR.fast, ease: EASE.inOut } }}
            >
              <span className="inline-block pb-1 border-b border-transparent">
                文档
              </span>
            </motion.a>
          </nav>
          
          {/* GitHub Star */}
                    <div className="flex items-center gap-2">
            <ThemeToggle />
            <motion.a
            href="https://github.com/shuakami/qq-chat-exporter"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg className="w-4 h-4 text-primary-foreground" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <span className="text-primary-foreground font-medium">
              {githubStars !== null ? (githubStars >= 1000 ? `${(githubStars / 1000).toFixed(1)}k` : githubStars) : 'Star'}
            </span>
          </motion.a>
          </div>
        </div>
      </motion.div>

      {/* Toasts */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-border bg-background/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            {...toastAnim}
          >
            <button 
              onClick={() => setError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-border bg-muted p-2.5">
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-foreground">发生错误</h3>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {scheduledError && (
          <motion.div
            key="scheduled-error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-border bg-background/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: error ? '140px' : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setScheduledError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-border bg-muted p-2.5">
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-foreground">定时任务错误</h3>
                <p className="mt-1 text-sm text-muted-foreground">{scheduledError}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chatHistoryError && (
          <motion.div
            key="chat-history-error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-border bg-background/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: (error || scheduledError) ? (error && scheduledError ? '280px' : '140px') : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setChatHistoryError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-border bg-muted p-2.5">
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-foreground">聊天记录错误</h3>
                <p className="mt-1 text-sm text-muted-foreground">{chatHistoryError}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStarToast && (
          <motion.div
            key="star-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: (error || scheduledError || chatHistoryError) ? 
              (Number(!!error) + Number(!!scheduledError) + Number(!!chatHistoryError)) === 3 ? '420px' :
              (Number(!!error) + Number(!!scheduledError) + Number(!!chatHistoryError)) === 2 ? '280px' :
              '140px' : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setShowStarToast(false)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-yellow-200 bg-yellow-50 p-2.5 dark:border-yellow-900/60 dark:bg-yellow-950/30">
                <Star className="w-5 h-5 text-yellow-600 fill-current" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-foreground">兄弟....</h3>
                <p className="mt-1 text-sm text-muted-foreground">如果有帮助到你，给我点个 Star 吧喵</p>
                <motion.button
                  onClick={() => window.open('https://github.com/shuakami/qq-chat-exporter', '_blank')}
                  className="mt-3 flex items-center gap-2 rounded-full bg-yellow-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600"
                  whileHover={{ y: -1, transition: { duration: DUR.fast, ease: EASE.out } }}
                  whileTap={{ scale: 0.98, transition: { duration: DUR.fast, ease: EASE.inOut } }}
                >
                  <Star className="w-4 h-4 fill-current" />
                  前往 GitHub
                  <ExternalLink className="w-3 h-3" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification Cards */}
      <div className={`fixed right-6 z-[200] space-y-3 pointer-events-none transition-all duration-300 ${
        showStarToast ? 'bottom-[180px]' : 'bottom-6'
      }`}>
        <AnimatePresence>
          {notifications.map((notification, index) => (
            <motion.div
              key={notification.id}
              className="w-full max-w-sm rounded-2xl border border-border bg-background/95 p-4 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg pointer-events-auto"
              style={{ marginBottom: index > 0 ? '12px' : 0 }}
              {...toastAnim}
            >
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-3 pr-8">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{notification.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{notification.message}</p>
                  {notification.actions && notification.actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {notification.actions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            action.onClick()
                            setNotifications(prev => prev.filter(n => n.id !== notification.id))
                          }}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                            action.variant === 'destructive' 
                              ? 'bg-red-500 text-white hover:bg-red-600' 
                              : 'bg-neutral-900 text-white hover:bg-neutral-800'
                          }`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main */}
      <main className="px-6 pb-16">
        <div className="max-w-5xl mx-auto">
          {/* 使用 AnimatePresence 做 Tab 内容的进出场 */}
          <AnimatePresence mode="wait">
            {activeTab === "overview" && (
              <motion.div key="tab-overview" {...fadeSlide} className="space-y-10 pt-10">
                {/* Hero */}
                <section className="space-y-4">
                  <motion.h1
                    className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    QQ 聊天记录导出工具
                  </motion.h1>
                  <motion.p
                    className="text-muted-foreground text-lg"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut, delay: 0.05 } }}
                  >
                    轻松备份群聊与好友的珍贵对话，支持多种格式导出
                  </motion.p>
                  <motion.div
                    className="flex flex-wrap gap-3 pt-2"
                    initial="initial"
                    animate="animate"
                    variants={STAG.container}
                  >
                    {[
                      { key: "new", text: "新建任务", onClick: () => handleOpenTaskWizard(), variant: undefined },
                      { key: "browse", text: "浏览会话", onClick: () => setActiveTab("sessions"), variant: "outline" as const },
                      { key: "view", text: "查看任务", onClick: () => setActiveTab("tasks"), variant: "outline" as const },
                    ].map((b, i) => (
                      <motion.div key={b.key} variants={STAG.item}>
                        <Button
                          className="rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                          onClick={b.onClick}
                          variant={b.variant}
                        >
                          {b.text}
                        </Button>
                      </motion.div>
                    ))}
                  </motion.div>
                </section>

                {/* Status Row - 简洁的状态卡片 */}
                <motion.section
                  className="rounded-2xl border border-border bg-background/80 backdrop-blur px-5 py-4"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  <div className="flex items-center justify-between">
                    {/* 左侧：用户信息 */}
                    <div className="flex items-center gap-4">
                      {systemInfo?.napcat.selfInfo ? (
                        <motion.div
                          className="flex items-center gap-3"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                        >
                          <Avatar className="w-10 h-10 border border-border">
                            <AvatarImage src={`http://q.qlogo.cn/g?b=qq&nk=${systemInfo.napcat.selfInfo.uin}&s=100`} />
                            <AvatarFallback className="text-sm">{systemInfo.napcat.selfInfo.nick?.[0] || 'Q'}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium text-foreground">{systemInfo.napcat.selfInfo.nick}</p>
                            <p className="text-xs text-muted-foreground">QQ {systemInfo.napcat.selfInfo.uin}</p>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                          <div className="space-y-1.5">
                            <div className="w-20 h-4 bg-muted rounded animate-pulse" />
                            <div className="w-16 h-3 bg-muted rounded animate-pulse" />
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* 右侧：状态指示器 */}
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <motion.span
                          className={`w-2 h-2 rounded-full ${wsConnected ? "bg-neutral-900" : "bg-red-400"}`}
                          {...(wsConnected ? {} : statusPulse)}
                        />
                        <span className="text-sm text-muted-foreground">{wsConnected ? "已连接" : "未连接"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <motion.span
                          className={`w-2 h-2 rounded-full ${systemInfo?.napcat.online ? "bg-neutral-900" : "bg-amber-400"}`}
                          {...(systemInfo?.napcat.online ? {} : statusPulse)}
                        />
                        <span className="text-sm text-muted-foreground">{systemInfo?.napcat.online ? "QQ在线" : "QQ离线"}</span>
                      </div>
                      <span className="text-xs text-muted-foreground/70 font-mono">v5.0.0</span>
                    </div>
                  </div>
                </motion.section>

                {/* Quick stats */}
                <motion.section
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    {
                      title: "导出任务",
                      value: getTaskStats().total,
                      sub: `进行中 ${getTaskStats().running} · 完成 ${getTaskStats().completed}`,
                    },
                    { title: "群组", value: groups.length },
                    { title: "好友", value: friends.length },
                  ].map((s, idx) => (
                    <motion.div
                      key={idx}
                      className="rounded-2xl border border-border bg-background/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-muted-foreground">{s.title}</p>
                      <div className="mt-2 flex items-baseline gap-3">
                        <span className="text-2xl font-semibold">{s.value}</span>
                        {s.sub && <span className="text-xs text-muted-foreground">{s.sub}</span>}
                      </div>
                    </motion.div>
                  ))}
                </motion.section>

                {/* Recent tasks preview */}
                {tasks.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-medium text-foreground">最近任务</h3>
                      <motion.div whileTap={{ scale: 0.98 }}>
                        <Button
                          variant="ghost"
                          className="rounded-full"
                          onClick={() => setActiveTab("tasks")}
                        >
                          查看全部
                        </Button>
                      </motion.div>
                    </div>
                    <motion.div
                      className="space-y-2"
                      variants={STAG.container}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {tasks.slice(0, 3).map((task) => (
                        <motion.div
                          key={task.id}
                          className="flex items-center justify-between rounded-2xl border border-border bg-background/70 px-4 py-3 hover:bg-background transition"
                          variants={STAG.item}
                          {...hoverLift}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-foreground">{task.sessionName}</p>
                              <Badge
                                variant="outline"
                                className={
                                  task.status === "completed"
                                    ? "rounded-full text-green-700 border-green-200 bg-green-50 dark:text-green-200 dark:border-green-900 dark:bg-green-950/40"
                                    : task.status === "running"
                                    ? "rounded-full text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-200 dark:border-blue-900 dark:bg-blue-950/40"
                                    : task.status === "failed"
                                    ? "rounded-full text-red-700 border-red-200 bg-red-50 dark:text-red-200 dark:border-red-900 dark:bg-red-950/40"
                                    : "rounded-full"
                                }
                              >
                                {getStatusText(task.status)}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount !== undefined && task.messageCount > 0 && (
                                <motion.span
                                  key={task.messageCount}
                                  initial={{ opacity: 0.5 }}
                                  animate={{ opacity: 1 }}
                                >
                                  {task.messageCount.toLocaleString()} 条
                                </motion.span>
                              )}
                              {task.status === "running" && task.progressMessage && (
                                <motion.span
                                  key={task.progressMessage}
                                  className="text-muted-foreground/70"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                >
                                  {task.progressMessage}
                                </motion.span>
                              )}
                            </div>
                          </div>
                          <div className="ml-4 flex items-center gap-2">
                            {task.status === "running" && (
                              <>
                                {/* 进度条 & 数字同步缓动 */}
                                <div className="w-24">
                                  <Progress
                                    value={task.progress}
                                    shimmer={true}
                                    className="w-24 h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                  />
                                </div>
                                <motion.span
                                  key={task.progress}
                                  className="text-xs text-muted-foreground font-medium min-w-[2.5rem] text-right"
                                  initial={{ opacity: 0, y: 2 }}
                                  animate={{ opacity: 1, y: 0, transition: { duration: DUR.fast, ease: EASE.out } }}
                                >
                                  {task.progress}%
                                </motion.span>
                              </>
                            )}
                            {task.status === "completed" && (
                              <>
                                <motion.div whileTap={{ scale: 0.98 }}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-full"
                                    onClick={() => openFileLocation(task.filePath)}
                                    title="打开文件位置"
                                  >
                                    <FolderOpen className="w-3 h-3" />
                                  </Button>
                                </motion.div>
                                <motion.div whileTap={{ scale: 0.98 }}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-full"
                                    onClick={() => downloadTask(task)}
                                  >
                                    <Download className="w-3 h-3 mr-1" />
                                    下载
                                  </Button>
                                </motion.div>
                              </>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  </section>
                )}
              </motion.div>
            )}

            {activeTab === "sessions" && (
              <motion.div key="tab-sessions" {...fadeSlide} className="space-y-10 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">会话管理</h2>
                    <p className="text-muted-foreground mt-1">
                      {batchMode ? `已选择 ${selectedItems.size} 个会话` : '浏览群组与好友，选择要导出的聊天记录'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button onClick={loadChatData} disabled={isLoading} variant="outline" className="rounded-full">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {isLoading ? "加载中..." : "刷新列表"}
                      </Button>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button 
                        onClick={handleToggleBatchMode} 
                        variant={batchMode ? "default" : "outline"} 
                        className="rounded-full"
                      >
                        {batchMode ? "退出批量模式" : "批量导出"}
                      </Button>
                    </motion.div>
                    {batchMode && selectedItems.size > 0 && (
                      <>
                        <motion.div whileTap={{ scale: 0.98 }}>
                          <Button 
                            onClick={handleOpenBatchExportDialog} 
                            className="rounded-full"
                          >
                            导出选中 ({selectedItems.size})
                          </Button>
                        </motion.div>
                        <motion.div whileTap={{ scale: 0.98 }}>
                          <Button 
                            onClick={handleSelectAll} 
                            variant="ghost" 
                            size="sm" 
                            className="rounded-full"
                          >
                            全选
                          </Button>
                        </motion.div>
                        <motion.div whileTap={{ scale: 0.98 }}>
                          <Button 
                            onClick={handleClearSelection} 
                            variant="ghost" 
                            size="sm" 
                            className="rounded-full"
                          >
                            清空
                          </Button>
                        </motion.div>
                      </>
                    )}
                  </div>
                </div>

                {groups.length === 0 && friends.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-border bg-background/60 py-14 text-center"
                    initial={{ opacity: 0, scale: 0.98, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <p className="text-foreground">暂无会话数据</p>
                    <p className="text-muted-foreground mt-1">请确认 QQ 已连接，然后点击 "刷新列表"</p>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Groups */}
                    {groups.length > 0 && (
                      <section className="space-y-3">
                        <h3 className="text-sm font-medium text-foreground">群组（{groups.length}）</h3>
                        <motion.div
                          className="space-y-2"
                          variants={STAG.container}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                        >
                          {groups.map((group, idx) => {
                            const isSelected = selectedItems.has(`group_${group.groupCode}`)
                            return (
                            <motion.div
                              key={group.groupCode}
                              className={[
                                "flex items-center gap-3 rounded-2xl border px-4 py-3 transition",
                                batchMode 
                                  ? isSelected 
                                    ? "border-border bg-muted"
                                    : "border-border bg-background/70 hover:bg-muted cursor-pointer"
                                  : "border-border bg-background/70 hover:bg-muted"
                              ].join(" ")}
                              variants={STAG.item}
                              {...hoverLift}
                              onClick={() => batchMode && handleToggleItem('group', group.groupCode)}
                            >
                              {batchMode && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => handleToggleItem('group', group.groupCode)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                              <Avatar className="w-10 h-10 rounded-xl overflow-hidden">
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                                >
                                  <AvatarImage
                                    src={group.avatarUrl || `https://p.qlogo.cn/gh/${group.groupCode}/${group.groupCode}/640/`}
                                    alt={group.groupName}
                                  />
                                </motion.div>
                                <AvatarFallback className="rounded-xl">
                                  {group.groupName.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-foreground">{group.groupName}</p>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{group.memberCount} 成员</span>
                                  <span className="text-muted-foreground/70">•</span>
                                  <span className="font-mono">{group.groupCode}</span>
                                </div>
                              </div>
                              {!batchMode && (
                                <div className="flex items-center gap-2">
                                  <motion.div whileTap={{ scale: 0.98 }}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="rounded-full h-8"
                                      onClick={() => handlePreviewChat('group', group.groupCode, group.groupName, { chatType: 2, peerUid: group.groupCode })}
                                    >
                                      预览
                                    </Button>
                                  </motion.div>
                                  <motion.div whileTap={{ scale: 0.98 }}>
                                    <Button
                                      size="sm"
                                      className="rounded-full h-8"
                                      onClick={() => handleOpenTaskWizard({
                                        chatType: 2,
                                        peerUid: group.groupCode,
                                        sessionName: group.groupName,
                                      })}
                                    >
                                      导出
                                    </Button>
                                  </motion.div>
                                  <motion.div whileTap={{ scale: 0.98 }}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="rounded-full h-8"
                                      disabled={avatarExportLoading === group.groupCode}
                                      onClick={() => handleExportGroupAvatars(group.groupCode, group.groupName)}
                                    >
                                      {avatarExportLoading === group.groupCode ? '导出中...' : '导出头像'}
                                    </Button>
                                  </motion.div>
                                </div>
                              )}
                            </motion.div>
                            )
                          })}
                        </motion.div>
                      </section>
                    )}

                    {/* Friends */}
                    {friends.length > 0 && (
                      <section className="space-y-3">
                        <h3 className="text-sm font-medium text-foreground">好友（{friends.length}）</h3>
                        <motion.div
                          className="space-y-2"
                          variants={STAG.container}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                        >
                          {friends.map((friend) => {
                            const isSelected = selectedItems.has(`friend_${friend.uid}`)
                            return (
                            <motion.div
                              key={friend.uid}
                              className={[
                                "flex items-center gap-3 rounded-2xl border px-4 py-3 transition",
                                batchMode 
                                  ? isSelected 
                                    ? "border-border bg-muted ring-1 ring-neutral-300" 
                                    : "border-border bg-background/70 hover:bg-background cursor-pointer"
                                  : "border-border bg-background/70 hover:bg-background"
                              ].join(" ")}
                              variants={STAG.item}
                              {...hoverLift}
                              onClick={() => batchMode && handleToggleItem('friend', friend.uid)}
                            >
                              {batchMode && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => handleToggleItem('friend', friend.uid)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                              <Avatar className="w-10 h-10 rounded-xl overflow-hidden">
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                                >
                                  <AvatarImage
                                    src={friend.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${friend.uin}&s=640`}
                                    alt={friend.remark || friend.nick}
                                  />
                                </motion.div>
                                <AvatarFallback className="rounded-xl">
                                  {(friend.remark || friend.nick).charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate font-medium text-foreground">{friend.remark || friend.nick}</p>
                                  {friend.isOnline && (
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-mono">{friend.uin}</span>
                                  {friend.remark && friend.nick !== friend.remark && (
                                    <>
                                      <span className="text-muted-foreground/70">•</span>
                                      <span className="truncate text-muted-foreground">{friend.nick}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {!batchMode && (
                                <div className="flex items-center gap-2">
                                  <motion.div whileTap={{ scale: 0.98 }}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="rounded-full h-8"
                                      onClick={() => handlePreviewChat('friend', friend.uid, friend.remark || friend.nick, { chatType: 1, peerUid: friend.uid })}
                                    >
                                      预览
                                    </Button>
                                  </motion.div>
                                  <motion.div whileTap={{ scale: 0.98 }}>
                                    <Button
                                      size="sm"
                                      className="rounded-full h-8"
                                      onClick={() => handleOpenTaskWizard({
                                        chatType: 1,
                                        peerUid: friend.uid,
                                        sessionName: friend.remark || friend.nick,
                                      })}
                                    >
                                      导出
                                    </Button>
                                  </motion.div>
                                </div>
                              )}
                            </motion.div>
                            )
                          })}
                        </motion.div>
                      </section>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "tasks" && (
              <motion.div key="tab-tasks" {...fadeSlide} className="space-y-10 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">导出任务</h2>
                    <p className="text-muted-foreground mt-1">查看与管理任务，下载完成文件</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.div whileTap={{ scale: 0.98 }} className="relative">
                      <Button 
                        variant="ghost" 
                        className="rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => setShowExportHelpMenu(!showExportHelpMenu)}
                      >
                        <HelpCircle className="w-4 h-4 mr-2" />
                        使用帮助
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
                              initial={{ opacity: 0, y: -8, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -8, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="absolute right-0 top-full mt-2 w-64 bg-background rounded-xl border border-border shadow-lg z-50 overflow-hidden"
                            >
                              <div className="p-2">
                                <button
                                  className="w-full px-3 py-2.5 text-left text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-3"
                                  onClick={() => { setShowExportHelpMenu(false); setShowHtmlHelp(true); }}
                                >
                                  <FileText className="w-4 h-4 text-muted-foreground/70" />
                                  <div>
                                    <div className="font-medium text-foreground">HTML 导出</div>
                                    <div className="text-xs text-muted-foreground/70">可视化聊天记录</div>
                                  </div>
                                </button>
                                <button
                                  className="w-full px-3 py-2.5 text-left text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-3"
                                  onClick={() => { setShowExportHelpMenu(false); setShowJsonHelp(true); }}
                                >
                                  <Database className="w-4 h-4 text-muted-foreground/70" />
                                  <div>
                                    <div className="font-medium text-foreground">JSON 导出</div>
                                    <div className="text-xs text-muted-foreground/70">结构化数据格式</div>
                                  </div>
                                </button>
                                <div className="my-1 border-t border-border" />
                                <button
                                  className="w-full px-3 py-2.5 text-left text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-3"
                                  onClick={() => { setShowExportHelpMenu(false); setShowStreamingZipHelp(true); }}
                                >
                                  <Package className="w-4 h-4 text-muted-foreground/70" />
                                  <div>
                                    <div className="font-medium text-foreground">流式 ZIP</div>
                                    <div className="text-xs text-muted-foreground/70">大规模 HTML 分块打包</div>
                                  </div>
                                </button>
                                <button
                                  className="w-full px-3 py-2.5 text-left text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-3"
                                  onClick={() => { setShowExportHelpMenu(false); setShowJsonlHelp(true); }}
                                >
                                  <Database className="w-4 h-4 text-muted-foreground/70" />
                                  <div>
                                    <div className="font-medium text-foreground">JSONL 分块</div>
                                    <div className="text-xs text-muted-foreground/70">大规模数据处理</div>
                                  </div>
                                </button>
                              </div>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button onClick={handleLoadTasks} disabled={isLoading} variant="outline" className="rounded-full">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {isLoading ? "加载中..." : "刷新列表"}
                      </Button>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button onClick={() => handleOpenTaskWizard()} className="rounded-full">
                        新建任务
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {tasks.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-border bg-background/60 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <p className="text-foreground">暂无导出任务</p>
                    <p className="text-muted-foreground mt-1">从「会话」中选择一个会话来创建任务，或点击右上角「新建任务」</p>
                  </motion.div>
                ) : (
                  <motion.div
                    className="space-y-3"
                    variants={STAG.container}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    {tasks.map((task) => (
                      <motion.div
                        key={task.id}
                        className="rounded-2xl border border-border bg-background/70 px-5 py-4 hover:bg-background transition"
                        variants={STAG.item}
                        {...hoverLift}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate font-medium text-foreground">{task.sessionName}</h3>
                              <Badge
                                variant="outline"
                                className={
                                  task.status === "completed"
                                    ? "rounded-full text-green-700 border-green-200 bg-green-50 dark:text-green-200 dark:border-green-900 dark:bg-green-950/40"
                                    : task.status === "running"
                                    ? "rounded-full text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-200 dark:border-blue-900 dark:bg-blue-950/40"
                                    : task.status === "failed"
                                    ? "rounded-full text-red-700 border-red-200 bg-red-50 dark:text-red-200 dark:border-red-900 dark:bg-red-950/40"
                                    : "rounded-full"
                                }
                              >
                                {getStatusText(task.status)}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                              <span className="font-mono">{task.peer?.peerUid}</span>
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount !== undefined && task.messageCount > 0 && (
                                <motion.span
                                  key={task.messageCount}
                                  initial={{ opacity: 0.5 }}
                                  animate={{ opacity: 1 }}
                                >
                                  {task.messageCount.toLocaleString()} 条消息
                                </motion.span>
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
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {task.status === "completed" && (
                              <>
                                <motion.div whileTap={{ scale: 0.98 }}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-full"
                                    onClick={() => openFileLocation(task.filePath)}
                                    title="打开文件位置"
                                  >
                                    <FolderOpen className="w-3 h-3" />
                                  </Button>
                                </motion.div>
                                <motion.div whileTap={{ scale: 0.98 }}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-full"
                                    onClick={() => downloadTask(task)}
                                  >
                                    <Download className="w-3 h-3 mr-1" />
                                    下载
                                  </Button>
                                </motion.div>
                              </>
                            )}
                            {(task.status === "completed" || task.status === "failed") && (
                              <motion.div whileTap={{ scale: 0.96 }}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-full text-red-600 hover:text-red-700 hover:border-red-300 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                  onClick={async () => {
                                    if (confirm("确定要删除这个任务吗？")) {
                                      const success = await deleteTask(task.id)
                                      if (success) {
                                        tasksLoadedRef.current = false
                                      }
                                    }
                                  }}
                                  title="删除"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </motion.div>
                            )}
                          </div>
                        </div>

                        {task.status === "running" && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {task.progressMessage || '准备中...'}
                              </span>
                              <motion.span
                                key={task.progress}
                                className="font-medium text-muted-foreground"
                                initial={{ opacity: 0, y: 2 }}
                                animate={{ opacity: 1, y: 0, transition: { duration: DUR.fast, ease: EASE.out } }}
                              >
                                {task.progress}%
                              </motion.span>
                            </div>
                            <Progress
                              value={task.progress}
                              shimmer={true}
                              className="h-1.5 rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                            />
                          </div>
                        )}

                        {task.error && (
                          <motion.div
                            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                          >
                            {task.error}
                          </motion.div>
                        )}
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeTab === "scheduled" && (
              <motion.div key="tab-scheduled" {...fadeSlide} className="space-y-6 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">定时导出</h2>
                    <p className="text-muted-foreground mt-1">管理自动化的定时导出任务</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.button
                      onClick={handleLoadScheduledExports}
                      disabled={scheduledLoading}
                      className="p-2 rounded-full text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      whileTap={{ rotate: -20, scale: 0.95 }}
                    >
                      <RefreshCw className={`w-4 h-4 ${scheduledLoading ? 'animate-spin' : ''}`} />
                    </motion.button>
                    <Button 
                      onClick={handleOpenScheduledMergeDialog}
                      disabled={loadingScheduledTasks}
                      variant="outline" 
                      className="rounded-full"
                    >
                      <Combine className="w-4 h-4 mr-2" />
                      合并备份
                    </Button>
                    <Button onClick={() => handleOpenScheduledExportWizard()} className="rounded-full">
                      新建定时任务
                    </Button>
                  </div>
                </div>

                {/* Filter Tabs */}
                {scheduledExports.length > 0 && (
                  <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full w-fit">
                    {[
                      { id: 'all', label: `全部 ${getScheduledStats().total}` },
                      { id: 'enabled', label: `启用 ${getScheduledStats().enabled}` },
                      { id: 'disabled', label: `禁用 ${getScheduledStats().disabled}` },
                    ].map(tab => {
                      const isActive = scheduledFilter === tab.id;
                      return (
                        <motion.button
                          key={tab.id}
                          onClick={() => setScheduledFilter(tab.id as typeof scheduledFilter)}
                          className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                            isActive 
                              ? 'bg-background text-foreground shadow-sm' 
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          whileTap={{ scale: 0.98 }}
                        >
                          {tab.label}
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {/* List */}
                {scheduledExports.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-border bg-muted/50 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Clock className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">暂无定时导出任务</p>
                    <p className="text-muted-foreground/70 text-sm mt-1">点击右上角「新建定时任务」开始</p>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {scheduledExports
                      .filter(se => scheduledFilter === 'all' || (scheduledFilter === 'enabled' ? se.enabled : !se.enabled))
                      .map((scheduledExport) => (
                      <div
                        key={scheduledExport.id}
                        className="group relative rounded-xl border border-border bg-background hover:border-border transition-all overflow-hidden"
                      >
                        <div className="p-4">
                          {/* Header */}
                          <div className="flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                              scheduledExport.enabled ? 'bg-neutral-900' : 'bg-neutral-300'
                            }`} />
                            <div className="min-w-0 flex-1">
                              <h3 className="font-medium text-foreground truncate text-sm">
                                {scheduledExport.name}
                              </h3>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  {scheduledExport.scheduleType === "daily" && "每天"}
                                  {scheduledExport.scheduleType === "weekly" && "每周"}
                                  {scheduledExport.scheduleType === "monthly" && "每月"}
                                  {scheduledExport.scheduleType === "custom" && "自定义"}
                                </span>
                                <span className="text-neutral-200">·</span>
                                <span className="text-xs text-muted-foreground">
                                  {scheduledExport.scheduleType === "custom" && scheduledExport.cronExpression
                                    ? scheduledExport.cronExpression
                                    : scheduledExport.executeTime}
                                </span>
                              </div>
                              {scheduledExport.nextRun && (
                                <p className="text-xs text-muted-foreground/70 mt-1">
                                  下次 {new Date(scheduledExport.nextRun).toLocaleString("zh-CN", {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </p>
                              )}
                            </div>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              scheduledExport.enabled 
                                ? 'bg-muted text-muted-foreground' 
                                : 'bg-muted text-muted-foreground/70'
                            }`}>
                              {scheduledExport.enabled ? "启用" : "禁用"}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
                            <button
                              className="flex-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                              onClick={() => toggleScheduledExport(scheduledExport.id, !scheduledExport.enabled)}
                            >
                              {scheduledExport.enabled ? "禁用" : "启用"}
                            </button>
                            <button
                              className="flex-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                              onClick={() => triggerScheduledExport(scheduledExport.id)}
                            >
                              执行
                            </button>
                            <button
                              className="flex-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                              onClick={() => handleOpenHistoryModal(scheduledExport.id, scheduledExport.name)}
                            >
                              历史
                            </button>
                          </div>
                        </div>
                        
                        {/* Delete button */}
                        <button
                          className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 text-muted-foreground/70 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={async () => {
                            if (confirm(`确定要删除定时任务"${scheduledExport.name}"吗？`)) {
                              const success = await deleteScheduledExport(scheduledExport.id)
                              if (success) await loadScheduledExports()
                            }
                          }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "history" && (
              <motion.div key="tab-history" {...fadeSlide} className="space-y-6 pt-10">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">聊天记录</h2>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      {getChatHistoryStats().total} 个文件
                      {resourceIndex && ` · ${resourceIndex.summary.totalResources.toLocaleString()} 资源 · ${formatResourceSize(resourceIndex.summary.totalSize)}`}
                    </p>
                  </div>
                  <motion.button
                    onClick={async () => {
                      chatHistoryLoadedRef.current = false
                      resourceIndexLoadedRef.current = false
                      await Promise.all([handleLoadChatHistory(), loadResourceIndex()])
                      chatHistoryLoadedRef.current = true
                      resourceIndexLoadedRef.current = true
                    }}
                    disabled={chatHistoryLoading || resourceIndexLoading}
                    className="p-2 rounded-full text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    whileTap={{ rotate: -20, scale: 0.95 }}
                  >
                    <RefreshCw className={`w-4 h-4 ${(chatHistoryLoading || resourceIndexLoading) ? 'animate-spin' : ''}`} />
                  </motion.button>
                </div>

                {/* Sub Tabs: Records / Gallery */}
                <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full w-fit">
                  <motion.button
                    onClick={() => setHistorySubTab('records')}
                    className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                      historySubTab === 'records'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    whileTap={{ scale: 0.98 }}
                  >
                    记录列表
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setHistorySubTab('gallery')
                      if (resourceFiles.length === 0) {
                        loadResourceFiles(galleryType, 1, 50)
                      }
                    }}
                    className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                      historySubTab === 'gallery'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    whileTap={{ scale: 0.98 }}
                  >
                    资源画廊
                  </motion.button>
                </div>

                {/* Records View */}
                {historySubTab === 'records' && (
                  <>
                {/* Filters Row */}
                {chatHistoryFiles.length > 0 && (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* Type Filter */}
                    <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full">
                      {[
                        { id: 'all', label: '全部' },
                        { id: 'group', label: '群组' },
                        { id: 'friend', label: '好友' },
                      ].map(tab => {
                        const isActive = (historyFilter || 'all') === tab.id;
                        return (
                          <motion.button
                            key={tab.id}
                            onClick={() => setHistoryFilter(tab.id as 'all' | 'group' | 'friend')}
                            className={`px-3 py-1 rounded-full text-xs transition-all ${
                              isActive 
                                ? 'bg-background text-foreground shadow-sm' 
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            whileTap={{ scale: 0.98 }}
                          >
                            {tab.label}
                          </motion.button>
                        );
                      })}
                    </div>

                    {/* Format Filter */}
                    <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full">
                      {[
                        { id: 'all', label: '全部格式' },
                        { id: 'html', label: 'HTML' },
                        { id: 'json', label: 'JSON' },
                        { id: 'zip', label: 'ZIP' },
                        { id: 'jsonl', label: 'JSONL' },
                      ].map(tab => {
                        const isActive = (historyFormatFilter || 'all') === tab.id;
                        return (
                          <motion.button
                            key={tab.id}
                            onClick={() => setHistoryFormatFilter(tab.id as 'all' | 'html' | 'json' | 'zip' | 'jsonl')}
                            className={`px-3 py-1 rounded-full text-xs transition-all ${
                              isActive 
                                ? 'bg-background text-foreground shadow-sm' 
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            whileTap={{ scale: 0.98 }}
                          >
                            {tab.label}
                          </motion.button>
                        );
                      })}
                    </div>

                  </div>
                )}

                {/* Empty State */}
                {chatHistoryFiles.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-border bg-muted/50 py-16 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <MessageCircle className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">暂无聊天记录</p>
                    <p className="text-muted-foreground/70 text-sm mt-1">完成导出任务后，记录将在此处显示</p>
                  </motion.div>
                ) : (
                  /* File Grid */
                  <motion.div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                    variants={STAG.container}
                    initial="initial"
                    animate="animate"
                  >
                    {chatHistoryFiles
                      .filter(file => {
                        // Type filter
                        if (historyFilter === 'group' && file.chatType !== 'group') return false;
                        if (historyFilter === 'friend' && file.chatType === 'group') return false;
                        
                        // Format filter
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
                        
                        // Find resource info for this file
                        const resourceInfo = resourceIndex?.exports.find(e => 
                          e.fileName === file.fileName || 
                          e.fileName === file.fileName.replace(/\.(html|json)$/i, '')
                        );
                        
                        return (
                          <motion.div
                            key={file.fileName}
                            className="group relative rounded-xl border border-border bg-background hover:border-border hover:shadow-sm transition-all cursor-pointer"
                            variants={STAG.item}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => handleOpenFilePathModal(file.filePath, file.displayName || file.sessionName || file.chatId, file.fileName, file.size)}
                          >
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <Avatar className="w-10 h-10 rounded-lg border border-border flex-shrink-0">
                                  <AvatarImage src={avatarUrl} />
                                  <AvatarFallback className="rounded-lg bg-muted text-muted-foreground/70">
                                    {file.chatType === 'group' ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-medium text-foreground truncate text-sm">
                                    {file.displayName || file.sessionName || file.chatId}
                                  </h3>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {file.messageCount !== undefined && file.messageCount > 0 && (
                                      <>
                                        <span className="text-xs text-muted-foreground/70">
                                          {file.messageCount} 条
                                        </span>
                                        <span className="text-neutral-200">·</span>
                                      </>
                                    )}
                                    {resourceInfo && resourceInfo.resourceCount > 0 && (
                                      <>
                                        <span className="text-xs text-muted-foreground/70">
                                          {resourceInfo.resourceCount} 资源
                                        </span>
                                        <span className="text-neutral-200">·</span>
                                      </>
                                    )}
                                    <span className="text-xs text-muted-foreground/70">
                                      {new Date(file.createTime).toLocaleDateString()}
                                    </span>
                                  </div>
                                </div>
                                <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                                  {formatLabel}
                                </span>
                              </div>
                            </div>
                            
                            {/* Delete button */}
                            <motion.button
                              className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 text-muted-foreground/70 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm(`确定要删除这条记录吗？`)) {
                                  const success = await deleteChatHistoryFile(file.fileName);
                                  if (success) chatHistoryLoadedRef.current = false;
                                }
                              }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <X className="w-3 h-3" />
                            </motion.button>
                          </motion.div>
                        );
                      })}
                  </motion.div>
                )}
                  </>
                )}

                {/* Gallery View */}
                {historySubTab === 'gallery' && (
                  <div className="space-y-4">
                    {/* Gallery Type Filter */}
                    <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full w-fit">
                      {[
                        { id: 'all', label: '全部' },
                        { id: 'images', label: '图片' },
                        { id: 'videos', label: '视频' },
                        { id: 'audios', label: '音频' },
                        { id: 'files', label: '文件' },
                      ].map(tab => {
                        const isActive = galleryType === tab.id;
                        return (
                          <motion.button
                            key={tab.id}
                            onClick={() => {
                              setGalleryType(tab.id as typeof galleryType)
                              setGalleryPage(1)
                              loadResourceFiles(tab.id as typeof galleryType, 1, 50)
                            }}
                            className={`px-3 py-1 rounded-full text-xs transition-all ${
                              isActive 
                                ? 'bg-background text-foreground shadow-sm' 
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            whileTap={{ scale: 0.98 }}
                          >
                            {tab.label}
                          </motion.button>
                        );
                      })}
                      <span className="text-xs text-muted-foreground/70 ml-2">
                        {resourceFilesTotal} 个
                      </span>
                    </div>

                    {/* Loading */}
                    {resourceFilesLoading && resourceFiles.length === 0 && (
                      <div className="flex items-center justify-center py-20">
                        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/70" />
                        <span className="ml-2 text-muted-foreground text-sm">加载中...</span>
                      </div>
                    )}

                    {/* Gallery Grid */}
                    {resourceFiles.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                        {resourceFiles.map((file, idx) => (
                          <motion.div
                            key={`${file.fileName}-${idx}`}
                            className="relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer group"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
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
                              <div className="w-full h-full flex items-center justify-center bg-muted">
                                <Music className="w-8 h-8 text-muted-foreground/70" />
                              </div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-muted">
                                <File className="w-8 h-8 text-muted-foreground/70" />
                              </div>
                            )}
                            {/* Overlay */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {/* Load More */}
                    {resourceFilesHasMore && (
                      <div className="flex justify-center pt-4">
                        <Button
                          variant="outline"
                          size="sm"
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
                      <div className="text-center py-16">
                        <Image className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
                        <p className="text-muted-foreground">暂无资源</p>
                        <p className="text-muted-foreground/70 text-sm mt-1">导出聊天记录后，资源将显示在这里</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Resource Preview Modal - Full Screen with Animation */}
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
                      {/* Top Bar */}
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

                      {/* Content */}
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

                      {/* Bottom hint */}
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
              </motion.div>
            )}

            {activeTab === "stickers" && (
              <motion.div key="tab-stickers" {...fadeSlide} className="space-y-6 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">表情包管理</h2>
                    <p className="text-muted-foreground mt-1">导出收藏的表情、市场表情包和系统表情包</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.button
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
                      className="p-2 rounded-full text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      whileTap={{ rotate: -20, scale: 0.95 }}
                    >
                      <RefreshCw className={`w-4 h-4 ${stickerPacksLoading ? 'animate-spin' : ''}`} />
                    </motion.button>
                    <Button
                      onClick={handleExportAllStickerPacks}
                      disabled={stickerPacksLoading || stickerPacks.length === 0}
                      className="rounded-full"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      导出所有
                    </Button>
                  </div>
                </div>

                {/* Filter Tabs */}
                {stickerPacks.length > 0 && (
                  <div className="flex items-center gap-1 p-1 bg-muted/80 rounded-full w-fit">
                    {[
                      { id: 'all', label: `全部 ${getStickerPacksStats().total}` },
                      { id: 'favorite', label: `收藏 ${getStickerPacksStats().favorite_emoji}` },
                      { id: 'market', label: `市场 ${getStickerPacksStats().market_pack}` },
                      { id: 'system', label: `系统 ${getStickerPacksStats().system_pack}` },
                    ].map(tab => {
                      const isActive = stickerFilter === tab.id;
                      return (
                        <motion.button
                          key={tab.id}
                          onClick={() => setStickerFilter(tab.id as typeof stickerFilter)}
                          className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                            isActive 
                              ? 'bg-background text-foreground shadow-sm' 
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          whileTap={{ scale: 0.98 }}
                        >
                          {tab.label}
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {/* Sticker Packs List */}
                {stickerPacks.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-border bg-muted/50 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Smile className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">暂无表情包</p>
                    <p className="text-muted-foreground/70 text-sm mt-1">点击刷新按钮加载表情包数据</p>
                  </motion.div>
                ) : (
                  <div className="rounded-xl border border-border bg-background divide-y divide-border overflow-hidden">
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
                          className="flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="font-medium text-foreground truncate">
                              {pack.packName}
                            </span>
                            <span className="text-xs text-muted-foreground/70 flex-shrink-0">
                              {pack.stickerCount} 个
                            </span>
                            <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                              {pack.packType === 'favorite_emoji' ? '收藏' : 
                               pack.packType === 'market_pack' ? '市场' : '系统'}
                            </span>
                          </div>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-4"
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
                  <motion.section className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">导出记录</h3>
                    <div className="space-y-2">
                      {stickerExportRecords.slice(0, 5).map((record) => (
                        <div
                          key={record.id}
                          className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground truncate">
                                {record.packName || '全部导出'}
                              </span>
                              {!record.success && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  失败
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span>{record.stickerCount} 个表情</span>
                              <span className="text-neutral-200">·</span>
                              <span>{new Date(record.exportTime).toLocaleDateString()}</span>
                            </div>
                          </div>
                          {record.success && record.exportPath && (
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                  </motion.section>
                )}
              </motion.div>
            )}

            {activeTab === "about" && (
              <motion.div key="tab-about" {...fadeSlide} className="min-h-[80vh] flex flex-col items-center justify-center space-y-16 pt-20 pb-20">
                {/* Hero Section */}
                <div className="text-center space-y-8 max-w-4xl">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-muted-foreground/70 tracking-wider uppercase">
                        About
                      </div>
                      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
                        QQ 聊天记录导出工具
                      </h1>
                    </div>
                    <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                      简单高效的聊天记录导出解决方案
                    </p>
                  </div>

                  {/* NapCat Tribute */}
                  <div className="pt-12 pb-8">
                    <div className="flex items-center justify-center gap-8">
                      <div className="text-left space-y-4 max-w-md">
                        <h2 className="text-2xl font-medium text-foreground">致谢 NapCat</h2>
                        <p className="text-muted-foreground leading-relaxed">
                          感谢 NapCat 提供了访问 QQ 客户端数据的能力，让我们能够读取和导出聊天记录。
                        </p>
                      </div>
                      <motion.div
                        className="flex-shrink-0"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                      >
                        <img 
                          src="https://napneko.github.io/assets/logos/napcat_8.png" 
                          alt="NapCat" 
                          className="w-32 h-48 object-contain"
                        />
                      </motion.div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-center">
                  <div className="flex items-center gap-4">
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                      <Button 
                        onClick={() => window.open('https://github.com/shuakami/qq-chat-exporter', '_blank')}
                        className="rounded-full bg-neutral-900 hover:bg-neutral-800 text-white"
                      >
                        <Star className="w-4 h-4 mr-2" />
                        Star on GitHub
                      </Button>
                    </motion.div>
                    <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                      <Button 
                        onClick={() => window.open('https://napneko.github.io/', '_blank')}
                        variant="outline"
                        className="rounded-full"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        了解 NapCat
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {/* Legal Notice */}
                <motion.div
                  className="text-center space-y-4 pt-12 w-full"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                >
                  <h3 className="text-lg font-medium text-foreground">使用声明</h3>
                  <div className="space-y-3 text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                    <p>
                      本工具仅供学习和个人使用，请勿用于商业用途。请遵守相关法律法规和平台服务条款。
                    </p>
                    <p>
                      <strong>反倒卖声明：</strong>本项目完全开源免费，任何个人或组织不得将此工具进行商业销售或倒卖。
                    </p>
                    <p>
                      如果这个工具对你有帮助，请在 GitHub 上给我们一个 Star ⭐
                    </p>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

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

      {/* 聊天记录预览模态框 */}
      <AnimatePresence>
        {isFilePathModalOpen && selectedFile && (() => {
          const fileName = selectedFile.fileName.toLowerCase()
          const isHtml = fileName.endsWith('.html') || fileName.endsWith('.htm')
          const isJson = fileName.endsWith('.json')
          const isZip = fileName.endsWith('.zip')
          const isJsonl = fileName.includes('_chunked_jsonl') || fileName.includes('jsonl')
          const fileSize = selectedFile.size || 0
          const isLargeFile = fileSize > 15 * 1024 * 1024 // 15MB
          // HTML 和 JSON（小于15MB）可以预览
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
                // 可预览的 HTML 文件 - 全屏预览
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
                // 不可预览的文件 - 显示友好提示
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
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">HTML 导出</h3>
                    <p className="text-xs text-muted-foreground">可视化聊天记录</p>
                  </div>
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
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Database className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">JSON 导出</h3>
                    <p className="text-xs text-muted-foreground">结构化数据格式</p>
                  </div>
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
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Database className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">JSONL 分块导出</h3>
                    <p className="text-xs text-muted-foreground">适合大规模数据处理</p>
                  </div>
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
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Package className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">流式 HTML ZIP 导出</h3>
                    <p className="text-xs text-muted-foreground">分块 HTML + 资源打包</p>
                  </div>
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
                className="fixed inset-0 bg-black/40 z-[100]" 
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-sm bg-background rounded-2xl shadow-xl p-6"
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
                    }}
                    className="flex-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    跳过
                  </button>
                  <button
                    onClick={() => setOnboardingStep(1)}
                    className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
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
          const targetEl = typeof document !== 'undefined' ? document.getElementById('nav-sessions') : null
          const rect = targetEl?.getBoundingClientRect()
          if (!rect) return null
          
          const tooltipWidth = 260
          let left = rect.left + rect.width / 2 - tooltipWidth / 2
          left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12))
          
          return (
            <div 
              className="fixed z-[100] animate-in fade-in slide-in-from-top-2 duration-200" 
              style={{ left, top: rect.bottom + 12 }}
            >
              <div 
                className="absolute -top-[6px] w-3 h-3 bg-blue-500 rotate-45"
                style={{ left: rect.left + rect.width / 2 - left - 6 }}
              />
              <div className="relative bg-blue-500 text-white rounded-xl p-4 shadow-lg" style={{ width: tooltipWidth }}>
                <p className="text-sm font-medium mb-1">第 1 步：打开会话列表</p>
                <p className="text-blue-100 text-xs mb-3">点击「会话」查看所有群聊和好友</p>
                <button
                  onClick={() => {
                    targetEl?.click()
                    setOnboardingStep(2)
                  }}
                  className="w-full py-2 bg-white dark:bg-blue-600 text-blue-500 dark:text-white rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-700"
                >
                  点击前往
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                  }}
                  className="w-full mt-2 text-xs text-blue-200 hover:text-white"
                >
                  跳过引导
                </button>
              </div>
            </div>
          )
        }
        
        // 在会话页，提示点击导出
        if (onboardingStep === 2 && activeTab === 'sessions') {
          return (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-blue-500 text-white rounded-xl px-5 py-4 shadow-lg max-w-sm">
                <p className="text-sm font-medium mb-1">第 2 步：选择并导出</p>
                <p className="text-blue-100 text-xs mb-3">
                  在列表中找到想导出的群聊或好友，点击右侧的「导出」按钮
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      localStorage.setItem("qce-onboarding-completed", "true")
                      setShowOnboarding(false)
                    }}
                    className="flex-1 py-2 text-xs text-blue-200 hover:text-white"
                  >
                    我知道了
                  </button>
                  <button
                    onClick={() => setOnboardingStep(3)}
                    className="flex-1 py-2 bg-white dark:bg-blue-600 text-blue-500 dark:text-white rounded-lg text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-700"
                  >
                    下一步
                  </button>
                </div>
              </div>
            </div>
          )
        }
        
        // 指向「任务」看进度
        if (onboardingStep === 3) {
          const targetEl = typeof document !== 'undefined' ? document.getElementById('nav-tasks') : null
          const rect = targetEl?.getBoundingClientRect()
          if (!rect) return null
          
          const tooltipWidth = 260
          let left = rect.left + rect.width / 2 - tooltipWidth / 2
          left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12))
          
          return (
            <div 
              className="fixed z-[100] animate-in fade-in slide-in-from-top-2 duration-200" 
              style={{ left, top: rect.bottom + 12 }}
            >
              <div 
                className="absolute -top-[6px] w-3 h-3 bg-blue-500 rotate-45"
                style={{ left: rect.left + rect.width / 2 - left - 6 }}
              />
              <div className="relative bg-blue-500 text-white rounded-xl p-4 shadow-lg" style={{ width: tooltipWidth }}>
                <p className="text-sm font-medium mb-1">第 3 步：查看导出进度</p>
                <p className="text-blue-100 text-xs mb-3">
                  在「任务」页面可以看到导出进度和状态
                </p>
                <button
                  onClick={() => setOnboardingStep(4)}
                  className="w-full py-2 bg-white dark:bg-blue-600 text-blue-500 dark:text-white rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-700"
                >
                  下一步
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                  }}
                  className="w-full mt-2 text-xs text-blue-200 hover:text-white"
                >
                  跳过引导
                </button>
              </div>
            </div>
          )
        }
        
        // 指向「聊天记录」查看文件
        if (onboardingStep === 4) {
          const targetEl = typeof document !== 'undefined' ? document.getElementById('nav-history') : null
          const rect = targetEl?.getBoundingClientRect()
          if (!rect) return null
          
          const tooltipWidth = 280
          let left = rect.left + rect.width / 2 - tooltipWidth / 2
          left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12))
          
          return (
            <div 
              className="fixed z-[100] animate-in fade-in slide-in-from-top-2 duration-200" 
              style={{ left, top: rect.bottom + 12 }}
            >
              <div 
                className="absolute -top-[6px] w-3 h-3 bg-blue-500 rotate-45"
                style={{ left: rect.left + rect.width / 2 - left - 6 }}
              />
              <div className="relative bg-blue-500 text-white rounded-xl p-4 shadow-lg" style={{ width: tooltipWidth }}>
                <p className="text-sm font-medium mb-1">第 4 步：查看导出文件</p>
                <p className="text-blue-100 text-xs mb-3">
                  导出完成后，在「聊天记录」可以查看、下载、预览所有文件
                </p>
                <button
                  onClick={() => {
                    localStorage.setItem("qce-onboarding-completed", "true")
                    setShowOnboarding(false)
                  }}
                  className="w-full py-2 bg-white dark:bg-blue-600 text-blue-500 dark:text-white rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-700"
                >
                  完成
                </button>
              </div>
            </div>
          )
        }
        
        return null
      })()}
    </div>
  )
}
