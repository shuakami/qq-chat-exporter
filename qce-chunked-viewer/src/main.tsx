import { createRoot } from 'react-dom/client';
import Viewer from './Viewer';
import modernCss from '../../qq-chat-export-core/assets/modern_css.css?raw';
import './index.css';
import './viewer.css';

// The exporter's message-layer CSS (MODERN_CSS) is embedded in a cascade
// layer sitting between tailwind's `base` (so it can override the preflight)
// and `utilities` (so shell utility classes always win). It must be the first
// stylesheet in the document so the layer order statement takes effect.
const modernStyle = document.createElement('style');
modernStyle.textContent = `@layer theme, base, qce-export, components, utilities;\n@layer qce-export {\n${modernCss}\n}`;
document.head.prepend(modernStyle);

// Inter（可变字重，仅 latin 子集，~46KB）从 npmmirror 延迟加载：
// 首屏先用系统字体渲染，页面 load 后才下载并应用，加载失败静默回退。
const INTER_WOFF2 =
  'https://registry.npmmirror.com/@fontsource-variable/inter/5.2.8/files/files/inter-latin-wght-normal.woff2';

function loadInterFont(): void {
  if (typeof FontFace === 'undefined') return;
  try {
    const font = new FontFace('Inter Variable', `url(${INTER_WOFF2}) format('woff2-variations')`, {
      weight: '100 900',
      display: 'swap',
    });
    font
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        document.documentElement.classList.add('qce-inter');
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

if (document.readyState === 'complete') {
  loadInterFont();
} else {
  window.addEventListener('load', loadInterFont, { once: true });
}

function mount(): void {
  const el = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
  el.id = 'root';
  createRoot(el).render(<Viewer />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
