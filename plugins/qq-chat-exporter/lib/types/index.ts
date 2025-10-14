/**
 * QQ聊天记录导出系统 - 类型定义
 */

import { NTMsgType, Peer, RawMessage } from 'NapCatQQ/src/core/index.js';

// 重新导出核心类型
export type { Peer };

/**
 * 导出任务状态枚举
 */
export enum ExportTaskStatus {
    /** 等待中 */
    PENDING = 'pending',
    /** 执行中 */
    RUNNING = 'running',
    /** 已暂停 */
    PAUSED = 'paused',
    /** 已完成 */
    COMPLETED = 'completed',
    /** 失败 */
    FAILED = 'failed',
    /** 已取消 */
    CANCELLED = 'cancelled'
}

/**
 * 导出格式枚举
 */
export enum ExportFormat {
    /** 纯文本格式 */
    TXT = 'txt',
    /** JSON格式 */
    JSON = 'json',
    /** HTML格式 */
    HTML = 'html',
    /** Excel格式 */
    EXCEL = 'excel'
}

/**
 * 聊天类型枚举
 */
export enum ChatTypeSimple {
    /** 私聊 */
    PRIVATE = 'private',
    /** 群聊 */
    GROUP = 'group',
    /** 临时聊天 */
    TEMP = 'temp'
}

/**
 * 消息筛选条件接口
 */
export interface MessageFilter {
    /** 开始时间（Unix时间戳，秒） */
    startTime?: number;
    /** 结束时间（Unix时间戳，秒） */
    endTime?: number;
    /** 发送者UID列表（为空则获取所有） */
    senderUids?: string[];
    /** 消息类型筛选 */
    messageTypes?: Array<{
        type: NTMsgType;
        subTypes?: number[];
    }>;
    /** 关键词筛选 */
    keywords?: string[];
    /** 是否包含撤回消息 */
    includeRecalled?: boolean;
    /** 是否包含系统消息 */
    includeSystem?: boolean;
    /** 是否过滤掉纯多媒体消息（图片、视频、音频、文件等） */
    filterPureImageMessages?: boolean;
}

/**
 * 导出任务配置接口
 */
export interface ExportTaskConfig {
    /** 任务ID */
    taskId: string;
    /** 任务名称 */
    taskName: string;
    /** 聊天对象信息 */
    peer: Peer;
    /** 聊天类型 */
    chatType: ChatTypeSimple;
    /** 聊天对象名称（群名/好友昵称） */
    chatName: string;
    /** 聊天对象头像URL */
    chatAvatar?: string;
    /** 导出格式 */
    formats: ExportFormat[];
    /** 消息筛选条件 */
    filter: MessageFilter;
    /** 输出目录 */
    outputDir: string;
    /** 是否包含资源文件链接 */
    includeResourceLinks: boolean;
    /** 批量获取大小 */
    batchSize: number;
    /** 超时设置（毫秒） */
    timeout: number;
    /** 重试次数 */
    retryCount: number;
    /** 创建时间 */
    createdAt: Date;
    /** 更新时间 */
    updatedAt: Date;
}

/**
 * 导出任务状态接口
 */
export interface ExportTaskState {
    /** 任务ID */
    taskId: string;
    /** 当前状态 */
    status: ExportTaskStatus;
    /** 总消息数 */
    totalMessages: number;
    /** 已处理消息数 */
    processedMessages: number;
    /** 成功处理数 */
    successCount: number;
    /** 失败处理数 */
    failureCount: number;
    /** 当前处理的消息ID */
    currentMessageId?: string;
    /** 错误信息 */
    error?: string;
    /** 开始时间 */
    startTime?: Date;
    /** 结束时间 */
    endTime?: Date;
    /** 估计剩余时间（毫秒） */
    estimatedTimeRemaining?: number;
    /** 处理速度（消息/秒） */
    processingSpeed?: number;
}

/**
 * 批量消息获取结果接口
 */
export interface BatchFetchResult {
    /** 获取到的消息列表 */
    messages: RawMessage[];
    /** 是否还有更多消息 */
    hasMore: boolean;
    /** 下一批次的起始消息ID */
    nextMessageId?: string;
    /** 下一批次的起始序列号 */
    nextSeq?: string;
    /** 实际获取数量 */
    actualCount: number;
    /** 获取耗时（毫秒） */
    fetchTime: number;
    /** 批次中最早消息的时间（毫秒） */
    earliestMsgTime?: number;
}

