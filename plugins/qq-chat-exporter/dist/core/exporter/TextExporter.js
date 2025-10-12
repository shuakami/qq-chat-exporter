/**
 * 纯文本格式导出器
 * 将聊天记录导出为易于阅读的纯文本格式
 * 支持多种文本布局和格式化选项
 */
import { ExportFormat } from '../../types.js';
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { ParsedMessage } from '../parser/MessageParser.js';
import { SimpleMessageParser, CleanMessage } from '../parser/SimpleMessageParser.js';
/**
 * 纯文本导出器类
 * 生成结构清晰、易于阅读的纯文本聊天记录
 */
export class TextExporter extends BaseExporter {
    textOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param textOptions 文本格式选项
     */
    constructor(options, textOptions = {}, core) {
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
    async generateContent(messages, chatInfo) {
        let parsedMessages = [];
        // 尝试使用MessageParser解析消息
        if (this.core) {
            try {
                const parser = this.getMessageParser(this.core);
                parsedMessages = await parser.parseMessages(messages);
                console.log(`[TextExporter] MessageParser解析了 ${parsedMessages.length} 条消息`);
                // 如果MessageParser解析结果为空，使用fallback
                if (parsedMessages.length === 0 && messages.length > 0) {
                    console.log(`[TextExporter] MessageParser解析结果为空，使用SimpleMessageParser作为fallback`);
                    parsedMessages = await this.useFallbackParser(messages);
                }
            }
            catch (error) {
                console.error(`[TextExporter] MessageParser解析失败，使用SimpleMessageParser作为fallback:`, error);
                parsedMessages = await this.useFallbackParser(messages);
            }
        }
        else {
            // 没有NapCatCore实例，直接使用SimpleMessageParser
            console.log(`[TextExporter] 没有NapCatCore实例，使用SimpleMessageParser`);
            parsedMessages = await this.useFallbackParser(messages);
        }
        const lines = [];
        // 生成文件头部信息
        lines.push(...this.generateHeader(chatInfo, parsedMessages));
        lines.push('');
        // 生成消息内容
        for (let i = 0; i < parsedMessages.length; i++) {
            if (this.cancelled)
                break;
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
                this.updateProgress(i, parsedMessages.length, `格式化消息 ${i + 1}/${parsedMessages.length}`);
            }
        }
        // 生成文件尾部信息
        lines.push('');
        lines.push(...this.generateFooter(parsedMessages));
        return lines.join('\n');
    }
    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    async useFallbackParser(messages) {
        const simpleParser = new SimpleMessageParser();
        const cleanMessages = await simpleParser.parseMessages(messages);
        // 将CleanMessage转换为ParsedMessage格式
        return cleanMessages.map((cleanMsg) => ({
            messageId: cleanMsg.id,
            messageSeq: cleanMsg.seq,
            timestamp: new Date(cleanMsg.timestamp),
            sender: {
                uid: cleanMsg.sender.uid,
                uin: cleanMsg.sender.uin,
                name: cleanMsg.sender.name || cleanMsg.sender.uid
            },
            receiver: {
                uid: 'unknown',
                type: 'unknown'
            },
            messageType: cleanMsg.type,
            isSystemMessage: cleanMsg.system,
            isRecalled: cleanMsg.recalled,
            isTempMessage: false,
            content: {
                text: cleanMsg.content.text,
                html: cleanMsg.content.html,
                raw: JSON.stringify(cleanMsg.content.elements),
                mentions: [],
                resources: cleanMsg.content.resources.map(r => ({
                    type: r.type,
                    fileName: r.filename,
                    fileSize: r.size,
                    originalUrl: r.url || '',
                    localPath: r.localPath,
                    md5: '',
                    mimeType: 'application/octet-stream',
                    status: 'downloaded',
                    accessible: true,
                    checkedAt: new Date()
                })),
                emojis: [],
                special: []
            },
            stats: {
                elementCount: cleanMsg.content.elements.length,
                resourceCount: cleanMsg.content.resources.length,
                textLength: cleanMsg.content.text.length,
                processingTime: 0
            },
            rawMessage: {} // 没有原始消息数据
        }));
    }
    /**
     * 生成文件头部信息
     */
    generateHeader(chatInfo, messages) {
        const lines = [];
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
            // 计算实际的时间范围（防止消息排序问题）
            const timeRange = this.calculateTimeRange(messages);
            if (timeRange) {
                lines.push(`时间范围: ${timeRange}`);
            }
        }
        lines.push('');
        return lines;
    }
    /**
     * 生成文件尾部信息
     */
    generateFooter(messages) {
        const lines = [];
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
    formatMessage(message, messageNumber) {
        const lines = [];
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
        else if (message.content.resources.length > 0) {
            // 如果没有文本但有资源，显示资源类型
            const resourceTypes = message.content.resources.map(r => r.type).join('、');
            lines.push(`内容: [${resourceTypes}消息]`);
        }
        else if (message.isSystemMessage) {
            // 系统消息
            lines.push(`内容: [系统消息]`);
        }
        else if (message.content.emojis.length > 0) {
            // 表情消息
            lines.push(`内容: [表情消息]`);
        }
        else {
            // 其他无内容消息
            lines.push(`内容: [无文本内容]`);
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
    wrapLine(line) {
        if (this.textOptions.lineWidth <= 0 || line.length <= this.textOptions.lineWidth) {
            return line;
        }
        // 简单的换行处理
        const chunks = [];
        for (let i = 0; i < line.length; i += this.textOptions.lineWidth) {
            chunks.push(line.substring(i, i + this.textOptions.lineWidth));
        }
        return chunks.join('\n' + this.textOptions.indentChar);
    }
    /**
     * 计算消息的实际时间范围
     * 遍历所有消息，找到真正的最早和最晚时间
     */
    calculateTimeRange(messages) {
        if (!messages || messages.length === 0) {
            return null;
        }
        let earliestTime = null;
        let latestTime = null;
        // 遍历所有消息，找到真正的时间范围
        for (const message of messages) {
            if (!message || !message.timestamp)
                continue;
            const messageTime = message.timestamp;
            if (!earliestTime || messageTime < earliestTime) {
                earliestTime = messageTime;
            }
            if (!latestTime || messageTime > latestTime) {
                latestTime = messageTime;
            }
        }
        if (!earliestTime || !latestTime) {
            return null;
        }
        // 格式化时间范围
        const startTime = this.formatTimestamp(earliestTime);
        const endTime = this.formatTimestamp(latestTime);
        console.log(`[TextExporter] 计算时间范围: ${startTime} 到 ${endTime}`);
        return `${startTime} - ${endTime}`;
    }
    /**
     * 获取聊天类型显示名称
     */
    getChatTypeDisplayName(type) {
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
//# sourceMappingURL=TextExporter.js.map