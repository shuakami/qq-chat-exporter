"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type ThemeMode = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "qce-theme-mode"

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light"
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)")
  return mql?.matches ? "dark" : "light"
}

function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  // 让浏览器原生控件（滚动条/表单控件）更符合主题
  root.style.colorScheme = theme
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>("system")
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light")

  const modeRef = useRef<ThemeMode>("system")
  modeRef.current = mode

  // 初始化：读取用户设置（没有就 system）
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark" || saved === "system") {
      setMode(saved)
    } else {
      setMode("system")
    }
  }, [])

  // mode 变化 -> 计算 resolvedTheme -> 应用到 <html>
  useEffect(() => {
    if (typeof window === "undefined") return
    const resolved: ResolvedTheme = mode === "system" ? getSystemTheme() : mode
    setResolvedTheme(resolved)
    applyResolvedTheme(resolved)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  // system 模式下监听系统主题变化
  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)")
    if (!mql) return

    const handler = () => {
      if (modeRef.current !== "system") return
      const next: ResolvedTheme = mql.matches ? "dark" : "light"
      setResolvedTheme(next)
      applyResolvedTheme(next)
    }

    // 初始同步一次
    handler()

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler)
      return () => mql.removeEventListener("change", handler)
    }

    // Safari 老版本 fallback
    // @ts-expect-error - legacy API
    mql.addListener(handler)
    return () => {
      // @ts-expect-error - legacy API
      mql.removeListener(handler)
    }
  }, [])

  const setThemeMode = useCallback((next: ThemeMode) => {
    setMode(next)
  }, [])

  // 切换可见主题（深<->浅），会变成显式模式（light/dark）
  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const currentResolved: ResolvedTheme = prev === "system" ? getSystemTheme() : prev
      return currentResolved === "dark" ? "light" : "dark"
    })
  }, [])

  const resetToSystem = useCallback(() => {
    setMode("system")
  }, [])

  const isDark = resolvedTheme === "dark"

  return useMemo(
    () => ({
      mode,
      resolvedTheme,
      isDark,
      setThemeMode,
      toggleTheme,
      resetToSystem,
    }),
    [mode, resolvedTheme, isDark, setThemeMode, toggleTheme, resetToSystem],
  )
}