/**
 * 资源类型
 */
export type ResourceType = 'image' | 'video' | 'audio' | 'file';

/**
 * 资源状态
 */
export enum ResourceStatus {
    PENDING = 'pending',         // 待处理
    DOWNLOADING = 'downloading', // 下载中
    DOWNLOADED = 'downloaded',   // 已下载
    FAILED = 'failed',          // 失败
    CORRUPTED = 'corrupted',    // 损坏
    SKIPPED = 'skipped'         // 已跳过（不可下载）
}

/**
 * 资源文件信息接口
 */
export interface ResourceInfo {
    /** 资源类型 */
    type: ResourceType;
    /** 原始URL */
    originalUrl: string;
    /** 本地存储路径 */
    localPath?: string;
    /** 文件名 */
    fileName: string;
    /** 文件大小（字节） */
    fileSize: number;
    /** MIME类型 */
    mimeType?: string;
    /** MD5哈希值 */
    md5: string;
    /** 是否可访问 */
    accessible: boolean;
    /** 检查时间 */
    checkedAt: Date;
    /** 资源状态 */
    status?: ResourceStatus;
    /** 下载尝试次数 */
    downloadAttempts?: number;
    /** 最后错误信息 */
    lastError?: string;
}

/**
 * 导出结果接口
 */
export interface ExportResult {
    /** 任务ID */
    taskId: string;
    /** 导出格式 */
    format: ExportFormat;
    /** 输出文件路径 */
    filePath: string;
    /** 文件大小（字节） */
    fileSize: number;
    /** 导出的消息数量 */
    messageCount: number;
    /** 包含的资源数量 */
    resourceCount: number;
    /** 导出耗时（毫秒） */
    exportTime: number;
    /** 导出完成时间 */
    completedAt: Date;
}

/**
 * API调用统计接口
 */
export interface ApiCallStats {
    /** 调用次数 */
    callCount: number;
    /** 成功次数 */
    successCount: number;
    /** 失败次数 */
    failureCount: number;
    /** 平均响应时间（毫秒） */
    averageResponseTime: number;
    /** 最后调用时间 */
    lastCallTime: Date;
    /** 连续失败次数 */
    consecutiveFailures: number;
}

/**
 * 健康监控状态接口
 */
export interface HealthStatus {
    /** 是否健康 */
    isHealthy: boolean;
    /** API调用统计 */
    apiStats: ApiCallStats;
    /** 错误信息 */
    errors: string[];
    /** 警告信息 */
    warnings: string[];
    /** 检查时间 */
    checkedAt: Date;
}

/**
 * 系统配置接口
 */
export interface SystemConfig {
    /** 数据库文件路径 */
    databasePath: string;
    /** 输出根目录 */
    outputRootDir: string;
    /** 默认批量大小 */
    defaultBatchSize: number;
    /** 默认超时时间（毫秒） */
    defaultTimeout: number;
    /** 默认重试次数 */
    defaultRetryCount: number;
    /** 最大并发任务数 */
    maxConcurrentTasks: number;
    /** 资源健康检查间隔（毫秒） */
    resourceHealthCheckInterval: number;
    /** 是否启用调试日志 */
    enableDebugLog: boolean;
    /** WebUI端口 */
    webuiPort: number;
}

/**
 * 数据库记录接口
 */
export interface DatabaseRecord {
    /** 记录ID */
    id: number;
    /** 创建时间 */
    createdAt: Date;
    /** 更新时间 */
    updatedAt: Date;
}

/**
 * 任务数据库记录接口
 */
export interface TaskDbRecord extends DatabaseRecord {
    /** 任务ID */
    taskId: string;
    /** 任务配置（JSON字符串） */
    config: string;
    /** 任务状态（JSON字符串） */
    state: string;
}

/**
 * 消息数据库记录接口
 */
export interface MessageDbRecord extends DatabaseRecord {
    /** 任务ID */
    taskId: string;
    /** 消息ID */
    messageId: string;
    /** 消息序列号 */
    messageSeq: string;
    /** 消息时间 */
    messageTime: string;
    /** 发送者UID */
    senderUid: string;
    /** 消息内容（JSON字符串） */
    content: string;
    /** 是否已处理 */
    processed: boolean;
}

