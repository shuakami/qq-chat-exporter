/**
 * 纯文本格式导出器
 * 将聊天记录导出为易于阅读的纯文本格式
 * 支持多种文本布局和格式化选项
 */

import { ExportFormat, ExportResult } from '../../types';
import { BaseExporter, ExportOptions } from './BaseExporter';
import { RawMessage } from '@/core';
import { NapCatCore } from '../../../core';
import { ParsedMessage } from '../parser/MessageParser';

/**
 * 文本格式选项接口
 */
interface TextFormatOptions {
    /** 消息之间的分隔符 */
    messageSeparator: string;
    /** 时间戳格式 */
    timestampFormat: 'full' | 'time-only' | 'date-only' | 'relative';
    /** 是否显示发送者信息 */
    showSender: boolean;
    /** 是否显示消息类型 */
    showMessageType: boolean;
    /** 是否显示资源统计 */
    showResourceStats: boolean;
    /** 行宽限制（0表示不限制） */
    lineWidth: number;
    /** 缩进字符 */
    indentChar: string;
    /** 是否显示消息序号 */
    showMessageNumber: boolean;
}

/**
 * 纯文本导出器类
 * 生成结构清晰、易于阅读的纯文本聊天记录
 */
export class TextExporter extends BaseExporter {
    private readonly textOptions: TextFormatOptions;

    /**
     * 构造函数
     * @param options 基础导出选项
     * @param textOptions 文本格式选项
     */
    constructor(options: ExportOptions, textOptions: Partial<TextFormatOptions> = {}, core?: NapCatCore) {
        super(ExportFormat.TXT, options, core);
        
        this.textOptions = {
            messageSeparator: '\n',
            timestampFormat: 'full',
            showSender: true,
            showMessageType: false,
            showResourceStats: true,
            lineWidth: 0,
            indentChar: '  ',
            showMessageNumber: false,
            ...textOptions
        };
    }

    /**
     * 实现导出方法
     */
    protected async generateContent(
        messages: RawMessage[], 
        chatInfo?: { name?: string; type?: string; avatar?: string; participantCount?: number }
    ): Promise<string> {
        // 需要使用MessageParser先解析消息
        if (!this.core) {
            throw new Error('NapCatCore实例不可用，无法解析消息');
        }
        
        const parser = this.getMessageParser(this.core);
        const parsedMessages = await parser.parseMessages(messages);
        
        const lines: string[] = [];
        
        // 生成文件头部信息
        lines.push(...this.generateHeader(chatInfo, parsedMessages));
        lines.push('');
        
        // 生成消息内容
        for (let i = 0; i < parsedMessages.length; i++) {
            if (this.cancelled) break;
            
            const message = parsedMessages[i];
            if (message) {
                const messageLines = this.formatMessage(message, i + 1);
                lines.push(...messageLines);
                
                // 添加消息分隔符
                if (i < parsedMessages.length - 1) {
                    lines.push(this.textOptions.messageSeparator);
                }
            }
            
            // 更新进度
            if (i % 100 === 0) {
                this.updateProgress(
                    i, 
                    parsedMessages.length, 
                    `格式化消息 ${i + 1}/${parsedMessages.length}`
                );
            }
        }
        
        // 生成文件尾部信息
        lines.push('');
        lines.push(...this.generateFooter(parsedMessages));
        
        return lines.join('\n');
    }

    /**
     * 生成文件头部信息
     */
    private generateHeader(
        chatInfo?: { name?: string; type?: string; avatar?: string; participantCount?: number },
        messages?: ParsedMessage[]
    ): string[] {
        const lines: string[] = [];
        
        // 软件信息
        lines.push('[QQChatExporter V4 / https://github.com/shuakami/qq-chat-exporter]');
        lines.push('[本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~]');
        lines.push('');
        
        // 标题
        lines.push('===============================================');
        lines.push('           QQ聊天记录导出文件');
        lines.push('===============================================');
        lines.push('');
        
        // 聊天信息
        if (chatInfo) {
            lines.push(`聊天名称: ${chatInfo.name || '未知聊天'}`);
            lines.push(`聊天类型: ${this.getChatTypeDisplayName(chatInfo.type || 'unknown')}`);
            
            if (chatInfo.participantCount !== undefined) {
                lines.push(`参与人数: ${chatInfo.participantCount}`);
            }
        }
        
        // 导出信息
        lines.push(`导出时间: ${this.formatTimestamp(new Date())}`);
        if (messages && messages.length > 0) {
            lines.push(`消息总数: ${messages.length}`);
            
            const firstMsg = messages[0];
            const lastMsg = messages[messages.length - 1];
            if (firstMsg && lastMsg) {
                lines.push(`时间范围: ${this.formatTimestamp(firstMsg.timestamp)} - ${this.formatTimestamp(lastMsg.timestamp)}`);
            }
        }
        lines.push('');
        
        return lines;
    }

    /**
     * 生成文件尾部信息
     */
    private generateFooter(messages: ParsedMessage[]): string[] {
        const lines: string[] = [];
        
        lines.push('===============================================');
        lines.push('              导出完成');
        lines.push('===============================================');
        lines.push(`总计导出 ${messages.length} 条消息`);
        lines.push(`导出时间: ${this.formatTimestamp(new Date())}`);
        
        return lines;
    }

    /**
     * 格式化单条消息
     */
    private formatMessage(message: ParsedMessage, messageNumber: number): string[] {
        const lines: string[] = [];
        
        // 消息序号（可选）
        if (this.textOptions.showMessageNumber) {
            lines.push(`[${messageNumber}]`);
        }
        
        // 发送者信息
        if (this.textOptions.showSender) {
            const senderName = message.sender.name || message.sender.uid;
            lines.push(`${senderName}:`);
        }
        
        // 时间戳
        lines.push(`时间: ${this.formatTimestamp(message.timestamp)}`);
        
        // 消息类型（可选）
        if (this.textOptions.showMessageType) {
            lines.push(`类型: ${message.messageType}`);
        }
        
        // 消息内容
        const content = message.content.text.trim();
        if (content) {
            lines.push(`内容: ${content}`);
        }
        
        // 资源信息（可选）
        if (this.textOptions.showResourceStats && message.content.resources.length > 0) {
            lines.push(`资源: ${message.content.resources.length} 个文件`);
            message.content.resources.forEach(resource => {
                lines.push(`  - ${resource.type}: ${resource.fileName}`);
            });
        }
        
        // 特殊元素信息
        if (message.content.mentions.length > 0) {
            const mentions = message.content.mentions.map(m => m.name || m.uid).join(', ');
            lines.push(`提及: ${mentions}`);
        }
        
        if (message.content.reply) {
            lines.push(`回复: ${message.content.reply.senderName} - ${message.content.reply.content}`);
        }
        
        return lines.map(line => this.wrapLine(line));
    }

    /**
     * 换行处理
     */
    private wrapLine(line: string): string {
        if (this.textOptions.lineWidth <= 0 || line.length <= this.textOptions.lineWidth) {
            return line;
        }
        
        // 简单的换行处理
        const chunks: string[] = [];
        for (let i = 0; i < line.length; i += this.textOptions.lineWidth) {
            chunks.push(line.substring(i, i + this.textOptions.lineWidth));
        }
        return chunks.join('\n' + this.textOptions.indentChar);
    }

    /**
     * 获取聊天类型显示名称
     */
    private getChatTypeDisplayName(type: string): string {
        switch (type) {
            case 'group':
                return '群聊';
            case 'private':
                return '私聊';
            case 'temp':
                return '临时会话';
            default:
                return '未知类型';
        }
    }
}