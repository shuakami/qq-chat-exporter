/**
 * 资源处理器
 * 负责资源的下载、健康检查、缓存管理和熔断机制
 * 支持图片、视频、音频、文件等多种资源类型的处理
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NapCatCore } from '../../../core';
import { MessageElement, ElementType, RawMessage } from '@/core';
import { 
    ResourceInfo, 
    SystemError, 
    ErrorType,
    ResourceType,
    ResourceStatus 
} from '../../types';
import { DatabaseManager } from '../storage/DatabaseManager';

/**
 * 资源处理配置
 */
export interface ResourceHandlerConfig {
    /** 资源存储根目录 */
    storageRoot: string;
    /** 下载超时时间（毫秒） */
    downloadTimeout: number;
    /** 最大并发下载数 */
    maxConcurrentDownloads: number;
    /** 重试次数 */
    maxRetries: number;
    /** 熔断阈值（连续失败次数） */
    circuitBreakerThreshold: number;
    /** 熔断恢复时间（毫秒） */
    circuitBreakerRecoveryTime: number;
    /** 健康检查间隔（毫秒） */
    healthCheckInterval: number;
    /** 是否启用本地缓存 */
    enableLocalCache: boolean;
    /** 缓存清理阈值（天） */
    cacheCleanupThreshold: number;
}

/**
 * 下载任务
 */
interface DownloadTask {
    id: string;
    resourceInfo: ResourceInfo;
    message: RawMessage;
    element: MessageElement;
    priority: number;
    retries: number;
    createdAt: Date;
}

/**
 * 熔断器状态
 */
enum CircuitBreakerState {
    CLOSED = 'closed',     // 正常状态
    OPEN = 'open',         // 熔断状态
    HALF_OPEN = 'half_open' // 半开状态
}

/**
 * 熔断器
 */
class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount: number = 0;
    private lastFailureTime: Date | null = null;
    
    constructor(
        private threshold: number,
        private recoveryTime: number
    ) {}

    /**
     * 执行操作
     */
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.state = CircuitBreakerState.HALF_OPEN;
            } else {
                throw new Error('熔断器已开启，拒绝执行操作');
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * 成功回调
     */
    private onSuccess(): void {
        this.failureCount = 0;
        this.state = CircuitBreakerState.CLOSED;
    }

    /**
     * 失败回调
     */
    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = new Date();
        
        if (this.failureCount >= this.threshold) {
            this.state = CircuitBreakerState.OPEN;
        }
    }

    /**
     * 是否应该尝试重置
     */
    private shouldAttemptReset(): boolean {
        if (!this.lastFailureTime) return false;
        
        const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
        return timeSinceLastFailure >= this.recoveryTime;
    }

    /**
     * 获取状态信息
     */
    getStatus(): {
        state: CircuitBreakerState;
        failureCount: number;
        lastFailureTime: Date | null;
    } {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}

/**
 * 资源健康检查器
 */
class ResourceHealthChecker {
    private healthStatus: Map<string, boolean> = new Map();
    private lastCheckTime: Map<string, Date> = new Map();

    /**
     * 检查资源健康状态
     */
    async checkHealth(resourceInfo: ResourceInfo): Promise<boolean> {
        const now = new Date();
        const lastCheck = this.lastCheckTime.get(resourceInfo.md5);
        
        // 如果最近检查过且状态良好，直接返回缓存结果
        if (lastCheck && (now.getTime() - lastCheck.getTime()) < 300000) { // 5分钟缓存
            return this.healthStatus.get(resourceInfo.md5) || false;
        }

        let isHealthy = false;
        try {
            // 检查本地文件是否存在且完整
            if (resourceInfo.localPath && fs.existsSync(resourceInfo.localPath)) {
                const stats = fs.statSync(resourceInfo.localPath);
                isHealthy = stats.size > 0 && (
                    resourceInfo.fileSize === 0 || 
                    stats.size === resourceInfo.fileSize
                );
                
                // 如果有MD5，验证文件完整性
                if (isHealthy && resourceInfo.md5) {
                    const fileMd5 = await this.calculateFileMd5(resourceInfo.localPath);
                    isHealthy = fileMd5 === resourceInfo.md5;
                }
            }
        } catch (error) {
            console.warn(`[ResourceHandler] 健康检查失败:`, error);
            isHealthy = false;
        }

        this.healthStatus.set(resourceInfo.md5, isHealthy);
        this.lastCheckTime.set(resourceInfo.md5, now);
        
        return isHealthy;
    }

