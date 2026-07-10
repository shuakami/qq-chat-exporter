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

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, '..');

async function main() {
    const port = parseInt(process.argv[2]) || 40653;
    
    console.log('[QCE] Starting standalone mode');
    
    try {
        const binary = join(
            repoRoot,
            'qq-chat-export-server',
            'target',
            'release',
            process.platform === 'win32' ? 'qce-server.exe' : 'qce-server',
        );
        const child = spawn(binary, [], {
            cwd: repoRoot,
            env: { ...process.env, QCE_SERVER_PORT: String(port) },
            stdio: 'inherit',
        });
        child.on('error', (error) => {
            console.error('[QCE] Standalone startup failed:', error);
            process.exit(1);
        });
        child.on('exit', (code, signal) => {
            process.exit(code ?? (signal ? 1 : 0));
        });
        const stop = () => child.kill();
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    } catch (error) {
        console.error('[QCE] Standalone startup failed:', error);
        console.error('\nBuild the Rust server first:');
        console.error('  cargo build --release --manifest-path qq-chat-export-server/Cargo.toml');
        process.exit(1);
    }
}

main();
