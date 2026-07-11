import { useEffect, useRef, useState } from 'react';
import type { DataSource } from './hyperscroll';
import { FilteredDataSource, HyperScroll } from './hyperscroll';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImageIcon,
  LayersIcon,
  MapPinIcon,
  MicIcon,
  MoonIcon,
  MoveRightIcon,
  PanelLeftIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  Share2Icon,
  SmileIcon,
  SunIcon,
  TypeIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Loader } from '@/components/ui/loader';
import { MediaPreview, downloadUrl, type MediaItem } from '@/components/ui/media-preview';
import { ChunkStore, loadManifest, type QceManifest } from './qce/chunk-store';

const QCE_REPO = 'https://github.com/shuakami/qq-chat-exporter';
const HS_REPO = 'https://github.com/shuakami/hyperscroll';

type IconComponent = React.ComponentType<{ className?: string }>;

const KIND_OPTIONS: ReadonlyArray<readonly [string, string, IconComponent]> = [
  ['text', '文本', TypeIcon],
  ['img', '图片', ImageIcon],
  ['sticker', '表情', SmileIcon],
  ['voice', '语音', MicIcon],
  ['video', '视频', VideoIcon],
  ['file', '文件', FileIcon],
  ['reply', '回复', ReplyIcon],
  ['forward', '转发', Share2Icon],
  ['location', '位置', MapPinIcon],
];

interface QceSettings {
  rememberScroll: boolean;
  prefetchChunks: boolean;
}

const DEFAULT_SETTINGS: QceSettings = { rememberScroll: false, prefetchChunks: false };

function loadSettings(): QceSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('qce-settings') ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Filters {
  sender: string;
  kind: string;
  startMs: number;
  endMs: number;
}

const NO_FILTERS: Filters = { sender: '', kind: '', startMs: 0, endMs: 0 };

function hasFilters(f: Filters): boolean {
  return Boolean(f.sender || f.kind || f.startMs || f.endMs);
}

function GithubMark({ className }: { className?: string }): React.ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// Highlights matches inside the message bubble only, never in sender names or
// other chrome, and never inside tags/attributes.
function highlightHtml(html: string, q: string): string {
  const at = html.indexOf('class="message-bubble');
  if (at === -1) return html;
  const open = html.indexOf('>', at);
  if (open === -1) return html;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let out = html.slice(0, open + 1);
  let i = open + 1;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const text = lt === -1 ? html.slice(i) : html.slice(i, lt);
    out += text.replace(re, (m) => `<mark class="hl">${m}</mark>`);
    if (lt === -1) break;
    const gt = html.indexOf('>', lt);
    out += html.slice(lt, gt === -1 ? html.length : gt + 1);
    i = gt === -1 ? html.length : gt + 1;
  }
  return out;
}

function skeletonHtml(i: number): string {
  return (
    `<div class="hs-item" data-i="${i}"><div class="skel-row">` +
    `<span class="skel skel-avatar"></span>` +
    `<div class="skel-body"><span class="skel skel-name"></span>` +
    `<span class="skel skel-bubble" style="width:${180 + ((i * 97) % 260)}px"></span></div>` +
    `</div></div>`
  );
}

function rowHtml(i: number, inner: string): string {
  return `<div class="hs-item" data-i="${i}">${inner}</div>`;
}

/**
 * Estimates a row's rendered height from its content so the virtual scroller
 * places offscreen rows close to their real size — this is what keeps big
 * jumps from thrashing. Undefined (not-yet-loaded) rows fall back to a
 * neutral guess matching the skeleton.
 */
function estimateRowHeight(rec: { html: string; text?: string } | null | undefined): number {
  if (!rec) return 96;
  const h = rec.html;
  if (h.includes('image-content') || h.includes('video-bubble')) return 300;
  if (h.includes('sticker-wrap')) return 176;
  if (h.includes('message-file')) return 92;
  if (h.includes('voice-bubble')) return 88;
  const len = (rec.text ?? '').length;
  const lines = Math.max(1, Math.ceil(len / 34));
  return 64 + Math.min(lines - 1, 12) * 22;
}

const AVATAR_HUES = [14, 44, 96, 152, 200, 232, 262, 312, 348];