    /**
     * 计算文件MD5
     */
    private async calculateFileMd5(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            
            stream.on('error', reject);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    /**
     * 清理缓存
     */
    cleanup(): void {
        this.healthStatus.clear();
        this.lastCheckTime.clear();
    }
}

/**
 * 资源处理器主类
 */
export class ResourceHandler {
    private readonly core: NapCatCore;
    private readonly config: ResourceHandlerConfig;
    private readonly dbManager: DatabaseManager;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly healthChecker: ResourceHealthChecker;
    
    private downloadQueue: DownloadTask[] = [];
    private activeDownloads: Map<string, Promise<string>> = new Map();
    private isProcessing: boolean = false;
    private healthCheckTimer: NodeJS.Timeout | null = null;

    constructor(core: NapCatCore, dbManager: DatabaseManager, config: Partial<ResourceHandlerConfig> = {}) {
        this.core = core;
        this.dbManager = dbManager;
        
        this.config = {
            storageRoot: path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources'),
            downloadTimeout: 60000, // 60秒
            maxConcurrentDownloads: 3,
            maxRetries: 3,
            circuitBreakerThreshold: 5,
            circuitBreakerRecoveryTime: 300000, // 5分钟
            healthCheckInterval: 600000, // 10分钟
            enableLocalCache: true,
            cacheCleanupThreshold: 30, // 30天
            ...config
        };

        this.circuitBreaker = new CircuitBreaker(
            this.config.circuitBreakerThreshold,
            this.config.circuitBreakerRecoveryTime
        );
        
        this.healthChecker = new ResourceHealthChecker();
        
        this.ensureStorageDirectory();
        this.startHealthCheckTimer();
    }

    /**
     * 批量处理消息中的资源
     */
    async processMessageResources(messages: RawMessage[]): Promise<Map<string, ResourceInfo[]>> {
        const resourceMap = new Map<string, ResourceInfo[]>();
        let totalResources = 0;
        let resourcesNeedingDownload = 0;
        
        console.log(`[ResourceHandler] 开始处理 ${messages.length} 条消息的资源`);
        
        for (const message of messages) {
            const resources: ResourceInfo[] = [];
            
            for (const element of message.elements) {
                if (this.isMediaElement(element)) {
                    try {
                        const resourceInfo = await this.processElement(message, element);
                        if (resourceInfo) {
                            resources.push(resourceInfo);
                            totalResources++;
                            if (!resourceInfo.accessible) {
                                resourcesNeedingDownload++;
                            }
                        }
                    } catch (error) {
                        console.warn(`[ResourceHandler] 处理元素失败:`, error);
                    }
                }
            }
            
            if (resources.length > 0) {
                resourceMap.set(message.msgId, resources);
            }
        }
        
        console.log(`[ResourceHandler] 资源处理完成: 总计 ${totalResources} 个资源, 其中 ${resourcesNeedingDownload} 个需要下载`);
        
        // 等待所有下载任务完成
        if (resourcesNeedingDownload > 0) {
            console.log(`[ResourceHandler] 开始等待 ${resourcesNeedingDownload} 个资源下载完成...`);
            
            // 给下载队列处理器一点时间启动
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await this.waitForAllDownloads();
        } else {
            console.log(`[ResourceHandler] 所有资源都已可用，无需下载`);
        }
        
        return resourceMap;
    }

