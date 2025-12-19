/**
 * 流式 ZIP 导出器
 * 专为超大消息量（>50万）设计，全程流式处理防止 OOM
 * 
 * 特点：
 * 1. 消息获取 -> 解析 -> HTML渲染 -> ZIP写入 全程流式
 * 2. 资源文件边下载边写入ZIP，不在内存中累积
 * 3. 内存占用恒定，不随消息数量增长
 */

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface StreamingZipOptions {
    /** 输出 ZIP 文件路径 */
    outputPath: string;
    /** HTML 文件在 ZIP 内的名称 */
    htmlFileName?: string;
    /** 压缩级别 (0-9)，默认 6（平衡速度和压缩率） */
    compressionLevel?: number;
    /** 资源目录名 */
    resourcesDirName?: string;
}

export interface StreamingZipProgress {
    phase: 'init' | 'messages' | 'resources' | 'finalizing' | 'done';
    messagesProcessed: number;
    resourcesProcessed: number;
    bytesWritten: number;
}

export type ProgressCallback = (progress: StreamingZipProgress) => void;

/**
 * 流式 ZIP 导出器
 */
export class StreamingZipExporter {
    private options: Required<StreamingZipOptions>;
    private archive: archiver.Archiver | null = null;
    private outputStream: fs.WriteStream | null = null;
    private htmlStream: PassThrough | null = null;
    private progress: StreamingZipProgress;
    private progressCallback?: ProgressCallback;

    constructor(options: StreamingZipOptions) {
        this.options = {
            outputPath: options.outputPath,
            htmlFileName: options.htmlFileName || 'chat.html',
            compressionLevel: options.compressionLevel ?? 6,
            resourcesDirName: options.resourcesDirName || 'resources'
        };
        this.progress = {
            phase: 'init',
            messagesProcessed: 0,
            resourcesProcessed: 0,
            bytesWritten: 0
        };
    }

    /**
     * 设置进度回调
     */
    setProgressCallback(callback: ProgressCallback): void {
        this.progressCallback = callback;
    }

    private updateProgress(updates: Partial<StreamingZipProgress>): void {
        Object.assign(this.progress, updates);
        this.progressCallback?.(this.progress);
    }

    /**
     * 初始化 ZIP 归档
     */
    async initialize(): Promise<void> {
        // 确保输出目录存在
        const outputDir = path.dirname(this.options.outputPath);
        await fsp.mkdir(outputDir, { recursive: true });

        // 创建输出流
        this.outputStream = fs.createWriteStream(this.options.outputPath);
        
        // 创建 archiver 实例
        this.archive = archiver('zip', {
            zlib: { level: this.options.compressionLevel }
        });

        // 监听错误
        this.archive.on('error', (err) => {
            console.error('[StreamingZipExporter] Archive error:', err);
            throw err;
        });

        this.archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                // 静默处理 ENOENT 警告
            } else {
                throw err;
            }
        });

        // 监听进度
        this.archive.on('progress', (progress) => {
            this.updateProgress({ bytesWritten: progress.fs.processedBytes });
        });

        // 管道连接
        this.archive.pipe(this.outputStream);

        // 创建 HTML 流（PassThrough 允许我们逐步写入）
        this.htmlStream = new PassThrough();
        
        // 将 HTML 流添加到归档（流式，不会等待完成）
        this.archive.append(this.htmlStream, { name: this.options.htmlFileName });

        this.updateProgress({ phase: 'init' });
    }

    /**
     * 写入 HTML 内容（流式）
     */
    writeHtml(content: string): void {
        if (!this.htmlStream) {
            throw new Error('StreamingZipExporter not initialized');
        }
        this.htmlStream.write(content);
    }

    /**
     * 完成 HTML 写入
     */
    finishHtml(): void {
        if (this.htmlStream) {
            this.htmlStream.end();
            this.htmlStream = null;
        }
    }

    /**
     * 添加资源文件到 ZIP（流式）
     * @param sourcePath 源文件路径
     * @param zipPath ZIP 内的路径
     */
    async addResource(sourcePath: string, zipPath: string): Promise<boolean> {
        if (!this.archive) {
            throw new Error('StreamingZipExporter not initialized');
        }

        try {
            if (!fs.existsSync(sourcePath)) {
                // 资源不存在，静默跳过
                return false;
            }

            // 使用流式读取，不加载整个文件到内存
            const readStream = fs.createReadStream(sourcePath);
            const fullZipPath = path.posix.join(this.options.resourcesDirName, zipPath);
            
            this.archive.append(readStream, { name: fullZipPath });
            this.progress.resourcesProcessed++;
            
            return true;
        } catch (error) {
            console.error(`[StreamingZipExporter] Failed to add resource: ${sourcePath}`, error);
            return false;
        }
    }

    /**
     * 批量添加资源文件（带并发控制）
     * @param resources 资源列表 [{sourcePath, zipPath}]
     * @param concurrency 并发数
     */
    async addResources(
        resources: Array<{ sourcePath: string; zipPath: string }>,
        concurrency: number = 4
    ): Promise<number> {
        this.updateProgress({ phase: 'resources' });
        
        let successCount = 0;
        const queue = [...resources];

        const worker = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (item) {
                    const success = await this.addResource(item.sourcePath, item.zipPath);
                    if (success) successCount++;
                }
            }
        };

        // 启动并发 workers
        const workers = Array(Math.min(concurrency, resources.length))
            .fill(null)
            .map(() => worker());

        await Promise.all(workers);
        
        return successCount;
    }

    /**
     * 添加内存中的数据到 ZIP
     */
    addBuffer(buffer: Buffer | string, zipPath: string): void {
        if (!this.archive) {
            throw new Error('StreamingZipExporter not initialized');
        }
        this.archive.append(buffer, { name: zipPath });
    }

    /**
     * 完成并关闭 ZIP
     */
    async finalize(): Promise<{ bytesWritten: number; success: boolean }> {
        if (!this.archive || !this.outputStream) {
            throw new Error('StreamingZipExporter not initialized');
        }

        this.updateProgress({ phase: 'finalizing' });

        // 确保 HTML 流已关闭
        this.finishHtml();

        return new Promise((resolve, reject) => {
            this.outputStream!.on('close', () => {
                const bytesWritten = this.archive!.pointer();
                this.updateProgress({ phase: 'done', bytesWritten });
                resolve({ bytesWritten, success: true });
            });

            this.outputStream!.on('error', (err) => {
                console.error('[StreamingZipExporter] Output stream error:', err);
                reject(err);
            });

            // 完成归档
            this.archive!.finalize();
        });
    }

    /**
     * 中止并清理
     */
    async abort(): Promise<void> {
        try {
            if (this.htmlStream) {
                this.htmlStream.destroy();
                this.htmlStream = null;
            }
            if (this.archive) {
                this.archive.abort();
                this.archive = null;
            }
            if (this.outputStream) {
                this.outputStream.destroy();
                this.outputStream = null;
            }
            // 删除不完整的文件
            if (fs.existsSync(this.options.outputPath)) {
                await fsp.unlink(this.options.outputPath);
            }
        } catch (error) {
            console.error('[StreamingZipExporter] Abort error:', error);
        }
    }

    /**
     * 获取当前进度
     */
    getProgress(): StreamingZipProgress {
        return { ...this.progress };
    }
}
