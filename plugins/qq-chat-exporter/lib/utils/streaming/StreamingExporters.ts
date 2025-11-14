import fs from 'fs';
import path from 'path';
import { once } from 'events';
import * as XLSX from 'xlsx';
import { CleanMessage } from '../../core/parser/SimpleMessageParser.js';
import { CleanMessageSpooler } from './CleanMessageSpooler.js';
import { StreamingStatistics } from './StreamingStatsAggregator.js';

interface ChatInfo {
  name: string;
  type: 'group' | 'private';
  avatar?: string;
  participantCount?: number;
}

interface ExportOptions {
  encoding?: string;
  includeResourceLinks?: boolean;
  includeSystemMessages?: boolean;
  prettyFormat?: boolean;
  sheetName?: string;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatIso(timestamp: number | null): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toISOString();
}

function indentMultiline(text: string, indent: string): string {
  if (!indent) return text;
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');
}

function buildStatisticsPayload(stats: StreamingStatistics) {
  const senderArray = Array.from(stats.senders.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      uid: entry.uid,
      name: entry.name,
      messageCount: entry.count,
      percentage:
        stats.totalMessages > 0
          ? Math.round((entry.count / stats.totalMessages) * 10000) / 100
          : 0,
    }));

  const resourceByType: Record<string, number> = {};
  for (const [type, data] of stats.resources.byType.entries()) {
    resourceByType[type] = data.count;
  }

  return {
    totalMessages: stats.totalMessages,
    timeRange: {
      start: formatIso(stats.firstTimestamp),
      end: formatIso(stats.lastTimestamp),
      durationDays:
        stats.firstTimestamp && stats.lastTimestamp
          ? Math.round((stats.lastTimestamp - stats.firstTimestamp) / (24 * 60 * 60 * 1000))
          : 0,
    },
    messageTypes: Object.fromEntries(stats.messageTypes.entries()),
    senders: senderArray,
    resources: {
      total: stats.resources.total,
      totalSize: stats.resources.totalSize,
      byType: resourceByType,
    },
  };
}

export async function exportJsonStreaming(
  outputPath: string,
  spooler: CleanMessageSpooler,
  stats: StreamingStatistics,
  chatInfo: ChatInfo,
  options: ExportOptions
): Promise<void> {
  ensureDir(outputPath);

  const pretty = options.prettyFormat !== false;
  const indentSize = pretty ? 2 : 0;
  const newline = pretty ? '\n' : '';
  const indent1 = pretty ? ' '.repeat(indentSize) : '';
  const indent2 = pretty ? ' '.repeat(indentSize * 2) : '';
  const metadata = {
    name: 'QQ Chat Exporter',
    version: '4.9.0',
    generator: 'streaming-json-exporter',
    exportTime: new Date().toISOString(),
  };

  const chatPayload = {
    name: chatInfo.name,
    type: chatInfo.type,
    avatar: chatInfo.avatar || null,
    participantCount: chatInfo.participantCount ?? null,
  };

  const statisticsPayload = buildStatisticsPayload(stats);

  const ws = fs.createWriteStream(outputPath, {
    encoding: (options.encoding || 'utf8') as BufferEncoding,
  });

  ws.write('{' + newline);
  ws.write(
    indent1 + '"metadata": ' +
      indentMultiline(JSON.stringify(metadata, null, indentSize), indent1) +
      ',' +
      newline
  );
  ws.write(
    indent1 + '"chatInfo": ' +
      indentMultiline(JSON.stringify(chatPayload, null, indentSize), indent1) +
      ',' +
      newline
  );
  ws.write(
    indent1 + '"statistics": ' +
      indentMultiline(JSON.stringify(statisticsPayload, null, indentSize), indent1) +
      ',' +
      newline
  );
  ws.write(indent1 + '"messages": [' + newline);

  let first = true;
  for await (const message of spooler.iterateMessages()) {
    const serialized = JSON.stringify(message, null, indentSize);
    if (!first) {
      ws.write(',' + newline);
    }
    ws.write(indent2 + indentMultiline(serialized, indent2));
    first = false;
  }

  ws.write(newline + indent1 + ']' + newline + '}');
  ws.end();
  await once(ws, 'finish');
}

function formatTextMessage(message: CleanMessage, index: number): string {
  const timestamp = new Date(message.timestamp).toLocaleString('zh-CN', {
    hour12: false,
  });
  const sender = message.sender?.name || message.sender?.uid || '未知用户';
  const lines: string[] = [];
  lines.push(`[#${index}] ${timestamp} ${sender}`);

  const textParts: string[] = [];
  if (message.content?.text) {
    textParts.push(message.content.text);
  }
  if (message.content?.resources?.length) {
    const resourceText = message.content.resources
      .map((res) => `[${res.type}: ${res.filename || res.localPath || '资源'}]`)
      .join(' ');
    if (resourceText) {
      textParts.push(resourceText);
    }
  }

  const finalText = textParts.length > 0 ? textParts.join('\n') : '[无文本内容]';
  lines.push(finalText);

  return lines.join('\n') + '\n';
}

