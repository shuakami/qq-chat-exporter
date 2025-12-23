'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-[400px] text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="text-7xl font-semibold text-neutral-200 dark:text-neutral-800 leading-none mb-3">
          404
        </div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1.5">
          页面不存在
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
          你访问的页面可能已被移动或删除
        </p>

        <div className="flex gap-2.5 justify-center">
          <Link
            href="/qce-v4-tool"
            className="flex items-center justify-center px-6 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            返回首页
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center justify-center px-6 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            返回上页
          </button>
        </div>
      </motion.div>
    </div>
  )
}
