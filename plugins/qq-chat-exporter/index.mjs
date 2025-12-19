/**
 * QQ聊天记录导出工具插件入口
 */

let apiLauncher = null;

export async function plugin_init(core, obContext, actions, instance) {
  try {
    // 注入Bridge供Overlay使用
    globalThis.__NAPCAT_BRIDGE__ = { core, obContext, actions, instance };
    
    // 使用tsx动态加载TypeScript
    const tsx = await import('tsx/esm/api').catch(() => null);
    if (!tsx) {
      console.error('[QCE] tsx not found');
      throw new Error('请先安装tsx: npm install tsx');
    }
    
    // 注册tsx加载器
    tsx.register();
    
    // 动态导入ApiLauncher (TypeScript)
    const { QQChatExporterApiLauncher } = await import('./lib/api/ApiLauncher.ts');
    
    // 创建并启动
    apiLauncher = new QQChatExporterApiLauncher(core);
    await apiLauncher.startApiServer();
    
  } catch (error) {
    console.error('[QCE] 初始化失败:', error);
    console.error(error.stack);
  }
}

export async function plugin_cleanup() {
  try {
    if (apiLauncher) {
      await apiLauncher.stopApiServer();
      apiLauncher = null;
    }
    delete globalThis.__NAPCAT_BRIDGE__;
  } catch (error) {
    console.error('[QCE] 清理失败:', error);
  }
}
