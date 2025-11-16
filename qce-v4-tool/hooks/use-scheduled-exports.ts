import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';
import { useApi } from './use-api';
import type { APIResponse, CreateScheduledExportForm } from '@/types/api';

export interface ScheduledExportConfig {
    id?: string;
    name: string;
    peer: {
        chatType: number;
        peerUid: string;
        guildId: string;
    };
    scheduleType: 'daily' | 'weekly' | 'monthly' | 'custom';
    executeTime: string;
    cronExpression?: string;
    timeRangeType: 'yesterday' | 'last-week' | 'last-month' | 'last-7-days' | 'last-30-days' | 'custom';
    customTimeRange?: {
        startTime: number;
        endTime: number;
    };
    format: 'JSON' | 'HTML' | 'TXT';
    options: {
        includeResourceLinks?: boolean;
        includeSystemMessages?: boolean;
        filterPureImageMessages?: boolean;
        prettyFormat?: boolean;
    };
    enabled: boolean;
    createdAt?: string;
    lastRun?: string;
    nextRun?: string;
}

export interface ExecutionHistory {
    id: string;
    scheduledExportId: string;
    executedAt: string;
    status: 'success' | 'failed' | 'partial';
    messageCount?: number;
    filePath?: string;
    fileSize?: number;
    error?: string;
    duration: number;
}

