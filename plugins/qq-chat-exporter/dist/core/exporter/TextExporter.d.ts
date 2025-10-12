/**
 * 纯文本格式导出器
 * 将聊天记录导出为易于阅读的纯文本格式
 * 支持多种文本布局和格式化选项
 */
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { RawMessage } from 'NapCatQQ/src/core/index.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
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
export declare class TextExporter extends BaseExporter {
    private readonly textOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param textOptions 文本格式选项
     */
    constructor(options: ExportOptions, textOptions?: Partial<TextFormatOptions>, core?: NapCatCore);
    /**
     * 实现导出方法
     */
    protected generateContent(messages: RawMessage[], chatInfo?: {
        name?: string;
        type?: string;
        avatar?: string;
        participantCount?: number;
    }): Promise<string>;
    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    private useFallbackParser;
    /**
     * 生成文件头部信息
     */
    private generateHeader;
    /**
     * 生成文件尾部信息
     */
    private generateFooter;
    /**
     * 格式化单条消息
     */
    private formatMessage;
    /**
     * 换行处理
     */
    private wrapLine;
    /**
     * 计算消息的实际时间范围
     * 遍历所有消息，找到真正的最早和最晚时间
     */
    private calculateTimeRange;
    /**
     * 获取聊天类型显示名称
     */
    private getChatTypeDisplayName;
}
export {};
//# sourceMappingURL=TextExporter.d.ts.map