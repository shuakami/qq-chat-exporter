export const EASE = {
  // standard in-out
  inOut: [0.22, 1, 0.36, 1] as [number, number, number, number],
  // swift out
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  // gentle in
  in: [0.3, 0, 0.7, 1] as [number, number, number, number],
}

export const DUR = {
  fast: 0.18,
  normal: 0.36,
  slow: 0.6,
}

// 级联容器与子项 variants
export const makeStagger = (delay = 0.04, r = false) => ({
  container: {
    animate: {
      transition: r
        ? { staggerChildren: 0, when: "beforeChildren" }
        : { staggerChildren: delay, when: "beforeChildren" },
    },
  },
  item: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } },
    exit: { opacity: 0, y: 6, transition: { duration: DUR.fast, ease: EASE.in } },
  },
})

// 卡片悬停/按压微动
export const hoverLift = {
  whileHover: { y: -2, scale: 1.01, transition: { duration: DUR.fast, ease: EASE.out } },
  whileTap: { scale: 0.995, transition: { duration: DUR.fast, ease: EASE.inOut } },
}

// 通用淡入淡出（用于 Tab 切换）
export const fadeSlide = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE.inOut } },
  exit: { opacity: 0, y: -8, transition: { duration: DUR.normal, ease: EASE.in } },
}

// Toast 弹入
export const toastAnim = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.normal, ease: EASE.out } },
  exit: { opacity: 0, y: 10, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.in } },
}

// 状态点呼吸（通过 framer 的 animate 属性实现）
export const statusPulse = {
  animate: {
    scale: [1, 1.06, 1],
    transition: { duration: 2.4, ease: EASE.inOut, repeat: Infinity, repeatDelay: 0.2 },
  },
}
