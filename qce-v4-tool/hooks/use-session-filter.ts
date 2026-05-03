import { useState, useMemo, useCallback, useEffect } from "react"
import type { Group, Friend } from "@/types/api"
import { compareSessionItems, type SortField, type SortOrder } from "@/lib/session-sort"

export type SessionType = 'all' | 'group' | 'friend'
export type { SortField, SortOrder }

export interface SessionFilterState {
  search: string
  type: SessionType
  sortField: SortField
  sortOrder: SortOrder
  page: number
  pageSize: number
}

export interface SessionItem {
  id: string
  type: 'group' | 'friend'
  name: string
  subName?: string
  avatarUrl: string
  memberCount?: number
  isOnline?: boolean
  /**
   * Issue #344: 会话最近一条消息的时间（ISO）。由 `useSessionFilter`
   * 调用方从 `/api/recent-contacts` 结果里查出来传进来，没有记录时 `undefined`。
   */
  lastMessageTime?: string
  /**
   * Issue #344: 该会话在本地任务里已经导出过的消息总数（`/api/tasks`
   * 里 completed task 的 `messageCount` 求和）。未导出过时 `0`。
   */
  exportedMessageCount?: number
  raw: Group | Friend
}

export interface UseSessionFilterOptions {
  defaultPageSize?: number
  /**
   * Issue #344: peerUid → 最近一条消息 ISO 时间。key 针对
   * `friend.uid` 和 `group.groupCode` 两种。
   */
  recentActivityMap?: Record<string, string | undefined>
  /**
   * Issue #344: peerUid → 已导出消息总数。
   */
  taskCountMap?: Record<string, number | undefined>
}

export interface UseSessionFilterReturn {
  // State
  search: string
  type: SessionType
  sortField: SortField
  sortOrder: SortOrder
  page: number
  pageSize: number

  // Actions
  setSearch: (search: string) => void
  setType: (type: SessionType) => void
  setSortField: (field: SortField) => void
  setSortOrder: (order: SortOrder) => void
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  resetFilters: () => void

  // Computed
  filteredItems: SessionItem[]
  paginatedItems: SessionItem[]
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean

  // Stats
  groupCount: number
  friendCount: number
}

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

export function useSessionFilter(
  groups: Group[],
  friends: Friend[],
  options: UseSessionFilterOptions = {}
): UseSessionFilterReturn {
  const {
    defaultPageSize = 50,
    recentActivityMap,
    taskCountMap,
  } = options

  // Filter state
  const [search, setSearch] = useState("")
  const [type, setType] = useState<SessionType>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  // Convert groups and friends to unified SessionItem format
  const allItems = useMemo<SessionItem[]>(() => {
    const groupItems: SessionItem[] = groups.map(g => ({
      id: g.groupCode,
      type: 'group' as const,
      name: g.groupName,
      subName: g.remark,
      avatarUrl: g.avatarUrl || `https://p.qlogo.cn/gh/${g.groupCode}/${g.groupCode}/640/`,
      memberCount: g.memberCount,
      lastMessageTime: recentActivityMap?.[g.groupCode],
      exportedMessageCount: taskCountMap?.[g.groupCode] ?? 0,
      raw: g,
    }))

    const friendItems: SessionItem[] = friends.map(f => ({
      id: f.uid,
      type: 'friend' as const,
      name: f.remark || f.nick,
      subName: f.remark && f.nick !== f.remark ? f.nick : undefined,
      avatarUrl: f.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${f.uin}&s=640`,
      isOnline: f.isOnline,
      lastMessageTime: recentActivityMap?.[f.uid],
      exportedMessageCount: taskCountMap?.[f.uid] ?? 0,
      raw: f,
    }))

    return [...groupItems, ...friendItems]
  }, [groups, friends, recentActivityMap, taskCountMap])

  // Filtered items (search + type filter)
  const filteredItems = useMemo<SessionItem[]>(() => {
    let items = allItems

    // Type filter
    if (type !== 'all') {
      items = items.filter(item => item.type === type)
    }

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim()
      items = items.filter(item => {
        // Search in name
        if (item.name.toLowerCase().includes(searchLower)) return true
        // Search in subName
        if (item.subName?.toLowerCase().includes(searchLower)) return true
        // Search in ID
        if (item.id.toLowerCase().includes(searchLower)) return true
        // Search in QQ number for friends
        if (item.type === 'friend') {
          const friend = item.raw as Friend
          if (friend.uin?.toString().includes(searchLower)) return true
        }
        // Search in group code
        if (item.type === 'group') {
          const group = item.raw as Group
          if (group.groupCode.includes(searchLower)) return true
        }
        return false
      })
    }

    // Sort。纯函数抽到 `lib/session-sort` 里，方便后端 node:test 复用。
    items = [...items].sort((a, b) =>
      compareSessionItems(a, b, sortField, sortOrder),
    )

    return items
  }, [allItems, search, type, sortField, sortOrder])

  // Paginated items
  const paginatedItems = useMemo<SessionItem[]>(() => {
    const start = (page - 1) * pageSize
    const end = start + pageSize
    return filteredItems.slice(start, end)
  }, [filteredItems, page, pageSize])

  // Computed values
  const totalItems = filteredItems.length
  const totalPages = Math.ceil(totalItems / pageSize) || 1
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  // Clamp page to totalPages when filteredItems length changes
  // This handles the case where the data set shrinks (e.g. after a refresh)
  // while the user is on a high page number.
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [totalPages, page])

  // Stats
  const groupCount = groups.length
  const friendCount = friends.length

  // Reset page when filters change
  const handleSetSearch = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleSetType = useCallback((value: SessionType) => {
    setType(value)
    setPage(1)
  }, [])

  const handleSetSortField = useCallback((value: SortField) => {
    setSortField(value)
    setPage(1)
  }, [])

  const handleSetSortOrder = useCallback((value: SortOrder) => {
    setSortOrder(value)
    setPage(1)
  }, [])

  const handleSetPageSize = useCallback((value: number) => {
    setPageSize(value)
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setSearch("")
    setType('all')
    setSortField('name')
    setSortOrder('asc')
    setPage(1)
    setPageSize(defaultPageSize)
  }, [defaultPageSize])

  return {
    // State
    search,
    type,
    sortField,
    sortOrder,
    page,
    pageSize,

    // Actions
    setSearch: handleSetSearch,
    setType: handleSetType,
    setSortField: handleSetSortField,
    setSortOrder: handleSetSortOrder,
    setPage,
    setPageSize: handleSetPageSize,
    resetFilters,

    // Computed
    filteredItems,
    paginatedItems,
    totalItems,
    totalPages,
    hasNextPage,
    hasPrevPage,

    // Stats
    groupCount,
    friendCount,
  }
}

export { PAGE_SIZE_OPTIONS }
