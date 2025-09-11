/**
 * 简化消息解析器
 * 专门为QQ聊天记录导出优化，提供清晰、准确的消息解析
 */

import path from 'path';
import { RawMessage, MessageElement, NTMsgType } from '@/core/types/msg';

export interface CleanMessage {
    /** 消息ID */
    id: string;
    /** 消息序列号 */
    seq: string;
    /** 发送时间戳（毫秒） */
    timestamp: number;
    /** 发送时间（ISO字符串） */
    time: string;
    /** 发送者信息 */
    sender: {
        uid: string;
        uin?: string;
        name: string;
        remark?: string;
    };
    /** 消息类型 */
    type: string;
    /** 消息内容 */
    content: MessageContent;
    /** 是否撤回 */
    recalled: boolean;
    /** 是否系统消息 */
    system: boolean;
}

export interface MessageContent {
    /** 纯文本内容 */
    text: string;
    /** 富文本内容（HTML） */
    html: string;
    /** 消息元素 */
    elements: MessageElementData[];
    /** 资源统计 */
    resources: ResourceData[];
}

export interface MessageElementData {
    /** 元素类型 */
    type: string;
    /** 元素数据 */
    data: any;
}

export interface ResourceData {
    type: string;
    filename: string;
    size: number;
    url?: string;
    localPath?: string;
    width?: number;
    height?: number;
    duration?: number;
}

export interface MessageStatistics {
    total: number;
    byType: Record<string, number>;
    bySender: Record<string, { uid: string; count: number }>;
    resources: {
        total: number;
        byType: Record<string, number>;
        totalSize: number;
    };
    timeRange: {
        start: string;
        end: string;
        durationDays: number;
    };
}

/**
 * 简化消息解析器类
 */
export class SimpleMessageParser {
    
    /**
     * 解析消息列表
     */
    async parseMessages(messages: RawMessage[]): Promise<CleanMessage[]> {
        const results: CleanMessage[] = [];
        
        for (const message of messages) {
            try {
                const parsed = await this.parseMessage(message);
                results.push(parsed);
            } catch (error) {
                console.error('解析消息失败:', error, message.msgId);
                results.push(this.createErrorMessage(message, error));
            }
        }
        
        return results;
    }
    
    /**
     * 解析单条消息
     */
    private async parseMessage(message: RawMessage): Promise<CleanMessage> {
        const parsedTime = parseInt(message.msgTime);
        // 如果时间戳无效，使用当前时间作为fallback
        const timestamp = isNaN(parsedTime) || parsedTime <= 0 ? Date.now() : parsedTime * 1000;
        
        // 改进发送者名称逻辑：群名片 > 好友备注 > 昵称 > QQ号 > UID
        const senderName = message.sendMemberName ||  // 群名片优先
                          message.sendRemarkName ||   // 好友备注
                          message.sendNickName ||     // 昵称
                          message.senderUin ||        // QQ号
                          message.senderUid ||        // UID
                          '未知用户';
        
        const cleanMessage: CleanMessage = {
            id: message.msgId,
            seq: message.msgSeq,
            timestamp,
            time: new Date(timestamp).toISOString(),
            sender: {
                uid: message.senderUid,
                uin: message.senderUin,
                name: senderName,
                remark: message.sendRemarkName || undefined
            },
            type: this.getMessageTypeString(message.msgType),
            content: await this.parseMessageContent(message),
            recalled: message.recallTime !== '0',
            system: this.isSystemMessage(message)
        };
        
        return cleanMessage;
    }
    
