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
    /**
     * 构造函数
     */
    constructor(core: NapCatCore);
    /**
     * 配置中间件
     */
    private setupMiddleware;
    /**
     * 配置路由
     */
    private setupRoutes;
    /**
     * 配置WebSocket
     */
    private setupWebSocket;
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