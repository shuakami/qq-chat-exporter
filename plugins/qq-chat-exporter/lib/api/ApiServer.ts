
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

// 导入核心模块
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
import { BatchMessageFetcher } from '../core/fetcher/BatchMessageFetcher.js';
import { SimpleMessageParser } from '../core/parser/SimpleMessageParser.js';
import { TextExporter } from '../core/exporter/TextExporter.js';
import { JsonExporter } from '../core/exporter/JsonExporter.js';
import { ModernHtmlExporter } from '../core/exporter/ModernHtmlExporter.js';
import { DatabaseManager } from '../core/storage/DatabaseManager.js';
import { ResourceHandler } from '../core/resource/ResourceHandler.js';
import { ScheduledExportManager } from '../core/scheduler/ScheduledExportManager.js';
import { FrontendBuilder } from '../webui/FrontendBuilder.js';
import { SecurityManager } from '../security/SecurityManager.js';
import { StickerPackExporter } from '../core/sticker/StickerPackExporter.js';

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
    
    // 资源文件名缓存 (shortName -> fullFileName 映射)
    // 例如: "A1D18D97.jpg" -> "a1d18d97b45c620add5133050c00044c_A1D18D97.jpg"
    private resourceFileCache: Map<string, Map<string, string>> = new Map();

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
        // CORS配置
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Access-Token']
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
            
            // 验证令牌
            const clientIP = req.ip || req.connection.remoteAddress || '';
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
                        'DELETE /api/tasks/:taskId - 删除任务'
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
                serverIP: this.securityManager.getPublicIP()
            }, (req as any).requestId);
        });

        // 认证验证端点
        this.app.post('/auth', (req, res) => {
            const { token } = req.body;
            const clientIP = req.ip || req.connection.remoteAddress || '';
            
            if (!token) {
                return this.sendErrorResponse(res, new SystemError(ErrorType.VALIDATION_ERROR, '缺少访问令牌', 'MISSING_TOKEN'), (req as any).requestId, 400);
            }
            
            const isValid = this.securityManager.verifyToken(token, clientIP);
            if (isValid) {
                this.sendSuccessResponse(res, {
                    authenticated: true,
                    message: '认证成功',
                    serverIP: this.securityManager.getPublicIP()
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
                const { peer, filter, batchSize = 5000, page = 1, limit = 100 } = req.body;

                if (!peer || !peer.chatType || !peer.peerUid) {
                    throw new SystemError(ErrorType.VALIDATION_ERROR, 'peer参数不完整', 'INVALID_PEER');
                }

                // 创建消息获取器
                const fetcher = new BatchMessageFetcher(this.core, {
                    batchSize,
                    timeout: 30000,
                    retryCount: 3
                });

                // 收集所有消息
                const allMessages: RawMessage[] = [];
                const messageGenerator = fetcher.fetchAllMessagesInTimeRange(
                    peer,
                    filter?.startTime ? filter.startTime : 0,
                    filter?.endTime ? filter.endTime : Date.now()
                );
                
                for await (const batch of messageGenerator) {
                    allMessages.push(...batch);
                }
                // 按时间戳排序，最新的消息在前面
                allMessages.sort((a, b) => Number(b.msgTime) - Number(a.msgTime));

                // 分页处理
                const startIndex = (page - 1) * limit;
                const endIndex = startIndex + limit;
                const paginatedMessages = allMessages.slice(startIndex, endIndex);

                this.sendSuccessResponse(res, {
                    messages: paginatedMessages,
                    totalCount: allMessages.length,
                    currentPage: page,
                    totalPages: Math.ceil(allMessages.length / limit),
                    hasNext: endIndex < allMessages.length,
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
                
                // 1. 从内存中删除
                this.exportTasks.delete(taskId);
                
                // 2. 从数据库中删除
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

        // 创建异步导出任务
        this.app.post('/api/messages/export', async (req, res) => {
            try {
                const { peer, format = 'JSON', filter, options } = req.body;

                console.log(`[ApiServer] 接收到导出请求: peer=${JSON.stringify(peer)}, filter=${JSON.stringify(filter)}, options=${JSON.stringify(options)}`);

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

                // 快速获取会话名称（避免阻塞任务创建）
                let sessionName = peer.peerUid;
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

        // HTML文件预览接口（用于iframe内嵌显示）
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
                
                // 设置适当的响应头（无缓存）
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                
                // 直接读取文件内容并返回
                const htmlContent = fs.readFileSync(path.resolve(filePath), 'utf8');
                res.send(htmlContent);
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

            ws.on('close', () => {
                this.wsConnections.delete(ws);
                this.core.context.logger.log(`[API] WebSocket连接关闭: ${requestId}`);
            });

            ws.on('error', (error) => {
                this.core.context.logger.logError(`[API] WebSocket错误: ${requestId}`, error);
            });

            // 发送连接确认
            this.sendWebSocketMessage(ws, {
                type: 'notification',
                data: { message: 'WebSocket连接成功', requestId },
                timestamp: new Date().toISOString()
            });
        });
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
            for await (const batch of messageGenerator) {
                batchCount++;
                allMessages.push(...batch);
                
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
            console.log(`[ApiServer] 时间范围: ${new Date(startTimeMs).toISOString()} - ${new Date(endTimeMs).toISOString()}`);
            console.log(`[ApiServer] 总批次数: ${batchCount}`);
            console.log(`[ApiServer] 收集到的消息总数: ${allMessages.length} 条`);
            console.log(`[ApiServer] 平均每批次: ${batchCount > 0 ? Math.round(allMessages.length / batchCount) : 0} 条`);
            console.log(`[ApiServer] ====================================================`);

            // 应用纯图片消息过滤（如果启用）
            let filteredMessages = allMessages;
            if (options?.filterPureImageMessages) {
                const parser = new SimpleMessageParser();
                const tempFilteredMessages: RawMessage[] = [];
                
                for (const message of allMessages) {
                    try {
                        const cleanMessage = await parser.parseSingleMessage(message);
                        if (!parser.isPureImageMessage(cleanMessage)) {
                            tempFilteredMessages.push(message);
                        }
                    } catch (error) {
                        // 解析失败的消息保留，避免丢失数据
                        console.warn(`[ApiServer] 过滤消息解析失败，保留消息: ${message.msgId}`, error);
                        tempFilteredMessages.push(message);
                    }
                }
                
                filteredMessages = tempFilteredMessages;
                console.log(`[ApiServer] 纯图片消息过滤完成: ${allMessages.length} → ${filteredMessages.length} 条`);
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

            // 处理资源下载（只处理过滤后的消息资源）
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
            const resourceMap = await this.resourceHandler.processMessageResources(filteredMessages);
            console.info(`[ApiServer] 处理了 ${resourceMap.size} 个消息的资源`);

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
            const chatInfo = {
                name: chatName,
                type: (peer.chatType === ChatType.KCHATTYPEGROUP ? 'group' : 'private') as 'group' | 'private'
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
                    await htmlExporter.exportFromIterable(messageStream, chatInfo);
                    console.log(`[ApiServer] HTML流式导出完成，内存占用已优化`);
                    break;
                default:
                    throw new SystemError(ErrorType.VALIDATION_ERROR, '不支持的导出格式', 'INVALID_FORMAT');
            }

            const stats = fs.statSync(filePath);

            // 更新任务为完成状态
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    status: 'completed',
                    progress: 100,
                    message: '导出完成',
                    messageCount: sortedMessages.length,
                    fileSize: stats.size,
                    completedAt: new Date().toISOString()
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
                    fileName,
                    filePath,
                    fileSize: stats.size,
                    downloadUrl
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
                
                // 转换为API格式
                const apiTask = {
                    taskId: config.taskId,
                    peer: config.peer,
                    sessionName: config.chatName,
                    status: state.status,
                    progress: state.totalMessages > 0 ? Math.round((state.processedMessages / state.totalMessages) * 100) : 0,
                    format: config.formats[0] || 'JSON',
                    messageCount: state.processedMessages,
                    fileName: `${config.chatName}_${Date.now()}.json`, // 重新生成文件名
                    downloadUrl: `/downloads/${config.chatName}_${Date.now()}.json`,
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
                processingSpeed: 0
            };

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
                    if (fileName.endsWith('.html')) {
                        const filePath = path.join(exportDir, fileName);
                        const stats = fs.statSync(filePath);
                        const fileInfo = this.parseExportFileName(fileName);
                        
                        if (fileInfo) {
                            // 从HTML文件头部读取元数据（最可靠的来源）
                            const htmlMetadata = this.parseHtmlMetadata(filePath);
                            
                            // 优先使用HTML元数据中的信息
                            if (htmlMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = htmlMetadata.messageCount;
                            }
                            if (htmlMetadata.chatName) {
                                fileInfo.displayName = htmlMetadata.chatName;
                            }
                            
                            // 如果仍然没有displayName，尝试从API实时获取
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
                                    // 使用默认值
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
            }
            
            // 扫描定时导出目录
            if (fs.existsSync(scheduledExportDir)) {
                const scheduledFiles = fs.readdirSync(scheduledExportDir);
                for (const fileName of scheduledFiles) {
                    if (fileName.endsWith('.html')) {
                        const filePath = path.join(scheduledExportDir, fileName);
                        const stats = fs.statSync(filePath);
                        const fileInfo = this.parseExportFileName(fileName);
                        
                        if (fileInfo) {
                            // 从HTML文件头部读取元数据（最可靠的来源）
                            const htmlMetadata = this.parseHtmlMetadata(filePath);
                            
                            // 优先使用HTML元数据中的信息
                            if (htmlMetadata.messageCount !== undefined) {
                                fileInfo.messageCount = htmlMetadata.messageCount;
                            }
                            if (htmlMetadata.chatName) {
                                fileInfo.displayName = htmlMetadata.chatName;
                            }
                            
                            // 如果仍然没有displayName，尝试从API实时获取
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
                                    // 使用默认值
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
        const match = fileName.match(/^(friend|group)_(.+?)_(\d{8})_(\d{6})(?:_\d{3}_TEMP)?\.html$/);
        if (!match) return null;
        
        const [, type, id, date, time] = match;
        if (!date || !time) return null;
        const dateTime = `${date.substr(0,4)}-${date.substr(4,2)}-${date.substr(6,2)} ${time.substr(0,2)}:${time.substr(2,2)}:${time.substr(4,2)}`;
        
        // 不设置默认 displayName，留给后续从数据库或API获取
        return {
            chatType: type as 'friend' | 'group',
            chatId: id,
            exportDate: dateTime,
            displayName: undefined, // 稍后从数据库或API获取
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
        
        // 尝试从HTML文件中提取更多信息
        let detailedInfo = null;
        try {
            const htmlContent = fs.readFileSync(filePath, 'utf-8');
            detailedInfo = this.extractChatInfoFromHtml(htmlContent);
        } catch (error) {
            console.warn('[ApiServer] 无法解析HTML文件内容:', error);
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
}
