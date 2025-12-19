"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"

interface LoadingScreenProps {
  isLoading: boolean
  onComplete: () => void
}

export function LoadingScreen({ isLoading, onComplete }: LoadingScreenProps) {
  const [showLogo, setShowLogo] = useState(false)

  useEffect(() => {
    if (isLoading) {
      setShowLogo(true)
      // Auto-complete after 2.5 seconds for smooth experience
      const timer = setTimeout(() => {
        onComplete()
      }, 2500)
      
      return () => clearTimeout(timer)
    }
  }, [isLoading, onComplete])

  return (
    <AnimatePresence mode="wait">
      {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/50 dark:bg-neutral-950/50 backdrop-blur-md"
        >
          <div className="flex flex-col items-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ 
                delay: 0.2, 
                duration: 0.8, 
                ease: "easeOut" 
              }}
              className="relative"
            >
              <Image
                src="/text-full-logo.png"
                alt="QCE Logo"
                width={600}
                height={240}
                className="max-w-2xl w-auto h-auto invert"
                priority
              />
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ 
                delay: 0.8, 
                duration: 0.6, 
                ease: "easeInOut" 
              }}
              className="mt-6"
            >
              <div className="flex space-x-1">
                {[0, 1, 2].map((index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: index * 0.2,
                      ease: "easeInOut"
                    }}
                    className="w-2 h-2 bg-neutral-400 dark:bg-neutral-500 rounded-full"
                  />
                ))}
              </div>
            </motion.div>
            
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ 
                delay: 1.2, 
                duration: 0.5, 
                ease: "easeOut" 
              }}
              className="mt-4 text-neutral-600 dark:text-neutral-400 text-sm font-light"
            >
              正在启动 QQ Chat Exporter...
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}