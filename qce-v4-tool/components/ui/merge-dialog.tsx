"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import { AlertCircle } from "lucide-react"

const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"

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
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">合并备份资源</DialogTitle>

        <div className="flex-1 flex min-h-0 w-full">
          {/* 左侧 - 选择任务 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col pt-12 pl-12 pr-8 pb-6">
            <h1 className="text-[20px] font-semibold text-foreground mb-2">合并备份资源</h1>
            <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">将多个备份任务的资源合并为单一资源，至少选择 2 个已完成的导出任务。</p>

            <div className="flex-1 overflow-hidden">
              {tasks.length === 0 ? (
                <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] p-8 text-center">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">暂无可合并的任务</p>
                  <p className="text-xs text-muted-foreground mt-1">请先完成至少 2 个导出任务</p>
                </div>
              ) : (
                <ScrollArea className="h-full rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] p-2">
                  <div className="space-y-1">
                    {tasks.map(task => {
                      const selected = selectedTasks.has(task.id)
                      return (
                        <div
                          key={task.id}
                          className={[
                            "flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-colors",
                            selected ? "bg-black/[0.05] dark:bg-white/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                          ].join(" ")}
                          onClick={() => handleTaskSelection(task.id, !selected)}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) => handleTaskSelection(task.id, checked)}
                            className="pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[13px] truncate text-foreground">{task.sessionName}</div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span>{task.messageCount} 条消息</span>
                              <span>·</span>
                              <span className="truncate">{task.fileName}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>

            {selectedTasks.size > 0 && (
              <div className="mt-4 text-[13px] text-muted-foreground">
                已选择 {selectedTasks.size} 个任务，预计消息总数 {tasks.filter(t => selectedTasks.has(t.id)).reduce((sum, t) => sum + t.messageCount, 0)} 条
              </div>
            )}
          </div>

          {/* 右侧 - 合并选项 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-10 xl:px-12 pt-12 pb-8">
            <div className="w-full max-w-[760px] mx-auto space-y-10">
              <section>
                <h2 className={SECTION_TITLE}>合并选项</h2>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-foreground">消息去重</div>
                      <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">自动移除重复的消息，节约空间</div>
                    </div>
                    <Switch checked={deduplicateMessages} onCheckedChange={setDeduplicateMessages} />
                  </div>

                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-foreground">删除源文件</div>
                      <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">合并完成后自动删除原始导出文件</div>
                    </div>
                    <Switch checked={deleteSourceFiles} onCheckedChange={setDeleteSourceFiles} />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="text-[13px] font-medium text-foreground/80">输出路径</label>
                    <Input
                      value={outputPath}
                      onChange={(e) => setOutputPath(e.target.value)}
                      placeholder="留空使用默认路径"
                      className={PILL_INPUT + " w-full"}
                    />
                  </div>
                </div>
              </section>

              {merging && mergeProgress && (
                <div className="space-y-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] p-5">
                  <div className="flex justify-between text-[13px] font-medium text-foreground">
                    <span>{mergeProgress.phase}</span>
                    <span className="tabular-nums">{mergeProgress.percentage}%</span>
                  </div>
                  <Progress value={mergeProgress.percentage} className="h-2" />
                  <p className="text-[12px] text-muted-foreground">{mergeProgress.message}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {selectedTasks.size >= 2 ? <span className="text-foreground">已选择 {selectedTasks.size} 个任务</span> : <span>请至少选择 2 个任务</span>}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging} className="rounded-full text-[13px] h-8">
              取消
            </Button>
            <Button
              onClick={handleMerge}
              disabled={selectedTasks.size < 2 || merging}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {merging ? '合并中...' : `合并 ${selectedTasks.size} 个任务`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
