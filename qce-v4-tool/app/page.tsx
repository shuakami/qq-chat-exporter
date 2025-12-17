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
} from "lucide-react"
import type { CreateTaskForm, CreateScheduledExportForm } from "@/types/api"
import { useQCE } from "@/hooks/use-qce"
import { useScheduledExports } from "@/hooks/use-scheduled-exports"
import { useChatHistory } from "@/hooks/use-chat-history"
import { useStickerPacks } from "@/hooks/use-sticker-packs"

// ✨ 动效核心：统一的 Bezier 曲线与时长
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"

// 曲线：inOut 更沉稳、out 更灵动、in 用于元素消失
const EASE = {
  inOut: [0.22, 1, 0.36, 1] as [number, number, number, number], // standard in-out
  out:   [0.16, 1, 0.3, 1]  as [number, number, number, number], // swift out
  in:    [0.3, 0, 0.7, 1]   as [number, number, number, number], // gentle in
}

// 时长：fast 用于 hover/press，normal 为默认，slow 用于大型容器
const DUR = {
  fast: 0.18,
  normal: 0.36,
  slow: 0.6,
}

// 级联容器与子项 variants
const makeStagger = (delay = 0.04, r = false) => ({
  container: {
    animate: {
      transition: r
        ? { staggerChildren: 0, when: "beforeChildren" }
        : { staggerChildren: delay, when: "beforeChildren" },
    },
  },
  item: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } },
    exit:    { opacity: 0, y: 6, transition: { duration: DUR.fast, ease: EASE.in } },
  },
})

// 卡片悬停/按压微动
const hoverLift = {
  whileHover: { y: -2, scale: 1.01, transition: { duration: DUR.fast, ease: EASE.out } },
  whileTap:   { scale: 0.995, transition: { duration: DUR.fast, ease: EASE.inOut } },
}

// 通用淡入淡出（用于 Tab 切换）
const fadeSlide = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE.inOut } },
  exit:    { opacity: 0, y: -8, transition: { duration: DUR.normal, ease: EASE.in } },
}

// Toast 弹入
const toastAnim = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.normal, ease: EASE.out } },
  exit:    { opacity: 0, y: 10, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.in } },
}

