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
