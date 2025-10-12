/**
 * JSON格式导出器
 * 将聊天记录导出为结构化的JSON格式
 * 便于程序化处理和数据分析
 */
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
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
 * JSON格式导出器类
 * 生成结构化、易于解析的JSON格式聊天记录
 */
export declare class JsonExporter extends BaseExporter {
    private readonly jsonOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param jsonOptions JSON格式选项
     */
    constructor(options: ExportOptions, jsonOptions?: Partial<JsonFormatOptions>, core?: NapCatCore);
    /**
     * 生成JSON内容 - 使用与TXT导出器相同的双重解析机制
     */
    protected generateContent(messages: any[], chatInfo: {
        name: string;
        type: string;
        avatar?: string;
        participantCount?: number;
    }): Promise<string>;
    /**
     * 使用双重解析策略解析消息（与TXT导出器相同的机制）
     * 首先尝试使用MessageParser，失败时fallback到SimpleMessageParser
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
     * 生成元数据
     */
    private generateMetadata;
    /**
     * 格式化聊天信息
     */
    private formatChatInfo;
    /**
     * 生成统计信息 - 从原始消息中提取
     */
    private generateStatistics;
    /**
     * 生成导出选项记录
     */
    private generateExportOptions;
    /**
     * 生成分块输出
     */
    private generateChunkedOutput;
    /**
     * 序列化JSON
     */
    private serializeJson;
    /**
     * 写入文件（重写以支持分块写入）
     */
    protected writeToFile(content: string): Promise<void>;
    /**
     * 分块写入文件
     */
    private writeFileInChunks;
    /**
     * 验证JSON格式
     */
    validateOutput(): Promise<boolean>;
    /**
     * 获取JSON模式定义
     */
    static getJsonSchema(): any;
}
export {};
//# sourceMappingURL=JsonExporter.d.ts.map