"use client"

/**
 * Issue #641：导出任务管理数据层。
 *
 * - 任务（导出任务计划）、群标签、运行记录的本地持久化（localStorage）。
 * - 执行引擎：解析群集合 → 自动拆分批次的顺序执行，实时回写进度。
 *   当前环境无后端任务接口时以本地模拟执行完成闭环；接入服务端后
 *   只需将 executeBatch 替换为对 /api/export-task-plans/:id/run 的调用。
 * - 失败恢复：runPlan({ onlyGroupCodes }) 仅重跑指定群。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { Group } from "@/types/api"
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

  // ---------------- hydration ----------------
  useEffect(() => {
    setPlans(readLS<ExportTaskPlan[]>(LS_PLANS, []))
    setGroupTags(readLS<GroupTagMap>(LS_TAGS, {}))
    setRuns(readLS<ExportTaskRun[]>(LS_RUNS, []))
    setKnownGroups(readLS<Group[]>(LS_KNOWN_GROUPS, []))
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

  /**
   * 执行单个批次。
   * TODO(backend): 替换为对服务端批量导出接口的调用，并按返回结果构造失败列表。
   * 本地模式下批次内全部成功。
   */
  const executeBatch = useCallback(
    async (_plan: ExportTaskPlan, batch: ExportTaskRunBatch): Promise<ExportTaskRunFailure[]> => {
      // 模拟批次执行耗时，驱动 UI 进度动画
      const cost = 420 + Math.min(batch.groupCodes.length, 20) * 36 + Math.random() * 240
      await new Promise((r) => setTimeout(r, cost))
      return []
    },
    [],
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

        const batchFailures = await executeBatch(plan, batch)

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

  // ---------------- 示例数据 ----------------

  /** 载入示例任务（空状态下的一键体验数据） */
  const seedDemoData = useCallback(() => {
    if (plans.length > 0) return false
    const demo = buildDemoPayload()
    persistPlans(demo.plans)
    persistTags(demo.groupTags)
    persistRuns(demo.runs)
    setKnownGroups((prev) => {
      const map = new Map(prev.map((g) => [g.groupCode, g]))
      for (const g of demo.groups) if (!map.has(g.groupCode)) map.set(g.groupCode, g)
      const merged = Array.from(map.values())
      writeLS(LS_KNOWN_GROUPS, merged)
      return merged
    })
    return true
  }, [plans.length, persistPlans, persistTags, persistRuns])

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
    seedDemoData,
  }
}

// ---------------------------------------------------------------------------
// 示例数据
// ---------------------------------------------------------------------------

