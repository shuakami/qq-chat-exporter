/**
 * QCE 独立模式服务器
 * 无需 NapCat 登录即可运行，提供：
 * - 聊天记录索引浏览
 * - 资源画廊（图片/视频/音频）
 * - 文件预览
 * - 导出文件管理
 */

import express from 'express';
import type { Request, Response, Application } from 'express';
import cors from 'cors';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import os from 'os';

// 导入前端服务管理器
import { FrontendBuilder } from '../webui/FrontendBuilder.js';
import { VERSION, APP_INFO } from '../version.js';

/**
 * API响应接口
 */
interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: { type: string; message: string; code: string };
    timestamp: string;
    requestId: string;
}

/**
 * QCE 独立模式服务器
 */
export class QCEStandaloneServer {
    private app: Application;
    private server: Server;
    private wss: WebSocketServer;
    private frontendBuilder: FrontendBuilder;
    private baseDir: string;
    private exportsDir: string;
    private resourcesDir: string;
    private scheduledExportsDir: string;
    private resourceFileCache: Map<string, Map<string, string>> = new Map();
    private port: number;

    constructor(port: number = 40653) {
        this.port = port;
        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        this.frontendBuilder = new FrontendBuilder();

        // 设置数据目录
        const userProfile = process.env['USERPROFILE'] || process.env['HOME'] || os.homedir();
        this.baseDir = path.join(userProfile, '.qq-chat-exporter');
        this.exportsDir = path.join(this.baseDir, 'exports');
        this.resourcesDir = path.join(this.baseDir, 'resources');
        this.scheduledExportsDir = path.join(this.baseDir, 'scheduled-exports');

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
    }

