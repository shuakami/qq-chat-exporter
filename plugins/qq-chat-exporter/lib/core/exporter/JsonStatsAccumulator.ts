/**
 * 在线统计累加器（供 JsonExporter streaming / chunked-jsonl 两种方案共用）
 * - 不缓存消息体
 * - 只维护必要的聚合统计，避免 OOM
 */

import { CleanMessage } from '../parser/SimpleMessageParser.js';

export class StatsAccumulator {
    private total = 0;
    private startTs: number | null = null;
    private endTs: number | null = null;
    private byType: Record<string, number> = {};
    private bySender: Map<string, { uid: string; name?: string; count: number }> = new Map();
    private resTotal = 0;
    private resByType: Record<string, number> = {};
    private resTotalSize = 0;

    consume(m: CleanMessage | any): void {
        this.total++;

        // 兼容三种格式的 timestamp：
        // - CleanMessage: timestamp (number, milliseconds)
        // - ParsedMessage: timestamp (Date object)
        // - 字符串格式: timestamp (ISO string)
        let ts: number | null = null;
        if (typeof m.timestamp === 'number') {
            ts = m.timestamp;
        } else if (m.timestamp instanceof Date) {
            ts = m.timestamp.getTime();
        } else if (typeof m.timestamp === 'string') {
            const parsed = Date.parse(m.timestamp);
            if (!isNaN(parsed)) ts = parsed;
        }
        if (ts !== null && ts > 0) {
            if (this.startTs === null || ts < this.startTs) this.startTs = ts;
            if (this.endTs === null || ts > this.endTs) this.endTs = ts;
        }

        // 兼容两种格式的 type：
        // - CleanMessage: type (string like 'text', 'image')
        // - ParsedMessage: messageType (number)
        let t = 'unknown';
        if (typeof m.type === 'string' && m.type) {
            t = m.type;
        } else if (typeof m.messageType === 'number') {
            // 将 messageType 数字转换为字符串
            const typeMap: Record<number, string> = {
                1: 'text', 2: 'text', 3: 'file', 4: 'json', 5: 'system',
                6: 'audio', 7: 'video', 8: 'forward', 9: 'reply', 11: 'json'
            };
            t = typeMap[m.messageType] || `type_${m.messageType}`;
        }
        this.byType[t] = (this.byType[t] || 0) + 1;

        const senderKey = m.sender?.uid || 'unknown';
        const prev = this.bySender.get(senderKey) || { uid: senderKey, name: m.sender?.name, count: 0 };
        prev.count++;
        if (!prev.name && m.sender?.name) prev.name = m.sender.name;
        this.bySender.set(senderKey, prev);

        const resArr = m.content?.resources || [];
        for (const r of resArr) {
            this.resTotal++;
            const rt = r.type || 'file';
            this.resByType[rt] = (this.resByType[rt] || 0) + 1;
            // 兼容两种格式的 size：size 或 fileSize
            const size = typeof r.size === 'number' ? r.size :
                typeof r.fileSize === 'number' ? r.fileSize : 0;
            this.resTotalSize += size;
        }
    }

    finalize() {
        const durationDays = (this.startTs !== null && this.endTs !== null)
            ? Math.max(1, Math.round((this.endTs - this.startTs) / (24 * 3600 * 1000)))
            : 0;

        const senders = Array.from(this.bySender.values())
            .map(s => ({
                uid: s.uid,
                name: s.name,
                messageCount: s.count,
                percentage: this.total > 0 ? Math.round((s.count / this.total) * 10000) / 100 : 0
            }))
            .sort((a, b) => b.messageCount - a.messageCount);

        return {
            totalMessages: this.total,
            timeRange: {
                start: this.startTs ? new Date(this.startTs).toISOString() : '',
                end: this.endTs ? new Date(this.endTs).toISOString() : '',
                durationDays
            },
            messageTypes: this.byType,
            senders,
            resources: {
                total: this.resTotal,
                byType: this.resByType,
                totalSize: this.resTotalSize
            }
        };
    }
}
