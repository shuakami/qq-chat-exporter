"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"
import { GrainGradient } from "@/components/ui/grain-gradient"
import { useThemeMode } from "@/hooks/use-theme-mode"

const REPO_URL = "https://github.com/shuakami/qq-chat-exporter"
const DOCS_URL = "https://shuakami.github.io/qq-chat-exporter/docs/index.html"
const NAPCAT_URL = "https://napneko.github.io/"

// 与 public/index.html 首页同款的品牌色
const LIGHT_COLORS = ["#f0f5ff", "#d9e6ff", "#317cfe10"]
const DARK_COLORS = ["#0b101c", "#122036", "#317cfe20"]

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 border-b border-foreground/25 pb-0.5 text-sm font-medium text-foreground transition-colors hover:border-foreground"
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  )
}

export function AboutPanel() {
  const { isDark } = useThemeMode()
  const colors = React.useMemo(() => (isDark ? DARK_COLORS : LIGHT_COLORS), [isDark])
  const wordmarkGradient = isDark
    ? "linear-gradient(to bottom, rgba(120,168,255,0.32), rgba(120,168,255,0.06))"
    : "linear-gradient(to bottom, rgba(49,124,254,0.16), rgba(49,124,254,0.03))"

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      {/* ==================== 品牌 banner：与首页 hero 同款，仅淡入 ==================== */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex h-56 items-center justify-center overflow-hidden rounded-2xl sm:h-64"
      >
        <GrainGradient colors={colors} />
        <span
          className="pointer-events-none relative select-none whitespace-nowrap text-[clamp(36px,6.5vw,76px)] font-bold leading-none tracking-[-0.04em] text-transparent"
          style={{
            backgroundImage: wordmarkGradient,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          QQ Chat Exporter
        </span>
      </motion.div>

      {/* ==================== 介绍 ==================== */}
      <section className="mt-12 max-w-2xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          最好的嘎嘎超级聊天记录导出工具！
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-[1.75] text-muted-foreground">
          QCE 能导出聊天记录为 HTML、JSON、TXT。且支持定时备份、批量导出、表情包导出。
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-7">
          <TextLink href={REPO_URL}>去 GitHub 点亮 Star</TextLink>
          <TextLink href={DOCS_URL}>使用文档</TextLink>
        </div>
      </section>

      {/* ==================== 致谢 NapCat ==================== */}
      <section className="mt-12 max-w-2xl">
        <div className="flex-1 space-y-3">
          <h2 className="text-base font-medium text-foreground">致谢 NapCat</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            感谢 NapCat 提供了访问 QQ 客户端数据的能力，让我们能够读取和导出聊天记录。
          </p>
          <TextLink href={NAPCAT_URL}>了解 NapCat</TextLink>
        </div>
      </section>

      {/* ==================== 使用声明 ==================== */}
      <section className="mt-12 max-w-2xl pb-6">
        <div className="space-y-3">
          <h3 className="text-base font-medium text-foreground">使用声明</h3>
          <div className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            <p>本工具仅供学习和个人使用，请勿用于商业用途。请遵守相关法律法规和平台服务条款。</p>
            <p>本项目完全开源免费，任何个人或组织不得将此工具进行商业销售或倒卖。</p>
            <p className="text-muted-foreground/60">
              如果这个工具对你有帮助，请在 GitHub 上给我们一个 Star
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default AboutPanel
