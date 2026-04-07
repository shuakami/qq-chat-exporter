"use client"

/**
 * @author shuakami
 * @repository github.com/shuakami/toast
 */
import * as React from "react"
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
  type Transition,
} from "framer-motion"
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react"

export type ToastType = "info" | "success" | "warning" | "error" | "loading"
export type ToastPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center"

export interface ToastAction {
  label: string
  onClick: () => void
  variant?: "default" | "destructive"
  keepOpen?: boolean
}

export interface ToastOptions {
  id?: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastAction
  actions?: ToastAction[]
  duration?: number
  type?: ToastType
  variant?: "default" | "destructive"
}

export interface ToastData {
  id: string
  type: ToastType
  title: React.ReactNode
  description?: React.ReactNode
  action?: ToastAction
  actions?: ToastAction[]
  duration?: number
  zIndex: number
}

export interface ToastTheme {
  name: string
  background: string
  border: string
  textPrimary: string
  textSecondary: string
  buttonBg: string
  buttonText: string
  buttonHover: string
  closeButton: string
  closeButtonHover: string
  dismissButtonHover: string
  shadow: string
  spinner: string
  iconBg: string
  borderRadius?: string
}

export interface ToastAnimationContext {
  index: number
  isHovered: boolean
  offset: number
  sign: number
  scale: number
  opacity: number
  position: ToastPosition
}

export interface ToastAnimation {
  name: string
  initial: (ctx: ToastAnimationContext) => TargetAndTransition
  animate: (ctx: ToastAnimationContext) => TargetAndTransition
  exit: (ctx: ToastAnimationContext) => TargetAndTransition
  transition: Transition
}

export const themes: Record<string, { name: string; light: ToastTheme; dark: ToastTheme }> = {
  default: {
    name: "Default (Glass)",
    light: {
      name: "Default (Glass)",
      background: "bg-white/70 backdrop-blur-2xl saturate-[1.5]",
      border: "border-white/50",
      textPrimary: "text-black/90",
      textSecondary: "text-black/65",
      buttonBg: "bg-black/90",
      buttonText: "text-white",
      buttonHover: "hover:bg-black",
      closeButton: "text-black/35",
      closeButtonHover: "hover:text-black/75 hover:bg-black/5",
      dismissButtonHover: "hover:text-black hover:bg-black/5",
      shadow: "shadow-[0_10px_40px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.75)]",
      spinner: "text-black/55",
      iconBg: "bg-black/[0.04]",
      borderRadius: "rounded-2xl",
    },
    dark: {
      name: "Default (Glass)",
      background: "bg-[#0f1115]/85 backdrop-blur-2xl",
      border: "border-white/8",
      textPrimary: "text-zinc-100",
      textSecondary: "text-zinc-400",
      buttonBg: "bg-white",
      buttonText: "text-black",
      buttonHover: "hover:bg-zinc-200",
      closeButton: "text-zinc-500",
      closeButtonHover: "hover:text-zinc-200 hover:bg-white/10",
      dismissButtonHover: "hover:text-zinc-200 hover:bg-white/10",
      shadow: "shadow-[0_12px_36px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.05)]",
      spinner: "text-zinc-400",
      iconBg: "bg-white/[0.05]",
      borderRadius: "rounded-2xl",
    },
  },
  minimal: {
    name: "Minimal",
    light: {
      name: "Minimal",
      background: "bg-white",
      border: "border-zinc-200",
      textPrimary: "text-zinc-900",
      textSecondary: "text-zinc-500",
      buttonBg: "bg-zinc-900",
      buttonText: "text-white",
      buttonHover: "hover:bg-zinc-800",
      closeButton: "text-zinc-400",
      closeButtonHover: "hover:text-zinc-900 hover:bg-zinc-100",
      dismissButtonHover: "hover:text-zinc-900 hover:bg-zinc-100",
      shadow: "shadow-[0_14px_34px_rgba(15,23,42,0.12)]",
      spinner: "text-zinc-500",
      iconBg: "bg-zinc-100",
      borderRadius: "rounded-xl",
    },
    dark: {
      name: "Minimal",
      background: "bg-zinc-900",
      border: "border-zinc-700",
      textPrimary: "text-zinc-100",
      textSecondary: "text-zinc-400",
      buttonBg: "bg-white",
      buttonText: "text-zinc-900",
      buttonHover: "hover:bg-zinc-200",
      closeButton: "text-zinc-500",
      closeButtonHover: "hover:text-zinc-200 hover:bg-zinc-800",
      dismissButtonHover: "hover:text-zinc-200 hover:bg-zinc-800",
      shadow: "shadow-[0_14px_34px_rgba(0,0,0,0.4)]",
      spinner: "text-zinc-400",
      iconBg: "bg-zinc-800",
      borderRadius: "rounded-xl",
    },
  },
  macos: {
    name: "macOS Glass",
    light: {
      name: "macOS Glass",
      background: "bg-white/65 backdrop-blur-2xl saturate-[1.5]",
      border: "border-white/45",
      textPrimary: "text-black/90",
      textSecondary: "text-black/60",
      buttonBg: "bg-white/60 backdrop-blur-md border border-white/50 shadow-sm",
      buttonText: "text-black/85",
      buttonHover: "hover:bg-white/90",
      closeButton: "text-black/30",
      closeButtonHover: "hover:text-black/75 hover:bg-black/5",
      dismissButtonHover: "hover:text-black/75 hover:bg-black/5",
      shadow: "shadow-[0_8px_32px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.7)]",
      spinner: "text-black/50",
      iconBg: "bg-white/55",
      borderRadius: "rounded-[20px]",
    },
    dark: {
      name: "macOS Glass",
      background: "bg-black/45 backdrop-blur-2xl saturate-[1.4]",
      border: "border-white/10",
      textPrimary: "text-white/92",
      textSecondary: "text-white/65",
      buttonBg: "bg-white/10 backdrop-blur-md border border-white/10 shadow-sm",
      buttonText: "text-white/85",
      buttonHover: "hover:bg-white/15",
      closeButton: "text-white/35",
      closeButtonHover: "hover:text-white/80 hover:bg-white/10",
      dismissButtonHover: "hover:text-white/80 hover:bg-white/10",
      shadow: "shadow-[0_8px_32px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]",
      spinner: "text-white/50",
      iconBg: "bg-white/8",
      borderRadius: "rounded-[20px]",
    },
  },
}

