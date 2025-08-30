package database

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"qq-chat-exporter/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// Database 数据库管理器
type Database struct {
	db *gorm.DB
}

// New 创建新的数据库实例
func New(dbPath string) (*Database, error) {
	// 确保数据库目录存在
	dbDir := filepath.Dir(dbPath)
	if dbDir != "." {
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			return nil, fmt.Errorf("创建数据库目录失败: %w", err)
		}
	}

	// 配置 GORM
	config := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent), // 静默模式，避免输出SQL日志
	}

	// 连接数据库
	db, err := gorm.Open(sqlite.Open(dbPath), config)
	if err != nil {
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}

	database := &Database{db: db}

	// 自动迁移数据库表
	if err := database.migrate(); err != nil {
		return nil, fmt.Errorf("数据库迁移失败: %w", err)
	}

	return database, nil
}

// migrate 自动迁移数据库表
func (d *Database) migrate() error {
	return d.db.AutoMigrate(
		&models.ChatSession{},
		&models.ChatMessage{},
		&models.ExportTask{},
		&models.AppConfig{},
	)
}

// GetDB 获取数据库实例
func (d *Database) GetDB() *gorm.DB {
	return d.db
}

// Close 关闭数据库连接
func (d *Database) Close() error {
	sqlDB, err := d.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// 会话相关操作

// CreateSession 创建新的聊天会话
func (d *Database) CreateSession(session *models.ChatSession) error {
	return d.db.Create(session).Error
}

// GetSession 根据ID获取会话
func (d *Database) GetSession(id uint) (*models.ChatSession, error) {
	var session models.ChatSession
	err := d.db.First(&session, id).Error
	return &session, err
}

// GetSessionByChat 根据聊天类型和ID获取会话
func (d *Database) GetSessionByChat(chatType, chatID string) (*models.ChatSession, error) {
	var session models.ChatSession
	err := d.db.Where("chat_type = ? AND chat_id = ?", chatType, chatID).First(&session).Error
	return &session, err
}

// GetAllSessions 获取所有会话
func (d *Database) GetAllSessions() ([]models.ChatSession, error) {
	var sessions []models.ChatSession
	err := d.db.Order("created_at DESC").Find(&sessions).Error
	return sessions, err
}

// UpdateSession 更新会话
func (d *Database) UpdateSession(session *models.ChatSession) error {
	return d.db.Save(session).Error
}

// DeleteSession 删除会话（包括相关消息）
func (d *Database) DeleteSession(id uint) error {
	return d.db.Transaction(func(tx *gorm.DB) error {
		// 删除相关消息
		if err := tx.Where("session_id = ?", id).Delete(&models.ChatMessage{}).Error; err != nil {
			return err
		}
		// 删除会话
		if err := tx.Delete(&models.ChatSession{}, id).Error; err != nil {
			return err
		}
		return nil
	})
}

// 消息相关操作

// CreateMessage 创建新消息
func (d *Database) CreateMessage(message *models.ChatMessage) error {
	return d.db.Create(message).Error
}

// CreateMessages 批量创建消息，自动忽略重复
func (d *Database) CreateMessages(messages []models.ChatMessage) error {
	// 使用较小的批次大小避免SQLite性能问题
	const sqliteBatchSize = 50

	// 使用事务来处理可能的重复消息
	return d.db.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < len(messages); i += sqliteBatchSize {
			end := i + sqliteBatchSize
			if end > len(messages) {
				end = len(messages)
			}
			batch := messages[i:end]

			// 使用 ON CONFLICT IGNORE 来忽略重复的消息
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch)
			if result.Error != nil {
				return result.Error
			}
		}
		return nil
	})
}

// GetMessages 获取会话的消息
func (d *Database) GetMessages(sessionID uint, limit, offset int) ([]models.ChatMessage, error) {
	var messages []models.ChatMessage
	query := d.db.Where("session_id = ?", sessionID).Order("parsed_time ASC")

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	err := query.Find(&messages).Error
	return messages, err
}

// GetMessagesInTimeRange 获取指定时间范围内的消息
func (d *Database) GetMessagesInTimeRange(sessionID uint, startTime, endTime *time.Time, limit, offset int) ([]models.ChatMessage, error) {
	var messages []models.ChatMessage
	query := d.db.Where("session_id = ?", sessionID)

	// 添加时间范围条件
	if startTime != nil {
		query = query.Where("parsed_time >= ?", *startTime)
	}
	if endTime != nil {
		query = query.Where("parsed_time <= ?", *endTime)
	}

	query = query.Order("parsed_time ASC")

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	err := query.Find(&messages).Error
	return messages, err
}

// GetMessageCountInTimeRange 获取指定时间范围内的消息数量
func (d *Database) GetMessageCountInTimeRange(sessionID uint, startTime, endTime *time.Time) (int64, error) {
	var count int64
	query := d.db.Model(&models.ChatMessage{}).Where("session_id = ?", sessionID)

	// 添加时间范围条件
	if startTime != nil {
		query = query.Where("parsed_time >= ?", *startTime)
	}
	if endTime != nil {
		query = query.Where("parsed_time <= ?", *endTime)
	}

	err := query.Count(&count).Error
	return count, err
}

