/**
 * 现代化 HTML 导出器（流式优化版）
 * - 使用流式写入避免一次性构建超大字符串
 * - 资源文件并发受限的流式复制
 * - 统计信息采用占位 + 尾部脚本回填，避免双遍历
 */

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { once } from 'events';
import { CleanMessage } from '../parser/SimpleMessageParser';

/**
 * HTML导出选项
 */
export interface HtmlExportOptions {
    outputPath: string;
    includeResourceLinks?: boolean;
    includeSystemMessages?: boolean;
    encoding?: string; // 建议使用 'utf8'
}

/**
 * 聊天信息接口
 */
interface ChatInfo {
    name: string;
    type: 'private' | 'group';
    avatar?: string;
}

/** 内部资源任务结构 */
type ResourceTask = {
    type: string;              // image / video / audio / file / ...
    fileName: string;
    localPath: string;
    url?: string;
};

/**
 * 现代化HTML导出器
 */
export class ModernHtmlExporter {
    private readonly options: HtmlExportOptions;

    constructor(options: HtmlExportOptions) {
        this.options = {
            includeResourceLinks: true,
            includeSystemMessages: true,
            encoding: 'utf8', // 更稳妥的 Node 编码常量
            ...options
        };
    }

    /**
     * 导出聊天记录为HTML（保持原签名，内部走流式）
     */
    async export(messages: CleanMessage[], chatInfo: ChatInfo): Promise<void> {
        // 若上游可以改造成 (Async)Iterable，这里可直接传入以实现端到端流式
        await this.exportFromIterable(messages, chatInfo);
    }

