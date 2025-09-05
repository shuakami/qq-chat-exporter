import { useState, useCallback } from "react"
import type { Group, Friend, GroupsResponse, FriendsResponse } from "@/types/api"
import { useApi } from "./use-api"

export function useChatData() {
  const [groups, setGroups] = useState<Group[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { apiCall } = useApi()

  const loadGroups = useCallback(async (page = 1, limit = 50) => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiCall<GroupsResponse>(`/api/groups?page=${page}&limit=${limit}`)
      if (response.success && response.data) {
        setGroups(response.data.groups || [])
      }
    } catch (err) {
      const errorMessage = `加载群组失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Groups load error:", err)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  const loadFriends = useCallback(async (page = 1, limit = 50) => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiCall<FriendsResponse>(`/api/friends?page=${page}&limit=${limit}`)
      if (response.success && response.data) {
        setFriends(response.data.friends || [])
      }
    } catch (err) {
      const errorMessage = `加载好友失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Friends load error:", err)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      await Promise.all([loadGroups(), loadFriends()])
    } catch (err) {
      const errorMessage = `加载数据失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [loadGroups, loadFriends])

  return {
    groups,
    friends,
    loading,
    error,
    loadGroups,
    loadFriends,
    loadAll,
  }
}