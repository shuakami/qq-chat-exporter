/**
 * 定时导出管理器
 * 负责管理和执行定时导出任务
 */
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
import { ResourceHandler } from '../resource/ResourceHandler.js';
/**
 * 定时规则类型
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'custom';
/**
 * 时间范围类型
 */
export type TimeRangeType = 'yesterday' | 'last-week' | 'last-month' | 'last-7-days' | 'last-30-days' | 'custom';
/**
 * 定时导出任务配置
 */
export interface ScheduledExportConfig {
    /** 任务ID */
    id: string;
    /** 任务名称 */
    name: string;
    /** 聊天对象 */
    peer: {
        chatType: number;
        peerUid: string;
        guildId: string;
    };
    /** 调度类型 */
    scheduleType: ScheduleType;
    /** cron表达式（scheduleType为custom时使用） */
    cronExpression?: string;
    /** 执行时间（scheduleType非custom时使用，格式：HH:mm） */
    executeTime: string;
    /** 时间范围类型 */
    timeRangeType: TimeRangeType;
    /** 自定义时间范围（timeRangeType为custom时使用） */
    customTimeRange?: {
        startTime: number;
        endTime: number;
    };
    /** 导出格式 */
    format: 'JSON' | 'HTML' | 'TXT';
    /** 导出选项 */
    options: {
        includeResourceLinks?: boolean;
        includeSystemMessages?: boolean;
        prettyFormat?: boolean;
    };
    /** 输出目录（可选，默认使用系统目录） */
    outputDir?: string;
    /** 是否启用 */
    enabled: boolean;
    /** 创建时间 */
    createdAt: Date;
    /** 更新时间 */
    updatedAt: Date;
    /** 上次执行时间 */
    lastRun?: Date;
    /** 下次执行时间 */
    nextRun?: Date;
    /** 创建者（可选，用于多用户环境） */
    createdBy?: string;
}
/**
 * 执行历史记录
 */
export interface ExecutionHistory {
    /** 历史记录ID */
    id: string;
    /** 定时任务ID */
    scheduledExportId: string;
    /** 执行时间 */
    executedAt: Date;
    /** 执行状态 */
    status: 'success' | 'failed' | 'partial';
    /** 消息数量 */
    messageCount?: number;
    /** 文件路径 */
    filePath?: string;
    /** 文件大小 */
    fileSize?: number;
    /** 错误信息（失败时） */
    error?: string;
    /** 执行耗时（毫秒） */
    duration: number;
}
/**
 * 定时导出管理器
 */
export declare class ScheduledExportManager {
    private core;
    private dbManager;
    private resourceHandler;
    private scheduledTasks;
    private cronJobs;
    private executionHistory;
    constructor(core: NapCatCore, dbManager: DatabaseManager, resourceHandler: ResourceHandler);
    /**
     * 初始化调度器
     */
    initialize(): Promise<void>;
    /**
     * 创建定时导出任务
     */
    createScheduledExport(config: Omit<ScheduledExportConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledExportConfig>;
    /**
     * 更新定时导出任务
     */
    updateScheduledExport(id: string, updates: Partial<ScheduledExportConfig>): Promise<ScheduledExportConfig | null>;
    /**
     * 删除定时导出任务
     */
    deleteScheduledExport(id: string): Promise<boolean>;
    /**
     * 获取所有定时导出任务
     */
    getAllScheduledExports(): ScheduledExportConfig[];
    /**
     * 获取指定的定时导出任务
     */
    getScheduledExport(id: string): ScheduledExportConfig | null;
    /**
     * 手动触发定时导出任务
     */
    triggerScheduledExport(id: string): Promise<ExecutionHistory | null>;
    /**
     * 获取任务执行历史
     */
    getExecutionHistory(scheduledExportId: string, limit?: number): Promise<ExecutionHistory[]>;
    /**
     * 计算下次执行时间
     */
    private calculateNextRun;
    /**
     * 计算时间范围
     */
    private calculateTimeRange;
    /**
     * 启动单个任务
     */
    private startTask;
    /**
     * 停止单个任务
     */
    private stopTask;
    /**
     * 启动所有启用的任务
     */
    private startAllEnabledTasks;
    /**
     * 执行导出任务
     */
    private executeExportTask;
    /**
     * 从数据库加载定时任务
     */
    private loadScheduledTasks;
    /**
     * 保存定时任务到数据库
     */
    private saveScheduledTask;
    /**
     * 保存执行历史到数据库
     */
    private saveExecutionHistory;
    /**
     * 关闭调度器
     */
    shutdown(): void;
}
//# sourceMappingURL=ScheduledExportManager.d.ts.map