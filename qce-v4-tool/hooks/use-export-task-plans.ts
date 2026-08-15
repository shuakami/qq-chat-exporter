"use client"

/**
 * Issue #641：导出任务管理数据层。
 *
 * - 任务（导出任务计划）、群标签、运行记录的本地持久化（localStorage）。
 * - 执行引擎：解析群集合 → 自动拆分批次的顺序执行，实时回写进度。
 *   每个群调用 `POST /api/messages/export` 创建真实导出任务，再轮询
 *   `GET /api/tasks/:taskId` 等待结果，失败原因写入运行记录。
 * - 失败恢复：runPlan({ onlyGroupCodes }) 仅重跑指定群。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { ExportTask, Group } from "@/types/api"
import { useApi } from "./use-api"
import {
  DEFAULT_BATCH_SIZE,
  ExportTaskPlan,
  ExportTaskRun,
  ExportTaskRunBatch,
  ExportTaskRunFailure,
  GroupTagMap,
  collectTags,
  genId,
  resolvePlanGroups,
  splitIntoBatches,
} from "@/types/export-task-plans"

const LS_PLANS = "qce-export-task-plans-v1"
const LS_TAGS = "qce-group-tags-v1"
const LS_RUNS = "qce-export-task-runs-v1"
const LS_KNOWN_GROUPS = "qce-known-groups-v1"
const MAX_RUNS_PER_PLAN = 30
const MAX_KNOWN_GROUPS = 500
/** 单群导出轮询间隔（毫秒）。 */
const TASK_POLL_INTERVAL_MS = 2_000
/** 单群导出等待上限（毫秒），超时当作失败并进入失败列表。 */
const TASK_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000
const DAY_SECONDS = 86_400

/**
 * Issue #641：旧版本提供过「载入示例数据」，写入的示例任务与虚构群会一直占着
 * 任务列表和群组选择器，用户看不到也选不了自己的群。示例数据已经移除，
 * 这里只负责把本地残留的示例记录清掉（真实任务的 ID 不使用这些前缀）。
 */
const DEMO_PLAN_IDS = new Set(["plan_demo_school", "plan_demo_games", "plan_demo_txt"])
const DEMO_RUN_ID_PREFIX = "run_demo_"

function demoGroupCodes(): Set<string> {
  const codes = new Set<string>()
  for (const [prefix, count] of [
    ["81", 8],
    ["82", 6],
    ["83", 6],
  ] as Array<[string, number]>) {
    for (let i = 0; i < count; i += 1) codes.add(`${prefix}${100_000 + i * 137}`)
  }
  return codes
}

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储配额满等情况忽略
  }
}

export interface RunPlanOptions {
  /** 仅运行这些群（失败重跑） */
  onlyGroupCodes?: string[]
  trigger?: "manual" | "retry"
}