    /**
     * 处理单个媒体元素
     */
    private async processElement(message: RawMessage, element: MessageElement): Promise<ResourceInfo | null> {
        const resourceInfo = this.extractResourceInfo(element);
        if (!resourceInfo) {
            return null;
        }

        // 设置本地存储路径
        const localPath = this.generateLocalPath(resourceInfo);
        resourceInfo.localPath = localPath;
        
        // 检查健康状态
        const isHealthy = await this.healthChecker.checkHealth(resourceInfo);
        resourceInfo.accessible = isHealthy;
        resourceInfo.checkedAt = new Date();
        
        console.log(`[ResourceHandler] 健康检查结果: ${resourceInfo.fileName} - ${isHealthy ? '可用' : '需要下载'} (路径: ${localPath})`);
        
        // 如果资源不健康或不存在，添加到下载队列并等待下载完成
        if (!isHealthy) {
            await this.enqueueDownload(message, element, resourceInfo);
            // 注意：enqueueDownload只是添加到队列，实际下载是异步的
            // 我们在processMessageResources的最后统一等待所有下载完成
        }
        
        // 更新数据库
        await this.dbManager.saveResourceInfo(resourceInfo);
        
        return resourceInfo;
    }

    /**
     * 从消息元素提取资源信息
     */
    private extractResourceInfo(element: MessageElement): ResourceInfo | null {
        switch (element.elementType) {
            case ElementType.PIC:
                if (element.picElement) {
                    return {
                        type: 'image' as ResourceType,
                        originalUrl: element.picElement.sourcePath || '',
                        fileName: element.picElement.fileName || `image_${Date.now()}.jpg`,
                        fileSize: Number(element.picElement.fileSize) || 0,
                        mimeType: element.picElement.picType ? 
                            this.getMimeTypeFromPicType(element.picElement.picType) : 'image/jpeg',
                        md5: element.picElement.md5HexStr || '',
                        accessible: false,
                        checkedAt: new Date(),
                        status: ResourceStatus.PENDING,
                        downloadAttempts: 0
                    };
                }
                break;
                
            case ElementType.VIDEO:
                if (element.videoElement) {
                    return {
                        type: 'video' as ResourceType,
                        originalUrl: '',
                        fileName: element.videoElement.fileName || `video_${Date.now()}.mp4`,
                        fileSize: Number(element.videoElement.fileSize) || 0,
                        mimeType: 'video/mp4',
                        md5: element.videoElement.fileUuid || '',
                        accessible: false,
                        checkedAt: new Date(),
                        status: ResourceStatus.PENDING,
                        downloadAttempts: 0
                    };
                }
                break;
                
            case ElementType.PTT:
                if (element.pttElement) {
                    return {
                        type: 'audio' as ResourceType,
                        originalUrl: '',
                        fileName: element.pttElement.fileName || `audio_${Date.now()}.wav`,
                        fileSize: Number(element.pttElement.fileSize) || 0,
                        mimeType: 'audio/wav',
                        md5: element.pttElement.md5HexStr || '',
                        accessible: false,
                        checkedAt: new Date(),
                        status: ResourceStatus.PENDING,
                        downloadAttempts: 0
                    };
                }
                break;
                
            case ElementType.FILE:
                if (element.fileElement) {
                    return {
                        type: 'file' as ResourceType,
                        originalUrl: '',
                        fileName: element.fileElement.fileName || `file_${Date.now()}`,
                        fileSize: Number(element.fileElement.fileSize) || 0,
                        mimeType: 'application/octet-stream',
                        md5: element.fileElement.fileMd5 || '',
                        accessible: false,
                        checkedAt: new Date(),
                        status: ResourceStatus.PENDING,
                        downloadAttempts: 0
                    };
                }
                break;
        }
        
        return null;
    }

    /**
     * 判断是否为媒体元素
     */
    private isMediaElement(element: MessageElement): boolean {
        return [
            ElementType.PIC,
            ElementType.VIDEO,
            ElementType.PTT,
            ElementType.FILE
        ].includes(element.elementType);
    }

