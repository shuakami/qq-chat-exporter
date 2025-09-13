/**
 * JSON格式导出器
 * 将聊天记录导出为结构化的JSON格式
 * 便于程序化处理和数据分析
 */

import { ExportFormat } from '../../types';
import { BaseExporter, ExportOptions } from './BaseExporter';
import { CleanMessage, SimpleMessageParser } from '../parser/SimpleMessageParser';
import { NapCatCore } from '@/core';
import { RawMessage } from '@/core';
import { ParsedMessage } from '../parser/MessageParser';

/**
 * JSON格式选项接口
 */
interface JsonFormatOptions {
    /** 是否美化输出（格式化JSON） */
    pretty: boolean;
    /** 缩进字符数（当pretty为true时生效） */
    indent: number;
    /** 是否包含原始消息数据 */
    includeRawData: boolean;
    /** 是否包含详细的元数据 */
    includeMetadata: boolean;
    /** 是否压缩字段名（减少文件大小） */
    compactFieldNames: boolean;
    /** 数组分块大小（0表示不分块） */
    chunkSize: number;
}

/**
 * JSON输出数据结构接口
 */
interface JsonExportData {
    /** 文件元信息 */
    metadata: {
        /** 软件名称 */
        name: string;
        /** 版权信息 */
        copyright: string;
        /** 软件版本 */
        version: string;
    };
    
    /** 聊天信息 */
    chatInfo: {
        /** 聊天名称 */
        name: string;
        /** 聊天类型 */
        type: string;
        /** 头像URL */
        avatar?: string;
        /** 参与人数 */
        participantCount?: number;
        /** 聊天创建时间 */
        createdAt?: string;
    };
    
    /** 统计信息 */
    statistics: {
        /** 消息总数 */
        totalMessages: number;
        /** 时间范围 */
        timeRange: {
            /** 开始时间 */
            start: string;
            /** 结束时间 */
            end: string;
            /** 时间跨度（天） */
            durationDays: number;
        };
        /** 消息类型统计 */
        messageTypes: Record<string, number>;
        /** 发送者统计 */
        senders: Array<{
            /** 发送者UID */
            uid: string;
            /** 发送者名称 */
            name?: string;
            /** 消息数量 */
            messageCount: number;
            /** 占比 */
            percentage: number;
        }>;
        /** 资源统计 */
        resources: {
            /** 总资源数 */
            total: number;
            /** 按类型分组 */
            byType: Record<string, number>;
            /** 总大小（字节） */
            totalSize: number;
        };
    };
    
    /** 解析后的消息列表 - 使用自定义解析器处理过的格式 */
    messages: CleanMessage[];
    
    /** 导出选项记录 */
    exportOptions?: {
        /** 包含的字段 */
        includedFields: string[];
        /** 筛选条件 */
        filters: any;
        /** 其他选项 */
        options: any;
    };
}

// 不再需要自定义的 JsonMessage 接口，直接使用 RawMessage

/**
 * JSON格式导出器类
 * 生成结构化、易于解析的JSON格式聊天记录
 */
export class JsonExporter extends BaseExporter {
    private readonly jsonOptions: JsonFormatOptions;

    /**
     * 构造函数
     * @param options 基础导出选项
     * @param jsonOptions JSON格式选项
     */
    constructor(options: ExportOptions, jsonOptions: Partial<JsonFormatOptions> = {}, core?: NapCatCore) {
        super(ExportFormat.JSON, options, core);
        
        this.jsonOptions = {
            pretty: true,
            indent: 2,
            includeRawData: false,
            includeMetadata: true,
            compactFieldNames: false,
            chunkSize: 0, // 0表示不分块
            ...jsonOptions
        };
    }

