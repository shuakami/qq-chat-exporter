"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FolderOpen, Image, Download, RefreshCw, FileText, AlertCircle, ChevronRight, ChevronDown, Video } from "lucide-react"
import { Loader } from "@/components/ui/loader"
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
        onNotification?.(
          'success',
          '导出成功',
          `已导出 ${result.albumCount} 个相册，共 ${result.downloadedCount} 个媒体文件`
        )
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
        onNotification?.('success', '导出成功', `已导出文件列表，共 ${result.fileCount} 个文件`)
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
        onNotification?.(
          'success',
          '导出成功',
          `已下载 ${result.downloadedCount}/${result.fileCount} 个文件`
        )
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
      <DialogContent
        fullScreen
        overlayClassName="bg-background/80 dark:bg-background/80"
        className="inset-4 w-auto h-auto rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-0"
      >
        <div className="px-10 pt-10 pb-6 flex-shrink-0">
          <DialogTitle className="text-[20px] font-semibold text-foreground">{groupName}</DialogTitle>
          <p className="text-[13px] text-muted-foreground mt-1.5">浏览并导出群相册与群文件。</p>
        </div>

        <div className="flex-1 flex min-h-0 px-6">
          {/* 左侧导航 */}
          <div className="w-52 flex-shrink-0 px-4 space-y-1.5">
            <button
              onClick={() => setActiveTab('albums')}
              className={`w-full text-left px-3.5 py-2.5 rounded-2xl transition-colors ${
                activeTab === 'albums' ? 'bg-black/[0.05] dark:bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-medium text-[13px]">群相册</div>
              <div className="text-xs text-muted-foreground mt-0.5">{albums.length} 个相册</div>
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`w-full text-left px-3.5 py-2.5 rounded-2xl transition-colors ${
                activeTab === 'files' ? 'bg-black/[0.05] dark:bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-medium text-[13px]">群文件</div>
              <div className="text-xs text-muted-foreground mt-0.5">{fileCount > 0 ? `${fileCount} 个文件` : '浏览文件'}</div>
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
                    <span className="text-sm text-muted-foreground">
                      {selectedAlbums.size > 0 ? `已选 ${selectedAlbums.size} 个` : '全选'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadAlbums(groupCode)} disabled={loading} className="rounded-full">
                      {loading ? <Loader size={16} /> : <RefreshCw className="w-4 h-4" />}
                    </Button>
                    <Button size="sm" onClick={handleExportAlbums} disabled={loading || exporting} className="rounded-full">
                      {exporting && <Loader size={16} />}
                      {selectedAlbums.size > 0 ? '导出选中' : '导出全部'}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loading && albums.length === 0 ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader size={24} className="text-muted-foreground/60" />
                    </div>
                  ) : albums.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">暂无相册</div>
                  ) : (
                    albums.map((album) => (
                      <div key={album.albumId} className="rounded-lg">
                        <div className="flex items-center gap-3 p-3 hover:bg-muted/50">
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
                          <div className="border-t border-black/[0.06] dark:border-white/[0.06] p-3 bg-muted/30">
                            {albumMediaLoading ? (
                              <div className="flex justify-center py-4">
                                <Loader size={20} />
                              </div>
                            ) : currentAlbumMedia.length === 0 ? (
                              <div className="text-center py-4 text-muted-foreground text-sm">暂无媒体</div>
                            ) : (
                              <div className="grid grid-cols-6 gap-2">
                                {currentAlbumMedia.slice(0, 18).map((media) => (
                                  <div
                                    key={media.id}
                                    className="relative aspect-square rounded overflow-hidden bg-muted group cursor-pointer"
                                    onClick={() => handleDownloadSingleMedia(media)}
                                  >
                                    {(media.thumbUrl || media.url) ? (
                                      <img src={media.thumbUrl || media.url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        {media.type === 'video' ? <Video className="w-5 h-5 text-muted-foreground/60" /> : <Image className="w-5 h-5 text-muted-foreground/60" />}
                                      </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      {downloadingMediaId === media.id ? (
                                        <Loader size={16} className="text-white" />
                                      ) : (
                                        <Download className="w-4 h-4 text-white" />
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {currentAlbumMedia.length > 18 && (
                                  <div className="aspect-square rounded bg-muted flex items-center justify-center text-muted-foreground text-sm">
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
                        {index > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground/60" />}
                        <button
                          onClick={() => handleNavigateToFolder(index)}
                          className="hover:text-blue-600 px-1"
                        >
                          {folder.name}
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => loadFiles(groupCode, currentFolderId)} disabled={loading} className="rounded-full">
                    {loading ? <Loader size={16} /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1">
                  {loading && files.length === 0 && folders.length === 0 ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader size={24} className="text-muted-foreground/60" />
                    </div>
                  ) : files.length === 0 && folders.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">暂无文件</div>
                  ) : (
                    <>
                      {folders.map((folder) => (
                        <button
                          key={folder.folderId}
                          onClick={() => handleEnterFolder(folder)}
                          className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 text-left"
                        >
                          <FolderOpen className="w-5 h-5 text-yellow-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{folder.folderName}</div>
                            <div className="text-xs text-muted-foreground">{folder.totalFileCount || 0} 个文件</div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
                        </button>
                      ))}
                      {files.map((file) => (
                        <div
                          key={file.fileId}
                          className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50"
                        >
                          <FileText className="w-5 h-5 text-blue-500" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{file.fileName}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatFileSize(file.fileSize)} · {formatTime(file.uploadTime)}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadSingleFile(file)}
                            disabled={downloadingFileId === file.fileId}
                            className="rounded-full"
                          >
                            {downloadingFileId === file.fileId ? (
                              <Loader size={16} />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-4 mt-4">
                  <Button variant="outline" onClick={handleExportFilesList} disabled={loading || exporting} className="rounded-full">
                    {exporting && <Loader size={16} />}
                    导出列表
                  </Button>
                  <Button onClick={handleExportFilesWithDownload} disabled={loading || exporting} className="rounded-full">
                    {exporting ? <Loader size={16} className="mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                    下载全部
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="h-[72px] flex items-center justify-end px-10 flex-shrink-0">
          <Button variant="outline" onClick={onClose} className="rounded-full text-[13px] h-8">关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