    /**
     * 生成本地存储路径
     */
    private generateLocalPath(resourceInfo: ResourceInfo): string {
        // 使用复数形式的目录名以保持一致性
        const typeDirName = resourceInfo.type + 's'; // image -> images, audio -> audios
        const typeDir = path.join(this.config.storageRoot, typeDirName);
        const fileName = resourceInfo.md5 ? 
            `${resourceInfo.md5}_${resourceInfo.fileName}` : 
            resourceInfo.fileName;
        
        return path.join(typeDir, fileName);
    }

    /**
     * 添加到下载队列
     */
    private async enqueueDownload(message: RawMessage, element: MessageElement, resourceInfo: ResourceInfo): Promise<void> {
        const taskId = `${message.msgId}_${element.elementId}`;
        
        // 检查是否已在队列中
        if (this.downloadQueue.some(task => task.id === taskId)) {
            console.log(`[ResourceHandler] 任务 ${taskId} 已在下载队列中，跳过添加`);
            return;
        }

        const task: DownloadTask = {
            id: taskId,
            resourceInfo,
            message,
            element,
            priority: this.calculatePriority(resourceInfo),
            retries: 0,
            createdAt: new Date()
        };

        this.downloadQueue.push(task);
        this.downloadQueue.sort((a, b) => b.priority - a.priority);
        
        console.log(`[ResourceHandler] 添加下载任务: ${resourceInfo.fileName} (优先级: ${task.priority}, 队列长度: ${this.downloadQueue.length})`);
        
        // 启动处理队列（不等待，允许异步处理）
        if (!this.isProcessing) {
            console.log(`[ResourceHandler] 启动下载队列处理器`);
            this.processDownloadQueue().catch(error => {
                console.error('[ResourceHandler] 处理下载队列时发生错误:', error);
            });
        } else {
            console.log(`[ResourceHandler] 下载队列处理器已在运行中`);
        }
    }

    /**
     * 计算下载优先级
     */
    private calculatePriority(resourceInfo: ResourceInfo): number {
        let priority = 0;
        
        // 图片优先级最高
        if (resourceInfo.type === 'image') priority += 100;
        else if (resourceInfo.type === 'audio') priority += 50;
        else if (resourceInfo.type === 'video') priority += 30;
        else priority += 10;
        
        // 文件大小越小优先级越高
        if (resourceInfo.fileSize < 1024 * 1024) priority += 20; // 1MB以下
        else if (resourceInfo.fileSize < 10 * 1024 * 1024) priority += 10; // 10MB以下
        
        return priority;
    }

    /**
     * 处理下载队列
     */
    private async processDownloadQueue(): Promise<void> {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        console.log(`[ResourceHandler] 开始处理下载队列，队列长度: ${this.downloadQueue.length}`);
        
        try {
            while (this.downloadQueue.length > 0) {
                // 控制并发数量
                while (this.activeDownloads.size >= this.config.maxConcurrentDownloads) {
                    await this.waitForDownloadSlot();
                }
                
                const task = this.downloadQueue.shift();
                if (!task) continue;
                
                console.log(`[ResourceHandler] 开始执行下载任务: ${task.resourceInfo.fileName} (剩余队列: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size})`);
                
                // 启动下载任务
                const downloadPromise = this.executeDownload(task);
                this.activeDownloads.set(task.id, downloadPromise);
                
                // 清理完成的任务
                downloadPromise.finally(() => {
                    this.activeDownloads.delete(task.id);
                    console.log(`[ResourceHandler] 下载任务完成: ${task.resourceInfo.fileName} (剩余活跃下载: ${this.activeDownloads.size})`);
                });
            }
            
            console.log(`[ResourceHandler] 所有下载任务已启动，等待完成...`);
            
            // 等待所有下载完成
            await Promise.allSettled(Array.from(this.activeDownloads.values()));
            
        } finally {
            this.isProcessing = false;
            console.log(`[ResourceHandler] 下载队列处理完成`);
        }
    }

    /**
     * 等待下载槽位
     */
    private async waitForDownloadSlot(): Promise<void> {
        return new Promise(resolve => {
            const checkSlot = () => {
                if (this.activeDownloads.size < this.config.maxConcurrentDownloads) {
                    resolve();
                } else {
                    setTimeout(checkSlot, 100);
                }
            };
            checkSlot();
        });
    }

