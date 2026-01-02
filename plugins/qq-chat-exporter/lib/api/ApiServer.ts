
/**
 * QQ聊天记录导出工具API服务器
 * 提供完整的QQ聊天记录导出功能API
 */

import express from 'express';
import type { Request, Response, Application } from 'express';
import cors from 'cors';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

// 导入核心模块
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { BatchMessageFetcher } from '../core/fetcher/BatchMessageFetcher.js';
import { SimpleMessageParser } from '../core/parser/SimpleMessageParser.js';
import { TextExporter } from '../core/exporter/TextExporter.js';
import { JsonExporter } from '../core/exporter/JsonExporter.js';
import { ExcelExporter } from '../core/exporter/ExcelExporter.js';
import { ModernHtmlExporter } from '../core/exporter/ModernHtmlExporter.js';
import { DatabaseManager } from '../core/storage/DatabaseManager.js';
import { ResourceHandler } from '../core/resource/ResourceHandler.js';
import { ScheduledExportManager } from '../core/scheduler/ScheduledExportManager.js';
import { FrontendBuilder } from '../webui/FrontendBuilder.js';
import { SecurityManager } from '../security/SecurityManager.js';
import { StickerPackExporter } from '../core/sticker/StickerPackExporter.js';
import { streamSearchService } from '../services/StreamSearchService.js';
import { ZipExporter } from '../utils/ZipExporter.js';
import { StreamingZipExporter } from '../utils/StreamingZipExporter.js';

// 导入类型定义
import type { RawMessage } from 'NapCatQQ/src/core/types.js';
import type { 
    SystemErrorData,
    ExportTaskConfig,
    ExportTaskState
} from '../types/index.js';
import { 
    ErrorType,
    ExportTaskStatus,
    ExportFormat,
    ChatTypeSimple
} from '../types/index.js';
import { ChatType } from 'NapCatQQ/src/core/types.js';

/**
 * API响应接口
 */
interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: SystemErrorData;
    timestamp: string;
    requestId: string;
}

/**
 * 系统错误类
 */
class SystemError extends Error {
    public readonly type: ErrorType;
    public readonly code: string;
    public readonly timestamp: Date;

    constructor(type: ErrorType, message: string, code: string) {
        super(message);
        this.type = type;
        this.code = code;
        this.timestamp = new Date();
        this.name = 'SystemError';
    }
}

/**
 * QQ聊天记录导出工具API服务器
 */
export class QQChatExporterApiServer {
    private app: Application;
    private server: Server;
    private wss: WebSocketServer;
    private core: NapCatCore;
    
    // WebSocket连接管理
    private wsConnections: Set<WebSocket> = new Set();
    
    // 数据库管理器
    private dbManager: DatabaseManager;
    
    // 资源处理器
    private resourceHandler: ResourceHandler;
    
    // 定时导出管理器
    private scheduledExportManager: ScheduledExportManager;
    
    // 前端服务管理器
    private frontendBuilder: FrontendBuilder;
    
    // 安全管理器
    private securityManager: SecurityManager;
    
    // 表情包导出管理器
    private stickerPackExporter: StickerPackExporter;
    
    // 任务管理
    private exportTasks: Map<string, any> = new Map();
    
    // 任务资源处理器管理（每个任务使用独立的 ResourceHandler）
    private taskResourceHandlers: Map<string, ResourceHandler> = new Map();
    
    // 资源文件名缓存 (shortName -> fullFileName 映射)
    // 例如: "A1D18D97.jpg" -> "a1d18d97b45c620add5133050c00044c_A1D18D97.jpg"
    private resourceFileCache: Map<string, Map<string, string>> = new Map();
    
    // 消息缓存系统（用于预览和搜索，避免重复获取）
    private messageCache: Map<string, {
        messages: RawMessage[];
        lastUpdate: number;
        hasMore: boolean;
    }> = new Map();
    
    // 缓存过期时间（10分钟）
    private readonly CACHE_EXPIRE_TIME = 10 * 60 * 1000;

    /**
     * 构造函数
     */
    constructor(core: NapCatCore) {
        this.core = core;
        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        
        // 初始化数据库管理器
        const userProfile = process.env['USERPROFILE'] || process.env['HOME'] || '.';
        const dbPath = path.join(userProfile, '.qq-chat-exporter', 'tasks.db');
        this.dbManager = new DatabaseManager(dbPath);
        
        // 初始化资源处理器
        this.resourceHandler = new ResourceHandler(core, this.dbManager);
        
        // 初始化定时导出管理器
        this.scheduledExportManager = new ScheduledExportManager(core, this.dbManager, this.resourceHandler);
        
        // 初始化前端服务管理器
        this.frontendBuilder = new FrontendBuilder();
        
        // 初始化安全管理器
        this.securityManager = new SecurityManager();
        
        // 初始化表情包导出管理器
        this.stickerPackExporter = new StickerPackExporter(core);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.setupProcessHandlers();
        
        // Issue #192: 清理遗留的临时文件
        this.cleanupTempFiles();
    }
    
    /**
     * 设置进程退出处理器
     */
    private setupProcessHandlers(): void {
        // 处理正常退出
        process.on('beforeExit', async () => {
            try {
                await this.dbManager.close();
            } catch (error) {
                console.error('[QCE] 保存数据失败:', error);
            }
        });
        
        // 处理Ctrl+C
        process.on('SIGINT', async () => {
            try {
                await this.dbManager.close();
                process.exit(0);
            } catch (error) {
                console.error('[QCE] 保存数据失败:', error);
                process.exit(1);
            }
        });
        
        // 处理SIGTERM
        process.on('SIGTERM', async () => {
            try {
                await this.dbManager.close();
                process.exit(0);
            } catch (error) {
                console.error('[QCE] 保存数据失败:', error);
                process.exit(1);
            }
        });
        
        // 处理未捕获的异常
        process.on('uncaughtException', async (error) => {
            console.error('[QCE] 未捕获的异常:', error);
            try {
                await this.dbManager.close();
            } catch (saveError) {
                // 静默处理
            }
        });
    }

