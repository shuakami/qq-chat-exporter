/**
 * 基础导出器
 * 定义导出器的通用接口和基础功能
 * 所有具体格式的导出器都应继承此基类
 */

import fs from 'fs';
import path from 'path';
import { RawMessage } from '@/core';
import { 
    ExportFormat, 
    ExportResult, 
    SystemError, 
    ErrorType 
} from '../../types';
import { MessageParser, MessageParserConfig } from '../parser/MessageParser';
import { NapCatCore } from '../../../core';

/**
 * 导出选项接口
 */
export interface ExportOptions {
    /** 输出文件路径 */
    outputPath: string;
    /** 是否包含资源链接 */
    includeResourceLinks: boolean;
    /** 是否包含系统消息 */
    includeSystemMessages: boolean;
    /** 时间格式 */
    timeFormat: string;
    /** 是否美化输出（适用于JSON等格式） */
    prettyFormat: boolean;
    /** 自定义CSS样式（适用于HTML格式） */
    customCss?: string;
    /** 编码格式 */
    encoding: string;
    /** 分块大小（大文件分块输出） */
    chunkSize?: number;
}

/**
 * 导出进度回调函数类型
 */
export type ProgressCallback = (progress: {
    current: number;
    total: number;
    percentage: number;
    message: string;
}) => void;

/**
 * 基础导出器抽象类
 * 提供导出功能的通用框架和工具方法
 */
export abstract class BaseExporter {
    protected readonly format: ExportFormat;
    protected readonly options: ExportOptions;
    protected readonly core?: NapCatCore; // 添加NapCatCore实例
    protected cancelled: boolean;
    protected progressCallback: ProgressCallback | null;

    /**
     * 构造函数
     * @param format 导出格式
     * @param options 导出选项
     * @param core NapCatCore实例（可选）
     */
    constructor(format: ExportFormat, options: ExportOptions, core?: NapCatCore) {
        this.format = format;
        this.core = core;
        this.options = {
            outputPath: options.outputPath,
            includeResourceLinks: options.includeResourceLinks ?? true,
            includeSystemMessages: options.includeSystemMessages ?? true,
            timeFormat: options.timeFormat || 'YYYY-MM-DD HH:mm:ss',
            prettyFormat: options.prettyFormat ?? true,
            encoding: options.encoding || 'utf-8',
            customCss: options.customCss,
            chunkSize: options.chunkSize
        };
        
        this.cancelled = false;
        this.progressCallback = null;
    }

    /**
     * 设置进度回调
     */
    setProgressCallback(callback: ProgressCallback | null): void {
        this.progressCallback = callback;
    }

    /**
     * 取消导出
     */
    cancel(): void {
        this.cancelled = true;
    }

    /**
     * 导出公共方法
     * @param messages 原始消息数组
     * @param chatInfo 聊天信息
     * @returns 导出结果
     */
    async export(messages: RawMessage[], chatInfo?: any): Promise<ExportResult> {
        const startTime = Date.now();
        
        try {
            this.updateProgress(0, messages.length, `开始${this.format}导出`);
            
            this.ensureOutputDirectory();
            
            // 过滤掉空消息
            const validMessages = messages.filter(m => m);
            
            const content = await this.generateContent(validMessages, chatInfo);
            
            if (this.cancelled) {
                throw new Error('导出已取消');
            }
            
            await this.writeToFile(content);
            
            this.updateProgress(validMessages.length, validMessages.length, '导出完成');
            
            const resourceCount = validMessages.reduce((acc, msg) => {
                const elements = msg.elements || [];
                return acc + elements.filter(e => e.picElement || e.fileElement).length;
            }, 0);

            return {
                taskId: '',
                format: this.format,
                filePath: this.options.outputPath,
                fileSize: this.getFileSize(),
                messageCount: validMessages.length,
                resourceCount: resourceCount,
                exportTime: Date.now() - startTime,
                completedAt: new Date()
            };
            
        } catch (error) {
            throw this.wrapError(error, `${this.format}Export`);
        }
    }

    /**
     * 生成内容的抽象方法
     * 各子类必须实现此方法
     */
    protected abstract generateContent(messages: RawMessage[], chatInfo?: any): Promise<string>;

    /**
     * 检查输出目录是否存在，不存在则创建
     */
    protected ensureOutputDirectory(): void {
        const dir = path.dirname(this.options.outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * 获取消息解析器实例
     */
    protected getMessageParser(core: NapCatCore): MessageParser {
        const config: MessageParserConfig = {
            includeResourceLinks: this.options.includeResourceLinks,
            includeSystemMessages: this.options.includeSystemMessages,
            parseMarketFace: true,
            parseCardMessages: true,
            parseMultiForward: true,
            fetchUserInfo: false,
            timeFormat: this.options.timeFormat,
            maxTextLength: 50000,
            debugMode: false
        };
        
        return new MessageParser(core, config);
    }

    /**
     * 写入文件
     */
    protected async writeToFile(content: string): Promise<void> {
        try {
            this.ensureOutputDirectory();
            await fs.promises.writeFile(this.options.outputPath, content, { encoding: this.options.encoding as BufferEncoding });
        } catch (error) {
            throw this.wrapError(error, 'writeToFile');
        }
    }

    /**
     * 获取文件大小
     */
    protected getFileSize(): number {
        try {
            const stats = fs.statSync(this.options.outputPath);
            return stats.size;
        } catch (error) {
            return 0;
        }
    }

    /**
     * 更新进度
     */
    protected updateProgress(current: number, total: number, message: string): void {
        if (this.progressCallback) {
            const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
            this.progressCallback({
                current,
                total,
                percentage,
                message
            });
        }
    }

    /**
     * HTML转义
     */
    protected escapeHtml(text: string): string {
        const htmlEscapes: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        
        return text.replace(/[&<>"']/g, (match) => htmlEscapes[match] || match);
    }

    /**
     * 格式化时间戳
     */
    protected formatTimestamp(timestamp: Date): string {
        const year = timestamp.getFullYear();
        const month = String(timestamp.getMonth() + 1).padStart(2, '0');
        const day = String(timestamp.getDate()).padStart(2, '0');
        const hours = String(timestamp.getHours()).padStart(2, '0');
        const minutes = String(timestamp.getMinutes()).padStart(2, '0');
        const seconds = String(timestamp.getSeconds()).padStart(2, '0');
        
        switch (this.options.timeFormat) {
            case 'date-only':
                return `${year}-${month}-${day}`;
            case 'time-only':
                return `${hours}:${minutes}:${seconds}`;
            case 'relative':
                return this.getRelativeTime(timestamp);
            default:
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }
    }

    /**
     * 获取相对时间
     */
    private getRelativeTime(timestamp: Date): string {
        const now = new Date();
        const diff = now.getTime() - timestamp.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天前`;
        } else if (hours > 0) {
            return `${hours}小时前`;
        } else if (minutes > 0) {
            return `${minutes}分钟前`;
        } else {
            return '刚刚';
        }
    }

    /**
     * 包装错误
     */
    protected wrapError(error: any, operation: string): SystemError {
        return new SystemError({
            type: ErrorType.API_ERROR,
            message: `${operation} 操作失败: ${error.message || error}`,
            details: error,
            timestamp: new Date(),
            context: { operation, options: this.options }
        });
    }
}