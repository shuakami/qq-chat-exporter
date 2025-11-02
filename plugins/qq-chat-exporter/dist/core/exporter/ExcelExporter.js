/**
 * Excel格式导出器
 * 将聊天记录导出为Excel格式 (.xlsx)
 * 便于数据分析和统计
 */
import { ExportFormat } from '../../types/index.js';
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { CleanMessage, SimpleMessageParser } from '../parser/SimpleMessageParser.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { ParsedMessage } from '../parser/MessageParser.js';
import * as XLSX from 'xlsx';
/**
 * Excel格式导出器类
 * 生成包含多个工作表的Excel文件
 */
export class ExcelExporter extends BaseExporter {
    excelOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param excelOptions Excel格式选项
     */
    constructor(options, excelOptions = {}, core) {
        super(ExportFormat.EXCEL, options, core);
        this.excelOptions = {
            sheetName: '聊天记录',
            includeStatistics: true,
            includeSenderStats: true,
            includeResourceStats: true,
            columnWidths: {
                timestamp: 20,
                sender: 15,
                content: 60,
                type: 12
            },
            ...excelOptions
        };
    }
    /**
     * 生成Excel内容
     */
    async generateContent(messages, chatInfo) {
        console.log(`[ExcelExporter] ==================== 开始Excel导出 ====================`);
        console.log(`[ExcelExporter] 输入消息数量: ${messages.length} 条`);
        console.log(`[ExcelExporter] 聊天信息: ${chatInfo.name} (${chatInfo.type})`);
        console.log(`[ExcelExporter] =====================================================`);
        // 检查是否需要解析消息
        let cleanMessages;
        // 更精确的类型检测：检查是否有RawMessage特有的字段
        if (messages.length > 0 && messages[0] &&
            typeof messages[0].msgId === 'string' &&
            messages[0].elements !== undefined &&
            messages[0].senderUid !== undefined &&
            messages[0].msgTime !== undefined) {
            // 这是RawMessage[]，需要解析
            console.log(`[ExcelExporter] 检测到RawMessage[]，使用双重解析机制解析 ${messages.length} 条消息`);
            cleanMessages = await this.parseWithDualStrategy(messages);
            console.log(`[ExcelExporter] 解析完成，得到 ${cleanMessages.length} 条CleanMessage`);
        }
        else if (messages.length > 0 && messages[0] &&
            messages[0].content !== undefined &&
            messages[0].sender !== undefined) {
            // 这是CleanMessage[]，直接使用
            console.log(`[ExcelExporter] 检测到CleanMessage[]，直接使用 ${messages.length} 条消息`);
            cleanMessages = messages;
        }
        else {
            // 兜底：当作RawMessage处理
            console.warn(`[ExcelExporter] 无法确定消息类型，当作RawMessage处理`);
            cleanMessages = await this.parseWithDualStrategy(messages);
        }
        // 创建工作簿
        const workbook = XLSX.utils.book_new();
        // 添加聊天记录工作表
        this.addMessagesSheet(workbook, cleanMessages, chatInfo);
        // 添加统计信息工作表
        if (this.excelOptions.includeStatistics) {
            this.addStatisticsSheet(workbook, cleanMessages);
        }
        // 添加发送者统计工作表
        if (this.excelOptions.includeSenderStats) {
            this.addSenderStatsSheet(workbook, cleanMessages);
        }
        // 添加资源统计工作表
        if (this.excelOptions.includeResourceStats) {
            this.addResourceStatsSheet(workbook, cleanMessages);
        }
        // 由于writeToFile需要字符串，我们这里返回一个占位符
        // 实际的文件写入将在writeToFile中完成
        return JSON.stringify({ workbook, chatInfo });
    }
    /**
     * 添加聊天记录工作表
     */
    addMessagesSheet(workbook, messages, chatInfo) {
        // 准备表头
        const headers = ['序号', '时间', '发送者', '消息类型', '消息内容', '是否撤回', '资源数量'];
        // 准备数据行
        const rows = messages.map((msg, index) => {
            const resourceCount = msg.content.resources?.length || 0;
            const contentText = this.extractTextContent(msg);
            return [
                index + 1,
                msg.time,
                msg.sender.name || msg.sender.uid,
                this.getMessageTypeLabel(msg.type),
                contentText,
                msg.recalled ? '是' : '否',
                resourceCount
            ];
        });
        // 合并表头和数据
        const data = [headers, ...rows];
        // 创建工作表
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        // 设置列宽
        worksheet['!cols'] = [
            { wch: 8 }, // 序号
            { wch: this.excelOptions.columnWidths.timestamp || 20 }, // 时间
            { wch: this.excelOptions.columnWidths.sender || 15 }, // 发送者
            { wch: this.excelOptions.columnWidths.type || 12 }, // 消息类型
            { wch: this.excelOptions.columnWidths.content || 60 }, // 消息内容
            { wch: 10 }, // 是否撤回
            { wch: 12 } // 资源数量
        ];
        // 添加到工作簿
        XLSX.utils.book_append_sheet(workbook, worksheet, this.excelOptions.sheetName);
    }
    /**
     * 添加统计信息工作表
     */
    addStatisticsSheet(workbook, messages) {
        const parser = new SimpleMessageParser();
        const stats = parser.calculateStatistics(messages);
        const data = [
            ['统计项目', '数值'],
            ['消息总数', stats.total],
            ['开始时间', stats.timeRange.start],
            ['结束时间', stats.timeRange.end],
            ['时间跨度(天)', stats.timeRange.durationDays],
            [''],
            ['消息类型', '数量'],
            ...Object.entries(stats.byType).map(([type, count]) => [this.getMessageTypeLabel(type), count]),
            [''],
            ['资源统计', ''],
            ['总资源数', stats.resources.total],
            ['总大小(字节)', stats.resources.totalSize],
            [''],
            ['资源类型', '数量'],
            ...Object.entries(stats.resources.byType).map(([type, count]) => [type, count])
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        worksheet['!cols'] = [{ wch: 20 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, '统计信息');
    }
    /**
     * 添加发送者统计工作表
     */
    addSenderStatsSheet(workbook, messages) {
        const parser = new SimpleMessageParser();
        const stats = parser.calculateStatistics(messages);
        const headers = ['排名', '发送者', 'UID', '消息数量', '占比(%)'];
        const senders = Object.entries(stats.bySender)
            .map(([name, data]) => ({
            name,
            uid: data.uid,
            count: data.count,
            percentage: Math.round((data.count / stats.total) * 100 * 100) / 100
        }))
            .sort((a, b) => b.count - a.count);
        const rows = senders.map((sender, index) => [
            index + 1,
            sender.name,
            sender.uid,
            sender.count,
            sender.percentage
        ]);
        const data = [headers, ...rows];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        worksheet['!cols'] = [
            { wch: 8 }, // 排名
            { wch: 20 }, // 发送者
            { wch: 15 }, // UID
            { wch: 12 }, // 消息数量
            { wch: 12 } // 占比
        ];
        XLSX.utils.book_append_sheet(workbook, worksheet, '发送者统计');
    }
    /**
     * 添加资源统计工作表
     */
    addResourceStatsSheet(workbook, messages) {
        const headers = ['序号', '时间', '发送者', '资源类型', '文件名', '大小(字节)', 'URL'];
        const resourceRows = [];
        messages.forEach((msg, msgIndex) => {
            if (msg.content.resources && msg.content.resources.length > 0) {
                msg.content.resources.forEach((resource) => {
                    resourceRows.push([
                        resourceRows.length + 1,
                        msg.time,
                        msg.sender.name || msg.sender.uid,
                        resource.type,
                        resource.filename || '',
                        resource.size || 0,
                        resource.url || resource.localPath || ''
                    ]);
                });
            }
        });
        const data = [headers, ...resourceRows];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        worksheet['!cols'] = [
            { wch: 8 }, // 序号
            { wch: 20 }, // 时间
            { wch: 15 }, // 发送者
            { wch: 12 }, // 资源类型
            { wch: 30 }, // 文件名
            { wch: 15 }, // 大小
            { wch: 50 } // URL
        ];
        XLSX.utils.book_append_sheet(workbook, worksheet, '资源列表');
    }
    /**
     * 提取消息的文本内容
     */
    extractTextContent(msg) {
        let text = msg.content.text || '';
        // 如果没有文本内容，尝试从elements中提取
        if (!text && msg.content.elements) {
            const textElements = msg.content.elements
                .filter((e) => e.type === 'text')
                .map((e) => e.data?.text || '')
                .join(' ');
            if (textElements) {
                text = textElements;
            }
            else {
                // 如果仍然没有文本，显示元素类型摘要
                const elementTypes = msg.content.elements
                    .map((e) => e.type)
                    .join(', ');
                text = elementTypes ? `[${elementTypes}]` : '[无文本内容]';
            }
        }
        // 添加资源信息
        if (msg.content.resources && msg.content.resources.length > 0) {
            const resourceInfo = msg.content.resources
                .map(r => `[${r.type}: ${r.filename || ''}]`)
                .join(' ');
            text += (text ? ' ' : '') + resourceInfo;
        }
        return text || '[空消息]';
    }
    /**
     * 获取消息类型标签
     */
    getMessageTypeLabel(type) {
        const typeMap = {
            'text': '文本',
            'image': '图片',
            'video': '视频',
            'audio': '音频',
            'file': '文件',
            'face': '表情',
            'at': '@提及',
            'reply': '回复',
            'system': '系统消息',
            'unknown': '未知'
        };
        return typeMap[type] || type;
    }
    /**
     * 使用双重解析策略解析消息
     */
    async parseWithDualStrategy(messages) {
        let parsedMessages = [];
        if (this.core) {
            try {
                console.log(`[ExcelExporter] 尝试使用MessageParser解析 ${messages.length} 条消息`);
                const parser = this.getMessageParser(this.core);
                parsedMessages = await parser.parseMessages(messages);
                console.log(`[ExcelExporter] MessageParser解析了 ${parsedMessages.length} 条消息`);
                if (parsedMessages.length === 0 && messages.length > 0) {
                    console.log(`[ExcelExporter] MessageParser解析结果为空，使用SimpleMessageParser作为fallback`);
                    return await this.useFallbackParser(messages);
                }
            }
            catch (error) {
                console.error(`[ExcelExporter] MessageParser解析失败，使用SimpleMessageParser作为fallback:`, error);
                return await this.useFallbackParser(messages);
            }
        }
        else {
            console.log(`[ExcelExporter] 没有NapCatCore实例，使用SimpleMessageParser`);
            return await this.useFallbackParser(messages);
        }
        return this.convertParsedMessagesToCleanMessages(parsedMessages);
    }
    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    async useFallbackParser(messages) {
        const simpleParser = new SimpleMessageParser();
        return await simpleParser.parseMessages(messages);
    }
    /**
     * 将ParsedMessage数组转换为CleanMessage数组
     */
    convertParsedMessagesToCleanMessages(parsedMessages) {
        return parsedMessages.map((parsedMsg) => ({
            id: parsedMsg.messageId,
            seq: parsedMsg.messageSeq,
            timestamp: parsedMsg.timestamp.getTime(),
            time: parsedMsg.timestamp.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\//g, '-'),
            sender: {
                uid: parsedMsg.sender.uid,
                uin: parsedMsg.sender.uin,
                name: parsedMsg.sender.name || parsedMsg.sender.uid,
                remark: undefined
            },
            type: this.getMessageTypeFromNTMsgType(parsedMsg.messageType),
            content: {
                text: parsedMsg.content.text,
                html: parsedMsg.content.html,
                elements: this.convertContentToElements(parsedMsg.content),
                resources: parsedMsg.content.resources.map(r => ({
                    type: r.type,
                    filename: r.fileName,
                    size: r.fileSize,
                    url: r.originalUrl,
                    localPath: r.localPath,
                    width: undefined,
                    height: undefined,
                    duration: undefined
                }))
            },
            recalled: parsedMsg.isRecalled,
            system: parsedMsg.isSystemMessage
        }));
    }
    /**
     * 将ParsedMessageContent转换为MessageElementData数组
     */
    convertContentToElements(content) {
        const elements = [];
        if (content.text) {
            elements.push({
                type: 'text',
                data: { text: content.text }
            });
        }
        for (const resource of content.resources) {
            elements.push({
                type: resource.type,
                data: {
                    filename: resource.fileName,
                    size: resource.fileSize,
                    url: resource.originalUrl
                }
            });
        }
        for (const mention of content.mentions) {
            elements.push({
                type: 'at',
                data: {
                    uid: mention.uid,
                    name: mention.name
                }
            });
        }
        for (const emoji of content.emojis) {
            elements.push({
                type: emoji.type === 'market' ? 'market_face' : 'face',
                data: {
                    id: emoji.id,
                    name: emoji.name,
                    url: emoji.url
                }
            });
        }
        if (content.reply) {
            elements.push({
                type: 'reply',
                data: {
                    messageId: content.reply.messageId,
                    senderName: content.reply.senderName,
                    content: content.reply.content
                }
            });
        }
        return elements;
    }
    /**
     * 将NTMsgType转换为字符串类型
     */
    getMessageTypeFromNTMsgType(msgType) {
        return `type_${msgType}`;
    }
    /**
     * 写入文件（重写以支持Excel二进制写入）
     */
    async writeToFile(content) {
        try {
            const data = JSON.parse(content);
            const { workbook } = data;
            // 写入Excel文件
            XLSX.writeFile(workbook, this.options.outputPath);
            console.log(`[ExcelExporter] Excel文件已写入: ${this.options.outputPath}`);
        }
        catch (error) {
            console.error('[ExcelExporter] 写入Excel文件失败:', error);
            throw error;
        }
    }
}
//# sourceMappingURL=ExcelExporter.js.map