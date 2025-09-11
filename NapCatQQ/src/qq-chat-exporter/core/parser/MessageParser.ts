/**
 * 消息解析器 - 复用NapCat OneBot解析器
 * 负责解析所有类型的QQ消息元素，转换为统一的结构化数据
 * 基于NapCat OneBot实现，确保解析结果的准确性和一致性
 */

import { RawMessage, MessageElement, ElementType, NTMsgType } from '@/core';
import { SystemError, ErrorType, ResourceInfo, ResourceStatus } from '../../types';
import { NapCatCore } from '../../../core';
import { OneBotMsgApi } from '../../../onebot/api/msg';

/**
 * 解析后的消息内容接口
 */
export interface ParsedMessageContent {
    /** 纯文本内容（去除格式） */
    text: string;
    /** 富文本内容（HTML格式） */
    html: string;
    /** 原始内容（保留所有信息） */
    raw: string;
    /** 提及的用户 */
    mentions: Array<{
        uid: string;
        name?: string;
        type: 'user' | 'all';
    }>;
    /** 引用的消息 */
    reply?: {
        messageId: string;
        senderName?: string;
        content: string;
        elements?: any[];
    };
    /** 资源文件列表 */
    resources: ResourceInfo[];
    /** 表情信息 */
    emojis: Array<{
        id: string;
        name?: string;
        url?: string;
        type: 'face' | 'market' | 'custom';
    }>;
    /** 位置信息 */
    location?: {
        latitude: number;
        longitude: number;
        title?: string;
        address?: string;
    };
    /** 卡片消息信息 */
    card?: {
        title?: string;
        content?: string;
        url?: string;
        preview?: string;
        type: string;
    };
    /** 合并转发信息 */
    multiForward?: {
        title: string;
        summary: string;
        messageCount: number;
        senderNames: string[];
    };
    /** 日历事件 */
    calendar?: {
        title: string;
        startTime: Date;
        endTime?: Date;
        description?: string;
    };
    /** 其他特殊元素 */
    special: Array<{
        type: string;
        data: any;
        description: string;
    }>;
}

/**
 * 解析后的完整消息接口
 */
export interface ParsedMessage {
    /** 消息ID */
    messageId: string;
    /** 消息序列号 */
    messageSeq: string;
    /** 消息随机ID */
    msgRandom?: string;
    /** 发送时间 */
    timestamp: Date;
    /** 发送者信息 */
    sender: {
        uid: string;
        uin?: string;
        name?: string;
        avatar?: string;
        role?: 'owner' | 'admin' | 'member';
    };
    /** 接收者信息 */
    receiver?: {
        uid: string;
        name?: string;
        type: 'group' | 'private';
    };
    /** 消息类型 */
    messageType: NTMsgType;
    /** 是否为系统消息 */
    isSystemMessage: boolean;
    /** 是否为撤回消息 */
    isRecalled: boolean;
    /** 是否为临时消息 */
    isTempMessage: boolean;
    /** 解析后的内容 */
    content: ParsedMessageContent;
    /** 消息统计信息 */
    stats: {
        elementCount: number;
        resourceCount: number;
        textLength: number;
        processingTime: number;
    };
    /** 原始消息数据 */
    rawMessage: RawMessage;
}

/**
 * 消息解析器配置接口
 */
export interface MessageParserConfig {
    /** 是否包含资源链接 */
    includeResourceLinks: boolean;
    /** 是否包含系统消息 */
    includeSystemMessages: boolean;
    /** 是否解析超级表情 */
    parseMarketFace: boolean;
    /** 是否解析卡片消息 */
    parseCardMessages: boolean;
    /** 是否解析合并转发 */
    parseMultiForward: boolean;
    /** 是否获取用户信息 */
    fetchUserInfo: boolean;
    /** 时间格式 */
    timeFormat: string;
    /** 文本最大长度限制 */
    maxTextLength: number;
    /** 是否启用调试模式 */
    debugMode: boolean;
}

/**
 * 默认解析器配置
 */
const DEFAULT_PARSER_CONFIG: MessageParserConfig = {
    includeResourceLinks: true,
    includeSystemMessages: true,
    parseMarketFace: true,
    parseCardMessages: true,
    parseMultiForward: true,
    fetchUserInfo: false,
    timeFormat: 'YYYY-MM-DD HH:mm:ss',
    maxTextLength: 50000,
    debugMode: false
};

/**
 * 消息解析器类
 * 提供全面的QQ消息解析功能
 */
