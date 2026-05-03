/**
 * Issue #128: 回复消息（reply 元素）在 HTML 导出中的渲染辅助。
 *
 * 历史问题：
 *  1. SimpleMessageParser 给 reply 元素写的字段是
 *     `referencedMessageId`，而 ModernHtmlExporter.renderReplyElement
 *     只会读 `data.replyMsgId || data.msgId`，导致点击引用框时
 *     `data-reply-to` 永远是空、`scrollToMessage` 也跳不动。
 *  2. parser 写的时间字段是 `timestamp`（秒级 epoch number），但
 *     `safeToDate` 在 0 / 没值时返回 null，时间标签直接不显示。
 *
 * 这里抽出两个纯函数仅做字段挑选 / 时间格式化，方便单测覆盖各种边界，
 * 也避免再有人在 ModernHtmlExporter 里塞硬编码字段名。
 */

export interface ReplyRenderInput {
    /** SimpleMessageParser 写入的目标消息 id（与 messageMap key 对齐）。 */
    referencedMessageId?: string | null
    /** 历史字段，部分老代码 / 老快照里仍然在用。 */
    replyMsgId?: string | null
    /** 内部查找用的 sourceMsgIdInRecords，不直接是 HTML id，但作为兜底。 */
    msgId?: string | null
    /** parser 写入的时间，可能是秒级 epoch（number）/ ms 级 epoch / ISO string。 */
    timestamp?: number | string | null
    /** ModernHtmlExporter 老路径会读 `data.time`，保留兼容。 */
    time?: number | string | null
}

/**
 * 选择「跳转到原消息」的目标 msgId。优先级：
 *   referencedMessageId > replyMsgId > msgId
 *
 * 任何 falsy / `0` / 空字符串都视为没值；返回 null 表示不应渲染跳转交互。
 */
export function chooseReplyJumpTarget(data: ReplyRenderInput | null | undefined): string | null {
    if (!data) return null
    const candidates: Array<unknown> = [data.referencedMessageId, data.replyMsgId, data.msgId]
    for (const raw of candidates) {
        if (raw == null) continue
        const s = String(raw).trim()
        if (s.length === 0 || s === '0') continue
        return s
    }
    return null
}

/**
 * 把 reply 元素里五花八门的时间字段统一成「MM-DD HH:mm」中文展示串。
 *
 * - 数字：> 1e12 视为毫秒，否则视为秒级 epoch；
 * - 字符串：先 trim，全数字 / 数字开头先按数字走，否则走 Date.parse；
 * - 0 / 空 / 解析失败：返回空字符串。
 *
 * 单独抽出来是为了让单测能跑（DOM 里 `Date#toLocaleString` 受时区影响，
 * 这里固定走 UTC 计算保证 CI 跨平台稳定）。
 */
export function formatReplyTimestamp(value: ReplyRenderInput['timestamp']): string {
    if (value == null) return ''
    let ms: number | null = null

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return ''
        ms = value > 1e12 ? value : value * 1000
    } else if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length === 0) return ''
        if (/^\d+$/.test(trimmed)) {
            const n = Number(trimmed)
            if (!Number.isFinite(n) || n <= 0) return ''
            ms = n > 1e12 ? n : n * 1000
        } else {
            const parsed = Date.parse(trimmed)
            if (Number.isNaN(parsed)) return ''
            ms = parsed
        }
    } else {
        return ''
    }

    if (ms == null || !Number.isFinite(ms) || ms <= 0) return ''
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return ''

    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/**
 * 仅给单测使用：把上面两个步骤合成一个对象，省得测试里反复手写。
 */
export function pickReplyRenderHints(data: ReplyRenderInput | null | undefined): {
    jumpTarget: string | null
    formattedTime: string
} {
    return {
        jumpTarget: chooseReplyJumpTarget(data),
        formattedTime: formatReplyTimestamp(data?.timestamp ?? data?.time ?? null),
    }
}
