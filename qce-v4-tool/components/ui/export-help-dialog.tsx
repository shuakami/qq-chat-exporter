"use client"

import React, { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { X, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type ExportHelpFormat = "html" | "json" | "jsonl" | "zip"

interface ExportHelpDialogProps {
  open: boolean
  format: ExportHelpFormat
  filePath?: string
  onClose: () => void
  onOpenFileLocation?: (filePath: string) => void
  onOpenExportDirectory?: () => void
}

function CodeBlock({ code, children }: { code: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="group relative rounded-[10px] border border-black/[0.04] dark:border-white/[0.06] bg-[#fcfcfc] dark:bg-white/[0.03] my-1 mb-4 overflow-hidden">
      <pre className="px-[18px] py-3.5 overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-foreground/80">
        {children ?? code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="复制"
        className={cn(
          "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-all",
          copied
            ? "opacity-100 text-green-600 dark:text-green-500"
            : "opacity-0 group-hover:opacity-100 hover:text-muted-foreground",
        )}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-10 mb-3 text-[17px] font-semibold tracking-[-0.02em] text-foreground first:mt-0">{children}</h2>
)

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-3.5 text-sm leading-[1.8] text-muted-foreground">{children}</p>
)

const UL = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="mb-3.5 list-disc pl-5 text-sm leading-[1.8] text-muted-foreground marker:text-muted-foreground/40">
    {items.map((it, i) => (
      <li key={i} className="my-1">{it}</li>
    ))}
  </ul>
)

const OL = ({ items }: { items: React.ReactNode[] }) => (
  <ol className="mb-3.5 list-decimal pl-5 text-sm leading-[1.8] text-muted-foreground marker:text-muted-foreground/40">
    {items.map((it, i) => (
      <li key={i} className="my-1">{it}</li>
    ))}
  </ol>
)

const Callout = ({ children }: { children: React.ReactNode }) => (
  <blockquote className="mb-4 border-l-2 border-black/[0.14] dark:border-white/[0.18] pl-[18px] py-0.5 text-sm leading-[1.8] text-foreground/70">
    {children}
  </blockquote>
)

const IC = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-[5px] bg-black/[0.035] dark:bg-white/[0.06] px-[5px] py-[2px] font-mono text-[0.85em]">{children}</code>
)

const Cm = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground/50">{children}</span>
)

const FORMAT_ORDER: ExportHelpFormat[] = ["html", "json", "jsonl", "zip"]

const FORMAT_META: Record<ExportHelpFormat, { nav: string; title: string; desc: string }> = {
  html: { nav: "HTML 导出", title: "HTML 导出", desc: "可视化聊天记录，浏览器直接打开。" },
  json: { nav: "JSON 导出", title: "JSON 导出", desc: "结构化数据格式，适合程序处理与二次开发。" },
  jsonl: { nav: "JSONL 分块导出", title: "JSONL 分块导出", desc: "逐行 JSON 分块文件，适合大规模数据处理。" },
  zip: { nav: "流式 HTML ZIP", title: "流式 HTML ZIP 导出", desc: "分块 HTML 与资源一起打包，超大群聊专用。" },
}

function HtmlDoc() {
  return (
    <>
      <H2>适合什么场景？</H2>
      <P>
        HTML 格式导出的聊天记录可以直接用浏览器打开查看，保留原始的对话样式，支持搜索和时间跳转，适合回顾和分享。
      </P>

      <H2>怎么用？</H2>
      <OL
        items={[
          <>导出完成后，在导出目录找到 <IC>.html</IC> 文件</>,
          <>双击用浏览器打开即可查看</>,
          <>图片等资源在同目录的 <IC>resources</IC> 文件夹</>,
        ]}
      />

      <H2>文件结构</H2>
      <CodeBlock code={"导出目录/\n├── 张三(10000).html\n└── resources/\n    ├── images/\n    └── videos/"}>
        <Cm>导出目录/</Cm>{"\n"}
        {"├── 张三(10000).html\n"}
        {"└── resources/\n"}
        {"    ├── images/\n"}
        {"    └── videos/"}
      </CodeBlock>

      <Callout>
        注意：不要单独移动 HTML 文件，需要和 <IC>resources</IC> 文件夹放在一起，图片才能正常显示。
      </Callout>
    </>
  )
}

