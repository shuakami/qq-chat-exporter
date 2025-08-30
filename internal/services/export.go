package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/client"
	"qq-chat-exporter/internal/config"
	"qq-chat-exporter/internal/database"
	"qq-chat-exporter/internal/models"

	"github.com/schollz/progressbar/v3"
	"go.uber.org/zap"
)

// ExportService 导出服务
type ExportService struct {
	napcatClient client.NapcatClientInterface
	db           *database.Database
	config       *config.Config
	logger       *zap.Logger
}

// NewExportService 创建新的导出服务
func NewExportService(napcatClient client.NapcatClientInterface, db *database.Database, cfg *config.Config, logger *zap.Logger) *ExportService {
	return &ExportService{
		napcatClient: napcatClient,
		db:           db,
		config:       cfg,
		logger:       logger,
	}
}

// ExportConfig 导出配置
type ExportConfig struct {
	ChatType     string     // "group" 或 "friend"
	ChatID       string     // 群号或QQ号
	ChatName     string     // 聊天名称（可选）
	MaxCount     int        // 最大消息数量，0表示全部
	ExportFormat string     // 导出格式: json, txt, html
	OutputDir    string     // 输出目录
	StartTime    *time.Time // 开始时间（可选）
	EndTime      *time.Time // 结束时间（可选）
}

// StartExport 开始导出聊天记录
func (s *ExportService) StartExport(ctx context.Context, config ExportConfig) error {
	cli.PrintTitle(fmt.Sprintf("开始导出%s聊天记录", s.getChatTypeName(config.ChatType)))
	cli.PrintInfo(fmt.Sprintf("聊天ID: %s", config.ChatID))
	cli.PrintInfo(fmt.Sprintf("导出格式: %s", strings.ToUpper(config.ExportFormat)))

	// 1. 创建或获取会话
	session, err := s.getOrCreateSession(config)
	if err != nil {
		return fmt.Errorf("创建会话失败: %w", err)
	}

	cli.PrintSuccess(fmt.Sprintf("会话已创建 (ID: %d)", session.ID))

	// 2. 开始采集消息
	cli.PrintStep(1, 3, "开始采集消息...")

	// 显示时间范围信息
	if config.StartTime != nil || config.EndTime != nil {
		if config.StartTime != nil {
			cli.PrintInfo(fmt.Sprintf("开始时间: %s", config.StartTime.Format("2006-01-02 15:04:05")))
		}
		if config.EndTime != nil {
			cli.PrintInfo(fmt.Sprintf("结束时间: %s", config.EndTime.Format("2006-01-02 15:04:05")))
		}
	}

	messageCount, err := s.collectMessages(ctx, session, config)
	if err != nil {
		return fmt.Errorf("采集消息失败: %w", err)
	}

	cli.PrintSuccess(fmt.Sprintf("消息采集完成，共采集 %d 条消息", messageCount))

	// 3. 创建导出任务
	cli.PrintStep(2, 3, "创建导出任务...")

	task, err := s.createExportTask(session.ID, config)
	if err != nil {
		return fmt.Errorf("创建导出任务失败: %w", err)
	}

	// 4. 执行导出
	cli.PrintStep(3, 3, "执行导出...")

	err = s.executeExport(ctx, task)
	if err != nil {
		return fmt.Errorf("导出失败: %w", err)
	}

	cli.PrintSuccess(fmt.Sprintf("导出完成！文件已保存到: %s", task.FilePath))

	return nil
}

// getOrCreateSession 获取或创建会话
func (s *ExportService) getOrCreateSession(config ExportConfig) (*models.ChatSession, error) {
	// 尝试获取现有会话
	session, err := s.db.GetSessionByChat(config.ChatType, config.ChatID)
	if err == nil {
		// 会话已存在，更新状态
		session.Status = "active"
		session.UpdatedAt = time.Now()
		if err := s.db.UpdateSession(session); err != nil {
			return nil, err
		}
		return session, nil
	}

	// 创建新会话
	session = &models.ChatSession{
		ChatType:    config.ChatType,
		ChatID:      config.ChatID,
		ChatName:    config.ChatName,
		Description: fmt.Sprintf("%s聊天记录", s.getChatTypeName(config.ChatType)),
		StartTime:   time.Now(),
		Status:      "active",
	}

	if err := s.db.CreateSession(session); err != nil {
		return nil, err
	}

	return session, nil
}

