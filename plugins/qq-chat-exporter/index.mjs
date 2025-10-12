/**
 * QQ聊天记录导出工具插件入口
 */

let apiLauncher = null;

export async function plugin_init(core, obContext, actions, instance) {
  try {
    console.log('[QCE Plugin] 正在初始化...');
    
    // 注入Bridge供Overlay使用
    globalThis.__NAPCAT_BRIDGE__ = { core, obContext, actions, instance };
    console.log('[QCE Plugin] ✓ Bridge已注入');
    
    // 版本自检
    try {
      const h = actions?.get?.('get_version_info');
      const ver = h ? (await h.handle({}, 'plugin', instance?.config)).data : null;
      console.log('[QCE Plugin] NapCat version:', ver || 'unknown');
    } catch (e) {
      console.warn('[QCE Plugin] get_version_info failed:', e);
    }
    
    // 使用tsx动态加载TypeScript
    const tsx = await import('tsx/esm/api').catch(() => null);
    if (!tsx) {
      console.error('[QCE Plugin] tsx not found, installing...');
      throw new Error('请先安装tsx: npm install tsx');
    }
    
    // 注册tsx加载器
    tsx.register();
    
    // 动态导入ApiLauncher (TypeScript)
    const { QQChatExporterApiLauncher } = await import('./lib/api/ApiLauncher.ts');
    
    // 创建并启动
    apiLauncher = new QQChatExporterApiLauncher(core);
    await apiLauncher.startApiServer();
    
    console.log('[QCE Plugin] =====================================');
    console.log('[QCE Plugin] ✓ QQ聊天记录导出工具已启动');
    console.log('[QCE Plugin] 🌐 API地址: http://localhost:40653');
    console.log('[QCE Plugin] 🎨 Web界面: http://localhost:40653/qce-v4-tool');
    console.log('[QCE Plugin] =====================================');
    
  } catch (error) {
    console.error('[QCE Plugin] ✗ 初始化失败:', error);
    console.error(error.stack);
  }
}

export async function plugin_cleanup() {
  try {
    console.log('[QCE Plugin] 正在清理...');
    
    if (apiLauncher) {
      await apiLauncher.stopApiServer();
      apiLauncher = null;
    }
    
    delete globalThis.__NAPCAT_BRIDGE__;
    
    console.log('[QCE Plugin] ✓ 清理完成');
  } catch (error) {
    console.error('[QCE Plugin] ✗ 清理失败:', error);
  }
}
