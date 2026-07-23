"use client"

import * as React from "react"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

type CopyButtonVariant = "icon" | "ghost" | "inline"
type CopyButtonSize = "xs" | "sm" | "md"

const sizeConfig: Record<CopyButtonSize, { icon: string; button: string }> = {
  xs: { icon: "h-3.5 w-3.5", button: "h-5 w-5" },
  sm: { icon: "h-3.5 w-3.5", button: "h-7 w-7" },
  md: { icon: "h-4 w-4", button: "h-8 w-8" },
}

const variantStyles: Record<CopyButtonVariant, string> = {
  icon: "rounded-md bg-black/[0.03] dark:bg-white/[0.05]",
  ghost: "rounded-full",
  inline: "rounded",
}

interface CopyButtonProps {
  /** 要复制的文本 */
  text: string
  variant?: CopyButtonVariant
  size?: CopyButtonSize
  /** 复制成功回调 */
  onCopySuccess?: () => void
  /** 复制失败回调 */
  onCopyError?: (error: unknown) => void
  className?: string
  /** 无障碍标签 / 悬浮提示 */
  title?: string
  disabled?: boolean
}

/**
 * 统一的复制按钮：点击复制文本，成功后短暂显示对勾。
 * 无 i18n、无 toast、无音效，遵循 qce-v4-tool 现有视觉约定。
 */
export function CopyButton({
  text,
  variant = "icon",
  size = "sm",
  onCopySuccess,
  onCopyError,
  className,
  title = "复制",
  disabled = false,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopySuccess?.()
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      onCopyError?.(error)
    }
  }

  const s = sizeConfig[size]

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      title={title}
      aria-label={copied ? "已复制" : title}
      className={cn(
        "flex shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]",
        variantStyles[variant],
        s.button,
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {copied ? (
        <Check className={cn(s.icon, "text-green-600 dark:text-green-500")} />
      ) : (
        <Copy className={s.icon} />
      )}
    </button>
  )
}

export default CopyButton
