/**
 * QQ聊天记录导出工具API启动器
 */

import { QQChatExporterApiServer } from './ApiServer.js';
import { RustBridgeServer, RustServerProcess, findRustServerBinary } from './rustBridge.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';

export class QQChatExporterApiLauncher {
    private apiServer: QQChatExporterApiServer | null = null;
    private rustBridge: RustBridgeServer | null = null;
    private rustServer: RustServerProcess | null = null;
    private core: NapCatCore;
    private isRunning = false;

    constructor(core: NapCatCore) {
        this.core = core;
    }

    async startApiServer(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        // Rust 版服务端：可执行文件存在（且未显式禁用）时优先启用，
        // 插件侧只保留 NapCat Core API 桥接。
        const rustBinary = process.env.QCE_DISABLE_RUST === '1' ? null : findRustServerBinary();
        if (rustBinary) {
            try {
                this.rustBridge = new RustBridgeServer(this.core);
                await this.rustBridge.start();
                this.rustServer = new RustServerProcess(rustBinary, (message) =>
                    this.core.context.logger.log(message)
                );
                this.rustServer.start(this.rustBridge.getPort());
                this.isRunning = true;
                this.core.context.logger.log(`[QCE] Rust 服务端已启动: ${rustBinary}`);
                return;
            } catch (error) {
                this.core.context.logger.logError('[QCE] Rust 服务端启动失败，回退 TS 服务端:', error);
                this.rustServer?.stop();
                this.rustServer = null;
                await this.rustBridge?.stop();
                this.rustBridge = null;
            }
        } else if (process.env.QCE_DISABLE_RUST !== '1') {
            this.core.context.logger.log('[QCE] 未找到 qce-server 可执行文件，使用 TS 服务端');
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
        if (!this.isRunning) {
            return;
        }

        try {
            if (this.rustServer || this.rustBridge) {
                this.rustServer?.stop();
                this.rustServer = null;
                await this.rustBridge?.stop();
                this.rustBridge = null;
                this.isRunning = false;
                return;
            }
            if (this.apiServer) {
                await this.apiServer.stop();
                this.apiServer = null;
            }
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
