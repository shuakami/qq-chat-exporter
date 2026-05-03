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

/**
 * Issue #163: 手动导出任务的备份组。形状和 ScheduledTask 几乎一致，多了
 * groupKey / chatType / peerUid 用于在 UI 上区分会话；taskName 在 API 层
 * 已经选好优先用 sessionName，UI 直接展示。
 */
interface ManualTask {
  groupKey: string
  taskName: string
  chatType: 'friend' | 'group'
  peerUid: string
  backupCount: number
  backups: ScheduledBackup[]
  latestBackup: ScheduledBackup
}

interface ScheduledBackupMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduledTasks: ScheduledTask[]
  /** Issue #163: 同一对话框里也展示手动导出任务，让两类备份共用一套合并入口。 */
  manualTasks?: ManualTask[]
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
  manualTasks = [],
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

  const handleSelectAllInTask = (task: ScheduledTask | ManualTask, checked: boolean | string) => {
    const newSelection = new Set(selectedBackups)
    if (checked) {
      task.backups.forEach(backup => newSelection.add(backup.fileName))
    } else {
      task.backups.forEach(backup => newSelection.delete(backup.fileName))
    }
    setSelectedBackups(newSelection)
  }

  const isTaskFullySelected = (task: ScheduledTask | ManualTask): boolean => {
    return task.backups.every(backup => selectedBackups.has(backup.fileName))
  }

  const isTaskPartiallySelected = (task: ScheduledTask | ManualTask): boolean => {
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
    // 定时备份格式: 2025-11-28T06-24-13 -> 2025-11-28 06:24:13
    if (timestamp.includes('T')) {
      return timestamp.replace('T', ' ').replace(/-/g, ':').slice(0, -3)
    }
    // 手动导出格式 (#163): 20251128-062413 -> 2025-11-28 06:24:13
    const m = timestamp.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    // ISO 字符串退路（mtime fallback）
    if (/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) {
      return timestamp.replace('T', ' ').slice(0, 19)
    }
    return timestamp
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreen
        overlayClassName="bg-white/60 dark:bg-neutral-950/60 backdrop-blur-xl"
        className="flex flex-col h-full p-0"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            合并备份
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-8 min-h-0 px-6 py-6">
          {/* 左侧 - 备份列表 */}
          <div className="w-2/5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-base font-medium mb-1">选择要合并的备份</h3>
              <p className="text-sm text-muted-foreground">至少选择 2 个备份文件进行合并；定时备份和手动导出可以混合选择。</p>
            </div>

            <div className="flex-1 overflow-hidden">
              {scheduledTasks.length === 0 && manualTasks.length === 0 ? (
                <div className="h-full flex items-center justify-center rounded-2xl border border-dashed border-black/[0.08] dark:border-white/[0.08] bg-muted/50">
                  <div className="text-center p-8">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
                    <p className="text-base font-medium text-foreground/80">暂无可合并的备份</p>
                    <p className="text-sm text-muted-foreground mt-1">先创建定时导出任务，或者多次手动导出同一会话再来合并</p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-full rounded-2xl border border-black/[0.06] dark:border-white/[0.06] p-2 bg-card/70">
                  <div className="space-y-3">
                    {scheduledTasks.length > 0 && (
                      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        定时备份
                      </div>
                    )}
                    {scheduledTasks.map(task => (
                      <div key={`scheduled-${task.taskName}`} className="rounded-xl bg-card overflow-hidden">
                        {/* 任务头部 */}
                        <div className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
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
                                <p className="font-medium text-sm text-foreground truncate">{task.taskName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="secondary" className="text-xs">
                                    {task.backupCount} 个备份
                                  </Badge>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {formatTimestamp(task.latestBackup.timestamp)}
                                  </span>
                                </div>
                              </div>
                              {expandedTasks.has(task.taskName) ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              )}
                            </div>
                          </button>
                        </div>

                        {/* 备份列表 */}
                        {expandedTasks.has(task.taskName) && (
                          <div className="border-t border-black/[0.06] dark:border-white/[0.06] bg-muted/30">
                            {task.backups.map(backup => (
                              <div
                                key={backup.fileName}
                                className="flex items-center gap-3 p-3 pl-11 hover:bg-card transition-colors"
                              >
                                <Checkbox
                                  checked={selectedBackups.has(backup.fileName)}
                                  onCheckedChange={(checked) => handleBackupSelection(backup.fileName, checked)}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">
                                    {formatTimestamp(backup.timestamp)}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-muted-foreground">
                                      {formatFileSize(backup.fileSize)}
                                    </span>
                                    <span className="text-xs text-muted-foreground/60 truncate">
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

                    {manualTasks.length > 0 && (
                      <div className="px-2 pt-3 pb-0.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        手动导出
                      </div>
                    )}
                    {manualTasks.map(task => {
                      // 同一会话下的所有手动导出共用一行 expand/collapse；用 groupKey 当 key 避免和
                      // 定时备份的 taskName 撞名（出现群名 = 定时任务名的边界情况）。
                      const expandKey = `manual:${task.groupKey}`
                      return (
                        <div key={expandKey} className="rounded-xl bg-card overflow-hidden">
                          <div className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
                            <Checkbox
                              checked={isTaskFullySelected(task)}
                              onCheckedChange={(checked) => handleSelectAllInTask(task, checked)}
                            />
                            <div className="flex-shrink-0">
                              <FolderOpen className="w-5 h-5 text-emerald-600" />
                            </div>
                            <button
                              onClick={() => toggleTask(expandKey)}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-sm text-foreground truncate">{task.taskName}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <Badge variant="secondary" className="text-xs">
                                      {task.backupCount} 个文件
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                      {task.chatType === 'group' ? '群聊' : '好友'} · {task.peerUid}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {formatTimestamp(task.latestBackup.timestamp)}
                                    </span>
                                  </div>
                                </div>
                                {expandedTasks.has(expandKey) ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                )}
                              </div>
                            </button>
                          </div>

                          {expandedTasks.has(expandKey) && (
                            <div className="border-t border-black/[0.06] dark:border-white/[0.06] bg-muted/30">
                              {task.backups.map(backup => (
                                <div
                                  key={backup.fileName}
                                  className="flex items-center gap-3 p-3 pl-11 hover:bg-card transition-colors"
                                >
                                  <Checkbox
                                    checked={selectedBackups.has(backup.fileName)}
                                    onCheckedChange={(checked) => handleBackupSelection(backup.fileName, checked)}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground">
                                      {formatTimestamp(backup.timestamp)}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-xs text-muted-foreground">
                                        {formatFileSize(backup.fileSize)}
                                      </span>
                                      <span className="text-xs text-muted-foreground/60 truncate">
                                        {backup.fileName}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
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
              <p className="text-sm text-muted-foreground">设置如何处理合并后的文件</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-6">
              {/* 去重选项 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-medium">消息处理</Label>
                  <p className="text-sm text-muted-foreground mt-1">选择如何处理重复的消息</p>
                </div>

                <div
                  className={[
                    "relative cursor-pointer rounded-2xl border p-4 transition-all",
                    deduplicateMessages ? "border-black/[0.08] dark:border-white/[0.08] bg-muted/30" : "border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.08] dark:hover:border-white/[0.08]",
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
                          : "border-black/[0.08] dark:border-white/[0.08] hover:border-black/[0.12] dark:hover:border-white/[0.12]"
                      ].join(" ")}>
                        {deduplicateMessages && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-foreground text-sm">去除重复消息</h4>
                      <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
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
                  <p className="text-sm text-muted-foreground mt-1">请谨慎选择以下选项</p>
                </div>

                <div
                  className={[
                    "relative cursor-pointer rounded-2xl border-2 p-4 transition-all",
                    deleteSourceFiles ? "border-red-500 bg-red-50/50 dark:bg-red-950/30" : "border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700",
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
                          : "border-red-300 dark:border-red-700 hover:border-red-400 dark:hover:border-red-600"
                      ].join(" ")}>
                        {deleteSourceFiles && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-red-900 dark:text-red-400 text-sm">合并后删除源文件</h4>
                      <p className="text-red-700 dark:text-red-500 text-sm mt-1 leading-relaxed">
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="text-sm text-muted-foreground">
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
