/**
 * 流式搜索Hook
 * 使用WebSocket实现实时搜索结果推送
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface SearchProgress {
  searchId: string;
  status: 'searching' | 'completed' | 'cancelled' | 'error';
  processedCount: number;
  matchedCount: number;
  results: any[];
  error?: string;
}

export interface UseStreamSearchOptions {
  onProgress?: (progress: SearchProgress) => void;
  onComplete?: (results: any[]) => void;
  onError?: (error: string) => void;
}

export function useStreamSearch(options: UseStreamSearchOptions = {}) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [allResults, setAllResults] = useState<any[]>([]);
  
  const currentSearchId = useRef<string | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  
  // 连接WebSocket
  const connect = useCallback(() => {
    if (ws?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('[StreamSearch] 连接WebSocket:', wsUrl);
    
    const socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      console.log('[StreamSearch] WebSocket已连接');
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error('[StreamSearch] 消息解析失败:', error);
      }
    };
    
    socket.onclose = () => {
      console.log('[StreamSearch] WebSocket已断开');
      setConnected(false);
      setWs(null);
      
      // 自动重连（5秒后）
      reconnectTimer.current = setTimeout(() => {
        console.log('[StreamSearch] 尝试重连...');
        connect();
      }, 5000);
    };
    
    socket.onerror = (error) => {
      console.error('[StreamSearch] WebSocket错误:', error);
    };
    
    setWs(socket);
  }, [ws]);
  
  // 处理WebSocket消息
  const handleMessage = useCallback((message: any) => {
    const { type, data } = message;
    
    switch (type) {
      case 'connected':
        console.log('[StreamSearch] 连接确认:', data.message);
        break;
        
      case 'search_progress':
        handleSearchProgress(data);
        break;
        
      case 'search_error':
        console.error('[StreamSearch] 搜索错误:', data.message);
        setSearching(false);
        options.onError?.(data.message);
        break;
        
      default:
        console.log('[StreamSearch] 未知消息类型:', type);
    }
  }, [options]);
  
  // 处理搜索进度
  const handleSearchProgress = useCallback((progressData: SearchProgress) => {
    console.log('[StreamSearch] 搜索进度:', {
      status: progressData.status,
      processed: progressData.processedCount,
      matched: progressData.matchedCount,
      newResults: progressData.results.length
    });
    
    setProgress(progressData);
    options.onProgress?.(progressData);
    
    // 增量累加结果
    if (progressData.results.length > 0) {
      setAllResults(prev => [...prev, ...progressData.results]);
    }
    
    // 搜索完成
    if (progressData.status === 'completed') {
      setSearching(false);
      currentSearchId.current = null;
      options.onComplete?.(allResults);
    }
    
    // 搜索取消或错误
    if (progressData.status === 'cancelled' || progressData.status === 'error') {
      setSearching(false);
      currentSearchId.current = null;
      if (progressData.error) {
        options.onError?.(progressData.error);
      }
    }
  }, [allResults, options]);
  
  // 启动搜索
  const startSearch = useCallback((params: {
    peer: any;
    filter?: any;
    searchQuery: string;
  }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[StreamSearch] WebSocket未连接');
      options.onError?.('WebSocket未连接，请稍后重试');
      return null;
    }
    
    if (searching) {
      console.warn('[StreamSearch] 已有搜索在进行中');
      return currentSearchId.current;
    }
    
    // 生成搜索ID
    const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    currentSearchId.current = searchId;
    
    // 清空之前的结果
    setAllResults([]);
    setProgress(null);
    setSearching(true);
    
    // 发送搜索请求
    ws.send(JSON.stringify({
      type: 'start_stream_search',
      data: {
        searchId,
        ...params
      }
    }));
    
    console.log('[StreamSearch] 已发送搜索请求:', searchId);
    
    return searchId;
  }, [ws, searching, options]);
  
  // 取消搜索
  const cancelSearch = useCallback(() => {
    if (!currentSearchId.current || !ws) return;
    
    console.log('[StreamSearch] 取消搜索:', currentSearchId.current);
    
    ws.send(JSON.stringify({
      type: 'cancel_search',
      data: {
        searchId: currentSearchId.current
      }
    }));
    
    setSearching(false);
    currentSearchId.current = null;
  }, [ws]);
  
  // 初始化连接
  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (ws) {
        ws.close();
      }
    };
  }, []);
  
  return {
    connected,
    searching,
    progress,
    results: allResults,
    startSearch,
    cancelSearch,
    reconnect: connect
  };
}

