"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FolderOpen, Image, Download, RefreshCw, FileText, Loader2, AlertCircle, ChevronRight, ChevronDown, Video } from "lucide-react"
import { useGroupFiles } from "@/hooks/use-group-files"
import type { AlbumInfo, AlbumMediaItem, GroupFolderInfo } from "@/types/api"

interface GroupFilesModalProps {
  isOpen: boolean
  onClose: () => void
  groupCode: string
  groupName: string
  onNotification?: (type: 'success' | 'error' | 'info', title: string, message: string) => void
}

export function GroupFilesModal({ isOpen, onClose, groupCode, groupName, onNotification }: GroupFilesModalProps) {
  const [activeTab, setActiveTab] = useState<'albums' | 'files'>('albums')
  const [selectedAlbums, setSelectedAlbums] = useState<Set<string>>(new Set())
  const [currentFolderId, setCurrentFolderId] = useState<string>('')
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([{ id: '', name: '根目录' }])
  const [exporting, setExporting] = useState(false)
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null)
  const [albumMediaLoading, setAlbumMediaLoading] = useState(false)
  const [currentAlbumMedia, setCurrentAlbumMedia] = useState<AlbumMediaItem[]>([])
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null)
  const [downloadingMediaId, setDownloadingMediaId] = useState<string | null>(null)

  const {
    albums, files, folders, fileCount, loading, error,
    loadAlbums, loadAlbumMedia, exportAlbum, loadFiles, loadFileCount,
    exportFilesMetadata, exportFilesWithDownload, formatFileSize, setError, downloadFile
  } = useGroupFiles()

  useEffect(() => {
    if (isOpen && groupCode) {
      if (activeTab === 'albums') loadAlbums(groupCode)
      else { loadFiles(groupCode, currentFolderId); loadFileCount(groupCode) }
    }
  }, [isOpen, groupCode, activeTab])

  useEffect(() => {
    if (!isOpen) {
      setExpandedAlbumId(null)
      setCurrentAlbumMedia([])
      setSelectedAlbums(new Set())
      setCurrentFolderId('')
      setFolderPath([{ id: '', name: '根目录' }])
    }
  }, [isOpen])

  const handleToggleAlbum = (albumId: string) => {
    const newSet = new Set(selectedAlbums)
    if (newSet.has(albumId)) newSet.delete(albumId)
    else newSet.add(albumId)
    setSelectedAlbums(newSet)
  }

  const handleSelectAllAlbums = () => {
    if (selectedAlbums.size === albums.length) setSelectedAlbums(new Set())
    else setSelectedAlbums(new Set(albums.map(a => a.albumId)))
  }

  const handleExpandAlbum = async (album: AlbumInfo) => {
    if (expandedAlbumId === album.albumId) {
      setExpandedAlbumId(null)
      setCurrentAlbumMedia([])
      return
    }
    setExpandedAlbumId(album.albumId)
    setAlbumMediaLoading(true)
    try {
      const media = await loadAlbumMedia(groupCode, album.albumId)
      setCurrentAlbumMedia(media || [])
    } catch {
      onNotification?.('error', '加载失败', '无法加载相册媒体')
    } finally {
      setAlbumMediaLoading(false)
    }
  }

  const handleExportAlbums = async () => {
    setExporting(true)
    try {
      const albumIds = selectedAlbums.size > 0 ? Array.from(selectedAlbums) : undefined
      const result = await exportAlbum(groupCode, groupName, albumIds)
      if (result?.success) {
        const msg = result.exportPath 
          ? `已导出到 ${result.exportPath}` 
          : `已导出 ${result.albumCount} 个相册，共 ${result.downloadedCount} 个媒体文件`
        onNotification?.('success', '导出成功', msg)
        setSelectedAlbums(new Set())
      } else {
        onNotification?.('error', '导出失败', result?.error || '未知错误')
      }
    } catch (err) {
      onNotification?.('error', '导出失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setExporting(false)
    }
  }

  const handleDownloadSingleMedia = async (media: AlbumMediaItem) => {
    if (!media.url) {
      onNotification?.('error', '下载失败', '媒体URL不可用')
      return
    }
    setDownloadingMediaId(media.id)
    try {
      window.open(media.url, '_blank')
      onNotification?.('success', '开始下载', '媒体文件已开始下载')
    } catch (err) {
      onNotification?.('error', '下载失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setDownloadingMediaId(null)
    }
  }

  const handleEnterFolder = (folder: GroupFolderInfo) => {
    setCurrentFolderId(folder.folderId)
    setFolderPath([...folderPath, { id: folder.folderId, name: folder.folderName }])
    loadFiles(groupCode, folder.folderId)
  }

  const handleNavigateToFolder = (index: number) => {
    const targetFolder = folderPath[index]
    setCurrentFolderId(targetFolder.id)
    setFolderPath(folderPath.slice(0, index + 1))
    loadFiles(groupCode, targetFolder.id)
  }

  const handleExportFilesList = async () => {
    setExporting(true)
    try {
      const result = await exportFilesMetadata(groupCode, groupName)
      if (result?.success) {
        const msg = result.exportPath
          ? `已导出到 ${result.exportPath}`
          : `已导出文件列表，共 ${result.fileCount} 个文件`
        onNotification?.('success', '导出成功', msg)
      } else {
        onNotification?.('error', '导出失败', result?.error || '未知错误')
      }
    } catch (err) {
      onNotification?.('error', '导出失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setExporting(false)
    }
  }

  const handleExportFilesWithDownload = async () => {
    setExporting(true)
    onNotification?.('info', '开始导出', '正在下载群文件，这可能需要较长时间...')
    try {
      const result = await exportFilesWithDownload(groupCode, groupName)
      if (result?.success) {
        const msg = result.exportPath
          ? `已导出到 ${result.exportPath}`
          : `已下载 ${result.downloadedCount}/${result.fileCount} 个文件`
        onNotification?.('success', '导出成功', msg)
      } else {
        onNotification?.('error', '导出失败', result?.error || '未知错误')
      }
    } catch (err) {
      onNotification?.('error', '导出失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setExporting(false)
    }
  }

  const handleDownloadSingleFile = async (file: { fileId: string; fileName: string }) => {
    setDownloadingFileId(file.fileId)
    try {
      const url = await downloadFile(groupCode, file.fileId)
      if (url) {
        onNotification?.('success', '开始下载', `${file.fileName} 已开始下载`)
      } else {
        onNotification?.('error', '下载失败', '无法获取下载链接')
      }
    } catch (err) {
      onNotification?.('error', '下载失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setDownloadingFileId(null)
    }
  }

  const formatTime = (timestamp: number) => !timestamp ? '-' : new Date(timestamp * 1000).toLocaleString('zh-CN')

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent fullScreen className="flex flex-col h-full p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>{groupName} - 群文件与相册</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex min-h-0">
          {/* 左侧导航 */}
          <div className="w-48 border-r p-4 space-y-2">
            <button
              onClick={() => setActiveTab('albums')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'albums' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <div className="font-medium">群相册</div>
              <div className="text-xs text-neutral-500">{albums.length} 个相册</div>
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'files' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <div className="font-medium">群文件</div>
              <div className="text-xs text-neutral-500">{fileCount > 0 ? `${fileCount} 个文件` : '浏览文件'}</div>
            </button>
          </div>

          {/* 右侧内容 */}
          <div className="flex-1 flex flex-col p-4 min-w-0">
            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-950/30 text-red-600 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {activeTab === 'albums' ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={albums.length > 0 && selectedAlbums.size === albums.length}
                      onCheckedChange={handleSelectAllAlbums}
                    />
                    <span className="text-sm text-neutral-500">
                      {selectedAlbums.size > 0 ? `已选 ${selectedAlbums.size} 个` : '全选'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadAlbums(groupCode)} disabled={loading}>
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button size="sm" onClick={handleExportAlbums} disabled={loading || exporting}>
                      {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                      {selectedAlbums.size > 0 ? '导出选中' : '导出全部'}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loading && albums.length === 0 ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
                    </div>
                  ) : albums.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500">暂无相册</div>
                  ) : (
                    albums.map((album) => (
                      <div key={album.albumId} className="border rounded-lg">
                        <div className="flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                          <Checkbox
                            checked={selectedAlbums.has(album.albumId)}
                            onCheckedChange={() => handleToggleAlbum(album.albumId)}
                          />
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => handleExpandAlbum(album)}
                          >
                            <div className="font-medium">{album.albumName}</div>
                          </div>
                          <button onClick={() => handleExpandAlbum(album)} className="p-1">
                            <ChevronDown className={`w-4 h-4 transition-transform ${expandedAlbumId === album.albumId ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                        {expandedAlbumId === album.albumId && (
                          <div className="border-t p-3 bg-neutral-50 dark:bg-neutral-800/30">
                            {albumMediaLoading ? (
                              <div className="flex justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin" />
                              </div>
                            ) : currentAlbumMedia.length === 0 ? (
                              <div className="text-center py-4 text-neutral-500 text-sm">暂无媒体</div>
                            ) : (
                              <div className="grid grid-cols-6 gap-2">
                                {currentAlbumMedia.slice(0, 18).map((media) => (
                                  <div
                                    key={media.id}
                                    className="relative aspect-square rounded overflow-hidden bg-neutral-200 dark:bg-neutral-700 group cursor-pointer"
                                    onClick={() => handleDownloadSingleMedia(media)}
                                  >
                                    {(media.thumbUrl || media.url) ? (
                                      <img src={media.thumbUrl || media.url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        {media.type === 'video' ? <Video className="w-5 h-5 text-neutral-400" /> : <Image className="w-5 h-5 text-neutral-400" />}
                                      </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      {downloadingMediaId === media.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                                      ) : (
                                        <Download className="w-4 h-4 text-white" />
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {currentAlbumMedia.length > 18 && (
                                  <div className="aspect-square rounded bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center text-neutral-500 text-sm">
                                    +{currentAlbumMedia.length - 18}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-1 text-sm">
                    {folderPath.map((folder, index) => (
                      <div key={folder.id} className="flex items-center">
                        {index > 0 && <ChevronRight className="w-4 h-4 text-neutral-400" />}
                        <button
                          onClick={() => handleNavigateToFolder(index)}
                          className="hover:text-blue-600 px-1"
                        >
                          {folder.name}
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => loadFiles(groupCode, currentFolderId)} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1">
                  {loading && files.length === 0 && folders.length === 0 ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
                    </div>
                  ) : files.length === 0 && folders.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500">暂无文件</div>
                  ) : (
                    <>
                      {folders.map((folder) => (
                        <button
                          key={folder.folderId}
                          onClick={() => handleEnterFolder(folder)}
                          className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-800 text-left"
                        >
                          <FolderOpen className="w-5 h-5 text-yellow-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{folder.folderName}</div>
                            <div className="text-xs text-neutral-500">{folder.totalFileCount || 0} 个文件</div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-neutral-400" />
                        </button>
                      ))}
                      {files.map((file) => (
                        <div
                          key={file.fileId}
                          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        >
                          <FileText className="w-5 h-5 text-blue-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{file.fileName}</div>
                            <div className="text-xs text-neutral-500">
                              {formatFileSize(file.fileSize)} · {formatTime(file.uploadTime)}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadSingleFile(file)}
                            disabled={downloadingFileId === file.fileId}
                          >
                            {downloadingFileId === file.fileId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                  <Button variant="outline" onClick={handleExportFilesList} disabled={loading || exporting}>
                    {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
                    导出列表
                  </Button>
                  <Button onClick={handleExportFilesWithDownload} disabled={loading || exporting}>
                    {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                    下载全部
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t flex justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
