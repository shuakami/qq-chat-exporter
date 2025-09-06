import { useState, useCallback, useMemo } from "react"
import type { Group, Friend, GroupsResponse, FriendsResponse } from "@/types/api"

const API_BASE = "http://localhost:40653"

interface SearchState<T> {
  allData: T[]          // 所有加载的数据
  filteredResults: T[]  // 搜索过滤后的结果
  loading: boolean
  error: string | null
  hasMore: boolean
  currentPage: number
  totalCount: number
  searchTerm: string
}

export function useSearch() {
  const [groupSearchState, setGroupSearchState] = useState<SearchState<Group>>({
    allData: [],
    filteredResults: [],
    loading: false,
    error: null,
    hasMore: false,
    currentPage: 0,
    totalCount: 0,
    searchTerm: "",
  })

  const [friendSearchState, setFriendSearchState] = useState<SearchState<Friend>>({
    allData: [],
    filteredResults: [],
    loading: false,
    error: null,
    hasMore: false,
    currentPage: 0,
    totalCount: 0,
    searchTerm: "",
  })

  // 前端搜索过滤函数
  const filterGroups = useCallback((groups: Group[], searchTerm: string) => {
    if (!searchTerm.trim()) return groups
    
    const term = searchTerm.toLowerCase()
    return groups.filter(group => 
      group.groupName.toLowerCase().includes(term) ||
      group.groupCode.toLowerCase().includes(term) ||
      (group.remark && group.remark.toLowerCase().includes(term))
    )
  }, [])

  const filterFriends = useCallback((friends: Friend[], searchTerm: string) => {
    if (!searchTerm.trim()) return friends
    
    const term = searchTerm.toLowerCase()
    return friends.filter(friend => 
      friend.nick.toLowerCase().includes(term) ||
      (friend.remark && friend.remark.toLowerCase().includes(term)) ||
      friend.uid.toLowerCase().includes(term)
    )
  }, [])

  // 加载群组数据
  const loadGroups = useCallback(async (page = 1, limit = 999, append = false) => {
    setGroupSearchState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`${API_BASE}/api/groups?page=${page}&limit=${limit}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || '加载群组失败')
      }

      const groupsData = data.data as GroupsResponse
      
      setGroupSearchState(prev => {
        const newAllData = append ? [...prev.allData, ...groupsData.groups] : groupsData.groups
        const newFilteredResults = filterGroups(newAllData, prev.searchTerm)
        
        return {
          ...prev,
          allData: newAllData,
          filteredResults: newFilteredResults,
          loading: false,
          hasMore: groupsData.hasNext,
          currentPage: groupsData.currentPage,
          totalCount: groupsData.totalCount,
        }
      })
    } catch (error) {
      setGroupSearchState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '加载群组失败',
      }))
    }
  }, [filterGroups])

  // 加载好友数据
  const loadFriends = useCallback(async (page = 1, limit = 999, append = false) => {
    setFriendSearchState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`${API_BASE}/api/friends?page=${page}&limit=${limit}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || '加载好友失败')
      }

      const friendsData = data.data as FriendsResponse
      
      setFriendSearchState(prev => {
        const newAllData = append ? [...prev.allData, ...friendsData.friends] : friendsData.friends
        const newFilteredResults = filterFriends(newAllData, prev.searchTerm)
        
        return {
          ...prev,
          allData: newAllData,
          filteredResults: newFilteredResults,
          loading: false,
          hasMore: friendsData.hasNext,
          currentPage: friendsData.currentPage,
          totalCount: friendsData.totalCount,
        }
      })
    } catch (error) {
      setFriendSearchState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '加载好友失败',
      }))
    }
  }, [filterFriends])

  // 搜索群组（前端过滤）
  const searchGroups = useCallback((searchTerm: string) => {
    setGroupSearchState(prev => {
      const filteredResults = filterGroups(prev.allData, searchTerm)
      return {
        ...prev,
        searchTerm,
        filteredResults,
      }
    })
  }, [filterGroups])

  // 搜索好友（前端过滤）
  const searchFriends = useCallback((searchTerm: string) => {
    setFriendSearchState(prev => {
      const filteredResults = filterFriends(prev.allData, searchTerm)
      return {
        ...prev,
        searchTerm,
        filteredResults,
      }
    })
  }, [filterFriends])

  // 加载更多群组
  const loadMoreGroups = useCallback(() => {
    if (groupSearchState.hasMore && !groupSearchState.loading) {
      loadGroups(groupSearchState.currentPage + 1, 20, true)
    }
  }, [groupSearchState.hasMore, groupSearchState.loading, groupSearchState.currentPage, loadGroups])

  // 加载更多好友
  const loadMoreFriends = useCallback(() => {
    if (friendSearchState.hasMore && !friendSearchState.loading) {
      loadFriends(friendSearchState.currentPage + 1, 20, true)
    }
  }, [friendSearchState.hasMore, friendSearchState.loading, friendSearchState.currentPage, loadFriends])

  // 清空群组搜索
  const clearGroupSearch = useCallback(() => {
    setGroupSearchState({
      allData: [],
      filteredResults: [],
      loading: false,
      error: null,
      hasMore: false,
      currentPage: 0,
      totalCount: 0,
      searchTerm: "",
    })
  }, [])

  // 清空好友搜索
  const clearFriendSearch = useCallback(() => {
    setFriendSearchState({
      allData: [],
      filteredResults: [],
      loading: false,
      error: null,
      hasMore: false,
      currentPage: 0,
      totalCount: 0,
      searchTerm: "",
    })
  }, [])

  return {
    // Group search
    groupSearch: {
      results: groupSearchState.filteredResults,
      allData: groupSearchState.allData,
      loading: groupSearchState.loading,
      error: groupSearchState.error,
      hasMore: groupSearchState.hasMore,
      currentPage: groupSearchState.currentPage,
      totalCount: groupSearchState.totalCount,
      searchTerm: groupSearchState.searchTerm,
      load: loadGroups,
      search: searchGroups,
      loadMore: loadMoreGroups,
      clear: clearGroupSearch,
    },
    // Friend search
    friendSearch: {
      results: friendSearchState.filteredResults,
      allData: friendSearchState.allData,
      loading: friendSearchState.loading,
      error: friendSearchState.error,
      hasMore: friendSearchState.hasMore,
      currentPage: friendSearchState.currentPage,
      totalCount: friendSearchState.totalCount,
      searchTerm: friendSearchState.searchTerm,
      load: loadFriends,
      search: searchFriends,
      loadMore: loadMoreFriends,
      clear: clearFriendSearch,
    },
  }
}