"use client"

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { ChevronDown, Maximize2, Minus, Square, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

type ShellAction = "browser" | "logs" | "quit"

/** True inside the Tauri desktop shell (installer); browsers never inject `__TAURI_INTERNALS__`. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Defer the runtime check to the client so static export and hydration agree. */
function useDesktopShell(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => setDesktop(isDesktopShell()), [])
  return desktop
}

/** Ask the shell (Rust side listens on `qce-shell-action`) to act on our behalf. */
export function shellAction(action: ShellAction) {
  void emit("qce-shell-action", action)
}

function openInBrowser(url: string) {
  invoke("plugin:opener|open_url", { url, with: null }).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer")
  })
}

/**
 * The WebView has no tabs: route `target=_blank` / cross-origin links and
 * `window.open` to the system browser instead of silently dropping them.
 */
export function useExternalLinksInBrowser() {
  useEffect(() => {
    if (!isDesktopShell()) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = (e.target as Element | null)?.closest("a[href]")
      if (!(a instanceof HTMLAnchorElement)) return
      const url = new URL(a.href, location.href)
      if (!/^https?:$/.test(url.protocol)) return
      if (a.target !== "_blank" && url.origin === location.origin) return
      e.preventDefault()
      openInBrowser(url.href)
    }
    document.addEventListener("click", onClick, true)
    const originalOpen = window.open
    window.open = (url?: string | URL) => {
      if (url) openInBrowser(new URL(url, location.href).href)
      return null
    }
    return () => {
      document.removeEventListener("click", onClick, true)
      window.open = originalOpen
    }
  }, [])
}

/**
 * Empty flex spacer that moves the window when dragged and toggles maximize on
 * double click. Renders a plain spacer outside the desktop shell so layouts
 * stay identical in the browser.
 */
export function WindowDragRegion({ className = "" }: { className?: string }) {
  const desktop = useDesktopShell()
  return (
    <div
      data-tauri-drag-region
      className={`h-full min-w-0 flex-1 ${className}`}
      onMouseDown={
        desktop
          ? (e) => {
              if (e.button === 0 && e.target === e.currentTarget) void getCurrentWindow().startDragging()
            }
          : undefined
      }
      onDoubleClick={
        desktop
          ? (e) => {
              if (e.target === e.currentTarget) void getCurrentWindow().toggleMaximize()
            }
          : undefined
      }
    />
  )
}

const buttonClass =
  "flex h-full w-11 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"

/** Native-style window controls; renders nothing outside the desktop shell. */
export function WindowControls() {
  const desktop = useDesktopShell()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktop) return
    const win = getCurrentWindow()
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    let unlisten: (() => void) | undefined
    void win.onResized(sync).then((dispose) => {
      unlisten = dispose
    })
    return () => unlisten?.()
  }, [desktop])

  if (!desktop) return null
  const win = getCurrentWindow()

  return (
    <div className="flex h-12 -mr-4 ml-1 flex-shrink-0 select-none">
      <button type="button" aria-label="最小化" onClick={() => void win.minimize()} className={buttonClass}>
        <Minus className="w-3.5 h-3.5" strokeWidth={1.6} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void win.toggleMaximize().then(() => win.isMaximized()).then(setMaximized)}
        className={buttonClass}
      >
        {maximized ? <Square className="w-2.5 h-2.5" strokeWidth={1.4} /> : <Maximize2 className="w-3 h-3" strokeWidth={1.4} />}
      </button>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => void win.close()}
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
  const desktop = useDesktopShell()
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
