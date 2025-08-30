package models

import (
	"fmt"
	"strconv"
)

// GroupMessageHistoryRequest 获取群消息历史请求
type GroupMessageHistoryRequest struct {
	GroupID      string `json:"group_id" binding:"required"` // 群号
	MessageSeq   string `json:"message_seq,omitempty"`       // 消息序号，可选
	Count        int    `json:"count" binding:"min=1"`       // 获取数量，无上限
	ReverseOrder bool   `json:"reverseOrder"`                // 是否倒序
}

// FriendMessageHistoryRequest 获取好友消息历史请求
type FriendMessageHistoryRequest struct {
	UserID       string `json:"user_id" binding:"required"` // 用户QQ号
	MessageSeq   string `json:"message_seq,omitempty"`      // 消息序号，可选
	Count        int    `json:"count" binding:"min=1"`      // 获取数量，无上限
	ReverseOrder bool   `json:"reverseOrder"`               // 是否倒序
}

// ExportRequest 导出请求
type ExportRequest struct {
	ChatType     string `json:"chat_type" binding:"required,oneof=group friend"` // 聊天类型：group/friend
	ChatID       string `json:"chat_id" binding:"required"`                      // 聊天ID（群号或QQ号）
	StartTime    *int64 `json:"start_time,omitempty"`                            // 开始时间戳
	EndTime      *int64 `json:"end_time,omitempty"`                              // 结束时间戳
	Format       string `json:"format" binding:"required,oneof=json txt"`        // 导出格式：json/txt
	IncludeImage bool   `json:"include_image"`                                   // 是否包含图片
	MaxCount     int    `json:"max_count" binding:"min=0"`                       // 最大消息数量，0表示无限制
}

// BatchExportRequest 批量导出请求
type BatchExportRequest struct {
	Chats        []ChatInfo `json:"chats" binding:"required,min=1"`           // 聊天列表
	StartTime    *int64     `json:"start_time,omitempty"`                     // 开始时间戳
	EndTime      *int64     `json:"end_time,omitempty"`                       // 结束时间戳
	Format       string     `json:"format" binding:"required,oneof=json txt"` // 导出格式
	IncludeImage bool       `json:"include_image"`                            // 是否包含图片
	MaxCount     int        `json:"max_count" binding:"min=0"`                // 每个聊天的最大消息数量，0表示无限制
}

// ChatInfo 聊天信息
type ChatInfo struct {
	Type string `json:"type" binding:"required,oneof=group friend"` // 聊天类型
	ID   string `json:"id" binding:"required"`                      // 聊天ID
	Name string `json:"name,omitempty"`                             // 聊天名称（可选）
}

// Validate 验证GroupMessageHistoryRequest
func (r *GroupMessageHistoryRequest) Validate() error {
	if r.GroupID == "" {
		return fmt.Errorf("群ID不能为空")
	}

	// 验证群ID格式（应该是数字）
	if _, err := strconv.ParseInt(r.GroupID, 10, 64); err != nil {
		return fmt.Errorf("群ID格式无效，必须是数字: %w", err)
	}

	if r.Count <= 0 {
		r.Count = 1000 // 默认1000条，提高效率
	}
	return nil
}

// Validate 验证FriendMessageHistoryRequest
func (r *FriendMessageHistoryRequest) Validate() error {
	if r.UserID == "" {
		return fmt.Errorf("用户ID不能为空")
	}

	// 验证用户ID格式（应该是数字）
	if _, err := strconv.ParseInt(r.UserID, 10, 64); err != nil {
		return fmt.Errorf("用户ID格式无效，必须是数字: %w", err)
	}

	if r.Count <= 0 {
		r.Count = 1000 // 默认1000条，提高效率
	}
	// 移除上限限制，支持无限制获取
	return nil
}

// Validate 验证ExportRequest
func (r *ExportRequest) Validate() error {
	if r.MaxCount < 0 {
		r.MaxCount = 0 // 0表示无限制
	}
	return nil
}
