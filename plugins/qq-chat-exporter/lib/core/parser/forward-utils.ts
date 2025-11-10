import type { NapCatCore } from 'NapCatQQ/src/core/index.js';

export interface ForwardMessageEntry {
  senderName: string;
  senderUid?: string;
  senderUin?: string;
  messageId?: string;
  time?: string;
  text: string;
  raw?: any;
}

interface ForwardFetchOptions {
  core?: NapCatCore | null;
  element?: any;
  messageId?: string;
  bridge?: any;
}

export interface ForwardMetadata {
  title?: string;
  summary?: string;
}

const CANDIDATE_ID_KEYS = [
  'resId',
  'res_id',
  'resid',
  'forwardResId',
  'forward_resid',
  'forwardId',
  'forward_id',
  'id',
  'fileResid',
  'file_resid',
  'fileId',
  'file_id',
  'msgResid',
  'msg_resid'
];

export async function fetchForwardMessagesFromContext(options: ForwardFetchOptions): Promise<ForwardMessageEntry[]> {
  const rawNodes = await resolveForwardRawNodes(options);
  if (!rawNodes.length) return [];
  return normalizeForwardNodes(rawNodes);
}

export function extractForwardMetadata(xml?: string | null): ForwardMetadata {
  if (!xml) return {};
  const text = String(xml);

  const title = decodeXmlEntities(
    matchFirst(text, /<title>([^<]+)<\/title>/i, 1) ||
    matchFirst(text, /title="([^"]+)"/i, 1) ||
    matchFirst(text, /title='([^']+)'/i, 1)
  );

  const summary = decodeXmlEntities(
    matchFirst(text, /<summary>([^<]+)<\/summary>/i, 1) ||
    matchFirst(text, /summary="([^"]+)"/i, 1) ||
    matchFirst(text, /summary='([^']+)'/i, 1)
  );

  const result: ForwardMetadata = {};
  if (title) result.title = title;
  if (summary) result.summary = summary;
  return result;
}

function matchFirst(text: string, regex: RegExp, index: number): string | undefined {
  const match = regex.exec(text);
  if (match && match[index]) {
    return match[index];
  }
  return undefined;
}

function decodeXmlEntities(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .trim();
}

async function resolveForwardRawNodes(options: ForwardFetchOptions): Promise<any[]> {
  const candidateIds = collectCandidateIds(options.element);
  if (options.messageId) {
    candidateIds.add(String(options.messageId));
  }

  const ids = Array.from(candidateIds.values()).filter(Boolean);
  const core = options.core as any;

  if (core?.apis) {
    const msgApi = core.apis.MsgApi || core.apis.msg;
    const getMultiMsg = msgApi?.getMultiMsg;
    if (typeof getMultiMsg === 'function') {
      for (const id of ids) {
        try {
          const params: any = {};
          if (id) {
            params.forwardId = id;
            params.resId = id;
          }
          const data = await getMultiMsg.call(msgApi, params);
          const arr = extractArrayFromResult(data);
          if (arr.length) return arr;
        } catch (error) {
          // ignore and fallback
        }
      }
    }
  }

  const bridge = options.bridge ?? (globalThis as any)?.__NAPCAT_BRIDGE__;
  const getForwardAction = bridge?.actions?.get?.('get_forward_msg');
  if (getForwardAction) {
    const tryIds = ids.length > 0 ? ids : [undefined];
    for (const id of tryIds) {
      const payload: any = {};
      if (options.messageId) payload.message_id = options.messageId;
      if (id) payload.id = id;
      try {
        const result = await getForwardAction.handle(payload, 'plugin', bridge?.instance?.config ?? {});
        const arr = extractArrayFromResult(result?.data ?? result);
        if (arr.length) return arr;
      } catch (error) {
        // ignore and continue
      }
    }
  }

  return [];
}

