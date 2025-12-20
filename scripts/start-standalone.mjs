#!/usr/bin/env node
/**
 * QCE 独立模式启动脚本
 * 无需 NapCat 登录即可运行，用于浏览已导出的聊天记录和资源
 * 
 * 使用方法:
 *   node scripts/start-standalone.mjs [port]
 * 
 * 示例:
 *   node scripts/start-standalone.mjs        # 使用默认端口 40653
 *   node scripts/start-standalone.mjs 8080   # 使用端口 8080
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从插件目录加载 tsx
const pluginDir = join(__dirname, '../plugins/qq-chat-exporter');
const require = createRequire(join(pluginDir, 'package.json'));

async function main() {
    const port = parseInt(process.argv[2]) || 40653;
    
    console.log('[QCE] 正在启动独立模式...');
    
    try {
        // 使用插件目录的 tsx
        const tsx = await import(pathToFileURL(join(pluginDir, 'node_modules/tsx/esm/api.mjs')).href);
        tsx.register();
        
        // 动态导入 StandaloneServer
        const serverPath = pathToFileURL(join(pluginDir, 'lib/api/StandaloneServer.ts')).href;
        const { startStandaloneServer } = await import(serverPath);
        
        await startStandaloneServer(port);
        
        // 保持进程运行
        process.on('SIGINT', () => {
            console.log('\n[QCE] 正在关闭...');
            process.exit(0);
        });
    } catch (error) {
        console.error('[QCE] 启动失败:', error);
        console.error('\n请确保已安装插件依赖:');
        console.error('  cd plugins/qq-chat-exporter && npm install');
        process.exit(1);
    }
}

main();