// collectMessages 采集消息
func (s *ExportService) collectMessages(ctx context.Context, session *models.ChatSession, config ExportConfig) (int, error) {
	var totalCollected int
	var messageSeq string
	var duplicateCount int // 序号未变化计数器

	// 设置信号处理，支持Ctrl+C优雅退出
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	// 实时保存定时器 - 每30秒自动保存一次
	autoSaveTicker := time.NewTicker(30 * time.Second)
	defer autoSaveTicker.Stop()

	// 记录上次自动保存的消息数量，避免重复保存
	lastAutoSaveCount := 0

	// 获取已有消息数量
	existingCount, err := s.db.GetMessageCount(session.ID)
	if err != nil {
		return 0, err
	}

	totalCollected = int(existingCount)

	// 如果已有消息，获取最新消息的序号
	if existingCount > 0 {
		latestMsg, err := s.db.GetLatestMessage(session.ID)
		if err == nil && latestMsg.NapcatMessageSeq != nil {
			messageSeq = strconv.FormatInt(*latestMsg.NapcatMessageSeq, 10)
		}
	}

	// 创建进度条
	var bar *progressbar.ProgressBar
	if config.MaxCount > 0 {
		bar = progressbar.NewOptions(config.MaxCount,
			progressbar.OptionSetDescription("采集消息"),
			progressbar.OptionSetWidth(50),
			progressbar.OptionShowCount(),
			progressbar.OptionSetTheme(progressbar.Theme{
				Saucer:        "█",
				SaucerPadding: "░",
				BarStart:      "[",
				BarEnd:        "]",
			}),
		)
	} else {
		// 无限制导出时创建一个显示计数的进度条
		bar = progressbar.NewOptions(-1,
			progressbar.OptionSetDescription("采集消息"),
			progressbar.OptionSetWidth(50),
			progressbar.OptionShowCount(),
			progressbar.OptionSpinnerType(14),
			progressbar.OptionSetTheme(progressbar.Theme{
				Saucer:        "█",
				SaucerPadding: "░",
				BarStart:      "[",
				BarEnd:        "]",
			}),
		)
	}

	// 开始采集循环
	for {
		// 优先检查中断信号，确保快速响应
		select {
		case sig := <-sigChan:
			s.logger.Warn("收到中断信号，正在优雅退出...", zap.String("signal", sig.String()))
			cli.PrintWarning("收到Ctrl+C，正在保存当前进度...")

			// 快速保存进度到数据库
			s.updateSessionProgress(session, totalCollected, "interrupted")

			// 异步导出临时文件（避免阻塞退出）
			go func() {
				tempFilePath := s.exportTempFile(session, config)
				if tempFilePath != "" {
					s.logger.Info("临时文件已保存", zap.String("path", tempFilePath))
				}
			}()

			cli.PrintInfo(fmt.Sprintf("已保存当前进度: %d条消息", totalCollected))
			return totalCollected, fmt.Errorf("用户中断")
		default:
		}

		// 检查自动保存（非阻塞）
		select {
		case <-autoSaveTicker.C:
			// 异步处理自动保存，避免阻塞主循环
			if totalCollected > lastAutoSaveCount && totalCollected > 0 {
				go func(count int, lastCount int) {
					s.logger.Info("自动保存进度", zap.Int("total_collected", count))
					s.updateSessionProgress(session, count, "running")

					// 每500条消息自动导出一次临时文件
					if count-lastCount >= 500 {
						suffix := fmt.Sprintf("AUTO_%d", count)
						tempFilePath := s.exportTempFileWithSuffix(session, config, suffix)
						if tempFilePath != "" {
							s.logger.Info("自动保存临时文件",
								zap.String("file", filepath.Base(tempFilePath)),
								zap.Int("messages", count))
						}
					}
				}(totalCollected, lastAutoSaveCount)
				lastAutoSaveCount = totalCollected
			}
		default:
		}

		// 检查是否达到最大数量
		if config.MaxCount > 0 && totalCollected >= config.MaxCount {
			break
		}

		// 获取一批消息
		var messages []models.Message
		var err error

		// 硬编码小批次大小以获得最佳性能
		// Napcat在小批量时响应很快（40-70ms），大批量时很慢
		const optimalBatchSize = 15
		batchSize := optimalBatchSize
		if config.MaxCount > 0 && config.MaxCount-totalCollected < batchSize {
			batchSize = config.MaxCount - totalCollected
		}

		if session.ChatType == "group" {
			req := &models.GroupMessageHistoryRequest{
				GroupID:      session.ChatID,
				MessageSeq:   messageSeq,
				Count:        batchSize,
				ReverseOrder: true,
			}

			resp, err := s.napcatClient.GetGroupMessageHistoryWithRetry(req, 3)
			if err != nil {
				return totalCollected, err
			}

			messages = resp.Data.Messages
		} else {
			req := &models.FriendMessageHistoryRequest{
				UserID:       session.ChatID,
				MessageSeq:   messageSeq,
				Count:        batchSize,
				ReverseOrder: true,
			}

			resp, err := s.napcatClient.GetFriendMessageHistoryWithRetry(req, 3)
			if err != nil {
				return totalCollected, err
			}

			messages = resp.Data.Messages
		}

		// 没有更多消息
		if len(messages) == 0 {
			s.logger.Info("没有更多消息，停止采集")
			break
		}

		// 时间范围过滤
		var filteredMessages []models.Message
		var outOfRangeCount int

		for _, msg := range messages {
			msgTime := time.Unix(msg.Time, 0)

			// 检查是否在时间范围内
			if config.StartTime != nil && msgTime.Before(*config.StartTime) {
				outOfRangeCount++
				s.logger.Debug("消息早于开始时间，跳过",
					zap.String("message_time", msgTime.Format("2006-01-02 15:04:05")),
					zap.String("start_time", config.StartTime.Format("2006-01-02 15:04:05")))
				continue
			}

			if config.EndTime != nil && msgTime.After(*config.EndTime) {
				outOfRangeCount++
				s.logger.Debug("消息晚于结束时间，跳过",
					zap.String("message_time", msgTime.Format("2006-01-02 15:04:05")),
					zap.String("end_time", config.EndTime.Format("2006-01-02 15:04:05")))
				continue
			}

			filteredMessages = append(filteredMessages, msg)
		}

		// 如果这批消息全部超出时间范围，且设置了结束时间，可能已经超过了时间范围
		if len(filteredMessages) == 0 && config.EndTime != nil && outOfRangeCount >= len(messages) {
			// 检查是否所有消息都晚于结束时间
			allAfterEnd := true
			for _, msg := range messages {
				msgTime := time.Unix(msg.Time, 0)
				if !msgTime.After(*config.EndTime) {
					allAfterEnd = false
					break
				}
			}

			if allAfterEnd {
				s.logger.Info("已到达时间范围末尾，停止采集")
				break
			}
		}

		// 如果没有有效消息，继续下一批
		if len(filteredMessages) == 0 {
			// 更新messageSeq继续获取（用第一条消息，与测试版本保持一致）
			if len(messages) > 0 {
				firstMessage := messages[0]
				messageSeq = strconv.FormatInt(firstMessage.MessageSeq, 10)
			}
			continue
		}

		// 先假设所有消息都是新的，让数据库处理重复
		newMessages := filteredMessages

		// 转换并保存消息
		dbMessages, err := s.convertMessages(newMessages, session.ID)
		if err != nil {
			s.logger.Error("转换消息失败", zap.Error(err))
			continue
		}

		savedCount := 0
		if len(dbMessages) > 0 {
			// 尝试保存消息，数据库会自动处理重复
			originalCount := totalCollected
			if err := s.db.CreateMessages(dbMessages); err != nil {
				s.logger.Error("保存消息失败", zap.Error(err))
				continue
			}

			// 查询实际保存的数量
			newCount, _ := s.db.GetMessageCount(session.ID)
			savedCount = int(newCount) - originalCount
			totalCollected = int(newCount)

			// 实时更新会话进度，确保数据不丢失（异步）
			if savedCount > 0 {
				go s.updateSessionProgress(session, totalCollected, "running")
			}
		}

		// 显示消息处理结果
		if len(filteredMessages) > 0 {
			firstMsg := filteredMessages[0]
			lastMsg := filteredMessages[len(filteredMessages)-1]
			s.logger.Info("本批消息时间范围",
				zap.String("最早", time.Unix(firstMsg.Time, 0).Format("2006-01-02 15:04:05")),
				zap.String("最晚", time.Unix(lastMsg.Time, 0).Format("2006-01-02 15:04:05")),
				zap.Int("消息数", len(filteredMessages)),
				zap.Int("新保存", savedCount))
		}

		// 更新进度条
		if bar != nil {
			if config.MaxCount > 0 {
				bar.Set(totalCollected)
				// 如果达到最大数量，确保进度条后换行
				if totalCollected >= config.MaxCount {
					fmt.Println()
				}
			} else {
				// 无限制导出时只增加计数
				bar.Add(savedCount)
			}
		}

		// 显示保存结果，但不在这里处理重复检测
		// 重复检测逻辑移到messageSeq检查部分
		if savedCount == 0 {
			s.logger.Debug("本批没有新消息保存到数据库",
				zap.Int("total_messages", len(filteredMessages)))
		}

		// 更新messageSeq为第一条消息的序号，用于获取更早的历史消息
		if len(filteredMessages) > 0 {
			firstMessage := filteredMessages[0]
			newMessageSeq := strconv.FormatInt(firstMessage.MessageSeq, 10)

			// 检查是否真的是新的序号
			if newMessageSeq == messageSeq {
				s.logger.Warn("消息序号未变化，可能到达历史末尾",
					zap.String("messageSeq", messageSeq),
					zap.Int("duplicate_count", duplicateCount))
				duplicateCount++
				if duplicateCount >= 3 {
					s.logger.Info("连续多批序号未变化，停止采集")
					break
				}
			} else {
				messageSeq = newMessageSeq
				duplicateCount = 0 // 序号有变化，重置计数器
			}

			s.logger.Info("消息序号更新",
				zap.String("messageSeq", messageSeq),
				zap.Int("本批消息数", len(filteredMessages)),
				zap.Int("新保存数", savedCount))
		}

		if len(messages) == 0 {
			// 只在空结果时稍微延迟
			time.Sleep(20 * time.Millisecond)
		}
		// 其他情况立即继续，最大化吞吐量
	}

	if bar != nil {
		bar.Finish()
		fmt.Println() // 确保进度条后有换行
	}

	// 更新会话信息
	session.MessageCount = totalCollected
	session.EndTime = &time.Time{}
	*session.EndTime = time.Now()
	session.Status = "completed"

	// 异步更新最终状态，避免阻塞返回
	go func() {
		if err := s.db.UpdateSession(session); err != nil {
			s.logger.Error("更新会话失败", zap.Error(err))
		}
	}()

	return totalCollected, nil
}