    /**
     * 获取消息类型字符串
     */
    private getMessageTypeString(msgType: NTMsgType): string {
        switch (msgType) {
            case NTMsgType.KMSGTYPEMIX: return 'text';
            case NTMsgType.KMSGTYPENULL: return 'text';
            case NTMsgType.KMSGTYPEFILE: return 'file';
            case NTMsgType.KMSGTYPEVIDEO: return 'video';
            case NTMsgType.KMSGTYPEPTT: return 'audio';
            case NTMsgType.KMSGTYPEREPLY: return 'reply';
            case NTMsgType.KMSGTYPEMULTIMSGFORWARD: return 'forward';
            case NTMsgType.KMSGTYPEGRAYTIPS: return 'system';
            case NTMsgType.KMSGTYPESTRUCT: return 'json';
            case NTMsgType.KMSGTYPEARKSTRUCT: return 'json';
            default: return `type_${msgType}`;
        }
    }
    
    /**
     * 解析消息内容
     */
    private async parseMessageContent(message: RawMessage): Promise<MessageContent> {
        const elements = message.elements || [];
        const parsedElements: MessageElementData[] = [];
        const resources: ResourceData[] = [];
        let textParts: string[] = [];
        let htmlParts: string[] = [];
        
        for (const element of elements) {
            const parsed = await this.parseElement(element);
            if (parsed) {
                parsedElements.push(parsed);
                
                // 提取资源信息
                const resource = this.extractResource(parsed);
                if (resource) {
                    resources.push(resource);
                }
                
                // 构建文本和HTML内容
                const { text, html } = this.elementToText(parsed);
                textParts.push(text);
                htmlParts.push(html);
            }
        }
        
        return {
            text: textParts.join('').trim(),
            html: htmlParts.join('').trim(),
            elements: parsedElements,
            resources
        };
    }
    
    /**
     * 解析消息元素
     */
    private async parseElement(element: MessageElement): Promise<MessageElementData | null> {
        // 文本元素
        if (element.textElement) {
            return {
                type: 'text',
                data: { text: element.textElement.content || '' }
            };
        }
        
        // 表情
        if (element.faceElement) {
            return {
                type: 'face',
                data: {
                    id: element.faceElement.faceIndex,
                    name: `表情${element.faceElement.faceIndex}`
                }
            };
        }
        
        // 商城表情
        if (element.marketFaceElement) {
            const emojiId = element.marketFaceElement.emojiId || '';
            const key = element.marketFaceElement.key || '';
            const url = emojiId ? this.generateMarketFaceUrl(emojiId) : '';
            
            return {
                type: 'market_face',
                data: {
                    name: element.marketFaceElement.faceName || '商城表情',
                    tabName: (element.marketFaceElement as any).tabName || '',
                    key: key,
                    emojiId: emojiId,
                    emojiPackageId: element.marketFaceElement.emojiPackageId,
                    url: url
                }
            };
        }
        
        // 图片
        if (element.picElement) {
            return {
                type: 'image',
                data: {
                    filename: element.picElement.fileName || '图片',
                    size: this.parseSizeString(element.picElement.fileSize),
                    width: element.picElement.picWidth,
                    height: element.picElement.picHeight,
                    md5: element.picElement.md5HexStr,
                    url: element.picElement.originImageUrl || ''
                }
            };
        }
        
        // 文件
        if (element.fileElement) {
            return {
                type: 'file',
                data: {
                    filename: element.fileElement.fileName || '文件',
                    size: this.parseSizeString(element.fileElement.fileSize),
                    md5: element.fileElement.fileMd5
                }
            };
        }
        
        // 视频
        if (element.videoElement) {
            return {
                type: 'video',
                data: {
                    filename: element.videoElement.fileName || '视频',
                    size: this.parseSizeString(element.videoElement.fileSize),
                    duration: (element.videoElement as any).duration || 0,
                    thumbSize: this.parseSizeString(element.videoElement.thumbSize)
                }
            };
        }
        
        // 语音
        if (element.pttElement) {
            return {
                type: 'audio',
                data: {
                    filename: element.pttElement.fileName || '语音',
                    size: this.parseSizeString(element.pttElement.fileSize),
                    duration: element.pttElement.duration || 0
                }
            };
        }
        
        // 回复
        if (element.replyElement) {
            const replyData = this.extractReplyContent(element.replyElement);
            return {
                type: 'reply',
                data: {
                    messageId: replyData.messageId,
                    senderUin: replyData.senderUin,
                    senderName: replyData.senderName,
                    content: replyData.content,
                    timestamp: replyData.timestamp
                }
            };
        }
        
        // 转发消息
        if (element.multiForwardMsgElement) {
            return {
                type: 'forward',
                data: {
                    title: '转发消息',
                    resId: element.multiForwardMsgElement.resId || '',
                    summary: element.multiForwardMsgElement.xmlContent || ''
                }
            };
        }
        
        // JSON卡片消息
        if (element.arkElement) {
            const jsonContent = element.arkElement.bytesData || '{}';
            const parsedJson = this.parseJsonContent(jsonContent);
            
            return {
                type: 'json',
                data: {
                    content: jsonContent,
                    title: parsedJson.title || 'JSON消息',
                    description: parsedJson.description,
                    url: parsedJson.url,
                    preview: parsedJson.preview,
                    appName: parsedJson.appName,
                    summary: parsedJson.title || parsedJson.description || 'JSON消息'
                }
            };
        }
        
        // 位置消息
        if (element.shareLocationElement) {
            return {
                type: 'location',
                data: {
                    title: '位置消息',
                    summary: '分享了位置'
                }
            };
        }
        
        // 小灰条消息（系统提示）
        if (element.grayTipElement) {
            return this.parseGrayTipElement(element.grayTipElement);
        }
        
        // 未知类型 - 输出详细信息方便调试
        console.warn(`[SimpleMessageParser] 未知消息元素类型: ${element.elementType}`, element);
        return {
            type: 'system',
            data: {
                elementType: element.elementType,
                summary: this.getSystemMessageSummary(element),
                text: this.getSystemMessageSummary(element)
            }
        };
    }
    
