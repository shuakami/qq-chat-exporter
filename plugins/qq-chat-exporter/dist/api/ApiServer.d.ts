/**
 * QQ聊天记录导出工具API服务器
 * 提供完整的QQ聊天记录导出功能API
 */
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * QQ聊天记录导出工具API服务器
 */
export declare class QQChatExporterApiServer {
    private app;
    private server;
    private wss;
    private core;
    private wsConnections;
    private dbManager;
    private resourceHandler;
    private scheduledExportManager;
    private frontendBuilder;
    private securityManager;
    private stickerPackExporter;
    private exportTasks;
    private taskResourceHandlers;
    private resourceFileCache;
    private messageCache;
    private readonly CACHE_EXPIRE_TIME;
    /**
     * 构造函数
     */
    constructor(core: NapCatCore);
    /**
     * 设置进程退出处理器
     */
    private setupProcessHandlers;
    /**
     * 配置中间件
     */
    private setupMiddleware;
    /**
     * 构建资源文件名缓存（延迟加载）
     * @param dirPath 目录路径（如 images/videos/audios）
     * @returns 文件名映射表
     */
    private buildResourceCache;
    /**
     * 快速查找资源文件（O(1)时间复杂度）
     * @param resourcePath 资源相对路径，如 images/xxx.jpg
     * @returns 实际文件的完整路径，不存在则返回null
     */
    private findResourceFile;
    /**
     * 清除资源文件缓存（当检测到文件变化时调用）
     */
    private clearResourceCache;
    /**
     * 配置路由
     */
    private setupRoutes;
    /**
     * 配置WebSocket
     */
    private setupWebSocket;
    /**
     * 处理WebSocket消息
     */
    private handleWebSocketMessage;
    /**
     * 处理流式搜索请求
     */
    private handleStreamSearchRequest;
    /**
     * 处理取消搜索
     */
    private handleCancelSearch;
    /**
     * 发送WebSocket消息
     */
    private sendWebSocketMessage;
    /**
     * 异步处理导出任务
     */
    private processExportTaskAsync;
    /**
     * 广播消息到所有WebSocket连接
     */
    private broadcastWebSocketMessage;
    /**
     * 生成请求ID
     */
    private generateRequestId;
    /**
     * 发送成功响应
     */
    private sendSuccessResponse;
    /**
     * 发送错误响应
     */
    private sendErrorResponse;
    /**
     * 初始化数据库并加载现有任务
     */
    initialize(): Promise<void>;
    /**
     * 从数据库加载现有任务
     */
    private loadExistingTasks;
    /**
     * 保存任务到数据库
     */
    private saveTaskToDatabase;
    /**
     * 更新任务状态并同步到数据库
     */
    private updateTaskStatus;
    /**
     * 启动服务器
     */
    start(): Promise<void>;
    /**
     * 关闭服务器
     */
    stop(): Promise<void>;
    /**
     * 从HTML文件中读取元数据注释
     */
    private parseHtmlMetadata;
    /**
     * 获取导出文件列表
     */
    private getExportFiles;
    /**
     * 解析导出文件名获取基本信息
     */
    private parseExportFileName;
    /**
     * 获取特定导出文件的详细信息
     */
    private getExportFileInfo;
    /**
     * 从HTML内容中提取聊天信息
     */
    private extractChatInfoFromHtml;
}
//# sourceMappingURL=ApiServer.d.ts.map