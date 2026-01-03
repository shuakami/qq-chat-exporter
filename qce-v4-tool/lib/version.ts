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