    /**
     * 配置中间件
     */
    private setupMiddleware(): void {
        // 信任代理配置（用于获取真实客户端IP，支持Docker/Nginx等反向代理环境）
        // 设置为true表示信任所有代理，在Docker环境下这是必要的
        this.app.set('trust proxy', true);
        
        // CORS配置
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Access-Token', 'X-Forwarded-For', 'X-Real-IP']
        }));

        // JSON解析配置
        this.app.use(express.json({ limit: '100mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '100mb' }));

        // 请求ID中间件
        this.app.use((req: Request, res: Response, next) => {
            (req as any).requestId = req.headers['x-request-id'] as string || this.generateRequestId();
            res.setHeader('X-Request-ID', (req as any).requestId);
            next();
        });

        // 日志中间件
        this.app.use((req: Request, _res: Response, next) => {
            this.core.context.logger.log(`[API] ${req.method} ${req.path}`);
            next();
        });

        // 安全认证中间件
        this.app.use((req: Request, res: Response, next: any) => {
            // 公开路由，无需认证
            const publicRoutes = [
                '/',
                '/health',
                '/auth',
                '/security-status',
                '/qce-v4-tool'
            ];
            
            // 静态资源文件（图片等）
            const staticFileExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf'];
            const isStaticFile = staticFileExtensions.some(ext => req.path.toLowerCase().endsWith(ext));
            
            const isPublicRoute = publicRoutes.some(route => {
                return req.path === route || 
                       req.path.startsWith('/static/') ||
                       req.path.startsWith('/qce-v4-tool/');
            }) || isStaticFile || 
               req.path === '/api/exports/files' || // 允许离线查看聊天记录索引
               req.path.match(/^\/api\/exports\/files\/[^\/]+\/preview$/) || // 允许预览接口公开访问
               req.path.match(/^\/api\/exports\/files\/[^\/]+\/info$/) || // 允许获取文件信息
               req.path.match(/^\/api\/exports\/files\/[^\/]+\/resources\//) || // 允许导出文件的资源访问
               req.path.startsWith('/resources/') || // 允许全局资源访问
               req.path.startsWith('/downloads/') || // 允许下载文件访问
               req.path.startsWith('/scheduled-downloads/') || // 允许定时导出文件访问
               req.path === '/download'; // 允许QQ文件下载API访问（用于图片等资源）
               // 注意：/api/download-file 需要认证，不在公开路由列表中 (Issue #192 安全修复)
            
            if (isPublicRoute) {
                return next();
            }
            
            // 检查认证令牌
            const token = req.headers.authorization?.replace('Bearer ', '') || 
                         req.query['token'] as string ||
                         req.headers['x-access-token'] as string;
            
            if (!token) {
                return res.status(401).json({
                    success: false,
                    error: {
                        type: 'AUTH_ERROR',
                        message: '需要访问令牌',
                        timestamp: new Date(),
                        context: {
                            code: 'MISSING_TOKEN',
                            requestId: (req as any).requestId
                        }
                    },
                    timestamp: new Date().toISOString(),
                    requestId: (req as any).requestId
                });
            }
            
            // 获取真实客户端IP（优先使用代理头）
            const clientIP = this.getClientIP(req);
            if (!this.securityManager.verifyToken(token, clientIP)) {
                return res.status(403).json({
                    success: false,
                    error: {
                        type: 'AUTH_ERROR',
                        message: '无效的访问令牌',
                        timestamp: new Date(),
                        context: {
                            code: 'INVALID_TOKEN',
                            requestId: (req as any).requestId
                        }
                    },
                    timestamp: new Date().toISOString(),
                    requestId: (req as any).requestId
                });
            }
            
            next();
        });
    }

    /**
     * 构建资源文件名缓存（延迟加载）
     * @param dirPath 目录路径（如 images/videos/audios）
     * @returns 文件名映射表
     */
    private buildResourceCache(dirPath: string): Map<string, string> {
        // 如果缓存已存在，直接返回
        if (this.resourceFileCache.has(dirPath)) {
            return this.resourceFileCache.get(dirPath)!;
        }

        const cache = new Map<string, string>();
        const resourcesRoot = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources');
        const fullDirPath = path.join(resourcesRoot, dirPath);

        // 检查目录是否存在
        if (!fs.existsSync(fullDirPath)) {
            this.resourceFileCache.set(dirPath, cache);
            return cache;
        }

        try {
            // 一次性读取所有文件名
            const files = fs.readdirSync(fullDirPath);
            
            for (const fileName of files) {
                // 跳过目录
                const fullPath = path.join(fullDirPath, fileName);
                if (!fs.statSync(fullPath).isFile()) {
                    continue;
                }

                // 检查是否是带MD5前缀的文件名格式: md5_originalName.ext
                const underscoreIndex = fileName.indexOf('_');
                if (underscoreIndex > 0) {
                    // 提取原始短文件名
                    const shortName = fileName.substring(underscoreIndex + 1);
                    cache.set(shortName, fileName);
                    // console.log(`[ApiServer] 缓存映射: ${shortName} -> ${fileName}`);
                }
                
                // 同时存储完整文件名，支持直接访问
                cache.set(fileName, fileName);
            }

            // 静默构建缓存
        } catch (error) {
            // 静默处理
        }

        // 保存到缓存
        this.resourceFileCache.set(dirPath, cache);
        return cache;
    }

    /**
     * 快速查找资源文件（O(1)时间复杂度）
     * @param resourcePath 资源相对路径，如 images/xxx.jpg
     * @returns 实际文件的完整路径，不存在则返回null
     */
    private findResourceFile(resourcePath: string): string | null {
        const resourcesRoot = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources');
        const dirPath = path.dirname(resourcePath);
        const shortFileName = path.basename(resourcePath);

        // 延迟加载：第一次访问该目录时才构建缓存
        const cache = this.buildResourceCache(dirPath);

        // O(1) 查找
        const actualFileName = cache.get(shortFileName);
        if (!actualFileName) {
            return null;
        }

        return path.join(resourcesRoot, dirPath, actualFileName);
    }

    /**
     * 清除资源文件缓存（当检测到文件变化时调用）
     */
    private clearResourceCache(dirPath?: string): void {
        if (dirPath) {
            this.resourceFileCache.delete(dirPath);
        } else {
            this.resourceFileCache.clear();
        }
    }

    /**
     * 格式化JSON数据为带颜色的HTML字符串
     */
    private formatJsonForDisplay(obj: any, indent: number = 0): string {
        const spaces = '  '.repeat(indent);
        const nextSpaces = '  '.repeat(indent + 1);

        if (obj === null) {
            return `<span class="json-null">null</span>`;
        }
        
        if (typeof obj === 'string') {
            return `<span class="json-string">"${this.escapeHtml(obj)}"</span>`;
        }
        
        if (typeof obj === 'number') {
            return `<span class="json-number">${obj}</span>`;
        }
        
        if (typeof obj === 'boolean') {
            return `<span class="json-boolean">${obj}</span>`;
        }
        
        if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]';
            const items = obj.map(item => `${nextSpaces}${this.formatJsonForDisplay(item, indent + 1)}`).join(',\n');
            return `[\n${items}\n${spaces}]`;
        }
        
        if (typeof obj === 'object') {
            const keys = Object.keys(obj);
            if (keys.length === 0) return '{}';
            const items = keys.map(key => {
                const value = this.formatJsonForDisplay(obj[key], indent + 1);
                return `${nextSpaces}<span class="json-key">"${this.escapeHtml(key)}"</span>: ${value}`;
            }).join(',\n');
            return `{\n${items}\n${spaces}}`;
        }
        
        return String(obj);
    }

    /**
     * HTML转义
     */
    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#39;');
    }

    /**
     * 生成群精华消息 HTML
     */
    private generateEssenceHtml(groupName: string, groupCode: string, messages: any[]): string {
        const messagesHtml = messages.map(msg => {
            const contentHtml = msg.content.map((c: any) => {
                if (c.type === 'text') {
                    return `<span class="text">${this.escapeHtml(c.text || '')}</span>`;
                } else if (c.type === 'image') {
                    return `<img src="${this.escapeHtml(c.url || '')}" alt="图片" class="essence-image" loading="lazy" />`;
                }
                return '';
            }).join('');

            return `
            <div class="essence-item">
                <div class="essence-header">
                    <img src="https://q1.qlogo.cn/g?b=qq&nk=${msg.senderUin}&s=40" alt="头像" class="avatar" />
                    <div class="sender-info">
                        <span class="sender-nick">${this.escapeHtml(msg.senderNick || '')}</span>
                        <span class="sender-uin">(${msg.senderUin})</span>
                    </div>
                    <span class="send-time">${msg.senderTimeFormatted}</span>
                </div>
                <div class="essence-content">${contentHtml}</div>
                <div class="essence-footer">
                    <span class="digest-info">由 ${this.escapeHtml(msg.addDigestNick || '')} 设为精华</span>
                    <span class="digest-time">${msg.addDigestTimeFormatted}</span>
                </div>
            </div>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(groupName)} - 群精华消息</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }
        .header h1 {
            font-size: 24px;
            color: #1a1a2e;
            margin-bottom: 8px;
        }
        .header .meta {
            color: #666;
            font-size: 14px;
        }
        .essence-item {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
            transition: transform 0.2s;
        }
        .essence-item:hover {
            transform: translateY(-2px);
        }
        .essence-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
        }
        .sender-info {
            flex: 1;
        }
        .sender-nick {
            font-weight: 600;
            color: #1a1a2e;
        }
        .sender-uin {
            color: #999;
            font-size: 12px;
            margin-left: 4px;
        }
        .send-time {
            color: #999;
            font-size: 12px;
        }
        .essence-content {
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            line-height: 1.6;
            color: #333;
        }
        .essence-content .text {
            white-space: pre-wrap;
            word-break: break-word;
        }
        .essence-image {
            max-width: 100%;
            max-height: 300px;
            border-radius: 8px;
            margin: 8px 0;
            cursor: pointer;
        }
        .essence-footer {
            display: flex;
            justify-content: space-between;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
        }
        .digest-info {
            color: #667eea;
        }
        @media (max-width: 600px) {
            body { padding: 10px; }
            .header { padding: 16px; }
            .essence-item { padding: 12px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📌 ${this.escapeHtml(groupName)}</h1>
            <div class="meta">群号: ${groupCode} | 共 ${messages.length} 条精华消息 | 导出时间: ${new Date().toLocaleString('zh-CN')}</div>
        </div>
        ${messagesHtml}
    </div>
</body>
</html>`;
    }

    /**
     * 配置路由
     */
    private setupRoutes(): void {
        // 根路由 - API信息
        this.app.get('/', (req, res) => {
            const frontendStatus = this.frontendBuilder.getStatus();
            this.sendSuccessResponse(res, {
                name: 'QQ聊天记录导出工具API',
                version: '5.0.0',
                description: '提供完整的QQ聊天记录导出功能API',
                endpoints: {
                    '基础信息': [
                        'GET / - API信息',
                        'GET /health - 健康检查'
                    ],
                    '群组管理': [
                        'GET /api/groups?page=1&limit=999&forceRefresh=false - 获取所有群组（支持分页）',
                        'GET /api/groups/:groupCode?forceRefresh=false - 获取群组详情',
                        'GET /api/groups/:groupCode/members?forceRefresh=false - 获取群成员',
                        'GET /api/groups/:groupCode/essence - 获取群精华消息列表',
                        'POST /api/groups/:groupCode/essence/export - 导出群精华消息'
                    ],
                    '好友管理': [
                        'GET /api/friends?page=1&limit=999 - 获取所有好友（支持分页）',
                        'GET /api/friends/:uid?no_cache=false - 获取好友详情'
                    ],
                    '消息处理': [
                        'POST /api/messages/fetch - 批量获取消息',
                        'POST /api/messages/export - 导出消息（支持过滤纯图片消息）'
                    ],
                    '任务管理': [
                        'GET /api/tasks - 获取所有导出任务',
                        'GET /api/tasks/:taskId - 获取指定任务状态',
                        'DELETE /api/tasks/:taskId - 删除任务',
                        'DELETE /api/tasks/:taskId/original-files - 删除ZIP导出的原始文件'
                    ],
                    '用户信息': [
                        'GET /api/users/:uid - 获取用户信息'
                    ],
                    '系统信息': [
                        'GET /api/system/info - 系统信息',
                        'GET /api/system/status - 系统状态'
                    ],
                    '前端应用': [
                        'GET /qce-v4-tool - Web界面入口'
                    ],
                    '表情包管理': [
                        'GET /api/sticker-packs?types=favorite_emoji,market_pack,system_pack - 获取表情包（可选类型筛选）',
                        'POST /api/sticker-packs/export - 导出指定表情包',
                        'POST /api/sticker-packs/export-all - 导出所有表情包',
                        'GET /api/sticker-packs/export-records?limit=50 - 获取导出记录'
                    ]
                },
                websocket: 'ws://localhost:40653',
                frontend: {
                    url: frontendStatus.mode === 'production' ? 'http://localhost:40653/qce-v4-tool' : frontendStatus.frontendUrl,
                    mode: frontendStatus.mode,
                    status: frontendStatus.isRunning ? 'running' : 'stopped'
                },
                documentation: '详见项目根目录API.md'
            }, (req as any).requestId);
        });

        // 健康检查
        this.app.get('/health', (req, res) => {
            this.sendSuccessResponse(res, {
                status: 'healthy',
                online: this.core.selfInfo?.online || false,
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            }, (req as any).requestId);
        });

        // 安全状态检查
        this.app.get('/security-status', (req, res) => {
            const status = this.securityManager.getSecurityStatus();
            this.sendSuccessResponse(res, {
                ...status,
                requiresAuth: true,
                serverIP: this.securityManager.getPublicIP(),
                isDocker: this.securityManager.isInDocker(),
                ipWhitelistDisabled: this.securityManager.isIPWhitelistDisabled(),
                allowedIPs: this.securityManager.getAllowedIPs(),
                currentClientIP: this.getClientIP(req),
                configPath: this.securityManager.getConfigPath()
            }, (req as any).requestId);
        });

        // 认证验证端点
        this.app.post('/auth', (req, res) => {
            const { token } = req.body;
            const clientIP = this.getClientIP(req);
            
            if (!token) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, '缺少访问令牌', 'MISSING_TOKEN'), (req as any).requestId, 400);
            }
            
            const isValid = this.securityManager.verifyToken(token, clientIP);
            if (isValid) {
                this.sendSuccessResponse(res, {
                    authenticated: true,
                    message: '认证成功',
                    serverIP: this.securityManager.getPublicIP(),
                    clientIP: clientIP // 返回检测到的客户端IP，便于调试
                }, (req as any).requestId);
            } else {
                return this.sendErrorResponse(res, new SystemError(ErrorType.AUTH_ERROR, '无效的访问令牌', 'INVALID_TOKEN'), (req as any).requestId, 403);
            }
        });

        // 更新服务器地址配置
        this.app.post('/api/server/host', async (req, res) => {
            try {
                const { host } = req.body;
                
                if (!host || typeof host !== 'string') {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, '服务器地址不能为空', 'INVALID_HOST'), (req as any).requestId, 400);
                }
                
                await this.securityManager.updateServerHost(host);
                
                this.sendSuccessResponse(res, {
                    message: '服务器地址更新成功',
                    serverAddresses: this.securityManager.getServerAddresses()
                }, (req as any).requestId);
            } catch (error) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.CONFIG_ERROR, '更新服务器地址失败', 'UPDATE_HOST_FAILED'), (req as any).requestId);
            }
        });

        // ==================== IP白名单管理API ====================
        
        // 获取IP白名单配置
        this.app.get('/api/security/ip-whitelist', (req, res) => {
            this.sendSuccessResponse(res, {
                allowedIPs: this.securityManager.getAllowedIPs(),
                disabled: this.securityManager.isIPWhitelistDisabled(),
                isDocker: this.securityManager.isInDocker(),
                configPath: this.securityManager.getConfigPath(),
                currentClientIP: this.getClientIP(req)
            }, (req as any).requestId);
        });
        
        // 添加IP到白名单
        this.app.post('/api/security/ip-whitelist', async (req, res) => {
            try {
                const { ip } = req.body;
                
                if (!ip || typeof ip !== 'string') {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, 'IP地址不能为空', 'INVALID_IP'), (req as any).requestId, 400);
                }
                
                await this.securityManager.addAllowedIP(ip);
                
                this.sendSuccessResponse(res, {
                    message: `IP ${ip} 已添加到白名单`,
                    allowedIPs: this.securityManager.getAllowedIPs()
                }, (req as any).requestId);
            } catch (error) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.CONFIG_ERROR, '添加IP失败', 'ADD_IP_FAILED'), (req as any).requestId);
            }
        });
        
        // 从白名单移除IP
        this.app.delete('/api/security/ip-whitelist', async (req, res) => {
            try {
                const { ip } = req.body;
                
                if (!ip || typeof ip !== 'string') {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, 'IP地址不能为空', 'INVALID_IP'), (req as any).requestId, 400);
                }
                
                const removed = await this.securityManager.removeAllowedIP(ip);
                
                if (removed) {
                    this.sendSuccessResponse(res, {
                        message: `IP ${ip} 已从白名单移除`,
                        allowedIPs: this.securityManager.getAllowedIPs()
                    }, (req as any).requestId);
                } else {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, `IP ${ip} 不在白名单中`, 'IP_NOT_FOUND'), (req as any).requestId, 404);
                }
            } catch (error) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.CONFIG_ERROR, '移除IP失败', 'REMOVE_IP_FAILED'), (req as any).requestId);
            }
        });
        
        // 启用/禁用IP白名单验证
        this.app.put('/api/security/ip-whitelist/toggle', async (req, res) => {
            try {
                const { disabled } = req.body;
                
                if (typeof disabled !== 'boolean') {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, 'disabled参数必须是布尔值', 'INVALID_PARAM'), (req as any).requestId, 400);
                }
                
                await this.securityManager.setDisableIPWhitelist(disabled);
                
                this.sendSuccessResponse(res, {
                    message: `IP白名单验证已${disabled ? '禁用' : '启用'}`,
                    disabled: this.securityManager.isIPWhitelistDisabled()
                }, (req as any).requestId);
            } catch (error) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.CONFIG_ERROR, '更新配置失败', 'UPDATE_CONFIG_FAILED'), (req as any).requestId);
            }
        });
        
        // 快速添加当前客户端IP到白名单
        this.app.post('/api/security/ip-whitelist/add-current', async (req, res) => {
            try {
                const clientIP = this.getClientIP(req);
                
                if (!clientIP) {
                    return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, '无法获取客户端IP', 'NO_CLIENT_IP'), (req as any).requestId, 400);
                }
                
                await this.securityManager.addAllowedIP(clientIP);
                
                this.sendSuccessResponse(res, {
                    message: `当前IP ${clientIP} 已添加到白名单`,
                    clientIP,
                    allowedIPs: this.securityManager.getAllowedIPs()
                }, (req as any).requestId);
            } catch (error) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.CONFIG_ERROR, '添加IP失败', 'ADD_IP_FAILED'), (req as any).requestId);
            }
        });

        // ==================== 系统信息API ====================

        // 系统信息
        this.app.get('/api/system/info', (req, res) => {
            const selfInfo = this.core.selfInfo;
            const avatarUrl = selfInfo?.avatarUrl || (selfInfo?.uin ? `https://q1.qlogo.cn/g?b=qq&nk=${selfInfo.uin}&s=640` : null);
            
            this.sendSuccessResponse(res, {
                name: 'QQChatExporter V5 / https://github.com/shuakami/qq-chat-exporter',
                copyright: '本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~',
                version: '5.0.0',
                napcat: {
                    version: 'unknown',
                    online: selfInfo?.online || false,
                    selfInfo: {
                        uid: selfInfo?.uid || '',
                        uin: selfInfo?.uin || '',
                        nick: selfInfo?.nick || '',
                        avatarUrl,
                        longNick: selfInfo?.longNick || '',
                        sex: selfInfo?.sex || null,
                        age: selfInfo?.age || null,
                        qqLevel: selfInfo?.qqLevel || null,
                        vipFlag: selfInfo?.vipFlag || false,
                        svipFlag: selfInfo?.svipFlag || false,
                        vipLevel: selfInfo?.vipLevel || 0
                    }
                },
                runtime: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    arch: process.arch,
                    uptime: process.uptime(),
                    memory: process.memoryUsage()
                }
            }, (req as any).requestId);
        });

        // 系统状态
        this.app.get('/api/system/status', (req, res) => {
            this.sendSuccessResponse(res, {
                online: this.core.selfInfo?.online || false,
                websocketConnections: this.wsConnections.size,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            }, (req as any).requestId);
        });

        // 获取所有群组
        this.app.get('/api/groups', async (req, res) => {
            try {
                const forceRefresh = req.query['forceRefresh'] === 'true';
                const page = parseInt(req.query['page'] as string) || 1;
                const limit = parseInt(req.query['limit'] as string) || 999;
                
                const groups = await this.core.apis.GroupApi.getGroups(forceRefresh);
                
                // 添加头像信息并分页
                const groupsWithAvatars = groups.map(group => ({
                    groupCode: group.groupCode,
                    groupName: group.groupName,
                    memberCount: group.memberCount,
                    maxMember: group.maxMember,
                    remark: null,
                    avatarUrl: `https://p.qlogo.cn/gh/${group.groupCode}/${group.groupCode}/640/`
                }));
                
                // 分页处理
                const startIndex = (page - 1) * limit;
                const endIndex = startIndex + limit;
                const paginatedGroups = groupsWithAvatars.slice(startIndex, endIndex);
                
                this.sendSuccessResponse(res, {
                    groups: paginatedGroups,
                    totalCount: groupsWithAvatars.length,
                    currentPage: page,
                    totalPages: Math.ceil(groupsWithAvatars.length / limit),
                    hasNext: endIndex < groupsWithAvatars.length,
                    hasPrev: page > 1
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取群组详情
        this.app.get('/api/groups/:groupCode', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }
                
                const groupDetail = await this.core.apis.GroupApi.fetchGroupDetail(groupCode);
                
                if (!groupDetail) {
                    throw new SystemError(ErrorType.API_ERROR, '群组不存在', 'GROUP_NOT_FOUND');
                }

                this.sendSuccessResponse(res, groupDetail, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取群成员
        this.app.get('/api/groups/:groupCode/members', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }
                
                const forceRefresh = req.query['forceRefresh'] === 'true';
                
                const result = await this.core.apis.GroupApi.getGroupMemberAll(groupCode, forceRefresh);
                const members = Array.from(result.result.infos.values());
                
                this.sendSuccessResponse(res, members, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取群精华消息列表
        this.app.get('/api/groups/:groupCode/essence', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }

                const essenceList = await this.core.apis.WebApi.getGroupEssenceMsgAll(groupCode);
                
                if (!essenceList || essenceList.length === 0) {
                    this.sendSuccessResponse(res, {
                        messages: [],
                        totalCount: 0,
                        groupCode
                    }, (req as any).requestId);
                    return;
                }

                const messages = essenceList
                    .flatMap(e => e?.data?.msg_list || [])
                    .filter(Boolean)
                    .map(msg => ({
                        msgSeq: msg.msg_seq,
                        msgRandom: msg.msg_random,
                        senderUin: msg.sender_uin,
                        senderNick: msg.sender_nick,
                        senderTime: msg.sender_time,
                        addDigestUin: msg.add_digest_uin,
                        addDigestNick: msg.add_digest_nick,
                        addDigestTime: msg.add_digest_time,
                        content: msg.msg_content?.map((c: any) => {
                            if (c.msg_type === 1) {
                                return { type: 'text', text: c.text };
                            } else if (c.msg_type === 3) {
                                return { type: 'image', url: c.image_url };
                            }
                            return { type: 'unknown', data: c };
                        }) || [],
                        canBeRemoved: msg.can_be_removed
                    }));

                this.sendSuccessResponse(res, {
                    messages,
                    totalCount: messages.length,
                    groupCode
                }, (req as any).requestId);
            } catch (error) {
                this.core.context.logger.logError('[ApiServer] 获取群精华消息失败:', error);
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 导出群精华消息
        this.app.post('/api/groups/:groupCode/essence/export', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }

                const { format = 'json' } = req.body;
                
                const groups = await this.core.apis.GroupApi.getGroups(false);
                const groupInfo = groups.find(g => g.groupCode === groupCode);
                const groupName = groupInfo?.groupName || `群${groupCode}`;

                const essenceList = await this.core.apis.WebApi.getGroupEssenceMsgAll(groupCode);
                
                if (!essenceList || essenceList.length === 0) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '该群没有精华消息', 'NO_ESSENCE_MESSAGES');
                }

                const messages = essenceList
                    .flatMap(e => e?.data?.msg_list || [])
                    .filter(Boolean)
                    .map(msg => ({
                        msgSeq: msg.msg_seq,
                        msgRandom: msg.msg_random,
                        senderUin: msg.sender_uin,
                        senderNick: msg.sender_nick,
                        senderTime: msg.sender_time,
                        senderTimeFormatted: new Date(msg.sender_time * 1000).toLocaleString('zh-CN'),
                        addDigestUin: msg.add_digest_uin,
                        addDigestNick: msg.add_digest_nick,
                        addDigestTime: msg.add_digest_time,
                        addDigestTimeFormatted: new Date(msg.add_digest_time * 1000).toLocaleString('zh-CN'),
                        content: msg.msg_content?.map((c: any) => {
                            if (c.msg_type === 1) {
                                return { type: 'text', text: c.text };
                            } else if (c.msg_type === 3) {
                                return { type: 'image', url: c.image_url };
                            }
                            return { type: 'unknown', data: c };
                        }) || [],
                        canBeRemoved: msg.can_be_removed
                    }));

                const exportDir = path.join(
                    process.env['USERPROFILE'] || process.cwd(),
                    '.qq-chat-exporter',
                    'exports',
                    'essence'
                );
                if (!fs.existsSync(exportDir)) {
                    fs.mkdirSync(exportDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const safeGroupName = groupName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
                
                let filePath: string;
                let fileName: string;
                let fileContent: string;

                if (format === 'html') {
                    fileName = `${safeGroupName}_${groupCode}_essence_${timestamp}.html`;
                    filePath = path.join(exportDir, fileName);
                    
                    const htmlContent = this.generateEssenceHtml(groupName, groupCode, messages);
                    fileContent = htmlContent;
                } else {
                    fileName = `${safeGroupName}_${groupCode}_essence_${timestamp}.json`;
                    filePath = path.join(exportDir, fileName);
                    
                    fileContent = JSON.stringify({
                        groupCode,
                        groupName,
                        exportTime: new Date().toISOString(),
                        totalCount: messages.length,
                        messages
                    }, null, 2);
                }

                fs.writeFileSync(filePath, fileContent, 'utf-8');
                const stats = fs.statSync(filePath);

                this.sendSuccessResponse(res, {
                    success: true,
                    groupCode,
                    groupName,
                    totalCount: messages.length,
                    format,
                    fileName,
                    filePath,
                    fileSize: stats.size,
                    downloadUrl: `/downloads/essence/${fileName}`
                }, (req as any).requestId);
            } catch (error) {
                this.core.context.logger.logError('[ApiServer] 导出群精华消息失败:', error);
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        
        // 导出群成员头像
        this.app.post('/api/groups/:groupCode/avatars/export', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }

                // 获取群成员列表
                const result = await this.core.apis.GroupApi.getGroupMemberAll(groupCode, true);
                const members = Array.from(result.result.infos.values());

                if (members.length === 0) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群成员列表为空', 'EMPTY_MEMBERS');
                }

                // 获取群信息
                const groups = await this.core.apis.GroupApi.getGroups(false);
                const groupInfo = groups.find(g => g.groupCode === groupCode);
                const groupName = groupInfo?.groupName || groupCode;

                // 创建导出目录
                const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports', 'avatars');
                if (!fs.existsSync(exportDir)) {
                    fs.mkdirSync(exportDir, { recursive: true });
                }

                // 创建临时目录存放头像
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const safeGroupName = groupName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
                const tempDir = path.join(exportDir, `${safeGroupName}_${groupCode}_${timestamp}`);
                fs.mkdirSync(tempDir, { recursive: true });

                // 下载头像
                let successCount = 0;
                let failCount = 0;
                const https = await import('https');
                const http = await import('http');

                for (const member of members) {
                    try {
                        const uin = (member as any).uin || (member as any).uid;
                        if (!uin) continue;

                        const nick = (member as any).nick || (member as any).cardName || uin;
                        const safeNick = String(nick).replace(/[<>:"/\\|?*]/g, '_').slice(0, 30);
                        const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                        const filePath = path.join(tempDir, `${safeNick}_${uin}.jpg`);

                        // 下载头像
                        await new Promise<void>((resolve, reject) => {
                            const file = fs.createWriteStream(filePath);
                            const protocol = avatarUrl.startsWith('https') ? https : http;
                            
                            protocol.get(avatarUrl, (response) => {
                                if (response.statusCode === 301 || response.statusCode === 302) {
                                    const redirectUrl = response.headers.location;
                                    if (redirectUrl) {
                                        const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                                        redirectProtocol.get(redirectUrl, (redirectResponse) => {
                                            redirectResponse.pipe(file);
                                            file.on('finish', () => {
                                                file.close();
                                                resolve();
                                            });
                                        }).on('error', reject);
                                    } else {
                                        reject(new Error('Redirect without location'));
                                    }
                                } else {
                                    response.pipe(file);
                                    file.on('finish', () => {
                                        file.close();
                                        resolve();
                                    });
                                }
                            }).on('error', (err) => {
                                fs.unlink(filePath, () => {});
                                reject(err);
                            });
                        });

                        successCount++;
                    } catch (err) {
                        failCount++;
                        console.warn(`[ApiServer] 下载头像失败:`, err);
                    }
                }

                // 创建ZIP文件
                const zipFileName = `${safeGroupName}_${groupCode}_avatars_${timestamp}.zip`;
                const zipFilePath = path.join(exportDir, zipFileName);

                // 使用archiver创建ZIP
                const archiver = (await import('archiver')).default;
                const output = fs.createWriteStream(zipFilePath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                await new Promise<void>((resolve, reject) => {
                    output.on('close', () => resolve());
                    archive.on('error', (err) => reject(err));
                    archive.pipe(output);
                    archive.directory(tempDir, false);
                    archive.finalize();
                });

                // 删除临时目录
                fs.rmSync(tempDir, { recursive: true, force: true });

                const stats = fs.statSync(zipFilePath);

                this.sendSuccessResponse(res, {
                    success: true,
                    groupCode,
                    groupName,
                    totalMembers: members.length,
                    successCount,
                    failCount,
                    fileName: zipFileName,
                    filePath: zipFilePath,
                    fileSize: stats.size,
                    downloadUrl: `/downloads/avatars/${zipFileName}`
                }, (req as any).requestId);

            } catch (error) {
                console.error('[ApiServer] 导出群头像失败:', error);
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取所有好友
        this.app.get('/api/friends', async (req, res) => {
            try {
                const page = parseInt(req.query['page'] as string) || 1;
                const limit = parseInt(req.query['limit'] as string) || 999;
                
                const friends = await this.core.apis.FriendApi.getBuddy();
                
                // 添加头像信息并分页
                const friendsWithAvatars = friends.map(friend => ({
                    uid: friend.uid || friend.coreInfo?.uid,
                    uin: friend.uin || friend.coreInfo?.uin,
                    nick: friend.coreInfo?.nick || friend.coreInfo?.uin || friend.uin || 'unknown',
                    remark: friend.coreInfo?.remark || null,
                    avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${friend.coreInfo?.uin || friend.uin}&s=640`,
                    isOnline: friend.status?.status === 1,
                    status: friend.status?.status || 0,
                    categoryId: friend.baseInfo?.categoryId || 1
                }));
                
                // 分页处理
                const startIndex = (page - 1) * limit;
                const endIndex = startIndex + limit;
                const paginatedFriends = friendsWithAvatars.slice(startIndex, endIndex);
                
                this.sendSuccessResponse(res, {
                    friends: paginatedFriends,
                    totalCount: friendsWithAvatars.length,
                    currentPage: page,
                    totalPages: Math.ceil(friendsWithAvatars.length / limit),
                    hasNext: endIndex < friendsWithAvatars.length,
                    hasPrev: page > 1
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取好友详情
        this.app.get('/api/friends/:uid', async (req, res) => {
            try {
                const { uid } = req.params;
                if (!uid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'UID不能为空', 'INVALID_UID');
                }
                
                const no_cache = req.query['no_cache'] === 'true';
                
                const friendDetail = await this.core.apis.UserApi.getUserDetailInfo(uid, no_cache);
                this.sendSuccessResponse(res, friendDetail, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取用户信息
        this.app.get('/api/users/:uid', async (req, res) => {
            try {
                const { uid } = req.params;
                if (!uid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'UID不能为空', 'INVALID_UID');
                }
                
                const no_cache = req.query['no_cache'] === 'true';
                
                const userInfo = await this.core.apis.UserApi.getUserDetailInfo(uid, no_cache);
                this.sendSuccessResponse(res, userInfo, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 批量获取消息
        this.app.post('/api/messages/fetch', async (req, res) => {
            try {
                const { peer, filter, batchSize = 5000, page = 1, limit = 50 } = req.body;

                if (!peer || !peer.chatType || !peer.peerUid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'peer参数不完整', 'INVALID_PEER');
                }

                if (filter?.startTime && filter?.endTime) {
                    const startTs = Number(filter.startTime);
                    const endTs = Number(filter.endTime);
                    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
                        throw new SystemError(ErrorType.VALIDATION_ERROR, '时间范围参数无效', 'INVALID_TIME_RANGE');
                    }
                    if (endTs < startTs) {
                        throw new SystemError(ErrorType.VALIDATION_ERROR, '结束时间不能早于开始时间', 'INVALID_TIME_RANGE');
                    }
                }

                // 生成缓存key（基于peer和时间范围）
                const cacheKey = `${peer.chatType}_${peer.peerUid}_${filter?.startTime || 0}_${filter?.endTime || Date.now()}`;
                
                // 检查缓存
                let cached = this.messageCache.get(cacheKey);
                const now = Date.now();
                
                // 如果缓存过期，清除
                if (cached && (now - cached.lastUpdate > this.CACHE_EXPIRE_TIME)) {
                    this.messageCache.delete(cacheKey);
                    cached = undefined;
                }
                
                let allMessages: RawMessage[] = [];
                let hasMore = false;
                
                // 如果有缓存，检查是否足够
                if (cached) {
                    allMessages = [...cached.messages];
                    hasMore = cached.hasMore;
                    
                    const startIndex = (page - 1) * limit;
                    const endIndex = startIndex + limit;
                    
                    // 如果缓存足够当前页
                    if (allMessages.length > endIndex) {
                        // 缓存有富余，可以直接返回
                        const hasNextValue = hasMore;
                        
                        const paginatedMessages = allMessages.slice(startIndex, endIndex);
                        
                        this.sendSuccessResponse(res, {
                            messages: paginatedMessages,
                            totalCount: allMessages.length,
                            currentPage: page,
                            totalPages: Math.ceil(allMessages.length / limit),
                            hasNext: hasNextValue,
                            cacheHit: true,
                            fetchedAt: new Date().toISOString()
                        }, (req as any).requestId);
                        return;
                    } else if (allMessages.length === endIndex && !hasMore) {
                        // 刚好用完且没有更多，返回最后一页
                        
                        const paginatedMessages = allMessages.slice(startIndex, endIndex);
                        
                        this.sendSuccessResponse(res, {
                            messages: paginatedMessages,
                            totalCount: allMessages.length,
                            currentPage: page,
                            totalPages: Math.ceil(allMessages.length / limit),
                            hasNext: false,
                            cacheHit: true,
                            fetchedAt: new Date().toISOString()
                        }, (req as any).requestId);
                        return;
                    } else if (allMessages.length === endIndex && hasMore) {
                        // 刚好用完但还有更多，继续加载
                    }
                    
                    // 缓存不够但hasMore=false，说明已经是全部消息了
                    if (!hasMore) {
                        
                        const paginatedMessages = allMessages.slice(startIndex, endIndex);
                        
                        this.sendSuccessResponse(res, {
                            messages: paginatedMessages,
                            totalCount: allMessages.length,
                            currentPage: page,
                            totalPages: Math.ceil(allMessages.length / limit),
                            hasNext: false,
                            cacheHit: true,
                            fetchedAt: new Date().toISOString()
                        }, (req as any).requestId);
                        return;
                    }
                    
                    // 缓存不够且hasMore=true，继续加载
                }
                
                // 需要获取更多消息（懒加载）
                
                const fetcher = new BatchMessageFetcher(this.core, {
                    batchSize,
                    timeout: 30000,
                    retryCount: 3
                });
                
                const messageGenerator = fetcher.fetchAllMessagesInTimeRange(
                    peer,
                    filter?.startTime ? filter.startTime : 0,
                    filter?.endTime ? filter.endTime : Date.now()
                );
                
                const targetCount = page * limit + limit * 10; // 多获取10页，减少请求次数
                let batchCount = 0;
                let generatorExhausted = false;
                
                for await (const batch of messageGenerator) {
                    batchCount++;
                    
                    // 跳过已有的消息
                    const newMessages = batch.filter(msg => 
                        !allMessages.some(m => m.msgId === msg.msgId)
                    );
                    
                    if (newMessages.length > 0) {
                        allMessages.push(...newMessages);
                    }
                    
                    // 足够了就停止
                    if (allMessages.length >= targetCount) {
                        hasMore = true;
                        break;
                    }
                }
                
                // 如果生成器自然结束（没有break），说明没有更多消息了
                if (!hasMore) {
                    generatorExhausted = true;
                }
                
                // 按时间戳排序
                allMessages.sort((a, b) => Number(b.msgTime) - Number(a.msgTime));
                
                // 更新缓存
                this.messageCache.set(cacheKey, {
                    messages: allMessages,
                    lastUpdate: Date.now(),
                    hasMore
                });
                
                // 分页处理
                const startIndex = (page - 1) * limit;
                const endIndex = startIndex + limit;
                const paginatedMessages = allMessages.slice(startIndex, endIndex);
                
                this.sendSuccessResponse(res, {
                    messages: paginatedMessages,
                    totalCount: allMessages.length,
                    currentPage: page,
                    totalPages: Math.ceil(allMessages.length / limit),
                    hasNext: allMessages.length > endIndex || hasMore,
                    cacheHit: !!cached,
                    fetchedAt: new Date().toISOString()
                }, (req as any).requestId);
                
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取所有任务
        this.app.get('/api/tasks', async (req, res) => {
            try {
                const tasks = Array.from(this.exportTasks.values()).map(task => ({
                    id: task.taskId,
                    peer: task.peer,
                    sessionName: task.sessionName || task.peer.peerUid, // 直接使用已保存的会话名称
                    status: task.status,
                    progress: task.progress,
                    format: task.format,
                    messageCount: task.messageCount,
                    fileName: task.fileName,
                    filePath: task.filePath,
                    fileSize: task.fileSize,
                    downloadUrl: task.downloadUrl,
                    createdAt: task.createdAt,
                    completedAt: task.completedAt,
                    error: task.error,
                    startTime: task.filter?.startTime,
                    endTime: task.filter?.endTime,
                    isZipExport: task.isZipExport,
                    originalFilePath: task.originalFilePath
                })).sort((a, b) => {
                    // 按创建时间倒序排列（最新的任务在前面）
                    const aTime = new Date(a.createdAt).getTime();
                    const bTime = new Date(b.createdAt).getTime();
                    return bTime - aTime;
                });
                
                this.sendSuccessResponse(res, { tasks }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取指定任务
        this.app.get('/api/tasks/:taskId', async (req, res) => {
            try {
                const { taskId } = req.params;
                const task = this.exportTasks.get(taskId);
                
                if (!task) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '任务不存在', 'TASK_NOT_FOUND');
                }
                
                this.sendSuccessResponse(res, {
                    id: task.taskId,
                    peer: task.peer,
                    sessionName: task.sessionName || task.peer.peerUid, // 直接使用已保存的会话名称
                    status: task.status,
                    progress: task.progress,
                    format: task.format,
                    messageCount: task.messageCount,
                    fileName: task.fileName,
                    downloadUrl: task.downloadUrl,
                    createdAt: task.createdAt,
                    completedAt: task.completedAt,
                    error: task.error,
                    startTime: task.filter?.startTime,
                    endTime: task.filter?.endTime
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 删除任务
        this.app.delete('/api/tasks/:taskId', async (req, res) => {
            try {
                const { taskId } = req.params;
                
                if (!this.exportTasks.has(taskId)) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '任务不存在', 'TASK_NOT_FOUND');
                }
                
                // 1. 清理任务的资源处理器（如果存在）
                const resourceHandler = this.taskResourceHandlers.get(taskId);
                if (resourceHandler) {
                    await resourceHandler.cleanup();
                    this.taskResourceHandlers.delete(taskId);
                }
                
                // 2. 从内存中删除
                this.exportTasks.delete(taskId);
                
                // 3. 从数据库中删除
                try {
                    await this.dbManager.deleteTask(taskId);
                } catch (dbError) {
                    // 继续执行，不因数据库删除失败而影响响应
                }
                
                this.sendSuccessResponse(res, { message: '任务已彻底删除' }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 删除ZIP导出任务的原始文件
        this.app.delete('/api/tasks/:taskId/original-files', async (req, res) => {
            try {
                const { taskId } = req.params;
                
                if (!this.exportTasks.has(taskId)) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '任务不存在', 'TASK_NOT_FOUND');
                }
                
                const task = this.exportTasks.get(taskId);
                
                // 检查任务是否为ZIP导出
                if (!task.isZipExport) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '该任务不是ZIP导出，无需删除原始文件', 'NOT_ZIP_EXPORT');
                }
                
                // 检查是否有原始文件路径
                if (!task.originalFilePath) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '未找到原始文件路径', 'NO_ORIGINAL_FILE');
                }
                
                // 调用ZipExporter删除原始文件
                const success = await ZipExporter.deleteOriginalFiles(task.originalFilePath);
                
                if (success) {
                    // 更新任务状态，移除originalFilePath
                    await this.updateTaskStatus(taskId, {
                        originalFilePath: undefined
                    });
                    
                    this.sendSuccessResponse(res, { 
                        message: '原始文件已删除',
                        deleted: true
                    }, (req as any).requestId);
                } else {
                    throw new SystemError(ErrorType.FILESYSTEM_ERROR, '删除原始文件失败', 'DELETE_FAILED');
                }
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 创建异步导出任务
        this.app.post('/api/messages/export', async (req, res) => {
            try {
                const { peer, format = 'JSON', filter, options, sessionName: userSessionName } = req.body;

                if (!peer || !peer.chatType || !peer.peerUid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'peer参数不完整', 'INVALID_PEER');
                }

                // 生成任务ID
                const taskId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = Date.now();
                
                let fileExt = 'json';
                switch (format.toUpperCase()) {
                    case 'TXT': fileExt = 'txt'; break;
                    case 'HTML': fileExt = 'html'; break;
                    case 'EXCEL': fileExt = 'xlsx'; break;
                    case 'JSON': default: fileExt = 'json'; break;
                }

                // 生成日期时间字符串
                const chatTypePrefix = peer.chatType === 1 ? 'friend' : 'group';
                const date = new Date(timestamp);
                const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`; // 20250506
                const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`; // 221008
                
                // Issue #192: 根据是否使用自定义路径生成不同的下载URL
                const customOutputDir = options?.outputDir?.trim();
                const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const outputDir = customOutputDir || defaultOutputDir;
                
                // 确定会话名称：优先使用用户输入的名称，否则自动获取
                let sessionName: string;
                if (userSessionName && userSessionName.trim()) {
                    // 使用用户输入的任务名
                    sessionName = userSessionName.trim();
                } else {
                    // 如果用户没有输入，则尝试自动获取会话名称
                    sessionName = peer.peerUid;
                    try {
                        // 设置较短的超时时间，避免阻塞
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('获取会话名称超时')), 2000);
                        });
                        
                        let namePromise;
                        if (peer.chatType === 1) {
                            // 私聊 - 仅尝试从已缓存的好友列表获取
                            namePromise = this.core.apis.FriendApi.getBuddy().then(friends => {
                                const friend = friends.find((f: any) => f.coreInfo?.uid === peer.peerUid);
                                return friend?.coreInfo?.remark || friend?.coreInfo?.nick || peer.peerUid;
                            });
                        } else if (peer.chatType === 2) {
                            // 群聊 - 仅尝试从已缓存的群列表获取
                            namePromise = this.core.apis.GroupApi.getGroups().then(groups => {
                                const group = groups.find(g => g.groupCode === peer.peerUid || g.groupCode === peer.peerUid.toString());
                                return group?.groupName || `群聊 ${peer.peerUid}`;
                            });
                        } else {
                            namePromise = Promise.resolve(peer.peerUid);
                        }
                        
                        sessionName = await Promise.race([namePromise, timeoutPromise]) as string;
                    } catch (error) {
                        console.warn(`快速获取会话名称失败，使用默认名称: ${peer.peerUid}`, error);
                        // 使用默认值，不阻塞任务创建
                    }
                }

                // Issue #216: 根据用户选项生成文件名（可选包含聊天名称）
                const useNameInFileName = options?.useNameInFileName === true;
                const fileName = this.generateExportFileName(
                    chatTypePrefix, peer.peerUid, sessionName,
                    dateStr, timeStr, fileExt, useNameInFileName
                );
                
                const filePath = path.join(outputDir, fileName);
                const downloadUrl = this.generateDownloadUrl(filePath, fileName, customOutputDir);

                // 创建任务记录
                const task = {
                    taskId,
                    peer,
                    sessionName,
                    fileName,
                    downloadUrl,
                    messageCount: 0,
                    status: 'running',
                    progress: 0,
                    createdAt: new Date().toISOString(),
                    format,
                    filter,
                    options
                };
                
                this.exportTasks.set(taskId, task);

                // 保存任务到数据库（异步操作，不阻塞响应）
                this.saveTaskToDatabase(task).catch(error => {
                    console.error('[ApiServer] 保存新任务到数据库失败:', error);
                });

                // 立即返回任务信息
                this.sendSuccessResponse(res, {
                    taskId: task.taskId,
                    sessionName: task.sessionName,
                    fileName: task.fileName,
                    downloadUrl: task.downloadUrl,
                    filePath: filePath, // Issue #192: 返回完整文件路径
                    messageCount: task.messageCount,
                    status: task.status,
                    startTime: filter?.startTime,
                    endTime: filter?.endTime
                }, (req as any).requestId);

                // 在后台异步处理导出（传递自定义输出目录）
                this.processExportTaskAsync(taskId, peer, format, filter, options, fileName, downloadUrl, customOutputDir);

            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 流式ZIP导出API（专为超大消息量设计，防止OOM）
        // ===================
        this.app.post('/api/messages/export-streaming-zip', async (req, res) => {
            try {
                const { peer, filter, options, sessionName: userSessionName } = req.body;

                if (!peer || !peer.chatType || !peer.peerUid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'peer参数不完整', 'INVALID_PEER');
                }

                // 生成任务ID
                const taskId = `streaming_zip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = Date.now();

                // 流式ZIP导出强制使用ZIP格式
                const chatTypePrefix = peer.chatType === 1 ? 'friend' : 'group';
                const date = new Date(timestamp);
                const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
                const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
                
                // Issue #192: 根据是否使用自定义路径生成不同的下载URL
                const customOutputDir = options?.outputDir?.trim();
                const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const outputDir = customOutputDir || defaultOutputDir;

                // 确定会话名称
                let sessionName: string;
                if (userSessionName && userSessionName.trim()) {
                    sessionName = userSessionName.trim();
                } else {
                    sessionName = peer.peerUid;
                    try {
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('获取会话名称超时')), 2000);
                        });
                        
                        let namePromise;
                        if (peer.chatType === 1) {
                            namePromise = this.core.apis.FriendApi.getBuddy().then(friends => {
                                const friend = friends.find((f: any) => f.coreInfo?.uid === peer.peerUid);
                                return friend?.coreInfo?.remark || friend?.coreInfo?.nick || peer.peerUid;
                            });
                        } else if (peer.chatType === 2) {
                            namePromise = this.core.apis.GroupApi.getGroups().then(groups => {
                                const group = groups.find(g => g.groupCode === peer.peerUid || g.groupCode === peer.peerUid.toString());
                                return group?.groupName || `群聊 ${peer.peerUid}`;
                            });
                        } else {
                            namePromise = Promise.resolve(peer.peerUid);
                        }
                        
                        sessionName = await Promise.race([namePromise, timeoutPromise]) as string;
                    } catch (error) {
                        console.warn(`快速获取会话名称失败，使用默认名称: ${peer.peerUid}`, error);
                    }
                }

                // Issue #216: 根据用户选项生成文件名（可选包含聊天名称）
                const useNameInFileName = options?.useNameInFileName === true;
                const fileName = this.generateExportFileName(
                    chatTypePrefix, peer.peerUid, sessionName,
                    dateStr, timeStr, 'zip', useNameInFileName
                ).replace(/\.zip$/, '_streaming.zip');  // 添加 _streaming 后缀（只替换末尾）
                
                const filePath = path.join(outputDir, fileName);
                const downloadUrl = this.generateDownloadUrl(filePath, fileName, customOutputDir);

                // 创建任务记录
                const task = {
                    taskId,
                    peer,
                    sessionName,
                    fileName,
                    downloadUrl,
                    messageCount: 0,
                    status: 'running',
                    progress: 0,
                    createdAt: new Date().toISOString(),
                    format: 'STREAMING_ZIP',
                    filter,
                    options: { ...options, streamingMode: true }
                };
                
                this.exportTasks.set(taskId, task);

                // 保存任务到数据库
                this.saveTaskToDatabase(task).catch(error => {
                    console.error('[ApiServer] 保存新任务到数据库失败:', error);
                });

                // 立即返回任务信息
                this.sendSuccessResponse(res, {
                    taskId: task.taskId,
                    sessionName: task.sessionName,
                    fileName: task.fileName,
                    downloadUrl: task.downloadUrl,
                    filePath: filePath, // Issue #192: 返回完整文件路径
                    messageCount: task.messageCount,
                    status: task.status,
                    startTime: filter?.startTime,
                    endTime: filter?.endTime,
                    streamingMode: true
                }, (req as any).requestId);

                // 在后台异步处理流式ZIP导出（传递自定义输出目录）
                this.processStreamingZipExportAsync(taskId, peer, filter, options, fileName, customOutputDir);

            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 流式JSONL导出API（专为超大消息量设计，防止OOM）
        // ===================
        this.app.post('/api/messages/export-streaming-jsonl', async (req, res) => {
            try {
                const { peer, filter, options, sessionName: userSessionName } = req.body;

                if (!peer || !peer.chatType || !peer.peerUid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'peer参数不完整', 'INVALID_PEER');
                }

                // 生成任务ID
                const taskId = `streaming_jsonl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = Date.now();

                // 流式JSONL导出使用目录格式
                const chatTypePrefix = peer.chatType === 1 ? 'friend' : 'group';
                const date = new Date(timestamp);
                const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
                const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
                
                // Issue #192: 根据是否使用自定义路径生成不同的下载URL
                const customOutputDir = options?.outputDir?.trim();
                const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const outputDir = customOutputDir || defaultOutputDir;

                // 确定会话名称
                let sessionName: string;
                if (userSessionName && userSessionName.trim()) {
                    sessionName = userSessionName.trim();
                } else {
                    sessionName = peer.peerUid;
                    try {
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('获取会话名称超时')), 2000);
                        });
                        
                        let namePromise;
                        if (peer.chatType === 1) {
                            namePromise = this.core.apis.FriendApi.getBuddy().then(friends => {
                                const friend = friends.find((f: any) => f.coreInfo?.uid === peer.peerUid);
                                return friend?.coreInfo?.remark || friend?.coreInfo?.nick || peer.peerUid;
                            });
                        } else if (peer.chatType === 2) {
                            namePromise = this.core.apis.GroupApi.getGroups().then(groups => {
                                const group = groups.find(g => g.groupCode === peer.peerUid || g.groupCode === peer.peerUid.toString());
                                return group?.groupName || `群聊 ${peer.peerUid}`;
                            });
                        } else {
                            namePromise = Promise.resolve(peer.peerUid);
                        }
                        
                        sessionName = await Promise.race([namePromise, timeoutPromise]) as string;
                    } catch (error) {
                        console.warn(`快速获取会话名称失败，使用默认名称: ${peer.peerUid}`, error);
                    }
                }

                // Issue #216: 根据用户选项生成目录名（可选包含聊天名称）
                const useNameInFileName = options?.useNameInFileName === true;
                const dirName = this.generateExportDirName(
                    chatTypePrefix, peer.peerUid, sessionName,
                    dateStr, timeStr, '_chunked_jsonl', useNameInFileName
                );
                
                const dirPath = path.join(outputDir, dirName);
                // JSONL导出是目录，不支持直接下载，返回目录路径
                const downloadUrl = customOutputDir 
                    ? dirPath  // 自定义路径返回完整目录路径
                    : `/downloads/${dirName}`;

                // 创建任务记录
                const task = {
                    taskId,
                    peer,
                    sessionName,
                    fileName: dirName,
                    downloadUrl,
                    messageCount: 0,
                    status: 'running',
                    progress: 0,
                    createdAt: new Date().toISOString(),
                    format: 'STREAMING_JSONL',
                    filter,
                    options: { ...options, streamingMode: true }
                };
                
                this.exportTasks.set(taskId, task);

                // 保存任务到数据库
                this.saveTaskToDatabase(task).catch(error => {
                    console.error('[ApiServer] 保存新任务到数据库失败:', error);
                });

                // 立即返回任务信息
                this.sendSuccessResponse(res, {
                    taskId: task.taskId,
                    sessionName: task.sessionName,
                    fileName: task.fileName,
                    downloadUrl: task.downloadUrl,
                    filePath: dirPath, // Issue #192: 返回完整目录路径
                    messageCount: task.messageCount,
                    status: task.status,
                    startTime: filter?.startTime,
                    endTime: filter?.endTime,
                    streamingMode: true
                }, (req as any).requestId);

                // 在后台异步处理流式JSONL导出（传递自定义输出目录）
                this.processStreamingJsonlExportAsync(taskId, peer, filter, options, dirName, customOutputDir);

            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 表情包管理API
        // ===================

        // 获取所有表情包
        this.app.get('/api/sticker-packs', async (req, res) => {
            const requestId = (req as any).requestId;
            try {
                // 支持按类型筛选
                const typesParam = req.query['types'] as string | undefined;
                let types: any[] | undefined;

                if (typesParam) {
                    types = typesParam.split(',').map(t => t.trim());
                }

                const packs = await this.stickerPackExporter.getStickerPacks(types);

                // 按类型分组统计
                const stats = {
                    favorite_emoji: 0,
                    market_pack: 0,
                    system_pack: 0
                };

                for (const pack of packs) {
                    if (stats.hasOwnProperty(pack.packType)) {
                        stats[pack.packType as keyof typeof stats]++;
                    }
                }

                this.sendSuccessResponse(res, {
                    packs,
                    totalCount: packs.length,
                    totalStickers: packs.reduce((sum, pack) => sum + pack.stickerCount, 0),
                    stats
                }, requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, requestId);
            }
        });

        // 导出指定表情包
        this.app.post('/api/sticker-packs/export', async (req, res) => {
            try {
                const { packId } = req.body;
                
                if (!packId) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '表情包ID不能为空', 'MISSING_PACK_ID');
                }
                
                const result = await this.stickerPackExporter.exportStickerPack(packId);
                
                if (!result.success) {
                    throw new SystemError(ErrorType.API_ERROR, result.error || '导出失败', 'EXPORT_FAILED');
                }
                
                this.sendSuccessResponse(res, result, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 导出所有表情包
        this.app.post('/api/sticker-packs/export-all', async (req, res) => {
            try {
                const result = await this.stickerPackExporter.exportAllStickerPacks();

                if (!result.success) {
                    throw new SystemError(ErrorType.API_ERROR, result.error || '导出失败', 'EXPORT_ALL_FAILED');
                }

                this.sendSuccessResponse(res, result, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取导出记录
        this.app.get('/api/sticker-packs/export-records', async (req, res) => {
            try {
                const limit = req.query['limit'] ? parseInt(req.query['limit'] as string) : 50;
                const records = this.stickerPackExporter.getExportRecords(limit);

                this.sendSuccessResponse(res, {
                    records,
                    totalCount: records.length
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 定时导出API
        // ===================

        // 创建定时导出任务
        this.app.post('/api/scheduled-exports', async (req, res) => {
            try {
                const config = req.body;
                
                // 验证必需字段
                if (!config.name || !config.peer || !config.scheduleType || !config.executeTime || !config.timeRangeType || !config.format) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '缺少必需的参数', 'MISSING_REQUIRED_FIELDS');
                }

                const scheduledExport = await this.scheduledExportManager.createScheduledExport({
                    ...config,
                    enabled: config.enabled !== false, // 默认启用
                    options: config.options || {}
                });

                this.sendSuccessResponse(res, scheduledExport, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取所有定时导出任务
        this.app.get('/api/scheduled-exports', async (req, res) => {
            try {
                const scheduledExports = this.scheduledExportManager.getAllScheduledExports();
                this.sendSuccessResponse(res, { scheduledExports }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取指定的定时导出任务
        this.app.get('/api/scheduled-exports/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const scheduledExport = this.scheduledExportManager.getScheduledExport(id);
                
                if (!scheduledExport) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '定时导出任务不存在', 'SCHEDULED_EXPORT_NOT_FOUND');
                }

                this.sendSuccessResponse(res, scheduledExport, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 更新定时导出任务
        this.app.put('/api/scheduled-exports/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const updates = req.body;
                
                const updatedTask = await this.scheduledExportManager.updateScheduledExport(id, updates);
                
                if (!updatedTask) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '定时导出任务不存在', 'SCHEDULED_EXPORT_NOT_FOUND');
                }

                this.sendSuccessResponse(res, updatedTask, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 删除定时导出任务
        this.app.delete('/api/scheduled-exports/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const deleted = await this.scheduledExportManager.deleteScheduledExport(id);
                
                if (!deleted) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '定时导出任务不存在', 'SCHEDULED_EXPORT_NOT_FOUND');
                }

                this.sendSuccessResponse(res, { message: '定时导出任务已删除' }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 手动触发定时导出任务
        this.app.post('/api/scheduled-exports/:id/trigger', async (req, res) => {
            try {
                const { id } = req.params;
                const result = await this.scheduledExportManager.triggerScheduledExport(id);
                
                if (!result) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '定时导出任务不存在', 'SCHEDULED_EXPORT_NOT_FOUND');
                }

                this.sendSuccessResponse(res, result, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取定时导出任务的执行历史
        this.app.get('/api/scheduled-exports/:id/history', async (req, res) => {
            try {
                const { id } = req.params;
                const limit = parseInt(req.query['limit'] as string) || 50;
                
                const history = await this.scheduledExportManager.getExecutionHistory(id, limit);
                this.sendSuccessResponse(res, { history }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 资源合并相关API 
        // ===================

        // 合并多个导出任务的资源
        this.app.post('/api/merge-resources', async (req, res) => {
            try {
                const { sourceTaskIds, outputPath, deleteSourceFiles = false, deduplicateMessages = true } = req.body;

                if (!sourceTaskIds || !Array.isArray(sourceTaskIds) || sourceTaskIds.length < 2) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '至少需要选择2个任务进行合并', 'INVALID_SOURCE_TASKS');
                }

                // 动态导入ResourceMerger
                const { ResourceMerger } = await import('../core/merger/ResourceMerger.js');
                const merger = new ResourceMerger();

                // 设置进度回调
                merger.setProgressCallback((progress) => {
                    // 通过WebSocket广播合并进度
                    this.broadcastWebSocketMessage({
                        type: 'merge-progress',
                        data: progress
                    });
                });

                // 执行合并
                const result = await merger.mergeResources({
                    sourceTaskIds,
                    outputPath: outputPath || path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'merged'),
                    deleteSourceFiles,
                    deduplicateMessages
                });

                this.sendSuccessResponse(res, { result }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取可用于合并的定时备份列表（按任务名称分组）
        this.app.get('/api/merge-resources/available-tasks', async (req, res) => {
            try {
                // 扫描 scheduled-exports 目录下的定时备份文件
                const scheduledDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
                const scheduledBackups: Array<{
                    fileName: string;
                    taskName: string;
                    timestamp: string;
                    createdAt: string;
                    fileSize: number;
                }> = [];

                if (fs.existsSync(scheduledDir)) {
                    try {
                        const files = fs.readdirSync(scheduledDir)
                            .filter(f => f.endsWith('.html') || f.endsWith('.json'));
                        
                        for (const file of files) {
                            try {
                                const filePath = path.join(scheduledDir, file);
                                const stats = fs.statSync(filePath);
                                
                                // 解析文件名：任务名_时间戳.格式
                                // 例如: TF绝活小屋_2025-11-28T06-24-13.html
                                const match = file.match(/^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(html|json)$/);
                                if (match) {
                                    const [, taskName, timestamp] = match;
                                    scheduledBackups.push({
                                        fileName: file,
                                        taskName,
                                        timestamp,
                                        createdAt: stats.mtime.toISOString(),
                                        fileSize: stats.size
                                    });
                                }
                            } catch (fileError) {
                                console.warn(`[ApiServer] 无法读取文件 ${file}:`, fileError);
                            }
                        }
                    } catch (dirError) {
                        console.warn('[ApiServer] 读取scheduled-exports目录失败:', dirError);
                    }
                }

                // 按任务名称分组
                const groupedTasks = new Map<string, typeof scheduledBackups>();
                for (const backup of scheduledBackups) {
                    if (!groupedTasks.has(backup.taskName)) {
                        groupedTasks.set(backup.taskName, []);
                    }
                    groupedTasks.get(backup.taskName)!.push(backup);
                }

                // 转换为数组并排序
                const scheduledTasks = Array.from(groupedTasks.entries()).map(([taskName, backups]) => ({
                    taskName,
                    backupCount: backups.length,
                    backups: backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
                    latestBackup: backups.reduce((latest, current) => 
                        new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest
                    )
                })).sort((a, b) => new Date(b.latestBackup.createdAt).getTime() - new Date(a.latestBackup.createdAt).getTime());

                this.sendSuccessResponse(res, { scheduledTasks }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取导出文件列表（用于聊天记录索引页面）
        this.app.get('/api/exports/files', async (req, res) => {
            try {
                const exportFiles = await this.getExportFiles();
                this.sendSuccessResponse(res, { files: exportFiles }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取特定导出文件的详细信息
        this.app.get('/api/exports/files/:fileName/info', (req, res) => {
            try {
                const { fileName } = req.params;
                const fileInfo = this.getExportFileInfo(fileName);
                this.sendSuccessResponse(res, fileInfo, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 删除导出文件（Issue #32 - 删除聊天记录索引中的文件）
        this.app.delete('/api/exports/files/:fileName', async (req, res) => {
            try {
                const { fileName } = req.params;
                
                // 构建文件路径（尝试两个目录）
                const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const scheduledExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
                
                let filePathToDelete = path.join(exportDir, fileName);
                let isScheduled = false;
                
                // 检查是否在定时导出目录
                if (!fs.existsSync(filePathToDelete)) {
                    filePathToDelete = path.join(scheduledExportDir, fileName);
                    isScheduled = true;
                }
                
                if (!fs.existsSync(filePathToDelete)) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '文件不存在', 'FILE_NOT_FOUND');
                }
                
                // 删除HTML和JSON文件
                const baseName = fileName.replace(/\.(html|json)$/, '');
                const htmlPath = isScheduled 
                    ? path.join(scheduledExportDir, `${baseName}.html`)
                    : path.join(exportDir, `${baseName}.html`);
                const jsonPath = isScheduled
                    ? path.join(scheduledExportDir, `${baseName}.json`)
                    : path.join(exportDir, `${baseName}.json`);
                
                // 删除资源目录
                const resourcesDir = path.dirname(htmlPath) + `/resources_${baseName}`;
                
                // 执行删除
                const deletedFiles: string[] = [];
                
                if (fs.existsSync(htmlPath)) {
                    fs.unlinkSync(htmlPath);
                    deletedFiles.push('HTML文件');
                }
                
                if (fs.existsSync(jsonPath)) {
                    fs.unlinkSync(jsonPath);
                    deletedFiles.push('JSON文件');
                }
                
                if (fs.existsSync(resourcesDir)) {
                    fs.rmSync(resourcesDir, { recursive: true, force: true });
                    deletedFiles.push('资源目录');
                }
                
                this.sendSuccessResponse(res, { 
                    message: '文件删除成功',
                    deleted: deletedFiles
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 打开文件所在位置
        this.app.post('/api/open-file-location', async (req, res) => {
            try {
                const { filePath } = req.body;
                
                if (!filePath || typeof filePath !== 'string') {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '缺少文件路径参数', 'MISSING_FILE_PATH');
                }

                // 检查文件是否存在
                if (!fs.existsSync(filePath)) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '文件不存在', 'FILE_NOT_FOUND');
                }

                // Windows: 使用 explorer /select 打开文件位置并选中文件
                const command = process.platform === 'win32' 
                    ? `explorer /select,"${filePath.replace(/\//g, '\\')}"`
                    : process.platform === 'darwin'
                    ? `open -R "${filePath}"`
                    : `xdg-open "${path.dirname(filePath)}"`;

                exec(command, (error) => {
                    if (error) {
                        console.error('[ApiServer] 打开文件位置失败:', error);
                    }
                });

                this.sendSuccessResponse(res, { 
                    message: '已打开文件位置'
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 打开导出目录
        this.app.post('/api/open-export-directory', async (req, res) => {
            try {
                const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                
                // 确保目录存在
                if (!fs.existsSync(exportDir)) {
                    fs.mkdirSync(exportDir, { recursive: true });
                }

                // 打开目录
                const command = process.platform === 'win32' 
                    ? `explorer "${exportDir.replace(/\//g, '\\')}"`
                    : process.platform === 'darwin'
                    ? `open "${exportDir}"`
                    : `xdg-open "${exportDir}"`;

                exec(command, (error) => {
                    if (error) {
                        console.error('[ApiServer] 打开导出目录失败:', error);
                    }
                });

                this.sendSuccessResponse(res, { 
                    message: '已打开导出目录',
                    path: exportDir
                }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // HTML/JSON文件预览接口（用于iframe内嵌显示）
        this.app.get('/api/exports/files/:fileName/preview', (req, res) => {
            try {
                const { fileName } = req.params;
                
                // 直接构建文件路径，不依赖getExportFiles()方法
                const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const scheduledExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
                
                let filePath = path.join(exportDir, fileName);
                let found = fs.existsSync(filePath);
                
                // 如果在主导出目录没找到，检查定时导出目录
                if (!found) {
                    filePath = path.join(scheduledExportDir, fileName);
                    found = fs.existsSync(filePath);
                }
                
                if (!found) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, `文件不存在: ${fileName}`, 'FILE_NOT_FOUND');
                }
                
                // 检查文件类型
                const ext = path.extname(fileName).toLowerCase();
                
                if (ext === '.json') {
                    // JSON文件 - 使用格式化预览
                    const jsonContent = fs.readFileSync(path.resolve(filePath), 'utf8');
                    let jsonData: any;
                    try {
                        jsonData = JSON.parse(jsonContent);
                    } catch (e) {
                        jsonData = { error: '无法解析JSON', content: jsonContent };
                    }
                    
                    const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSON 预览 - ${fileName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: #ffffff;
            padding: 20px;
            line-height: 1.6;
            color: #1d1d1f;
        }
        pre {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.8;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .json-key { color: #881391; font-weight: 500; }
        .json-string { color: #0e5c99; }
        .json-number { color: #1c00cf; }
        .json-boolean { color: #0d22aa; font-weight: 500; }
        .json-null { color: #808080; font-style: italic; }
    </style>
</head>
<body>
    <pre>${this.formatJsonForDisplay(jsonData)}</pre>
</body>
</html>`;
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.send(htmlTemplate);
                } else {
                    // HTML或其他文件 - 动态修复资源路径
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    
                    let htmlContent = fs.readFileSync(path.resolve(filePath), 'utf8');
                    
                    // 修复资源路径：将相对路径替换为绝对 API 路径
                    // 支持新版（./resources/）和旧版（../resources/）导出格式
                    // 使用绝对路径避免 iframe 中的相对路径解析问题
                    const encodedFileName = encodeURIComponent(fileName);
                    htmlContent = htmlContent
                        .replace(/src="\.\/resources\//g, `src="/api/exports/files/${encodedFileName}/resources/`)
                        .replace(/href="\.\/resources\//g, `href="/api/exports/files/${encodedFileName}/resources/`)
                        .replace(/src="\.\.\/resources\//g, `src="/api/exports/files/${encodedFileName}/resources/`)
                        .replace(/href="\.\.\/resources\//g, `href="/api/exports/files/${encodedFileName}/resources/`);
                    
                    res.send(htmlContent);
                }
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // HTML预览页面的资源文件服务（处理相对路径资源请求）
        this.app.get('/api/exports/files/:fileName/resources/*', (req, res) => {
            try {
                // 提取资源相对路径（去掉 /api/exports/files/{fileName}/resources/ 前缀）
                const resourcePath = (req.params as any)[0] as string; // 例如: images/xxx.jpg
                
                // 安全检查：防止路径遍历攻击
                const normalizedPath = path.normalize(resourcePath);
                if (normalizedPath.includes('..') || normalizedPath.startsWith('/') || normalizedPath.startsWith('\\')) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '非法的资源路径', 'INVALID_PATH');
                }
                
                // 使用缓存快速查找文件（O(1)复杂度）
                const fullPath = this.findResourceFile(resourcePath);
                
                if (!fullPath || !fs.existsSync(fullPath)) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, `资源文件不存在: ${resourcePath}`, 'RESOURCE_NOT_FOUND');
                }
                
                // 根据文件扩展名设置Content-Type
                const ext = path.extname(resourcePath).toLowerCase();
                const contentTypes: Record<string, string> = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.svg': 'image/svg+xml',
                    '.mp4': 'video/mp4',
                    '.webm': 'video/webm',
                    '.mp3': 'audio/mpeg',
                    '.wav': 'audio/wav',
                    '.ogg': 'audio/ogg'
                };
                
                const contentType = contentTypes[ext] || 'application/octet-stream';
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=31536000'); // 资源可以长期缓存
                
                // 发送文件
                res.sendFile(fullPath);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // ===================
        // 资源索引API（极致性能）
        // ===================
        
        // 获取资源索引（支持所有资源类型、ZIP、JSONL）
        this.app.get('/api/resources/index', async (req, res) => {
            try {
                const resourceIndex = await this.buildResourceIndex();
                this.sendSuccessResponse(res, resourceIndex, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取特定导出文件的资源列表
        this.app.get('/api/resources/export/:fileName', async (req, res) => {
            try {
                const { fileName } = req.params;
                const resources = await this.getExportFileResources(fileName);
                this.sendSuccessResponse(res, { resources }, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 获取全局资源文件列表（用于画廊浏览）
        this.app.get('/api/resources/files', async (req, res) => {
            try {
                const type = req.query['type'] as string || 'all'; // all, images, videos, audios, files
                const page = parseInt(req.query['page'] as string) || 1;
                const limit = parseInt(req.query['limit'] as string) || 50;
                const resources = await this.getGlobalResourceFiles(type, page, limit);
                this.sendSuccessResponse(res, resources, (req as any).requestId);
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 动态下载API - 支持自定义导出路径的文件下载 (Issue #192)
        // 安全措施：需要认证 + 限制文件扩展名 + 路径安全检查
        this.app.get('/api/download-file', (req, res) => {
            try {
                const filePath = req.query['path'] as string;
                if (!filePath) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '缺少文件路径参数', 'MISSING_PATH');
                }

                // 安全检查1：在规范化之前检查原始路径是否包含危险字符
                // 防止通过编码或特殊字符绕过检查
                if (filePath.includes('..') || filePath.includes('\0') || filePath.includes('%00')) {
                    throw new SystemError(ErrorType.PERMISSION_ERROR, '非法的文件路径', 'INVALID_PATH');
                }

                // 安全检查2：规范化路径
                const normalizedPath = path.normalize(filePath);
                
                // 安全检查3：规范化后再次检查（防止编码绕过）
                if (normalizedPath.includes('..') || normalizedPath.includes('\0')) {
                    throw new SystemError(ErrorType.PERMISSION_ERROR, '非法的文件路径', 'INVALID_PATH');
                }
                
                // 安全检查4：只允许下载特定扩展名的导出文件
                const allowedExtensions = ['.json', '.html', '.txt', '.xlsx', '.zip', '.jsonl'];
                const ext = path.extname(normalizedPath).toLowerCase();
                if (!allowedExtensions.includes(ext)) {
                    throw new SystemError(ErrorType.PERMISSION_ERROR, '不允许下载此类型的文件', 'FORBIDDEN_FILE_TYPE');
                }
                
                // 安全检查5：确保是绝对路径（防止相对路径攻击）
                if (!path.isAbsolute(normalizedPath)) {
                    throw new SystemError(ErrorType.PERMISSION_ERROR, '必须使用绝对路径', 'RELATIVE_PATH_NOT_ALLOWED');
                }
                
                // 检查文件是否存在
                if (!fs.existsSync(normalizedPath)) {
                    throw new SystemError(ErrorType.FILESYSTEM_ERROR, '文件不存在', 'FILE_NOT_FOUND');
                }

                // 检查是否为文件（不是目录）
                const stats = fs.statSync(normalizedPath);
                if (!stats.isFile()) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '路径不是文件', 'NOT_A_FILE');
                }

                // 获取文件名和MIME类型
                const fileName = path.basename(normalizedPath);
                const mimeTypes: Record<string, string> = {
                    '.json': 'application/json',
                    '.html': 'text/html',
                    '.txt': 'text/plain',
                    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    '.zip': 'application/zip',
                    '.jsonl': 'application/x-ndjson'
                };
                const contentType = mimeTypes[ext] || 'application/octet-stream';

                // 设置响应头
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
                res.setHeader('Content-Length', stats.size);

                // 流式发送文件
                const fileStream = fs.createReadStream(normalizedPath);
                fileStream.pipe(res);
                fileStream.on('error', (error) => {
                    console.error('[ApiServer] 文件流读取错误:', error);
                    if (!res.headersSent) {
                        this.sendErrorResponse(res, error, (req as any).requestId);
                    }
                });
            } catch (error) {
                this.sendErrorResponse(res, error, (req as any).requestId);
            }
        });

        // 静态文件服务
        this.app.use('/downloads', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports')));
        this.app.use('/scheduled-downloads', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports')));
        // 资源文件服务（图片、音频、视频等）
        this.app.use('/resources', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources')));
        
        // 前端应用路由
        this.frontendBuilder.setupStaticRoutes(this.app);

        // 404处理
        this.app.use((req, res) => {
            const ignoredPaths = ['/favicon.ico', '/robots.txt', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];
            if (ignoredPaths.includes(req.path) || req.path.startsWith('/favicon')) {
                res.status(404).end();
                return;
            }
            this.sendErrorResponse(res, new SystemError(ErrorType.API_ERROR, `API端点不存在: ${req.method} ${req.path}`, 'ENDPOINT_NOT_FOUND'), (req as any).requestId, 404);
        });

        // 错误处理中间件
        this.app.use((error: any, req: Request, res: Response, _next: any) => {
            this.sendErrorResponse(res, error, (req as any).requestId);
        });
    }

    /**
     * 配置WebSocket
     */
    private setupWebSocket(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            const requestId = this.generateRequestId();
            this.core.context.logger.log(`[API] WebSocket连接建立: ${requestId}`);
            
            this.wsConnections.add(ws);

            // 监听客户端消息
            ws.on('message', async (data: string) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleWebSocketMessage(ws, message);
                } catch (error) {
                    this.core.context.logger.logError('[API] WebSocket消息处理失败', error);
                    this.sendWebSocketMessage(ws, {
                        type: 'error',
                        data: { message: '消息格式错误' },
                        timestamp: new Date().toISOString()
                    });
                }
            });

            ws.on('close', () => {
                this.wsConnections.delete(ws);
                this.core.context.logger.log(`[API] WebSocket连接关闭: ${requestId}`);
            });

            ws.on('error', (error) => {
                this.core.context.logger.logError(`[API] WebSocket错误: ${requestId}`, error);
            });

            // 发送连接确认
            this.sendWebSocketMessage(ws, {
                type: 'connected',
                data: { message: 'WebSocket连接成功', requestId },
                timestamp: new Date().toISOString()
            });
        });
    }
    
    /**
     * 处理WebSocket消息
     */
    private async handleWebSocketMessage(ws: WebSocket, message: any): Promise<void> {
        const { type, data } = message;
        
        switch (type) {
            case 'start_stream_search':
                await this.handleStreamSearchRequest(ws, data);
                break;
                
            case 'cancel_search':
                this.handleCancelSearch(data.searchId);
                break;
                
            default:
                console.warn(`[ApiServer] 未知的WebSocket消息类型: ${type}`);
        }
    }
    
    /**
     * 处理流式搜索请求
     */
    private async handleStreamSearchRequest(ws: WebSocket, data: any): Promise<void> {
        const { searchId, peer, filter, searchQuery } = data;
        
        if (!peer || !searchQuery) {
            this.sendWebSocketMessage(ws, {
                type: 'search_error',
                data: { searchId, message: '缺少必要参数' }
            });
            return;
        }
        
        try {
            // 创建消息获取器
            const fetcher = new BatchMessageFetcher(this.core, {
                batchSize: 5000,  // 每批5000条，处理完立即释放
                timeout: 30000,
                retryCount: 3
            });
            
            // 获取消息生成器（异步迭代器）
            const messageGenerator = fetcher.fetchAllMessagesInTimeRange(
                peer,
                filter?.startTime || 0,
                filter?.endTime || Date.now()
            );
            
            // 启动流式搜索（不阻塞，在后台运行）
            // 搜索会一直进行到所有消息处理完毕，或用户取消
            streamSearchService.startStreamSearch(messageGenerator, {
                searchId,
                query: searchQuery,
                ws
            }).catch(error => {
                console.error(`[ApiServer] 流式搜索失败: ${searchId}`, error);
            });
            
        } catch (error) {
            console.error(`[ApiServer] 启动流式搜索失败: ${searchId}`, error);
            this.sendWebSocketMessage(ws, {
                type: 'search_error',
                data: { 
                    searchId, 
                    message: error instanceof Error ? error.message : '搜索失败' 
                }
            });
        }
    }
    
    /**
     * 处理取消搜索
     */
    private handleCancelSearch(searchId: string): void {
        streamSearchService.cancelSearch(searchId);
    }

    /**
     * 发送WebSocket消息
     */
    private sendWebSocketMessage(ws: WebSocket, message: any): void {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        } catch (error) {
            this.core.context.logger.logError('[API] 发送WebSocket消息失败:', error);
        }
    }

    /**
     * 异步处理导出任务
     */
    private async processExportTaskAsync(
        taskId: string,
        peer: any,
        format: string,
        filter: any,
        options: any,
        fileName: string,
        downloadUrl: string,
        customOutputDir?: string
    ): Promise<void> {
        let task = this.exportTasks.get(taskId);
        
        // 为此任务创建独立的 ResourceHandler
        const taskResourceHandler = new ResourceHandler(this.core, this.dbManager);
        this.taskResourceHandlers.set(taskId, taskResourceHandler);
        
        try {

            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'running',
                    progress: 0,
                    message: '开始获取消息...'
                });
            }

            // 发送任务开始通知
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 0,
                    message: '开始获取消息...'
                }
            });

            // 获取消息
            const fetcher = new BatchMessageFetcher(this.core, {
                batchSize: options?.batchSize || 5000,
                timeout: 120000,
                retryCount: 3
            });

            // 检测时间戳单位并转换为毫秒级
            let startTimeMs = filter?.startTime ? filter.startTime : 0;
            let endTimeMs = filter?.endTime ? filter.endTime : Date.now();
            
            // 检查时间戳是否为秒级（10位数）并转换为毫秒级
            // 秒级时间戳范围大约：1000000000 (2001年) - 9999999999 (2286年)
            if (startTimeMs > 1000000000 && startTimeMs < 10000000000) {
                startTimeMs = startTimeMs * 1000;
            }
            if (endTimeMs > 1000000000 && endTimeMs < 10000000000) {
                endTimeMs = endTimeMs * 1000;
            }
            
            const allMessages: RawMessage[] = [];
            const messageGenerator = fetcher.fetchAllMessagesInTimeRange(peer, startTimeMs, endTimeMs);
            
            let batchCount = 0;
            let earliestMsgTime: number | null = null;
            let latestMsgTime: number | null = null;
            
            for await (const batch of messageGenerator) {
                batchCount++;
                allMessages.push(...batch);
                
                // 记录每批次的消息时间范围
                if (batch.length > 0) {
                    const batchTimes = batch.map(msg => {
                        const msgTime = typeof msg.msgTime === 'string' ? parseInt(msg.msgTime) : msg.msgTime;
                        return msgTime > 10000000000 ? msgTime : msgTime * 1000;
                    });
                    const batchEarliest = Math.min(...batchTimes);
                    const batchLatest = Math.max(...batchTimes);
                    
                    // 更新全局最早/最晚时间
                    if (earliestMsgTime === null || batchEarliest < earliestMsgTime) {
                        earliestMsgTime = batchEarliest;
                    }
                    if (latestMsgTime === null || batchLatest > latestMsgTime) {
                        latestMsgTime = batchLatest;
                    }
                }
                
                // 更新任务状态
                task = this.exportTasks.get(taskId);
                if (task) {
                    await this.updateTaskStatus(taskId, {
                        progress: Math.min(batchCount * 10, 50),
                        messageCount: allMessages.length,
                        message: `已获取 ${allMessages.length} 条消息...`
                    });
                }

                // 推送进度更新
                this.broadcastWebSocketMessage({
                    type: 'export_progress',
                    data: {
                        taskId,
                        status: 'running',
                        progress: Math.min(batchCount * 10, 50), // 获取消息阶段占50%进度
                        message: `已获取 ${allMessages.length} 条消息...`,
                        messageCount: allMessages.length
                    }
                });
                
                // 每10批次触发垃圾回收，减少内存压力
                if (batchCount % 10 === 0 && global.gc) {
                    global.gc();
                }
            }
            
            // 消息收集完成

            // 补全群消息的群昵称（sendMemberName）

            if (Number(peer.chatType) === 2 && allMessages.length > 0) {
                try {
                    const groupMembers = await this.core.apis.GroupApi.getGroupMemberAll(peer.peerUid, false);
                    if (groupMembers?.result?.infos) {
                        const memberMap = groupMembers.result.infos;
                        let filledCount = 0;
                        
                        for (const message of allMessages) {
                            if (!message.sendMemberName || message.sendMemberName.trim() === '') {
                                const member = memberMap.get(message.senderUid);
                                if (member?.cardName) {
                                    message.sendMemberName = member.cardName;
                                    filledCount++;
                                }
                            }
                        }
                        
                    }
                } catch (error) {
                    console.warn(`[ApiServer] 获取群成员信息失败，跳过群昵称补全:`, error);
                }
            }

            // 注意：filterPureImageMessages只是跳过资源下载，不过滤消息
            // 所有消息都保留，只是不下载图片等资源文件
            let filteredMessages = allMessages;

            // 过滤指定用户的消息
            if (filter?.excludeUserUins && filter.excludeUserUins.length > 0) {
                const excludeSet = new Set(filter.excludeUserUins.map((uin: string) => String(uin)));
                const beforeCount = filteredMessages.length;
                filteredMessages = filteredMessages.filter(msg => {
                    const senderUin = String(msg.senderUin || '');
                    return !excludeSet.has(senderUin);
                });
            }

            // 所有格式都需要通过OneBot解析器处理
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    progress: 60,
                    message: '正在解析消息...',
                    messageCount: filteredMessages.length
                });
            }
            
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 60,
                    message: '正在解析消息...',
                    messageCount: filteredMessages.length
                }
            });

            // 处理资源下载（如果启用了纯多媒体消息过滤，则跳过资源下载）
            let resourceMap: Map<string, any>;
            if (!options?.filterPureImageMessages) {
                task = this.exportTasks.get(taskId);
                if (task) {
                    await this.updateTaskStatus(taskId, {
                        progress: 70,
                        message: '正在下载资源...',
                        messageCount: filteredMessages.length
                    });
                }
                
                this.broadcastWebSocketMessage({
                    type: 'export_progress',
                    data: {
                        taskId,
                        status: 'running',
                        progress: 70,
                        message: '正在下载资源...',
                        messageCount: filteredMessages.length
                    }
                });

                // 设置资源下载进度回调
                taskResourceHandler.setProgressCallback((resourceProgress) => {
                    const progressPercent = 70 + Math.round((resourceProgress.completed / Math.max(resourceProgress.total, 1)) * 15);
                    this.broadcastWebSocketMessage({
                        type: 'export_progress',
                        data: {
                            taskId,
                            status: 'running',
                            progress: progressPercent,
                            message: resourceProgress.message,
                            messageCount: filteredMessages.length
                        }
                    });
                });

                // 下载和处理资源（使用过滤后的消息列表）
                resourceMap = await taskResourceHandler.processMessageResources(filteredMessages);
                
                // 清除进度回调
                taskResourceHandler.setProgressCallback(null);
                
                console.info(`[ApiServer] 处理了 ${resourceMap.size} 个消息的资源`);
            } else {
                console.info(`[ApiServer] 已启用纯多媒体消息过滤，跳过资源下载`);
                resourceMap = new Map(); // 不下载资源，使用空Map
            }

            // 导出文件
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    progress: 85,
                    message: '正在生成文件...',
                    messageCount: filteredMessages.length
                });
            }
            
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 85,
                    message: '正在生成文件...',
                    messageCount: filteredMessages.length
                }
            });

            // 修复 Issue #30: 使用用户目录，与索引扫描目录保持一致
            // Issue #192: 支持自定义导出路径
            const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
            const outputDir = customOutputDir && customOutputDir.trim() ? customOutputDir.trim() : defaultOutputDir;
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const filePath = path.join(outputDir, fileName);

            // 选择导出器
            let exporter: any;
            const exportOptions = {
                outputPath: filePath,
                includeResourceLinks: options?.includeResourceLinks ?? true,
                includeSystemMessages: options?.includeSystemMessages ?? true,
                filterPureImageMessages: options?.filterPureImageMessages ?? false,
                prettyFormat: options?.prettyFormat ?? true,
                timeFormat: 'YYYY-MM-DD HH:mm:ss',
                encoding: 'utf-8'
            };

            // 对消息按时间戳排序，确保时间顺序正确
            const sortedMessages = filteredMessages.sort((a, b) => {
                // 解析时间戳
                let timeA = parseInt(a.msgTime || '0');
                let timeB = parseInt(b.msgTime || '0');
                
                // 处理无效时间戳
                if (isNaN(timeA) || timeA <= 0) timeA = 0;
                if (isNaN(timeB) || timeB <= 0) timeB = 0;
                
                // 检查是否为秒级时间戳（10位数）并转换为毫秒级进行比较
                if (timeA > 1000000000 && timeA < 10000000000) {
                    timeA = timeA * 1000;
                }
                if (timeB > 1000000000 && timeB < 10000000000) {
                    timeB = timeB * 1000;
                }
                
                // 按时间从早到晚排序（升序）
                return timeA - timeB;
            });
            
            // 输出排序统计信息
            if (sortedMessages.length > 0) {
            }

            // 获取友好的聊天名称
            task = this.exportTasks.get(taskId);
            const chatName = task?.sessionName || peer.peerUid;
            const selfInfo = this.core.selfInfo;
            const chatInfo = {
                name: chatName,
                type: (peer.chatType === ChatType.Group || peer.chatType === 2 ? 'group' : 'private') as 'group' | 'private',
                selfUid: selfInfo?.uid,
                selfUin: selfInfo?.uin,
                selfName: selfInfo?.nick
            };

            switch (format.toUpperCase()) {
                case 'TXT':
                    exporter = new TextExporter(exportOptions, {}, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'JSON':
                    exporter = new JsonExporter(exportOptions, { embedAvatarsAsBase64: options?.embedAvatarsAsBase64 ?? false }, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'EXCEL':
                    exporter = new ExcelExporter(exportOptions, {}, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'HTML':
                    // HTML流式导出：使用异步生成器，实现全程低内存占用
                    const parser = new SimpleMessageParser();
                    
                    const htmlExporter = new ModernHtmlExporter({
                        outputPath: filePath,
                        includeResourceLinks: exportOptions.includeResourceLinks,
                        includeSystemMessages: exportOptions.includeSystemMessages,
                        encoding: exportOptions.encoding
                    });
                    
                    // 使用流式API：逐条解析、更新资源路径、写入HTML，全程低内存
                    // 🔧 修复 Issue #29: 传入已排序的消息，确保时间顺序正确
                    const messageStream = parser.parseMessagesStream(sortedMessages, resourceMap);
                    const copiedResourcePaths = await htmlExporter.exportFromIterable(messageStream, chatInfo);
                    // 保存资源列表供ZIP打包使用
                    (exportOptions as any)._copiedResourcePaths = copiedResourcePaths;
                    break;
                default:
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '不支持的导出格式', 'INVALID_FORMAT');
            }

            let finalFilePath = filePath;
            let finalFileName = fileName;
            let isZipExport = false;

            // 如果是HTML格式且启用了ZIP导出
            if (format.toUpperCase() === 'HTML' && options?.exportAsZip === true) {
                try {
                    // 更新进度
                    task = this.exportTasks.get(taskId);
                    if (task) {
                        await this.updateTaskStatus(taskId, {
                            progress: 95,
                            message: '正在打包ZIP文件...'
                        });
                    }
                    
                    this.broadcastWebSocketMessage({
                        type: 'export_progress',
                        data: {
                            taskId,
                            status: 'running',
                            progress: 95,
                            message: '正在打包ZIP文件...'
                        }
                    });

                    // 生成ZIP文件路径（替换.html为.zip）
                    const zipFileName = fileName.replace(/\.html$/i, '.zip');
                    const zipFilePath = path.join(outputDir, zipFileName);

                    // 获取资源列表
                    const resourcePaths = (exportOptions as any)._copiedResourcePaths || [];

                    // 调用ZipExporter创建ZIP文件
                    await ZipExporter.createZip(filePath, zipFilePath, resourcePaths);

                    // 更新最终文件信息
                    finalFilePath = zipFilePath;
                    finalFileName = zipFileName;
                    isZipExport = true;
                } catch (zipError) {
                    console.error(`[ApiServer] 创建ZIP压缩包失败:`, zipError);
                    // ZIP创建失败时，保留原HTML文件，任务仍然标记为完成
                    console.warn(`[ApiServer] 将使用原始HTML文件作为导出结果`);
                }
            }

            const stats = fs.statSync(finalFilePath);

            // 更新任务为完成状态
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'completed',
                    progress: 100,
                    message: '导出完成',
                    messageCount: sortedMessages.length,
                    filePath: finalFilePath,
                    fileSize: stats.size,
                    completedAt: new Date().toISOString(),
                    fileName: finalFileName,
                    isZipExport,
                    originalFilePath: isZipExport ? filePath : undefined
                });
            }

            // 发送完成通知
            // Issue #192: 根据是否使用自定义路径生成正确的下载URL
            const finalDownloadUrl = this.generateDownloadUrl(
                finalFilePath, 
                finalFileName, 
                customOutputDir,
                isZipExport ? '/download?file=' : '/downloads/'
            );
            
            this.broadcastWebSocketMessage({
                type: 'export_complete',
                data: {
                    taskId,
                    status: 'completed',
                    progress: 100,
                    message: '导出完成',
                    messageCount: sortedMessages.length,
                    fileName: finalFileName,
                    filePath: finalFilePath,
                    fileSize: stats.size,
                    downloadUrl: finalDownloadUrl,
                    isZipExport,
                    originalFilePath: isZipExport ? filePath : undefined
                }
            });

            // 立即刷新数据库，确保任务状态持久化
            await this.dbManager.flushWriteQueue();
            
            // 清除资源缓存，确保新下载的资源能被访问
            this.clearResourceCache('images');
            this.clearResourceCache('videos');
            this.clearResourceCache('audios');

        } catch (error) {
            console.error(`[ApiServer] 导出任务失败: ${taskId}`, error);
            
            // 更新任务为失败状态
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : '导出失败',
                    completedAt: new Date().toISOString()
                });
            }

            // 发送错误通知
            this.broadcastWebSocketMessage({
                type: 'export_error',
                data: {
                    taskId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : '导出失败'
                }
            });
        } finally {
            // 清理任务的资源处理器（无论成功还是失败）
            const resourceHandler = this.taskResourceHandlers.get(taskId);
            if (resourceHandler) {
                await resourceHandler.cleanup();
                this.taskResourceHandlers.delete(taskId);
            }
        }
    }

    /**
     * 流式ZIP导出处理（专为超大消息量设计，防止OOM）
     * 使用分块导出 + ZIP打包：
     * 1. 流式获取消息
     * 2. 流式解析并分块写入（每块2000条消息）
     * 3. 生成 index.html + chunks/*.js + manifest.js + 索引文件
     * 4. 将所有文件打包成ZIP
     */
    private async processStreamingZipExportAsync(
        taskId: string,
        peer: any,
        filter: any,
        options: any,
        fileName: string,
        customOutputDir?: string
    ): Promise<void> {
        let task = this.exportTasks.get(taskId);
        let tempDir: string | null = null;
        
        // 为此任务创建独立的 ResourceHandler
        const taskResourceHandler = new ResourceHandler(this.core, this.dbManager);
        this.taskResourceHandlers.set(taskId, taskResourceHandler);
        
        try {

            // 更新任务状态
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'running',
                    progress: 0,
                    message: '初始化流式分块导出...'
                });
            }

            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: { taskId, status: 'running', progress: 0, message: '初始化流式分块导出...' }
            });

            // 准备输出路径（Issue #192: 支持自定义导出路径）
            const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
            const outputDir = customOutputDir && customOutputDir.trim() ? customOutputDir.trim() : defaultOutputDir;
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const zipFilePath = path.join(outputDir, fileName);
            
            // 创建临时目录用于分块导出
            tempDir = path.join(outputDir, `temp_${taskId}`);
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            fs.mkdirSync(tempDir, { recursive: true });

            // 获取聊天信息
            let sessionName = task?.sessionName || peer.peerUid;
            const selfInfo = this.core.selfInfo;
            const chatInfo = {
                name: sessionName,
                type: (peer.chatType === ChatType.Group || peer.chatType === 2 ? 'group' : 'private') as 'group' | 'private',
                selfUid: selfInfo?.uid,
                selfUin: selfInfo?.uin,
                selfName: selfInfo?.nick
            };

            // 创建分块HTML导出器
            const parser = new SimpleMessageParser();
            const htmlExporter = new ModernHtmlExporter({
                outputPath: path.join(tempDir, 'index.html'),
                includeResourceLinks: !options?.filterPureImageMessages,
                includeSystemMessages: options?.includeSystemMessages ?? true,
                encoding: 'utf-8'
            });

            // 配置消息获取器
            const fetcher = new BatchMessageFetcher(this.core, {
                batchSize: options?.batchSize || 3000,
                timeout: 120000,
                retryCount: 3
            });

            // 处理时间戳
            let startTimeMs = filter?.startTime ? filter.startTime : 0;
            let endTimeMs = filter?.endTime ? filter.endTime : Date.now();
            
            if (startTimeMs > 1000000000 && startTimeMs < 10000000000) {
                startTimeMs = startTimeMs * 1000;
            }
            if (endTimeMs > 1000000000 && endTimeMs < 10000000000) {
                endTimeMs = endTimeMs * 1000;
            }

            // 创建消息流生成器
            const messageGenerator = fetcher.fetchAllMessagesInTimeRange(peer, startTimeMs, endTimeMs);
            
            // 收集所有消息并解析（流式）
            let totalRawMessages = 0;
            let batchCount = 0;

            // 创建异步生成器：流式获取 -> 流式解析
            const broadcastProgress = (progress: number, message: string, count?: number) => {
                this.exportTasks.get(taskId) && this.updateTaskStatus(taskId, {
                    progress,
                    messageCount: count,
                    message
                });
                this.broadcastWebSocketMessage({
                    type: 'export_progress',
                    data: { taskId, status: 'running', progress, message, messageCount: count }
                });
            };

            async function* streamParseMessages(
                rawGenerator: AsyncGenerator<any[], void, unknown>,
                parserInstance: SimpleMessageParser,
                filterOpts: any,
                updateProgress: (progress: number, message: string, count?: number) => void,
                resourceHandler: ResourceHandler
            ) {
                for await (const batch of rawGenerator) {
                    batchCount++;
                    const currentProgress = Math.min(batchCount * 3, 50);
                    
                    // 过滤指定用户
                    let filteredBatch = batch;
                    if (filterOpts?.excludeUserUins && filterOpts.excludeUserUins.length > 0) {
                        const excludeSet = new Set(filterOpts.excludeUserUins.map((uin: string) => String(uin)));
                        filteredBatch = filteredBatch.filter((msg: any) => !excludeSet.has(String(msg.senderUin || '')));
                    }

                    // 先处理资源（下载到本地）
                    if (filteredBatch.length > 0) {
                        try {
                            updateProgress(currentProgress, `正在下载资源 (批次 ${batchCount})...`, totalRawMessages);
                            await resourceHandler.processMessageResources(filteredBatch);
                        } catch (e) {
                            console.warn(`[StreamingZip] 批次资源处理失败:`, e);
                        }
                    }

                    for (const rawMsg of filteredBatch) {
                        const cleanMsg = await parserInstance.parseSingleMessage(rawMsg);
                        if (cleanMsg) {
                            totalRawMessages++;
                            yield cleanMsg;
                        }
                    }

                    updateProgress(currentProgress, `已获取 ${totalRawMessages} 条消息...`, totalRawMessages);

                    // 每5批次触发垃圾回收
                    if (batchCount % 5 === 0 && global.gc) {
                        global.gc();
                    }
                }
            }

            const cleanMessageStream = streamParseMessages(messageGenerator, parser, filter, broadcastProgress, taskResourceHandler);

            // 使用分块导出（流式写入）
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: { taskId, status: 'running', progress: 65, message: '正在分块写入...' }
            });

            const chunkedResult = await htmlExporter.exportChunkedFromIterable(
                cleanMessageStream,
                chatInfo,
                {
                    maxMessagesPerChunk: 2000,
                    maxChunkBytes: 50 * 1024 * 1024, // 50MB
                    enableTextBloom: true,
                    msgIdIndexBucketCount: 64
                }
            );

            // 更新进度
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: { taskId, status: 'running', progress: 80, message: '正在打包ZIP文件...' }
            });

            // 使用 archiver 打包整个临时目录
            const archiver = await import('archiver');
            const archive = archiver.default('zip', { zlib: { level: 6 } });
            const outputStream = fs.createWriteStream(zipFilePath);

            await new Promise<void>((resolve, reject) => {
                outputStream.on('close', () => resolve());
                outputStream.on('error', reject);
                archive.on('error', reject);

                archive.pipe(outputStream);

                // 添加整个临时目录的内容到ZIP根目录
                archive.directory(tempDir!, false);

                archive.finalize();
            });

            const zipStats = fs.statSync(zipFilePath);

            // 清理临时目录
            if (tempDir && fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }

            // 更新任务为完成状态
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'completed',
                    progress: 100,
                    message: '流式分块导出完成',
                    messageCount: chunkedResult.totalMessages,
                    filePath: zipFilePath,
                    fileSize: zipStats.size,
                    completedAt: new Date().toISOString(),
                    fileName,
                    isZipExport: true,
                    streamingMode: true
                });
            }

            // Issue #192: 根据是否使用自定义路径生成正确的下载URL
            const finalDownloadUrl = this.generateDownloadUrl(zipFilePath, fileName, customOutputDir, '/download?file=');

            this.broadcastWebSocketMessage({
                type: 'export_complete',
                data: {
                    taskId,
                    status: 'completed',
                    progress: 100,
                    message: '流式分块导出完成',
                    messageCount: chunkedResult.totalMessages,
                    fileName,
                    filePath: zipFilePath,
                    fileSize: zipStats.size,
                    downloadUrl: finalDownloadUrl,
                    isZipExport: true,
                    streamingMode: true,
                    chunkCount: chunkedResult.chunkCount
                }
            });

            await this.dbManager.flushWriteQueue();

        } catch (error) {
            console.error(`[ApiServer] 流式分块ZIP导出任务失败: ${taskId}`, error);
            
            // 清理临时目录
            if (tempDir && fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (e) {
                    console.error(`[ApiServer] 清理临时目录失败:`, e);
                }
            }

            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : '流式分块导出失败',
                    completedAt: new Date().toISOString()
                });
            }

            this.broadcastWebSocketMessage({
                type: 'export_error',
                data: {
                    taskId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : '流式分块导出失败'
                }
            });
        } finally {
            const resourceHandler = this.taskResourceHandlers.get(taskId);
            if (resourceHandler) {
                await resourceHandler.cleanup();
                this.taskResourceHandlers.delete(taskId);
            }
        }
    }

    /**
     * 流式JSONL导出处理（异步后台任务）
     * 使用 JsonExporter 的 exportChunkedJsonl 方法，全程流式处理防止OOM
     */
    private async processStreamingJsonlExportAsync(
        taskId: string,
        peer: any,
        filter: any,
        options: any,
        dirName: string,
        customOutputDir?: string
    ): Promise<void> {
        let task = this.exportTasks.get(taskId);
        
        try {
            // 更新任务状态
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'running',
                    progress: 0,
                    message: '初始化流式JSONL导出...'
                });
            }

            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: { taskId, status: 'running', progress: 0, message: '初始化流式JSONL导出...' }
            });

            // 准备输出路径（Issue #192: 支持自定义导出路径）
            const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
            const outputDir = customOutputDir && customOutputDir.trim() ? customOutputDir.trim() : defaultOutputDir;
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const jsonlOutputDir = path.join(outputDir, dirName);

            // 获取聊天信息
            let sessionName = task?.sessionName || peer.peerUid;
            const selfInfo = this.core.selfInfo;
            const chatInfo = {
                name: sessionName,
                type: (peer.chatType === ChatType.Group || peer.chatType === 2 ? 'group' : 'private') as 'group' | 'private',
                selfUid: selfInfo?.uid,
                selfUin: selfInfo?.uin,
                selfName: selfInfo?.nick
            };

            // 配置消息获取器
            const fetcher = new BatchMessageFetcher(this.core, {
                batchSize: options?.batchSize || 3000,
                timeout: 120000,
                retryCount: 3
            });

            // 处理时间戳
            let startTimeMs = filter?.startTime ? filter.startTime : 0;
            let endTimeMs = filter?.endTime ? filter.endTime : Date.now();
            
            if (startTimeMs > 1000000000 && startTimeMs < 10000000000) {
                startTimeMs = startTimeMs * 1000;
            }
            if (endTimeMs > 1000000000 && endTimeMs < 10000000000) {
                endTimeMs = endTimeMs * 1000;
            }

            // 创建消息流生成器
            const messageGenerator = fetcher.fetchAllMessagesInTimeRange(peer, startTimeMs, endTimeMs);
            
            // 真正流式处理：边获取边解析边写入，不累积到内存
            let totalRawMessages = 0;
            let batchCount = 0;

            const broadcastProgress = (progress: number, message: string, count?: number) => {
                this.exportTasks.get(taskId) && this.updateTaskStatus(taskId, {
                    progress,
                    messageCount: count,
                    message
                });
                this.broadcastWebSocketMessage({
                    type: 'export_progress',
                    data: { taskId, status: 'running', progress, message, messageCount: count }
                });
            };

            // 准备 JSONL 输出目录
            const chunksDir = path.join(jsonlOutputDir, 'chunks');
            if (!fs.existsSync(chunksDir)) {
                fs.mkdirSync(chunksDir, { recursive: true });
            }

            // 初始化解析器
            const { SimpleMessageParser } = await import('../core/parser/SimpleMessageParser.js');
            const parser = new SimpleMessageParser(this.core);

            // 头像收集（如果启用了 embedAvatarsAsBase64）
            const embedAvatars = options?.embedAvatarsAsBase64 === true;
            const avatarUins = new Set<string>(); // 收集所有发送者的 QQ 号

            // 流式 JSONL 写入状态
            const maxMessagesPerChunk = 50000;
            const maxBytesPerChunk = 50 * 1024 * 1024;
            let currentChunkIndex = 0;
            let currentChunkMessages = 0;
            let currentChunkBytes = 0;
            let currentWriteStream: ReturnType<typeof fs.createWriteStream> | null = null;
            const chunks: Array<{ file: string; messages: number; bytes: number; startTime?: number; endTime?: number }> = [];
            let chunkStartTime: number | undefined;
            let chunkEndTime: number | undefined;

            const startNewChunk = () => {
                if (currentWriteStream) {
                    currentWriteStream.end();
                    chunks.push({
                        file: `chunks/chunk_${String(currentChunkIndex).padStart(4, '0')}.jsonl`,
                        messages: currentChunkMessages,
                        bytes: currentChunkBytes,
                        startTime: chunkStartTime,
                        endTime: chunkEndTime
                    });
                }
                currentChunkIndex++;
                currentChunkMessages = 0;
                currentChunkBytes = 0;
                chunkStartTime = undefined;
                chunkEndTime = undefined;
                const chunkPath = path.join(chunksDir, `chunk_${String(currentChunkIndex).padStart(4, '0')}.jsonl`);
                currentWriteStream = fs.createWriteStream(chunkPath, { encoding: 'utf-8' });
            };

            // 开始第一个 chunk
            startNewChunk();

            // 流式获取 -> 解析 -> 写入
            for await (const batch of messageGenerator) {
                batchCount++;
                const currentProgress = Math.min(batchCount * 3, 80);
                
                // 过滤指定用户
                let filteredBatch = batch;
                if (filter?.excludeUserUins && filter.excludeUserUins.length > 0) {
                    const excludeSet = new Set(filter.excludeUserUins.map((uin: string) => String(uin)));
                    filteredBatch = filteredBatch.filter((msg: any) => !excludeSet.has(String(msg.senderUin || '')));
                }

                // 逐条解析并写入（不累积）
                for (const rawMsg of filteredBatch) {
                    const cleanMsg = await parser.parseSingleMessage(rawMsg);
                    if (!cleanMsg) continue;

                    const line = JSON.stringify(cleanMsg) + '\n';
                    const lineBytes = Buffer.byteLength(line, 'utf-8');

                    // 检查是否需要切换到新 chunk
                    if (currentChunkMessages >= maxMessagesPerChunk || currentChunkBytes + lineBytes > maxBytesPerChunk) {
                        startNewChunk();
                    }

                    // 写入当前 chunk
                    currentWriteStream!.write(line);
                    currentChunkMessages++;
                    currentChunkBytes += lineBytes;
                    totalRawMessages++;

                    // 收集发送者 QQ 号用于头像下载
                    if (embedAvatars && cleanMsg.sender?.uin) {
                        avatarUins.add(String(cleanMsg.sender.uin));
                    }

                    // 更新时间范围
                    const msgTime = cleanMsg.timestamp;
                    if (msgTime) {
                        if (!chunkStartTime || msgTime < chunkStartTime) chunkStartTime = msgTime;
                        if (!chunkEndTime || msgTime > chunkEndTime) chunkEndTime = msgTime;
                    }
                }

                broadcastProgress(currentProgress, `已处理 ${totalRawMessages} 条消息...`, totalRawMessages);

                // 每5批次触发垃圾回收
                if (batchCount % 5 === 0 && global.gc) {
                    global.gc();
                }
            }

            // 关闭最后一个 chunk
            if (currentWriteStream !== null) {
                (currentWriteStream as any).end();
                if (currentChunkMessages > 0) {
                    chunks.push({
                        file: `chunks/chunk_${String(currentChunkIndex).padStart(4, '0')}.jsonl`,
                        messages: currentChunkMessages,
                        bytes: currentChunkBytes,
                        startTime: chunkStartTime,
                        endTime: chunkEndTime
                    });
                }
            }

            // 如果启用了头像嵌入，下载所有头像并写入 avatars.json
            let avatarsRef: { file: string; count: number } | undefined;
            if (embedAvatars && avatarUins.size > 0) {
                broadcastProgress(85, `正在下载 ${avatarUins.size} 个头像...`, totalRawMessages);
                
                const avatarMap = new Map<string, string>();
                const downloadAvatar = async (uin: string): Promise<void> => {
                    try {
                        const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                        const response = await fetch(avatarUrl);
                        if (response.ok) {
                            const buffer = await response.arrayBuffer();
                            const base64 = Buffer.from(buffer).toString('base64');
                            const contentType = response.headers.get('content-type') || 'image/jpeg';
                            avatarMap.set(uin, `data:${contentType};base64,${base64}`);
                        }
                    } catch (error) {
                        // 静默处理单个头像下载失败
                    }
                };

                // 并发下载头像（限制并发数为 10）
                const uinArray = Array.from(avatarUins);
                const concurrency = 10;
                for (let i = 0; i < uinArray.length; i += concurrency) {
                    const batch = uinArray.slice(i, i + concurrency);
                    await Promise.all(batch.map(uin => downloadAvatar(uin)));
                }

                // 写入 avatars.json
                if (avatarMap.size > 0) {
                    const avatarsPath = path.join(jsonlOutputDir, 'avatars.json');
                    const avatarsObj: Record<string, string> = {};
                    for (const [uin, base64] of avatarMap.entries()) {
                        avatarsObj[uin] = base64;
                    }
                    fs.writeFileSync(avatarsPath, JSON.stringify(avatarsObj, null, 2), 'utf-8');
                    
                    avatarsRef = {
                        file: 'avatars.json',
                        count: avatarMap.size
                    };
                }
            }

            // 写入 manifest.json
            const manifest: any = {
                metadata: {
                    exportTime: new Date().toISOString(),
                    version: '5.0.0',
                    format: 'chunked-jsonl'
                },
                chatInfo,
                statistics: {
                    totalMessages: totalRawMessages,
                    chunkCount: chunks.length
                },
                chunked: {
                    format: 'jsonl',
                    chunksDir: 'chunks',
                    chunkFileExt: '.jsonl',
                    maxMessagesPerChunk,
                    maxBytesPerChunk,
                    chunks
                }
            };
            
            // 添加头像引用到 manifest
            if (avatarsRef) {
                manifest.avatars = avatarsRef;
            }
            
            const manifestPath = path.join(jsonlOutputDir, 'manifest.json');
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

            // 计算总大小
            let totalSize = fs.statSync(manifestPath).size;
            for (const chunk of chunks) {
                totalSize += chunk.bytes;
            }
            // 加上 avatars.json 大小
            if (avatarsRef) {
                try {
                    totalSize += fs.statSync(path.join(jsonlOutputDir, avatarsRef.file)).size;
                } catch {}
            }

            const result = {
                messageCount: totalRawMessages,
                fileSize: totalSize,
                chunkCount: chunks.length
            };

            // 更新任务为完成状态
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'completed',
                    progress: 100,
                    message: '流式JSONL导出完成',
                    messageCount: result.messageCount,
                    filePath: jsonlOutputDir,
                    fileSize: result.fileSize,
                    completedAt: new Date().toISOString(),
                    fileName: dirName,
                    streamingMode: true
                });
            }

            // Issue #192: JSONL导出是目录，自定义路径时返回目录路径
            const finalDownloadUrl = customOutputDir && customOutputDir.trim()
                ? jsonlOutputDir  // 自定义路径返回完整目录路径
                : `/download?file=${encodeURIComponent(dirName)}`;

            this.broadcastWebSocketMessage({
                type: 'export_complete',
                data: {
                    taskId,
                    status: 'completed',
                    progress: 100,
                    message: '流式JSONL导出完成',
                    messageCount: result.messageCount,
                    fileName: dirName,
                    filePath: jsonlOutputDir,
                    fileSize: result.fileSize,
                    downloadUrl: finalDownloadUrl,
                    streamingMode: true,
                    chunkCount: result.chunkCount
                }
            });

            await this.dbManager.flushWriteQueue();

        } catch (error) {
            console.error(`[ApiServer] 流式JSONL导出任务失败: ${taskId}`, error);

            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : '流式JSONL导出失败',
                    completedAt: new Date().toISOString()
                });
            }

            this.broadcastWebSocketMessage({
                type: 'export_error',
                data: {
                    taskId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : '流式JSONL导出失败'
                }
            });
        }
    }

    /**
     * 广播消息到所有WebSocket连接
     */
    private broadcastWebSocketMessage(message: any): void {
        this.wsConnections.forEach(ws => {
            this.sendWebSocketMessage(ws, message);
        });
    }

    /**
     * 生成请求ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 清理遗留的临时文件 (Issue #192)
     * 在启动时清理超过1小时的临时文件，避免磁盘空间浪费
     */
    private cleanupTempFiles(): void {
        try {
            // 清理默认导出目录
            const defaultExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
            this.cleanupTempFilesInDirectory(defaultExportDir);
            
            console.log('[ApiServer] 临时文件清理完成');
        } catch (error) {
            console.error('[ApiServer] 清理临时文件失败:', error);
        }
    }

    /**
     * 清理指定目录中的临时文件
     * @param directory 要清理的目录
     */
    private cleanupTempFilesInDirectory(directory: string): void {
        try {
            if (!fs.existsSync(directory)) {
                return;
            }
            
            const files = fs.readdirSync(directory);
            let cleanedCount = 0;
            
            for (const file of files) {
                // 清理 .qce_temp_ 开头的临时文件
                if (file.startsWith('.qce_temp_')) {
                    const filePath = path.join(directory, file);
                    try {
                        const stats = fs.statSync(filePath);
                        // 只清理超过 1 小时的临时文件（避免误删正在使用的文件）
                        const fileAge = Date.now() - stats.mtimeMs;
                        if (fileAge > 3600000) { // 1 小时 = 3600000 毫秒
                            fs.unlinkSync(filePath);
                            cleanedCount++;
                            console.log(`[ApiServer] 已清理临时文件: ${file}`);
                        }
                    } catch (error) {
                        // 静默处理单个文件的错误
                    }
                }
                
                // 清理 temp_ 开头的临时目录（流式ZIP导出的临时目录）
                if (file.startsWith('temp_')) {
                    const dirPath = path.join(directory, file);
                    try {
                        const stats = fs.statSync(dirPath);
                        if (stats.isDirectory()) {
                            const dirAge = Date.now() - stats.mtimeMs;
                            if (dirAge > 3600000) { // 1 小时
                                fs.rmSync(dirPath, { recursive: true, force: true });
                                cleanedCount++;
                                console.log(`[ApiServer] 已清理临时目录: ${file}`);
                            }
                        }
                    } catch (error) {
                        // 静默处理单个目录的错误
                    }
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`[ApiServer] 在 ${directory} 中共清理 ${cleanedCount} 个临时文件/目录`);
            }
        } catch (error) {
            // 静默处理目录级别的错误
        }
    }

    /**
     * 生成下载URL (Issue #192: 统一处理自定义路径和默认路径的URL生成)
     * @param filePath 文件完整路径
     * @param fileName 文件名
     * @param customOutputDir 自定义输出目录（可选）
     * @param urlPrefix 默认路径的URL前缀，默认为 '/downloads/'
     * @returns 下载URL
     */
    private generateDownloadUrl(
        filePath: string,
        fileName: string,
        customOutputDir?: string,
        urlPrefix: string = '/downloads/'
    ): string {
        // 如果使用自定义路径，返回动态下载API的URL
        if (customOutputDir && customOutputDir.trim()) {
            return `/api/download-file?path=${encodeURIComponent(filePath)}`;
        }
        // 否则返回静态文件服务的URL
        return `${urlPrefix}${fileName}`;
    }

    /**
     * Issue #216: 安全处理聊天名称，用于文件名
     * 移除文件名非法字符，限制长度，确保文件系统兼容性
     * @param name 原始聊天名称
     * @param maxLength 最大长度，默认50字符
     * @returns 安全的文件名部分
     */
    private sanitizeChatNameForFileName(name: string, maxLength: number = 50): string {
        if (!name) return '';
        // 移除文件名非法字符: < > : " / \ | ? *
        // 同时移除控制字符和其他可能导致问题的字符
        let safeName = name
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // 替换非法字符为下划线
            .replace(/\s+/g, '_')                     // 替换空白字符为下划线
            .replace(/_+/g, '_')                      // 合并连续下划线
            .replace(/^_|_$/g, '');                   // 移除首尾下划线
        
        // 限制长度
        if (safeName.length > maxLength) {
            safeName = safeName.slice(0, maxLength);
            // 确保不以下划线结尾
            safeName = safeName.replace(/_+$/, '');
        }
        
        return safeName;
    }

    /**
     * Issue #216: 生成导出文件名
     * 根据用户选项决定是否在文件名中包含聊天名称
     * @param chatTypePrefix 聊天类型前缀 (friend/group)
     * @param peerUid 对方UID
     * @param sessionName 会话名称
     * @param dateStr 日期字符串 (YYYYMMDD)
     * @param timeStr 时间字符串 (HHMMSS)
     * @param extension 文件扩展名
     * @param useNameInFileName 是否在文件名中包含聊天名称
     * @returns 生成的文件名
     */
    private generateExportFileName(
        chatTypePrefix: string,
        peerUid: string,
        sessionName: string,
        dateStr: string,
        timeStr: string,
        extension: string,
        useNameInFileName: boolean = false
    ): string {
        if (useNameInFileName && sessionName && sessionName !== peerUid) {
            const safeName = this.sanitizeChatNameForFileName(sessionName);
            if (safeName) {
                // 格式: group_群名_QQ号_日期_时间.扩展名
                return `${chatTypePrefix}_${safeName}_${peerUid}_${dateStr}_${timeStr}.${extension}`;
            }
        }
        // 默认格式: group_QQ号_日期_时间.扩展名
        return `${chatTypePrefix}_${peerUid}_${dateStr}_${timeStr}.${extension}`;
    }

    /**
     * Issue #216: 生成导出目录名（用于chunked_jsonl等目录格式）
     * @param chatTypePrefix 聊天类型前缀 (friend/group)
     * @param peerUid 对方UID
     * @param sessionName 会话名称
     * @param dateStr 日期字符串 (YYYYMMDD)
     * @param timeStr 时间字符串 (HHMMSS)
     * @param suffix 目录后缀 (如 _chunked_jsonl)
     * @param useNameInFileName 是否在目录名中包含聊天名称
     * @returns 生成的目录名
     */
    private generateExportDirName(
        chatTypePrefix: string,
        peerUid: string,
        sessionName: string,
        dateStr: string,
        timeStr: string,
        suffix: string,
        useNameInFileName: boolean = false
    ): string {
        if (useNameInFileName && sessionName && sessionName !== peerUid) {
            const safeName = this.sanitizeChatNameForFileName(sessionName);
            if (safeName) {
                // 格式: group_群名_QQ号_日期_时间_后缀
                return `${chatTypePrefix}_${safeName}_${peerUid}_${dateStr}_${timeStr}${suffix}`;
            }
        }
        // 默认格式: group_QQ号_日期_时间_后缀
        return `${chatTypePrefix}_${peerUid}_${dateStr}_${timeStr}${suffix}`;
    }
    
    /**
     * 获取真实客户端IP地址
     * 支持通过代理头获取真实IP（Docker/Nginx等反向代理环境）
     */
    private getClientIP(req: Request): string {
        // 优先使用 X-Forwarded-For 头（标准代理头）
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // X-Forwarded-For 可能包含多个IP，取第一个（最原始的客户端IP）
            const ips = (Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor).split(',');
            const clientIP = ips[0].trim();
            if (clientIP) {
                return clientIP;
            }
        }
        
        // 其次使用 X-Real-IP 头（Nginx常用）
        const xRealIP = req.headers['x-real-ip'];
        if (xRealIP) {
            return Array.isArray(xRealIP) ? xRealIP[0] : xRealIP;
        }
        
        // 使用Express的req.ip（已配置trust proxy后会自动解析代理头）
        if (req.ip) {
            return req.ip;
        }
        
        // 最后使用socket地址
        return req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    }

    /**
     * 发送成功响应
     */
    private sendSuccessResponse<T>(res: Response, data: T, requestId: string): void {
        const response: ApiResponse<T> = {
            success: true,
            data,
            timestamp: new Date().toISOString(),
            requestId
        };
        res.json(response);
    }

    /**
     * 发送错误响应
     */
    private sendErrorResponse(res: Response, error: any, requestId: string, statusCode = 500): void {
        let systemError: SystemError;
        
        if (error instanceof SystemError) {
            systemError = error;
        } else {
            systemError = new SystemError(
                ErrorType.UNKNOWN_ERROR,
                error.message || '未知错误',
                'UNKNOWN_ERROR'
            );
        }

        const response: ApiResponse = {
            success: false,
            error: {
                type: systemError.type,
                message: systemError.message,
                timestamp: systemError.timestamp,
                stack: error.stack,
                context: {
                    code: systemError.code,
                    requestId
                }
            },
            timestamp: new Date().toISOString(),
            requestId
        };
        
        this.core.context.logger.logError('[API] 请求错误:', error);
        res.status(statusCode).json(response);
    }

    /**
     * 初始化数据库并加载现有任务
     */
    async initialize(): Promise<void> {
        try {
            // 初始化安全管理器（优先）
            await this.securityManager.initialize();
            
            await this.dbManager.initialize();
            await this.loadExistingTasks();
            await this.scheduledExportManager.initialize();
            
            // 初始化前端服务
            await this.frontendBuilder.initialize();
        } catch (error) {
            console.error('[ApiServer] 初始化失败:', error);
        }
    }

    /**
     * 从数据库加载现有任务
     */
    private async loadExistingTasks(): Promise<void> {
        try {
            const tasks = await this.dbManager.getAllTasks();
            
            for (const { config, state } of tasks) {
                
                // 从state中恢复fileName和filePath（如果有的话）
                const fileName = (state as any).fileName || `${config.chatName}_${Date.now()}.json`;
                const filePath = (state as any).filePath;
                
                // Issue #192: 检查是否使用了自定义导出路径
                const defaultOutputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
                const isCustomPath = filePath && !filePath.startsWith(defaultOutputDir);
                
                // 根据是否使用自定义路径生成正确的下载URL
                const downloadUrl = this.generateDownloadUrl(
                    filePath || '', 
                    fileName, 
                    isCustomPath ? filePath : undefined
                );
                
                // 转换为API格式
                const apiTask = {
                    taskId: config.taskId,
                    peer: config.peer,
                    sessionName: config.chatName,
                    status: state.status,
                    progress: state.totalMessages > 0 ? Math.round((state.processedMessages / state.totalMessages) * 100) : 0,
                    format: config.formats[0] || 'JSON',
                    messageCount: state.processedMessages,
                    fileName: fileName,
                    filePath: filePath,  // 恢复filePath
                    downloadUrl: downloadUrl,
                    createdAt: typeof config.createdAt === 'string' ? config.createdAt : config.createdAt.toISOString(),
                    completedAt: state.endTime 
                        ? (typeof state.endTime === 'string' ? state.endTime : state.endTime.toISOString())
                        : undefined,
                    error: state.error,
                    filter: {
                        startTime: config.filter.startTime,
                        endTime: config.filter.endTime
                    },
                    options: {
                        batchSize: config.batchSize,
                        includeResourceLinks: config.includeResourceLinks
                    }
                };
                
                this.exportTasks.set(config.taskId, apiTask);
            }
        } catch (error) {
            console.error('[ApiServer] 加载现有任务失败:', error);
        }
    }

    /**
     * 保存任务到数据库
     */
    private async saveTaskToDatabase(task: any): Promise<void> {
        try {
            const config: ExportTaskConfig = {
                taskId: task.taskId,
                taskName: task.sessionName,
                peer: task.peer,
                chatType: task.peer.chatType === 1 ? ChatTypeSimple.PRIVATE : ChatTypeSimple.GROUP,
                chatName: task.sessionName,
                chatAvatar: '', // 可以后续添加
                formats: [task.format?.toUpperCase() || 'JSON'] as ExportFormat[],
                filter: {
                    startTime: task.filter?.startTime,
                    endTime: task.filter?.endTime,
                    includeRecalled: task.filter?.includeRecalled || false
                },
                // Issue #192: 保存实际使用的输出目录（可能是自定义路径）
                outputDir: task.options?.outputDir?.trim() || path.join(process.env['USERPROFILE'] || process.env['HOME'] || '.', '.qq-chat-exporter', 'exports'),
                includeResourceLinks: task.options?.includeResourceLinks || true,
                batchSize: task.options?.batchSize || 5000,
                timeout: 30000,
                retryCount: 3,
                createdAt: new Date(task.createdAt),
                updatedAt: new Date()
            };

            const state: ExportTaskState = {
                taskId: task.taskId,
                status: task.status === 'running' ? ExportTaskStatus.RUNNING : 
                       task.status === 'completed' ? ExportTaskStatus.COMPLETED :
                       task.status === 'failed' ? ExportTaskStatus.FAILED :
                       ExportTaskStatus.PENDING,
                totalMessages: 0,
                processedMessages: task.messageCount || 0,
                successCount: task.messageCount || 0,
                failureCount: 0,
                currentMessageId: undefined,
                error: task.error,
                startTime: task.createdAt ? new Date(task.createdAt) : new Date(),
                endTime: task.completedAt ? new Date(task.completedAt) : undefined,
                processingSpeed: 0,
                fileName: task.fileName,  // 保存文件名
                filePath: task.filePath   // 保存文件路径
            } as any;

            await this.dbManager.saveTask(config, state);
        } catch (error) {
            console.error('[ApiServer] 保存任务到数据库失败:', error);
        }
    }

    /**
     * 更新任务状态并同步到数据库
     */
    private async updateTaskStatus(taskId: string, updates: Partial<any>): Promise<void> {
        const task = this.exportTasks.get(taskId);
        if (!task) return;

        // 更新内存中的任务
        Object.assign(task, updates);
        this.exportTasks.set(taskId, task);

        // 异步保存到数据库（不阻塞）
        this.saveTaskToDatabase(task).catch(error => {
            console.error(`[ApiServer] 更新任务 ${taskId} 到数据库失败:`, error);
        });
    }

    /**
     * 启动服务器
     */
    async start(): Promise<void> {
        // 先初始化数据库
        await this.initialize();
        
        return new Promise((resolve, reject) => {
            this.server.listen(40653, '0.0.0.0', () => {
                // 获取安全和网络信息
                const securityStatus = this.securityManager.getSecurityStatus();
                const serverAddresses = this.securityManager.getServerAddresses();
                const accessToken = this.securityManager.getAccessToken();
                const frontendStatus = this.frontendBuilder.getStatus();
                
                // 检测终端是否支持 ANSI 颜色
                const supportsColor = process.stdout.isTTY && (
                    process.platform !== 'win32' ||
                    process.env.TERM === 'xterm' ||
                    process.env.TERM === 'xterm-256color' ||
                    process.env.WT_SESSION || // Windows Terminal
                    process.env.COLORTERM ||
                    process.env.ANSICON
                );
                const green = supportsColor ? '\x1b[38;5;28m' : '';
                const reset = supportsColor ? '\x1b[0m' : '';
                
                console.log('');
                console.log(`${green}[QCE]${reset} QQChatExporter v5.0.0`);
                
                // 显示服务地址（只显示外部地址，如果有的话）
                if (serverAddresses.external) {
                    console.log(`${green}[QCE]${reset} API: ${green}${serverAddresses.external}${reset}`);
                }
                
                // 显示访问令牌
                if (accessToken) {
                    console.log(`${green}[QCE]${reset} Token: ${green}${accessToken}${reset}`);
                }
                
                // 显示前端地址
                if (frontendStatus.isRunning && frontendStatus.mode === 'production') {
                    const toolUrl = serverAddresses.external 
                        ? `${serverAddresses.external}/qce-v4-tool` 
                        : `${serverAddresses.local}/qce-v4-tool`;
                    console.log(`${green}[QCE]${reset} Web界面: ${green}${toolUrl}${reset}`);
                } else if (frontendStatus.mode === 'development') {
                    console.log(`${green}[QCE]${reset} Web界面: ${green}${frontendStatus.frontendUrl}${reset}`);
                }
                console.log('');
                
                // 广播服务器启动消息
                this.broadcastWebSocketMessage({
                    type: 'notification',
                    data: { 
                        message: 'QQ聊天记录导出工具API服务器已启动',
                        version: '5.0.0',
                        frontend: frontendStatus
                    },
                    timestamp: new Date().toISOString()
                });
                
                resolve();
            });

            this.server.on('error', (error) => {
                console.error('[QCE] 服务器启动失败:', error);
                reject(error);
            });
        });
    }

    /**
     * 关闭服务器
     */
    async stop(): Promise<void> {
        return new Promise(async (resolve) => {
            // 1. 刷新数据库写入队列
            try {
                await this.dbManager.close();
            } catch (error) {
                console.error('[QCE] 关闭数据库失败:', error);
            }
            
            // 2. 停止前端服务
            try {
                await this.frontendBuilder.stop();
            } catch (error) {
                // 静默处理
            }
            
            // 3. 关闭所有WebSocket连接
            this.wsConnections.forEach(ws => {
                ws.close(1000, '服务器关闭');
            });

            // 4. 关闭WebSocket服务器
            this.wss.close();

            // 5. 关闭HTTP服务器
            this.server.close(() => {
                console.log('[QCE] 服务器已关闭');
                resolve();
            });
        });
    }

    /**
     * 从HTML文件中读取元数据注释
     */
    private parseHtmlMetadata(filePath: string): { messageCount?: number; chatName?: string } {
        try {
            // 只读取文件的前1KB，足够包含元数据注释
            const buffer = fs.readFileSync(filePath);
            const header = buffer.toString('utf8', 0, Math.min(1024, buffer.length));
            
            // 匹配元数据注释: <!-- QCE_METADATA: {...} -->
            const match = header.match(/<!-- QCE_METADATA: ({[^}]+}) -->/);
            if (match && match[1]) {
                const metadata = JSON.parse(match[1]);
                return {
                    messageCount: metadata.messageCount || 0,
                    chatName: metadata.chatName
                };
            }
        } catch (error) {
            // 忽略解析错误，返回空对象
        }
        return {};
    }

    /**
     * 从 JSON 导出文件中提取元数据
     */
    private parseJsonMetadata(filePath: string): { messageCount?: number; chatName?: string; timeRange?: string } {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            const timeRange = data?.statistics?.timeRange;

            return {
                messageCount: data?.statistics?.totalMessages,
                chatName: data?.chatInfo?.name,
                timeRange: timeRange?.start && timeRange?.end
                    ? `${timeRange.start} ~ ${timeRange.end}`
                    : undefined
            };
        } catch (error) {
            // JSON 体积可能较大，解析失败时静默忽略
        }
        return {};
    }

    /**
     * 获取导出文件列表
     */
    private async getExportFiles(): Promise<any[]> {
        const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
        const scheduledExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
        
        const files: any[] = [];
        
        try {
            // 扫描主导出目录
            if (fs.existsSync(exportDir)) {
                const mainFiles = fs.readdirSync(exportDir, { withFileTypes: true });

                for (const entry of mainFiles) {
                    const fileName = entry.name;
                    const normalizedName = fileName.toLowerCase();
                    const filePath = path.join(exportDir, fileName);
                    
                    // 处理 _chunked_jsonl 目录
                    if (entry.isDirectory() && normalizedName.endsWith('_chunked_jsonl')) {
                        const fileInfo = this.parseChunkedJsonlDirName(fileName);
                        if (fileInfo) {
                            const stats = fs.statSync(filePath);
                            // 尝试从 manifest.json 读取元数据
                            const manifestPath = path.join(filePath, 'manifest.json');
                            if (fs.existsSync(manifestPath)) {
                                try {
                                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                                    fileInfo.messageCount = manifest?.statistics?.totalMessages;
                                    fileInfo.displayName = manifest?.chatInfo?.name;
                                } catch {}
                            }
                            
                            if (!fileInfo.displayName) {
                                fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                            }
                            
                            files.push({
                                fileName,
                                filePath,
                                relativePath: `/downloads/${fileName}`,
                                size: stats.size,
                                createTime: stats.birthtime,
                                modifyTime: stats.mtime,
                                ...fileInfo
                            });
                        }
                        continue;
                    }
                    
                    // 处理 _streaming.zip 文件
                    if (entry.isFile() && normalizedName.endsWith('_streaming.zip')) {
                        const fileInfo = this.parseStreamingZipFileName(fileName);
                        if (fileInfo) {
                            const stats = fs.statSync(filePath);
                            
                            if (!fileInfo.displayName) {
                                fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                            }
                            
                            files.push({
                                fileName,
                                filePath,
                                relativePath: `/downloads/${fileName}`,
                                size: stats.size,
                                createTime: stats.birthtime,
                                modifyTime: stats.mtime,
                                ...fileInfo
                            });
                        }
                        continue;
                    }
                    
                    // 处理普通 .html 和 .json 文件
                    if (!entry.isFile()) continue;
                    if (!normalizedName.endsWith('.html') && !normalizedName.endsWith('.json')) {
                        continue;
                    }

                    const stats = fs.statSync(filePath);
                    const fileInfo = this.parseExportFileName(fileName);
                    
                    if (fileInfo) {
                        if (fileInfo.format === 'HTML') {
                            const htmlMetadata = this.parseHtmlMetadata(filePath);
                            if (htmlMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = htmlMetadata.messageCount;
                            }
                            if (htmlMetadata.chatName) {
                                fileInfo.displayName = htmlMetadata.chatName;
                            }
                        } else if (fileInfo.format === 'JSON') {
                            const jsonMetadata = this.parseJsonMetadata(filePath);
                            if (jsonMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = jsonMetadata.messageCount;
                            }
                            if (jsonMetadata.chatName) {
                                fileInfo.displayName = jsonMetadata.chatName;
                            }
                            if (jsonMetadata.timeRange) {
                                fileInfo.description = jsonMetadata.timeRange;
                            }
                        }
                        
                        if (!fileInfo.displayName) {
                            fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                        }
                        
                        files.push({
                            fileName,
                            filePath: filePath,
                            relativePath: `/downloads/${fileName}`,
                            size: stats.size,
                            createTime: stats.birthtime,
                            modifyTime: stats.mtime,
                            ...fileInfo
                        });
                    }
                }
            }
            
            // 扫描定时导出目录
            if (fs.existsSync(scheduledExportDir)) {
                const scheduledFiles = fs.readdirSync(scheduledExportDir, { withFileTypes: true });

                for (const entry of scheduledFiles) {
                    const fileName = entry.name;
                    const normalizedName = fileName.toLowerCase();
                    const filePath = path.join(scheduledExportDir, fileName);
                    
                    // 处理 _chunked_jsonl 目录
                    if (entry.isDirectory() && normalizedName.endsWith('_chunked_jsonl')) {
                        const fileInfo = this.parseChunkedJsonlDirName(fileName);
                        if (fileInfo) {
                            const stats = fs.statSync(filePath);
                            const manifestPath = path.join(filePath, 'manifest.json');
                            if (fs.existsSync(manifestPath)) {
                                try {
                                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                                    fileInfo.messageCount = manifest?.statistics?.totalMessages;
                                    fileInfo.displayName = manifest?.chatInfo?.name;
                                } catch {}
                            }
                            
                            if (!fileInfo.displayName) {
                                fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                            }
                            
                            files.push({
                                fileName,
                                filePath,
                                relativePath: `/scheduled-downloads/${fileName}`,
                                size: stats.size,
                                createTime: stats.birthtime,
                                modifyTime: stats.mtime,
                                isScheduled: true,
                                ...fileInfo
                            });
                        }
                        continue;
                    }
                    
                    // 处理 _streaming.zip 文件
                    if (entry.isFile() && normalizedName.endsWith('_streaming.zip')) {
                        const fileInfo = this.parseStreamingZipFileName(fileName);
                        if (fileInfo) {
                            const stats = fs.statSync(filePath);
                            
                            if (!fileInfo.displayName) {
                                fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                            }
                            
                            files.push({
                                fileName,
                                filePath,
                                relativePath: `/scheduled-downloads/${fileName}`,
                                size: stats.size,
                                createTime: stats.birthtime,
                                modifyTime: stats.mtime,
                                isScheduled: true,
                                ...fileInfo
                            });
                        }
                        continue;
                    }
                    
                    // 处理普通文件
                    if (!entry.isFile()) continue;
                    if (!normalizedName.endsWith('.html') && !normalizedName.endsWith('.json')) {
                        continue;
                    }

                    const stats = fs.statSync(filePath);
                    const fileInfo = this.parseExportFileName(fileName);
                    
                    if (fileInfo) {
                        if (fileInfo.format === 'HTML') {
                            const htmlMetadata = this.parseHtmlMetadata(filePath);
                            if (htmlMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = htmlMetadata.messageCount;
                            }
                            if (htmlMetadata.chatName) {
                                fileInfo.displayName = htmlMetadata.chatName;
                            }
                        } else if (fileInfo.format === 'JSON') {
                            const jsonMetadata = this.parseJsonMetadata(filePath);
                            if (jsonMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = jsonMetadata.messageCount;
                            }
                            if (jsonMetadata.chatName) {
                                fileInfo.displayName = jsonMetadata.chatName;
                            }
                            if (jsonMetadata.timeRange) {
                                fileInfo.description = jsonMetadata.timeRange;
                            }
                        }
                        
                        if (!fileInfo.displayName) {
                            fileInfo.displayName = await this.getDisplayNameForChat(fileInfo.chatType, fileInfo.chatId);
                        }
                        
                        files.push({
                            fileName,
                            filePath: filePath,
                            relativePath: `/scheduled-downloads/${fileName}`,
                            size: stats.size,
                            createTime: stats.birthtime,
                            modifyTime: stats.mtime,
                            isScheduled: true,
                            ...fileInfo
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[ApiServer] 获取导出文件列表失败:', error);
        }
        
        // 按修改时间倒序排序
        return files.sort((a, b) => new Date(b.modifyTime).getTime() - new Date(a.modifyTime).getTime());
    }

    /**
     * 解析导出文件名获取基本信息
     * Issue #216: 支持新格式 (friend|group)_聊天名_ID_日期_时间.扩展名
     * 同时保持向后兼容旧格式 (friend|group)_ID_日期_时间.扩展名
     * 注意：ID 可能包含非数字字符（如 u_xxx）
     */
    private parseExportFileName(fileName: string): any | null {
        // 新格式：friend_聊天名_1234567890_20250830_142843.html 或 group_群名_u_123_20250830_142843.html
        // 旧格式：friend_1234567890_20250830_142843.html 或 group_u_xxx_20250830_142843.html
        
        // 使用从右向左的匹配策略：先匹配固定的日期时间部分，再处理前面的部分
        // 基础模式：匹配 _日期_时间.扩展名 部分
        const baseMatch = fileName.match(/^(friend|group)_(.+)_(\d{8})_(\d{6})(?:_\d{3}_TEMP)?\.(html|json)$/i);
        if (!baseMatch) return null;
        
        const [, type, middlePart, date, time, extension] = baseMatch;
        if (!date || !time || !middlePart) return null;
        
        const dateTime = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)} ${time.substr(0,2)}:${time.substr(2,2)}:${time.substr(4,2)}`;
        
        // 尝试从 middlePart 中分离聊天名和ID
        // 新格式：middlePart = "聊天名_ID" 或 "聊天名_u_xxx"
        // 旧格式：middlePart = "ID" 或 "u_xxx"
        
        // 策略：从右向左找最后一个看起来像ID的部分
        // ID特征：纯数字，或者以 u_ 开头的字符串
        const lastUnderscoreIdx = middlePart.lastIndexOf('_');
        
        if (lastUnderscoreIdx > 0) {
            const possibleId = middlePart.substring(lastUnderscoreIdx + 1);
            const possibleChatName = middlePart.substring(0, lastUnderscoreIdx);
            
            // 如果最后一部分是纯数字，认为是新格式
            if (/^\d+$/.test(possibleId) && possibleChatName) {
                return {
                    chatType: type as 'friend' | 'group',
                    chatId: possibleId,
                    exportDate: dateTime,
                    displayName: possibleChatName.replace(/_/g, ' '),
                    format: extension?.toUpperCase() === 'JSON' ? 'JSON' : 'HTML',
                    avatarUrl: type === 'friend' ? 
                        `https://q1.qlogo.cn/g?b=qq&nk=${possibleId}&s=100` : 
                        `https://p.qlogo.cn/gh/${possibleId}/${possibleId}/100`
                };
            }
            
            // 检查是否是 chatName_u_xxx 格式（ID以u_开头）
            const secondLastIdx = possibleChatName.lastIndexOf('_');
            if (secondLastIdx > 0) {
                const possibleUPrefix = possibleChatName.substring(secondLastIdx + 1);
                if (possibleUPrefix === 'u') {
                    // 格式是 chatName_u_xxx，ID = u_xxx
                    const chatName = possibleChatName.substring(0, secondLastIdx);
                    const id = `u_${possibleId}`;
                    return {
                        chatType: type as 'friend' | 'group',
                        chatId: id,
                        exportDate: dateTime,
                        displayName: chatName.replace(/_/g, ' '),
                        format: extension?.toUpperCase() === 'JSON' ? 'JSON' : 'HTML',
                        avatarUrl: type === 'friend' ? 
                            `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100` : 
                            `https://p.qlogo.cn/gh/${id}/${id}/100`
                    };
                }
            }
        }
        
        // 旧格式：整个 middlePart 就是 ID
        return {
            chatType: type as 'friend' | 'group',
            chatId: middlePart,
            exportDate: dateTime,
            displayName: undefined,
            format: extension?.toUpperCase() === 'JSON' ? 'JSON' : 'HTML',
            avatarUrl: type === 'friend' ? 
                `https://q1.qlogo.cn/g?b=qq&nk=${middlePart}&s=100` : 
                `https://p.qlogo.cn/gh/${middlePart}/${middlePart}/100`
        };
    }

    /**
     * 解析 _chunked_jsonl 目录名获取基本信息
     * Issue #216: 支持新格式 group_群名_ID_日期_时间_chunked_jsonl
     * 同时保持向后兼容旧格式 group_ID_日期_时间_chunked_jsonl
     */
    private parseChunkedJsonlDirName(dirName: string): any | null {
        // 移除 _chunked_jsonl 后缀
        const baseName = dirName.replace(/_chunked_jsonl$/i, '');
        
        // 使用与 parseExportFileName 相同的策略
        const baseMatch = baseName.match(/^(friend|group)_(.+)_(\d{8})_(\d{6})$/i);
        if (!baseMatch) return null;
        
        const [, type, middlePart, date, time] = baseMatch;
        if (!date || !time || !middlePart) return null;
        
        const dateTime = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)} ${time.substr(0,2)}:${time.substr(2,2)}:${time.substr(4,2)}`;
        
        const lastUnderscoreIdx = middlePart.lastIndexOf('_');
        
        if (lastUnderscoreIdx > 0) {
            const possibleId = middlePart.substring(lastUnderscoreIdx + 1);
            const possibleChatName = middlePart.substring(0, lastUnderscoreIdx);
            
            if (/^\d+$/.test(possibleId) && possibleChatName) {
                return {
                    chatType: type as 'friend' | 'group',
                    chatId: possibleId,
                    exportDate: dateTime,
                    displayName: possibleChatName.replace(/_/g, ' '),
                    format: 'JSONL',
                    avatarUrl: type === 'friend' ? 
                        `https://q1.qlogo.cn/g?b=qq&nk=${possibleId}&s=100` : 
                        `https://p.qlogo.cn/gh/${possibleId}/${possibleId}/100`
                };
            }
            
            const secondLastIdx = possibleChatName.lastIndexOf('_');
            if (secondLastIdx > 0) {
                const possibleUPrefix = possibleChatName.substring(secondLastIdx + 1);
                if (possibleUPrefix === 'u') {
                    const chatName = possibleChatName.substring(0, secondLastIdx);
                    const id = `u_${possibleId}`;
                    return {
                        chatType: type as 'friend' | 'group',
                        chatId: id,
                        exportDate: dateTime,
                        displayName: chatName.replace(/_/g, ' '),
                        format: 'JSONL',
                        avatarUrl: type === 'friend' ? 
                            `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100` : 
                            `https://p.qlogo.cn/gh/${id}/${id}/100`
                    };
                }
            }
        }
        
        return {
            chatType: type as 'friend' | 'group',
            chatId: middlePart,
            exportDate: dateTime,
            displayName: undefined,
            format: 'JSONL',
            avatarUrl: type === 'friend' ? 
                `https://q1.qlogo.cn/g?b=qq&nk=${middlePart}&s=100` : 
                `https://p.qlogo.cn/gh/${middlePart}/${middlePart}/100`
        };
    }

    /**
     * 解析 _streaming.zip 文件名获取基本信息
     * Issue #216: 支持新格式 group_群名_ID_日期_时间_streaming.zip
     * 同时保持向后兼容旧格式 group_ID_日期_时间_streaming.zip
     */
    private parseStreamingZipFileName(fileName: string): any | null {
        // 移除 _streaming.zip 后缀
        const baseName = fileName.replace(/_streaming\.zip$/i, '');
        
        // 使用与 parseExportFileName 相同的策略
        const baseMatch = baseName.match(/^(friend|group)_(.+)_(\d{8})_(\d{6})$/i);
        if (!baseMatch) return null;
        
        const [, type, middlePart, date, time] = baseMatch;
        if (!date || !time || !middlePart) return null;
        
        const dateTime = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)} ${time.substr(0,2)}:${time.substr(2,2)}:${time.substr(4,2)}`;
        
        const lastUnderscoreIdx = middlePart.lastIndexOf('_');
        
        if (lastUnderscoreIdx > 0) {
            const possibleId = middlePart.substring(lastUnderscoreIdx + 1);
            const possibleChatName = middlePart.substring(0, lastUnderscoreIdx);
            
            if (/^\d+$/.test(possibleId) && possibleChatName) {
                return {
                    chatType: type as 'friend' | 'group',
                    chatId: possibleId,
                    exportDate: dateTime,
                    displayName: possibleChatName.replace(/_/g, ' '),
                    format: 'ZIP',
                    avatarUrl: type === 'friend' ? 
                        `https://q1.qlogo.cn/g?b=qq&nk=${possibleId}&s=100` : 
                        `https://p.qlogo.cn/gh/${possibleId}/${possibleId}/100`
                };
            }
            
            const secondLastIdx = possibleChatName.lastIndexOf('_');
            if (secondLastIdx > 0) {
                const possibleUPrefix = possibleChatName.substring(secondLastIdx + 1);
                if (possibleUPrefix === 'u') {
                    const chatName = possibleChatName.substring(0, secondLastIdx);
                    const id = `u_${possibleId}`;
                    return {
                        chatType: type as 'friend' | 'group',
                        chatId: id,
                        exportDate: dateTime,
                        displayName: chatName.replace(/_/g, ' '),
                        format: 'ZIP',
                        avatarUrl: type === 'friend' ? 
                            `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100` : 
                            `https://p.qlogo.cn/gh/${id}/${id}/100`
                    };
                }
            }
        }
        
        return {
            chatType: type as 'friend' | 'group',
            chatId: middlePart,
            exportDate: dateTime,
            displayName: undefined,
            format: 'ZIP',
            avatarUrl: type === 'friend' ? 
                `https://q1.qlogo.cn/g?b=qq&nk=${middlePart}&s=100` : 
                `https://p.qlogo.cn/gh/${middlePart}/${middlePart}/100`
        };
    }

    /**
     * 获取聊天对象的显示名称
     */
    private async getDisplayNameForChat(chatType: 'friend' | 'group', chatId: string): Promise<string | undefined> {
        try {
            if (chatType === 'group') {
                const groups = await this.core.apis.GroupApi.getGroups(false);
                const group = groups.find(g => g.groupCode === chatId);
                return group?.groupName;
            } else {
                const friends = await this.core.apis.FriendApi.getFriends(false);
                const friend = friends.find(f => f.uin === chatId || f.uid === chatId);
                return friend?.nick || friend?.remark;
            }
        } catch (error) {
            console.warn(`[ApiServer] 获取 ${chatType} ${chatId} 显示名称失败:`, error);
            return undefined;
        }
    }

    /**
     * 获取特定导出文件的详细信息
     */
    private getExportFileInfo(fileName: string): any {
        const exportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
        const scheduledExportDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports');
        
        let filePath = path.join(exportDir, fileName);
        let isScheduled = false;
        
        if (!fs.existsSync(filePath)) {
            filePath = path.join(scheduledExportDir, fileName);
            isScheduled = true;
        }
        
        if (!fs.existsSync(filePath)) {
            throw new SystemError(ErrorType.VALIDATION_ERROR, '导出文件不存在', 'FILE_NOT_FOUND');
        }
        
        const stats = fs.statSync(filePath);
        const basicInfo = this.parseExportFileName(fileName);
        
        if (!basicInfo) {
            throw new SystemError(ErrorType.VALIDATION_ERROR, '无效的文件名格式', 'INVALID_FILENAME');
        }
        
        // 尝试从HTML文件中提取        // 尝试从导出文件中提取会话信息
        let detailedInfo = null;
        try {
            if ((basicInfo.format || '').toUpperCase() === 'JSON' || fileName.toLowerCase().endsWith('.json')) {
                detailedInfo = this.extractChatInfoFromJson(filePath);
            } else {
                const htmlContent = fs.readFileSync(filePath, 'utf-8');
                detailedInfo = this.extractChatInfoFromHtml(htmlContent);
            }
        } catch (error) {
            console.warn('[ApiServer] 无法读取导出文件内容:', error);
        }
        return {
            fileName,
            filePath,
            relativePath: isScheduled ? `/scheduled-downloads/${fileName}` : `/downloads/${fileName}`,
            size: stats.size,
            createTime: stats.birthtime,
            modifyTime: stats.mtime,
            isScheduled,
            ...basicInfo,
            ...detailedInfo
        };
    }

    /**
     * 从HTML内容中提取聊天信息
     */
    private extractChatInfoFromHtml(htmlContent: string): any {
        const info: any = {};
        
        try {
            // 修复 Issue #30: 提取聊天对象名称（从 <title> 或 header 中）
            const titleMatch = htmlContent.match(/<title>([^<]+?)(?:\s*-\s*聊天记录)?<\/title>/);
            if (titleMatch && titleMatch[1]) {
                info.displayName = titleMatch[1].trim();
            }
            
            // 备选方案：从 header 中提取
            if (!info.displayName) {
                const headerMatch = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/);
                if (headerMatch && headerMatch[1]) {
                    info.displayName = headerMatch[1].trim();
                }
            }
            
            // 提取导出时间
            const exportTimeMatch = htmlContent.match(/<div class="info-value">([^<]+)<\/div>/);
            if (exportTimeMatch) {
                info.exportTime = exportTimeMatch[1];
            }
            
            // 提取消息总数
            const messageCountMatch = htmlContent.match(/消息总数.*?<div class="info-value">(\d+)<\/div>/s);
            if (messageCountMatch && messageCountMatch[1]) {
                info.messageCount = parseInt(messageCountMatch[1]);
            }
            
            // 提取聊天对象名称（从第一条消息的发送者）
            const senderMatch = htmlContent.match(/<span class="sender">([^<]+)<\/span>/);
            if (senderMatch) {
                info.senderName = senderMatch[1];
            }
            
            // 提取时间范围
            const timeRangeMatch = htmlContent.match(/时间范围.*?<div class="info-value">([^<]+)<\/div>/s);
            if (timeRangeMatch) {
                info.timeRange = timeRangeMatch[1];
            }
            
        } catch (error) {
            console.warn('[ApiServer] 解析HTML内容失败:', error);
        }
        
        return info;
    }

    /**
     * 从 JSON 导出中提取会话信息
     */
    private extractChatInfoFromJson(filePath: string): any {
        const info: any = {};
        
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            if (data?.chatInfo?.name) {
                info.displayName = data.chatInfo.name;
            }
            
            if (data?.metadata?.exportTime) {
                info.exportTime = data.metadata.exportTime;
            }
            
            if (typeof data?.statistics?.totalMessages === 'number') {
                info.messageCount = data.statistics.totalMessages;
            }
            
            const timeRange = data?.statistics?.timeRange;
            if (timeRange?.start && timeRange?.end) {
                info.timeRange = `${timeRange.start} ~ ${timeRange.end}`;
            }
            
            if (Array.isArray(data?.messages) && data.messages.length > 0) {
                const firstMessage = data.messages[0];
                info.senderName = firstMessage?.sender?.name || firstMessage?.sender?.uid;
            }
        } catch (error) {
            console.warn('[ApiServer] 解析JSON导出失败:', error);
        }
        
        return info;
    }

    // ===================
    // 资源索引相关方法
    // ===================

    /**
     * 构建完整的资源索引
     * 高性能流式扫描，支持：
     * - 全局资源目录 (images/videos/audios/files)
     * - ZIP导出文件
     * - JSONL分块导出目录
     */
    private async buildResourceIndex(): Promise<{
        summary: {
            totalResources: number;
            totalSize: number;
            byType: Record<string, { count: number; size: number }>;
            bySource: Record<string, { count: number; size: number }>;
        };
        globalResources: {
            images: { count: number; size: number; path: string };
            videos: { count: number; size: number; path: string };
            audios: { count: number; size: number; path: string };
            files: { count: number; size: number; path: string };
        };
        exports: Array<{
            fileName: string;
            format: 'html' | 'json' | 'zip' | 'jsonl';
            resourceCount: number;
            resourceSize: number;
            chatType?: string;
            chatId?: string;
            displayName?: string;
        }>;
    }> {
        const userProfile = process.env['USERPROFILE'] || process.cwd();
        const baseDir = path.join(userProfile, '.qq-chat-exporter');
        const resourcesDir = path.join(baseDir, 'resources');
        const exportsDir = path.join(baseDir, 'exports');
        const scheduledDir = path.join(baseDir, 'scheduled-exports');

        // 初始化统计
        const summary = {
            totalResources: 0,
            totalSize: 0,
            byType: {} as Record<string, { count: number; size: number }>,
            bySource: {} as Record<string, { count: number; size: number }>
        };

        const globalResources = {
            images: { count: 0, size: 0, path: path.join(resourcesDir, 'images') },
            videos: { count: 0, size: 0, path: path.join(resourcesDir, 'videos') },
            audios: { count: 0, size: 0, path: path.join(resourcesDir, 'audios') },
            files: { count: 0, size: 0, path: path.join(resourcesDir, 'files') }
        };

        const exports: Array<{
            fileName: string;
            format: 'html' | 'json' | 'zip' | 'jsonl';
            resourceCount: number;
            resourceSize: number;
            chatType?: string;
            chatId?: string;
            displayName?: string;
        }> = [];

        // 1. 扫描全局资源目录
        for (const [type, info] of Object.entries(globalResources)) {
            if (fs.existsSync(info.path)) {
                const stats = await this.scanDirectoryStats(info.path);
                info.count = stats.count;
                info.size = stats.size;
                
                summary.totalResources += stats.count;
                summary.totalSize += stats.size;
                
                if (!summary.byType[type]) {
                    summary.byType[type] = { count: 0, size: 0 };
                }
                summary.byType[type].count += stats.count;
                summary.byType[type].size += stats.size;
                
                if (!summary.bySource['global']) {
                    summary.bySource['global'] = { count: 0, size: 0 };
                }
                summary.bySource['global'].count += stats.count;
                summary.bySource['global'].size += stats.size;
            }
        }

        // 2. 扫描导出目录
        const scanExportDir = async (dir: string, isScheduled: boolean) => {
            if (!fs.existsSync(dir)) return;
            
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // 检查是否是JSONL分块目录
                    if (entry.name.endsWith('_chunked_jsonl')) {
                        const jsonlStats = await this.scanJsonlDirectory(fullPath);
                        const fileInfo = this.parseExportFileName(entry.name.replace('_chunked_jsonl', '.json'));
                        
                        exports.push({
                            fileName: entry.name,
                            format: 'jsonl',
                            resourceCount: jsonlStats.resourceCount,
                            resourceSize: jsonlStats.resourceSize,
                            chatType: fileInfo?.chatType,
                            chatId: fileInfo?.chatId,
                            displayName: fileInfo?.displayName
                        });
                        
                        summary.totalResources += jsonlStats.resourceCount;
                        summary.totalSize += jsonlStats.resourceSize;
                        
                        if (!summary.bySource['jsonl']) {
                            summary.bySource['jsonl'] = { count: 0, size: 0 };
                        }
                        summary.bySource['jsonl'].count += jsonlStats.resourceCount;
                        summary.bySource['jsonl'].size += jsonlStats.resourceSize;
                    }
                    // 检查是否是ZIP解压目录（带resources子目录）
                    else if (entry.name.startsWith('friend_') || entry.name.startsWith('group_')) {
                        const resourcesSubDir = path.join(fullPath, 'resources');
                        if (fs.existsSync(resourcesSubDir)) {
                            const zipStats = await this.scanDirectoryStats(resourcesSubDir);
                            const fileInfo = this.parseExportFileName(entry.name + '.html');
                            
                            exports.push({
                                fileName: entry.name,
                                format: 'zip',
                                resourceCount: zipStats.count,
                                resourceSize: zipStats.size,
                                chatType: fileInfo?.chatType,
                                chatId: fileInfo?.chatId,
                                displayName: fileInfo?.displayName
                            });
                            
                            summary.totalResources += zipStats.count;
                            summary.totalSize += zipStats.size;
                            
                            if (!summary.bySource['zip']) {
                                summary.bySource['zip'] = { count: 0, size: 0 };
                            }
                            summary.bySource['zip'].count += zipStats.count;
                            summary.bySource['zip'].size += zipStats.size;
                        }
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    
                    // ZIP文件
                    if (ext === '.zip') {
                        const stats = fs.statSync(fullPath);
                        const fileInfo = this.parseExportFileName(entry.name.replace('.zip', '.html'));
                        
                        exports.push({
                            fileName: entry.name,
                            format: 'zip',
                            resourceCount: 0, // ZIP内部资源需要解压才能统计
                            resourceSize: stats.size,
                            chatType: fileInfo?.chatType,
                            chatId: fileInfo?.chatId,
                            displayName: fileInfo?.displayName
                        });
                        
                        if (!summary.bySource['zip']) {
                            summary.bySource['zip'] = { count: 0, size: 0 };
                        }
                        summary.bySource['zip'].size += stats.size;
                    }
                    // HTML/JSON文件
                    else if (ext === '.html' || ext === '.json') {
                        const stats = fs.statSync(fullPath);
                        const fileInfo = this.parseExportFileName(entry.name);
                        
                        // 检查是否有关联的资源目录
                        const baseName = entry.name.replace(/\.(html|json)$/i, '');
                        const resourceDir = path.join(dir, `resources_${baseName}`);
                        let resourceCount = 0;
                        let resourceSize = 0;
                        
                        if (fs.existsSync(resourceDir)) {
                            const resStats = await this.scanDirectoryStats(resourceDir);
                            resourceCount = resStats.count;
                            resourceSize = resStats.size;
                        }
                        
                        exports.push({
                            fileName: entry.name,
                            format: ext === '.html' ? 'html' : 'json',
                            resourceCount,
                            resourceSize,
                            chatType: fileInfo?.chatType,
                            chatId: fileInfo?.chatId,
                            displayName: fileInfo?.displayName
                        });
                        
                        if (resourceCount > 0) {
                            summary.totalResources += resourceCount;
                            summary.totalSize += resourceSize;
                            
                            const source = ext === '.html' ? 'html' : 'json';
                            if (!summary.bySource[source]) {
                                summary.bySource[source] = { count: 0, size: 0 };
                            }
                            summary.bySource[source].count += resourceCount;
                            summary.bySource[source].size += resourceSize;
                        }
                    }
                }
            }
        };

        await scanExportDir(exportsDir, false);
        await scanExportDir(scheduledDir, true);

        return {
            summary,
            globalResources,
            exports: exports.sort((a, b) => b.resourceSize - a.resourceSize)
        };
    }

    /**
     * 高性能目录统计（不读取文件内容）
     */
    private async scanDirectoryStats(dirPath: string): Promise<{ count: number; size: number }> {
        let count = 0;
        let size = 0;

        const scanRecursive = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanRecursive(fullPath);
                    } else if (entry.isFile()) {
                        try {
                            const stats = fs.statSync(fullPath);
                            count++;
                            size += stats.size;
                        } catch {
                            // 忽略无法访问的文件
                        }
                    }
                }
            } catch {
                // 忽略无法访问的目录
            }
        };

        scanRecursive(dirPath);
        return { count, size };
    }

    /**
     * 扫描JSONL分块目录
     */
    private async scanJsonlDirectory(dirPath: string): Promise<{ 
        resourceCount: number; 
        resourceSize: number;
        chunkCount: number;
        messageCount: number;
    }> {
        let resourceCount = 0;
        let resourceSize = 0;
        let chunkCount = 0;
        let messageCount = 0;

        // 读取manifest.json获取统计信息
        const manifestPath = path.join(dirPath, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                messageCount = manifest?.statistics?.totalMessages || 0;
                chunkCount = manifest?.chunked?.chunks?.length || 0;
                
                // 从统计信息获取资源数量
                const resources = manifest?.statistics?.resources;
                if (resources) {
                    resourceCount = resources.total || 0;
                    resourceSize = resources.totalSize || 0;
                }
            } catch {
                // 忽略解析错误
            }
        }

        // 如果manifest没有资源统计，扫描chunks目录
        if (resourceCount === 0) {
            const chunksDir = path.join(dirPath, 'chunks');
            if (fs.existsSync(chunksDir)) {
                const stats = await this.scanDirectoryStats(chunksDir);
                // JSONL文件本身不是资源，这里只统计大小
                resourceSize = stats.size;
            }
        }

        return { resourceCount, resourceSize, chunkCount, messageCount };
    }

    /**
     * 获取特定导出文件的资源列表
     */
    private async getExportFileResources(fileName: string): Promise<Array<{
        type: string;
        fileName: string;
        relativePath: string;
        size: number;
        mimeType?: string;
    }>> {
        const userProfile = process.env['USERPROFILE'] || process.cwd();
        const baseDir = path.join(userProfile, '.qq-chat-exporter');
        const exportsDir = path.join(baseDir, 'exports');
        const scheduledDir = path.join(baseDir, 'scheduled-exports');

        const resources: Array<{
            type: string;
            fileName: string;
            relativePath: string;
            size: number;
            mimeType?: string;
        }> = [];

        // 确定文件位置
        let targetDir = exportsDir;
        let baseName = fileName.replace(/\.(html|json|zip)$/i, '');
        
        // 检查是否是JSONL目录
        if (fileName.endsWith('_chunked_jsonl')) {
            baseName = fileName;
        }

        // 尝试在两个目录中查找
        let resourceDir = path.join(targetDir, `resources_${baseName}`);
        if (!fs.existsSync(resourceDir)) {
            resourceDir = path.join(scheduledDir, `resources_${baseName}`);
        }
        
        // 检查JSONL目录
        if (!fs.existsSync(resourceDir)) {
            const jsonlDir = path.join(targetDir, baseName);
            if (fs.existsSync(jsonlDir) && fs.statSync(jsonlDir).isDirectory()) {
                resourceDir = path.join(jsonlDir, 'resources');
            }
        }
        if (!fs.existsSync(resourceDir)) {
            const jsonlDir = path.join(scheduledDir, baseName);
            if (fs.existsSync(jsonlDir) && fs.statSync(jsonlDir).isDirectory()) {
                resourceDir = path.join(jsonlDir, 'resources');
            }
        }

        // 扫描资源目录
        if (fs.existsSync(resourceDir)) {
            const scanDir = (dir: string, prefix: string = '') => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                    
                    if (entry.isDirectory()) {
                        scanDir(fullPath, relativePath);
                    } else if (entry.isFile()) {
                        try {
                            const stats = fs.statSync(fullPath);
                            const ext = path.extname(entry.name).toLowerCase();
                            const type = this.getResourceTypeFromExtension(ext);
                            const mimeType = this.getMimeTypeFromExtension(ext);
                            
                            resources.push({
                                type,
                                fileName: entry.name,
                                relativePath: `/api/exports/files/${encodeURIComponent(fileName)}/resources/${relativePath}`,
                                size: stats.size,
                                mimeType
                            });
                        } catch {
                            // 忽略无法访问的文件
                        }
                    }
                }
            };
            
            scanDir(resourceDir);
        }

        return resources.sort((a, b) => b.size - a.size);
    }

    /**
     * 根据扩展名获取资源类型
     */
    private getResourceTypeFromExtension(ext: string): string {
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.svg'];
        const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'];
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.amr', '.silk'];
        
        if (imageExts.includes(ext)) return 'image';
        if (videoExts.includes(ext)) return 'video';
        if (audioExts.includes(ext)) return 'audio';
        return 'file';
    }

    /**
     * 根据扩展名获取MIME类型
     */
    private getMimeTypeFromExtension(ext: string): string {
        const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml',
            '.mp4': 'video/mp4',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska',
            '.webm': 'video/webm',
            '.flv': 'video/x-flv',
            '.wmv': 'video/x-ms-wmv',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
            '.aac': 'audio/aac',
            '.m4a': 'audio/mp4',
            '.wma': 'audio/x-ms-wma',
            '.amr': 'audio/amr',
            '.silk': 'audio/silk'
        };
        
        return mimeTypes[ext] || 'application/octet-stream';
    }

    /**
     * 获取全局资源文件列表（用于画廊浏览）
     */
    private async getGlobalResourceFiles(
        type: string,
        page: number,
        limit: number
    ): Promise<{
        files: Array<{
            type: string;
            fileName: string;
            url: string;
            size: number;
            mimeType: string;
            modifyTime: string;
        }>;
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
    }> {
        const userProfile = process.env['USERPROFILE'] || process.cwd();
        const resourcesDir = path.join(userProfile, '.qq-chat-exporter', 'resources');
        
        const files: Array<{
            type: string;
            fileName: string;
            url: string;
            size: number;
            mimeType: string;
            modifyTime: string;
        }> = [];

        // 确定要扫描的目录
        const dirsToScan: Array<{ dir: string; type: string }> = [];
        
        if (type === 'all' || type === 'images') {
            dirsToScan.push({ dir: path.join(resourcesDir, 'images'), type: 'image' });
        }
        if (type === 'all' || type === 'videos') {
            dirsToScan.push({ dir: path.join(resourcesDir, 'videos'), type: 'video' });
        }
        if (type === 'all' || type === 'audios') {
            dirsToScan.push({ dir: path.join(resourcesDir, 'audios'), type: 'audio' });
        }
        if (type === 'all' || type === 'files') {
            dirsToScan.push({ dir: path.join(resourcesDir, 'files'), type: 'file' });
        }

        // 扫描所有目录
        for (const { dir, type: resourceType } of dirsToScan) {
            if (!fs.existsSync(dir)) continue;
            
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (!entry.isFile()) continue;
                    
                    const fullPath = path.join(dir, entry.name);
                    try {
                        const stats = fs.statSync(fullPath);
                        const ext = path.extname(entry.name).toLowerCase();
                        const mimeType = this.getMimeTypeFromExtension(ext);
                        
                        // 构建URL路径
                        const urlPath = `/resources/${resourceType}s/${entry.name}`;
                        
                        files.push({
                            type: resourceType,
                            fileName: entry.name,
                            url: urlPath,
                            size: stats.size,
                            mimeType,
                            modifyTime: stats.mtime.toISOString()
                        });
                    } catch {
                        // 忽略无法访问的文件
                    }
                }
            } catch {
                // 忽略无法访问的目录
            }
        }

        // 按修改时间倒序排序
        files.sort((a, b) => new Date(b.modifyTime).getTime() - new Date(a.modifyTime).getTime());

        // 分页
        const total = files.length;
        const startIndex = (page - 1) * limit;
        const paginatedFiles = files.slice(startIndex, startIndex + limit);

        return {
            files: paginatedFiles,
            total,
            page,
            limit,
            hasMore: startIndex + limit < total
        };
    }

}
