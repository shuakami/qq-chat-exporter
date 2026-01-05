"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConfig } from "@/hooks/use-config"
import { motion } from "framer-motion"
import { Save, RotateCcw, RefreshCw } from "lucide-react"
import { EASE, DUR, fadeSlide } from "@/components/qce-dashboard/animations"

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
    <motion.div className="space-y-6 pt-10" {...fadeSlide}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">设置</h2>
          <p className="text-muted-foreground mt-1">配置导出路径和其他选项</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => loadConfig()}
            disabled={loading}
            className="p-2 rounded-full text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            whileTap={{ rotate: -20, scale: 0.95 }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="rounded-full"
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "保存中..." : "保存"}
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

      {/* Content */}
      {loading ? (
        <motion.div
          className="rounded-2xl border border-dashed border-border bg-muted/50 py-14 text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">加载配置中...</p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {/* 手动导出路径 */}
          <div className="rounded-xl border border-border bg-background hover:border-border transition-all p-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="customOutputDir" className="text-sm font-medium text-foreground">
                  手动导出路径
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  新建导出任务时使用的默认保存位置
                </p>
              </div>
              <Input
                id="customOutputDir"
                value={customOutputDir}
                onChange={(e) => setCustomOutputDir(e.target.value)}
                placeholder="留空使用默认路径"
                className="rounded-lg"
              />
              {config?.currentExportsDir && (
                <p className="text-xs text-muted-foreground">
                  当前: <span className="font-mono text-foreground/70">{config.currentExportsDir}</span>
                </p>
              )}
            </div>
          </div>

          {/* 定时导出路径 */}
          <div className="rounded-xl border border-border bg-background hover:border-border transition-all p-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="customScheduledExportDir" className="text-sm font-medium text-foreground">
                  定时导出路径
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  定时备份任务使用的默认保存位置
                </p>
              </div>
              <Input
                id="customScheduledExportDir"
                value={customScheduledExportDir}
                onChange={(e) => setCustomScheduledExportDir(e.target.value)}
                placeholder="留空使用默认路径"
                className="rounded-lg"
              />
              {config?.currentScheduledExportsDir && (
                <p className="text-xs text-muted-foreground">
                  当前: <span className="font-mono text-foreground/70">{config.currentScheduledExportsDir}</span>
                </p>
              )}
            </div>
          </div>

          {/* 说明 */}
          <div className="text-sm text-muted-foreground space-y-1 pt-2">
            <p>留空则使用默认路径（用户目录下的 .qq-chat-exporter）</p>
            <p>路径必须在用户目录内，禁止访问系统关键目录</p>
          </div>
        </div>
      )}
    </motion.div>
  )
}
