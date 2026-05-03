/**
 * 资源画廊文件名搜索辅助函数。
 *
 * `/api/resources/files` 在文件名上接受可选的 `nameSearch` 子串过滤，配合
 * 现有的类型 / 分页参数一起使用。逻辑独立成模块的好处是 `ApiServer` 和
 * `StandaloneServer` 两边的实现可以共用，且能针对边界情况单独写单测。
 *
 * 行为约定：
 * - 空串 / 仅空白 / `undefined` / `null` 视为「不过滤」，返回的判定函数总是返回 `true`。
 * - 非字符串（数组、对象、数字等异常入参）也视为「不过滤」，避免上游 query 解析翻车时
 *   把整库筛空。
 * - 长度上限 `MAX_NAME_SEARCH_LENGTH = 200`。超过部分截断，防止恶意超长字符串拖慢扫描。
 * - 大小写不敏感：`includes` 比较前两边都 `toLowerCase()`。
 */

/** `nameSearch` 子串最大长度，超过的部分会被截断。 */
export const MAX_NAME_SEARCH_LENGTH = 200;

/**
 * 把上游传进来的 `nameSearch` query 参数标准化成可用的搜索词。
 *
 * 返回 `null` 表示「不过滤」（空 / 空白 / 类型异常 / 截断后仍然为空）。返回的字符串
 * 已经 `trim` + `toLowerCase`，调用方直接拿去做 `includes` 比较即可。
 */
export function normalizeNameSearch(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const truncated = trimmed.slice(0, MAX_NAME_SEARCH_LENGTH);
    const lower = truncated.toLowerCase();
    return lower.length === 0 ? null : lower;
}

/**
 * 构造一个 `(fileName) => boolean` 的判定函数。
 *
 * - `nameSearch` 为 `null` 时永远返回 `true`（不过滤）。
 * - 否则返回 `fileName.toLowerCase().includes(nameSearch)`。
 *
 * 用法示例：
 *
 * ```ts
 * const match = buildNameSearchPredicate(req.query['nameSearch']);
 * for (const entry of entries) {
 *     if (!match(entry.name)) continue;
 *     ...
 * }
 * ```
 */
export function buildNameSearchPredicate(raw: unknown): (fileName: string) => boolean {
    const term = normalizeNameSearch(raw);
    if (term === null) {
        return () => true;
    }
    return (fileName: string) => {
        if (typeof fileName !== 'string' || fileName.length === 0) return false;
        return fileName.toLowerCase().includes(term);
    };
}
