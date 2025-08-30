package models

import "time"

// APIResponse 表示Napcat API的通用响应结构
type APIResponse struct {
	Status  string      `json:"status"`  // 请求状态: ok/error
	Retcode int         `json:"retcode"` // 响应码
	Data    interface{} `json:"data"`    // 响应数据
	Message string      `json:"message"` // 提示信息
	Wording string      `json:"wording"` // 提示信息（人性化）
	Echo    string      `json:"echo"`    // 回显
}

// GroupMessageHistoryResponse 群消息历史响应
type GroupMessageHistoryResponse struct {
	Status  string                  `json:"status"`
	Retcode int                     `json:"retcode"`
	Data    GroupMessageHistoryData `json:"data"`
	Message string                  `json:"message"`
	Wording string                  `json:"wording"`
	Echo    string                  `json:"echo"`
}

// FriendMessageHistoryResponse 好友消息历史响应
type FriendMessageHistoryResponse struct {
	Status  string                   `json:"status"`
	Retcode int                      `json:"retcode"`
	Data    FriendMessageHistoryData `json:"data"`
	Message string                   `json:"message"`
	Wording string                   `json:"wording"`
	Echo    string                   `json:"echo"`
}

// GroupMessageHistoryData 群消息历史数据
type GroupMessageHistoryData struct {
	Messages []Message `json:"messages"`
}

// FriendMessageHistoryData 好友消息历史数据
type FriendMessageHistoryData struct {
	Messages []Message `json:"messages"`
}

// Message 消息结构
type Message struct {
	SelfID          int64         `json:"self_id"`            // 自己QQ号
	UserID          int64         `json:"user_id"`            // 发送人QQ号
	Time            int64         `json:"time"`               // 发送时间戳
	MessageID       int64         `json:"message_id"`         // 消息ID
	MessageSeq      int64         `json:"message_seq"`        // 消息序号
	RealID          int64         `json:"real_id"`            // ?ID
	MessageType     string        `json:"message_type"`       // 消息类型
	Sender          Sender        `json:"sender"`             // 发送人信息
	RawMessage      string        `json:"raw_message"`        // 原始消息
	Font            int           `json:"font"`               // 字体
	SubType         string        `json:"sub_type"`           // 子类型
	Message         []MessageNode `json:"message"`            // 消息内容
	MessageFormat   string        `json:"message_format"`     // 消息格式
	PostType        string        `json:"post_type"`          // ?
	MessageSentType string        `json:"message_sent_type"`  // 消息发送类型
	GroupID         *int64        `json:"group_id,omitempty"` // 群号（仅群消息）
}

// Sender 发送人信息
type Sender struct {
	UserID   int64  `json:"user_id"`  // 发送人QQ号
	Nickname string `json:"nickname"` // 昵称
	Sex      string `json:"sex"`      // 性别: male/female/unknown
	Age      int    `json:"age"`      // 年龄
	Card     string `json:"card"`     // 名片
	Role     string `json:"role"`     // 角色: owner/admin/member
}

// MessageNode 消息节点
type MessageNode struct {
	Type string                 `json:"type"` // 消息类型
	Data map[string]interface{} `json:"data"` // 消息数据
}

// 消息类型常量
const (
	MessageTypeText   = "text"   // 文本消息
	MessageTypeAt     = "at"     // @某人
	MessageTypeImage  = "image"  // 图片消息
	MessageTypeFace   = "face"   // 表情消息
	MessageTypeJSON   = "json"   // JSON卡片消息
	MessageTypeRecord = "record" // 语音消息
	MessageTypeVideo  = "video"  // 视频消息
	MessageTypeReply  = "reply"  // 回复消息
	MessageTypeMusic  = "music"  // 音乐消息
	MessageTypeDice   = "dice"   // 掷骰子
	MessageTypeRPS    = "rps"    // 猜拳
	MessageTypeFile   = "file"   // 发送消息
	MessageTypeNode   = "node"   // 消息节点
)

// GetFormattedTime 获取格式化时间
func (m *Message) GetFormattedTime() time.Time {
	return time.Unix(m.Time, 0)
}

// GetFormattedTimeString 获取格式化时间字符串
func (m *Message) GetFormattedTimeString() string {
	return m.GetFormattedTime().Format("2006-01-02 15:04:05")
}

// IsGroupMessage 判断是否为群消息
func (m *Message) IsGroupMessage() bool {
	return m.GroupID != nil && *m.GroupID > 0
}

// GetDisplayName 获取显示名称
func (m *Message) GetDisplayName() string {
	if m.Sender.Card != "" {
		return m.Sender.Card
	}
	return m.Sender.Nickname
}
