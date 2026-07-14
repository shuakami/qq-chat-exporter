/**
 * QCE 前端版本管理
 * 
 * 版本来源优先级：
 * 1. 构建时注入的环境变量 QCE_VERSION
 * 2. 从 API /api/system/info 获取
 */

/** 构建时注入的版本号 */
export const BUILD_VERSION = process.env.QCE_VERSION || 'unknown';

/** 获取版本显示文本 */
export function getVersionDisplay(apiVersion?: string): string {
    // 优先使用 API 返回的版本（运行时真实版本）
    if (apiVersion && apiVersion !== 'unknown') {
        return apiVersion;
    }
    // 回退到构建时版本
    return BUILD_VERSION;
}

function parseVersion(version: string): number[] | null {
    const match = version
        .trim()
        .replace(/^v/i, '')
        .match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/i);
    if (!match) {
        return null;
    }

    const channel = match[4]?.toLowerCase();
    const channelRank = channel
        ? { alpha: 0, beta: 1, rc: 2 }[channel as 'alpha' | 'beta' | 'rc']
        : 3;
    return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        channelRank,
        match[5] ? Number(match[5]) : 0,
    ];
}

export function isNewerVersion(latest: string, current: string): boolean {
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    if (!latestParts || !currentParts) {
        return false;
    }

    for (let index = 0; index < latestParts.length; index += 1) {
        if (latestParts[index] !== currentParts[index]) {
            return latestParts[index] > currentParts[index];
        }
    }
    return false;
}

/** 检查版本是否匹配 */
export function checkVersionMatch(apiVersion?: string): {
    match: boolean;
    buildVersion: string;
    apiVersion: string;
} {
    const build = BUILD_VERSION;
    const api = apiVersion || 'unknown';
    return {
        match: build === api || build === 'unknown' || api === 'unknown',
        buildVersion: build,
        apiVersion: api
    };
}
