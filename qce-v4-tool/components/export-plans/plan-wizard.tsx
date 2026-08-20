"use client"

/**
 * Issue #641：导出任务创建 / 编辑向导。
 * 布局与视觉完全对齐 ScheduledExportWizard：
 * 全屏 inset-4 圆角模态、左侧群聊集合选择、右侧配置分节、底部操作栏。
 */

import React, { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown, Search, Users, X } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Slider } from "@/components/ui/slider"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { toast } from "@/components/ui/use-toast"
import type { useExportTaskPlans } from "@/hooks/use-export-task-plans"
import { toggleSkipResourceType } from "@/lib/skip-resource-types"
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_EXPORT_TASK_PLAN_OPTIONS,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  ExportTaskPlan,
  ExportTaskPlanFormat,
  ExportTaskPlanSourceMode,
  ExportTaskPlanTimeRangeType,
  resolvePlanGroups,
  splitIntoBatches,
} from "@/types/export-task-plans"

type Store = ReturnType<typeof useExportTaskPlans>

// 与 ScheduledExportWizard 完全一致的输入 / 分节样式
const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"
const SECTION_TITLE = "text-[14px] font-medium text-foreground mb-5"
const FIELD_LABEL = "text-[13px] font-medium text-foreground/80"

interface WizardProps {
  open: boolean
  mode: "create" | "edit"
  initialPlan: ExportTaskPlan | null
  store: Store
  onClose: () => void
}

interface DraftState {
  name: string
  description: string
  sourceMode: ExportTaskPlanSourceMode
  fixedGroupCodes: string[]
  fixedSnapshots: Record<string, { groupName: string; memberCount?: number; avatarUrl?: string }>
  tags: string[]
  format: ExportTaskPlanFormat
  includeResourceLinks: boolean
  includeSystemMessages: boolean
  filterPureImageMessages: boolean
  preferGroupMemberName: boolean
  includeRecalled: boolean
  debugExport: boolean
  streamingZipMode: boolean
  exportAsZip: boolean
  embedAvatarsAsBase64: boolean
  embedResourcesAsDataUri: boolean
  skipDownloadResourceTypes?: Array<"image" | "video" | "audio" | "file">
  useNameInFileName: boolean
  useFriendlyFileName: boolean
  keywords: string
  excludeUserUins: string
  includeUserUins: string
  outputDir: string
  incremental: boolean
  timeRangeType: ExportTaskPlanTimeRangeType
  customStartTime: string
  customEndTime: string
  batchSize: number
}