    /**
     * 生成JSON内容 - 使用与TXT导出器相同的双重解析机制
     */
    protected async generateContent(
        messages: any[], 
        chatInfo: { name: string; type: string; avatar?: string; participantCount?: number }
    ): Promise<string> {
        console.log(`[JsonExporter] ==================== 开始JSON导出 ====================`);
        console.log(`[JsonExporter] 输入消息数量: ${messages.length} 条`);
        console.log(`[JsonExporter] 聊天信息: ${chatInfo.name} (${chatInfo.type})`);
        console.log(`[JsonExporter] =====================================================`);
        
        // 检查是否需要解析消息
        let cleanMessages: CleanMessage[];
        
        // 更精确的类型检测：检查是否有RawMessage特有的字段
        if (messages.length > 0 && messages[0] && 
            typeof messages[0].msgId === 'string' && 
            messages[0].elements !== undefined &&
            messages[0].senderUid !== undefined &&
            messages[0].msgTime !== undefined) {
            // 这是RawMessage[]，需要解析
            console.log(`[JsonExporter] 检测到RawMessage[]，使用双重解析机制解析 ${messages.length} 条消息`);
            cleanMessages = await this.parseWithDualStrategy(messages as RawMessage[]);
            console.log(`[JsonExporter] 解析完成，得到 ${cleanMessages.length} 条CleanMessage`);
        } else if (messages.length > 0 && messages[0] && 
                   messages[0].content !== undefined &&
                   messages[0].sender !== undefined) {
            // 这是CleanMessage[]，直接使用
            console.log(`[JsonExporter] 检测到CleanMessage[]，直接使用 ${messages.length} 条消息`);
            cleanMessages = messages as CleanMessage[];
        } else {
            // 兜底：当作RawMessage处理
            console.warn(`[JsonExporter] 无法确定消息类型，当作RawMessage处理`);
            cleanMessages = await this.parseWithDualStrategy(messages as RawMessage[]);
        }
        // 构建JSON数据结构
        const exportData: JsonExportData = {
            metadata: this.generateMetadata(),
            chatInfo: this.formatChatInfo(chatInfo),
            statistics: this.generateStatistics(cleanMessages),
            messages: cleanMessages, // 使用解析后的消息数据
            ...(this.jsonOptions.includeMetadata && {
                exportOptions: this.generateExportOptions()
            })
        };

        // 如果需要分块输出
        if (this.jsonOptions.chunkSize > 0 && cleanMessages.length > this.jsonOptions.chunkSize) {
            return this.generateChunkedOutput(exportData);
        }

        // 序列化为JSON
        return this.serializeJson(exportData);
    }

    /**
     * 使用双重解析策略解析消息（与TXT导出器相同的机制）
     * 首先尝试使用MessageParser，失败时fallback到SimpleMessageParser
     */
    private async parseWithDualStrategy(messages: RawMessage[]): Promise<CleanMessage[]> {
        let parsedMessages: ParsedMessage[] = [];
        
        // 尝试使用MessageParser解析消息
        if (this.core) {
            try {
                console.log(`[JsonExporter] 尝试使用MessageParser解析 ${messages.length} 条消息`);
                const parser = this.getMessageParser(this.core);
                parsedMessages = await parser.parseMessages(messages);
                console.log(`[JsonExporter] MessageParser解析了 ${parsedMessages.length} 条消息`);
                
                // 如果MessageParser解析结果为空，使用fallback
                if (parsedMessages.length === 0 && messages.length > 0) {
                    console.log(`[JsonExporter] MessageParser解析结果为空，使用SimpleMessageParser作为fallback`);
                    return await this.useFallbackParser(messages);
                }
            } catch (error) {
                console.error(`[JsonExporter] MessageParser解析失败，使用SimpleMessageParser作为fallback:`, error);
                return await this.useFallbackParser(messages);
            }
        } else {
            // 没有NapCatCore实例，直接使用SimpleMessageParser
            console.log(`[JsonExporter] 没有NapCatCore实例，使用SimpleMessageParser`);
            return await this.useFallbackParser(messages);
        }
        
        // 将ParsedMessage转换为CleanMessage格式
        return this.convertParsedMessagesToCleanMessages(parsedMessages);
    }

    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    private async useFallbackParser(messages: RawMessage[]): Promise<CleanMessage[]> {
        const simpleParser = new SimpleMessageParser();
        return await simpleParser.parseMessages(messages);
    }

