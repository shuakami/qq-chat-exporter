/**
 * QQ聊天记录导出工具API模块入口
 * 导出API服务器和相关工具
 */

export * from './ApiServer';

// 导出API相关类型
export interface ApiServerConfig {
    /** 监听端口 */
    port: number;
    /** 监听地址 */
    host: string;
    /** 是否启用CORS */
    enableCors: boolean;
    /** 是否启用WebSocket */
    enableWebSocket: boolean;
    /** 静态文件服务路径 */
    staticPath?: string;
    /** API访问密码（可选） */
    accessPassword?: string;
    /** SSL配置（可选） */
    ssl?: {
        key: string;
        cert: string;
    };
}

export const DEFAULT_API_CONFIG: ApiServerConfig = {
    port: 40653,
    host: '0.0.0.0',
    enableCors: true,
    enableWebSocket: true,
    staticPath: 'exports'
};