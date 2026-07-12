import type { DataSource } from './types.js';
 
/**
 * Decides whether the item at `index` matches. Runs inside the scan loop so
 * it must not allocate per call; read fields lazily from your own data layer.
 */
export type MatchPredicate = (index: number) => boolean;
 
function popcount32(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}
 
// bits per rank block: 16 words × 32 bits
const BLOCK_BITS = 512;
const BLOCK_WORDS = BLOCK_BITS >>> 5;
 
/**
 * Succinct match set over a fixed index space [0, capacity): a bitmap
 * (1 bit per candidate) plus a per-512-bit prefix-count directory for O(1)
 * rank and near-O(1) select. Memory is capacity/8 bytes regardless of how
 * many indices match — 30M candidates cost ~4 MB whether there are 100
 * matches or 30M.
 *
 * `push` requires strictly ascending values (the order a streaming scan
 * produces them), which lets the rank directory be maintained incrementally
 * for free.
 */
export class BitsetIndex {
  private readonly words: Uint32Array;
  private readonly prefix: Uint32Array; // matches before block b
  private size = 0;
  private last = -1;
  private curBlock = 0;
 
  constructor(readonly capacity: number) {
    this.words = new Uint32Array((capacity + 31) >>> 5);
    this.prefix = new Uint32Array(((capacity + BLOCK_BITS - 1) / BLOCK_BITS + 1) | 0);
  }
 
  get length(): number {
    return this.size;
  }
 
  push(value: number): void {
    if (value <= this.last || value >= this.capacity) {
      throw new RangeError(`push(${value}): values must be ascending and < capacity`);
    }
    const block = (value / BLOCK_BITS) | 0;
    while (this.curBlock < block) {
      this.curBlock++;
      this.prefix[this.curBlock] = this.size;
    }
    this.words[value >>> 5] = (this.words[value >>> 5] as number) | (1 << (value & 31));
    this.size++;
    this.last = value;
  }
 
  /** Select: the index-space value of the `index`-th match (ascending). */
  at(index: number): number {
    if (index < 0 || index >= this.size) throw new RangeError(`index ${index} out of bounds`);
    // binary search the prefix directory for the block containing match #index
    let lo = 0;
    let hi = this.curBlock;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.prefix[mid] as number) <= index) lo = mid;
      else hi = mid - 1;
    }
    let remaining = index - (this.prefix[lo] as number);
    const wordStart = lo * BLOCK_WORDS;
    for (let w = wordStart; w < this.words.length; w++) {
      const word = this.words[w] as number;
      const c = popcount32(word);
      if (remaining >= c) {
        remaining -= c;
        continue;
      }
      let v = word;
      for (;;) {
        const bit = v & -v;
        if (remaining === 0) return (w << 5) + (31 - Math.clz32(bit));
        v ^= bit;
        remaining--;
      }
    }
    throw new RangeError(`index ${index} out of bounds`);
  }
 
  /** Rank: position of `value` among the matches, or -1 if not a match. */
  indexOf(value: number): number {
    if (value < 0 || value >= this.capacity) return -1;
    const w = value >>> 5;
    if (((this.words[w] as number) & (1 << (value & 31))) === 0) return -1;
    const block = (value / BLOCK_BITS) | 0;
    let rank = this.prefix[block] as number;
    for (let i = block * BLOCK_WORDS; i < w; i++) rank += popcount32(this.words[i] as number);
    rank += popcount32((this.words[w] as number) & ((1 << (value & 31)) - 1));
    return rank;
  }
 
  clear(): void {
    this.words.fill(0);
    this.prefix.fill(0);
    this.size = 0;
    this.last = -1;
    this.curBlock = 0;
  }
 
  *[Symbol.iterator](): IterableIterator<number> {
    for (let i = 0; i < this.size; i++) yield this.at(i);
  }
}
 
export interface ScanOptions {
  /** Max milliseconds of work per frame slice. Default 8. */
  budgetMs?: number;
  /** Stop after this many matches. Default Infinity. */
  limit?: number;
  /** Called with newly found match indices after each slice. */
  onMatches?(batch: readonly number[], scanner: SearchScanner): void;
  /** Called after each slice with scan progress in [0, 1]. */
  onProgress?(scanned: number, total: number): void;
  /** Called once when the scan finishes (not when cancelled). */
  onDone?(matches: BitsetIndex): void;
}
 