    /**
     * **推荐**：从 Iterable/AsyncIterable 流式导出，最低内存占用
     */
    async exportFromIterable(
        messages: Iterable<CleanMessage> | AsyncIterable<CleanMessage>,
        chatInfo: ChatInfo
    ): Promise<void> {
        const outputDir = path.dirname(this.options.outputPath);
        await fsp.mkdir(outputDir, { recursive: true });

        const ws = fs.createWriteStream(this.options.outputPath, {
            encoding: (this.options.encoding || 'utf8') as BufferEncoding,
            flags: 'w'
        });

        // 捕获写入流错误
        const onError = (error: unknown) => {
            console.error('[ModernHtmlExporter] 写入流错误:', error);
            try { ws.destroy(); } catch { /* noop */ }
        };
        ws.on('error', onError);

        let totalMessages = 0;
        let firstTime: Date | null = null;
        let lastTime: Date | null = null;
        let copiedCount = 0;

        // 资源复制并发限制（根据 CPU 数量自适应，范围 [2, 8]）
        const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
        const running: Promise<void>[] = [];

        const scheduleCopy = (task: () => Promise<void>) => {
            const p = (async () => {
                try {
                    await task();
                    copiedCount++;
                } catch (e) {
                    console.error(`[ModernHtmlExporter] 复制资源失败:`, e);
                }
            })();
            // 完成后从运行集中移除
            p.finally(() => {
                const idx = running.indexOf(p);
                if (idx >= 0) running.splice(idx, 1);
            });
            running.push(p);
            return p;
        };

        // 若需要资源目录，预先创建
        if (this.options.includeResourceLinks) {
            const resourceTypes = ['images', 'videos', 'audios', 'files'];
            await Promise.all(
                resourceTypes.map(type =>
                    fsp.mkdir(path.join(outputDir, 'resources', type), { recursive: true })
                )
            );
        }

        try {
            // 1) 写入文档头与样式/脚本 + 头部信息(占位)
            await this.writeChunk(
                ws,
                `<!DOCTYPE html>
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
${this.generateHeader(chatInfo, { totalMessages: '--' }, '--')}
<div class="chat-content">
`
            );

            // 2) 单次遍历：一边渲染消息写入，一边调度资源复制
            for await (const message of this.toAsyncIterable(messages)) {
                // 统计时间范围（首/尾）
                const t = this.safeToDate(message?.time);
                if (t) {
                    if (!firstTime || t < firstTime) firstTime = t;
                    if (!lastTime || t > lastTime) lastTime = t;
                }

                // 是否跳过系统消息
                if (!this.options.includeSystemMessages && this.isSystemMessage(message)) {
                    continue;
                }

                // 渲染并写入单条消息（小字符串，立即写出，避免累积）
                const chunk = this.renderMessage(message);
                await this.writeChunk(ws, chunk + '\n');
                totalMessages++;

                // 并发受限地复制资源（仅当启用本地资源）
                if (this.options.includeResourceLinks) {
                    for (const res of this.iterResources(message)) {
                        // 控制并发：超出并发上限时，等待任一任务完成
                        while (running.length >= concurrency) {
                            await Promise.race(running);
                        }
                        scheduleCopy(() => this.copyResourceFileStream(res, outputDir));
                    }
                }
            }

            // 等待剩余资源拷贝任务完成
            await Promise.all(running);

            // 3) 收尾：关闭消息区域 + 页脚 + 占位数据回填脚本 + 模态框 + 结束
            const timeRangeText = firstTime && lastTime
                ? `${firstTime.toLocaleDateString('zh-CN')} 至 ${lastTime.toLocaleDateString('zh-CN')}`
                : '--';

            // 使用安全的 JSON 转义注入文本
            const timeRangeJs = JSON.stringify(timeRangeText);

            await this.writeChunk(
                ws,
                `</div>
${this.generateFooter()}
</div>
<!-- 图片预览模态框 -->
<div id="imageModal" class="image-modal">
    <img id="modalImage" src="" alt="预览图片">
</div>

<!-- 统计占位回填 -->
<script>
(function(){
  try {
    var totalEl = document.getElementById('info-total');
    if (totalEl) totalEl.textContent = ${String(totalMessages)};
    var rangeEl = document.getElementById('info-range');
    if (rangeEl) rangeEl.textContent = ${timeRangeJs};
  } catch (e) { /* noop */ }
})();
</script>

</body>
</html>`
            );

            // 正常结束写入
            ws.end();
            await once(ws, 'finish');

            // 控制台输出
            if (this.options.includeResourceLinks) {
                console.log(`[ModernHtmlExporter] HTML导出完成！`);
                console.log(`[ModernHtmlExporter] 📁 HTML文件位置: ${this.options.outputPath}`);
                console.log(`[ModernHtmlExporter] 📁 资源文件位置: ${path.join(outputDir, 'resources')}/`);
                console.log(`[ModernHtmlExporter] ✅ 共复制资源 ${copiedCount} 个`);
                console.log(`[ModernHtmlExporter] ⚠️ 重要提示：保持 HTML 与 resources 目录同级，移动请整体搬迁。`);
            } else {
                console.log(`[ModernHtmlExporter] HTML导出完成！文件位置: ${this.options.outputPath}`);
            }
        } catch (error) {
            // 确保流被关闭
            try { ws.destroy(); } catch { /* noop */ }
            console.error(`[ModernHtmlExporter] 导出发生错误:`, error);
            throw error;
        }
    }

    /* ------------------------ 工具方法：流式写入 ------------------------ */

