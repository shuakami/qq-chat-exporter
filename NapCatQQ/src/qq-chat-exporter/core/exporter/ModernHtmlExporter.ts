/**
 * HTML导出器
 */

import fs from 'fs';
import path from 'path';
import { CleanMessage } from '../parser/SimpleMessageParser';

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
export class ModernHtmlExporter {
    private options: HtmlExportOptions;

    constructor(options: HtmlExportOptions) {
        this.options = {
            includeResourceLinks: true,
            includeSystemMessages: true,
            encoding: 'utf-8',
            ...options
        };
    }

    /**
     * 导出聊天记录为HTML
     */
    async export(messages: CleanMessage[], chatInfo: ChatInfo): Promise<void> {
        const html = this.generateHtml(messages, chatInfo);
        
        // 确保输出目录存在
        const outputDir = path.dirname(this.options.outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 写入HTML文件
        fs.writeFileSync(this.options.outputPath, html, { encoding: this.options.encoding as BufferEncoding });
        
        // 复制资源文件到导出目录
        if (this.options.includeResourceLinks) {
            await this.copyResources(messages, outputDir);
        }
    }

    /**
     * 复制资源文件到导出目录
     */
    private async copyResources(messages: CleanMessage[], outputDir: string): Promise<void> {
        console.log(`[ModernHtmlExporter] 开始复制资源文件到: ${outputDir}`);
        
        const resourceTypes = ['images', 'videos', 'audios', 'files'];
        const copiedFiles = new Set<string>(); // 防止重复复制
        
        // 创建资源目录
        for (const type of resourceTypes) {
            const typeDir = path.join(outputDir, 'resources', type);
            if (!fs.existsSync(typeDir)) {
                fs.mkdirSync(typeDir, { recursive: true });
                console.log(`[ModernHtmlExporter] 创建目录: ${typeDir}`);
            }
        }
        
        // 遍历所有消息，收集需要复制的资源
        for (const message of messages) {
            // 检查 resources 数组
            if (message.content.resources && message.content.resources.length > 0) {
                for (const resource of message.content.resources) {
                    if (resource.localPath && this.isValidResourcePath(resource.localPath)) {
                        // 构造完整的资源信息对象
                        const resourceInfo = {
                            type: resource.type || 'file',
                            fileName: resource.filename || path.basename(resource.localPath),
                            localPath: resource.localPath,
                            url: resource.url
                        };
                        await this.copyResourceFile(resourceInfo, outputDir, copiedFiles);
                    }
                }
            }
            
            // 检查 elements 数组中的资源
            if (message.content.elements && message.content.elements.length > 0) {
                for (const element of message.content.elements) {
                    if (element.data && typeof element.data === 'object') {
                        const data = element.data as any;
                        if (data.localPath && this.isValidResourcePath(data.localPath)) {
                            // 构造资源信息对象
                            const resourceInfo = {
                                type: element.type,
                                fileName: data.filename || path.basename(data.localPath),
                                localPath: data.localPath,
                                url: data.url
                            };
                            await this.copyResourceFile(resourceInfo, outputDir, copiedFiles);
                        }
                    }
                }
            }
        }
        
        console.log(`[ModernHtmlExporter] 资源复制完成，共复制 ${copiedFiles.size} 个文件`);
    }
    
    /**
     * 复制单个资源文件
     */
    private async copyResourceFile(
        resource: { type: string; fileName: string; localPath: string; url?: string },
        outputDir: string,
        copiedFiles: Set<string>
    ): Promise<void> {
        try {
            const sourceAbsolutePath = this.resolveResourcePath(resource.localPath);
            
            // 检查源文件是否存在
            if (!fs.existsSync(sourceAbsolutePath)) {
                console.warn(`[ModernHtmlExporter] 源文件不存在: ${sourceAbsolutePath}`);
                return;
            }
            
            // 生成目标路径（与HTML中的相对路径保持一致）
            const typeDir = resource.type + 's'; // image -> images, video -> videos
            const targetRelativePath = `resources/${typeDir}/${resource.fileName}`;
            const targetAbsolutePath = path.join(outputDir, targetRelativePath);
            
            // 防止重复复制
            const fileKey = `${typeDir}/${resource.fileName}`;
            if (copiedFiles.has(fileKey)) {
                return;
            }
            
            // 复制文件
            fs.copyFileSync(sourceAbsolutePath, targetAbsolutePath);
            copiedFiles.add(fileKey);
            
            console.log(`[ModernHtmlExporter] 复制文件: ${sourceAbsolutePath} -> ${targetAbsolutePath}`);
            
        } catch (error) {
            console.error(`[ModernHtmlExporter] 复制资源文件失败:`, {
                resource,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * 解析资源路径为绝对路径
     */
    private resolveResourcePath(resourcePath: string): string {
        // 如果已经是绝对路径，直接返回
        if (path.isAbsolute(resourcePath)) {
            return resourcePath;
        }
        
        // 如果是相对路径，可能需要基于 qq-chat-exporter 配置目录解析
        const resourceRoot = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources');
        return path.resolve(resourceRoot, resourcePath);
    }
    
    /**
     * 检查是否是有效的资源路径
     */
    private isValidResourcePath(resourcePath: string): boolean {
        if (!resourcePath || typeof resourcePath !== 'string') {
            return false;
        }
        
        const trimmed = resourcePath.trim();
        return trimmed !== '' && 
               (trimmed.startsWith('resources/') || path.isAbsolute(trimmed));
    }

    /**
     * 生成完整HTML
     */
    private generateHtml(messages: CleanMessage[], chatInfo: ChatInfo): string {
        const timeRange = this.getTimeRange(messages);
        const stats = this.calculateStats(messages);

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QQ Chat Exporter Pro - 聊天记录</title>
    ${this.generateStyles()}
    ${this.generateScripts()}
</head>
<body>
    <div class="container">
        ${this.generateHeader(chatInfo, stats, timeRange)}
        ${this.generateChatContent(messages)}
        ${this.generateFooter()}
    </div>
    
    <!-- 图片预览模态框 -->
    <div id="imageModal" class="image-modal">
        <img id="modalImage" src="" alt="预览图片">
    </div>
</body>
</html>`;
    }

    /**
     * 生成样式
     */
    private generateStyles(): string {
        return `<style>
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: #ffffff;
            color: #1d1d1f;
            line-height: 1.47;
            font-size: 17px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            min-height: 100vh;
            background: #ffffff;
        }
        
        .header {
            padding: 44px 0 32px;
            text-align: center;
            border-bottom: 1px solid #f5f5f7;
        }
        
        .header h1 {
            font-size: 48px;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 8px;
            letter-spacing: -0.022em;
        }
        
        .header .subtitle {
            font-size: 21px;
            color: #86868b;
            font-weight: 400;
            margin-bottom: 16px;
        }
        
        .github-link {
            margin-top: 16px;
        }
        
        .github-star {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #007aff;
            color: white;
            text-decoration: none;
            padding: 12px 24px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        
        .github-star:hover {
            background: #0056d3;
            text-decoration: none;
            color: white;
            transform: translateY(-1px);
        }
        
        .export-info {
            padding: 24px 0;
            text-align: center;
            background: #fbfbfd;
        }
        
        .info-grid {
            display: flex;
            justify-content: center;
            gap: 48px;
            flex-wrap: wrap;
        }
        
        .info-item {
            text-align: center;
        }
        
        .info-label {
            font-size: 14px;
            color: #86868b;
            margin-bottom: 4px;
            font-weight: 400;
        }
        
        .info-value {
            font-size: 17px;
            color: #1d1d1f;
            font-weight: 500;
        }
        
        .chat-content {
            padding: 32px 24px;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .message {
            margin-bottom: 16px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            clear: both;
        }
        
        .message.self {
            flex-direction: row-reverse;
            justify-content: flex-start;
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #f5f5f7;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            color: #86868b;
        }
        
        .avatar img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
        }
        
        .message-bubble {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            position: relative;
        }
        
        .message.other .message-bubble {
            background: #f5f5f7;
            color: #1d1d1f;
        }
        
        .message.self .message-bubble {
            background: #007aff;
            color: #ffffff;
        }
        
        .message-header {
            margin-bottom: 8px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .sender {
            font-size: 14px;
            font-weight: 500;
            line-height: 1.2;
        }
        
        .message.other .sender {
            color: #86868b;
        }
        
        .message.self .sender {
            color: rgba(255, 255, 255, 0.8);
        }
        
        .time {
            font-size: 11px;
            opacity: 0.6;
            line-height: 1.2;
        }
        
        .content {
            font-size: 16px;
            line-height: 1.5;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        .text-content {
            display: inline;
            word-wrap: break-word;
        }
        
        .image-content {
            margin: 8px 0;
            border-radius: 12px;
            overflow: hidden;
            max-width: 300px;
        }
        
        .image-content img {
            width: 100%;
            height: auto;
            display: block;
            cursor: pointer;
        }
        
        .at-mention {
            background: rgba(0, 122, 255, 0.1);
            color: #007aff;
            padding: 2px 6px;
            border-radius: 6px;
            font-weight: 500;
            display: inline;
        }
        
        .message.self .at-mention {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }
        
        .face-emoji {
            display: inline;
            font-size: 18px;
            margin: 0 2px;
            vertical-align: baseline;
        }
        
        .reply-content {
            border-left: 3px solid #007aff;
            padding-left: 12px;
            margin: 8px 0;
            opacity: 0.8;
            font-size: 15px;
        }
        
        .message.self .reply-content {
            border-left-color: rgba(255, 255, 255, 0.6);
        }

        .json-card {
            background: rgba(0, 122, 255, 0.1);
            border: 1px solid rgba(0, 122, 255, 0.2);
            border-radius: 12px;
            padding: 12px;
            margin: 8px 0;
        }

        .json-title {
            font-weight: 600;
            color: #007aff;
            margin-bottom: 4px;
        }

        .json-description {
            font-size: 14px;
            opacity: 0.8;
            margin-bottom: 8px;
        }

        .json-url {
            font-size: 12px;
            color: #007aff;
            text-decoration: none;
        }

        .market-face {
            display: inline-block;
            width: 32px;
            height: 32px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            vertical-align: middle;
        }
        
        /* 滚动条 */
        ::-webkit-scrollbar {
            width: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #d1d1d6;
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #c7c7cc;
        }
        
        /* 图片预览 */
        .image-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            cursor: pointer;
        }
        
        .image-modal img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90vw;
            max-height: 90vh;
            object-fit: contain;
        }
        
        /* 响应式 */
        @media (max-width: 768px) {
            .header h1 {
                font-size: 32px;
            }
            
            .header .subtitle {
                font-size: 17px;
            }
            
            .info-grid {
                gap: 24px;
            }
            
            .chat-content {
                padding: 24px 16px;
            }
            
            .message-bubble {
                max-width: 85%;
            }
        }
    </style>`;
    }

    /**
     * 生成脚本
     */
    private generateScripts(): string {
        return `<script>
        function showImageModal(imgSrc) {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            const modal = document.getElementById('imageModal');
            modal.addEventListener('click', hideImageModal);
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    hideImageModal();
                }
            });
        });
    </script>`;
    }

    /**
     * 生成页头
     */
    private generateHeader(chatInfo: ChatInfo, stats: any, timeRange: string | null): string {
        const currentTime = new Date().toLocaleString('zh-CN');
        
        return `<div class="header">
            <h1>QQ Chat Exporter Pro</h1>
            <div class="subtitle">${this.escapeHtml(chatInfo.name)} - 聊天记录导出</div>
            <div class="github-link">
                <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank" class="github-star">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 13.125l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.192L.644 6.374a.75.75 0 01.416-1.28l4.21-.612L7.327.668A.75.75 0 018 .25z"></path>
                    </svg>
                    给我个 Star 吧~
                </a>
            </div>
        </div>
        <div class="export-info">
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">导出时间</div>
                    <div class="info-value">${currentTime}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">消息总数</div>
                    <div class="info-value">${stats.totalMessages}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">导出格式</div>
                    <div class="info-value">HTML</div>
                </div>
                ${timeRange ? `<div class="info-item">
                    <div class="info-label">时间范围</div>
                    <div class="info-value">${timeRange}</div>
                </div>` : ''}
            </div>
        </div>`;
    }

    /**
     * 生成聊天内容
     */
    private generateChatContent(messages: CleanMessage[]): string {
        const messagesHtml = messages.map(message => this.renderMessage(message)).join('\n');
        
        return `<div class="chat-content">
            ${messagesHtml}
        </div>`;
    }

    /**
     * 渲染单条消息
     */
    private renderMessage(message: CleanMessage): string {
        // 检查是否为系统消息
        const isSystemMessage = message.type === 'system' || 
            (message.content.elements && message.content.elements.some(el => el.type === 'system'));

        if (isSystemMessage) {
            // 系统消息使用居中样式，无头像
            const content = this.parseMessageContent(message);
            return `<div class="system-message-container" style="text-align: center; margin: 12px 0;">
                ${content}
                <div style="color: #999; font-size: 10px; margin-top: 2px;">${this.formatTime(message.time)}</div>
            </div>`;
        }

        // 普通消息的处理
        const isSelf = false; // TODO: 根据实际逻辑判断
        const cssClass = isSelf ? "self" : "other";

        // 生成头像 - 使用QQ官方头像API
        const avatarContent = this.generateAvatarHtml(message.sender.uin, message.sender.name);

        // 解析消息内容
        const content = this.parseMessageContent(message);

        return `
        <div class="message ${cssClass}">
            <div class="avatar">${avatarContent}</div>
            <div class="message-bubble">
                <div class="message-header">
                    <span class="sender">${this.escapeHtml(this.getDisplayName(message))}</span>
                    <span class="time">${this.formatTime(message.time)}</span>
                </div>
                <div class="content">${content}</div>
            </div>
        </div>`;
    }

    /**
     * 解析消息内容
     */
    private parseMessageContent(message: CleanMessage): string {
        if (!message.content.elements || message.content.elements.length === 0) {
            return `<span class="text-content">${this.escapeHtml(message.content.text || '[空消息]')}</span>`;
        }

        let result = '';
        
        for (const element of message.content.elements) {
            switch (element.type) {
                case 'text':
                    result += this.renderTextElement(element.data);
                    break;
                case 'image':
                    result += this.renderImageElement(element.data);
                    break;
                case 'audio':
                    result += this.renderAudioElement(element.data);
                    break;
                case 'video':
                    result += this.renderVideoElement(element.data);
                    break;
                case 'file':
                    result += this.renderFileElement(element.data);
                    break;
                case 'face':
                    result += this.renderFaceElement(element.data);
                    break;
                case 'market_face':
                    result += this.renderMarketFaceElement(element.data);
                    break;
                case 'reply':
                    result += this.renderReplyElement(element.data);
                    break;
                case 'json':
                    result += this.renderJsonElement(element.data);
                    break;
                case 'forward':
                    result += this.renderForwardElement(element.data);
                    break;
                case 'system':
                    result += this.renderSystemElement(element.data);
                    break;
                case 'location':
                    result += this.renderLocationElement(element.data);
                    break;
                default:
                    const rawText = element.data?.text || element.data?.summary || element.data?.content || '';
                    if (rawText) {
                        result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
                    }
            }
        }

        return result || `<span class="text-content">[空消息]</span>`;
    }

    /**
     * 渲染文本元素
     */
    private renderTextElement(data: any): string {
        const text = data.text || '';
        return `<span class="text-content">${this.escapeHtml(text)}</span>`;
    }

    /**
     * 渲染图片元素
     */
    private renderImageElement(data: any): string {
        const url = data.url || data.localPath || '';
        const filename = data.filename || '图片';
        
        if (url) {
            return `<div class="image-content"><img src="${url}" alt="${this.escapeHtml(filename)}" loading="lazy" onclick="showImageModal('${url}')"></div>`;
        }
        
        return `<span class="text-content">📷 ${this.escapeHtml(filename)}</span>`;
    }

    /**
     * 渲染音频元素
     */
    private renderAudioElement(data: any): string {
        const url = data.url || data.localPath || '';
        const duration = data.duration || 0;
        
        if (url) {
            return `<audio src="${url}" controls class="message-audio" preload="metadata">[语音:${duration}秒]</audio>`;
        }
        
        return `<span class="text-content">🎤 [语音:${duration}秒]</span>`;
    }

    /**
     * 渲染视频元素
     */
    private renderVideoElement(data: any): string {
        const url = data.url || data.localPath || '';
        const filename = data.filename || '视频';
        
        if (url) {
            return `<video src="${url}" controls class="message-video" preload="metadata">[视频: ${this.escapeHtml(filename)}]</video>`;
        }
        
        return `<span class="text-content">🎬 ${this.escapeHtml(filename)}</span>`;
    }

    /**
     * 渲染文件元素
     */
    private renderFileElement(data: any): string {
        const url = data.url || data.localPath || '';
        const filename = data.filename || '文件';
        
        if (url) {
            return `<a href="${url}" class="message-file" download="${this.escapeHtml(filename)}">📎 ${this.escapeHtml(filename)}</a>`;
        }
        
        return `<span class="text-content">📎 ${this.escapeHtml(filename)}</span>`;
    }

    /**
     * 渲染表情元素
     */
    private renderFaceElement(data: any): string {
        const name = data.name || `表情${data.id || ''}`;
        return `<span class="face-emoji">${name}</span>`;
    }

    /**
     * 渲染商城表情元素
     */
    private renderMarketFaceElement(data: any): string {
        const name = data.name || '商城表情';
        const url = data.url || '';
        
        if (url) {
            return `<img src="${url}" alt="${this.escapeHtml(name)}" class="market-face" title="${this.escapeHtml(name)}">`;
        }
        
        return `<span class="text-content">[${this.escapeHtml(name)}]</span>`;
    }

    /**
     * 渲染回复元素
     */
    private renderReplyElement(data: any): string {
        const senderName = data.senderName || '用户';
        const content = data.content || '引用消息';
        
        return `<div class="reply-content">
            <strong>${this.escapeHtml(senderName)}:</strong> ${this.escapeHtml(content)}
        </div>`;
    }

    /**
     * 渲染JSON元素
     */
    private renderJsonElement(data: any): string {
        const title = data.title || data.summary || 'JSON消息';
        const description = data.description || '';
        const url = data.url || '';
        
        return `<div class="json-card">
            <div class="json-title">${this.escapeHtml(title)}</div>
            ${description ? `<div class="json-description">${this.escapeHtml(description)}</div>` : ''}
            ${url ? `<a href="${url}" target="_blank" class="json-url">${this.escapeHtml(url)}</a>` : ''}
        </div>`;
    }

    /**
     * 渲染转发元素
     */
    private renderForwardElement(data: any): string {
        const summary = data.summary || '转发消息';
        return `<span class="text-content">📝 ${this.escapeHtml(summary)}</span>`;
    }

    /**
     * 生成页脚
     */
    private generateFooter(): string {
        return ``;
    }

    /**
     * 获取显示名称
     */
    private getDisplayName(message: CleanMessage): string {
        if (message.sender.remark) {
            return message.sender.remark;
        }
        if (message.sender.name) {
            return message.sender.name;
        }
        if (message.sender.uin) {
            return message.sender.uin.toString();
        }
        return message.sender.uid || '未知用户';
    }

    /**
     * 格式化时间
     */
    private formatTime(time: string): string {
        const date = new Date(time);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    /**
     * HTML转义
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 获取时间范围
     */
    private getTimeRange(messages: CleanMessage[]): string | null {
        if (messages.length === 0) return null;
        
        const firstMessage = messages[0];
        const lastMessage = messages[messages.length - 1];
        
        if (!firstMessage || !lastMessage) return null;
        
        const firstTime = new Date(firstMessage.time);
        const lastTime = new Date(lastMessage.time);
        
        return `${firstTime.toLocaleDateString('zh-CN')} 至 ${lastTime.toLocaleDateString('zh-CN')}`;
    }

    /**
     * 计算统计信息
     */
    private calculateStats(messages: CleanMessage[]): any {
        const senders = new Set();
        let totalResources = 0;
        
        messages.forEach(message => {
            senders.add(message.sender.uid);
            totalResources += message.content.resources.length;
        });
        
        return {
            totalMessages: messages.length,
            uniqueSenders: senders.size,
            totalResources
        };
    }

    /**
     * 渲染系统消息元素
     */
    private renderSystemElement(data: any): string {
        const text = data.text || data.summary || '系统消息';
        return `<div class="system-message" style="text-align: center; color: #666; font-size: 12px; margin: 8px 0; padding: 4px 8px; background: #f5f5f5; border-radius: 4px; font-style: italic;">
            ${this.escapeHtml(text)}
        </div>`;
    }

    /**
     * 渲染位置消息元素
     */
    private renderLocationElement(data: any): string {
        const title = data.title || '位置消息';
        const summary = data.summary || '分享了位置';
        
        return `<div class="location-content" style="border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 4px 0; background: #f9f9f9;">
            📍 ${this.escapeHtml(title)}
            ${summary !== title ? `<div style="color: #666; font-size: 12px; margin-top: 4px;">${this.escapeHtml(summary)}</div>` : ''}
        </div>`;
    }

    /**
     * 生成头像HTML，优先使用QQ官方头像API
     */
    private generateAvatarHtml(uin?: string, name?: string): string {
        if (uin) {
            // 使用QQ官方头像接口
            const avatarUrl = `http://q.qlogo.cn/g?b=qq&nk=${uin}&s=100`;
            const fallbackText = name ? name.charAt(0).toUpperCase() : uin.slice(-2);
            
            return `<img src="${avatarUrl}" alt="${this.escapeHtml(name || uin)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline-flex';" />
                    <span style="display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${fallbackText}</span>`;
        } else {
            // 备用方案：使用首字母
            const fallbackText = name ? name.charAt(0).toUpperCase() : 'U';
            return `<span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${fallbackText}</span>`;
        }
    }
}