export async function exportTextStreaming(
  outputPath: string,
  spooler: CleanMessageSpooler,
  stats: StreamingStatistics,
  chatInfo: ChatInfo,
  options: ExportOptions
): Promise<void> {
  ensureDir(outputPath);
  const ws = fs.createWriteStream(outputPath, {
    encoding: (options.encoding || 'utf8') as BufferEncoding,
  });

  const headerLines = [
    '[QQChatExporter V4 / Streaming Mode]',
    '[感谢使用QQ聊天记录导出工具 - https://github.com/shuakami/qq-chat-exporter]',
    '',
    '===============================================',
    '           QQ聊天记录导出文件',
    '===============================================',
    '',
    `聊天名称: ${chatInfo.name}`,
    `聊天类型: ${chatInfo.type === 'group' ? '群聊' : '私聊'}`,
    `导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    stats.totalMessages > 0
      ? `消息时间范围: ${formatIso(stats.firstTimestamp)} ~ ${formatIso(stats.lastTimestamp)}`
      : '消息时间范围: --',
    `消息总数: ${stats.totalMessages}`,
    '',
  ];
  ws.write(headerLines.join('\n') + '\n');

  let index = 0;
  for await (const message of spooler.iterateMessages()) {
    index += 1;
    ws.write(formatTextMessage(message, index));
  }

  ws.write('\n===============================================\n');
  ws.write('导出完成，感谢使用！\n');
  ws.end();
  await once(ws, 'finish');
}

function extractMessageContent(message: CleanMessage): string {
  if (message.content?.text) {
    return message.content.text;
  }
  if (message.content?.elements?.length) {
    const text = message.content.elements
      .filter((el) => el.type === 'text')
      .map((el) => el.data?.text || '')
      .join(' ');
    if (text.trim()) return text;
  }
  if (message.content?.resources?.length) {
    return message.content.resources
      .map((res) => `[${res.type}: ${res.filename || res.localPath || '资源'}]`)
      .join(' ');
  }
  return '[空消息]';
}

export async function exportExcelStreaming(
  outputPath: string,
  spooler: CleanMessageSpooler,
  stats: StreamingStatistics,
  chatInfo: ChatInfo,
  options: ExportOptions
): Promise<void> {
  ensureDir(outputPath);

  const workbook = XLSX.utils.book_new();
  const sheetName = options.sheetName || '聊天记录';
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['序号', '时间', '发送者', '消息类型', '内容', '是否撤回', '资源数量'],
  ]);

  let index = 0;
  for await (const message of spooler.iterateMessages()) {
    index += 1;
    const resourceCount = message.content?.resources?.length || 0;
    const row = [
      index,
      new Date(message.timestamp).toLocaleString('zh-CN', { hour12: false }),
      message.sender?.name || message.sender?.uid || '未知用户',
      message.type,
      extractMessageContent(message),
      message.recalled ? '是' : '否',
      resourceCount,
    ];
    XLSX.utils.sheet_add_aoa(worksheet, [row], { origin: -1 });
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const statsPayload = buildStatisticsPayload(stats);
  const statsSheetData = [
    ['统计项目', '数值'],
    ['消息总数', statsPayload.totalMessages],
    ['开始时间', statsPayload.timeRange.start],
    ['结束时间', statsPayload.timeRange.end],
    ['时间跨度(天)', statsPayload.timeRange.durationDays],
    [''],
    ['消息类型', '数量'],
    ...Object.entries(statsPayload.messageTypes),
  ];
  const statsSheet = XLSX.utils.aoa_to_sheet(statsSheetData);
  XLSX.utils.book_append_sheet(workbook, statsSheet, '统计信息');

  const senderSheetData = [
    ['排名', '发送者', 'UID', '消息数量', '占比(%)'],
    ...statsPayload.senders.map((sender, idx) => [
      idx + 1,
      sender.name,
      sender.uid,
      sender.messageCount,
      sender.percentage,
    ]),
  ];
  const senderSheet = XLSX.utils.aoa_to_sheet(senderSheetData);
  XLSX.utils.book_append_sheet(workbook, senderSheet, '发送者统计');

  const resourceSheetData = [
    ['资源类型', '数量'],
    ...Object.entries(statsPayload.resources.byType),
  ];
  const resourceSheet = XLSX.utils.aoa_to_sheet(resourceSheetData);
  XLSX.utils.book_append_sheet(workbook, resourceSheet, '资源统计');

  XLSX.writeFile(workbook, outputPath, { bookType: 'xlsx' });
}
