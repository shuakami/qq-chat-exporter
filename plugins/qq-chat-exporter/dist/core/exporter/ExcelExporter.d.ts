/**
 * Excel格式导出器
 * 将聊天记录导出为Excel格式 (.xlsx)
 * 便于数据分析和统计
 */
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * Excel格式选项接口
 */
interface ExcelFormatOptions {
    /** 工作表名称 */
    sheetName: string;
    /** 是否包含统计表 */
    includeStatistics: boolean;
    /** 是否包含发送者统计表 */
    includeSenderStats: boolean;
    /** 是否包含资源统计表 */
    includeResourceStats: boolean;
    /** 列宽度设置 */
    columnWidths: {
        timestamp?: number;
        sender?: number;
        content?: number;
        type?: number;
    };
}
/**
 * Excel格式导出器类
 * 生成包含多个工作表的Excel文件
 */
export declare class ExcelExporter extends BaseExporter {
    private readonly excelOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param excelOptions Excel格式选项
     */
    constructor(options: ExportOptions, excelOptions?: Partial<ExcelFormatOptions>, core?: NapCatCore);
    /**
     * 生成Excel内容
     */
    protected generateContent(messages: any[], chatInfo: {
        name: string;
        type: string;
        avatar?: string;
        participantCount?: number;
    }): Promise<string>;
    /**
     * 添加聊天记录工作表
     */
    private addMessagesSheet;
    /**
     * 添加统计信息工作表
     */
    private addStatisticsSheet;
    /**
     * 添加发送者统计工作表
     */
    private addSenderStatsSheet;
    /**
     * 添加资源统计工作表
     */
    private addResourceStatsSheet;
    /**
     * 提取消息的文本内容
     */
    private extractTextContent;
    /**
     * 获取消息类型标签
     */
    private getMessageTypeLabel;
    /**
     * 使用双重解析策略解析消息
     */
    private parseWithDualStrategy;
    /**
     * 使用SimpleMessageParser作为fallback解析器
     */
    private useFallbackParser;
    /**
     * 将ParsedMessage数组转换为CleanMessage数组
     */
    private convertParsedMessagesToCleanMessages;
    /**
     * 将ParsedMessageContent转换为MessageElementData数组
     */
    private convertContentToElements;
    /**
     * 将NTMsgType转换为字符串类型
     */
    private getMessageTypeFromNTMsgType;
    /**
     * 写入文件（重写以支持Excel二进制写入）
     */
    protected writeToFile(content: string): Promise<void>;
}
export {};
//# sourceMappingURL=ExcelExporter.d.ts.map