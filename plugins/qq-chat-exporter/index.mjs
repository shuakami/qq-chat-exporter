/**
 * QQ聊天记录导出工具插件入口
 * 支持 NapCat Shell 和 Framework 两种运行模式
 */

let apiLauncher = null;

/**
 * 检测当前运行模式
 * @returns {'shell' | 'framework' | 'unknown'}
 */
function detectWorkingEnv(core) {
  // 优先从 core.context.workingEnv 获取
  const workingEnv = core?.context?.workingEnv;
  if (workingEnv === 1) return 'shell';
  if (workingEnv === 2) return 'framework';
  
  // 备用检测：检查是否存在 Electron 环境（Framework 模式特征）
  if (typeof process !== 'undefined') {
    if (process.versions?.electron) return 'framework';
    // Shell 模式通常没有 electron
    if (process.env?.NAPCAT_SHELL) return 'shell';
  }
  
  return 'unknown';
}

export async function plugin_init(core, obContext, actions, instance) {
  try {
    const workingEnv = detectWorkingEnv(core);
    
    // 注入Bridge供Overlay使用，包含运行模式信息
    globalThis.__NAPCAT_BRIDGE__ = { 
      core, 
      obContext, 
      actions, 
      instance,
      workingEnv 
    };
    
    console.log(`[QCE] 运行模式: ${workingEnv === 'framework' ? 'Framework (QQNT插件)' : workingEnv === 'shell' ? 'Shell (独立无头)' : '未知'}`);
    
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
