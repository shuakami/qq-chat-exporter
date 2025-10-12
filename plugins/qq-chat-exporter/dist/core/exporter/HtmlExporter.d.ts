/**
 * HTML格式导出器
 * 将聊天记录导出为美观的HTML网页格式
 * 支持自定义主题、响应式设计和交互功能
 */
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { RawMessage, NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * HTML主题选项
 */
interface HtmlTheme {
    /** 主题名称 */
    name: string;
    /** 主色调 */
    primaryColor: string;
    /** 次要色调 */
    secondaryColor: string;
    /** 背景色 */
    backgroundColor: string;
    /** 文字颜色 */
    textColor: string;
    /** 消息气泡颜色 */
    bubbleColor: string;
    /** 字体家族 */
    fontFamily: string;
}
/**
 * HTML格式选项接口
 */
interface HtmlFormatOptions {
    /** 页面标题 */
    pageTitle?: string;
    /** 主题设置 */
    theme: HtmlTheme;
    /** 是否包含CSS样式 */
    includeCss: boolean;
    /** 是否包含JavaScript */
    includeJs: boolean;
    /** 是否启用响应式设计 */
    responsive: boolean;
    /** 是否显示时间戳 */
    showTimestamps: boolean;
    /** 是否显示头像 */
    showAvatars: boolean;
    /** 是否启用搜索功能 */
    enableSearch: boolean;
    /** 是否启用消息统计 */
    showStatistics: boolean;
    /** 图片懒加载 */
    lazyLoadImages: boolean;
    /** 自定义CSS */
    customCss?: string;
    /** 自定义JavaScript */
    customJs?: string;
}
/**
 * 预定义主题
 */
declare const PREDEFINED_THEMES: Record<string, HtmlTheme>;
/**
 * HTML格式导出器类
 * 生成美观、功能丰富的HTML聊天记录页面
 */
export declare class HtmlExporter extends BaseExporter {
    private readonly htmlOptions;
    /**
     * 构造函数
     * @param options 基础导出选项
     * @param htmlOptions HTML格式选项
     */
    constructor(options: ExportOptions, htmlOptions?: Partial<HtmlFormatOptions>, core?: NapCatCore);
    /**
     * 生成HTML内容的核心逻辑
     * @override
     */
    protected generateContent(messages: RawMessage[], chatInfo?: any): Promise<string>;
    /**
     * 生成HTML头部
     */
    private generateHtmlHead;
    /**
     * 生成CSS样式
     */
    private generateCss;
    /**
     * 生成页面头部
     */
    private generateHeader;
    /**
     * 生成统计信息
     */
    private generateStatistics;
    /**
     * 生成搜索栏
     */
    private generateSearchBar;
    /**
     * 生成消息HTML
     */
    private generateMessagesHtml;
    /**
     * 生成单条消息HTML
     */
    private generateMessageHtml;
    /**
     * 生成回复HTML
     */
    private generateReplyHtml;
    /**
     * 生成资源HTML
     */
    private generateResourcesHtml;
    /**
     * 处理消息文本（链接、提及等）
     */
    private processMessageText;
    /**
     * 生成头像占位符
     */
    private generateAvatarPlaceholder;
    /**
     * 生成页脚
     */
    private generateFooter;
    /**
     * 生成JavaScript
     */
    private generateJavaScript;
    /**
     * 计算消息统计
     */
    private calculateMessageStats;
    /**
     * 获取时间范围
     */
    private getTimeRange;
    /**
     * 获取聊天类型图标
     */
    private getChatTypeIcon;
    /**
     * 获取聊天类型显示名称
     */
    private getChatTypeDisplayName;
    /**
     * 设置主题
     */
    setTheme(themeName: keyof typeof PREDEFINED_THEMES): void;
    /**
     * 获取可用主题
     */
    static getAvailableThemes(): Record<string, HtmlTheme>;
    /**
     * 判断是否为系统消息
     */
    private isSystemMessage;
}
export {};
//# sourceMappingURL=HtmlExporter.d.ts.map