"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { GettingStarted } from "@/components/ui/getting-started"
import { TaskWizard } from "@/components/ui/task-wizard"
import { ScheduledExportWizard } from "@/components/ui/scheduled-export-wizard"
import { ExecutionHistoryModal } from "@/components/ui/execution-history-modal"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Download,
  Settings,
  Activity,
  FileText,
  Users,
  AlertCircle,
  CheckCircle,
  Clock,
  X,
  RefreshCw,
  Wifi,
  User,
  ArrowRight,
  Circle,
  Play,
  Heart,
  Star,
  ExternalLink,
  Github,
  Calendar,
  Timer,
  ToggleLeft,
  ToggleRight,
  History,
  Zap,
} from "lucide-react"
import type { CreateTaskForm, CreateScheduledExportForm } from "@/types/api"
import { useQCE } from "@/hooks/use-qce"
import { useScheduledExports } from "@/hooks/use-scheduled-exports"

export default function QCEDashboard() {
  const [activeTab, setActiveTabState] = useState("dashboard")
  const [isTaskWizardOpen, setIsTaskWizardOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<Partial<CreateTaskForm> | undefined>()
  const [isScheduledExportWizardOpen, setIsScheduledExportWizardOpen] = useState(false)
  const [selectedScheduledPreset, setSelectedScheduledPreset] = useState<Partial<CreateScheduledExportForm> | undefined>()
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<{id: string, name: string} | null>(null)
  const tasksLoadedRef = useRef(false)
  const scheduledExportsLoadedRef = useRef(false)

  // Custom setActiveTab with localStorage persistence
  const setActiveTab = (tabId: string) => {
    setActiveTabState(tabId)
    if (typeof window !== "undefined") {
      localStorage.setItem("qce-active-tab", tabId)
    }
  }

  // Restore active tab from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTab = localStorage.getItem("qce-active-tab")
      if (savedTab && ["dashboard", "sessions", "tasks", "scheduled", "settings"].includes(savedTab)) {
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

  const handleOpenTaskWizard = (preset?: Partial<CreateTaskForm>) => {
    setSelectedPreset(preset)
    setIsTaskWizardOpen(true)
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

  // Auto-load tasks when switching to tasks tab (only once)
  useEffect(() => {
    if (activeTab === "tasks" && !tasksLoadedRef.current) {
      console.log("[QCE] Loading tasks for tasks tab...")
      loadTasks().then(() => {
        tasksLoadedRef.current = true
      })
    }
  }, [activeTab, loadTasks])
  
  // Auto-load scheduled exports when switching to scheduled tab (only once)
  useEffect(() => {
    if (activeTab === "scheduled" && !scheduledExportsLoadedRef.current) {
      console.log("[QCE] Loading scheduled exports for scheduled tab...")
      loadScheduledExports().then(() => {
        scheduledExportsLoadedRef.current = true
      })
    }
  }, [activeTab, loadScheduledExports])
  
  // Reset tasks loaded flag when manually refreshing
  const handleLoadTasks = async () => {
    tasksLoadedRef.current = false
    await loadTasks()
    tasksLoadedRef.current = true
  }

  // Reset scheduled exports loaded flag when manually refreshing
  const handleLoadScheduledExports = async () => {
    scheduledExportsLoadedRef.current = false
    await loadScheduledExports()
    scheduledExportsLoadedRef.current = true
  }

  // Handle task creation and refresh list
  const handleCreateTask = async (form: CreateTaskForm) => {
    const success = await createTask(form)
    if (success) {
      // 重置加载标志，以便任务列表能显示新任务
      tasksLoadedRef.current = false
    }
    return success
  }

  // Handle scheduled export creation and refresh list
  const handleCreateScheduledExport = async (form: CreateScheduledExportForm) => {
    const success = await createScheduledExport(form)
    if (success) {
      // 重置加载标志，以便定时导出列表能显示新任务
      scheduledExportsLoadedRef.current = false
    }
    return success
  }

  // Load chat data when switching to sessions tab
  useEffect(() => {
    if (activeTab === "sessions" && groups.length === 0 && friends.length === 0) {
      loadChatData()
    }
  }, [activeTab, groups.length, friends.length, loadChatData])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Clock className="w-4 h-4 text-blue-500" />
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-neutral-400" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "进行中"
      case "completed":
        return "已完成"
      case "failed":
        return "失败"
      default:
        return "等待中"
    }
  }

  const sidebarItems = [
    { id: "dashboard", label: "仪表板", icon: Activity },
    { id: "sessions", label: "会话管理", icon: Users },
    { id: "tasks", label: "导出任务", icon: FileText },
    { id: "scheduled", label: "定时导出", icon: Timer },
    { id: "settings", label: "设置", icon: Settings },
  ]

  return (
    <div className="flex flex-col min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-8 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <Image
                src="/text-logo.png"
                alt="QCE Logo"
                width={120}
                height={32}
                className="h-8 w-auto"
                priority
              />
              <div>
                <p className="text-sm text-neutral-600 font-medium">Chat Export Tool v4.0.0</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-6">
              {sidebarItems.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md transition-colors ${
                      activeTab === item.id
                        ? "bg-neutral-100 text-neutral-900"
                        : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {wsConnected ? (
              systemInfo?.napcat.online ? (
                <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                  <Wifi className="w-3 h-3 mr-2" />
                  在线
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">
                  <AlertCircle className="w-3 h-3 mr-2" />
                  QQ离线
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                <AlertCircle className="w-3 h-3 mr-2" />
                未连接
              </Badge>
            )}

            <button
              onClick={refreshSystemInfo}
              className="text-neutral-500 hover:text-neutral-700 p-2 rounded-md transition-colors"
              title="刷新系统状态"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-8 py-3">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 px-8 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Dashboard Tab */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-light text-neutral-900 mb-2">仪表板</h2>
                <p className="text-neutral-600">轻松备份您的聊天记录</p>
              </div>

              <GettingStarted
                wsConnected={wsConnected}
                qqOnline={systemInfo?.napcat.online || false}
                hasGroups={groups.length > 0}
                hasFriends={friends.length > 0}
                hasTasks={tasks.length > 0}
                onLoadChatData={loadChatData}
                onCreateTask={() => handleOpenTaskWizard()}
              />

              {/* System Status Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">系统状态</CardTitle>
                    {wsConnected && systemInfo?.napcat.online ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-yellow-500" />
                    )}
                  </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">WebSocket</span>
                      <span className={wsConnected ? "text-green-600" : "text-red-600"}>
                        {wsConnected ? "已连接" : "未连接"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">QQ状态</span>
                      <span className={systemInfo?.napcat.online ? "text-green-600" : "text-yellow-600"}>
                        {systemInfo?.napcat.online ? "在线" : "离线"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">版本</span>
                      <span className="text-neutral-900">{systemInfo?.version || "4.0.0"}</span>
                    </div>
                    {systemInfo?.napcat.selfInfo && (
                      <div className="flex justify-between">
                        <span className="text-neutral-600">账号</span>
                        <span className="text-neutral-900">{systemInfo.napcat.selfInfo.nick}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">导出任务</CardTitle>
                    <FileText className="w-5 h-5 text-neutral-400" />
                  </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">总任务</span>
                      <span className="text-neutral-900">{getTaskStats().total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">进行中</span>
                      <span className="text-blue-600">{getTaskStats().running}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">已完成</span>
                      <span className="text-green-600">{getTaskStats().completed}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">会话统计</CardTitle>
                    <Users className="w-5 h-5 text-neutral-400" />
                  </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">群组</span>
                      <span className="text-neutral-900">{groups.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">好友</span>
                      <span className="text-neutral-900">{friends.length}</span>
                    </div>
                  </CardContent>
                </Card>
                  </div>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>快速操作</CardTitle>
                  <CardDescription>选择一个操作开始使用QCE工具</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Button
                      variant="outline"
                      className="justify-start h-auto p-4"
                      onClick={() => setActiveTab("sessions")}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <Users className="w-6 h-6 text-blue-600" />
                        <div className="text-left">
                          <div className="font-medium">浏览会话</div>
                          <div className="text-sm text-neutral-600">查看群组和好友列表</div>
                </div>
              </div>
                    </Button>

                    <Button
                      variant="outline"
                      className="justify-start h-auto p-4"
                      onClick={() => handleOpenTaskWizard()}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <FileText className="w-6 h-6 text-green-600" />
                        <div className="text-left">
                          <div className="font-medium">创建任务</div>
                          <div className="text-sm text-neutral-600">导出聊天记录</div>
                </div>
                      </div>
                    </Button>

                      <Button
                      variant="outline"
                      className="justify-start h-auto p-4"
                      onClick={() => setActiveTab("tasks")}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <Download className="w-6 h-6 text-purple-600" />
                        <div className="text-left">
                          <div className="font-medium">查看任务</div>
                          <div className="text-sm text-neutral-600">管理导出任务</div>
                        </div>
                      </div>
                      </Button>
                    </div>
                </CardContent>
              </Card>

              {/* Recent Tasks Preview */}
              {tasks.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>最近任务</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveTab("tasks")}
                      >
                        查看全部
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {tasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="flex items-center justify-between p-3 border border-neutral-100 rounded-lg hover:border-neutral-200 hover:bg-neutral-50 transition-all duration-200">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium text-neutral-900 truncate text-sm">{task.sessionName}</h4>
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  task.status === "completed"
                                    ? "text-green-600 border-green-200 bg-green-50"
                                    : task.status === "running"
                                      ? "text-blue-600 border-blue-200 bg-blue-50"
                                      : task.status === "failed"
                                        ? "text-red-600 border-red-200 bg-red-50"
                                        : "text-neutral-600 border-neutral-200"
                                }`}
                              >
                                {getStatusText(task.status)}
                              </Badge>
                          </div>
                            <div className="flex items-center gap-3 text-xs text-neutral-500">
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount && <span>{task.messageCount.toLocaleString()}条</span>}
                              {(task.startTime || task.endTime) && (
                                <span className="font-medium">
                                  {task.startTime && task.endTime 
                                    ? `${new Date(task.startTime * 1000).toLocaleDateString()} ~ ${new Date(task.endTime * 1000).toLocaleDateString()}`
                                    : task.startTime 
                                      ? `从 ${new Date(task.startTime * 1000).toLocaleDateString()}`
                                      : `到 ${new Date(task.endTime! * 1000).toLocaleDateString()}`
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 ml-3">
                          {task.status === "running" && (
                            <>
                              <Progress value={task.progress} className="w-16 h-1.5" />
                              <span className="text-xs text-blue-600 min-w-[2.5rem] text-right font-medium">
                                {task.progress}%
                              </span>
                            </>
                          )}
                          {task.status === "completed" && (
                            <Button size="sm" variant="outline" onClick={() => downloadTask(task)} className="h-7">
                              <Download className="w-3 h-3 mr-1" />
                              下载
                            </Button>
                          )}
                        </div>
                    </div>
                    ))}
                  </CardContent>
                </Card>
                  )}
            </div>
          )}

          {/* Sessions Tab */}
          {activeTab === "sessions" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-light text-neutral-900 mb-2">会话管理</h2>
                  <p className="text-neutral-600">浏览您的QQ群组和好友列表，点击"导出聊天记录"开始导出</p>
                </div>
                <Button
                  onClick={loadChatData}
                  disabled={isLoading}
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {isLoading ? "加载中..." : "刷新列表"}
                    </Button>
              </div>

              {(groups.length === 0 && friends.length === 0) ? (
                <EmptyState
                  icon={<Users className="w-16 h-16" />}
                  title={isLoading ? "正在加载..." : "暂无会话数据"}
                  description={isLoading 
                    ? "正在从QQ获取您的群组和好友列表，请稍等..."
                    : "无法获取到您的群组和好友信息。请确保QQ正常连接，然后点击\"刷新列表\"重试。"
                  }
                  action={!isLoading ? {
                    label: "刷新列表",
                    onClick: loadChatData
                  } : undefined}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Groups */}
                  {groups.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Users className="w-5 h-5" />
                          群组 ({groups.length})
                        </CardTitle>
                        <CardDescription>点击任意群组开始导出聊天记录</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                        {groups.map((group) => (
                          <div
                            key={group.groupCode}
                            className="flex items-center gap-3 p-3 border border-neutral-100 rounded-lg hover:bg-neutral-50 transition-colors"
                          >
                            <Avatar className="w-12 h-12">
                              <AvatarImage 
                                src={group.avatarUrl || `https://p.qlogo.cn/gh/${group.groupCode}/${group.groupCode}/640/`} 
                                alt={group.groupName} 
                              />
                              <AvatarFallback>
                                {group.groupName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-neutral-900 truncate">
                                {group.groupName}
                              </h3>
                              <div className="flex items-center gap-2 text-sm text-neutral-600">
                                <span>{group.memberCount} 成员</span>
                                <span className="text-neutral-400">•</span>
                                <span className="font-mono text-xs">{group.groupCode}</span>
                        </div>
                      </div>

                            <Button
                              size="sm"
                              onClick={() => handleOpenTaskWizard({
                                chatType: 2,
                                peerUid: group.groupCode,
                                sessionName: group.groupName,
                              })}
                            >
                              导出聊天记录
                            </Button>
                      </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Friends */}
                  {friends.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <User className="w-5 h-5" />
                          好友 ({friends.length})
                        </CardTitle>
                        <CardDescription>点击任意好友开始导出聊天记录</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                        {friends.map((friend) => (
                          <div
                            key={friend.uid}
                            className="flex items-center gap-3 p-3 border border-neutral-100 rounded-lg hover:bg-neutral-50 transition-colors"
                          >
                            <Avatar className="w-12 h-12">
                              <AvatarImage 
                                src={friend.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${friend.uin}&s=640`} 
                                alt={friend.remark || friend.nick} 
                              />
                              <AvatarFallback>
                                {(friend.remark || friend.nick).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium text-neutral-900 truncate">
                                  {friend.remark || friend.nick}
                                </h3>
                                {friend.isOnline && (
                                  <div className="flex items-center gap-1">
                                    <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-sm text-neutral-600">
                                <span className="font-mono text-xs">{friend.uin}</span>
                                {friend.remark && friend.nick !== friend.remark && (
                                  <>
                                    <span className="text-neutral-400">•</span>
                                    <span className="text-xs text-neutral-500 truncate">{friend.nick}</span>
                                  </>
                                )}
                              </div>
                      </div>

                            <Button
                              size="sm"
                              onClick={() => handleOpenTaskWizard({
                                chatType: 1,
                                peerUid: friend.uid,
                                sessionName: friend.remark || friend.nick,
                              })}
                            >
                              导出聊天记录
                            </Button>
                        </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                        </div>
              )}
                      </div>
          )}

          {/* Tasks Tab */}
          {activeTab === "tasks" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-light text-neutral-900 mb-2">导出任务</h2>
                  <p className="text-neutral-600">查看和管理您的所有导出任务，下载完成的文件</p>
                  <p className="text-sm text-neutral-500 mt-1">如果消息数量为0，请先尝试刷新</p>
                </div>

                <div className="flex items-center gap-2">
                      <Button
                    onClick={handleLoadTasks}
                        disabled={isLoading}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {isLoading ? "加载中..." : "刷新列表"}
                  </Button>
                  <Button 
                    onClick={() => handleOpenTaskWizard()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    新建任务
                      </Button>
                    </div>
              </div>

              {/* Tasks List */}
                {tasks.length === 0 ? (
                <EmptyState
                  icon={<FileText className="w-16 h-16" />}
                  title="暂无导出任务"
                  description="您还没有创建任何导出任务。建议先去“会话管理”查看您的群组和好友，然后选择要导出的聊天记录。您也可以直接创建新任务。"
                  action={{
                    label: "去查看会话列表",
                    onClick: () => setActiveTab("sessions")
                  }}
                />
              ) : (
                <div className="space-y-3">
                    {tasks.map((task) => (
                    <div key={task.id} className="group border border-neutral-200 rounded-lg p-4 hover:border-neutral-300 hover:shadow-sm transition-all duration-200 bg-white">
                      <div className="flex items-center justify-between">
                        {/* Left: Status + Info */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Main Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium text-neutral-900 truncate">{task.sessionName}</h3>
                            <Badge
                              variant="outline"
                                className={`text-xs ${
                                task.status === "completed"
                                    ? "text-green-600 border-green-200 bg-green-50"
                                  : task.status === "running"
                                      ? "text-blue-600 border-blue-200 bg-blue-50"
                                    : task.status === "failed"
                                        ? "text-red-600 border-red-200 bg-red-50"
                                      : "text-neutral-600 border-neutral-200"
                                }`}
                            >
                              {getStatusText(task.status)}
                            </Badge>
                        </div>

                            <div className="flex items-center gap-4 text-xs text-neutral-500">
                              <span className="font-mono">{task.peer.peerUid}</span>
                              <span>{task.format}</span>
                              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                              {task.messageCount && <span>{task.messageCount.toLocaleString()} 条消息</span>}
                              {(task.startTime || task.endTime) && (
                                <span className="font-medium">
                                  {task.startTime && task.endTime 
                                    ? `${new Date(task.startTime * 1000).toLocaleDateString()} ~ ${new Date(task.endTime * 1000).toLocaleDateString()}`
                                    : task.startTime 
                                      ? `从 ${new Date(task.startTime * 1000).toLocaleDateString()}`
                                      : `到 ${new Date(task.endTime! * 1000).toLocaleDateString()}`
                                  }
                                </span>
                              )}
                          </div>
                      </div>
                  </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2 ml-4">
                            {task.status === "completed" && (
                            <Button size="sm" variant="outline" onClick={() => downloadTask(task)} className="h-8">
                              <Download className="w-3 h-3 mr-1" />
                                下载
                </Button>
                            )}
                          
                          {(task.status === "completed" || task.status === "failed") && (
                              <Button
                                size="sm"
                                variant="outline"
                              onClick={async () => {
                                if (confirm("确定要删除这个任务吗？")) {
                                  const success = await deleteTask(task.id)
                                  if (success) {
                                    tasksLoadedRef.current = false
                                  }
                                }
                              }}
                              className="h-8 text-red-600 hover:text-red-700 hover:border-red-300"
                            >
                              <X className="w-3 h-3" />
                              </Button>
                    )}
                  </div>
                </div>

                      {/* Progress Bar (only for running tasks) */}
                        {task.status === "running" && (
                        <div className="mt-3 space-y-1">
                            <div className="flex justify-between items-center">
                            <span className="text-xs text-neutral-600">导出进度</span>
                            <span className="text-xs font-medium text-blue-600">{task.progress}%</span>
                  </div>
                          <Progress value={task.progress} className="h-1.5" />
                              </div>
                        )}

                      {/* Error Message */}
                        {task.error && (
                        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                          {task.error}
                            </div>
                        )}
                          </div>
                        ))}
                      </div>
                    )}
            </div>
          )}

          {/* Scheduled Exports Tab */}
          {activeTab === "scheduled" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-light text-neutral-900 mb-2">定时导出</h2>
                  <p className="text-neutral-600">管理自动化的聊天记录定时导出任务</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleLoadScheduledExports}
                    disabled={scheduledLoading}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {scheduledLoading ? "加载中..." : "刷新列表"}
                  </Button>
                  <Button 
                    onClick={() => handleOpenScheduledExportWizard()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Timer className="w-4 h-4 mr-2" />
                    新建定时任务
                  </Button>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-neutral-600">总任务数</p>
                        <p className="text-2xl font-bold">{getScheduledStats().total}</p>
                      </div>
                      <Calendar className="w-8 h-8 text-neutral-400" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-neutral-600">已启用</p>
                        <p className="text-2xl font-bold text-green-600">{getScheduledStats().enabled}</p>
                      </div>
                      <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-neutral-600">已禁用</p>
                        <p className="text-2xl font-bold text-neutral-500">{getScheduledStats().disabled}</p>
                      </div>
                      <X className="w-8 h-8 text-neutral-400" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-neutral-600">每日任务</p>
                        <p className="text-2xl font-bold text-blue-600">{getScheduledStats().daily}</p>
                      </div>
                      <Clock className="w-8 h-8 text-blue-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Scheduled Exports List */}
              {scheduledExports.length === 0 ? (
                <EmptyState
                  icon={<Timer className="w-16 h-16" />}
                  title="暂无定时导出任务"
                  description="您还没有创建任何定时导出任务。定时导出可以帮您自动备份聊天记录，无需手动操作。"
                  action={{
                    label: "创建首个定时任务",
                    onClick: () => handleOpenScheduledExportWizard()
                  }}
                />
              ) : (
                <div className="space-y-3">
                  {scheduledExports.map((scheduledExport) => (
                    <div 
                      key={scheduledExport.id} 
                      className="group flex items-center gap-4 px-6 py-4 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-lg shadow-sm transition-all duration-150"
                    >
                      {/* Status Dot */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        scheduledExport.enabled ? 'bg-green-500' : 'bg-neutral-300'
                      }`} />

                      {/* Main Content */}
                      <div className="flex-1 min-w-0 flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          {/* Task Name */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-neutral-900 truncate">
                                {scheduledExport.name}
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                scheduledExport.enabled 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-neutral-100 text-neutral-600'
                              }`}>
                                {scheduledExport.enabled ? '启用' : '禁用'}
                              </span>
                            </div>
                          </div>

                          {/* Schedule Info */}
                          <div className="flex items-center gap-4 text-sm text-neutral-600">
                            <span className="px-1.5 py-0.5 bg-neutral-100 rounded">
                              {scheduledExport.scheduleType === 'daily' && '每天'}
                              {scheduledExport.scheduleType === 'weekly' && '每周'}
                              {scheduledExport.scheduleType === 'monthly' && '每月'}
                              {scheduledExport.scheduleType === 'custom' && '自定义'}
                            </span>
                            <span className="font-mono">
                              {scheduledExport.format}
                            </span>
                            <span>
                              {scheduledExport.scheduleType === 'custom' && scheduledExport.cronExpression
                                ? scheduledExport.cronExpression
                                : scheduledExport.executeTime
                              }
                            </span>
                            <span>
                              {scheduledExport.timeRangeType === 'yesterday' && '昨天' ||
                               scheduledExport.timeRangeType === 'last-week' && '上周' ||
                               scheduledExport.timeRangeType === 'last-month' && '上月' ||
                               scheduledExport.timeRangeType === 'last-7-days' && '最近7天' ||
                               scheduledExport.timeRangeType === 'last-30-days' && '最近30天' ||
                               '自定义'
                              }
                            </span>
                          </div>

                          {/* Next Run */}
                          {scheduledExport.nextRun && (
                            <div className="text-sm text-blue-600 font-medium">
                              下次: {new Date(scheduledExport.nextRun).toLocaleString('zh-CN', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          )}
                        </div>

                        {/* Actions - Always visible with larger buttons */}
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleScheduledExport(scheduledExport.id, !scheduledExport.enabled)}
                            className="h-9 px-3"
                            title={scheduledExport.enabled ? "禁用任务" : "启用任务"}
                          >
                            {scheduledExport.enabled ? (
                              <>
                                <ToggleRight className="w-4 h-4 text-green-600 mr-1" />
                                <span className="text-xs text-green-600">禁用</span>
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="w-4 h-4 text-neutral-400 mr-1" />
                                <span className="text-xs text-neutral-500">启用</span>
                              </>
                            )}
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => triggerScheduledExport(scheduledExport.id)}
                            className="h-9 px-3"
                            title="立即执行一次"
                          >
                            <Zap className="w-4 h-4 text-blue-600 mr-1" />
                            <span className="text-xs text-blue-600">执行</span>
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenHistoryModal(scheduledExport.id, scheduledExport.name)}
                            className="h-9 px-3"
                            title="查看执行历史"
                          >
                            <History className="w-4 h-4 text-purple-600 mr-1" />
                            <span className="text-xs text-purple-600">历史</span>
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (confirm(`确定要删除定时任务"${scheduledExport.name}"吗？`)) {
                                const success = await deleteScheduledExport(scheduledExport.id)
                                if (success) {
                                  scheduledExportsLoadedRef.current = false
                                }
                              }
                            }}
                            className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="删除任务"
                          >
                            <X className="w-4 h-4 mr-1" />
                            <span className="text-xs">删除</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-light text-neutral-900 mb-2">设置</h2>
                <p className="text-neutral-600">查看系统信息和配置参数</p>
              </div>

              {/* Project Info Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Github className="w-5 h-5" />
                      项目信息
                    </CardTitle>
                    <a 
                      href="https://github.com/shuakami/qq-chat-exporter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      <span>GitHub</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <CardDescription>
                    QQChatExporter V4 - 免费开源的QQ聊天记录导出工具
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-neutral-600">项目名称</span>
                      <p className="font-medium">QQChatExporter V4</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">当前版本</span>
                      <p className="font-medium">v4.0.0</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">许可证</span>
                      <p className="font-medium">GPL v3</p>
                    </div>
                  </div>

                  {/* Important Declarations */}
                  <div className="space-y-4">
                    <a
                      href="https://github.com/shuakami/qq-chat-exporter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
                    >
                      <Heart className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-neutral-900 mb-1">
                          反倒卖声明
                        </h4>
                        <p className="text-neutral-700 text-sm leading-relaxed">
                          本软件完全免费且开源！如果您是花钱购买的，请立即要求退款并举报卖家。
                          我们从未授权任何个人或组织销售此软件。
                        </p>
                      </div>
                    </a>

                    <a
                      href="https://github.com/shuakami/qq-chat-exporter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
                    >
                      <Star className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-neutral-900 mb-1">
                          支持我们
                        </h4>
                        <p className="text-neutral-700 text-sm leading-relaxed">
                          如果这个工具对您有帮助，请考虑给我们的GitHub仓库点个Star！
                          您的支持是我们持续改进的动力。
                        </p>
                      </div>
                    </a>

                    <div className="flex items-start gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                      <Github className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-neutral-900 mb-1">
                          开源地址
                        </h4>
                        <a 
                          href="https://github.com/shuakami/qq-chat-exporter"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-700 text-sm hover:text-neutral-800 underline break-all"
                        >
                          https://github.com/shuakami/qq-chat-exporter
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Features */}
                  <div>
                    <h4 className="font-medium text-neutral-900 mb-3">主要特性</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-neutral-600">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>支持多种导出格式 (JSON/HTML/TXT)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>定时导出任务</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>现代化Web界面</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>完全免费开源</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* User Info Card */}
              {systemInfo?.napcat.selfInfo && (
                <Card>
                  <CardHeader>
                    <CardTitle>当前账号</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <Avatar className="w-16 h-16">
                        <AvatarImage 
                          src={systemInfo.napcat.selfInfo.avatarUrl || 
                               `https://q1.qlogo.cn/g?b=qq&nk=${systemInfo.napcat.selfInfo.uin}&s=640`}
                          alt={systemInfo.napcat.selfInfo.nick} 
                        />
                        <AvatarFallback className="text-lg">
                          {systemInfo.napcat.selfInfo.nick.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="text-lg font-medium text-neutral-900">
                          {systemInfo.napcat.selfInfo.nick}
                        </h3>
                        <p className="text-neutral-600">QQ: {systemInfo.napcat.selfInfo.uin}</p>
                        {systemInfo.napcat.selfInfo.longNick && (
                          <p className="text-sm text-neutral-500 mt-1">
                            {systemInfo.napcat.selfInfo.longNick}
                          </p>
                        )}
                      </div>
                            </div>
                  </CardContent>
                </Card>
              )}

              {/* System Info */}
              <Card>
                <CardHeader>
                  <CardTitle>系统信息</CardTitle>
                </CardHeader>
                <CardContent>
                  {systemInfo ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-3">
                      <div>
                            <span className="text-neutral-600">工具版本</span>
                            <p className="font-medium">{systemInfo.version}</p>
                      </div>
                      <div>
                            <span className="text-neutral-600">NapCat版本</span>
                            <p className="font-medium">{systemInfo.napcat.version}</p>
                      </div>
                      <div>
                            <span className="text-neutral-600">Node.js版本</span>
                            <p className="font-medium">{systemInfo.runtime.nodeVersion}</p>
                      </div>
                    </div>

                        <div className="space-y-3">
                          <div>
                            <span className="text-neutral-600">运行平台</span>
                            <p className="font-medium">
                              {systemInfo.runtime.platform}
                              {systemInfo.runtime.arch && ` (${systemInfo.runtime.arch})`}
                            </p>
                          </div>
                          <div>
                            <span className="text-neutral-600">运行时间</span>
                            <p className="font-medium">
                              {Math.floor(systemInfo.runtime.uptime / 3600)}小时 
                              {Math.floor((systemInfo.runtime.uptime % 3600) / 60)}分钟
                            </p>
                          </div>
                          {systemInfo.runtime.memory && (
                            <div>
                              <span className="text-neutral-600">内存使用</span>
                              <p className="font-medium">
                                {Math.round(systemInfo.runtime.memory.heapUsed / 1024 / 1024)}MB
                              </p>
                        </div>
                          )}
                          </div>
                      </div>
                      
                      {systemInfo.napcat.selfInfo?.qqLevel && (
                        <div className="pt-4 border-t border-neutral-200">
                          <span className="text-neutral-600 text-sm">QQ等级</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-yellow-600">☀ {systemInfo.napcat.selfInfo.qqLevel.sunNum}</span>
                            <span className="text-blue-600">🌙 {systemInfo.napcat.selfInfo.qqLevel.moonNum}</span>
                            <span className="text-purple-600">⭐ {systemInfo.napcat.selfInfo.qqLevel.starNum}</span>
                            {systemInfo.napcat.selfInfo.vipFlag && (
                              <Badge variant="outline" className="text-yellow-600 border-yellow-200">
                                VIP{systemInfo.napcat.selfInfo.vipLevel}
                              </Badge>
                    )}
                  </div>
                      </div>
                    )}
                  </div>
                ) : (
                    <div className="text-center py-8">
                      <RefreshCw className="w-8 h-8 text-neutral-300 mx-auto mb-2 animate-spin" />
                  <p className="text-neutral-500">加载系统信息中...</p>
            </div>
          )}
                </CardContent>
              </Card>

              {/* Help Section */}
              <Card>
                <CardHeader>
                  <CardTitle>使用说明</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                        <h4 className="font-medium text-neutral-900 mb-2">基本流程</h4>
                        <ol className="space-y-1 text-neutral-600">
                          <li>1. 确保QQ在线状态</li>
                          <li>2. 在"会话管理"中浏览群组/好友</li>
                          <li>3. 点击"导出聊天记录"创建任务</li>
                          <li>4. 等待导出完成后下载文件</li>
                        </ol>
              </div>

                      <div>
                        <h4 className="font-medium text-neutral-900 mb-2">导出格式说明</h4>
                        <ul className="space-y-1 text-neutral-600">
                          <li><strong>JSON</strong> - 结构化数据，便于程序处理</li>
                          <li><strong>HTML</strong> - 网页格式，便于查看和打印</li>
                          <li><strong>TXT</strong> - 纯文本格式，兼容性最好</li>
                        </ul>
                      </div>
                      </div>
                      </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Footer with Anti-Resale Declaration */}
      <footer className="bg-white border-t border-neutral-200 mt-8">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Left Side - Project Info */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Image
                  src="/text-logo.png"
                  alt="QCE Logo"
                  width={80}
                  height={20}
                  className="h-5 w-auto opacity-80"
                />
                <div className="text-sm text-neutral-600">
                  <span className="font-medium">QQChatExporter</span>
                  <span className="mx-2">•</span>
                  <span>v4.0.0</span>
                </div>
              </div>
              
              <a 
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 transition-colors"
              >
                <Github className="w-4 h-4" />
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Right Side - Declaration */}
            <div className="flex items-center gap-6 text-center md:text-right">
              <a
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
              >
                <Heart className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-neutral-700 font-medium">
                    免费开源项目！如果您是买来的，请立即退款！
                  </p>
                </div>
              </a>
              
              <a
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
              >
                <Star className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-neutral-700 font-medium">
                    如果有帮助到您，欢迎给我点个Star~
                  </p>
                </div>
              </a>
            </div>
          </div>
          
          {/* Mobile Layout */}
          <div className="block md:hidden mt-4 pt-4 border-t border-neutral-100">
            <div className="flex flex-col gap-3 text-center">
              <a
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
              >
                <Heart className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-neutral-700 font-medium">
                  免费开源项目！如果您是买来的，请立即退款！
                </p>
              </a>
              
              <a
                href="https://github.com/shuakami/qq-chat-exporter"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg hover:shadow-sm transition-all cursor-pointer"
              >
                <Star className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <p className="text-sm text-neutral-700 font-medium">
                  如果有帮助到您，欢迎给我点个Star~
                </p>
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Task Wizard */}
      <TaskWizard
        isOpen={isTaskWizardOpen}
        onClose={handleCloseTaskWizard}
        onSubmit={handleCreateTask}
        isLoading={isLoading}
        prefilledData={selectedPreset}
        groups={groups}
        friends={friends}
        onLoadData={loadChatData}
      />

      {/* Scheduled Export Wizard */}
      <ScheduledExportWizard
        isOpen={isScheduledExportWizardOpen}
        onClose={handleCloseScheduledExportWizard}
        onSubmit={handleCreateScheduledExport}
        isLoading={scheduledLoading}
        prefilledData={selectedScheduledPreset}
        groups={groups}
        friends={friends}
        onLoadData={loadChatData}
      />

      {/* Execution History Modal */}
      {selectedHistoryTask && (
        <ExecutionHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={handleCloseHistoryModal}
          scheduledExportId={selectedHistoryTask.id}
          taskName={selectedHistoryTask.name}
          onGetHistory={getExecutionHistory}
        />
      )}
    </div>
  )
}