    private async writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
        // 遵循 backpressure：write 返回 false 则等待 'drain'
        if (!stream.write(chunk)) {
            await once(stream, 'drain');
        }
    }

    private toAsyncIterable<T>(src: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
        if ((src as any)[Symbol.asyncIterator]) {
            return src as AsyncIterable<T>;
        }
        const it = src as Iterable<T>;
        return (async function* () {
            for (const item of it) yield item;
        })();
    }

    private safeToDate(input: unknown): Date | null {
        if (!input) return null;
        const d = new Date(input as any);
        return isNaN(d.getTime()) ? null : d;
    }

    /* ------------------------ 资源复制（流式 + 并发受限） ------------------------ */

    private *iterResources(message: CleanMessage): Iterable<ResourceTask> {
        const c = message?.content;

        // 自带 resources 数组
        if (c?.resources && Array.isArray(c.resources)) {
            for (const r of c.resources) {
                const localPath = (r as any)?.localPath;
                if (localPath && this.isValidResourcePath(localPath)) {
                    yield {
                        type: ((r as any)?.type || 'file') as string,
                        fileName: ((r as any)?.filename || path.basename(localPath)) as string,
                        localPath,
                        url: (r as any)?.url
                    };
                }
            }
        }

        // elements 中的资源元素
        if (c?.elements && Array.isArray(c.elements)) {
            for (const el of c.elements as any[]) {
                const data = el?.data;
                if (data && typeof data === 'object' && data.localPath && this.isValidResourcePath(data.localPath)) {
                    yield {
                        type: (el?.type || 'file') as string,
                        fileName: (data.filename || path.basename(data.localPath)) as string,
                        localPath: data.localPath,
                        url: data.url
                    };
                }
            }
        }
    }

    private async copyResourceFileStream(resource: ResourceTask, outputDir: string): Promise<void> {
        try {
            const sourceAbsolutePath = this.resolveResourcePath(resource.localPath);

            // 源文件存在性校验
            await fsp.access(sourceAbsolutePath).catch(() => {
                console.warn(`[ModernHtmlExporter] 源文件不存在: ${sourceAbsolutePath}`);
                throw new Error('source-not-found');
            });

            // 目标路径（按 HTML 中引用规则）
            const typeDir = this.normalizeTypeDir(resource.type); // image -> images
            const targetRelativePath = path.join('resources', typeDir, resource.fileName);
            const targetAbsolutePath = path.join(outputDir, targetRelativePath);

            // 文件已存在则跳过（以磁盘为真，避免维护超大 Set）
            const exists = await this.fileExists(targetAbsolutePath);
            if (exists) return;

            // 确保父目录存在（理论上已创建，这里兜底）
            await fsp.mkdir(path.dirname(targetAbsolutePath), { recursive: true });

            // 使用 pipeline 流式复制，内存占用极小
            await pipeline(
                fs.createReadStream(sourceAbsolutePath),
                fs.createWriteStream(targetAbsolutePath)
            );
        } catch (error) {
            if ((error as any)?.message === 'source-not-found') return;
            console.error(`[ModernHtmlExporter] 复制资源文件失败:`, {
                resource,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private normalizeTypeDir(type: string): string {
        // 仅特定类型收敛到约定目录，其他一律归档至 files
        switch (type) {
            case 'image': return 'images';
            case 'video': return 'videos';
            case 'audio': return 'audios';
            case 'file':  return 'files';
            default:      return 'files';
        }
    }

    private async fileExists(p: string): Promise<boolean> {
        try {
            await fsp.access(p);
            return true;
        } catch {
            return false;
        }
    }

    /* ------------------------ 原有 HTML 片段生成（小片段、可复用） ------------------------ */

    private generateStyles(): string {
        return `<style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: #ffffff; color: #1d1d1f; line-height: 1.47; font-size: 17px;
        }
        .container { max-width: 1200px; margin: 0 auto; min-height: 100vh; background: #ffffff; }
        .header { padding: 44px 0 32px; text-align: center; border-bottom: 1px solid #f5f5f7; }
        .header h1 { font-size: 48px; font-weight: 600; color: #1d1d1f; margin-bottom: 8px; letter-spacing: -0.022em; }
        .header .subtitle { font-size: 21px; color: #86868b; font-weight: 400; margin-bottom: 16px; }
        .github-link { margin-top: 16px; }
        .github-star { display: inline-flex; align-items: center; gap: 8px; background: #007aff; color: #fff;
            text-decoration: none; padding: 12px 24px; border-radius: 12px; font-size: 16px; font-weight: 500; transition: all .2s; }
        .github-star:hover { background: #0056d3; color: #fff; transform: translateY(-1px); }
        .export-info { padding: 24px 0; text-align: center; background: #fbfbfd; }
        .info-grid { display: flex; justify-content: center; gap: 48px; flex-wrap: wrap; }
        .info-item { text-align: center; }
        .info-label { font-size: 14px; color: #86868b; margin-bottom: 4px; font-weight: 400; }
        .info-value { font-size: 17px; color: #1d1d1f; font-weight: 500; }
        .chat-content { padding: 32px 24px; max-width: 800px; margin: 0 auto; }
        .message { margin-bottom: 16px; display: flex; align-items: flex-start; gap: 12px; clear: both; }
        .message.self { flex-direction: row-reverse; justify-content: flex-start; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; background: #f5f5f7; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; color: #86868b; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .message-bubble { max-width: 70%; padding: 12px 16px; border-radius: 18px; position: relative; }
        .message.other .message-bubble { background: #f5f5f7; color: #1d1d1f; }
        .message.self .message-bubble { background: #007aff; color: #ffffff; }
        .message-header { margin-bottom: 8px; display: flex; flex-direction: column; gap: 2px; }
        .sender { font-size: 14px; font-weight: 500; line-height: 1.2; }
        .message.other .sender { color: #86868b; }
        .message.self .sender { color: rgba(255, 255, 255, 0.8); }
        .time { font-size: 11px; opacity: 0.6; line-height: 1.2; }
        .content { font-size: 16px; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
        .text-content { display: inline; word-wrap: break-word; }
        .image-content { margin: 8px 0; border-radius: 12px; overflow: hidden; max-width: 300px; }
        .image-content img { width: 100%; height: auto; display: block; cursor: pointer; }
        .at-mention { background: rgba(0,122,255,.1); color: #007aff; padding: 2px 6px; border-radius: 6px; font-weight: 500; display: inline; }
        .message.self .at-mention { background: rgba(255,255,255,.2); color: #fff; }
        .face-emoji { display: inline; font-size: 18px; margin: 0 2px; vertical-align: baseline; }
        .reply-content { border-left: 3px solid #007aff; padding-left: 12px; margin: 8px 0; opacity: .8; font-size: 15px; }
        .message.self .reply-content { border-left-color: rgba(255,255,255,.6); }
        .json-card { background: rgba(0,122,255,.1); border: 1px solid rgba(0,122,255,.2); border-radius: 12px; padding: 12px; margin: 8px 0; }
        .json-title { font-weight: 600; color: #007aff; margin-bottom: 4px; }
        .json-description { font-size: 14px; opacity: .8; margin-bottom: 8px; }
        .json-url { font-size: 12px; color: #007aff; text-decoration: none; }
        .market-face { display: inline-block; width: 32px; height: 32px; background-size: contain; background-repeat: no-repeat; background-position: center; vertical-align: middle; }
        ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d1d6; border-radius: 4px; } ::-webkit-scrollbar-thumb:hover { background: #c7c7cc; }
        .image-modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,.8); cursor: pointer; }
        .image-modal img { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 90vw; max-height: 90vh; object-fit: contain; }
        @media (max-width: 768px) {
            .header h1 { font-size: 32px; }
            .header .subtitle { font-size: 17px; }
            .info-grid { gap: 24px; }
            .chat-content { padding: 24px 16px; }
            .message-bubble { max-width: 85%; }
        }
    </style>`;
    }

    private generateScripts(): string {
        return `<script>
        function showImageModal(imgSrc) {
            var modal = document.getElementById('imageModal');
            var modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        document.addEventListener('DOMContentLoaded', function() {
            var modal = document.getElementById('imageModal');
            if (modal) modal.addEventListener('click', hideImageModal);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') hideImageModal();
            });
        });
    </script>`;
    }

    /**
     * 头部信息（加入 DOM 占位 id，便于尾部脚本回填）
     */
    private generateHeader(chatInfo: ChatInfo, stats: { totalMessages: number | string }, timeRange: string | null): string {
        const currentTime = new Date().toLocaleString('zh-CN');
        const total = typeof stats.totalMessages === 'number' ? String(stats.totalMessages) : (stats.totalMessages || '--');
        const range = timeRange ?? '--';

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
                    <div class="info-value" id="info-total">${this.escapeHtml(total)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">导出格式</div>
                    <div class="info-value">HTML</div>
                </div>
                <div class="info-item">
                    <div class="info-label">时间范围</div>
                    <div class="info-value" id="info-range">${this.escapeHtml(range)}</div>
                </div>
            </div>
        </div>`;
    }

    /**
     * 渲染单条消息（保持原有视觉，按条写入）
     */
    private renderMessage(message: CleanMessage): string {
        // 系统消息
        if (this.isSystemMessage(message)) {
            const content = this.parseMessageContent(message);
            return `<div class="system-message-container" style="text-align: center; margin: 12px 0;">
                ${content}
                <div style="color: #999; font-size: 10px; margin-top: 2px;">${this.formatTime(message?.time)}</div>
            </div>`;
        }

        // 普通消息
        const isSelf = false; // TODO: 根据实际逻辑判断
        const cssClass = isSelf ? 'self' : 'other';
        const avatarContent = this.generateAvatarHtml(
            (message as any)?.sender?.uin,
            (message as any)?.sender?.name
        );
        const content = this.parseMessageContent(message);

        return `
        <div class="message ${cssClass}">
            <div class="avatar">${avatarContent}</div>
            <div class="message-bubble">
                <div class="message-header">
                    <span class="sender">${this.escapeHtml(this.getDisplayName(message))}</span>
                    <span class="time">${this.formatTime(message?.time)}</span>
                </div>
                <div class="content">${content}</div>
            </div>
        </div>`;
    }

    private isSystemMessage(message: CleanMessage): boolean {
        return message?.type === 'system' ||
               !!(message?.content?.elements && message.content.elements.some((el: any) => el?.type === 'system'));
    }

    /**
     * 解析消息内容（按元素渲染）
     */
    private parseMessageContent(message: CleanMessage): string {
        const elements = message?.content?.elements;
        if (!elements || elements.length === 0) {
            return `<span class="text-content">${this.escapeHtml(message?.content?.text || '[空消息]')}</span>`;
        }

        let result = '';
        for (const element of elements as any[]) {
            switch (element?.type) {
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
                    const rawText = element?.data?.text || element?.data?.summary || element?.data?.content || '';
                    if (rawText) result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
            }
        }

        return result || `<span class="text-content">[空消息]</span>`;
    }

    /* ------------------------ 各类元素渲染 ------------------------ */

    private renderTextElement(data: any): string {
        const text = data?.text || '';
        return `<span class="text-content">${this.escapeHtml(text)}</span>`;
    }

    private renderImageElement(data: any): string {
        const filename = data?.filename || '图片';
        let src = '';
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/images/${data.filename || path.basename(data.localPath)}`;
        } else if (data?.url) {
            src = data.url;
        }
        if (src) {
            return `<div class="image-content"><img src="${src}" alt="${this.escapeHtml(filename)}" loading="lazy" onclick="showImageModal('${src}')"></div>`;
        }
        return `<span class="text-content">📷 ${this.escapeHtml(filename)}</span>`;
    }

    private renderAudioElement(data: any): string {
        const duration = data?.duration || 0;
        let src = '';
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/audios/${data.filename || path.basename(data.localPath)}`;
        } else if (data?.url) {
            src = data.url;
        }
        if (src) {
            return `<audio src="${src}" controls class="message-audio" preload="metadata">[语音:${duration}秒]</audio>`;
        }
        return `<span class="text-content">🎤 [语音:${duration}秒]</span>`;
    }

    private renderVideoElement(data: any): string {
        const filename = data?.filename || '视频';
        let src = '';
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/videos/${data.filename || path.basename(data.localPath)}`;
        } else if (data?.url) {
            src = data.url;
        }
        if (src) {
            return `<video src="${src}" controls class="message-video" preload="metadata">[视频: ${this.escapeHtml(filename)}]</video>`;
        }
        return `<span class="text-content">🎬 ${this.escapeHtml(filename)}</span>`;
    }

    private renderFileElement(data: any): string {
        const filename = data?.filename || '文件';
        let href = '';
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            href = `resources/files/${data.filename || path.basename(data.localPath)}`;
        } else if (data?.url) {
            href = data.url;
        }
        if (href) {
            return `<a href="${href}" class="message-file" download="${this.escapeHtml(filename)}">📎 ${this.escapeHtml(filename)}</a>`;
        }
        return `<span class="text-content">📎 ${this.escapeHtml(filename)}</span>`;
    }

    private renderFaceElement(data: any): string {
        const name = data?.name || `表情${data?.id || ''}`;
        return `<span class="face-emoji">${this.escapeHtml(name)}</span>`;
    }

    private renderMarketFaceElement(data: any): string {
        const name = data?.name || '商城表情';
        const url = data?.url || '';
        if (url) {
            return `<img src="${url}" alt="${this.escapeHtml(name)}" class="market-face" title="${this.escapeHtml(name)}">`;
        }
        return `<span class="text-content">[${this.escapeHtml(name)}]</span>`;
    }

    private renderReplyElement(data: any): string {
        const senderName = data?.senderName || '用户';
        const content = data?.content || '引用消息';
        return `<div class="reply-content"><strong>${this.escapeHtml(senderName)}:</strong> ${this.escapeHtml(content)}</div>`;
    }

    private renderJsonElement(data: any): string {
        const title = data?.title || data?.summary || 'JSON消息';
        const description = data?.description || '';
        const url = data?.url || '';
        return `<div class="json-card">
            <div class="json-title">${this.escapeHtml(title)}</div>
            ${description ? `<div class="json-description">${this.escapeHtml(description)}</div>` : ''}
            ${url ? `<a href="${url}" target="_blank" class="json-url">${this.escapeHtml(url)}</a>` : ''}
        </div>`;
    }

    private renderForwardElement(data: any): string {
        const summary = data?.summary || '转发消息';
        return `<span class="text-content">📝 ${this.escapeHtml(summary)}</span>`;
    }

    private renderSystemElement(data: any): string {
        const text = data?.text || data?.content || '系统消息';
        return `<div class="system-message">${this.escapeHtml(text)}</div>`;
    }

    private renderLocationElement(data: any): string {
        const name = data?.name || '位置';
        const address = data?.address || '';
        const lat = data?.lat || data?.latitude || '';
        const lng = data?.lng || data?.longitude || '';
        
        let locationText = `📍 ${this.escapeHtml(name)}`;
        if (address) {
            locationText += ` - ${this.escapeHtml(address)}`;
        }
        if (lat && lng) {
            locationText += ` (${lat}, ${lng})`;
        }
        
        return `<span class="text-content">${locationText}</span>`;
    }

    private generateFooter(): string {
        return ``;
    }

    /* ------------------------ 基础工具 ------------------------ */

    private getDisplayName(message: CleanMessage): string {
        const s: any = (message as any)?.sender || {};
        if (s.remark) return String(s.remark);
        if (s.name) return String(s.name);
        if (s.uin) return String(s.uin);
        return s.uid || '未知用户';
    }

    private formatTime(time: any): string {
        const date = this.safeToDate(time);
        if (!date) return '';
        return date.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    private escapeHtml(text?: string): string {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private resolveResourcePath(resourcePath: string): string {
        // 已是绝对路径
        if (path.isAbsolute(resourcePath)) return resourcePath;

        // 资源根目录：跨平台 HOME 目录
        const resourceRoot = path.join(os.homedir(), '.qq-chat-exporter', 'resources');

        // 修复 Issue #30: 处理 images/xxx.jpg 格式的相对路径
        const resourceTypes = ['images/', 'videos/', 'audios/', 'files/'];
        for (const type of resourceTypes) {
            if (resourcePath.startsWith(type)) {
                return path.join(resourceRoot, resourcePath);
            }
        }

        // resources/ 相对路径
        if (resourcePath.startsWith('resources/')) {
            return path.resolve(resourceRoot, resourcePath.substring(10)); // 去掉 'resources/'
        }

        // 仅文件名：遍历资源类型目录
        const resourceTypeDirs = ['images', 'videos', 'audios', 'files'];
        for (const type of resourceTypeDirs) {
            const fullPath = path.join(resourceRoot, type, resourcePath);
            if (fs.existsSync(fullPath)) return fullPath;
        }

        // 默认回退
        return path.resolve(resourceRoot, resourcePath);
    }

    private isValidResourcePath(resourcePath: string): boolean {
        if (!resourcePath || typeof resourcePath !== 'string') return false;
        const trimmed = resourcePath.trim();
        return (
            trimmed !== '' &&
            (trimmed.startsWith('resources/') ||
                path.isAbsolute(trimmed) ||
                // 允许纯文件名（不含路径分隔符）
                (trimmed.length > 0 && !trimmed.includes('\\') && !trimmed.includes('/')))
        );
    }

    private generateAvatarHtml(uin?: string, name?: string): string {
        if (uin) {
            const avatarUrl = `http://q.qlogo.cn/g?b=qq&nk=${uin}&s=100`;
            const fallbackText = name ? name.charAt(0).toUpperCase() : uin.slice(-2);
            return `<img src="${avatarUrl}" alt="${this.escapeHtml(name || uin)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline-flex';" />
                    <span style="display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        } else {
            const fallbackText = name ? name.charAt(0).toUpperCase() : 'U';
            return `<span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        }
    }
}
