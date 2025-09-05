'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Clock, Download, Play, Settings, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ScheduledExportConfig {
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
        prettyFormat?: boolean;
    };
    enabled: boolean;
    createdAt?: string;
    lastRun?: string;
    nextRun?: string;
}

interface ScheduledExportFormProps {
    onSubmit: (config: ScheduledExportConfig) => void;
    initialData?: ScheduledExportConfig;
    onCancel?: () => void;
}

export function ScheduledExportForm({ onSubmit, initialData, onCancel }: ScheduledExportFormProps) {
    const [config, setConfig] = useState<ScheduledExportConfig>({
        name: '',
        peer: {
            chatType: 1,
            peerUid: '',
            guildId: ''
        },
        scheduleType: 'daily',
        executeTime: '02:00',
        timeRangeType: 'yesterday',
        format: 'HTML',
        options: {
            includeResourceLinks: true,
            includeSystemMessages: true,
            prettyFormat: true
        },
        enabled: true
    });

    useEffect(() => {
        if (initialData) {
            setConfig(initialData);
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!config.name.trim()) {
            toast.error('请输入任务名称');
            return;
        }

        if (!config.peer.peerUid.trim()) {
            toast.error('请输入聊天对象UID');
            return;
        }

        onSubmit(config);
    };

    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {initialData ? '编辑定时导出任务' : '创建定时导出任务'}
                </CardTitle>
                <CardDescription>
                    设置自动导出聊天记录的计划任务
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* 基本信息 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">基本信息</h3>
                        
                        <div className="space-y-2">
                            <Label htmlFor="name">任务名称</Label>
                            <Input
                                id="name"
                                value={config.name}
                                onChange={(e) => setConfig(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="例如：每日备份-我的好友"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="chatType">聊天类型</Label>
                                <Select 
                                    value={config.peer.chatType.toString()} 
                                    onValueChange={(value) => setConfig(prev => ({ 
                                        ...prev, 
                                        peer: { ...prev.peer, chatType: parseInt(value) }
                                    }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">私聊</SelectItem>
                                        <SelectItem value="2">群聊</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="peerUid">聊天对象UID</Label>
                                <Input
                                    id="peerUid"
                                    value={config.peer.peerUid}
                                    onChange={(e) => setConfig(prev => ({ 
                                        ...prev, 
                                        peer: { ...prev.peer, peerUid: e.target.value }
                                    }))}
                                    placeholder={config.peer.chatType === 1 ? "u_xxxxxxxxxxxx" : "123456789"}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 调度设置 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            调度设置
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>执行频率</Label>
                                <Select 
                                    value={config.scheduleType} 
                                    onValueChange={(value: any) => setConfig(prev => ({ ...prev, scheduleType: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="daily">每天</SelectItem>
                                        <SelectItem value="weekly">每周</SelectItem>
                                        <SelectItem value="monthly">每月</SelectItem>
                                        <SelectItem value="custom">自定义</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="executeTime">执行时间</Label>
                                <Input
                                    id="executeTime"
                                    type="time"
                                    value={config.executeTime}
                                    onChange={(e) => setConfig(prev => ({ ...prev, executeTime: e.target.value }))}
                                />
                            </div>
                        </div>

                        {config.scheduleType === 'custom' && (
                            <div className="space-y-2">
                                <Label htmlFor="cron">Cron表达式</Label>
                                <Input
                                    id="cron"
                                    value={config.cronExpression || ''}
                                    onChange={(e) => setConfig(prev => ({ ...prev, cronExpression: e.target.value }))}
                                    placeholder="0 2 * * * (每天凌晨2点)"
                                />
                                <p className="text-sm text-muted-foreground">
                                    格式：分 时 日 月 周，例如 "0 2 * * *" 表示每天凌晨2点
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 时间范围 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">时间范围</h3>

                        <div className="space-y-2">
                            <Label>导出范围</Label>
                            <Select 
                                value={config.timeRangeType} 
                                onValueChange={(value: any) => setConfig(prev => ({ ...prev, timeRangeType: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="yesterday">昨天 (0:00-23:59)</SelectItem>
                                    <SelectItem value="last-week">上周 (完整一周)</SelectItem>
                                    <SelectItem value="last-month">上月 (完整一月)</SelectItem>
                                    <SelectItem value="last-7-days">最近7天</SelectItem>
                                    <SelectItem value="last-30-days">最近30天</SelectItem>
                                    <SelectItem value="custom">自定义</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {config.timeRangeType === 'custom' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>开始时间偏移 (秒)</Label>
                                    <Input
                                        type="number"
                                        value={config.customTimeRange?.startTime || -86400}
                                        onChange={(e) => setConfig(prev => ({ 
                                            ...prev, 
                                            customTimeRange: { 
                                                ...prev.customTimeRange, 
                                                startTime: parseInt(e.target.value),
                                                endTime: prev.customTimeRange?.endTime || 0
                                            }
                                        }))}
                                        placeholder="-86400"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        负数表示过去的时间，-86400 = 昨天
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label>结束时间偏移 (秒)</Label>
                                    <Input
                                        type="number"
                                        value={config.customTimeRange?.endTime || 0}
                                        onChange={(e) => setConfig(prev => ({ 
                                            ...prev, 
                                            customTimeRange: { 
                                                ...prev.customTimeRange, 
                                                startTime: prev.customTimeRange?.startTime || -86400,
                                                endTime: parseInt(e.target.value)
                                            }
                                        }))}
                                        placeholder="0"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        0 = 当前时间
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 导出设置 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            导出设置
                        </h3>

                        <div className="space-y-2">
                            <Label>导出格式</Label>
                            <Select 
                                value={config.format} 
                                onValueChange={(value: any) => setConfig(prev => ({ ...prev, format: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="HTML">HTML (推荐)</SelectItem>
                                    <SelectItem value="JSON">JSON</SelectItem>
                                    <SelectItem value="TXT">TXT</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="includeResources">包含资源链接</Label>
                                <Switch
                                    id="includeResources"
                                    checked={config.options.includeResourceLinks}
                                    onCheckedChange={(checked) => setConfig(prev => ({
                                        ...prev,
                                        options: { ...prev.options, includeResourceLinks: checked }
                                    }))}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="includeSystem">包含系统消息</Label>
                                <Switch
                                    id="includeSystem"
                                    checked={config.options.includeSystemMessages}
                                    onCheckedChange={(checked) => setConfig(prev => ({
                                        ...prev,
                                        options: { ...prev.options, includeSystemMessages: checked }
                                    }))}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="prettyFormat">格式化输出</Label>
                                <Switch
                                    id="prettyFormat"
                                    checked={config.options.prettyFormat}
                                    onCheckedChange={(checked) => setConfig(prev => ({
                                        ...prev,
                                        options: { ...prev.options, prettyFormat: checked }
                                    }))}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="enabled">启用任务</Label>
                                <Switch
                                    id="enabled"
                                    checked={config.enabled}
                                    onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enabled: checked }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 提交按钮 */}
                    <div className="flex justify-end gap-2">
                        {onCancel && (
                            <Button type="button" variant="outline" onClick={onCancel}>
                                取消
                            </Button>
                        )}
                        <Button type="submit">
                            {initialData ? '更新任务' : '创建任务'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

interface ScheduledExportListProps {
    tasks: (ScheduledExportConfig & { id: string })[];
    onEdit: (task: ScheduledExportConfig & { id: string }) => void;
    onDelete: (id: string) => void;
    onTrigger: (id: string) => void;
}

export function ScheduledExportList({ tasks, onEdit, onDelete, onTrigger }: ScheduledExportListProps) {
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">定时导出任务</h2>
            
            {tasks.length === 0 ? (
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>暂无定时导出任务</p>
                            <p className="text-sm">点击"创建任务"按钮添加您的第一个定时导出任务</p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {tasks.map((task) => (
                        <Card key={task.id}>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-semibold">{task.name}</h3>
                                        <p className="text-sm text-muted-foreground mb-2">
                                            {task.peer.chatType === 1 ? '私聊' : '群聊'} • {task.format}格式 • {task.scheduleType === 'daily' ? '每天' : task.scheduleType === 'weekly' ? '每周' : task.scheduleType === 'monthly' ? '每月' : '自定义'}
                                        </p>
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <span>执行时间: {task.executeTime}</span>
                                            <span>导出范围: {
                                                task.timeRangeType === 'yesterday' ? '昨天' :
                                                task.timeRangeType === 'last-week' ? '上周' :
                                                task.timeRangeType === 'last-month' ? '上月' :
                                                task.timeRangeType === 'last-7-days' ? '最近7天' :
                                                task.timeRangeType === 'last-30-days' ? '最近30天' : '自定义'
                                            }</span>
                                            <span className={`px-2 py-1 rounded-full text-xs ${
                                                task.enabled 
                                                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' 
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                                            }`}>
                                                {task.enabled ? '已启用' : '已禁用'}
                                            </span>
                                        </div>
                                        {task.lastRun && (
                                            <p className="text-sm text-muted-foreground mt-1">
                                                上次运行: {new Date(task.lastRun).toLocaleString()}
                                            </p>
                                        )}
                                        {task.nextRun && (
                                            <p className="text-sm text-muted-foreground">
                                                下次运行: {new Date(task.nextRun).toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onTrigger(task.id)}
                                            disabled={!task.enabled}
                                        >
                                            <Play className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onEdit(task)}
                                        >
                                            <Settings className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onDelete(task.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}