function buildDemoPayload(): {
  plans: ExportTaskPlan[]
  runs: ExportTaskRun[]
  groupTags: GroupTagMap
  groups: Group[]
} {
  const now = Date.now()
  const day = 86_400_000
  const iso = (t: number) => new Date(t).toISOString()

  const school = [
    "高三（2）班家长群",
    "高三年级通知群",
    "班级家委会",
    "数学竞赛兴趣小组",
    "英语角交流群",
    "校学生会大群",
    "社团联合会",
    "图书馆志愿者",
  ]
  const games = ["原神锄地大队", "王者开黑群", "Steam 拼车群", "Switch 同好会", "独立游戏品鉴", "电竞赛事讨论"]
  const interests = ["摄影扫街小分队", "周末骑行俱乐部", "手冲咖啡研究所", "二次元同好会", "读书会·周六场", "城市徒步联盟"]

  const groups: Group[] = []
  const groupTags: GroupTagMap = {}
  const push = (name: string, tag: string, i: number, prefix: string) => {
    const groupCode = `${prefix}${(100000 + i * 137).toString()}`
    groups.push({
      groupCode,
      groupName: name,
      memberCount: 48 + ((i * 37) % 450),
      maxMember: 500,
    })
    groupTags[groupCode] = [tag]
  }
  school.forEach((n, i) => push(n, "学校", i, "81"))
  games.forEach((n, i) => push(n, "游戏", i, "82"))
  interests.forEach((n, i) => push(n, "兴趣", i, "83"))

  const tagGroups = (tag: string) => groups.filter((g) => (groupTags[g.groupCode] || []).includes(tag))

  const schoolRefs = tagGroups("学校").map((g) => ({
    groupCode: g.groupCode,
    groupName: g.groupName,
    memberCount: g.memberCount,
  }))

  // 任务一：标签关联，最近一次部分失败
  const planA: ExportTaskPlan = {
    id: "plan_demo_school",
    name: "学校交流群备份",
    description: "每周备份班级群与社团群文字消息，用于期末整理归档",
    sourceMode: "tags",
    fixedGroups: [],
    tags: ["学校"],
    format: "JSON",
    options: {
      includeResourceLinks: false,
      includeSystemMessages: true,
      filterPureImageMessages: true,
      preferGroupMemberName: true,
    },
    outputDir: "backups/school",
    incremental: true,
    timeRangeType: "all",
    batchSize: 5,
    createdAt: iso(now - 32 * day),
    updatedAt: iso(now - 1 * day),
    progress: Object.fromEntries(schoolRefs.map((r) => [r.groupCode, Math.floor((now - day) / 1000)])),
  }

  // 任务一的最近一次运行：8 群，6 成功 2 失败
  const failedA = schoolRefs.slice(5, 7)
  const runA: ExportTaskRun = {
    id: "run_demo_school_1",
    planId: planA.id,
    planName: planA.name,
    trigger: "manual",
    status: "partial",
    startedAt: iso(now - day - 3_600_000),
    finishedAt: iso(now - day - 3_540_000),
    durationMs: 60_000,
    total: schoolRefs.length,
    success: schoolRefs.length - failedA.length,
    failed: failedA.length,
    batches: [
      {
        index: 0,
        groupCodes: schoolRefs.slice(0, 5).map((r) => r.groupCode),
        groupNames: schoolRefs.slice(0, 5).map((r) => r.groupName),
        status: "success",
      },
      {
        index: 1,
        groupCodes: schoolRefs.slice(5).map((r) => r.groupCode),
        groupNames: schoolRefs.slice(5).map((r) => r.groupName),
        status: "partial",
        failedGroupCodes: failedA.map((r) => r.groupCode),
        error: "批次内部分群导出失败",
      },
    ],
    failures: [
      { groupCode: failedA[0].groupCode, groupName: failedA[0].groupName, reason: "消息拉取超时（单群消息量过大）" },
      { groupCode: failedA[1].groupCode, groupName: failedA[1].groupName, reason: "账号被临时风控，群消息接口受限" },
    ],
  }
  planA.lastRun = {
    runId: runA.id,
    at: runA.finishedAt!,
    status: "partial",
    total: runA.total,
    success: runA.success,
    failed: runA.failed,
  }

  // 任务一更早的一次成功运行
  const runA0: ExportTaskRun = {
    id: "run_demo_school_0",
    planId: planA.id,
    planName: planA.name,
    trigger: "manual",
    status: "success",
    startedAt: iso(now - 8 * day),
    finishedAt: iso(now - 8 * day + 54_000),
    durationMs: 54_000,
    total: schoolRefs.length,
    success: schoolRefs.length,
    failed: 0,
    batches: [
      {
        index: 0,
        groupCodes: schoolRefs.slice(0, 5).map((r) => r.groupCode),
        groupNames: schoolRefs.slice(0, 5).map((r) => r.groupName),
        status: "success",
      },
      {
        index: 1,
        groupCodes: schoolRefs.slice(5).map((r) => r.groupCode),
        groupNames: schoolRefs.slice(5).map((r) => r.groupName),
        status: "success",
      },
    ],
    failures: [],
  }

  // 任务二：混合来源，从未运行
  const fixedB = tagGroups("游戏").slice(0, 3).map((g) => ({
    groupCode: g.groupCode,
    groupName: g.groupName,
    memberCount: g.memberCount,
  }))
  const planB: ExportTaskPlan = {
    id: "plan_demo_games",
    name: "游戏群精华存档",
    description: "固定三个开黑群 + 所有 #兴趣 标签群",
    sourceMode: "mixed",
    fixedGroups: fixedB,
    tags: ["兴趣"],
    format: "HTML",
    options: {
      includeResourceLinks: true,
      includeSystemMessages: false,
      filterPureImageMessages: false,
      preferGroupMemberName: true,
    },
    outputDir: "",
    incremental: false,
    timeRangeType: "last-30-days",
    batchSize: 5,
    createdAt: iso(now - 6 * day),
    updatedAt: iso(now - 6 * day),
  }

  // 任务三：固定群，上次全部成功
  const fixedC = tagGroups("游戏").map((g) => ({
    groupCode: g.groupCode,
    groupName: g.groupName,
    memberCount: g.memberCount,
  }))
  const planC: ExportTaskPlan = {
    id: "plan_demo_txt",
    name: "游戏群文字记录（TXT）",
    sourceMode: "fixed",
    fixedGroups: fixedC,
    tags: [],
    format: "TXT",
    options: {
      includeResourceLinks: false,
      includeSystemMessages: false,
      filterPureImageMessages: true,
      preferGroupMemberName: false,
    },
    incremental: true,
    timeRangeType: "all",
    batchSize: 10,
    createdAt: iso(now - 20 * day),
    updatedAt: iso(now - 2 * day),
    progress: Object.fromEntries(fixedC.map((r) => [r.groupCode, Math.floor((now - 2 * day) / 1000)])),
  }
  const runC: ExportTaskRun = {
    id: "run_demo_txt_1",
    planId: planC.id,
    planName: planC.name,
    trigger: "manual",
    status: "success",
    startedAt: iso(now - 2 * day - 40_000),
    finishedAt: iso(now - 2 * day),
    durationMs: 40_000,
    total: fixedC.length,
    success: fixedC.length,
    failed: 0,
    batches: [
      {
        index: 0,
        groupCodes: fixedC.map((r) => r.groupCode),
        groupNames: fixedC.map((r) => r.groupName),
        status: "success",
      },
    ],
    failures: [],
  }
  planC.lastRun = {
    runId: runC.id,
    at: runC.finishedAt!,
    status: "success",
    total: runC.total,
    success: runC.success,
    failed: 0,
  }

  return {
    plans: [planA, planB, planC],
    runs: [runA, runA0, runC],
    groupTags,
    groups,
  }
}
