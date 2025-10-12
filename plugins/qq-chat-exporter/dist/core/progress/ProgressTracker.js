/**
 * 进度跟踪器
 * 负责任务进度的实时跟踪、持久化存储和状态管理
 * 支持多任务并发、断点续传和详细的进度统计
 */
import { EventEmitter } from 'events';
import { ExportTaskState, ExportTaskStatus, ExportTaskConfig, EventType, EventData, SystemError, ErrorType } from '../../types.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
/**
 * 预定义的任务阶段
 */
const DEFAULT_PHASES = [
    { name: 'init', description: '初始化任务', weight: 5, status: 'pending' },
    { name: 'fetch', description: '获取消息数据', weight: 60, status: 'pending' },
    { name: 'process', description: '处理消息内容', weight: 20, status: 'pending' },
    { name: 'export', description: '导出文件', weight: 10, status: 'pending' },
    { name: 'finalize', description: '完成任务', weight: 5, status: 'pending' }
];
/**
 * 进度跟踪器类
 * 提供全面的任务进度监控和管理功能
 */
export class ProgressTracker extends EventEmitter {
    taskStates = new Map();
    taskConfigs = new Map(); // 存储任务配置以支持自动保存
    progressSnapshots = new Map();
    performanceStats = new Map();
    taskPhases = new Map();
    dbManager;
    /** 自动保存间隔（毫秒） */
    autoSaveInterval = 5000;
    /** 自动保存定时器 */
    autoSaveTimers = new Map();
    /** 性能监控定时器 */
    performanceTimers = new Map();
    /**
     * 构造函数
     * @param dbManager 数据库管理器实例
     */
    constructor(dbManager) {
        super();
        this.dbManager = dbManager;
        this.setMaxListeners(100); // 支持更多监听器
    }
    /**
     * 初始化任务跟踪
     * 设置初始状态并开始监控
     *
     * @param taskId 任务ID
     * @param config 任务配置
     * @param totalMessages 总消息数
     * @param phases 自定义阶段（可选）
     */
    async initializeTask(taskId, config, totalMessages, phases = DEFAULT_PHASES) {
        try {
            // 检查是否已存在任务状态（断点续传）
            const existingTask = await this.dbManager.loadTask(taskId);
            let taskState;
            if (existingTask) {
                // 恢复现有任务状态
                taskState = existingTask.state;
                taskState.status = ExportTaskStatus.RUNNING;
                // 恢复阶段信息
                const existingPhases = this.taskPhases.get(taskId) || [...phases];
                this.taskPhases.set(taskId, existingPhases);
            }
            else {
                // 创建新任务状态
                taskState = {
                    taskId,
                    status: ExportTaskStatus.RUNNING,
                    totalMessages,
                    processedMessages: 0,
                    successCount: 0,
                    failureCount: 0,
                    startTime: new Date(),
                    processingSpeed: 0
                };
                // 设置阶段信息
                this.taskPhases.set(taskId, [...phases]);
            }
            // 存储任务状态和配置
            this.taskStates.set(taskId, taskState);
            this.taskConfigs.set(taskId, config); // 存储配置以支持自动保存
            // 初始化进度快照
            if (!this.progressSnapshots.has(taskId)) {
                this.progressSnapshots.set(taskId, []);
            }
            // 初始化性能统计
            this.performanceStats.set(taskId, {
                averageSpeed: 0,
                peakSpeed: 0,
                currentSpeed: 0,
                speedHistory: []
            });
            // 启动自动保存
            this.startAutoSave(taskId);
            // 启动性能监控
            this.startPerformanceMonitoring(taskId);
            // 发送初始化事件
            this.emitEvent(EventType.TASK_STATUS_CHANGED, {
                taskId,
                status: taskState.status,
                progress: this.calculateOverallProgress(taskId)
            });
        }
        catch (error) {
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '初始化任务跟踪失败',
                details: error,
                timestamp: new Date(),
                context: { taskId, totalMessages }
            });
        }
    }
    /**
     * 更新消息处理进度
     *
     * @param taskId 任务ID
     * @param processedCount 已处理数量
     * @param successCount 成功数量（可选）
     * @param failureCount 失败数量（可选）
     * @param currentMessageId 当前处理的消息ID（可选）
     */
    updateProgress(taskId, processedCount, successCount, failureCount, currentMessageId) {
        const taskState = this.taskStates.get(taskId);
        if (!taskState) {
            console.warn(`任务状态不存在: ${taskId}`);
            return;
        }
        // 更新基础统计
        taskState.processedMessages = processedCount;
        if (successCount !== undefined)
            taskState.successCount = successCount;
        if (failureCount !== undefined)
            taskState.failureCount = failureCount;
        if (currentMessageId !== undefined)
            taskState.currentMessageId = currentMessageId;
        // 计算处理速度
        this.calculateProcessingSpeed(taskId);
        // 估计剩余时间
        this.estimateRemainingTime(taskId);
        // 更新阶段进度
        this.updatePhaseProgress(taskId);
        // 记录进度快照
        this.recordProgressSnapshot(taskId);
        // 发送进度更新事件
        this.emitEvent(EventType.TASK_PROGRESS_UPDATED, {
            taskId,
            processed: processedCount,
            total: taskState.totalMessages,
            percentage: Math.round((processedCount / taskState.totalMessages) * 100),
            speed: taskState.processingSpeed,
            estimatedTimeRemaining: taskState.estimatedTimeRemaining
        });
    }
    /**
     * 设置当前任务阶段
     *
     * @param taskId 任务ID
     * @param phaseName 阶段名称
     */
    setTaskPhase(taskId, phaseName) {
        const phases = this.taskPhases.get(taskId);
        if (!phases)
            return;
        // 标记当前阶段为完成，新阶段为运行中
        let found = false;
        for (const phase of phases) {
            if (phase.name === phaseName) {
                if (phase.status === 'pending') {
                    phase.status = 'running';
                    phase.startTime = new Date();
                }
                found = true;
            }
            else if (phase.status === 'running' && phase.name !== phaseName) {
                phase.status = 'completed';
                phase.endTime = new Date();
            }
        }
        if (!found) {
            console.warn(`未找到阶段: ${phaseName}`);
            return;
        }
        // 更新总进度
        const taskState = this.taskStates.get(taskId);
        if (taskState) {
            // 发送阶段变更事件
            this.emitEvent(EventType.MESSAGE_FETCH_PROGRESS, {
                taskId,
                phase: phaseName,
                phases: phases.map(p => ({
                    name: p.name,
                    description: p.description,
                    status: p.status
                }))
            });
        }
    }
    /**
     * 完成任务
     *
     * @param taskId 任务ID
     * @param error 错误信息（如果失败）
     */
    async completeTask(taskId, error) {
        const taskState = this.taskStates.get(taskId);
        if (!taskState)
            return;
        // 更新任务状态
        taskState.status = error ? ExportTaskStatus.FAILED : ExportTaskStatus.COMPLETED;
        taskState.endTime = new Date();
        taskState.error = error;
        // 标记所有阶段为完成或失败
        const phases = this.taskPhases.get(taskId);
        if (phases) {
            phases.forEach(phase => {
                if (phase.status === 'running' || phase.status === 'pending') {
                    phase.status = error ? 'failed' : 'completed';
                    phase.endTime = new Date();
                }
            });
        }
        // 停止定时器
        this.stopAutoSave(taskId);
        this.stopPerformanceMonitoring(taskId);
        // 最终保存
        try {
            const taskConfig = this.taskConfigs.get(taskId);
            if (taskConfig) {
                await this.dbManager.saveTask(taskConfig, taskState);
                console.debug(`任务 ${taskId} 最终状态已保存`);
            }
            else {
                console.warn(`无法保存任务 ${taskId}: 配置不存在`);
            }
        }
        catch (saveError) {
            console.error('保存任务状态失败:', saveError);
        }
        // 发送完成事件
        const eventType = error ? EventType.TASK_FAILED : EventType.TASK_COMPLETED;
        this.emitEvent(eventType, {
            taskId,
            status: taskState.status,
            totalProcessed: taskState.processedMessages,
            successCount: taskState.successCount,
            failureCount: taskState.failureCount,
            duration: taskState.endTime.getTime() - (taskState.startTime?.getTime() || 0),
            error
        });
        // 清理资源
        this.cleanupTask(taskId);
    }
    /**
     * 暂停任务
     *
     * @param taskId 任务ID
     */
    pauseTask(taskId) {
        const taskState = this.taskStates.get(taskId);
        if (!taskState)
            return;
        taskState.status = ExportTaskStatus.PAUSED;
        // 暂停定时器
        this.stopAutoSave(taskId);
        this.stopPerformanceMonitoring(taskId);
        this.emitEvent(EventType.TASK_STATUS_CHANGED, {
            taskId,
            status: taskState.status
        });
    }
    /**
     * 恢复任务
     *
     * @param taskId 任务ID
     */
    resumeTask(taskId) {
        const taskState = this.taskStates.get(taskId);
        if (!taskState)
            return;
        taskState.status = ExportTaskStatus.RUNNING;
        // 重启定时器
        this.startAutoSave(taskId);
        this.startPerformanceMonitoring(taskId);
        this.emitEvent(EventType.TASK_STATUS_CHANGED, {
            taskId,
            status: taskState.status
        });
    }
    /**
     * 取消任务
     *
     * @param taskId 任务ID
     */
    async cancelTask(taskId) {
        await this.completeTask(taskId, '任务已被用户取消');
        const taskState = this.taskStates.get(taskId);
        if (taskState) {
            taskState.status = ExportTaskStatus.CANCELLED;
        }
    }
    /**
     * 获取任务状态
     *
     * @param taskId 任务ID
     * @returns 任务状态
     */
    getTaskState(taskId) {
        return this.taskStates.get(taskId);
    }
    /**
     * 获取任务性能统计
     *
     * @param taskId 任务ID
     * @returns 性能统计
     */
    getPerformanceStats(taskId) {
        return this.performanceStats.get(taskId);
    }
    /**
     * 获取任务阶段信息
     *
     * @param taskId 任务ID
     * @returns 阶段信息
     */
    getTaskPhases(taskId) {
        return this.taskPhases.get(taskId);
    }
    /**
     * 获取进度历史
     *
     * @param taskId 任务ID
     * @returns 进度快照列表
     */
    getProgressHistory(taskId) {
        return this.progressSnapshots.get(taskId) || [];
    }
    /**
     * 计算处理速度
     */
    calculateProcessingSpeed(taskId) {
        const taskState = this.taskStates.get(taskId);
        const snapshots = this.progressSnapshots.get(taskId);
        if (!taskState || !snapshots || snapshots.length === 0)
            return;
        const now = new Date();
        const startTime = taskState.startTime || now;
        const elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
        if (elapsedSeconds > 0) {
            // 计算整体平均速度
            taskState.processingSpeed = taskState.processedMessages / elapsedSeconds;
            // 更新性能统计
            const perfStats = this.performanceStats.get(taskId);
            if (perfStats && taskState.processingSpeed !== undefined) {
                perfStats.currentSpeed = taskState.processingSpeed;
                perfStats.averageSpeed = taskState.processingSpeed;
                // 记录速度历史
                perfStats.speedHistory.push(taskState.processingSpeed);
                if (perfStats.speedHistory.length > 60) {
                    perfStats.speedHistory.shift(); // 保持最近60个数据点
                }
                // 更新峰值速度
                if (taskState.processingSpeed > perfStats.peakSpeed) {
                    perfStats.peakSpeed = taskState.processingSpeed;
                }
            }
        }
    }
    /**
     * 估计剩余时间
     */
    estimateRemainingTime(taskId) {
        const taskState = this.taskStates.get(taskId);
        if (!taskState || !taskState.processingSpeed || taskState.processingSpeed <= 0)
            return;
        const remainingMessages = taskState.totalMessages - taskState.processedMessages;
        taskState.estimatedTimeRemaining = Math.round((remainingMessages / taskState.processingSpeed) * 1000);
    }
    /**
     * 更新阶段进度
     */
    updatePhaseProgress(taskId) {
        const phases = this.taskPhases.get(taskId);
        if (!phases)
            return;
        // 找到当前运行的阶段
        const currentPhase = phases.find(p => p.status === 'running');
        if (!currentPhase)
            return;
    }
    /**
     * 计算总体进度
     */
    calculateOverallProgress(taskId) {
        const taskState = this.taskStates.get(taskId);
        const phases = this.taskPhases.get(taskId);
        if (!taskState || !phases)
            return 0;
        // 基于阶段权重计算总进度
        let totalWeight = 0;
        let completedWeight = 0;
        for (const phase of phases) {
            totalWeight += phase.weight;
            if (phase.status === 'completed') {
                completedWeight += phase.weight;
            }
            else if (phase.status === 'running') {
                // 对于正在运行的阶段，根据消息处理进度计算部分权重
                const messageProgress = taskState.totalMessages > 0 ?
                    taskState.processedMessages / taskState.totalMessages : 0;
                completedWeight += phase.weight * messageProgress;
            }
        }
        return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
    }
    /**
     * 记录进度快照
     */
    recordProgressSnapshot(taskId) {
        const taskState = this.taskStates.get(taskId);
        const phases = this.taskPhases.get(taskId);
        if (!taskState)
            return;
        const currentPhase = phases?.find(p => p.status === 'running');
        const snapshot = {
            timestamp: new Date(),
            processedMessages: taskState.processedMessages,
            successCount: taskState.successCount,
            failureCount: taskState.failureCount,
            speed: taskState.processingSpeed || 0,
            phase: currentPhase?.name || 'unknown'
        };
        let snapshots = this.progressSnapshots.get(taskId);
        if (!snapshots) {
            snapshots = [];
            this.progressSnapshots.set(taskId, snapshots);
        }
        snapshots.push(snapshot);
        // 保持最近1000个快照
        if (snapshots.length > 1000) {
            snapshots.shift();
        }
    }
    /**
     * 启动自动保存
     */
    startAutoSave(taskId) {
        this.stopAutoSave(taskId); // 先停止现有的定时器
        const timer = setInterval(async () => {
            try {
                const taskState = this.taskStates.get(taskId);
                const taskConfig = this.taskConfigs.get(taskId);
                if (taskState && taskConfig) {
                    // 保存任务状态到数据库
                    await this.dbManager.saveTask(taskConfig, taskState);
                    console.debug(`自动保存任务 ${taskId} 成功`);
                }
                else {
                    console.warn(`自动保存失败: 任务 ${taskId} 的状态或配置不存在`);
                }
            }
            catch (error) {
                console.error(`自动保存任务 ${taskId} 失败:`, error);
            }
        }, this.autoSaveInterval);
        this.autoSaveTimers.set(taskId, timer);
    }
    /**
     * 停止自动保存
     */
    stopAutoSave(taskId) {
        const timer = this.autoSaveTimers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.autoSaveTimers.delete(taskId);
        }
    }
    /**
     * 启动性能监控
     */
    startPerformanceMonitoring(taskId) {
        this.stopPerformanceMonitoring(taskId); // 先停止现有的定时器
        const timer = setInterval(() => {
            const perfStats = this.performanceStats.get(taskId);
            if (perfStats) {
                if (perfStats.currentSpeed < perfStats.averageSpeed * 0.3) {
                    this.emitEvent(EventType.HEALTH_STATUS_CHANGED, {
                        taskId,
                        warning: '处理速度显著下降',
                        currentSpeed: perfStats.currentSpeed,
                        averageSpeed: perfStats.averageSpeed
                    });
                }
            }
        }, 10000); // 每10秒检查一次
        this.performanceTimers.set(taskId, timer);
    }
    /**
     * 停止性能监控
     */
    stopPerformanceMonitoring(taskId) {
        const timer = this.performanceTimers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.performanceTimers.delete(taskId);
        }
    }
    /**
     * 清理任务资源
     */
    cleanupTask(taskId) {
        // 停止定时器
        this.stopAutoSave(taskId);
        this.stopPerformanceMonitoring(taskId);
        // 清理内存中的数据（保留一段时间用于查询）
        setTimeout(() => {
            this.taskStates.delete(taskId);
            this.taskConfigs.delete(taskId); // 清理任务配置
            this.progressSnapshots.delete(taskId);
            this.performanceStats.delete(taskId);
            this.taskPhases.delete(taskId);
        }, 60000); // 1分钟后清理
    }
    /**
     * 发送事件
     */
    emitEvent(type, data) {
        const eventData = {
            type,
            data,
            timestamp: new Date()
        };
        this.emit(type, eventData);
        this.emit('event', eventData); // 通用事件
    }
    /**
     * 获取所有活跃任务
     */
    getActiveTasks() {
        return Array.from(this.taskStates.values()).filter(state => state.status === ExportTaskStatus.RUNNING ||
            state.status === ExportTaskStatus.PAUSED);
    }
    /**
     * 生成进度报告
     *
     * @param taskId 任务ID
     * @returns 详细的进度报告
     */
    generateProgressReport(taskId) {
        const taskState = this.taskStates.get(taskId);
        const perfStats = this.performanceStats.get(taskId);
        const phases = this.taskPhases.get(taskId);
        const snapshots = this.progressSnapshots.get(taskId);
        if (!taskState)
            return null;
        return {
            taskId,
            status: taskState.status,
            progress: {
                processed: taskState.processedMessages,
                total: taskState.totalMessages,
                percentage: Math.round((taskState.processedMessages / taskState.totalMessages) * 100),
                success: taskState.successCount,
                failure: taskState.failureCount
            },
            timing: {
                startTime: taskState.startTime,
                endTime: taskState.endTime,
                estimatedRemaining: taskState.estimatedTimeRemaining
            },
            performance: perfStats,
            phases: phases?.map(p => ({
                name: p.name,
                description: p.description,
                status: p.status,
                startTime: p.startTime,
                endTime: p.endTime
            })),
            snapshotCount: snapshots?.length || 0,
            generatedAt: new Date()
        };
    }
}
//# sourceMappingURL=ProgressTracker.js.map