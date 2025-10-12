/**
 * QQ聊天记录导出工具API启动器
 * 用于在插件中启动和管理API服务器
 */
import { QQChatExporterApiServer } from './ApiServer.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * API启动器类
 */
export class QQChatExporterApiLauncher {
    apiServer = null;
    core;
    isRunning = false;
    /**
     * 构造函数
     */
    constructor(core) {
        this.core = core;
    }
    /**
     * 启动API服务器
     */
    async startApiServer() {
        if (this.isRunning) {
            this.core.context.logger.log('[ApiLauncher] API服务器已在运行中');
            return;
        }
        try {
            this.core.context.logger.log('[ApiLauncher] 正在启动QQ聊天记录导出工具API服务器...');
            this.apiServer = new QQChatExporterApiServer(this.core);
            await this.apiServer.start();
            this.isRunning = true;
        }
        catch (error) {
            this.core.context.logger.logError('[ApiLauncher] API服务器启动失败:', error);
            this.isRunning = false;
            this.apiServer = null;
            throw error;
        }
    }
    /**
     * 关闭API服务器
     */
    async stopApiServer() {
        if (!this.isRunning || !this.apiServer) {
            this.core.context.logger.log('[ApiLauncher] API服务器未运行');
            return;
        }
        try {
            this.core.context.logger.log('[ApiLauncher] 正在关闭API服务器...');
            await this.apiServer.stop();
            this.apiServer = null;
            this.isRunning = false;
            this.core.context.logger.log('[ApiLauncher] ✅ API服务器已关闭');
        }
        catch (error) {
            this.core.context.logger.logError('[ApiLauncher] 关闭API服务器失败:', error);
            throw error;
        }
    }
    /**
     * 重启API服务器
     */
    async restartApiServer() {
        this.core.context.logger.log('[ApiLauncher] 正在重启API服务器...');
        if (this.isRunning) {
            await this.stopApiServer();
        }
        await this.startApiServer();
        this.core.context.logger.log('[ApiLauncher] ✅ API服务器重启成功');
    }
    /**
     * 获取API服务器状态
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            port: this.isRunning ? 40653 : undefined,
            uptime: this.isRunning ? process.uptime() : undefined
        };
    }
    /**
     * 获取API服务器实例
     */
    getApiServer() {
        return this.apiServer;
    }
}
//# sourceMappingURL=ApiLauncher.js.map