export class MessageParser {
    private readonly core: NapCatCore;
    private readonly config: MessageParserConfig;
    private readonly oneBotMsgApi: OneBotMsgApi;
    
    /** 用户信息缓存 */
    private userInfoCache: Map<string, any> = new Map();
    
    /** 表情映射缓存 */
    private faceMap: Map<string, string> = new Map();

    /**
     * 构造函数
     * @param core NapCat核心实例
     * @param config 解析器配置
     */
    constructor(core: NapCatCore, config: Partial<MessageParserConfig> = {}) {
        this.core = core;
        this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
        
        // 创建OneBot消息API实例，用于复用解析逻辑
        // 这里我们只需要转换器，不需要完整的OneBot上下文
        this.oneBotMsgApi = new OneBotMsgApi(null as any, core);
        
        // 初始化表情映射
        this.initializeFaceMap();
    }

    /**
     * 解析消息列表 - 使用OneBot解析器
     * 
     * @param messages 原始消息列表
     * @returns 解析后的消息列表
     */
    async parseMessages(messages: RawMessage[]): Promise<ParsedMessage[]> {
        const results: ParsedMessage[] = [];
        const startTime = Date.now();

        this.log(`开始使用OneBot解析器解析 ${messages.length} 条消息...`);

        for (let i = 0; i < messages.length; i++) {
            try {
                const message = messages[i];
                
                // 跳过空消息
                if (!message || !message.msgId) {
                    continue;
                }
                
                // 跳过系统消息（如果配置不包含）
                if (!this.config.includeSystemMessages && this.isSystemMessage(message)) {
                    continue;
                }

                // 使用OneBot解析器解析消息
                const ob11Result = await this.oneBotMsgApi.parseMessageV2(
                    message, 
                    this.config.parseMultiForward, 
                    !this.config.includeResourceLinks,
                    false // quick_reply
                );

                if (ob11Result && ob11Result.arrayMsg) {
                    // 转换OneBot消息为我们的格式
                    const parsed = this.convertOB11MessageToParsedMessage(ob11Result.arrayMsg, message);
                    results.push(parsed);
                } else {
                    // OneBot解析失败，创建基础消息记录
                    this.log(`OneBot解析失败，使用fallback处理消息 ${message.msgId}`, 'warn');
                    const fallbackMessage = this.createFallbackMessage(message);
                    results.push(fallbackMessage);
                }

                // 每100条消息输出一次进度
                if ((i + 1) % 100 === 0) {
                    this.log(`已解析 ${i + 1}/${messages.length} 条消息`);
                }

            } catch (error) {
                this.log(`解析消息失败 (${messages[i]?.msgId || 'unknown'}): ${error}`, 'error');
                
                // 创建一个错误消息记录
                if (messages[i]) {
                    const errorMessage = this.createErrorMessage(messages[i]!, error);
                    results.push(errorMessage);
                }
            }
        }

        const duration = Date.now() - startTime;
        this.log(`OneBot消息解析完成，共 ${results.length} 条，耗时 ${duration}ms`);

        return results;
    }

    /**
     * 将OneBot消息转换为ParsedMessage格式
     */
    private convertOB11MessageToParsedMessage(ob11Msg: any, rawMsg: RawMessage): ParsedMessage {
        const content: ParsedMessageContent = {
            text: ob11Msg.raw_message || '',
            html: '',
            raw: JSON.stringify(ob11Msg.message),
            mentions: [],
            resources: [],
            emojis: [],
            special: []
        };

        // 解析消息元素
        if (Array.isArray(ob11Msg.message)) {
            for (const segment of ob11Msg.message) {
                this.processOB11Segment(segment, content);
            }
        }

        // 生成HTML内容
        content.html = this.generateHtmlFromOB11(ob11Msg.message);

        return {
            messageId: rawMsg.msgId,
            messageSeq: rawMsg.msgSeq,
            msgRandom: rawMsg.msgRandom,
            timestamp: new Date(parseInt(rawMsg.msgTime) * 1000),
            sender: {
                uid: rawMsg.senderUid,
                uin: rawMsg.senderUin,
                name: rawMsg.sendNickName || rawMsg.sendRemarkName,
                avatar: undefined,
                role: undefined // roleType 在RawMessage中不存在，暂时设为undefined
            },
            receiver: {
                uid: rawMsg.peerUid,
                type: rawMsg.chatType === 2 ? 'group' : 'private'
            },
            messageType: rawMsg.msgType,
            isSystemMessage: this.isSystemMessage(rawMsg),
            isRecalled: false,
            isTempMessage: false,
            stats: {
                elementCount: rawMsg.elements?.length || 0,
                resourceCount: content.resources.length,
                textLength: content.text.length,
                processingTime: 0
            },
            content,
            rawMessage: rawMsg
        };
    }

