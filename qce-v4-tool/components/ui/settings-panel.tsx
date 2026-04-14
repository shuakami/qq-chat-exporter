"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConfig } from "@/hooks/use-config"
import { Save, RotateCcw, RefreshCw } from "lucide-react"

export function SettingsPanel() {
  const { config, loading, loadConfig, updateConfig } = useConfig()
  const [customOutputDir, setCustomOutputDir] = useState("")
  const [customScheduledExportDir, setCustomScheduledExportDir] = useState("")
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (config) {
      setCustomOutputDir(config.customOutputDir || "")
      setCustomScheduledExportDir(config.customScheduledExportDir || "")
    }
  }, [config])

  useEffect(() => {
    if (config) {
      const changed = 
        customOutputDir !== (config.customOutputDir || "") ||
        customScheduledExportDir !== (config.customScheduledExportDir || "")
      setHasChanges(changed)
    }
  }, [customOutputDir, customScheduledExportDir, config])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateConfig({
        customOutputDir: customOutputDir.trim() || null,
        customScheduledExportDir: customScheduledExportDir.trim() || null,
      })
      setHasChanges(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (config) {
      setCustomOutputDir(config.customOutputDir || "")
      setCustomScheduledExportDir(config.customScheduledExportDir || "")
      setHasChanges(false)
    }
  }

  return (
    <div className="p-5 space-y-5">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground/40 mb-2" />
          <p className="text-[13px] text-muted-foreground/60">加载配置中...</p>
        </div>
      ) : (
        <>
          {/* Export path */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="customOutputDir" className="text-[13px] font-medium text-foreground">
                手动导出路径
              </Label>
              <p className="text-[12px] text-muted-foreground/60 mt-0.5">
                新建导出任务时使用的默认保存位置
              </p>
            </div>
            <Input
              id="customOutputDir"
              value={customOutputDir}
              onChange={(e) => setCustomOutputDir(e.target.value)}
              placeholder="留空使用默认路径"
              className="h-9 text-[13px] rounded-lg border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] focus:bg-card"
            />
            {config?.currentExportsDir && (
              <p className="text-[11px] text-muted-foreground/50">
                当前: <span className="font-mono">{config.currentExportsDir}</span>
              </p>
            )}
          </div>

          <div className="h-px bg-black/[0.04] dark:bg-white/[0.04]" />

          {/* Scheduled export path */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="customScheduledExportDir" className="text-[13px] font-medium text-foreground">
                定时导出路径
              </Label>
              <p className="text-[12px] text-muted-foreground/60 mt-0.5">
                定时备份任务使用的默认保存位置
              </p>
            </div>
            <Input
              id="customScheduledExportDir"
              value={customScheduledExportDir}
              onChange={(e) => setCustomScheduledExportDir(e.target.value)}
              placeholder="留空使用默认路径"
              className="h-9 text-[13px] rounded-lg border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] focus:bg-card"
            />
            {config?.currentScheduledExportsDir && (
              <p className="text-[11px] text-muted-foreground/50">
                当前: <span className="font-mono">{config.currentScheduledExportsDir}</span>
              </p>
            )}
          </div>

          <div className="h-px bg-black/[0.04] dark:bg-white/[0.04]" />

          {/* Note */}
          <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
            留空则使用默认路径（用户目录下的 .qq-chat-exporter）。支持任意磁盘和文件夹，但禁止访问系统关键目录。
          </p>

          {/* Actions */}
          {hasChanges && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7 text-[12px] rounded-md px-3"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {isSaving ? "保存中..." : "保存更改"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleReset}
                className="h-7 text-[12px] rounded-md px-2.5 text-muted-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                重置
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
