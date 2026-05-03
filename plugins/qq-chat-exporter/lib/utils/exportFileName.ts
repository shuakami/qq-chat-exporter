/**
 * Export filename utilities.
 *
 * 提供给 ApiServer 与定时任务复用的文件名生成 / 去重逻辑：
 * - {@link sanitizeChatNameForFileName} 把会话名称裁剪成跨平台安全的文件名片段。
 * - {@link buildExportFileName} 根据用户选项产出最终文件名（包含 Issue #134 的友好命名）。
 * - {@link buildExportDirName} 用于 chunked_jsonl 等目录格式。
 * - {@link disambiguateExportFileName} 在友好命名碰撞时追加 `_<日期>_<时间>` 后缀。
 *
 * 这些函数是纯函数（disambiguate 仅依赖一个 exists 探针），方便单元测试覆盖。
 */

import path from 'path';
import fs from 'fs';

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * 把会话名称压成安全文件名片段：
 * - 移除 Windows / POSIX 都禁用的字符与控制字符；
 * - 把空白与连续下划线压平；
 * - 限制长度，避免触发 OS 文件名上限。
 */
export function sanitizeChatNameForFileName(name: string, maxLength: number = 50): string {
    if (!name) return '';
    let safe = String(name)
        .replace(ILLEGAL_FILENAME_CHARS, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    if (safe.length > maxLength) {
        safe = safe.slice(0, maxLength).replace(/_+$/, '');
    }
    return safe;
}

export interface BuildExportFileNameOptions {
    /** 业务前缀，例如 friend / group。 */
    chatTypePrefix: string;
    /** 对方 UID（一般就是 QQ 号）。 */
    peerUid: string;
    /** 会话名称；为空 / 等于 peerUid 时退回默认格式。 */
    sessionName: string;
    /** YYYYMMDD。 */
    dateStr: string;
    /** HHMMSS。 */
    timeStr: string;
    /** 文件扩展名，不含点。 */
    extension: string;
    /** Issue #216 — 在文件名中带聊天名称。 */
    useNameInFileName?: boolean;
    /** Issue #134 — 友好命名 `<名称>(<QQ号>).<ext>`。优先级高于 useNameInFileName。 */
    useFriendlyFileName?: boolean;
}

/**
 * 根据选项产出最终文件名。
 *
 * 优先级：useFriendlyFileName > useNameInFileName > 默认。
 *
 * 友好命名缺少可用 sessionName 时退回默认格式而非崩溃。
 */
export function buildExportFileName(opts: BuildExportFileNameOptions): string {
    const { chatTypePrefix, peerUid, sessionName, dateStr, timeStr, extension } = opts;
    if (opts.useFriendlyFileName && sessionName && sessionName !== peerUid) {
        const safeName = sanitizeChatNameForFileName(sessionName);
        if (safeName) {
            return `${safeName}(${peerUid}).${extension}`;
        }
    }
    if (opts.useNameInFileName && sessionName && sessionName !== peerUid) {
        const safeName = sanitizeChatNameForFileName(sessionName);
        if (safeName) {
            return `${chatTypePrefix}_${safeName}_${peerUid}_${dateStr}_${timeStr}.${extension}`;
        }
    }
    return `${chatTypePrefix}_${peerUid}_${dateStr}_${timeStr}.${extension}`;
}

export interface BuildExportDirNameOptions extends Omit<BuildExportFileNameOptions, 'extension'> {
    /** 例如 _chunked_jsonl，会原样附加在末尾。 */
    suffix: string;
}

/** 与 {@link buildExportFileName} 同族，但用于目录名（不带扩展名）。 */
export function buildExportDirName(opts: BuildExportDirNameOptions): string {
    const { chatTypePrefix, peerUid, sessionName, dateStr, timeStr, suffix } = opts;
    if (opts.useFriendlyFileName && sessionName && sessionName !== peerUid) {
        const safeName = sanitizeChatNameForFileName(sessionName);
        if (safeName) {
            return `${safeName}(${peerUid})${suffix}`;
        }
    }
    if (opts.useNameInFileName && sessionName && sessionName !== peerUid) {
        const safeName = sanitizeChatNameForFileName(sessionName);
        if (safeName) {
            return `${chatTypePrefix}_${safeName}_${peerUid}_${dateStr}_${timeStr}${suffix}`;
        }
    }
    return `${chatTypePrefix}_${peerUid}_${dateStr}_${timeStr}${suffix}`;
}

/**
 * Issue #134：友好命名不带时间戳，重复导出会撞名。
 *
 * 当目标目录里已经存在同名文件时，附加 `_<dateStr>_<timeStr>` 作为去重后缀，
 * 否则保持原文件名。`exists` 默认走 `fs.existsSync`，便于单元测试注入桩。
 */
export function disambiguateExportFileName(
    outputDir: string,
    fileName: string,
    dateStr: string,
    timeStr: string,
    exists: (p: string) => boolean = fs.existsSync
): string {
    try {
        const fullPath = path.join(outputDir, fileName);
        if (!exists(fullPath)) {
            return fileName;
        }
        const dotIdx = fileName.lastIndexOf('.');
        if (dotIdx <= 0) {
            return `${fileName}_${dateStr}_${timeStr}`;
        }
        const base = fileName.slice(0, dotIdx);
        const ext = fileName.slice(dotIdx);
        return `${base}_${dateStr}_${timeStr}${ext}`;
    } catch {
        return fileName;
    }
}