export const defaultAnimation: ToastAnimation = {
  name: "Default (Spring)",
  initial: ({ sign }) => ({ opacity: 0, y: -30 * sign, scale: 0.95, filter: "blur(16px)" }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale, filter: "blur(0px)" }),
  exit: () => ({ opacity: 0, scale: 0.95, filter: "blur(16px)", transition: { duration: 0.22, ease: "easeOut" } }),
  transition: { type: "spring", stiffness: 360, damping: 34, mass: 1 },
}

export const slideAnimation: ToastAnimation = {
  name: "Slide",
  initial: ({ sign }) => ({ opacity: 0, y: -56 * sign }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign }) => ({ opacity: 0, y: -56 * sign, transition: { duration: 0.18 } }),
  transition: { type: "spring", stiffness: 420, damping: 38 },
}

export const fadeAnimation: ToastAnimation = {
  name: "Fade",
  initial: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.96 }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.96, transition: { duration: 0.18 } }),
  transition: { duration: 0.18, ease: "easeOut" },
}

export const animations = [defaultAnimation, slideAnimation, fadeAnimation]

type ToastListener = () => void

let toastItems: ToastData[] = []
let toastListeners = new Set<ToastListener>()
let toastCounter = 0

function emitToasts() {
  toastListeners.forEach((listener) => listener())
}

function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

function resolveToastType(type?: ToastType, variant?: ToastOptions["variant"]): ToastType {
  if (type) return type
  if (variant === "destructive") return "error"
  return "info"
}

function resolveActions(options?: ToastOptions) {
  if (!options) return undefined
  if (options.actions?.length) return options.actions
  if (options.action) return [options.action]
  return undefined
}

function normalizeToastInput(
  input: React.ReactNode | ToastOptions,
  options?: ToastOptions,
): ToastData {
  const isPlainObject =
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !React.isValidElement(input)

  const merged = (isPlainObject ? input : { ...options, title: input }) as ToastOptions
  const title = merged.title ?? ""

  return {
    id: merged.id || generateId(),
    title,
    description: merged.description,
    action: merged.action,
    actions: resolveActions(merged),
    duration: merged.duration,
    type: resolveToastType(merged.type, merged.variant),
    zIndex: toastCounter++,
  }
}