// 状态点呼吸（通过 framer 的 animate 属性实现）
const statusPulse = {
  animate: {
    scale: [1, 1.06, 1],
    transition: { duration: 2.4, ease: EASE.inOut, repeat: Infinity, repeatDelay: 0.2 },
  },
}

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
  const [selectedFile, setSelectedFile] = useState<{ filePath: string; sessionName: string; fileName: string } | null>(null)
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
      }
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

  const handleOpenFilePathModal = (filePath: string, sessionName: string, fileName: string) => {
    setSelectedFile({ filePath, sessionName, fileName })
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

  // 任务列表加载
  useEffect(() => {
    if (activeTab === "tasks" && !tasksLoadedRef.current) {
      tasksLoadedRef.current = true
      loadTasks().catch(() => {
        tasksLoadedRef.current = false
      })
    }
  }, [activeTab])
  
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
      scheduledExportsLoadedRef.current = false
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

        const form = {
          chatType: item.chatType,
          peerUid: item.peerUid,
          sessionName: item.name,
          format: config.format,
          startTime,
          endTime,
          downloadMedia: config.downloadMedia
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
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      {/* Header */}
      <motion.div
        className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100"
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
                onClick={() => setActiveTab(id)}
                className={`text-sm transition-all duration-300 ${
                  activeTab === id
                    ? "text-black"
                    : "text-neutral-500 hover:text-neutral-800"
                }`}
                whileTap={{ scale: 0.98, transition: { duration: DUR.fast, ease: EASE.inOut } }}
              >
                <span
                  className={`inline-block pb-1 border-b ${
                    activeTab === id ? "border-neutral-900" : "border-transparent"
                  } transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]`}
                >
                  {label}
                </span>
              </motion.button>
            ))}
          </nav>
          
          {/* Status & Actions */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <motion.span
                className={`w-2 h-2 rounded-full ${
                  !wsConnected ? "bg-red-400" :
                  !systemInfo?.napcat.online ? "bg-yellow-400" : "bg-green-400"
                }`}
                {...statusPulse}
              />
              <span className="text-sm text-neutral-600">
                {!wsConnected ? "离线" : systemInfo?.napcat.online ? "在线" : "QQ离线"}
              </span>
            </div>
            <motion.button
              onClick={refreshSystemInfo}
              className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
              whileTap={{ rotate: -20, scale: 0.95, transition: { duration: DUR.fast, ease: EASE.inOut } }}
              title="刷新"
            >
              <RefreshCw className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Toasts */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            {...toastAnim}
          >
            <button 
              onClick={() => setError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-neutral-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-neutral-200 bg-neutral-100 p-2.5">
                <AlertCircle className="w-5 h-5 text-neutral-600" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-neutral-900">发生错误</h3>
                <p className="mt-1 text-sm text-neutral-600">{error}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {scheduledError && (
          <motion.div
            key="scheduled-error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: error ? '140px' : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setScheduledError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-neutral-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-neutral-200 bg-neutral-100 p-2.5">
                <AlertCircle className="w-5 h-5 text-neutral-600" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-neutral-900">定时任务错误</h3>
                <p className="mt-1 text-sm text-neutral-600">{scheduledError}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chatHistoryError && (
          <motion.div
            key="chat-history-error-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: (error || scheduledError) ? (error && scheduledError ? '280px' : '140px') : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setChatHistoryError(null)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-neutral-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-neutral-200 bg-neutral-100 p-2.5">
                <AlertCircle className="w-5 h-5 text-neutral-600" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-neutral-900">聊天记录错误</h3>
                <p className="mt-1 text-sm text-neutral-600">{chatHistoryError}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStarToast && (
          <motion.div
            key="star-toast"
            className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg"
            style={{ bottom: (error || scheduledError || chatHistoryError) ? 
              (Number(!!error) + Number(!!scheduledError) + Number(!!chatHistoryError)) === 3 ? '420px' :
              (Number(!!error) + Number(!!scheduledError) + Number(!!chatHistoryError)) === 2 ? '280px' :
              '140px' : '24px' }}
            {...toastAnim}
          >
            <button 
              onClick={() => setShowStarToast(false)}
              className="absolute top-3 right-3 rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 rounded-full border border-yellow-200 bg-yellow-50 p-2.5">
                <Star className="w-5 h-5 text-yellow-600 fill-current" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-neutral-900">兄弟....</h3>
                <p className="mt-1 text-sm text-neutral-600">如果有帮助到你，给我点个 Star 吧喵</p>
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
      <div className={`fixed right-6 z-50 space-y-3 pointer-events-none transition-all duration-300 ${
        showStarToast ? 'bottom-[180px]' : 'bottom-6'
      }`}>
        <AnimatePresence>
          {notifications.map((notification, index) => (
            <motion.div
              key={notification.id}
              className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-2xl shadow-neutral-500/10 backdrop-blur-lg pointer-events-auto"
              style={{ marginBottom: index > 0 ? '12px' : 0 }}
              {...toastAnim}
            >
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                className="absolute top-3 right-3 rounded-full p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-3 pr-8">
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-neutral-900">{notification.title}</h3>
                  <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">{notification.message}</p>
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
                    className="text-4xl md:text-5xl font-semibold tracking-tight text-neutral-900"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    QQ 聊天记录导出工具
                  </motion.h1>
                  <motion.p
                    className="text-neutral-600 text-lg"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut, delay: 0.05 } }}
                  >
                    现代化的聊天记录导出解决方案，支持多种格式和定时备份
                  </motion.p>
                  <motion.div
                    className="flex flex-wrap gap-3 pt-2"
                    initial="initial"
                    animate="animate"
                    variants={STAG.container}
                  >
                    {[
                      { key: "browse", text: "浏览会话", onClick: () => setActiveTab("sessions"), variant: "outline" as const },
                      { key: "new", text: "新建任务", onClick: () => handleOpenTaskWizard(), variant: undefined },
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

                {/* Status Row */}
                <motion.section
                  className="rounded-2xl border border-neutral-200 bg-white/60 backdrop-blur px-5 py-4"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      {
                        label: "连接",
                        dotClass: wsConnected ? "bg-green-500" : "bg-red-500",
                        textClass: wsConnected ? "text-green-700" : "text-red-700",
                        text: wsConnected ? "已连接" : "未连接",
                      },
                      {
                        label: "QQ状态",
                        dotClass: systemInfo?.napcat.online ? "bg-green-500" : "bg-amber-500",
                        textClass: systemInfo?.napcat.online ? "text-green-700" : "text-amber-700",
                        text: systemInfo?.napcat.online ? "在线" : "离线",
                      },
                      {
                        label: "版本",
                        textOnly: systemInfo?.version || "4.0.0",
                      },
                    ].map((it, idx) => (
                      <motion.div
                        key={idx}
                        className="flex items-center justify-between rounded-xl px-3 py-2"
                        variants={STAG.item}
                        {...hoverLift}
                      >
                        <span className="text-sm text-neutral-600">{it.label}</span>
                        {"textOnly" in it ? (
                          <span className="text-sm font-medium text-neutral-900">{it.textOnly}</span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className={["inline-block w-2 h-2 rounded-full", it.dotClass].join(" ")} />
                            <span className={`${it.textClass} text-sm`}>{it.text}</span>
                          </span>
                        )}
                      </motion.div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pt-4">
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={refreshSystemInfo}
                        variant="outline"
                        size="sm"
                        className="rounded-full h-8"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        刷新系统状态
                      </Button>
                    </motion.div>
                    {systemInfo?.napcat.selfInfo && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                      >
                        <Badge variant="outline" className="rounded-full h-8 px-3 flex items-center">
                          {systemInfo.napcat.selfInfo.nick} · QQ {systemInfo.napcat.selfInfo.uin}
                        </Badge>
                      </motion.div>
                    )}
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
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-neutral-600">{s.title}</p>
                      <div className="mt-2 flex items-baseline gap-3">
                        <span className="text-2xl font-semibold">{s.value}</span>
                        {s.sub && <span className="text-xs text-neutral-500">{s.sub}</span>}
                      </div>
                    </motion.div>
                  ))}
                </motion.section>

                {/* Recent tasks preview */}
                {tasks.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-medium text-neutral-900">最近任务</h3>
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
                          className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 hover:bg-white transition"
                          variants={STAG.item}
                          {...hoverLift}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-neutral-900">{task.sessionName}</p>
                              <Badge
                                variant="outline"
                                className={
                                  task.status === "completed"
                                    ? "rounded-full text-green-700 border-green-200 bg-green-50"
                                    : task.status === "running"
                                    ? "rounded-full text-blue-700 border-blue-200 bg-blue-50"
                                    : task.status === "failed"
                                    ? "rounded-full text-red-700 border-red-200 bg-red-50"
                                    : "rounded-full"
                                }
                              >
                                {getStatusText(task.status)}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount && <span>{task.messageCount.toLocaleString()} 条</span>}
                            </div>
                          </div>
                          <div className="ml-4 flex items-center gap-2">
                            {task.status === "running" && (
                              <>
                                {/* 进度条 & 数字同步缓动 */}
                                <div className="w-24">
                                  <Progress
                                    value={task.progress}
                                    className="w-24 h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                  />
                                </div>
                                <motion.span
                                  key={task.progress} // 数字变化时做一个小淡入
                                  className="text-xs text-blue-700 font-medium min-w-[2.5rem] text-right"
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
                    <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">会话管理</h2>
                    <p className="text-neutral-600 mt-1">
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
                    className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-14 text-center"
                    initial={{ opacity: 0, scale: 0.98, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <p className="text-neutral-700">暂无会话数据</p>
                    <p className="text-neutral-500 mt-1">请确认 QQ 已连接，然后点击 "刷新列表"</p>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Groups */}
                    {groups.length > 0 && (
                      <section className="space-y-3">
                        <h3 className="text-sm font-medium text-neutral-900">群组（{groups.length}）</h3>
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
                                    ? "border-neutral-400 bg-neutral-50"
                                    : "border-neutral-200 bg-white/70 hover:bg-neutral-50 cursor-pointer"
                                  : "border-neutral-200 bg-white/70 hover:bg-neutral-50"
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
                                <p className="truncate font-medium text-neutral-900">{group.groupName}</p>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-600">
                                  <span>{group.memberCount} 成员</span>
                                  <span className="text-neutral-400">•</span>
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
                                      {avatarExportLoading === group.groupCode ? '导出中...' : '头像'}
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
                        <h3 className="text-sm font-medium text-neutral-900">好友（{friends.length}）</h3>
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
                                    ? "border-neutral-300 bg-neutral-50 ring-1 ring-neutral-300" 
                                    : "border-neutral-200 bg-white/70 hover:bg-white cursor-pointer"
                                  : "border-neutral-200 bg-white/70 hover:bg-white"
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
                                  <p className="truncate font-medium text-neutral-900">{friend.remark || friend.nick}</p>
                                  {friend.isOnline && (
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-600">
                                  <span className="font-mono">{friend.uin}</span>
                                  {friend.remark && friend.nick !== friend.remark && (
                                    <>
                                      <span className="text-neutral-400">•</span>
                                      <span className="truncate text-neutral-500">{friend.nick}</span>
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
                    <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">导出任务</h2>
                    <p className="text-neutral-600 mt-1">查看与管理任务，下载完成文件</p>
                    <p className="text-sm text-neutral-500 mt-1">如果消息数量为 0，请先尝试刷新</p>
                  </div>
                  <div className="flex items-center gap-2">
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
                    className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <p className="text-neutral-700">暂无导出任务</p>
                    <p className="text-neutral-500 mt-1">从「会话」中选择一个会话来创建任务，或点击右上角「新建任务」</p>
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
                        className="rounded-2xl border border-neutral-200 bg-white/70 px-5 py-4 hover:bg-white transition"
                        variants={STAG.item}
                        {...hoverLift}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate font-medium text-neutral-900">{task.sessionName}</h3>
                              <Badge
                                variant="outline"
                                className={
                                  task.status === "completed"
                                    ? "rounded-full text-green-700 border-green-200 bg-green-50"
                                    : task.status === "running"
                                    ? "rounded-full text-blue-700 border-blue-200 bg-blue-50"
                                    : task.status === "failed"
                                    ? "rounded-full text-red-700 border-red-200 bg-red-50"
                                    : "rounded-full"
                                }
                              >
                                {getStatusText(task.status)}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
                              <span className="font-mono">{task.peer?.peerUid}</span>
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount && <span>{task.messageCount.toLocaleString()} 条消息</span>}
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
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs text-neutral-600 mb-1">
                              <span>导出进度</span>
                              <motion.span
                                key={task.progress}
                                className="font-medium text-blue-700"
                                initial={{ opacity: 0, y: 2 }}
                                animate={{ opacity: 1, y: 0, transition: { duration: DUR.fast, ease: EASE.out } }}
                              >
                                {task.progress}%
                              </motion.span>
                            </div>
                            <Progress
                              value={task.progress}
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
              <motion.div key="tab-scheduled" {...fadeSlide} className="space-y-10 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">定时导出</h2>
                    <p className="text-neutral-600 mt-1">管理自动化的定时导出任务</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={handleLoadScheduledExports}
                        disabled={scheduledLoading}
                        variant="outline"
                        className="rounded-full"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {scheduledLoading ? "加载中..." : "刷新列表"}
                      </Button>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button 
                        onClick={handleOpenScheduledMergeDialog}
                        disabled={loadingScheduledTasks}
                        variant="outline" 
                        className="rounded-full"
                      >
                        <Combine className="w-4 h-4 mr-2" />
                        {loadingScheduledTasks ? "加载中..." : "合并备份"}
                      </Button>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button onClick={() => handleOpenScheduledExportWizard()} className="rounded-full">
                        新建定时任务
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {/* Stats */}
                <motion.section
                  className="grid grid-cols-1 sm:grid-cols-4 gap-3"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    { label: "总任务数", value: getScheduledStats().total },
                    { label: "已启用", value: getScheduledStats().enabled },
                    { label: "已禁用", value: getScheduledStats().disabled },
                    { label: "每日任务", value: getScheduledStats().daily },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-neutral-600">{s.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-neutral-900">{s.value}</p>
                    </motion.div>
                  ))}
                </motion.section>

                {/* List */}
                {scheduledExports.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <p className="text-neutral-700">暂无定时导出任务</p>
                    <p className="text-neutral-500 mt-1">点击右上角「新建定时任务」开始</p>
                  </motion.div>
                ) : (
                  <motion.div
                    className="space-y-2"
                    variants={STAG.container}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    {scheduledExports.map((scheduledExport) => (
                      <motion.div
                        key={scheduledExport.id}
                        className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white/70 px-5 py-4 hover:bg-white transition"
                        variants={STAG.item}
                        {...hoverLift}
                      >
                        <span
                          className={[
                            "inline-block w-1.5 h-1.5 rounded-full",
                            scheduledExport.enabled ? "bg-green-500" : "bg-neutral-300",
                          ].join(" ")}
                        />
                        <div className="min-w-0 flex-1 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-neutral-900">{scheduledExport.name}</span>
                              <span
                                className={[
                                  "text-xs px-2 py-0.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                  scheduledExport.enabled
                                    ? "bg-green-100 text-green-700"
                                    : "bg-neutral-100 text-neutral-600",
                                ].join(" ")}
                              >
                                {scheduledExport.enabled ? "启用" : "禁用"}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                                {scheduledExport.scheduleType === "daily" && "每天"}
                                {scheduledExport.scheduleType === "weekly" && "每周"}
                                {scheduledExport.scheduleType === "monthly" && "每月"}
                                {scheduledExport.scheduleType === "custom" && "自定义"}
                              </span>
                              <span className="font-mono">{scheduledExport.format}</span>
                              <span>
                                {scheduledExport.scheduleType === "custom" && scheduledExport.cronExpression
                                  ? scheduledExport.cronExpression
                                  : scheduledExport.executeTime}
                              </span>
                              <span>
                                {(scheduledExport.timeRangeType === "yesterday" && "昨天") ||
                                  (scheduledExport.timeRangeType === "last-week" && "上周") ||
                                  (scheduledExport.timeRangeType === "last-month" && "上月") ||
                                  (scheduledExport.timeRangeType === "last-7-days" && "最近7天") ||
                                  (scheduledExport.timeRangeType === "last-30-days" && "最近30天") ||
                                  "自定义"}
                              </span>
                              {scheduledExport.nextRun && (
                                <span className="text-blue-700 font-medium">
                                  下次 {new Date(scheduledExport.nextRun).toLocaleString("zh-CN", {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <motion.div whileTap={{ scale: 0.96 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 px-3 rounded-full"
                                onClick={() => toggleScheduledExport(scheduledExport.id, !scheduledExport.enabled)}
                              >
                                {scheduledExport.enabled ? (
                                  <>
                                    <ToggleRight className="w-4 h-4 text-green-600 mr-1" />
                                    <span className="text-xs text-green-700">禁用</span>
                                  </>
                                ) : (
                                  <>
                                    <ToggleLeft className="w-4 h-4 text-neutral-500 mr-1" />
                                    <span className="text-xs text-neutral-600">启用</span>
                                  </>
                                )}
                              </Button>
                            </motion.div>
                            <motion.div whileTap={{ scale: 0.96 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 px-3 rounded-full"
                                onClick={() => triggerScheduledExport(scheduledExport.id)}
                              >
                                <Zap className="w-4 h-4 text-blue-700 mr-1" />
                                <span className="text-xs text-blue-700">执行</span>
                              </Button>
                            </motion.div>
                            <motion.div whileTap={{ scale: 0.96 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 px-3 rounded-full"
                                onClick={() => handleOpenHistoryModal(scheduledExport.id, scheduledExport.name)}
                              >
                                <History className="w-4 h-4 text-purple-700 mr-1" />
                                <span className="text-xs text-purple-700">历史</span>
                              </Button>
                            </motion.div>
                            <motion.div whileTap={{ scale: 0.94 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 px-3 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={async () => {
                                  if (confirm(`确定要删除定时任务"${scheduledExport.name}"吗？`)) {
                                    const success = await deleteScheduledExport(scheduledExport.id)
                                    if (success) scheduledExportsLoadedRef.current = false
                                  }
                                }}
                              >
                                <X className="w-4 h-4 mr-1" />
                                <span className="text-xs">删除</span>
                              </Button>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeTab === "history" && (
              <motion.div key="tab-history" {...fadeSlide} className="space-y-10 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">聊天记录索引</h2>
                    <p className="text-neutral-600 mt-1">点击任意聊天记录即可直接查看</p>
                  </div>
                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button onClick={handleLoadChatHistory} disabled={chatHistoryLoading} variant="outline" className="rounded-full">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {chatHistoryLoading ? "加载中..." : "刷新列表"}
                    </Button>
                  </motion.div>
                </div>

                {/* Stats */}
                <motion.section
                  className="grid grid-cols-1 sm:grid-cols-4 gap-3"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    { label: "总文件数", value: getChatHistoryStats().total },
                    { label: "HTML 文件", value: getChatHistoryStats().htmlFiles },
                    { label: "JSON 文件", value: getChatHistoryStats().jsonFiles },
                    { label: "总大小", value: getChatHistoryStats().totalSize },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-neutral-600">{s.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-neutral-900">{s.value}</p>
                    </motion.div>
                  ))}
                </motion.section>

                {/* Chat History List */}
                {chatHistoryFiles.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-full bg-neutral-100">
                        <MessageCircle className="w-8 h-8 text-neutral-400" />
                      </div>
                      <div>
                        <p className="text-neutral-700 font-medium">暂无聊天记录</p>
                        <p className="text-neutral-500 mt-1">完成导出任务后，记录将在此处显示</p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    className="space-y-2"
                    variants={STAG.container}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    {chatHistoryFiles.map((file) => {
                      // 生成头像URL
                      const avatarUrl = file.chatType === 'group' 
                        ? `https://p.qlogo.cn/gh/${file.chatId}/${file.chatId}/640/`
                        : `https://q1.qlogo.cn/g?b=qq&nk=${file.chatId}&s=640`;
                      
                      // 提取文件格式
                      const getFileFormat = (fileName: string) => {
                        const ext = fileName.toLowerCase().split('.').pop();
                        if (ext === 'html' || ext === 'htm') return { type: 'html', label: 'HTML', color: 'bg-blue-100 text-blue-700 border-blue-200' };
                        if (ext === 'json') return { type: 'json', label: 'JSON', color: 'bg-green-100 text-green-700 border-green-200' };
                        if (ext === 'zip') return { type: 'zip', label: 'ZIP', color: 'bg-purple-100 text-purple-700 border-purple-200' };
                        return { type: 'unknown', label: ext?.toUpperCase() || 'FILE', color: 'bg-neutral-100 text-neutral-700 border-neutral-200' };
                      };
                      const fileFormat = getFileFormat(file.fileName);
                      
                      return (
                        <motion.div
                          key={file.fileName}
                          className="group rounded-2xl border border-neutral-200 bg-white/70 hover:bg-white hover:border-neutral-300 transition-all duration-200 cursor-pointer"
                          variants={STAG.item}
                          whileHover={{ y: -1, transition: { duration: DUR.fast, ease: EASE.out } }}
                          whileTap={{ scale: 0.995, transition: { duration: DUR.fast, ease: EASE.inOut } }}
                          onClick={() => handleOpenFilePathModal(file.filePath, file.displayName || file.sessionName || file.chatId, file.fileName)}
                        >
                          <div className="flex items-center gap-4 p-4">
                            {/* Avatar */}
                            <div className="flex-shrink-0">
                              <Avatar className="w-12 h-12 rounded-xl overflow-hidden border border-neutral-200">
                                <AvatarImage
                                  src={avatarUrl}
                                  alt={file.displayName || file.sessionName || file.chatId}
                                />
                                <AvatarFallback className="rounded-xl bg-neutral-100">
                                  {file.chatType === 'group' ? (
                                    <Users className="w-6 h-6 text-neutral-600" />
                                  ) : (
                                    <User className="w-6 h-6 text-neutral-600" />
                                  )}
                                </AvatarFallback>
                              </Avatar>
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate font-semibold text-neutral-900 text-lg">
                                  {file.displayName || file.sessionName || `${file.chatType === 'group' ? '群组' : '好友'} ${file.chatId}`}
                                </h3>
                                <Badge variant="outline" className={`rounded-full text-xs border ${fileFormat.color}`}>
                                  {fileFormat.label}
                                </Badge>
                                {file.isScheduled && (
                                  <Badge variant="outline" className="rounded-full text-neutral-700 border-neutral-300 bg-neutral-50 text-xs">
                                    定时
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="mt-1 flex items-center gap-4 text-sm text-neutral-600">
                                <div className="flex items-center gap-1">
                                  <MessageCircle className="w-4 h-4" />
                                  <span>{file.messageCount || 0} 条消息</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Clock className="w-4 h-4" />
                                  <span>{new Date(file.createTime).toLocaleDateString()}</span>
                                </div>
                              </div>

                              <div className="mt-2 text-xs text-neutral-500">
                                {file.chatType === 'group' ? '群组' : '好友'} • {file.chatId}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <motion.div whileTap={{ scale: 0.95 }}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-8 rounded-full p-0 text-neutral-500 hover:text-neutral-700 hover:border-neutral-400"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm(`确定要删除"${file.displayName || file.sessionName || file.chatId}"的聊天记录吗？`)) {
                                      const success = await deleteChatHistoryFile(file.fileName);
                                      if (success) {
                                        chatHistoryLoadedRef.current = false;
                                      }
                                    }
                                  }}
                                  title="删除聊天记录"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </motion.div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeTab === "stickers" && (
              <motion.div key="tab-stickers" {...fadeSlide} className="space-y-10 pt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">表情包管理</h2>
                    <p className="text-neutral-600 mt-1">导出收藏的表情、市场表情包和系统表情包</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button
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
                        variant="outline"
                        className="rounded-full"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {stickerPacksLoading ? "加载中..." : "刷新列表"}
                      </Button>
                    </motion.div>
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={handleExportAllStickerPacks}
                        disabled={stickerPacksLoading || stickerPacks.length === 0}
                        className="rounded-full"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        导出所有
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {/* Stats */}
                <motion.section
                  className="grid grid-cols-1 sm:grid-cols-4 gap-3"
                  variants={STAG.container}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    { label: "总表情包数", value: getStickerPacksStats().total, icon: Package },
                    { label: "收藏表情", value: getStickerPacksStats().favorite_emoji, icon: Star },
                    { label: "市场表情包", value: getStickerPacksStats().market_pack, icon: Sticker },
                    { label: "系统表情包", value: getStickerPacksStats().system_pack, icon: Smile },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <div className="flex items-center gap-2">
                        <s.icon className="w-4 h-4 text-neutral-500" />
                        <p className="text-sm text-neutral-600">{s.label}</p>
                      </div>
                      <p className="mt-2 text-2xl font-semibold text-neutral-900">{s.value}</p>
                    </motion.div>
                  ))}
                </motion.section>

                {/* Sticker Packs List */}
                {stickerPacks.length === 0 ? (
                  <motion.div
                    className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-14 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-full bg-neutral-100">
                        <Smile className="w-8 h-8 text-neutral-400" />
                      </div>
                      <div>
                        <p className="text-neutral-700 font-medium">暂无表情包</p>
                        <p className="text-neutral-500 mt-1">点击"刷新列表"加载表情包数据</p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    className="space-y-2"
                    variants={STAG.container}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    {stickerPacks.map((pack) => {
                      const getPackIcon = () => {
                        switch (pack.packType) {
                          case 'favorite_emoji':
                            return <Star className="w-5 h-5 text-yellow-600" />
                          case 'market_pack':
                            return <Sticker className="w-5 h-5 text-blue-600" />
                          case 'system_pack':
                            return <Smile className="w-5 h-5 text-purple-600" />
                          default:
                            return <Package className="w-5 h-5 text-neutral-600" />
                        }
                      }

                      const getPackTypeText = () => {
                        switch (pack.packType) {
                          case 'favorite_emoji':
                            return '收藏表情'
                          case 'market_pack':
                            return '市场表情包'
                          case 'system_pack':
                            return '系统表情包'
                          default:
                            return '未知类型'
                        }
                      }

                      return (
                        <motion.div
                          key={pack.packId}
                          className="rounded-2xl border border-neutral-200 bg-white/70 hover:bg-white hover:border-neutral-300 transition-all duration-200"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: DUR.normal, ease: EASE.inOut }}
                          {...hoverLift}
                        >
                          <div className="flex items-center gap-4 p-5">
                            {/* Icon */}
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 border border-neutral-200 flex items-center justify-center">
                                {getPackIcon()}
                              </div>
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate font-semibold text-neutral-900 text-lg">
                                  {pack.packName}
                                </h3>
                                <Badge variant="outline" className="rounded-full text-xs">
                                  {getPackTypeText()}
                                </Badge>
                              </div>
                              
                              <div className="mt-1 flex items-center gap-4 text-sm text-neutral-600">
                                <div className="flex items-center gap-1">
                                  <Smile className="w-4 h-4" />
                                  <span>{pack.stickerCount} 个表情</span>
                                </div>
                                {pack.description && (
                                  <div className="flex items-center gap-1">
                                    <span className="truncate">{pack.description}</span>
                                  </div>
                                )}
                              </div>

                              {pack.packType === 'market_pack' && pack.rawData?.packId && (
                                <div className="mt-2 text-xs text-neutral-500">
                                  包ID: {pack.rawData.packId}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              <motion.div whileTap={{ scale: 0.95 }}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-full"
                                  onClick={() => handleExportStickerPack(pack.packId, pack.packName)}
                                  disabled={stickerPacksLoading}
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  导出
                                </Button>
                              </motion.div>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                )}

                {/* Export History */}
                <motion.section 
                  id="sticker-export-history"
                  className="space-y-4"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 1 }}
                >
                  <div>
                    <h3 className="text-lg font-semibold text-neutral-900">导出记录</h3>
                    <p className="text-sm text-neutral-600 mt-1">最近的表情包导出历史</p>
                  </div>

                  {stickerExportRecords.length === 0 ? (
                    <motion.div
                      className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 py-10 text-center"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <Clock className="w-6 h-6 text-neutral-400" />
                        <p className="text-neutral-600">暂无导出记录</p>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="space-y-2">
                      {stickerExportRecords.slice(0, 10).map((record) => (
                        <motion.div
                          key={record.id}
                          className={`rounded-xl border ${
                            record.success 
                              ? 'border-neutral-200 bg-white/70 hover:bg-white' 
                              : 'border-neutral-200 bg-neutral-50/50'
                          } transition-all duration-200`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: DUR.normal, ease: EASE.inOut }}
                          whileHover={{ scale: 1.005, transition: { duration: DUR.fast, ease: EASE.inOut } }}
                        >
                          <div className="flex items-center gap-4 p-4">
                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium text-neutral-900">
                                  {record.packName || '未命名'}
                                </h4>
                                <Badge variant="outline" className="text-xs text-neutral-600 border-neutral-300">
                                  {record.type === 'all' ? '全部导出' : '单包导出'}
                                </Badge>
                                {!record.success && (
                                  <Badge variant="outline" className="text-xs text-neutral-600 border-neutral-300">
                                    失败
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-1 flex items-center gap-3 text-sm text-neutral-600">
                                <div className="flex items-center gap-1">
                                  <Package className="w-3 h-3" />
                                  <span>{record.packCount} 个表情包</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Smile className="w-3 h-3" />
                                  <span>{record.stickerCount} 个表情</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{new Date(record.exportTime).toLocaleString('zh-CN')}</span>
                                </div>
                              </div>
                              {record.success && record.exportPath && (
                                <div className="mt-2 text-xs text-neutral-500 font-mono truncate">
                                  {record.exportPath}
                                </div>
                              )}
                              {!record.success && record.error && (
                                <div className="mt-2 text-xs text-neutral-600">
                                  错误: {record.error}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            {record.success && record.exportPath && (
                              <div className="flex-shrink-0">
                                <motion.div whileTap={{ scale: 0.95 }}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8"
                                    onClick={() => {
                                      navigator.clipboard.writeText(record.exportPath)
                                      addNotification('success', '已复制', '路径已复制到剪贴板')
                                    }}
                                  >
                                    <Copy className="w-3 h-3 mr-1" />
                                    复制路径
                                  </Button>
                                </motion.div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.section>
              </motion.div>
            )}

            {activeTab === "about" && (
              <motion.div key="tab-about" {...fadeSlide} className="min-h-[80vh] flex flex-col items-center justify-center space-y-16 pt-20 pb-20">
                {/* Hero Section */}
                <div className="text-center space-y-8 max-w-4xl">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-neutral-400 tracking-wider uppercase">
                        About
                      </div>
                      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
                        QQ 聊天记录导出工具
                      </h1>
                    </div>
                    <p className="text-neutral-600 leading-relaxed max-w-2xl mx-auto">
                      简单高效的聊天记录导出解决方案
                    </p>
                  </div>

                  {/* NapCat Tribute */}
                  <div className="pt-12 pb-8">
                    <div className="flex items-center justify-center gap-8">
                      <div className="text-left space-y-4 max-w-md">
                        <h2 className="text-2xl font-medium text-neutral-900">致谢 NapCat</h2>
                        <p className="text-neutral-600 leading-relaxed">
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
                  <h3 className="text-lg font-medium text-neutral-900">使用声明</h3>
                  <div className="space-y-3 text-sm text-neutral-600 max-w-2xl mx-auto leading-relaxed">
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
      <Dialog open={isFilePathModalOpen} onOpenChange={setIsFilePathModalOpen}>
        <DialogContent 
          overlayClassName="bg-white/60 backdrop-blur-xl"
          className="w-full h-full max-w-full max-h-full p-0 m-0"
        >
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white border-neutral-200"
              onClick={() => {
                if (selectedFile) {
                  const link = document.createElement('a');
                  link.href = `/api/exports/files/${selectedFile.fileName}`;
                  link.download = selectedFile.fileName;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
              }}
            >
              <Download className="w-4 h-4 mr-1" />
              <span className="text-xs">下载</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white border-neutral-200"
              onClick={() => setIsFilePathModalOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <DialogHeader className="px-6 py-4 border-b bg-white">
            <DialogTitle className="flex items-center gap-3">
              <FileText className="w-5 h-5" />
              <span>{selectedFile?.sessionName || "聊天记录"}</span>
              {selectedFile && (
                <Badge variant="outline" className="text-xs">
                  {selectedFile.fileName.toLowerCase().endsWith('.html') ? 'HTML' : 
                   selectedFile.fileName.toLowerCase().endsWith('.json') ? 'JSON' : 
                   selectedFile.fileName.toLowerCase().endsWith('.zip') ? 'ZIP' : 'FILE'}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden">
            {selectedFile && (
              <iframe
                src={`/api/exports/files/${selectedFile.fileName}/preview`}
                className="w-full h-[calc(100vh-120px)] border-0"
                title={`预览 ${selectedFile.sessionName}`}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