function SenderDot({ name, avatar }: { name: string; avatar?: string }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  if (avatar && !failed) {
    return (
      <img
        src={avatar}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-4 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: `hsl(${hue} 55% 55%)` }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function fmtDate(key: string | undefined): string {
  if (!key) return '--';
  return new Date(`${key}T00:00:00`).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface SearchState {
  matches: number[];
  cursor: number;
  running: boolean;
  chunksScanned: number;
  chunksSkipped: number;
  cancelled: boolean;
}

declare global {
  interface Window {
    showImageModal?: (src: string) => void;
    hideImageModal?: () => void;
    scrollToMessage?: (msgId: string) => void;
  }
}

function fnv1a32(str: string, seed: number): number {
  let h = seed >>> 0 || 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export default function Viewer(): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HyperScroll | null>(null);
  const storeRef = useRef<ChunkStore | null>(null);
  const highlightRef = useRef('');
  const filterSourceRef = useRef<FilteredDataSource | null>(null);
  const searchRef = useRef<SearchState | null>(null);
  const filterRunRef = useRef(0);
  const voiceAudioRef = useRef<HTMLAudioElement>(
    typeof Audio !== 'undefined' ? new Audio() : ({} as HTMLAudioElement),
  );
  const playingVoiceRef = useRef<HTMLElement | null>(null);
  const playingSrcRef = useRef('');

  const [manifest, setManifest] = useState<QceManifest | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const filtersRef = useRef<Filters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [canNav, setCanNav] = useState(false);
  const [canClear, setCanClear] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadedChunks, setLoadedChunks] = useState(0);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<QceSettings>(loadSettings);
  const settingsRef = useRef(settings);
  const [dark, setDark] = useState(
    () =>
      document.documentElement.classList.contains('dark') ||
      (localStorage.getItem('qce-theme') === null &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) ||
      localStorage.getItem('qce-theme') === 'dark',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    // MODERN_CSS (assets/style.css) themes the message layer via data-theme.
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('qce-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem('qce-settings', JSON.stringify(settings));
  }, [settings]);

  // Exported message HTML calls these globals (image onclick / reply jump).
  useEffect(() => {
    window.showImageModal = (src: string) => {
      const name = src.startsWith('data:')
        ? '图片'
        : decodeURIComponent(src.split('/').pop()?.split('?')[0] || '图片');
      setPreview({ type: 'image', src, name, thumb: src });
    };
    window.hideImageModal = () => setPreview(null);
    window.scrollToMessage = (msgId: string) => {
      void jumpToMessageId(msgId);
    };
    return () => {
      delete window.showImageModal;
      delete window.hideImageModal;
      delete window.scrollToMessage;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rich-media clicks inside the exported message HTML: voice playback,
  // video preview, and voice download. Delegated from the viewport container.
  function onViewportClick(e: React.MouseEvent): void {
    const target = e.target as HTMLElement;

    const voice = target.closest('.voice-bubble');
    if (voice instanceof HTMLElement) {
      const src = voice.getAttribute('data-src') ?? '';
      if (target.closest('.vdl')) {
        e.preventDefault();
        if (src) void downloadUrl(src, voice.getAttribute('data-name') || 'voice');
        return;
      }
      toggleVoice(voice, src);
      return;
    }

    const video = target.closest('.video-bubble');
    if (video instanceof HTMLElement) {
      const src = video.getAttribute('data-src') ?? '';
      if (src) setPreview({ type: 'video', src, name: video.getAttribute('data-name') || '视频' });
      return;
    }
  }

  function toggleVoice(el: HTMLElement, src: string): void {
    if (!src) return;
    const audio = voiceAudioRef.current;
    const prev = playingVoiceRef.current;
    if (prev && prev !== el) prev.classList.remove('playing');
    if (playingSrcRef.current === src && !audio.paused) {
      audio.pause();
      el.classList.remove('playing');
      playingVoiceRef.current = null;
      return;
    }
    if (playingSrcRef.current !== src) {
      audio.src = src;
      playingSrcRef.current = src;
    }
    audio.onended = () => {
      el.classList.remove('playing');
      playingVoiceRef.current = null;
    };
    void audio.play().then(() => {
      el.classList.add('playing');
      playingVoiceRef.current = el;
    }).catch(() => {
      el.classList.remove('playing');
    });
  }

  async function jumpToMessageId(msgId: string): Promise<void> {
    const store = storeRef.current;
    const engine = engineRef.current;
    if (!store || !engine) return;
    const idx = manifestRef.current?.msgidIndex;
    if (!idx?.bucketCount) return;
    const bucket = fnv1a32(String(msgId), 0x811c9dc5) % idx.bucketCount;
    const chunkId = await store.msgIdToChunkId(msgId, bucket);
    if (!chunkId) return;
    const c = store.manifest.chunks.findIndex((m) => m.id === chunkId);
    if (c < 0) return;
    const records = await store.load(c);
    const k = records.findIndex((r) => r.id === msgId);
    if (k < 0) return;
    const globalIdx = store.chunkStarts[c]! + k;
    const filterSource = filterSourceRef.current;
    if (filterSource) {
      const p = filterSource.indexOf(globalIdx);
      if (p >= 0) engine.scrollToIndex(p, -80);
    } else {
      engine.scrollToIndex(globalIdx, -80);
    }
    window.setTimeout(() => {
      const el = document.getElementById(msgId);
      if (!el) return;
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(0, 122, 255, 0.1)';
      window.setTimeout(() => {
        el.style.background = '';
        window.setTimeout(() => {
          el.style.transition = '';
        }, 300);
      }, 1000);
    }, 350);
  }

  const manifestRef = useRef<QceManifest | null>(null);

  function withHighlight(src: DataSource): DataSource {
    return {
      get count() {
        return src.count;
      },
      renderToString: (i) =>
        highlightRef.current
          ? highlightHtml(src.renderToString(i), highlightRef.current)
          : src.renderToString(i),
      estimateHeight: src.estimateHeight?.bind(src),
    };
  }

  useEffect(() => {
    let disposed = false;
    void loadManifest('.').then((m) => {
      if (disposed) return;
      manifestRef.current = m;
      setManifest(m);
      if (m.chat?.name) document.title = `聊天记录 - ${m.chat.name}`;
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!manifest) return;
    const el = viewportRef.current;
    if (!el) return;
    const store = new ChunkStore('.', manifest);
    storeRef.current = store;
    const engine = new HyperScroll(el, {
      dataSource: withHighlight(fullSourceOf(store)),
      keyboard: true,
    });
    engineRef.current = engine;
    let refreshQueued = false;
    store.onChunkLoaded = () => {
      setLoadedChunks(store.loadedChunkCount());
      if (refreshQueued) return;
      refreshQueued = true;
      requestAnimationFrame(() => {
        refreshQueued = false;
        engine.refresh();
      });
    };

    if (settingsRef.current.rememberScroll) {
      const saved = Number(localStorage.getItem('qce-scroll') ?? -1);
      if (saved > 0 && saved < manifest.stats.totalMessages) engine.scrollToIndex(saved);
    }
    const settingsTimer = window.setInterval(() => {
      const s = settingsRef.current;
      if (filterSourceRef.current) return;
      const a = engine.getStats().anchor;
      if (s.rememberScroll) localStorage.setItem('qce-scroll', String(a.index));
      if (s.prefetchChunks) {
        const c = store.chunkOf(a.index);
        if (c + 1 < store.manifest.chunks.length && !store.isLoaded(c + 1)) void store.load(c + 1);
        if (c > 0 && !store.isLoaded(c - 1)) void store.load(c - 1);
      }
    }, 800);

    return () => {
      window.clearInterval(settingsTimer);
      if (searchRef.current) searchRef.current.cancelled = true;
      engine.destroy();
      engineRef.current = null;
      storeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  function fullSourceOf(store: ChunkStore): DataSource {
    return {
      count: store.manifest.stats.totalMessages,
      renderToString(i) {
        const rec = store.get(i);
        return rec ? rowHtml(i, rec.html) : skeletonHtml(i);
      },
      estimateHeight: (i) => estimateRowHeight(store.get(i)),
    };
  }

  function resetSearch(): void {
    if (searchRef.current) searchRef.current.cancelled = true;
    searchRef.current = null;
    setSearching(false);
    setSearchStatus('');
    setCanNav(false);
    setCanClear(false);
    if (highlightRef.current) {
      highlightRef.current = '';
      engineRef.current?.refresh();
    }
  }

  function applyFilters(next: Filters): void {
    const engine = engineRef.current;
    const store = storeRef.current;
    if (!engine || !store) return;
    const run = ++filterRunRef.current;
    resetSearch();
    filtersRef.current = next;
    setFilters(next);
    if (!hasFilters(next)) {
      filterSourceRef.current = null;
      setFilterStatus('');
      engine.setDataSource(withHighlight(fullSourceOf(store)));
      return;
    }
    const src = new FilteredDataSource(fullSourceOf(store));
    filterSourceRef.current = src;
    engine.setDataSource(withHighlight(src));
    setFilterStatus('筛选中…');
    void (async () => {
      let skipped = 0;
      for (let c = 0; c < store.manifest.chunks.length; c++) {
        if (filterRunRef.current !== run) return;
        const meta = store.manifest.chunks[c]!;
        const outsideRange =
          (next.endMs > 0 && meta.startTs > next.endMs) ||
          (next.startMs > 0 && meta.endTs < next.startMs);
        if (outsideRange || (next.sender && !store.senderMayContain(c, next.sender))) {
          skipped += 1;
          continue;
        }
        const records = await store.load(c);
        if (filterRunRef.current !== run) return;
        const base = store.chunkStarts[c]!;
        const batch: number[] = [];
        for (let k = 0; k < records.length; k++) {
          const r = records[k]!;
          if (next.sender && r.uid !== next.sender) continue;
          if (next.kind && r.kind !== next.kind) continue;
          if (next.startMs > 0 && r.ts < next.startMs) continue;
          if (next.endMs > 0 && r.ts > next.endMs) continue;
          batch.push(base + k);
        }
        if (batch.length > 0) src.append(batch);
        engine.refresh();
        setFilterStatus(
          `${src.count.toLocaleString()} 条结果，已扫描 ${Math.round(((c + 1) / store.manifest.chunks.length) * 100)}%`,
        );
      }
      if (filterRunRef.current !== run) return;
      engine.refresh();
      setFilterStatus(`${src.count.toLocaleString()} 条结果，跳过 ${skipped} 个分块`);
    })();
  }

  function jumpToMatch(pos: number): void {
    const s = searchRef.current;
    const engine = engineRef.current;
    if (!s || !engine) return;
    const n = s.matches.length;
    if (n === 0) return;
    s.cursor = ((pos % n) + n) % n;
    const srcIdx = s.matches[s.cursor]!;
    setSearchStatus(
      `第 ${(s.cursor + 1).toLocaleString()} / ${n.toLocaleString()} 条${s.running ? '，搜索中…' : ''}`,
    );
    const filterSource = filterSourceRef.current;
    if (filterSource) {
      const p = filterSource.indexOf(srcIdx);
      if (p >= 0) engine.scrollToIndex(p, -8);
    } else {
      engine.scrollToIndex(srcIdx, -8);
    }
  }

  function runSearch(): void {
    const engine = engineRef.current;
    const store = storeRef.current;
    if (!engine || !store) return;
    const q = query.trim().toLowerCase();
    resetSearch();
    if (!q) return;
    setCanClear(true);
    setSearching(true);
    highlightRef.current = q;
    engine.refresh();
    const s: SearchState = {
      matches: [],
      cursor: -1,
      running: true,
      chunksScanned: 0,
      chunksSkipped: 0,
      cancelled: false,
    };
    searchRef.current = s;
    const f = filtersRef.current;
    const t0 = performance.now();
    void (async () => {
      let firstJump = true;
      for (let c = 0; c < store.manifest.chunks.length; c++) {
        if (s.cancelled) return;
        const meta = store.manifest.chunks[c]!;
        const outsideRange =
          (f.endMs > 0 && meta.startTs > f.endMs) || (f.startMs > 0 && meta.endTs < f.startMs);
        if (outsideRange || !store.textMayContain(c, q)) {
          s.chunksSkipped += 1;
          continue;
        }
        const records = await store.load(c);
        if (s.cancelled) return;
        s.chunksScanned += 1;
        const base = store.chunkStarts[c]!;
        for (let k = 0; k < records.length; k++) {
          const r = records[k]!;
          if (f.sender && r.uid !== f.sender) continue;
          if (f.kind && r.kind !== f.kind) continue;
          if (f.startMs > 0 && r.ts < f.startMs) continue;
          if (f.endMs > 0 && r.ts > f.endMs) continue;
          if (r.text.toLowerCase().includes(q)) s.matches.push(base + k);
        }
        if (s.matches.length > 0 && firstJump) {
          firstJump = false;
          setCanNav(true);
          jumpToMatch(0);
        } else {
          const pos = s.cursor >= 0 ? `第 ${(s.cursor + 1).toLocaleString()} / ` : '';
          setSearchStatus(
            `${pos}${s.matches.length.toLocaleString()} 条匹配，${Math.round(((c + 1) / store.manifest.chunks.length) * 100)}%`,
          );
        }
      }
      if (s.cancelled) return;
      s.running = false;
      setSearching(false);
      const ms = performance.now() - t0;
      if (s.matches.length === 0) {
        setSearchStatus(
          `无匹配，Bloom 跳过 ${s.chunksSkipped} 个分块，${(ms / 1000).toFixed(1)}s`,
        );
      } else {
        jumpToMatch(Math.max(s.cursor, 0));
      }
    })();
  }

  const chat = manifest?.chat;
  const stats = manifest?.stats;
  const senderEntry = manifest?.senders.find((s) => s.uid === filters.sender);
  const senderName = senderEntry?.displayName;

  return (
    <div className="relative flex h-dvh bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col overflow-y-auto bg-background px-5 py-6 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="font-semibold text-base tracking-tight">{chat?.name ?? '加载中…'}</div>
          {chat ? (
            <div className="mt-0.5 text-muted-foreground text-xs">
              {chat.type === 'group' ? '群聊' : '私聊'}记录
            </div>
          ) : null}
        </div>

        {manifest && stats ? (
          <>
            <dl className="mt-5 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">消息数</dt>
                <dd className="font-medium tabular-nums">{stats.totalMessages.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">时间范围</dt>
                <dd className="flex items-center gap-1.5 font-medium">
                  {fmtDate(stats.minDateKey)}
                  <MoveRightIcon className="size-3 text-muted-foreground" />
                  {fmtDate(stats.maxDateKey)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">分块</dt>
                <dd className="font-medium tabular-nums">
                  {manifest.chunks.length} × {manifest.chunking.maxMessagesPerChunk.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">已加载分块</dt>
                <dd className="font-medium tabular-nums">{loadedChunks}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">导出时间</dt>
                <dd className="font-medium">{new Date(manifest.exportTime).toLocaleDateString('zh-CN')}</dd>
              </div>
            </dl>

            <div className="mt-8">
              <div className="font-medium text-muted-foreground text-xs">搜索</div>
              <InputGroup className="mt-2 w-full">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  size="sm"
                  type="search"
                  placeholder="搜索消息"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                />
                {searching ? (
                  <InputGroupAddon align="inline-end">
                    <Loader className="text-muted-foreground" />
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" onClick={runSearch}>
                  搜索
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="上一条"
                  disabled={!canNav}
                  onClick={() => jumpToMatch((searchRef.current?.cursor ?? 0) - 1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下一条"
                  disabled={!canNav}
                  onClick={() => jumpToMatch((searchRef.current?.cursor ?? 0) + 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="清除搜索"
                  disabled={!canClear}
                  onClick={() => {
                    setQuery('');
                    resetSearch();
                  }}
                >
                  <XIcon />
                </Button>
              </div>
              {searchStatus ? (
                <div className="mt-2 text-muted-foreground text-xs">{searchStatus}</div>
              ) : null}
            </div>

            <div className="mt-8">
              <div className="font-medium text-muted-foreground text-xs">筛选</div>
              <Select
                value={filters.sender}
                onValueChange={(v) => applyFilters({ ...filtersRef.current, sender: v ?? '' })}
              >
                <SelectTrigger size="sm" className="mt-2 w-full">
                  <SelectValue>
                    {senderName ? (
                      <span className="flex items-center gap-2">
                        <SenderDot name={senderName} avatar={senderEntry?.avatar ?? undefined} />
                        {senderName}
                      </span>
                    ) : (
                      '全部成员'
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">全部成员</SelectItem>
                  {manifest.senders
                    .filter((sd) => sd.uid && sd.uid !== '未知' && sd.displayName !== '0')
                    .map((sd) => (
                    <SelectItem key={sd.uid} value={sd.uid}>
                      <span className="flex items-center gap-2">
                        <SenderDot name={sd.displayName} avatar={sd.avatar ?? undefined} />
                        <span className="max-w-40 truncate">{sd.displayName}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={filters.kind}
                onValueChange={(v) => applyFilters({ ...filtersRef.current, kind: v ?? '' })}
              >
                <SelectTrigger size="sm" className="mt-2 w-full">
                  <SelectValue>
                    {KIND_OPTIONS.find(([k]) => k === filters.kind)?.[1] ?? '全部类型'}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">
                    <span className="flex items-center gap-2">
                      <LayersIcon className="size-3.5 text-muted-foreground" />
                      全部类型
                    </span>
                  </SelectItem>
                  {KIND_OPTIONS.map(([k, label, Icon]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <Icon className="size-3.5 text-muted-foreground" />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <DateRangePicker
                className="mt-2"
                startTime={dateStart}
                endTime={dateEnd}
                placeholder="全部日期"
                defaultMonth={stats.minDateKey ? new Date(`${stats.minDateKey}T00:00:00`) : undefined}
                onChange={(s, e) => {
                  setDateStart(s);
                  setDateEnd(e);
                  applyFilters({
                    ...filtersRef.current,
                    startMs: s ? new Date(s).getTime() : 0,
                    endMs: e ? new Date(e).getTime() + 59_999 : 0,
                  });
                }}
              />
              {filterStatus ? (
                <div className="mt-2 text-muted-foreground text-xs">{filterStatus}</div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="mt-auto space-y-2 pt-6 text-muted-foreground text-xs">
          <div className="flex items-center justify-between gap-1.5">
            <a
              href={QCE_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <GithubMark className="size-3.5" />
              shuakami/qq-chat-exporter
            </a>
            <span className="flex items-center">
              <button
                type="button"
                aria-label="设置"
                className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
                className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setDark((v) => !v)}
              >
                {dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
              </button>
            </span>
          </div>
          {manifest?.exporter?.version ? (
            <span className="block">exporter {manifest.exporter.version}</span>
          ) : null}
          <a
            href={HS_REPO}
            target="_blank"
            rel="noreferrer"
            className="block hover:text-foreground"
          >
            QCE Viewer powered by <span className="italic">HyperScroll</span>
          </a>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="关闭侧栏"
          className="absolute inset-0 z-20 bg-background/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {/* Main */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 left-2 z-10 md:hidden"
          aria-label="切换侧栏"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <PanelLeftIcon />
        </Button>

        <div className="relative min-h-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent" />
          <div id="viewport" ref={viewportRef} className="qce-viewport h-full" onClick={onViewportClick} />
        </div>
      </div>

      <MediaPreview item={preview} onClose={() => setPreview(null)} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function SettingsToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/60"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'bg-primary' : 'bg-muted-foreground/25'
        }`}
      >
        <span
          className={`size-4 rounded-full bg-background shadow transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}

function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: QceSettings;
  onChange: (s: QceSettings) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let raf2 = 0;
      const raf = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        cancelAnimationFrame(raf);
        cancelAnimationFrame(raf2);
        window.removeEventListener('keydown', onKey);
      };
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/45 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="设置"
        className="w-[380px] max-w-[92vw] rounded-xl border bg-background shadow-xl"
        style={{
          transform: visible ? 'scale(1)' : 'scale(0.86)',
          opacity: visible ? 1 : 0,
          transition: 'transform 520ms cubic-bezier(0.34, 1.36, 0.44, 1), opacity 200ms ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-sm font-medium">设置</span>
          <button
            type="button"
            aria-label="关闭"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <div className="px-5 pt-3 pb-1 text-xs text-muted-foreground">实验性功能</div>
        <div className="flex flex-col divide-y divide-border/60 px-2 pb-3">
          <SettingsToggle
            label="记住滚动位置"
            hint="下次打开时回到上次阅读的位置"
            checked={settings.rememberScroll}
            onChange={(v) => onChange({ ...settings, rememberScroll: v })}
          />
          <SettingsToggle
            label="预加载相邻分块"
            hint="阅读时在后台提前加载附近的消息分块"
            checked={settings.prefetchChunks}
            onChange={(v) => onChange({ ...settings, prefetchChunks: v })}
          />
        </div>
      </div>
    </div>
  );
}
