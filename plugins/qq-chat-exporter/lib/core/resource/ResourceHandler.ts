/**
 * 资源处理器
 * 负责资源的下载、健康检查、缓存管理和熔断机制
 * 支持图片、视频、音频、文件等多种资源类型的处理
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { MessageElement, ElementType, RawMessage } from 'NapCatQQ/src/core/index.js';
import { 
    ResourceInfo, 
    SystemError, 
    ErrorType,
    ResourceType,
    ResourceStatus 
} from '../../types/index.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';

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
 * 智能熔断器
 * 区分不同类型的错误，只有严重错误才计入熔断
 */
class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount: number = 0;
    private lastFailureTime: Date | null = null;
    private consecutiveFailures: number = 0;
    
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
                console.log('[CircuitBreaker] 尝试从熔断状态恢复，切换到半开状态');
            } else {
                // 输出更详细的信息，帮助用户理解问题
                const timeUntilRecovery = this.getTimeUntilRecovery();
                console.warn(`[CircuitBreaker] 熔断器已开启，拒绝执行操作。预计 ${Math.ceil(timeUntilRecovery / 1000)} 秒后可尝试恢复`);
                throw new Error(`熔断器已开启，拒绝执行操作。预计 ${Math.ceil(timeUntilRecovery / 1000)} 秒后可尝试恢复`);
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            // 智能错误处理：只有特定类型的错误才计入熔断
            this.onFailure(error);
            throw error;
        }
    }

    /**
     * 成功回调
     */
    private onSuccess(): void {
        this.failureCount = 0;
        this.consecutiveFailures = 0;
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            console.log('[CircuitBreaker] 半开状态下操作成功，恢复到关闭状态');
        }
        this.state = CircuitBreakerState.CLOSED;
    }

    /**
     * 智能失败处理
     * 只有特定类型的错误才计入熔断，避免因为404等正常错误触发熔断
     */
    private onFailure(error: any): void {
        const errorMessage = error?.message || String(error);
        const shouldCountTowardsBreaker = this.shouldCountAsFailure(errorMessage);
        
        if (shouldCountTowardsBreaker) {
            this.failureCount++;
            this.consecutiveFailures++;
            this.lastFailureTime = new Date();
            
            console.warn(`[CircuitBreaker] 严重错误计入熔断统计: ${errorMessage} (${this.failureCount}/${this.threshold})`);
            
            if (this.failureCount >= this.threshold) {
                this.state = CircuitBreakerState.OPEN;
                console.error(`[CircuitBreaker] 熔断器已开启，连续失败 ${this.failureCount} 次，将在 ${this.recoveryTime / 1000} 秒后尝试恢复`);
            }
        } else {
            // 轻微错误不计入熔断，但重置连续成功计数
            this.consecutiveFailures++;
            console.log(`[CircuitBreaker] 轻微错误不计入熔断: ${errorMessage}`);
        }
    }

    /**
     * 判断错误是否应该计入熔断统计
     */
    private shouldCountAsFailure(errorMessage: string): boolean {
        // 不应该计入熔断的错误类型（业务错误，不是系统故障）
        const ignoredErrors = [
            '404',                    // 资源不存在
            'not found',              // 文件未找到
            'forbidden',              // 权限错误
            'unauthorized',           // 认证错误
            'file exists',            // 文件已存在
            'disk quota',             // 磁盘空间不足
            'api返回空路径',          // API返回空路径（文件可能已过期或被删除）
            '空路径',                 // 空路径错误
            '文件不存在',             // 文件不存在
            '权限问题',               // 权限问题
            '无法找到有效的下载文件', // 无法找到有效文件
        ];
        
        const lowerErrorMsg = errorMessage.toLowerCase();
        return !ignoredErrors.some(ignored => lowerErrorMsg.includes(ignored));
    }

    /**
     * 获取距离恢复尝试的剩余时间
     */
    private getTimeUntilRecovery(): number {
        if (!this.lastFailureTime) return 0;
        const elapsed = Date.now() - this.lastFailureTime.getTime();
        return Math.max(0, this.recoveryTime - elapsed);
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
            downloadTimeout: 30000, // 30秒（缩短超时时间，更快失败重试）
            maxConcurrentDownloads: 2, // 降低并发数，减少服务器压力
            maxRetries: 5, // 增加重试次数
            circuitBreakerThreshold: 20, // 大幅提高熔断阈值（5→20）
            circuitBreakerRecoveryTime: 60000, // 大幅缩短恢复时间（5分钟→1分钟）
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
                // 调试：打印所有元素类型
                if (element.videoElement || element.pttElement) {
                    console.log(`[ResourceHandler] 🔍 发现媒体元素: elementType=${element.elementType}, hasVideo=${!!element.videoElement}, hasAudio=${!!element.pttElement}`);
                }
                
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
                } else if (element.videoElement || element.pttElement) {
                    console.warn(`[ResourceHandler] ⚠️ 媒体元素未被识别: elementType=${element.elementType}, VIDEO=${ElementType.VIDEO}, PTT=${ElementType.PTT}`);
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
            
            // 给下载队列处理器足够时间启动和处理
            console.log(`[ResourceHandler] 等待下载队列处理器启动...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 增加到1秒
            
            console.log(`[ResourceHandler] 开始监控下载进度...`);
            await this.waitForAllDownloads();
            
            console.log(`[ResourceHandler] 所有资源下载完成`);
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
     * 修复：直接检查元素属性，而不是依赖可能不准确的枚举值
     */
    private extractResourceInfo(element: MessageElement): ResourceInfo | null {
        // 图片
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
        
        // 视频
        if (element.videoElement) {
            const fileName = element.videoElement.fileName || `video_${Date.now()}.mp4`;
            // 从文件名中提取MD5（通常格式为: {md5}.mp4）
            const md5FromFileName = fileName.replace(/\.(mp4|avi|mov|mkv)$/i, '');
            const md5 = element.videoElement.md5HexStr || md5FromFileName || element.videoElement.fileUuid || '';
            
            console.log(`[ResourceHandler] 📹 视频元素: fileName=${fileName}, md5提取=${md5FromFileName}, 最终md5=${md5.substring(0, 32)}`);
            
            return {
                type: 'video' as ResourceType,
                originalUrl: '',
                fileName: fileName,
                fileSize: Number(element.videoElement.fileSize) || 0,
                mimeType: 'video/mp4',
                md5: md5,
                accessible: false,
                checkedAt: new Date(),
                status: ResourceStatus.PENDING,
                downloadAttempts: 0
            };
        }
        
        // 语音
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
        
        // 文件
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
        
        return null;
    }

    /**
     * 判断是否为媒体元素
     * 修复：直接检查元素属性，而不是依赖可能不准确的枚举值
     */
    private isMediaElement(element: MessageElement): boolean {
        // 直接检查是否有对应的媒体元素属性
        return !!(
            element.picElement || 
            element.videoElement || 
            element.pttElement || 
            element.fileElement
        );
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
        const initialQueueSize = this.downloadQueue.length;
        console.log(`[ResourceHandler] 开始处理下载队列，队列长度: ${initialQueueSize}`);
        
        let successCount = 0;
        let failureCount = 0;
        let skippedCount = 0;
        
        try {
            while (this.downloadQueue.length > 0) {
                // 控制并发数量
                while (this.activeDownloads.size >= this.config.maxConcurrentDownloads) {
                    await this.waitForDownloadSlot();
                }
                
                const task = this.downloadQueue.shift();
                if (!task) continue;
                
                const progress = Math.round(((initialQueueSize - this.downloadQueue.length) / initialQueueSize) * 100);
                console.log(`[ResourceHandler] [${progress}%] 开始执行下载任务: ${task.resourceInfo.fileName} (剩余队列: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size})`);
                
                // 启动下载任务
                const downloadPromise = this.executeDownload(task)
                    .then(result => {
                        if (result) {
                            successCount++;
                            console.log(`[ResourceHandler] ✅ 下载成功: ${task.resourceInfo.fileName}`);
                        } else {
                            // 空字符串表示延迟重试或跳过
                            if (task.resourceInfo.status === ResourceStatus.SKIPPED) {
                                skippedCount++;
                                console.log(`[ResourceHandler] ⏭️ 已跳过: ${task.resourceInfo.fileName}`);
                            }
                        }
                        return result;
                    })
                    .catch(error => {
                        failureCount++;
                        console.error(`[ResourceHandler] ❌ 下载失败: ${task.resourceInfo.fileName} - ${error.message}`);
                        return '';
                    });
                
                this.activeDownloads.set(task.id, downloadPromise);
                
                // 清理完成的任务
                downloadPromise.finally(() => {
                    this.activeDownloads.delete(task.id);
                });
            }
            
            console.log(`[ResourceHandler] 所有下载任务已启动，等待完成...`);
            
            // 等待所有下载完成，使用allSettled避免因个别失败而中断
            const results = await Promise.allSettled(Array.from(this.activeDownloads.values()));
            
            // 统计最终结果
            console.log(`[ResourceHandler] 📊 下载统计: 成功 ${successCount}, 失败 ${failureCount}, 跳过 ${skippedCount}, 总计 ${successCount + failureCount + skippedCount}`);
            
            // 检查是否有意外失败
            const rejectedResults = results.filter(r => r.status === 'rejected');
            if (rejectedResults.length > 0) {
                console.warn(`[ResourceHandler] ⚠️ 有 ${rejectedResults.length} 个下载任务异常终止`);
            }
            
        } catch (error) {
            console.error(`[ResourceHandler] 下载队列处理出现严重错误:`, error);
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
        
        // 如果没有任何下载任务，直接返回
        if (this.downloadQueue.length === 0 && this.activeDownloads.size === 0 && !this.isProcessing) {
            console.log(`[ResourceHandler] 没有下载任务，直接返回`);
            return;
        }
        
        return new Promise(resolve => {
            let checkCount = 0;
            const maxChecks = 600; // 最多等待60秒 (600 * 100ms)
            
            const checkAllDownloads = () => {
                checkCount++;
                
                console.log(`[ResourceHandler] 等待状态检查 ${checkCount}: 队列=${this.downloadQueue.length}, 活跃=${this.activeDownloads.size}, 处理中=${this.isProcessing}`);
                
                // 更严格的完成条件：队列空、无活跃下载、且已经开始过处理或当前无任何任务
                const queueEmpty = this.downloadQueue.length === 0;
                const noActiveDownloads = this.activeDownloads.size === 0;
                const notProcessing = !this.isProcessing;
                
                if (queueEmpty && noActiveDownloads && notProcessing) {
                    console.log(`[ResourceHandler] 所有下载任务已完成，等待检查次数: ${checkCount}`);
                    resolve();
                } else if (checkCount >= maxChecks) {
                    console.warn(`[ResourceHandler] 等待下载任务超时，强制继续。队列长度: ${this.downloadQueue.length}, 活跃下载: ${this.activeDownloads.size}, 正在处理: ${this.isProcessing}`);
                    resolve();
                } else {
                    // 如果有队列任务但没在处理，可能需要手动触发处理
                    if (this.downloadQueue.length > 0 && !this.isProcessing && this.activeDownloads.size === 0) {
                        console.warn(`[ResourceHandler] 检测到队列有任务但未在处理，尝试重新触发处理`);
                        this.processDownloadQueue().catch(error => {
                            console.error('[ResourceHandler] 重新触发下载队列处理失败:', error);
                        });
                    }
                    
                    setTimeout(checkAllDownloads, 200); // 增加检查间隔，给处理更多时间
                }
            };
            
            // 给队列处理器更多启动时间
            setTimeout(checkAllDownloads, 300);
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
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isRetriableError = this.isRetriableError(errorMessage);
            
            // 分类处理不同类型的错误
            if (this.isNonRetriableError(errorMessage)) {
                // 不可重试的错误，直接标记为跳过
                task.resourceInfo.status = ResourceStatus.SKIPPED;
                task.resourceInfo.lastError = `已跳过：${errorMessage}`;
                console.log(`[ResourceHandler] 资源不可下载，已跳过: ${task.resourceInfo.fileName} - ${errorMessage}`);
            } else {
                // 可重试的错误
                task.resourceInfo.status = ResourceStatus.FAILED;
                task.resourceInfo.lastError = errorMessage;
            }
            
            await this.dbManager.saveResourceInfo(task.resourceInfo);
            
            // 重试逻辑（仅对可重试错误）
            if (isRetriableError && task.retries < this.config.maxRetries) {
                // 使用指数退避策略
                const retryDelay = Math.min(1000 * Math.pow(2, task.retries - 1), 10000);
                console.warn(`[ResourceHandler] 下载失败，${retryDelay}ms后重试 ${task.retries}/${this.config.maxRetries}: ${task.resourceInfo.fileName} - ${errorMessage}`);
                
                setTimeout(() => {
                    this.downloadQueue.unshift(task); // 重新添加到队列前端
                    
                    // 如果队列处理器已停止，重新启动
                    if (!this.isProcessing && this.downloadQueue.length > 0) {
                        this.processDownloadQueue().catch(err => {
                            console.error('[ResourceHandler] 重新启动队列处理失败:', err);
                        });
                    }
                }, retryDelay);
                
                return ''; // 返回空字符串表示延迟重试
            } else {
                console.error(`[ResourceHandler] 下载最终失败: ${task.resourceInfo.fileName} - ${errorMessage}`);
            }
            
            // 对于不可重试错误或重试次数耗尽的情况，不要抛出错误
            // 这样可以继续处理其他资源
            return '';
        }
    }

    /**
     * 判断是否为可重试的错误
     */
    private isRetriableError(errorMessage: string): boolean {
        const lowerMsg = errorMessage.toLowerCase();
        
        // 网络和临时错误可以重试
        const retriableErrors = [
            'timeout',
            'connect',
            'network',
            'temporary',
            'server error',
            '500',
            '502',
            '503',
            '504',
            'econnreset',
            'enotfound',
            'econnrefused'
        ];
        
        return retriableErrors.some(pattern => lowerMsg.includes(pattern));
    }

    /**
     * 判断是否为明确不可重试的错误
     */
    private isNonRetriableError(errorMessage: string): boolean {
        const lowerMsg = errorMessage.toLowerCase();
        
        // 这些错误不应该重试
        const nonRetriableErrors = [
            '404',
            '403',
            '401',
            'not found',
            'forbidden',
            'unauthorized',
            'invalid url',
            'malformed',
            'file exists',
            'disk quota'
        ];
        
        return nonRetriableErrors.some(pattern => lowerMsg.includes(pattern));
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