    /**
     * 处理OneBot消息段
     */
    private processOB11Segment(segment: any, content: ParsedMessageContent): void {
        switch (segment.type) {
            case 'text':
                // 文本内容已在raw_message中处理
                break;
                
            case 'at':
                content.mentions.push({
                    uid: segment.data.qq === 'all' ? 'all' : segment.data.qq,
                    name: segment.data.name,
                    type: segment.data.qq === 'all' ? 'all' : 'user'
                });
                break;
                
            case 'image':
                content.resources.push({
                    type: 'image',
                    fileName: segment.data.file || 'unknown.jpg',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'image/jpeg',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt: new Date()
                });
                break;
                
            case 'file':
                content.resources.push({
                    type: 'file',
                    fileName: segment.data.file || 'unknown',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'application/octet-stream',
                    md5: segment.data.file_id,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt: new Date()
                });
                break;
                
            case 'video':
                content.resources.push({
                    type: 'video',
                    fileName: segment.data.file || 'unknown.mp4',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'video/mp4',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt: new Date()
                });
                break;
                
            case 'voice':
                content.resources.push({
                    type: 'audio',
                    fileName: segment.data.file || 'unknown.amr',
                    originalUrl: segment.data.url,
                    fileSize: segment.data.file_size || 0,
                    mimeType: 'audio/amr',
                    md5: segment.data.file,
                    localPath: segment.data.path,
                    status: ResourceStatus.DOWNLOADED,
                    accessible: true,
                    checkedAt: new Date()
                });
                break;
                
            case 'face':
                content.emojis.push({
                    id: segment.data.id,
                    name: this.faceMap.get(segment.data.id) || `表情${segment.data.id}`,
                    url: undefined,
                    type: 'face'
                });
                break;
                
            case 'reply':
                if (!content.reply) {
                    content.reply = {
                        messageId: segment.data.id,
                        senderName: undefined,
                        content: '引用消息',
                        elements: []
                    };
                }
                break;
                
            default:
                // 其他特殊元素
                content.special.push({
                    type: segment.type,
                    data: segment.data,
                    description: `${segment.type}类型消息`
                });
                break;
        }
    }

    /**
     * 从OneBot消息生成HTML内容
     */
    private generateHtmlFromOB11(message: any[]): string {
        if (!Array.isArray(message)) return '';
        
        return message.map(segment => {
            switch (segment.type) {
                case 'text':
                    return this.escapeHtml(segment.data.text);
                case 'at':
                    return `<span class="at">@${segment.data.qq === 'all' ? '全体成员' : segment.data.qq}</span>`;
                case 'image':
                    return `<img src="${segment.data.url || ''}" alt="图片" />`;
                case 'face':
                    return `<span class="emoji">[表情:${segment.data.id}]</span>`;
                case 'file':
                    return `<span class="file">[文件:${segment.data.file}]</span>`;
                case 'video':
                    return `<span class="video">[视频:${segment.data.file}]</span>`;
                case 'voice':
                    return `<span class="voice">[语音]</span>`;
                case 'reply':
                    return `<span class="reply">[回复消息]</span>`;
                default:
                    return `<span class="special">[${segment.type}]</span>`;
            }
        }).join('');
    }

    /**
     * 转义HTML特殊字符
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 解析单条消息
     * 
     * @param message 原始消息
     * @returns 解析后的消息
     */
    async parseMessage(message: RawMessage): Promise<ParsedMessage> {
        const startTime = Date.now();
        
        try {
            // 解析发送者信息
            const sender = await this.parseSenderInfo(message);
            
            // 解析接收者信息
            const receiver = this.parseReceiverInfo(message);
            
            // 解析消息内容
            const content = await this.parseMessageContent(message.elements || []);
            
            // 计算统计信息
                            const stats = {
                elementCount: (message.elements && message.elements.length) || 0,
                resourceCount: content.resources.length,
                textLength: content.text.length,
                processingTime: Date.now() - startTime
            };

            return {
                messageId: message.msgId,
                messageSeq: message.msgSeq,
                msgRandom: message.msgRandom,
                timestamp: new Date(parseInt(message.msgTime) * 1000),
                sender,
                receiver,
                messageType: message.msgType,
                isSystemMessage: this.isSystemMessage(message),
                isRecalled: this.isRecalledMessage(message),
                isTempMessage: this.isTempMessage(message),
                content,
                stats,
                rawMessage: message
            };

        } catch (error) {
            throw new SystemError({
                type: ErrorType.API_ERROR,
                message: '解析消息失败',
                details: error,
                timestamp: new Date(),
                context: { messageId: message.msgId }
            });
        }
    }