    /**
     * 从元素提取资源信息
     */
    private extractResource(element: MessageElementData): ResourceData | null {
        if (!['image', 'file', 'video', 'audio'].includes(element.type)) {
            return null;
        }
        
        const data = element.data;
        return {
            type: element.type,
            filename: data.filename || '未知',
            size: data.size || 0,
            url: data.url,
            width: data.width,
            height: data.height,
            duration: data.duration
        };
    }
    
    /**
     * 将元素转换为文本表示
     */
    private elementToText(element: MessageElementData): { text: string; html: string } {
        switch (element.type) {
            case 'text':
                const text = element.data.text || '';
                return { text, html: text };
            
            case 'face':
                const faceText = `[表情${element.data.id}]`;
                return { text: faceText, html: faceText };
            
            case 'market_face':
                const marketText = `[${element.data.name || '表情'}]`;
                return { text: marketText, html: marketText };
            
            case 'image':
                const imgText = `[图片:${element.data.filename}]`;
                return { text: imgText, html: `<img alt="${element.data.filename}" class="image">` };
            
            case 'file':
                const fileText = `[文件:${element.data.filename}]`;
                return { text: fileText, html: `<span class="file">${fileText}</span>` };
            
            case 'video':
                const videoText = `[视频:${element.data.filename}]`;
                return { text: videoText, html: `<span class="video">${videoText}</span>` };
            
            case 'audio':
                const audioText = `[语音:${element.data.duration}秒]`;
                return { text: audioText, html: `<span class="audio">${audioText}</span>` };
            
            case 'reply':
                const replyText = `[回复消息]`;
                return { text: replyText, html: `<div class="reply">${replyText}</div>` };
            
            case 'forward':
                const forwardText = `[转发消息]`;
                return { text: forwardText, html: `<div class="forward">${forwardText}</div>` };
            
            case 'location':
                const locationText = `[位置消息]`;
                return { text: locationText, html: `<div class="location">${locationText}</div>` };
            
            case 'json':
                const jsonText = `[JSON消息]`;
                return { text: jsonText, html: `<div class="json">${jsonText}</div>` };
            
            case 'system':
                const systemText = element.data.text || element.data.summary || '系统消息';
                return { text: systemText, html: `<div class="system">${systemText}</div>` };
            
            default:
                const rawText = element.data.text || element.data.summary || element.data.content || '';
                return { text: rawText, html: rawText ? `<span>${rawText}</span>` : '' };
        }
    }
    