// convertMessages 转换Napcat消息为数据库消息
func (s *ExportService) convertMessages(napcatMessages []models.Message, sessionID uint) ([]models.ChatMessage, error) {
	var dbMessages []models.ChatMessage

	for _, msg := range napcatMessages {
		// 序列化完整的原始响应
		rawResponse, err := json.Marshal(msg)
		if err != nil {
			s.logger.Error("序列化原始响应失败", zap.Error(err))
			continue
		}

		// 序列化发送者信息
		senderData, err := json.Marshal(msg.Sender)
		if err != nil {
			s.logger.Error("序列化发送者信息失败", zap.Error(err))
			continue
		}

		// 序列化消息内容
		messageContent, err := json.Marshal(msg.Message)
		if err != nil {
			s.logger.Error("序列化消息内容失败", zap.Error(err))
			continue
		}

		dbMessage := models.ChatMessage{
			SessionID:        sessionID,
			NapcatSelfID:     &msg.SelfID,
			NapcatUserID:     &msg.UserID,
			NapcatTime:       &msg.Time,
			NapcatMessageID:  &msg.MessageID,
			NapcatMessageSeq: &msg.MessageSeq,
			NapcatRealID:     &msg.RealID,
			NapcatGroupID:    msg.GroupID,
			MessageType:      msg.MessageType,
			SubType:          msg.SubType,
			RawMessage:       msg.RawMessage,
			Font:             &msg.Font,
			MessageFormat:    msg.MessageFormat,
			PostType:         msg.PostType,
			MessageSentType:  msg.MessageSentType,
			SenderData:       string(senderData),
			MessageContent:   string(messageContent),
			RawResponse:      string(rawResponse),
		}

		dbMessages = append(dbMessages, dbMessage)
	}

	return dbMessages, nil
}