    /**
     * 将ParsedMessage数组转换为CleanMessage数组
     */
    private convertParsedMessagesToCleanMessages(parsedMessages: ParsedMessage[]): CleanMessage[] {
        return parsedMessages.map((parsedMsg: ParsedMessage): CleanMessage => ({
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
                remark: undefined // ParsedMessage中没有remark字段
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
    private convertContentToElements(content: any): any[] {
        const elements: any[] = [];
        
        // 添加文本元素
        if (content.text) {
            elements.push({
                type: 'text',
                data: { text: content.text }
            });
        }
        
        // 添加资源元素
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
        
        // 添加提及元素
        for (const mention of content.mentions) {
            elements.push({
                type: 'at',
                data: {
                    uid: mention.uid,
                    name: mention.name
                }
            });
        }
        
        // 添加表情元素
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
        
        // 添加回复元素
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
    private getMessageTypeFromNTMsgType(msgType: any): string {
        // 这里可以根据需要添加更多类型映射
        return `type_${msgType}`;
    }

    /**
     * 生成元数据
     */
    private generateMetadata(): JsonExportData['metadata'] {
        return {
            name: 'QQChatExporter V4 / https://github.com/shuakami/qq-chat-exporter',
            copyright: '本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~',
            version: '4.0.0'
        };
    }

    /**
     * 格式化聊天信息
     */
    private formatChatInfo(chatInfo: { name: string; type: string; avatar?: string; participantCount?: number }): JsonExportData['chatInfo'] {
        return {
            name: chatInfo.name,
            type: chatInfo.type,
            ...(chatInfo.avatar && { avatar: chatInfo.avatar }),
            ...(chatInfo.participantCount !== undefined && { participantCount: chatInfo.participantCount })
        };
    }

    /**
     * 生成统计信息 - 从原始消息中提取
     */
    private generateStatistics(messages: CleanMessage[]): JsonExportData['statistics'] {
        const parser = new SimpleMessageParser();
        const stats = parser.calculateStatistics(messages);
        
        // 转换为JsonExportData期望的格式
        const senders = Object.entries(stats.bySender)
            .map(([name, data]) => ({
                uid: data.uid,
                name: name,
                messageCount: data.count,
                percentage: Math.round((data.count / stats.total) * 100 * 100) / 100
            }))
            .sort((a, b) => b.messageCount - a.messageCount);

        return {
            totalMessages: stats.total,
            timeRange: {
                start: stats.timeRange.start,
                end: stats.timeRange.end,
                durationDays: stats.timeRange.durationDays
            },
            messageTypes: stats.byType,
            senders,
            resources: {
                total: stats.resources.total,
                byType: stats.resources.byType,
                totalSize: stats.resources.totalSize
            }
        };
    }

    // formatMessages 方法已删除 - 直接使用原始消息数据

    // formatMessage 方法已删除 - 直接使用原始消息数据

    /**
     * 生成导出选项记录
     */
    private generateExportOptions(): JsonExportData['exportOptions'] {
        return {
            includedFields: ['id', 'timestamp', 'sender', 'content', 'resources'],
            filters: {},
            options: {
                includeResourceLinks: this.options.includeResourceLinks,
                includeSystemMessages: this.options.includeSystemMessages,
                timeFormat: this.options.timeFormat,
                encoding: this.options.encoding
            }
        };
    }

    /**
     * 生成分块输出
     */
    private generateChunkedOutput(exportData: JsonExportData): string {
        const chunks: JsonExportData[] = [];
        const messages = exportData.messages;
        const chunkSize = this.jsonOptions.chunkSize;

        // 分割消息
        for (let i = 0; i < messages.length; i += chunkSize) {
            const chunkMessages = messages.slice(i, i + chunkSize);
            
            const chunkData: JsonExportData = {
                ...exportData,
                messages: chunkMessages,
                metadata: {
                    ...exportData.metadata,
                    name: `${exportData.metadata.name} (分块 ${Math.floor(i / chunkSize) + 1})`
                },
                statistics: {
                    ...exportData.statistics,
                    totalMessages: chunkMessages.length
                }
            };
            
            chunks.push(chunkData);
        }

        // 如果只有一个分块，直接返回
        if (chunks.length === 1) {
            return this.serializeJson(chunks[0]);
        }

        // 多分块，返回数组格式
        return this.serializeJson({
            metadata: exportData.metadata,
            chunkInfo: {
                totalChunks: chunks.length,
                totalMessages: messages.length,
                chunkSize
            },
            chunks
        });
    }

    /**
     * 序列化JSON
     */
    private serializeJson(data: any): string {
        if (this.jsonOptions.pretty) {
            return JSON.stringify(data, null, this.jsonOptions.indent);
        } else {
            return JSON.stringify(data);
        }
    }

    /**
     * 写入文件（重写以支持分块写入）
     */
    protected override async writeToFile(content: string): Promise<void> {
        if (this.options.chunkSize && content.length > this.options.chunkSize) {
            // 大文件分块写入
            await this.writeFileInChunks(content);
        } else {
            // 一次性写入
            await super.writeToFile(content);
        }
    }

    /**
     * 分块写入文件
     */
    private async writeFileInChunks(content: string): Promise<void> {
        const fs = await import('fs');
        const stream = fs.createWriteStream(this.options.outputPath, { 
            encoding: this.options.encoding as BufferEncoding 
        });

        return new Promise((resolve, reject) => {
            stream.on('error', reject);
            stream.on('finish', resolve);

            const chunkSize = this.options.chunkSize || 1024 * 1024; // 1MB chunks
            let offset = 0;

            const writeNextChunk = () => {
                if (offset >= content.length) {
                    stream.end();
                    return;
                }

                const chunk = content.slice(offset, offset + chunkSize);
                offset += chunkSize;

                stream.write(chunk, 'utf8', (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        // 异步写入下一块
                        setImmediate(writeNextChunk);
                    }
                });
            };

            writeNextChunk();
        });
    }

    /**
     * 验证JSON格式
     */
    async validateOutput(): Promise<boolean> {
        try {
            const fs = await import('fs');
            const content = await fs.promises.readFile(this.options.outputPath, { encoding: this.options.encoding as BufferEncoding });
            JSON.parse(content);
            return true;
        } catch (error) {
            console.error('JSON格式验证失败:', error);
            return false;
        }
    }

    /**
     * 获取JSON模式定义
     */
    static getJsonSchema(): any {
        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
                metadata: {
                    type: 'object',
                    properties: {
                        exporter: { type: 'string' },
                        version: { type: 'string' },
                        exportTime: { type: 'string', format: 'date-time' },
                        formatVersion: { type: 'string' }
                    },
                    required: ['exporter', 'version', 'exportTime', 'formatVersion']
                },
                chatInfo: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        type: { type: 'string' },
                        avatar: { type: 'string' },
                        participantCount: { type: 'number' }
                    },
                    required: ['name', 'type']
                },
                messages: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            timestamp: { type: 'string', format: 'date-time' },
                            sender: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'string' },
                                    name: { type: 'string' }
                                },
                                required: ['uid']
                            },
                            content: {
                                type: 'object',
                                properties: {
                                    text: { type: 'string' }
                                },
                                required: ['text']
                            }
                        },
                        required: ['id', 'timestamp', 'sender', 'content']
                    }
                }
            },
            required: ['metadata', 'chatInfo', 'messages']
        };
    }
}