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
 * 处理所有接收到的消息（保留基本ping-pong功能）
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
        // 保留原有的ping-pong功能
        if (message.raw_message === 'ping') {
            const ret = await action.get('send_group_msg')?.handle({ 
                group_id: String(message.group_id), 
                message: 'pong - QQ聊天记录导出工具API已启动，访问 http://localhost:40653 查看文档' 
            }, adapter, instance.config);
            console.log('[Plugin] Ping-pong response:', ret);
            return;
        }
        
        // 提示用户使用API
        if (message.raw_message.startsWith('/export') || message.raw_message.startsWith('/help')) {
            const helpMessage = `QQ聊天记录导出工具已启动API服务器！
🌐 API地址: http://localhost:40653
📚 完整文档: http://localhost:40653/
📄 API.md: 项目根目录
💡 现在通过HTTP API调用所有功能，支持WebSocket实时进度追踪`;

            if (message.group_id) {
                await action.get('send_group_msg')?.handle({ 
                    group_id: String(message.group_id), 
                    message: helpMessage 
                }, adapter, instance.config);
            } else if (message.user_id) {
                await action.get('send_private_msg')?.handle({ 
                    user_id: String(message.user_id), 
                    message: helpMessage 
                }, adapter, instance.config);
            }
        }
        
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