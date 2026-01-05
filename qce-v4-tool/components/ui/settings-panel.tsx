"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useConfig } from "@/hooks/use-config"
import { FolderOpen, Save, RotateCcw, CheckCircle, AlertCircle, Info } from "lucide-react"
import { motion } from "framer-motion"
import { EASE, DUR, fadeSlide } from "@/components/qce-dashboard/animations"

export function SettingsPanel() {
  const { config, loading, loadConfig, updateConfig } = useConfig()
  const [customOutputDir, setCustomOutputDir] = useState("")
  const [customScheduledExportDir, setCustomScheduledExportDir] = useState("")
  const [hasChanges, setHasChanges] = useState(false)

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
        (customOutputDir !== (config.customOutputDir || "")) ||
        (customScheduledExportDir !== (config.customScheduledExportDir || ""))
      setHasChanges(changed)
    }
  }, [customOutputDir, customScheduledExportDir, config])

  const handleSave = async () => {
    const success = await updateConfig({
      customOutputDir: customOutputDir.trim() || null,
      customScheduledExportDir: customScheduledExportDir.trim() || null
    })
    if (success) {
      setHasChanges(false)
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
    <motion.div 
      className="space-y-6 max-w-4xl"
      {...fadeSlide}
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.normal, ease: EASE.out }}
      >
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl">
              <motion.div
                whileHover={{ rotate: 15, scale: 1.1 }}
                transition={{ duration: DUR.fast }}
              >
                <FolderOpen className="w-6 h-6 text-primary" />
              </motion.div>
              导出路径配置
            </CardTitle>
            <CardDescription className="text-base">
              自定义导出文件的保存位置，提升文件管理效率
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <motion.div 
              className="space-y-3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR.normal, ease: EASE.out, delay: 0.1 }}
            >
              <Label htmlFor="outputDir" className="text-base font-medium flex items-center gap-2">
                默认导出路径
                <span className="text-xs text-muted-foreground font-normal">(手动导出)</span>
              </Label>
              <Input
                id="outputDir"
                placeholder="留空使用默认路径"
                value={customOutputDir}
                onChange={(e) => setCustomOutputDir(e.target.value)}
                disabled={loading}
                className="h-11 text-base rounded-xl border-border/50 focus:border-primary transition-all"
              />
              {config && (
                <motion.div 
                  className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/30"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: DUR.fast }}
                >
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="text-muted-foreground">
                      当前使用: <code className="text-xs bg-background/50 px-2 py-0.5 rounded">{config.currentExportsDir}</code>
                    </p>
                  </div>
                </motion.div>
              )}
            </motion.div>

            <motion.div 
              className="space-y-3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR.normal, ease: EASE.out, delay: 0.2 }}
            >
              <Label htmlFor="scheduledExportDir" className="text-base font-medium flex items-center gap-2">
                定时导出路径
                <span className="text-xs text-muted-foreground font-normal">(自动备份)</span>
              </Label>
              <Input
                id="scheduledExportDir"
                placeholder="留空使用默认路径"
                value={customScheduledExportDir}
                onChange={(e) => setCustomScheduledExportDir(e.target.value)}
                disabled={loading}
                className="h-11 text-base rounded-xl border-border/50 focus:border-primary transition-all"
              />
              {config && (
                <motion.div 
                  className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/30"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: DUR.fast }}
                >
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="text-muted-foreground">
                      当前使用: <code className="text-xs bg-background/50 px-2 py-0.5 rounded">{config.currentScheduledExportsDir}</code>
                    </p>
                  </div>
                </motion.div>
              )}
            </motion.div>

            <motion.div 
              className="flex gap-3 pt-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.normal, ease: EASE.out, delay: 0.3 }}
            >
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button 
                  onClick={handleSave} 
                  disabled={loading || !hasChanges}
                  className="h-11 px-6 rounded-xl"
                >
                  <Save className="w-4 h-4 mr-2" />
                  保存设置
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button 
                  variant="outline" 
                  onClick={handleReset} 
                  disabled={loading || !hasChanges}
                  className="h-11 px-6 rounded-xl"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重置
                </Button>
              </motion.div>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.normal, ease: EASE.out, delay: 0.4 }}
      >
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              使用说明
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: "📁", text: "路径可以是绝对路径（如 D:\\QQ-Exports）或相对路径" },
              { icon: "💻", text: "Windows 系统使用反斜杠（\\）或正斜杠（/）均可" },
              { icon: "✨", text: "修改路径后，新的导出文件将保存到新路径" },
              { icon: "📦", text: "已导出的文件不会自动移动，需要手动迁移" },
              { icon: "🏠", text: "留空则使用默认路径：%USERPROFILE%\\.qq-chat-exporter\\exports" }
            ].map((item, index) => (
              <motion.div
                key={index}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: DUR.fast, delay: 0.5 + index * 0.05 }}
              >
                <span className="text-xl flex-shrink-0">{item.icon}</span>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.normal, ease: EASE.out, delay: 0.9 }}
      >
        <Card className="border-amber-500/20 bg-amber-500/5 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-5 h-5" />
              安全提示
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <motion.p 
              className="text-sm text-muted-foreground leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DUR.normal, delay: 1 }}
            >
              为了保护您的系统安全，自定义路径必须位于用户目录内，且不能指向系统关键目录（如 System32、Program Files 等）。
            </motion.p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
