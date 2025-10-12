/**
 * QQ聊天记录导出工具API服务器
 */

import express from 'express';
import type { Request, Response, Application } from 'express';
import cors from 'cors';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';

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

/* -----------------------------------------------
 *                  类型与接口
 * ----------------------------------------------- */

/** API响应接口 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: SystemErrorData;
  timestamp: string;
  requestId: string;
}

/** 扩展 Request 注入 requestId */
interface RequestWithId extends Request {
  requestId?: string;
}

/** WebSocket 扩展：加入心跳标记 */
type AliveWebSocket = WebSocket & { isAlive?: boolean };

/* -----------------------------------------------
 *                常量 / 工具函数
 * ----------------------------------------------- */

// 统一 Content-Type 映射（避免每次创建临时对象）
const CONTENT_TYPE_MAP: Record<string, string> = {
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

// 静态资源 Cache-Control
const STATIC_CACHE_CONTROL = 'public, max-age=31536000';

// 导出文件列表缓存 TTL（秒）
const EXPORT_FILES_TTL_SEC = 5;

// NapCat 上游列表缓存 TTL（秒）
const LIST_CACHE_TTL_SEC = 15;

// WebSocket 心跳周期（毫秒）
const WS_PING_INTERVAL_MS = 30000;

// 统一 ISO 时间
const nowISO = () => new Date().toISOString();

// 取请求ID
const asRequestId = (req: RequestWithId) =>
  (req.requestId as string) || 'unknown_request';

/** 确保时间戳为毫秒（10位秒级 -> 毫秒） */
function ensureMsTimestamp(ts: number | string | undefined | null): number {
  if (ts == null) return 0;
  let n = typeof ts === 'string' ? parseInt(ts, 10) : ts;
  if (!Number.isFinite(n)) return 0;
  // 10位秒级（2001~2286）
  if (n > 1000000000 && n < 10000000000) return n * 1000;
  return n;
}

/** 生成 requestId */
function genRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** 简易最小堆（Min-Heap）实现，用于保留 Top-K 最大值（按 t 排序，t 越大越新） */
class MinHeap<T extends { t: number; i: number }> {
  private a: T[] = [];
  size(): number {
    return this.a.length;
  }
  peek(): T | undefined {
    return this.a[0];
  }
  push(v: T): void {
    const a = this.a;
    a.push(v);
    this.heapifyUp(a.length - 1);
  }
  replaceTop(v: T): void {
    const a = this.a;
    if (a.length === 0) {
      a.push(v);
      return;
    }
    a[0] = v;
    this.heapifyDown(0);
  }
  toArray(): T[] {
    return this.a.slice();
  }
  private heapifyUp(idx: number) {
    const a = this.a;
    let i = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t <= a[i].t) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  private heapifyDown(idx: number) {
    const a = this.a;
    let i = idx;
    const n = a.length;
    while (true) {
      const l = (i << 1) + 1;
      const r = l + 1;
      let m = i;
      if (l < n && a[l].t < a[m].t) m = l;
      if (r < n && a[r].t < a[m].t) m = r;
      if (m === i) break;
      [a[i], a[m]] = [a[m], a[i]];
      i = m;
    }
  }
}

/** TTL 内存缓存（轻量实现，无第三方依赖） */
class TTLCache<K, V> {
  private store = new Map<K, { v: V; expireAt: number }>();
  constructor(private ttlMs: number) {}
  get(key: K): V | undefined {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      return undefined;
    }
    return item.v;
  }
  set(key: K, v: V): void {
    this.store.set(key, { v, expireAt: Date.now() + this.ttlMs });
  }
  delete(key: K): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

/* -----------------------------------------------
 *                 系统错误类
 * ----------------------------------------------- */

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

/* -----------------------------------------------
 *                 主服务器实现
 * ----------------------------------------------- */

export class QQChatExporterApiServer {
  private app: Application;
  private server: Server;
  private wss: WebSocketServer;
  private core: NapCatCore;

  // WebSocket连接管理
  private wsConnections: Set<AliveWebSocket> = new Set();
  private wsHeartbeatTimer?: NodeJS.Timeout;

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

  // 资源文件名缓存 (dirPath -> (shortName -> fullFileName))
  private resourceFileCache: Map<string, Map<string, string>> = new Map();

  // NapCat 列表缓存
  private groupsCache = new TTLCache<string, any[]>(
    LIST_CACHE_TTL_SEC * 1000
  );
  private friendsCache = new TTLCache<string, any[]>(
    LIST_CACHE_TTL_SEC * 1000
  );
  private groupMembersCache = new TTLCache<string, any[]>(
    LIST_CACHE_TTL_SEC * 1000
  );

  // 导出文件列表缓存
  private exportFilesCache: {
    ts: number;
    data: any[];
  } | null = null;

  // 统一路径配置（一次计算，处处复用）
  private paths: {
    userHome: string;
    baseDir: string;
    dbPath: string;
    exportsDir: string;
    scheduledExportsDir: string;
    resourcesDir: string;
  };

  constructor(core: NapCatCore) {
    this.core = core;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // 统一路径初始化（优先使用 USERPROFILE / HOME）
    const userProfile =
      process.env['USERPROFILE'] || process.env['HOME'] || '.';
    const baseDir = path.join(userProfile, '.qq-chat-exporter');
    this.paths = {
      userHome: userProfile,
      baseDir,
      dbPath: path.join(baseDir, 'tasks.db'),
      exportsDir: path.join(baseDir, 'exports'),
      scheduledExportsDir: path.join(baseDir, 'scheduled-exports'),
      resourcesDir: path.join(baseDir, 'resources')
    };

    // 初始化数据库管理器
    this.dbManager = new DatabaseManager(this.paths.dbPath);

    // 初始化资源处理器
    this.resourceHandler = new ResourceHandler(core, this.dbManager);

    // 初始化定时导出管理器
    this.scheduledExportManager = new ScheduledExportManager(
      core,
      this.dbManager,
      this.resourceHandler
    );

    // 前端服务管理器
    this.frontendBuilder = new FrontendBuilder();

    // 安全管理器
    this.securityManager = new SecurityManager();

    // 表情包导出管理器
    this.stickerPackExporter = new StickerPackExporter(core);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupProcessHandlers();
  }

  /* -----------------------------------------------
   *               进程信号处理与清理
   * ----------------------------------------------- */
  private setupProcessHandlers(): void {
    const gracefulClose = async (exitCode = 0) => {
      try {
        await this.dbManager.close();
      } catch (e) {
        // ignore
      } finally {
        process.exit(exitCode);
      }
    };

    process.on('beforeExit', async () => {
      this.core.context.logger.log('[ApiServer] 进程即将退出，保存数据...');
      try {
        await this.dbManager.close();
        this.core.context.logger.log('[ApiServer] ✅ 数据已安全保存');
      } catch (error) {
        this.core.context.logger.logError('[ApiServer] 保存数据失败:', error);
      }
    });

    process.on('SIGINT', async () => {
      this.core.context.logger.log(
        '\n[ApiServer] 收到SIGINT信号，正在优雅关闭...'
      );
      await gracefulClose(0);
    });

    process.on('SIGTERM', async () => {
      this.core.context.logger.log(
        '[ApiServer] 收到SIGTERM信号，正在优雅关闭...'
      );
      await gracefulClose(0);
    });

    process.on('uncaughtException', async (error) => {
      this.core.context.logger.logError('[ApiServer] 未捕获的异常:', error);
      try {
        await this.dbManager.close();
        this.core.context.logger.log('[ApiServer] ✅ 数据已安全保存');
      } catch (saveError) {
        this.core.context.logger.logError(
          '[ApiServer] 保存数据失败:',
          saveError
        );
      }
    });
  }

  /* -----------------------------------------------
   *                    中间件
   * ----------------------------------------------- */
  private setupMiddleware(): void {
    this.app.disable('x-powered-by');

    // CORS配置
    this.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Request-ID',
          'X-Access-Token'
        ]
      })
    );

    // JSON解析配置
    this.app.use(express.json({ limit: '100mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '100mb' }));

    // 请求ID中间件
    this.app.use((req: RequestWithId, res: Response, next) => {
      req.requestId =
        (req.headers['x-request-id'] as string) || genRequestId();
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });

    // 日志中间件（走 NapCat 内置 logger）
    this.app.use((req: Request, _res: Response, next) => {
      this.core.context.logger.log(`[API] ${req.method} ${req.path}`);
      next();
    });

    // 安全认证中间件（公开路由绕过）
    this.app.use((req: RequestWithId, res: Response, next) => {
      const publicRoutes = new Set<string>([
        '/',
        '/health',
        '/auth',
        '/security-status',
        '/qce-v4-tool'
      ]);
      const isStaticFile = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf'].some(
        (ext) => req.path.toLowerCase().endsWith(ext)
      );
      const isPublicRoute =
        publicRoutes.has(req.path) ||
        isStaticFile ||
        req.path.startsWith('/static/') ||
        req.path.startsWith('/qce-v4-tool/') ||
        /^\/api\/exports\/files\/[^/]+\/preview$/.test(req.path);

      if (isPublicRoute) return next();

      // 鉴权
      const token =
        req.headers.authorization?.replace('Bearer ', '') ||
        (req.query['token'] as string) ||
        (req.headers['x-access-token'] as string);

      if (!token) {
        return res.status(401).json({
          success: false,
          error: {
            type: 'AUTH_ERROR',
            message: '需要访问令牌',
            timestamp: new Date(),
            context: {
              code: 'MISSING_TOKEN',
              requestId: asRequestId(req)
            }
          },
          timestamp: nowISO(),
          requestId: asRequestId(req)
        });
      }

      const clientIP = req.ip || (req.socket && req.socket.remoteAddress) || '';
      if (!this.securityManager.verifyToken(token, clientIP)) {
        return res.status(403).json({
          success: false,
          error: {
            type: 'AUTH_ERROR',
            message: '无效的访问令牌',
            timestamp: new Date(),
            context: {
              code: 'INVALID_TOKEN',
              requestId: asRequestId(req)
            }
          },
          timestamp: nowISO(),
          requestId: asRequestId(req)
        });
      }

      next();
    });
  }

  /* -----------------------------------------------
   *              资源文件名缓存构建/查询
   * ----------------------------------------------- */

  /** 构建资源文件名缓存（延迟加载） */
  private buildResourceCache(dirPath: string): Map<string, string> {
    if (this.resourceFileCache.has(dirPath)) {
      return this.resourceFileCache.get(dirPath)!;
    }

    const cache = new Map<string, string>();
    const fullDirPath = path.join(this.paths.resourcesDir, dirPath);

    if (!fs.existsSync(fullDirPath)) {
      this.resourceFileCache.set(dirPath, cache);
      return cache;
    }

    try {
      // 尽量减少 stat 次数：仅对文件做一次判断
      const files = fs.readdirSync(fullDirPath);
      for (const fileName of files) {
        const fullPath = path.join(fullDirPath, fileName);
        const st = fs.statSync(fullPath);
        if (!st.isFile()) continue;

        const underscoreIndex = fileName.indexOf('_');
        if (underscoreIndex > 0) {
          const shortName = fileName.substring(underscoreIndex + 1);
          cache.set(shortName, fileName);
        }
        cache.set(fileName, fileName);
      }
      this.core.context.logger.log(
        `[ApiServer] 构建资源缓存: ${dirPath} (${cache.size} 个文件)`
      );
    } catch (error) {
      this.core.context.logger.logError(
        `[ApiServer] 构建资源缓存失败: ${dirPath}`,
        error
      );
    }

    this.resourceFileCache.set(dirPath, cache);
    return cache;
  }

  /** O(1) 查找资源文件 */
  private findResourceFile(resourcePath: string): string | null {
    const dirPath = path.dirname(resourcePath);
    const shortFileName = path.basename(resourcePath);
    const cache = this.buildResourceCache(dirPath);
    const actual = cache.get(shortFileName);
    if (!actual) return null;
    return path.join(this.paths.resourcesDir, dirPath, actual);
  }

  /** 清除资源缓存 */
  private clearResourceCache(dirPath?: string): void {
    if (dirPath) {
      this.resourceFileCache.delete(dirPath);
      this.core.context.logger.log(`[ApiServer] 清除资源缓存: ${dirPath}`);
    } else {
      this.resourceFileCache.clear();
      this.core.context.logger.log('[ApiServer] 清除所有资源缓存');
    }
  }

  /* -----------------------------------------------
   *                     路由
   * ----------------------------------------------- */

  private setupRoutes(): void {
    // 根路由
    this.app.get('/', (req, res) => {
      const frontendStatus = this.frontendBuilder.getStatus();
      this.sendSuccessResponse(
        res,
        {
          name: 'QQ聊天记录导出工具API',
          version: '4.0.0',
          description: '提供完整的QQ聊天记录导出功能API',
          endpoints: {
            基础信息: ['GET / - API信息', 'GET /health - 健康检查'],
            群组管理: [
              'GET /api/groups?page=1&limit=999&forceRefresh=false - 获取所有群组（支持分页）',
              'GET /api/groups/:groupCode?forceRefresh=false - 获取群组详情',
              'GET /api/groups/:groupCode/members?forceRefresh=false - 获取群成员'
            ],
            好友管理: [
              'GET /api/friends?page=1&limit=999 - 获取所有好友（支持分页）',
              'GET /api/friends/:uid?no_cache=false - 获取好友详情'
            ],
            消息处理: [
              'POST /api/messages/fetch - 批量获取消息',
              'POST /api/messages/export - 导出消息（支持过滤纯图片消息）'
            ],
            任务管理: [
              'GET /api/tasks - 获取所有导出任务',
              'GET /api/tasks/:taskId - 获取指定任务状态',
              'DELETE /api/tasks/:taskId - 删除任务'
            ],
            用户信息: ['GET /api/users/:uid - 获取用户信息'],
            系统信息: ['GET /api/system/info - 系统信息', 'GET /api/system/status - 系统状态'],
            前端应用: ['GET /qce-v4-tool - Web界面入口'],
            表情包管理: [
              'GET /api/sticker-packs?types=favorite_emoji,market_pack,system_pack - 获取表情包（可选类型筛选）',
              'POST /api/sticker-packs/export - 导出指定表情包',
              'POST /api/sticker-packs/export-all - 导出所有表情包',
              'GET /api/sticker-packs/export-records?limit=50 - 获取导出记录'
            ]
          },
          websocket: 'ws://localhost:40653',
          frontend: {
            url:
              frontendStatus.mode === 'production'
                ? 'http://localhost:40653/qce-v4-tool'
                : frontendStatus.frontendUrl,
            mode: frontendStatus.mode,
            status: frontendStatus.isRunning ? 'running' : 'stopped'
          },
          documentation: '详见项目根目录API.md'
        },
        asRequestId(req)
      );
    });

    // 健康检查
    this.app.get('/health', (req, res) => {
      this.sendSuccessResponse(
        res,
        {
          status: 'healthy',
          online: this.core.selfInfo?.online || false,
          timestamp: nowISO(),
          uptime: process.uptime()
        },
        asRequestId(req)
      );
    });

    // 安全状态
    this.app.get('/security-status', (req, res) => {
      const status = this.securityManager.getSecurityStatus();
      this.sendSuccessResponse(
        res,
        {
          ...status,
          requiresAuth: true,
          serverIP: this.securityManager.getPublicIP()
        },
        asRequestId(req)
      );
    });

    // 认证验证
    this.app.post('/auth', (req: RequestWithId, res) => {
      const { token } = req.body || {};
      const clientIP = req.ip || (req.socket && req.socket.remoteAddress) || '';

      if (!token) {
        return this.sendErrorResponse(
          res,
          new SystemError(
            ErrorType.VALIDATION_ERROR,
            '缺少访问令牌',
            'MISSING_TOKEN'
          ),
          asRequestId(req),
          400
        );
      }
      const ok = this.securityManager.verifyToken(token, clientIP);
      if (ok) {
        return this.sendSuccessResponse(
          res,
          {
            authenticated: true,
            message: '认证成功',
            serverIP: this.securityManager.getPublicIP()
          },
          asRequestId(req)
        );
      }
      return this.sendErrorResponse(
        res,
        new SystemError(ErrorType.AUTH_ERROR, '无效的访问令牌', 'INVALID_TOKEN'),
        asRequestId(req),
        403
      );
    });

    // 更新服务器地址配置
    this.app.post('/api/server/host', async (req: RequestWithId, res) => {
      try {
        const { host } = req.body || {};
        if (!host || typeof host !== 'string') {
          return this.sendErrorResponse(
            res,
            new SystemError(
              ErrorType.VALIDATION_ERROR,
              '服务器地址不能为空',
              'INVALID_HOST'
            ),
            asRequestId(req),
            400
          );
        }
        await this.securityManager.updateServerHost(host);
        this.sendSuccessResponse(
          res,
          {
            message: '服务器地址更新成功',
            serverAddresses: this.securityManager.getServerAddresses()
          },
          asRequestId(req)
        );
      } catch (error) {
        this.sendErrorResponse(
          res,
          new SystemError(
            ErrorType.CONFIG_ERROR,
            '更新服务器地址失败',
            'UPDATE_HOST_FAILED'
          ),
          asRequestId(req)
        );
      }
    });

    // 系统信息
    this.app.get('/api/system/info', (req: RequestWithId, res) => {
      const selfInfo = this.core.selfInfo;
      const avatarUrl =
        selfInfo?.avatarUrl ||
        (selfInfo?.uin
          ? `https://q1.qlogo.cn/g?b=qq&nk=${selfInfo.uin}&s=640`
          : null);
      this.sendSuccessResponse(
        res,
        {
          name: 'QQChatExporter V4 / https://github.com/shuakami/qq-chat-exporter',
          copyright:
            '本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~',
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
        },
        asRequestId(req)
      );
    });

    // 系统状态
    this.app.get('/api/system/status', (req: RequestWithId, res) => {
      this.sendSuccessResponse(
        res,
        {
          online: this.core.selfInfo?.online || false,
          websocketConnections: this.wsConnections.size,
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime()
        },
        asRequestId(req)
      );
    });

    // 获取所有群组（带 TTL 缓存，支持 forceRefresh）
    this.app.get('/api/groups', async (req: RequestWithId, res) => {
      try {
        const forceRefresh = req.query['forceRefresh'] === 'true';
        const page = parseInt(req.query['page'] as string) || 1;
        const limit = parseInt(req.query['limit'] as string) || 999;

        let groups: any[] | undefined;
        if (!forceRefresh) {
          groups = this.groupsCache.get('all');
        }
        if (!groups) {
          groups = await this.core.apis.GroupApi.getGroups(forceRefresh);
          this.groupsCache.set('all', groups);
        }

        const groupsWithAvatars = groups.map((group: any) => ({
          groupCode: group.groupCode,
          groupName: group.groupName,
          memberCount: group.memberCount,
          maxMember: group.maxMember,
          remark: null,
          avatarUrl: `https://p.qlogo.cn/gh/${group.groupCode}/${group.groupCode}/640/`
        }));

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedGroups = groupsWithAvatars.slice(startIndex, endIndex);

        this.sendSuccessResponse(
          res,
          {
            groups: paginatedGroups,
            totalCount: groupsWithAvatars.length,
            currentPage: page,
            totalPages: Math.ceil(groupsWithAvatars.length / limit),
            hasNext: endIndex < groupsWithAvatars.length,
            hasPrev: page > 1
          },
          asRequestId(req)
        );
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取群组详情（可加入细粒度缓存，如需）
    this.app.get('/api/groups/:groupCode', async (req: RequestWithId, res) => {
      try {
        const { groupCode } = req.params as any;
        if (!groupCode) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '群组代码不能为空',
            'INVALID_GROUP_CODE'
          );
        }
        const groupDetail =
          await this.core.apis.GroupApi.fetchGroupDetail(groupCode);
        if (!groupDetail) {
          throw new SystemError(
            ErrorType.API_ERROR,
            '群组不存在',
            'GROUP_NOT_FOUND'
          );
        }
        this.sendSuccessResponse(res, groupDetail, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取群成员（TTL 缓存 + forceRefresh）
    this.app.get(
      '/api/groups/:groupCode/members',
      async (req: RequestWithId, res) => {
        try {
          const { groupCode } = req.params as any;
          if (!groupCode) {
            throw new SystemError(
              ErrorType.VALIDATION_ERROR,
              '群组代码不能为空',
              'INVALID_GROUP_CODE'
            );
          }
          const forceRefresh = req.query['forceRefresh'] === 'true';
          const cacheKey = `members:${groupCode}`;
          let members = forceRefresh
            ? undefined
            : this.groupMembersCache.get(cacheKey);
          if (!members) {
            const result = await this.core.apis.GroupApi.getGroupMemberAll(
              groupCode,
              forceRefresh
            );
            members = Array.from(result.result.infos.values());
            this.groupMembersCache.set(cacheKey, members);
          }
          this.sendSuccessResponse(res, members, asRequestId(req));
        } catch (error) {
          this.sendErrorResponse(res, error, asRequestId(req));
        }
      }
    );

    // 获取所有好友（TTL 缓存）
    this.app.get('/api/friends', async (req: RequestWithId, res) => {
      try {
        const page = parseInt(req.query['page'] as string) || 1;
        const limit = parseInt(req.query['limit'] as string) || 999;

        let friends = this.friendsCache.get('all');
        if (!friends) {
          friends = await this.core.apis.FriendApi.getBuddy();
          this.friendsCache.set('all', friends);
        }

        const friendsWithAvatars = friends.map((friend: any) => ({
          uid: friend.uid || friend.coreInfo?.uid,
          uin: friend.uin || friend.coreInfo?.uin,
          nick:
            friend.coreInfo?.nick ||
            friend.coreInfo?.uin ||
            friend.uin ||
            'unknown',
          remark: friend.coreInfo?.remark || null,
          avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${
            friend.coreInfo?.uin || friend.uin
          }&s=640`,
          isOnline: friend.status?.status === 1,
          status: friend.status?.status || 0,
          categoryId: friend.baseInfo?.categoryId || 1
        }));

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedFriends = friendsWithAvatars.slice(startIndex, endIndex);

        this.sendSuccessResponse(
          res,
          {
            friends: paginatedFriends,
            totalCount: friendsWithAvatars.length,
            currentPage: page,
            totalPages: Math.ceil(friendsWithAvatars.length / limit),
            hasNext: endIndex < friendsWithAvatars.length,
            hasPrev: page > 1
          },
          asRequestId(req)
        );
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取好友详情
    this.app.get('/api/friends/:uid', async (req: RequestWithId, res) => {
      try {
        const { uid } = req.params as any;
        if (!uid) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            'UID不能为空',
            'INVALID_UID'
          );
        }
        const no_cache = req.query['no_cache'] === 'true';
        const friendDetail = await this.core.apis.UserApi.getUserDetailInfo(
          uid,
          no_cache
        );
        this.sendSuccessResponse(res, friendDetail, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取用户信息
    this.app.get('/api/users/:uid', async (req: RequestWithId, res) => {
      try {
        const { uid } = req.params as any;
        if (!uid) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            'UID不能为空',
            'INVALID_UID'
          );
        }
        const no_cache = req.query['no_cache'] === 'true';
        const userInfo = await this.core.apis.UserApi.getUserDetailInfo(
          uid,
          no_cache
        );
        this.sendSuccessResponse(res, userInfo, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 批量获取消息（Top-K 分页算法，极大降低内存与排序开销）
    this.app.post('/api/messages/fetch', async (req: RequestWithId, res) => {
      try {
        const { peer, filter, batchSize = 5000, page = 1, limit = 100 } =
          req.body || {};

        if (!peer || !peer.chatType || !peer.peerUid) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            'peer参数不完整',
            'INVALID_PEER'
          );
        }

        const fetcher = new BatchMessageFetcher(this.core, {
          batchSize,
          timeout: 30000,
          retryCount: 3
        });

        // Top-K 保留 page*limit 条最新消息（按时间倒序展示，故使用时间越大越新）
        const K = Math.max(1, Math.min(50000, page * limit)); // 兼顾极端页数，避免滥用
        const heap = new MinHeap<{ t: number; i: number; m: RawMessage }>();
        let totalCount = 0;
        let indexCounter = 0;

        const startTime = ensureMsTimestamp(filter?.startTime) || 0;
        const endTime =
          ensureMsTimestamp(filter?.endTime) || Date.now();

        const gen = fetcher.fetchAllMessagesInTimeRange(
          peer,
          startTime,
          endTime
        );

        for await (const batch of gen) {
          totalCount += batch.length;
          for (const m of batch) {
            let t = ensureMsTimestamp(m.msgTime);
            if (t <= 0) t = 0; // 容错
            const item = { t, i: indexCounter++, m };
            if (heap.size() < K) {
              heap.push(item);
            } else if ((heap.peek()?.t ?? Number.NEGATIVE_INFINITY) < t) {
              heap.replaceTop(item);
            }
          }
        }

        // 从堆中取出 Top-K，按时间戳降序排序（最新在前）
        const topK = heap.toArray();
        topK.sort((a, b) => (b.t === a.t ? b.i - a.i : b.t - a.t));
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginated = topK.slice(startIndex, endIndex).map((x) => x.m);

        this.sendSuccessResponse(
          res,
          {
            messages: paginated,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            hasNext: endIndex < totalCount,
            fetchedAt: nowISO()
          },
          asRequestId(req)
        );
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取所有任务
    this.app.get('/api/tasks', async (req: RequestWithId, res) => {
      try {
        const tasks = Array.from(this.exportTasks.values())
          .map((task) => ({
            id: task.taskId,
            peer: task.peer,
            sessionName: task.sessionName || task.peer.peerUid,
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
          }))
          .sort((a, b) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });

        this.sendSuccessResponse(res, { tasks }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取指定任务
    this.app.get('/api/tasks/:taskId', async (req: RequestWithId, res) => {
      try {
        const { taskId } = req.params as any;
        const task = this.exportTasks.get(taskId);
        if (!task) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '任务不存在',
            'TASK_NOT_FOUND'
          );
        }
        this.sendSuccessResponse(
          res,
          {
            id: task.taskId,
            peer: task.peer,
            sessionName: task.sessionName || task.peer.peerUid,
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
          },
          asRequestId(req)
        );
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 删除任务
    this.app.delete('/api/tasks/:taskId', async (req: RequestWithId, res) => {
      try {
        const { taskId } = req.params as any;
        if (!this.exportTasks.has(taskId)) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '任务不存在',
            'TASK_NOT_FOUND'
          );
        }
        this.core.context.logger.log(`[ApiServer] 正在删除任务: ${taskId}`);
        this.exportTasks.delete(taskId);
        try {
          await this.dbManager.deleteTask(taskId);
        } catch (dbError) {
          this.core.context.logger.logError(
            `[ApiServer] 从数据库删除任务失败: ${taskId}`,
            dbError
          );
        }
        this.sendSuccessResponse(res, { message: '任务已彻底删除' }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 创建异步导出任务
    this.app.post('/api/messages/export', async (req: RequestWithId, res) => {
      try {
        const { peer, format = 'JSON', filter, options } = req.body || {};
        if (!peer || !peer.chatType || !peer.peerUid) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            'peer参数不完整',
            'INVALID_PEER'
          );
        }

        const taskId = `export_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 11)}`;
        const timestamp = Date.now();

        let fileExt = 'json';
        switch (String(format).toUpperCase()) {
          case 'TXT':
            fileExt = 'txt';
            break;
          case 'HTML':
            fileExt = 'html';
            break;
          case 'JSON':
          default:
            fileExt = 'json';
            break;
        }

        const chatTypePrefix = peer.chatType === 1 ? 'friend' : 'group';
        const date = new Date(timestamp);
        const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
          date.getDate()
        ).padStart(2, '0')}`;
        const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(
          date.getMinutes()
        ).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
        const fileName = `${chatTypePrefix}_${peer.peerUid}_${dateStr}_${timeStr}.${fileExt}`;
        const downloadUrl = `/downloads/${fileName}`;

        // 快速会话名，不阻塞任务创建
        let sessionName = peer.peerUid as string;
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('获取会话名称超时')), 2000)
          );
          let namePromise: Promise<string>;
          if (peer.chatType === 1) {
            namePromise = this.core.apis.FriendApi.getBuddy().then((friends: any[]) => {
              const friend = friends.find((f: any) => f.coreInfo?.uid === peer.peerUid);
              return friend?.coreInfo?.remark || friend?.coreInfo?.nick || String(peer.peerUid);
            });
          } else if (peer.chatType === 2) {
            namePromise = this.core.apis.GroupApi.getGroups().then((groups: any[]) => {
              const group = groups.find(
                (g: any) =>
                  g.groupCode === peer.peerUid || g.groupCode === String(peer.peerUid)
              );
              return group?.groupName || `群聊 ${peer.peerUid}`;
            });
          } else {
            namePromise = Promise.resolve(String(peer.peerUid));
          }
          sessionName = (await Promise.race([namePromise, timeoutPromise])) as string;
        } catch (e) {
          this.core.context.logger.log(
            `快速获取会话名称失败，使用默认名称: ${peer.peerUid}`
          );
        }

        const task = {
          taskId,
          peer,
          sessionName,
          fileName,
          downloadUrl,
          messageCount: 0,
          status: 'running',
          progress: 0,
          createdAt: nowISO(),
          format,
          filter,
          options
        };

        this.exportTasks.set(taskId, task);

        // 异步持久化
        this.saveTaskToDatabase(task).catch((e) => {
          this.core.context.logger.logError('[ApiServer] 保存新任务到数据库失败:', e);
        });

        // 立即返回任务信息
        this.sendSuccessResponse(
          res,
          {
            taskId: task.taskId,
            sessionName: task.sessionName,
            fileName: task.fileName,
            downloadUrl: task.downloadUrl,
            messageCount: task.messageCount,
            status: task.status,
            startTime: filter?.startTime,
            endTime: filter?.endTime
          },
          asRequestId(req)
        );

        // 后台处理
        this.processExportTaskAsync(
          taskId,
          peer,
          format,
          filter,
          options,
          fileName,
          downloadUrl
        );
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    /* ===================
     *    表情包管理API
     * =================== */

    // 获取所有表情包
    this.app.get('/api/sticker-packs', async (req: RequestWithId, res) => {
      const requestId = asRequestId(req);
      try {
        this.core.context.logger.log(
          `[ApiServer] ======= 收到获取表情包列表请求 (${requestId}) =======`
        );
        const typesParam = req.query['types'] as string | undefined;
        let types: any[] | undefined = undefined;
        if (typesParam) {
          types = typesParam.split(',').map((t) => t.trim());
        }
        const start = Date.now();
        const packs = await this.stickerPackExporter.getStickerPacks(types);
        const elapsed = Date.now() - start;
        this.core.context.logger.log(
          `[ApiServer] getStickerPacks 完成 (耗时: ${elapsed}ms)，返回 ${packs.length} 个表情包`
        );

        const stats = { favorite_emoji: 0, market_pack: 0, system_pack: 0 } as any;
        for (const p of packs) {
          if (Object.prototype.hasOwnProperty.call(stats, p.packType)) {
            stats[p.packType]++;
          }
        }
        this.sendSuccessResponse(
          res,
          {
            packs,
            totalCount: packs.length,
            totalStickers: packs.reduce((sum: number, p: any) => sum + p.stickerCount, 0),
            stats
          },
          requestId
        );
        this.core.context.logger.log(
          `[ApiServer] ======= 请求处理完成 (${requestId}) =======`
        );
      } catch (error) {
        this.core.context.logger.logError(
          `[ApiServer] !!! 请求处理失败 (${requestId}):`,
          error
        );
        this.sendErrorResponse(res, error, requestId);
      }
    });

    // 导出指定表情包
    this.app.post('/api/sticker-packs/export', async (req: RequestWithId, res) => {
      try {
        const { packId } = req.body || {};
        if (!packId) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '表情包ID不能为空',
            'MISSING_PACK_ID'
          );
        }
        const result = await this.stickerPackExporter.exportStickerPack(packId);
        if (!result.success) {
          throw new SystemError(
            ErrorType.API_ERROR,
            result.error || '导出失败',
            'EXPORT_FAILED'
          );
        }
        this.sendSuccessResponse(res, result, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 导出所有表情包
    this.app.post('/api/sticker-packs/export-all', async (req: RequestWithId, res) => {
      try {
        const result = await this.stickerPackExporter.exportAllStickerPacks();
        if (!result.success) {
          throw new SystemError(
            ErrorType.API_ERROR,
            result.error || '导出失败',
            'EXPORT_ALL_FAILED'
          );
        }
        this.sendSuccessResponse(res, result, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 获取导出记录
    this.app.get('/api/sticker-packs/export-records', async (req: RequestWithId, res) => {
      try {
        const limit = req.query['limit'] ? parseInt(req.query['limit'] as string) : 50;
        const records = this.stickerPackExporter.getExportRecords(limit);
        this.sendSuccessResponse(res, { records, totalCount: records.length }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    /* ===================
     *      定时导出API
     * =================== */

    this.app.post('/api/scheduled-exports', async (req: RequestWithId, res) => {
      try {
        const config = req.body || {};
        if (
          !config.name ||
          !config.peer ||
          !config.scheduleType ||
          !config.executeTime ||
          !config.timeRangeType ||
          !config.format
        ) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '缺少必需的参数',
            'MISSING_REQUIRED_FIELDS'
          );
        }
        const scheduledExport = await this.scheduledExportManager.createScheduledExport({
          ...config,
          enabled: config.enabled !== false,
          options: config.options || {}
        });
        this.sendSuccessResponse(res, scheduledExport, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    this.app.get('/api/scheduled-exports', async (req: RequestWithId, res) => {
      try {
        const scheduledExports = this.scheduledExportManager.getAllScheduledExports();
        this.sendSuccessResponse(res, { scheduledExports }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    this.app.get('/api/scheduled-exports/:id', async (req: RequestWithId, res) => {
      try {
        const { id } = req.params as any;
        const scheduledExport = this.scheduledExportManager.getScheduledExport(id);
        if (!scheduledExport) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '定时导出任务不存在',
            'SCHEDULED_EXPORT_NOT_FOUND'
          );
        }
        this.sendSuccessResponse(res, scheduledExport, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    this.app.put('/api/scheduled-exports/:id', async (req: RequestWithId, res) => {
      try {
        const { id } = req.params as any;
        const updates = req.body || {};
        const updatedTask = await this.scheduledExportManager.updateScheduledExport(id, updates);
        if (!updatedTask) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '定时导出任务不存在',
            'SCHEDULED_EXPORT_NOT_FOUND'
          );
        }
        this.sendSuccessResponse(res, updatedTask, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    this.app.delete('/api/scheduled-exports/:id', async (req: RequestWithId, res) => {
      try {
        const { id } = req.params as any;
        const deleted = await this.scheduledExportManager.deleteScheduledExport(id);
        if (!deleted) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '定时导出任务不存在',
            'SCHEDULED_EXPORT_NOT_FOUND'
          );
        }
        this.sendSuccessResponse(res, { message: '定时导出任务已删除' }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    this.app.post(
      '/api/scheduled-exports/:id/trigger',
      async (req: RequestWithId, res) => {
        try {
          const { id } = req.params as any;
          const result = await this.scheduledExportManager.triggerScheduledExport(id);
          if (!result) {
            throw new SystemError(
              ErrorType.VALIDATION_ERROR,
              '定时导出任务不存在',
              'SCHEDULED_EXPORT_NOT_FOUND'
            );
          }
          this.sendSuccessResponse(res, result, asRequestId(req));
        } catch (error) {
          this.sendErrorResponse(res, error, asRequestId(req));
        }
      }
    );

    this.app.get(
      '/api/scheduled-exports/:id/history',
      async (req: RequestWithId, res) => {
        try {
          const { id } = req.params as any;
          const limit = parseInt((req.query['limit'] as string) || '50') || 50;
          const history = await this.scheduledExportManager.getExecutionHistory(id, limit);
          this.sendSuccessResponse(res, { history }, asRequestId(req));
        } catch (error) {
          this.sendErrorResponse(res, error, asRequestId(req));
        }
      }
    );

    /* ===================
     *   导出文件相关API
     * =================== */

    // 文件列表（异步 I/O + TTL 缓存）
    this.app.get('/api/exports/files', async (req: RequestWithId, res) => {
      try {
        const exportFiles = await this.getExportFilesWithCache();
        this.sendSuccessResponse(res, { files: exportFiles }, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 文件信息
    this.app.get('/api/exports/files/:fileName/info', async (req: RequestWithId, res) => {
      try {
        const { fileName } = req.params as any;
        const fileInfo = await this.getExportFileInfo(fileName);
        this.sendSuccessResponse(res, fileInfo, asRequestId(req));
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // HTML 预览（异步读取）
    this.app.get('/api/exports/files/:fileName/preview', async (req: RequestWithId, res) => {
      try {
        const { fileName } = req.params as any;
        let filePath = path.join(this.paths.exportsDir, fileName);
        let found = fs.existsSync(filePath);
        if (!found) {
          filePath = path.join(this.paths.scheduledExportsDir, fileName);
          found = fs.existsSync(filePath);
        }
        if (!found) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            `文件不存在: ${fileName}`,
            'FILE_NOT_FOUND'
          );
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        const htmlContent = await fsp.readFile(path.resolve(filePath), 'utf8');
        res.send(htmlContent);
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // HTML 预览页面内资源（走资源缓存 O(1) 查找）
    this.app.get('/api/exports/files/:fileName/resources/*', async (req: RequestWithId, res) => {
      try {
        const resourcePath = (req.params as any)[0] as string;
        const normalizedPath = path.normalize(resourcePath);
        if (
          normalizedPath.includes('..') ||
          normalizedPath.startsWith('/') ||
          normalizedPath.startsWith('\\')
        ) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '非法的资源路径',
            'INVALID_PATH'
          );
        }
        const fullPath = this.findResourceFile(resourcePath);
        if (!fullPath || !fs.existsSync(fullPath)) {
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            `资源文件不存在: ${resourcePath}`,
            'RESOURCE_NOT_FOUND'
          );
        }
        const ext = path.extname(resourcePath).toLowerCase();
        const ct = CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', STATIC_CACHE_CONTROL);
        res.sendFile(fullPath);
      } catch (error) {
        this.sendErrorResponse(res, error, asRequestId(req));
      }
    });

    // 静态目录
    this.app.use('/downloads', express.static(this.paths.exportsDir));
    this.app.use('/scheduled-downloads', express.static(this.paths.scheduledExportsDir));
    this.app.use('/resources', express.static(this.paths.resourcesDir));

    // 前端路由
    this.frontendBuilder.setupStaticRoutes(this.app);

    // 404
    this.app.use((req: RequestWithId, res) => {
      this.sendErrorResponse(
        res,
        new SystemError(
          ErrorType.API_ERROR,
          `API端点不存在: ${req.method} ${req.path}`,
          'ENDPOINT_NOT_FOUND'
        ),
        asRequestId(req),
        404
      );
    });

    // 错误处理中间件
    this.app.use((error: any, req: RequestWithId, res: Response, _next: any) => {
      this.sendErrorResponse(res, error, asRequestId(req));
    });
  }

  /* -----------------------------------------------
   *                 WebSocket 管理
   * ----------------------------------------------- */

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: AliveWebSocket) => {
      const requestId = genRequestId();
      this.core.context.logger.log(`[API] WebSocket连接建立: ${requestId}`);

      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));

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
        timestamp: nowISO()
      });
    });

    // 心跳清理（防僵尸连接）
    this.wsHeartbeatTimer = setInterval(() => {
      for (const ws of this.wsConnections) {
        if (ws.isAlive === false) {
          try {
            ws.terminate();
          } catch {
            // ignore
          } finally {
            this.wsConnections.delete(ws);
          }
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          // ignore
        }
      }
    }, WS_PING_INTERVAL_MS);
  }

  private sendWebSocketMessage(ws: WebSocket, message: any): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      this.core.context.logger.logError('[API] 发送WebSocket消息失败:', error);
    }
  }

  private broadcastWebSocketMessage(message: any): void {
    for (const ws of this.wsConnections) {
      this.sendWebSocketMessage(ws, message);
    }
  }

  /* -----------------------------------------------
   *             导出任务异步处理（复用强化）
   * ----------------------------------------------- */

  private async processExportTaskAsync(
    taskId: string,
    peer: any,
    format: string,
    filter: any,
    options: any,
    fileName: string,
    downloadUrl: string
  ): Promise<void> {
    const updateProgress = async (partial: Partial<any>) => {
      const t = this.exportTasks.get(taskId);
      if (!t) return;
      Object.assign(t, partial);
      this.exportTasks.set(taskId, t);
      // 异步落库，不阻塞主流程
      this.saveTaskToDatabase(t).catch((e) =>
        this.core.context.logger.logError(`[ApiServer] 更新任务 ${taskId} 到数据库失败:`, e)
      );
    };

    try {
      this.broadcastWebSocketMessage({
        type: 'export_progress',
        data: { taskId, status: 'running', progress: 0, message: '开始获取消息...' }
      });
      await updateProgress({ status: 'running', progress: 0, message: '开始获取消息...' });

      const fetcher = new BatchMessageFetcher(this.core, {
        batchSize: options?.batchSize || 5000,
        timeout: 120000,
        retryCount: 3
      });

      let startTimeMs = ensureMsTimestamp(filter?.startTime) || 0;
      let endTimeMs = ensureMsTimestamp(filter?.endTime) || Date.now();

      this.core.context.logger.log(
        `[ApiServer] 时间范围: ${new Date(startTimeMs).toISOString()} - ${new Date(
          endTimeMs
        ).toISOString()}`
      );

      const allMessages: RawMessage[] = [];
      const messageGenerator = fetcher.fetchAllMessagesInTimeRange(
        peer,
        startTimeMs,
        endTimeMs
      );

      let batchCount = 0;
      for await (const batch of messageGenerator) {
        batchCount++;
        allMessages.push(...batch);

        const progress = Math.min(batchCount * 10, 50);
        await updateProgress({
          progress,
          messageCount: allMessages.length,
          message: `已获取 ${allMessages.length} 条消息...`
        });
        this.broadcastWebSocketMessage({
          type: 'export_progress',
          data: {
            taskId,
            status: 'running',
            progress,
            message: `已获取 ${allMessages.length} 条消息...`,
            messageCount: allMessages.length
          }
        });

        // 控制 GC 触发频率
        if (batchCount % 10 === 0 && (global as any).gc) {
          (global as any).gc();
        }
      }

      // 纯图片过滤（如启用）
      let filteredMessages = allMessages;
      if (options?.filterPureImageMessages) {
        const parser = new SimpleMessageParser();
        const kept: RawMessage[] = [];
        for (const msg of allMessages) {
          try {
            const clean = await parser.parseSingleMessage(msg);
            if (!parser.isPureImageMessage(clean)) kept.push(msg);
          } catch {
            kept.push(msg); // 解析异常则保留，逻辑不变
          }
        }
        filteredMessages = kept;
        this.core.context.logger.log(
          `[ApiServer] 纯图片消息过滤完成: ${allMessages.length} → ${filteredMessages.length} 条`
        );
      }

      await updateProgress({
        progress: 60,
        message: '正在解析消息...',
        messageCount: filteredMessages.length
      });
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

      await updateProgress({
        progress: 70,
        message: '正在下载资源...',
        messageCount: filteredMessages.length
      });
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

      const resourceMap = await this.resourceHandler.processMessageResources(
        filteredMessages
      );

      await updateProgress({
        progress: 85,
        message: '正在生成文件...',
        messageCount: filteredMessages.length
      });
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

      // 确保导出目录存在
      await fsp.mkdir(this.paths.exportsDir, { recursive: true });
      const filePath = path.join(this.paths.exportsDir, fileName);

      // 排序（升序，保证时间线一致）
      filteredMessages.sort((a, b) => {
        const ta = ensureMsTimestamp(a.msgTime) || 0;
        const tb = ensureMsTimestamp(b.msgTime) || 0;
        return ta - tb;
      });

      const task = this.exportTasks.get(taskId);
      const chatName = task?.sessionName || peer.peerUid;
      const chatInfo = {
        name: chatName,
        type:
          peer.chatType === ChatType.KCHATTYPEGROUP ? ('group' as const) : ('private' as const)
      };

      switch (String(format).toUpperCase()) {
        case 'TXT': {
          const exporter = new TextExporter(
            {
              outputPath: filePath,
              includeResourceLinks: options?.includeResourceLinks ?? true,
              includeSystemMessages: options?.includeSystemMessages ?? true,
              filterPureImageMessages: options?.filterPureImageMessages ?? false,
              prettyFormat: options?.prettyFormat ?? true,
              timeFormat: 'YYYY-MM-DD HH:mm:ss',
              encoding: 'utf-8'
            },
            {},
            this.core
          );
          await exporter.export(filteredMessages, chatInfo);
          break;
        }
        case 'JSON': {
          const exporter = new JsonExporter(
            {
              outputPath: filePath,
              includeResourceLinks: options?.includeResourceLinks ?? true,
              includeSystemMessages: options?.includeSystemMessages ?? true,
              filterPureImageMessages: options?.filterPureImageMessages ?? false,
              prettyFormat: options?.prettyFormat ?? true,
              timeFormat: 'YYYY-MM-DD HH:mm:ss',
              encoding: 'utf-8'
            },
            {},
            this.core
          );
          await exporter.export(filteredMessages, chatInfo);
          break;
        }
        case 'HTML': {
          const parser = new SimpleMessageParser();
          const htmlExporter = new ModernHtmlExporter({
            outputPath: filePath,
            includeResourceLinks: options?.includeResourceLinks ?? true,
            includeSystemMessages: options?.includeSystemMessages ?? true,
            encoding: 'utf-8'
          });
          const messageStream = parser.parseMessagesStream(filteredMessages, resourceMap);
          await htmlExporter.exportFromIterable(messageStream, chatInfo);
          break;
        }
        default:
          throw new SystemError(
            ErrorType.VALIDATION_ERROR,
            '不支持的导出格式',
            'INVALID_FORMAT'
          );
      }

      const st = await fsp.stat(filePath);
      await updateProgress({
        status: 'completed',
        progress: 100,
        message: '导出完成',
        messageCount: filteredMessages.length,
        fileSize: st.size,
        completedAt: nowISO()
      });
      this.broadcastWebSocketMessage({
        type: 'export_complete',
        data: {
          taskId,
          status: 'completed',
          progress: 100,
          message: '导出完成',
          messageCount: filteredMessages.length,
          fileName,
          filePath,
          fileSize: st.size,
          downloadUrl
        }
      });

      // 刷盘
      await this.dbManager.flushWriteQueue();

      // 资源缓存失效（新资源可见）
      this.clearResourceCache('images');
      this.clearResourceCache('videos');
      this.clearResourceCache('audios');

      // 导出文件列表缓存失效（下次请求即时可见）
      this.invalidateExportFilesCache();
    } catch (error) {
      this.core.context.logger.logError(`[ApiServer] 导出任务失败: ${taskId}`, error);
      await this.updateTaskStatus(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '导出失败',
        completedAt: nowISO()
      });
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

  /* -----------------------------------------------
   *            统一成功/失败响应封装
   * ----------------------------------------------- */

  private sendSuccessResponse<T>(res: Response, data: T, requestId: string): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      timestamp: nowISO(),
      requestId
    };
    res.json(response);
  }

  private sendErrorResponse(
    res: Response,
    error: any,
    requestId: string,
    statusCode = 500
  ): void {
    let systemError: SystemError;
    if (error instanceof SystemError) {
      systemError = error;
    } else {
      systemError = new SystemError(
        ErrorType.UNKNOWN_ERROR,
        error?.message || '未知错误',
        'UNKNOWN_ERROR'
      );
    }
    const response: ApiResponse = {
      success: false,
      error: {
        type: systemError.type,
        message: systemError.message,
        timestamp: systemError.timestamp,
        stack: error?.stack,
        context: {
          code: systemError.code,
          requestId
        }
      },
      timestamp: nowISO(),
      requestId
    };
    this.core.context.logger.logError('[API] 请求错误:', error);
    res.status(statusCode).json(response);
  }

  /* -----------------------------------------------
   *                 初始化 / 启停
   * ----------------------------------------------- */

  async initialize(): Promise<void> {
    try {
      await this.securityManager.initialize();
      await this.dbManager.initialize();
      await this.loadExistingTasks();
      await this.scheduledExportManager.initialize();
      await this.frontendBuilder.initialize();
      this.core.context.logger.log('[ApiServer] 安全配置、数据库和前端服务初始化完成');
    } catch (error) {
      this.core.context.logger.logError('[ApiServer] 初始化失败:', error);
    }
  }

  private async loadExistingTasks(): Promise<void> {
    try {
      this.core.context.logger.log('[ApiServer] 开始加载现有任务...');
      const tasks = await this.dbManager.getAllTasks();
      this.core.context.logger.log(`[ApiServer] 从数据库获取到 ${tasks.length} 个任务`);

      for (const { config, state } of tasks) {
        const createdAt =
          typeof config.createdAt === 'string'
            ? config.createdAt
            : config.createdAt?.toISOString?.() || nowISO();
        const completedAt =
          state.endTime &&
          (typeof state.endTime === 'string'
            ? state.endTime
            : state.endTime?.toISOString?.());

        const fileName = `${config.chatName}_${Date.now()}.json`;
        const apiTask = {
          taskId: config.taskId,
          peer: config.peer,
          sessionName: config.chatName,
          status:
            state.status === ExportTaskStatus.RUNNING
              ? 'running'
              : state.status === ExportTaskStatus.COMPLETED
              ? 'completed'
              : state.status === ExportTaskStatus.FAILED
              ? 'failed'
              : 'pending',
          progress:
            state.totalMessages > 0
              ? Math.round((state.processedMessages / state.totalMessages) * 100)
              : 0,
          format: (config.formats[0] || 'JSON') as string,
          messageCount: state.processedMessages,
          fileName,
          downloadUrl: `/downloads/${fileName}`,
          createdAt,
          completedAt,
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
      this.core.context.logger.log(`[ApiServer] 已加载 ${tasks.length} 个现有任务`);
    } catch (error) {
      this.core.context.logger.logError('[ApiServer] 加载现有任务失败:', error);
    }
  }

  private async saveTaskToDatabase(task: any): Promise<void> {
    try {
      const config: ExportTaskConfig = {
        taskId: task.taskId,
        taskName: task.sessionName,
        peer: task.peer,
        chatType: task.peer.chatType === 1 ? ChatTypeSimple.PRIVATE : ChatTypeSimple.GROUP,
        chatName: task.sessionName,
        chatAvatar: '',
        formats: [String(task.format || 'JSON').toUpperCase() as ExportFormat],
        filter: {
          startTime: task.filter?.startTime,
          endTime: task.filter?.endTime,
          includeRecalled: task.filter?.includeRecalled || false
        },
        outputDir: this.paths.exportsDir,
        includeResourceLinks: task.options?.includeResourceLinks || true,
        batchSize: task.options?.batchSize || 5000,
        timeout: 30000,
        retryCount: 3,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date()
      };

      const state: ExportTaskState = {
        taskId: task.taskId,
        status:
          task.status === 'running'
            ? ExportTaskStatus.RUNNING
            : task.status === 'completed'
            ? ExportTaskStatus.COMPLETED
            : task.status === 'failed'
            ? ExportTaskStatus.FAILED
            : ExportTaskStatus.PENDING,
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
      this.core.context.logger.logError('[ApiServer] 保存任务到数据库失败:', error);
    }
  }

  private async updateTaskStatus(taskId: string, updates: Partial<any>): Promise<void> {
    const task = this.exportTasks.get(taskId);
    if (!task) return;
    Object.assign(task, updates);
    this.exportTasks.set(taskId, task);
    this.saveTaskToDatabase(task).catch((e) =>
      this.core.context.logger.logError(`[ApiServer] 更新任务 ${taskId} 到数据库失败:`, e)
    );
  }

  async start(): Promise<void> {
    await this.initialize();
    return new Promise((resolve, reject) => {
      this.server.listen(40653, '0.0.0.0', () => {
        const securityStatus = this.securityManager.getSecurityStatus();
        const serverAddresses = this.securityManager.getServerAddresses();
        const accessToken = this.securityManager.getAccessToken();

        this.core.context.logger.log(
          '[API] ══════════════════════════════════════════════════════════'
        );
        this.core.context.logger.log('[API]  QQChatExporter • v4.0.0');
        this.core.context.logger.log('[API]  GitHub: https://github.com/shuakami/qq-chat-exporter');
        this.core.context.logger.log('[API]  这是一个免费开源项目！如果您是买来的，请立即退款！');
        this.core.context.logger.log('[API]  如果有帮助到您，欢迎给我点个Star~');
        
        if (accessToken) {
          this.core.context.logger.log('[API] 🔐 安全认证已启用');
          this.core.context.logger.log(`[API] 🔑 访问令牌: ${accessToken}`);
          if (securityStatus.tokenExpired) {
            this.core.context.logger.log('[API] ⚠️ 令牌已过期，已自动生成新令牌');
          }
          this.core.context.logger.log('[API] 💡 请在访问前端时输入上述令牌进行认证');
          this.core.context.logger.log(
            '[API] ══════════════════════════════════════════════════════════'
          );
        }

        const frontendStatus = this.frontendBuilder.getStatus();
        if (frontendStatus.isRunning && frontendStatus.mode === 'production') {
          if (serverAddresses.external) {
            this.core.context.logger.log(
              `[API] 🎨 打开工具: ${serverAddresses.external}/qce-v4-tool`
            );
          }
          this.core.context.logger.log(
            `[API] 🎨 打开工具: ${serverAddresses.local}/qce-v4-tool`
          );
        } else if (frontendStatus.mode === 'development') {
          this.core.context.logger.log(
            `[API] 🔧 前端开发服务器: ${frontendStatus.frontendUrl}`
          );
        } else {
          this.core.context.logger.log('[API] ⚠️ 前端应用未构建，请运行 npm run build:universal');
        }

        this.broadcastWebSocketMessage({
          type: 'notification',
          data: {
            message: 'QQ聊天记录导出工具API服务器已启动',
            version: '4.0.0',
            frontend: frontendStatus
          },
          timestamp: nowISO()
        });

        resolve();
      });

      this.server.on('error', (error) => {
        this.core.context.logger.logError('[API] 服务器启动失败:', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise(async (resolve) => {
      this.core.context.logger.log('[API] 正在关闭服务器...');

      try {
        this.core.context.logger.log('[API] 正在保存数据库...');
        await this.dbManager.close();
        this.core.context.logger.log('[API] ✅ 数据库已安全关闭');
      } catch (error) {
        this.core.context.logger.logError('[API] 关闭数据库失败:', error);
      }

      try {
        await this.frontendBuilder.stop();
        this.core.context.logger.log('[API] ✅ 前端服务已停止');
      } catch (error) {
        this.core.context.logger.logError('[API] 停止前端服务失败:', error);
      }

      // 停止 WS 心跳
      if (this.wsHeartbeatTimer) {
        clearInterval(this.wsHeartbeatTimer);
        this.wsHeartbeatTimer = undefined;
      }

      // 关闭所有WebSocket连接
      for (const ws of this.wsConnections) {
        try {
          ws.close(1000, '服务器关闭');
        } catch {
          // ignore
        }
      }
      this.wsConnections.clear();
      this.core.context.logger.log('[API] ✅ WebSocket连接已关闭');

      try {
        this.wss.close();
      } catch {
        // ignore
      }

      this.server.close(() => {
        this.core.context.logger.log('[API] ✅ QQ聊天记录导出工具API服务器已安全关闭');
        resolve();
      });
    });
  }

  /* -----------------------------------------------
   *       导出文件解析 / 列表（异步 + 缓存）
   * ----------------------------------------------- */

  /** 从HTML文件中读取元数据注释（只读前 1KB） */
  private async parseHtmlMetadata(
    filePath: string
  ): Promise<{ messageCount?: number; chatName?: string }> {
    try {
      const fh = await fsp.open(filePath, 'r');
      try {
        const size = Math.min(1024, (await fh.stat()).size);
        const buf = Buffer.alloc(size);
        await fh.read(buf, 0, size, 0);
        const header = buf.toString('utf8');
        const match = header.match(/<!-- QCE_METADATA: ({[^}]+}) -->/);
        if (match && match[1]) {
          const metadata = JSON.parse(match[1]);
          return {
            messageCount: metadata.messageCount || 0,
            chatName: metadata.chatName
          };
        }
      } finally {
        await fh.close();
      }
    } catch {
      // ignore
    }
    return {};
  }

  private invalidateExportFilesCache(): void {
    this.exportFilesCache = null;
  }

  private async getExportFilesWithCache(): Promise<any[]> {
    const now = Date.now();
    if (this.exportFilesCache && now - this.exportFilesCache.ts < EXPORT_FILES_TTL_SEC * 1000) {
      return this.exportFilesCache.data;
    }
    const data = await this.getExportFiles();
    this.exportFilesCache = { ts: now, data };
    return data;
  }

  /** 扫描导出文件（异步 I/O + 元数据优先） */
  private async getExportFiles(): Promise<any[]> {
    const files: any[] = [];
    const pushDir = async (dir: string, isScheduled: boolean) => {
      try {
        const exists = fs.existsSync(dir);
        if (!exists) return;
        const entries = await fsp.readdir(dir);
        for (const fileName of entries) {
          if (!fileName.endsWith('.html')) continue;
          const filePath = path.join(dir, fileName);
          const st = await fsp.stat(filePath);
          const fileInfo = this.parseExportFileName(fileName);
          if (!fileInfo) continue;

          const htmlMeta = await this.parseHtmlMetadata(filePath);
          if (htmlMeta.messageCount !== undefined) {
            fileInfo.messageCount = htmlMeta.messageCount;
          }
          if (htmlMeta.chatName) {
            fileInfo.displayName = htmlMeta.chatName;
          }

          if (!fileInfo.displayName) {
            try {
              if (fileInfo.chatType === 'friend') {
                let friends = this.friendsCache.get('all');
                if (!friends) {
                  friends = await this.core.apis.FriendApi.getBuddy();
                  this.friendsCache.set('all', friends);
                }
                const friend = friends.find((f: any) => f.coreInfo?.uid === fileInfo.chatId);
                fileInfo.displayName =
                  friend?.coreInfo?.remark || friend?.coreInfo?.nick || fileInfo.chatId;
              } else if (fileInfo.chatType === 'group') {
                let groups = this.groupsCache.get('all');
                if (!groups) {
                  groups = await this.core.apis.GroupApi.getGroups(false);
                  this.groupsCache.set('all', groups);
                }
                const group = groups.find(
                  (g: any) => g.groupCode === fileInfo.chatId || g.groupCode === String(fileInfo.chatId)
                );
                fileInfo.displayName = group?.groupName || fileInfo.chatId;
              }
            } catch (e) {
              this.core.context.logger.log(
                `[ApiServer] 获取会话名称失败 (${fileInfo.chatType} ${fileInfo.chatId})`
              );
              fileInfo.displayName = fileInfo.chatId;
            }
          }

          files.push({
            fileName,
            filePath,
            relativePath: isScheduled ? `/scheduled-downloads/${fileName}` : `/downloads/${fileName}`,
            size: st.size,
            createTime: st.birthtime,
            modifyTime: st.mtime,
            isScheduled,
            ...fileInfo
          });
        }
      } catch (error) {
        this.core.context.logger.logError(
          `[ApiServer] 扫描导出目录失败: ${dir}`,
          error
        );
      }
    };

    await pushDir(this.paths.exportsDir, false);
    await pushDir(this.paths.scheduledExportsDir, true);

    files.sort(
      (a, b) => new Date(b.modifyTime).getTime() - new Date(a.modifyTime).getTime()
    );
    return files;
  }

  /** 解析导出文件名 */
  private parseExportFileName(fileName: string): any | null {
    const match = fileName.match(
      /^(friend|group)_(.+?)_(\d{8})_(\d{6})(?:_\d{3}_TEMP)?\.html$/
    );
    if (!match) return null;
    const [, type, id, date, time] = match;
    if (!date || !time) return null;
    const dateTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(
      6,
      8
    )} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
    return {
      chatType: type as 'friend' | 'group',
      chatId: id,
      exportDate: dateTime,
      displayName: undefined,
      avatarUrl:
        type === 'friend'
          ? `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100`
          : `https://p.qlogo.cn/gh/${id}/${id}/100`
    };
  }

  /** 获取特定导出文件的详细信息（异步） */
  private async getExportFileInfo(fileName: string): Promise<any> {
    let filePath = path.join(this.paths.exportsDir, fileName);
    let isScheduled = false;
    if (!fs.existsSync(filePath)) {
      filePath = path.join(this.paths.scheduledExportsDir, fileName);
      isScheduled = true;
    }
    if (!fs.existsSync(filePath)) {
      throw new SystemError(
        ErrorType.VALIDATION_ERROR,
        '导出文件不存在',
        'FILE_NOT_FOUND'
      );
    }
    const st = await fsp.stat(filePath);
    const basic = this.parseExportFileName(fileName);
    if (!basic) {
      throw new SystemError(
        ErrorType.VALIDATION_ERROR,
        '无效的文件名格式',
        'INVALID_FILENAME'
      );
    }

    // 尝试从 HTML 内容中解析更多信息（保底）
    let detailed: any = null;
    try {
      const htmlContent = await fsp.readFile(filePath, 'utf-8');
      detailed = this.extractChatInfoFromHtml(htmlContent);
    } catch (e) {
      this.core.context.logger.log('[ApiServer] 无法解析HTML文件内容');
    }

    return {
      fileName,
      filePath,
      relativePath: isScheduled ? `/scheduled-downloads/${fileName}` : `/downloads/${fileName}`,
      size: st.size,
      createTime: st.birthtime,
      modifyTime: st.mtime,
      isScheduled,
      ...basic,
      ...detailed
    };
  }

  /** 简单 HTML 信息提取 */
  private extractChatInfoFromHtml(htmlContent: string): any {
    const info: any = {};
    try {
      const titleMatch = htmlContent.match(/<title>([^<]+?)(?:\s*-\s*聊天记录)?<\/title>/);
      if (titleMatch && titleMatch[1]) info.displayName = titleMatch[1].trim();
      if (!info.displayName) {
        const headerMatch = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/);
        if (headerMatch && headerMatch[1]) info.displayName = headerMatch[1].trim();
      }
      const exportTimeMatch = htmlContent.match(/<div class="info-value">([^<]+)<\/div>/);
      if (exportTimeMatch) info.exportTime = exportTimeMatch[1];

      const messageCountMatch = htmlContent.match(
        /消息总数.*?<div class="info-value">(\d+)<\/div>/s
      );
      if (messageCountMatch && messageCountMatch[1]) {
        info.messageCount = parseInt(messageCountMatch[1], 10);
      }

      const senderMatch = htmlContent.match(/<span class="sender">([^<]+)<\/span>/);
      if (senderMatch) info.senderName = senderMatch[1];

      const timeRangeMatch = htmlContent.match(
        /时间范围.*?<div class="info-value">([^<]+)<\/div>/s
      );
      if (timeRangeMatch) info.timeRange = timeRangeMatch[1];
    } catch {
      // ignore
    }
    return info;
  }
}
