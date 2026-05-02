/**
 * HTML格式导出器
 * 将聊天记录导出为美观的HTML网页格式
 * 支持自定义主题、响应式设计和交互功能
 */

import { ExportFormat } from '../../types/index.js';
import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { ParsedMessage } from '../parser/MessageParser.js';
import { RawMessage, NapCatCore } from 'NapCatQQ/src/core/index.js';
import { NTMsgType, ElementType } from 'NapCatQQ/src/core/index.js';

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
const PREDEFINED_THEMES: Record<string, HtmlTheme> = {
    default: {
        name: '默认主题',
        primaryColor: '#1890ff',
        secondaryColor: '#f0f2f5',
        backgroundColor: '#ffffff',
        textColor: '#262626',
        bubbleColor: '#e6f7ff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    },
    dark: {
        name: '暗黑主题',
        primaryColor: '#177ddc',
        secondaryColor: '#2f2f2f',
        backgroundColor: '#1f1f1f',
        textColor: '#ffffff',
        bubbleColor: '#3a3a3a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    },
    minimal: {
        name: '简约主题',
        primaryColor: '#52c41a',
        secondaryColor: '#fafafa',
        backgroundColor: '#ffffff',
        textColor: '#595959',
        bubbleColor: '#f6ffed',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
    },
    wechat: {
        name: '微信风格',
        primaryColor: '#07c160',
        secondaryColor: '#ededed',
        backgroundColor: '#f5f5f5',
        textColor: '#333333',
        bubbleColor: '#95ec69',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    }
};

/**
 * HTML格式导出器类
 * 生成美观、功能丰富的HTML聊天记录页面
 */
export class HtmlExporter extends BaseExporter {
    private readonly htmlOptions: HtmlFormatOptions;

    /**
     * 构造函数
     * @param options 基础导出选项
     * @param htmlOptions HTML格式选项
     */
    constructor(options: ExportOptions, htmlOptions: Partial<HtmlFormatOptions> = {}, core?: NapCatCore) {
        super(ExportFormat.HTML, options, core);
        
        this.htmlOptions = {
            theme: PREDEFINED_THEMES['default']!,
            includeCss: true,
            includeJs: true,
            responsive: true,
            showTimestamps: true,
            showAvatars: true,
            enableSearch: false,
            showStatistics: true,
            lazyLoadImages: true,
            ...htmlOptions
        };
    }

    /**
     * 生成HTML内容的核心逻辑
     * @override
     */
    protected async generateContent(
        messages: RawMessage[], 
        chatInfo?: any
    ): Promise<string> {
        // Parse raw messages into parsed messages
        if (!this.core) {
            throw new Error('NapCatCore实例不可用，无法解析消息');
        }
        
        const parser = this.getMessageParser(this.core);
        const parsedMessages = await parser.parseMessages(messages);

        const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${this.generateHtmlHead(chatInfo)}
</head>
<body>
    <div class="chat-container">
        ${this.generateHeader(chatInfo, parsedMessages)}
        ${this.htmlOptions.showStatistics ? this.generateStatistics(parsedMessages) : ''}
        ${this.htmlOptions.enableSearch ? this.generateSearchBar() : ''}
        <div class="messages-container" id="messagesContainer">
            ${await this.generateMessagesHtml(parsedMessages)}
        </div>
        ${this.generateFooter()}
    </div>
    ${this.htmlOptions.includeJs ? this.generateJavaScript() : ''}
</body>
</html>`;

        return html.trim();
    }

    /**
     * 生成HTML头部
     */
    private generateHtmlHead(chatInfo: { name: string; type: string; avatar?: string; participantCount?: number }): string {
        const title = this.htmlOptions.pageTitle || `${chatInfo.name} - 聊天记录`;
        
        return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${chatInfo.name}的聊天记录导出文件">
    <meta name="generator" content="QQ聊天记录导出工具">
    <title>${this.escapeHtml(title)}</title>
    ${this.htmlOptions.includeCss ? `<style>${this.generateCss()}</style>` : ''}
    ${this.htmlOptions.customCss ? `<style>${this.htmlOptions.customCss}</style>` : ''}
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><text y='20' font-size='20'>💬</text></svg>">`;
    }

    /**
     * 生成CSS样式
     */
    private generateCss(): string {
        const theme = this.htmlOptions.theme;
        
        return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: ${theme.fontFamily};
            background-color: ${theme.backgroundColor};
            color: ${theme.textColor};
            line-height: 1.6;
            ${this.htmlOptions.responsive ? `
            font-size: 14px;
            @media (max-width: 768px) {
                font-size: 12px;
            }` : ''}
        }

        .chat-container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            ${this.htmlOptions.responsive ? `
            @media (max-width: 768px) {
                padding: 10px;
            }` : ''}
        }

        .chat-header {
            text-align: center;
            padding: 30px 0;
            border-bottom: 2px solid ${theme.secondaryColor};
            margin-bottom: 30px;
        }

        .chat-title {
            font-size: 2.5em;
            font-weight: bold;
            color: ${theme.primaryColor};
            margin-bottom: 10px;
        }

        .chat-info {
            font-size: 1.1em;
            color: ${theme.textColor};
            opacity: 0.8;
        }

        .chat-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            margin: 0 auto 20px;
            background: ${theme.secondaryColor};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2em;
        }

        .statistics {
            background: ${theme.secondaryColor};
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .stat-item {
            text-align: center;
        }

        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: ${theme.primaryColor};
        }

        .stat-label {
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 5px;
        }

        .search-bar {
            margin-bottom: 20px;
        }

        .search-input {
            width: 100%;
            padding: 12px 20px;
            border: 2px solid ${theme.secondaryColor};
            border-radius: 25px;
            font-size: 1em;
            background: ${theme.backgroundColor};
            color: ${theme.textColor};
            transition: border-color 0.3s;
        }

        .search-input:focus {
            outline: none;
            border-color: ${theme.primaryColor};
        }

        .messages-container {
            margin-bottom: 50px;
        }

        .message {
            margin-bottom: 20px;
            padding: 15px;
            border-radius: 12px;
            background: ${theme.bubbleColor};
            position: relative;
            word-wrap: break-word;
            ${this.htmlOptions.responsive ? `
            @media (max-width: 768px) {
                padding: 12px;
                margin-bottom: 15px;
            }` : ''}
        }

        .message.system {
            text-align: center;
            background: ${theme.secondaryColor};
            font-style: italic;
            opacity: 0.8;
        }

        .message-header {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            gap: 10px;
        }

        .message-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: ${theme.primaryColor};
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 0.8em;
        }

        .message-sender {
            font-weight: bold;
            color: ${theme.primaryColor};
            flex-grow: 1;
        }

        /* 群头衔徽章（issue #331） */
        .message-sender-title {
            display: inline-block;
            font-size: 0.75em;
            font-weight: 600;
            line-height: 1.4;
            color: #fff;
            background: linear-gradient(135deg, #ff7a59, #ff4d4f);
            padding: 1px 6px;
            border-radius: 4px;
            margin-right: 6px;
            white-space: nowrap;
            vertical-align: middle;
        }

        .message-time {
            font-size: 0.85em;
            opacity: 0.6;
            ${this.htmlOptions.responsive ? `
            @media (max-width: 768px) {
                display: none;
            }` : ''}
        }

        .message-content {
            margin-left: ${this.htmlOptions.showAvatars ? '46px' : '0'};
            ${this.htmlOptions.responsive ? `
            @media (max-width: 768px) {
                margin-left: 0;
            }` : ''}
        }

        .reply-content {
            background: ${theme.secondaryColor};
            padding: 8px 12px;
            border-radius: 8px;
            margin-bottom: 8px;
            border-left: 3px solid ${theme.primaryColor};
            font-size: 0.9em;
            opacity: 0.8;
        }

        .mention {
            color: ${theme.primaryColor};
            font-weight: bold;
            text-decoration: none;
        }

        .mention:hover {
            text-decoration: underline;
        }

        .emoji {
            font-size: 1.2em;
        }

        .message-image, .message-video {
            max-width: 100%;
            max-height: 400px;
            border-radius: 8px;
            margin: 8px 0;
            cursor: pointer;
            transition: transform 0.2s;
        }

        .message-image:hover, .message-video:hover {
            transform: scale(1.02);
        }

        .message-audio {
            width: 100%;
            margin: 8px 0;
        }

        .message-file {
            display: inline-flex;
            align-items: center;
            padding: 8px 12px;
            background: ${theme.secondaryColor};
            border-radius: 8px;
            text-decoration: none;
            color: ${theme.textColor};
            margin: 8px 0;
            transition: background-color 0.2s;
        }

        .message-file:hover {
            background: ${theme.primaryColor};
            color: white;
        }

        .resource-placeholder {
            display: inline-block;
            padding: 4px 8px;
            background: ${theme.secondaryColor};
            border-radius: 4px;
            font-size: 0.9em;
            opacity: 0.8;
        }

        .resources-list {
            margin-top: 8px;
            padding: 8px;
            background: ${theme.secondaryColor};
            border-radius: 6px;
            font-size: 0.9em;
        }

        .resource-item {
            margin: 4px 0;
            padding: 4px 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
        }

        .resource-item:last-child {
            border-bottom: none;
        }

        .chat-footer {
            text-align: center;
            padding: 30px 0;
            border-top: 2px solid ${theme.secondaryColor};
            font-size: 0.9em;
            opacity: 0.6;
        }

        .loading {
            text-align: center;
            padding: 20px;
            opacity: 0.6;
        }

        /* 响应式设计 */
        ${this.htmlOptions.responsive ? `
        @media (max-width: 768px) {
            .chat-title {
                font-size: 1.8em;
            }
            
            .statistics {
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                padding: 15px;
            }
            
            .stat-number {
                font-size: 1.5em;
            }
            
            .message-header {
                flex-wrap: wrap;
            }
            
            .message-time {
                width: 100%;
                margin-top: 5px;
                margin-left: 46px;
            }
        }` : ''}

        /* 打印样式 */
        @media print {
            .search-bar, .chat-footer {
                display: none;
            }
            
            .message {
                break-inside: avoid;
                margin-bottom: 10px;
            }
            
            .message-image, .message-video {
                max-height: 200px;
            }
        }

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {
            ${theme.name === '默认主题' ? `
            body {
                background-color: #1f1f1f;
                color: #ffffff;
            }
            
            .message {
                background: #3a3a3a;
            }
            
            .statistics {
                background: #2f2f2f;
            }` : ''}
        }

        /* 动画效果 */
        .message {
            animation: fadeIn 0.3s ease-in;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* 滚动条样式 */
        ::-webkit-scrollbar {
            width: 8px;
        }

        ::-webkit-scrollbar-track {
            background: ${theme.secondaryColor};
        }

        ::-webkit-scrollbar-thumb {
            background: ${theme.primaryColor};
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: ${theme.primaryColor}CC;
        }
        `;
    }

    /**
     * 生成页面头部
     */
    private generateHeader(
        chatInfo: { name: string; type: string; avatar?: string; participantCount?: number },
        messages: ParsedMessage[]
    ): string {
        const timeRange = this.getTimeRange(messages);
        
        return `
        <div class="chat-header">
            ${chatInfo.avatar ? `
            <div class="chat-avatar">
                <img src="${chatInfo.avatar}" alt="头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
            </div>` : `
            <div class="chat-avatar">
                ${this.getChatTypeIcon(chatInfo.type)}
            </div>`}
            <h1 class="chat-title">${this.escapeHtml(chatInfo.name)}</h1>
            <div class="chat-info">
                <div>${this.getChatTypeDisplayName(chatInfo.type)}</div>
                ${chatInfo.participantCount ? `<div>参与人数: ${chatInfo.participantCount}</div>` : ''}
                <div>导出时间: ${this.formatTimestamp(new Date())}</div>
                ${timeRange ? `<div>时间范围: ${timeRange}</div>` : ''}
            </div>
        </div>`;
    }

    /**
     * 生成统计信息
     */
    private generateStatistics(messages: ParsedMessage[]): string {
        const stats = this.calculateMessageStats(messages);
        
        return `
        <div class="statistics">
            <div class="stat-item">
                <div class="stat-number">${stats.totalMessages}</div>
                <div class="stat-label">总消息数</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.uniqueSenders}</div>
                <div class="stat-label">参与者</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.totalResources}</div>
                <div class="stat-label">资源文件</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${stats.durationDays}</div>
                <div class="stat-label">时间跨度(天)</div>
            </div>
        </div>`;
    }

    /**
     * 生成搜索栏
     */
    private generateSearchBar(): string {
        return `
        <div class="search-bar">
            <input type="text" class="search-input" placeholder="搜索消息内容..." id="searchInput">
        </div>`;
    }

    /**
     * 生成消息HTML
     */
    private async generateMessagesHtml(messages: ParsedMessage[]): Promise<string> {
        const messageElements: string[] = [];

        for (let i = 0; i < messages.length; i++) {
            if (this.cancelled) break;

            const message = messages[i];
            if (message) {
                const messageHtml = this.generateMessageHtml(message);
                messageElements.push(messageHtml);
            }

            // 更新进度
            if (i % 50 === 0) {
                this.updateProgress(
                    messages.length * 0.7 + i * 0.25, 
                    messages.length, 
                    `生成HTML ${i + 1}/${messages.length}`
                );
            }
        }

        return messageElements.join('\n');
    }

    /**
     * 生成单条消息HTML
     */
    private generateMessageHtml(message: ParsedMessage): string {
        const isSystemMessage = this.isSystemMessage(message.rawMessage);
        const messageClass = isSystemMessage ? 'message system' : 'message';
        
        if (isSystemMessage) {
            return `
            <div class="${messageClass}" data-message-id="${message.messageId}">
                <div class="message-content">
                    ${this.processMessageText(message.content.text)}
                </div>
            </div>`;
        }

        return `
        <div class="${messageClass}" data-message-id="${message.messageId}">
            <div class="message-header">
                ${this.htmlOptions.showAvatars ? `
                <div class="message-avatar">
                    ${message.sender.avatar ? 
                        `<img src="${message.sender.avatar}" alt="头像" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` :
                        this.generateAvatarPlaceholder(message.sender.name || message.sender.uid)
                    }
                </div>` : ''}
                ${(message.sender as { title?: string }).title ? `<span class="message-sender-title">${this.escapeHtml((message.sender as { title?: string }).title!)}</span>` : ''}<span class="message-sender">${this.escapeHtml(message.sender.name || message.sender.uid)}</span>
                ${this.htmlOptions.showTimestamps ? `
                <span class="message-time">${this.formatTimestamp(message.timestamp)}</span>` : ''}
            </div>
            <div class="message-content">
                ${message.content.reply ? this.generateReplyHtml(message.content.reply) : ''}
                ${message.content.text ? this.processMessageText(message.content.text) : ''}
                ${message.content.resources.length > 0 ? this.generateResourcesHtml(message.content.resources) : ''}
            </div>
        </div>`;
    }

    /**
     * 生成回复HTML
     */
    private generateReplyHtml(reply: { messageId: string; senderName?: string; content: string }): string {
        return `
        <div class="reply-content">
            <strong>${this.escapeHtml(reply.senderName || '用户')}:</strong>
            ${this.escapeHtml(reply.content)}
        </div>`;
    }

    /**
     * 生成资源HTML
     */
    private generateResourcesHtml(resources: any[]): string {
        const resourceElements = resources.map(resource => {
            // 优先使用本地路径（相对路径），回退到原始URL
            const resourceUrl = resource.localPath || resource.originalUrl;
            
            switch (resource.type) {
                case 'image':
                    if (this.options.includeResourceLinks && resourceUrl) {
                        const lazyLoad = this.htmlOptions.lazyLoadImages ? 'loading="lazy"' : '';
                        return `<img src="${resourceUrl}" alt="${resource.fileName || resource.filename || 'image'}" class="message-image" ${lazyLoad}>`;
                    }
                    return `<span class="resource-placeholder">[图片: ${resource.fileName || resource.filename || 'unknown'}]</span>`;

                case 'video':
                    if (this.options.includeResourceLinks && resourceUrl) {
                        return `<video src="${resourceUrl}" controls class="message-video" preload="metadata">[视频: ${resource.fileName || resource.filename || 'video'}]</video>`;
                    }
                    return `<span class="resource-placeholder">[视频: ${resource.fileName || resource.filename || 'unknown'}]</span>`;

                case 'audio':
                    if (this.options.includeResourceLinks && resourceUrl) {
                        return `<audio src="${resourceUrl}" controls class="message-audio" preload="metadata">[语音: ${resource.fileName || resource.filename || 'audio'}]</audio>`;
                    }
                    return `<span class="resource-placeholder">[语音: ${resource.fileName || resource.filename || 'unknown'}]</span>`;

                case 'file':
                    if (this.options.includeResourceLinks && resourceUrl) {
                        return `<a href="${resourceUrl}" class="message-file" download="${resource.fileName || resource.filename || 'file'}">📎 ${resource.fileName || resource.filename || 'file'}</a>`;
                    }
                    return `<span class="resource-placeholder">[文件: ${resource.fileName || resource.filename || 'unknown'}]</span>`;

                default:
                    return `<span class="resource-placeholder">[${resource.type}: ${resource.fileName || resource.filename || 'unknown'}]</span>`;
            }
        });

        return resourceElements.join('<br>');
    }

    /**
     * 处理消息文本（链接、提及等）
     */
    private processMessageText(text: string): string {
        let processedText = this.escapeHtml(text);

        // 处理URL链接
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        processedText = processedText.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

        // 处理换行
        processedText = processedText.replace(/\n/g, '<br>');

        return processedText;
    }

    /**
     * 生成头像占位符
     */
    private generateAvatarPlaceholder(name: string): string {
        // 使用名字的首字符作为头像
        const firstChar = name.charAt(0).toUpperCase();
        return firstChar;
    }

    /**
     * 生成页脚
     */
    private generateFooter(): string {
        return `
        <div class="chat-footer">
            <p>由 <strong>QQ聊天记录导出工具</strong> 生成</p>
            <p>导出时间: ${this.formatTimestamp(new Date())}</p>
        </div>`;
    }

    /**
     * 生成JavaScript
     */
    private generateJavaScript(): string {
        return `
        <script>
        (function() {
            // 搜索功能
            ${this.htmlOptions.enableSearch ? `
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                let searchTimeout;
                searchInput.addEventListener('input', function() {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        const searchTerm = this.value.toLowerCase();
                        const messages = document.querySelectorAll('.message');
                        
                        messages.forEach(message => {
                            const content = message.textContent.toLowerCase();
                            if (searchTerm === '' || content.includes(searchTerm)) {
                                message.style.display = '';
                            } else {
                                message.style.display = 'none';
                            }
                        });
                    }, 300);
                });
            }` : ''}

            // 图片点击放大
            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('message-image')) {
                    const img = e.target;
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; cursor: pointer;';
                    
                    const enlargedImg = img.cloneNode();
                    enlargedImg.style.cssText = 'max-width: 90%; max-height: 90%; object-fit: contain;';
                    
                    overlay.appendChild(enlargedImg);
                    document.body.appendChild(overlay);
                    
                    overlay.addEventListener('click', () => {
                        document.body.removeChild(overlay);
                    });
                }
            });

            // 懒加载实现
            ${this.htmlOptions.lazyLoadImages ? `
            if ('IntersectionObserver' in window) {
                const imageObserver = new IntersectionObserver((entries, observer) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            if (img.dataset.src) {
                                img.src = img.dataset.src;
                                img.removeAttribute('data-src');
                                observer.unobserve(img);
                            }
                        }
                    });
                });

                document.querySelectorAll('img[data-src]').forEach(img => {
                    imageObserver.observe(img);
                });
            }` : ''}

            // 平滑滚动到锚点
            document.addEventListener('click', function(e) {
                if (e.target.tagName === 'A' && e.target.hash) {
                    e.preventDefault();
                    const target = document.querySelector(e.target.hash);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            });

            // 自定义JavaScript
            ${this.htmlOptions.customJs || ''}

            console.log('QQ聊天记录导出工具 - HTML页面已加载完成');
        })();
        </script>`;
    }

    /**
     * 计算消息统计
     */
    private calculateMessageStats(messages: ParsedMessage[]): {
        totalMessages: number;
        uniqueSenders: number;
        totalResources: number;
        durationDays: number;
    } {
        const senders = new Set(messages.map(m => m.sender.uid));
        const totalResources = messages.reduce((count, m) => count + m.content.resources.length, 0);
        
        let durationDays = 0;
        if (messages.length > 0) {
            // 找到实际的最早和最晚消息时间
            let earliestTime = messages[0]?.timestamp.getTime() ?? 0;
            let latestTime = messages[0]?.timestamp.getTime() ?? 0;
            
            messages.forEach(msg => {
                const msgTime = msg.timestamp.getTime();
                if (msgTime < earliestTime) {
                    earliestTime = msgTime;
                }
                if (msgTime > latestTime) {
                    latestTime = msgTime;
                }
            });
            
            durationDays = Math.ceil((latestTime - earliestTime) / (1000 * 60 * 60 * 24));
        }

        return {
            totalMessages: messages.length,
            uniqueSenders: senders.size,
            totalResources,
            durationDays
        };
    }

    /**
     * 获取时间范围
     */
    private getTimeRange(messages: ParsedMessage[]): string | null {
        if (messages.length === 0) return null;
        
        // 找到实际的最早和最晚消息
        let earliestTime = messages[0]?.timestamp;
        let latestTime = messages[0]?.timestamp;
        
        messages.forEach(msg => {
            if (earliestTime && msg.timestamp < earliestTime) {
                earliestTime = msg.timestamp;
            }
            if (latestTime && msg.timestamp > latestTime) {
                latestTime = msg.timestamp;
            }
        });
        
        if (!earliestTime || !latestTime) {
            return null;
        }
        
        return `${this.formatTimestamp(earliestTime)} 至 ${this.formatTimestamp(latestTime)}`;
    }

    /**
     * 获取聊天类型图标
     */
    private getChatTypeIcon(type: string): string {
        switch (type) {
            case 'group':
                return '👥';
            case 'private':
                return '💬';
            case 'temp':
                return '⏰';
            default:
                return '💭';
        }
    }

    /**
     * 获取聊天类型显示名称
     */
    private getChatTypeDisplayName(type: string): string {
        switch (type) {
            case 'group':
                return '群聊';
            case 'private':
                return '私聊';
            case 'temp':
                return '临时聊天';
            default:
                return type;
        }
    }

    /**
     * 设置主题
     */
    setTheme(themeName: keyof typeof PREDEFINED_THEMES): void {
        if (PREDEFINED_THEMES[themeName]) {
            this.htmlOptions.theme = PREDEFINED_THEMES[themeName]!;
        }
    }

    /**
     * 获取可用主题
     */
    static getAvailableThemes(): Record<string, HtmlTheme> {
        return { ...PREDEFINED_THEMES };
    }

    /**
     * 判断是否为系统消息
     */
    private isSystemMessage(message: RawMessage): boolean {
        return message.msgType === NTMsgType.KMSGTYPEGRAYTIPS ||
               (message.elements && message.elements.length === 1 && message.elements[0]?.elementType === ElementType.GreyTip);
    }
}