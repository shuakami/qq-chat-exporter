"use client"

import { useEffect, useState } from "react"
import { Minus, Square, X } from "lucide-react"

/**
 * Subset of `@tauri-apps/api/window` exposed on `window.__TAURI__` when the
 * host window is configured with `withGlobalTauri`. Only the desktop shell
 * (installer) grants these permissions; browsers never see the global.
 */
interface TauriWindow {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  close(): Promise<void>
}

declare global {
  interface Window {
    __TAURI__?: { window: { getCurrentWindow(): TauriWindow } }
  }
}

function currentTauriWindow(): TauriWindow | null {
  if (typeof window === "undefined") return null
  return window.__TAURI__?.window.getCurrentWindow() ?? null
}

const buttonClass =
  "flex h-full w-11 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"

/** Native-style window controls; renders nothing outside the Tauri shell. */
export function WindowControls() {
  const [appWindow, setAppWindow] = useState<TauriWindow | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = currentTauriWindow()
    if (!win) return
    setAppWindow(win)
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [])

  if (!appWindow) return null

  return (
    <div className="flex h-12 -mr-4 ml-1 flex-shrink-0 select-none">
      <button type="button" aria-label="最小化" onClick={() => void appWindow.minimize()} className={buttonClass}>
        <Minus className="w-3.5 h-3.5" strokeWidth={1.6} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void appWindow.toggleMaximize()}
        className={buttonClass}
      >
        <Square className={maximized ? "w-2.5 h-2.5" : "w-3 h-3"} strokeWidth={1.4} />
      </button>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => void appWindow.close()}
        className={`${buttonClass} hover:bg-red-500 hover:text-white dark:hover:bg-red-500`}
      >
        <X className="w-3.5 h-3.5" strokeWidth={1.6} />
      </button>
    </div>
  )
}