// createExportTask 创建导出任务
func (s *ExportService) createExportTask(sessionID uint, config ExportConfig) (*models.ExportTask, error) {
	// 确保输出目录存在
	if err := os.MkdirAll(config.OutputDir, 0755); err != nil {
		return nil, fmt.Errorf("创建输出目录失败: %w", err)
	}

	// 生成文件名
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s_%s.%s", config.ChatType, config.ChatID, timestamp, config.ExportFormat)
	filePath := filepath.Join(config.OutputDir, filename)

	task := &models.ExportTask{
		SessionID:       sessionID,
		TaskName:        fmt.Sprintf("导出%s聊天记录", s.getChatTypeName(config.ChatType)),
		ExportType:      config.ExportFormat,
		FilePath:        filePath,
		Status:          "pending",
		Progress:        0,
		StartTime:       time.Now(),
		FilterStartTime: config.StartTime,
		FilterEndTime:   config.EndTime,
	}

	if err := s.db.CreateExportTask(task); err != nil {
		return nil, err
	}

	return task, nil
}

// executeExport 执行导出
func (s *ExportService) executeExport(ctx context.Context, task *models.ExportTask) error {
	// 更新任务状态
	task.Status = "running"
	task.Progress = 0
	if err := s.db.UpdateExportTask(task); err != nil {
		return err
	}

	// 获取消息（根据时间范围过滤）
	var messages []models.ChatMessage
	var err error

	if task.FilterStartTime != nil || task.FilterEndTime != nil {
		// 有时间范围过滤，使用时间范围查询
		messages, err = s.db.GetMessagesInTimeRange(task.SessionID, task.FilterStartTime, task.FilterEndTime, 0, 0)
		if err != nil {
			task.Status = "failed"
			task.ErrorMsg = fmt.Sprintf("查询时间范围内消息失败: %v", err)
			s.db.UpdateExportTask(task)
			return err
		}

		s.logger.Info("根据时间范围查询消息",
			zap.Uint("session_id", task.SessionID),
			zap.Int("message_count", len(messages)),
			zap.Any("start_time", task.FilterStartTime),
			zap.Any("end_time", task.FilterEndTime))
	} else {
		// 没有时间范围过滤，获取所有消息
		messages, err = s.db.GetMessages(task.SessionID, 0, 0)
		if err != nil {
			task.Status = "failed"
			task.ErrorMsg = fmt.Sprintf("查询消息失败: %v", err)
			s.db.UpdateExportTask(task)
			return err
		}

		s.logger.Info("查询所有消息",
			zap.Uint("session_id", task.SessionID),
			zap.Int("message_count", len(messages)))
	}

	// 根据格式导出
	switch task.ExportType {
	case "json":
		err = s.exportToJSON(messages, task.FilePath)
	case "txt":
		err = s.exportToTXT(messages, task.FilePath)
	case "html":
		err = s.exportToHTML(messages, task.FilePath)
	default:
		err = fmt.Errorf("不支持的导出格式: %s", task.ExportType)
	}

	// 更新任务状态
	if err != nil {
		task.Status = "failed"
		task.ErrorMsg = err.Error()
		task.Progress = 0
	} else {
		task.Status = "completed"
		task.Progress = 100
		endTime := time.Now()
		task.EndTime = &endTime
	}

	return s.db.UpdateExportTask(task)
}

// exportToJSON 导出为JSON格式
func (s *ExportService) exportToJSON(messages []models.ChatMessage, filePath string) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	exportData := map[string]interface{}{
		"export_time":    time.Now().Format("2006-01-02 15:04:05"),
		"export_version": "3.0.0",
		"message_count":  len(messages),
		"messages":       messages,
	}

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(exportData)
}

// exportToTXT 导出为TXT格式
func (s *ExportService) exportToTXT(messages []models.ChatMessage, filePath string) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// 写入头部
	header := fmt.Sprintf("QQ Chat Exporter Pro V3.0\n导出时间: %s\n消息数量: %d\n\n%s\n\n",
		time.Now().Format("2006-01-02 15:04:05"),
		len(messages),
		strings.Repeat("=", 60),
	)
	if _, err := file.WriteString(header); err != nil {
		return err
	}

	// 写入消息
	for _, msg := range messages {
		line := fmt.Sprintf("[%s] %s: %s\n",
			msg.GetTimeString(),
			msg.GetDisplayName(),
			msg.ContentPreview,
		)
		if _, err := file.WriteString(line); err != nil {
			return err
		}
	}

	return nil
}

