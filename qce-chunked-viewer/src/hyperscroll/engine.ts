import { indexToScrollTop, normalizeAnchor, scrollTopToIndex } from './anchor.js';
import { HeightCache } from './height-cache.js';
import type { Anchor, DataSource, EngineDebugStats, HyperScrollOptions, RenderRange } from './types.js';
 
const BASE_STYLE = `
.hs-viewport{position:relative;overflow-y:scroll;overflow-x:hidden;overscroll-behavior:contain;overflow-anchor:none;}
.hs-spacer{width:1px;pointer-events:none;}
.hs-layer{position:sticky;top:0;left:0;height:0;overflow:visible;}
.hs-list{will-change:transform;}
.hs-item{content-visibility:auto;}
`;
 
let styleInjected = false;
function injectBaseStyle(doc: Document): void {
  if (styleInjected) return;
  const el = doc.createElement('style');
  el.dataset.hyperscroll = '';
  el.textContent = BASE_STYLE;
  doc.head.appendChild(el);
  styleInjected = true;
}
 
/**
 * Anchor-driven virtualization engine.
 *
 * Architecture:
 * - Position model is an {@link Anchor} (item index + pixel offset), never a
 *   real scroll offset — so total content height is unbounded.
 * - A fixed-height spacer provides a native scrollbar; the thumb maps
 *   linearly to index space (coarse path). Wheel/touch/keyboard adjust the
 *   anchor in pixels (precise path).
 * - The render window (~upCount above + overscanPx below) is rebuilt as one
 *   innerHTML write — no per-node diffing — and translated so the anchor item
 *   sits `offset` px above the viewport top.
 * - `content-visibility:auto` on items delegates offscreen layout/paint
 *   culling to the browser's native (C++) implementation.
 */
export class HyperScroll {
  private readonly viewport: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly list: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly opts: Required<Pick<HyperScrollOptions, 'upCount' | 'overscanPx' | 'scrollbarHeight' | 'estimatedItemHeight' | 'keyboard' | 'smoothWheel'>> & HyperScrollOptions;
  private readonly heights: HeightCache;
 
  private anchor: Anchor = { index: 0, offset: 0 };
  private range: RenderRange = { start: 0, end: 0 };
  private lastRebuildMs = 0;
  private ignoreScroll = false;
  private lastSetScrollTop = -1;
  private smoothRemainder = 0;
  private smoothVel = 0;
  private smoothRunning = false;
  private smoothLastTs = 0;
  private framePending = false;
  private smoothTau = 110;
  private touchY: number | null = null;
  private touchVel = 0;
  private touchLastT = 0;
  private destroyed = false;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly abort = new AbortController();
 
  constructor(container: HTMLElement, options: HyperScrollOptions) {
    this.opts = {
      upCount: 40,
      overscanPx: 2000,
      scrollbarHeight: 3_000_000,
      estimatedItemHeight: 60,
      keyboard: false,
      smoothWheel: true,
      ...options,
    };
    this.heights = new HeightCache(this.opts.estimatedItemHeight);
 
    const doc = container.ownerDocument;
    injectBaseStyle(doc);
    container.classList.add('hs-viewport');
    this.viewport = container;
    this.layer = doc.createElement('div');
    this.layer.className = 'hs-layer';
    this.list = doc.createElement('div');
    this.list.className = 'hs-list';
    this.spacer = doc.createElement('div');
    this.spacer.className = 'hs-spacer';
    this.spacer.style.height = `${this.opts.scrollbarHeight}px`;
    this.layer.appendChild(this.list);
    container.appendChild(this.layer);
    container.appendChild(this.spacer);
 
    const signal = this.abort.signal;
    container.addEventListener('wheel', this.onWheel, { passive: false, signal });
    container.addEventListener('scroll', this.onScroll, { passive: true, signal });
    container.addEventListener('touchstart', this.onTouchStart, { passive: true, signal });
    container.addEventListener('touchmove', this.onTouchMove, { passive: false, signal });
    container.addEventListener('touchend', this.onTouchEnd, { passive: true, signal });
    if (this.opts.keyboard) {
      doc.defaultView?.addEventListener('keydown', this.onKeyDown, { signal });
    }
    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.rebuild());
    this.resizeObserver?.observe(container);
 
