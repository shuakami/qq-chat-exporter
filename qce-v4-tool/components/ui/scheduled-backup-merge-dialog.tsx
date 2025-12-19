"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Layers, AlertCircle, FolderOpen, FileText, Clock, HardDrive, ChevronDown, ChevronRight, CheckCircle2, Loader2 } from "lucide-react"

interface ScheduledBackup {
  fileName: string
  taskName: string
  timestamp: string
  createdAt: string
  fileSize: number
}

interface ScheduledTask {
  taskName: string
  backupCount: number
  backups: ScheduledBackup[]
  latestBackup: ScheduledBackup
}

interface ScheduledBackupMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduledTasks: ScheduledTask[]
  onMerge: (config: {
    sourceTaskIds: string[]  // 实际是文件名列表
    deleteSourceFiles: boolean
    deduplicateMessages: boolean
  }) => Promise<void>
}

export function ScheduledBackupMergeDialog({
  open,
  onOpenChange,
  scheduledTasks,
  onMerge
}: ScheduledBackupMergeDialogProps) {
  const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [deduplicateMessages, setDeduplicateMessages] = useState(true)
  const [deleteSourceFiles, setDeleteSourceFiles] = useState(false)
  const [merging, setMerging] = useState(false)

  const toggleTask = (taskName: string) => {
    const newExpanded = new Set(expandedTasks)
    if (newExpanded.has(taskName)) {
      newExpanded.delete(taskName)
    } else {
      newExpanded.add(taskName)
    }
    setExpandedTasks(newExpanded)
  }

  const handleBackupSelection = (fileName: string, checked: boolean | string) => {
    const newSelection = new Set(selectedBackups)
    if (checked) {
      newSelection.add(fileName)
    } else {
      newSelection.delete(fileName)
    }
    setSelectedBackups(newSelection)
  }

  const handleSelectAllInTask = (task: ScheduledTask, checked: boolean | string) => {
    const newSelection = new Set(selectedBackups)
    if (checked) {
      task.backups.forEach(backup => newSelection.add(backup.fileName))
    } else {
      task.backups.forEach(backup => newSelection.delete(backup.fileName))
    }
    setSelectedBackups(newSelection)
  }

  const isTaskFullySelected = (task: ScheduledTask): boolean => {
    return task.backups.every(backup => selectedBackups.has(backup.fileName))
  }

  const isTaskPartiallySelected = (task: ScheduledTask): boolean => {
    const selected = task.backups.filter(backup => selectedBackups.has(backup.fileName)).length
    return selected > 0 && selected < task.backups.length
  }

  const handleMerge = async () => {
    if (selectedBackups.size < 2) {
      return
    }

    setMerging(true)
    try {
      await onMerge({
        sourceTaskIds: Array.from(selectedBackups),
        deleteSourceFiles,
        deduplicateMessages
      })
      
      setSelectedBackups(new Set())
      setExpandedTasks(new Set())
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

  const formatTimestamp = (timestamp: string): string => {
    // 格式: 2025-11-28T06-24-13 -> 2025-11-28 06:24:13
    return timestamp.replace('T', ' ').replace(/-/g, ':').slice(0, -3)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-white/60 dark:bg-neutral-950/60 backdrop-blur-xl"
        className="flex flex-col h-full p-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            合并定时备份
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-8 min-h-0 px-6 py-6">
          {/* 左侧 - 备份列表 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">选择要合并的备份</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">至少选择 2 个备份文件进行合并</p>
            </div>
            
            <div className="flex-1 overflow-hidden">
              {scheduledTasks.length === 0 ? (
                <div className="h-full flex items-center justify-center rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800">
                  <div className="text-center p-8">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-neutral-400 dark:text-neutral-500" />
                    <p className="text-base font-medium text-neutral-700 dark:text-neutral-300">暂无定时备份</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">请先创建并运行定时导出任务</p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-full rounded-2xl border border-neutral-200 dark:border-neutral-700 p-2 bg-white/70 dark:bg-neutral-800/70">
                  <div className="space-y-1">
                    {scheduledTasks.map(task => (
                      <div key={task.taskName} className="rounded-xl bg-white dark:bg-neutral-800 overflow-hidden">
                        {/* 任务头部 */}
                        <div className="flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
                          <Checkbox
                            checked={isTaskFullySelected(task)}
                            onCheckedChange={(checked) => handleSelectAllInTask(task, checked)}
                          />
                          <div className="flex-shrink-0">
                            <FolderOpen className="w-5 h-5 text-blue-600" />
                          </div>
                          <button
                            onClick={() => toggleTask(task.taskName)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-neutral-900 truncate">{task.taskName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="secondary" className="text-xs">
                                    {task.backupCount} 个备份
                                  </Badge>
                                  <span className="text-xs text-neutral-500 truncate">
                                    {formatTimestamp(task.latestBackup.timestamp)}
                                  </span>
                                </div>
                              </div>
                              {expandedTasks.has(task.taskName) ? (
                                <ChevronDown className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                              )}
                            </div>
                          </button>
                        </div>

                        {/* 备份列表 */}
                        {expandedTasks.has(task.taskName) && (
                          <div className="border-t border-neutral-100 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50">
                            {task.backups.map(backup => (
                              <div
                                key={backup.fileName}
                                className="flex items-center gap-3 p-3 pl-11 hover:bg-white dark:hover:bg-neutral-700 transition-colors"
                              >
                                <Checkbox
                                  checked={selectedBackups.has(backup.fileName)}
                                  onCheckedChange={(checked) => handleBackupSelection(backup.fileName, checked)}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                    {formatTimestamp(backup.timestamp)}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                      {formatFileSize(backup.fileSize)}
                                    </span>
                                    <span className="text-xs text-neutral-400 truncate">
                                      {backup.fileName}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <Separator orientation="vertical" className="h-full" />

          {/* 右侧 - 合并选项 */}
          <div className="w-3/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">配置合并选项</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">设置如何处理合并后的文件</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-6">
              {/* 去重选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">消息处理</Label>
                  <p className="text-sm text-neutral-600 mt-1">选择如何处理重复的消息</p>
                </div>

                <div
                  className={[
                    "relative cursor-pointer rounded-2xl border p-4 transition-all",
                    deduplicateMessages ? "border-neutral-300 dark:border-neutral-600 bg-neutral-50/50 dark:bg-neutral-800/50" : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600",
                    merging ? "opacity-50 cursor-not-allowed" : ""
                  ].join(" ")}
                  onClick={() => !merging && setDeduplicateMessages(!deduplicateMessages)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 pt-0.5">
                      <div className={[
                        "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                        deduplicateMessages 
                          ? "border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100" 
                          : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500"
                      ].join(" ")}>
                        {deduplicateMessages && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-neutral-900 text-sm">去除重复消息</h4>
                      <p className="text-neutral-600 text-sm mt-1 leading-relaxed">
                        自动识别并去除重复的消息内容，保持聊天记录整洁
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 删除源文件选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium text-red-700">危险操作</Label>
                  <p className="text-sm text-neutral-600 mt-1">请谨慎选择以下选项</p>
                </div>

                <div
                  className={[
                    "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                    deleteSourceFiles ? "border-red-500 bg-red-50/50" : "border-red-200 hover:border-red-300",
                    merging ? "opacity-50 cursor-not-allowed" : ""
                  ].join(" ")}
                  onClick={() => !merging && setDeleteSourceFiles(!deleteSourceFiles)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 pt-0.5">
                      <div className={[
                        "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                        deleteSourceFiles 
                          ? "border-red-600 bg-red-600" 
                          : "border-red-300 hover:border-red-400"
                      ].join(" ")}>
                        {deleteSourceFiles && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-red-900 text-sm">合并后删除源文件</h4>
                      <p className="text-red-700 text-sm mt-1 leading-relaxed">
                        合并完成后自动删除原始备份文件，此操作不可撤销，请谨慎选择
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-200 dark:border-neutral-700">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            {merging ? (
              <span className="text-blue-600">
                正在合并 {selectedBackups.size} 个备份文件...
              </span>
            ) : (
              <span>
                已选择 <strong className="text-blue-600">{selectedBackups.size}</strong> 个备份文件
                {selectedBackups.size < 2 && <span className="text-amber-600"> (至少需要 2 个)</span>}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)} 
              disabled={merging}
              className="rounded-full"
            >
              取消
            </Button>
            <Button
              onClick={handleMerge}
              disabled={selectedBackups.size < 2 || merging}
              className="bg-blue-600 hover:bg-blue-700 rounded-full"
            >
              {merging ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  合并中...
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4 mr-2" />
                  开始合并 ({selectedBackups.size})
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
