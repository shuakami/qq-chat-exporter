/**
 * 消息解析器
 */

import { RawMessage, MessageElement, ElementType, NTMsgType } from 'NapCatQQ/src/core/index.js';
import { SystemError, ErrorType, ResourceInfo, ResourceStatus } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { OneBotMsgApi } from 'NapCatQQ/src/onebot/api/msg.js';

/* ------------------------------ 内部高性能工具 ------------------------------ */

/** 并发限流 map（保持顺序的结果数组） */
async function mapLimit<T, R>(
  arr: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const len = arr.length;
  const out = new Array<R>(len);
  if (len === 0) return out;

  const workers = Math.min((limit >>> 0) || 1, len);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= len) break;
      out[i] = await mapper(arr[i]!, i);
    }
  }
  const tasks = new Array(workers);
  for (let i = 0; i < workers; i++) tasks[i] = worker();
  await Promise.all(tasks);
  return out;
}

/** 自适应并发度 */
function resolveConcurrency(): number {
  try {
    // Node 环境
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');
    const cores = (os?.cpus?.() || []).length || 4;
    // 2x 核心，最多 32，最少 4
    return Math.max(4, Math.min(32, cores * 2));
  } catch {
    // 浏览器/未知环境
    return 8;
  }
}

/** 让出事件循环，防止长时间 CPU 占用导致“卡住”观感 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/** Promise 超时包装（超时返回 null，不抛异常） */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) {
    try {
      return await p;
    } catch {
      return null;
    }
  }
  let timer: any = null;
  return new Promise<T | null>((resolve) => {
    const done = (v: T | null) => {
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    timer = setTimeout(() => done(null), ms);
    p.then((v) => done(v)).catch(() => done(null));
  });
}

/** 轻量 LRU 缓存实现 */
class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      this.capacity = 1000;
    }
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // 最近使用：删除再插入到尾部
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.capacity) {
      // 淘汰最旧
      const it = this.map.keys().next();
      if (!it.done) this.map.delete(it.value);
    }
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  clear(): void {
    this.map.clear();
  }
  size(): number {
    return this.map.size;
  }
  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }
}

/** 被引用消息的轻量索引，尽量减少内存：只保留解析引用所需的最小字段 */
type MsgRef = {
  msgId: string;
  msgSeq?: string;
  clientSeq?: string;
  // 为提取引用预览而保留的最小 elements 信息（不保留 records / 原始大字段）
  elements?: any[];
};

/** 高性能字符串分块构建器，避免 O(n^2) 级别的拼接 */
class ChunkedBuilder {
  private chunks: string[] = [];
  push(s: string | undefined | null) {
    if (s) this.chunks.push(s);
  }
  toString() {
    return this.chunks.join('');
  }
  clear() {
    this.chunks.length = 0;
  }
}

/** HTML 高性能转义（按需触发，一次扫描） */
const NEED_ESCAPE_RE = /[&<>"']/;
function escapeHtmlFast(text: string): string {
  if (!text) return '';
  if (!NEED_ESCAPE_RE.test(text)) return text;
  const len = text.length;
  let out = '';
  let last = 0;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    let rep: string | null = null;
    // & < > " '
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep) {
      if (i > last) out += text.slice(last, i);
      out += rep;
      last = i + 1;
    }
  }
  if (last < len) out += text.slice(last);
  return out;
}