    this.rebuild();
  }
 
  /** Jump so that item `index` is at the viewport top (+`offset` px). */
  scrollToIndex(index: number, offset = 0): void {
    const count = this.opts.dataSource.count;
    // Drop any in-flight wheel momentum: letting it keep draining after a
    // jump drags the viewport away from the target.
    this.smoothRemainder = 0;
    this.smoothVel = 0;
    this.anchor = { index: Math.min(Math.max(index, 0), Math.max(count - 1, 0)), offset };
    this.rebuild();
  }
 
  /** Scroll by a pixel delta along the precise (anchor) path. */
  scrollBy(px: number): void {
    this.anchor = { ...this.anchor, offset: this.anchor.offset + px };
    this.scheduleFrame();
  }
 
  /** Re-render in place (e.g. after the data source contents change). */
  refresh(): void {
    this.rebuild();
  }
 
  /**
   * Swap the data source (e.g. toggling between the full set and a filtered
   * view). Resets the anchor to the top of the new source.
   */
  setDataSource(source: DataSource): void {
    this.opts.dataSource = source;
    this.anchor = { index: 0, offset: 0 };
    this.smoothRemainder = 0;
    this.smoothVel = 0;
    this.rebuild();
  }
 
  getStats(): EngineDebugStats {
    return {
      anchor: { ...this.anchor },
      range: { ...this.range },
      renderedCount: this.list.children.length,
      lastRebuildMs: this.lastRebuildMs,
    };
  }
 
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.layer.remove();
    this.spacer.remove();
    this.viewport.classList.remove('hs-viewport');
  }
 
  // ------------------------------------------------------------------ input
 
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
    if (this.opts.smoothWheel) {
      this.smoothTau = 110;
      this.smoothRemainder += px;
      this.startSmoothLoop();
    } else {
      this.anchor = { ...this.anchor, offset: this.anchor.offset + px };
      this.scheduleFrame();
    }
  };
 
  /**
   * Smooths accumulated wheel deltas over frames. Wheel events arrive far
   * apart (~50ms) relative to frames (~16ms), so the outstanding distance is
   * drained with a time-based exponential decay: each frame consumes
   * `1 - e^(-dt/τ)` of the remainder. Speed is proportional to the remaining
   * distance — continuous, monotone, with no stop-go between events — and the
   * final position lands exactly on the accumulated total.
   */
  private startSmoothLoop(): void {
    if (this.smoothRunning || this.destroyed) return;
    this.smoothRunning = true;
    this.smoothLastTs = 0;
    const tick = (now: number): void => {
      if (this.destroyed) {
        this.smoothRunning = false;
        return;
      }
      const dt = this.smoothLastTs > 0 ? Math.min(now - this.smoothLastTs, 64) : 16;
      this.smoothLastTs = now;
      const remainder = this.smoothRemainder;
      if (Math.abs(remainder) < 0.5) {
        // settle on an integer pixel so text is never subpixel-rendered
        this.smoothRemainder = 0;
        this.smoothVel = 0;
        this.anchor = { ...this.anchor, offset: Math.round(this.anchor.offset + remainder) };
        this.position();
        this.smoothRunning = false;
        return;
      }
      const step = remainder * (1 - Math.exp(-dt / this.smoothTau));
      this.smoothRemainder -= step;
      this.anchor = { ...this.anchor, offset: this.anchor.offset + step };
      this.position();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
 
  private readonly onScroll = (): void => {
    if (this.ignoreScroll) return;
    const scrollTop = this.viewport.scrollTop;
    // Echo of our own scrollbar sync (scroll events fire async) — the thumb
    // resolution is coarse (1px may span many items), so treating an echo as
    // a user drag would teleport the anchor. Ignore near-identical positions.
    if (this.lastSetScrollTop >= 0 && Math.abs(scrollTop - this.lastSetScrollTop) < 3) return;
    const count = this.opts.dataSource.count;
    const max = this.opts.scrollbarHeight - this.viewport.clientHeight;
    const idx = scrollTopToIndex(scrollTop, max, count);
    const itemsPerPx = max > 0 ? count / max : 0;
    if (Math.abs(idx - this.anchor.index) > Math.max(2, itemsPerPx * 3)) {
      this.smoothRemainder = 0;
      this.smoothVel = 0;
      this.anchor = { index: idx, offset: 0 };
      this.rebuild();
    }
  };
 
  private readonly onTouchStart = (e: TouchEvent): void => {
    this.touchY = e.touches[0]?.clientY ?? null;
    this.touchVel = 0;
    this.touchLastT = e.timeStamp;
    // A touch on a moving list stops the fling, native-style.
    this.smoothRemainder = 0;
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    const y = e.touches[0]?.clientY;
    if (this.touchY === null || y === undefined) return;
    e.preventDefault();
    const delta = this.touchY - y;
    const dt = Math.max(e.timeStamp - this.touchLastT, 1);
    // Blend recent velocity so the release fling reflects the last ~50ms of
    // finger motion rather than a single noisy event.
    this.touchVel = 0.8 * (delta / dt) + 0.2 * this.touchVel;
    this.touchLastT = e.timeStamp;
    this.anchor = { ...this.anchor, offset: this.anchor.offset + delta };
    this.touchY = y;
    this.scheduleFrame();
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    this.touchY = null;
    const v = this.touchVel; // px/ms at release
    this.touchVel = 0;
    // Stale sample: the finger paused before lifting, so no fling.
    if (Math.abs(v) < 0.15 || e.timeStamp - this.touchLastT > 80) return;
    // Exponential-decay fling: total distance v·τ, initial speed exactly v.
    const FLING_TAU_MS = 325;
    this.smoothTau = FLING_TAU_MS;
    this.smoothRemainder = v * FLING_TAU_MS;
    this.startSmoothLoop();
  };
 
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const vh = this.viewport.clientHeight;
    const count = this.opts.dataSource.count;
    switch (e.key) {
      case 'PageDown': this.scrollBy(vh * 0.9); break;
      case 'PageUp': this.scrollBy(-vh * 0.9); break;
      case 'ArrowDown': this.scrollBy(60); break;
      case 'ArrowUp': this.scrollBy(-60); break;
      case 'Home': this.scrollToIndex(0); break;
      case 'End': this.scrollToIndex(count - 1); break;
      default: return;
    }
    e.preventDefault();
  };
 
  // ------------------------------------------------------------- rendering
 
  private scheduleFrame(): void {
    if (this.framePending || this.destroyed) return;
    this.framePending = true;
    requestAnimationFrame(() => {
      this.framePending = false;
      if (!this.destroyed) this.position();
    });
  }
 
  private heightAt = (index: number): number => {
    const el = this.list.children[index - this.range.start] as HTMLElement | undefined;
    if (el) {
      const h = el.offsetHeight;
      if (h > 0) {
        this.heights.set(index, h);
        return h;
      }
    }
    return this.opts.dataSource.estimateHeight?.(index) ?? this.heights.get(index);
  };
 
  private rebuild(): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    const src = this.opts.dataSource;
    const count = src.count;
    this.anchor = normalizeAnchorIndexOnly(this.anchor, count);
 
    const start = Math.max(0, this.anchor.index - this.opts.upCount);
    let end = Math.min(count, this.anchor.index + 60);
    let html = '';
    for (let i = start; i < end; i++) html += src.renderToString(i);
    this.list.innerHTML = html;
    this.range = { start, end };
 
    // Extend downward until the window covers viewport + overscan. Heights
    // are unknowable pre-layout, so this measures real DOM incrementally.
    const vh = this.viewport.clientHeight;
    for (let guard = 0; guard < 24; guard++) {
      const anchorEl = this.list.children[this.anchor.index - start] as HTMLElement | undefined;
      const below = this.list.offsetHeight - (anchorEl?.offsetTop ?? 0);
      if (below >= vh + this.opts.overscanPx || end >= count) break;
      const next = Math.min(count, end + 40);
      let extra = '';
      for (let i = end; i < next; i++) extra += src.renderToString(i);
      this.list.insertAdjacentHTML('beforeend', extra);
      end = next;
      this.range = { start, end };
    }
 
    // Force exact layout on the anchor and everything above it: offscreen
    // `content-visibility:auto` items only report their intrinsic-size
    // estimate, which would corrupt the anchor's offsetTop (and thus the
    // translate) until they happen to get painted.
    {
      const children = this.list.children;
      const upTo = Math.min(this.anchor.index - start, children.length - 1);
      for (let i = 0; i <= upTo; i++) {
        (children[i] as HTMLElement).style.contentVisibility = 'visible';
      }
    }

    // When the window reaches the data end, force exact layout on the tail
    // stretch: offscreen `content-visibility:auto` items only report their
    // intrinsic-size estimate, which would corrupt the bottom clamp.
    if (end >= count) {
      const children = this.list.children;
      const from = Math.max(0, children.length - 60);
      for (let i = from; i < children.length; i++) {
        (children[i] as HTMLElement).style.contentVisibility = 'visible';
      }
    }
 
    this.lastRebuildMs = performance.now() - t0;
    this.opts.onRangeChange?.({ ...this.range }, this.lastRebuildMs);
    this.position();
  }
 
  /** Append a batch below and prune far-above items — no full rebuild. */
  private extendDown(): void {
    const t0 = performance.now();
    const src = this.opts.dataSource;
    const count = src.count;
    const next = Math.min(count, this.range.end + 40);
    if (next > this.range.end) {
      let html = '';
      for (let i = this.range.end; i < next; i++) html += src.renderToString(i);
      this.list.insertAdjacentHTML('beforeend', html);
      this.range = { start: this.range.start, end: next };
    }
    if (next >= count) {
      // Tail stretch needs exact layout for the bottom clamp (see rebuild).
      const children = this.list.children;
      const from = Math.max(0, children.length - 60);
      for (let i = from; i < children.length; i++) {
        (children[i] as HTMLElement).style.contentVisibility = 'visible';
      }
    }
    const keepFrom = Math.max(0, this.anchor.index - this.opts.upCount);
    while (this.range.start < keepFrom && this.list.firstElementChild) {
      this.list.firstElementChild.remove();
      this.range = { start: this.range.start + 1, end: this.range.end };
    }
    this.lastRebuildMs = performance.now() - t0;
    this.opts.onRangeChange?.({ ...this.range }, this.lastRebuildMs);
  }

  /** Prepend a batch above and prune far-below items — no full rebuild. */
  private extendUp(): void {
    const t0 = performance.now();
    const src = this.opts.dataSource;
    const prevStart = this.range.start;
    const from = Math.max(0, prevStart - 40);
    if (from < prevStart) {
      let html = '';
      for (let i = from; i < prevStart; i++) html += src.renderToString(i);
      this.list.insertAdjacentHTML('afterbegin', html);
      this.range = { start: from, end: this.range.end };
      // Everything above the anchor must have exact layout (see rebuild).
      const children = this.list.children;
      for (let i = 0; i < prevStart - from; i++) {
        (children[i] as HTMLElement).style.contentVisibility = 'visible';
      }
    }
    // Keep the below-anchor stretch bounded; ~150 items comfortably covers
    // viewport + overscan at any realistic item height.
    while (this.range.end - this.anchor.index > 150 && this.list.lastElementChild) {
      this.list.lastElementChild.remove();
      this.range = { start: this.range.start, end: this.range.end - 1 };
    }
    this.lastRebuildMs = performance.now() - t0;
    this.opts.onRangeChange?.({ ...this.range }, this.lastRebuildMs);
  }

  private position(): void {
    if (this.destroyed) return;
    const count = this.opts.dataSource.count;
    if (count === 0) {
      this.anchor = { index: 0, offset: 0 };
      this.list.style.transform = '';
      return;
    }
    const before = this.anchor;
    const normalized = normalizeAnchor(before, count, this.heightAt);
    this.anchor = normalized;
 
    // Outside the window entirely (scrollbar drag, jump): rebuild around the
    // new anchor. Merely near an edge during continuous scrolling is handled
    // incrementally — appending/pruning a batch instead of tearing the whole
    // window down, so no full innerHTML write happens mid-scroll.
    const margin = 12;
    if (normalized.index >= this.range.end || normalized.index < this.range.start) {
      this.rebuild();
      return;
    }
    if (normalized.index >= this.range.end - margin && this.range.end < count) {
      this.extendDown();
    }
    if (this.range.start > 0 && normalized.index < this.range.start + margin) {
      this.extendUp();
    }
 
    const anchorEl = this.list.children[normalized.index - this.range.start] as HTMLElement | undefined;
    if (!anchorEl) {
      this.rebuild();
      return;
    }
    let translate = anchorEl.offsetTop + normalized.offset;
 
    // Bottom clamp: when the window reaches the end of the data, the viewport
    // must never scroll past "last item's bottom == viewport bottom".
    if (this.range.end >= count) {
      const maxTranslate = Math.max(0, this.list.offsetHeight - this.viewport.clientHeight);
      if (translate > maxTranslate) {
        translate = maxTranslate;
        this.smoothRemainder = 0;
        this.smoothVel = 0;
        let idx = normalized.index;
        let el = anchorEl;
        while (idx > this.range.start && el.offsetTop > maxTranslate) {
          idx -= 1;
          el = this.list.children[idx - this.range.start] as HTMLElement;
        }
        this.anchor = { index: idx, offset: maxTranslate - el.offsetTop };
      }
    }
    // integer device pixels: fractional translate makes text blurry
    this.list.style.transform = `translateY(${-Math.round(translate)}px)`;
    this.syncScrollbar();
    this.opts.onAnchorChange?.({ ...this.anchor });
  }
 
  private syncScrollbar(): void {
    const count = this.opts.dataSource.count;
    const max = this.opts.scrollbarHeight - this.viewport.clientHeight;
    const target = indexToScrollTop(this.anchor.index, max, count);
    this.lastSetScrollTop = target;
    if (Math.abs(this.viewport.scrollTop - target) >= 1) {
      this.ignoreScroll = true;
      this.viewport.scrollTop = target;
      requestAnimationFrame(() => {
        this.ignoreScroll = false;
      });
    }
  }
}
 
function normalizeAnchorIndexOnly(anchor: Anchor, count: number): Anchor {
  if (count <= 0) return { index: 0, offset: 0 };
  if (anchor.index < 0) return { index: 0, offset: 0 };
  if (anchor.index >= count) return { index: count - 1, offset: 0 };
  return anchor;
}
