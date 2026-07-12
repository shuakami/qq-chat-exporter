'use client'

import { useEffect } from 'react'

// Inter（可变字重，仅 latin 子集，~46KB）从 npmmirror 延迟加载：
// 首屏先用 Geist/系统字体渲染，页面 load 后才下载并应用（html 加 qce-inter class），
// 加载失败静默回退，不影响任何功能。
const INTER_WOFF2 =
  'https://registry.npmmirror.com/@fontsource-variable/inter/5.2.8/files/files/inter-latin-wght-normal.woff2'

export function InterFontLoader() {
  useEffect(() => {
    if (typeof FontFace === 'undefined') return

    const loadInter = () => {
      try {
        const font = new FontFace(
          'Inter Variable',
          `url(${INTER_WOFF2}) format('woff2-variations')`,
          { weight: '100 900', display: 'swap' }
        )
        font
          .load()
          .then((loaded) => {
            document.fonts.add(loaded)
            document.documentElement.classList.add('qce-inter')
          })
          .catch(() => {})
      } catch {
        /* ignore */
      }
    }

    if (document.readyState === 'complete') {
      loadInter()
    } else {
      window.addEventListener('load', loadInter, { once: true })
      return () => window.removeEventListener('load', loadInter)
    }
  }, [])

  return null
}
