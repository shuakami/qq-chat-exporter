/**
 * 定时导出管理器
 * 负责管理和执行定时导出任务
 */

// import cron from 'node-cron'; // 暂时注释，需要安装依赖

interface ScheduledTask {
    stop(): void;
    nextDate?(): { toDate(): Date };
}

// 简单的调度器实现，替代node-cron
class SimpleCronScheduler {
    static schedule(cronExpression: string, callback: () => void, options: { scheduled: boolean; timezone?: string } = { scheduled: true }): ScheduledTask {
        let intervalId: NodeJS.Timeout | null = null;
        
        if (options.scheduled) {
            // 简单实现：每分钟检查一次
            intervalId = setInterval(() => {
                const now = new Date();
                if (this.shouldExecute(cronExpression, now)) {
                    callback();
                }
            }, 60000);
        }
        
        return {
            stop: () => {
                if (intervalId) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
            },
            nextDate: () => ({
                toDate: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 简单返回明天
            })
        };
    }
    
    private static shouldExecute(cronExpression: string, now: Date): boolean {
        // 简单的cron表达式解析 (分 时 日 月 周)
        const parts = cronExpression.split(' ');
        if (parts.length !== 5) return false;
        
        const minute = now.getMinutes();
        const hour = now.getHours();
        const day = now.getDate();
        const month = now.getMonth() + 1;
        const weekday = now.getDay();
        
        return this.matchesPart(parts[0] || '*', minute) &&
               this.matchesPart(parts[1] || '*', hour) &&
               this.matchesPart(parts[2] || '*', day) &&
               this.matchesPart(parts[3] || '*', month) &&
               this.matchesPart(parts[4] || '*', weekday === 0 ? 7 : weekday); // 转换周日
    }
    
    private static matchesPart(pattern: string, value: number): boolean {
        if (pattern === '*') return true;
        if (pattern.includes(',')) {
            return pattern.split(',').some(p => this.matchesPart(p.trim(), value));
        }
        if (pattern.includes('/')) {
            const parts = pattern.split('/');
            const range = parts[0] || '*';
            const step = parts[1] || '1';
            const stepValue = parseInt(step);
            if (range === '*') {
                return value % stepValue === 0;
            }
        }
        return parseInt(pattern) === value;
    }
}
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
import { SimpleMessageParser } from '../parser/SimpleMessageParser.js';
import { ModernHtmlExporter } from '../exporter/ModernHtmlExporter.js';
import { JsonExporter } from '../exporter/JsonExporter.js';
import { TextExporter } from '../exporter/TextExporter.js';
import { BatchMessageFetcher } from '../fetcher/BatchMessageFetcher.js';
import { ResourceHandler } from '../resource/ResourceHandler.js';
import { RawMessage } from 'NapCatQQ/src/core/types.js';
// import { ChatType } from 'NapCatQQ/src/core/types.js';
import path from 'path';
import fs from 'fs';

/**
 * 定时规则类型
 */
export type ScheduleType = 
    | 'daily'           // 每天
    | 'weekly'          // 每周
    | 'monthly'         // 每月  
    | 'custom'          // 自定义cron表达式

/**
 * 时间范围类型
 */
export type TimeRangeType = 
    | 'yesterday'       // 昨天
    | 'last-week'       // 上周
    | 'last-month'      // 上月
    | 'last-7-days'     // 最近7天
    | 'last-30-days'    // 最近30天
    | 'custom'          // 自定义时间范围

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
        startTime: number;  // 相对当前时间的秒数（负数表示过去）
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
export class ScheduledExportManager {
    private core: NapCatCore;
    private dbManager: DatabaseManager;
    private resourceHandler: ResourceHandler;
    
    private scheduledTasks: Map<string, ScheduledExportConfig> = new Map();
    private cronJobs: Map<string, ScheduledTask> = new Map();
    private executionHistory: Map<string, ExecutionHistory[]> = new Map();
    
    constructor(core: NapCatCore, dbManager: DatabaseManager, resourceHandler: ResourceHandler) {
        this.core = core;
        this.dbManager = dbManager;
        this.resourceHandler = resourceHandler;
    }

    /**
     * 初始化调度器
     */
    async initialize(): Promise<void> {
        await this.loadScheduledTasks();
        this.startAllEnabledTasks();
        console.log('[ScheduledExportManager] 定时导出管理器已初始化');
    }

