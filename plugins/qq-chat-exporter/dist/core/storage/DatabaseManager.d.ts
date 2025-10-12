/**
 * 数据库管理器
 * 负责所有持久化存储操作，支持任务状态、消息缓存、进度跟踪等
 * 使用高性能JSONL格式确保数据安全和极致性能
 */
import { ExportTaskConfig, ExportTaskState, ResourceInfo, ResourceStatus } from '../../types.js';
import { ScheduledExportConfig, ExecutionHistory } from '../scheduler/ScheduledExportManager.js';
/**
 * 高性能JSONL数据库管理器类
 * 使用JSON Lines格式提供极致性能和完美兼容性
 */
export declare class DatabaseManager {
    private readonly dbDir;
    private readonly backupDir;
    private readonly files;
    /** 内存索引，提供O(1)查询性能 */
    private indexes;
    /** taskId 到记录ID的映射，用于通过taskId查找记录 */
    private taskIdToRecordId;
    /** 是否已初始化 */
    private initialized;
    /** 写入队列，支持批量操作 */
    private writeQueue;
    private writeTimeout;
    /**
     * 构造函数
     * @param dbPath 数据库目录路径
     */
    constructor(dbPath: string);
    /**
     * 初始化JSONL数据库
     * 创建目录结构并加载所有数据到内存索引
     */
    initialize(): Promise<void>;
    /**
     * 初始化JSONL文件
     */
    private initializeFiles;
    /**
     * 加载所有数据到内存索引
     */
    private loadIndexes;
    /**
     * 加载任务索引
     */
    private loadTaskIndex;
    /**
     * 加载消息索引
     */
    private loadMessageIndex;
    /**
     * 加载资源索引
     */
    private loadResourceIndex;
    /**
     * 加载系统信息索引
     */
    private loadSystemInfoIndex;
    /**
     * 设置批量写入机制
     */
    private setupBatchWrite;
    /**
     * 添加数据到写入队列
     */
    private queueWrite;
    /**
     * 调度延时写入
     */
    private scheduleDelayedWrite;
    /**
     * 刷新写入队列
     */
    private flushWriteQueue;
    /**
     * 保存任务配置和状态
     */
    saveTask(config: ExportTaskConfig, state: ExportTaskState): Promise<void>;
    /**
     * 加载任务配置和状态
     */
    loadTask(taskId: string): Promise<{
        config: ExportTaskConfig;
        state: ExportTaskState;
    } | null>;
    /**
     * 获取所有任务
     */
    getAllTasks(): Promise<Array<{
        config: ExportTaskConfig;
        state: ExportTaskState;
    }>>;
    /**
     * 删除任务及其所有相关数据
     */
    deleteTask(taskId: string): Promise<void>;
    /**
     * 重建所有文件（用于删除操作后的清理）
     */
    private rebuildFiles;
    /**
     * 重建任务文件
     */
    private rebuildTaskFile;
    /**
     * 重建消息文件
     */
    private rebuildMessageFile;
    /**
     * 重建资源文件
     */
    private rebuildResourceFile;
    /**
     * 清理失败的任务
     * 删除状态为PENDING或RUNNING但进度为0%的任务
     */
    private cleanupFailedTasks;
    /**
     * 批量保存消息
     */
    saveMessages(taskId: string, messages: any[]): Promise<void>;
    /**
     * 标记消息为已处理
     */
    markMessageProcessed(taskId: string, messageId: string): Promise<void>;
    /**
     * 获取未处理的消息
     */
    getUnprocessedMessages(taskId: string): Promise<any[]>;
    /**
     * 获取任务进度统计
     */
    getTaskProgress(taskId: string): Promise<{
        total: number;
        processed: number;
    }>;
    /**
     * 保存资源信息（遗留方法，保持向后兼容）
     */
    saveResources(_taskId: string, _messageId: string, resources: any[]): Promise<void>;
    /**
     * 获取任务的所有资源（遗留方法，保持向后兼容）
     */
    getTaskResources(_taskId: string): Promise<any[]>;
    /**
     * 设置系统信息
     */
    private setSystemInfo;
    /**
     * 获取系统信息
     */
    getSystemInfo(key: string): string | null;
    /**
     * 创建JSONL数据库备份
     */
    createBackup(): Promise<string>;
    /**
     * 清理旧的备份文件
     */
    cleanupOldBackups(keepDays?: number): Promise<void>;
    /**
     * 获取数据库统计信息
     */
    getDatabaseStats(): Promise<{
        totalTasks: number;
        totalMessages: number;
        totalResources: number;
        databaseSize: number;
    }>;
    /**
     * 执行数据库优化
     */
    optimize(): Promise<void>;
    /**
     * 确保数据库已初始化
     */
    private ensureInitialized;
    /**
     * 关闭数据库连接
     */
    close(): Promise<void>;
    /**
     * 检查数据库连接状态
     */
    isConnected(): boolean;
    /**
     * 保存资源信息
     */
    saveResourceInfo(resourceInfo: ResourceInfo): Promise<void>;
    /**
     * 根据MD5获取资源信息
     */
    getResourceByMd5(md5: string): Promise<ResourceInfo | null>;
    /**
     * 根据状态获取资源列表
     */
    getResourcesByStatus(status: ResourceStatus): Promise<ResourceInfo[]>;
    /**
     * 获取早于指定时间的资源
     */
    getResourcesOlderThan(cutoffTime: Date): Promise<ResourceInfo[]>;
    /**
     * 删除过期资源
     */
    deleteExpiredResources(cutoffTime: Date): Promise<number>;
    /**
     * 获取资源统计信息
     */
    getResourceStatistics(): Promise<{
        total: number;
        downloaded: number;
        failed: number;
        pending: number;
    }>;
    /**
     * 加载定时导出任务索引
     */
    private loadScheduledExportIndex;
    /**
     * 加载执行历史索引
     */
    private loadExecutionHistoryIndex;
    /**
     * 保存定时导出任务
     */
    saveScheduledExport(scheduledExport: ScheduledExportConfig): Promise<void>;
    /**
     * 获取所有定时导出任务
     */
    getScheduledExports(): Promise<ScheduledExportConfig[]>;
    /**
     * 获取指定的定时导出任务
     */
    getScheduledExport(id: string): Promise<ScheduledExportConfig | null>;
    /**
     * 删除定时导出任务
     */
    deleteScheduledExport(id: string): Promise<boolean>;
    /**
     * 保存执行历史
     */
    saveExecutionHistory(history: ExecutionHistory): Promise<void>;
    /**
     * 获取执行历史
     */
    getExecutionHistory(scheduledExportId: string, limit?: number): Promise<ExecutionHistory[]>;
    /**
     * 重建定时导出任务文件
     */
    private rebuildScheduledExportFile;
    /**
     * 重建执行历史文件
     */
    private rebuildExecutionHistoryFile;
}
//# sourceMappingURL=DatabaseManager.d.ts.map