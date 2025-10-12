/**
 * 简化消息解析器
 */
import { RawMessage } from 'NapCatQQ/src/core/types.js';
export interface CleanMessage {
    id: string;
    seq: string;
    timestamp: number;
    time: string;
    sender: {
        uid: string;
        uin?: string;
        name: string;
        remark?: string;
    };
    type: string;
    content: MessageContent;
    recalled: boolean;
    system: boolean;
}
export interface MessageContent {
    text: string;
    html: string;
    elements: MessageElementData[];
    resources: ResourceData[];
}
export interface MessageElementData {
    type: string;
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
    bySender: Record<string, {
        uid: string;
        count: number;
    }>;
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
/** 轻量解析器配置 */
export interface SimpleParserOptions {
    concurrency?: number;
    progressEvery?: number;
    yieldEvery?: number;
    html?: 'full' | 'none';
    onProgress?: (processed: number, total: number) => void;
}
export declare class SimpleMessageParser {
    private readonly options;
    private readonly onProgress?;
    private readonly concurrency;
    constructor(opts?: SimpleParserOptions);
    /**
     * 解析消息列表（高并发 + 有序输出）
     */
    parseMessages(messages: RawMessage[]): Promise<CleanMessage[]>;
    /**
     * 【流式版本】解析消息生成器 - 逐条解析并yield，实现低内存占用
     * 适用于大量消息的场景，配合流式导出可实现全程低内存
     */
    parseMessagesStream(messages: RawMessage[], resourceMap?: Map<string, any>): AsyncGenerator<CleanMessage, void, undefined>;
    /**
     * 解析单条消息（公开）
     */
    parseSingleMessage(message: RawMessage): Promise<CleanMessage>;
    /**
     * 解析单条消息（内部）
     */
    private parseMessage;
    private getMessageTypeString;
    /**
     * 单趟解析消息内容
     */
    private parseMessageContent;
    /**
     * 元素解析（尽量同步，无额外中间对象）
     */
    private parseElement;
    private extractResource;
    private elementToText;
    private parseSizeString;
    private isSystemMessage;
    private createErrorMessage;
    /** @deprecated 使用 isPureMediaMessage 代替 */
    isPureImageMessage(message: CleanMessage): boolean;
    isPureMediaMessage(message: CleanMessage): boolean;
    private hasRealTextContent;
    private isOnlyCQCode;
    filterMessages(messages: CleanMessage[], includePureImages?: boolean): CleanMessage[];
    calculateStatistics(messages: CleanMessage[]): MessageStatistics;
    updateResourcePaths(messages: CleanMessage[], resourceMap: Map<string, any[]>): Promise<void>;
    /**
     * 更新单条消息的资源路径（私有方法，供批量和流式使用）
     */
    private updateSingleMessageResourcePaths;
    private parseJsonContent;
    private extractReplyContent;
    private generateMarketFaceUrl;
    private parseGrayTipElement;
    private getSystemMessageSummary;
}
//# sourceMappingURL=SimpleMessageParser.d.ts.map