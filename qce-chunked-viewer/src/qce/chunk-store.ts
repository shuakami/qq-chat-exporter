/**
 * Chunked message store over the QCE JSONP export format: binary-searched
 * global index -> chunk mapping, LRU-bounded chunk cache, deduplicated
 * script-injection loads, and Bloom accessors for search prefiltering.
 */
import { BloomFilter } from './bloom.js';

export interface QceRecord {
  id: string;
  ts: number;
  date: string;
  uid: string;
  name: string;
  nameLower: string;
  text: string;
  textTruncated?: boolean;
  /** Derived message kind (not part of the export format). */
  kind: string;
  html: string;
}

/** Derives a coarse message kind from the exporter's message HTML. */
export function kindOf(html: string): string {
  if (html.includes('class="image-content"')) return 'img';
  if (html.includes('class="market-face"') || html.includes('class="face-emoji"')) return 'sticker';
  if (html.includes('class="audio-wrapper"') || html.includes('class="message-audio"')) return 'voice';
  if (html.includes('class="message-video"')) return 'video';
  if (html.includes('class="message-file"')) return 'file';
  if (html.includes('class="reply-content"')) return 'reply';
  if (html.includes('class="forward-card')) return 'forward';
  if (html.includes('class="location-')) return 'location';
  if (html.includes('class="json-card"')) return 'card';
  return 'text';
}

export interface QceChunkMeta {
  id: string;
  file: string;
  count: number;
  startTs: number;
  endTs: number;
  startDate: string;
  endDate: string;
  firstMsgId: string;
  lastMsgId: string;
  textBloom: string;
  textBloomIncomplete?: boolean;
  senderBloom: string;
  bytes: number;
}

export interface QceManifest {
  format: string;
  version: number;
  exporter?: { name: string; version: string };
  exportTime: string;
  chat: {
    name: string;
    type: string;
    avatar?: string;
    selfUid?: string;
    selfUin?: string;
    selfName?: string;
    peerUid?: string;
    peerUin?: string;
  };
  stats: {
    totalMessages: number;
    minDateKey: string;
    maxDateKey: string;
    timeRangeText?: string;
  };
  chunking: { maxMessagesPerChunk: number };
  bloom: { textBits: number; textHashes: number; senderBits: number; senderHashes: number };
  msgidIndex?: { bucketCount: number; dir: string; filePrefix: string; fileExt: string };
  senders: Array<{ uid: string; displayName: string; aliases?: string[]; count: number; avatar?: string | null }>;
  chunks: QceChunkMeta[];
}

interface QceChunkPayload {
  id: string;
  messages: QceRecord[];
}

/**
 * Single-file inline exports pre-register all JSONP payloads into this stash
 * (via a bootstrap script that runs before the data scripts), so the store
 * can resolve everything synchronously without script injection.
 */
interface QceInlineData {
  manifest?: QceManifest;
  chunks: Record<string, QceRecord[]>;
  msgid: Record<number, Array<[string, string]>>;
}

declare global {
  interface Window {
    __QCE_MANIFEST__?: (m: QceManifest) => void;
    __QCE_CHUNK__?: (c: QceChunkPayload) => void;
    __QCE_MSGID_INDEX__?: (bucket: number, pairs: Array<[string, string]>) => void;
    __QCE_INLINE__?: QceInlineData;
  }
}

const LRU_CAPACITY = 16;
const MAX_CONCURRENT_LOADS = 4;
// Render-requested chunks older than this many requests behind the newest
// are dropped: the user has scrolled past them.
const STALE_WINDOW = 8;

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => {
      el.remove();
      res();
    };
    el.onerror = () => {
      el.remove();
      rej(new Error(`failed to load ${src}`));
    };
    document.head.appendChild(el);
  });
}

export function loadManifest(baseUrl: string): Promise<QceManifest> {
  const inline = window.__QCE_INLINE__;
  if (inline?.manifest) return Promise.resolve(inline.manifest);
  return new Promise((res, rej) => {
    window.__QCE_MANIFEST__ = (m) => {
      delete window.__QCE_MANIFEST__;
      res(m);
    };
    loadScript(`${baseUrl}/data/manifest.js`).catch(rej);
  });
}

