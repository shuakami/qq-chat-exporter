"use client"

import { useState, useEffect, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { PillDropdown } from "@/components/ui/pill-dropdown"
import { Switch } from "@/components/ui/switch"
import { useConfig } from "@/hooks/use-config"
import { useSecurity } from "@/hooks/use-security"
import { useThemeMode, type ThemeMode } from "@/hooks/use-theme-mode"
import { Loader } from "@/components/ui/loader"
import { CopyButton } from "@/components/ui/copy-button"
import { X } from "lucide-react"

/** 编辑触发按钮（卡片行内右侧，无边框）。 */
function EditButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="h-8 shrink-0 rounded-full px-3 text-[13px] font-medium text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
    >
      编辑
    </Button>
  )
}

/** 模态框头部：左侧标题 + 说明，右上角关闭按钮（无分割线）。 */
function ModalHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </div>
      <DialogClose asChild>
        <button
          type="button"
          aria-label="关闭"
          className="-mr-1 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
        >
          <X className="h-4 w-4" />
        </button>
      </DialogClose>
    </div>
  )
}

/** 模态框内的分组容器：微弱灰底、圆角、行间细分割线。 */
function FieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
      <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">{children}</div>
    </div>
  )
}

/** 一条路径展示：标签 + 路径 + 尾随复制按钮。 */
function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[12px] text-muted-foreground/60">{label}</span>
      <span className="truncate font-mono text-[12px] text-muted-foreground" title={value}>
        {value}
      </span>
      <CopyButton text={value} variant="inline" size="xs" title={`复制${label}路径`} />
    </div>
  )
}

/** 设置分区：标题 + 可选说明 + 内容卡片（微弱灰底、无边框）。 */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3 px-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="overflow-hidden rounded-xl bg-black/[0.02] dark:bg-white/[0.03]">
        <div className="divide-y divide-black/[0.035] dark:divide-white/[0.04]">{children}</div>
      </div>
    </section>
  )
}

/** 卡片内的一行：左侧标题+说明，右侧内容，垂直居中。 */
function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children != null && <div className="min-w-0 shrink-0 text-right">{children}</div>}
    </div>
  )
}

const DEFAULT_HINT = "默认目录（用户目录下的 .qq-chat-exporter）"

