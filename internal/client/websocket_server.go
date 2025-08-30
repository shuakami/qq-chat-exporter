package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"qq-chat-exporter/internal/config"
)

// WebSocketServer WebSocket服务端，用于接收Napcat的反向连接
type WebSocketServer struct {
	config   *config.NapcatConfig
	logger   *zap.Logger
	server   *http.Server
	listener net.Listener

	// 连接管理
	connections map[*websocket.Conn]*ConnectionInfo
	connMutex   sync.RWMutex

	// 请求管理
	pendingRequests map[string]*pendingRequest
	requestMutex    sync.RWMutex
	requestCounter  uint64

	// 上下文管理
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

// ConnectionInfo 连接信息
type ConnectionInfo struct {
	id          string
	conn        *websocket.Conn
	lastPing    time.Time
	isConnected bool
	mutex       sync.RWMutex
}

// NewWebSocketServer 创建WebSocket服务端
func NewWebSocketServer(cfg *config.NapcatConfig, logger *zap.Logger) *WebSocketServer {
	ctx, cancel := context.WithCancel(context.Background())

	return &WebSocketServer{
		config:          cfg,
		logger:          logger,
		connections:     make(map[*websocket.Conn]*ConnectionInfo),
		pendingRequests: make(map[string]*pendingRequest),
		ctx:             ctx,
		cancel:          cancel,
		done:            make(chan struct{}),
	}
}

// Start 启动WebSocket服务端
func (s *WebSocketServer) Start() error {
	// 解析监听地址
	addr, err := s.parseListenAddr()
	if err != nil {
		return fmt.Errorf("解析监听地址失败: %w", err)
	}

	// 创建listener
	s.listener, err = net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("监听端口失败: %w", err)
	}

	// 设置WebSocket升级器
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // 允许所有来源
		},
		HandshakeTimeout: 10 * time.Second,
	}

	// 创建HTTP处理器
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		s.handleWebSocket(upgrader, w, r)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		s.handleWebSocket(upgrader, w, r) // 根路径也支持
	})

	// 创建HTTP服务器
	s.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// 启动服务器
	go func() {
		defer close(s.done)
		if err := s.server.Serve(s.listener); err != nil && err != http.ErrServerClosed {
			s.logger.Error("WebSocket服务器启动失败", zap.Error(err))
		}
	}()

	s.logger.Info("WebSocket服务端已启动",
		zap.String("address", addr),
		zap.String("endpoints", "/ws, /"))

	return nil
}

// handleWebSocket 处理WebSocket连接
func (s *WebSocketServer) handleWebSocket(upgrader websocket.Upgrader, w http.ResponseWriter, r *http.Request) {
	// 升级连接
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("WebSocket升级失败", zap.Error(err))
		return
	}

	// 创建连接信息
	connInfo := &ConnectionInfo{
		id:          fmt.Sprintf("napcat_%d", atomic.AddUint64(&s.requestCounter, 1)),
		conn:        conn,
		lastPing:    time.Now(),
		isConnected: true,
	}

	// 注册连接
	s.connMutex.Lock()
	s.connections[conn] = connInfo
	s.connMutex.Unlock()

	s.logger.Debug("Napcat连接已建立",
		zap.String("connection_id", connInfo.id),
		zap.String("remote_addr", r.RemoteAddr))

	// 处理连接
	go s.handleConnection(connInfo)
}

// handleConnection 处理单个连接
func (s *WebSocketServer) handleConnection(connInfo *ConnectionInfo) {
	defer func() {
		// 清理连接
		s.connMutex.Lock()
		delete(s.connections, connInfo.conn)
		s.connMutex.Unlock()

		connInfo.conn.Close()
		s.logger.Debug("Napcat连接已关闭", zap.String("connection_id", connInfo.id))
	}()

	// 设置读取消息的处理
	connInfo.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	connInfo.conn.SetPongHandler(func(string) error {
		connInfo.mutex.Lock()
		connInfo.lastPing = time.Now()
		connInfo.mutex.Unlock()
		connInfo.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// 启动心跳
	go s.startHeartbeat(connInfo)

	// 读取消息循环
	for {
		select {
		case <-s.ctx.Done():
			return
		default:
			_, message, err := connInfo.conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					s.logger.Error("读取WebSocket消息失败",
						zap.String("connection_id", connInfo.id),
						zap.Error(err))
				}
				return
			}

			// 处理消息
			s.handleMessage(connInfo, message)
		}
	}
}