    /**
     * 配置 WebSocket
     */
    private setupWebSocket(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[QCE-Standalone] WebSocket 连接建立');

            // 发送连接确认
            ws.send(JSON.stringify({
                type: 'connected',
                data: { message: 'WebSocket连接成功（独立模式）', mode: 'standalone' },
                timestamp: new Date().toISOString()
            }));

            ws.on('message', (data: string) => {
                try {
                    const message = JSON.parse(data.toString());
                    // 独立模式下，对于搜索等请求返回不支持的提示
                    if (message.type === 'start_stream_search') {
                        ws.send(JSON.stringify({
                            type: 'search_error',
                            data: { 
                                searchId: message.data?.searchId,
                                message: '独立模式不支持消息搜索，需要启动NapCat并登录QQ'
                            }
                        }));
                    }
                } catch (error) {
                    console.error('[QCE-Standalone] WebSocket消息处理失败:', error);
                }
            });

            ws.on('close', () => {
                console.log('[QCE-Standalone] WebSocket 连接关闭');
            });
        });
    }

    /**
     * 配置中间件
     */
    private setupMiddleware(): void {
        // CORS配置
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Access-Token']
        }));

        // JSON解析
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));

        // 请求ID中间件
        this.app.use((req: Request, res: Response, next) => {
            (req as any).requestId = req.headers['x-request-id'] as string || this.generateRequestId();
            res.setHeader('X-Request-ID', (req as any).requestId);
            next();
        });

        // 日志中间件
        this.app.use((req: Request, _res: Response, next) => {
            console.log(`[QCE-Standalone] ${req.method} ${req.path}`);
            next();
        });
    }

    /**
     * 配置路由
     */
    private setupRoutes(): void {
        // 根路由 - API信息
        this.app.get('/', (req, res) => {
            this.sendSuccessResponse(res, {
                name: 'QCE 独立模式',
                version: VERSION,
                description: '无需登录即可浏览已导出的聊天记录和资源',
                mode: 'standalone',
                features: [
                    '聊天记录索引浏览',
                    '资源画廊（图片/视频/音频）',
                    '文件预览',
                    '导出文件管理'
                ],
                limitations: [
                    '无法导出新的聊天记录（需要NapCat登录）',
                    '无法获取群组/好友列表',
                    '无法下载QQ资源文件'
                ],
                dataDir: this.baseDir
            }, (req as any).requestId);
        });

        // 健康检查
        this.app.get('/health', (req, res) => {
            this.sendSuccessResponse(res, {
                status: 'healthy',
                mode: 'standalone',
                online: false, // 独立模式下始终为false
                timestamp: new Date().toISOString()
            }, (req as any).requestId);
        });

        // 安全状态（独立模式无需认证）
        this.app.get('/security-status', (req, res) => {
            this.sendSuccessResponse(res, {
                requiresAuth: false,
                mode: 'standalone',
                message: '独立模式无需认证'
            }, (req as any).requestId);
        });

        // 认证端点（独立模式始终通过）
        this.app.post('/auth', (req, res) => {
            this.sendSuccessResponse(res, {
                authenticated: true,
                mode: 'standalone',
                message: '独立模式无需认证'
            }, (req as any).requestId);
        });

        // 系统信息
        this.app.get('/api/system/info', (req, res) => {
            this.sendSuccessResponse(res, {
                name: 'QCE 独立模式',
                version: VERSION,
                mode: 'standalone',
                napcat: {
                    version: 'N/A',
                    online: false,
                    selfInfo: {
                        uid: '',
                        uin: '',
                        nick: '独立模式',
                        avatarUrl: null
                    }
                },
                runtime: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    arch: process.arch,
                    uptime: process.uptime()
                }
            }, (req as any).requestId);
        });

        // 系统状态
        this.app.get('/api/system/status', (req, res) => {
            this.sendSuccessResponse(res, {
                online: false,
                mode: 'standalone',
                websocketConnections: 0,
                uptime: process.uptime()
            }, (req as any).requestId);
        });

        // ==================== 导出文件管理 ====================

        // 获取导出文件列表
        this.app.get('/api/exports/files', async (req, res) => {
            try {
                const files = await this.getExportFiles();
                this.sendSuccessResponse(res, { files }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取文件详情
        this.app.get('/api/exports/files/:fileName/info', (req, res) => {
            try {
                const { fileName } = req.params;
                const fileInfo = this.getFileInfo(fileName);
                this.sendSuccessResponse(res, fileInfo, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 文件预览
        this.app.get('/api/exports/files/:fileName/preview', (req, res) => {
            try {
                const { fileName } = req.params;
                this.serveFilePreview(fileName, res);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 资源文件服务
        this.app.get('/api/exports/files/:fileName/resources/*', (req, res) => {
            try {
                // 资源路径，例如: images/xxx.jpg
                const resourcePath = (req.params as any)[0] as string;
                this.serveResourceFile(resourcePath, res);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 删除导出文件
        this.app.delete('/api/exports/files/:fileName', async (req, res) => {
            try {
                const { fileName } = req.params;
                const result = await this.deleteExportFile(fileName);
                this.sendSuccessResponse(res, result, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ==================== 资源索引API ====================

        // 获取资源索引
        this.app.get('/api/resources/index', async (req, res) => {
            try {
                const index = await this.buildResourceIndex();
                this.sendSuccessResponse(res, index, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取全局资源文件列表（画廊）
        this.app.get('/api/resources/files', async (req, res) => {
            try {
                const type = req.query['type'] as string || 'all';
                const page = parseInt(req.query['page'] as string) || 1;
                const limit = parseInt(req.query['limit'] as string) || 50;
                const resources = await this.getGlobalResourceFiles(type, page, limit);
                this.sendSuccessResponse(res, resources, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ==================== 文件操作 ====================

        // 打开文件位置
        this.app.post('/api/open-file-location', async (req, res) => {
            try {
                const { filePath } = req.body;
                
                if (!filePath) {
                    throw new Error('缺少文件路径参数');
                }
                if (!fs.existsSync(filePath)) {
                    throw new Error(`文件不存在: ${filePath}`);
                }
                
                const normalizedPath = filePath.replace(/\//g, '\\');
                const command = process.platform === 'win32'
                    ? `explorer /select,"${normalizedPath}"`
                    : process.platform === 'darwin'
                    ? `open -R "${filePath}"`
                    : `xdg-open "${path.dirname(filePath)}"`;
                
                exec(command);
                
                this.sendSuccessResponse(res, { message: '已打开文件位置' }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 打开导出目录
        this.app.post('/api/open-export-directory', async (req, res) => {
            try {
                if (!fs.existsSync(this.exportsDir)) {
                    fs.mkdirSync(this.exportsDir, { recursive: true });
                }
                
                const normalizedPath = this.exportsDir.replace(/\//g, '\\');
                const command = process.platform === 'win32'
                    ? `explorer "${normalizedPath}"`
                    : process.platform === 'darwin'
                    ? `open "${this.exportsDir}"`
                    : `xdg-open "${this.exportsDir}"`;
                
                exec(command);
                
                this.sendSuccessResponse(res, { message: '已打开导出目录', path: this.exportsDir }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ==================== 不支持的API（返回友好提示）====================

        const unsupportedHandler = (feature: string) => (req: Request, res: Response) => {
            this.sendErrorResponse(res, {
                type: 'STANDALONE_MODE',
                message: `独立模式不支持${feature}，需要启动NapCat并登录QQ`,
                code: 'FEATURE_NOT_AVAILABLE'
            }, (req as any).requestId, 503);
        };

        // 群组/好友相关
        this.app.get('/api/groups', unsupportedHandler('获取群组列表'));
        this.app.get('/api/groups/:groupCode', unsupportedHandler('获取群组详情'));
        this.app.get('/api/groups/:groupCode/members', unsupportedHandler('获取群成员'));
        this.app.get('/api/friends', unsupportedHandler('获取好友列表'));
        this.app.get('/api/friends/:uid', unsupportedHandler('获取好友详情'));

        // 消息导出相关
        this.app.post('/api/messages/fetch', unsupportedHandler('获取消息'));
        this.app.post('/api/messages/export', unsupportedHandler('导出消息'));
        this.app.post('/api/tasks', unsupportedHandler('创建导出任务'));

        // 任务列表（将已导出的文件作为已完成的任务返回）
        this.app.get('/api/tasks', async (req, res) => {
            try {
                const files = await this.getExportFiles();
                // 将导出文件转换为任务格式
                const tasks = files.map((file, index) => ({
                    id: `standalone-${index}`,
                    sessionName: file.chatId || file.fileName,
                    chatType: file.chatType === 'group' ? 2 : 1,
                    peerUid: file.chatId || '',
                    format: file.format?.toLowerCase() || 'html',
                    status: 'completed',
                    progress: 100,
                    message: '已完成',
                    fileName: file.fileName,
                    filePath: file.filePath,
                    downloadUrl: file.relativePath,
                    createdAt: file.createTime,
                    completedAt: file.modifyTime,
                    fileSize: file.size
                }));
                this.sendSuccessResponse(res, { tasks, total: tasks.length }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 定时导出相关（返回空列表）
        this.app.get('/api/scheduled-exports', (req, res) => {
            this.sendSuccessResponse(res, { scheduledExports: [], total: 0 }, (req as any).requestId);
        });
        this.app.post('/api/scheduled-exports', unsupportedHandler('创建定时导出'));

        // 表情包相关（返回空列表）
        this.app.get('/api/sticker-packs', (req, res) => {
            this.sendSuccessResponse(res, { packs: [], total: 0 }, (req as any).requestId);
        });
        this.app.get('/api/sticker-packs/export-records', (req, res) => {
            this.sendSuccessResponse(res, { records: [], total: 0 }, (req as any).requestId);
        });
        this.app.post('/api/sticker-packs/export', unsupportedHandler('导出表情包'));

        // ==================== 静态文件服务 ====================

        // 导出文件下载
        this.app.use('/downloads', express.static(this.exportsDir));
        this.app.use('/scheduled-downloads', express.static(this.scheduledExportsDir));
        this.app.use('/resources', express.static(this.resourcesDir));

        // 前端应用路由
        this.frontendBuilder.setupStaticRoutes(this.app);

        // 404处理
        this.app.use((req, res) => {
            const ignoredPaths = ['/favicon.ico', '/robots.txt'];
            if (ignoredPaths.includes(req.path)) {
                res.status(404).end();
                return;
            }
            this.sendErrorResponse(res, {
                type: 'NOT_FOUND',
                message: `端点不存在: ${req.method} ${req.path}`,
                code: 'ENDPOINT_NOT_FOUND'
            }, (req as any).requestId, 404);
        });
    }

    // ==================== 辅助方法 ====================

    /**
     * 获取导出文件列表
     */
    private async getExportFiles(): Promise<any[]> {
        const files: any[] = [];
        const dirs = [
            { dir: this.exportsDir, isScheduled: false },
            { dir: this.scheduledExportsDir, isScheduled: true }
        ];

        for (const { dir, isScheduled } of dirs) {
            if (!fs.existsSync(dir)) continue;

            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const filePath = path.join(dir, entry);
                const stats = fs.statSync(filePath);
                
                if (stats.isFile() && /\.(html|json|zip|jsonl)$/i.test(entry)) {
                    const parsed = this.parseFileName(entry);
                    files.push({
                        fileName: entry,
                        filePath,
                        relativePath: isScheduled ? `/scheduled-downloads/${entry}` : `/downloads/${entry}`,
                        size: stats.size,
                        createTime: stats.birthtime,
                        modifyTime: stats.mtime,
                        isScheduled,
                        ...parsed
                    });
                }
            }
        }

        // 按创建时间倒序
        files.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
        return files;
    }

    /**
     * 解析文件名
     * Issue #216: 支持新格式 (friend|group)_聊天名_ID_日期_时间.扩展名
     * 同时保持向后兼容旧格式 (friend|group)_ID_日期_时间.扩展名
     * 注意：ID 可能包含非数字字符（如 u_xxx）
     */
    private parseFileName(fileName: string): any {
        // 使用从右向左的匹配策略：先匹配固定的日期时间部分
        const baseMatch = fileName.match(/^(friend|group)_(.+)_(\d{8})_(\d{6})(?:_\w+)?\.(\w+)$/);
        if (!baseMatch) return { chatType: 'unknown', chatId: '', format: path.extname(fileName).slice(1) };

        const [, type, middlePart, date, time, ext] = baseMatch;
        if (!middlePart) return { chatType: 'unknown', chatId: '', format: ext.toUpperCase() };
        
        // 尝试从 middlePart 中分离聊天名和ID
        const lastUnderscoreIdx = middlePart.lastIndexOf('_');
        
        if (lastUnderscoreIdx > 0) {
            const possibleId = middlePart.substring(lastUnderscoreIdx + 1);
            const possibleChatName = middlePart.substring(0, lastUnderscoreIdx);
            
            // 如果最后一部分是纯数字，认为是新格式
            if (/^\d+$/.test(possibleId) && possibleChatName) {
                return {
                    chatType: type === 'group' ? 'group' : 'private',
                    chatId: possibleId,
                    displayName: possibleChatName.replace(/_/g, ' '),
                    exportDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
                    exportTime: `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
                    format: ext.toUpperCase()
                };
            }
            
            // 检查是否是 chatName_u_xxx 格式
            const secondLastIdx = possibleChatName.lastIndexOf('_');
            if (secondLastIdx > 0) {
                const possibleUPrefix = possibleChatName.substring(secondLastIdx + 1);
                if (possibleUPrefix === 'u') {
                    const chatName = possibleChatName.substring(0, secondLastIdx);
                    const id = `u_${possibleId}`;
                    return {
                        chatType: type === 'group' ? 'group' : 'private',
                        chatId: id,
                        displayName: chatName.replace(/_/g, ' '),
                        exportDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
                        exportTime: `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
                        format: ext.toUpperCase()
                    };
                }
            }
        }
        
        // 旧格式：整个 middlePart 就是 ID
        return {
            chatType: type === 'group' ? 'group' : 'private',
            chatId: middlePart,
            exportDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
            exportTime: `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
            format: ext.toUpperCase()
        };
    }

    /**
     * 获取文件详情
     */
    private getFileInfo(fileName: string): any {
        let filePath = path.join(this.exportsDir, fileName);
        let isScheduled = false;

        if (!fs.existsSync(filePath)) {
            filePath = path.join(this.scheduledExportsDir, fileName);
            isScheduled = true;
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${fileName}`);
        }

        const stats = fs.statSync(filePath);
        const parsed = this.parseFileName(fileName);

        // 尝试读取JSON元数据
        let metadata = null;
        if (fileName.endsWith('.json')) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(content);
                metadata = {
                    chatName: data.chatInfo?.name,
                    messageCount: data.statistics?.totalMessages,
                    timeRange: data.statistics?.timeRange
                };
            } catch {}
        }

        return {
            fileName,
            filePath,
            relativePath: isScheduled ? `/scheduled-downloads/${fileName}` : `/downloads/${fileName}`,
            size: stats.size,
            createTime: stats.birthtime,
            isScheduled,
            metadata,
            ...parsed
        };
    }

    /**
     * 提供文件预览
     */
    private serveFilePreview(fileName: string, res: Response): void {
        let filePath = path.join(this.exportsDir, fileName);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(this.scheduledExportsDir, fileName);
        }
        if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${fileName}`);
        }

        const ext = path.extname(fileName).toLowerCase();

        if (ext === '.json') {
            const content = fs.readFileSync(filePath, 'utf-8');
            let jsonData;
            try { jsonData = JSON.parse(content); } catch { jsonData = { error: '无法解析JSON' }; }
            
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>JSON预览</title>
<style>body{font-family:monospace;padding:20px;background:#fff;}pre{white-space:pre-wrap;}</style>
</head><body><pre>${JSON.stringify(jsonData, null, 2)}</pre></body></html>`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            let htmlContent = fs.readFileSync(filePath, 'utf-8');
            // 修复资源路径：将 ./resources/ 或 ../resources/ 替换为正确的 API 路径
            // 支持新版（./resources/）和旧版（../resources/）导出格式
            // 原始: src="./resources/images/xxx.jpg" 或 src="../resources/images/xxx.jpg"
            // 目标: src="/api/exports/files/{fileName}/resources/images/xxx.jpg"
            const encodedFileName = encodeURIComponent(fileName);
            htmlContent = htmlContent
                .replace(/src="\.\/resources\//g, `src="/api/exports/files/${encodedFileName}/resources/`)
                .replace(/href="\.\/resources\//g, `href="/api/exports/files/${encodedFileName}/resources/`)
                .replace(/src="\.\.\/resources\//g, `src="/api/exports/files/${encodedFileName}/resources/`)
                .replace(/href="\.\.\/resources\//g, `href="/api/exports/files/${encodedFileName}/resources/`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(htmlContent);
        }
    }

    /**
     * 提供资源文件
     */
    private serveResourceFile(resourcePath: string, res: Response): void {
        const normalizedPath = path.normalize(resourcePath);
        if (normalizedPath.includes('..')) {
            throw new Error('非法路径');
        }

        const fullPath = this.findResourceFile(resourcePath);
        if (!fullPath || !fs.existsSync(fullPath)) {
            throw new Error(`资源不存在: ${resourcePath}`);
        }

        const ext = path.extname(resourcePath).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.mp4': 'video/mp4', '.webm': 'video/webm',
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
        };
        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.sendFile(fullPath);
    }

    /**
     * 构建资源文件缓存
     */
    private buildResourceCache(dirPath: string): Map<string, string> {
        if (this.resourceFileCache.has(dirPath)) {
            return this.resourceFileCache.get(dirPath)!;
        }

        const cache = new Map<string, string>();
        const fullDirPath = path.join(this.resourcesDir, dirPath);

        if (fs.existsSync(fullDirPath)) {
            const files = fs.readdirSync(fullDirPath);
            for (const fileName of files) {
                const fullPath = path.join(fullDirPath, fileName);
                if (fs.statSync(fullPath).isFile()) {
                    const underscoreIndex = fileName.indexOf('_');
                    if (underscoreIndex > 0) {
                        cache.set(fileName.substring(underscoreIndex + 1), fileName);
                    }
                    cache.set(fileName, fileName);
                }
            }
        }

        this.resourceFileCache.set(dirPath, cache);
        return cache;
    }

    /**
     * 查找资源文件
     */
    private findResourceFile(resourcePath: string): string | null {
        const dirPath = path.dirname(resourcePath);
        const shortFileName = path.basename(resourcePath);
        const cache = this.buildResourceCache(dirPath);
        const actualFileName = cache.get(shortFileName);
        return actualFileName ? path.join(this.resourcesDir, dirPath, actualFileName) : null;
    }

    /**
     * 构建资源索引
     */
    private async buildResourceIndex(): Promise<any> {
        const globalResources = {
            images: { count: 0, size: 0, path: '/resources/images' },
            videos: { count: 0, size: 0, path: '/resources/videos' },
            audios: { count: 0, size: 0, path: '/resources/audios' },
            files: { count: 0, size: 0, path: '/resources/files' }
        };

        let totalResources = 0;
        let totalSize = 0;

        const resourceTypes = ['images', 'videos', 'audios', 'files'] as const;
        for (const type of resourceTypes) {
            const dirPath = path.join(this.resourcesDir, type);
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    if (stats.isFile()) {
                        globalResources[type].count++;
                        globalResources[type].size += stats.size;
                        totalResources++;
                        totalSize += stats.size;
                    }
                }
            }
        }

        // 获取导出文件列表
        const exportFiles = await this.getExportFiles();
        const exports = exportFiles.map(f => ({
            fileName: f.fileName,
            format: f.format?.toLowerCase() || 'unknown',
            resourceCount: 0,
            resourceSize: 0,
            chatType: f.chatType,
            chatId: f.chatId,
            displayName: f.chatId
        }));

        return {
            summary: {
                totalResources,
                totalSize,
                byType: {
                    images: { count: globalResources.images.count, size: globalResources.images.size },
                    videos: { count: globalResources.videos.count, size: globalResources.videos.size },
                    audios: { count: globalResources.audios.count, size: globalResources.audios.size },
                    files: { count: globalResources.files.count, size: globalResources.files.size }
                },
                bySource: {}
            },
            globalResources,
            exports
        };
    }

    /**
     * 获取全局资源文件列表
     */
    private async getGlobalResourceFiles(type: string, page: number, limit: number): Promise<any> {
        const files: any[] = [];
        const resourceTypes = type === 'all' ? ['images', 'videos', 'audios', 'files'] : [type];

        for (const resourceType of resourceTypes) {
            const dirPath = path.join(this.resourcesDir, resourceType);
            if (!fs.existsSync(dirPath)) continue;

            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
                const filePath = path.join(dirPath, entry);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    files.push({
                        type: resourceType.slice(0, -1), // images -> image
                        fileName: entry,
                        relativePath: `/resources/${resourceType}/${entry}`,
                        size: stats.size,
                        mtime: stats.mtime
                    });
                }
            }
        }

        // 按修改时间倒序
        files.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

        const startIndex = (page - 1) * limit;
        const paginatedFiles = files.slice(startIndex, startIndex + limit);

        return {
            files: paginatedFiles,
            total: files.length,
            page,
            limit,
            hasMore: startIndex + limit < files.length
        };
    }

    /**
     * 删除导出文件
     */
    private async deleteExportFile(fileName: string): Promise<any> {
        let filePath = path.join(this.exportsDir, fileName);
        let found = fs.existsSync(filePath);

        if (!found) {
            filePath = path.join(this.scheduledExportsDir, fileName);
            found = fs.existsSync(filePath);
        }

        if (!found) {
            throw new Error(`文件不存在: ${fileName}`);
        }

        const deletedFiles: string[] = [];

        // 删除主文件
        fs.unlinkSync(filePath);
        deletedFiles.push(fileName);

        // 尝试删除关联文件
        const baseName = fileName.replace(/\.(html|json|zip|jsonl)$/i, '');
        const dir = path.dirname(filePath);

        // 删除对应的HTML/JSON文件
        for (const ext of ['.html', '.json']) {
            const relatedFile = path.join(dir, baseName + ext);
            if (fs.existsSync(relatedFile) && relatedFile !== filePath) {
                fs.unlinkSync(relatedFile);
                deletedFiles.push(baseName + ext);
            }
        }

        // 删除资源目录
        const resourcesDir = path.join(dir, `resources_${baseName}`);
        if (fs.existsSync(resourcesDir)) {
            fs.rmSync(resourcesDir, { recursive: true, force: true });
            deletedFiles.push('资源目录');
        }

        return { message: '文件删除成功', deleted: deletedFiles };
    }

    // ==================== 响应辅助方法 ====================

    private generateRequestId(): string {
        return `standalone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private sendSuccessResponse<T>(res: Response, data: T, requestId: string): void {
        const response: ApiResponse<T> = {
            success: true,
            data,
            timestamp: new Date().toISOString(),
            requestId
        };
        res.json(response);
    }

    private sendErrorResponse(res: Response, error: any, requestId: string, statusCode: number = 500): void {
        const response: ApiResponse = {
            success: false,
            error: {
                type: error.type || 'ERROR',
                message: error.message || String(error),
                code: error.code || 'UNKNOWN_ERROR'
            },
            timestamp: new Date().toISOString(),
            requestId
        };
        res.status(statusCode).json(response);
    }

    // ==================== 服务器控制 ====================

    /**
     * 启动服务器
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.server.listen(this.port, () => {
                    console.log('');
                    console.log('[QCE] 独立模式已启动');
                    console.log(`[QCE] Web界面: http://127.0.0.1:${this.port}/qce-v4-tool`);
                    console.log(`[QCE] 数据目录: ${this.baseDir}`);
                    console.log('[QCE] 此模式仅支持查看已导出的文件，不支持新建导出任务');
                    console.log('');
                    resolve();
                });

                this.server.on('error', (error: any) => {
                    if (error.code === 'EADDRINUSE') {
                        console.error(`[QCE] 端口 ${this.port} 已被占用`);
                    }
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 停止服务器
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => {
                console.log('[QCE] 服务器已停止');
                resolve();
            });
        });
    }
}

// 导出启动函数
export async function startStandaloneServer(port?: number): Promise<QCEStandaloneServer> {
    const server = new QCEStandaloneServer(port);
    await server.start();
    return server;
}
