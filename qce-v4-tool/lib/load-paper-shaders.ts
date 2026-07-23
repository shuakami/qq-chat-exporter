/**
 * 按需加载 paper-shaders（@paper-design/shaders 0.0.77）。
 *
 * 加载顺序：先本地随包发布的 vendor 文件（离线可用），失败再回退到
 * jsdelivr / fastly 的 ESM CDN。整个库只在真正需要时（关于页）动态引入，
 * 不进入主包体积。与 public/index.html 首页使用同一份 vendor 与加载策略。
 */

export interface PaperShaderColor {
  r: number
  g: number
  b: number
  a: number
}

export interface ShaderMountInstance {
  setUniforms: (uniforms: Record<string, unknown>) => void
  setSpeed: (speed: number) => void
  setFrame: (frame: number) => void
  dispose: () => void
}

export interface PaperShadersModule {
  ShaderMount: new (
    parent: HTMLElement,
    fragmentShader: string,
    uniforms: Record<string, unknown>,
    webGlContextAttributes?: WebGLContextAttributes,
    speed?: number,
    frame?: number,
    minPixelRatio?: number,
    maxPixelCount?: number,
  ) => ShaderMountInstance
  grainGradientFragmentShader: string
  GrainGradientShapes: Record<string, number>
  ShaderFitOptions: Record<string, number>
  defaultObjectSizing: {
    fit: string
    scale: number
    rotation: number
    offsetX: number
    offsetY: number
    originX: number
    originY: number
    worldWidth: number
    worldHeight: number
  }
  getShaderNoiseTexture: () => HTMLImageElement
  getShaderColorFromString: (color: string) => PaperShaderColor
}

const BASE = process.env.NODE_ENV === "production" ? "/static/qce" : ""

const SOURCES = [
  `${BASE}/assets/vendor/paper-shaders-0.0.77.js`,
  "https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.77/+esm",
  "https://fastly.jsdelivr.net/npm/@paper-design/shaders@0.0.77/+esm",
]

let cached: Promise<PaperShadersModule> | null = null

export function loadPaperShaders(): Promise<PaperShadersModule> {
  if (cached) return cached

  cached = (async () => {
    let lastError: unknown = null
    for (const src of SOURCES) {
      try {
        const mod = (await import(/* webpackIgnore: true */ src)) as Partial<PaperShadersModule>
        if (mod && typeof mod.ShaderMount === "function" && mod.grainGradientFragmentShader) {
          return mod as PaperShadersModule
        }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error("paper-shaders 加载失败")
  })()

  // 加载失败时清空缓存，允许后续重试
  cached.catch(() => {
    cached = null
  })

  return cached
}