    /**
     * 等待所有下载任务完成
     */
    private async waitForAllDownloads(): Promise<void> {
        console.log(`[ResourceHandler] 开始等待所有下载任务完成，当前队列长度: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size}, 正在处理: ${this.isProcessing}`);
        
        return new Promise(resolve => {
            let checkCount = 0;
            const maxChecks = 600; // 最多等待60秒 (600 * 100ms)
            
            const checkAllDownloads = () => {
                checkCount++;
                
                // 如果下载队列为空且没有活跃的下载任务且不在处理中
                if (this.downloadQueue.length === 0 && this.activeDownloads.size === 0 && !this.isProcessing) {
                    console.log(`[ResourceHandler] 所有下载任务已完成，等待检查次数: ${checkCount}`);
                    resolve();
                } else if (checkCount >= maxChecks) {
                    console.warn(`[ResourceHandler] 等待下载任务超时，强制继续。队列长度: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size}, 正在处理: ${this.isProcessing}`);
                    resolve();
                } else {
                    // 每次检查时输出状态（减少频率）
                    if (checkCount % 10 === 0) {
                        console.log(`[ResourceHandler] 等待下载任务完成中... 队列长度: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size}, 正在处理: ${this.isProcessing}`);
                    }
                    setTimeout(checkAllDownloads, 100);
                }
            };
            
            // 先检查一次，如果已经没有任务则立即返回
            checkAllDownloads();
        });
    }

    /**
     * 执行下载任务
     */
    private async executeDownload(task: DownloadTask): Promise<string> {
        try {
            return await this.circuitBreaker.execute(async () => {
                const filePath = await this.downloadResource(task.message, task.element, task.resourceInfo);
                
                // 更新资源状态
                task.resourceInfo.localPath = filePath;
                task.resourceInfo.accessible = true;
                task.resourceInfo.status = ResourceStatus.DOWNLOADED;
                task.resourceInfo.checkedAt = new Date();
                
                await this.dbManager.saveResourceInfo(task.resourceInfo);
                
                return filePath;
            });
        } catch (error) {
            task.retries++;
            task.resourceInfo.downloadAttempts = (task.resourceInfo.downloadAttempts || 0) + 1;
            task.resourceInfo.status = ResourceStatus.FAILED;
            task.resourceInfo.lastError = error instanceof Error ? error.message : String(error);
            
            await this.dbManager.saveResourceInfo(task.resourceInfo);
            
            // 重试逻辑
            if (task.retries < this.config.maxRetries) {
                console.warn(`[ResourceHandler] 下载失败，重试 ${task.retries}/${this.config.maxRetries}:`, error);
                this.downloadQueue.unshift(task); // 重新添加到队列前端
            } else {
                console.error(`[ResourceHandler] 下载最终失败:`, error);
            }
            
            throw error;
        }
    }

