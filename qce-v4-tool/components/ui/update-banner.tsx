"use client"

import { useEffect, useState, type ReactNode } from "react"
import { X, ArrowUpRight } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

export interface UpdateBannerInfo {
  tag: string
  url: string
  name?: string
  body?: string
  image?: string
  /** 是否为重大更新：只有重大更新才自动弹出 popover */
  major?: boolean
}

interface UpdatePopoverProps {
  update: UpdateBannerInfo | null
  /** 作为锚点的元素（侧边栏底部/问号所在的一行），卡片会在其正上方弹出 */
  children: ReactNode
}

const DISMISS_STORAGE_KEY = "qce-update-banner-dismissed"

function readDismissedTag(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * 更新提示卡片（锚定在侧边栏底部“问号”一行的正上方）。
 *
 * 检测到新版本时无需用户点击帮助，直接弹出一张清晰可见的卡片：顶部展示
 * 该 Release 的更新图片，底部是一行可点击的「查看更新内容」入口。
 * 每个版本仅自动弹出一次，用户关闭后记录该版本 tag，出新版本才会再次弹出。
 */
export function UpdatePopover({ update, children }: UpdatePopoverProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // 仅在「重大更新」且存在更新图片、且该版本未被关闭过时自动弹出
    if (update?.major && update.image && readDismissedTag() !== update.tag) {
      setOpen(true)
    } else {
      setOpen(false)
    }
  }, [update])

  const dismiss = (next: boolean) => {
    if (!next && update) {
      try {
        window.localStorage.setItem(DISMISS_STORAGE_KEY, update.tag)
      } catch {
        // 忽略存储失败（隐私模式等）
      }
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={dismiss}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {update?.major && update.image && (
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-72 overflow-hidden rounded-lg border-transparent p-2 shadow-[0_0_0_1px_rgba(17,24,39,0.03),0_2px_6px_-2px_rgba(17,24,39,0.04),0_18px_40px_-16px_rgba(17,24,39,0.10)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_18px_40px_-16px_rgba(0,0,0,0.45)]"
        >
          <div className="relative overflow-hidden rounded-sm border border-black/[0.06] dark:border-white/[0.08]">
            <button
              onClick={() => dismiss(false)}
              aria-label="关闭更新提示"
              className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-black/30 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <a
              href={update.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`前往更新 ${update.tag}`}
              onClick={() => dismiss(false)}
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={update.image}
                alt={`${update.tag} 更新图片`}
                className="block w-full object-cover"
                onError={() => dismiss(false)}
              />
            </a>
          </div>

          <a
            href={update.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => dismiss(false)}
            className="mt-1.5 flex items-center justify-between gap-2 rounded-sm px-2 py-2 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center rounded-sm bg-primary/10 px-1.5 py-1 text-[10px] font-medium leading-none text-primary">
                重大更新
              </span>
              <span className="truncate text-[13px] font-medium text-foreground">
                前往更新 <span className="text-muted-foreground">{update.tag}</span>
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>
        </PopoverContent>
      )}
    </Popover>
  )
}