function JsonDoc() {
  return (
    <>
      <H2>适合什么场景？</H2>
      <P>JSON 是通用的数据格式，适合程序处理、数据分析、导入其他工具或二次开发。</P>

      <H2>可以做什么？</H2>
      <UL
        items={[
          <>用 Python、Node.js 等脚本分析聊天数据</>,
          <>导入数据库做统计查询</>,
          <>转换成其他格式（如 Excel、CSV）</>,
          <>作为 AI 训练语料</>,
        ]}
      />

      <H2>快速读取</H2>
      <CodeBlock code={'import json\n\nwith open("export.json", encoding="utf-8") as f:\n    data = json.load(f)\n\nprint(len(data["messages"]), "条消息")'}>
        <span className="text-[#215bd6] dark:text-blue-400">import</span> json{"\n\n"}
        <span className="text-[#215bd6] dark:text-blue-400">with</span> open(<span className="text-[#0f766e] dark:text-teal-400">"export.json"</span>, encoding=<span className="text-[#0f766e] dark:text-teal-400">"utf-8"</span>) <span className="text-[#215bd6] dark:text-blue-400">as</span> f:{"\n"}
        {"    "}data = json.load(f){"\n\n"}
        print(len(data[<span className="text-[#0f766e] dark:text-teal-400">"messages"</span>]), <span className="text-[#0f766e] dark:text-teal-400">"条消息"</span>)
      </CodeBlock>

      <Callout>
        JSON 文件可以用任何文本编辑器打开查看，推荐使用 VS Code 等支持语法高亮的编辑器。
      </Callout>
    </>
  )
}

function JsonlDoc() {
  return (
    <>
      <H2>这是什么？</H2>
      <P>
        JSONL（JSON Lines）格式把聊天记录拆成多个小文件，每个文件包含几千条消息。适合处理几十万甚至上百万条消息的超大群聊。
      </P>

      <H2>文件结构</H2>
      <CodeBlock code={"导出目录/\n├── chunk_001.jsonl\n├── chunk_002.jsonl\n├── chunk_003.jsonl\n└── ..."}>
        <Cm>导出目录/</Cm>{"\n"}
        {"├── chunk_001.jsonl\n"}
        {"├── chunk_002.jsonl\n"}
        {"├── chunk_003.jsonl\n"}
        <Cm>└── ...</Cm>
      </CodeBlock>

      <H2>怎么用？</H2>
      <UL
        items={[
          <>用 Python、Node.js 等脚本逐行读取处理</>,
          <>导入数据库做分析统计</>,
          <>训练 AI 模型的语料数据</>,
        ]}
      />

      <H2>逐行读取</H2>
      <CodeBlock code={'import json\n\nwith open("chunk_001.jsonl", encoding="utf-8") as f:\n    for line in f:\n        msg = json.loads(line)'}>
        <span className="text-[#215bd6] dark:text-blue-400">import</span> json{"\n\n"}
        <span className="text-[#215bd6] dark:text-blue-400">with</span> open(<span className="text-[#0f766e] dark:text-teal-400">"chunk_001.jsonl"</span>, encoding=<span className="text-[#0f766e] dark:text-teal-400">"utf-8"</span>) <span className="text-[#215bd6] dark:text-blue-400">as</span> f:{"\n"}
        {"    "}<span className="text-[#215bd6] dark:text-blue-400">for</span> line <span className="text-[#215bd6] dark:text-blue-400">in</span> f:{"\n"}
        {"        "}msg = json.loads(line)
      </CodeBlock>

      <Callout>
        每个 <IC>.jsonl</IC> 文件的每一行都是一条独立的 JSON 消息，可以流式读取，不用一次性加载到内存。
      </Callout>
    </>
  )
}

