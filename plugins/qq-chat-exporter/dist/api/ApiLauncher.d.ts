/**
 * QQ聊天记录导出工具API启动器
 * 用于在插件中启动和管理API服务器
 */
import { QQChatExporterApiServer } from './ApiServer.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
/**
 * API启动器类
 */
export declare class QQChatExporterApiLauncher {
    private apiServer;
    private core;
    private isRunning;
    /**
     * 构造函数
     */
    constructor(core: NapCatCore);
    /**
     * 启动API服务器
     */
    startApiServer(): Promise<void>;
    /**
     * 关闭API服务器
     */
    stopApiServer(): Promise<void>;
    /**
     * 重启API服务器
     */
    restartApiServer(): Promise<void>;
    /**
     * 获取API服务器状态
     */
    getStatus(): {
        isRunning: boolean;
        port?: number;
        uptime?: number;
    };
    /**
     * 获取API服务器实例
     */
    getApiServer(): QQChatExporterApiServer | null;
}
//# sourceMappingURL=ApiLauncher.d.ts.map