"use client"

import { AnimatePresence, motion } from "framer-motion"

interface BatchSelectionCheckboxProps {
  visible: boolean
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

export function BatchSelectionCheckbox({ visible, checked, label, onCheckedChange }: BatchSelectionCheckboxProps) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ width: 0, opacity: 0, marginRight: 0 }}
          animate={{ width: 14, opacity: 1, marginRight: 0 }}
          exit={{ width: 0, opacity: 0, marginRight: 0 }}
          transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
          className="flex-shrink-0 overflow-hidden"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={label}
            className={[
              "flex items-center justify-center w-[14px] h-[14px] rounded-[3.5px] transition-colors cursor-pointer border",
              checked
                ? "bg-[#317CFF] border-[#317CFF]"
                : "bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-600 hover:border-[#317CFF]",
            ].join(" ")}
            onClick={(event) => {
              event.stopPropagation()
              onCheckedChange(!checked)
            }}
          >
            <AnimatePresence>
              {checked && (
                <motion.svg
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-2.5 h-2.5 text-white"
                >
                  <path d="M4.5 12.75l6 6 9-13.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </motion.svg>
              )}
            </AnimatePresence>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
