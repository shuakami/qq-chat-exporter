/**
 * QQ聊天记录导出工具API启动器
 */

import { QQChatExporterApiServer } from './ApiServer.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';

export class QQChatExporterApiLauncher {
    private apiServer: QQChatExporterApiServer | null = null;
    private core: NapCatCore;
    private isRunning = false;

    constructor(core: NapCatCore) {
        this.core = core;
    }

    async startApiServer(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        try {
            this.apiServer = new QQChatExporterApiServer(this.core);
            await this.apiServer.start();
            this.isRunning = true;
        } catch (error) {
            this.core.context.logger.logError('[QCE] API服务器启动失败:', error);
            this.isRunning = false;
            this.apiServer = null;
            throw error;
        }
    }

    async stopApiServer(): Promise<void> {
        if (!this.isRunning || !this.apiServer) {
            return;
        }

        try {
            await this.apiServer.stop();
            this.apiServer = null;
            this.isRunning = false;
        } catch (error) {
            this.core.context.logger.logError('[QCE] 关闭API服务器失败:', error);
            throw error;
        }
    }

    async restartApiServer(): Promise<void> {
        if (this.isRunning) {
            await this.stopApiServer();
        }
        await this.startApiServer();
    }

    getStatus(): { isRunning: boolean; port?: number; uptime?: number } {
        return {
            isRunning: this.isRunning,
            port: this.isRunning ? 40653 : undefined,
            uptime: this.isRunning ? process.uptime() : undefined
        };
    }

    getApiServer(): QQChatExporterApiServer | null {
        return this.apiServer;
    }
}
