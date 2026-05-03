/**
 * 发件人过滤器：根据 includeUserUins / excludeUserUins 决定一条消息的发送者
 * UIN 是否应该被保留。
 *
 * 规则：
 *   1. include 集合非空时，只保留 senderUin 在 include 集合里的消息；
 *   2. exclude 集合非空时，丢弃 senderUin 在 exclude 集合里的消息（exclude 优先）；
 *   3. include 与 exclude 同时为空（或都未提供）时返回 null，让调用方走零成本快路径。
 *
 * 抽出来后 #369 的「只导出指定 QQ」需求和原有「排除某些 QQ」可以共用同一份判断
 * 逻辑，不会再出现一个入口能 include、另一个入口只能 exclude 的不一致情况。
 */
export type SenderFilter = (senderUin: string | number | null | undefined) => boolean;

/**
 * 把字符串数组规范成一个去掉首尾空白、去掉空串的字符串集合。
 * 入参允许 undefined / null，返回的集合可能为空。
 */
function normalizeUinList(list: string[] | undefined | null): Set<string> {
    if (!list || list.length === 0) return new Set();
    const out = new Set<string>();
    for (const item of list) {
        if (item === undefined || item === null) continue;
        const trimmed = String(item).trim();
        if (!trimmed) continue;
        out.add(trimmed);
    }
    return out;
}

/**
 * 构造一个发件人过滤器。
 *
 * - 当 include 与 exclude 都为空时返回 `null`，调用方应跳过过滤步骤；
 * - 否则返回一个 `(senderUin) => boolean` 函数，true 表示保留。
 *
 * senderUin 在不同代码路径里可能是 string / number / null / undefined，统一在这里转字符串比较。
 */
export function buildSenderFilter(
    includeUserUins?: string[] | null,
    excludeUserUins?: string[] | null
): SenderFilter | null {
    const include = normalizeUinList(includeUserUins);
    const exclude = normalizeUinList(excludeUserUins);
    if (include.size === 0 && exclude.size === 0) return null;

    return (senderUin) => {
        const uin = senderUin === undefined || senderUin === null ? '' : String(senderUin);
        if (exclude.size > 0 && exclude.has(uin)) return false;
        if (include.size > 0 && !include.has(uin)) return false;
        return true;
    };
}