// exportToHTML 导出为HTML格式
func (s *ExportService) exportToHTML(messages []models.ChatMessage, filePath string) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// 计算时间范围
	var startTime, endTime *time.Time
	if len(messages) > 0 {
		startTime = &messages[0].ParsedTime
		endTime = &messages[len(messages)-1].ParsedTime
	}

	// 写入HTML头部和样式
	if err := s.writeHTMLHeader(file, len(messages), startTime, endTime); err != nil {
		return err
	}

	// 写入消息
	for _, msg := range messages {
		messageHTML := s.renderMessage(msg)
		if _, err := file.WriteString(messageHTML); err != nil {
			return err
		}
	}

	// HTML尾部
	footer := `
        </div>
    </div>
    
    <!-- 图片预览模态框 -->
    <div id="imageModal" class="image-modal">
        <img id="modalImage" src="" alt="预览图片">
    </div>
</body>
</html>`

	_, err = file.WriteString(footer)
	return err
}

// writeHTMLHeader 写入HTML头部和CSS样式
func (s *ExportService) writeHTMLHeader(file *os.File, messageCount int, startTime, endTime *time.Time) error {
	// 构建时间范围字符串
	var timeRangeStr string
	if startTime != nil && endTime != nil {
		timeRangeStr = fmt.Sprintf(`<div class="subtitle">时间范围: %s 至 %s</div>`,
			startTime.Format("2006-01-02 15:04:05"),
			endTime.Format("2006-01-02 15:04:05"))
	}

	htmlPart1 := `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QQ Chat Exporter Pro - 聊天记录</title>
    <style>
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: #ffffff;
            color: #1d1d1f;
            line-height: 1.47;
            font-size: 17px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            min-height: 100vh;
            background: #ffffff;
        }
        
        .header {
            padding: 44px 0 32px;
            text-align: center;
            border-bottom: 1px solid #f5f5f7;
        }
        
        .header h1 {
            font-size: 48px;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 8px;
            letter-spacing: -0.022em;
        }
        
        .header .subtitle {
            font-size: 21px;
            color: #86868b;
            font-weight: 400;
            margin-bottom: 16px;
        }
        
        .github-link {
            margin-top: 16px;
        }
        
        .github-star {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #007aff;
            color: white;
            text-decoration: none;
            padding: 12px 24px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        
        .github-star:hover {
            background: #0056d3;
            text-decoration: none;
            color: white;
            transform: translateY(-1px);
        }
        
        .export-info {
            padding: 24px 0;
            text-align: center;
            background: #fbfbfd;
        }
        
        .info-grid {
            display: flex;
            justify-content: center;
            gap: 48px;
            flex-wrap: wrap;
        }
        
        .info-item {
            text-align: center;
        }
        
        .info-label {
            font-size: 14px;
            color: #86868b;
            margin-bottom: 4px;
            font-weight: 400;
        }
        
        .info-value {
            font-size: 17px;
            color: #1d1d1f;
            font-weight: 500;
        }
        
        .chat-content {
            padding: 32px 24px;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .message {
            margin-bottom: 16px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            clear: both;
        }
        
        .message.self {
            flex-direction: row-reverse;
            justify-content: flex-start;
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #f5f5f7;
            flex-shrink: 0;
        }
        
        .message-bubble {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            position: relative;
        }
        
        .message.other .message-bubble {
            background: #f5f5f7;
            color: #1d1d1f;
        }
        
        .message.self .message-bubble {
            background: #007aff;
            color: #ffffff;
        }
        
        .message-header {
            margin-bottom: 8px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .sender {
            font-size: 14px;
            font-weight: 500;
            line-height: 1.2;
        }
        
        .message.other .sender {
            color: #86868b;
        }
        
        .message.self .sender {
            color: rgba(255, 255, 255, 0.8);
        }
        
        .time {
            font-size: 11px;
            opacity: 0.6;
            line-height: 1.2;
        }
        
        .content {
            font-size: 16px;
            line-height: 1.5;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        .text-content {
            display: inline;
            word-wrap: break-word;
        }
        
        .image-content {
            margin: 8px 0;
            border-radius: 12px;
            overflow: hidden;
            max-width: 300px;
        }
        
        .image-content img {
            width: 100%;
            height: auto;
            display: block;
            cursor: pointer;
        }
        
        .at-mention {
            background: rgba(0, 122, 255, 0.1);
            color: #007aff;
            padding: 2px 6px;
            border-radius: 6px;
            font-weight: 500;
            display: inline;
        }
        
        .message.self .at-mention {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }
        
        .face-emoji {
            display: inline;
            font-size: 18px;
            margin: 0 2px;
            vertical-align: baseline;
        }
        
        .reply-content {
            border-left: 3px solid #007aff;
            padding-left: 12px;
            margin: 8px 0;
            opacity: 0.8;
            font-size: 15px;
        }
        
        .message.self .reply-content {
            border-left-color: rgba(255, 255, 255, 0.6);
        }
        
        /* 滚动条 */
        ::-webkit-scrollbar {
            width: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #d1d1d6;
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #c7c7cc;
        }
        
        /* 图片预览 */
        .image-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            cursor: pointer;
        }
        
        .image-modal img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90vw;
            max-height: 90vh;
            object-fit: contain;
        }
        
        /* 响应式 */
        @media (max-width: 768px) {
            .header h1 {
                font-size: 32px;
            }
            
            .header .subtitle {
                font-size: 17px;
            }
            
            .info-grid {
                gap: 24px;
            }
            
            .chat-content {
                padding: 24px 16px;
            }
            
            .message-bubble {
                max-width: 85%;
            }
        }
    </style>
    <script>
        function showImageModal(imgSrc) {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            const modal = document.getElementById('imageModal');
            modal.addEventListener('click', hideImageModal);
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    hideImageModal();
                }
            });
        });
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>QQ Chat Exporter Pro</h1>
            <div class="subtitle">聊天记录导出</div>
            <div class="github-link">
                <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank" class="github-star">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 13.125l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.192L.644 6.374a.75.75 0 01.416-1.28l4.21-.612L7.327.668A.75.75 0 018 .25z"></path>
                    </svg>
                    给我个 Star 吧~
                </a>
            </div>
        </div>
        <div class="export-info">
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">导出时间</div>
                    <div class="info-value">` + time.Now().Format("2006-01-02 15:04:05") + `</div>
                </div>
                <div class="info-item">
                    <div class="info-label">消息总数</div>
                    <div class="info-value">` + fmt.Sprintf("%d", messageCount) + `</div>
                </div>
                <div class="info-item">
                    <div class="info-label">导出格式</div>
                    <div class="info-value">HTML</div>
                </div>` +
		func() string {
			if timeRangeStr != "" {
				return `
                <div class="info-item">
                    <div class="info-label">时间范围</div>
                    <div class="info-value">` +
					func() string {
						if startTime != nil && endTime != nil {
							return startTime.Format("2006-01-02") + " 至 " + endTime.Format("2006-01-02")
						}
						return ""
					}() + `</div>
                </div>`
			}
			return ""
		}() + `
            </div>
        </div>
        <div class="chat-content">
`

	_, err := file.WriteString(htmlPart1)
	return err
}

