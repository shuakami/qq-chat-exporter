/**
 * 进度跟踪器
 * 负责任务进度的实时跟踪、持久化存储和状态管理
 * 支持多任务并发、断点续传和详细的进度统计
 */
import { EventEmitter } from 'events';
import { ExportTaskState, ExportTaskConfig } from '../../types.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
/**
 * 进度快照接口
 * 用于记录特定时间点的进度状态
 */
interface ProgressSnapshot {
    /** 快照时间 */
    timestamp: Date;
    /** 已处理消息数 */
    processedMessages: number;
    /** 成功处理数 */
    successCount: number;
    /** 失败处理数 */
    failureCount: number;
    /** 处理速度（消息/秒） */
    speed: number;
    /** 阶段描述 */
    phase: string;
}
/**
 * 性能统计接口
 */
interface PerformanceStats {
    /** 平均处理速度（消息/秒） */
    averageSpeed: number;
    /** 峰值处理速度（消息/秒） */
    peakSpeed: number;
    /** 当前处理速度（消息/秒） */
    currentSpeed: number;
    /** 处理速度历史（最近60个数据点） */
    speedHistory: number[];
    /** CPU使用率估计 */
    estimatedCpuUsage?: number;
    /** 内存使用量估计（MB） */
    estimatedMemoryUsage?: number;
}
/**
 * 阶段定义接口
 */
interface TaskPhase {
    /** 阶段名称 */
    name: string;
    /** 阶段描述 */
    description: string;
    /** 阶段权重（用于计算总进度） */
    weight: number;
    /** 阶段开始时间 */
    startTime?: Date;
    /** 阶段结束时间 */
    endTime?: Date;
    /** 阶段状态 */
    status: 'pending' | 'running' | 'completed' | 'failed';
}
/**
 * 进度跟踪器类
 * 提供全面的任务进度监控和管理功能
 */
export declare class ProgressTracker extends EventEmitter {
    private readonly taskStates;
    private readonly taskConfigs;
    private readonly progressSnapshots;
    private readonly performanceStats;
    private readonly taskPhases;
    private readonly dbManager;
    /** 自动保存间隔（毫秒） */
    private readonly autoSaveInterval;
    /** 自动保存定时器 */
    private autoSaveTimers;
    /** 性能监控定时器 */
    private performanceTimers;
    /**
     * 构造函数
     * @param dbManager 数据库管理器实例
     */
    constructor(dbManager: DatabaseManager);
    /**
     * 初始化任务跟踪
     * 设置初始状态并开始监控
     *
     * @param taskId 任务ID
     * @param config 任务配置
     * @param totalMessages 总消息数
     * @param phases 自定义阶段（可选）
     */
    initializeTask(taskId: string, config: ExportTaskConfig, totalMessages: number, phases?: TaskPhase[]): Promise<void>;
    /**
     * 更新消息处理进度
     *
     * @param taskId 任务ID
     * @param processedCount 已处理数量
     * @param successCount 成功数量（可选）
     * @param failureCount 失败数量（可选）
     * @param currentMessageId 当前处理的消息ID（可选）
     */
    updateProgress(taskId: string, processedCount: number, successCount?: number, failureCount?: number, currentMessageId?: string): void;
    /**
     * 设置当前任务阶段
     *
     * @param taskId 任务ID
     * @param phaseName 阶段名称
     */
    setTaskPhase(taskId: string, phaseName: string): void;
    /**
     * 完成任务
     *
     * @param taskId 任务ID
     * @param error 错误信息（如果失败）
     */
    completeTask(taskId: string, error?: string): Promise<void>;
    /**
     * 暂停任务
     *
     * @param taskId 任务ID
     */
    pauseTask(taskId: string): void;
    /**
     * 恢复任务
     *
     * @param taskId 任务ID
     */
    resumeTask(taskId: string): void;
    /**
     * 取消任务
     *
     * @param taskId 任务ID
     */
    cancelTask(taskId: string): Promise<void>;
    /**
     * 获取任务状态
     *
     * @param taskId 任务ID
     * @returns 任务状态
     */
    getTaskState(taskId: string): ExportTaskState | undefined;
    /**
     * 获取任务性能统计
     *
     * @param taskId 任务ID
     * @returns 性能统计
     */
    getPerformanceStats(taskId: string): PerformanceStats | undefined;
    /**
     * 获取任务阶段信息
     *
     * @param taskId 任务ID
     * @returns 阶段信息
     */
    getTaskPhases(taskId: string): TaskPhase[] | undefined;
    /**
     * 获取进度历史
     *
     * @param taskId 任务ID
     * @returns 进度快照列表
     */
    getProgressHistory(taskId: string): ProgressSnapshot[];
    /**
     * 计算处理速度
     */
    private calculateProcessingSpeed;
    /**
     * 估计剩余时间
     */
    private estimateRemainingTime;
    /**
     * 更新阶段进度
     */
    private updatePhaseProgress;
    /**
     * 计算总体进度
     */
    private calculateOverallProgress;
    /**
     * 记录进度快照
     */
    private recordProgressSnapshot;
    /**
     * 启动自动保存
     */
    private startAutoSave;
    /**
     * 停止自动保存
     */
    private stopAutoSave;
    /**
     * 启动性能监控
     */
    private startPerformanceMonitoring;
    /**
     * 停止性能监控
     */
    private stopPerformanceMonitoring;
    /**
     * 清理任务资源
     */
    private cleanupTask;
    /**
     * 发送事件
     */
    private emitEvent;
    /**
     * 获取所有活跃任务
     */
    getActiveTasks(): ExportTaskState[];
    /**
     * 生成进度报告
     *
     * @param taskId 任务ID
     * @returns 详细的进度报告
     */
    generateProgressReport(taskId: string): any;
}
export {};
//# sourceMappingURL=ProgressTracker.d.ts.map