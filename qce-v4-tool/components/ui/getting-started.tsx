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
                <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                  <Wifi className="w-3 h-3 mr-1" />
                  已连接
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  QQ离线
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
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
            className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              step.completed 
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" 
                : "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
            }`}
          >
            <div className="flex-shrink-0">
              {step.completed ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <Circle className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                  步骤 {index + 1}
                </span>
                {step.completed && (
                  <Badge variant="secondary" className="text-xs">完成</Badge>
                )}
              </div>
              <h3 className="font-medium text-neutral-900 mt-1">
                {step.title}
              </h3>
              <p className="text-sm text-neutral-600 mt-1">
                {step.description}
              </p>
            </div>
            
            {step.action && !step.completed && (
              <Button 
                onClick={step.action}
                variant="outline"
                size="sm"
                className="flex-shrink-0"
              >
                {step.actionText}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        ))}
        
        {allCompleted && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-blue-900">准备就绪</h3>
                <p className="text-sm text-blue-700 mt-1">
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