    /**
     * 解析大小字符串为数字
     */
    private parseSizeString(size: string | number | undefined): number {
        if (typeof size === 'number') return size;
        if (typeof size === 'string') {
            const parsed = parseInt(size);
            return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
    }
    
    /**
     * 判断是否为系统消息
     */
    private isSystemMessage(message: RawMessage): boolean {
        return message.msgType === NTMsgType.KMSGTYPEGRAYTIPS;
    }
    
    /**
     * 创建错误消息
     */
    private createErrorMessage(message: RawMessage, error: any): CleanMessage {
        const parsedTime = parseInt(message.msgTime);
        const timestamp = isNaN(parsedTime) || parsedTime <= 0 ? Date.now() : parsedTime * 1000;
        
        // 改进发送者名称逻辑：群名片 > 好友备注 > 昵称 > QQ号 > UID
        const senderName = message.sendMemberName ||  // 群名片优先
                          message.sendRemarkName ||   // 好友备注
                          message.sendNickName ||     // 昵称
                          message.senderUin ||        // QQ号
                          message.senderUid ||        // UID
                          '未知用户';
        
        return {
            id: message.msgId,
            seq: message.msgSeq,
            timestamp,
            time: new Date(timestamp).toISOString(),
            sender: {
                uid: message.senderUid,
                uin: message.senderUin,
                name: senderName
            },
            type: 'error',
            content: {
                text: `[解析失败: ${error.message}]`,
                html: `<span class="error">[解析失败: ${error.message}]</span>`,
                elements: [],
                resources: []
            },
            recalled: false,
            system: false
        };
    }
    
    /**
     * 计算消息统计信息
     */
    calculateStatistics(messages: CleanMessage[]): MessageStatistics {
        const stats: MessageStatistics = {
            total: messages.length,
            byType: {},
            bySender: {},
            resources: {
                total: 0,
                byType: {},
                totalSize: 0
            },
            timeRange: {
                start: '',
                end: '',
                durationDays: 0
            }
        };
        
        if (messages.length === 0) {
            return stats;
        }
        
        // 时间范围
        const timestamps = messages.map(m => m.timestamp).filter(t => t > 0).sort((a, b) => a - b);
        if (timestamps.length > 0) {
            const start = new Date(timestamps[0]!);
            const end = new Date(timestamps[timestamps.length - 1]!);
            stats.timeRange = {
                start: start.toISOString(),
                end: end.toISOString(),
                durationDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
            };
        }
        
        // 统计消息
        for (const message of messages) {
            // 防护：确保消息对象完整
            if (!message || !message.content) {
                console.warn('[SimpleMessageParser] 跳过无效消息:', message);
                continue;
            }
            
            // 按类型统计
            stats.byType[message.type] = (stats.byType[message.type] || 0) + 1;
            
            // 按发送者统计
            const sender = message.sender?.name || message.sender?.uid || '未知用户';
            if (!stats.bySender[sender]) {
                stats.bySender[sender] = {
                    uid: message.sender?.uid || 'unknown',
                    count: 0
                };
            }
            stats.bySender[sender]!.count++;
            
            // 资源统计
            const resources = message.content.resources || [];
            for (const resource of resources) {
                stats.resources.total++;
                const resourceType = resource.type || 'unknown';
                stats.resources.byType[resourceType] = (stats.resources.byType[resourceType] || 0) + 1;
                
                // 累加文件大小（确保数字运算）
                const size = resource.size || 0;
                stats.resources.totalSize += size;
            }
        }
        
        return stats;
    }

    /**
     * 更新消息中的资源路径为本地路径
     */
    async updateResourcePaths(messages: CleanMessage[], resourceMap: Map<string, any[]>): Promise<void> {
        for (const message of messages) {
            const resources = resourceMap.get(message.id);
            if (resources && resources.length > 0) {
                // 更新message中的resources数组
                for (let i = 0; i < message.content.resources.length && i < resources.length; i++) {
                    const resourceInfo = resources[i];
                    if (resourceInfo.localPath) {
                        // 使用文件名，让ModernHtmlExporter根据类型正确解析路径
                        const fileName = path.basename(resourceInfo.localPath);
                        message.content.resources[i]!.localPath = fileName;
                        message.content.resources[i]!.url = `resources/${resourceInfo.type}s/${fileName}`;
                        message.content.resources[i]!.type = resourceInfo.type;
                    }
                }
                
                // 更新elements中的URL
                for (const element of message.content.elements) {
                    if (element.data && typeof element.data === 'object') {
                        const resourceInfo = resources.find(r => r.fileName === element.data.filename);
                        if (resourceInfo && resourceInfo.localPath) {
                            const fileName = path.basename(resourceInfo.localPath);
                            (element.data as any).localPath = fileName;
                            if (element.type === 'image' || element.type === 'video' || element.type === 'audio' || element.type === 'file') {
                                (element.data as any).url = `resources/${resourceInfo.type}s/${fileName}`;
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * 解析JSON消息内容，提取有用信息
     */
    private parseJsonContent(jsonString: string): any {
        try {
            const json = JSON.parse(jsonString);
            
            // 提取常见的字段
            const result: any = {};
            
            // 标题
            if (json.prompt) {
                result.title = json.prompt;
            } else if (json.meta?.detail_1?.title) {
                result.title = json.meta.detail_1.title;
            } else if (json.meta?.news?.title) {
                result.title = json.meta.news.title;
            }
            
            // 描述
            if (json.meta?.detail_1?.desc) {
                result.description = json.meta.detail_1.desc;
            } else if (json.meta?.news?.desc) {
                result.description = json.meta.news.desc;
            }
            
            // URL
            if (json.meta?.detail_1?.qqdocurl) {
                result.url = json.meta.detail_1.qqdocurl;
            } else if (json.meta?.detail_1?.url) {
                result.url = json.meta.detail_1.url;
            } else if (json.meta?.news?.jumpUrl) {
                result.url = json.meta.news.jumpUrl;
            }
            
            // 预览图
            if (json.meta?.detail_1?.preview) {
                result.preview = json.meta.detail_1.preview;
            } else if (json.meta?.news?.preview) {
                result.preview = json.meta.news.preview;
            }
            
            // 应用名称
            if (json.meta?.detail_1?.title && json.app) {
                result.appName = json.meta.detail_1.title;
            } else if (json.app === 'com.tencent.miniapp_01') {
                result.appName = '小程序';
            }
            
            return result;
        } catch (error) {
            console.warn('[SimpleMessageParser] JSON解析失败:', error);
            return {};
        }
    }

    /**
     * 提取回复消息的内容
     */
    private extractReplyContent(replyElement: any): any {
        const result = {
            messageId: replyElement.replayMsgId || replyElement.replayMsgSeq || '0',
            senderUin: replyElement.senderUin || '',
            senderName: replyElement.senderUinStr || '',
            content: '引用消息',
            timestamp: 0
        };

        // 尝试从不同的字段提取内容
        if (replyElement.sourceMsgText) {
            result.content = replyElement.sourceMsgText;
        } else if (replyElement.sourceMsgTextElems && replyElement.sourceMsgTextElems.length > 0) {
            // 从文本元素数组中提取
            const textParts = replyElement.sourceMsgTextElems
                .filter((elem: any) => elem.textElement)
                .map((elem: any) => elem.textElement.content)
                .filter((text: string) => text && text.trim());
            
            if (textParts.length > 0) {
                result.content = textParts.join('');
            }
        } else if (replyElement.referencedMsg) {
            // 从引用消息中提取
            const refMsg = replyElement.referencedMsg;
            if (refMsg.msgBody) {
                result.content = refMsg.msgBody;
            }
        }

        // 尝试提取发送者名称
        if (replyElement.senderNick) {
            result.senderName = replyElement.senderNick;
        }

        // 尝试提取时间戳
        if (replyElement.replayMsgTime) {
            result.timestamp = replyElement.replayMsgTime;
        }

        return result;
    }

    /**
     * 生成表情包URL
     */
    private generateMarketFaceUrl(emojiId: string): string {
        if (emojiId.length < 2) {
            return '';
        }
        
        const prefix = emojiId.substring(0, 2);
        return `https://gxh.vip.qq.com/club/item/parcel/item/${prefix}/${emojiId}/raw300.gif`;
    }

    /**
     * 解析小灰条消息（系统提示）
     */
    private parseGrayTipElement(grayTip: any): MessageElementData {
        const subType = grayTip.subElementType;
        let summary = '系统消息';
        let text = '';

        try {
            // 撤回消息
            if (subType === 1 && grayTip.revokeElement) {
                const revokeInfo = grayTip.revokeElement;
                const operatorName = revokeInfo.operatorName || '用户';
                const originalSenderName = revokeInfo.origMsgSenderName || '用户';
                
                if (revokeInfo.isSelfOperate) {
                    text = `${operatorName} 撤回了一条消息`;
                } else if (operatorName === originalSenderName) {
                    text = `${operatorName} 撤回了一条消息`;
                } else {
                    text = `${operatorName} 撤回了 ${originalSenderName} 的消息`;
                }
                
                if (revokeInfo.wording) {
                    text = revokeInfo.wording;
                }
                
                summary = text;
            }
            // 群操作相关
            else if (subType === 4 && grayTip.groupElement) {
                // 群成员变化等
                text = grayTip.groupElement.content || '群聊更新';
                summary = text;
            }
            // JSON格式的灰条消息
            else if (subType === 17 && grayTip.jsonGrayTipElement) {
                const jsonContent = grayTip.jsonGrayTipElement.jsonStr || '{}';
                try {
                    const parsed = JSON.parse(jsonContent);
                    text = parsed.prompt || parsed.content || '系统提示';
                } catch {
                    text = '系统提示';
                }
                summary = text;
            }
            // AIO操作相关（拍一拍等）
            else if (grayTip.aioOpGrayTipElement) {
                const aioOp = grayTip.aioOpGrayTipElement;
                if (aioOp.operateType === 1) { // 拍一拍
                    const fromUser = aioOp.peerName || '用户';
                    const toUser = aioOp.targetName || '用户';
                    text = `${fromUser} 拍了拍 ${toUser}`;
                    if (aioOp.suffix) {
                        text += ` ${aioOp.suffix}`;
                    }
                } else {
                    text = aioOp.content || '互动消息';
                }
                summary = text;
            }
            else {
                // 通用处理
                const content = (grayTip as any).content || (grayTip as any).text || (grayTip as any).wording;
                if (content) {
                    text = content;
                    summary = content;
                } else {
                    text = `系统提示 (类型: ${subType})`;
                    summary = text;
                }
            }
        } catch (error) {
            console.warn('[SimpleMessageParser] 解析灰条消息失败:', error, grayTip);
            text = '系统消息';
            summary = text;
        }

        return {
            type: 'system',
            data: {
                subType,
                text,
                summary,
                originalData: grayTip
            }
        };
    }

    /**
     * 获取系统消息摘要
     */
    private getSystemMessageSummary(element: any): string {
        // 根据elementType返回更有意义的描述
        const elementType = element.elementType;
        
        switch (elementType) {
            case 8:
                return '系统提示消息';
            case 9:
                return '文件传输消息';
            case 10:
                return '语音通话消息';
            case 11:
                return '视频通话消息';
            case 12:
                return '红包消息';
            case 13:
                return '转账消息';
            default:
                return `系统消息 (类型: ${elementType})`;
        }
    }
}