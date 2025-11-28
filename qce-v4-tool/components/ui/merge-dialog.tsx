"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import { Layers, AlertCircle } from "lucide-react"

interface MergeTask {
  id: string
  sessionName: string
  messageCount: number
  fileName: string
  createdAt: string
  completedAt?: string
}

interface MergeProgress {
  phase: string
  current: number
  total: number
  percentage: number
  message: string
}

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: MergeTask[]
  onMerge: (config: {
    sourceTaskIds: string[]
    deleteSourceFiles: boolean
    deduplicateMessages: boolean
    outputPath?: string
  }) => Promise<void>
}

export function MergeDialog({
  open,
  onOpenChange,
  tasks,
  onMerge
}: MergeDialogProps) {
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [deduplicateMessages, setDeduplicateMessages] = useState(true)
  const [deleteSourceFiles, setDeleteSourceFiles] = useState(false)
  const [outputPath, setOutputPath] = useState("")
  const [merging, setMerging] = useState(false)
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null)

  const handleTaskSelection = (taskId: string, checked: boolean | string) => {
    const newSelection = new Set(selectedTasks)
    if (checked) {
      newSelection.add(taskId)
    } else {
      newSelection.delete(taskId)
    }
    setSelectedTasks(newSelection)
  }

  const handleMerge = async () => {
    if (selectedTasks.size < 2) {
      return
    }

    setMerging(true)
    try {
      await onMerge({
        sourceTaskIds: Array.from(selectedTasks),
        deleteSourceFiles,
        deduplicateMessages,
        outputPath: outputPath || undefined
      })
      
      // 重置状态
      setSelectedTasks(new Set())
      setMergeProgress(null)
      onOpenChange(false)
    } catch (error) {
      console.error("合并失败:", error)
    } finally {
      setMerging(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-blue-200 bg-blue-50 p-2.5">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle>合并备份资源</DialogTitle>
              <DialogDescription>
                将多个备份任务的资源合并为单一资源，便于管理和使用
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 步骤1: 选择要合并的任务 */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">选择要合并的备份任务</Label>
            <p className="text-sm text-neutral-500">至少选择2个已完成的导出任务进行合并</p>
            
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-neutral-400" />
                <p className="text-sm text-neutral-600">暂无可合并的任务</p>
                <p className="text-xs text-neutral-500 mt-1">请先完成至少2个导出任务</p>
              </div>
            ) : (
              <ScrollArea className="h-64 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="space-y-2">
                  {tasks.map(task => (
                    <div 
                      key={task.id}
                      className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                    >
                      <Checkbox 
                        checked={selectedTasks.has(task.id)}
                        onCheckedChange={(checked) => handleTaskSelection(task.id, checked)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{task.sessionName}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                          <span>{task.messageCount} 条消息</span>
                          <span>·</span>
                          <span className="truncate">{task.fileName}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            
            {selectedTasks.size > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm font-medium text-blue-900">
                  已选择 {selectedTasks.size} 个任务
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  预计消息总数: {tasks.filter(t => selectedTasks.has(t.id)).reduce((sum, t) => sum + t.messageCount, 0)} 条
                </p>
              </div>
            )}
          </div>

          {/* 步骤2: 配置合并选项 */}
          <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <Label className="text-base font-semibold">合并选项</Label>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3">
                <div>
                  <Label htmlFor="deduplicate" className="font-medium">消息去重</Label>
                  <p className="text-xs text-neutral-500 mt-1">自动移除重复的消息，节约空间</p>
                </div>
                <Switch 
                  id="deduplicate"
                  checked={deduplicateMessages}
                  onCheckedChange={setDeduplicateMessages}
                />
              </div>
              
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3">
                <div>
                  <Label htmlFor="deleteSource" className="font-medium">删除源文件</Label>
                  <p className="text-xs text-neutral-500 mt-1">合并完成后自动删除原始导出文件</p>
                </div>
                <Switch 
                  id="deleteSource"
                  checked={deleteSourceFiles}
                  onCheckedChange={setDeleteSourceFiles}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="outputPath" className="font-medium">输出路径（可选）</Label>
                <Input 
                  id="outputPath"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder="留空使用默认路径"
                  className="bg-white"
                />
                <p className="text-xs text-neutral-500">留空将使用默认输出目录</p>
              </div>
            </div>
          </div>

          {/* 进度显示 */}
          {merging && mergeProgress && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex justify-between text-sm font-medium">
                <span>{mergeProgress.phase}</span>
                <span>{mergeProgress.percentage}%</span>
              </div>
              <Progress value={mergeProgress.percentage} className="h-2" />
              <p className="text-xs text-neutral-600">{mergeProgress.message}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-neutral-200">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={merging}
          >
            取消
          </Button>
          <Button 
            onClick={handleMerge}
            disabled={selectedTasks.size < 2 || merging}
          >
            {merging ? '合并中...' : `合并 ${selectedTasks.size} 个任务`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