// GetMessageCount 获取会话的消息总数
func (d *Database) GetMessageCount(sessionID uint) (int64, error) {
	var count int64
	err := d.db.Model(&models.ChatMessage{}).Where("session_id = ?", sessionID).Count(&count).Error
	return count, err
}

// GetLatestMessage 获取会话的最新消息
func (d *Database) GetLatestMessage(sessionID uint) (*models.ChatMessage, error) {
	var message models.ChatMessage
	err := d.db.Where("session_id = ?", sessionID).Order("parsed_time DESC").First(&message).Error
	return &message, err
}

// SearchMessages 搜索消息
func (d *Database) SearchMessages(sessionID uint, keyword string, limit int) ([]models.ChatMessage, error) {
	var messages []models.ChatMessage
	query := d.db.Where("session_id = ? AND content_preview LIKE ?", sessionID, "%"+keyword+"%").
		Order("parsed_time DESC")

	if limit > 0 {
		query = query.Limit(limit)
	}

	err := query.Find(&messages).Error
	return messages, err
}

// 导出任务相关操作

// CreateExportTask 创建导出任务
func (d *Database) CreateExportTask(task *models.ExportTask) error {
	return d.db.Create(task).Error
}

// GetExportTask 获取导出任务
func (d *Database) GetExportTask(id uint) (*models.ExportTask, error) {
	var task models.ExportTask
	err := d.db.Preload("Session").First(&task, id).Error
	return &task, err
}

// GetExportTasks 获取所有导出任务
func (d *Database) GetExportTasks() ([]models.ExportTask, error) {
	var tasks []models.ExportTask
	err := d.db.Preload("Session").Order("created_at DESC").Find(&tasks).Error
	return tasks, err
}

// GetRunningTasks 获取正在运行的任务
func (d *Database) GetRunningTasks() ([]models.ExportTask, error) {
	var tasks []models.ExportTask
	err := d.db.Preload("Session").Where("status IN ?", []string{"pending", "running"}).
		Order("created_at DESC").Find(&tasks).Error
	return tasks, err
}

// UpdateExportTask 更新导出任务
func (d *Database) UpdateExportTask(task *models.ExportTask) error {
	return d.db.Save(task).Error
}

// UpdateTaskProgress 更新任务进度
func (d *Database) UpdateTaskProgress(id uint, progress int, status string) error {
	return d.db.Model(&models.ExportTask{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"progress": progress,
			"status":   status,
		}).Error
}

// DeleteExportTask 删除导出任务
func (d *Database) DeleteExportTask(id uint) error {
	return d.db.Delete(&models.ExportTask{}, id).Error
}

// 配置相关操作

// GetConfig 获取配置
func (d *Database) GetConfig(key string) (string, error) {
	var config models.AppConfig
	err := d.db.Where("key = ?", key).First(&config).Error
	if err != nil {
		return "", err
	}
	return config.Value, nil
}

// SetConfig 设置配置
func (d *Database) SetConfig(key, value string) error {
	var config models.AppConfig
	err := d.db.Where("key = ?", key).First(&config).Error

	if err != nil {
		// 配置不存在，创建新的
		config = models.AppConfig{
			Key:   key,
			Value: value,
		}
		return d.db.Create(&config).Error
	} else {
		// 配置存在，更新
		config.Value = value
		return d.db.Save(&config).Error
	}
}

// GetAllConfigs 获取所有配置
func (d *Database) GetAllConfigs() (map[string]string, error) {
	var configs []models.AppConfig
	err := d.db.Find(&configs).Error
	if err != nil {
		return nil, err
	}

	result := make(map[string]string)
	for _, config := range configs {
		result[config.Key] = config.Value
	}

	return result, nil
}

// DeleteConfig 删除配置
func (d *Database) DeleteConfig(key string) error {
	return d.db.Where("key = ?", key).Delete(&models.AppConfig{}).Error
}

// 统计相关操作

// GetStats 获取统计信息
func (d *Database) GetStats() (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// 会话统计
	var sessionCount int64
	if err := d.db.Model(&models.ChatSession{}).Count(&sessionCount).Error; err != nil {
		return nil, err
	}
	stats["total_sessions"] = sessionCount

	// 消息统计
	var messageCount int64
	if err := d.db.Model(&models.ChatMessage{}).Count(&messageCount).Error; err != nil {
		return nil, err
	}
	stats["total_messages"] = messageCount

	// 任务统计
	var taskCount int64
	if err := d.db.Model(&models.ExportTask{}).Count(&taskCount).Error; err != nil {
		return nil, err
	}
	stats["total_tasks"] = taskCount

	// 群聊统计
	var groupCount int64
	if err := d.db.Model(&models.ChatSession{}).Where("chat_type = ?", "group").Count(&groupCount).Error; err != nil {
		return nil, err
	}
	stats["group_sessions"] = groupCount

	// 好友聊天统计
	var friendCount int64
	if err := d.db.Model(&models.ChatSession{}).Where("chat_type = ?", "friend").Count(&friendCount).Error; err != nil {
		return nil, err
	}
	stats["friend_sessions"] = friendCount

	return stats, nil
}

// CheckConnection 检查数据库连接
func (d *Database) CheckConnection() error {
	sqlDB, err := d.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Ping()
}
