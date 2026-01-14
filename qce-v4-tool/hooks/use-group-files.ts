import { useState, useCallback } from 'react'
import { useApi } from './use-api'
import type {
  AlbumInfo,
  AlbumMediaItem,
  AlbumExportResult,
  AlbumExportRecord,
  GroupFileInfo,
  GroupFolderInfo,
  FileExportResult,
  FileExportRecord
} from '@/types/api'

export function useGroupFiles() {
  const api = useApi()
  
  // 群相册状态
  const [albums, setAlbums] = useState<AlbumInfo[]>([])
  const [albumMedia, setAlbumMedia] = useState<AlbumMediaItem[]>([])
  const [albumExportRecords, setAlbumExportRecords] = useState<AlbumExportRecord[]>([])
  
  // 群文件状态
  const [files, setFiles] = useState<GroupFileInfo[]>([])
  const [folders, setFolders] = useState<GroupFolderInfo[]>([])
  const [fileExportRecords, setFileExportRecords] = useState<FileExportRecord[]>([])
  const [fileCount, setFileCount] = useState<number>(0)
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取群相册列表
  const loadAlbums = useCallback(async (groupCode: string) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<{
        albums: AlbumInfo[]
        totalCount: number
      }>(`/api/groups/${groupCode}/albums`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setAlbums(response.data.albums || [])
        return response.data.albums
      } else {
        throw new Error(response.error?.message || '获取相册列表失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取相册列表失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 获取相册列表失败:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取相册媒体列表
  const loadAlbumMedia = useCallback(async (groupCode: string, albumId: string) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<{
        media: AlbumMediaItem[]
        totalCount: number
      }>(`/api/groups/${groupCode}/albums/${albumId}/media`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setAlbumMedia(response.data.media || [])
        return response.data.media
      } else {
        throw new Error(response.error?.message || '获取相册媒体失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取相册媒体失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 获取相册媒体失败:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [api])

  // 导出群相册
  const exportAlbum = useCallback(async (
    groupCode: string,
    groupName: string,
    albumIds?: string[]
  ): Promise<AlbumExportResult | null> => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<AlbumExportResult>(
        `/api/groups/${groupCode}/albums/export`,
        {
          method: 'POST',
          body: JSON.stringify({ groupName, albumIds })
        }
      )
      
      if (response.success && response.data) {
        return response.data
      } else {
        throw new Error(response.error?.message || '导出相册失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出相册失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 导出相册失败:', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取群相册导出记录
  const loadAlbumExportRecords = useCallback(async (limit: number = 50) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<{
        records: AlbumExportRecord[]
        totalCount: number
      }>(`/api/group-albums/export-records?limit=${limit}`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setAlbumExportRecords(response.data.records || [])
        return response.data.records
      } else {
        throw new Error(response.error?.message || '获取导出记录失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取导出记录失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 获取相册导出记录失败:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取群文件列表
  const loadFiles = useCallback(async (
    groupCode: string,
    folderId: string = '/',
    startIndex: number = 0,
    count: number = 100
  ) => {
    setLoading(true)
    setError(null)
    
    try {
      const params = new URLSearchParams({
        folderId,
        startIndex: startIndex.toString(),
        fileCount: count.toString()
      })
      
      const response = await api.apiCall<{
        files: GroupFileInfo[]
        folders: GroupFolderInfo[]
        fileCount: number
        folderCount: number
      }>(`/api/groups/${groupCode}/files?${params}`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setFiles(response.data.files || [])
        setFolders(response.data.folders || [])
        return response.data
      } else {
        throw new Error(response.error?.message || '获取文件列表失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取文件列表失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 获取文件列表失败:', err)
      return { files: [], folders: [], fileCount: 0, folderCount: 0 }
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取群文件数量
  const loadFileCount = useCallback(async (groupCode: string) => {
    try {
      const response = await api.apiCall<{ count: number }>(
        `/api/groups/${groupCode}/files/count`,
        { method: 'GET' }
      )
      
      if (response.success && response.data) {
        setFileCount(response.data.count)
        return response.data.count
      }
      return 0
    } catch (err) {
      console.error('[useGroupFiles] 获取文件数量失败:', err)
      return 0
    }
  }, [api])

  // 导出群文件列表（仅元数据）
  const exportFilesMetadata = useCallback(async (
    groupCode: string,
    groupName: string
  ): Promise<FileExportResult | null> => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<FileExportResult>(
        `/api/groups/${groupCode}/files/export`,
        {
          method: 'POST',
          body: JSON.stringify({ groupName })
        }
      )
      
      if (response.success && response.data) {
        return response.data
      } else {
        throw new Error(response.error?.message || '导出文件列表失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出文件列表失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 导出文件列表失败:', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [api])

  // 导出群文件（含下载）
  const exportFilesWithDownload = useCallback(async (
    groupCode: string,
    groupName: string
  ): Promise<FileExportResult | null> => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<FileExportResult>(
        `/api/groups/${groupCode}/files/export-with-download`,
        {
          method: 'POST',
          body: JSON.stringify({ groupName })
        }
      )
      
      if (response.success && response.data) {
        return response.data
      } else {
        throw new Error(response.error?.message || '导出文件失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出文件失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 导出文件失败:', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [api])

  // 获取群文件导出记录
  const loadFileExportRecords = useCallback(async (limit: number = 50) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await api.apiCall<{
        records: FileExportRecord[]
        totalCount: number
      }>(`/api/group-files/export-records?limit=${limit}`, {
        method: 'GET'
      })
      
      if (response.success && response.data) {
        setFileExportRecords(response.data.records || [])
        return response.data.records
      } else {
        throw new Error(response.error?.message || '获取导出记录失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取导出记录失败'
      setError(errorMessage)
      console.error('[useGroupFiles] 获取文件导出记录失败:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [api])

  const downloadFile = useCallback(async (groupCode: string, fileId: string): Promise<string | null> => {
    try {
      const response = await api.apiCall<{ downloadUrl: string }>(
        `/api/groups/${groupCode}/files/download`,
        { 
          method: 'POST',
          body: JSON.stringify({ fileId })
        }
      )
      
      if (response.success && response.data?.downloadUrl) {
        window.open(response.data.downloadUrl, '_blank')
        return response.data.downloadUrl
      }
      return null
    } catch (err) {
      console.error('[useGroupFiles] 下载文件失败:', err)
      return null
    }
  }, [api])

  // 格式化文件大小
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }, [])

  return {
    // 群相册
    albums,
    albumMedia,
    albumExportRecords,
    loadAlbums,
    loadAlbumMedia,
    exportAlbum,
    loadAlbumExportRecords,
    
    // 群文件
    files,
    folders,
    fileCount,
    fileExportRecords,
    loadFiles,
    loadFileCount,
    exportFilesMetadata,
    exportFilesWithDownload,
    loadFileExportRecords,
    downloadFile,
    
    // 通用
    loading,
    error,
    setError,
    formatFileSize
  }
}
