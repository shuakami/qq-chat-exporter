"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { loadPaperShaders, type ShaderMountInstance } from "@/lib/load-paper-shaders"

interface GrainGradientProps {
  colors: string[]
  intensity?: number
  speed?: number
  className?: string
}

/**
 * 与 public/index.html 首页同款的 grain gradient 氛围底。
 * 加载完成前保持透明，加载后淡入；WebGL 不可用时静默降级为空白。
 */
export function GrainGradient({ colors, intensity = 0.38, speed = 0.4, className }: GrainGradientProps) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const mountRef = React.useRef<ShaderMountInstance | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const m = await loadPaperShaders()
        if (cancelled || !hostRef.current) return

        const tex = m.getShaderNoiseTexture()
        if (tex && !(tex.complete && tex.naturalWidth)) {
          await new Promise<void>((resolve) => {
            tex.onload = () => resolve()
            tex.onerror = () => resolve()
          })
        }
        if (cancelled || !hostRef.current) return

        const s = m.defaultObjectSizing
        mountRef.current = new m.ShaderMount(
          hostRef.current,
          m.grainGradientFragmentShader,
          {
            u_colorBack: m.getShaderColorFromString("#00000000"),
            u_colors: colors.map(m.getShaderColorFromString),
            u_colorsCount: colors.length,
            u_softness: 1,
            u_intensity: intensity,
            u_noise: 0.1,
            u_shape: m.GrainGradientShapes.corners,
            u_noiseTexture: tex,
            u_fit: m.ShaderFitOptions[s.fit],
            u_scale: s.scale,
            u_rotation: s.rotation,
            u_offsetX: s.offsetX,
            u_offsetY: s.offsetY,
            u_originX: s.originX,
            u_originY: s.originY,
            u_worldWidth: s.worldWidth,
            u_worldHeight: s.worldHeight,
          },
          undefined,
          speed,
          0,
          1,
          1920 * 1080,
        )
        requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setReady(true)))
      } catch {
        // WebGL / 加载失败：保持空白背景
      }
    })()

    return () => {
      cancelled = true
      mountRef.current?.dispose()
      mountRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.join(","), intensity, speed])

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn("absolute inset-0 transition-opacity duration-700", ready ? "opacity-100" : "opacity-0", className)}
    />
  )
}
