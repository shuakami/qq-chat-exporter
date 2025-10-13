/**
 * 基础导出器
 * 定义导出器的通用接口和基础功能
 * 所有具体格式的导出器都应继承此基类
 */
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { ExportFormat, ExportResult, SystemError } from '../../types/index.js';
import { MessageParser } from '../parser/MessageParser.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * 导出选项接口
 */
export interface ExportOptions {
    /** 输出文件路径 */
    outputPath: string;
    /** 是否包含资源链接 */
    includeResourceLinks: boolean;
    /** 是否包含系统消息 */
    includeSystemMessages: boolean;
    /** 是否过滤掉纯图片消息 */
    filterPureImageMessages: boolean;
    /** 时间格式 */
    timeFormat: string;
    /** 是否美化输出（适用于JSON等格式） */
    prettyFormat: boolean;
    /** 自定义CSS样式（适用于HTML格式） */
    customCss?: string;
    /** 编码格式 */
    encoding: string;
    /** 分块大小（大文件分块输出） */
    chunkSize?: number;
}
/**
 * 导出进度回调函数类型
 */
export type ProgressCallback = (progress: {
    current: number;
    total: number;
    percentage: number;
    message: string;
}) => void;
/**
 * 基础导出器抽象类
 * 提供导出功能的通用框架和工具方法
 */
export declare abstract class BaseExporter {
    protected readonly format: ExportFormat;
    protected readonly options: ExportOptions;
    protected readonly core?: NapCatCore;
    protected cancelled: boolean;
    protected progressCallback: ProgressCallback | null;
    /**
     * 构造函数
     * @param format 导出格式
     * @param options 导出选项
     * @param core NapCatCore实例（可选）
     */
    constructor(format: ExportFormat, options: ExportOptions, core?: NapCatCore);
    /**
     * 设置进度回调
     */
    setProgressCallback(callback: ProgressCallback | null): void;
    /**
     * 取消导出
     */
    cancel(): void;
    /**
     * 导出公共方法
     * @param messages 原始消息数组
     * @param chatInfo 聊天信息
     * @returns 导出结果
     */
    export(messages: RawMessage[], chatInfo?: any): Promise<ExportResult>;
    /**
     * 生成内容的抽象方法
     * 各子类必须实现此方法
     */
    protected abstract generateContent(messages: RawMessage[], chatInfo?: any): Promise<string>;
    /**
     * 检查输出目录是否存在，不存在则创建
     */
    protected ensureOutputDirectory(): void;
    /**
     * 获取消息解析器实例
     */
    protected getMessageParser(core: NapCatCore): MessageParser;
    /**
     * 写入文件
     */
    protected writeToFile(content: string): Promise<void>;
    /**
     * 获取文件大小
     */
    protected getFileSize(): number;
    /**
     * 更新进度
     */
    protected updateProgress(current: number, total: number, message: string): void;
    /**
     * HTML转义
     */
    protected escapeHtml(text: string): string;
    /**
     * 格式化时间戳
     */
    protected formatTimestamp(timestamp: Date): string;
    /**
     * 获取相对时间
     */
    private getRelativeTime;
    /**
     * 包装错误
     */
    protected wrapError(error: any, operation: string): SystemError;
    /**
     * 应用纯图片消息过滤
     * 如果启用了过滤选项，会过滤掉只包含图片、表情等非文字元素的消息
     */
    protected applyPureImageFilter(messages: RawMessage[]): Promise<RawMessage[]>;
    /**
     * 按时间戳排序消息
     * 确保消息按发送时间从早到晚的顺序排列
     *
     * @param messages 原始消息数组
     * @returns 按时间排序后的消息数组
     */
    protected sortMessagesByTimestamp(messages: RawMessage[]): RawMessage[];
}
//# sourceMappingURL=BaseExporter.d.ts.map