export class ChunkStore {
  readonly manifest: QceManifest;
  readonly chunkStarts: number[];
  /** Called after any lazy chunk arrives, so the viewer can re-render. */
  onChunkLoaded: (() => void) | null = null;
  /** Chunks that have been loaded at least once (survives LRU eviction). */
  private readonly everLoaded = new Set<number>();

  private readonly baseUrl: string;
  private readonly cache = new Map<number, QceRecord[]>();
  private readonly pending = new Map<number, Promise<QceRecord[]>>();
  private readonly resolvers = new Map<string, (c: QceChunkPayload) => void>();
  private readonly wanted = new Map<number, number>();
  private wantGen = 0;
  private readonly msgIdBuckets = new Map<number, Map<string, string>>();
  private readonly pendingBuckets = new Map<number, Promise<Map<string, string>>>();
  private readonly bucketResolvers = new Map<number, (pairs: Array<[string, string]>) => void>();

  constructor(baseUrl: string, manifest: QceManifest) {
    this.baseUrl = baseUrl;
    this.manifest = manifest;
    this.chunkStarts = [];
    let acc = 0;
    for (const c of manifest.chunks) {
      this.chunkStarts.push(acc);
      acc += c.count;
    }
    window.__QCE_CHUNK__ = (c) => {
      this.resolvers.get(c.id)?.(c);
    };
    window.__QCE_MSGID_INDEX__ = (bucket, pairs) => {
      this.bucketResolvers.get(bucket)?.(pairs);
    };
  }