/**
 * 资源数据库记录接口
 */
export interface ResourceDbRecord extends DatabaseRecord {
    /** 任务ID */
    taskId: string;
    /** 消息ID */
    messageId: string;
    /** 资源信息（JSON字符串） */
    resourceInfo: string;
}

/**
 * 事件类型枚举
 */
export enum EventType {
    /** 任务状态变更 */
    TASK_STATUS_CHANGED = 'task_status_changed',
    /** 任务进度更新 */
    TASK_PROGRESS_UPDATED = 'task_progress_updated',
    /** 任务完成 */
    TASK_COMPLETED = 'task_completed',
    /** 任务失败 */
    TASK_FAILED = 'task_failed',
    /** 消息获取进度 */
    MESSAGE_FETCH_PROGRESS = 'message_fetch_progress',
    /** 导出进度 */
    EXPORT_PROGRESS = 'export_progress',
    /** 系统错误 */
    SYSTEM_ERROR = 'system_error',
    /** 健康状态变更 */
    HEALTH_STATUS_CHANGED = 'health_status_changed'
}

/**
 * 事件数据接口
 */
export interface EventData {
    /** 事件类型 */
    type: EventType;
    /** 事件数据 */
    data: any;
    /** 时间戳 */
    timestamp: Date;
}

/**
 * WebUI API响应接口
 */
export interface ApiResponse<T = any> {
    /** 是否成功 */
    success: boolean;
    /** 响应数据 */
    data?: T;
    /** 错误消息 */
    message?: string;
    /** 错误代码 */
    code?: string;
    /** 时间戳 */
    timestamp: Date;
}

/**
 * 聊天会话信息接口
 */
export interface ChatSession {
    /** 会话标识符 */
    id: string;
    /** 聊天类型 */
    type: ChatTypeSimple;
    /** 对等体信息 */
    peer: Peer;
    /** 会话名称 */
    name: string;
    /** 头像URL */
    avatar?: string;
    /** 最后一条消息时间 */
    lastMessageTime?: Date;
    /** 最后一条消息ID */
    lastMessageId?: string;
    /** 消息总数（估计） */
    estimatedMessageCount?: number;
    /** 成员数量（群聊） */
    memberCount?: number;
    /** 是否在线（好友） */
    isOnline?: boolean;
    /** 是否可用 */
    available: boolean;
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
    /** API调用错误 */
    API_ERROR = 'api_error',
    /** 网络错误 */
    NETWORK_ERROR = 'network_error',
    /** 数据库错误 */
    DATABASE_ERROR = 'database_error',
    RESOURCE_ERROR = 'resource_error',
    /** 文件系统错误 */
    FILESYSTEM_ERROR = 'filesystem_error',
    /** 配置错误 */
    CONFIG_ERROR = 'config_error',
    /** 验证错误 */
    VALIDATION_ERROR = 'validation_error',
    /** 权限错误 */
    PERMISSION_ERROR = 'permission_error',
    /** 超时错误 */
    TIMEOUT_ERROR = 'timeout_error',
    /** 认证错误 */
    AUTH_ERROR = 'auth_error',
    /** 未知错误 */
    UNKNOWN_ERROR = 'unknown_error'
}

/**
 * 系统错误接口
 */
export interface SystemErrorData {
    /** 错误类型 */
    type: ErrorType;
    /** 错误消息 */
    message: string;
    /** 错误详情 */
    details?: any;
    /** 错误栈 */
    stack?: string;
    /** 发生时间 */
    timestamp: Date;
    /** 相关上下文 */
    context?: {
        taskId?: string;
        messageId?: string;
        operation?: string;
        [key: string]: any;
    };
}

/**
 * 系统错误类
 */
export class SystemError extends Error {
    public readonly type: ErrorType;
    public readonly details?: any;
    public readonly timestamp: Date;
    public readonly context?: {
        taskId?: string;
        messageId?: string;
        operation?: string;
        [key: string]: any;
    };

    constructor(data: SystemErrorData) {
        super(data.message);
        this.name = 'SystemError';
        this.type = data.type;
        this.details = data.details;
        this.timestamp = data.timestamp;
        this.context = data.context;
        
        if (data.stack) {
            this.stack = data.stack;
        } else if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SystemError);
        }
    }
}