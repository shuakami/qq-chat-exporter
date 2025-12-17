import { useState, useCallback } from "react"
import type { Group, Friend, GroupsResponse, FriendsResponse } from "@/types/api"
import { useApi } from "./use-api"

export interface AvatarExportResult {
  success: boolean
  groupCode: string
  groupName: string
  totalMembers: number
  successCount: number
  failCount: number
  fileName: string
  filePath: string
  fileSize: number
  downloadUrl: string
}

export function useChatData() {
  const [groups, setGroups] = useState<Group[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState<{ current: number; total: number } | null>(null)
  const [avatarExportLoading, setAvatarExportLoading] = useState<string | null>(null)
  const { apiCall } = useApi()

  // 自动分页加载所有群组
  const loadGroups = useCallback(async (page = 1, limit = 1000) => {
    try {
      setLoading(true)
      setError(null)

      const allGroups: Group[] = []
      let currentPage = page
      let hasMore = true

      while (hasMore) {
        const response = await apiCall<GroupsResponse>(`/api/groups?page=${currentPage}&limit=${limit}`)

        if (response.success && response.data) {
          const pageGroups = response.data.groups || []
          allGroups.push(...pageGroups)

          // 更新进度
          setLoadProgress({ current: allGroups.length, total: response.data.total || allGroups.length })

          // 判断是否还有更多
          hasMore = pageGroups.length === limit && allGroups.length < (response.data.total || 0)

          if (hasMore) {
            currentPage++
            // 实时更新UI
            setGroups([...allGroups])
          } else {
            break
          }
        } else {
          break
        }
      }

      setGroups(allGroups)
      setLoadProgress(null)
      console.log(`[QCE] 已加载 ${allGroups.length} 个群组`)

    } catch (err) {
      const errorMessage = `加载群组失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Groups load error:", err)
      setLoadProgress(null)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  // 自动分页加载所有好友
  const loadFriends = useCallback(async (page = 1, limit = 1000) => {
    try {
      setLoading(true)
      setError(null)

      const allFriends: Friend[] = []
      let currentPage = page
      let hasMore = true

      while (hasMore) {
        const response = await apiCall<FriendsResponse>(`/api/friends?page=${currentPage}&limit=${limit}`)

        if (response.success && response.data) {
          const pageFriends = response.data.friends || []
          allFriends.push(...pageFriends)

          // 更新进度
          setLoadProgress({ current: allFriends.length, total: response.data.total || allFriends.length })

          // 判断是否还有更多
          hasMore = pageFriends.length === limit && allFriends.length < (response.data.total || 0)

          if (hasMore) {
            currentPage++
            // 实时更新UI
            setFriends([...allFriends])
          } else {
            break
          }
        } else {
          break
        }
      }

      setFriends(allFriends)
      setLoadProgress(null)
      console.log(`[QCE] 已加载 ${allFriends.length} 个好友`)

    } catch (err) {
      const errorMessage = `加载好友失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Friends load error:", err)
      setLoadProgress(null)
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

  // 导出群成员头像
  const exportGroupAvatars = useCallback(async (groupCode: string): Promise<AvatarExportResult | null> => {
    try {
      setAvatarExportLoading(groupCode)
      setError(null)

      const response = await apiCall<AvatarExportResult>(`/api/groups/${groupCode}/avatars/export`, {
        method: 'POST'
      })

      if (response.success && response.data) {
        console.log(`[QCE] 群头像导出成功: ${response.data.fileName}`)
        return response.data
      } else {
        throw new Error(response.error?.message || '导出失败')
      }
    } catch (err) {
      const errorMessage = `导出群头像失败: ${err instanceof Error ? err.message : "未知错误"}`
      setError(errorMessage)
      console.error("[QCE] Avatar export error:", err)
      return null
    } finally {
      setAvatarExportLoading(null)
    }
  }, [apiCall])

  return {
    groups,
    friends,
    loading,
    error,
    loadProgress,
    loadGroups,
    loadFriends,
    loadAll,
    exportGroupAvatars,
    avatarExportLoading,
  }
}