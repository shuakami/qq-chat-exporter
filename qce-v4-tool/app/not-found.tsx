'use client'

import { motion } from 'framer-motion'
import { FileQuestion, Home, ArrowLeft, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-4">
      <motion.div
        className="w-full max-w-md text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-neutral-100 dark:bg-neutral-800 mb-6"
        >
          <FileQuestion className="w-10 h-10 text-neutral-400 dark:text-neutral-500" />
        </motion.div>

        {/* Text */}
        <h1 className="text-6xl font-bold text-neutral-200 dark:text-neutral-800 mb-2">
          404
        </h1>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
          页面不存在
        </h2>
        <p className="text-neutral-500 dark:text-neutral-400 mb-8">
          你访问的页面可能已被移动或删除
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/qce-v4-tool"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
          >
            <Home className="w-4 h-4" />
            返回首页
          </Link>
          
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回上页
          </button>
        </div>

        {/* Footer */}
        <div className="mt-12">
          <a
            href="https://github.com/shuakami/qq-chat-exporter"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            QQ Chat Exporter
          </a>
        </div>
      </motion.div>
    </div>
  )
}
