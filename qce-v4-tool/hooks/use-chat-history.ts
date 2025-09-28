import { useState, useCallback } from 'react';

export interface ExportFile {
  fileName: string;
  filePath: string;
  relativePath: string;
  size: number;
  createTime: string;
  modifyTime: string;
  chatType: 'friend' | 'group';
  chatId: string;
  exportTime: string;
  isScheduled?: boolean;
  sessionName?: string;
  messageCount?: number;
  avatarUrl?: string;
  description?: string;
}

export interface ChatHistoryStats {
  total: number;
  htmlFiles: number;
  jsonFiles: number;
  totalSize: string;
}

export function useChatHistory() {
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChatHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/exports/files');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error?.message || '获取聊天记录失败');
      }

      setFiles(result.data?.files || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      console.error('[useChatHistory] 加载聊天记录失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getStats = useCallback((): ChatHistoryStats => {
    const htmlFiles = files.filter(f => f.fileName.endsWith('.html')).length;
    const jsonFiles = files.filter(f => f.fileName.endsWith('.json')).length;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    
    // 格式化文件大小
    const formatSize = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    };

    return {
      total: files.length,
      htmlFiles,
      jsonFiles,
      totalSize: formatSize(totalBytes),
    };
  }, [files]);

  const deleteFile = useCallback(async (fileName: string): Promise<boolean> => {
    try {
      setError(null);
      
      const response = await fetch(`/api/exports/files/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error?.message || '删除文件失败');
      }

      // 从本地状态中移除文件
      setFiles(prev => prev.filter(f => f.fileName !== fileName));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      console.error('[useChatHistory] 删除文件失败:', err);
      return false;
    }
  }, []);

  const downloadFile = useCallback((file: ExportFile) => {
    // 创建下载链接
    const link = document.createElement('a');
    link.href = file.relativePath;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  return {
    files,
    loading,
    error,
    loadChatHistory,
    getStats,
    deleteFile,
    downloadFile,
    setError,
  };
}