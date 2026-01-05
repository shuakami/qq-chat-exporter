"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConfig } from "@/hooks/use-config"
import { motion } from "framer-motion"
import { Save, RotateCcw } from "lucide-react"
import { EASE, DUR, fadeSlide, hoverLift } from "@/components/qce-dashboard/animations"

export function SettingsPanel() {
  const { config, loading, updateConfig } = useConfig()
  const [customOutputDir, setCustomOutputDir] = useState("")
  const [customScheduledExportDir, setCustomScheduledExportDir] = useState("")
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <motion.div
      className="space-y-6 max-w-3xl"
      {...fadeSlide}
    >
      {/* 导出路径配置 */}
      <motion.div
        className="rounded-2xl border border-border bg-background/60 p-6"
        {...hoverLift}
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-medium text-foreground">导出路径配置</h3>
            <p className="text-sm text-muted-foreground mt-1">自定义默认导出路径，留空使用系统默认</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customOutputDir" className="text-sm text-muted-foreground">
                手动导出路径
              </Label>
              <Input
                id="customOutputDir"
                value={customOutputDir}
                onChange={(e) => setCustomOutputDir(e.target.value)}
                placeholder="留空使用默认路径"
                className="rounded-xl"
              />
              {config?.currentExportsDir && (
                <p className="text-xs text-muted-foreground">
                  当前: {config.currentExportsDir}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="customScheduledExportDir" className="text-sm text-muted-foreground">
                定时备份路径
              </Label>
              <Input
                id="customScheduledExportDir"
                value={customScheduledExportDir}
                onChange={(e) => setCustomScheduledExportDir(e.target.value)}
                placeholder="留空使用默认路径"
                className="rounded-xl"
              />
              {config?.currentScheduledExportsDir && (
                <p className="text-xs text-muted-foreground">
                  当前: {config.currentScheduledExportsDir}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t border-border">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="rounded-full"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "保存中..." : "保存配置"}
            </Button>
            <Button
              onClick={handleReset}
              disabled={!hasChanges}
              variant="outline"
              className="rounded-full"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              重置
            </Button>
          </div>
        </div>
      </motion.div>

      {/* 说明 */}
      <motion.div
        className="rounded-2xl border border-border bg-background/60 p-6"
        {...hoverLift}
      >
        <div className="space-y-3">
          <h3 className="text-base font-medium text-foreground">说明</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>配置后，所有新建的导出任务将自动使用新路径</li>
            <li>留空则使用系统默认路径（用户目录下的 .qq-chat-exporter）</li>
            <li>路径必须在用户目录内，禁止访问系统关键目录</li>
          </ul>
        </div>
      </motion.div>
    </motion.div>
  )
}
