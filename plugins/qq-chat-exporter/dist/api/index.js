/**
 * QQ聊天记录导出工具API模块入口
 * 导出API服务器和相关工具
 */
export * from './ApiServer.js';
export const DEFAULT_API_CONFIG = {
    port: 40653,
    host: '0.0.0.0',
    enableCors: true,
    enableWebSocket: true,
    staticPath: 'exports'
};
//# sourceMappingURL=index.js.map