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

/**
 * 判断是否为“重大更新”。仅重大更新才自动弹出更新 popover：
 * - 大版本号（major）提升，或
 * - 同一大版本内，小版本号（minor）距离当前 > 阈值（默认 5）。
 * 普通小更新（补丁 / 少量小版本）不弹窗。
 */
export function isMajorUpdate(latest: string, current: string, minorThreshold = 5): boolean {
    if (!isNewerVersion(latest, current)) {
        return false;
    }
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    if (!latestParts || !currentParts) {
        return false;
    }
    const [latestMajor, latestMinor] = latestParts;
    const [currentMajor, currentMinor] = currentParts;
    if (latestMajor > currentMajor) {
        return true;
    }
    if (latestMajor === currentMajor) {
        return latestMinor - currentMinor > minorThreshold;
    }
    return false;
}

/**
 * 从 Release 正文（Markdown/HTML）中提取第一张图片地址，
 * 用于在更新弹窗中直接展示更新图片。
 */
export function extractReleaseImage(body?: string): string | null {
    if (!body) {
        return null;
    }
    // Markdown 图片：![alt](url)
    const markdownMatch = body.match(/!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/);
    if (markdownMatch?.[1]) {
        return markdownMatch[1];
    }
    // HTML 图片：<img src="url">
    const htmlMatch = body.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (htmlMatch?.[1]) {
        return htmlMatch[1];
    }
    return null;
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
