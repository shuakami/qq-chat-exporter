import { useState, useCallback } from 'react'
import { useApi } from './use-api'
import { toast } from '@/components/ui/use-toast'

export interface IpWhitelistData {
  allowedIPs: string[]
  disabled: boolean
  isDocker: boolean
  currentClientIP: string | null
}

export interface SecurityStatus {
  hasConfig: boolean
  tokenExpired: boolean
  requiresAuth: boolean
}

/** 判断当前来源 IP 是否已被白名单规则覆盖（精确匹配即可，CIDR 交给后端）。 */
function isCurrentIpAllowed(data: IpWhitelistData): boolean {
  const ip = data.currentClientIP
  if (!ip) return false
  return data.allowedIPs.some(
    (rule) => rule === ip || rule === '*' || rule === '0.0.0.0' || rule === '0.0.0.0/0',
  )
}

export function useSecurity() {
  const { apiCall } = useApi()
  const [whitelist, setWhitelist] = useState<IpWhitelistData | null>(null)
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [wl, st] = await Promise.all([
        apiCall<IpWhitelistData>('/api/security/ip-whitelist').catch(() => null),
        apiCall<SecurityStatus>('/security-status').catch(() => null),
      ])
      if (wl?.success && wl.data) setWhitelist(wl.data)
      if (st?.success && st.data) setStatus(st.data)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  const refreshWhitelist = useCallback(async () => {
    const wl = await apiCall<IpWhitelistData>('/api/security/ip-whitelist').catch(() => null)
    if (wl?.success && wl.data) setWhitelist(wl.data)
  }, [apiCall])

  const addIp = useCallback(
    async (ip: string): Promise<boolean> => {
      setBusy(true)
      try {
        await apiCall('/api/security/ip-whitelist', {
          method: 'POST',
          body: JSON.stringify({ ip }),
        })
        await refreshWhitelist()
        return true
      } catch (error) {
        toast({
          title: '添加失败',
          description: error instanceof Error ? error.message : 'IP 地址或 CIDR 格式无效',
          variant: 'destructive',
        })
        return false
      } finally {
        setBusy(false)
      }
    },
    [apiCall, refreshWhitelist],
  )

  const removeIp = useCallback(
    async (ip: string): Promise<boolean> => {
      setBusy(true)
      try {
        await apiCall('/api/security/ip-whitelist', {
          method: 'DELETE',
          body: JSON.stringify({ ip }),
        })
        await refreshWhitelist()
        return true
      } catch (error) {
        toast({
          title: '移除失败',
          description: error instanceof Error ? error.message : '无法移除该 IP',
          variant: 'destructive',
        })
        return false
      } finally {
        setBusy(false)
      }
    },
    [apiCall, refreshWhitelist],
  )

  const addCurrentIp = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    try {
      await apiCall('/api/security/ip-whitelist/add-current', { method: 'POST' })
      await refreshWhitelist()
      return true
    } catch (error) {
      toast({
        title: '添加失败',
        description: error instanceof Error ? error.message : '无法获取当前 IP',
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(false)
    }
  }, [apiCall, refreshWhitelist])

  /** 开启 / 关闭白名单校验。开启前若当前 IP 未被覆盖，先加入以避免把自己锁在门外。 */
  const setWhitelistEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setBusy(true)
      try {
        if (enabled && whitelist && !isCurrentIpAllowed(whitelist)) {
          await apiCall('/api/security/ip-whitelist/add-current', { method: 'POST' }).catch(
            () => null,
          )
        }
        await apiCall('/api/security/ip-whitelist/toggle', {
          method: 'PUT',
          body: JSON.stringify({ disabled: !enabled }),
        })
        await refreshWhitelist()
        return true
      } catch (error) {
        toast({
          title: '操作失败',
          description: error instanceof Error ? error.message : '无法更新白名单状态',
          variant: 'destructive',
        })
        return false
      } finally {
        setBusy(false)
      }
    },
    [apiCall, refreshWhitelist, whitelist],
  )

  return {
    whitelist,
    status,
    loading,
    busy,
    load,
    addIp,
    removeIp,
    addCurrentIp,
    setWhitelistEnabled,
  }
}
