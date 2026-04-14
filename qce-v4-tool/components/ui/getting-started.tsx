"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"
import { Button } from "./button"
import { Badge } from "./badge"
import { CheckCircle, Circle, ArrowRight, Wifi, AlertCircle } from "lucide-react"

interface Step {
  id: string
  title: string
  description: string
  completed: boolean
  action?: () => void
  actionText?: string
}

interface GettingStartedProps {
  wsConnected: boolean
  qqOnline: boolean
  hasGroups: boolean
  hasFriends: boolean
  hasTasks: boolean
  onLoadChatData: () => void
  onCreateTask: () => void
}

export function GettingStarted({
  wsConnected,
  qqOnline,
  hasGroups,
  hasFriends,
  hasTasks,
  onLoadChatData,
  onCreateTask,
}: GettingStartedProps) {
  const steps: Step[] = [
    {
      id: "connection",
      title: "连接状态检查",
      description: "确保工具已连接到QQ并处于在线状态",
      completed: wsConnected && qqOnline,
    },
    {
      id: "load-data",
      title: "加载聊天数据",
      description: "获取您的群组和好友列表，这是导出聊天记录的基础",
      completed: hasGroups || hasFriends,
      action: onLoadChatData,
      actionText: "加载数据",
    },
    {
      id: "create-task",
      title: "创建导出任务",
      description: "选择要导出的群组或好友，开始您的第一个导出任务",
      completed: hasTasks,
      action: onCreateTask,
      actionText: "创建任务",
    },
  ]

  const completedSteps = steps.filter(step => step.completed).length
  const allCompleted = completedSteps === steps.length

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">快速开始</CardTitle>
            <CardDescription>
              {allCompleted 
                ? "恭喜！您已完成所有设置，现在可以正常使用所有功能了"
                : `按照以下步骤完成设置，当前进度：${completedSteps}/${steps.length}`
              }
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {wsConnected ? (
              qqOnline ? (
                <Badge variant="outline" className="text-blue-600 border-blue-200/50 bg-blue-50/50 dark:text-blue-400 dark:border-blue-800 dark:bg-blue-950/40">
                  <Wifi className="w-3 h-3 mr-1" />
                  已连接
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-200/50 bg-amber-50/50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950/40">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  QQ离线
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-red-600 border-red-200/50 bg-red-50/50 dark:text-red-400 dark:border-red-800 dark:bg-red-950/40">
                <AlertCircle className="w-3 h-3 mr-1" />
                未连接
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
              step.completed 
                ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" 
                : "bg-muted/50 border-black/[0.06] dark:border-white/[0.06]"
            }`}
          >
            <div className="flex-shrink-0">
              {step.completed ? (
                <CheckCircle className="w-5 h-5 text-blue-500" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground/60" />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  步骤 {index + 1}
                </span>
                {step.completed && (
                  <Badge variant="secondary" className="text-xs">完成</Badge>
                )}
              </div>
              <h3 className="font-medium text-foreground mt-1">
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {step.description}
              </p>
            </div>
            
            {step.action && !step.completed && (
              <Button 
                onClick={step.action}
                variant="outline"
                size="sm"
                className="flex-shrink-0 rounded-full"
              >
                {step.actionText}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        ))}
        
        {allCompleted && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-foreground">准备就绪</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  您现在可以在"会话管理"中选择要导出的群组或好友，或在"导出任务"中查看和管理您的导出任务。
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
