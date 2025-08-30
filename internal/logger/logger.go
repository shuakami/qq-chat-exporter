package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/config"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

// 定义统一的日志输出函数，使用CLI风格
func logWithStyle(level, message string, fields ...zap.Field) {
	// 提取所有字段信息
	fieldMap := make(map[string]interface{})
	for _, field := range fields {
		switch field.Type {
		case zapcore.StringType:
			fieldMap[field.Key] = field.String
		case zapcore.Int64Type, zapcore.Int32Type, zapcore.Int16Type, zapcore.Int8Type:
			fieldMap[field.Key] = field.Integer
		case zapcore.DurationType:
			// Duration类型需要特殊处理
			if field.Integer != 0 {
				duration := time.Duration(field.Integer)
				fieldMap[field.Key] = duration.String()
			} else {
				fieldMap[field.Key] = "0s"
			}
		case zapcore.BoolType:
			if field.Integer == 1 {
				fieldMap[field.Key] = true
			} else {
				fieldMap[field.Key] = false
			}
		default:
			fieldMap[field.Key] = field.Interface
		}
	}

	// 构建输出消息，显示所有字段
	output := message
	for key, value := range fieldMap {
		switch key {
		case "connection_id":
			output += fmt.Sprintf(" (连接:%v)", value)
		case "remote_addr":
			output += fmt.Sprintf(" [地址:%v]", value)
		case "error":
			output += fmt.Sprintf(" [错误:%v]", value)
		case "echo":
			output += fmt.Sprintf(" [请求ID:%v]", value)
		case "action":
			output += fmt.Sprintf(" [动作:%v]", value)
		case "timeout", "设置超时时间", "实际耗时", "耗时":
			output += fmt.Sprintf(" [%s:%v]", key, value)
		case "status", "状态":
			output += fmt.Sprintf(" [状态:%v]", value)
		case "retcode", "返回码":
			output += fmt.Sprintf(" [返回码:%v]", value)
		case "message", "消息", "超时原因", "分析":
			output += fmt.Sprintf(" [%s:%v]", key, value)
		case "等待队列中请求数", "当前等待队列中请求数", "pending_requests_count":
			output += fmt.Sprintf(" [队列:%v]", value)
		case "完整请求JSON", "完整响应JSON", "完整消息JSON", "response_message":
			// 对于JSON数据，单独一行显示
			if level == "WARN" || level == "ERROR" {
				output += fmt.Sprintf("\n    JSON数据: %v", value)
			}
		default:
			output += fmt.Sprintf(" [%s:%v]", key, value)
		}
	}

	// 根据级别使用不同的输出函数
	switch level {
	case "INFO":
		cli.PrintInfo(output)
	case "WARN":
		cli.PrintWarning(output)
	case "ERROR":
		cli.PrintError(output)
	case "DEBUG":
		cli.PrintInfo("调试: " + output)
	default:
		cli.PrintInfo(output)
	}
}

// New 创建新的日志记录器
func New(cfg *config.LogConfig) (*zap.Logger, error) {
	// 设置日志级别
	level, err := zapcore.ParseLevel(cfg.Level)
	if err != nil {
		level = zapcore.InfoLevel
	}

	// 创建编码器配置 - 使用Console格式以匹配CLI输出风格
	encoderConfig := zap.NewDevelopmentEncoderConfig()
	encoderConfig.TimeKey = ""     // 不显示时间戳，保持简洁
	encoderConfig.LevelKey = ""    // 不显示级别，使用中文标签
	encoderConfig.CallerKey = ""   // 不显示调用者信息
	encoderConfig.MessageKey = "M" // 简化消息键
	encoderConfig.StacktraceKey = ""
	encoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	encoderConfig.EncodeName = zapcore.FullNameEncoder
	encoderConfig.ConsoleSeparator = " "

	// 创建自定义核心，用于拦截日志并使用统一风格
	var core zapcore.Core = &unifiedCore{
		level: level,
		cfg:   cfg,
	}

	// 如果需要同时写入文件，创建文件core
	if cfg.Output == "file" || cfg.Output == "both" {
		// 确保日志目录存在
		logDir := filepath.Dir(cfg.Filename)
		if err := os.MkdirAll(logDir, 0755); err != nil {
			return nil, err
		}

		// 配置日志轮转
		lumberJackLogger := &lumberjack.Logger{
			Filename:   cfg.Filename,
			MaxSize:    cfg.MaxSize, // MB
			MaxBackups: cfg.MaxBackups,
			MaxAge:     cfg.MaxAge, // days
			Compress:   cfg.Compress,
		}

		// 创建文件编码器（保持JSON格式用于文件记录）
		fileEncoderConfig := zap.NewProductionEncoderConfig()
		fileEncoderConfig.TimeKey = "timestamp"
		fileEncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		fileEncoder := zapcore.NewJSONEncoder(fileEncoderConfig)

		fileCore := zapcore.NewCore(
			fileEncoder,
			zapcore.AddSync(lumberJackLogger),
			level,
		)

		// 合并控制台和文件core
		core = &combinedCore{
			consoleCore: core,
			fileCore:    fileCore,
		}
	}

	// 创建日志记录器
	logger := zap.New(core)

	// 在开发模式下添加调用者信息和堆栈跟踪
	if cfg.Level == "debug" {
		logger = logger.WithOptions(
			zap.AddCaller(),
			zap.AddStacktrace(zapcore.ErrorLevel),
		)
	}

	return logger, nil
}

// NewDevelopment 创建开发环境日志记录器
func NewDevelopment() (*zap.Logger, error) {
	config := zap.NewDevelopmentConfig()
	config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	return config.Build()
}

// NewProduction 创建生产环境日志记录器
func NewProduction() (*zap.Logger, error) {
	return zap.NewProduction()
}

// unifiedCore 实现zapcore.Core接口，用于统一日志输出风格
type unifiedCore struct {
	level zapcore.Level
	cfg   *config.LogConfig
}

func (c *unifiedCore) Enabled(level zapcore.Level) bool {
	return c.level.Enabled(level)
}

func (c *unifiedCore) With(fields []zapcore.Field) zapcore.Core {
	return &unifiedCore{
		level: c.level,
		cfg:   c.cfg,
	}
}

func (c *unifiedCore) Check(entry zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(entry.Level) {
		return ce.AddCore(entry, c)
	}
	return ce
}

func (c *unifiedCore) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	levelStr := entry.Level.CapitalString()
	logWithStyle(levelStr, entry.Message, fields...)
	return nil
}

func (c *unifiedCore) Sync() error {
	return nil
}

// combinedCore 组合控制台和文件输出
type combinedCore struct {
	consoleCore zapcore.Core
	fileCore    zapcore.Core
}

func (c *combinedCore) Enabled(level zapcore.Level) bool {
	return c.consoleCore.Enabled(level) || c.fileCore.Enabled(level)
}

func (c *combinedCore) With(fields []zapcore.Field) zapcore.Core {
	return &combinedCore{
		consoleCore: c.consoleCore.With(fields),
		fileCore:    c.fileCore.With(fields),
	}
}

func (c *combinedCore) Check(entry zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	ce = c.consoleCore.Check(entry, ce)
	ce = c.fileCore.Check(entry, ce)
	return ce
}

func (c *combinedCore) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	if err := c.consoleCore.Write(entry, fields); err != nil {
		return err
	}
	return c.fileCore.Write(entry, fields)
}

func (c *combinedCore) Sync() error {
	if err := c.consoleCore.Sync(); err != nil {
		return err
	}
	return c.fileCore.Sync()
}
