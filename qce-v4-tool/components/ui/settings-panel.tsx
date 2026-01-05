"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useConfig } from "@/hooks/use-config"
import { FolderOpen, Save, RotateCcw } from "lucide-react"

export function SettingsPanel() {
  const { config, loading, loadConfig, updateConfig } = useConfig()
  const [customOutputDir, setCustomOutputDir] = useState("")
  const [customScheduledExportDir, setCustomScheduledExportDir] = useState("")

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (config) {
      setCustomOutputDir(config.customOutputDir || "")
      setCustomScheduledExportDir(config.customScheduledExportDir || "")
    }
  }, [config])

  const handleSave = async () => {
    await updateConfig({
      customOutputDir: customOutputDir.trim() || null,
      customScheduledExportDir: customScheduledExportDir.trim() || null
    })
  }

  const handleReset = () => {
    if (config) {
      setCustomOutputDir(config.customOutputDir || "")
      setCustomScheduledExportDir(config.customScheduledExportDir || "")
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            导出路径设置
          </CardTitle>
          <CardDescription>
            自定义导出文件的保存位置。留空则使用默认路径。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="outputDir">默认导出路径</Label>
            <Input
              id="outputDir"
              placeholder="留空使用默认路径"
              value={customOutputDir}
              onChange={(e) => setCustomOutputDir(e.target.value)}
              disabled={loading}
            />
            {config && (
              <p className="text-sm text-muted-foreground">
                当前使用: {config.currentExportsDir}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduledExportDir">定时导出路径</Label>
            <Input
              id="scheduledExportDir"
              placeholder="留空使用默认路径"
              value={customScheduledExportDir}
              onChange={(e) => setCustomScheduledExportDir(e.target.value)}
              disabled={loading}
            />
            {config && (
              <p className="text-sm text-muted-foreground">
                当前使用: {config.currentScheduledExportsDir}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={loading}>
              <Save className="w-4 h-4 mr-2" />
              保存设置
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>
              <RotateCcw className="w-4 h-4 mr-2" />
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• 路径可以是绝对路径（如 D:\QQ-Exports）或相对路径</p>
          <p>• Windows 系统使用反斜杠（\）或正斜杠（/）均可</p>
          <p>• 修改路径后，新的导出文件将保存到新路径</p>
          <p>• 已导出的文件不会自动移动，需要手动迁移</p>
          <p>• 留空则使用默认路径：%USERPROFILE%\.qq-chat-exporter\exports</p>
        </CardContent>
      </Card>
    </div>
  )
}