export function useScheduledExports() {
    const [tasks, setTasks] = useState<(ScheduledExportConfig & { id: string })[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { apiCall } = useApi();

    // 获取所有定时导出任务
    const fetchTasks = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            
            const response = await apiCall('/api/scheduled-exports') as APIResponse<{
                scheduledExports: (ScheduledExportConfig & { id: string })[]
            }>;
            
            if (response.success && response.data) {
                setTasks(response.data.scheduledExports || []);
            } else {
                throw new Error(response.error?.message || '获取任务列表失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '获取任务列表失败';
            setError(errorMsg);
            toast({
                title: "错误",
                description: errorMsg,
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }, [apiCall]);

    // 创建定时导出任务
    const createTask = useCallback(async (formData: CreateScheduledExportForm) => {
        try {
            setLoading(true);
            
            // 将表单数据转换为API配置格式
            const config: ScheduledExportConfig = {
                name: formData.name,
                peer: {
                    chatType: formData.chatType,
                    peerUid: formData.peerUid,
                    guildId: "",
                },
                scheduleType: formData.scheduleType,
                executeTime: formData.executeTime,
                cronExpression: formData.cronExpression,
                timeRangeType: formData.timeRangeType,
                customTimeRange: formData.customTimeRange,
                format: formData.format as 'JSON' | 'HTML' | 'TXT',
                options: {
                    includeResourceLinks: formData.includeResourceLinks ?? true,
                    includeSystemMessages: formData.includeSystemMessages ?? true,
                    filterPureImageMessages: formData.filterPureImageMessages ?? false,
                    prettyFormat: true,
                },
                enabled: formData.enabled,
            };
            
            const response = await apiCall('/api/scheduled-exports', {
                method: 'POST',
                body: JSON.stringify(config),
            }) as APIResponse<ScheduledExportConfig & { id: string }>;
            
            if (response.success && response.data) {
                toast({
                    title: "成功",
                    description: "定时导出任务创建成功"
                });
                await fetchTasks(); // 刷新列表
                return response.data;
            } else {
                throw new Error(response.error?.message || '创建任务失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '创建任务失败';
            toast({
                title: "错误",
                description: errorMsg,
                variant: "destructive"
            });
            throw err;
        } finally {
            setLoading(false);
        }
    }, [apiCall, fetchTasks]);

    // 更新定时导出任务
    const updateTask = useCallback(async (id: string, updates: Partial<ScheduledExportConfig>) => {
        try {
            setLoading(true);
            
            const response = await apiCall(`/api/scheduled-exports/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates),
            }) as APIResponse<ScheduledExportConfig & { id: string }>;
            
            if (response.success && response.data) {
                toast({
                    title: "成功",
                    description: "任务更新成功"
                });
                await fetchTasks(); // 刷新列表
                return response.data;
            } else {
                throw new Error(response.error?.message || '更新任务失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '更新任务失败';
            toast({
                title: "错误",
                description: errorMsg,
                variant: "destructive"
            });
            throw err;
        } finally {
            setLoading(false);
        }
    }, [apiCall, fetchTasks]);

    // 删除定时导出任务
    const deleteTask = useCallback(async (id: string) => {
        try {
            setLoading(true);
            
            const response = await apiCall(`/api/scheduled-exports/${id}`, {
                method: 'DELETE',
            }) as APIResponse<{ message: string }>;
            
            if (response.success) {
                toast({
                    title: "成功",
                    description: "任务删除成功"
                });
                await fetchTasks(); // 刷新列表
                return true;
            } else {
                throw new Error(response.error?.message || '删除任务失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '删除任务失败';
            toast({
                title: "错误",
                description: errorMsg,
                variant: "destructive"
            });
            throw err;
        } finally {
            setLoading(false);
        }
    }, [apiCall, fetchTasks]);

    // 手动触发定时导出任务
    const triggerTask = useCallback(async (id: string) => {
        try {
            setLoading(true);
            
            const response = await apiCall(`/api/scheduled-exports/${id}/trigger`, {
                method: 'POST',
            }) as APIResponse<{ message: string }>;
            
            if (response.success) {
                toast({
                    title: "成功",
                    description: "任务触发成功，正在后台执行"
                });
                await fetchTasks(); // 刷新列表
                return response.data;
            } else {
                throw new Error(response.error?.message || '触发任务失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '触发任务失败';
            toast({
                title: "错误",
                description: errorMsg,
                variant: "destructive"
            });
            throw err;
        } finally {
            setLoading(false);
        }
    }, [apiCall, fetchTasks]);

    // 获取任务执行历史
    const fetchTaskHistory = useCallback(async (id: string, limit: number = 50): Promise<ExecutionHistory[]> => {
        try {
            const response = await apiCall(`/api/scheduled-exports/${id}/history?limit=${limit}`) as APIResponse<{
                history: ExecutionHistory[]
            }>;
            
            if (response.success && response.data) {
                return response.data.history || [];
            } else {
                throw new Error(response.error?.message || '获取执行历史失败');
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '获取执行历史失败';
            console.error('获取执行历史失败:', err);
            return [];
        }
    }, [apiCall]);

    // 检查API连接状态
    const checkConnection = useCallback(async (): Promise<boolean> => {
        try {
            const response = await apiCall('/api/scheduled-exports');
            return response.success;
        } catch {
            return false;
        }
    }, [apiCall]);

    // 获取统计信息
    const getStats = useCallback(() => {
        return {
            total: tasks.length,
            enabled: tasks.filter(task => task.enabled).length,
            disabled: tasks.filter(task => !task.enabled).length,
            daily: tasks.filter(task => task.scheduleType === 'daily').length,
        };
    }, [tasks]);

    // 组件挂载时自动获取任务列表
    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    return {
        scheduledExports: tasks,
        loading,
        error,
        loadScheduledExports: fetchTasks,
        createScheduledExport: createTask,
        updateScheduledExport: updateTask,
        deleteScheduledExport: deleteTask,
        triggerScheduledExport: triggerTask,
        toggleScheduledExport: async (id: string, enabled: boolean) => {
            const task = tasks.find(t => t.id === id);
            if (task) {
                return await updateTask(id, { ...task, enabled });
            }
            return false;
        },
        getExecutionHistory: fetchTaskHistory,
        getStats,
        setError: setError,
    };
}

// 辅助函数：格式化执行频率显示
export function formatScheduleType(scheduleType: string): string {
    switch (scheduleType) {
        case 'daily':
            return '每天';
        case 'weekly':
            return '每周';
        case 'monthly':
            return '每月';
        case 'custom':
            return '自定义';
        default:
            return scheduleType;
    }
}

// 辅助函数：格式化时间范围显示
export function formatTimeRangeType(timeRangeType: string): string {
    switch (timeRangeType) {
        case 'yesterday':
            return '昨天';
        case 'last-week':
            return '上周';
        case 'last-month':
            return '上月';
        case 'last-7-days':
            return '最近7天';
        case 'last-30-days':
            return '最近30天';
        case 'custom':
            return '自定义';
        default:
            return timeRangeType;
    }
}

// 辅助函数：格式化文件大小
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 辅助函数：格式化持续时间
export function formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
        return `${milliseconds}ms`;
    } else if (milliseconds < 60000) {
        return `${(milliseconds / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
}

// 预设配置模板
export const PRESET_CONFIGS = {
    dailyFriendBackup: {
        name: '每日好友备份',
        scheduleType: 'daily' as const,
        executeTime: '02:00',
        timeRangeType: 'yesterday' as const,
        format: 'HTML' as const,
        options: {
            includeResourceLinks: true,
            includeSystemMessages: true,
            filterPureImageMessages: false,
            prettyFormat: true
        },
        enabled: true
    },
    weeklyGroupReport: {
        name: '周报备份',
        scheduleType: 'weekly' as const,
        executeTime: '09:00',
        timeRangeType: 'last-week' as const,
        format: 'JSON' as const,
        options: {
            includeResourceLinks: true,
            includeSystemMessages: false,
            filterPureImageMessages: false,
            prettyFormat: true
        },
        enabled: true
    },
    monthlyArchive: {
        name: '月度存档',
        scheduleType: 'monthly' as const,
        executeTime: '01:00',
        timeRangeType: 'last-month' as const,
        format: 'HTML' as const,
        options: {
            includeResourceLinks: true,
            includeSystemMessages: true,
            filterPureImageMessages: false,
            prettyFormat: true
        },
        enabled: true
    }
};