function toDateTimeLocal(seconds?: number): string {
  if (seconds === undefined) return ""
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function draftFromPlan(plan: ExportTaskPlan | null): DraftState {
  if (!plan) {
    return {
      name: "",
      description: "",
      sourceMode: "fixed",
      fixedGroupCodes: [],
      fixedSnapshots: {},
      tags: [],
      format: "JSON",
      ...DEFAULT_EXPORT_TASK_PLAN_OPTIONS,
      keywords: "",
      excludeUserUins: "",
      includeUserUins: "",
      outputDir: "",
      incremental: true,
      timeRangeType: "all",
      customStartTime: "",
      customEndTime: "",
      batchSize: DEFAULT_BATCH_SIZE,
    }
  }
  return {
    name: plan.name,
    description: plan.description || "",
    sourceMode: plan.sourceMode,
    fixedGroupCodes: plan.fixedGroups.map((g) => g.groupCode),
    fixedSnapshots: Object.fromEntries(
      plan.fixedGroups.map((g) => [
        g.groupCode,
        { groupName: g.groupName, memberCount: g.memberCount, avatarUrl: g.avatarUrl },
      ]),
    ),
    tags: [...plan.tags],
    format: plan.format,
    includeResourceLinks: plan.options.includeResourceLinks,
    includeSystemMessages: plan.options.includeSystemMessages,
    filterPureImageMessages: plan.options.filterPureImageMessages,
    preferGroupMemberName: plan.options.preferGroupMemberName,
    includeRecalled: plan.options.includeRecalled,
    debugExport: plan.options.debugExport,
    streamingZipMode: plan.options.streamingZipMode,
    exportAsZip: plan.options.exportAsZip,
    embedAvatarsAsBase64: plan.options.embedAvatarsAsBase64,
    embedResourcesAsDataUri: plan.options.embedResourcesAsDataUri,
    skipDownloadResourceTypes: plan.options.skipDownloadResourceTypes,
    useNameInFileName: plan.options.useNameInFileName,
    useFriendlyFileName: plan.options.useFriendlyFileName,
    keywords: plan.options.keywords || "",
    excludeUserUins: plan.options.excludeUserUins || "",
    includeUserUins: plan.options.includeUserUins || "",
    outputDir: plan.outputDir || "",
    incremental: plan.incremental,
    timeRangeType: plan.timeRangeType,
    customStartTime: toDateTimeLocal(plan.customTimeRange?.startTime),
    customEndTime: toDateTimeLocal(plan.customTimeRange?.endTime),
    batchSize: plan.batchSize || DEFAULT_BATCH_SIZE,
  }
}

export function ExportTaskPlanWizard({ open, mode, initialPlan, store, onClose }: WizardProps) {
  const [draft, setDraft] = useState<DraftState>(() => draftFromPlan(initialPlan))
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(draftFromPlan(initialPlan))
      setFiltersOpen(false)
    }
  }, [open, initialPlan])

  const patch = (updates: Partial<DraftState>) => setDraft((d) => ({ ...d, ...updates }))

  // 实时解析群集合
  const resolved = useMemo(
    () =>
      resolvePlanGroups(
        {
          sourceMode: draft.sourceMode,
          fixedGroups: draft.fixedGroupCodes.map((code) => ({
            groupCode: code,
            groupName:
              store.knownGroups.find((g) => g.groupCode === code)?.groupName ||
              draft.fixedSnapshots[code]?.groupName ||
              code,
            memberCount: draft.fixedSnapshots[code]?.memberCount,
            avatarUrl: draft.fixedSnapshots[code]?.avatarUrl,
          })),
          tags: draft.tags,
        },
        store.knownGroups,
        store.groupTags,
      ),
    [draft.sourceMode, draft.fixedGroupCodes, draft.fixedSnapshots, draft.tags, store.knownGroups, store.groupTags],
  )

  const nameValid = draft.name.trim().length > 0
  const groupsValid = resolved.length > 0
  const customRangeValid =
    draft.timeRangeType !== "custom" ||
    (Boolean(draft.customStartTime) &&
      Boolean(draft.customEndTime) &&
      new Date(draft.customEndTime).getTime() >= new Date(draft.customStartTime).getTime())
  const canSubmit = nameValid && groupsValid && customRangeValid
  const progressed = initialPlan?.progress ? Object.keys(initialPlan.progress).length : 0
  const batches = splitIntoBatches(Array.from({ length: resolved.length }, (_, i) => i + 1), draft.batchSize)

  const handleSubmit = () => {
    if (!nameValid) {
      toast({ title: "请填写任务名称", variant: "destructive" })
      return
    }
    if (!groupsValid) {
      toast({ title: "群聊集合为空", description: "请选择固定群或关联至少一个标签", variant: "destructive" })
      return
    }
    if (!customRangeValid) {
      toast({ title: "自定义时间范围无效", description: "请选择完整时间，并确保结束时间不早于开始时间", variant: "destructive" })
      return
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      sourceMode: draft.sourceMode,
      fixedGroups: draft.fixedGroupCodes.map((code) => ({
        groupCode: code,
        groupName:
          store.knownGroups.find((g) => g.groupCode === code)?.groupName ||
          draft.fixedSnapshots[code]?.groupName ||
          code,
        memberCount: draft.fixedSnapshots[code]?.memberCount,
        avatarUrl: draft.fixedSnapshots[code]?.avatarUrl,
      })),
      tags: draft.tags,
      format: draft.format,
      options: {
        includeResourceLinks: draft.includeResourceLinks,
        includeSystemMessages: draft.includeSystemMessages,
        filterPureImageMessages: draft.filterPureImageMessages,
        preferGroupMemberName: draft.preferGroupMemberName,
        includeRecalled: draft.includeRecalled,
        debugExport: draft.debugExport,
        streamingZipMode: draft.streamingZipMode,
        exportAsZip: draft.exportAsZip,
        embedAvatarsAsBase64: draft.embedAvatarsAsBase64,
        embedResourcesAsDataUri: draft.embedResourcesAsDataUri,
        skipDownloadResourceTypes: draft.filterPureImageMessages
          ? undefined
          : draft.skipDownloadResourceTypes,
        useNameInFileName: draft.useNameInFileName,
        useFriendlyFileName: draft.useFriendlyFileName,
        keywords: draft.keywords.trim() || undefined,
        excludeUserUins: draft.excludeUserUins.trim() || undefined,
        includeUserUins: draft.includeUserUins.trim() || undefined,
      },
      outputDir: draft.outputDir.trim() || undefined,
      incremental: draft.incremental,
      timeRangeType: draft.timeRangeType,
      customTimeRange:
        draft.timeRangeType === "custom"
          ? {
              startTime: Math.floor(new Date(draft.customStartTime).getTime() / 1000),
              endTime: Math.floor(new Date(draft.customEndTime).getTime() / 1000),
            }
          : undefined,
      batchSize: draft.batchSize,
    }
    if (mode === "edit" && initialPlan) {
      store.updatePlan(initialPlan.id, payload)
      toast({ title: "已保存", description: `任务「${payload.name}」已更新` })
    } else {
      store.createPlan(payload)
      toast({ title: "创建成功", description: `任务「${payload.name}」已创建，点击「运行」开始导出` })
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <DialogTitle className="sr-only">{mode === "edit" ? "编辑导出任务" : "新建导出任务"}</DialogTitle>

        <div className="flex-1 flex min-h-0 w-full">
          {/* 左侧 - 群聊集合 */}
          <div className="w-2/5 max-w-[500px] min-w-[300px] flex-shrink-0 flex flex-col pt-12 pl-12 pr-8 pb-6">
            <h1 className="text-[20px] font-semibold text-foreground mb-2">
              {mode === "edit" ? "编辑导出任务" : "新建导出任务"}
            </h1>
            <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">
              选择要纳入任务的群聊，右侧配置导出与执行方式。
            </p>

            <div className="flex-1 overflow-hidden flex flex-col space-y-4">
              {/* 来源模式切换 */}
              <div className="flex gap-1 p-0.5 rounded-full bg-black/[0.03] dark:bg-white/[0.04]">
                {(
                  [
                    { id: "fixed", label: "固定群聊" },
                    { id: "tags", label: "标签关联" },
                    { id: "mixed", label: "混合" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => patch({ sourceMode: m.id })}
                    className={[
                      "flex-1 px-3 py-1.5 text-[13px] font-medium rounded-full transition-all text-center",
                      draft.sourceMode === m.id
                        ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {draft.sourceMode !== "tags" && (
                <FixedGroupPicker draft={draft} patch={patch} store={store} />
              )}
              {draft.sourceMode !== "fixed" && (
                <TagPicker draft={draft} patch={patch} store={store} />
              )}

              {/* 解析结果 */}
              <div className="flex justify-between items-center pt-2 mt-auto">
                <span className="text-sm text-muted-foreground">
                  {resolved.length > 0 ? (
                    <>
                      共 <span className="text-foreground font-medium tabular-nums">{resolved.length}</span> 个群
                    </>
                  ) : (
                    "尚未选择群聊"
                  )}
                </span>
                {resolved.length > 0 && (
                  <span className="text-xs text-muted-foreground/60 truncate max-w-[240px]">
                    {resolved.slice(0, 3).map((g) => g.groupName).join("、")}
                    {resolved.length > 3 ? " 等" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧 - 配置选项 */}
          <div className="flex-1 min-w-0 overflow-y-auto px-10 xl:px-12 pt-12 pb-8">
            <div className="w-full max-w-[760px] mx-auto space-y-10">
              {/* 基本信息 */}
              <section>
                <h2 className={SECTION_TITLE}>基本信息</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className={FIELD_LABEL}>任务名称</label>
                    <Input
                      autoFocus
                      placeholder="例如：学校交流群备份"
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                      maxLength={40}
                      className={PILL_INPUT + " w-full"}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={FIELD_LABEL}>备注（可选）</label>
                    <Input
                      placeholder="记录这个任务的用途，方便日后维护"
                      value={draft.description}
                      onChange={(e) => patch({ description: e.target.value })}
                      maxLength={120}
                      className={PILL_INPUT + " w-full"}
                    />
                  </div>
                </div>
              </section>

              {/* 导出设置 */}
              <section>
                <h2 className={SECTION_TITLE}>导出设置</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className={FIELD_LABEL}>导出格式</label>
                    <div className="flex items-center flex-wrap gap-1 p-1 rounded-[20px] bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                      {(["HTML", "JSON", "TXT", "EXCEL"] as const).map((fmt) => {
                        const active = draft.format === fmt
                        return (
                          <button
                            key={fmt}
                            type="button"
                            className={[
                              "px-5 h-[30px] text-[13px] font-medium rounded-full transition-all",
                              active
                                ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                                : "text-muted-foreground hover:text-foreground",
                            ].join(" ")}
                            onClick={() =>
                              patch({
                                format: fmt,
                                filterPureImageMessages: fmt === "JSON" || fmt === "TXT",
                                streamingZipMode:
                                  fmt === "JSON" || fmt === "HTML" ? draft.streamingZipMode : false,
                                exportAsZip: fmt === "HTML" ? draft.exportAsZip : false,
                                embedAvatarsAsBase64:
                                  fmt === "JSON" ? draft.embedAvatarsAsBase64 : false,
                                embedResourcesAsDataUri:
                                  fmt === "HTML" ? draft.embedResourcesAsDataUri : false,
                              })
                            }
                          >
                            {fmt}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {!draft.incremental && (
                    <div className="space-y-2">
                      <label className={FIELD_LABEL}>时间范围</label>
                      <div className="inline-flex items-center flex-wrap gap-1 p-1 rounded-[20px] bg-black/[0.04] dark:bg-white/[0.06] w-fit max-w-full">
                        {(
                          [
                            { id: "all", label: "全部消息" },
                            { id: "recent-3-months", label: "最近 3 个月" },
                            { id: "last-7-days", label: "最近 7 天" },
                            { id: "last-30-days", label: "最近 30 天" },
                            { id: "custom", label: "自定义" },
                          ] as const
                        ).map((t) => {
                          const active = draft.timeRangeType === t.id
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={[
                                "px-5 h-[30px] text-[13px] font-medium rounded-full transition-all",
                                active
                                  ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                                  : "text-muted-foreground hover:text-foreground",
                              ].join(" ")}
                              onClick={() => patch({ timeRangeType: t.id })}
                            >
                              {t.label}
                            </button>
                          )
                        })}
                      </div>
                      {draft.timeRangeType === "custom" && (
                        <div className="space-y-2">
                          <DateRangePicker
                            startTime={draft.customStartTime}
                            endTime={draft.customEndTime}
                            onChange={(start, end) => patch({ customStartTime: start, customEndTime: end })}
                          />
                          {!customRangeValid && (draft.customStartTime || draft.customEndTime) && (
                            <div className="text-[12px] text-red-600 dark:text-red-400">
                              请选择完整时间，并确保结束时间不早于开始时间
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* 过滤条件 */}
              <section>
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((value) => !value)}
                  className={["inline-flex items-center gap-2 text-left", filtersOpen ? "mb-5" : ""].join(" ")}
                >
                  <span className="text-[14px] font-medium text-foreground">过滤条件</span>
                  {[draft.keywords, draft.excludeUserUins, draft.includeUserUins].filter((value) => value.trim()).length > 0 && (
                    <span className="rounded-full bg-[#317CFF]/10 px-2 py-0.5 text-[10px] font-medium text-[#317CFF]">
                      已配置 {[draft.keywords, draft.excludeUserUins, draft.includeUserUins].filter((value) => value.trim()).length} 项
                    </span>
                  )}
                  <ChevronDown
                    className={["h-4 w-4 text-muted-foreground transition-transform", filtersOpen ? "rotate-180" : ""].join(" ")}
                  />
                </button>
                {filtersOpen && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className={FIELD_LABEL}>关键词过滤</label>
                      <Input
                        placeholder="用逗号分隔多个关键词，如：重要,会议,通知"
                        value={draft.keywords}
                        onChange={(event) => patch({ keywords: event.target.value })}
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={FIELD_LABEL}>屏蔽用户</label>
                      <Input
                        placeholder="用逗号分隔多个 QQ 号"
                        value={draft.excludeUserUins}
                        onChange={(event) => patch({ excludeUserUins: event.target.value })}
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={FIELD_LABEL}>仅保留用户</label>
                      <Input
                        placeholder="用逗号分隔多个 QQ 号，留空表示不限制"
                        value={draft.includeUserUins}
                        onChange={(event) => patch({ includeUserUins: event.target.value })}
                        className={PILL_INPUT + " w-full"}
                      />
                    </div>
                  </div>
                )}
              </section>

              <hr className="border-black/[0.06] dark:border-white/[0.08]" />

              {/* 高级选项 */}
              <section>
                <h2 className={SECTION_TITLE}>高级选项</h2>
                <div className="space-y-6">
                  {(() => {
                    const options = [
                      { id: "includeResourceLinks", checked: draft.includeResourceLinks, set: (v: boolean) => patch({ includeResourceLinks: v }), title: "包含资源链接", desc: "在导出中包含图片、文件等资源的下载链接", visible: true, group: "导出内容" },
                      { id: "includeSystemMessages", checked: draft.includeSystemMessages, set: (v: boolean) => patch({ includeSystemMessages: v }), title: "包含系统消息", desc: "包含入群通知、撤回提示等系统提示消息", visible: true, group: "导出内容" },
                      { id: "includeRecalled", checked: draft.includeRecalled, set: (v: boolean) => patch({ includeRecalled: v }), title: "包含撤回消息", desc: "在可获取时保留已撤回消息", visible: true, group: "导出内容" },
                      { id: "filterPureImageMessages", checked: draft.filterPureImageMessages, set: (v: boolean) => patch({ filterPureImageMessages: v }), title: "快速导出（跳过资源下载）", desc: "保留消息记录，但不下载图片、视频、语音等资源", visible: true, group: "导出内容" },
                      { id: "skipFileDownload", checked: !!draft.skipDownloadResourceTypes?.includes("file"), set: (v: boolean) => patch({ skipDownloadResourceTypes: toggleSkipResourceType(draft.skipDownloadResourceTypes, "file", v) }), title: "仅保留文件元数据，不下载文件", desc: "群文件和聊天文档仅保留文件名、大小、MD5 等信息", visible: !draft.filterPureImageMessages, group: "导出内容" },
                      { id: "skipImageDownload", checked: !!draft.skipDownloadResourceTypes?.includes("image"), set: (v: boolean) => patch({ skipDownloadResourceTypes: toggleSkipResourceType(draft.skipDownloadResourceTypes, "image", v) }), title: "不下载图片", desc: "跳过图片资源下载，HTML 中以占位形式显示", visible: !draft.filterPureImageMessages, group: "导出内容" },
                      { id: "skipVideoDownload", checked: !!draft.skipDownloadResourceTypes?.includes("video"), set: (v: boolean) => patch({ skipDownloadResourceTypes: toggleSkipResourceType(draft.skipDownloadResourceTypes, "video", v) }), title: "不下载视频", desc: "避免视频占用大量带宽和磁盘空间", visible: !draft.filterPureImageMessages, group: "导出内容" },
                      { id: "skipAudioDownload", checked: !!draft.skipDownloadResourceTypes?.includes("audio"), set: (v: boolean) => patch({ skipDownloadResourceTypes: toggleSkipResourceType(draft.skipDownloadResourceTypes, "audio", v) }), title: "不下载语音", desc: "跳过 SILK、AMR 等语音资源下载", visible: !draft.filterPureImageMessages, group: "导出内容" },
                      { id: "preferGroupMemberName", checked: draft.preferGroupMemberName, set: (v: boolean) => patch({ preferGroupMemberName: v }), title: "优先使用群成员名称", desc: "优先使用群名片或群内名称", visible: true, group: "导出内容" },
                      { id: "embedAvatarsAsBase64", checked: draft.embedAvatarsAsBase64, set: (v: boolean) => patch({ embedAvatarsAsBase64: v }), title: "嵌入头像为 Base64", desc: "将发送者头像嵌入 JSON 文件", visible: draft.format === "JSON" && !draft.streamingZipMode, group: "导出内容" },
                      { id: "embedResourcesAsDataUri", checked: draft.embedResourcesAsDataUri, set: (v: boolean) => patch({ embedResourcesAsDataUri: v, exportAsZip: v ? false : draft.exportAsZip }), title: "生成自包含 HTML", desc: "把资源内联到单个 HTML，不再生成 resources 目录", visible: draft.format === "HTML" && !draft.exportAsZip && !draft.streamingZipMode, group: "导出内容" },
                      { id: "useNameInFileName", checked: draft.useNameInFileName, set: (v: boolean) => patch({ useNameInFileName: v }), title: "文件名包含会话名称", desc: "保留旧客户端的名称文件名兼容设置", visible: true, group: "文件命名" },
                      { id: "useFriendlyFileName", checked: draft.useFriendlyFileName, set: (v: boolean) => patch({ useFriendlyFileName: v }), title: "使用友好文件名", desc: "使用名称、群号和时间生成可读文件名", visible: true, group: "文件命名" },
                      { id: "streamingZipMode", checked: draft.streamingZipMode, set: (v: boolean) => patch({ streamingZipMode: v, exportAsZip: v ? false : draft.exportAsZip, embedResourcesAsDataUri: v ? false : draft.embedResourcesAsDataUri }), title: "流式导出（超大消息量专用）", desc: draft.format === "HTML" ? "输出流式 ZIP，适合 50 万条以上记录" : "输出分块 JSONL，适合 50 万条以上记录", visible: draft.format === "HTML" || draft.format === "JSON", group: "性能与处理" },
                      { id: "exportAsZip", checked: draft.exportAsZip, set: (v: boolean) => patch({ exportAsZip: v, embedResourcesAsDataUri: v ? false : draft.embedResourcesAsDataUri }), title: "导出为 ZIP 压缩包", desc: "将 HTML 和资源文件打包为 ZIP", visible: draft.format === "HTML" && !draft.streamingZipMode, group: "性能与处理" },
                      { id: "debugExport", checked: draft.debugExport, set: (v: boolean) => patch({ debugExport: v }), title: "调试导出", desc: "额外保存原始消息、解析结果与资源调用错误", visible: true, group: "性能与处理" },
                    ].filter((option) => option.visible)

                    return ["导出内容", "文件命名", "性能与处理"]
                      .map((groupName) => ({ groupName, items: options.filter((option) => option.group === groupName) }))
                      .filter(({ items }) => items.length > 0)
                      .map(({ groupName, items }) => (
                        <div key={groupName} className="space-y-2.5">
                          <h3 className="text-[12px] font-medium text-muted-foreground pl-1">{groupName}</h3>
                          <div className="bg-neutral-50/50 dark:bg-white/[0.03] rounded-2xl border border-neutral-100/80 dark:border-white/[0.06] overflow-hidden divide-y divide-neutral-100/80 dark:divide-white/[0.06]">
                            {items.map((option) => (
                              <div key={option.id} className="flex items-center justify-between gap-6 p-4 transition-colors">
                                <div className="flex flex-col gap-0.5 flex-1 pr-4">
                                  <div className="text-[13px] font-medium text-foreground">{option.title}</div>
                                  <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">{option.desc}</div>
                                </div>
                                <Switch checked={option.checked} onCheckedChange={option.set} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                  })()}
                </div>

                {/* 自定义存储路径（对齐 TaskWizard 的位置与样式） */}
                <div className="space-y-2.5 pt-4">
                  <label className="block text-[12px] font-medium text-muted-foreground pl-1">自定义存储路径</label>
                  <Input
                    placeholder="留空则使用默认导出目录"
                    value={draft.outputDir}
                    onChange={(e) => patch({ outputDir: e.target.value })}
                    className={PILL_INPUT + " w-full"}
                  />
                </div>
              </section>

              {/* 执行策略 */}
              <section>
                <h2 className={SECTION_TITLE}>执行策略</h2>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-6 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="flex flex-col gap-0.5 flex-1 pr-4">
                      <div className="text-[13px] font-medium text-foreground">增量导出</div>
                      <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        {draft.incremental
                          ? progressed > 0
                            ? `已为 ${progressed} 个群记录进度，下次从上次位置继续`
                            : "首次导出全部历史，之后仅导出上次之后的新消息"
                          : "每次按所选时间范围导出"}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Switch checked={draft.incremental} onCheckedChange={(v) => patch({ incremental: v })} />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[13px] font-medium text-foreground">自动拆分执行</div>
                        <div className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                          大批量自动拆成小批次顺序执行，不受单次任务数量限制
                        </div>
                      </div>
                      <span className="text-[13px] text-muted-foreground tabular-nums flex-shrink-0">
                        每批 <span className="text-foreground font-medium">{draft.batchSize}</span> 群
                      </span>
                    </div>
                    <Slider
                      value={[draft.batchSize]}
                      min={MIN_BATCH_SIZE}
                      max={MAX_BATCH_SIZE}
                      step={5}
                      onValueChange={([v]) => patch({ batchSize: v })}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="h-[72px] flex items-center justify-between px-10 flex-shrink-0">
          <div className="text-[13px] font-medium text-muted-foreground">
            {canSubmit ? (
              <span className="text-foreground">
                配置就绪，{resolved.length} 个群将分为 {batches.length} 批执行
              </span>
            ) : (
              <span>
                {!nameValid
                  ? "请填写任务名称"
                  : !groupsValid
                    ? "请选择固定群或关联标签"
                    : "请填写有效的自定义时间范围"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-full text-[13px] h-8 px-6 bg-[#317CFF] text-white hover:bg-[#2867d6]"
            >
              {mode === "edit" ? "保存更改" : "创建任务"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 固定群选择（行样式对齐 ScheduledExportWizard 的目标列表）
// ---------------------------------------------------------------------------

function FixedGroupPicker({
  draft,
  patch,
  store,
}: {
  draft: DraftState
  patch: (u: Partial<DraftState>) => void
  store: Store
}) {
  const [keyword, setKeyword] = useState("")
  const selected = new Set(draft.fixedGroupCodes)

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = store.knownGroups
    if (!kw) return list.slice(0, 60)
    return list.filter((g) => g.groupName.toLowerCase().includes(kw) || g.groupCode.includes(kw)).slice(0, 60)
  }, [store.knownGroups, keyword])

  const toggle = (code: string) => {
    const next = new Set(selected)
    const snapshots = { ...draft.fixedSnapshots }
    if (next.has(code)) {
      next.delete(code)
    } else {
      next.add(code)
      const g = store.knownGroups.find((x) => x.groupCode === code)
      if (g) snapshots[code] = { groupName: g.groupName, memberCount: g.memberCount, avatarUrl: g.avatarUrl }
    }
    patch({ fixedGroupCodes: Array.from(next), fixedSnapshots: snapshots })
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col space-y-2 min-h-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
        <Input
          placeholder="搜索群组名称、群号..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="pl-10 rounded-full h-9 border-0 bg-black/[0.03] dark:bg-white/[0.05] shadow-none focus-visible:ring-0 focus-visible:border-0"
        />
      </div>

      <div className="flex-1 min-h-0 max-h-96 overflow-y-auto space-y-1 rounded-2xl p-2 bg-card/70">
        {candidates.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Users className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm">{store.knownGroups.length === 0 ? "暂无群组数据" : `没有找到匹配 "${keyword}" 的群组`}</p>
            {store.knownGroups.length === 0 && (
              <p className="text-xs text-muted-foreground/60 mt-1">群列表正在加载，稍等一下或到「会话」页刷新</p>
            )}
          </div>
        ) : (
          candidates.map((g) => {
            const isSelected = selected.has(g.groupCode)
            return (
              <div
                key={g.groupCode}
                className={[
                  "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all",
                  "border border-transparent hover:bg-muted/50",
                ].join(" ")}
                onClick={() => toggle(g.groupCode)}
              >
                <Checkbox checked={isSelected} className="pointer-events-none" />
                <Avatar className="w-7 h-7 rounded-xl">
                  {g.avatarUrl && <AvatarImage src={g.avatarUrl} alt={g.groupName} />}
                  <AvatarFallback className="rounded-xl text-xs">{g.groupName[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate text-foreground">{g.groupName}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" />
                    <span>{g.memberCount} 成员</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">已选择 {selected.size} 个固定群</span>
        {selected.size > 0 && (
          <Button variant="outline" size="sm" onClick={() => patch({ fixedGroupCodes: [] })} className="rounded-full">
            清空
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 标签选择与管理
// ---------------------------------------------------------------------------

function TagPicker({
  draft,
  patch,
  store,
}: {
  draft: DraftState
  patch: (u: Partial<DraftState>) => void
  store: Store
}) {
  const [newTag, setNewTag] = useState("")
  const [managing, setManaging] = useState(false)
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const addTag = () => {
    const tag = newTag.trim().replace(/^#/, "")
    if (!tag) return
    if (!draft.tags.includes(tag)) patch({ tags: [...draft.tags, tag] })
    setNewTag("")
    setActiveTag(tag)
    setManaging(true)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between pl-1">
        <h3 className="text-[12px] font-medium text-muted-foreground">关联标签</h3>
        {store.allTags.length > 0 && (
          <button
            onClick={() => {
              setManaging((v) => !v)
              if (!activeTag) setActiveTag(draft.tags[0] || store.allTags[0]?.name || null)
            }}
            className="text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-0.5"
          >
            管理标签
            <ChevronDown className={`w-3 h-3 transition-transform ${managing ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {store.allTags.map((t) => {
          const selected = draft.tags.includes(t.name)
          return (
            <button
              key={t.name}
              onClick={() =>
                patch({ tags: selected ? draft.tags.filter((x) => x !== t.name) : [...draft.tags, t.name] })
              }
              className={[
                "h-7 px-3 rounded-full text-[12px] transition-all",
                selected
                  ? "bg-white dark:bg-white/10 text-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] dark:ring-white/[0.1]"
                  : "bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              #{t.name}
              <span className="text-[10px] tabular-nums ml-1 text-muted-foreground/50">{t.count}</span>
            </button>
          )
        })}
        {draft.tags
          .filter((t) => !store.allTags.some((x) => x.name === t))
          .map((t) => (
            <button
              key={t}
              onClick={() => patch({ tags: draft.tags.filter((x) => x !== t) })}
              className="h-7 pl-3 pr-2 rounded-full text-[12px] font-medium bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] dark:ring-white/[0.1] flex items-center gap-1"
            >
              #{t}
              <X className="w-3 h-3 text-muted-foreground/50" />
            </button>
          ))}
        <span className="inline-flex items-center h-7 rounded-full bg-black/[0.04] dark:bg-white/[0.06] px-3 focus-within:bg-black/[0.06] dark:focus-within:bg-white/[0.09] transition-colors">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="新建标签"
            className="w-20 bg-transparent outline-none text-[12px] placeholder:text-muted-foreground/50"
          />
          {newTag.trim() && (
            <button onClick={addTag} className="text-muted-foreground/60 hover:text-foreground">
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {managing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <TagManager store={store} activeTag={activeTag} onSelectTag={setActiveTag} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TagManager({
  store,
  activeTag,
  onSelectTag,
}: {
  store: Store
  activeTag: string | null
  onSelectTag: (tag: string) => void
}) {
  const [keyword, setKeyword] = useState("")
  const tags = store.allTags

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = store.knownGroups
    if (!kw) return list.slice(0, 40)
    return list.filter((g) => g.groupName.toLowerCase().includes(kw)).slice(0, 40)
  }, [store.knownGroups, keyword])

  if (tags.length === 0) return null
  const current = activeTag && tags.some((t) => t.name === activeTag) ? activeTag : tags[0]?.name

  return (
    <div className="rounded-2xl p-2 bg-card/70 space-y-1">
      <div className="flex items-center gap-1 overflow-x-auto px-1 py-1">
        {tags.map((t) => (
          <button
            key={t.name}
            onClick={() => onSelectTag(t.name)}
            className={[
              "h-6 px-2.5 rounded-full text-[11px] whitespace-nowrap transition-all",
              current === t.name
                ? "bg-white dark:bg-white/10 text-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-muted-foreground/60 hover:text-foreground",
            ].join(" ")}
          >
            #{t.name}
          </button>
        ))}
      </div>
      <div className="relative px-1">
        <Search className="w-3 h-3 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={`勾选即打上 #${current} 标签`}
          className="h-8 pl-8 rounded-full text-[12px]"
        />
      </div>
      <div className="max-h-[180px] overflow-y-auto space-y-1">
        {candidates.map((g) => {
          const has = (store.groupTags[g.groupCode] || []).includes(current)
          return (
            <div
              key={g.groupCode}
              className={[
                "flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all border border-transparent hover:bg-muted/50",
              ].join(" ")}
              onClick={() => store.toggleGroupTag(g.groupCode, current, !has)}
            >
              <Checkbox checked={has} className="pointer-events-none" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate text-foreground">{g.groupName}</p>
                {(store.groupTags[g.groupCode] || []).length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">
                    {(store.groupTags[g.groupCode] || []).map((t) => `#${t}`).join(" ")}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
