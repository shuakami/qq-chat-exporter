import { useState, useCallback } from 'react';

export interface ResourceSummary {
  totalResources: number;
  totalSize: number;
  byType: Record<string, { count: number; size: number }>;
  bySource: Record<string, { count: number; size: number }>;
}

export interface GlobalResources {
  images: { count: number; size: number; path: string };
  videos: { count: number; size: number; path: string };
  audios: { count: number; size: number; path: string };
  files: { count: number; size: number; path: string };
}

export interface ExportResourceInfo {
  fileName: string;
  format: 'html' | 'json' | 'zip' | 'jsonl';
  resourceCount: number;
  resourceSize: number;
  chatType?: string;
  chatId?: string;
  displayName?: string;
}

export interface ResourceIndex {
  summary: ResourceSummary;
  globalResources: GlobalResources;
  exports: ExportResourceInfo[];
}

export interface ExportFileResource {
  type: string;
  fileName: string;
  relativePath: string;
  size: number;
  mimeType?: string;
}

export interface ResourceFile {
  type: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
  modifyTime: string;
}

export interface ResourceFilesResult {
  files: ResourceFile[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useResourceIndex() {
  const [index, setIndex] = useState<ResourceIndex | null>(null);
  const [exportResources, setExportResources] = useState<ExportFileResource[]>([]);
  const [resourceFiles, setResourceFiles] = useState<ResourceFile[]>([]);
  const [resourceFilesTotal, setResourceFilesTotal] = useState(0);
  const [resourceFilesHasMore, setResourceFilesHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResourceIndex = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/resources/index');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error?.message || '获取资源索引失败');
      }

      setIndex(result.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      console.error('[useResourceIndex] 加载资源索引失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadResourceFiles = useCallback(async (
    type: 'all' | 'images' | 'videos' | 'audios' | 'files' = 'all',
    page: number = 1,
    limit: number = 50,
    append: boolean = false
  ) => {
    try {
      setFilesLoading(true);
      setError(null);

      const response = await fetch(`/api/resources/files?type=${type}&page=${page}&limit=${limit}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error?.message || '获取资源文件失败');
      }

      const data = result.data as ResourceFilesResult;
      
      if (append) {
        setResourceFiles(prev => [...prev, ...data.files]);
      } else {
        setResourceFiles(data.files);
      }
      setResourceFilesTotal(data.total);
      setResourceFilesHasMore(data.hasMore);
      
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      console.error('[useResourceIndex] 加载资源文件失败:', err);
      return null;
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const loadExportResources = useCallback(async (fileName: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/resources/export/${encodeURIComponent(fileName)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error?.message || '获取导出资源失败');
      }

      setExportResources(result.data?.resources || []);
      return result.data?.resources || [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      console.error('[useResourceIndex] 加载导出资源失败:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const formatSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
  }, []);

  const getStats = useCallback(() => {
    if (!index) {
      return {
        totalResources: 0,
        totalSize: '0 B',
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
        fileCount: 0,
        exportCount: index?.exports?.length || 0
      };
    }

    return {
      totalResources: index.summary.totalResources,
      totalSize: formatSize(index.summary.totalSize),
      imageCount: index.globalResources.images.count,
      videoCount: index.globalResources.videos.count,
      audioCount: index.globalResources.audios.count,
      fileCount: index.globalResources.files.count,
      exportCount: index.exports.length
    };
  }, [index, formatSize]);

  return {
    index,
    exportResources,
    resourceFiles,
    resourceFilesTotal,
    resourceFilesHasMore,
    loading,
    filesLoading,
    error,
    loadResourceIndex,
    loadResourceFiles,
    loadExportResources,
    formatSize,
    getStats,
    setError,
  };
}
