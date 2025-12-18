
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
        console.info(`[ApiServer] 构造函数 - userProfile: ${userProfile}`);
        console.info(`[ApiServer] 构造函数 - dbPath: ${dbPath}`);
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
    }
    
    /**
     * 设置进程退出处理器
     */
    private setupProcessHandlers(): void {
        // 处理正常退出
        process.on('beforeExit', async () => {
            console.log('[ApiServer] 进程即将退出，保存数据...');
            try {
                await this.dbManager.close();
                console.log('[ApiServer] ✅ 数据已安全保存');
            } catch (error) {
                console.error('[ApiServer] 保存数据失败:', error);
            }
        });
        
        // 处理Ctrl+C
        process.on('SIGINT', async () => {
            console.log('\n[ApiServer] 收到SIGINT信号，正在优雅关闭...');
            try {
                await this.dbManager.close();
                console.log('[ApiServer] ✅ 数据已安全保存');
                process.exit(0);
            } catch (error) {
                console.error('[ApiServer] 保存数据失败:', error);
                process.exit(1);
            }
        });
        
        // 处理SIGTERM
        process.on('SIGTERM', async () => {
            console.log('[ApiServer] 收到SIGTERM信号，正在优雅关闭...');
            try {
                await this.dbManager.close();
                console.log('[ApiServer] ✅ 数据已安全保存');
                process.exit(0);
            } catch (error) {
                console.error('[ApiServer] 保存数据失败:', error);
                process.exit(1);
            }
        });
        
        // 处理未捕获的异常
        process.on('uncaughtException', async (error) => {
            console.error('[ApiServer] 未捕获的异常:', error);
            try {
                await this.dbManager.close();
                console.log('[ApiServer] ✅ 数据已安全保存');
            } catch (saveError) {
                console.error('[ApiServer] 保存数据失败:', saveError);
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

            console.log(`[ApiServer] 构建资源缓存: ${dirPath} (${cache.size} 个文件)`);
        } catch (error) {
            console.error(`[ApiServer] 构建资源缓存失败: ${dirPath}`, error);
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
            console.log(`[ApiServer] 清除资源缓存: ${dirPath}`);
        } else {
            this.resourceFileCache.clear();
            console.log(`[ApiServer] 清除所有资源缓存`);
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
     * 配置路由
     */
    private setupRoutes(): void {
        // 根路由 - API信息
        this.app.get('/', (req, res) => {
            const frontendStatus = this.frontendBuilder.getStatus();
            this.sendSuccessResponse(res, {
                name: 'QQ聊天记录导出工具API',
                version: '4.0.0',
                description: '提供完整的QQ聊天记录导出功能API',
                endpoints: {
                    '基础信息': [
                        'GET / - API信息',
                        'GET /health - 健康检查'
                    ],
                    '群组管理': [
                        'GET /api/groups?page=1&limit=999&forceRefresh=false - 获取所有群组（支持分页）',
                        'GET /api/groups/:groupCode?forceRefresh=false - 获取群组详情',
                        'GET /api/groups/:groupCode/members?forceRefresh=false - 获取群成员'
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
                name: 'QQChatExporter V4 / https://github.com/shuakami/qq-chat-exporter',
                copyright: '本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~',
                version: '4.0.0',
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

        
        // 导出群成员头像
        this.app.post('/api/groups/:groupCode/avatars/export', async (req, res) => {
            try {
                const { groupCode } = req.params;
                if (!groupCode) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '群组代码不能为空', 'INVALID_GROUP_CODE');
                }

                console.log(`[ApiServer] 开始导出群 ${groupCode} 的成员头像...`);

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

                console.log(`[ApiServer] 准备下载 ${members.length} 个成员头像到 ${tempDir}`);

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

                console.log(`[ApiServer] 头像下载完成: 成功 ${successCount}, 失败 ${failCount}`);

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

                console.log(`[ApiServer] ZIP文件创建完成: ${zipFilePath} (${stats.size} bytes)`);

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

                console.log(`[ApiServer] 获取消息 - 页码: ${page}, 每页: ${limit}`);
                
                // 生成缓存key（基于peer和时间范围）
                const cacheKey = `${peer.chatType}_${peer.peerUid}_${filter?.startTime || 0}_${filter?.endTime || Date.now()}`;
                
                // 检查缓存
                let cached = this.messageCache.get(cacheKey);
                const now = Date.now();
                
                // 如果缓存过期，清除
                if (cached && (now - cached.lastUpdate > this.CACHE_EXPIRE_TIME)) {
                    console.log(`[ApiServer] 缓存过期，清除缓存: ${cacheKey}`);
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
                        const hasNextValue = hasMore; // 有富余说明至少还有一页，hasNext取决于是否还有更多
                        console.log(`[ApiServer] 缓存足够，直接返回 (${allMessages.length} 条)`);
                        console.log(`[ApiServer] hasNext计算: ${allMessages.length} > ${endIndex} = true, hasMore=${hasMore}, 最终hasNext=${hasNextValue}`);
                        
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
                        console.log(`[ApiServer] 缓存刚好够且没有更多，返回最后一页 (${allMessages.length} 条)`);
                        
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
                        console.log(`[ApiServer] 缓存刚好用完但还有更多，继续加载... (${allMessages.length} 条)`);
                        // 不return，继续往下走
                    }
                    
                    // 缓存不够但hasMore=false，说明已经是全部消息了
                    if (!hasMore) {
                        console.log(`[ApiServer] 缓存已是全部消息，直接返回 (${allMessages.length} 条)`);
                        
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
                    console.log(`[ApiServer] 缓存不足且还有更多，继续懒加载... (当前${allMessages.length}条)`);
                }
                
                // 需要获取更多消息（懒加载）
                if (allMessages.length === 0) {
                    console.log(`[ApiServer] 首次获取消息...`);
                } else {
                    console.log(`[ApiServer] 继续懒加载更多消息... (已有${allMessages.length}条)`);
                }
                
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
                        console.log(`[ApiServer] 批次${batchCount}: +${newMessages.length}条, 累计${allMessages.length}条`);
                    }
                    
                    // 足够了就停止
                    if (allMessages.length >= targetCount) {
                        console.log(`[ApiServer] 已获取足够消息 (${allMessages.length}条 >= 目标${targetCount}条)，暂停获取`);
                        hasMore = true;
                        break;
                    }
                }
                
                // 如果生成器自然结束（没有break），说明没有更多消息了
                if (!hasMore) {
                    console.log(`[ApiServer] 生成器已耗尽，这就是全部消息了 (共${allMessages.length}条)`);
                    generatorExhausted = true;
                }
                
                console.log(`[ApiServer] 懒加载完成: ${allMessages.length}条消息, hasMore=${hasMore}`);
                
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
                    downloadUrl: task.downloadUrl,
                    createdAt: task.createdAt,
                    completedAt: task.completedAt,
                    error: task.error,
                    startTime: task.filter?.startTime,
                    endTime: task.filter?.endTime
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
                
                console.log(`[ApiServer] 正在删除任务: ${taskId}`);
                
                // 1. 清理任务的资源处理器（如果存在）
                const resourceHandler = this.taskResourceHandlers.get(taskId);
                if (resourceHandler) {
                    console.log(`[ApiServer] 停止并清理任务 ${taskId} 的资源处理器`);
                    await resourceHandler.cleanup();
                    this.taskResourceHandlers.delete(taskId);
                }
                
                // 2. 从内存中删除
                this.exportTasks.delete(taskId);
                
                // 3. 从数据库中删除
                try {
                    await this.dbManager.deleteTask(taskId);
                    console.log(`[ApiServer] 任务 ${taskId} 已从数据库删除`);
                } catch (dbError) {
                    console.error(`[ApiServer] 从数据库删除任务失败: ${taskId}`, dbError);
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
                
                console.log(`[ApiServer] 正在删除任务 ${taskId} 的原始文件: ${task.originalFilePath}`);
                
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

                console.log(`[ApiServer] 接收到导出请求: peer=${JSON.stringify(peer)}, filter=${JSON.stringify(filter)}, options=${JSON.stringify(options)}, sessionName=${userSessionName}`);

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

                // 生成符合索引页面格式的文件名：(friend|group)_QQ号_日期_时间.扩展名
                const chatTypePrefix = peer.chatType === 1 ? 'friend' : 'group';
                const date = new Date(timestamp);
                const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`; // 20250506
                const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`; // 221008
                const fileName = `${chatTypePrefix}_${peer.peerUid}_${dateStr}_${timeStr}.${fileExt}`;
                const downloadUrl = `/downloads/${fileName}`;
                
                console.log(`[ApiServer] 生成文件名: ${fileName} (chatType=${peer.chatType}, peerUid=${peer.peerUid})`);

                // 确定会话名称：优先使用用户输入的名称，否则自动获取
                let sessionName: string;
                if (userSessionName && userSessionName.trim()) {
                    // 使用用户输入的任务名
                    sessionName = userSessionName.trim();
                    console.log(`[ApiServer] 使用用户自定义任务名: ${sessionName}`);
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
                        console.log(`[ApiServer] 自动获取会话名称: ${sessionName}`);
                    } catch (error) {
                        console.warn(`快速获取会话名称失败，使用默认名称: ${peer.peerUid}`, error);
                        // 使用默认值，不阻塞任务创建
                    }
                }

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
                    messageCount: task.messageCount,
                    status: task.status,
                    startTime: filter?.startTime,
                    endTime: filter?.endTime
                }, (req as any).requestId);

                // 在后台异步处理导出
                this.processExportTaskAsync(taskId, peer, format, filter, options, fileName, downloadUrl);

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
                console.log(`[ApiServer] ======= 收到获取表情包列表请求 (${requestId}) =======`);

                // 支持按类型筛选
                const typesParam = req.query['types'] as string | undefined;
                let types: any[] | undefined;

                if (typesParam) {
                    types = typesParam.split(',').map(t => t.trim());
                    console.log(`[ApiServer] 筛选类型:`, types);
                }

                console.log(`[ApiServer] 调用 getStickerPacks...`);
                const startTime = Date.now();
                const packs = await this.stickerPackExporter.getStickerPacks(types);
                const elapsed = Date.now() - startTime;
                console.log(`[ApiServer] getStickerPacks 完成 (耗时: ${elapsed}ms)，返回 ${packs.length} 个表情包`);

                // 按类型分组统计
                console.log(`[ApiServer] 计算统计信息...`);
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

                console.log(`[ApiServer] 统计信息:`, stats);
                console.log(`[ApiServer] 发送响应...`);
                this.sendSuccessResponse(res, {
                    packs,
                    totalCount: packs.length,
                    totalStickers: packs.reduce((sum, pack) => sum + pack.stickerCount, 0),
                    stats
                }, requestId);
                console.log(`[ApiServer] ======= 请求处理完成 (${requestId}) =======`);
            } catch (error) {
                console.error(`[ApiServer] !!! 请求处理失败 (${requestId}):`, error);
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
                
                console.log(`[ApiServer] 收到导出表情包请求: ${packId}`);
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
                console.log('[ApiServer] 收到导出所有表情包请求');
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
                console.log(`[ApiServer] 收到获取导出记录请求: limit=${limit}`);
                
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
                    
                    // 修复资源路径：将 ../resources/ 替换为 {fileName}/resources/
                    // 这样服务器访问时路径正确，本地打开时仍然使用 ../resources/
                    htmlContent = htmlContent
                        .replace(/src="\.\.\/resources\//g, `src="${fileName}/resources/`)
                        .replace(/href="\.\.\/resources\//g, `href="${fileName}/resources/`);
                    
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

        // 静态文件服务
        this.app.use('/downloads', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports')));
        this.app.use('/scheduled-downloads', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports')));
        // 资源文件服务（图片、音频、视频等）
        this.app.use('/resources', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'resources')));
        
        // 前端应用路由
        this.frontendBuilder.setupStaticRoutes(this.app);

        // 404处理
        this.app.use((req, res) => {
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
        
        console.log(`[ApiServer] 启动流式搜索: ${searchId}, query="${searchQuery}"`);
        console.log(`[ApiServer] 搜索范围: ${filter?.startTime || 0} ~ ${filter?.endTime || Date.now()}`);
        
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
        console.log(`[ApiServer] 取消搜索: ${searchId}`);
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
        downloadUrl: string
    ): Promise<void> {
        let task = this.exportTasks.get(taskId);
        
        // 为此任务创建独立的 ResourceHandler
        const taskResourceHandler = new ResourceHandler(this.core, this.dbManager);
        this.taskResourceHandlers.set(taskId, taskResourceHandler);
        console.log(`[ApiServer] 为任务 ${taskId} 创建了独立的资源处理器`);
        
        try {
            console.log(`[ApiServer] 开始处理异步导出任务: ${taskId}`);

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
                console.log(`[ApiServer] 检测到秒级时间戳 startTime=${startTimeMs}，转换为毫秒级`);
                startTimeMs = startTimeMs * 1000;
            }
            if (endTimeMs > 1000000000 && endTimeMs < 10000000000) {
                console.log(`[ApiServer] 检测到秒级时间戳 endTime=${endTimeMs}，转换为毫秒级`);
                endTimeMs = endTimeMs * 1000;
            }
            
            console.log(`[ApiServer] 时间范围参数: startTime=${startTimeMs}, endTime=${endTimeMs}`);
            console.log(`[ApiServer] 时间范围: ${new Date(startTimeMs).toISOString()} - ${new Date(endTimeMs).toISOString()}`);
            
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
                    
                    console.log(`[Debug] 批次 ${batchCount}: 消息数=${batch.length}, 时间范围=${new Date(batchEarliest).toISOString()} ~ ${new Date(batchLatest).toISOString()}`);
                    console.log(`[Debug] 批次 ${batchCount}: 第一条msgId=${batch[0]?.msgId}, 最后一条msgId=${batch[batch.length - 1]?.msgId}`);
                    
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
                    console.log(`[ApiServer] 已触发垃圾回收 (批次 ${batchCount}, 消息数 ${allMessages.length})`);
                }
            }
            
            console.log(`[ApiServer] ==================== 消息收集汇总 ====================`);
            console.log(`[ApiServer] 请求时间范围: ${new Date(startTimeMs).toISOString()} - ${new Date(endTimeMs).toISOString()}`);
            console.log(`[ApiServer] 实际获取时间: ${earliestMsgTime ? new Date(earliestMsgTime).toISOString() : 'N/A'} - ${latestMsgTime ? new Date(latestMsgTime).toISOString() : 'N/A'}`);
            console.log(`[ApiServer] 总批次数: ${batchCount}`);
            console.log(`[ApiServer] 收集到的消息总数: ${allMessages.length} 条`);
            console.log(`[ApiServer] 平均每批次: ${batchCount > 0 ? Math.round(allMessages.length / batchCount) : 0} 条`);
            
            // 🔍 调试：检查是否有时间断层
            if (startTimeMs > 0 && earliestMsgTime && earliestMsgTime > startTimeMs) {
                const gapDays = Math.round((earliestMsgTime - startTimeMs) / (1000 * 60 * 60 * 24));
                console.warn(`[ApiServer] ⚠️ 时间断层检测: 请求从 ${new Date(startTimeMs).toISOString()} 开始，但最早消息为 ${new Date(earliestMsgTime).toISOString()}，缺少 ${gapDays} 天的消息！`);
            }
            console.log(`[ApiServer] ====================================================`);

            // 补全群消息的群昵称（sendMemberName）

            if (Number(peer.chatType) === 2 && allMessages.length > 0) {
                console.log(`[ApiServer] 正在获取群成员信息以补全群昵称...`);
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
                        
                        console.log(`[ApiServer] 群昵称补全完成: ${filledCount} 条消息`);
                    }
                } catch (error) {
                    console.warn(`[ApiServer] 获取群成员信息失败，跳过群昵称补全:`, error);
                }
            }

            // 注意：filterPureImageMessages只是跳过资源下载，不过滤消息
            // 所有消息都保留，只是不下载图片等资源文件
            let filteredMessages = allMessages;
            if (options?.filterPureImageMessages) {
                console.log(`[ApiServer] 启用纯文字模式: 跳过资源下载，保留所有 ${allMessages.length} 条消息`);
            }

            // 过滤指定用户的消息
            if (filter?.excludeUserUins && filter.excludeUserUins.length > 0) {
                const excludeSet = new Set(filter.excludeUserUins.map((uin: string) => String(uin)));
                const beforeCount = filteredMessages.length;
                filteredMessages = filteredMessages.filter(msg => {
                    const senderUin = String(msg.senderUin || '');
                    return !excludeSet.has(senderUin);
                });
                console.log(`[ApiServer] 用户过滤: 排除 ${excludeSet.size} 个用户，消息从 ${beforeCount} 条减少到 ${filteredMessages.length} 条`);
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

                // 下载和处理资源（使用过滤后的消息列表）
                resourceMap = await taskResourceHandler.processMessageResources(filteredMessages);
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
            const outputDir = path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'exports');
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

            // 🔧 修复 Issue #29: 对消息按时间戳排序，确保时间顺序正确
            console.log(`[ApiServer] 开始对 ${filteredMessages.length} 条消息进行时间排序...`);
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
                const firstTime = sortedMessages[0]?.msgTime;
                const lastTime = sortedMessages[sortedMessages.length - 1]?.msgTime;
                console.log(`[ApiServer] 消息排序完成: 时间范围从 ${firstTime} 到 ${lastTime}`);
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

            console.log(`[ApiServer] ==================== 开始导出 ====================`);
            console.log(`[ApiServer] 导出格式: ${format.toUpperCase()}`);
            console.log(`[ApiServer] 传递给导出器的消息数量: ${sortedMessages.length} 条`);
            console.log(`[ApiServer] 导出文件路径: ${filePath}`);
            console.log(`[ApiServer] =================================================`);
            
            switch (format.toUpperCase()) {
                case 'TXT':
                    console.log(`[ApiServer] 调用 TextExporter，传入 ${sortedMessages.length} 条 RawMessage`);
                    exporter = new TextExporter(exportOptions, {}, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'JSON':
                    console.log(`[ApiServer] 调用 JsonExporter，传入 ${sortedMessages.length} 条 RawMessage`);
                    exporter = new JsonExporter(exportOptions, {}, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'EXCEL':
                    console.log(`[ApiServer] 调用 ExcelExporter，传入 ${sortedMessages.length} 条 RawMessage`);
                    exporter = new ExcelExporter(exportOptions, {}, this.core);
                    await exporter.export(sortedMessages, chatInfo);
                    break;
                case 'HTML':
                    // 🚀 HTML流式导出：使用异步生成器，实现全程低内存占用
                    console.log(`[ApiServer] 使用流式导出 HTML，传入 ${sortedMessages.length} 条 RawMessage`);
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
                    console.log(`[ApiServer] HTML流式导出完成，内存占用已优化`);
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
                    console.log(`[ApiServer] 开始创建ZIP压缩包...`);
                    
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

                    console.log(`[ApiServer] ZIP压缩包创建成功: ${zipFilePath}`);
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
                    downloadUrl: isZipExport ? `/download?file=${encodeURIComponent(finalFileName)}` : downloadUrl,
                    isZipExport,
                    originalFilePath: isZipExport ? filePath : undefined
                }
            });

            console.log(`[ApiServer] 导出任务完成: ${taskId}`);
            
            // 立即刷新数据库，确保任务状态持久化
            console.log(`[ApiServer] 正在保存任务状态到数据库...`);
            await this.dbManager.flushWriteQueue();
            console.log(`[ApiServer] ✅ 任务状态已保存`);
            
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
                console.log(`[ApiServer] 清理任务 ${taskId} 的资源处理器`);
                await resourceHandler.cleanup();
                this.taskResourceHandlers.delete(taskId);
                console.log(`[ApiServer] 任务 ${taskId} 的资源处理器已清理完成`);
            }
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
            
            console.info('[ApiServer] 安全配置、数据库和前端服务初始化完成');
        } catch (error) {
            console.error('[ApiServer] 初始化失败:', error);
        }
    }

    /**
     * 从数据库加载现有任务
     */
    private async loadExistingTasks(): Promise<void> {
        try {
            console.info('[ApiServer] 开始加载现有任务...');
            const tasks = await this.dbManager.getAllTasks();
            console.info(`[ApiServer] 从数据库获取到 ${tasks.length} 个任务`);
            
            for (const { config, state } of tasks) {
                console.info(`[ApiServer] 正在处理任务: ${config.taskId}, 状态: ${state.status}`);
                
                // 从state中恢复fileName和filePath（如果有的话）
                const fileName = (state as any).fileName || `${config.chatName}_${Date.now()}.json`;
                const filePath = (state as any).filePath;
                
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
                    downloadUrl: `/downloads/${fileName}`,
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
            console.info(`[ApiServer] 已加载 ${tasks.length} 个现有任务`);
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
                outputDir: path.join(process.env['USERPROFILE'] || process.env['HOME'] || '.', '.qq-chat-exporter', 'exports'),
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
                
                // 项目版权和基本信息
                this.core.context.logger.log('[API] ══════════════════════════════════════════════════════════');
                this.core.context.logger.log('[API]  QQChatExporter • v4.0.0');
                this.core.context.logger.log('[API]  GitHub: https://github.com/shuakami/qq-chat-exporter');
                this.core.context.logger.log('[API]  这是一个免费开源项目！如果您是买来的，请立即退款！');
                this.core.context.logger.log('[API]  如果有帮助到您，欢迎给我点个Star~');
                
                // 显示服务地址（参考NapCat的简洁方式）
                if (serverAddresses.external) {
                    this.core.context.logger.log(`[API] 🌐 api服务地址: ${serverAddresses.external}`);
                }
                this.core.context.logger.log(`[API] 🏠 api本地地址: ${serverAddresses.local}`);
                
                // 显示安全信息
                if (accessToken) {
                    this.core.context.logger.log('[API] 🔐 安全认证已启用');
                    this.core.context.logger.log(`[API] 🔑 访问令牌: ${accessToken}`);
                    if (securityStatus.tokenExpired) {
                        this.core.context.logger.log('[API] ⚠️ 令牌已过期，已自动生成新令牌');
                    }
                    this.core.context.logger.log('[API] 💡 请在访问前端时输入上述令牌进行认证');
                    this.core.context.logger.log('[API] ══════════════════════════════════════════════════════════');
                }
                
                // 显示前端服务信息
                const frontendStatus = this.frontendBuilder.getStatus();
                if (frontendStatus.isRunning && frontendStatus.mode === 'production') {
                    if (serverAddresses.external) {
                        this.core.context.logger.log(`[API] 🎨 打开工具: ${serverAddresses.external}/qce-v4-tool`);
                    }
                    this.core.context.logger.log(`[API] 🎨 打开工具: ${serverAddresses.local}/qce-v4-tool`);
                } else if (frontendStatus.mode === 'development') {
                    this.core.context.logger.log(`[API] 🔧 前端开发服务器: ${frontendStatus.frontendUrl}`);
                } else {
                    this.core.context.logger.log('[API] ⚠️ 前端应用未构建，请运行 npm run build:universal');
                }
                
                // 广播服务器启动消息
                this.broadcastWebSocketMessage({
                    type: 'notification',
                    data: { 
                        message: 'QQ聊天记录导出工具API服务器已启动',
                        version: '4.0.0',
                        frontend: frontendStatus
                    },
                    timestamp: new Date().toISOString()
                });
                
                resolve();
            });

            this.server.on('error', (error) => {
                this.core.context.logger.logError('[API] 服务器启动失败:', error);
                reject(error);
            });
        });
    }

    /**
     * 关闭服务器
     */
    async stop(): Promise<void> {
        return new Promise(async (resolve) => {
            this.core.context.logger.log('[API] 正在关闭服务器...');
            
            // 1. 刷新数据库写入队列（最重要！）
            try {
                this.core.context.logger.log('[API] 正在保存数据库...');
                await this.dbManager.close();
                this.core.context.logger.log('[API] ✅ 数据库已安全关闭');
            } catch (error) {
                this.core.context.logger.logError('[API] 关闭数据库失败:', error);
            }
            
            // 2. 停止前端服务
            try {
                await this.frontendBuilder.stop();
                this.core.context.logger.log('[API] ✅ 前端服务已停止');
            } catch (error) {
                this.core.context.logger.logError('[API] 停止前端服务失败:', error);
            }
            
            // 3. 关闭所有WebSocket连接
            this.wsConnections.forEach(ws => {
                ws.close(1000, '服务器关闭');
            });
            this.core.context.logger.log('[API] ✅ WebSocket连接已关闭');

            // 4. 关闭WebSocket服务器
            this.wss.close();

            // 5. 关闭HTTP服务器
            this.server.close(() => {
                this.core.context.logger.log('[API] ✅ QQ聊天记录导出工具API服务器已安全关闭');
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
                const mainFiles = fs.readdirSync(exportDir);
                


                for (const fileName of mainFiles) {
                    const normalizedName = fileName.toLowerCase();
                    if (!normalizedName.endsWith('.html') && !normalizedName.endsWith('.json')) {
                        continue;
                    }

                    const filePath = path.join(exportDir, fileName);
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
                            try {
                                if (fileInfo.chatType === 'friend') {
                                    const friends = await this.core.apis.FriendApi.getBuddy();
                                    const friend = friends.find((f: any) => f.coreInfo?.uid === fileInfo.chatId);
                                    fileInfo.displayName = friend?.coreInfo?.remark || friend?.coreInfo?.nick || fileInfo.chatId;
                                } else if (fileInfo.chatType === 'group') {
                                    const groups = await this.core.apis.GroupApi.getGroups();
                                    const group = groups.find(g => g.groupCode === fileInfo.chatId || g.groupCode === fileInfo.chatId.toString());
                                    fileInfo.displayName = group?.groupName || fileInfo.chatId;
                                }
                            } catch (error) {
                                console.warn(`[ApiServer] 获取会话名称失败 (${fileInfo.chatType} ${fileInfo.chatId}):`, error);
                                fileInfo.displayName = fileInfo.chatId;
                            }
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
                const scheduledFiles = fs.readdirSync(scheduledExportDir);


                for (const fileName of scheduledFiles) {
                    const normalizedName = fileName.toLowerCase();
                    if (!normalizedName.endsWith('.html') && !normalizedName.endsWith('.json')) {
                        continue;
                    }

                    const filePath = path.join(scheduledExportDir, fileName);
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
                            try {
                                if (fileInfo.chatType === 'friend') {
                                    const friends = await this.core.apis.FriendApi.getBuddy();
                                    const friend = friends.find((f: any) => f.coreInfo?.uid === fileInfo.chatId);
                                    fileInfo.displayName = friend?.coreInfo?.remark || friend?.coreInfo?.nick || fileInfo.chatId;
                                } else if (fileInfo.chatType === 'group') {
                                    const groups = await this.core.apis.GroupApi.getGroups();
                                    const group = groups.find(g => g.groupCode === fileInfo.chatId || g.groupCode === fileInfo.chatId.toString());
                                    fileInfo.displayName = group?.groupName || fileInfo.chatId;
                                }
                            } catch (error) {
                                console.warn(`[ApiServer] 获取会话名称失败 (${fileInfo.chatType} ${fileInfo.chatId}):`, error);
                                fileInfo.displayName = fileInfo.chatId;
                            }
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
     */
    private parseExportFileName(fileName: string): any | null {
        // 匹配格式：friend_1234567890_20250830_142843.html 或 group_1234567890_20250830_142843.html
        // 或 friend_u_xxx_20250830_142843.html (支持带前缀的UID，包含下划线)
        // 使用非贪婪匹配 (.+?) 匹配 UID，直到遇到 _日期_ 的模式
        const match = fileName.match(/^(friend|group)_(.+?)_(\d{8})_(\d{6})(?:_\d{3}_TEMP)?\.(html|json)$/i);
        if (!match) return null;
        
        const [, type, id, date, time, extension] = match;
        if (!date || !time) return null;
        const dateTime = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)} ${time.substr(0,2)}:${time.substr(2,2)}:${time.substr(4,2)}`;
        
        // 不设置默认 displayName，留给后续从数据库或API获取
        return {
            chatType: type as 'friend' | 'group',
            chatId: id,
            exportDate: dateTime,
            displayName: undefined, // 稍后从数据库或API获取
            format: extension?.toUpperCase() === 'JSON' ? 'JSON' : 'HTML',
            avatarUrl: type === 'friend' ? 
                `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100` : 
                `https://p.qlogo.cn/gh/${id}/${id}/100`
        };
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

}
