/**
 * QCE 统一版本管理模块
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function loadVersionFromPackageJson(): string {
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const packagePath = join(__dirname, '../package.json');
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

function getVersion(): string {
    // 优先使用环境变量（CI 构建时注入）
    if (process.env.QCE_VERSION) {
        return process.env.QCE_VERSION.replace(/^v/, '');
    }
    return loadVersionFromPackageJson();
}

/** QCE 版本号 */
export const VERSION = getVersion();

/** 主版本号 */
export const MAJOR_VERSION = VERSION.split('.')[0] || '5';

/** 应用名称 */
export const APP_NAME = 'QQChatExporter';

/** 完整应用名称（带版本） */
export const APP_FULL_NAME = `${APP_NAME} V${MAJOR_VERSION}`;

/** GitHub 仓库地址 */
export const GITHUB_URL = 'https://github.com/shuakami/qq-chat-exporter';

/** 版权声明 */
export const COPYRIGHT = '本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~';

/** 完整的软件信息 */
export const APP_INFO = {
    name: `${APP_FULL_NAME} / ${GITHUB_URL}`,
    version: VERSION,
    copyright: COPYRIGHT,
    github: GITHUB_URL
} as const;