// getQQAvatar 获取QQ头像URL
func (s *ExportService) getQQAvatar(qqNumber string) string {
	// 直接使用QQ官方头像接口
	return fmt.Sprintf("http://q.qlogo.cn/g?b=qq&nk=%s&s=100", qqNumber)
}

// renderMessage 渲染单条消息
func (s *ExportService) renderMessage(msg models.ChatMessage) string {
	// 判断是否为自己发送的消息
	var isSelf bool
	if msg.NapcatSelfID != nil && msg.NapcatUserID != nil {
		isSelf = *msg.NapcatSelfID == *msg.NapcatUserID
	}

	cssClass := "other"
	if isSelf {
		cssClass = "self"
	}

	// 获取QQ号用于头像
	var qqNumber string
	if msg.NapcatUserID != nil {
		qqNumber = fmt.Sprintf("%d", *msg.NapcatUserID)
	}

	// 获取头像URL
	avatarURL := s.getQQAvatar(qqNumber)

	// 解析消息内容
	content := s.parseMessageContent(msg.MessageContent)

	return fmt.Sprintf(`
        <div class="message %s">
            <img class="avatar" src="%s" alt="头像" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNGNUY1RjciLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNiIgcj0iNiIgZmlsbD0iIzg2ODY4QiIvPgo8cGF0aCBkPSJNOCAzMkM4IDI2LjQ3NzIgMTIuNDc3MiAyMiAxOCAyMkMyMy41MjI4IDIyIDI4IDI2LjQ3NzIgMjggMzJIMzIuNDAwOUMzMi40MDA5IDI0LjI2OCAyNi4xMzI5IDE4IDIwIDE4QzEzLjg2NzEgMTggNy41OTkxMyAyNC4yNjggNy41OTkxMyAzMkg4WiIgZmlsbD0iIzg2ODY4QiIvPgo8L3N2Zz4K'">
            <div class="message-bubble">
                <div class="message-header">
                    <span class="sender">%s</span>
                    <span class="time">%s</span>
                </div>
                <div class="content">%s</div>
            </div>
        </div>`,
		cssClass,
		avatarURL,
		msg.GetDisplayName(),
		msg.GetTimeString(),
		content,
	)
}

// parseMessageContent 解析消息内容
func (s *ExportService) parseMessageContent(messageContent string) string {
	if messageContent == "" {
		return `<span class="text-content">[空消息]</span>`
	}

	// 尝试解析为JSON数组
	var messageArray []map[string]interface{}
	if err := json.Unmarshal([]byte(messageContent), &messageArray); err != nil {
		// 如果解析失败，返回原始内容
		return fmt.Sprintf(`<span class="text-content">%s</span>`, messageContent)
	}

	var result strings.Builder
	for _, msgPart := range messageArray {
		msgType, ok := msgPart["type"].(string)
		if !ok {
			continue
		}

		data, _ := msgPart["data"].(map[string]interface{})

		switch msgType {
		case "text":
			result.WriteString(s.renderTextMessage(data))
		case "at":
			result.WriteString(s.renderAtMessage(data))
		case "image":
			result.WriteString(s.renderImageMessage(data))
		case "face":
			result.WriteString(s.renderFaceMessage(data))
		case "json":
			result.WriteString(s.renderJsonMessage(data))
		case "record":
			result.WriteString(s.renderRecordMessage(data))
		case "video":
			result.WriteString(s.renderVideoMessage(data))
		case "reply":
			result.WriteString(s.renderReplyMessage(data))
		case "music":
			result.WriteString(s.renderMusicMessage(data))
		case "dice":
			result.WriteString(s.renderDiceMessage())
		case "rps":
			result.WriteString(s.renderRpsMessage())
		case "file":
			result.WriteString(s.renderFileMessage(data))
		case "node":
			result.WriteString(s.renderNodeMessage(data))
		default:
			result.WriteString(fmt.Sprintf(`<span class="text-content">[未知消息类型: %s]</span>`, msgType))
		}
	}

	if result.Len() == 0 {
		return `<span class="text-content">[空消息]</span>`
	}

	return result.String()
}

