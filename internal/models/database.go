package models

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// ChatSession 聊天会话表
type ChatSession struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	ChatType     string     `gorm:"not null;index" json:"chat_type"` // group或friend
	ChatID       string     `gorm:"not null;index" json:"chat_id"`   // 群号或好友QQ号
	ChatName     string     `json:"chat_name"`                       // 聊天名称
	Description  string     `json:"description"`                     // 描述
	StartTime    time.Time  `json:"start_time"`                      // 开始采集时间
	EndTime      *time.Time `json:"end_time"`                        // 结束采集时间
	Status       string     `gorm:"default:active" json:"status"`    // active, completed, failed
	MessageCount int        `gorm:"default:0" json:"message_count"`  // 消息总数
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`

	// 关联
	Messages []ChatMessage `gorm:"foreignKey:SessionID;constraint:OnDelete:CASCADE" json:"messages,omitempty"`
}

// ChatMessage 聊天消息表 - 保存完整的Napcat响应
type ChatMessage struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	SessionID uint `gorm:"not null;index;uniqueIndex:idx_session_message" json:"session_id"`

	// Napcat原始字段
	NapcatSelfID     *int64 `json:"napcat_self_id"`
	NapcatUserID     *int64 `json:"napcat_user_id"`
	NapcatTime       *int64 `json:"napcat_time"`
	NapcatMessageID  *int64 `gorm:"uniqueIndex:idx_session_message" json:"napcat_message_id"`
	NapcatMessageSeq *int64 `json:"napcat_message_seq"`
	NapcatRealID     *int64 `json:"napcat_real_id"`
	NapcatGroupID    *int64 `json:"napcat_group_id"`

	// 消息基本信息
	MessageType     string `json:"message_type"`
	SubType         string `json:"sub_type"`
	RawMessage      string `gorm:"type:text" json:"raw_message"`
	Font            *int   `json:"font"`
	MessageFormat   string `json:"message_format"`
	PostType        string `json:"post_type"`
	MessageSentType string `json:"message_sent_type"`

	// 发送者信息 - JSON存储完整的Sender对象
	SenderData string `gorm:"type:text" json:"sender_data"`

	// 消息内容 - JSON存储完整的Message数组
	MessageContent string `gorm:"type:text" json:"message_content"`

	// 完整的原始响应 - 保存Napcat返回的完整JSON
	RawResponse string `gorm:"type:text" json:"raw_response"`

	// 解析后的字段（方便查询和显示）
	ParsedTime     time.Time `gorm:"index" json:"parsed_time"`
	SenderNickname string    `gorm:"index" json:"sender_nickname"`
	SenderCard     string    `json:"sender_card"`
	SenderRole     string    `json:"sender_role"`
	ContentPreview string    `gorm:"type:text" json:"content_preview"` // 内容预览，方便显示
	ContentType    string    `json:"content_type"`                     // text, image, video, etc.
	HasImage       bool      `gorm:"index" json:"has_image"`
	HasVideo       bool      `gorm:"index" json:"has_video"`
	HasVoice       bool      `gorm:"index" json:"has_voice"`
	HasFile        bool      `gorm:"index" json:"has_file"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// 关联
	Session ChatSession `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

// ExportTask 导出任务表
type ExportTask struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	SessionID  uint       `gorm:"not null;index" json:"session_id"`
	TaskName   string     `gorm:"not null" json:"task_name"`
	ExportType string     `gorm:"not null" json:"export_type"` // json, txt, html
	FilePath   string     `json:"file_path"`
	Status     string     `gorm:"default:pending" json:"status"` // pending, running, completed, failed
	Progress   int        `gorm:"default:0" json:"progress"`     // 0-100
	ErrorMsg   string     `gorm:"type:text" json:"error_msg"`
	StartTime  time.Time  `json:"start_time"`
	EndTime    *time.Time `json:"end_time"`

	// 时间范围过滤字段
	FilterStartTime *time.Time `json:"filter_start_time"` // 过滤开始时间
	FilterEndTime   *time.Time `json:"filter_end_time"`   // 过滤结束时间

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// 关联
	Session ChatSession `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

