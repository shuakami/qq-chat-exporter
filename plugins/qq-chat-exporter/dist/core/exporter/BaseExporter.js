/**
 * 基础导出器
 * 定义导出器的通用接口和基础功能
 * 所有具体格式的导出器都应继承此基类
 */
import fs from 'fs';
import path from 'path';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { ExportFormat, ExportResult, SystemError, ErrorType } from '../../types/index.js';
import { MessageParser, MessageParserConfig } from '../parser/MessageParser.js';
import { SimpleMessageParser } from '../parser/SimpleMessageParser.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 基础导出器抽象类
 * 提供导出功能的通用框架和工具方法
 */
export class BaseExporter {
    format;
    options;
    core; // 添加NapCatCore实例
    cancelled;
    progressCallback;
    /**
     * 构造函数
     * @param format 导出格式
     * @param options 导出选项
     * @param core NapCatCore实例（可选）
     */
    constructor(format, options, core) {
        this.format = format;
        this.core = core;
        this.options = {
            outputPath: options.outputPath,
            includeResourceLinks: options.includeResourceLinks ?? true,
            includeSystemMessages: options.includeSystemMessages ?? true,
            filterPureImageMessages: options.filterPureImageMessages ?? false,
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
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }
    /**
     * 取消导出
     */
    cancel() {
        this.cancelled = true;
    }
    /**
     * 导出公共方法
     * @param messages 原始消息数组
     * @param chatInfo 聊天信息
     * @returns 导出结果
     */
    async export(messages, chatInfo) {
        const startTime = Date.now();
        try {
            this.updateProgress(0, messages.length, `开始${this.format}导出`);
            this.ensureOutputDirectory();
            // 过滤掉空消息
            const validMessages = messages.filter(m => m);
            // 按时间戳排序消息，确保时间顺序正确
            const sortedMessages = this.sortMessagesByTimestamp(validMessages);
            console.log(`[${this.format}Exporter] 消息排序完成: ${validMessages.length} → ${sortedMessages.length} 条`);
            // 应用纯图片消息过滤
            const filteredMessages = await this.applyPureImageFilter(sortedMessages);
            console.log(`[${this.format}Exporter] 消息过滤完成: ${sortedMessages.length} → ${filteredMessages.length} 条`);
            const content = await this.generateContent(filteredMessages, chatInfo);
            if (this.cancelled) {
                throw new Error('导出已取消');
            }
            await this.writeToFile(content);
            this.updateProgress(filteredMessages.length, filteredMessages.length, '导出完成');
            const resourceCount = filteredMessages.reduce((acc, msg) => {
                const elements = msg.elements || [];
                return acc + elements.filter(e => e.picElement || e.fileElement).length;
            }, 0);
            return {
                taskId: '',
                format: this.format,
                filePath: this.options.outputPath,
                fileSize: this.getFileSize(),
                messageCount: filteredMessages.length,
                resourceCount: resourceCount,
                exportTime: Date.now() - startTime,
                completedAt: new Date()
            };
        }
        catch (error) {
            throw this.wrapError(error, `${this.format}Export`);
        }
    }
    /**
     * 检查输出目录是否存在，不存在则创建
     */
    ensureOutputDirectory() {
        const dir = path.dirname(this.options.outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    /**
     * 获取消息解析器实例
     */
    getMessageParser(core) {
        const config = {
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
    async writeToFile(content) {
        try {
            this.ensureOutputDirectory();
            await fs.promises.writeFile(this.options.outputPath, content, { encoding: this.options.encoding });
        }
        catch (error) {
            throw this.wrapError(error, 'writeToFile');
        }
    }
    /**
     * 获取文件大小
     */
    getFileSize() {
        try {
            const stats = fs.statSync(this.options.outputPath);
            return stats.size;
        }
        catch (error) {
            return 0;
        }
    }
    /**
     * 更新进度
     */
    updateProgress(current, total, message) {
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
    escapeHtml(text) {
        const htmlEscapes = {
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
    formatTimestamp(timestamp) {
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
    getRelativeTime(timestamp) {
        const now = new Date();
        const diff = now.getTime() - timestamp.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) {
            return `${days}天前`;
        }
        else if (hours > 0) {
            return `${hours}小时前`;
        }
        else if (minutes > 0) {
            return `${minutes}分钟前`;
        }
        else {
            return '刚刚';
        }
    }
    /**
     * 包装错误
     */
    wrapError(error, operation) {
        return new SystemError({
            type: ErrorType.API_ERROR,
            message: `${operation} 操作失败: ${error.message || error}`,
            details: error,
            timestamp: new Date(),
            context: { operation, options: this.options }
        });
    }
    /**
     * 应用纯图片消息过滤
     * 如果启用了过滤选项，会过滤掉只包含图片、表情等非文字元素的消息
     */
    async applyPureImageFilter(messages) {
        if (!this.options.filterPureImageMessages) {
            return messages;
        }
        const simpleParser = new SimpleMessageParser();
        const filteredMessages = [];
        for (const message of messages) {
            try {
                const cleanMessage = await simpleParser.parseSingleMessage(message);
                if (!simpleParser.isPureImageMessage(cleanMessage)) {
                    filteredMessages.push(message);
                }
            }
            catch (error) {
                // 解析失败的消息保留，避免丢失数据
                console.warn(`[BaseExporter] 过滤消息解析失败，保留消息: ${message.msgId}`, error);
                filteredMessages.push(message);
            }
        }
        return filteredMessages;
    }
    /**
     * 按时间戳排序消息
     * 确保消息按发送时间从早到晚的顺序排列
     *
     * @param messages 原始消息数组
     * @returns 按时间排序后的消息数组
     */
    sortMessagesByTimestamp(messages) {
        const sortedMessages = [...messages].sort((a, b) => {
            // 解析时间戳
            let timeA = parseInt(a.msgTime || '0');
            let timeB = parseInt(b.msgTime || '0');
            // 处理无效时间戳
            if (isNaN(timeA) || timeA <= 0) {
                console.warn(`[BaseExporter] 消息 ${a.msgId} 的时间戳无效: ${a.msgTime}`);
                timeA = 0; // 无效时间戳放到最前面
            }
            if (isNaN(timeB) || timeB <= 0) {
                console.warn(`[BaseExporter] 消息 ${b.msgId} 的时间戳无效: ${b.msgTime}`);
                timeB = 0;
            }
            // 检查是否为秒级时间戳并转换为毫秒级进行比较
            // 但保持原始数据不变
            let compareTimeA = timeA;
            let compareTimeB = timeB;
            // 如果是秒级时间戳（10位数），转换为毫秒级用于比较
            if (timeA > 1000000000 && timeA < 10000000000) {
                compareTimeA = timeA * 1000;
            }
            if (timeB > 1000000000 && timeB < 10000000000) {
                compareTimeB = timeB * 1000;
            }
            // 按时间从早到晚排序
            return compareTimeA - compareTimeB;
        });
        // 输出排序统计信息
        if (sortedMessages.length > 0) {
            const firstTime = sortedMessages[0]?.msgTime;
            const lastTime = sortedMessages[sortedMessages.length - 1]?.msgTime;
            console.log(`[BaseExporter] 消息排序: 时间范围从 ${firstTime} 到 ${lastTime}`);
        }
        return sortedMessages;
    }
}
//# sourceMappingURL=BaseExporter.js.map