/**
 * QQ聊天记录导出工具API服务器
 * 提供完整的QQ聊天记录导出功能API
 */

import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';

// 导入核心模块
import { NapCatCore } from '../../core';
import { BatchMessageFetcher } from '../core/fetcher/BatchMessageFetcher';
import { SimpleMessageParser } from '../core/parser/SimpleMessageParser';
import { TextExporter } from '../core/exporter/TextExporter';
import { JsonExporter } from '../core/exporter/JsonExporter';
import { ModernHtmlExporter } from '../core/exporter/ModernHtmlExporter';
import { DatabaseManager } from '../core/storage/DatabaseManager';
import { ResourceHandler } from '../core/resource/ResourceHandler';
import { ScheduledExportManager } from '../core/scheduler/ScheduledExportManager';
import { FrontendBuilder } from '../webui/FrontendBuilder';
import { SecurityManager } from '../security/SecurityManager';

// 导入类型定义
import { RawMessage } from '../../core/types/msg';
import { 
    SystemErrorData,
    ErrorType,
    ExportTaskConfig,
    ExportTaskState,
    ExportTaskStatus,
    ExportFormat,
    ChatTypeSimple
} from '../types';
import { ChatType } from '../../core/types';

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
    
    // 任务管理
    private exportTasks: Map<string, any> = new Map();

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
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
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
            }) || isStaticFile;
            
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
                        'POST /api/messages/export - 导出消息'
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
                const chatName = peer.peerUid;
                
                let fileExt = 'json';
                switch (format.toUpperCase()) {
                    case 'TXT': fileExt = 'txt'; break;
                    case 'HTML': fileExt = 'html'; break;
                    case 'JSON': default: fileExt = 'json'; break;
                }

                const fileName = `${chatName}_${timestamp}.${fileExt}`;
                const downloadUrl = `/downloads/${fileName}`;

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

        // 静态文件服务
        this.app.use('/downloads', express.static(path.join(process.cwd(), 'exports')));
        this.app.use('/scheduled-downloads', express.static(path.join(process.env['USERPROFILE'] || process.cwd(), '.qq-chat-exporter', 'scheduled-exports')));
        
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
            }
            
            console.log(`[ApiServer] ==================== 消息收集汇总 ====================`);
            console.log(`[ApiServer] 时间范围: ${new Date(startTimeMs).toISOString()} - ${new Date(endTimeMs).toISOString()}`);
            console.log(`[ApiServer] 总批次数: ${batchCount}`);
            console.log(`[ApiServer] 收集到的消息总数: ${allMessages.length} 条`);
            console.log(`[ApiServer] 平均每批次: ${batchCount > 0 ? Math.round(allMessages.length / batchCount) : 0} 条`);
            console.log(`[ApiServer] ====================================================`);

            // 所有格式都需要通过OneBot解析器处理
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    progress: 60,
                    message: '正在解析消息...',
                    messageCount: allMessages.length
                });
            }
            
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 60,
                    message: '正在解析消息...',
                    messageCount: allMessages.length
                }
            });

            // 处理资源下载
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    progress: 70,
                    message: '正在下载资源...',
                    messageCount: allMessages.length
                });
            }
            
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 70,
                    message: '正在下载资源...',
                    messageCount: allMessages.length
                }
            });

            // 下载和处理资源
            const resourceMap = await this.resourceHandler.processMessageResources(allMessages);
            console.info(`[ApiServer] 处理了 ${resourceMap.size} 个消息的资源`);

            // 导出文件
            task = this.exportTasks.get(taskId);
            if (task) {
                await this.updateTaskStatus(taskId, {
                    progress: 85,
                    message: '正在生成文件...',
                    messageCount: allMessages.length
                });
            }
            
            this.broadcastWebSocketMessage({
                type: 'export_progress',
                data: {
                    taskId,
                    status: 'running',
                    progress: 85,
                    message: '正在生成文件...',
                    messageCount: allMessages.length
                }
            });

            const outputDir = path.join(process.cwd(), 'exports');
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
                prettyFormat: options?.prettyFormat ?? true,
                timeFormat: 'YYYY-MM-DD HH:mm:ss',
                encoding: 'utf-8'
            };

            // 获取友好的聊天名称
            task = this.exportTasks.get(taskId);
            const chatName = task?.sessionName || peer.peerUid;
            const chatInfo = {
                name: chatName,
                type: (peer.chatType === ChatType.KCHATTYPEGROUP ? 'group' : 'private') as 'group' | 'private'
            };

            console.log(`[ApiServer] ==================== 开始导出 ====================`);
            console.log(`[ApiServer] 导出格式: ${format.toUpperCase()}`);
            console.log(`[ApiServer] 传递给导出器的消息数量: ${allMessages.length} 条`);
            console.log(`[ApiServer] 导出文件路径: ${filePath}`);
            console.log(`[ApiServer] =================================================`);
            
            switch (format.toUpperCase()) {
                case 'TXT':
                    console.log(`[ApiServer] 调用 TextExporter，传入 ${allMessages.length} 条 RawMessage`);
                    exporter = new TextExporter(exportOptions, {}, this.core);
                    await exporter.export(allMessages, chatInfo);
                    break;
                case 'JSON':
                    console.log(`[ApiServer] 调用 JsonExporter，传入 ${allMessages.length} 条 RawMessage`);
                    exporter = new JsonExporter(exportOptions, {}, this.core);
                    await exporter.export(allMessages, chatInfo);
                    break;
                case 'HTML':
                    // HTML导出需要CleanMessage格式，先解析消息
                    const parser = new SimpleMessageParser();
                    const cleanMessages = await parser.parseMessages(allMessages);
                    
                    // 🔧 关键修复：更新资源路径为本地路径
                    await parser.updateResourcePaths(cleanMessages, resourceMap);
                    console.log(`[ApiServer] 已更新${cleanMessages.length}条消息的资源路径为本地路径`);
                    
                    const htmlExporter = new ModernHtmlExporter({
                        outputPath: filePath,
                        includeResourceLinks: exportOptions.includeResourceLinks,
                        includeSystemMessages: exportOptions.includeSystemMessages,
                        encoding: exportOptions.encoding
                    });
                    await htmlExporter.export(cleanMessages, chatInfo);
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
                    messageCount: allMessages.length,
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
                    messageCount: allMessages.length,
                    fileName,
                    filePath,
                    fileSize: stats.size,
                    downloadUrl
                }
            });

            console.log(`[ApiServer] 导出任务完成: ${taskId}`);

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
            // 停止前端服务
            try {
                await this.frontendBuilder.stop();
                this.core.context.logger.log('[API] 前端服务已停止');
            } catch (error) {
                this.core.context.logger.logError('[API] 停止前端服务失败:', error);
            }
            
            // 关闭所有WebSocket连接
            this.wsConnections.forEach(ws => {
                ws.close(1000, '服务器关闭');
            });

            // 关闭WebSocket服务器
            this.wss.close();

            // 关闭HTTP服务器
            this.server.close(() => {
                this.core.context.logger.log('[API] QQ聊天记录导出工具API服务器已关闭');
                resolve();
            });
        });
    }
}