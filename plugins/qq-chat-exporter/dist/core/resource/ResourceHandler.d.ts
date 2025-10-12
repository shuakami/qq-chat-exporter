/**
 * 资源处理器
 * 负责资源的下载、健康检查、缓存管理和熔断机制
 * 支持图片、视频、音频、文件等多种资源类型的处理
 */
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { ResourceInfo } from '../../types.js';
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
 * 资源处理器主类
 */
export declare class ResourceHandler {
    private readonly core;
    private readonly config;
    private readonly dbManager;
    private readonly circuitBreaker;
    private readonly healthChecker;
    private downloadQueue;
    private activeDownloads;
    private isProcessing;
    private healthCheckTimer;
    constructor(core: NapCatCore, dbManager: DatabaseManager, config?: Partial<ResourceHandlerConfig>);
    /**
     * 批量处理消息中的资源
     */
    processMessageResources(messages: RawMessage[]): Promise<Map<string, ResourceInfo[]>>;
    /**
     * 处理单个媒体元素
     */
    private processElement;
    /**
     * 从消息元素提取资源信息
     */
    private extractResourceInfo;
    /**
     * 判断是否为媒体元素
     */
    private isMediaElement;
    /**
     * 生成本地存储路径
     */
    private generateLocalPath;
    /**
     * 添加到下载队列
     */
    private enqueueDownload;
    /**
     * 计算下载优先级
     */
    private calculatePriority;
    /**
     * 处理下载队列
     */
    private processDownloadQueue;
    /**
     * 等待下载槽位
     */
    private waitForDownloadSlot;
    /**
     * 等待所有下载任务完成
     */
    private waitForAllDownloads;
    /**
     * 执行下载任务
     */
    private executeDownload;
    /**
     * 判断是否为可重试的错误
     */
    private isRetriableError;
    /**
     * 判断是否为明确不可重试的错误
     */
    private isNonRetriableError;
    /**
     * 下载资源
     */
    private downloadResource;
    /**
     * 获取MIME类型
     */
    private getMimeTypeFromPicType;
    /**
     * 启动健康检查定时器
     */
    private startHealthCheckTimer;
    /**
     * 执行定期健康检查
     */
    private performScheduledHealthCheck;
    /**
     * 确保存储目录存在
     */
    private ensureStorageDirectory;
    /**
     * 获取统计信息
     */
    getStatistics(): Promise<{
        totalResources: number;
        downloadedResources: number;
        failedResources: number;
        pendingDownloads: number;
        activeDownloads: number;
        circuitBreakerStatus: any;
    }>;
    /**
     * 清理资源
     */
    cleanup(): Promise<void>;
    /**
     * 清理过期缓存文件
     */
    cleanupExpiredCache(): Promise<void>;
}
//# sourceMappingURL=ResourceHandler.d.ts.map