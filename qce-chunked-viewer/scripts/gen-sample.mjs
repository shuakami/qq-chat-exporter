/**
 * Generates a dev sample in public/ shaped exactly like a real
 * qq-chat-export-core chunked export (manifest.js, chunk JSONP files,
 * bucketed msgid index, MODERN_CSS as assets/style.css).
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
mkdirSync(resolve(pub, 'data/chunks'), { recursive: true });
mkdirSync(resolve(pub, 'data/index'), { recursive: true });
mkdirSync(resolve(pub, 'assets'), { recursive: true });
copyFileSync(
  resolve(root, '../qq-chat-export-core/assets/modern_css.css'),
  resolve(pub, 'assets/style.css'),
);

const TOTAL = 20_000;
const PER_CHUNK = 500;
const TEXT_BITS = 16384;
const TEXT_HASHES = 3;
const SENDER_BITS = 2048;
const SENDER_HASHES = 2;
const BUCKETS = 32;

function fnv1a32(units, from, to, seed) {
  let h = seed >>> 0 || 0x811c9dc5;
  for (let k = from; k < to; k++) {
    h ^= units[k] & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const H2 = (0x811c9dc5 ^ 0x5bd1e995) >>> 0;
function toUnits(s) {
  const u = new Uint16Array(s.length);
  for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
  return u;
}
class Bloom {
  constructor(bits, hashes) {
    this.bits = bits;
    this.hashes = hashes;
    this.bytes = new Uint8Array(Math.ceil(bits / 8));
  }
  addRange(u, a, b) {
    const h1 = fnv1a32(u, a, b, 0x811c9dc5);
    const h2 = fnv1a32(u, a, b, H2);
    for (let i = 0; i < this.hashes; i++) {
      const idx = (h1 + i * h2) % this.bits >>> 0;
      this.bytes[idx >> 3] |= 1 << (idx & 7);
    }
  }
  addToken(s) {
    const u = toUnits(s);
    if (u.length) this.addRange(u, 0, u.length);
  }
  addText(lower) {
    const u = toUnits(lower);
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= u.length; i++) this.addRange(u, i, i + n);
    }
  }
  b64() {
    return Buffer.from(this.bytes).toString('base64');
  }
}
function fnvStr(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SENDERS = [
  ['u_alice', 'Alice', '10001'],
  ['u_bob', '阿黄', '10002'],
  ['u_carol', 'Carol·测试', '10003'],
  ['u_dave', '大卫', '10004'],
  ['u_self', '我自己', '10005'],
];
const TEXTS = [
  '今天的会议改到下午三点了，大家记得参加。',
  '哈哈哈哈这个太搞笑了',
  '收到，我马上处理这个 bug，预计半小时修完。',
  '周末要不要一起去爬山？天气预报说是晴天。',
  'The quick brown fox jumps over the lazy dog',
  '这个需求文档我看完了，有几个问题想确认一下。',
  '晚饭吃什么？火锅还是烧烤？',
  '刚发布的版本有点问题，我先回滚了。',
  '好的没问题，明天见！',
  '你们看了昨天的比赛吗？绝杀太精彩了',
];
const IMG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#7aa5d2"/><text x="160" y="105" font-size="20" text-anchor="middle" fill="#fff">sample image</text></svg>',
  ).toString('base64');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const START = Date.UTC(2024, 0, 3, 1, 0, 0);
const records = [];
for (let i = 0; i < TOTAL; i++) {
  const [uid, name, uin] = SENDERS[i % SENDERS.length];
  const self = uid === 'u_self';
  const ts = START + i * 47_000;
  const d = new Date(ts);
  const dateKey = d.toISOString().slice(0, 10);
  const timeStr = d.toISOString().slice(11, 19);
  const id = `msg-${100000 + i}`;
  let text = TEXTS[i % TEXTS.length];
  let content;
  const mod = i % 37;
  if (mod === 5) {
    content = `<div class="image-content"><img src="${IMG}" alt="图片" loading="lazy" onclick="showImageModal(this.src)"></div>`;
    text = '[图片]';
  } else if (mod === 11) {
    content = `<div class="audio-wrapper"><audio class="message-audio" src="resources/voice_${i}.wav" controls preload="none"></audio><a class="audio-download-link" href="resources/voice_${i}.wav" download>下载语音</a></div>`;
    text = '[语音]';
  } else if (mod === 17) {
    content = `<video class="message-video" src="resources/video_${i}.mp4" controls preload="none"></video>`;
    text = '[视频]';
  } else if (mod === 23) {
    content = `<div class="message-file"><a href="resources/file_${i}.zip" download="报表_${i}.zip">📄 报表_${i}.zip (1.2 MB)</a></div>`;
    text = '[文件] 报表_' + i + '.zip';
  } else if (mod === 29 && i > 40) {
    const target = 100000 + i - 40;
    content = `<div class="reply-content" data-reply-to="msg-${target}" onclick="scrollToMessage('msg-${target}')"><div class="reply-content-header"><strong>${esc(name)}</strong></div><div class="reply-content-text">回复上面的消息</div></div><div class="text-content">${esc(text)}</div>`;
  } else {
    content = `<div class="text-content">${esc(text)}</div>`;
  }
  const html = `
        <div class="message-block" data-date="${dateKey}">
            <div class="message ${self ? 'self' : 'other'}" data-date="${dateKey}" data-sender-uid="${uid}" id="${id}">
                <div class="avatar"><span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${esc(name[0])}</span></div>
                <div class="message-wrapper">
                    <div class="message-header">
                        <span class="sender">${esc(name)}</span>
                        <span class="time">${timeStr}</span>
                    </div>
                    <div class="message-bubble">
                        <div class="content">${content}</div>
                    </div>
                </div>
            </div>
        </div>`;
  records.push({
    id,
    ts,
    date: dateKey,
    uid,
    name,
    nameLower: name.toLowerCase(),
    text,
    textTruncated: false,
    html,
    _uin: uin,
  });
}

const chunksMeta = [];
const buckets = Array.from({ length: BUCKETS }, () => []);
for (let c = 0; c * PER_CHUNK < TOTAL; c++) {
  const slice = records.slice(c * PER_CHUNK, (c + 1) * PER_CHUNK);
  const id = `c${String(c).padStart(4, '0')}`;
  const tb = new Bloom(TEXT_BITS, TEXT_HASHES);
  const sb = new Bloom(SENDER_BITS, SENDER_HASHES);
  for (const r of slice) {
    tb.addText(`${r.text.toLowerCase()} ${r.nameLower}`);
    sb.addToken(r.uid);
    buckets[fnvStr(r.id, 0x811c9dc5) % BUCKETS].push([r.id, id]);
  }
  const msgs = slice.map(({ _uin, ...r }) => r);
  writeFileSync(
    resolve(pub, `data/chunks/${id}.js`),
    `window.__QCE_CHUNK__ && window.__QCE_CHUNK__(${JSON.stringify({ id, messages: msgs })});\n`,
  );
  chunksMeta.push({
    id,
    file: `data/chunks/${id}.js`,
    count: slice.length,
    startTs: slice[0].ts,
    endTs: slice[slice.length - 1].ts,
    startDate: slice[0].date,
    endDate: slice[slice.length - 1].date,
    textBloom: tb.b64(),
    textBloomIncomplete: false,
    senderBloom: sb.b64(),
    firstMsgId: slice[0].id,
    lastMsgId: slice[slice.length - 1].id,
    bytes: 0,
  });
}
buckets.forEach((pairs, i) => {
  const hex = i.toString(16).padStart(2, '0');
  writeFileSync(
    resolve(pub, `data/index/msgid_b${hex}.js`),
    `window.__QCE_MSGID_INDEX__ && window.__QCE_MSGID_INDEX__(${i}, ${JSON.stringify(pairs)});\n`,
  );
});

const senderCounts = {};
for (const r of records) senderCounts[r.uid] = (senderCounts[r.uid] ?? 0) + 1;
const manifest = {
  format: 'qce-modern-html-chunked',
  version: 1,
  exportTime: new Date().toISOString(),
  chat: { name: '测试群聊（样例数据）', type: 'group', avatar: '', selfUid: 'u_self' },
  stats: {
    totalMessages: TOTAL,
    firstTime: new Date(records[0].ts).toISOString(),
    lastTime: new Date(records[TOTAL - 1].ts).toISOString(),
    timeRangeText: '',
    minDateKey: records[0].date,
    maxDateKey: records[TOTAL - 1].date,
  },
  chunking: { maxMessagesPerChunk: PER_CHUNK, maxChunkBytes: 2_000_000 },
  bloom: {
    textBits: TEXT_BITS,
    textHashes: TEXT_HASHES,
    senderBits: SENDER_BITS,
    senderHashes: SENDER_HASHES,
  },
  msgidIndex: { bucketCount: BUCKETS, dir: 'data/index', filePrefix: 'msgid_b', fileExt: '.js' },
  paths: {
    assetsDir: 'assets',
    dataDir: 'data',
    chunksDir: 'data/chunks',
    indexDir: 'data/index',
    resourcesDir: 'resources',
  },
  senders: SENDERS.map(([uid, name]) => ({
    uid,
    displayName: name,
    aliases: [name],
    count: senderCounts[uid] ?? 0,
  })),
  chunks: chunksMeta,
};
writeFileSync(
  resolve(pub, 'data/manifest.js'),
  `window.__QCE_MANIFEST__ && window.__QCE_MANIFEST__(${JSON.stringify(manifest)});\n`,
);
console.log(`sample: ${TOTAL} messages in ${chunksMeta.length} chunks -> public/`);
