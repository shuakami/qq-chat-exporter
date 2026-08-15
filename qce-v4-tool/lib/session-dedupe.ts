import type { Friend, Group } from "@/types/api"

/**
 * 会话去重工具（Issue #649）。
 *
 * 群列表 / 好友列表来自多个来源：分页拉取（可能重复追加同一页）、NapCat 缓存与
 * 实时列表合并、最近联系人补充的特殊会话。任何一处重复都会让会话列表出现两条
 * 完全一样的记录，因此在进入 UI 之前按稳定身份键统一去重，保留首次出现的条目。
 */

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const id = key(item)
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    result.push(item)
  }
  return result
}

/** 按群号去重。 */
export function dedupeGroups(groups: Group[]): Group[] {
  return dedupeBy(groups, (g) => g.groupCode ?? "")
}

/** 按 uid 去重；uid 缺失时退回 uin。 */
export function dedupeFriends(friends: Friend[]): Friend[] {
  return dedupeBy(friends, (f) => f.uid || (f.uin ? String(f.uin) : ""))
}

/** 按「会话类型 + 会话 ID」去重，群与好友即使 ID 相同也互不影响。 */
export function dedupeSessionItems<T extends { id: string; type: "group" | "friend" }>(
  items: T[],
): T[] {
  return dedupeBy(items, (item) => `${item.type}:${item.id}`)
}