function collectCandidateIds(element: any): Set<string> {
  const ids = new Set<string>();
  if (!element || typeof element !== 'object') return ids;

  for (const key of CANDIDATE_ID_KEYS) {
    const value = (element as any)[key];
    const str = normalizeIdValue(value);
    if (str) ids.add(str);
  }

  if (typeof element === 'object') {
    const data = (element as any).multiMsgItem || (element as any).multiForwardMsgItem;
    if (data && typeof data === 'object') {
      for (const key of CANDIDATE_ID_KEYS) {
        const str = normalizeIdValue((data as any)[key]);
        if (str) ids.add(str);
      }
    }
  }

  return ids;
}

function normalizeIdValue(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return undefined;
}

function extractArrayFromResult(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.msgs)) return data.msgs;
  if (Array.isArray(data.msgList)) return data.msgList;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.message)) return data.message;
  if (Array.isArray(data.records)) return data.records;

  if (data.result) {
    const result = extractArrayFromResult(data.result);
    if (result.length) return result;
  }
  if (data.data && data !== data.data) {
    const nested = extractArrayFromResult(data.data);
    if (nested.length) return nested;
  }
  return [];
}

function normalizeForwardNodes(nodes: any[]): ForwardMessageEntry[] {
  const results: ForwardMessageEntry[] = [];
  for (const node of nodes) {
    const normalized = normalizeSingleForwardNode(node);
    if (normalized) {
      results.push(normalized);
    }
  }
  return results;
}

function normalizeSingleForwardNode(node: any): ForwardMessageEntry | null {
  if (!node) return null;

  const dataPart = typeof node.data === 'object' && node.data ? node.data : undefined;
  const sender = node.sender || dataPart?.sender;

  let senderName = pickString(
    node.senderName,
    node.sender_name,
    node.nickname,
    node.nick,
    node.name,
    node.title,
    dataPart?.name,
    dataPart?.nickname,
    dataPart?.title,
    sender?.nickname,
    sender?.name,
    sender?.card
  );

  let senderUid = pickString(
    node.senderUid,
    node.sender_uid,
    node.uid,
    node.user_id,
    dataPart?.uid,
    dataPart?.user_id,
    sender?.user_id,
    sender?.uid
  );

  let senderUin = pickString(
    node.senderUin,
    node.sender_uin,
    node.uin,
    node.qq,
    dataPart?.uin,
    dataPart?.qq,
    sender?.uin,
    sender?.user_id
  );

  let messageId = pickString(
    node.messageId,
    node.message_id,
    node.msgId,
    node.msg_id,
    dataPart?.message_id,
    dataPart?.id
  );

  let timeValue: any =
    node.time ??
    node.timestamp ??
    node.msgTime ??
    node.msg_time ??
    dataPart?.time ??
    dataPart?.timeStamp ??
    sender?.time;

  let segments: any[] = [];

  if (Array.isArray(node.elements)) {
    segments = node.elements;
  }

  if (!segments.length && Array.isArray(node.message)) {
    segments = node.message;
  }

  if (!segments.length && Array.isArray(node.messages)) {
    segments = node.messages;
  }

  if (!segments.length && Array.isArray(node.content)) {
    const first = node.content.find((seg: any) => seg?.type === 'node' || seg?.type === 'forward') || node.content[0];
    if (first) {
      const inner = first.data || first;
      const innerSegments = toArray(inner?.content ?? inner?.message ?? first.content);
      if (innerSegments.length) segments = innerSegments;
      senderName = senderName || pickString(inner?.name, inner?.nickname, inner?.title);
      senderUid = senderUid || pickString(inner?.user_id, inner?.uid);
      senderUin = senderUin || pickString(inner?.uin, inner?.qq);
      messageId = messageId || pickString(inner?.message_id, inner?.id);
      timeValue = timeValue ?? inner?.time ?? inner?.timeStamp;
    } else {
      segments = toArray(node.content);
    }
  }

  if (!segments.length && dataPart) {
    const maybeSegments = toArray(dataPart.content ?? dataPart.message ?? dataPart.elements);
    if (maybeSegments.length) segments = maybeSegments;
  }

  const text = flattenForwardSegments(segments);
  const timeIso = normalizeTime(timeValue);

  return {
    senderName: senderName || '未知用户',
    senderUid,
    senderUin,
    messageId,
    time: timeIso,
    text: text || '[空消息]',
    raw: node
  };
}

function toArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function pickString(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
  }
  return undefined;
}

function flattenForwardSegments(segments: any[]): string {
  if (!segments || segments.length === 0) return '';
  const parts: string[] = [];
  for (const seg of segments) {
    const text = flattenForwardSegment(seg);
    if (text) parts.push(text);
  }
  return parts.join('');
}

function flattenForwardSegment(segment: any): string {
  if (!segment) return '';

  if (Array.isArray(segment)) {
    return flattenForwardSegments(segment);
  }

  if (typeof segment === 'string') {
    return segment;
  }

  if (typeof segment === 'number' && Number.isFinite(segment)) {
    return String(segment);
  }

  if (segment.textElement) {
    return segment.textElement.content || '';
  }
  if (segment.faceElement) {
    const face = segment.faceElement;
    const name = pickString(face.faceText, face.index);
    return `[${name || '表情'}]`;
  }
  if (segment.marketFaceElement) {
    const mf = segment.marketFaceElement;
    return `[${pickString(mf.faceName, mf.emojiId) || '表情'}]`;
  }
  if (segment.picElement) {
    return '[图片]';
  }
  if (segment.videoElement) {
    return '[视频]';
  }
  if (segment.pttElement) {
    return '[语音]';
  }
  if (segment.fileElement) {
    const file = segment.fileElement;
    const name = pickString(file.fileName);
    return `[文件${name ? `:${name}` : ''}]`;
  }
  if (segment.replyElement) {
    return '[回复消息]';
  }
  if (segment.shareLocationElement) {
    return '[位置消息]';
  }
  if (segment.arkElement) {
    return '[卡片消息]';
  }
  if (segment.markdownElement) {
    return segment.markdownElement.content || '[Markdown消息]';
  }

  const type = segment.type || segment.elementType;
  if (type) {
    switch (type) {
      case 'text':
        return pickString(segment.text, segment.data?.text, segment.data?.content, segment.data?.value) || '';
      case 'node':
      case 'forward':
        return flattenForwardSegments(toArray(segment.data?.content ?? segment.content ?? segment.data?.message));
      case 'at': {
        const name = pickString(segment.data?.text, segment.data?.qq, segment.data?.name, segment.qq, segment.name);
        return name ? `@${name}` : '@未知';
      }
      case 'face':
      case 'emoji': {
        const label = pickString(segment.data?.id, segment.data?.text, segment.data?.name, segment.text);
        return `[表情${label ? `:${label}` : ''}]`;
      }
      case 'image':
      case 'pic':
      case 'image_file':
        return '[图片]';
      case 'video':
        return '[视频]';
      case 'record':
      case 'voice':
      case 'audio':
      case 'ptt':
        return '[语音]';
      case 'reply':
        return '[回复消息]';
      case 'json':
      case 'card':
        return '[卡片消息]';
      case 'xml':
        return '[XML消息]';
      case 'location':
        return '[位置信息]';
      case 'file': {
        const name = pickString(segment.data?.name, segment.data?.file, segment.data?.filename, segment.data?.title);
        return `[文件${name ? `:${name}` : ''}]`;
      }
      case 'markdown':
        return segment.data?.content || '[Markdown消息]';
      default:
        if (segment.data?.text) return segment.data.text;
        break;
    }
  }

  if (typeof segment.text === 'string') {
    return segment.text;
  }

  if (typeof segment.content === 'string') {
    return segment.content;
  }

  if (Array.isArray(segment.content)) {
    return flattenForwardSegments(segment.content);
  }

  if (segment.children) {
    return flattenForwardSegments(toArray(segment.children));
  }

  if (segment.summary) {
    return String(segment.summary);
  }

  if (segment.title) {
    return String(segment.title);
  }

  return '';
}

function normalizeTime(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isNaN(time)) {
      return value.toISOString();
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return normalizeNumericTime(n);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeNumericTime(value);
  }

  if (typeof value === 'bigint') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return normalizeNumericTime(n);
    }
  }

  return undefined;
}

function normalizeNumericTime(value: number): string | undefined {
  const ms = value > 1e12 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
