import { NapCatOneBot11Adapter, OB11Message } from '@/onebot';
import { NapCatCore } from '@/core';
import { ActionMap } from '@/onebot/action';
import { OB11PluginMangerAdapter } from '@/onebot/network/plugin-manger';
import { QQChatExporterApiLauncher } from '../qq-chat-exporter/api/ApiLauncher';

// 全局API启动器实例
let apiLauncher: QQChatExporterApiLauncher | null = null;

/**
 * 插件初始化
 * 在NapCat启动时调用，启动QQ聊天记录导出工具API服务器
 */
export const plugin_init = async (
    core: NapCatCore, 
    _obContext: NapCatOneBot11Adapter, 
    _actions: ActionMap, 
    _instance: OB11PluginMangerAdapter
) => {
    try {
        console.log('[Plugin] 正在初始化QQ聊天记录导出工具API服务器...');
        
        // 创建API启动器
        apiLauncher = new QQChatExporterApiLauncher(core);
        
        // 启动API服务器
        await apiLauncher.startApiServer();
        
        console.log('[Plugin] ✅ QQ聊天记录导出工具初始化成功');
        console.log('[Plugin] 🌐 API服务地址: http://localhost:40653');
        console.log('[Plugin] 📡 WebSocket地址: ws://localhost:40653');
        console.log('[Plugin] 📚 API文档地址: http://localhost:40653/');
        console.log('[Plugin] 📄 详细文档: 请查看项目根目录的API.md文件');
        
    } catch (error) {
        console.error('[Plugin] QQ聊天记录导出工具初始化失败:', error);
        apiLauncher = null;
    }
};

/**
 * 消息处理
 * 不处理任何消息，避免在QQ群中自动回复
 */
export const plugin_onmessage = async (
    adapter: string, 
    _core: NapCatCore, 
    _obCtx: NapCatOneBot11Adapter, 
    message: OB11Message, 
    action: ActionMap, 
    instance: OB11PluginMangerAdapter
) => {
    try {
        // 移除所有自动回复功能，避免在QQ群中自动回复消息
        // 如需帮助，请访问 http://localhost:40653 查看API文档
        
    } catch (error) {
        console.error('[Plugin] 消息处理失败:', error);
    }
};

/**
 * 事件处理
 * 处理其他类型的事件（如好友请求、群邀请等）
 */
export const plugin_onevent = async (
    _adapter: string, 
    _core: NapCatCore, 
    _obCtx: NapCatOneBot11Adapter, 
    _event: any, 
    _actions: ActionMap, 
    _instance: OB11PluginMangerAdapter
) => {
    try {
        // 目前暂不处理其他事件，专注于API服务功能
        
    } catch (error) {
        console.error('[Plugin] 事件处理失败:', error);
    }
};

/**
 * 插件清理
 * 在NapCat关闭时调用，关闭API服务器
 */
export const plugin_cleanup = async (
    _core: NapCatCore, 
    _obContext: NapCatOneBot11Adapter, 
    _actions: ActionMap, 
    _instance: OB11PluginMangerAdapter
) => {
    try {
        console.log('[Plugin] 正在清理QQ聊天记录导出工具...');
        
        if (apiLauncher) {
            await apiLauncher.stopApiServer();
            apiLauncher = null;
        }
        
        console.log('[Plugin] ✅ QQ聊天记录导出工具清理完成');
    } catch (error) {
        console.error('[Plugin] QQ聊天记录导出工具清理失败:', error);
    }
};