/**
 * issue #363：把一份资源批处理摘要翻译成给用户看的中文一句话。
 *
 * 背景：用户在 NapCat 终端里看到 `[Rkey] 所有服务均已禁用，片段使用 fallBack 机制`
 * 之类的日志后，无法判断 QCE 这次导出是不是成功、有没有漏图、要不要重试。这个
 * helper 直接基于本次批处理的统计给出明确结论：
 *   - 资源 X/Y、跳过 N、失败 M（含 a、b、c 等）；
 *   - 失败时附上一句对 Rkey 降级的说明 + 重试建议。
 *
 * 抽成纯函数是为了让 ApiServer / ScheduledExportManager 都能复用，并且方便单测覆盖
 * 各种 (failed, skipped, attempted) 组合而不需要拉起整个数据库 / 资源管线。
 */

export interface ResourceBatchSummaryLike {
    attempted: number;
    alreadyAvailable: number;
    downloaded: number;
    failed: number;
    skipped: number;
    failedSamples: string[];
}

/**
 * 构造一句给用户看的资源摘要消息。
 *
 * 返回值约定：
 *   - `null` 表示这一批没动过任何资源（纯文字消息或显式跳过资源下载），
 *     调用方不需要在 UI 上额外提示什么。
 *   - 否则永远返回完整一句话，调用方按需附加在任务的 message / progressMessage 字段里。
 */
export function buildResourceSummaryMessage(
    summary: ResourceBatchSummaryLike | null | undefined,
): string | null {
    if (!summary || summary.attempted <= 0) return null;

    const reused = summary.alreadyAvailable + summary.downloaded;
    const parts: string[] = [`资源 ${reused}/${summary.attempted}`];
    if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped}`);
    if (summary.failed > 0) {
        const sampleList = (summary.failedSamples || []).slice(0, 3).join('、');
        const sample = sampleList ? `（含 ${sampleList}${summary.failed > 3 ? ' 等' : ''}）` : '';
        parts.push(`失败 ${summary.failed}${sample}`);
    }

    const head = parts.join('，');
    if (summary.failed === 0) return head;

    return (
        `${head}。这通常是 QQ Rkey 服务临时降级导致下载链接拿不到（NapCat 终端会打 ` +
        '`[Rkey] 所有服务均已禁用，片段使用 fallBack 机制`），文字内容不受影响。' +
        '可以在 QQ 客户端重新点开这些消息让 NapCat 拿到新 token，再到 QCE 任务列表点「重试」补齐。'
    );
}