    /**
     * 下载资源
     */
    private async downloadResource(message: RawMessage, element: MessageElement, resourceInfo: ResourceInfo): Promise<string> {
        const localPath = resourceInfo.localPath || this.generateLocalPath(resourceInfo);
        
        console.log(`[ResourceHandler] 开始下载资源: ${resourceInfo.fileName}`);
        console.log(`[ResourceHandler] 本地路径: ${localPath}`);
        console.log(`[ResourceHandler] 消息ID: ${message.msgId}, 元素ID: ${element.elementId}`);
        
        // 确保目录存在
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[ResourceHandler] 创建目录: ${dir}`);
        }
        
        try {
            // 检查是否是图片类型，如果是，使用图片特定的下载方法
            if (element.picElement && resourceInfo.type === 'image') {
                console.log(`[ResourceHandler] 下载图片，使用图片API`);
                const downloadedPath = await this.core.apis.FileApi.downloadMedia(
                    message.msgId,
                    message.chatType as any,
                    message.peerUid,
                    element.elementId,
                    '', // thumbPath
                    localPath, // sourcePath  
                    this.config.downloadTimeout,
                    true // force
                );
                
                console.log(`[ResourceHandler] 图片下载完成: ${downloadedPath || '(空路径)'}`);
                
                // 检查下载返回路径是否有效
                if (!downloadedPath || downloadedPath.trim() === '') {
                    console.error(`[ResourceHandler] API返回空路径，尝试使用本地路径: ${localPath}`);
                    // 尝试检查本地路径是否存在文件
                    if (fs.existsSync(localPath)) {
                        const stats = fs.statSync(localPath);
                        if (stats.size > 0) {
                            console.log(`[ResourceHandler] 找到本地文件，大小: ${stats.size} bytes`);
                            return localPath;
                        }
                    }
                    
                    // 如果本地路径也没有，尝试回退到图片元素的源路径
                    if (element.picElement.sourcePath && fs.existsSync(element.picElement.sourcePath)) {
                        const sourcePath = element.picElement.sourcePath;
                        const stats = fs.statSync(sourcePath);
                        console.log(`[ResourceHandler] 使用图片元素源路径: ${sourcePath}, 大小: ${stats.size} bytes`);
                        
                        // 复制到我们的资源目录
                        if (sourcePath !== localPath) {
                            console.log(`[ResourceHandler] 复制源文件到资源目录: ${sourcePath} -> ${localPath}`);
                            fs.copyFileSync(sourcePath, localPath);
                            if (fs.existsSync(localPath)) {
                                const copiedStats = fs.statSync(localPath);
                                console.log(`[ResourceHandler] 源文件复制成功，大小: ${copiedStats.size} bytes`);
                                return localPath;
                            }
                        }
                        return sourcePath;
                    }
                    
                    throw new Error(`API返回空路径且无法找到有效的下载文件`);
                }
                
                // 验证文件是否成功下载
                if (fs.existsSync(downloadedPath)) {
                    const stats = fs.statSync(downloadedPath);
                    console.log(`[ResourceHandler] 文件大小: ${stats.size} bytes`);
                    
                    if (stats.size === 0) {
                        throw new Error('下载的文件为空');
                    }
                    
                    // 将文件复制到我们指定的资源目录
                    if (downloadedPath !== localPath) {
                        console.log(`[ResourceHandler] 复制文件到指定位置: ${downloadedPath} -> ${localPath}`);
                        fs.copyFileSync(downloadedPath, localPath);
                        
                        // 验证复制是否成功
                        if (fs.existsSync(localPath)) {
                            const copiedStats = fs.statSync(localPath);
                            console.log(`[ResourceHandler] 文件复制成功，大小: ${copiedStats.size} bytes`);
                            return localPath; // 返回我们的资源路径
                        } else {
                            console.warn(`[ResourceHandler] 文件复制失败，使用原路径: ${downloadedPath}`);
                            return downloadedPath;
                        }
                    }
                    
                    return downloadedPath;
                } else {
                    throw new Error(`文件未下载到预期位置: ${downloadedPath}`);
                }
            } else {
                // 其他类型资源的下载（音频、视频、文件等）
                console.log(`[ResourceHandler] 下载${resourceInfo.type}资源`);
                const downloadedPath = await this.core.apis.FileApi.downloadMedia(
                    message.msgId,
                    message.chatType as any,
                    message.peerUid,
                    element.elementId,
                    '', // thumbPath
                    localPath, // sourcePath
                    this.config.downloadTimeout,
                    true // force
                );
                
                console.log(`[ResourceHandler] ${resourceInfo.type}资源下载完成: ${downloadedPath || '(空路径)'}`);
                
                // 检查下载返回路径是否有效
                if (!downloadedPath || downloadedPath.trim() === '') {
                    console.error(`[ResourceHandler] ${resourceInfo.type}资源API返回空路径，尝试使用本地路径: ${localPath}`);
                    // 尝试检查本地路径是否存在文件
                    if (fs.existsSync(localPath)) {
                        const stats = fs.statSync(localPath);
                        if (stats.size > 0) {
                            console.log(`[ResourceHandler] 找到${resourceInfo.type}本地文件，大小: ${stats.size} bytes`);
                            return localPath;
                        }
                    }
                    
                    // 尝试回退到元素的源路径
                    let sourcePath = '';
                    if (element.videoElement?.filePath) {
                        sourcePath = element.videoElement.filePath;
                    } else if (element.fileElement?.filePath) {
                        sourcePath = element.fileElement.filePath;
                    } else if (element.pttElement?.filePath) {
                        sourcePath = element.pttElement.filePath;
                    }
                    
                    if (sourcePath && fs.existsSync(sourcePath)) {
                        const stats = fs.statSync(sourcePath);
                        console.log(`[ResourceHandler] 使用${resourceInfo.type}元素源路径: ${sourcePath}, 大小: ${stats.size} bytes`);
                        
                        // 复制到我们的资源目录
                        if (sourcePath !== localPath) {
                            console.log(`[ResourceHandler] 复制${resourceInfo.type}源文件到资源目录: ${sourcePath} -> ${localPath}`);
                            fs.copyFileSync(sourcePath, localPath);
                            if (fs.existsSync(localPath)) {
                                const copiedStats = fs.statSync(localPath);
                                console.log(`[ResourceHandler] ${resourceInfo.type}源文件复制成功，大小: ${copiedStats.size} bytes`);
                                return localPath;
                            }
                        }
                        return sourcePath;
                    }
                    
                    throw new Error(`${resourceInfo.type}资源API返回空路径且无法找到有效的下载文件`);
                }
                
                // 验证并复制文件
                if (fs.existsSync(downloadedPath)) {
                    const stats = fs.statSync(downloadedPath);
                    console.log(`[ResourceHandler] 文件大小: ${stats.size} bytes`);
                    
                    if (stats.size === 0) {
                        throw new Error('下载的文件为空');
                    }
                    
                    // 复制到指定位置（如果路径不同）
                    if (downloadedPath !== localPath) {
                        console.log(`[ResourceHandler] 复制${resourceInfo.type}文件: ${downloadedPath} -> ${localPath}`);
                        fs.copyFileSync(downloadedPath, localPath);
                        
                        if (fs.existsSync(localPath)) {
                            const copiedStats = fs.statSync(localPath);
                            console.log(`[ResourceHandler] ${resourceInfo.type}文件复制成功，大小: ${copiedStats.size} bytes`);
                            return localPath;
                        } else {
                            console.warn(`[ResourceHandler] ${resourceInfo.type}文件复制失败，使用原路径`);
                            return downloadedPath;
                        }
                    }
                    
                    return downloadedPath;
                } else {
                    throw new Error(`${resourceInfo.type}资源未下载到预期位置: ${downloadedPath}`);
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[ResourceHandler] 下载失败:`, {
                error: errorMessage,
                messageId: message.msgId,
                elementId: element.elementId,
                resourceType: resourceInfo.type,
                fileName: resourceInfo.fileName,
                localPath,
                chatType: message.chatType,
                peerUid: message.peerUid,
                timeout: this.config.downloadTimeout
            });
            
