/**
 * Issue #344: 会话列表排序的纯函数实现，单独抽出来方便用 node:test 跑单测
 * （`use-session-filter` 直接依赖 React，不易在 node 测试里加载）。
 */

export type SortField =
  | 'name'
  | 'memberCount'
  | 'id'
  | 'lastActivity'
  | 'exportedCount'

export type SortOrder = 'asc' | 'desc'

export interface SortableSessionItem {
  id: string
  type: 'group' | 'friend'
  name: string
  memberCount?: number
  /**
   * 最近一条消息的时间（ISO 字符串），来自后端 `/api/recent-contacts` 的
   * `lastMsgTime`。没有最近联系人记录时为 `undefined`。
   */
  lastMessageTime?: string
  /**
   * 该会话已经通过任务导出的消息条数累计值。后端 `/api/tasks` 返回的
   * 已完成任务里 `messageCount` 求和。没有历史任务时为 `0`。
   */
  exportedMessageCount?: number
}

/**
 * 把 ISO 时间字符串转为 epoch ms。无法解析或缺失时返回 `null`。
 */
export function parseLastActivity(value: string | undefined | null): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * 比较两个会话条目的纯函数。
 *
 * 排序原则：
 * - `name`：按名称，中文 locale。
 * - `memberCount`：群人数；好友默认为 -1（始终排在最后）。
 * - `id`：peerUid / groupCode 字典序。
 * - `lastActivity`：按 `lastMessageTime` 排，缺失项始终排在最后（不论
 *   asc / desc），避免「按最近活跃倒序」时一堆没有活动数据的会话冒到最前面。
 * - `exportedCount`：按已导出消息数累计。0 / undefined 当作 0 参与排序，但
 *   两端都为 0 时 fallback 到名称排序，让结果稳定。
 *
 * 当主键相等时统一 fallback 到 `name` 比较，保持顺序稳定。
 */
export function compareSessionItems(
  a: SortableSessionItem,
  b: SortableSessionItem,
  field: SortField,
  order: SortOrder,
): number {
  const direction = order === 'asc' ? 1 : -1

  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name, 'zh-CN') * direction

    case 'memberCount': {
      const aCount = a.memberCount ?? -1
      const bCount = b.memberCount ?? -1
      if (aCount === bCount) {
        return a.name.localeCompare(b.name, 'zh-CN')
      }
      return (aCount - bCount) * direction
    }

    case 'id':
      return a.id.localeCompare(b.id) * direction

    case 'lastActivity': {
      const aT = parseLastActivity(a.lastMessageTime)
      const bT = parseLastActivity(b.lastMessageTime)
      // 没有 lastMessageTime 的会话不论升降序都沉到最底，避免空数据顶头。
      if (aT === null && bT === null) {
        return a.name.localeCompare(b.name, 'zh-CN')
      }
      if (aT === null) return 1
      if (bT === null) return -1
      if (aT === bT) {
        return a.name.localeCompare(b.name, 'zh-CN')
      }
      return (aT - bT) * direction
    }

    case 'exportedCount': {
      const aN = a.exportedMessageCount ?? 0
      const bN = b.exportedMessageCount ?? 0
      if (aN === bN) {
        return a.name.localeCompare(b.name, 'zh-CN')
      }
      return (aN - bN) * direction
    }

    default: {
      // exhaustive check：新增字段忘了写 case 时 TS 会报错
      const _exhaustive: never = field
      void _exhaustive
      return 0
    }
  }
}

/**
 * 在指定字段下排序一份会话条目数组（不修改原数组）。
 */
export function sortSessionItems<T extends SortableSessionItem>(
  items: readonly T[],
  field: SortField,
  order: SortOrder,
): T[] {
  return [...items].sort((a, b) => compareSessionItems(a, b, field, order))
}

/**
 * 把 ISO 时间格式化成「相对当前时间」的中文字符串。
 *
 * - 5 分钟内：「刚刚」
 * - 1 小时内：「N 分钟前」
 * - 24 小时内：「N 小时前」
 * - 30 天内：「N 天前」
 * - 12 个月内：「N 个月前」
 * - 否则：「N 年前」
 *
 * 解析失败时返回空字符串，调用方自行决定是否渲染。`now` 参数主要用于
 * 单测可重现。
 */
export function formatRelativeFromNow(
  iso: string | undefined | null,
  now: number = Date.now(),
): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diffMs = now - t
  if (diffMs < 0) return '刚刚'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon} 个月前`
  const yr = Math.floor(day / 365)
  return `${yr} 年前`
}

/**
 * 紧凑数字格式化，避免徽标里出现 "13427 条" 这种长串：
 * - <1000：原样
 * - <10_000：`1.2k`（保留 1 位小数，去掉尾随 0）
 * - <1_000_000：`12k`
 * - 否则：`1.2m`
 */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(Math.floor(value))
  if (value < 10_000) {
    const v = value / 1000
    return `${stripTrailingZero(v.toFixed(1))}k`
  }
  if (value < 1_000_000) {
    return `${Math.floor(value / 1000)}k`
  }
  const v = value / 1_000_000
  return `${stripTrailingZero(v.toFixed(1))}m`
}

function stripTrailingZero(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}