// AppConfig 应用配置表
type AppConfig struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"uniqueIndex;not null" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BeforeCreate 创建前处理
func (m *ChatMessage) BeforeCreate(tx *gorm.DB) error {
	// 解析时间
	if m.NapcatTime != nil {
		m.ParsedTime = time.Unix(*m.NapcatTime, 0)
	} else {
		m.ParsedTime = time.Now()
	}

	// 解析发送者信息
	if m.SenderData != "" {
		var sender Sender
		if err := json.Unmarshal([]byte(m.SenderData), &sender); err == nil {
			m.SenderNickname = sender.Nickname
			m.SenderCard = sender.Card
			m.SenderRole = sender.Role
		}
	}

	// 解析消息内容
	if m.MessageContent != "" {
		var messageNodes []MessageNode
		if err := json.Unmarshal([]byte(m.MessageContent), &messageNodes); err == nil {
			m.parseMessageNodes(messageNodes)
		}
	}

	return nil
}

// parseMessageNodes 解析消息节点，提取内容类型和预览
func (m *ChatMessage) parseMessageNodes(nodes []MessageNode) {
	var contentParts []string
	var contentTypes []string

	for _, node := range nodes {
		switch node.Type {
		case MessageTypeText:
			if text, ok := node.Data["text"].(string); ok {
				contentParts = append(contentParts, text)
				contentTypes = append(contentTypes, "text")
			}
		case MessageTypeImage:
			m.HasImage = true
			contentParts = append(contentParts, "[图片]")
			contentTypes = append(contentTypes, "image")
		case MessageTypeVideo:
			m.HasVideo = true
			contentParts = append(contentParts, "[视频]")
			contentTypes = append(contentTypes, "video")
		case MessageTypeRecord:
			m.HasVoice = true
			contentParts = append(contentParts, "[语音]")
			contentTypes = append(contentTypes, "voice")
		case MessageTypeFile:
			m.HasFile = true
			contentParts = append(contentParts, "[文件]")
			contentTypes = append(contentTypes, "file")
		case MessageTypeAt:
			if qq, ok := node.Data["qq"].(string); ok {
				contentParts = append(contentParts, "@"+qq)
				contentTypes = append(contentTypes, "at")
			}
		case MessageTypeFace:
			contentParts = append(contentParts, "[表情]")
			contentTypes = append(contentTypes, "face")
		default:
			contentParts = append(contentParts, "["+node.Type+"]")
			contentTypes = append(contentTypes, node.Type)
		}
	}

	// 生成内容预览（限制长度）
	preview := ""
	for _, part := range contentParts {
		if len(preview) > 0 {
			preview += " "
		}
		preview += part
		if len(preview) > 200 {
			preview = preview[:200] + "..."
			break
		}
	}
	m.ContentPreview = preview

	// 设置主要内容类型
	if len(contentTypes) > 0 {
		if m.HasImage {
			m.ContentType = "image"
		} else if m.HasVideo {
			m.ContentType = "video"
		} else if m.HasVoice {
			m.ContentType = "voice"
		} else if m.HasFile {
			m.ContentType = "file"
		} else {
			m.ContentType = "text"
		}
	}
}

// GetDisplayName 获取显示名称
func (m *ChatMessage) GetDisplayName() string {
	if m.SenderCard != "" {
		return m.SenderCard
	}
	return m.SenderNickname
}

// GetTimeString 获取时间字符串
func (m *ChatMessage) GetTimeString() string {
	return m.ParsedTime.Format("2006-01-02 15:04:05")
}

// TableName 指定表名
func (ChatSession) TableName() string {
	return "chat_sessions"
}

func (ChatMessage) TableName() string {
	return "chat_messages"
}

func (ExportTask) TableName() string {
	return "export_tasks"
}

func (AppConfig) TableName() string {
	return "app_configs"
}