export const toastStore = {
  getSnapshot() {
    return toastItems
  },
  subscribe(listener: ToastListener) {
    toastListeners.add(listener)
    return () => {
      toastListeners.delete(listener)
    }
  },
  addToast(toast: ToastData) {
    toastItems = [toast, ...toastItems.filter((item) => item.id !== toast.id)].slice(0, 10)
    emitToasts()
  },
  removeToast(id?: string) {
    toastItems = id ? toastItems.filter((item) => item.id !== id) : []
    emitToasts()
  },
  updateToast(id: string, data: Partial<ToastData>) {
    toastItems = toastItems.map((item) => (item.id === id ? { ...item, ...data } : item))
    emitToasts()
  },
}

function createToast(input: React.ReactNode | ToastOptions, options?: ToastOptions) {
  const nextToast = normalizeToastInput(input, options)
  toastStore.addToast(nextToast)
  return nextToast.id
}

type PromiseMessages<T> = {
  loading: React.ReactNode
  success: React.ReactNode | ((data: T) => React.ReactNode)
  error: React.ReactNode | ((err: unknown) => React.ReactNode)
}

export interface ToastFn {
  (input: React.ReactNode | ToastOptions, options?: ToastOptions): string
  info: (title: React.ReactNode, options?: ToastOptions) => string
  success: (title: React.ReactNode, options?: ToastOptions) => string
  warning: (title: React.ReactNode, options?: ToastOptions) => string
  error: (title: React.ReactNode, options?: ToastOptions) => string
  loading: (title: React.ReactNode, options?: ToastOptions) => string
  dismiss: (id?: string) => void
  update: (id: string, options: Partial<ToastData> & ToastOptions) => void
  promise: <T>(
    promise: Promise<T> | (() => Promise<T>),
    messages: PromiseMessages<T>,
    options?: ToastOptions,
  ) => Promise<T>
}

const toastFn = ((input: React.ReactNode | ToastOptions, options?: ToastOptions) =>
  createToast(input, options)) as ToastFn

toastFn.info = (title, options) => createToast(title, { ...options, type: "info" })
toastFn.success = (title, options) => createToast(title, { ...options, type: "success" })
toastFn.warning = (title, options) => createToast(title, { ...options, type: "warning" })
toastFn.error = (title, options) => createToast(title, { ...options, type: "error" })
toastFn.loading = (title, options) => createToast(title, { ...options, type: "loading", duration: options?.duration ?? Number.POSITIVE_INFINITY })
toastFn.dismiss = (id) => {
  toastStore.removeToast(id)
}
toastFn.update = (id, options) => {
  toastStore.updateToast(id, {
    ...options,
    actions: resolveActions(options),
    type: resolveToastType(options.type, options.variant),
  })
}
toastFn.promise = async <T,>(
  promise: Promise<T> | (() => Promise<T>),
  messages: PromiseMessages<T>,
  options?: ToastOptions,
) => {
  const id = toastFn.loading(messages.loading, options)
  const startedAt = Date.now()
  const minLoadingTime = 600

  try {
    const run = typeof promise === "function" ? promise() : promise
    const data = await run
    const delay = Math.max(0, minLoadingTime - (Date.now() - startedAt))

    window.setTimeout(() => {
      toastFn.update(id, {
        type: "success",
        title: typeof messages.success === "function" ? messages.success(data) : messages.success,
        duration: options?.duration ?? 5000,
      })
    }, delay)

    return data
  } catch (error) {
    const delay = Math.max(0, minLoadingTime - (Date.now() - startedAt))

    window.setTimeout(() => {
      toastFn.update(id, {
        type: "error",
        title: typeof messages.error === "function" ? messages.error(error) : messages.error,
        duration: options?.duration ?? 7000,
      })
    }, delay)

    throw error
  }
}

export const toast = toastFn

