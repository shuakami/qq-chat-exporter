"use client"

/**
 * Issue #641：任务运行记录弹窗。
 * 布局与视觉完全对齐 ExecutionHistoryModal：
 * 全屏模态、max-w-[880px]、muted 行、状态点 + 状态文字、展开详情、底部操作栏。
 */

import React, { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, ChevronRight, FileText } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import type { useExportTaskPlans } from "@/hooks/use-export-task-plans"
import {
  ExportTaskPlan,
  ExportTaskRun,
  formatRelativeTime,
  formatRunDuration,
} from "@/types/export-task-plans"

type Store = ReturnType<typeof useExportTaskPlans>

export function ExportTaskRunHistoryDialog({
  plan,
  store,
  onClose,
}: {
  plan: ExportTaskPlan | null
  store: Store
  onClose: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const runs = useMemo(() => (plan ? store.getPlanRuns(plan.id) : []), [store, plan])
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async (run: ExportTaskRun) => {
    if (!plan || retrying) return
    setRetrying(true)
    try {
      const result = await store.retryFailedGroups(plan.id, run.id)
      if (result) {
        toast({
          title: "失败群重跑完成",
          description: `成功 ${result.success} 个，失败 ${result.failed} 个`,
          variant: result.failed > 0 ? "destructive" : "default",
        })
      }
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Dialog open={!!plan} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">运行记录</DialogTitle>

        {plan && (
          <div className="flex-1 flex flex-col min-h-0 w-full max-w-[880px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-10 pt-12 pb-6 flex-shrink-0">
              <div>
                <h1 className="text-[20px] font-semibold text-foreground">运行记录</h1>
                <p className="text-[13px] text-muted-foreground mt-1.5">{plan.name}</p>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-10 pb-4">
              {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">暂无运行记录</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">回到列表点击「运行」开始首次导出</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      expanded={expandedId === run.id}
                      onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
                      onRetry={() => handleRetry(run)}
                      retrying={retrying}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <span className="text-[13px] font-medium text-muted-foreground">共 {runs.length} 次运行</span>
          <div className="flex items-center gap-3">
            {runs.length > 0 && (
              <button
                onClick={() => {
                  if (plan) {
                    store.clearPlanRuns(plan.id)
                    toast({ title: "已清空运行记录" })
                  }
                }}
                className="text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                清空记录
              </button>
            )}
            <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 单条运行记录（行结构对齐 ExecutionHistoryModal）
// ---------------------------------------------------------------------------

function statusLabel(run: ExportTaskRun): string {
  switch (run.status) {
    case "success":
      return "成功"
    case "partial":
      return "部分失败"
    case "failed":
      return "失败"
    case "running":
      return "运行中"
    default:
      return "已取消"
  }
}

function RunRow({
  run,
  expanded,
  onToggle,
  onRetry,
  retrying,
}: {
  run: ExportTaskRun
  expanded: boolean
  onToggle: () => void
  onRetry: () => void
  retrying: boolean
}) {
  const hasFailure = run.failed > 0
  // 7 天内显示相对时间，更早的记录只保留绝对日期（避免重复）
  const showRelative = Date.now() - new Date(run.startedAt).getTime() < 7 * 86_400_000

  return (
    <motion.div
      className="rounded-xl bg-muted/30 overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Main Row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        {/* Status Indicator */}
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            run.status === "running"
              ? "bg-[#317CFF] animate-pulse"
              : hasFailure
                ? "bg-foreground"
                : "bg-muted-foreground/60"
          }`}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground font-medium">
              {new Date(run.startedAt).toLocaleDateString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span aria-hidden className="h-2.5 w-px bg-current opacity-20" />
            <span className="text-muted-foreground">{formatRunDuration(run.durationMs)}</span>
            <span aria-hidden className="h-2.5 w-px bg-current opacity-20" />
            <span className="text-muted-foreground tabular-nums">
              {run.success}/{run.total} 群
            </span>
            {run.trigger === "retry" && (
              <>
                <span aria-hidden className="h-2.5 w-px bg-current opacity-20" />
                <span className="text-muted-foreground">失败重跑</span>
              </>
            )}
            {showRelative && (
              <span className="text-muted-foreground/50 text-xs">{formatRelativeTime(run.startedAt)}</span>
            )}
          </div>
        </div>

        {/* Status Text */}
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            hasFailure
              ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : "bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground"
          }`}
        >
          {statusLabel(run)}
        </span>

        <ChevronRight
          className={`w-4 h-4 text-muted-foreground/40 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-2 space-y-2 text-sm border-t border-black/[0.06] dark:border-white/[0.06]">
              {/* 批次明细 */}
              {run.batches.map((b) => (
                <div key={b.index} className="flex justify-between gap-4 text-muted-foreground">
                  <span className="flex-shrink-0">批次 {b.index + 1}</span>
                  <span className="text-xs truncate">
                    {b.groupNames.slice(0, 4).join("、")}
                    {b.groupNames.length > 4 && ` 等 ${b.groupNames.length} 群`}
                  </span>
                </div>
              ))}

              {/* 失败明细（对齐 ExecutionHistoryModal 的错误展示） */}
              {run.failures.map((f) => (
                <div key={f.groupCode} className="text-foreground/80 bg-muted px-3 py-2 rounded">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{f.groupName}</div>
                      <span className="break-all text-xs text-muted-foreground">{f.reason}</span>
                    </div>
                  </div>
                </div>
              ))}

              {run.failures.length > 0 && (
                <div className="pt-1">
                  <Button
                    onClick={onRetry}
                    disabled={retrying || run.status === "running"}
                    className="rounded-full text-[13px] h-8 px-4 bg-[#317CFF] text-white hover:bg-[#2867d6]"
                  >
                    仅重跑这 {run.failures.length} 个群
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
