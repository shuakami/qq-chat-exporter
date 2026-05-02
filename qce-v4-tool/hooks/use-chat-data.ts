import { useState, useCallback } from "react"
import type { Group, Friend, GroupsResponse, FriendsResponse, RecentContactsResponse } from "@/types/api"
import { useApi } from "./use-api"

/**
 * 将 NTQQ ChatType 数值映射为人类可读的细分类别（Issue #364）。
 * 仅覆盖最近联系人列表里常见的非好友 / 非群聊会话。
 */
function classifySpecialChatType(chatType: number): string {
  switch (chatType) {
    case 99:
    case 100:
    case 101:
    case 102:
    case 103:
    case 111:
    case 117:
    case 119:
      return "temp"
    case 118:
    case 201:
      return "service"
    case 132:
    case 133:
    case 134:
      return "notify"
    case 9:
    case 16:
      return "guild"
    default:
      return "other"
  }
}

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

          const totalCount = response.data.totalCount ?? allGroups.length
          setLoadProgress({ current: allGroups.length, total: totalCount })

          hasMore = response.data.hasNext === true

          if (hasMore) {
            currentPage++
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

          const totalCount = response.data.totalCount ?? allFriends.length
          setLoadProgress({ current: allFriends.length, total: totalCount })

          hasMore = response.data.hasNext === true

          if (hasMore) {
            currentPage++
            setFriends([...allFriends])
          } else {
            break
          }
        } else {
          break
        }
      }

      // Issue #364: 把最近联系人中既不在好友列表也不在群组列表的会话（QQ Bot、
      // 服务号、临时会话等）合并到 friends 数组里。这些会话保留原始 chatType，
      // 上层导出 / 定时任务在选中时会把 chatType 透传给后端，避免被强制归为
      // 普通好友（chatType=1）。失败时静默跳过，不影响普通好友加载。
      try {
        const recentResp = await apiCall<RecentContactsResponse>("/api/recent-contacts?limit=200")
        if (recentResp.success && recentResp.data) {
          const existingUids = new Set(allFriends.map((f) => f.uid))
          const specialFriends: Friend[] = recentResp.data.contacts
            .filter((c) => c.classification === "special" && !existingUids.has(c.peerUid))
            .map((c) => ({
              uid: c.peerUid,
              uin: c.peerUin ? Number(c.peerUin) : 0,
              nick: c.name,
              remark: undefined,
              avatarUrl: c.avatarUrl,
              isOnline: false,
              status: 0,
              categoryId: 0,
              chatType: c.chatType,
              isSpecial: true,
              specialKind: classifySpecialChatType(c.chatType),
            }))

          if (specialFriends.length > 0) {
            allFriends.push(...specialFriends)
            console.log(`[QCE] 合并 ${specialFriends.length} 个特殊会话（Bot / 服务号 / 临时会话）`)
          }
        }
      } catch (recentErr) {
        console.warn("[QCE] 加载最近联系人失败，跳过特殊会话合并:", recentErr)
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