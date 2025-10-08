import { useState, useCallback } from 'react'
import { useApi } from './use-api'

export interface StickerInfo {
  stickerId: string
  name: string
  path: string
  downloaded: boolean
  md5?: string
  fileSize?: number
}

export interface StickerPackInfo {
  packId: string
  packName: string
  packType: 'favorite_emoji' | 'market_pack' | 'system_pack'
  description?: string
  stickerCount: number
  stickers: StickerInfo[]
  rawData?: any
}

export interface StickerPackStats {
  favorite_emoji: number
  market_pack: number
  system_pack: number
}

export interface ExportResult {
  success: boolean
  packCount: number
  stickerCount: number
  exportPath: string
  exportId?: string
  error?: string
}

export interface ExportRecord {
  id: string
  type: 'single' | 'all'
  packId?: string
  packName?: string
  packCount: number
  stickerCount: number
  exportPath: string
  exportTime: string
  success: boolean
  error?: string
}

export function useStickerPacks() {
  const api = useApi()
  const [packs, setPacks] = useState<StickerPackInfo[]>([])
  const [stats, setStats] = useState<StickerPackStats>({
    favorite_emoji: 0,
    market_pack: 0,
    system_pack: 0
  })
  const [exportRecords, setExportRecords] = useState<ExportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 加载表情包列表
  const loadStickerPacks = useCallback(async (types?: string[]) => {
    setLoading(true)
    setError(null)
    
    try {
      const params = types ? `?types=${types.join(',')}` : ''
      const response = await api.apiCall<{
        packs: StickerPackInfo[]
        stats: StickerPackStats
        totalCount: number
        totalStickers: number
      }>(`/api/sticker-packs${params}`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setPacks(response.data.packs || [])
        setStats(response.data.stats || { favorite_emoji: 0, market_pack: 0, system_pack: 0 })
      } else {
        throw new Error(response.error?.message || '加载表情包列表失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载表情包列表失败'
      setError(errorMessage)
      console.error('[useStickerPacks] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [api])

  // 导出指定表情包
  const exportStickerPack = useCallback(async (packId: string): Promise<ExportResult | null> => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<ExportResult>('/api/sticker-packs/export', {
        method: 'POST',
        body: JSON.stringify({ packId })
      })
      
      if (response.success && response.data) {
        return response.data as ExportResult
      } else {
        throw new Error(response.error?.message || '导出表情包失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出表情包失败'
      setError(errorMessage)
      console.error('[useStickerPacks] 导出失败:', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [api])

  // 导出所有表情包
  const exportAllStickerPacks = useCallback(async (): Promise<ExportResult | null> => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<ExportResult>('/api/sticker-packs/export-all', {
        method: 'POST',
        body: JSON.stringify({})
      })
      
      if (response.success && response.data) {
        return response.data as ExportResult
      } else {
        throw new Error(response.error?.message || '导出所有表情包失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出所有表情包失败'
      setError(errorMessage)
      console.error('[useStickerPacks] 导出所有失败:', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [api])

  // 加载导出记录
  const loadExportRecords = useCallback(async (limit: number = 50) => {
    setLoading(true)
    setError(null)

    try {
      const response = await api.apiCall<{
        records: ExportRecord[]
        totalCount: number
      }>(`/api/sticker-packs/export-records?limit=${limit}`, {
        method: 'GET'
      })

      if (response.success && response.data) {
        setExportRecords(response.data.records || [])
      } else {
        throw new Error(response.error?.message || '加载导出记录失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载导出记录失败'
      setError(errorMessage)
      console.error('[useStickerPacks] 加载导出记录失败:', err)
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取统计信息
  const getStats = useCallback(() => {
    return {
      total: packs.length,
      totalStickers: packs.reduce((sum, pack) => sum + pack.stickerCount, 0),
      ...stats
    }
  }, [packs, stats])

  return {
    packs,
    stats,
    exportRecords,
    loading,
    error,
    loadStickerPacks,
    loadExportRecords,
    exportStickerPack,
    exportAllStickerPacks,
    getStats,
    setError
  }
}

