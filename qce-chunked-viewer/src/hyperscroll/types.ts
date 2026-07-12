/**
 * A data source for the engine. The engine never holds item objects in
 * memory — it asks the source to produce the HTML for an index on demand.
 * Implementations may generate content, read from sharded JSON, or stream
 * from IndexedDB with a cursor.
 */
export interface DataSource {
  /** Total number of items. May be arbitrarily large (10^8+). */
  readonly count: number;
  /**
   * Return the outer HTML string for the item at `index`.
   * Must produce exactly one root element. Called only for items entering
   * the render window (~100 at a time), so it may be moderately expensive.
   */
  renderToString(index: number): string;
  /** Optional lightweight HTML used while seeking with the native scrollbar. */
  renderSeekToString?(index: number): string;
  /** Optional pre-measure height estimate in px, used before first render. */
  estimateHeight?(index: number): number;
}
 
/**
 * The engine's positional model: the item at the top of the viewport plus
 * the number of pixels the viewport has scrolled past its top edge.
 * Content placement never depends on a real DOM scroll offset, which is what
 * lets the engine bypass the browser's ~33.5M px max scroll height.
 */
export interface Anchor {
  index: number;
  /** Pixels scrolled past the top of item `index`. May be temporarily out of range before normalization. */
  offset: number;
}
 
/** Currently materialized window of items: [start, end). */
export interface RenderRange {
  start: number;
  end: number;
}
 
export interface HyperScrollOptions {
  dataSource: DataSource;
  /** Items rendered above the anchor. Default 40. */
  upCount?: number;
  /** Minimum pixels rendered below the viewport bottom. Default 2000. */
  overscanPx?: number;
  /** Virtual scrollbar track height in px (must stay far below browser limits). Default 3e6. */
  scrollbarHeight?: number;
  /** Fallback item height estimate in px before any measurement. Default 60. */
  estimatedItemHeight?: number;
  /** Attach PageUp/PageDown/Home/End/Arrow key handling to the window. Default false. */
  keyboard?: boolean;
  /** Ease wheel deltas over frames instead of applying them instantly. Default true. */
  smoothWheel?: boolean;
  /** Fired after every anchor movement (wheel, drag, jump, ...). */
  onAnchorChange?(anchor: Readonly<Anchor>): void;
  /** Fired whenever the materialized window is rebuilt. */
  onRangeChange?(range: Readonly<RenderRange>, rebuildMs: number): void;
}
 
export interface EngineDebugStats {
  anchor: Anchor;
  range: RenderRange;
  renderedCount: number;
  lastRebuildMs: number;
}