  chunkOf(index: number): number {
    let lo = 0;
    let hi = this.chunkStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunkStarts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Synchronous lookup; returns null (and schedules a load) when not cached. */
  get(index: number): QceRecord | null {
    const c = this.chunkOf(index);
    let records = this.cache.get(c);
    if (!records) records = this.insertInline(c) ?? undefined;
    if (records) {
      // refresh LRU position
      this.cache.delete(c);
      this.cache.set(c, records);
      return records[index - this.chunkStarts[c]!] ?? null;
    }
    this.want(c);
    return null;
  }

  /** Hydrates a chunk from the inline stash (single-file exports), if present. */
  private insertInline(chunk: number): QceRecord[] | null {
    const meta = this.manifest.chunks[chunk];
    if (!meta) return null;
    const messages = window.__QCE_INLINE__?.chunks[meta.id];
    if (!messages) return null;
    for (const r of messages) {
      if (!r.kind) r.kind = kindOf(r.html);
    }
    this.cache.set(chunk, messages);
    const isNew = !this.everLoaded.has(chunk);
    this.everLoaded.add(chunk);
    this.trimLru();
    // Defer: get() runs during render; notify listeners outside of it.
    if (isNew) queueMicrotask(() => this.onChunkLoaded?.());
    return messages;
  }

  private trimLru(): void {
    while (this.cache.size > LRU_CAPACITY) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /**
   * Marks a chunk as needed by the current render. Newest requests win: the
   * pump starts the most recently wanted chunks first and drops stale ones,
   * so a scrollbar drag never queues dozens of obsolete loads ahead of the
   * chunk the user actually settled on.
   */
  private want(chunk: number): void {
    this.wanted.set(chunk, ++this.wantGen);
    this.pump();
  }

  private pump(): void {
    while (this.pending.size < MAX_CONCURRENT_LOADS && this.wanted.size > 0) {
      let best = -1;
      let bestGen = -1;
      for (const [c, g] of this.wanted) {
        if (this.cache.has(c) || this.pending.has(c) || g < this.wantGen - STALE_WINDOW) {
          this.wanted.delete(c);
          continue;
        }
        if (g > bestGen) {
          bestGen = g;
          best = c;
        }
      }
      if (best < 0) return;
      this.wanted.delete(best);
      void this.load(best)
        .catch(() => undefined)
        .finally(() => this.pump());
    }
  }

  isLoaded(chunk: number): boolean {
    return this.cache.has(chunk);
  }

  /** Loads a chunk (deduplicated), inserting into the LRU. */
  load(chunk: number): Promise<QceRecord[]> {
    const cached = this.cache.get(chunk);
    if (cached) return Promise.resolve(cached);
    const inline = this.insertInline(chunk);
    if (inline) return Promise.resolve(inline);
    const inflight = this.pending.get(chunk);
    if (inflight) return inflight;
    const meta = this.manifest.chunks[chunk]!;
    // Payloads self-identify by chunk id, so loads can run fully in parallel:
    // the shared JSONP callback dispatches to the matching per-chunk resolver.
    const p: Promise<QceRecord[]> = (async () => {
      let messages: QceRecord[] | null = null;
      for (let attempt = 0; attempt < 3 && !messages; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
        try {
          const done = new Promise<QceRecord[]>((r, rej) => {
            this.resolvers.set(meta.id, (c) => {
              this.resolvers.delete(meta.id);
              r(c.messages);
            });
            setTimeout(() => {
              this.resolvers.delete(meta.id);
              rej(new Error(`chunk ${meta.id} timed out`));
            }, 20_000);
          });
          await loadScript(`${this.baseUrl}/${meta.file}`);
          messages = await done;
        } catch {
          messages = null;
        }
      }
      if (messages) {
        for (const r of messages) {
          if (!r.kind) r.kind = kindOf(r.html);
        }
      }
      if (!messages) {
        // Re-render so visible skeletons re-request the chunk.
        this.onChunkLoaded?.();
        throw new Error(`failed to load chunk ${meta.id}`);
      }
      this.cache.set(chunk, messages);
      this.everLoaded.add(chunk);
      this.trimLru();
      this.onChunkLoaded?.();
      return messages;
    })().finally(() => this.pending.delete(chunk));
    this.pending.set(chunk, p);
    return p;
  }

  /**
   * Resolves a DOM message id (e.g. "msg-123") to its chunk id via the
   * bucketed msgid index (data/index/msgid_bXX.js JSONP files).
   */
  msgIdToChunkId(msgId: string, bucket: number): Promise<string | null> {
    const loaded = this.msgIdBuckets.get(bucket);
    if (loaded) return Promise.resolve(loaded.get(msgId) ?? null);
    const inlinePairs = window.__QCE_INLINE__?.msgid[bucket];
    if (inlinePairs) {
      const map = new Map(inlinePairs);
      this.msgIdBuckets.set(bucket, map);
      return Promise.resolve(map.get(msgId) ?? null);
    }
    const idx = this.manifest.msgidIndex;
    if (!idx) return Promise.resolve(null);
    let inflight = this.pendingBuckets.get(bucket);
    if (!inflight) {
      const dir = idx.dir || 'data/index';
      const prefix = idx.filePrefix || 'msgid_b';
      const ext = idx.fileExt || '.js';
      const hex = bucket.toString(16).padStart(2, '0');
      inflight = new Promise<Map<string, string>>((res, rej) => {
        this.bucketResolvers.set(bucket, (pairs) => {
          this.bucketResolvers.delete(bucket);
          const map = new Map(pairs);
          this.msgIdBuckets.set(bucket, map);
          res(map);
        });
        loadScript(`${this.baseUrl}/${dir}/${prefix}${hex}${ext}`).catch((e) => {
          this.bucketResolvers.delete(bucket);
          rej(e instanceof Error ? e : new Error(String(e)));
        });
      }).finally(() => this.pendingBuckets.delete(bucket));
      this.pendingBuckets.set(bucket, inflight);
    }
    return inflight.then((map) => map.get(msgId) ?? null);
  }

  /** Text-Bloom prefilter; `true` means the chunk must still be scanned. */
  textMayContain(chunk: number, queryLower: string): boolean {
    const meta = this.manifest.chunks[chunk]!;
    if (!meta.textBloom || meta.textBloomIncomplete) return true;
    const { textBits, textHashes } = this.manifest.bloom;
    return BloomFilter.fromBase64(meta.textBloom, textBits, textHashes).mayContain(queryLower);
  }

  /** Sender-Bloom prefilter over whole uid tokens. */
  senderMayContain(chunk: number, uid: string): boolean {
    const meta = this.manifest.chunks[chunk]!;
    if (!meta.senderBloom) return true;
    const { senderBits, senderHashes } = this.manifest.bloom;
    return BloomFilter.fromBase64(meta.senderBloom, senderBits, senderHashes).mayContainToken(uid);
  }

  cacheSize(): number {
    return this.cache.size;
  }

  /** Number of distinct chunks loaded so far (not reduced by LRU eviction). */
  loadedChunkCount(): number {
    return this.everLoaded.size;
  }
}
