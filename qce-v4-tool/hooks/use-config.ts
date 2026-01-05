import { useState, useCallback } from 'react'
import { useApi } from './use-api'
import { toast } from '@/components/ui/use-toast'

export interface ConfigData {
  customOutputDir: string | null
  customScheduledExportDir: string | null
  currentExportsDir: string
  currentScheduledExportsDir: string
}

export function useConfig() {
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(false)
  const { apiCall } = useApi()

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      const response = await apiCall('/api/config')
      
      if (response.success && response.data) {
        setConfig(response.data)
      }
    } catch (error) {
      console.error('加载配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  const updateConfig = useCallback(async (updates: {
    customOutputDir?: string | null
    customScheduledExportDir?: string | null
  }) => {
    try {
      setLoading(true)
      const response = await apiCall('/api/config', {
        method: 'PUT',
        body: JSON.stringify(updates)
      })

      if (response.success && response.data) {
        setConfig(response.data)
        toast({
          title: '成功',
          description: response.data.message || '配置已更新'
        })
        return true
      } else {
        throw new Error(response.error?.message || '更新配置失败')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '更新配置失败'
      toast({
        title: '错误',
        description: errorMsg,
        variant: 'destructive'
      })
      return false
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  return {
    config,
    loading,
    loadConfig,
    updateConfig
  }
}
