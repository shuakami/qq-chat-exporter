"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Layers, AlertCircle, FolderOpen, ChevronDown, ChevronRight } from "lucide-react"
import { Loader } from "@/components/ui/loader"

const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"

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
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">合并备份</DialogTitle>

        <div className="flex-1 flex min-h-0 w-full">
          {/* 左侧 - 备份列表 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col pt-12 pl-12 pr-8 pb-6">
            <h1 className="text-[20px] font-semibold text-foreground mb-2">合并备份</h1>
            <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">至少选择 2 个备份文件进行合并；定时备份和手动导出可以混合选择。</p>

            <div className="flex-1 overflow-hidden">
              {scheduledTasks.length === 0 && manualTasks.length === 0 ? (
                <div className="h-full flex items-center justify-center rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                  <div className="text-center p-8">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
                    <p className="text-[15px] font-medium text-foreground/80">暂无可合并的备份</p>
                    <p className="text-[13px] text-muted-foreground mt-1">先创建定时导出任务，或者多次手动导出同一会话再来合并</p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-full rounded-2xl p-2 bg-black/[0.02] dark:bg-white/[0.03]">
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

          {/* 右侧 - 合并选项 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-10 xl:px-12 pt-12 pb-8">
            <div className="w-full max-w-[760px] mx-auto space-y-10">
              <section>
                <h2 className={SECTION_TITLE}>合并选项</h2>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-foreground">去除重复消息</div>
                      <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">自动识别并去除重复的消息内容，保持聊天记录整洁</div>
                    </div>
                    <Switch checked={deduplicateMessages} disabled={merging} onCheckedChange={setDeduplicateMessages} />
                  </div>

                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-red-50/70 dark:bg-red-950/25">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-red-700 dark:text-red-400">合并后删除源文件</div>
                      <div className="text-[12px] text-red-600/90 dark:text-red-500/90 leading-snug mt-0.5">合并完成后自动删除原始备份文件，此操作不可撤销，请谨慎选择</div>
                    </div>
                    <Switch checked={deleteSourceFiles} disabled={merging} onCheckedChange={setDeleteSourceFiles} />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {merging ? (
              <span className="text-foreground">正在合并 {selectedBackups.size} 个备份文件...</span>
            ) : selectedBackups.size >= 2 ? (
              <span className="text-foreground">已选择 {selectedBackups.size} 个备份文件</span>
            ) : (
              <span>请至少选择 2 个备份文件</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging} className="rounded-full text-[13px] h-8">
              取消
            </Button>
            <Button
              onClick={handleMerge}
              disabled={selectedBackups.size < 2 || merging}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {merging ? (
                <><Loader size={16} className="mr-2" />合并中...</>
              ) : (
                <><Layers className="w-4 h-4 mr-2" />开始合并 ({selectedBackups.size})</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