// handleMessage 处理收到的消息
func (s *WebSocketServer) handleMessage(connInfo *ConnectionInfo, message []byte) {
	// 先解析为通用的json.RawMessage，检查消息类型
	var genericMsg map[string]json.RawMessage
	if err := json.Unmarshal(message, &genericMsg); err != nil {
		s.logger.Error("解析WebSocket消息失败",
			zap.String("connection_id", connInfo.id),
			zap.String("message", string(message)),
			zap.Error(err))
		return
	}

	// 检查是否是Napcat事件消息（包含post_type字段）
	if _, hasPostType := genericMsg["post_type"]; hasPostType {
		// 解析事件类型
		var eventType string
		if err := json.Unmarshal(genericMsg["post_type"], &eventType); err == nil {
			if eventType == "meta_event" {
				// 解析元事件类型
				if metaEventRaw, exists := genericMsg["meta_event_type"]; exists {
					var metaEventType string
					if err := json.Unmarshal(metaEventRaw, &metaEventType); err == nil && metaEventType == "heartbeat" {
						// 心跳消息，静默处理
						return
					}
				}
			}
		}

		return
	}

	// 尝试解析为API响应
	var response WSResponse
	if err := json.Unmarshal(message, &response); err != nil {
		s.logger.Error("解析API响应消息失败",
			zap.String("connection_id", connInfo.id),
			zap.String("message", string(message)),
			zap.Error(err))
		return
	}

	// 如果有echo，说明是对我们请求的响应
	if response.Echo != "" {
		s.requestMutex.RLock()
		req, exists := s.pendingRequests[response.Echo]
		s.requestMutex.RUnlock()

		if exists {
			select {
			case req.responseChan <- &response:
			case <-time.After(time.Second):
				s.logger.Warn("响应通道阻塞", zap.String("echo", response.Echo))
			}
		} else {
			s.logger.Debug("收到未知echo的响应，可能是延迟响应",
				zap.String("echo", response.Echo),
				zap.String("status", response.Status))
		}
	} else {
		// 没有echo的响应消息，记录警告
		s.logger.Warn("收到没有echo的响应消息",
			zap.String("connection_id", connInfo.id),
			zap.String("message", string(message)))
	}
}

// startHeartbeat 启动心跳
func (s *WebSocketServer) startHeartbeat(connInfo *ConnectionInfo) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			if err := connInfo.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				s.logger.Error("发送心跳失败",
					zap.String("connection_id", connInfo.id),
					zap.Error(err))
				return
			}
		}
	}
}

// SendRequest 发送请求到Napcat
func (s *WebSocketServer) SendRequest(action string, params interface{}, timeout time.Duration) (*WSResponse, error) {
	// 获取可用连接
	conn := s.getAvailableConnection()
	if conn == nil {
		return nil, fmt.Errorf("没有可用的Napcat连接")
	}

	// 生成echo
	echo := fmt.Sprintf("req_%d_%d", atomic.AddUint64(&s.requestCounter, 1), time.Now().UnixNano())

	// 创建请求
	request := WSRequest{
		Action: action,
		Params: params,
		Echo:   echo,
	}

	// 序列化请求
	requestData, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	// 创建待处理请求
	pendingReq := &pendingRequest{
		echo:         echo,
		responseChan: make(chan *WSResponse, 1),
		createdAt:    time.Now(),
	}

	// 注册请求
	s.requestMutex.Lock()
	s.pendingRequests[echo] = pendingReq
	s.requestMutex.Unlock()

	// 发送请求
	if err := conn.WriteMessage(websocket.TextMessage, requestData); err != nil {
		s.requestMutex.Lock()
		delete(s.pendingRequests, echo)
		s.requestMutex.Unlock()
		s.logger.Error("发送WebSocket请求失败",
			zap.String("echo", echo),
			zap.Error(err))
		return nil, fmt.Errorf("发送WebSocket请求失败: %w", err)
	}

	// 等待响应
	select {
	case response := <-pendingReq.responseChan:
		s.requestMutex.Lock()
		delete(s.pendingRequests, echo)
		s.requestMutex.Unlock()

		return response, nil

	case <-time.After(timeout):
		s.requestMutex.Lock()
		delete(s.pendingRequests, echo)
		s.requestMutex.Unlock()

		s.logger.Warn("WebSocket请求超时",
			zap.String("action", action),
			zap.Duration("timeout", timeout))

		return nil, fmt.Errorf("请求超时: action=%s", action)

	case <-s.ctx.Done():
		return nil, fmt.Errorf("客户端已关闭")
	}
}

// getAvailableConnection 获取可用的连接
func (s *WebSocketServer) getAvailableConnection() *websocket.Conn {
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()

	for conn, connInfo := range s.connections {
		connInfo.mutex.RLock()
		isConnected := connInfo.isConnected
		connInfo.mutex.RUnlock()

		if isConnected {
			return conn
		}
	}

	return nil
}

// parseListenAddr 解析监听地址
func (s *WebSocketServer) parseListenAddr() (string, error) {
	u, err := url.Parse(s.config.BaseURL)
	if err != nil {
		return "", fmt.Errorf("解析BaseURL失败: %w", err)
	}

	// 返回监听地址
	return u.Host, nil
}

// IsHealthy 检查服务端健康状态
func (s *WebSocketServer) IsHealthy() bool {
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()

	// 至少有一个活跃连接
	for _, connInfo := range s.connections {
		connInfo.mutex.RLock()
		isConnected := connInfo.isConnected
		connInfo.mutex.RUnlock()

		if isConnected {
			return true
		}
	}

	return false
}

// Close 关闭服务端
func (s *WebSocketServer) Close() error {
	s.logger.Info("正在关闭WebSocket服务端...")

	// 取消上下文
	s.cancel()

	// 关闭所有连接
	s.connMutex.Lock()
	for conn := range s.connections {
		conn.Close()
	}
	s.connMutex.Unlock()

	// 关闭HTTP服务器
	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.server.Shutdown(ctx)
	}

	// 等待完成
	select {
	case <-s.done:
	case <-time.After(2 * time.Second):
		s.logger.Warn("等待服务端关闭超时")
	}

	s.logger.Info("WebSocket服务端已关闭")
	return nil
}