/** RFC3339/ISO8601（UTC）格式化工具：毫秒 */
function pad2(n: number) {
  return n < 10 ? '0' + n : '' + n;
}
function pad3(n: number) {
  if (n >= 100) return '' + n;
  if (n >= 10) return '0' + n;
  return '00' + n;
}
function pad4(n: number) {
  if (n >= 1000) return '' + n;
  if (n >= 100) return '0' + n;
  if (n >= 10) return '00' + n;
  return '000' + n;
}
function rfc3339FromMillis(ms: number): string {
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const ms3 = d.getUTCMilliseconds();
  return `${pad4(Y)}-${pad2(M)}-${pad2(D)}T${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms3)}Z`;
}
/** 秒级 Unix（string/number/bigint） -> RFC3339（UTC） */
function rfc3339FromUnixSeconds(sec: string | number | bigint): string {
  try {
    if (typeof sec === 'bigint') {
      const n = Number(sec * 1000n);
      return Number.isFinite(n) ? rfc3339FromMillis(n) : '1970-01-01T00:00:00.000Z';
    }
    const n =
      typeof sec === 'string'
        ? Math.trunc(parseInt(sec, 10) * 1000)
        : Math.trunc(sec * 1000);
    return rfc3339FromMillis(n);
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}
/** 安全的秒 -> Date */
function dateFromUnixSeconds(sec: string | number | bigint): Date {
  try {
    if (typeof sec === 'bigint') {
      const n = Number(sec * 1000n);
      return Number.isFinite(n) ? new Date(n) : new Date(0);
    }
    const n = typeof sec === 'string' ? parseInt(sec, 10) : sec;
    if (!Number.isFinite(n)) return new Date(0);
    return new Date(Math.trunc(n * 1000));
  } catch {
    return new Date(0);
  }
}

/** 高性能 JSON 解析（优先 simdjson，自动降级） */
type FastJsonParser = (s: string) => any;
let fastJsonParse: FastJsonParser = (s) => JSON.parse(s);
(function tryLoadSimdJson() {
  try {
    // Node/CommonJS
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = typeof require !== 'undefined' ? require('simdjson') : null;
    if (mod && typeof mod.parse === 'function') {
      fastJsonParse = (s) => mod.parse(s);
    }
  } catch {
    // ESM 或不可用环境下静默降级到原生
  }
})();

/* ------------------------------ 解析类型定义（与原始保持一致） ------------------------------ */

/**
 * 解析后的消息内容接口
 */
export interface ParsedMessageContent {
  text: string;
  html: string;
  raw: string;
  mentions: Array<{
    uid: string;
    name?: string;
    type: 'user' | 'all';
  }>;
  reply?: {
    messageId: string;
    referencedMessageId?: string;  // 被引用消息的实际messageId，用于链接跳转
    senderName?: string;
    content: string;
    elements?: any[];
  };
  resources: ResourceInfo[];
  emojis: Array<{
    id: string;
    name?: string;
    url?: string;
    type: 'face' | 'market' | 'custom';
  }>;
  location?: {
    latitude: number;
    longitude: number;
    title?: string;
    address?: string;
  };
  card?: {
    title?: string;
    content?: string;
    url?: string;
    preview?: string;
    type: string;
  };
  multiForward?: {
    title: string;
    summary: string;
    messageCount: number;
    senderNames: string[];
  };
  calendar?: {
    title: string;
    startTime: Date;
    endTime?: Date;
    description?: string;
  };
  special: Array<{
    type: string;
    data: any;
    description: string;
  }>;
}

/**
 * 解析后的完整消息接口
 */
export interface ParsedMessage {
  messageId: string;
  messageSeq: string;
  msgRandom?: string;
  timestamp: Date;
  sender: {
    uid: string;
    uin?: string;
    name?: string;
    nickname?: string;      // QQ昵称
    groupCard?: string;     // 群昵称
    remark?: string;        // 好友备注
    avatar?: string;
    role?: 'owner' | 'admin' | 'member';
  };
  receiver?: {
    uid: string;
    name?: string;
    type: 'group' | 'private';
  };
  messageType: NTMsgType;
  isSystemMessage: boolean;
  isRecalled: boolean;
  isTempMessage: boolean;
  content: ParsedMessageContent;
  stats: {
    elementCount: number;
    resourceCount: number;
    textLength: number;
    processingTime: number;
  };
  rawMessage: RawMessage;
}

/**
 * 消息解析器配置接口（扩展）
 */
export interface MessageParserConfig {
  includeResourceLinks: boolean;
  includeSystemMessages: boolean;
  parseMarketFace: boolean;
  parseCardMessages: boolean;
  parseMultiForward: boolean;
  fetchUserInfo: boolean;
  timeFormat: string;
  maxTextLength: number;
  debugMode: boolean;

  /** 新增：性能 & 行为开关 */
  concurrency?: number;                     // 并发覆盖（默认自动）
  obParseTimeoutMs: number;                 // OneBot 解析超时（默认 400ms）
  quickReply: boolean;                      // quick_reply=true 避免重抓引用
  obMode: 'prefer-native' | 'prefer-ob' | 'native-only' | 'ob-only';
  fallback: 'native' | 'basic';             // OB 失败的回退策略
  html: 'full' | 'none';                    // 是否生成 HTML
  rawStrategy: 'string' | 'none';           // 是否生成内容 raw 字符串
  progressEvery: number;                    // 进度输出节流
  yieldEvery: number;                       // 每处理 N 条让出事件循环
  suppressFallbackWarn: boolean;            // 抑制 fallback warn 日志
  stopOnAbort: boolean;                     // 配合 signal
  signal?: { aborted: boolean } | AbortSignal; // 可选：外部中止
  onProgress?: (processed: number, total: number) => void; // 可选：进度回调
  
  /** 新增：流式/批处理 & 内存控制 */
  batchSize?: number;                       // 流式/分批解析的批大小（建议 10k~50k）
  messageIndexCapacity?: number;            // 引用索引（messageMap）的最大容量（LRU）
  onBatch?: (batch: ParsedMessage[], batchIndex: number, batchCount: number) => Promise<void> | void; // 批次回调（流式写出）
  gcBetweenBatches?: boolean;               // 是否在批次间尝试 GC（需要 node 启动 --expose-gc）
  gcMinIntervalMs?: number;                 // 两次 GC 的最小间隔，毫秒
  memorySoftLimitMB?: number;               // 软内存上限（MB），超过则记录警告日志
  crossBatchReference?: 'window' | 'strict'; // 跨批引用策略：window（LRU窗口） | strict（尽力回溯）
}

/** 默认解析器配置（含新增默认） */
const DEFAULT_PARSER_CONFIG: MessageParserConfig = {
  includeResourceLinks: true,
  includeSystemMessages: true,
  parseMarketFace: true,
  parseCardMessages: true,
  parseMultiForward: true,
  fetchUserInfo: false,
  timeFormat: 'YYYY-MM-DD HH:mm:ss',
  maxTextLength: 50000,
  debugMode: false,

  obParseTimeoutMs: 400,
  quickReply: true,
  obMode: 'prefer-native',
  fallback: 'native',
  html: 'full',
  rawStrategy: 'string',
  progressEvery: 100,
  yieldEvery: 1000,
  suppressFallbackWarn: true,
  stopOnAbort: true,
  
  // 流式/批处理默认值
  batchSize: 20000,
  messageIndexCapacity: 50000,
  onBatch: undefined,
  gcBetweenBatches: true,
  gcMinIntervalMs: 8000,
  memorySoftLimitMB: 1400,
  crossBatchReference: 'window'
};

/* ---------------------------------- 主解析器 ---------------------------------- */

export class MessageParser {
  private readonly core: NapCatCore;
  private readonly config: MessageParserConfig;
  private readonly oneBotMsgApi: OneBotMsgApi;

  /** 用户信息缓存 */
  private userInfoCache: Map<string, any> = new Map();

  /** 表情映射缓存 */
  private faceMap: Map<string, string> = new Map();

  /** 全局消息映射（滑动窗口 LRU），用于引用解析 */
  private messageMap: LRUCache<string, MsgRef>;
  
  /** 上次 GC 时间戳 */
  private lastGcTs = 0;

  /** 并发度（内部自适应，可被配置覆盖） */
  private readonly concurrency: number;

  constructor(core: NapCatCore, config: Partial<MessageParserConfig> = {}) {
    this.core = core;
    this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
    this.concurrency = this.config.concurrency ?? resolveConcurrency();
    // 仅需转换器
    this.oneBotMsgApi = new OneBotMsgApi(null as any, core);
    this.initializeFaceMap();
    
    // 初始化 LRU
    const cap = this.config.messageIndexCapacity ?? 50000;
    this.messageMap = new LRUCache<string, MsgRef>(cap);
  }

  // ========== [新增] 内部：将消息批量索引到 LRU ==========
  private indexBatch(messages: RawMessage[]): void {
    for (const msg of messages) {
      if (!msg || !msg.msgId) continue;
      this.messageMap.set(msg.msgId, {
        msgId: msg.msgId,
        msgSeq: msg.msgSeq,
        clientSeq: (msg as any).clientSeq,
        elements: Array.isArray(msg.elements) ? msg.elements.slice(0, 16) : undefined // 控制体积
      });
      // 也索引 records（引用常出现在这里）
      if (Array.isArray(msg.records)) {
        for (const r of msg.records) {
          if (r?.msgId) {
            this.messageMap.set(r.msgId, {
              msgId: r.msgId,
              msgSeq: r.msgSeq,
              clientSeq: (r as any).clientSeq,
              elements: Array.isArray(r.elements) ? r.elements.slice(0, 16) : undefined
            });
          }
        }
      }
    }
  }

  // ========== [新增] 内部：尝试触发 GC 与内存预警 ==========
  private maybeGc(hint: string): void {
    if (!this.config.gcBetweenBatches) return;
    const now = Date.now();
    if (now - this.lastGcTs < (this.config.gcMinIntervalMs ?? 8000)) return;

    try {
      const mu = process.memoryUsage?.();
      const heapMB = mu?.heapUsed ? Math.round(mu.heapUsed / 1e6) : 0;
      if (this.config.memorySoftLimitMB && heapMB > this.config.memorySoftLimitMB) {
        console.warn(`[MessageParser] heapUsed=${heapMB}MB 超过软上限 ${this.config.memorySoftLimitMB}MB（${hint}）`);
      }
      if (typeof global.gc === 'function') {
        const before = heapMB;
        global.gc();
        const after = Math.round(process.memoryUsage().heapUsed / 1e6);
        console.log(`[MessageParser] GC(${hint}) -> ${before}MB → ${after}MB`);
      }
    } catch {
      // 忽略：未开启 --expose-gc
    } finally {
      this.lastGcTs = now;
    }
  }

  // ========== [新增] 内部：解析单批（完全沿用原有并发/OB 回退/统计等逻辑） ==========
  private async parseBatch(messages: RawMessage[], total: number, processed0: number): Promise<ParsedMessage[]> {
    // 将当前批次预索引到 LRU（滑窗 + records）
    this.indexBatch(messages);

    const preferNative =
      this.config.obMode === 'native-only' || this.config.obMode === 'prefer-native';
    const obOnly = this.config.obMode === 'ob-only';

    let processed = processed0;

    const results = await mapLimit(messages, this.concurrency, async (message, idx) => {
      try {
        if (this.config.signal?.aborted && this.config.stopOnAbort) return null;
        if (!message || !message.msgId) return null;
        if (!this.config.includeSystemMessages && this.isSystemMessage(message)) return null;

        const t0 = Date.now();
        let parsed: ParsedMessage | null = null;

        if (preferNative) {
          parsed = await this.parseMessage(message);
        } else {
          const obPromise = this.oneBotMsgApi.parseMessageV2(
            message,
            this.config.parseMultiForward,
            !this.config.includeResourceLinks,
            this.config.quickReply
          );
          const ob11Result = await withTimeout(obPromise, this.config.obParseTimeoutMs);

          if (ob11Result && ob11Result.arrayMsg) {
            parsed = this.convertOB11MessageToParsedMessage(ob11Result.arrayMsg, message, Date.now() - t0);
          } else if (obOnly) {
            if (!this.config.suppressFallbackWarn) {
              this.log(`OneBot解析失败/超时（OB-only），使用 basic fallback: ${message.msgId}`, 'warn');
            }
            parsed = this.createFallbackMessage(message);
          } else {
            if (!this.config.suppressFallbackWarn) {
              this.log(`OneBot解析失败/超时，回退到本地解析: ${message.msgId}`, 'warn');
            }
            parsed = await this.parseMessage(message);
          }
        }

        // 进度
        processed++;
        if (this.config.onProgress) {
          this.config.onProgress(processed, total);
        } else if (processed % this.config.progressEvery === 0) {
          const pct = Math.round((processed / total) * 100);
          const heapMB = Math.round((process.memoryUsage?.().heapUsed || 0) / 1e6);
          this.log(`进度 ${pct}% (${processed}/${total}) | heapUsed≈${heapMB}MB`);
        }

        // 周期性让出事件循环
        if (this.config.yieldEvery > 0 && (idx + 1) % this.config.yieldEvery === 0) {
          await yieldToEventLoop();
        }
        return parsed;
      } catch (err) {
        this.log(`解析消息失败 (${message?.msgId || 'unknown'}): ${err}`, 'error');
        return message ? this.createErrorMessage(message, err) : null;
      }
    });

    // 压紧输出
    const out: ParsedMessage[] = [];
    for (let i = 0; i < results.length; i++) {
      const v = results[i];
      if (v) out.push(v);
    }
    return out;
  }

  /**
   * 解析消息列表（高并发 + 有序输出 + 超时快回退 + 让步）
   * - 自动跳过空消息与（可选）系统消息
   * - OB 与原生两路可切换
   */
  async parseMessages(messages: RawMessage[]): Promise<ParsedMessage[]> {
    const total = messages.length;
    const start = Date.now();
    let processed = 0;

    this.log(`开始解析 ${total} 条消息（分批流式，batchSize=${this.config.batchSize}, concurrency=${this.concurrency}）`);

    const batchSize = Math.max(1000, this.config.batchSize ?? 20000);
    const batches = Math.ceil(total / batchSize);
    const all: ParsedMessage[] = [];

    this.messageMap.clear();

    for (let bi = 0; bi < batches; bi++) {
      const begin = bi * batchSize;
      const end = Math.min(begin + batchSize, total);
      const slice = messages.slice(begin, end);

      const parsed = await this.parseBatch(slice, total, processed);
      processed += slice.length;

      // 如果外部未订阅批次回调，保留结果（保持原有返回行为）
      all.push(...parsed);

      // 批次进度日志
      const pct = Math.round((processed / total) * 100);
      const heapMB = Math.round((process.memoryUsage?.().heapUsed || 0) / 1e6);
      this.log(`批次 ${bi + 1}/${batches} 完成，累计 ${processed}/${total}（${pct}%），heapUsed≈${heapMB}MB`);

      // 尝试 GC
      this.maybeGc(`batch#${bi + 1}`);

      // 让出事件循环（保证 UI/事件响应）
      await yieldToEventLoop();
    }

    // 清理 LRU
    this.messageMap.clear();

    const duration = Date.now() - start;
    this.log(`消息解析完成，共 ${all.length} 条，耗时 ${duration}ms`);
    return all;
  }

  // ========== [新增] 真正的"流式解析"入口：不累计所有结果，按批次回调/写出 ==========
  /**
   * 流式分批解析（推荐大数据量时由导出器调用）
   * - 保持对外 API 兼容：这是新增方法，不改变 parseMessages 签名与语义
   */
  async parseMessagesStream(
    messages: RawMessage[],
    opts?: {
      batchSize?: number;
      onBatch?: (batch: ParsedMessage[], batchIndex: number, batchCount: number) => Promise<void> | void;
    }
  ): Promise<{ total: number; batches: number; yielded: number; elapsedMs: number }> {
    const total = messages.length;
    const batchSize = Math.max(1000, opts?.batchSize ?? this.config.batchSize ?? 20000);
    const batches = Math.ceil(total / batchSize);

    const start = Date.now();
    let yielded = 0;

    this.messageMap.clear();
    this.log(`流式解析启动：total=${total}, batchSize=${batchSize}, batches=${batches}`);

    for (let bi = 0; bi < batches; bi++) {
      const s = bi * batchSize;
      const e = Math.min(s + batchSize, total);
      const slice = messages.slice(s, e);

      const parsed = await this.parseBatch(slice, total, s);
      yielded += parsed.length;

      // 交给外部写出（JSON/HTML 导出器）
      const cb = opts?.onBatch ?? this.config.onBatch;
      if (cb) await cb(parsed, bi, batches);

      // 批间 GC
      this.maybeGc(`stream-batch#${bi + 1}`);

      await yieldToEventLoop();
    }

    // 清理索引
    this.messageMap.clear();

    const elapsedMs = Date.now() - start;
    this.log(`流式解析完成：yielded=${yielded}, batches=${batches}, 耗时=${elapsedMs}ms`);
    return { total, batches, yielded, elapsedMs };
  }

  /**
   * 将 OneBot 消息转换为 ParsedMessage 格式（单趟处理 + 可选产出 HTML/RAW）
   */
  private convertOB11MessageToParsedMessage(ob11Msg: any, rawMsg: RawMessage, elapsedMs = 0): ParsedMessage {
    const content: ParsedMessageContent = {
      text: ob11Msg.raw_message || '',
      html: '',
      raw: this.config.rawStrategy === 'string' ? JSON.stringify(ob11Msg.message) : '',
      mentions: [],
      resources: [],
      emojis: [],
      special: []
    };

    const checkedAt = new Date(); // 复用同一时间戳，减少 Date 分配

    // 单趟扫描 OB11 段
    if (Array.isArray(ob11Msg.message)) {
      for (let i = 0; i < ob11Msg.message.length; i++) {
        const seg = ob11Msg.message[i];
        this.processOB11Segment(seg, content, checkedAt);
      }
    }

    if (this.config.html !== 'none') {
      content.html = this.generateHtmlFromOB11(ob11Msg.message);
    }

    return {
      messageId: rawMsg.msgId,
      messageSeq: rawMsg.msgSeq,
      msgRandom: rawMsg.msgRandom,
      timestamp: dateFromUnixSeconds(rawMsg.msgTime),
      sender: {
        uid: rawMsg.senderUid,
        uin: rawMsg.senderUin,
        name: (rawMsg.sendMemberName && rawMsg.sendMemberName.trim()) ||
              (rawMsg.sendRemarkName && rawMsg.sendRemarkName.trim()) ||
              (rawMsg.sendNickName && rawMsg.sendNickName.trim()) ||
              (rawMsg.senderUin && String(rawMsg.senderUin)) ||
              undefined,
        nickname: (rawMsg.sendNickName && rawMsg.sendNickName.trim()) || undefined,
        groupCard: (rawMsg.sendMemberName && rawMsg.sendMemberName.trim()) || undefined,
        remark: (rawMsg.sendRemarkName && rawMsg.sendRemarkName.trim()) || undefined,
        avatar: undefined,
        role: undefined
      },
      receiver: {
        uid: rawMsg.peerUid,
        type: rawMsg.chatType === 2 ? 'group' : 'private'
      },
      messageType: rawMsg.msgType,
      isSystemMessage: this.isSystemMessage(rawMsg),
      isRecalled: this.isRecalledMessage(rawMsg),
      isTempMessage: false,
      stats: {
        elementCount: rawMsg.elements?.length || 0,
        resourceCount: content.resources.length,
        textLength: content.text.length,
        processingTime: elapsedMs
      },
      content,
      rawMessage: rawMsg
    };
  }

  /**
   * 处理 OneBot 段（极简分支 + 复用日期对象）
   */
  private processOB11Segment(segment: any, content: ParsedMessageContent, checkedAt: Date): void {
    switch (segment.type) {
      case 'text':
        // 文本内容已在 raw_message 中
        break;

      case 'at': {
        const isAll = segment.data.qq === 'all';
        content.mentions.push({
          uid: isAll ? 'all' : segment.data.qq,
          name: segment.data.name,
          type: isAll ? 'all' : 'user'
        });
        break;
      }

      case 'image': {
        content.resources.push({
          type: 'image',
          fileName: segment.data.file || 'unknown.jpg',
          originalUrl: segment.data.url,
          fileSize: segment.data.file_size || 0,
          mimeType: 'image/jpeg',
          md5: segment.data.file,
          localPath: segment.data.path,
          status: ResourceStatus.DOWNLOADED,
          accessible: true,
          checkedAt
        });
        break;
      }

      case 'file': {
        content.resources.push({
          type: 'file',
          fileName: segment.data.file || 'unknown',
          originalUrl: segment.data.url,
          fileSize: segment.data.file_size || 0,
          mimeType: 'application/octet-stream',
          md5: segment.data.file_id,
          localPath: segment.data.path,
          status: ResourceStatus.DOWNLOADED,
          accessible: true,
          checkedAt
        });
        break;
      }

      case 'video': {
        content.resources.push({
          type: 'video',
          fileName: segment.data.file || 'unknown.mp4',
          originalUrl: segment.data.url,
          fileSize: segment.data.file_size || 0,
          mimeType: 'video/mp4',
          md5: segment.data.file,
          localPath: segment.data.path,
          status: ResourceStatus.DOWNLOADED,
          accessible: true,
          checkedAt
        });
        break;
      }

      case 'voice': {
        content.resources.push({
          type: 'audio',
          fileName: segment.data.file || 'unknown.amr',
          originalUrl: segment.data.url,
          fileSize: segment.data.file_size || 0,
          mimeType: 'audio/amr',
          md5: segment.data.file,
          localPath: segment.data.path,
          status: ResourceStatus.DOWNLOADED,
          accessible: true,
          checkedAt
        });
        break;
      }

      case 'face': {
        const id = segment.data.id;
        content.emojis.push({
          id,
          name: this.faceMap.get(id) || `表情${id}`,
          url: undefined,
          type: 'face'
        });
        break;
      }

      case 'reply': {
        if (!content.reply) {
          const replyId = segment.data.id;
          let referencedMessageId: string | undefined;
          
          // 尝试从全局消息映射中查找被引用消息的实际messageId
          if (replyId && this.messageMap.has(replyId)) {
            const referencedMessage = this.messageMap.get(replyId);
            referencedMessageId = referencedMessage?.msgId;
          }
          
          content.reply = {
            messageId: replyId,
            referencedMessageId,
            senderName: undefined,
            content: '引用消息',
            elements: []
          };
        }
        break;
      }

      default:
        content.special.push({
          type: segment.type,
          data: segment.data,
          description: `${segment.type}类型消息`
        });
        break;
    }
  }

  /**
   * 从 OneBot 消息生成 HTML（单趟）
   */
  private generateHtmlFromOB11(message: any[]): string {
    if (this.config.html === 'none') return '';
    if (!Array.isArray(message)) return '';
    const b = new ChunkedBuilder();
    for (let i = 0; i < message.length; i++) {
      const seg = message[i];
      switch (seg.type) {
        case 'text':
          b.push(escapeHtmlFast(seg.data.text));
          break;
        case 'at':
          b.push(
            `<span class="at">@${seg.data.qq === 'all' ? '全体成员' : seg.data.qq}</span>`
          );
          break;
        case 'image':
          b.push(`<img src="${seg.data.url || ''}" alt="图片" />`);
          break;
        case 'face':
          b.push(`<span class="emoji">[表情:${seg.data.id}]</span>`);
          break;
        case 'file':
          b.push(`<span class="file">[文件:${seg.data.file}]</span>`);
          break;
        case 'video':
          b.push(`<span class="video">[视频:${seg.data.file}]</span>`);
          break;
        case 'voice':
          b.push(`<span class="voice">[语音]</span>`);
          break;
        case 'reply':
          b.push(`<span class="reply">[回复消息]</span>`);
          break;
        default:
          b.push(`<span class="special">[${seg.type}]</span>`);
          break;
      }
    }
    return b.toString();
  }

  /** 兼容旧名方法（内部调用高性能实现） */
  private escapeHtml(text: string): string {
    return escapeHtmlFast(text);
  }

  /**
   * 解析单条消息（原生路径，完全本地，无 OB 调用）
   */
  async parseMessage(message: RawMessage): Promise<ParsedMessage> {
    const start = Date.now();
    try {
      const sender = await this.parseSenderInfo(message);
      const receiver = this.parseReceiverInfo(message);
      const content = await this.parseMessageContent(message.elements || [], message);
      const stats = {
        elementCount: (message.elements && message.elements.length) || 0,
        resourceCount: content.resources.length,
        textLength: content.text.length,
        processingTime: Date.now() - start
      };

      return {
        messageId: message.msgId,
        messageSeq: message.msgSeq,
        msgRandom: message.msgRandom,
        timestamp: dateFromUnixSeconds(message.msgTime),
        sender,
        receiver,
        messageType: message.msgType,
        isSystemMessage: this.isSystemMessage(message),
        isRecalled: this.isRecalledMessage(message),
        isTempMessage: this.isTempMessage(message),
        content,
        stats,
        rawMessage: message
      };
    } catch (error) {
      throw new SystemError({
        type: ErrorType.API_ERROR,
        message: '解析消息失败',
        details: error,
        timestamp: new Date(),
        context: { messageId: message.msgId }
      });
    }
  }

  /**
   * 解析消息内容（单趟 + 分块构建 + 可选 HTML/RAW）
   */
  private async parseMessageContent(elements: MessageElement[], messageRef?: RawMessage): Promise<ParsedMessageContent> {
    const textB = new ChunkedBuilder();
    const htmlB = new ChunkedBuilder();
    const rawB = new ChunkedBuilder();

    const mentions: ParsedMessageContent['mentions'] = [];
    const resources: ResourceInfo[] = [];
    const emojis: ParsedMessageContent['emojis'] = [];
    const special: ParsedMessageContent['special'] = [];

    let reply: ParsedMessageContent['reply'] | undefined;
    let location: ParsedMessageContent['location'] | undefined;
    let card: ParsedMessageContent['card'] | undefined;
    let multiForward: ParsedMessageContent['multiForward'] | undefined;
    let calendar: ParsedMessageContent['calendar'] | undefined;

    const checkedAt = new Date();

    const ctxText = (t: string, h: string) => {
      textB.push(t);
      if (this.config.html !== 'none') htmlB.push(h);
    };

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!;
      const elementType = element.elementType;

      if (this.config.rawStrategy === 'string') {
        rawB.push(JSON.stringify(element));
        rawB.push('\n');
      }

        try {
          switch (elementType) {
            case 1: // ElementType.TEXT
            if (element.textElement) {
              const te = element.textElement;
              const content = te.content || '';
              // atType: 0=普通文本, 1=@全体成员, 2=@某人
              if (te.atType === 1) {
                mentions.push({ uid: 'all', name: '全体成员', type: 'all' });
                ctxText(content, `<span class="mention mention-all">${escapeHtmlFast(content)}</span>`);
              } else if (te.atType === 2) {
                const uid = te.atNtUid || te.atUid || 'unknown';
                const name = content.replace(/^@/, '');
                mentions.push({ uid, name, type: 'user' });
                ctxText(content, `<span class="mention" data-uid="${uid}">${escapeHtmlFast(content)}</span>`);
              } else {
                ctxText(content, escapeHtmlFast(content));
              }
            }
            break;

            case 2: // ElementType.PIC:
            if (element.picElement) {
              const pic = element.picElement;
              const resource: ResourceInfo = {
                type: 'image',
                fileName: pic.fileName || 'image.jpg',
                fileSize: parseInt(pic.fileSize?.toString() || '0', 10),
                originalUrl: pic.originImageUrl || '',
                md5: pic.md5HexStr || '',
                accessible: !!pic.originImageUrl,
                checkedAt
              };
              resources.push(resource);

              const altText = `[图片${pic.fileName ? `: ${pic.fileName}` : ''}]`;
              if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                ctxText(altText, `<img src="${resource.originalUrl}" alt="${pic.fileName}" class="message-image" />`);
              } else {
                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
              }
            }
            break;

            case 5: // ElementType.VIDEO
            if (element.videoElement) {
              const video = element.videoElement;
              const resource: ResourceInfo = {
                type: 'video',
                fileName: video.fileName || 'video.mp4',
                fileSize: parseInt(video.fileSize?.toString() || '0', 10),
                originalUrl: '',
                md5: video.fileUuid || '',
                accessible: false,
                checkedAt
              };
              resources.push(resource);
              const altText = `[视频${video.fileName ? `: ${video.fileName}` : ''}]`;
              if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                ctxText(altText, `<video src="${resource.originalUrl}" controls class="message-video">${altText}</video>`);
              } else {
                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
              }
            }
            break;

          case 4: // ElementType.PTT
            if (element.pttElement) {
              const ptt = element.pttElement;
              let pttHandled = false;
              
              // 尝试使用 NapCat core.apis.FileApi.getPttUrl 获取语音下载URL
              try {
                const bridge = (globalThis as any).__NAPCAT_BRIDGE__;
                
                // 诊断日志：检查必要条件
                if (!bridge?.core?.apis?.FileApi) {
                  console.warn('[Voice] bridge.core.apis.FileApi 不可用');
                } else if (!ptt.fileUuid) {
                  console.warn('[Voice] fileUuid 为空，fileName:', ptt.fileName);
                } else if (!messageRef?.peerUid) {
                  console.warn('[Voice] peerUid 为空');
                } else {
                  // 所有条件满足，尝试获取 URL
                  const pttUrl = await bridge.core.apis.FileApi.getPttUrl(
                    messageRef.peerUid,
                    ptt.fileUuid,
                    5000
                  );
                  
                  if (pttUrl) {
                    console.log('[Voice] 成功获取URL:', pttUrl.substring(0, 100));
                    const resource: ResourceInfo = {
                      type: 'audio',
                      fileName: ptt.fileName || 'audio.amr',
                      fileSize: parseInt(ptt.fileSize?.toString() || '0', 10),
                      originalUrl: pttUrl,
                      md5: ptt.md5HexStr || '',
                      accessible: true,
                      checkedAt
                    };
                    resources.push(resource);

                    const duration = ptt.duration ? `${Math.round(ptt.duration)}秒` : '';
                    const altText = `[语音${duration ? ` ${duration}` : ''}]`;
                    if (this.config.html !== 'none') {
                      ctxText(altText, `<audio src="${pttUrl}" controls class="message-audio">${altText}</audio>`);
                    } else {
                      ctxText(altText, '');
                    }
                    pttHandled = true;
                  } else {
                    console.warn('[Voice] getPttUrl 返回空值');
                  }
                }
              } catch (error) {
                console.error('[Voice] getPttUrl 异常:', error);
              }
              
              // Fallback：使用本地路径
              if (!pttHandled) {
                const resource: ResourceInfo = {
                  type: 'audio',
                  fileName: ptt.fileName || 'audio.amr',
                  fileSize: parseInt(ptt.fileSize?.toString() || '0', 10),
                  originalUrl: ptt.filePath || '',
                  md5: ptt.md5HexStr || '',
                  accessible: false,
                  checkedAt
                };
                resources.push(resource);

                const duration = ptt.duration ? `${Math.round(ptt.duration)}秒` : '';
                const altText = `[语音${duration ? ` ${duration}` : ''}]`;
                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
              }
            }
            break;

            case 3: // ElementType.FILE
            if (element.fileElement) {
              const file = element.fileElement;
              const resource: ResourceInfo = {
                type: 'file',
                fileName: file.fileName || 'file',
                fileSize: parseInt(file.fileSize?.toString() || '0', 10),
                originalUrl: '',
                md5: file.fileMd5 || '',
                accessible: false,
                checkedAt
              };
              resources.push(resource);

              const altText = `[文件: ${resource.fileName}]`;
              if (this.config.html !== 'none' && this.config.includeResourceLinks && resource.originalUrl) {
                ctxText(altText, `<a href="${resource.originalUrl}" class="message-file" download="${resource.fileName}">${altText}</a>`);
              } else {
                ctxText(altText, (this.config.html !== 'none') ? `<span class="resource-placeholder">${altText}</span>` : '');
              }
            }
            break;

            case 6: // ElementType.FACE
            if (element.faceElement) {
              const face = element.faceElement;
              const faceId = face.faceIndex?.toString() || '';
              const faceName = face.faceText || this.faceMap.get(faceId) || `表情${faceId}`;
              emojis.push({ id: faceId, name: faceName, type: 'face' });
              const faceText = `[${faceName}]`;
              ctxText(faceText, (this.config.html !== 'none') ? `<span class="emoji face" data-id="${faceId}">${faceText}</span>` : '');
            }
            break;

            case 11: // ElementType.MFACE
            if (element.marketFaceElement && this.config.parseMarketFace) {
              const marketFace = element.marketFaceElement;
              const faceName = marketFace.faceName || '超级表情';
              const emojiId = marketFace.emojiId || '';
              emojis.push({ id: emojiId, name: faceName, url: undefined, type: 'market' });
              const faceText = `[${faceName}]`;
              ctxText(faceText, (this.config.html !== 'none') ? `<span class="emoji market-face">${faceText}</span>` : '');
            }
            break;

            case 7: // ElementType.REPLY
            if (element.replyElement) {
              // 原生路径不额外抓取被引用正文，保持轻量
              reply = await this.parseReplyElement(element, messageRef);
              const replyText = `[回复 ${reply?.senderName}: ${reply?.content}]`;
              ctxText(`${replyText}\n`, (this.config.html !== 'none')
                ? `<div class="reply">[回复 ${escapeHtmlFast(reply?.senderName || '')}: ${escapeHtmlFast(reply?.content || '')}]</div>`
                : '');
            }
            break;

            case 10: // ElementType.ARK
            if (element.arkElement && this.config.parseCardMessages) {
              card = await this.parseArkElement(element);
              
              // 添加 JSON 卡片到 special，以便正确识别为 type_7
              special.push({
                type: 'json-card',
                data: card,
                description: `卡片消息: ${card?.title || '未知卡片'}`
              });
              
              const t = `[卡片消息: ${card?.title}]`;
              ctxText(t, (this.config.html !== 'none') ? `<div class="card">[卡片消息: ${escapeHtmlFast(card?.title || '')}]</div>` : '');
            }
            break;

            case 16: // ElementType.MULTIFORWARD
            if (element.multiForwardMsgElement && this.config.parseMultiForward) {
              multiForward = await this.parseMultiForwardElement(element);
              
              // 尝试获取合并转发的消息数量
              try {
                const bridge = (globalThis as any).__NAPCAT_BRIDGE__;
                if (bridge?.actions && messageRef?.msgId) {
                  const getForwardAction = bridge.actions.get('get_forward_msg');
                  if (getForwardAction) {
                    const result = await getForwardAction.handle({
                      message_id: messageRef.msgId
                    }, 'plugin', {});
                    
                    if (result?.data?.messages) {
                      multiForward = multiForward || {
                        title: '聊天记录',
                        summary: '合并转发的聊天记录',
                        messageCount: result.data.messages.length,
                        senderNames: []
                      };
                      multiForward.messageCount = result.data.messages.length;
                    }
                  }
                }
              } catch (error) {
                // 获取合并转发详情失败，忽略错误
              }
              
              const count = multiForward?.messageCount || 0;
              const t = count > 0 ? `[合并转发: ${count}条]` : `[合并转发: ${multiForward?.title}]`;
              ctxText(t, (this.config.html !== 'none') ? `<div class="multi-forward">${escapeHtmlFast(t)}</div>` : '');
            }
            break;

            case 28: // ElementType.SHARELOCATION
            if (element.shareLocationElement) {
              location = await this.parseLocationElement(element);
              const t = `[位置: ${location?.title || location?.address}]`;
              ctxText(t, (this.config.html !== 'none') ? `<div class="location">[位置: ${escapeHtmlFast(location?.title || location?.address || '')}]</div>` : '');
            }
            break;

          case ElementType.CALENDAR:
            if (element.calendarElement) {
              calendar = await this.parseCalendarElement(element);
              const t = `[日历: ${calendar?.title}]`;
              ctxText(t, (this.config.html !== 'none') ? `<div class="calendar">[日历: ${escapeHtmlFast(calendar?.title || '')}]</div>` : '');
            }
            break;

            case 14: // ElementType.MARKDOWN
            if (element.markdownElement) {
              const md = element.markdownElement.content || '';
              ctxText(md, (this.config.html !== 'none') ? `<div class="markdown">${escapeHtmlFast(md)}</div>` : '');
            }
            break;

            case 8: // ElementType.GreyTip
            if (element.grayTipElement) {
              const gt = element.grayTipElement.subElementType?.toString() || '系统消息';
              const t = `[${gt}]`;
              ctxText(t, (this.config.html !== 'none') ? `<div class="system-message">[${escapeHtmlFast(gt)}]</div>` : '');
            }
            break;

          default: {
            // 未知类型：尝试通过 get_msg 回退识别
            let handled = false;
            
            try {
              const bridge = (globalThis as any).__NAPCAT_BRIDGE__;
              if (bridge?.actions && messageRef?.msgId) {
                const getMsgAction = bridge.actions.get('get_msg');
                if (getMsgAction) {
                  const result = await getMsgAction.handle({
                    message_id: messageRef.msgId
                  }, 'plugin', {});
                  
                  if (result?.data?.message && Array.isArray(result.data.message)) {
                    // 检查 OneBot segments 中是否有 json 或 forward
                    for (const seg of result.data.message) {
                      if (seg.type === 'json') {
                        // JSON 卡片
                        special.push({
                          type: 'json-card',
                          data: seg.data,
                          description: '卡片消息'
                        });
                        ctxText('[卡片]', (this.config.html !== 'none') ? `<div class="special">[卡片消息]</div>` : '');
                        handled = true;
                        break;
                      } else if (seg.type === 'forward' || seg.type === 'node') {
                        // 合并转发
                        try {
                          const getForwardAction = bridge.actions.get('get_forward_msg');
                          if (getForwardAction) {
                            const fwdResult = await getForwardAction.handle({
                              message_id: messageRef.msgId
                            }, 'plugin', {});
                            const count = fwdResult?.data?.messages?.length || 0;
                            const t = count > 0 ? `[合并转发: ${count}条]` : '[合并转发]';
                            ctxText(t, (this.config.html !== 'none') ? `<div class="special">${escapeHtmlFast(t)}</div>` : '');
                            handled = true;
                            break;
                          }
                        } catch (e) {
                          // 忽略错误
                        }
                      } else if (seg.type === 'contact') {
                        // 分享卡片
                        special.push({
                          type: 'contact-card',
                          data: seg.data,
                          description: '分享卡片'
                        });
                        ctxText('[分享]', (this.config.html !== 'none') ? `<div class="special">[分享卡片]</div>` : '');
                        handled = true;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (error) {
              // 回退识别失败，使用默认处理
            }
            
            // 如果回退识别失败，使用默认处理
            if (!handled) {
              const specialInfo = await this.parseSpecialElement(element);
              if (specialInfo) {
                special.push(specialInfo);
                const d = `[${specialInfo.description}]`;
                ctxText(d, (this.config.html !== 'none') ? `<div class="special">[${escapeHtmlFast(specialInfo.description)}]</div>` : '');
              }
            }
            break;
          }
        }
      } catch (error) {
        this.log(`解析元素失败 (type: ${elementType}): ${error}`, 'warn');
        special.push({
          type: `error_${elementType}`,
          data: element,
          description: `解析失败的元素 (${ElementType[elementType] || elementType})`
        });
        const errT = `[解析失败的消息元素]`;
        ctxText(errT, (this.config.html !== 'none') ? `<span class="parse-error">[解析失败的消息元素]</span>` : '');
      }
    }

    // 注意：@ 提及已在处理 textElement 时通过 atType 正确提取
    // 不再需要从文本中重复解析，避免产生 uid: 'unknown' 的重复条目

    return {
      text: textB.toString().trim(),
      html: this.config.html !== 'none' ? htmlB.toString().trim() : '',
      raw: this.config.rawStrategy === 'string' ? rawB.toString().trim() : '',
      mentions,
      reply,
      resources,
      emojis,
      location,
      card,
      multiForward,
      calendar,
      special
    };
  }

  /** 普通表情/超级表情等已内联在 parseMessageContent */

  private async parseReplyElement(element: MessageElement, messageRef?: RawMessage): Promise<ParsedMessageContent['reply'] | undefined> {
    if (!element.replyElement) return undefined;
    const reply = element.replyElement;
    
    // 使用 replayMsgId 作为被引用消息的真实ID（但要排除 "0" 的情况）
    const replayMsgId = reply.replayMsgId || '';
    let referencedMessageId: string | undefined = (replayMsgId && replayMsgId !== '0') ? replayMsgId : undefined;
    
    // sourceMsgIdInRecords 用于内部查找（在 records 数组中）
    const sourceMsgId = reply.sourceMsgIdInRecords || '';
    
    // 如果 replayMsgId 无效，尝试用 replayMsgSeq 查找
    if (!referencedMessageId && reply.replayMsgSeq) {
      for (const [msgId, msg] of this.messageMap.entries()) {
        if (msg.msgSeq === reply.replayMsgSeq) {
          referencedMessageId = msg.msgId;
          break;
        }
      }
    }
    
    // 再尝试用 replyMsgClientSeq 查找
    if (!referencedMessageId && reply.replyMsgClientSeq) {
      for (const [msgId, msg] of this.messageMap.entries()) {
        if (msg.clientSeq === reply.replyMsgClientSeq) {
          referencedMessageId = msg.msgId;
          break;
        }
      }
    }

    return {
      messageId: sourceMsgId,      // 保留原始的sourceMsgIdInRecords用于内部查找
      referencedMessageId,         // 使用 replayMsgId 作为被引用消息的实际ID
      senderName: reply.senderUidStr || '',
      content: this.extractReplyContent(reply, messageRef),
      elements: []
    };
  }

  private async parseArkElement(element: MessageElement): Promise<ParsedMessageContent['card'] | undefined> {
    if (!element.arkElement || !this.config.parseCardMessages) return undefined;
    const ark = element.arkElement;
    try {
      const data = fastJsonParse(ark.bytesData || '{}');
      return {
        title: data.prompt || data.title || '卡片消息',
        content: data.desc || data.summary || '',
        url: data.url || data.jumpUrl || '',
        preview: data.preview || '',
        type: 'ark'
      };
    } catch (error) {
      this.log(`解析ARK卡片失败: ${error}`, 'warn');
      return {
        title: '卡片消息',
        content: ark.bytesData || '',
        url: '',
        preview: '',
        type: 'ark'
      };
    }
  }

  private async parseMultiForwardElement(element: MessageElement): Promise<ParsedMessageContent['multiForward'] | undefined> {
    if (!element.multiForwardMsgElement || !this.config.parseMultiForward) return undefined;
    const mf = element.multiForwardMsgElement;
    return {
      title: mf.xmlContent || '聊天记录',
      summary: '合并转发的聊天记录',
      messageCount: 0,
      senderNames: []
    };
  }

  private async parseLocationElement(_element: MessageElement): Promise<ParsedMessageContent['location'] | undefined> {
    // 结构未完全公开，保持占位语义不变
    return {
      latitude: 0,
      longitude: 0,
      title: '位置信息',
      address: ''
    };
  }

  private async parseCalendarElement(element: MessageElement): Promise<ParsedMessageContent['calendar'] | undefined> {
    if (!element.calendarElement) return undefined;
    const calendar = element.calendarElement;
    return {
      title: '日历事件',
      startTime: new Date(),
      description: JSON.stringify(calendar)
    };
  }

  private async parseSpecialElement(element: MessageElement): Promise<ParsedMessageContent['special'][0] | null> {
    const t = element.elementType;
    const name = ElementType[t] || `UNKNOWN_${t}`;
    return {
      type: name,
      data: element,
      description: `${name}消息`
    };
  }

  private readonly AT_REGEX = /@[\w\u4e00-\u9fa5]+/g;

  private parseAtMentions(text: string): ParsedMessageContent['mentions'] {
    const mentions: ParsedMessageContent['mentions'] = [];
    if (!text) return mentions;

    if (text.includes('@全体成员') || text.includes('@everyone')) {
      mentions.push({ uid: 'all', name: '全体成员', type: 'all' });
    }

    const matches = text.match(this.AT_REGEX);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        const name = matches[i]!.substring(1);
        mentions.push({ uid: 'unknown', name, type: 'user' });
      }
    }
    return mentions;
  }

  private async parseSenderInfo(message: RawMessage): Promise<ParsedMessage['sender']> {
    const uid = message.senderUid || message.peerUid;
    let userInfo: any = null;

    if (this.config.fetchUserInfo && uid) {
      userInfo = this.userInfoCache.get(uid);
      if (!userInfo) {
        try {
          userInfo = await this.core.apis.UserApi.getUserDetailInfo(uid, false);
          if (userInfo) this.userInfoCache.set(uid, userInfo);
        } catch (error) {
          this.log(`获取用户信息失败 (${uid}): ${error}`, 'warn');
        }
      }
    }

    return {
      uid,
      uin: message.senderUin || userInfo?.uin,
      name: (message.sendNickName && message.sendNickName.trim()) || 
            userInfo?.nick || 
            (message.senderUin && String(message.senderUin)) ||
            undefined,
      avatar: userInfo?.avatarUrl,
      role: undefined
    };
  }

  private parseReceiverInfo(message: RawMessage): ParsedMessage['receiver'] | undefined {
    if (message.chatType === 1) {
      return { uid: message.peerUid, name: undefined, type: 'private' };
    } else if (message.chatType === 2) {
      return { uid: message.peerUid, name: undefined, type: 'group' };
    }
    return undefined;
  }

  private isSystemMessage(message: RawMessage): boolean {
    return (
      message.msgType === NTMsgType.KMSGTYPEGRAYTIPS ||
      (message.elements && message.elements.length === 1 && message.elements[0]?.elementType === ElementType.GreyTip)
    );
  }

  private isRecalledMessage(message: RawMessage): boolean {
    return message.recallTime !== '0' && message.recallTime !== undefined;
  }

  private isTempMessage(message: RawMessage): boolean {
    return message.chatType === 100;
  }

  private extractReplyContent(replyElement: any, messageRef?: RawMessage): string {
    let source: 'messageMap' | 'records' | 'sourceMsgElements' | 'none' = 'none';
    let content = '原消息';
    
    try {
      // 优先使用 sourceMsgIdInRecords
      const sourceMsgId = replyElement.sourceMsgIdInRecords;
      let referencedMessage: RawMessage | undefined;
      
      // 1. 先从全局消息映射中查找
      if (sourceMsgId && this.messageMap.has(sourceMsgId)) {
        referencedMessage = this.messageMap.get(sourceMsgId);
        source = 'messageMap';
      }
      
      // 2. 如果全局映射中找不到，再从 messageRef.records 中查找
      if (!referencedMessage && sourceMsgId && messageRef?.records && messageRef.records.length > 0) {
        referencedMessage = messageRef.records.find((record: RawMessage) => record.msgId === sourceMsgId);
        if (referencedMessage) source = 'records';
      }
      
      // 如果找到了被引用的消息，从中提取内容
      if (referencedMessage && referencedMessage.elements) {
        const b = new ChunkedBuilder();
        for (const element of referencedMessage.elements) {
          if (element.textElement) b.push(element.textElement.content || '');
          else if (element.picElement) b.push('[图片]');
          else if (element.videoElement) b.push('[视频]');
          else if (element.pttElement) b.push('[语音]');
          else if (element.fileElement) b.push(`[文件: ${element.fileElement.fileName || ''}]`);
          else if (element.faceElement) b.push(`[表情${element.faceElement.faceIndex}]`);
          else if (element.marketFaceElement) {
            const faceName = element.marketFaceElement.faceName || '超级表情';
            b.push(`[${faceName}]`);
          }
        }
        const s = b.toString().trim();
        content = s || '原消息';
      } else {
        // 备用方案：从 replyElement.sourceMsgElements 中提取
      const elements = replyElement.sourceMsgElements || [];
        if (elements.length > 0) {
          source = 'sourceMsgElements';
      const b = new ChunkedBuilder();
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.textElement) b.push(el.textElement.content || '');
        else if (el.picElement) b.push('[图片]');
        else if (el.videoElement) b.push('[视频]');
        else if (el.pttElement) b.push('[语音]');
        else if (el.fileElement) b.push(`[文件: ${el.fileElement.fileName || ''}]`);
            else if (el.marketFaceElement) {
              const faceName = el.marketFaceElement.faceName || '超级表情';
              b.push(`[${faceName}]`);
            }
      }
      const s = b.toString().trim();
          content = s || '原消息';
        }
      }
      
      return content;
    } catch (error) {
      console.error('[MessageParser] extractReplyContent 错误:', error);
      return '原消息';
    }
  }

  private createFallbackMessage(message: RawMessage): ParsedMessage {
    const timestamp = dateFromUnixSeconds(message.msgTime);
    // 提取文本
    let textContent = '';
    if (message.elements && message.elements.length > 0) {
      const b = new ChunkedBuilder();
      for (let i = 0; i < message.elements.length; i++) {
        const e = message.elements[i]!;
        if (e.textElement) b.push(e.textElement?.content || '');
      }
      textContent = b.toString().trim();
      if (!textContent) {
        const b2 = new ChunkedBuilder();
        for (let i = 0; i < message.elements.length; i++) {
          const e = message.elements[i]!;
          if (e.picElement) b2.push('[图片]');
          else if (e.videoElement) b2.push('[视频]');
          else if (e.fileElement) b2.push('[文件]');
          else if (e.pttElement) b2.push('[语音]');
          else if (e.faceElement) b2.push('[表情]');
          else if (e.marketFaceElement) b2.push('[表情包]');
          else if (e.replyElement) b2.push('[回复]');
          else b2.push('[消息]');
        }
        textContent = b2.toString() || '[消息内容]';
      }
    }

    return {
      messageId: message.msgId,
      messageSeq: message.msgSeq,
      msgRandom: message.msgRandom,
      timestamp,
      sender: {
        uid: message.senderUid || '0',
        uin: message.senderUin || '0',
        name: (message.sendMemberName && message.sendMemberName.trim()) ||
              (message.sendRemarkName && message.sendRemarkName.trim()) || 
              (message.sendNickName && message.sendNickName.trim()) || 
              (message.senderUin && String(message.senderUin)) ||
              '未知用户',
        nickname: (message.sendNickName && message.sendNickName.trim()) || undefined,
        groupCard: (message.sendMemberName && message.sendMemberName.trim()) || undefined,
        remark: (message.sendRemarkName && message.sendRemarkName.trim()) || undefined
      },
      receiver: {
        uid: message.peerUid,
        type: message.chatType === 2 ? 'group' : 'private'
      },
      messageType: message.msgType,
      isSystemMessage: this.isSystemMessage(message),
      isRecalled: this.isRecalledMessage(message),
      isTempMessage: false,
      content: {
        text: textContent,
        html: this.config.html !== 'none' ? escapeHtmlFast(textContent) : '',
        raw: this.config.rawStrategy === 'string' ? JSON.stringify(message.elements || []) : '',
        mentions: [],
        resources: [],
        emojis: [],
        special: []
      },
      stats: {
        elementCount: message.elements?.length || 0,
        resourceCount: 0,
        textLength: textContent.length,
        processingTime: 0
      },
      rawMessage: message
    };
  }

  private createErrorMessage(originalMessage: RawMessage, error: any): ParsedMessage {
    return {
      messageId: originalMessage.msgId,
      messageSeq: originalMessage.msgSeq,
      timestamp: dateFromUnixSeconds(originalMessage.msgTime),
      sender: {
        uid: originalMessage.senderUid || 'unknown',
        name: (originalMessage.sendNickName && originalMessage.sendNickName.trim()) ||
              (originalMessage.senderUin && String(originalMessage.senderUin)) ||
              '未知用户'
      },
      messageType: originalMessage.msgType,
      isSystemMessage: false,
      isRecalled: false,
      isTempMessage: false,
      content: {
        text: '[消息解析失败]',
        html: this.config.html !== 'none' ? '<span class="error">[消息解析失败]</span>' : '',
        raw: this.config.rawStrategy === 'string' ? JSON.stringify(originalMessage) : '',
        mentions: [],
        resources: [],
        emojis: [],
        special: [
          {
            type: 'error',
            data: error,
            description: '消息解析失败'
          }
        ]
      },
      stats: {
        elementCount: 0,
        resourceCount: 0,
        textLength: 0,
        processingTime: 0
      },
      rawMessage: originalMessage
    };
  }

  private initializeFaceMap(): void {
    this.faceMap.set('0', '微笑');
    this.faceMap.set('1', '撇嘴');
    this.faceMap.set('2', '色');
    this.faceMap.set('3', '发呆');
    this.faceMap.set('4', '得意');
    this.faceMap.set('5', '流泪');
    this.faceMap.set('6', '害羞');
    this.faceMap.set('7', '闭嘴');
    this.faceMap.set('8', '睡');
    this.faceMap.set('9', '大哭');
    this.faceMap.set('10', '尴尬');
    // ...更多表情映射
  }

  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.debugMode && level === 'debug') return;
    const prefix = '[MessageParser]';
    switch (level) {
      case 'debug':
        console.debug(`${prefix} ${message}`);
        break;
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        if (!this.config.suppressFallbackWarn) {
          console.warn(`${prefix} ${message}`);
        }
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
    }
  }

  clearCache(): void {
    this.userInfoCache.clear();
    this.log('缓存已清除');
  }

  getStats(): { userCacheSize: number; faceMappingSize: number } {
    return {
      userCacheSize: this.userInfoCache.size,
      faceMappingSize: this.faceMap.size
    };
  }
}