// renderTextMessage 渲染文本消息
func (s *ExportService) renderTextMessage(data map[string]interface{}) string {
	text, _ := data["text"].(string)
	if text == "" {
		return ""
	}
	return fmt.Sprintf(`<span class="text-content">%s</span>`, text)
}

// renderAtMessage 渲染@消息
func (s *ExportService) renderAtMessage(data map[string]interface{}) string {
	qq, _ := data["qq"].(string)
	if qq == "all" {
		return `<span class="at-mention">@全体成员</span>`
	}
	return fmt.Sprintf(`<span class="at-mention">@%s</span>`, qq)
}

// renderImageMessage 渲染图片消息
func (s *ExportService) renderImageMessage(data map[string]interface{}) string {
	// 优先使用url字段
	url, hasURL := data["url"].(string)
	if hasURL && url != "" {
		return fmt.Sprintf(`<div class="image-content"><img src="%s" alt="图片" loading="lazy" onclick="showImageModal('%s')"></div>`, url, url)
	}

	// 如果没有url，尝试使用file字段
	file, hasFile := data["file"].(string)
	if hasFile && file != "" && strings.HasPrefix(file, "http") {
		return fmt.Sprintf(`<div class="image-content"><img src="%s" alt="图片" loading="lazy" onclick="showImageModal('%s')"></div>`, file, file)
	}

	// 如果都没有有效URL，显示文件名或占位符
	if hasFile && file != "" {
		return fmt.Sprintf(`<span class="text-content">📷 %s</span>`, file)
	}

	return `<span class="text-content">📷 图片</span>`
}

// renderFaceMessage 渲染表情消息
func (s *ExportService) renderFaceMessage(data map[string]interface{}) string {
	id, _ := data["id"].(float64)
	// QQ表情ID对应的emoji
	emojiMap := map[int]string{
		0: "😀", 1: "😁", 2: "😂", 3: "😃", 4: "😄", 5: "😅", 6: "😆", 7: "😉", 8: "😊", 9: "😋",
		10: "😎", 11: "😍", 12: "😘", 13: "😗", 14: "😙", 15: "😚", 16: "😇", 17: "😐", 18: "😑", 19: "😶",
	}

	if emoji, ok := emojiMap[int(id)]; ok {
		return fmt.Sprintf(`<span class="face-emoji">%s</span>`, emoji)
	}

	return fmt.Sprintf(`<span class="face-emoji">[表情%d]</span>`, int(id))
}

// renderJsonMessage 渲染JSON卡片消息
func (s *ExportService) renderJsonMessage(data map[string]interface{}) string {
	return `<span class="text-content">📄 卡片消息</span>`
}

// renderRecordMessage 渲染语音消息
func (s *ExportService) renderRecordMessage(data map[string]interface{}) string {
	return `<span class="text-content">🎤 语音消息</span>`
}

// renderVideoMessage 渲染视频消息
func (s *ExportService) renderVideoMessage(data map[string]interface{}) string {
	return `<span class="text-content">🎬 视频消息</span>`
}

// renderReplyMessage 渲染回复消息
func (s *ExportService) renderReplyMessage(data map[string]interface{}) string {
	return `<div class="reply-content">回复消息</div>`
}

// renderMusicMessage 渲染音乐消息
func (s *ExportService) renderMusicMessage(data map[string]interface{}) string {
	musicType, _ := data["type"].(string)
	if musicType == "custom" {
		title, _ := data["title"].(string)
		if title != "" {
			return fmt.Sprintf(`<span class="text-content">🎵 %s</span>`, title)
		}
	}
	return `<span class="text-content">🎵 音乐分享</span>`
}

// renderDiceMessage 渲染掷骰子消息
func (s *ExportService) renderDiceMessage() string {
	return `<span class="text-content">🎲 掷骰子</span>`
}

// renderRpsMessage 渲染猜拳消息
func (s *ExportService) renderRpsMessage() string {
	return `<span class="text-content">✂️ 猜拳</span>`
}

// renderFileMessage 渲染文件消息
func (s *ExportService) renderFileMessage(data map[string]interface{}) string {
	return `<span class="text-content">📎 文件</span>`
}

// renderNodeMessage 渲染消息节点
func (s *ExportService) renderNodeMessage(data map[string]interface{}) string {
	return `<span class="text-content">📝 转发消息</span>`
}

// getChatTypeName 获取聊天类型名称
func (s *ExportService) getChatTypeName(chatType string) string {
	switch chatType {
	case "group":
		return "群聊"
	case "friend":
		return "好友"
	default:
		return "未知"
	}
}

// GetExportHistory 获取导出历史
func (s *ExportService) GetExportHistory() ([]models.ExportTask, error) {
	return s.db.GetExportTasks()
}

// GetSessionHistory 获取会话历史
func (s *ExportService) GetSessionHistory() ([]models.ChatSession, error) {
	return s.db.GetAllSessions()
}