    /**
     * 解析消息内容元素
     * 
     * @param elements 消息元素列表
     * @returns 解析后的内容
     */
    private async parseMessageContent(elements: MessageElement[]): Promise<ParsedMessageContent> {
        let text = '';
        let html = '';
        let raw = '';
        const mentions: ParsedMessageContent['mentions'] = [];
        const resources: ResourceInfo[] = [];
        const emojis: ParsedMessageContent['emojis'] = [];
        const special: ParsedMessageContent['special'] = [];
        
        let reply: ParsedMessageContent['reply'] | undefined;
        let location: ParsedMessageContent['location'] | undefined;
        let card: ParsedMessageContent['card'] | undefined;
        let multiForward: ParsedMessageContent['multiForward'] | undefined;
        let calendar: ParsedMessageContent['calendar'] | undefined;

        for (const element of elements) {
            const elementType = element.elementType;
            raw += JSON.stringify(element) + '\n';

            try {
                switch (elementType) {
                    case ElementType.TEXT:
                        await this.parseTextElement(element, { text, html, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.PIC:
                        await this.parsePicElement(element, { text, html, resources, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.VIDEO:
                        await this.parseVideoElement(element, { text, html, resources, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.PTT:
                        await this.parsePttElement(element, { text, html, resources, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.FILE:
                        await this.parseFileElement(element, { text, html, resources, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.FACE:
                        await this.parseFaceElement(element, { text, html, emojis, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.MFACE:
                        await this.parseMarketFaceElement(element, { text, html, emojis, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.REPLY:
                        reply = await this.parseReplyElement(element);
                        text += `[回复 ${reply?.senderName}: ${reply?.content}]\n`;
                        html += `<div class="reply">[回复 ${reply?.senderName}: ${this.escapeHtml(reply?.content || '')}]</div>`;
                        break;

                    case ElementType.ARK:
                        card = await this.parseArkElement(element);
                        text += `[卡片消息: ${card?.title}]`;
                        html += `<div class="card">[卡片消息: ${this.escapeHtml(card?.title || '')}]</div>`;
                        break;

                    case ElementType.MULTIFORWARD:
                        multiForward = await this.parseMultiForwardElement(element);
                        text += `[合并转发: ${multiForward?.title}]`;
                        html += `<div class="multi-forward">[合并转发: ${this.escapeHtml(multiForward?.title || '')}]</div>`;
                        break;

                    case ElementType.SHARELOCATION:
                        location = await this.parseLocationElement(element);
                        text += `[位置: ${location?.title || location?.address}]`;
                        html += `<div class="location">[位置: ${this.escapeHtml(location?.title || location?.address || '')}]</div>`;
                        break;

                    case ElementType.CALENDAR:
                        calendar = await this.parseCalendarElement(element);
                        text += `[日历: ${calendar?.title}]`;
                        html += `<div class="calendar">[日历: ${this.escapeHtml(calendar?.title || '')}]</div>`;
                        break;

                    case ElementType.MARKDOWN:
                        await this.parseMarkdownElement(element, { text, html, addText: (t, h) => { text += t; html += h; } });
                        break;

                    case ElementType.GreyTip:
                        await this.parseGreyTipElement(element, { text, html, addText: (t, h) => { text += t; html += h; } });
                        break;

                    default:
                        // 处理未知或不常见的元素类型
                        const specialInfo = await this.parseSpecialElement(element);
                        if (specialInfo) {
                            special.push(specialInfo);
                            text += `[${specialInfo.description}]`;
                            html += `<div class="special">[${this.escapeHtml(specialInfo.description)}]</div>`;
                        }
                        break;
                }
            } catch (error) {
                this.log(`解析元素失败 (type: ${elementType}): ${error}`, 'warn');
                
                // 添加到特殊元素中
                special.push({
                    type: `error_${elementType}`,
                    data: element,
                    description: `解析失败的元素 (${ElementType[elementType] || elementType})`
                });
                
                text += `[解析失败的消息元素]`;
                html += `<span class="parse-error">[解析失败的消息元素]</span>`;
            }
        }

        // 解析@消息
        const atResults = this.parseAtMentions(text);
        mentions.push(...atResults);

        return {
            text: text.trim(),
            html: html.trim(),
            raw: raw.trim(),
            mentions,
            reply,
            resources,
            emojis,
            location,
            card,
            multiForward,
            calendar,
            special
        };
    }

    /**
     * 解析文本元素
     */
    private async parseTextElement(
        element: MessageElement,
        context: { text: string; html: string; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.textElement) return;

        const content = element.textElement.content || '';
        context.addText(content, this.escapeHtml(content));
    }

    /**
     * 解析图片元素
     */
    private async parsePicElement(
        element: MessageElement,
        context: { text: string; html: string; resources: ResourceInfo[]; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.picElement) return;

        const pic = element.picElement;
        const resource: ResourceInfo = {
            type: 'image',
            fileName: pic.fileName || 'image.jpg',
            fileSize: parseInt(pic.fileSize?.toString() || '0'),
            originalUrl: pic.originImageUrl || '',
            md5: pic.md5HexStr || '',
            accessible: !!pic.originImageUrl,
            checkedAt: new Date()
        };

        context.resources.push(resource);
        
        const altText = `[图片${pic.fileName ? `: ${pic.fileName}` : ''}]`;
        if (this.config.includeResourceLinks && resource.originalUrl) {
            context.addText(altText, `<img src="${resource.originalUrl}" alt="${pic.fileName}" class="message-image" />`);
        } else {
            context.addText(altText, `<span class="resource-placeholder">${altText}</span>`);
        }
    }

    /**
     * 解析视频元素
     */
    private async parseVideoElement(
        element: MessageElement,
        context: { text: string; html: string; resources: ResourceInfo[]; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.videoElement) return;

        const video = element.videoElement;
        const resource: ResourceInfo = {
            type: 'video',
            fileName: video.fileName || 'video.mp4',
            fileSize: parseInt(video.fileSize?.toString() || '0'),
            originalUrl: '',
            md5: video.fileUuid || '',
            accessible: false,
            checkedAt: new Date()
        };

        context.resources.push(resource);
        
        const altText = `[视频${video.fileName ? `: ${video.fileName}` : ''}]`;
        if (this.config.includeResourceLinks && resource.originalUrl) {
            context.addText(altText, `<video src="${resource.originalUrl}" controls class="message-video">${altText}</video>`);
        } else {
            context.addText(altText, `<span class="resource-placeholder">${altText}</span>`);
        }
    }

    /**
     * 解析语音元素
     */
    private async parsePttElement(
        element: MessageElement,
        context: { text: string; html: string; resources: ResourceInfo[]; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.pttElement) return;

        const ptt = element.pttElement;
        const resource: ResourceInfo = {
            type: 'audio',
            fileName: ptt.fileName || 'audio.wav',
            fileSize: parseInt(ptt.fileSize?.toString() || '0'),
            originalUrl: '',
            md5: ptt.md5HexStr || '',
            accessible: false,
            checkedAt: new Date()
        };

        context.resources.push(resource);
        
        const duration = ptt.duration ? `${Math.round(ptt.duration)}秒` : '';
        const altText = `[语音${duration ? ` ${duration}` : ''}]`;
        
        if (this.config.includeResourceLinks && resource.originalUrl) {
            context.addText(altText, `<audio src="${resource.originalUrl}" controls class="message-audio">${altText}</audio>`);
        } else {
            context.addText(altText, `<span class="resource-placeholder">${altText}</span>`);
        }
    }

    /**
     * 解析文件元素
     */
    private async parseFileElement(
        element: MessageElement,
        context: { text: string; html: string; resources: ResourceInfo[]; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.fileElement) return;

        const file = element.fileElement;
        const resource: ResourceInfo = {
            type: 'file',
            fileName: file.fileName || 'file',
            fileSize: parseInt(file.fileSize?.toString() || '0'),
            originalUrl: '',
            md5: file.fileMd5 || '',
            accessible: false,
            checkedAt: new Date()
        };

        context.resources.push(resource);
        
        const altText = `[文件: ${resource.fileName}]`;
        if (this.config.includeResourceLinks && resource.originalUrl) {
            context.addText(altText, `<a href="${resource.originalUrl}" class="message-file" download="${resource.fileName}">${altText}</a>`);
        } else {
            context.addText(altText, `<span class="resource-placeholder">${altText}</span>`);
        }
    }

    /**
     * 解析普通表情元素
     */
    private async parseFaceElement(
        element: MessageElement,
        context: { text: string; html: string; emojis: ParsedMessageContent['emojis']; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.faceElement) return;

        const face = element.faceElement;
        const faceId = face.faceIndex?.toString() || '';
        const faceName = face.faceText || this.faceMap.get(faceId) || `表情${faceId}`;

        context.emojis.push({
            id: faceId,
            name: faceName,
            type: 'face'
        });

        const faceText = `[${faceName}]`;
        context.addText(faceText, `<span class="emoji face" data-id="${faceId}">${faceText}</span>`);
    }

    /**
     * 解析超级表情元素
     */
    private async parseMarketFaceElement(
        element: MessageElement,
        context: { text: string; html: string; emojis: ParsedMessageContent['emojis']; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.marketFaceElement || !this.config.parseMarketFace) return;

        const marketFace = element.marketFaceElement;
        const faceName = marketFace.faceName || '超级表情';
        const emojiId = marketFace.emojiId || '';

        context.emojis.push({
            id: emojiId,
            name: faceName,
            url: undefined, // 超级表情的URL需要通过其他方式获取
            type: 'market'
        });

        const faceText = `[${faceName}]`;
        // 超级表情暂时用文本形式显示，URL获取需要额外的API调用
        context.addText(faceText, `<span class="emoji market-face">${faceText}</span>`);
    }

    /**
     * 解析回复元素
     */
    private async parseReplyElement(element: MessageElement): Promise<ParsedMessageContent['reply'] | undefined> {
        if (!element.replyElement) return undefined;

        const reply = element.replyElement;
        return {
            messageId: reply.sourceMsgIdInRecords || '',
            senderName: reply.senderUidStr || '',
            content: this.extractReplyContent(reply),
            elements: []
        };
    }

    /**
     * 解析ARK卡片元素
     */
    private async parseArkElement(element: MessageElement): Promise<ParsedMessageContent['card'] | undefined> {
        if (!element.arkElement || !this.config.parseCardMessages) return undefined;

        const ark = element.arkElement;
        try {
            const arkData = JSON.parse(ark.bytesData || '{}');
            return {
                title: arkData.prompt || arkData.title || '卡片消息',
                content: arkData.desc || arkData.summary || '',
                url: arkData.url || arkData.jumpUrl || '',
                preview: arkData.preview || '',
                type: 'ark'
            };
        } catch (error) {
            this.log(`解析ARK卡片失败: ${error}`, 'warn');
            return {
                title: '卡片消息',
                content: ark.bytesData || '',
                url: '',
                preview: '',
                type: 'ark'
            };
        }
    }

    /**
     * 解析合并转发元素
     */
    private async parseMultiForwardElement(element: MessageElement): Promise<ParsedMessageContent['multiForward'] | undefined> {
        if (!element.multiForwardMsgElement || !this.config.parseMultiForward) return undefined;

        const multiForward = element.multiForwardMsgElement;
        return {
            title: multiForward.xmlContent || '聊天记录',
            summary: '合并转发的聊天记录',
            messageCount: 0, // 这个需要进一步解析
            senderNames: []
        };
    }

    /**
     * 解析位置元素
     */
    private async parseLocationElement(element: MessageElement): Promise<ParsedMessageContent['location'] | undefined> {
        if (!element.shareLocationElement) return undefined;

        // const location = element.shareLocationElement; // 暂时不使用，避免lint警告
        return {
            latitude: 0, // location元素结构需要进一步调研
            longitude: 0,
            title: '位置信息',
            address: ''
        };
    }

    /**
     * 解析日历元素
     */
    private async parseCalendarElement(element: MessageElement): Promise<ParsedMessageContent['calendar'] | undefined> {
        if (!element.calendarElement) return undefined;

        const calendar = element.calendarElement;
        return {
            title: '日历事件',
            startTime: new Date(),
            description: JSON.stringify(calendar)
        };
    }

    /**
     * 解析Markdown元素
     */
    private async parseMarkdownElement(
        element: MessageElement,
        context: { text: string; html: string; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.markdownElement) return;

        const markdown = element.markdownElement;
        const content = markdown.content || '';
        
        context.addText(content, `<div class="markdown">${this.escapeHtml(content)}</div>`);
    }

    /**
     * 解析灰色提示元素（系统消息）
     */
    private async parseGreyTipElement(
        element: MessageElement,
        context: { text: string; html: string; addText: (text: string, html: string) => void }
    ): Promise<void> {
        if (!element.grayTipElement) return;

        const greyTip = element.grayTipElement;
        const content = greyTip.subElementType?.toString() || '系统消息';
        
        context.addText(`[${content}]`, `<div class="system-message">[${this.escapeHtml(content)}]</div>`);
    }

    /**
     * 解析特殊/未知元素
     */
    private async parseSpecialElement(element: MessageElement): Promise<ParsedMessageContent['special'][0] | null> {
        const elementType = element.elementType;
        const typeName = ElementType[elementType] || `UNKNOWN_${elementType}`;
        
        return {
            type: typeName,
            data: element,
            description: `${typeName}消息`
        };
    }

    /**
     * 解析@提及
     */
    private parseAtMentions(text: string): ParsedMessageContent['mentions'] {
        const mentions: ParsedMessageContent['mentions'] = [];
        
        // 匹配@所有人
        if (text.includes('@全体成员') || text.includes('@everyone')) {
            mentions.push({
                uid: 'all',
                name: '全体成员',
                type: 'all'
            });
        }
        
        // 匹配@具体用户（简化版本，实际应该从atElement中获取）
        const atMatches = text.match(/@[\w\u4e00-\u9fa5]+/g);
        if (atMatches) {
            atMatches.forEach(match => {
                const name = match.substring(1);
                mentions.push({
                    uid: 'unknown',
                    name,
                    type: 'user'
                });
            });
        }
        
        return mentions;
    }

    /**
     * 解析发送者信息
     */
    private async parseSenderInfo(message: RawMessage): Promise<ParsedMessage['sender']> {
        const uid = message.senderUid || message.peerUid;
        let userInfo: any = null;

        if (this.config.fetchUserInfo && uid) {
            userInfo = this.userInfoCache.get(uid);
            if (!userInfo) {
                try {
                    userInfo = await this.core.apis.UserApi.getUserDetailInfo(uid, false);
                    if (userInfo) {
                        this.userInfoCache.set(uid, userInfo);
                    }
                } catch (error) {
                    this.log(`获取用户信息失败 (${uid}): ${error}`, 'warn');
                }
            }
        }

        return {
            uid,
            uin: message.senderUin || userInfo?.uin,
            name: message.sendNickName || userInfo?.nick || undefined,
            avatar: userInfo?.avatarUrl,
            role: undefined // roleType信息需要从群成员信息中获取
        };
    }

    /**
     * 解析接收者信息
     */
    private parseReceiverInfo(message: RawMessage): ParsedMessage['receiver'] | undefined {
        if (message.chatType === 1) {
            // 私聊
            return {
                uid: message.peerUid,
                name: undefined,
                type: 'private'
            };
        } else if (message.chatType === 2) {
            // 群聊
            return {
                uid: message.peerUid,
                name: undefined,
                type: 'group'
            };
        }
        return undefined;
    }

    /**
     * 判断是否为系统消息
     */
    private isSystemMessage(message: RawMessage): boolean {
        return message.msgType === NTMsgType.KMSGTYPEGRAYTIPS ||
               (message.elements && message.elements.length === 1 && message.elements[0]?.elementType === ElementType.GreyTip);
    }

    /**
     * 判断是否为撤回消息
     */
    private isRecalledMessage(message: RawMessage): boolean {
        return message.recallTime !== '0' && message.recallTime !== undefined;
    }

    /**
     * 判断是否为临时消息
     */
    private isTempMessage(message: RawMessage): boolean {
        return message.chatType === 100; // 临时会话
    }

    /**
     * 提取回复内容
     */
    private extractReplyContent(replyElement: any): string {
        try {
            const elements = replyElement.sourceMsgElements || [];
            let content = '';
            
            for (const element of elements) {
                if (element.textElement) {
                    content += element.textElement.content || '';
                } else if (element.picElement) {
                    content += '[图片]';
                } else if (element.videoElement) {
                    content += '[视频]';
                } else if (element.pttElement) {
                    content += '[语音]';
                } else if (element.fileElement) {
                    content += `[文件: ${element.fileElement.fileName || ''}]`;
                }
            }
            
            return content.trim() || '原消息';
        } catch (error) {
            return '原消息';
        }
    }

    /**
     * 创建fallback消息记录（当OneBot解析失败时使用）
     */
    private createFallbackMessage(message: RawMessage): ParsedMessage {
        const timestamp = new Date(parseInt(message.msgTime) * 1000);
        
        // 提取文本内容
        let textContent = '';
        if (message.elements && message.elements.length > 0) {
            textContent = message.elements
                .filter(e => e.textElement)
                .map(e => e.textElement?.content || '')
                .join('')
                .trim();
            
            // 如果没有文本内容，尝试生成描述性文本
            if (!textContent) {
                const elementTypes = message.elements.map(e => {
                    if (e.picElement) return '[图片]';
                    if (e.videoElement) return '[视频]';
                    if (e.fileElement) return '[文件]';
                    if (e.pttElement) return '[语音]';
                    if (e.faceElement) return '[表情]';
                    if (e.marketFaceElement) return '[表情包]';
                    if (e.replyElement) return '[回复]';
                    return '[消息]';
                }).join('');
                textContent = elementTypes || '[消息内容]';
            }
        }
        
        return {
            messageId: message.msgId,
            messageSeq: message.msgSeq,
            msgRandom: message.msgRandom,
            timestamp,
            sender: {
                uid: message.senderUid || '0',
                uin: message.senderUin || '0',
                name: message.sendNickName || message.sendRemarkName || '未知用户'
            },
            receiver: {
                uid: message.peerUid,
                type: message.chatType === 2 ? 'group' : 'private'
            },
            messageType: message.msgType,
            isSystemMessage: this.isSystemMessage(message),
            isRecalled: message.recallTime !== '0' && message.recallTime !== undefined,
            isTempMessage: false,
            content: {
                text: textContent,
                html: this.escapeHtml(textContent),
                raw: JSON.stringify(message.elements || []),
                mentions: [],
                resources: [],
                emojis: [],
                special: []
            },
            stats: {
                elementCount: message.elements?.length || 0,
                resourceCount: 0,
                textLength: textContent.length,
                processingTime: 0
            },
            rawMessage: message
        };
    }

    /**
     * 创建错误消息记录
     */
    private createErrorMessage(originalMessage: RawMessage, error: any): ParsedMessage {
        return {
            messageId: originalMessage.msgId,
            messageSeq: originalMessage.msgSeq,
            timestamp: new Date(parseInt(originalMessage.msgTime) * 1000),
            sender: {
                uid: originalMessage.senderUid || 'unknown',
                name: originalMessage.sendNickName || '未知用户'
            },
            messageType: originalMessage.msgType,
            isSystemMessage: false,
            isRecalled: false,
            isTempMessage: false,
            content: {
                text: '[消息解析失败]',
                html: '<span class="error">[消息解析失败]</span>',
                raw: JSON.stringify(originalMessage),
                mentions: [],
                resources: [],
                emojis: [],
                special: [{
                    type: 'error',
                    data: error,
                    description: '消息解析失败'
                }]
            },
            stats: {
                elementCount: 0,
                resourceCount: 0,
                textLength: 0,
                processingTime: 0
            },
            rawMessage: originalMessage
        };
    }

    /**
     * 初始化表情映射
     */
    private initializeFaceMap(): void {
        // 这里可以加载QQ表情ID到名称的映射
        // 暂时使用简化版本
        this.faceMap.set('0', '微笑');
        this.faceMap.set('1', '撇嘴');
        this.faceMap.set('2', '色');
        this.faceMap.set('3', '发呆');
        this.faceMap.set('4', '得意');
        this.faceMap.set('5', '流泪');
        this.faceMap.set('6', '害羞');
        this.faceMap.set('7', '闭嘴');
        this.faceMap.set('8', '睡');
        this.faceMap.set('9', '大哭');
        this.faceMap.set('10', '尴尬');
        // ... 更多表情映射
    }


    /**
     * 日志输出
     */
    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
        if (!this.config.debugMode && level === 'debug') return;
        
        const prefix = '[MessageParser]';
        switch (level) {
            case 'debug':
                console.debug(`${prefix} ${message}`);
                break;
            case 'info':
                console.log(`${prefix} ${message}`);
                break;
            case 'warn':
                console.warn(`${prefix} ${message}`);
                break;
            case 'error':
                console.error(`${prefix} ${message}`);
                break;
        }
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.userInfoCache.clear();
        this.log('缓存已清除');
    }

    /**
     * 获取统计信息
     */
    getStats(): {
        userCacheSize: number;
        faceMappingSize: number;
    } {
        return {
            userCacheSize: this.userInfoCache.size,
            faceMappingSize: this.faceMap.size
        };
    }
}