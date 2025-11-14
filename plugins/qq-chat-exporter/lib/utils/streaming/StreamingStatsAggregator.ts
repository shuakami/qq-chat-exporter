import { CleanMessage } from '../../core/parser/SimpleMessageParser.js';

export interface ResourceStats {
  total: number;
  totalSize: number;
  byType: Map<string, { count: number; size: number }>;
}

export interface SenderStatsEntry {
  uid: string;
  name: string;
  count: number;
}

export interface StreamingStatistics {
  totalMessages: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  messageTypes: Map<string, number>;
  senders: Map<string, SenderStatsEntry>;
  resources: ResourceStats;
}

export class StreamingStatsAggregator {
  private readonly stats: StreamingStatistics = {
    totalMessages: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    messageTypes: new Map(),
    senders: new Map(),
    resources: {
      total: 0,
      totalSize: 0,
      byType: new Map(),
    },
  };

  addMessage(message: CleanMessage): void {
    this.stats.totalMessages += 1;
    if (this.stats.firstTimestamp === null || message.timestamp < this.stats.firstTimestamp) {
      this.stats.firstTimestamp = message.timestamp;
    }
    if (this.stats.lastTimestamp === null || message.timestamp > this.stats.lastTimestamp) {
      this.stats.lastTimestamp = message.timestamp;
    }

    const type = message.type || 'unknown';
    this.stats.messageTypes.set(type, (this.stats.messageTypes.get(type) || 0) + 1);

    const senderKey = message.sender.uid || message.sender.name || 'unknown';
    const senderEntry = this.stats.senders.get(senderKey) || {
      uid: message.sender.uid || senderKey,
      name: message.sender.name || senderKey,
      count: 0,
    };
    senderEntry.count += 1;
    this.stats.senders.set(senderKey, senderEntry);

    if (message.content?.resources?.length) {
      for (const resource of message.content.resources) {
        const resType = resource.type || 'unknown';
        const size = Number(resource.size) || 0;
        this.stats.resources.total += 1;
        this.stats.resources.totalSize += size;
        const resEntry = this.stats.resources.byType.get(resType) || { count: 0, size: 0 };
        resEntry.count += 1;
        resEntry.size += size;
        this.stats.resources.byType.set(resType, resEntry);
      }
    }
  }

  merge(other: StreamingStatsAggregator): void {
    const otherStats = other.getStatistics();
    this.stats.totalMessages += otherStats.totalMessages;

    if (
      otherStats.firstTimestamp !== null &&
      (this.stats.firstTimestamp === null || otherStats.firstTimestamp < this.stats.firstTimestamp)
    ) {
      this.stats.firstTimestamp = otherStats.firstTimestamp;
    }
    if (
      otherStats.lastTimestamp !== null &&
      (this.stats.lastTimestamp === null || otherStats.lastTimestamp > this.stats.lastTimestamp)
    ) {
      this.stats.lastTimestamp = otherStats.lastTimestamp;
    }

    for (const [type, count] of otherStats.messageTypes.entries()) {
      this.stats.messageTypes.set(type, (this.stats.messageTypes.get(type) || 0) + count);
    }

    for (const [key, entry] of otherStats.senders.entries()) {
      const existing = this.stats.senders.get(key) || {
        uid: entry.uid,
        name: entry.name,
        count: 0,
      };
      existing.count += entry.count;
      this.stats.senders.set(key, existing);
    }

    this.stats.resources.total += otherStats.resources.total;
    this.stats.resources.totalSize += otherStats.resources.totalSize;
    for (const [type, data] of otherStats.resources.byType.entries()) {
      const existing = this.stats.resources.byType.get(type) || { count: 0, size: 0 };
      existing.count += data.count;
      existing.size += data.size;
      this.stats.resources.byType.set(type, existing);
    }
  }

  getStatistics(): StreamingStatistics {
    return this.stats;
  }
}
