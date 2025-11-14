import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { once } from 'events';
/**
 * 现代化HTML导出器
 */
export class ModernHtmlExporter {
    options;
    constructor(options) {
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
    async export(messages, chatInfo) {
        // 若上游可以改造成 (Async)Iterable，这里可直接传入以实现端到端流式
        await this.exportFromIterable(messages, chatInfo);
    }
    /**
     * 从 Iterable/AsyncIterable 流式导出，最低内存占用
     */
    async exportFromIterable(messages, chatInfo) {
        const outputDir = path.dirname(this.options.outputPath);
        await fsp.mkdir(outputDir, { recursive: true });
        const ws = fs.createWriteStream(this.options.outputPath, {
            encoding: (this.options.encoding || 'utf8'),
            flags: 'w'
        });
        // 捕获写入流错误
        const onError = (error) => {
            console.error('[ModernHtmlExporter] 写入流错误:', error);
            try {
                ws.destroy();
            }
            catch { /* noop */ }
        };
        ws.on('error', onError);
        let totalMessages = 0;
        let firstTime = null;
        let lastTime = null;
        let copiedCount = 0;
        const copiedResources = [];
        // 资源复制并发限制（根据 CPU 数量自适应，范围 [2, 8]）
        const concurrency = Math.max(2, Math.min(8, os.cpus().length || 4));
        const running = [];
        const scheduleCopy = (task) => {
            const p = (async () => {
                try {
                    const resourcePath = await task();
                    if (resourcePath) {
                        copiedResources.push(resourcePath);
                    }
                    copiedCount++;
                }
                catch (e) {
                    console.error(`[ModernHtmlExporter] 复制资源失败:`, e);
                }
            })();
            // 完成后从运行集中移除
            p.finally(() => {
                const idx = running.indexOf(p);
                if (idx >= 0)
                    running.splice(idx, 1);
            });
            running.push(p);
            return p;
        };
        // 若需要资源目录，预先创建
        if (this.options.includeResourceLinks) {
            const resourceTypes = ['images', 'videos', 'audios', 'files'];
            await Promise.all(resourceTypes.map(type => fsp.mkdir(path.join(outputDir, 'resources', type), { recursive: true })));
        }
        try {
            // 1) 写入文档头与样式/脚本 + 头部信息(占位)
            await this.writeChunk(ws, `<!DOCTYPE html>
<html lang="zh-CN">
<!-- QCE_METADATA: {"messageCount": 0, "chatName": "${this.escapeHtml(chatInfo.name)}", "chatType": "${chatInfo.type}", "exportTime": "${new Date().toISOString()}"} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>聊天记录 - ${this.escapeHtml(chatInfo.name)}</title>
${this.generateStyles()}
${this.generateScripts()}
</head>
<body>
    <!-- Toolbar -->
    ${this.generateToolbar()}
    
    <!-- Hero Section -->
${this.generateHeader(chatInfo, { totalMessages: '--' }, '--')}
    
    <!-- Chat Messages -->
<div class="chat-content">
`);
            // 2) 单次遍历：一边渲染消息写入，一边调度资源复制
            for await (const message of this.toAsyncIterable(messages)) {
                // 统计时间范围（首/尾）
                const t = this.safeToDate(message?.time);
                if (t) {
                    if (!firstTime || t < firstTime)
                        firstTime = t;
                    if (!lastTime || t > lastTime)
                        lastTime = t;
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
            await this.writeChunk(ws, `</div>

${this.generateFooter()}

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <img src="" alt="" id="modalImage">
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
</html>`);
            // 正常结束写入
            ws.end();
            await once(ws, 'finish');
            // 更新元数据注释中的消息数量
            await this.updateMetadata(totalMessages);
            // 控制台输出
            if (this.options.includeResourceLinks) {
                console.log(`[ModernHtmlExporter] HTML导出完成！`);
                console.log(`[ModernHtmlExporter] 📁 HTML文件位置: ${this.options.outputPath}`);
                console.log(`[ModernHtmlExporter] 📁 资源文件位置: ${path.join(outputDir, 'resources')}/`);
                console.log(`[ModernHtmlExporter] ✅ 共复制资源 ${copiedCount} 个`);
                console.log(`[ModernHtmlExporter] ⚠️ 重要提示：保持 HTML 与 resources 目录同级，移动请整体搬迁。`);
            }
            else {
                console.log(`[ModernHtmlExporter] HTML导出完成！文件位置: ${this.options.outputPath}`);
            }
            return copiedResources;
        }
        catch (error) {
            // 确保流被关闭
            try {
                ws.destroy();
            }
            catch { /* noop */ }
            console.error(`[ModernHtmlExporter] 导出发生错误:`, error);
            throw error;
        }
    }
    /* ------------------------ 工具方法：流式写入 ------------------------ */
    async writeChunk(stream, chunk) {
        // 遵循 backpressure：write 返回 false 则等待 'drain'
        if (!stream.write(chunk)) {
            await once(stream, 'drain');
        }
    }
    toAsyncIterable(src) {
        if (src[Symbol.asyncIterator]) {
            return src;
        }
        const it = src;
        return (async function* () {
            for (const item of it)
                yield item;
        })();
    }
    safeToDate(input) {
        if (!input)
            return null;
        const d = new Date(input);
        return isNaN(d.getTime()) ? null : d;
    }
    /* ------------------------ 资源复制（流式 + 并发受限） ------------------------ */
    *iterResources(message) {
        const c = message?.content;
        // 自带 resources 数组
        if (c?.resources && Array.isArray(c.resources)) {
            for (const r of c.resources) {
                const localPath = r?.localPath;
                if (localPath && this.isValidResourcePath(localPath)) {
                    yield {
                        type: (r?.type || 'file'),
                        fileName: (r?.filename || path.basename(localPath)),
                        localPath,
                        url: r?.url
                    };
                }
            }
        }
        // elements 中的资源元素
        if (c?.elements && Array.isArray(c.elements)) {
            for (const el of c.elements) {
                const data = el?.data;
                if (data && typeof data === 'object' && data.localPath && this.isValidResourcePath(data.localPath)) {
                    yield {
                        type: (el?.type || 'file'),
                        fileName: (data.filename || path.basename(data.localPath)),
                        localPath: data.localPath,
                        url: data.url
                    };
                }
            }
        }
    }
    /**
     * 更新HTML文件中的元数据注释
     */
    async updateMetadata(messageCount) {
        try {
            // 读取HTML文件内容
            const content = await fsp.readFile(this.options.outputPath, 'utf8');
            // 查找并替换元数据注释
            const metadataRegex = /<!-- QCE_METADATA: \{[^}]+\} -->/;
            const match = content.match(metadataRegex);
            if (match) {
                // 提取现有元数据
                const metadataStr = match[0].match(/\{[^}]+\}/)?.[0];
                if (metadataStr) {
                    const metadata = JSON.parse(metadataStr);
                    metadata.messageCount = messageCount;
                    // 生成新的元数据注释
                    const newMetadataComment = `<!-- QCE_METADATA: ${JSON.stringify(metadata)} -->`;
                    // 替换旧的元数据注释
                    const newContent = content.replace(metadataRegex, newMetadataComment);
                    // 写回文件
                    await fsp.writeFile(this.options.outputPath, newContent, 'utf8');
                    console.log(`[ModernHtmlExporter] ✅ 元数据已更新: messageCount=${messageCount}`);
                }
            }
        }
        catch (error) {
            console.error('[ModernHtmlExporter] 更新元数据失败:', error);
            // 不抛出错误，不影响导出流程
        }
    }
    async copyResourceFileStream(resource, outputDir) {
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
            if (exists)
                return targetRelativePath;
            // 确保父目录存在（理论上已创建，这里兜底）
            await fsp.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
            // 使用 pipeline 流式复制，内存占用极小
            await pipeline(fs.createReadStream(sourceAbsolutePath), fs.createWriteStream(targetAbsolutePath));
            return targetRelativePath;
        }
        catch (error) {
            if (error?.message === 'source-not-found')
                return null;
            console.error(`[ModernHtmlExporter] 复制资源文件失败:`, {
                resource,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    normalizeTypeDir(type) {
        // 仅特定类型收敛到约定目录，其他一律归档至 files
        switch (type) {
            case 'image': return 'images';
            case 'video': return 'videos';
            case 'audio': return 'audios';
            case 'file': return 'files';
            default: return 'files';
        }
    }
    async fileExists(p) {
        try {
            await fsp.access(p);
            return true;
        }
        catch {
            return false;
        }
    }
    /* ------------------------ 原有 HTML 片段生成（小片段、可复用） ------------------------ */
    generateStyles() {
        return `<style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* CSS Variables for Theme */
        :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f5f5f7;
            --text-primary: #1d1d1f;
            --text-secondary: #86868b;
            --border-color: rgba(0, 0, 0, 0.08);
            --shadow: rgba(0, 0, 0, 0.05);
            --bubble-other: #f2f2f7;
            --bubble-self: #1d1d1f;
            --bubble-self-text: #ffffff;
            --at-mention-bg: rgba(29, 29, 31, 0.1);
            --at-mention-text: #1d1d1f;
            --reply-bg: rgba(29, 29, 31, 0.05);
            --reply-border: rgba(29, 29, 31, 0.25);
            --footer-gradient: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.02) 100%);
        }
        
        [data-theme="dark"] {
            --bg-primary: #000000;
            --bg-secondary: #1c1c1e;
            --text-primary: #f5f5f7;
            --text-secondary: #98989f;
            --border-color: rgba(255, 255, 255, 0.12);
            --shadow: rgba(0, 0, 0, 0.3);
            --bubble-other: #1c1c1e;
            --bubble-self: #f5f5f7;
            --bubble-self-text: #000000;
            --at-mention-bg: rgba(245, 245, 247, 0.15);
            --at-mention-text: #f5f5f7;
            --reply-bg: rgba(255, 255, 255, 0.08);
            --reply-border: rgba(255, 255, 255, 0.2);
            --footer-gradient: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.03) 100%);
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5; 
            font-size: 17px;
            -webkit-font-smoothing: antialiased;
            transition: background 0.3s, color 0.3s;
        }
        
        /* Toolbar - 底部胶囊 */
        .toolbar {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(249, 249, 249, 0.78);
            backdrop-filter: saturate(180%) blur(20px);
            border-radius: 20px;
            padding: 8px;
            z-index: 1000;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08),
                        0 8px 32px rgba(0, 0, 0, 0.06),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
        }
        
        [data-theme="dark"] .toolbar {
            background: rgba(44, 44, 46, 0.78);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3),
                        0 8px 32px rgba(0, 0, 0, 0.25),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .toolbar-content {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        /* 分隔线 */
        .toolbar-separator {
            width: 1px;
            height: 20px;
            background: rgba(0, 0, 0, 0.08);
            margin: 0 4px;
        }
        
        [data-theme="dark"] .toolbar-separator {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-container {
            display: flex;
            align-items: center;
        }
        
        .search-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .search-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .search-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .search-input-wrapper {
            position: relative;
            width: 0;
            overflow: hidden;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-input-wrapper.active {
            width: 240px;
            margin-left: 4px;
        }
        
        .search-input {
            width: 100%;
            padding: 7px 32px 7px 12px;
            border: none;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.06);
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            transition: all 0.2s;
            font-family: inherit;
        }
        
        [data-theme="dark"] .search-input {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-input:focus {
            background: rgba(0, 0, 0, 0.1);
        }
        
        [data-theme="dark"] .search-input:focus {
            background: rgba(255, 255, 255, 0.18);
        }
        
        .search-input::placeholder {
            color: var(--text-secondary);
        }
        
        .clear-search {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 4px;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .clear-search:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }
        
        [data-theme="dark"] .clear-search:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .clear-search svg {
            width: 14px !important;
            height: 14px !important;
            stroke-width: 2.5 !important;
        }
        
        .toolbar-actions {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        .filter-container {
            position: relative;
        }
        
        .filter-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .filter-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .filter-dropdown {
            position: absolute;
            bottom: calc(100% + 12px);
            right: 0;
            min-width: 160px;
            padding: 6px;
            border-radius: 14px;
            background: rgba(249, 249, 249, 0.88);
            backdrop-filter: saturate(180%) blur(20px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12),
                        0 8px 40px rgba(0, 0, 0, 0.08),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        
        [data-theme="dark"] .filter-dropdown {
            background: rgba(44, 44, 46, 0.88);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        0 8px 40px rgba(0, 0, 0, 0.3),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .filter-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        
        .filter-option {
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            color: var(--text-primary);
            white-space: nowrap;
        }
        
        .filter-option:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-option:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-option.active {
            background: rgba(0, 0, 0, 0.08);
            font-weight: 600;
        }
        
        [data-theme="dark"] .filter-option.active {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .github-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            text-decoration: none;
        }
        
        .github-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .github-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .github-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .theme-toggle {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .theme-toggle:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .theme-toggle:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .theme-toggle svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        /* 搜索高亮 */
        mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
            font-weight: 600;
            padding: 2px 4px;
            border-radius: 4px;
        }
        
        [data-theme="dark"] mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
        }
        
        /* Hero Section - 左对齐 */
        .hero {
            padding: 80px 64px 48px;
            max-width: 980px;
            margin: 0 auto;
            border-bottom: 1px solid var(--border-color);
        }
        
        .hero-title {
            font-size: 64px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 8px;
            letter-spacing: -0.03em;
            line-height: 1.05;
        }
        
        .hero-subtitle {
            font-size: 17px;
            color: var(--text-secondary);
            font-weight: 400;
            margin-bottom: 24px;
        }
        
        .hero-meta {
            display: flex;
            gap: 32px;
            flex-wrap: wrap;
        }
        
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .meta-label {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .meta-value {
            font-size: 17px;
            color: var(--text-primary);
            font-weight: 500;
        }
        
        /* Chat Content */
        .chat-content {
            padding: 64px 64px 120px;
            max-width: 980px;
            margin: 0 auto;
            position: relative;
        }
        
        /* 虚拟滚动容器 */
        .virtual-scroll-container {
            position: relative;
            overflow: hidden;
        }
        
        .virtual-scroll-spacer {
            position: absolute;
            top: 0;
            left: 0;
            width: 1px;
            pointer-events: none;
        }
        
        .virtual-scroll-content {
            position: relative;
            will-change: transform;
        }
        
        /* 加载指示器 */
        .scroll-loader {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .message {
            margin-bottom: 32px;
            display: flex;
            gap: 16px;
            align-items: flex-start;
            contain: layout style paint;
            will-change: auto;
        }
        
        .message.self {
            flex-direction: row-reverse;
        }
        
        .avatar {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: var(--bg-secondary);
            flex-shrink: 0;
            overflow: hidden;
        }
        
        .avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .message-wrapper {
            max-width: 60%;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .message-header {
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 0 4px;
        }
        
        .message.self .message-header {
            flex-direction: row-reverse;
        }
        
        .sender {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .time {
            font-size: 12px;
            color: var(--text-secondary);
        }
        
        /* 消息气泡 - 带角 */
        .message-bubble {
            padding: 14px 18px;
            border-radius: 20px;
            position: relative;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        .message.other .message-bubble {
            background: var(--bubble-other);
            color: var(--text-primary);
        }
        
        .message.self .message-bubble {
            background: var(--bubble-self);
            color: var(--bubble-self-text);
        }
        
        /* 气泡左角 (其他人) */
        .message.other .message-bubble::before {
            content: '';
            position: absolute;
            left: -7px;
            top: 14px;
            width: 0;
            height: 0;
            border-style: solid;
            border-width: 0 10px 10px 0;
            border-color: transparent var(--bubble-other) transparent transparent;
        }
        
        /* 气泡右角 (自己) */
        .message.self .message-bubble::before {
            content: '';
            position: absolute;
            right: -7px;
            top: 14px;
            width: 0;
            height: 0;
            border-style: solid;
            border-width: 0 0 10px 10px;
            border-color: transparent transparent var(--bubble-self) transparent;
        }
        
        .content {
            font-size: 17px;
            line-height: 1.47;
        }
        
        .text-content {
            display: inline;
        }
        
        /* 图片内容 */
        .image-content {
            margin: 10px 0 4px;
            border-radius: 16px;
            overflow: hidden;
            max-width: 320px;
        }
        
        .image-content img {
            width: 100%;
            height: auto;
            display: block;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        
        .image-content img:hover {
            opacity: 0.9;
        }
        
        /* @提及 */
        .at-mention {
            background: var(--at-mention-bg);
            color: var(--at-mention-text);
            padding: 3px 8px;
            border-radius: 8px;
            font-weight: 600;
            display: inline;
            transition: background 0.2s;
        }
        
        .message.other .at-mention:hover {
            opacity: 0.85;
        }
        
        .message.self .at-mention {
            background: rgba(255, 255, 255, 0.2);
            color: var(--bubble-self-text);
        }
        
        .message.self .at-mention:hover {
            background: rgba(255, 255, 255, 0.25);
        }
        
        /* 表情 */
        .face-emoji {
            display: inline;
            font-size: 20px;
            margin: 0 2px;
            vertical-align: baseline;
        }
        
        /* 引用消息 */
        .reply-content {
            background: var(--reply-bg);
            border-left: 3px solid var(--reply-border);
            padding: 10px 12px;
            margin: 0 0 10px 0;
            border-radius: 0 8px 8px 0;
            font-size: 14px;
            line-height: 1.4;
            opacity: 0.8;
        }
        
        .reply-content strong {
            font-weight: 600;
            color: var(--text-primary);
            display: block;
            margin-bottom: 4px;
        }
        
        .message.self .reply-content {
            background: rgba(255, 255, 255, 0.1);
            border-left-color: rgba(255, 255, 255, 0.4);
        }
        
        .message.self .reply-content strong {
            color: var(--bubble-self-text);
        }
        
        /* JSON 卡片 */
        .json-card {
            background: rgba(29, 29, 31, 0.06);
            border: 1px solid rgba(29, 29, 31, 0.1);
            border-radius: 12px;
            padding: 14px 16px;
            margin: 8px 0;
            transition: background 0.2s;
        }
        
        .json-card:hover {
            background: rgba(29, 29, 31, 0.08);
        }
        
        .message.self .json-card {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.2);
        }
        
        .message.self .json-card:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .json-title {
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 6px;
            line-height: 1.3;
        }
        
        .json-description {
            font-size: 14px;
            opacity: 0.75;
            margin-bottom: 8px;
            line-height: 1.4;
        }
        
        .json-url {
            font-size: 12px;
            opacity: 0.6;
            text-decoration: none;
        }
        
        /* 市场表情 */
        .market-face {
            display: inline-block;
            width: 80px;
            height: 80px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            vertical-align: middle;
            margin: 4px 0;
        }
        
        /* 图片模态框 */
        .image-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
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
            border-radius: 8px;
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
        
        /* 响应式 */
        @media (max-width: 768px) {
            .hero {
                padding: 48px 24px 32px;
            }
            
            .hero-title {
                font-size: 40px;
            }
            
            .hero-subtitle {
                font-size: 15px;
            }
            
            .hero-meta {
                gap: 24px;
            }
            
            .chat-content {
                padding: 48px 24px 80px;
            }
            
            .message {
                margin-bottom: 28px;
                gap: 12px;
            }
            
            .avatar {
                width: 38px;
                height: 38px;
            }
            
            .message-wrapper {
                max-width: 75%;
            }
        }
        
        /* Footer */
        .footer {
            margin-top: 100px;
            padding: 80px 0;
            background: var(--footer-gradient);
        }
        
        .footer-content {
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
        }
        
        .footer-brand h3 {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .footer-version {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 500;
            margin-bottom: 32px;
        }
        
        .footer-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .footer-copyright {
            font-size: 15px;
            color: var(--text-primary);
            font-weight: 400;
        }
        
        .footer-copyright strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .footer-links {
            font-size: 14px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .footer-links a,
        .footer-links > span:not(.separator) {
            color: var(--text-primary);
            text-decoration: none;
            font-weight: 500;
        }
        
        .footer-links a {
            transition: opacity 0.2s;
        }
        
        .footer-links a:hover {
            opacity: 0.7;
        }
        
        .footer-links .separator {
            color: var(--text-secondary);
            font-weight: 300;
        }
        
        .footer-notice {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: 8px;
            font-weight: 400;
        }
        
        /* 隐藏消息 (搜索/筛选) */
        .message.hidden {
            display: none !important;
        }
    </style>`;
    }
    generateScripts() {
        return `<script src="https://unpkg.com/lucide@latest"></script>
    <script>
        function showImageModal(imgSrc) {
            var modal = document.getElementById('imageModal');
            var modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        // ========== 虚拟滚动管理器 ==========
        class VirtualScroller {
            constructor(container, items, options = {}) {
                this.container = container;
                this.allItems = items;
                this.options = {
                    itemHeight: options.itemHeight || 100,
                    bufferSize: options.bufferSize || 10,
                    ...options
                };
                
                this.visibleItems = [];
                this.startIndex = 0;
                this.endIndex = 0;
                this.scrollTop = 0;
                this.containerHeight = 0;
                this.totalHeight = 0;
                this.isUpdating = false;
                
                this.init();
            }
            
            init() {
                // 创建虚拟滚动结构
                this.spacer = document.createElement('div');
                this.spacer.className = 'virtual-scroll-spacer';
                
                this.content = document.createElement('div');
                this.content.className = 'virtual-scroll-content';
                
                this.container.appendChild(this.spacer);
                this.container.appendChild(this.content);
                
                // 初始化总高度
                this.totalHeight = this.allItems.length * this.options.itemHeight;
                this.spacer.style.height = this.totalHeight + 'px';
                
                // 监听滚动
                this.handleScroll = this.handleScroll.bind(this);
                window.addEventListener('scroll', this.handleScroll, { passive: true });
                window.addEventListener('resize', () => this.update());
                
                this.update();
            }
            
            handleScroll() {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                // 降低阈值，提高响应性
                if (Math.abs(scrollTop - this.scrollTop) > 30 && !this.isUpdating) {
                    this.scrollTop = scrollTop;
                    requestAnimationFrame(() => this.update());
                }
            }
            
            update() {
                if (!this.allItems || this.allItems.length === 0 || this.isUpdating) return;
                
                this.isUpdating = true;
                
                this.containerHeight = window.innerHeight;
                this.totalHeight = this.allItems.length * this.options.itemHeight;
                
                // 获取容器在文档中的位置
                const containerRect = this.container.getBoundingClientRect();
                const containerTop = this.scrollTop + containerRect.top;
                
                // 计算当前视口相对于容器的位置
                const viewportTop = this.scrollTop;
                const viewportBottom = viewportTop + this.containerHeight;
                
                // 计算可见区域在容器内的偏移
                const visibleStart = Math.max(0, viewportTop - containerTop);
                const visibleEnd = Math.max(0, viewportBottom - containerTop);
                
                // 计算应该渲染的项目范围（使用更大的缓冲区）
                const startIndex = Math.max(0, Math.floor(visibleStart / this.options.itemHeight) - this.options.bufferSize);
                const endIndex = Math.min(
                    this.allItems.length,
                    Math.ceil(visibleEnd / this.options.itemHeight) + this.options.bufferSize
                );
                
                // 只在范围变化时才重新渲染
                if (startIndex !== this.startIndex || endIndex !== this.endIndex) {
                    this.startIndex = startIndex;
                    this.endIndex = endIndex;
                    this.render();
                }
                
                this.isUpdating = false;
            }
            
            render() {
                const fragment = document.createDocumentFragment();
                const offset = this.startIndex * this.options.itemHeight;
                
                // 批量渲染可见项
                for (let i = this.startIndex; i < this.endIndex; i++) {
                    if (this.allItems[i]) {
                        fragment.appendChild(this.allItems[i].cloneNode(true));
                    }
                }
                
                // 一次性更新DOM
                this.content.innerHTML = '';
                this.content.appendChild(fragment);
                this.content.style.transform = 'translateY(' + offset + 'px)';
                
                // 重新初始化图标
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons({
                        attrs: { 'stroke-width': 2 }
                    });
                }
            }
            
            updateItems(items) {
                this.allItems = items;
                this.totalHeight = items.length * this.options.itemHeight;
                // 更新后重新计算滚动位置
                this.scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                // 强制完整更新
                this.startIndex = -1;
                this.endIndex = -1;
                this.update();
            }
            
            destroy() {
                window.removeEventListener('scroll', this.handleScroll);
            }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            var modal = document.getElementById('imageModal');
            if (modal) modal.addEventListener('click', hideImageModal);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') hideImageModal();
            });
            
            // 收集所有消息DOM
            var messages = Array.from(document.querySelectorAll('.message'));
            var total = messages.length;
            document.getElementById('info-total').textContent = total;
            
            if (messages.length > 0) {
                var firstTime = messages[0].querySelector('.time').textContent;
                var lastTime = messages[messages.length - 1].querySelector('.time').textContent;
                document.getElementById('info-range').textContent = firstTime + ' ~ ' + lastTime;
            }
            
            // 初始化虚拟滚动（消息超过100条时启用）
            var virtualScroller = null;
            if (messages.length > 100) {
                var chatContent = document.querySelector('.chat-content');
                
                // 保存原始消息
                var originalMessages = messages.map(msg => msg.cloneNode(true));
                
                // 清空容器
                chatContent.innerHTML = '';
                
                // 启用虚拟滚动
                virtualScroller = new VirtualScroller(chatContent, originalMessages, {
                    itemHeight: 120, // 平均消息高度
                    bufferSize: 30   // 缓冲区大小（增大以改善底部滚动体验）
                });
                
                console.log('虚拟滚动已启用，共', messages.length, '条消息');
            }
            
            // ========== 初始化 Lucide 图标 ==========
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
            
            // ========== 主题切换 ==========
            var themeToggle = document.getElementById('themeToggle');
            var themeIconElement = document.getElementById('themeIcon');
            var currentTheme = localStorage.getItem('theme') || 'light';
            
            function setTheme(theme) {
                if (theme === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    themeIconElement.setAttribute('data-lucide', 'moon');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                    themeIconElement.setAttribute('data-lucide', 'sun');
                    localStorage.setItem('theme', 'light');
                }
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            setTheme(currentTheme);
            
            themeToggle.addEventListener('click', function() {
                currentTheme = localStorage.getItem('theme') || 'light';
                setTheme(currentTheme === 'dark' ? 'light' : 'dark');
            });
            
            // ========== 发送者筛选 ==========
            var filterBtn = document.getElementById('filterBtn');
            var filterDropdown = document.getElementById('filterDropdown');
            var currentFilter = 'all';
            var senders = new Set();
            
            // 收集所有发送者
            messages.forEach(function(msg) {
                var sender = msg.querySelector('.sender');
                if (sender) {
                    senders.add(sender.textContent);
                }
            });
            
            // 生成筛选选项
            senders.forEach(function(sender) {
                var option = document.createElement('div');
                option.className = 'filter-option';
                option.setAttribute('data-value', sender);
                option.textContent = sender;
                filterDropdown.appendChild(option);
            });
            
            // 切换下拉菜单
            filterBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                filterDropdown.classList.toggle('active');
            });
            
            // 选择选项
            filterDropdown.addEventListener('click', function(e) {
                if (e.target.classList.contains('filter-option')) {
                    // 移除所有active
                    filterDropdown.querySelectorAll('.filter-option').forEach(function(opt) {
                        opt.classList.remove('active');
                    });
                    // 添加当前active
                    e.target.classList.add('active');
                    currentFilter = e.target.getAttribute('data-value');
                    filterDropdown.classList.remove('active');
                    filterMessages();
                }
            });
            
            // 点击外部关闭
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.filter-container')) {
                    filterDropdown.classList.remove('active');
                }
            });
            
            // ========== 搜索框展开/收起 ==========
            var searchBtn = document.getElementById('searchBtn');
            var searchWrapper = document.getElementById('searchWrapper');
            var searchInput = document.getElementById('searchInput');
            var searchActive = false;
            
            searchBtn.addEventListener('click', function() {
                searchActive = !searchActive;
                if (searchActive) {
                    searchWrapper.classList.add('active');
                    searchInput.focus();
                } else {
                    searchWrapper.classList.remove('active');
                    searchInput.value = '';
                    filterMessages();
                }
            });
            
            // 点击外部关闭搜索框
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.search-container') && searchActive) {
                    searchActive = false;
                    searchWrapper.classList.remove('active');
                    if (!searchInput.value) {
                        searchInput.value = '';
                        filterMessages();
                    }
                }
            });
            
            // ========== 防抖函数 ==========
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            
            // ========== 搜索功能 + 高亮 ==========
            var clearSearch = document.getElementById('clearSearch');
            var originalContents = new Map();
            var originalMessages = messages.map(msg => msg.cloneNode(true));
            
            // 保存原始内容
            originalMessages.forEach(function(msg) {
                var content = msg.querySelector('.content');
                if (content) {
                    originalContents.set(msg, content.innerHTML);
                }
            });
            
            function escapeRegExp(string) {
                return string.replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&');
            }
            
            function highlightText(text, searchTerm) {
                if (!searchTerm) return text;
                var escapedTerm = escapeRegExp(searchTerm);
                var regex = new RegExp('(' + escapedTerm + ')', 'gi');
                return text.replace(regex, '<mark class="highlight">$1</mark>');
            }
            
            function filterMessages() {
                var searchTerm = searchInput.value.trim();
                var selectedSender = currentFilter;
                var filteredMessages = [];
                var visibleCount = 0;
                
                // 使用DocumentFragment优化DOM操作
                originalMessages.forEach(function(msg) {
                    var sender = msg.querySelector('.sender');
                    var senderName = sender ? sender.textContent : '';
                    var content = msg.querySelector('.content');
                    var originalContent = originalContents.get(msg);
                    
                    if (!content || !originalContent) return;
                    
                    // 克隆消息用于过滤
                    var msgClone = msg.cloneNode(true);
                    var contentClone = msgClone.querySelector('.content');
                    
                    // 恢复原始内容
                    contentClone.innerHTML = originalContent;
                    
                    var contentText = contentClone.textContent.toLowerCase();
                    var searchLower = searchTerm.toLowerCase();
                    
                    var matchSearch = searchTerm === '' || contentText.includes(searchLower) || senderName.toLowerCase().includes(searchLower);
                    var matchSender = selectedSender === 'all' || senderName === selectedSender;
                    
                    if (matchSearch && matchSender) {
                        visibleCount++;
                        
                        // 高亮匹配文本
                        if (searchTerm && contentText.includes(searchLower)) {
                            var textContent = contentClone.querySelector('.text-content');
                            if (textContent) {
                                var originalText = textContent.textContent;
                                textContent.innerHTML = highlightText(originalText, searchTerm);
                            }
                        }
                        
                        filteredMessages.push(msgClone);
                    }
                });
                
                // 更新虚拟滚动器
                if (virtualScroller) {
                    virtualScroller.updateItems(filteredMessages);
                    // 延迟滚动到顶部，确保虚拟滚动器已更新
                    setTimeout(function() {
                        window.scrollTo({ top: 0, behavior: 'auto' });
                    }, 50);
                } else {
                    // 非虚拟滚动模式：直接更新DOM
                    var chatContent = document.querySelector('.chat-content');
                    var fragment = document.createDocumentFragment();
                    filteredMessages.forEach(msg => fragment.appendChild(msg));
                    chatContent.innerHTML = '';
                    chatContent.appendChild(fragment);
                }
                
                // 显示/隐藏清除按钮
                clearSearch.style.display = searchTerm ? 'block' : 'none';
                
                // 更新统计
                document.getElementById('info-total').textContent = visibleCount + ' / ' + total;
                
                // 更新图标
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            // 使用防抖优化搜索
            var debouncedFilter = debounce(filterMessages, 300);
            searchInput.addEventListener('input', debouncedFilter);
            
            clearSearch.addEventListener('click', function() {
                searchInput.value = '';
                filterMessages();
                searchInput.focus();
            });
        });
    </script>`;
    }
    /**
     * 生成Toolbar（底部胶囊）
     */
    generateToolbar() {
        return `<div class="toolbar">
        <div class="toolbar-content">
            <div class="search-container">
                <button class="search-btn" id="searchBtn">
                    <i data-lucide="search"></i>
                </button>
                <div class="search-input-wrapper" id="searchWrapper">
                    <input type="text" id="searchInput" class="search-input" placeholder="搜索消息...">
                    <button class="clear-search" id="clearSearch" style="display: none;">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-actions">
                <div class="filter-container">
                    <button class="filter-btn" id="filterBtn">
                        <i data-lucide="user"></i>
                    </button>
                    <div class="filter-dropdown" id="filterDropdown">
                        <div class="filter-option active" data-value="all">全部发送者</div>
                    </div>
                </div>
                <div class="toolbar-separator"></div>
                <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank" class="github-btn" title="GitHub">
                    <i data-lucide="github"></i>
                </a>
                <div class="toolbar-separator"></div>
                <button class="theme-toggle" id="themeToggle" title="切换深色模式">
                    <i data-lucide="sun" id="themeIcon"></i>
                </button>
            </div>
        </div>
    </div>`;
    }
    /**
     * Hero Section（左对齐，Apple风格）
     */
    generateHeader(chatInfo, stats, timeRange) {
        const currentTime = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).replace(/\//g, '/');
        const total = typeof stats.totalMessages === 'number' ? String(stats.totalMessages) : (stats.totalMessages || '--');
        const range = timeRange ?? '--';
        return `<div class="hero">
        <h1 class="hero-title">${this.escapeHtml(chatInfo.name)}</h1>
        <p class="hero-subtitle">聊天记录</p>
        <div class="hero-meta">
            <div class="meta-item">
                <span class="meta-label">导出时间</span>
                <span class="meta-value">${currentTime}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">消息总数</span>
                <span class="meta-value" id="info-total">${this.escapeHtml(total)}</span>
        </div>
            <div class="meta-item">
                <span class="meta-label">时间范围</span>
                <span class="meta-value" id="info-range">${this.escapeHtml(range)}</span>
                </div>
            </div>
        </div>`;
    }
    /**
     * 渲染单条消息（Apple风格带气泡角）
     */
    renderMessage(message) {
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
        const avatarContent = this.generateAvatarHtml(message?.sender?.uin, message?.sender?.name);
        const content = this.parseMessageContent(message);
        return `
        <div class="message ${cssClass}" id="msg-${message.id}">
            <div class="avatar">${avatarContent}</div>
            <div class="message-wrapper">
                <div class="message-header">
                    <span class="sender">${this.escapeHtml(this.getDisplayName(message))}</span>
                    <span class="time">${this.formatTime(message?.time)}</span>
                </div>
                <div class="message-bubble">
                <div class="content">${content}</div>
                </div>
            </div>
        </div>`;
    }
    isSystemMessage(message) {
        return message?.type === 'system' ||
            !!(message?.content?.elements && message.content.elements.some((el) => el?.type === 'system'));
    }
    /**
     * 解析消息内容（按元素渲染）
     */
    parseMessageContent(message) {
        const elements = message?.content?.elements;
        if (!elements || elements.length === 0) {
            return `<span class="text-content">${this.escapeHtml(message?.content?.text || '[空消息]')}</span>`;
        }
        let result = '';
        for (const element of elements) {
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
                    if (rawText)
                        result += `<span class="text-content">${this.escapeHtml(rawText)}</span>`;
            }
        }
        return result || `<span class="text-content">[空消息]</span>`;
    }
    /* ------------------------ 各类元素渲染 ------------------------ */
    renderTextElement(data) {
        const text = data?.text || '';
        return `<span class="text-content">${this.escapeHtml(text)}</span>`;
    }
    renderImageElement(data) {
        const filename = data?.filename || '图片';
        let src = '';
        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/images/${data.filename || path.basename(data.localPath)}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }
        if (src) {
            return `<div class="image-content"><img src="${src}" alt="${this.escapeHtml(filename)}" loading="lazy" onclick="showImageModal('${src}')"></div>`;
        }
        return `<span class="text-content">📷 ${this.escapeHtml(filename)}</span>`;
    }
    renderAudioElement(data) {
        const duration = data?.duration || 0;
        let src = '';
        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/audios/${data.filename || path.basename(data.localPath)}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }
        if (src) {
            return `<audio src="${src}" controls class="message-audio" preload="metadata">[语音:${duration}秒]</audio>`;
        }
        return `<span class="text-content">🎤 [语音:${duration}秒]</span>`;
    }
    renderVideoElement(data) {
        const filename = data?.filename || '视频';
        let src = '';
        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            src = `resources/videos/${data.filename || path.basename(data.localPath)}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                src = url;
            }
        }
        if (src) {
            return `<video src="${src}" controls class="message-video" preload="metadata">[视频: ${this.escapeHtml(filename)}]</video>`;
        }
        return `<span class="text-content">🎬 ${this.escapeHtml(filename)}</span>`;
    }
    renderFileElement(data) {
        const filename = data?.filename || '文件';
        let href = '';
        // 优先使用localPath（导出后的本地资源）
        if (data?.localPath && this.isValidResourcePath(data.localPath)) {
            href = `resources/files/${data.filename || path.basename(data.localPath)}`;
        }
        // 其次使用url，但要过滤掉无效的file://协议路径
        else if (data?.url) {
            const url = data.url;
            // 过滤掉file://协议和本地文件系统路径
            if (!url.startsWith('file://') &&
                !url.startsWith('C:/') &&
                !url.startsWith('D:/') &&
                !url.match(/^[A-Z]:\\/)) {
                href = url;
            }
        }
        if (href) {
            return `<a href="${href}" class="message-file" download="${this.escapeHtml(filename)}">📎 ${this.escapeHtml(filename)}</a>`;
        }
        return `<span class="text-content">📎 ${this.escapeHtml(filename)}</span>`;
    }
    renderFaceElement(data) {
        const name = data?.name || `表情${data?.id || ''}`;
        return `<span class="face-emoji">${this.escapeHtml(name)}</span>`;
    }
    renderMarketFaceElement(data) {
        const name = data?.name || '商城表情';
        const url = data?.url || '';
        if (url) {
            return `<img src="${url}" alt="${this.escapeHtml(name)}" class="market-face" title="${this.escapeHtml(name)}">`;
        }
        return `<span class="text-content">[${this.escapeHtml(name)}]</span>`;
    }
    renderReplyElement(data) {
        const senderName = data?.senderName || '用户';
        const content = data?.content || '引用消息';
        return `<div class="reply-content"><strong>${this.escapeHtml(senderName)}:</strong> ${this.escapeHtml(content)}</div>`;
    }
    renderJsonElement(data) {
        const title = data?.title || data?.summary || 'JSON消息';
        const description = data?.description || '';
        const url = data?.url || '';
        return `<div class="json-card">
            <div class="json-title">${this.escapeHtml(title)}</div>
            ${description ? `<div class="json-description">${this.escapeHtml(description)}</div>` : ''}
            ${url ? `<a href="${url}" target="_blank" class="json-url">${this.escapeHtml(url)}</a>` : ''}
        </div>`;
    }
    renderForwardElement(data) {
        const summary = data?.summary || '转发消息';
        return `<span class="text-content">📝 ${this.escapeHtml(summary)}</span>`;
    }
    renderSystemElement(data) {
        const text = data?.text || data?.content || '系统消息';
        return `<div class="system-message">${this.escapeHtml(text)}</div>`;
    }
    renderLocationElement(data) {
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
    generateFooter() {
        return `    <!-- Footer -->
    <footer class="footer">
        <div class="footer-content">
            <div class="footer-brand">
                <h3>QQ Chat Exporter Pro</h3>
            </div>
            <div class="footer-info">
                <p class="footer-copyright">Made with ❤️ by <strong>shuakami</strong></p>
                <p class="footer-links">
                    <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank">GitHub</a>
                    <span class="separator">·</span>
                    <span>GPL-3.0 License</span>
                </p>
                <p class="footer-notice">本软件完全免费开源 · 如果有帮助到您，欢迎给个 Star 喵，谢谢喵</p>
            </div>
        </div>
    </footer>`;
    }
    /* ------------------------ 基础工具 ------------------------ */
    getDisplayName(message) {
        const s = message?.sender || {};
        if (s.remark)
            return String(s.remark);
        if (s.name)
            return String(s.name);
        if (s.uin)
            return String(s.uin);
        return s.uid || '未知用户';
    }
    formatTime(time) {
        const date = this.safeToDate(time);
        if (!date)
            return '';
        return date.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
    escapeHtml(text) {
        if (text == null)
            return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    resolveResourcePath(resourcePath) {
        // 已是绝对路径
        if (path.isAbsolute(resourcePath))
            return resourcePath;
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
            if (fs.existsSync(fullPath))
                return fullPath;
        }
        // 默认回退
        return path.resolve(resourceRoot, resourcePath);
    }
    isValidResourcePath(resourcePath) {
        if (!resourcePath || typeof resourcePath !== 'string')
            return false;
        const trimmed = resourcePath.trim();
        // 修复 Issue #30: 允许 images/videos/audios/files 开头的相对路径
        const resourceTypePrefixes = ['images/', 'videos/', 'audios/', 'files/'];
        const hasValidPrefix = resourceTypePrefixes.some(prefix => trimmed.startsWith(prefix));
        return (trimmed !== '' &&
            (trimmed.startsWith('resources/') ||
                hasValidPrefix ||
                path.isAbsolute(trimmed) ||
                // 允许纯文件名（不含路径分隔符）
                (trimmed.length > 0 && !trimmed.includes('\\') && !trimmed.includes('/'))));
    }
    generateAvatarHtml(uin, name) {
        if (uin) {
            const avatarUrl = `http://q.qlogo.cn/g?b=qq&nk=${uin}&s=100`;
            const fallbackText = name ? name.charAt(0).toUpperCase() : uin.slice(-2);
            return `<img src="${avatarUrl}" alt="${this.escapeHtml(name || uin)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline-flex';" />
                    <span style="display:none; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        }
        else {
            const fallbackText = name ? name.charAt(0).toUpperCase() : 'U';
            return `<span style="display:inline-flex; width:40px; height:40px; border-radius:50%; background:#007AFF; color:white; align-items:center; justify-content:center; font-size:14px; font-weight:500;">${this.escapeHtml(fallbackText)}</span>`;
        }
    }
}
//# sourceMappingURL=ModernHtmlExporter.js.map