/**
 * 消息解析器
 */
import { RawMessage, NTMsgType } from 'NapCatQQ/src/core/index.js';
import { ResourceInfo } from '../../types/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { type ForwardMessageEntry } from './forward-utils.js';
/**
 * 解析后的消息内容接口
 */
export interface ParsedMessageContent {
    text: string;
    html: string;
    raw: string;
    mentions: Array<{
        uid: string;
        name?: string;
        type: 'user' | 'all';
    }>;
    reply?: {
        messageId: string;
        referencedMessageId?: string;
        senderName?: string;
        content: string;
        elements?: any[];
    };
    resources: ResourceInfo[];
    emojis: Array<{
        id: string;
        name?: string;
        url?: string;
        type: 'face' | 'market' | 'custom';
    }>;
    location?: {
        latitude: number;
        longitude: number;
        title?: string;
        address?: string;
    };
    card?: {
        title?: string;
        content?: string;
        url?: string;
        preview?: string;
        type: string;
    };
    multiForward?: {
        title: string;
        summary: string;
        messageCount: number;
        senderNames: string[];
        messages: ForwardMessageEntry[];
    };
    calendar?: {
        title: string;
        startTime: Date;
        endTime?: Date;
        description?: string;
    };
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
    messageId: string;
    messageSeq: string;
    msgRandom?: string;
    timestamp: Date;
    sender: {
        uid: string;
        uin?: string;
        name?: string;
        avatar?: string;
        role?: 'owner' | 'admin' | 'member';
    };
    receiver?: {
        uid: string;
        name?: string;
        type: 'group' | 'private';
    };
    messageType: NTMsgType;
    isSystemMessage: boolean;
    isRecalled: boolean;
    isTempMessage: boolean;
    content: ParsedMessageContent;
    stats: {
        elementCount: number;
        resourceCount: number;
        textLength: number;
        processingTime: number;
    };
    rawMessage: RawMessage;
}
/**
 * 消息解析器配置接口（扩展）
 */
export interface MessageParserConfig {
    includeResourceLinks: boolean;
    includeSystemMessages: boolean;
    parseMarketFace: boolean;
    parseCardMessages: boolean;
    parseMultiForward: boolean;
    fetchUserInfo: boolean;
    timeFormat: string;
    maxTextLength: number;
    debugMode: boolean;
    /** 新增：性能 & 行为开关 */
    concurrency?: number;
    obParseTimeoutMs: number;
    quickReply: boolean;
    obMode: 'prefer-native' | 'prefer-ob' | 'native-only' | 'ob-only';
    fallback: 'native' | 'basic';
    html: 'full' | 'none';
    rawStrategy: 'string' | 'none';
    progressEvery: number;
    yieldEvery: number;
    suppressFallbackWarn: boolean;
    stopOnAbort: boolean;
    signal?: {
        aborted: boolean;
    } | AbortSignal;
    onProgress?: (processed: number, total: number) => void;
}
export declare class MessageParser {
    private readonly core;
    private readonly config;
    private readonly oneBotMsgApi;
    /** 用户信息缓存 */
    private userInfoCache;
    /** 表情映射缓存 */
    private faceMap;
    /** 全局消息映射，用于查找被引用的消息 */
    private messageMap;
    /** 并发度（内部自适应，可被配置覆盖） */
    private readonly concurrency;
    constructor(core: NapCatCore, config?: Partial<MessageParserConfig>);
    /**
     * 解析消息列表（高并发 + 有序输出 + 超时快回退 + 让步）
     * - 自动跳过空消息与（可选）系统消息
     * - OB 与原生两路可切换
     */
    parseMessages(messages: RawMessage[]): Promise<ParsedMessage[]>;
    /**
     * 将 OneBot 消息转换为 ParsedMessage 格式（单趟处理 + 可选产出 HTML/RAW）
     */
    private convertOB11MessageToParsedMessage;
    /**
     * 处理 OneBot 段（极简分支 + 复用日期对象）
     */
    private processOB11Segment;
    /**
     * 从 OneBot 消息生成 HTML（单趟）
     */
    private generateHtmlFromOB11;
    /** 兼容旧名方法（内部调用高性能实现） */
    private escapeHtml;
    /**
     * 解析单条消息（原生路径，完全本地，无 OB 调用）
     */
    parseMessage(message: RawMessage): Promise<ParsedMessage>;
    /**
     * 解析消息内容（单趟 + 分块构建 + 可选 HTML/RAW）
     */
    private parseMessageContent;
    /** 普通表情/超级表情等已内联在 parseMessageContent */
    private parseReplyElement;
    private parseArkElement;
    private parseMultiForwardElement;
    private parseLocationElement;
    private parseCalendarElement;
    private formatForwardDisplayTime;
    private parseSpecialElement;
    private readonly AT_REGEX;
    private parseAtMentions;
    private parseSenderInfo;
    private parseReceiverInfo;
    private isSystemMessage;
    private isRecalledMessage;
    private isTempMessage;
    private extractReplyContent;
    private createFallbackMessage;
    private createErrorMessage;
    private initializeFaceMap;
    private log;
    clearCache(): void;
    getStats(): {
        userCacheSize: number;
        faceMappingSize: number;
    };
}
//# sourceMappingURL=MessageParser.d.ts.map