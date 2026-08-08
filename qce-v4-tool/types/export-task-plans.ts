/**
 * Issue #641：导出任务管理（群聊集合 / 自动拆分 / 增量导出 / 运行记录 / 失败恢复）
 *
 * 数据模型与纯函数工具。持久化与执行引擎见 hooks/use-export-task-plans.ts。
 *
 * 说明：当前版本以前端本地持久化（localStorage）实现完整交互闭环，
 * 数据结构与服务端 REST 资源一一对应，后续接入后端时仅需替换
 * hooks 内的 storage 适配层：
 *   GET/POST        /api/export-task-plans
 *   PUT/DELETE      /api/export-task-plans/:id
 *   POST            /api/export-task-plans/:id/run        { onlyGroupCodes? }
 *   GET             /api/export-task-plans/:id/runs
 *   GET/PUT         /api/group-tags
 */

import type { Group } from "@/types/api"

// ---------------------------------------------------------------------------
// 任务定义
// ---------------------------------------------------------------------------

export type ExportTaskPlanSourceMode = "fixed" | "tags" | "mixed"

export type ExportTaskPlanFormat = "JSON" | "HTML" | "TXT" | "EXCEL"

export interface ExportTaskGroupRef {
  groupCode: string
  groupName: string
  memberCount?: number
  avatarUrl?: string
}

export interface ExportTaskPlanOptions {
  includeResourceLinks: boolean
  includeSystemMessages: boolean
  filterPureImageMessages: boolean
  preferGroupMemberName: boolean
}

export type ExportTaskPlanTimeRangeType = "all" | "last-7-days" | "last-30-days" | "custom"

export interface ExportTaskPlanLastRun {
  runId: string
  at: string
  status: ExportTaskRunStatus
  total: number
  success: number
  failed: number
}

export interface ExportTaskPlan {
  id: string
  name: string
  description?: string

  /** 群聊集合来源 */
  sourceMode: ExportTaskPlanSourceMode
  /** 固定群聊 */
  fixedGroups: ExportTaskGroupRef[]
  /** 关联标签（并集匹配） */
  tags: string[]

  format: ExportTaskPlanFormat
  options: ExportTaskPlanOptions
  outputDir?: string

  /** 增量导出：首次全量，之后自每个群的上次导出位置继续 */
  incremental: boolean
  timeRangeType: ExportTaskPlanTimeRangeType
  customTimeRange?: { startTime: number; endTime: number }

  /** 自动拆分：每批群数（规避单次任务数量限制） */
  batchSize: number

  createdAt: string
  updatedAt: string

  /** 增量游标：groupCode -> 已导出到的消息时间（秒） */
  progress?: Record<string, number>
  lastRun?: ExportTaskPlanLastRun
}

// ---------------------------------------------------------------------------
// 运行记录
// ---------------------------------------------------------------------------

export type ExportTaskRunStatus = "running" | "success" | "partial" | "failed" | "cancelled"

export type ExportTaskBatchStatus = "pending" | "running" | "success" | "partial" | "failed"

export interface ExportTaskRunBatch {
  index: number
  groupCodes: string[]
  groupNames: string[]
  status: ExportTaskBatchStatus
  /** 批次内失败的群 */
  failedGroupCodes?: string[]
  error?: string
}

export interface ExportTaskRunFailure {
  groupCode: string
  groupName: string
  reason: string
}

export interface ExportTaskRun {
  id: string
  planId: string
  planName: string
  trigger: "manual" | "retry"
  status: ExportTaskRunStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  total: number
  success: number
  failed: number
  batches: ExportTaskRunBatch[]
  failures: ExportTaskRunFailure[]
}

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

/** groupCode -> 标签列表 */
export type GroupTagMap = Record<string, string[]>

// ---------------------------------------------------------------------------
// 纯函数工具
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH_SIZE = 20
export const MIN_BATCH_SIZE = 5
export const MAX_BATCH_SIZE = 50

let idCounter = 0
export function genId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/**
 * 解析任务实际覆盖的群集合：
 * 固定群（去重、保留任务内快照信息）∪ 命中任一关联标签的群。
 * 返回带 source 标记的有序列表（固定群在前，标签群按名称排序）。
 */
export function resolvePlanGroups(
  plan: Pick<ExportTaskPlan, "sourceMode" | "fixedGroups" | "tags">,
  knownGroups: Group[],
  groupTags: GroupTagMap,
): Array<ExportTaskGroupRef & { via: "fixed" | "tag"; missing?: boolean }> {
  const result: Array<ExportTaskGroupRef & { via: "fixed" | "tag"; missing?: boolean }> = []
  const seen = new Set<string>()
  const liveMap = new Map(knownGroups.map((g) => [g.groupCode, g]))

  if (plan.sourceMode !== "tags") {
    for (const ref of plan.fixedGroups) {
      if (seen.has(ref.groupCode)) continue
      seen.add(ref.groupCode)
      const live = liveMap.get(ref.groupCode)
      result.push({
        groupCode: ref.groupCode,
        groupName: live?.groupName || ref.groupName,
        memberCount: live?.memberCount ?? ref.memberCount,
        avatarUrl: live?.avatarUrl ?? ref.avatarUrl,
        via: "fixed",
        missing: !live && knownGroups.length > 0 ? true : undefined,
      })
    }
  }

  if (plan.sourceMode !== "fixed" && plan.tags.length > 0) {
    const tagSet = new Set(plan.tags)
    const tagged = knownGroups
      .filter((g) => (groupTags[g.groupCode] || []).some((t) => tagSet.has(t)))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, "zh-CN"))
    for (const g of tagged) {
      if (seen.has(g.groupCode)) continue
      seen.add(g.groupCode)
      result.push({
        groupCode: g.groupCode,
        groupName: g.groupName,
        memberCount: g.memberCount,
        avatarUrl: g.avatarUrl,
        via: "tag",
      })
    }
  }

  return result
}

/** 将群列表按 batchSize 自动拆分为执行批次 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const size = Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, batchSize || DEFAULT_BATCH_SIZE))
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

/** 统计所有标签（按引用群数降序） */
export function collectTags(groupTags: GroupTagMap): Array<{ name: string; count: number }> {
  const counter = new Map<string, number>()
  for (const tags of Object.values(groupTags)) {
    for (const tag of tags) counter.set(tag, (counter.get(tag) || 0) + 1)
  }
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
}

export const RUN_STATUS_META: Record<
  ExportTaskRunStatus,
  { label: string; className: string; dotClassName: string }
> = {
  running: {
    label: "运行中",
    className: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
    dotClassName: "bg-blue-500",
  },
  success: {
    label: "全部成功",
    className: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    dotClassName: "bg-emerald-500",
  },
  partial: {
    label: "部分失败",
    className: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
    dotClassName: "bg-amber-500",
  },
  failed: {
    label: "失败",
    className: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
    dotClassName: "bg-red-500",
  },
  cancelled: {
    label: "已取消",
    className: "bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]",
    dotClassName: "bg-neutral-400",
  },
}

export function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ""
  const diff = Date.now() - time
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatRunDuration(ms?: number): string {
  if (!ms && ms !== 0) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}
