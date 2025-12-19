"use client"

import { motion } from "framer-motion"
import { Monitor, Moon, Sun } from "lucide-react"

import { useThemeMode } from "@/hooks/use-theme-mode"
import { DUR, EASE } from "@/components/qce-dashboard/animations"

export function ThemeToggle() {
  const { mode, resolvedTheme, toggleTheme, resetToSystem } = useThemeMode()

  const Icon = mode === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun

  const title =
    mode === "system"
      ? `主题：跟随系统（当前：${resolvedTheme === "dark" ? "深色" : "浅色"}）\n点击：切换深/浅\nShift 点击：恢复跟随系统`
      : `主题：${mode === "dark" ? "深色" : "浅色"}\n点击：切换深/浅\nShift 点击：恢复跟随系统`

  return (
    <motion.button
      type="button"
      title={title}
      onClick={(e) => {
        if (e.shiftKey) {
          resetToSystem()
          return
        }
        toggleTheme()
      }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent hover:bg-accent transition-colors"
      whileTap={{ scale: 0.98, transition: { duration: DUR.fast, ease: EASE.inOut } }}
    >
      <Icon className="h-4 w-4 text-foreground" />
    </motion.button>
  )
}
