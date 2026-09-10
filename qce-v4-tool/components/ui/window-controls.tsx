"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Minus, Square, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

/**
 * Subset of the Tauri globals exposed on `window.__TAURI__` when the host
 * window is configured with `withGlobalTauri`. Only the desktop shell
 * (installer) grants these permissions; browsers never see the global.
 */
interface TauriWindow {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  close(): Promise<void>
}

type ShellAction = "browser" | "logs" | "quit"

declare global {
  interface Window {
    __TAURI__?: {
      window: { getCurrentWindow(): TauriWindow }
      event: { emit(event: string, payload?: unknown): Promise<void> }
      opener: { openUrl(url: string): Promise<void> }
    }
  }
}

function tauri() {
  return typeof window === "undefined" ? undefined : window.__TAURI__
}

export function isDesktopShell(): boolean {
  return tauri() !== undefined
}

/** Ask the shell (Rust side listens on `qce-shell-action`) to act on our behalf. */
export function shellAction(action: ShellAction) {
  void tauri()?.event.emit("qce-shell-action", action)
}

/**
 * The WebView has no tabs: route `target=_blank` / cross-origin links and
 * `window.open` to the system browser instead of silently dropping them.
 */
export function useExternalLinksInBrowser() {
  useEffect(() => {
    const t = tauri()
    if (!t) return
    const openUrl = (url: string) => void t.opener.openUrl(url)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = (e.target as Element | null)?.closest("a[href]")
      if (!(a instanceof HTMLAnchorElement)) return
      const url = new URL(a.href, location.href)
      if (!/^https?:$/.test(url.protocol)) return
      if (a.target !== "_blank" && url.origin === location.origin) return
      e.preventDefault()
      openUrl(url.href)
    }
    document.addEventListener("click", onClick, true)
    const originalOpen = window.open
    window.open = (url?: string | URL) => {
      if (url) openUrl(new URL(url, location.href).href)
      return null
    }
    return () => {
      document.removeEventListener("click", onClick, true)
      window.open = originalOpen
    }
  }, [])
}

const buttonClass =
  "flex h-full w-11 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"

/** Native-style window controls; renders nothing outside the desktop shell. */
export function WindowControls() {
  const [appWindow, setAppWindow] = useState<TauriWindow | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = tauri()?.window.getCurrentWindow()
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

/**
 * Wraps the sidebar account row with a shell menu (browser / logs / quit) in
 * the desktop shell; renders the row untouched everywhere else.
 */
export function AccountMenu({ children }: { children: React.ReactNode }) {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => setDesktop(isDesktopShell()), [])
  if (!desktop) return <>{children}</>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 min-w-0 -mx-1.5 px-1.5 py-1 rounded-md text-left outline-none transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06] data-[state=open]:bg-black/[0.04] dark:data-[state=open]:bg-white/[0.06]"
        >
          {children}
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-44">
        <DropdownMenuItem onClick={() => shellAction("browser")}>在浏览器中打开</DropdownMenuItem>
        <DropdownMenuItem onClick={() => shellAction("logs")}>查看运行日志</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => shellAction("quit")}>退出</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
