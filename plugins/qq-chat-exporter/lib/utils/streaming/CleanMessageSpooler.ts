import fs from 'fs';
import os from 'os';
import path from 'path';
import { once } from 'events';
import { CleanMessage } from '../../core/parser/SimpleMessageParser.js';

interface SpoolIndexEntry {
  offset: number;
  length: number;
  timestamp: number;
}

/**
 * 将解析后的消息流式写入临时文件，并提供按时间顺序读取的能力。
 * 该类用于在导出超大数据集时避免在内存中保存全部消息。
 */
export class CleanMessageSpooler {
  private readonly filePath: string;
  private readonly writeStream: fs.WriteStream;
  private readonly index: SpoolIndexEntry[] = [];
  private writeOffset = 0;
  private sorted = false;
  private readonly baseDir: string;
  private readonly ownsBaseDir: boolean;

  constructor(tempDir?: string) {
    let baseDir = tempDir;
    let ownsBase = false;
    if (!baseDir) {
      baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-chat-exporter-'));
      ownsBase = true;
    } else if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.baseDir = baseDir;
    this.ownsBaseDir = ownsBase;
    this.filePath = path.join(baseDir, `spool-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
    this.writeStream = fs.createWriteStream(this.filePath, { encoding: 'utf8' });
  }

  get path(): string {
    return this.filePath;
  }

  get count(): number {
    return this.index.length;
  }

  async append(message: CleanMessage): Promise<void> {
    const payload = JSON.stringify(message);
    const data = payload + '\n';
    const buffer = Buffer.from(data, 'utf8');
    const length = buffer.length;

    this.index.push({
      offset: this.writeOffset,
      length,
      timestamp: message.timestamp,
    });

    this.writeOffset += length;
    if (!this.writeStream.write(buffer)) {
      await once(this.writeStream, 'drain');
    }
    this.sorted = false;
  }

  async finalize(): Promise<void> {
    if (!this.writeStream.closed) {
      this.writeStream.end();
      await once(this.writeStream, 'close');
    }
  }

  private ensureSorted(): void {
    if (this.sorted) return;
    this.index.sort((a, b) => a.timestamp - b.timestamp);
    this.sorted = true;
  }

  async *iterateMessages(): AsyncGenerator<CleanMessage> {
    await this.finalize();
    this.ensureSorted();

    const handle = await fs.promises.open(this.filePath, 'r');
    try {
      for (const entry of this.index) {
        const buffer = Buffer.alloc(entry.length);
        await handle.read({ buffer, position: entry.offset, length: entry.length });
        const json = buffer.toString('utf8');
        if (!json) continue;
        const trimmed = json.trim();
        if (!trimmed) continue;
        try {
          const message = JSON.parse(trimmed) as CleanMessage;
          yield message;
        } catch (error) {
          console.warn('[CleanMessageSpooler] JSON 解析失败，跳过当前记录', error);
        }
      }
    } finally {
      await handle.close();
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.finalize();
    } catch {
      // ignore
    }
    try {
      await fs.promises.unlink(this.filePath);
    } catch {
      // ignore
    }
    if (this.ownsBaseDir) {
      try {
        await fs.promises.rm(this.baseDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
