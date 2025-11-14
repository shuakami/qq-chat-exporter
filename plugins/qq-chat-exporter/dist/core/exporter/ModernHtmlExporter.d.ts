import type { CleanMessage } from '../parser/SimpleMessageParser.js';
/**
 * HTML导出选项
 */
export interface HtmlExportOptions {
    outputPath: string;
    includeResourceLinks?: boolean;
    includeSystemMessages?: boolean;
    encoding?: string;
}
/**
 * 聊天信息接口
 */
interface ChatInfo {
    name: string;
    type: 'private' | 'group';
    avatar?: string;
}
/**
 * 现代化HTML导出器
 */
export declare class ModernHtmlExporter {
    private readonly options;
    constructor(options: HtmlExportOptions);
    /**
     * 导出聊天记录为HTML（保持原签名，内部走流式）
     */
    export(messages: CleanMessage[], chatInfo: ChatInfo): Promise<void>;
    /**
     * 从 Iterable/AsyncIterable 流式导出，最低内存占用
     */
    exportFromIterable(messages: Iterable<CleanMessage> | AsyncIterable<CleanMessage>, chatInfo: ChatInfo): Promise<string[]>;
    private writeChunk;
    private toAsyncIterable;
    private safeToDate;
    private iterResources;
    /**
     * 更新HTML文件中的元数据注释
     */
    private updateMetadata;
    private copyResourceFileStream;
    private normalizeTypeDir;
    private fileExists;
    private generateStyles;
    private generateScripts;
    /**
     * 生成Toolbar（底部胶囊）
     */
    private generateToolbar;
    /**
     * Hero Section（左对齐，Apple风格）
     */
    private generateHeader;
    /**
     * 渲染单条消息（Apple风格带气泡角）
     */
    private renderMessage;
    private isSystemMessage;
    /**
     * 解析消息内容（按元素渲染）
     */
    private parseMessageContent;
    private renderTextElement;
    private renderImageElement;
    private renderAudioElement;
    private renderVideoElement;
    private renderFileElement;
    private renderFaceElement;
    private renderMarketFaceElement;
    private renderReplyElement;
    private renderJsonElement;
    private renderForwardElement;
    private renderSystemElement;
    private renderLocationElement;
    private generateFooter;
    private getDisplayName;
    private formatTime;
    private escapeHtml;
    private resolveResourcePath;
    private isValidResourcePath;
    private generateAvatarHtml;
}
export {};
//# sourceMappingURL=ModernHtmlExporter.d.ts.map