function ZipDoc() {
  return (
    <>
      <H2>这是什么？</H2>
      <P>
        流式 ZIP 把聊天记录导出成分块的 HTML 格式，每块约 2000 条消息，然后连同图片等资源一起打包成 ZIP。适合超大群聊，边导出边写入，不会爆内存。
      </P>

      <H2>ZIP 里有什么？</H2>
      <CodeBlock code={"xxx_streaming.zip/\n├── index.html\n├── assets/\n└── data/\n    ├── manifest.js\n    ├── chunks/\n    └── index/"}>
        <Cm>xxx_streaming.zip/</Cm>{"\n"}
        {"├── index.html "}<Cm>（主页面，直接打开）</Cm>{"\n"}
        {"├── assets/ "}<Cm>（样式和脚本）</Cm>{"\n"}
        {"└── data/\n"}
        {"    ├── manifest.js "}<Cm>（清单）</Cm>{"\n"}
        {"    ├── chunks/ "}<Cm>（分块消息）</Cm>{"\n"}
        {"    └── index/ "}<Cm>（消息索引）</Cm>
      </CodeBlock>

      <H2>怎么用？</H2>
      <OL
        items={[
          <>解压 ZIP 文件到任意文件夹</>,
          <>双击打开 <IC>index.html</IC></>,
          <>页面会自动加载分块数据，支持搜索和跳转</>,
        ]}
      />

      <Callout>
        注意：必须解压后才能正常查看，不要直接在压缩软件里打开 HTML。
      </Callout>
    </>
  )
}

const FORMAT_DOC: Record<ExportHelpFormat, () => React.JSX.Element> = {
  html: HtmlDoc,
  json: JsonDoc,
  jsonl: JsonlDoc,
  zip: ZipDoc,
}

export function ExportHelpDialog({
  open,
  format,
  filePath,
  onClose,
  onOpenFileLocation,
  onOpenExportDirectory,
}: ExportHelpDialogProps) {
  const [active, setActive] = useState<ExportHelpFormat>(format)

  useEffect(() => {
    if (open) setActive(format)
  }, [open, format])

  const meta = FORMAT_META[active]
  const Doc = FORMAT_DOC[active]
  const showOpenLocation = active === "jsonl" || active === "zip"

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-background/80 z-[110]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-4 sm:inset-[8%] z-[111] flex flex-col bg-card rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.12)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.4)] overflow-hidden"
          >
            {/* Top bar */}
            <div className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-black/[0.05] dark:border-white/[0.06] px-5">
              <div className="flex items-center gap-[9px] text-sm font-semibold tracking-[-0.01em] text-foreground select-none">
                <span>QCE</span>
                <span className="rotate-[8deg] text-[15px] font-light text-foreground/20">/</span>
                <span className="font-normal text-muted-foreground">导出格式说明</span>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Sidebar */}
              <div className="hidden w-[190px] flex-shrink-0 overflow-y-auto border-r border-black/[0.05] dark:border-white/[0.06] px-5 py-6 md:block">
                <div className="mb-2 text-xs font-medium text-muted-foreground/50">导出格式</div>
                <nav className="flex flex-col">
                  {FORMAT_ORDER.map((f) => (
                    <button
                      key={f}
                      onClick={() => setActive(f)}
                      className={cn(
                        "py-1 text-left text-[13.5px] transition-colors",
                        active === f
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {FORMAT_META[f].nav}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 overflow-y-auto">
                {/* Mobile format switcher */}
                <div className="flex gap-1.5 overflow-x-auto px-5 pt-4 md:hidden">
                  {FORMAT_ORDER.map((f) => (
                    <button
                      key={f}
                      onClick={() => setActive(f)}
                      className={cn(
                        "whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors",
                        active === f
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {FORMAT_META[f].nav}
                    </button>
                  ))}
                </div>

                <div className="mx-auto w-full max-w-[640px] px-6 py-8 sm:px-10">
                  <h1 className="mb-2 text-[26px] font-semibold leading-[1.25] tracking-[-0.03em] text-foreground">
                    {meta.title}
                  </h1>
                  <p className="mb-8 text-sm leading-[1.8] text-muted-foreground">{meta.desc}</p>
                  <Doc />
                </div>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="flex h-[72px] flex-shrink-0 items-center justify-end gap-3 border-t border-black/[0.05] dark:border-white/[0.06] px-6">
              {showOpenLocation && (onOpenFileLocation || onOpenExportDirectory) && (
                <Button
                  variant="outline"
                  className="rounded-full px-5"
                  onClick={() => {
                    if (filePath && onOpenFileLocation) {
                      onOpenFileLocation(filePath)
                    } else if (onOpenExportDirectory) {
                      onOpenExportDirectory()
                    }
                  }}
                >
                  {filePath ? "打开文件位置" : "打开导出目录"}
                </Button>
              )}
              <Button className="rounded-full px-6" onClick={onClose}>
                知道了
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
