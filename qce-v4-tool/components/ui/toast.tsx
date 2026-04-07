"use client"

/**
 * @author shuakami
 * @repository github.com/shuakami/toast
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { X } from "lucide-react"

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

export interface ToastData extends ToastOptions {
  id: string
  type: ToastType
  title: React.ReactNode
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
  initial: (ctx: ToastAnimationContext) => any
  animate: (ctx: ToastAnimationContext) => any
  exit: (ctx: ToastAnimationContext) => any
  transition: any
}

export const themes: Record<string, { name: string; light: ToastTheme; dark: ToastTheme }> = {
  default: {
    name: "Default (Glass)",
    light: {
      name: "Default (Glass)",
      background: "bg-white/60 backdrop-blur-2xl saturate-[1.5]",
      border: "border-white/40",
      textPrimary: "text-black/90",
      textSecondary: "text-black/60",
      buttonBg: "bg-black/90",
      buttonText: "text-white",
      buttonHover: "hover:bg-black",
      closeButton: "text-black/30",
      closeButtonHover: "hover:text-black/70 hover:bg-black/5",
      dismissButtonHover: "hover:text-black hover:bg-black/5",
      shadow: "shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]",
      spinner: "text-black/60",
    },
    dark: {
      name: "Default (Glass)",
      background: "bg-[#111111]/80 backdrop-blur-2xl",
      border: "border-white/5",
      textPrimary: "text-zinc-100",
      textSecondary: "text-zinc-400",
      buttonBg: "bg-white",
      buttonText: "text-black",
      buttonHover: "hover:bg-zinc-200",
      closeButton: "text-zinc-500",
      closeButtonHover: "hover:text-zinc-300 hover:bg-white/10",
      dismissButtonHover: "hover:text-zinc-300 hover:bg-white/10",
      shadow: "shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]",
      spinner: "text-zinc-400",
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
      shadow: "shadow-[0_8px_30px_rgb(0,0,0,0.12)]",
      spinner: "text-zinc-500",
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
      closeButtonHover: "hover:text-zinc-300 hover:bg-zinc-800",
      dismissButtonHover: "hover:text-zinc-300 hover:bg-zinc-800",
      shadow: "shadow-[0_8px_30px_rgb(0,0,0,0.5)]",
      spinner: "text-zinc-400",
    },
  },
  soft: {
    name: "Soft",
    light: {
      name: "Soft",
      background: "bg-slate-50",
      border: "border-slate-100",
      textPrimary: "text-slate-700",
      textSecondary: "text-slate-500",
      buttonBg: "bg-white shadow-sm border border-slate-200",
      buttonText: "text-slate-700",
      buttonHover: "hover:bg-slate-100",
      closeButton: "text-slate-400",
      closeButtonHover: "hover:text-slate-700 hover:bg-slate-200/50",
      dismissButtonHover: "hover:text-slate-700 hover:bg-slate-200/50",
      shadow: "shadow-sm",
      spinner: "text-slate-400",
    },
    dark: {
      name: "Soft",
      background: "bg-slate-800",
      border: "border-slate-700/50",
      textPrimary: "text-slate-200",
      textSecondary: "text-slate-400",
      buttonBg: "bg-slate-700 shadow-sm border border-slate-600",
      buttonText: "text-slate-200",
      buttonHover: "hover:bg-slate-600",
      closeButton: "text-slate-400",
      closeButtonHover: "hover:text-slate-200 hover:bg-slate-600/50",
      dismissButtonHover: "hover:text-slate-200 hover:bg-slate-600/50",
      shadow: "shadow-md",
      spinner: "text-slate-400",
    },
  },
  outlined: {
    name: "Outlined (Neo-brutalism)",
    light: {
      name: "Outlined (Neo-brutalism)",
      background: "bg-white",
      border: "border-2 border-black",
      textPrimary: "text-black",
      textSecondary: "text-zinc-700",
      buttonBg: "bg-black",
      buttonText: "text-white",
      buttonHover: "hover:bg-zinc-800",
      closeButton: "text-zinc-400",
      closeButtonHover: "hover:text-black hover:bg-zinc-100",
      dismissButtonHover: "hover:text-black hover:bg-zinc-100",
      shadow: "shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
      spinner: "text-black",
    },
    dark: {
      name: "Outlined (Neo-brutalism)",
      background: "bg-zinc-950",
      border: "border-2 border-white",
      textPrimary: "text-white",
      textSecondary: "text-zinc-300",
      buttonBg: "bg-white",
      buttonText: "text-black",
      buttonHover: "hover:bg-zinc-200",
      closeButton: "text-zinc-500",
      closeButtonHover: "hover:text-white hover:bg-zinc-800",
      dismissButtonHover: "hover:text-white hover:bg-zinc-800",
      shadow: "shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]",
      spinner: "text-white",
    },
  },
  warm: {
    name: "Warm (Sepia)",
    light: {
      name: "Warm (Sepia)",
      background: "bg-stone-50",
      border: "border-stone-200",
      textPrimary: "text-stone-800",
      textSecondary: "text-stone-500",
      buttonBg: "bg-stone-200",
      buttonText: "text-stone-800",
      buttonHover: "hover:bg-stone-300",
      closeButton: "text-stone-400",
      closeButtonHover: "hover:text-stone-800 hover:bg-stone-200/50",
      dismissButtonHover: "hover:text-stone-800 hover:bg-stone-200/50",
      shadow: "shadow-lg shadow-stone-900/5",
      spinner: "text-stone-500",
    },
    dark: {
      name: "Warm (Sepia)",
      background: "bg-stone-900",
      border: "border-stone-700",
      textPrimary: "text-stone-200",
      textSecondary: "text-stone-400",
      buttonBg: "bg-stone-800",
      buttonText: "text-stone-200",
      buttonHover: "hover:bg-stone-700",
      closeButton: "text-stone-500",
      closeButtonHover: "hover:text-stone-200 hover:bg-stone-800",
      dismissButtonHover: "hover:text-stone-200 hover:bg-stone-800",
      shadow: "shadow-lg shadow-black/40",
      spinner: "text-stone-400",
    },
  },
  ocean: {
    name: "Ocean Breeze",
    light: {
      name: "Ocean Breeze",
      background: "bg-sky-50",
      border: "border-sky-200",
      textPrimary: "text-sky-900",
      textSecondary: "text-sky-700",
      buttonBg: "bg-sky-200",
      buttonText: "text-sky-900",
      buttonHover: "hover:bg-sky-300",
      closeButton: "text-sky-400",
      closeButtonHover: "hover:text-sky-900 hover:bg-sky-200/50",
      dismissButtonHover: "hover:text-sky-900 hover:bg-sky-200/50",
      shadow: "shadow-lg shadow-sky-900/5",
      spinner: "text-sky-500",
    },
    dark: {
      name: "Ocean Breeze",
      background: "bg-slate-900",
      border: "border-sky-900/50",
      textPrimary: "text-sky-100",
      textSecondary: "text-sky-400",
      buttonBg: "bg-sky-900/50",
      buttonText: "text-sky-100",
      buttonHover: "hover:bg-sky-800/50",
      closeButton: "text-sky-600",
      closeButtonHover: "hover:text-sky-200 hover:bg-sky-900/50",
      dismissButtonHover: "hover:text-sky-200 hover:bg-sky-900/50",
      shadow: "shadow-lg shadow-black/40",
      spinner: "text-sky-500",
    },
  },
  macos: {
    name: "macOS Glass",
    light: {
      name: "macOS Glass",
      background: "bg-white/60 backdrop-blur-2xl saturate-[1.5]",
      border: "border-white/40",
      textPrimary: "text-black/90",
      textSecondary: "text-black/60",
      buttonBg: "bg-white/50 backdrop-blur-md border border-white/40 shadow-sm",
      buttonText: "text-black/80",
      buttonHover: "hover:bg-white/80",
      closeButton: "text-black/30",
      closeButtonHover: "hover:text-black/70 hover:bg-black/5",
      dismissButtonHover: "hover:text-black/70 hover:bg-black/5",
      shadow: "shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]",
      spinner: "text-black/50",
      borderRadius: "rounded-[20px]",
    },
    dark: {
      name: "macOS Glass",
      background: "bg-black/40 backdrop-blur-2xl saturate-[1.5]",
      border: "border-white/10",
      textPrimary: "text-white/90",
      textSecondary: "text-white/60",
      buttonBg: "bg-black/50 backdrop-blur-md border border-white/10 shadow-sm",
      buttonText: "text-white/80",
      buttonHover: "hover:bg-white/10",
      closeButton: "text-white/30",
      closeButtonHover: "hover:text-white/70 hover:bg-white/10",
      dismissButtonHover: "hover:text-white/70 hover:bg-white/10",
      shadow: "shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]",
      spinner: "text-white/50",
      borderRadius: "rounded-[20px]",
    },
  },
}

export const defaultAnimation: ToastAnimation = {
  name: "Default (Spring)",
  initial: ({ sign }) => ({ opacity: 0, y: -30 * sign, scale: 0.95, filter: "blur(16px)" }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale, filter: "blur(0px)" }),
  exit: () => ({ opacity: 0, scale: 0.95, filter: "blur(16px)", transition: { duration: 0.25, ease: "easeOut" } }),
  transition: { type: "spring", stiffness: 350, damping: 35, mass: 1 },
}

export const slideAnimation: ToastAnimation = {
  name: "Slide",
  initial: ({ sign }) => ({ opacity: 0, y: -60 * sign }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign }) => ({ opacity: 0, y: -60 * sign, transition: { duration: 0.2 } }),
  transition: { type: "spring", stiffness: 400, damping: 40 },
}

export const fadeAnimation: ToastAnimation = {
  name: "Fade",
  initial: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.95 }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.95, transition: { duration: 0.2 } }),
  transition: { duration: 0.2, ease: "easeOut" },
}

export const bounceAnimation: ToastAnimation = {
  name: "Bounce",
  initial: ({ sign }) => ({ opacity: 0, y: -150 * sign }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign }) => ({ opacity: 0, y: 150 * sign, transition: { duration: 0.2 } }),
  transition: { type: "spring", stiffness: 500, damping: 15, mass: 1 },
}

export const zoomAnimation: ToastAnimation = {
  name: "Zoom",
  initial: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.5 }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale }),
  exit: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, scale: 0.5, transition: { duration: 0.2 } }),
  transition: { type: "spring", stiffness: 400, damping: 30 },
}

export const flipAnimation: ToastAnimation = {
  name: "Flip 3D",
  initial: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, rotateX: 90 }),
  animate: ({ opacity, offset, sign, scale }) => ({ opacity, y: offset * sign, scale, rotateX: 0 }),
  exit: ({ sign, offset }) => ({ opacity: 0, y: offset * sign, rotateX: -90, transition: { duration: 0.2 } }),
  transition: { type: "spring", stiffness: 300, damping: 30 },
}

export const animations = [
  defaultAnimation,
  slideAnimation,
  fadeAnimation,
  bounceAnimation,
  zoomAnimation,
  flipAnimation,
]

let toasts: ToastData[] = []
let listeners: ((toasts: ToastData[]) => void)[] = []
let toastCounter = 0

export const toastStore = {
  subscribe(listener: (items: ToastData[]) => void) {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((item) => item !== listener)
    }
  },
  addToast(toast: ToastData) {
    toasts = [toast, ...toasts.filter((item) => item.id !== toast.id)].slice(0, 10)
    listeners.forEach((listener) => listener(toasts))
  },
  removeToast(id?: string) {
    toasts = id ? toasts.filter((item) => item.id !== id) : []
    listeners.forEach((listener) => listener(toasts))
  },
  updateToast(id: string, data: Partial<ToastData>) {
    toasts = toasts.map((item) => item.id === id ? { ...item, ...data } : item)
    listeners.forEach((listener) => listener(toasts))
  },
  getSnapshot() {
    return toasts
  },
}

const generateId = () => Math.random().toString(36).substring(2, 9)

function resolveToastType(options?: ToastOptions): ToastType {
  if (options?.type) return options.type
  if (options?.variant === "destructive") return "error"
  return "info"
}

function resolveActions(options?: ToastOptions) {
  if (!options) return undefined
  if (options.actions && options.actions.length > 0) return options.actions
  if (options.action) return [options.action]
  return undefined
}

type ToastInput = React.ReactNode | (ToastOptions & { title: React.ReactNode })

function isToastOptionsInput(input: ToastInput): input is ToastOptions & { title: React.ReactNode } {
  return typeof input === "object"
    && input !== null
    && !Array.isArray(input)
    && !React.isValidElement(input)
    && "title" in input
}

function normalizeToastInput(
  input: ToastInput,
  options?: ToastOptions & { type?: ToastType },
) {
  if (isToastOptionsInput(input)) {
    return {
      title: input.title,
      options: input,
    }
  }

  return {
    title: input,
    options,
  }
}

const createToast = (input: ToastInput, type?: ToastType, options?: ToastOptions & { type?: ToastType }) => {
  const normalized = normalizeToastInput(input, options)
  const resolvedOptions = normalized.options
  const id = resolvedOptions?.id || generateId()

  toastStore.addToast({
    ...resolvedOptions,
    id,
    title: normalized.title,
    type: type || resolveToastType(resolvedOptions),
    actions: resolveActions(resolvedOptions),
    zIndex: toastCounter++,
  })
  return id
}

export interface ToastFn {
  (title: React.ReactNode, options?: ToastOptions & { type?: ToastType }): string
  (options: ToastOptions & { title: React.ReactNode; type?: ToastType }): string
  info: (title: React.ReactNode, options?: ToastOptions) => string
  success: (title: React.ReactNode, options?: ToastOptions) => string
  warning: (title: React.ReactNode, options?: ToastOptions) => string
  error: (title: React.ReactNode, options?: ToastOptions) => string
  loading: (title: React.ReactNode, options?: ToastOptions) => string
  dismiss: (id?: string) => void
  update: (id: string, options: Partial<ToastOptions> & { type?: ToastType; title?: React.ReactNode }) => void
  promise: <T>(
    promise: Promise<T> | (() => Promise<T>),
    messages: {
      loading: React.ReactNode
      success: React.ReactNode | ((data: T) => React.ReactNode)
      error: React.ReactNode | ((err: unknown) => React.ReactNode)
    },
    options?: ToastOptions
  ) => Promise<T>
}

const toastFn = ((input: ToastInput, options?: ToastOptions & { type?: ToastType }) =>
  createToast(input, undefined, options)) as ToastFn

toastFn.info = (title, options) => createToast(title, "info", options)
toastFn.success = (title, options) => createToast(title, "success", options)
toastFn.warning = (title, options) => createToast(title, "warning", options)
toastFn.error = (title, options) => createToast(title, "error", options)
toastFn.loading = (title, options) => createToast(title, "loading", options)
toastFn.dismiss = (id) => toastStore.removeToast(id)
toastFn.update = (id, options) => {
  const nextUpdate: Partial<ToastData> = { ...options }

  if ("type" in options || "variant" in options) {
    nextUpdate.type = resolveToastType(options)
  }

  if ("actions" in options || "action" in options) {
    nextUpdate.actions = resolveActions(options)
  }

  toastStore.updateToast(id, {
    ...nextUpdate,
  })
}

toastFn.promise = <T,>(
  promise: Promise<T> | (() => Promise<T>),
  messages: {
    loading: React.ReactNode
    success: React.ReactNode | ((data: T) => React.ReactNode)
    error: React.ReactNode | ((err: unknown) => React.ReactNode)
  },
  options?: ToastOptions,
) => {
  const id = toastFn.loading(messages.loading, options)
  const run = typeof promise === "function" ? promise() : promise
  const minLoadingTime = 600
  const startTime = Date.now()

  run.then((data) => {
    const elapsedTime = Date.now() - startTime
    const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

    setTimeout(() => {
      toastStore.updateToast(id, {
        type: "success",
        title: typeof messages.success === "function" ? messages.success(data) : messages.success,
      })
    }, remainingTime)
  }).catch((error) => {
    const elapsedTime = Date.now() - startTime
    const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

    setTimeout(() => {
      toastStore.updateToast(id, {
        type: "error",
        title: typeof messages.error === "function" ? messages.error(error) : messages.error,
      })
    }, remainingTime)
  })

  return run
}

export const toast = toastFn

const toastHeightCallbacks = new WeakMap<Element, (height: number) => void>()
let globalResizeObserver: ResizeObserver | null = null

const observeHeight = (element: Element, callback: (height: number) => void) => {
  if (!globalResizeObserver) {
    globalResizeObserver = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        for (const entry of entries) {
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
          const current = toastHeightCallbacks.get(entry.target)
          if (current) current(Math.round(height))
        }
      })
    })
  }

  toastHeightCallbacks.set(element, callback)
  globalResizeObserver.observe(element)

  return () => {
    toastHeightCallbacks.delete(element)
    if (globalResizeObserver) {
      globalResizeObserver.unobserve(element)
    }
  }
}

const LoadingSpinner = React.memo(({ theme }: { theme: ToastTheme }) => (
  <motion.svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    className={theme.spinner}
    animate={{ rotate: 360 }}
    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
  >
    <circle cx="12" cy="12" r="9" strokeOpacity="0.15" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </motion.svg>
))
LoadingSpinner.displayName = "LoadingSpinner"

function renderDescription(description: React.ReactNode, className: string) {
  if (typeof description === "string") {
    return <p className={`${className} whitespace-pre-line`}>{description}</p>
  }

  return <div className={className}>{description}</div>
}

export interface ToastProps {
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

export const Toast = React.memo(({
  toast,
  index,
  onRemove,
  isHovered,
  position,
  hoverOffset,
  onHeightChange,
  theme,
  animation,
}: ToastProps) => {
  const isBottom = position.startsWith("bottom")
  const sign = isBottom ? -1 : 1
  const ref = useRef<HTMLDivElement>(null)

  const stackedOffset = index * 12
  const offset = isHovered ? hoverOffset : stackedOffset
  const scale = isHovered ? 1 : 1 - index * 0.04
  const opacity = isHovered ? 1 : Math.max(0, 1 - index * 0.15)
  const duration = toast.duration || 4000
  const resolvedActions = toast.actions?.length ? toast.actions : toast.action ? [toast.action] : []

  useEffect(() => {
    if (!ref.current) return
    return observeHeight(ref.current, (height) => onHeightChange(toast.id, height))
  }, [toast.id, onHeightChange])

  useEffect(() => {
    if (isHovered || toast.type === "loading" || duration === Infinity) return
    const timer = setTimeout(() => {
      onRemove(toast.id)
    }, duration)
    return () => clearTimeout(timer)
  }, [isHovered, toast.type, toast.id, duration, onRemove])

  const ctx: ToastAnimationContext = useMemo(() => ({
    index,
    isHovered,
    offset,
    sign,
    scale,
    opacity,
    position,
  }), [index, isHovered, offset, sign, scale, opacity, position])

  const initialAnimation = useMemo(() => animation.initial(ctx), [animation, ctx])
  const animateAnimation = useMemo(() => animation.animate(ctx), [animation, ctx])
  const exitAnimation = useMemo(() => animation.exit(ctx), [animation, ctx])

  const styleObj = useMemo(() => ({
    zIndex: toast.zIndex,
    willChange: "transform, opacity, filter",
  }), [toast.zIndex])

  return (
    <motion.div
      ref={ref}
      initial={initialAnimation}
      animate={animateAnimation}
      exit={exitAnimation}
      transition={animation.transition}
      style={styleObj}
      className={`absolute ${isBottom ? "bottom-0" : "top-0"} w-full ${theme.borderRadius || "rounded-xl"} ${theme.background} border ${theme.border} p-4 flex flex-col group pointer-events-auto ${theme.shadow}`}
    >
      <div className="flex items-start">
        <AnimatePresence>
          {toast.type === "loading" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, width: 0, marginRight: 0 }}
              animate={{ opacity: 1, scale: 1, width: 16, marginRight: 12 }}
              exit={{ opacity: 0, scale: 0.5, width: 0, marginRight: 0 }}
              transition={{ type: "spring", stiffness: 450, damping: 40 }}
              className="mt-[2px] shrink-0 overflow-hidden"
            >
              <LoadingSpinner theme={theme} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col gap-1 overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="relative h-5 flex-1 overflow-hidden">
              <AnimatePresence initial={false}>
                <motion.h3
                  key={`${toast.id}-${toast.type}-${String(toast.title)}`}
                  initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
                  transition={{ type: "spring", stiffness: 450, damping: 40 }}
                  className={`text-[14px] font-semibold ${theme.textPrimary} tracking-tight leading-snug absolute inset-0 flex items-center`}
                >
                  {toast.title}
                </motion.h3>
              </AnimatePresence>
            </div>
            {!toast.action && resolvedActions.length === 0 && (
              <button
                onClick={() => onRemove(toast.id)}
                className={`w-6 h-6 rounded-full flex items-center justify-center ${theme.closeButton} ${theme.closeButtonHover} opacity-0 group-hover:opacity-100 transition-all duration-200 focus:outline-none -mt-1 -mr-1 shrink-0 ml-2`}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {toast.description && renderDescription(
            toast.description,
            `text-[13px] font-normal ${theme.textSecondary} leading-snug pr-4`,
          )}

          {resolvedActions.length > 0 && (
            <div className="w-full flex justify-end gap-2 mt-1 flex-wrap">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(toast.id)
                }}
                className={`px-3 py-1.5 bg-transparent ${theme.dismissButtonHover} ${theme.textSecondary} text-[12px] font-medium rounded-md transition-all active:scale-95`}
              >
                Dismiss
              </button>

              {resolvedActions.map((action, index) => {
                const actionClassName = action.variant === "destructive"
                  ? "bg-rose-500 text-white hover:bg-rose-600"
                  : `${theme.buttonBg} ${theme.buttonText} ${theme.buttonHover}`

                return (
                  <button
                    key={`${toast.id}-action-${index}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      action.onClick()
                    }}
                    className={`px-3 py-1.5 ${actionClassName} text-[12px] font-medium rounded-md transition-all active:scale-95 shadow-sm`}
                  >
                    {action.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
})
Toast.displayName = "Toast"

const positionClasses: Record<ToastPosition, string> = {
  "top-right": "top-4 right-4 sm:top-6 sm:right-6",
  "top-left": "top-4 left-4 sm:top-6 sm:left-6",
  "top-center": "top-4 left-1/2 -translate-x-1/2 sm:top-6",
  "bottom-right": "bottom-4 right-4 sm:bottom-6 sm:right-6",
  "bottom-left": "bottom-4 left-4 sm:bottom-6 sm:left-6",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 sm:bottom-6",
}

function useResolvedDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
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

export interface ToasterProps {
  position?: ToastPosition
  theme?: string | ToastTheme
  isDarkMode?: boolean
  animation?: ToastAnimation
}

export const Toaster: React.FC<ToasterProps> = ({
  position = "top-right",
  theme = "default",
  isDarkMode,
  animation = defaultAnimation,
}) => {
  const [items, setItems] = useState<ToastData[]>([])
  const [isHovered, setIsHovered] = useState(false)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvedDarkMode = useResolvedDarkMode()
  const darkMode = isDarkMode ?? resolvedDarkMode

  useEffect(() => {
    return toastStore.subscribe(setItems)
  }, [])

  const currentTheme = typeof theme === "string"
    ? themes[theme]?.[darkMode ? "dark" : "light"] || themes.default[darkMode ? "dark" : "light"]
    : theme

  const removeToast = useCallback((id: string) => {
    toastStore.removeToast(id)
    setHeights((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const handleHeightChange = useCallback((id: string, height: number) => {
    setHeights((prev) => {
      if (prev[id] === height) return prev
      return { ...prev, [id]: height }
    })
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false)
    }, 150)
  }, [])

  const { offsets, totalHeight } = useMemo(() => {
    let currentOffset = 0
    const gap = 12
    const nextOffsets: number[] = []

    for (let index = 0; index < items.length; index++) {
      nextOffsets.push(currentOffset)
      currentOffset += (heights[items[index].id] || 80) + gap
    }

    return {
      offsets: nextOffsets,
      totalHeight: items.length > 0 ? currentOffset - gap : 0,
    }
  }, [items, heights])

  return (
    <div
      className={`fixed ${positionClasses[position]} w-[calc(100vw-32px)] sm:w-[360px] z-[100] pointer-events-none`}
      style={{ height: items.length > 0 ? (isHovered ? totalHeight : 80) : 0 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative w-full h-full">
        <AnimatePresence mode="popLayout">
          {items.map((toastData, index) => (
            <Toast
              key={toastData.id}
              toast={toastData}
              index={index}
              onRemove={removeToast}
              isHovered={isHovered}
              position={position}
              hoverOffset={offsets[index]}
              onHeightChange={handleHeightChange}
              theme={currentTheme}
              animation={animation}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function useToast() {
  const [items, setItems] = useState<ToastData[]>([])

  useEffect(() => {
    return toastStore.subscribe(setItems)
  }, [])

  return {
    toasts: items,
    toast,
    dismiss: toast.dismiss,
  }
}
