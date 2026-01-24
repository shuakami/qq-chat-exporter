import { useState, useMemo, useCallback } from "react"
import type { Group, Friend } from "@/types/api"

export type SessionType = 'all' | 'group' | 'friend'
export type SortField = 'name' | 'memberCount' | 'id'
export type SortOrder = 'asc' | 'desc'

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
  raw: Group | Friend
}

export interface UseSessionFilterOptions {
  defaultPageSize?: number
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
  const { defaultPageSize = 50 } = options

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
      raw: g,
    }))

    const friendItems: SessionItem[] = friends.map(f => ({
      id: f.uid,
      type: 'friend' as const,
      name: f.remark || f.nick,
      subName: f.remark && f.nick !== f.remark ? f.nick : undefined,
      avatarUrl: f.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${f.uin}&s=640`,
      isOnline: f.isOnline,
      raw: f,
    }))

    return [...groupItems, ...friendItems]
  }, [groups, friends])

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

    // Sort
    items = [...items].sort((a, b) => {
      let comparison = 0
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name, 'zh-CN')
          break
        case 'memberCount':
          // Groups first (they have memberCount), then friends
          const aCount = a.memberCount ?? -1
          const bCount = b.memberCount ?? -1
          comparison = aCount - bCount
          break
        case 'id':
          comparison = a.id.localeCompare(b.id)
          break
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

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
