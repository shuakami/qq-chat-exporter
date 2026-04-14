"use client"

import { useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface LoadingScreenProps {
  isLoading: boolean
  onComplete: () => void
}

export function LoadingScreen({ isLoading, onComplete }: LoadingScreenProps) {
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        onComplete()
      }, 1800)
      
      return () => clearTimeout(timer)
    }
  }, [isLoading, onComplete])

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
        >
          <div className="flex flex-col items-center gap-5">
            <div className="text-[15px] font-semibold tracking-tight text-foreground">
              QQ Chat Exporter
            </div>
            <div className="w-5 h-5 border-2 border-black/[0.08] dark:border-white/[0.08] border-t-foreground/60 rounded-full animate-spin" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
