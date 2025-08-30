package client

import (
	"qq-chat-exporter/internal/config"
	"qq-chat-exporter/internal/models"
)

// NapcatClientInterface Napcat客户端接口
type NapcatClientInterface interface {
	// 获取群消息历史
	GetGroupMessageHistory(req *models.GroupMessageHistoryRequest) (*models.GroupMessageHistoryResponse, error)

	// 获取好友消息历史
	GetFriendMessageHistory(req *models.FriendMessageHistoryRequest) (*models.FriendMessageHistoryResponse, error)

	// 带重试的获取群消息历史
	GetGroupMessageHistoryWithRetry(req *models.GroupMessageHistoryRequest, maxRetries int) (*models.GroupMessageHistoryResponse, error)

	// 带重试的获取好友消息历史
	GetFriendMessageHistoryWithRetry(req *models.FriendMessageHistoryRequest, maxRetries int) (*models.FriendMessageHistoryResponse, error)

	// 设置Token
	SetToken(token string)

	// 更新配置
	UpdateConfig(cfg *config.NapcatConfig)

	// 检查健康状态
	IsHealthy() bool

	// 关闭客户端
	Close() error
}