    /**
     * 创建定时导出任务
     */
    async createScheduledExport(config: Omit<ScheduledExportConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledExportConfig> {
        const now = new Date();
        const scheduledExport: ScheduledExportConfig = {
            ...config,
            id: `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            createdAt: now,
            updatedAt: now,
            nextRun: this.calculateNextRun(config.scheduleType, config.cronExpression, config.executeTime)
        };

        this.scheduledTasks.set(scheduledExport.id, scheduledExport);
        await this.saveScheduledTask(scheduledExport);

        if (scheduledExport.enabled) {
            this.startTask(scheduledExport);
        }

        console.log(`[ScheduledExportManager] 创建定时导出任务: ${scheduledExport.name} (${scheduledExport.id})`);
        return scheduledExport;
    }

    /**
     * 更新定时导出任务
     */
    async updateScheduledExport(id: string, updates: Partial<ScheduledExportConfig>): Promise<ScheduledExportConfig | null> {
        const existingTask = this.scheduledTasks.get(id);
        if (!existingTask) {
            return null;
        }

        const updatedTask: ScheduledExportConfig = {
            ...existingTask,
            ...updates,
            id: existingTask.id, // 确保ID不被修改
            createdAt: existingTask.createdAt, // 确保创建时间不被修改
            updatedAt: new Date(),
            nextRun: this.calculateNextRun(
                updates.scheduleType || existingTask.scheduleType,
                updates.cronExpression || existingTask.cronExpression,
                updates.executeTime || existingTask.executeTime
            )
        };

        this.scheduledTasks.set(id, updatedTask);
        await this.saveScheduledTask(updatedTask);

        // 重新调度任务
        this.stopTask(id);
        if (updatedTask.enabled) {
            this.startTask(updatedTask);
        }

        console.log(`[ScheduledExportManager] 更新定时导出任务: ${updatedTask.name} (${id})`);
        return updatedTask;
    }

    /**
     * 删除定时导出任务
     */
    async deleteScheduledExport(id: string): Promise<boolean> {
        const task = this.scheduledTasks.get(id);
        if (!task) {
            return false;
        }

        this.stopTask(id);
        this.scheduledTasks.delete(id);
        this.executionHistory.delete(id);

        // 从数据库删除
        await this.dbManager.deleteScheduledExport(id);

        console.log(`[ScheduledExportManager] 删除定时导出任务: ${task.name} (${id})`);
        return true;
    }

    /**
     * 获取所有定时导出任务
     */
    getAllScheduledExports(): ScheduledExportConfig[] {
        return Array.from(this.scheduledTasks.values());
    }

    /**
     * 获取指定的定时导出任务
     */
    getScheduledExport(id: string): ScheduledExportConfig | null {
        return this.scheduledTasks.get(id) || null;
    }

    /**
     * 手动触发定时导出任务
     */
    async triggerScheduledExport(id: string): Promise<ExecutionHistory | null> {
        const task = this.scheduledTasks.get(id);
        if (!task) {
            return null;
        }

        console.log(`[ScheduledExportManager] 手动触发定时导出任务: ${task.name} (${id})`);
        return await this.executeExportTask(task);
    }

    /**
     * 获取任务执行历史
     */
    async getExecutionHistory(scheduledExportId: string, limit: number = 50): Promise<ExecutionHistory[]> {
        // 从数据库获取执行历史
        return await this.dbManager.getExecutionHistory(scheduledExportId, limit);
    }

    /**
     * 计算下次执行时间
     */
    private calculateNextRun(scheduleType: ScheduleType, cronExpression?: string, executeTime?: string): Date {
        const now = new Date();

        if (scheduleType === 'custom' && cronExpression) {
            // 使用cron表达式计算下次执行时间
            const scheduledTask = SimpleCronScheduler.schedule(cronExpression, () => {}, { scheduled: false });
            return scheduledTask.nextDate ? scheduledTask.nextDate().toDate() : new Date(Date.now() + 24 * 60 * 60 * 1000);
        }

        // 解析执行时间
        const timeParts = (executeTime || '02:00').split(':');
        const hour = parseInt(timeParts[0] || '2');
        const minute = parseInt(timeParts[1] || '0');
        const nextRun = new Date(now);
        nextRun.setHours(hour, minute, 0, 0);

        // 如果当前时间已过今天的执行时间，则设置为下一个周期
        if (nextRun <= now) {
            switch (scheduleType) {
                case 'daily':
                    nextRun.setDate(nextRun.getDate() + 1);
                    break;
                case 'weekly':
                    nextRun.setDate(nextRun.getDate() + 7);
                    break;
                case 'monthly':
                    nextRun.setMonth(nextRun.getMonth() + 1);
                    break;
            }
        }

        return nextRun;
    }

    /**
     * 计算时间范围
     */
    private calculateTimeRange(timeRangeType: TimeRangeType, customTimeRange?: { startTime: number; endTime: number }): { startTime: number; endTime: number } {
        const now = Date.now();
        
        switch (timeRangeType) {
            case 'yesterday': {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();
                const end = start + 24 * 60 * 60 * 1000 - 1;
                return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
            }
            case 'last-week': {
                const lastWeek = new Date();
                lastWeek.setDate(lastWeek.getDate() - 7);
                const start = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate()).getTime();
                const end = start + 7 * 24 * 60 * 60 * 1000 - 1;
                return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
            }
            case 'last-month': {
                const lastMonth = new Date();
                lastMonth.setMonth(lastMonth.getMonth() - 1);
                const start = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).getTime();
                const end = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
                return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
            }
            case 'last-7-days': {
                const end = now;
                const start = now - 7 * 24 * 60 * 60 * 1000;
                return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
            }
            case 'last-30-days': {
                const end = now;
                const start = now - 30 * 24 * 60 * 60 * 1000;
                return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
            }
            case 'custom': {
                if (customTimeRange) {
                    return {
                        startTime: Math.floor((now + customTimeRange.startTime * 1000) / 1000),
                        endTime: Math.floor((now + customTimeRange.endTime * 1000) / 1000)
                    };
                }
                // 默认为昨天
                return this.calculateTimeRange('yesterday');
            }
            default:
                return this.calculateTimeRange('yesterday');
        }
    }

    /**
     * 启动单个任务
     */
    private startTask(task: ScheduledExportConfig): void {
        if (this.cronJobs.has(task.id)) {
            this.stopTask(task.id);
        }

        let cronExpression: string;

        if (task.scheduleType === 'custom' && task.cronExpression) {
            cronExpression = task.cronExpression;
        } else {
            const [hour, minute] = task.executeTime.split(':').map(Number);
            switch (task.scheduleType) {
                case 'daily':
                    cronExpression = `${minute} ${hour} * * *`;
                    break;
                case 'weekly':
                    cronExpression = `${minute} ${hour} * * 1`; // 每周一
                    break;
                case 'monthly':
                    cronExpression = `${minute} ${hour} 1 * *`; // 每月1号
                    break;
                default:
                    cronExpression = `${minute} ${hour} * * *`; // 默认每天
            }
        }

        const cronJob = SimpleCronScheduler.schedule(cronExpression, async () => {
            console.log(`[ScheduledExportManager] 执行定时导出任务: ${task.name} (${task.id})`);
            await this.executeExportTask(task);
        }, {
            scheduled: true,
            timezone: 'Asia/Shanghai'
        });

        this.cronJobs.set(task.id, cronJob);
        console.log(`[ScheduledExportManager] 启动定时任务: ${task.name} (${task.id}), cron: ${cronExpression}`);
    }

    /**
     * 停止单个任务
     */
    private stopTask(id: string): void {
        const cronJob = this.cronJobs.get(id);
        if (cronJob) {
            cronJob.stop();
            this.cronJobs.delete(id);
            console.log(`[ScheduledExportManager] 停止定时任务: ${id}`);
        }
    }

    /**
     * 启动所有启用的任务
     */
    private startAllEnabledTasks(): void {
        for (const task of this.scheduledTasks.values()) {
            if (task.enabled) {
                this.startTask(task);
            }
        }
    }

    /**
     * 执行导出任务
     */
    private async executeExportTask(task: ScheduledExportConfig): Promise<ExecutionHistory> {
        const startTime = Date.now();
        const historyId = `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const history: ExecutionHistory = {
            id: historyId,
            scheduledExportId: task.id,
            executedAt: new Date(),
            status: 'failed',
            duration: 0
        };

        try {
            // 计算时间范围
            const timeRange = this.calculateTimeRange(task.timeRangeType, task.customTimeRange);
            
            // 获取消息
            const fetcher = new BatchMessageFetcher(this.core, {
                batchSize: 1000,
                timeout: 30000,
                retryCount: 3
            });

            const allMessages: RawMessage[] = [];
            const messageGenerator = fetcher.fetchAllMessagesInTimeRange(
                task.peer,
                timeRange.startTime * 1000,
                timeRange.endTime * 1000
            );

            for await (const batch of messageGenerator) {
                allMessages.push(...batch);
            }

            if (allMessages.length === 0) {
                history.status = 'success';
                history.messageCount = 0;
                history.error = '指定时间范围内没有消息';
                return history;
            }

            // 下载资源
            const resourceMap = await this.resourceHandler.processMessageResources(allMessages);

            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const sessionName = task.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
            const fileName = `${sessionName}_${timestamp}.${task.format.toLowerCase()}`;
            
            const outputDir = task.outputDir || path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            const filePath = path.join(outputDir, fileName);

            // 导出文件
            const chatInfo = {
                name: task.name,
                type: (task.peer.chatType === 2 ? 'group' : 'private') as 'group' | 'private'
            };

            const parser = new SimpleMessageParser();

            switch (task.format.toUpperCase()) {
                case 'HTML':
                    // 🚀 使用流式导出HTML，优化内存占用
                    const htmlExporter = new ModernHtmlExporter({
                        outputPath: filePath,
                        includeResourceLinks: task.options.includeResourceLinks ?? true,
                        includeSystemMessages: task.options.includeSystemMessages ?? true
                    });
                    const htmlMessageStream = parser.parseMessagesStream(allMessages, resourceMap);
                    await htmlExporter.exportFromIterable(htmlMessageStream, chatInfo);
                    break;
                case 'JSON':
                    // JSON/TXT 导出仍需要解析全部消息（它们本身就比较轻量）
                    const parsedMessagesForJson = await parser.parseMessages(allMessages);
                    if (resourceMap.size > 0) {
                        await parser.updateResourcePaths(parsedMessagesForJson, resourceMap);
                    }
                    const jsonExporter = new JsonExporter({
                        outputPath: filePath,
                        includeResourceLinks: task.options.includeResourceLinks ?? true,
                        includeSystemMessages: task.options.includeSystemMessages ?? true,
                        prettyFormat: task.options.prettyFormat ?? true,
                        timeFormat: 'YYYY-MM-DD HH:mm:ss',
                        encoding: 'utf-8'
                    });
                    await jsonExporter.export(parsedMessagesForJson as any, chatInfo);
                    break;
                case 'TXT':
                    const parsedMessagesForTxt = await parser.parseMessages(allMessages);
                    if (resourceMap.size > 0) {
                        await parser.updateResourcePaths(parsedMessagesForTxt, resourceMap);
                    }
                    const textExporter = new TextExporter({
                        outputPath: filePath,
                        includeResourceLinks: task.options.includeResourceLinks ?? true,
                        includeSystemMessages: task.options.includeSystemMessages ?? true,
                        timeFormat: 'YYYY-MM-DD HH:mm:ss',
                        prettyFormat: false,
                        encoding: 'utf-8'
                    });
                    await textExporter.export(parsedMessagesForTxt as any, chatInfo);
                    break;
            }

            const stats = fs.statSync(filePath);
            
            history.status = 'success';
            history.messageCount = allMessages.length;
            history.filePath = filePath;
            history.fileSize = stats.size;

            // 更新任务的上次执行时间
            task.lastRun = new Date();
            task.nextRun = this.calculateNextRun(task.scheduleType, task.cronExpression, task.executeTime);
            await this.saveScheduledTask(task);

            console.log(`[ScheduledExportManager] 定时导出任务执行成功: ${task.name}, 消息数: ${allMessages.length}, 文件: ${fileName}`);

        } catch (error) {
            history.status = 'failed';
            history.error = error instanceof Error ? error.message : String(error);
            console.error(`[ScheduledExportManager] 定时导出任务执行失败: ${task.name}`, error);
        } finally {
            history.duration = Date.now() - startTime;
            
            // 保存执行历史
            if (!this.executionHistory.has(task.id)) {
                this.executionHistory.set(task.id, []);
            }
            const taskHistory = this.executionHistory.get(task.id)!;
            taskHistory.push(history);
            
            // 只保留最近100条记录
            if (taskHistory.length > 100) {
                taskHistory.splice(0, taskHistory.length - 100);
            }

            // 保存到数据库
            await this.saveExecutionHistory(history);
        }

        return history;
    }

    /**
     * 从数据库加载定时任务
     */
    private async loadScheduledTasks(): Promise<void> {
        try {
            const tasks = await this.dbManager.getScheduledExports();
            for (const task of tasks) {
                this.scheduledTasks.set(task.id, task);
            }
            console.log(`[ScheduledExportManager] 加载了 ${tasks.length} 个定时导出任务`);
        } catch (error) {
            console.error('[ScheduledExportManager] 加载定时导出任务失败:', error);
        }
    }

    /**
     * 保存定时任务到数据库
     */
    private async saveScheduledTask(task: ScheduledExportConfig): Promise<void> {
        try {
            await this.dbManager.saveScheduledExport(task);
        } catch (error) {
            console.error('[ScheduledExportManager] 保存定时导出任务失败:', error);
        }
    }

    /**
     * 保存执行历史到数据库
     */
    private async saveExecutionHistory(history: ExecutionHistory): Promise<void> {
        try {
            await this.dbManager.saveExecutionHistory(history);
        } catch (error) {
            console.error('[ScheduledExportManager] 保存执行历史失败:', error);
        }
    }

    /**
     * 关闭调度器
     */
    shutdown(): void {
        for (const cronJob of this.cronJobs.values()) {
            cronJob.stop();
        }
        this.cronJobs.clear();
        console.log('[ScheduledExportManager] 定时导出管理器已关闭');
    }
}