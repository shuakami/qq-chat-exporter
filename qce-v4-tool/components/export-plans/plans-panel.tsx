"use client"

/**
 * Issue #641：导出任务管理主面板。
 * 视觉对齐「定时导出」页：行式列表、单色 + 蓝色主按钮、hover 仅底色变化。
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Layers, Trash2 } from "lucide-react"

import type { Group } from "@/types/api"
import {
  ExportTaskPlan,
  ExportTaskRun,
  formatRelativeTime,
} from "@/types/export-task-plans"
import { useExportTaskPlans } from "@/hooks/use-export-task-plans"
import { toast } from "@/components/ui/use-toast"
import { ExportTaskPlanWizard } from "./plan-wizard"
import { ExportTaskRunHistoryDialog } from "./run-history-dialog"

export interface ExportTaskPlansPanelHandle {
  openCreateWizard: () => void
}

type FilterId = "all" | "fixed" | "tags" | "attention"

export const ExportTaskPlansPanel = forwardRef<
  ExportTaskPlansPanelHandle,
  { groups: Group[] }
>(function ExportTaskPlansPanel({ groups }, ref) {
  const store = useExportTaskPlans(groups)
  const {
    plans,
    hydrated,
    runs,
    activeRuns,
    resolvePlan,
    runPlan,
    retryFailedGroups,
    cancelRun,
    deletePlan,
  } = store

  const [filter, setFilter] = useState<FilterId>("all")
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<ExportTaskPlan | null>(null)
  const [historyPlan, setHistoryPlan] = useState<ExportTaskPlan | null>(null)

  useImperativeHandle(ref, () => ({
    openCreateWizard: () => {
      setEditingPlan(null)
      setWizardOpen(true)
    },
  }))

  const needsAttention = (p: ExportTaskPlan) =>
    !!p.lastRun && (p.lastRun.status === "partial" || p.lastRun.status === "failed")

  const filteredPlans = useMemo(() => {
    switch (filter) {
      case "fixed":
        return plans.filter((p) => p.sourceMode === "fixed")
      case "tags":
        return plans.filter((p) => p.sourceMode !== "fixed")
      case "attention":
        return plans.filter(needsAttention)
      default:
        return plans
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, plans])

  const counts = useMemo(
    () => ({
      all: plans.length,
      fixed: plans.filter((p) => p.sourceMode === "fixed").length,
      tags: plans.filter((p) => p.sourceMode !== "fixed").length,
      attention: plans.filter(needsAttention).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans],
  )

  const latestRunOf = (plan: ExportTaskPlan): ExportTaskRun | undefined => {
    const activeId = activeRuns[plan.id]
    if (activeId) return runs.find((r) => r.id === activeId)
    if (plan.lastRun) return runs.find((r) => r.id === plan.lastRun!.runId)
    return undefined
  }

  const handleRun = async (plan: ExportTaskPlan) => {
    const resolved = resolvePlan(plan).filter((g) => !g.missing)
    if (resolved.length === 0) {
      toast({ title: "无法运行", description: "任务未解析到任何群聊，请先编辑群聊集合", variant: "destructive" })
      return
    }
    const run = await runPlan(plan.id)
    if (run) {
      toast({
        title: "任务执行完成",
        description:
          run.status === "success"
            ? `「${plan.name}」${run.total} 个群全部导出成功`
            : `「${plan.name}」成功 ${run.success} 个，失败 ${run.failed} 个`,
        variant: run.status === "success" ? "default" : "destructive",
      })
    }
  }

  const handleRetry = async (plan: ExportTaskPlan) => {
    if (!plan.lastRun) return
    const run = await retryFailedGroups(plan.id, plan.lastRun.runId)
    if (run) {
      toast({
        title: "失败群重跑完成",
        description: `成功 ${run.success} 个，失败 ${run.failed} 个`,
        variant: run.failed > 0 ? "destructive" : "default",
      })
    }
  }

  if (!hydrated) return null

  const FILTER_TABS: Array<{ id: FilterId; label: string }> = [
    { id: "all", label: `全部 ${counts.all}` },
    { id: "fixed", label: `固定群聊 ${counts.fixed}` },
    { id: "tags", label: `标签关联 ${counts.tags}` },
    { id: "attention", label: `需要处理 ${counts.attention}` },
  ]

  return (
    <div className="p-5 space-y-4 max-w-4xl mx-auto w-full">
      {/* 筛选 */}
      {plans.length > 0 && (
        <div className="flex items-center gap-1 px-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                filter === tab.id
                  ? "bg-black/[0.06] dark:bg-white/[0.08] text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* 列表 */}
      {plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Layers className="w-8 h-8 text-muted-foreground/20 mb-3" strokeWidth={1.5} />
          <p className="text-[13px] text-foreground font-medium">暂无导出任务</p>
          <p className="text-[12px] text-muted-foreground/60 mt-1">点击右上角「新建导出任务」开始</p>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => {
                setEditingPlan(null)
                setWizardOpen(true)
              }}
              className="h-8 px-4 rounded-full bg-[#317CFF] hover:bg-[#2867d6] text-white text-[12px] font-medium transition-colors"
            >
              新建导出任务
            </button>
            <button
              onClick={() => {
                if (store.seedDemoData()) {
                  toast({ title: "已载入示例数据", description: "包含标签、任务与运行记录，可直接体验" })
                }
              }}
              className="h-8 px-3.5 rounded-full text-[12px] text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            >
              载入示例数据
            </button>
          </div>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[13px] text-muted-foreground/60">该筛选条件下暂无任务</p>
        </div>
      ) : (
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {filteredPlans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                run={latestRunOf(plan)}
                resolvedCount={resolvePlan(plan).length}
                running={!!activeRuns[plan.id]}
                onRun={() => handleRun(plan)}
                onCancel={() => cancelRun(plan.id)}
                onRetry={() => handleRetry(plan)}
                onHistory={() => setHistoryPlan(plan)}
                onEdit={() => {
                  setEditingPlan(plan)
                  setWizardOpen(true)
                }}
                onDelete={() => deletePlan(plan.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <ExportTaskPlanWizard
        open={wizardOpen}
        mode={editingPlan ? "edit" : "create"}
        initialPlan={editingPlan}
        store={store}
        onClose={() => {
          setWizardOpen(false)
          setEditingPlan(null)
        }}
      />

      <ExportTaskRunHistoryDialog
        plan={historyPlan}
        store={store}
        onClose={() => setHistoryPlan(null)}
      />
    </div>
  )
})

// ---------------------------------------------------------------------------
// 任务行
// ---------------------------------------------------------------------------

function PlanRow({
  plan,
  run,
  resolvedCount,
  running,
  onRun,
  onCancel,
  onRetry,
  onHistory,
  onEdit,
  onDelete,
}: {
  plan: ExportTaskPlan
  run?: ExportTaskRun
  resolvedCount: number
  running: boolean
  onRun: () => void
  onCancel: () => void
  onRetry: () => void
  onHistory: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const batchSize = plan.batchSize || 20
  const batchTotal = run?.batches.length ?? Math.max(Math.ceil(resolvedCount / batchSize), 1)
  const doneBatches =
    run?.batches.filter((b) => b.status === "success" || b.status === "partial" || b.status === "failed").length ?? 0
  const failedCount = plan.lastRun?.failed ?? 0
  const canRetry = !running && failedCount > 0

  // 元信息行：12 个群 · 标签 #学校 #游戏 · JSON · 每批 20 群 / 3 批 · 上次 2 小时前
  const meta: string[] = [`${resolvedCount} 个群`]
  if (plan.sourceMode !== "fixed" && plan.tags.length > 0) meta.push(plan.tags.map((t) => `#${t}`).join(" "))
  if (plan.sourceMode === "mixed") meta.push(`固定 ${plan.fixedGroups.length} 群`)
  meta.push(plan.format)
  meta.push(`每批 ${batchSize} 群 / ${batchTotal} 批`)
  if (plan.outputDir) meta.push(plan.outputDir)
  if (plan.lastRun && !running) meta.push(`上次 ${formatRelativeTime(plan.lastRun.at)}`)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="group px-3 py-2.5 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-medium text-foreground truncate">{plan.name}</span>
            {running && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                运行中
              </span>
            )}
            {!running && failedCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                {failedCount} 失败
              </span>
            )}
            {!running && !plan.lastRun && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.04] text-muted-foreground/50">
                未运行
              </span>
            )}
            {plan.incremental && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.04] text-muted-foreground/50">
                增量
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5 truncate">{meta.join(" · ")}</div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {running ? (
            <>
              <span className="text-[12px] text-muted-foreground tabular-nums mr-1">
                批次 {Math.min(doneBatches + 1, batchTotal)}/{batchTotal}
              </span>
              <button
                onClick={onCancel}
                className="px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60 hover:text-red-500 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                停止
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {canRetry && (
                <button
                  onClick={onRetry}
                  className="px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60 hover:text-foreground rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
                >
                  重跑失败
                </button>
              )}
              <button
                onClick={onHistory}
                className="px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60 hover:text-foreground rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                历史
              </button>
              <button
                onClick={onEdit}
                className="px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60 hover:text-foreground rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                编辑
              </button>
              <button
                onClick={onRun}
                className="px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60 hover:text-foreground rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                运行
              </button>
              <button
                onClick={onDelete}
                aria-label={`删除任务 ${plan.name}`}
                className="p-1.5 text-muted-foreground/40 hover:text-red-500 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 批次进度（有运行记录或运行中时展示） */}
      {(run || running) && (
        <div className="flex items-center gap-2.5 mt-2">
          <div className="flex gap-[3px] h-1 flex-1">
            {Array.from({ length: batchTotal }, (_, i) => {
              const batch = run?.batches[i]
              const status = batch?.status
              const color =
                status === "success"
                  ? "bg-foreground/25"
                  : status === "partial" || status === "failed"
                    ? "bg-red-400 dark:bg-red-500"
                    : status === "running"
                      ? "bg-[#317CFF] animate-pulse"
                      : "bg-black/[0.06] dark:bg-white/[0.08]"
              return (
                <div
                  key={i}
                  title={batch ? `批次 ${i + 1} · ${batch.groupCodes.length} 群` : `批次 ${i + 1}`}
                  className={`flex-1 max-w-[24px] rounded-full transition-colors duration-300 ${color}`}
                />
              )
            })}
          </div>
          {run && (
            <span className="text-[11px] tabular-nums text-muted-foreground/50 flex-shrink-0">
              {run.success} 成功
              {run.failed > 0 && <span className="text-red-500 ml-1">{run.failed} 失败</span>}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}
