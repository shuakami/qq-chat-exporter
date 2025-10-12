/**
 * QQ聊天记录导出工具前端服务管理器
 * 负责管理NextJS前端应用的启动和服务
 */
import express from 'express';
/**
 * 前端服务管理器
 */
export declare class FrontendBuilder {
    private devServer;
    private isDevMode;
    private frontendPort;
    private staticPath;
    private nextjsProjectPath;
    constructor();
    /**
     * 初始化前端服务
     */
    initialize(): Promise<void>;
    /**
     * 启动NextJS开发服务器
     */
    private startDevServer;
    /**
     * 检查静态资源是否存在
     */
    private checkStaticAssets;
    /**
     * 设置前端静态文件服务路由
     * @param app Express应用实例
     */
    setupStaticRoutes(app: express.Application): void;
    /**
     * 获取前端访问URL
     */
    getFrontendUrl(): string;
    /**
     * 检查前端服务是否在运行
     */
    isRunning(): boolean;
    /**
     * 停止前端服务
     */
    stop(): Promise<void>;
    /**
     * 获取服务状态信息
     */
    getStatus(): {
        isRunning: boolean;
        mode: 'development' | 'production';
        frontendUrl: string;
        staticPath?: string;
    };
    /**
     * 生成认证页面HTML
     */
    private generateAuthPage;
}
//# sourceMappingURL=FrontendBuilder.d.ts.map