// DeleteSession 删除会话
func (s *ExportService) DeleteSession(sessionID uint) error {
	return s.db.DeleteSession(sessionID)
}

// DeleteExportTask 删除导出任务
func (s *ExportService) DeleteExportTask(taskID uint) error {
	return s.db.DeleteExportTask(taskID)
}

// CreateExportTaskFromSession 从已存在的会话创建导出任务
func (s *ExportService) CreateExportTaskFromSession(sessionID uint, config ExportConfig) (*models.ExportTask, error) {
	// 获取会话信息
	session, err := s.db.GetSession(sessionID)
	if err != nil {
		return nil, fmt.Errorf("获取会话失败: %w", err)
	}

	// 生成文件路径
	filename := fmt.Sprintf("%s_%s_%s.%s",
		session.ChatType,
		session.ChatID,
		time.Now().Format("20060102_150405"),
		config.ExportFormat,
	)

	outputDir := s.config.Export.OutputDir
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("创建输出目录失败: %w", err)
	}

	filePath := filepath.Join(outputDir, filename)

	// 创建导出任务
	task := &models.ExportTask{
		SessionID:  sessionID,
		ExportType: config.ExportFormat,
		FilePath:   filePath,
		Status:     "created",
		Progress:   0,
		StartTime:  time.Now(),
	}

	if err := s.db.CreateExportTask(task); err != nil {
		return nil, fmt.Errorf("创建导出任务失败: %w", err)
	}

	return task, nil
}

// ExecuteExportFromTask 执行导出任务而不重新采集消息
func (s *ExportService) ExecuteExportFromTask(ctx context.Context, task *models.ExportTask) error {
	// 更新任务状态
	task.Status = "running"
	task.Progress = 0
	if err := s.db.UpdateExportTask(task); err != nil {
		return err
	}

	// 获取消息
	messages, err := s.db.GetMessages(task.SessionID, 0, 0)
	if err != nil {
		task.Status = "failed"
		task.ErrorMsg = err.Error()
		s.db.UpdateExportTask(task)
		return err
	}

	// 根据格式导出
	switch task.ExportType {
	case "json":
		err = s.exportToJSON(messages, task.FilePath)
	case "txt":
		err = s.exportToTXT(messages, task.FilePath)
	case "html":
		err = s.exportToHTML(messages, task.FilePath)
	default:
		err = fmt.Errorf("不支持的导出格式: %s", task.ExportType)
	}

	// 更新任务状态
	if err != nil {
		task.Status = "failed"
		task.ErrorMsg = err.Error()
		task.Progress = 0
	} else {
		task.Status = "completed"
		task.Progress = 100
		endTime := time.Now()
		task.EndTime = &endTime
	}

	return s.db.UpdateExportTask(task)
}

// updateSessionProgress 实时更新会话进度
func (s *ExportService) updateSessionProgress(session *models.ChatSession, messageCount int, status string) {
	// 创建副本避免竞态条件
	sessionCopy := *session
	sessionCopy.MessageCount = messageCount
	sessionCopy.Status = status
	now := time.Now()
	sessionCopy.EndTime = &now

	// 异步更新数据库，避免阻塞主流程
	go func() {
		if err := s.db.UpdateSession(&sessionCopy); err != nil {
			s.logger.Error("更新会话进度失败", zap.Error(err))
		}
	}()

	// 更新内存中的session状态
	session.MessageCount = messageCount
	session.Status = status
	session.EndTime = &now
}

// exportTempFile 导出临时文件
func (s *ExportService) exportTempFile(session *models.ChatSession, config ExportConfig) string {
	return s.exportTempFileWithSuffix(session, config, "TEMP")
}

// exportTempFileWithSuffix 导出临时文件（带自定义后缀）
func (s *ExportService) exportTempFileWithSuffix(session *models.ChatSession, config ExportConfig, suffix string) string {
	// 获取当前已采集的所有消息
	messages, err := s.db.GetMessages(session.ID, 0, 0)
	if err != nil {
		s.logger.Error("获取消息失败", zap.Error(err))
		return ""
	}

	if len(messages) == 0 {
		s.logger.Warn("没有消息可导出")
		return ""
	}

	// 确保输出目录存在
	if err := os.MkdirAll(config.OutputDir, 0755); err != nil {
		s.logger.Error("创建输出目录失败", zap.Error(err))
		return ""
	}

	// 生成临时文件名（包含更精确的时间戳）
	timestamp := time.Now().Format("20060102_150405_000")
	filename := fmt.Sprintf("%s_%s_%s_%s.%s", config.ChatType, config.ChatID, timestamp, suffix, config.ExportFormat)
	filePath := filepath.Join(config.OutputDir, filename)

	// 根据格式导出
	switch config.ExportFormat {
	case "json":
		err = s.exportToJSON(messages, filePath)
	case "txt":
		err = s.exportToTXT(messages, filePath)
	case "html":
		err = s.exportToHTML(messages, filePath)
	default:
		// 默认导出为HTML，最直观
		filename = fmt.Sprintf("%s_%s_%s_%s.html", config.ChatType, config.ChatID, timestamp, suffix)
		filePath = filepath.Join(config.OutputDir, filename)
		err = s.exportToHTML(messages, filePath)
	}

	if err != nil {
		s.logger.Error("导出临时文件失败", zap.Error(err))
		return ""
	}

	return filePath
}