const positionClasses: Record<ToastPosition, string> = {
  "top-right": "top-4 right-4 sm:top-6 sm:right-6",
  "top-left": "top-4 left-4 sm:top-6 sm:left-6",
  "top-center": "top-4 left-1/2 -translate-x-1/2 sm:top-6",
  "bottom-right": "bottom-4 right-4 sm:bottom-6 sm:right-6",
  "bottom-left": "bottom-4 left-4 sm:bottom-6 sm:left-6",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 sm:bottom-6",
}

const toastHeightCallbacks = new WeakMap<Element, (height: number) => void>()
let resizeObserver: ResizeObserver | null = null

function observeHeight(element: Element, callback: (height: number) => void) {
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        for (const entry of entries) {
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
          const handler = toastHeightCallbacks.get(entry.target)
          if (handler) handler(Math.round(height))
        }
      })
    })
  }

  toastHeightCallbacks.set(element, callback)
  resizeObserver.observe(element)

  return () => {
    toastHeightCallbacks.delete(element)
    resizeObserver?.unobserve(element)
  }
}

function useResolvedDarkMode() {
  const [isDarkMode, setIsDarkMode] = React.useState(false)

  React.useEffect(() => {
    if (typeof document === "undefined") return

    const update = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"))
    }

    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  return isDarkMode
}

function LoadingSpinner({ theme }: { theme: ToastTheme }) {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1, ease: "linear" }}
      className={theme.spinner}
    >
      <Loader2 className="h-4 w-4" />
    </motion.span>
  )
}

function TypeIcon({ type, theme }: { type: ToastType; theme: ToastTheme }) {
  const iconClassName = "h-4 w-4"

  if (type === "success") {
    return <CheckCircle2 className={`${iconClassName} text-emerald-500`} />
  }
  if (type === "warning") {
    return <TriangleAlert className={`${iconClassName} text-amber-500`} />
  }
  if (type === "error") {
    return <AlertCircle className={`${iconClassName} text-rose-500`} />
  }
  return <Info className={`${iconClassName} text-sky-500`} />
}

function renderDescription(description: React.ReactNode, className: string) {
  if (typeof description === "string") {
    return <div className={`${className} whitespace-pre-line`}>{description}</div>
  }

  return <div className={className}>{description}</div>
}

interface ToastCardProps {
  toast: ToastData
  index: number
  onRemove: (id: string) => void
  isHovered: boolean
  position: ToastPosition
  hoverOffset: number
  onHeightChange: (id: string, height: number) => void
  theme: ToastTheme
  animation: ToastAnimation
}

