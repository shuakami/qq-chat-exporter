/**
 * 流式搜索Hook
 * 使用WebSocket实现实时搜索结果推送
 *
 * 连接策略：懒连接 —— 只有真正发起搜索时才建立 WebSocket，搜索结束 / 取消即释放，
 * 空闲时完全不连接。断线时按指数退避重连并限制次数，且连接失败只打一条日志，
 * 避免服务未启动时刷屏（与 use-websocket 的进度通道彼此独立）。
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

interface StartSearchParams {
  peer: any;
  filter?: any;
  searchQuery: string;
}

const BASE_RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function useStreamSearch(options: UseStreamSearchOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [allResults, setAllResults] = useState<any[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const currentSearchId = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const pendingSearch = useRef<StartSearchParams | null>(null);
  // 仅在搜索进行中 / 有待发搜索时维持连接与重连；空闲时不连不重连。
  const keepConnected = useRef(false);
  const failureLogged = useRef(false);
  const unmounted = useRef(false);

  const resultsRef = useRef<any[]>([]);
  useEffect(() => {
    resultsRef.current = allResults;
  }, [allResults]);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const handleSearchProgress = useCallback((progressData: SearchProgress) => {
    setProgress(progressData);
    optionsRef.current.onProgress?.(progressData);

    if (progressData.results.length > 0) {
      setAllResults((prev) => [...prev, ...progressData.results]);
    }

    if (progressData.status === 'completed') {
      setSearching(false);
      keepConnected.current = false;
      currentSearchId.current = null;
      optionsRef.current.onComplete?.(resultsRef.current);
    }

    if (progressData.status === 'cancelled' || progressData.status === 'error') {
      setSearching(false);
      keepConnected.current = false;
      currentSearchId.current = null;
      if (progressData.error) {
        optionsRef.current.onError?.(progressData.error);
      }
    }
  }, []);

  const handleMessage = useCallback(
    (message: any) => {
      const { type, data } = message;
      switch (type) {
        case 'connected':
          break;
        case 'search_progress':
          handleSearchProgress(data);
          break;
        case 'search_error':
          setSearching(false);
          keepConnected.current = false;
          optionsRef.current.onError?.(data.message);
          break;
        default:
          break;
      }
    },
    [handleSearchProgress],
  );

  const handleMessageRef = useRef(handleMessage);
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  const sendSearch = (socket: WebSocket, params: StartSearchParams): string => {
    const searchId = `search_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    currentSearchId.current = searchId;
    setAllResults([]);
    setProgress(null);
    setSearching(true);
    socket.send(JSON.stringify({ type: 'start_stream_search', data: { searchId, ...params } }));
    return searchId;
  };

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectAttempts.current = 0;
      failureLogged.current = false;
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const pending = pendingSearch.current;
      if (pending) {
        pendingSearch.current = null;
        sendSearch(socket, pending);
      }
    };

    socket.onmessage = (event) => {
      try {
        handleMessageRef.current(JSON.parse(event.data));
      } catch (error) {
        console.error('[StreamSearch] 消息解析失败:', error);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (unmounted.current || !keepConnected.current) {
        return;
      }
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        keepConnected.current = false;
        pendingSearch.current = null;
        setSearching(false);
        optionsRef.current.onError?.('无法连接到搜索服务，请确认 QCE 服务已启动后重试');
        return;
      }
      const delay = Math.min(
        BASE_RECONNECT_MS * 2 ** reconnectAttempts.current,
        MAX_RECONNECT_MS,
      );
      reconnectAttempts.current += 1;
      if (!failureLogged.current) {
        console.warn('[StreamSearch] 连接断开，将自动重连');
        failureLogged.current = true;
      }
      reconnectTimer.current = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      if (!failureLogged.current) {
        console.warn('[StreamSearch] WebSocket 连接失败');
        failureLogged.current = true;
      }
    };
  }, []);

  const startSearch = useCallback(
    (params: StartSearchParams) => {
      if (searching) {
        console.warn('[StreamSearch] 已有搜索在进行中');
        return currentSearchId.current;
      }
      keepConnected.current = true;
      reconnectAttempts.current = 0;
      failureLogged.current = false;
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        return sendSearch(socket, params);
      }
      // 尚未连接：暂存请求，连接建立后由 onopen 自动发出。
      pendingSearch.current = params;
      setSearching(true);
      connect();
      return null;
    },
    [searching, connect],
  );

  const cancelSearch = useCallback(() => {
    keepConnected.current = false;
    pendingSearch.current = null;
    const socket = wsRef.current;
    if (currentSearchId.current && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: 'cancel_search', data: { searchId: currentSearchId.current } }),
      );
    }
    setSearching(false);
    currentSearchId.current = null;
  }, []);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      keepConnected.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, []);

  return {
    connected,
    searching,
    progress,
    results: allResults,
    startSearch,
    cancelSearch,
    reconnect: connect,
  };
}
