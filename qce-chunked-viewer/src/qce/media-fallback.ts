const ICON_IMAGE_OFF =
  '<line x1="2" y1="2" x2="22" y2="22"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/>' +
  '<line x1="13.5" y1="13.5" x2="6" y2="21"/><line x1="18" y1="12" x2="21" y2="15"/>' +
  '<path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59"/>' +
  '<path d="M21 15V5a2 2 0 0 0-2-2H9"/>';
const ICON_VIDEO_OFF =
  '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/>' +
  '<path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/>' +
  '<line x1="2" y1="2" x2="22" y2="22"/>';
const ICON_AUDIO_OFF =
  '<path d="M12 2a3 3 0 0 0-3 3v3"/><path d="M15 9V5a3 3 0 0 0-.12-.84"/>' +
  '<path d="M5 10v1a7 7 0 0 0 11.5 5.36"/><path d="M19 10v1c0 .94-.18 1.84-.52 2.66"/>' +
  '<path d="M12 18v4"/><path d="M8 22h8"/><line x1="2" y1="2" x2="22" y2="22"/>';

export type MediaFallbackKind = 'image' | 'video' | 'audio' | 'sticker' | 'compact';

const KIND_ICON: Record<MediaFallbackKind, string> = {
  image: ICON_IMAGE_OFF,
  video: ICON_VIDEO_OFF,
  audio: ICON_AUDIO_OFF,
  sticker: ICON_IMAGE_OFF,
  compact: ICON_IMAGE_OFF,
};

const KIND_TEXT: Record<MediaFallbackKind, string> = {
  image: '图片不可用',
  video: '视频不可用',
  audio: '语音不可用',
  sticker: '',
  compact: '',
};

function applySize(el: HTMLElement, source: HTMLElement, kind: MediaFallbackKind): void {
  if (kind === 'sticker') return;
  if (kind === 'compact') {
    el.style.width = '52px';
    el.style.height = '52px';
    return;
  }

  const rect = source.getBoundingClientRect();
  const width = source.getAttribute('width') ?? source.dataset.mediaWidth;
  const height = source.getAttribute('height') ?? source.dataset.mediaHeight;
  const parsedWidth = Number.parseFloat(width ?? '');
  const parsedHeight = Number.parseFloat(height ?? '');
  const measuredWidth = rect.width > 24 ? rect.width : parsedWidth;
  const ratio = parsedWidth > 0 && parsedHeight > 0 ? parsedHeight / parsedWidth : 0.66;
  const fallbackWidth = kind === 'audio' ? 180 : 240;
  const resolvedWidth = Number.isFinite(measuredWidth) && measuredWidth > 24
    ? Math.min(measuredWidth, 320)
    : fallbackWidth;
  el.style.width = `${resolvedWidth}px`;
  el.style.height = `${Math.max(64, Math.min(resolvedWidth * ratio, 240))}px`;
}

export function buildMediaFallback(
  kind: MediaFallbackKind,
  source: HTMLElement,
): HTMLElement {
  const el = document.createElement('span');
  el.className = `media-fallback mf-${kind}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', KIND_TEXT[kind] || '表情不可用');
  applySize(el, source, kind);

  const icon = document.createElement('span');
  icon.className = 'mf-icon';
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KIND_ICON[kind]}</svg>`;
  el.appendChild(icon);

  const text = KIND_TEXT[kind];
  if (text) {
    const label = document.createElement('span');
    label.className = 'mf-text';
    label.textContent = text;
    el.appendChild(label);
  }
  return el;
}

export function replaceMediaWithFallback(
  source: HTMLElement,
  kind: MediaFallbackKind,
): void {
  if (!source.isConnected || source.classList.contains('media-fallback')) return;
  const bubble = source.closest('.video-bubble, .voice-bubble');
  bubble?.classList.add('media-broken');
  const fallback = buildMediaFallback(kind, source);
  if (kind === 'audio' && bubble instanceof HTMLElement) {
    bubble.replaceWith(fallback);
  } else {
    source.replaceWith(fallback);
  }
}

function replaceBrokenMedia(target: EventTarget | null): void {
  if (target instanceof HTMLVideoElement && target.matches('.video-bubble video.img')) {
    replaceMediaWithFallback(target, 'video');
    return;
  }
  if (!(target instanceof HTMLImageElement)) return;
  if (target.matches('.sticker-wrap img.sticker')) {
    replaceMediaWithFallback(target, 'sticker');
  } else if (target.matches('.image-content img')) {
    replaceMediaWithFallback(target, 'image');
  } else if (target.matches('img.reply-content-thumb')) {
    replaceMediaWithFallback(target, 'compact');
  }
}

export function installMediaFallback(root: HTMLElement): () => void {
  const onError = (event: Event): void => replaceBrokenMedia(event.target);
  root.addEventListener('error', onError, true);
  return () => root.removeEventListener('error', onError, true);
}
