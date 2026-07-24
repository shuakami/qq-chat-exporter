"use client"

import { useCallback, useSyncExternalStore } from "react"

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

interface ThemeState {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
}

// 单一全局主题状态：所有组件共享同一份，避免各自持有独立 state 时相互覆盖
// localStorage / <html> class 造成的竞态（例如 about 页挂载时把主题重置回浅色，
// 导致氛围底色球在暗色模式下不适配）。
const SERVER_STATE: ThemeState = { mode: "system", resolvedTheme: "light" }
let state: ThemeState | null = null
const listeners = new Set<() => void>()

function readInitial(): ThemeState {
  if (typeof window === "undefined") return SERVER_STATE
  const saved = window.localStorage.getItem(STORAGE_KEY)
  const mode: ThemeMode =
    saved === "light" || saved === "dark" || saved === "system" ? saved : "system"
  const resolvedTheme = mode === "system" ? getSystemTheme() : mode
  return { mode, resolvedTheme }
}

function ensureInit() {
  if (state || typeof window === "undefined") return
  state = readInitial()
  applyResolvedTheme(state.resolvedTheme)

  // system 模式下跟随系统主题变化
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)")
  const handler = () => {
    if (!state || state.mode !== "system") return
    commit({ mode: "system", resolvedTheme: mql?.matches ? "dark" : "light" })
  }
  if (mql?.addEventListener) {
    mql.addEventListener("change", handler)
  } else {
    mql?.addListener?.(handler)
  }
}

function commit(next: ThemeState) {
  state = next
  applyResolvedTheme(next.resolvedTheme)
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next.mode)
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  ensureInit()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): ThemeState {
  ensureInit()
  return state ?? SERVER_STATE
}

function getServerSnapshot(): ThemeState {
  return SERVER_STATE
}

export function useThemeMode() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setThemeMode = useCallback((next: ThemeMode) => {
    ensureInit()
    commit({ mode: next, resolvedTheme: next === "system" ? getSystemTheme() : next })
  }, [])

  // 切换可见主题（深<->浅），会变成显式模式（light/dark）
  const toggleTheme = useCallback(() => {
    ensureInit()
    const current = (state ?? SERVER_STATE).resolvedTheme
    const resolved: ResolvedTheme = current === "dark" ? "light" : "dark"
    commit({ mode: resolved, resolvedTheme: resolved })
  }, [])

  const resetToSystem = useCallback(() => {
    setThemeMode("system")
  }, [setThemeMode])

  return {
    mode: s.mode,
    resolvedTheme: s.resolvedTheme,
    isDark: s.resolvedTheme === "dark",
    setThemeMode,
    toggleTheme,
    resetToSystem,
  }
}
