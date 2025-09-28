"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TaskWizard } from "@/components/ui/task-wizard"
import { ScheduledExportWizard } from "@/components/ui/scheduled-export-wizard"
import { ExecutionHistoryModal } from "@/components/ui/execution-history-modal"
import { MessagePreviewModal } from "@/components/ui/message-preview-modal"
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
  HardDrive,
  Filter,
  SortAsc,
  SortDesc,
  Copy,
  CheckCircle,
} from "lucide-react"
import type { CreateTaskForm, CreateScheduledExportForm } from "@/types/api"
import { useQCE } from "@/hooks/use-qce"
import { useScheduledExports } from "@/hooks/use-scheduled-exports"
import { useChatHistory } from "@/hooks/use-chat-history"

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
  const [selectedFile, setSelectedFile] = useState<{ filePath: string; sessionName: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const tasksLoadedRef = useRef(false)
  const scheduledExportsLoadedRef = useRef(false)
  const chatHistoryLoadedRef = useRef(false)
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
        if (savedTab && ["overview", "sessions", "tasks", "scheduled", "history", "about"].includes(savedTab)) {
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
  } = useQCE()

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

  const handleOpenFilePathModal = (filePath: string, sessionName: string) => {
    setSelectedFile({ filePath, sessionName })
    setIsFilePathModalOpen(true)
    setCopied(false)
  }

  const handleCloseFilePathModal = () => {
    setIsFilePathModalOpen(false)
    setSelectedFile(null)
    setCopied(false)
  }

  const handleCopyPath = async () => {
    if (!selectedFile) return
    
    try {
      await navigator.clipboard.writeText(`file:///${selectedFile.filePath.replace(/\\/g, '/')}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // 如果剪贴板API失败，使用fallback方法
      const textArea = document.createElement('textarea')
      textArea.value = `file:///${selectedFile.filePath.replace(/\\/g, '/')}`
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackErr) {
        console.error('复制失败:', fallbackErr)
      }
      document.body.removeChild(textArea)
    }
  }

  useEffect(() => {
    if (activeTab === "tasks" && !tasksLoadedRef.current) {
      loadTasks().then(() => {
        tasksLoadedRef.current = true
      })
    }
  }, [activeTab, loadTasks])
  
  useEffect(() => {
    if (activeTab === "scheduled" && !scheduledExportsLoadedRef.current) {
      loadScheduledExports().then(() => {
        scheduledExportsLoadedRef.current = true
      })
    }
  }, [activeTab, loadScheduledExports])
  
  useEffect(() => {
    if (activeTab === "history" && !chatHistoryLoadedRef.current) {
      loadChatHistory().then(() => {
        chatHistoryLoadedRef.current = true
      })
    }
  }, [activeTab, loadChatHistory])
  
  const handleLoadTasks = async () => {
    tasksLoadedRef.current = false
    await loadTasks()
    tasksLoadedRef.current = true
  }

  const handleLoadScheduledExports = async () => {
    scheduledExportsLoadedRef.current = false
    await loadScheduledExports()
    scheduledExportsLoadedRef.current = true
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
  const STAG = useMemo(() => makeStagger(reduceMotion ? 0 : 0.06, reduceMotion), [reduceMotion])

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
                    <p className="text-neutral-600 mt-1">浏览群组与好友，选择要导出的聊天记录</p>
                  </div>
                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button onClick={loadChatData} disabled={isLoading} variant="outline" className="rounded-full">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {isLoading ? "加载中..." : "刷新列表"}
                    </Button>
                  </motion.div>
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
                          {groups.map((group, idx) => (
                            <motion.div
                              key={group.groupCode}
                              className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 hover:bg-white transition"
                              variants={STAG.item}
                              {...hoverLift}
                            >
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
                              </div>
                            </motion.div>
                          ))}
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
                          {friends.map((friend) => (
                            <motion.div
                              key={friend.uid}
                              className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 hover:bg-white transition"
                              variants={STAG.item}
                              {...hoverLift}
                            >
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
                            </motion.div>
                          ))}
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
                    { label: "总任务数", value: getScheduledStats().total, color: "" },
                    { label: "已启用", value: getScheduledStats().enabled, color: "text-green-700" },
                    { label: "已禁用", value: getScheduledStats().disabled, color: "text-neutral-700" },
                    { label: "每日任务", value: getScheduledStats().daily, color: "text-blue-700" },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-neutral-600">{s.label}</p>
                      <p className={`mt-2 text-2xl font-semibold ${s.color}`}>{s.value}</p>
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
                    { label: "总文件数", value: getChatHistoryStats().total, color: "" },
                    { label: "HTML 文件", value: getChatHistoryStats().htmlFiles, color: "" },
                    { label: "JSON 文件", value: getChatHistoryStats().jsonFiles, color: "" },
                    { label: "总大小", value: getChatHistoryStats().totalSize, color: "" },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      className="rounded-2xl border border-neutral-200 bg-white/60 p-4"
                      variants={STAG.item}
                      {...hoverLift}
                    >
                      <p className="text-sm text-neutral-600">{s.label}</p>
                      <p className={`mt-2 text-2xl font-semibold ${s.color}`}>{s.value}</p>
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
                      
                      return (
                        <motion.div
                          key={file.fileName}
                          className="group rounded-2xl border border-neutral-200 bg-white/70 hover:bg-white hover:border-neutral-300 transition-all duration-200 cursor-pointer"
                          variants={STAG.item}
                          whileHover={{ y: -1, transition: { duration: DUR.fast, ease: EASE.out } }}
                          whileTap={{ scale: 0.995, transition: { duration: DUR.fast, ease: EASE.inOut } }}
                          onClick={() => handleOpenFilePathModal(file.filePath, file.sessionName || file.chatId)}
                        >
                          <div className="flex items-center gap-4 p-4">
                            {/* Avatar */}
                            <div className="flex-shrink-0">
                              <Avatar className="w-12 h-12 rounded-xl overflow-hidden border border-neutral-200">
                                <AvatarImage
                                  src={avatarUrl}
                                  alt={file.sessionName || file.chatId}
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
                                  {file.sessionName || `${file.chatType === 'group' ? '群组' : '好友'} ${file.chatId}`}
                                </h3>
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
                                <div className="flex items-center gap-1">
                                  <HardDrive className="w-4 h-4" />
                                  <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
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
                                    if (confirm(`确定要删除"${file.sessionName || file.chatId}"的聊天记录吗？`)) {
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

      {/* File Path Modal */}
      <Dialog open={isFilePathModalOpen} onOpenChange={setIsFilePathModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-neutral-100">
                <FileText className="w-5 h-5 text-neutral-600" />
              </div>
              打开聊天记录
            </DialogTitle>
            <DialogDescription>
              受浏览器安全限制，需要您手动复制路径到浏览器地址栏访问
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            {selectedFile && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-neutral-700 mb-2">聊天记录：</p>
                  <p className="text-base text-neutral-900">{selectedFile.sessionName}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-neutral-700 mb-2">文件路径：</p>
                  <div className="relative">
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 pr-12 font-mono text-sm text-neutral-800 break-all">
                      file:///{selectedFile.filePath.replace(/\\/g, '/')}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute right-1 top-1 h-8 w-8 p-0"
                      onClick={handleCopyPath}
                    >
                      {copied ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4 text-neutral-500" />
                      )}
                    </Button>
                  </div>
                  {copied && (
                    <motion.p
                      className="text-sm text-green-600 mt-2"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                    >
                      ✓ 已复制到剪贴板
                    </motion.p>
                  )}
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">操作步骤：</h4>
                  <ol className="text-sm text-blue-800 space-y-1">
                    <li>1. 点击上方复制按钮复制文件路径</li>
                    <li>2. 在浏览器地址栏粘贴路径</li>
                    <li>3. 按回车键打开聊天记录</li>
                  </ol>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCloseFilePathModal}>
                关闭
              </Button>
              <Button onClick={handleCopyPath}>
                {copied ? '已复制' : '复制路径'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