            // 根据错误类型提供更具体的错误信息
            let enhancedMessage = `${resourceInfo.type}资源下载失败`;
            if (errorMessage.includes('空路径')) {
                enhancedMessage += '：下载API返回空路径，可能是文件不存在或权限问题';
            } else if (errorMessage.includes('文件为空')) {
                enhancedMessage += '：下载的文件为空，可能是网络问题或文件损坏';
            } else if (errorMessage.includes('预期位置')) {
                enhancedMessage += '：文件未下载到预期位置，可能是权限问题';
            } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
                enhancedMessage += '：下载超时，可能是网络问题或文件过大';
            }
            
            throw new SystemError({
                type: ErrorType.RESOURCE_ERROR,
                message: `${enhancedMessage}: ${errorMessage}`,
                details: {
                    messageId: message.msgId,
                    elementId: element.elementId,
                    resourceType: resourceInfo.type,
                    fileName: resourceInfo.fileName,
                    localPath,
                    chatType: message.chatType,
                    peerUid: message.peerUid,
                    timeout: this.config.downloadTimeout,
                    error: errorMessage
                },
                timestamp: new Date()
            });
        }
    }

    /**
     * 获取MIME类型
     */
    private getMimeTypeFromPicType(picType: number): string {
        const mimeMap: Record<number, string> = {
            1000: 'image/jpeg',
            1001: 'image/png',
            1002: 'image/webp',
            1003: 'image/bmp',
            1004: 'image/tiff',
            1005: 'image/gif'
        };
        
        return mimeMap[picType] || 'image/jpeg';
    }

    /**
     * 启动健康检查定时器
     */
    private startHealthCheckTimer(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.healthCheckTimer = setInterval(async () => {
            await this.performScheduledHealthCheck();
        }, this.config.healthCheckInterval);
    }

    /**
     * 执行定期健康检查
     */
    private async performScheduledHealthCheck(): Promise<void> {
        try {
            const resources = await this.dbManager.getResourcesByStatus(ResourceStatus.DOWNLOADED);
            
            for (const resource of resources) {
                const isHealthy = await this.healthChecker.checkHealth(resource);
                
                if (!isHealthy && resource.status === ResourceStatus.DOWNLOADED) {
                    resource.status = ResourceStatus.FAILED;
                    resource.accessible = false;
                    resource.checkedAt = new Date();
                    
                    await this.dbManager.saveResourceInfo(resource);
                }
            }
        } catch (error) {
            console.warn('[ResourceHandler] 健康检查失败:', error);
        }
    }

    /**
     * 确保存储目录存在
     */
    private ensureStorageDirectory(): void {
        const directories = [
            this.config.storageRoot,
            path.join(this.config.storageRoot, 'image'),
            path.join(this.config.storageRoot, 'video'),
            path.join(this.config.storageRoot, 'audio'),
            path.join(this.config.storageRoot, 'file')
        ];
        
        directories.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * 获取统计信息
     */
    async getStatistics(): Promise<{
        totalResources: number;
        downloadedResources: number;
        failedResources: number;
        pendingDownloads: number;
        activeDownloads: number;
        circuitBreakerStatus: any;
    }> {
        const stats = await this.dbManager.getResourceStatistics();
        
        return {
            totalResources: stats.total,
            downloadedResources: stats.downloaded,
            failedResources: stats.failed,
            pendingDownloads: this.downloadQueue.length,
            activeDownloads: this.activeDownloads.size,
            circuitBreakerStatus: this.circuitBreaker.getStatus()
        };
    }

    /**
     * 清理资源
     */
    async cleanup(): Promise<void> {
        // 停止健康检查定时器
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        
        // 清理下载队列
        this.downloadQueue = [];
        
        // 等待活动下载完成
        await Promise.allSettled(Array.from(this.activeDownloads.values()));
        this.activeDownloads.clear();
        
        // 清理健康检查缓存
        this.healthChecker.cleanup();
    }

    /**
     * 清理过期缓存文件
     */
    async cleanupExpiredCache(): Promise<void> {
        if (!this.config.enableLocalCache) return;
        
        const cutoffTime = new Date();
        cutoffTime.setDate(cutoffTime.getDate() - this.config.cacheCleanupThreshold);
        
        try {
            const expiredResources = await this.dbManager.getResourcesOlderThan(cutoffTime);
            
            for (const resource of expiredResources) {
                if (resource.localPath && fs.existsSync(resource.localPath)) {
                    try {
                        fs.unlinkSync(resource.localPath);
                        console.log(`[ResourceHandler] 清理过期缓存: ${resource.fileName}`);
                    } catch (error) {
                        console.warn(`[ResourceHandler] 清理缓存失败: ${resource.fileName}`, error);
                    }
                }
            }
            
            await this.dbManager.deleteExpiredResources(cutoffTime);
        } catch (error) {
            console.error('[ResourceHandler] 清理过期缓存时发生错误:', error);
        }
    }
}