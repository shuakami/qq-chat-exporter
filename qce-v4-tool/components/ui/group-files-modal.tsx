"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FolderOpen,
  File,
  Image,
  Download,
  RefreshCw,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle,
  ChevronRight,
  ArrowLeft
} from "lucide-react"
import { useGroupFiles } from "@/hooks/use-group-files"
import type { AlbumInfo, GroupFolderInfo } from "@/types/api"

interface GroupFilesModalProps {
  isOpen: boolean
  onClose: () => void
  groupCode: string
  groupName: string
  onNotification?: (type: 'success' | 'error' | 'info', title: string, message: string) => void
}

export function GroupFilesModal({
  isOpen,
  onClose,
  groupCode,
  groupName,
  onNotification
}: GroupFilesModalProps) {
  const [activeTab, setActiveTab] = useState<'albums' | 'files'>('albums')
  const [selectedAlbums, setSelectedAlbums] = useState<Set<string>>(new Set())
  const [currentFolderId, setCurrentFolderId] = useState<string>('/')
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([{ id: '/', name: '根目录' }])
  const [exporting, setExporting] = useState(false)

  const {
    albums,
    albumMedia,
    files,
    folders,
    fileCount,
    loading,
    error,
    loadAlbums,
    loadAlbumMedia,
    exportAlbum,
    loadFiles,
    loadFileCount,
    exportFilesMetadata,
    exportFilesWithDownload,
    formatFileSize,
    setError
  } = useGroupFiles()

  useEffect(() => {
    if (isOpen && groupCode) {
      if (activeTab === 'albums') {
        loadAlbums(groupCode)
      } else {
        loadFiles(groupCode, currentFolderId)
        loadFileCount(groupCode)
      }
    }
  }, [isOpen, groupCode, activeTab])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as 'albums' | 'files')
    setError(null)
  }

  const handleToggleAlbum = (albumId: string) => {
    const newSet = new Set(selectedAlbums)
    if (newSet.has(albumId)) {
      newSet.delete(albumId)
    } else {
      newSet.add(albumId)
    }
    setSelectedAlbums(newSet)
  }

  const handleSelectAllAlbums = () => {
    if (selectedAlbums.size === albums.length) {
      setSelectedAlbums(new Set())
    } else {
      setSelectedAlbums(new Set(albums.map(a => a.albumId)))
    }
  }

  const handleExportAlbums = async () => {
    setExporting(true)
    try {
      const albumIds = selectedAlbums.size > 0 ? Array.from(selectedAlbums) : undefined
      const result = await exportAlbum(groupCode, groupName, albumIds)
      
      if (result?.success) {
        onNotification?.('success', '导出成功', 
          `已导出 ${result.albumCount} 个相册，共 ${result.downloadedCount} 个媒体文件`)
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
        onNotification?.('success', '导出成功', 
          `已导出文件列表，共 ${result.fileCount} 个文件，${result.folderCount} 个文件夹`)
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
        onNotification?.('success', '导出成功', 
          `已下载 ${result.downloadedCount}/${result.fileCount} 个文件，总大小 ${formatFileSize(result.totalSize)}`)
      } else {
        onNotification?.('error', '导出失败', result?.error || '未知错误')
      }
    } catch (err) {
      onNotification?.('error', '导出失败', err instanceof Error ? err.message : '未知错误')
    } finally {
      setExporting(false)
    }
  }

  const formatTime = (timestamp: number) => {
    if (!timestamp) return '-'
    return new Date(timestamp * 1000).toLocaleString('zh-CN')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {groupName} - 群文件与相册
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="albums" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              群相册
            </TabsTrigger>
            <TabsTrigger value="files" className="flex items-center gap-2">
              <File className="h-4 w-4" />
              群文件
              {fileCount > 0 && (
                <Badge variant="secondary" className="ml-1">{fileCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="albums" className="mt-4">
            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={albums.length > 0 && selectedAlbums.size === albums.length}
                  onCheckedChange={handleSelectAllAlbums}
                />
                <span className="text-sm text-muted-foreground">
                  {selectedAlbums.size > 0 ? `已选择 ${selectedAlbums.size} 个相册` : '全选'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadAlbums(groupCode)}
                  disabled={loading}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
                <Button
                  size="sm"
                  onClick={handleExportAlbums}
                  disabled={loading || exporting}
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  {selectedAlbums.size > 0 ? '导出选中' : '导出全部'}
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[400px]">
              {loading && albums.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : albums.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Image className="h-8 w-8 mb-2" />
                  <span>暂无相册</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {albums.map((album) => (
                    <div
                      key={album.albumId}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedAlbums.has(album.albumId)}
                        onCheckedChange={() => handleToggleAlbum(album.albumId)}
                      />
                      <Image className="h-10 w-10 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{album.albumName}</div>
                        <div className="text-sm text-muted-foreground">
                          {album.photoCount || 0} 张照片
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="files" className="mt-4">
            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1 text-sm">
                {folderPath.map((folder, index) => (
                  <div key={folder.id} className="flex items-center">
                    {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <button
                      onClick={() => handleNavigateToFolder(index)}
                      className="hover:text-primary hover:underline"
                    >
                      {folder.name}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadFiles(groupCode, currentFolderId)}
                  disabled={loading}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[350px]">
              {loading && files.length === 0 && folders.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : files.length === 0 && folders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <FolderOpen className="h-8 w-8 mb-2" />
                  <span>暂无文件</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {folders.map((folder) => (
                    <button
                      key={folder.folderId}
                      onClick={() => handleEnterFolder(folder)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors text-left"
                    >
                      <FolderOpen className="h-8 w-8 text-yellow-500" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{folder.folderName}</div>
                        <div className="text-sm text-muted-foreground">
                          {folder.totalFileCount || 0} 个文件
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                  {files.map((file) => (
                    <div
                      key={file.fileId}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <FileText className="h-8 w-8 text-blue-500" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{file.fileName}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatFileSize(file.fileSize)} · {formatTime(file.uploadTime)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleExportFilesList}
                disabled={loading || exporting}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-1" />
                )}
                导出文件列表
              </Button>
              <Button
                onClick={handleExportFilesWithDownload}
                disabled={loading || exporting}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                下载全部文件
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