/**
 * Time-sliced streaming scanner: walks the entire index space of a
 * `DataSource`-sized collection without blocking the main thread. Each
 * animation frame it scans until the time budget is exhausted, reports the
 * batch, and yields. Results stream in immediately; a 30M scan stays at
 * 60 FPS throughout.
 */
export class SearchScanner {
  private readonly matchList: BitsetIndex;
  private cursor = 0;
  private cancelled = false;
  private finished = false;
 
  constructor(
    private readonly total: number,
    private readonly predicate: MatchPredicate,
    private readonly opts: ScanOptions = {},
  ) {
    this.matchList = new BitsetIndex(total);
  }
 
  get matches(): BitsetIndex {
    return this.matchList;
  }
 
  get scanned(): number {
    return this.cursor;
  }
 
  get done(): boolean {
    return this.finished;
  }
 
  start(): void {
    if (this.cancelled || this.finished) return;
    const schedule: (cb: () => void) => void =
      typeof requestAnimationFrame === 'function'
        ? (cb) => requestAnimationFrame(() => cb())
        : (cb) => setTimeout(cb, 0);
    const budget = this.opts.budgetMs ?? 8;
    const limit = this.opts.limit ?? Infinity;
 
    const slice = (): void => {
      if (this.cancelled) return;
      const t0 = performance.now();
      const batch: number[] = [];
      while (this.cursor < this.total && this.matchList.length < limit) {
        // check the clock every 2048 items — per-item now() calls dominate otherwise
        if ((this.cursor & 2047) === 0 && performance.now() - t0 > budget) break;
        if (this.predicate(this.cursor)) {
          this.matchList.push(this.cursor);
          batch.push(this.cursor);
        }
        this.cursor++;
      }
      if (batch.length > 0) this.opts.onMatches?.(batch, this);
      this.opts.onProgress?.(this.cursor, this.total);
      if (this.cursor >= this.total || this.matchList.length >= limit) {
        this.finished = true;
        this.opts.onDone?.(this.matchList);
        return;
      }
      schedule(slice);
    };
    schedule(slice);
  }
 
  cancel(): void {
    this.cancelled = true;
  }
}
 
/**
 * Wraps a `DataSource` so the engine renders only a filtered subset. The
 * match list may still be growing (streaming scan): call `append` as batches
 * arrive and `engine.refresh()` to reveal them. Memory is a fixed 1 bit per
 * underlying item (`BitsetIndex`) — independent of the match count, no cap.
 */
export class FilteredDataSource implements DataSource {
  private readonly indices: BitsetIndex;
  estimateHeight?: (index: number) => number;
  renderSeekToString?: (index: number) => string;
 
  constructor(
    private readonly inner: DataSource,
    initial: readonly number[] = [],
  ) {
    this.indices = new BitsetIndex(inner.count);
    for (const i of initial) this.indices.push(i);
    const est = inner.estimateHeight?.bind(inner);
    if (est) this.estimateHeight = (index) => est(this.sourceIndex(index));
    const seek = inner.renderSeekToString?.bind(inner);
    if (seek) this.renderSeekToString = (index) => seek(this.sourceIndex(index));
  }
 
  get count(): number {
    return this.indices.length;
  }
 
  /** Underlying index of the filtered item at `index`. */
  sourceIndex(index: number): number {
    if (index < 0 || index >= this.indices.length) {
      throw new RangeError(`filtered index ${index} out of bounds`);
    }
    return this.indices.at(index);
  }
 
  /** Position of the underlying `sourceIndex` in the filtered list, or -1. */
  indexOf(sourceIndex: number): number {
    return this.indices.indexOf(sourceIndex);
  }
 
  append(batch: readonly number[]): void {
    for (const i of batch) this.indices.push(i);
  }
 
  reset(indices: readonly number[] = []): void {
    this.indices.clear();
    for (const i of indices) this.indices.push(i);
  }
 
  renderToString(index: number): string {
    return this.inner.renderToString(this.sourceIndex(index));
  }
}
