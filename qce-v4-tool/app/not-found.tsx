'use client'

import { BuildFooter } from '@/components/ui/build-footer'

export default function NotFound() {
  return (
    <div className="flex flex-col h-screen w-full bg-[#fbfbfb] dark:bg-neutral-950 text-[#111111] dark:text-neutral-100 font-sans">
      <main className="flex-1 flex flex-col items-start justify-center max-w-lg w-full mx-auto px-8 pb-32">
        <h1 className="text-[20px] font-medium text-[#111111] dark:text-neutral-100 mb-3">页面未找到</h1>
        <p className="text-[14px] text-[#737373] dark:text-neutral-400 mb-8 leading-relaxed">
          您访问的页面不存在或已被移除。
          <br />
          请检查链接是否正确。
        </p>

        <button
          onClick={() => {
            window.location.href = '/qce/'
          }}
          className="inline-flex items-center justify-center h-8 px-4 text-[13px] font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-black/10 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white rounded-full transition-all"
        >
          返回主页
        </button>
      </main>

      <BuildFooter />
    </div>
  )
}