function ToastCard({
  toast,
  index,
  onRemove,
  isHovered,
  position,
  hoverOffset,
  onHeightChange,
  theme,
  animation,
}: ToastCardProps) {
  const isBottom = position.startsWith("bottom")
  const sign = isBottom ? -1 : 1
  const ref = React.useRef<HTMLDivElement>(null)

  const stackedOffset = index * 12
  const offset = isHovered ? hoverOffset : stackedOffset
  const scale = isHovered ? 1 : Math.max(0.88, 1 - index * 0.04)
  const opacity = isHovered ? 1 : Math.max(0.45, 1 - index * 0.15)
  const resolvedActions = toast.actions?.length ? toast.actions : toast.action ? [toast.action] : []
  const duration = toast.duration ?? 4000

  React.useEffect(() => {
    if (!ref.current) return
    return observeHeight(ref.current, (height) => onHeightChange(toast.id, height))
  }, [onHeightChange, toast.id])

  React.useEffect(() => {
    if (isHovered || toast.type === "loading" || duration === Number.POSITIVE_INFINITY) return

    const timer = window.setTimeout(() => {
      onRemove(toast.id)
    }, duration)

    return () => window.clearTimeout(timer)
  }, [duration, isHovered, onRemove, toast.id, toast.type])

  const ctx: ToastAnimationContext = {
    index,
    isHovered,
    offset,
    sign,
    scale,
    opacity,
    position,
  }

  return (
    <motion.div
      ref={ref}
      initial={animation.initial(ctx)}
      animate={animation.animate(ctx)}
      exit={animation.exit(ctx)}
      transition={animation.transition}
      style={{
        zIndex: toast.zIndex,
        willChange: "transform, opacity, filter",
      }}
      className={`absolute ${isBottom ? "bottom-0" : "top-0"} w-full ${theme.borderRadius || "rounded-2xl"} ${theme.background} border ${theme.border} ${theme.shadow} p-4 pointer-events-auto`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${theme.iconBg}`}>
          {toast.type === "loading" ? <LoadingSpinner theme={theme} /> : <TypeIcon type={toast.type} theme={theme} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className={`text-[14px] font-semibold leading-snug tracking-tight ${theme.textPrimary}`}>
                {toast.title}
              </div>
              {toast.description ? renderDescription(toast.description, `mt-1 text-[13px] leading-snug ${theme.textSecondary}`) : null}
            </div>

            <button
              type="button"
              onClick={() => onRemove(toast.id)}
              className={`mt-[-2px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${theme.closeButton} ${theme.closeButtonHover}`}
              aria-label="关闭通知"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {resolvedActions.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {toast.type !== "loading" ? (
                <button
                  type="button"
                  onClick={() => onRemove(toast.id)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${theme.textSecondary} ${theme.dismissButtonHover}`}
                >
                  关闭
                </button>
              ) : null}

              {resolvedActions.map((action, actionIndex) => {
                const buttonClassName =
                  action.variant === "destructive"
                    ? "bg-rose-500 text-white hover:bg-rose-600"
                    : `${theme.buttonBg} ${theme.buttonText} ${theme.buttonHover}`

                return (
                  <button
                    key={`${toast.id}-action-${actionIndex}`}
                    type="button"
                    onClick={() => {
                      action.onClick()
                      if (!action.keepOpen) onRemove(toast.id)
                    }}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-medium shadow-sm transition-all ${buttonClassName}`}
                  >
                    {action.label}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}

export interface ToasterProps {
  position?: ToastPosition
  theme?: string | ToastTheme
  isDarkMode?: boolean
  animation?: ToastAnimation
}

export function Toaster({
  position = "bottom-right",
  theme = "macos",
  isDarkMode,
  animation = defaultAnimation,
}: ToasterProps) {
  const toasts = React.useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot)
  const [isHovered, setIsHovered] = React.useState(false)
  const [heights, setHeights] = React.useState<Record<string, number>>({})
  const hoverTimeoutRef = React.useRef<number | null>(null)
  const resolvedDarkMode = useResolvedDarkMode()
  const darkMode = isDarkMode ?? resolvedDarkMode

  const resolvedTheme =
    typeof theme === "string"
      ? themes[theme]?.[darkMode ? "dark" : "light"] || themes.default[darkMode ? "dark" : "light"]
      : theme

  const offsets = React.useMemo(() => {
    const values: number[] = []
    let currentOffset = 0
    const gap = 12

    for (const item of toasts) {
      values.push(currentOffset)
      currentOffset += (heights[item.id] || 88) + gap
    }

    return {
      offsets: values,
      totalHeight: toasts.length > 0 ? currentOffset - gap : 0,
    }
  }, [heights, toasts])

  const removeToast = React.useCallback((id: string) => {
    toast.dismiss(id)
    setHeights((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const handleHeightChange = React.useCallback((id: string, height: number) => {
    setHeights((prev) => {
      if (prev[id] === height) return prev
      return { ...prev, [id]: height }
    })
  }, [])

  return (
    <div
      className={`fixed ${positionClasses[position]} z-[300] w-[calc(100vw-32px)] max-w-[380px] pointer-events-none sm:w-[380px]`}
      style={{ height: toasts.length > 0 ? (isHovered ? offsets.totalHeight : 92) : 0 }}
      onMouseEnter={() => {
        if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current)
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        hoverTimeoutRef.current = window.setTimeout(() => {
          setIsHovered(false)
        }, 120)
      }}
    >
      <div className="relative h-full w-full">
        <AnimatePresence mode="popLayout">
          {toasts.map((toastItem, index) => (
            <ToastCard
              key={toastItem.id}
              toast={toastItem}
              index={index}
              onRemove={removeToast}
              isHovered={isHovered}
              position={position}
              hoverOffset={offsets.offsets[index] || 0}
              onHeightChange={handleHeightChange}
              theme={resolvedTheme}
              animation={animation}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function useToast() {
  const toasts = React.useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot)

  return {
    toasts,
    toast,
    dismiss: toast.dismiss,
  }
}
