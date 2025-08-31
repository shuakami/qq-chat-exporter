package client

import (
	"context"
	"encoding/json"
	"time"

	"go.uber.org/zap"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/config"
	"qq-chat-exporter/internal/models"
)

// NapcatServerClient 服务端模式的Napcat客户端
type NapcatServerClient struct {
	config *config.NapcatConfig
	logger *zap.Logger
	server *WebSocketServer
	ctx    context.Context
	cancel context.CancelFunc
}

// NewNapcatServerClient 创建服务端模式的Napcat客户端
func NewNapcatServerClient(cfg *config.NapcatConfig, logger *zap.Logger) *NapcatServerClient {
	ctx, cancel := context.WithCancel(context.Background())

	// 创建WebSocket服务端
	server := NewWebSocketServer(cfg, logger)

	client := &NapcatServerClient{
		config: cfg,
		logger: logger,
		server: server,
		ctx:    ctx,
		cancel: cancel,
	}

	// 启动WebSocket服务端
	if err := server.Start(); err != nil {
		logger.Error("启动WebSocket服务端失败", zap.Error(err))
		cancel()
		return nil
	}

	logger.Info("WebSocket服务端模式已启动，等待Napcat连接",
		zap.String("listen_address", cfg.BaseURL),
		zap.Int("max_requests", cfg.MaxRequests))

	return client
}

// sendRequest 发送请求 (内部方法)
func (c *NapcatServerClient) sendRequest(action string, params interface{}, timeout time.Duration) (*WSResponse, error) {
	// 发送请求到WebSocket服务端
	return c.server.SendRequest(action, params, timeout)
}

// GetGroupMessageHistory 获取群消息历史
func (c *NapcatServerClient) GetGroupMessageHistory(req *models.GroupMessageHistoryRequest) (*models.GroupMessageHistoryResponse, error) {
	params := map[string]interface{}{
		"group_id":     req.GroupID,
		"message_seq":  req.MessageSeq,
		"count":        req.Count,
		"reverseOrder": req.ReverseOrder,
	}

	response, err := c.sendRequest("get_group_msg_history", params, c.config.Timeout)
	if err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, &cli.UserFriendlyError{
			Title:       "获取群消息历史失败",
			Description: response.Message,
		}
	}

	// 直接构建完整响应结构，而不是只解析Data部分
	napcatResp := models.GroupMessageHistoryResponse{
		Status:  response.Status,
		Retcode: response.Retcode,
		Message: response.Message,
		Echo:    response.Echo,
	}

	// 解析Data部分到正确的结构
	if response.Data != nil {
		dataJSON, err := json.Marshal(response.Data)
		if err != nil {
			return nil, &cli.UserFriendlyError{
				Title:       "序列化响应数据失败",
				Description: err.Error(),
			}
		}

		if err := json.Unmarshal(dataJSON, &napcatResp.Data); err != nil {
			return nil, &cli.UserFriendlyError{
				Title:       "解析群消息历史数据失败",
				Description: err.Error(),
			}
		}
	}

	return &napcatResp, nil
}

// GetFriendMessageHistory 获取好友消息历史
func (c *NapcatServerClient) GetFriendMessageHistory(req *models.FriendMessageHistoryRequest) (*models.FriendMessageHistoryResponse, error) {
	params := map[string]interface{}{
		"user_id":      req.UserID,
		"message_seq":  req.MessageSeq,
		"count":        req.Count,
		"reverseOrder": req.ReverseOrder,
	}

	response, err := c.sendRequest("get_friend_msg_history", params, c.config.Timeout)
	if err != nil {
		return nil, err
	}

	if response.Status != "ok" {
		return nil, &cli.UserFriendlyError{
			Title:       "获取好友消息历史失败",
			Description: response.Message,
		}
	}

	// 直接构建完整响应结构，而不是只解析Data部分
	napcatResp := models.FriendMessageHistoryResponse{
		Status:  response.Status,
		Retcode: response.Retcode,
		Message: response.Message,
		Echo:    response.Echo,
	}

	// 解析Data部分到正确的结构
	if response.Data != nil {
		dataJSON, err := json.Marshal(response.Data)
		if err != nil {
			return nil, &cli.UserFriendlyError{
				Title:       "序列化响应数据失败",
				Description: err.Error(),
			}
		}

		if err := json.Unmarshal(dataJSON, &napcatResp.Data); err != nil {
			return nil, &cli.UserFriendlyError{
				Title:       "解析好友消息历史数据失败",
				Description: err.Error(),
			}
		}
	}

	return &napcatResp, nil
}

// GetGroupMessageHistoryWithRetry 带重试的获取群消息历史
func (c *NapcatServerClient) GetGroupMessageHistoryWithRetry(req *models.GroupMessageHistoryRequest, maxRetries int) (*models.GroupMessageHistoryResponse, error) {
	var lastErr error

	for i := 0; i <= maxRetries; i++ {
		resp, err := c.GetGroupMessageHistory(req)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if i < maxRetries {
			waitTime := time.Duration(i+1) * c.config.RetryDelay
			c.logger.Warn("获取群消息历史失败，正在重试",
				zap.String("group_id", req.GroupID),
				zap.Int("retry", i+1),
				zap.Duration("wait_time", waitTime),
				zap.Error(err))

			select {
			case <-time.After(waitTime):
			case <-c.ctx.Done():
				return nil, c.ctx.Err()
			}
		}
	}

	return nil, lastErr
}

// GetFriendMessageHistoryWithRetry 带重试的获取好友消息历史
func (c *NapcatServerClient) GetFriendMessageHistoryWithRetry(req *models.FriendMessageHistoryRequest, maxRetries int) (*models.FriendMessageHistoryResponse, error) {
	var lastErr error

	for i := 0; i <= maxRetries; i++ {
		resp, err := c.GetFriendMessageHistory(req)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if i < maxRetries {
			waitTime := time.Duration(i+1) * c.config.RetryDelay
			c.logger.Warn("获取好友消息历史失败，正在重试",
				zap.String("user_id", req.UserID),
				zap.Int("retry", i+1),
				zap.Duration("wait_time", waitTime),
				zap.Error(err))

			select {
			case <-time.After(waitTime):
			case <-c.ctx.Done():
				return nil, c.ctx.Err()
			}
		}
	}

	return nil, lastErr
}

// SetToken 设置Token
func (c *NapcatServerClient) SetToken(token string) {
	c.config.Token = token
	c.logger.Info("已更新API Token")
}

// UpdateConfig 更新配置
func (c *NapcatServerClient) UpdateConfig(cfg *config.NapcatConfig) {
	oldConfig := c.config
	c.config = cfg

	c.logger.Info("配置已更新",
		zap.String("old_base_url", oldConfig.BaseURL),
		zap.String("new_base_url", cfg.BaseURL))
}

// IsHealthy 检查健康状态
func (c *NapcatServerClient) IsHealthy() bool {
	return c.server.IsHealthy()
}

// Close 关闭客户端
func (c *NapcatServerClient) Close() error {
	c.cancel()

	if c.server != nil {
		return c.server.Close()
	}

	c.logger.Info("Napcat WebSocket服务端客户端已关闭")
	return nil
}