export function useExportTaskPlans(liveGroups: Group[] = []) {
  const [plans, setPlans] = useState<ExportTaskPlan[]>([])
  const [groupTags, setGroupTags] = useState<GroupTagMap>({})
  const [runs, setRuns] = useState<ExportTaskRun[]>([])
  const [knownGroups, setKnownGroups] = useState<Group[]>([])
  const [hydrated, setHydrated] = useState(false)
  /** 正在运行的计划 ID -> run ID */
  const [activeRuns, setActiveRuns] = useState<Record<string, string>>({})
  const cancelRef = useRef<Set<string>>(new Set())
  const { apiCall } = useApi()

  // ---------------- hydration ----------------
  useEffect(() => {
    const storedPlans = readLS<ExportTaskPlan[]>(LS_PLANS, [])
    const storedTags = readLS<GroupTagMap>(LS_TAGS, {})
    const storedRuns = readLS<ExportTaskRun[]>(LS_RUNS, [])
    const storedGroups = readLS<Group[]>(LS_KNOWN_GROUPS, [])

    const demoCodes = demoGroupCodes()
    const cleanPlans = storedPlans.filter((p) => !DEMO_PLAN_IDS.has(p.id))
    const cleanRuns = storedRuns.filter(
      (r) => !r.id.startsWith(DEMO_RUN_ID_PREFIX) && !DEMO_PLAN_IDS.has(r.planId),
    )
    const cleanGroups = storedGroups.filter((g) => !demoCodes.has(g.groupCode))
    const cleanTags = Object.fromEntries(
      Object.entries(storedTags).filter(([code]) => !demoCodes.has(code)),
    )

    if (cleanPlans.length !== storedPlans.length) writeLS(LS_PLANS, cleanPlans)
    if (cleanRuns.length !== storedRuns.length) writeLS(LS_RUNS, cleanRuns)
    if (cleanGroups.length !== storedGroups.length) writeLS(LS_KNOWN_GROUPS, cleanGroups)
    if (Object.keys(cleanTags).length !== Object.keys(storedTags).length) writeLS(LS_TAGS, cleanTags)

    setPlans(cleanPlans)
    setGroupTags(cleanTags)
    setRuns(cleanRuns)
    setKnownGroups(cleanGroups)
    setHydrated(true)
  }, [])

  // 合并在线群列表到 knownGroups（任务内群快照 + 标签解析都依赖它）
  useEffect(() => {
    if (!hydrated || liveGroups.length === 0) return
    setKnownGroups((prev) => {
      const map = new Map(prev.map((g) => [g.groupCode, g]))
      for (const g of liveGroups) map.set(g.groupCode, g)
      const merged = Array.from(map.values()).slice(0, MAX_KNOWN_GROUPS)
      writeLS(LS_KNOWN_GROUPS, merged)
      return merged
    })
  }, [hydrated, liveGroups])

  const persistPlans = useCallback((next: ExportTaskPlan[]) => {
    setPlans(next)
    writeLS(LS_PLANS, next)
  }, [])

  const persistTags = useCallback((next: GroupTagMap) => {
    setGroupTags(next)
    writeLS(LS_TAGS, next)
  }, [])

  const persistRuns = useCallback((next: ExportTaskRun[]) => {
    setRuns(next)
    writeLS(LS_RUNS, next)
  }, [])

  // ---------------- 标签 ----------------

  const allTags = useMemo(() => collectTags(groupTags), [groupTags])

  const setGroupTagList = useCallback(
    (groupCode: string, tags: string[]) => {
      const next = { ...groupTags }
      const cleaned = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
      if (cleaned.length === 0) delete next[groupCode]
      else next[groupCode] = cleaned
      persistTags(next)
    },
    [groupTags, persistTags],
  )

  const toggleGroupTag = useCallback(
    (groupCode: string, tag: string, enabled: boolean) => {
      const current = groupTags[groupCode] || []
      const next = enabled ? [...current, tag] : current.filter((t) => t !== tag)
      setGroupTagList(groupCode, next)
    },
    [groupTags, setGroupTagList],
  )

  const deleteTag = useCallback(
    (tag: string) => {
      const next: GroupTagMap = {}
      for (const [code, tags] of Object.entries(groupTags)) {
        const kept = tags.filter((t) => t !== tag)
        if (kept.length > 0) next[code] = kept
      }
      persistTags(next)
      // 同步从任务关联中移除
      persistPlans(
        plans.map((p) =>
          p.tags.includes(tag) ? { ...p, tags: p.tags.filter((t) => t !== tag), updatedAt: new Date().toISOString() } : p,
        ),
      )
    },
    [groupTags, plans, persistTags, persistPlans],
  )

  // ---------------- 任务 CRUD ----------------

  const createPlan = useCallback(
    (input: Omit<ExportTaskPlan, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString()
      const plan: ExportTaskPlan = { ...input, id: genId("plan"), createdAt: now, updatedAt: now }
      persistPlans([plan, ...plans])
      return plan
    },
    [plans, persistPlans],
  )

  const updatePlan = useCallback(
    (id: string, updates: Partial<Omit<ExportTaskPlan, "id" | "createdAt">>) => {
      persistPlans(
        plans.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p)),
      )
    },
    [plans, persistPlans],
  )

  const deletePlan = useCallback(
    (id: string) => {
      persistPlans(plans.filter((p) => p.id !== id))
      persistRuns(runs.filter((r) => r.planId !== id))
    },
    [plans, runs, persistPlans, persistRuns],
  )

  // ---------------- 解析 ----------------

  const resolvePlan = useCallback(
    (plan: ExportTaskPlan) => resolvePlanGroups(plan, knownGroups, groupTags),
    [knownGroups, groupTags],
  )

  // ---------------- 执行引擎 ----------------

  const updateRun = useCallback(
    (runId: string, updater: (run: ExportTaskRun) => ExportTaskRun) => {
      setRuns((prev) => {
        const next = prev.map((r) => (r.id === runId ? updater(r) : r))
        writeLS(LS_RUNS, next)
        return next
      })
    },
    [],
  )

  /** 轮询导出任务直到结束，返回失败原因；成功返回 null。 */
  const waitForTask = useCallback(
    async (taskId: string, runId: string): Promise<string | null> => {
      const deadline = Date.now() + TASK_WAIT_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (cancelRef.current.has(runId)) return "任务已取消"
        await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS))
        const resp = await apiCall<ExportTask>(`/api/tasks/${encodeURIComponent(taskId)}`)
        if (!resp.success || !resp.data) continue
        const task = resp.data
        if (task.status === "completed") return null
        if (task.status === "failed") return task.error || "导出失败"
        if (task.status === "cancelled") return "导出任务被取消"
      }
      return "等待导出结果超时"
    },
    [apiCall],
  )

  /** 导出单个群，返回失败原因；成功返回 null。 */
  const exportGroup = useCallback(
    async (plan: ExportTaskPlan, group: { groupCode: string; groupName: string }, runId: string) => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      // 增量导出：从该群上次导出到的位置继续；否则按任务的时间范围类型。
      const incrementalFrom = plan.incremental ? plan.progress?.[group.groupCode] : undefined
      let startTime = incrementalFrom
      let endTime: number | undefined
      if (startTime === undefined) {
        if (plan.timeRangeType === "last-7-days") startTime = nowSeconds - 7 * DAY_SECONDS
        else if (plan.timeRangeType === "last-30-days") startTime = nowSeconds - 30 * DAY_SECONDS
        else if (plan.timeRangeType === "custom" && plan.customTimeRange) {
          startTime = plan.customTimeRange.startTime
          endTime = plan.customTimeRange.endTime
        }
      }

      const outputDir = plan.outputDir?.trim()
      const body = {
        peer: { chatType: 2, peerUid: group.groupCode, guildId: "" },
        sessionName: group.groupName || group.groupCode,
        format: plan.format,
        filter: {
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          includeRecalled: false,
        },
        options: {
          batchSize: 5000,
          prettyFormat: true,
          useFriendlyFileName: true,
          includeResourceLinks: plan.options.includeResourceLinks,
          includeSystemMessages: plan.options.includeSystemMessages,
          filterPureImageMessages: plan.options.filterPureImageMessages,
          preferGroupMemberName: plan.options.preferGroupMemberName,
          ...(outputDir && { outputDir }),
        },
      }

      try {
        const resp = await apiCall<{ taskId?: string }>("/api/messages/export", {
          method: "POST",
          body: JSON.stringify(body),
        })
        if (!resp.success) return resp.error?.message || "创建导出任务失败"
        const taskId = resp.data?.taskId
        // 没有 taskId 说明服务端同步完成，无需轮询。
        if (!taskId) return null
        return await waitForTask(taskId, runId)
      } catch (err) {
        return err instanceof Error ? err.message : "创建导出任务失败"
      }
    },
    [apiCall, waitForTask],
  )

  /** 顺序执行单个批次内的每个群，返回失败列表。 */
  const executeBatch = useCallback(
    async (
      plan: ExportTaskPlan,
      batch: ExportTaskRunBatch,
      runId: string,
    ): Promise<ExportTaskRunFailure[]> => {
      const failures: ExportTaskRunFailure[] = []
      for (const [index, groupCode] of batch.groupCodes.entries()) {
        const groupName = batch.groupNames[index] || groupCode
        if (cancelRef.current.has(runId)) {
          failures.push({ groupCode, groupName, reason: "任务已取消" })
          continue
        }
        const reason = await exportGroup(plan, { groupCode, groupName }, runId)
        if (reason) failures.push({ groupCode, groupName, reason })
      }
      return failures
    },
    [exportGroup],
  )

  const runPlan = useCallback(
    async (planId: string, options: RunPlanOptions = {}): Promise<ExportTaskRun | null> => {
      const plan = plans.find((p) => p.id === planId)
      if (!plan || activeRuns[planId]) return null

      let targets = resolvePlan(plan).filter((g) => !g.missing)
      if (options.onlyGroupCodes && options.onlyGroupCodes.length > 0) {
        const only = new Set(options.onlyGroupCodes)
        targets = targets.filter((g) => only.has(g.groupCode))
      }
      if (targets.length === 0) return null

      const batchSize = plan.batchSize || DEFAULT_BATCH_SIZE
      const batchItems = splitIntoBatches(targets, batchSize)
      const run: ExportTaskRun = {
        id: genId("run"),
        planId,
        planName: plan.name,
        trigger: options.trigger || "manual",
        status: "running",
        startedAt: new Date().toISOString(),
        total: targets.length,
        success: 0,
        failed: 0,
        batches: batchItems.map((items, index) => ({
          index,
          groupCodes: items.map((g) => g.groupCode),
          groupNames: items.map((g) => g.groupName),
          status: "pending",
        })),
        failures: [],
      }

      persistRuns([run, ...runs])
      setActiveRuns((prev) => ({ ...prev, [planId]: run.id }))

      const startedAt = Date.now()
      let success = 0
      let failed = 0
      const failures: ExportTaskRunFailure[] = []

      for (const batch of run.batches) {
        if (cancelRef.current.has(run.id)) {
          updateRun(run.id, (r) => ({
            ...r,
            status: "cancelled",
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            success,
            failed,
            failures,
            batches: r.batches.map((b) => (b.status === "pending" || b.status === "running" ? { ...b, status: "pending" } : b)),
          }))
          setActiveRuns((prev) => {
            const next = { ...prev }
            delete next[planId]
            return next
          })
          return null
        }

        updateRun(run.id, (r) => ({
          ...r,
          batches: r.batches.map((b) => (b.index === batch.index ? { ...b, status: "running" } : b)),
        }))

        const batchFailures = await executeBatch(plan, batch, run.id)

        const batchFailed = batchFailures.length
        const batchSuccess = batch.groupCodes.length - batchFailed
        success += batchSuccess
        failed += batchFailed
        failures.push(...batchFailures)

        updateRun(run.id, (r) => ({
          ...r,
          success,
          failed,
          failures: [...failures],
          batches: r.batches.map((b) =>
            b.index === batch.index
              ? {
                  ...b,
                  status: batchFailed === 0 ? "success" : batchSuccess === 0 ? "failed" : "partial",
                  failedGroupCodes: batchFailures.map((f) => f.groupCode),
                }
              : b,
          ),
        }))
      }

      const status: ExportTaskRun["status"] = failed === 0 ? "success" : success === 0 ? "failed" : "partial"
      const finishedAt = new Date().toISOString()
      const durationMs = Date.now() - startedAt

      updateRun(run.id, (r) => ({ ...r, status, finishedAt, durationMs, success, failed, failures: [...failures] }))

      // 回写任务：最近运行 + 增量游标（成功的群推进到当前时间）
      const cursor = Math.floor(Date.now() / 1000)
      setPlans((prev) => {
        const next = prev.map((p) => {
          if (p.id !== planId) return p
          const progress = { ...(p.progress || {}) }
          if (p.incremental) {
            for (const batch of run.batches) {
              for (const code of batch.groupCodes) {
                if (!failures.some((f) => f.groupCode === code)) progress[code] = cursor
              }
            }
          }
          return {
            ...p,
            progress,
            lastRun: { runId: run.id, at: finishedAt, status, total: run.total, success, failed },
            updatedAt: finishedAt,
          }
        })
        writeLS(LS_PLANS, next)
        return next
      })

      setActiveRuns((prev) => {
        const next = { ...prev }
        delete next[planId]
        return next
      })

      return { ...run, status, finishedAt, durationMs, success, failed, failures }
    },
    [plans, runs, activeRuns, resolvePlan, executeBatch, persistRuns, updateRun],
  )

  /** 失败恢复：仅重跑某次运行中失败的群 */
  const retryFailedGroups = useCallback(
    async (planId: string, runId: string) => {
      const run = runs.find((r) => r.id === runId && r.planId === planId)
      if (!run || run.failures.length === 0) return null
      return runPlan(planId, {
        onlyGroupCodes: run.failures.map((f) => f.groupCode),
        trigger: "retry",
      })
    },
    [runs, runPlan],
  )

  const cancelRun = useCallback(
    (planId: string) => {
      const runId = activeRuns[planId]
      if (runId) cancelRef.current.add(runId)
    },
    [activeRuns],
  )

  const getPlanRuns = useCallback((planId: string) => runs.filter((r) => r.planId === planId), [runs])

  const clearPlanRuns = useCallback(
    (planId: string) => {
      persistRuns(runs.filter((r) => r.planId !== planId))
      setPlans((prev) => {
        const next = prev.map((p) => (p.id === planId ? { ...p, lastRun: undefined } : p))
        writeLS(LS_PLANS, next)
        return next
      })
    },
    [runs, persistRuns],
  )

  // 裁剪每个任务的运行记录数量
  useEffect(() => {
    if (!hydrated) return
    const byPlan = new Map<string, ExportTaskRun[]>()
    for (const r of runs) {
      const list = byPlan.get(r.planId) || []
      list.push(r)
      byPlan.set(r.planId, list)
    }
    let overflow = false
    for (const list of byPlan.values()) {
      if (list.length > MAX_RUNS_PER_PLAN) overflow = true
    }
    if (overflow) {
      const kept: ExportTaskRun[] = []
      for (const list of byPlan.values()) kept.push(...list.slice(0, MAX_RUNS_PER_PLAN))
      persistRuns(kept)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, runs.length])

  return {
    hydrated,
    plans,
    runs,
    groupTags,
    allTags,
    knownGroups,
    activeRuns,
    createPlan,
    updatePlan,
    deletePlan,
    resolvePlan,
    runPlan,
    retryFailedGroups,
    cancelRun,
    getPlanRuns,
    clearPlanRuns,
    setGroupTagList,
    toggleGroupTag,
    deleteTag,
  }
}