export function SettingsPanel() {
  const { config, loading, loadConfig, updateConfig } = useConfig()
  const {
    whitelist,
    busy: securityBusy,
    load: loadSecurity,
    addIp,
    removeIp,
    addCurrentIp,
    setWhitelistEnabled,
  } = useSecurity()
  const { mode, setThemeMode } = useThemeMode()
  const [customOutputDir, setCustomOutputDir] = useState("")
  const [customScheduledExportDir, setCustomScheduledExportDir] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [ipOpen, setIpOpen] = useState(false)
  const [newIp, setNewIp] = useState("")

  useEffect(() => {
    loadConfig()
    loadSecurity()
  }, [loadConfig, loadSecurity])

  const syncFromConfig = () => {
    setCustomOutputDir(config?.customOutputDir || "")
    setCustomScheduledExportDir(config?.customScheduledExportDir || "")
  }

  useEffect(() => {
    if (config) syncFromConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const openEdit = () => {
    syncFromConfig()
    setEditOpen(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateConfig({
        customOutputDir: customOutputDir.trim() || null,
        customScheduledExportDir: customScheduledExportDir.trim() || null,
      })
      setEditOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "跟随系统" },
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
  ]

  const manualDir = config?.customOutputDir || config?.currentExportsDir || DEFAULT_HINT
  const scheduledDir =
    config?.customScheduledExportDir || config?.currentScheduledExportsDir || DEFAULT_HINT

  const whitelistEnabled = whitelist ? !whitelist.disabled : false
  const allowedIPs = whitelist?.allowedIPs ?? []
  const currentIp = whitelist?.currentClientIP ?? null
  const currentIpListed = currentIp != null && allowedIPs.includes(currentIp)

  const handleAddIp = async () => {
    const ip = newIp.trim()
    if (!ip) return
    const ok = await addIp(ip)
    if (ok) setNewIp("")
  }

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-10">
      <h1 className="px-1 text-[22px] font-semibold tracking-tight text-foreground">设置</h1>

      {loading && !config ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader size={16} className="mb-2 text-muted-foreground/40" />
          <p className="text-[13px] text-muted-foreground/60">加载配置中...</p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {/* Appearance */}
          <Section title="外观">
            <Row title="主题" description="跟随系统，或强制使用浅色 / 深色显示">
              <PillDropdown<ThemeMode>
                value={mode}
                onChange={setThemeMode}
                options={themeOptions}
              />
            </Row>
          </Section>

          {/* Export paths */}
          <Section title="导出路径">
            <div className="flex items-center justify-between gap-6 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">保存位置</div>
                <div className="mt-2 space-y-1.5">
                  <PathLine label="手动" value={manualDir} />
                  <PathLine label="定时" value={scheduledDir} />
                </div>
              </div>
              <EditButton onClick={openEdit} />
            </div>
          </Section>

          {/* Security */}
          <Section title="安全">
            <Row
              title="IP 白名单"
              description={
                whitelist?.isDocker
                  ? "Docker 环境默认放行容器网络，开启后仅允许名单内的 IP 访问"
                  : "开启后仅允许名单内的 IP 访问，关闭时任何知道地址和令牌的人都能访问"
              }
            >
              <Switch
                checked={whitelistEnabled}
                disabled={securityBusy || !whitelist}
                onCheckedChange={(v) => setWhitelistEnabled(v)}
              />
            </Row>
            <Row
              title="允许的 IP 名单"
              description={
                whitelist
                  ? `${allowedIPs.length} 个地址 / 网段${currentIp ? `，当前来源 ${currentIp}` : ""}`
                  : "加载中…"
              }
            >
              <EditButton onClick={() => setIpOpen(true)} disabled={!whitelist} />
            </Row>
          </Section>
        </div>
      )}

      {/* Edit paths modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          overlayClassName="bg-background/80 dark:bg-background/80"
          className="max-w-md rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
        >
          <ModalHeader
            title="编辑导出路径"
            description="留空则使用默认目录，禁止访问系统关键目录"
          />

          <div className="px-5">
            <FieldGroup>
              <div className="flex items-center gap-3 px-3.5 py-2.5">
                <Label
                  htmlFor="customOutputDir"
                  className="w-14 shrink-0 text-[13px] font-medium text-muted-foreground"
                >
                  手动
                </Label>
                <Input
                  id="customOutputDir"
                  value={customOutputDir}
                  onChange={(e) => setCustomOutputDir(e.target.value)}
                  placeholder={config?.currentExportsDir || DEFAULT_HINT}
                  className="h-8 flex-1 rounded-none border-0 bg-transparent px-0 font-mono text-[13px] shadow-none focus:border-0 dark:bg-transparent"
                />
              </div>
              <div className="flex items-center gap-3 px-3.5 py-2.5">
                <Label
                  htmlFor="customScheduledExportDir"
                  className="w-14 shrink-0 text-[13px] font-medium text-muted-foreground"
                >
                  定时
                </Label>
                <Input
                  id="customScheduledExportDir"
                  value={customScheduledExportDir}
                  onChange={(e) => setCustomScheduledExportDir(e.target.value)}
                  placeholder={config?.currentScheduledExportsDir || DEFAULT_HINT}
                  className="h-8 flex-1 rounded-none border-0 bg-transparent px-0 font-mono text-[13px] shadow-none focus:border-0 dark:bg-transparent"
                />
              </div>
            </FieldGroup>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-5">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5 text-[13px]">
                取消
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="h-8 rounded-full bg-[#317CFF] px-4 text-[13px] text-white hover:bg-[#2867d6]"
            >
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* IP whitelist modal */}
      <Dialog open={ipOpen} onOpenChange={setIpOpen}>
        <DialogContent
          overlayClassName="bg-background/80 dark:bg-background/80"
          className="max-w-md rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
        >
          <ModalHeader
            title="IP 白名单"
            description="只有名单内的 IP / 网段能访问服务，支持单个 IP、CIDR（如 192.168.1.0/24），或用 * 放行全部"
          />

          <div className="space-y-3 px-5">
            <FieldGroup>
              <div className="flex items-center gap-2 py-1 pl-3.5 pr-1.5">
                <Input
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void handleAddIp()
                    }
                  }}
                  placeholder="输入 IP 或 CIDR"
                  className="h-8 flex-1 rounded-none border-0 bg-transparent px-0 font-mono text-[13px] shadow-none focus:border-0 dark:bg-transparent"
                />
                <Button
                  size="sm"
                  onClick={() => void handleAddIp()}
                  disabled={!newIp.trim() || securityBusy}
                  className="h-7 shrink-0 rounded-full bg-[#317CFF] px-4 text-[13px] text-white hover:bg-[#2867d6]"
                >
                  添加
                </Button>
              </div>
            </FieldGroup>

            <FieldGroup>
              {allowedIPs.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[13px] text-muted-foreground/60">
                  名单为空，将无法通过白名单校验
                </p>
              ) : (
                allowedIPs.map((ip) => (
                  <div key={ip} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                    <span className="truncate font-mono text-[13px] text-foreground" title={ip}>
                      {ip}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${ip}`}
                      onClick={() => void removeIp(ip)}
                      disabled={securityBusy}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-black/[0.06] hover:text-red-500 dark:hover:bg-white/[0.08] dark:hover:text-red-400 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </FieldGroup>

            {currentIp && !currentIpListed && (
              <button
                type="button"
                onClick={() => void addCurrentIp()}
                disabled={securityBusy}
                className="text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                + 添加当前来源 IP（{currentIp}）
              </button>
            )}
          </div>

          <div className="flex items-center justify-end px-5 pb-5 pt-5">
            <DialogClose asChild>
              <Button size="sm" className="h-8 rounded-full bg-[#317CFF] px-4 text-[13px] text-white hover:bg-[#2867d6]">
                完成
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
