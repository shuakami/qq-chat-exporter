package config

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/spf13/viper"
)

// Config 应用配置结构
type Config struct {
	Server   ServerConfig   `mapstructure:"server"`   // 服务器配置
	Napcat   NapcatConfig   `mapstructure:"napcat"`   // Napcat配置
	Export   ExportConfig   `mapstructure:"export"`   // 导出配置
	Log      LogConfig      `mapstructure:"log"`      // 日志配置
	Security SecurityConfig `mapstructure:"security"` // 安全配置
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Host         string        `mapstructure:"host"`          // 服务器地址
	Port         int           `mapstructure:"port"`          // 服务器端口
	Mode         string        `mapstructure:"mode"`          // 运行模式: debug/release
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`  // 读取超时
	WriteTimeout time.Duration `mapstructure:"write_timeout"` // 写入超时
	IdleTimeout  time.Duration `mapstructure:"idle_timeout"`  // 空闲超时
}

// NapcatConfig Napcat配置
type NapcatConfig struct {
	BaseURL     string        `mapstructure:"base_url"`     // Napcat API基础URL
	Token       string        `mapstructure:"token"`        // API Token
	Timeout     time.Duration `mapstructure:"timeout"`      // 请求超时时间
	RetryCount  int           `mapstructure:"retry_count"`  // 重试次数
	RetryDelay  time.Duration `mapstructure:"retry_delay"`  // 重试延迟
	MaxRequests int           `mapstructure:"max_requests"` // 最大并发请求数
}

// ExportConfig 导出配置
type ExportConfig struct {
	OutputDir       string `mapstructure:"output_dir"`        // 输出目录
	MaxFileSize     int64  `mapstructure:"max_file_size"`     // 最大文件大小（字节）
	MaxMessageCount int    `mapstructure:"max_message_count"` // 单次最大消息数量
	IncludeImages   bool   `mapstructure:"include_images"`    // 是否包含图片
	DateFormat      string `mapstructure:"date_format"`       // 日期格式
	Compression     bool   `mapstructure:"compression"`       // 是否压缩输出文件
}

// LogConfig 日志配置
type LogConfig struct {
	Level      string `mapstructure:"level"`       // 日志级别
	Format     string `mapstructure:"format"`      // 日志格式: json/text
	Output     string `mapstructure:"output"`      // 输出目标: stdout/file
	Filename   string `mapstructure:"filename"`    // 日志文件名
	MaxSize    int    `mapstructure:"max_size"`    // 最大文件大小(MB)
	MaxBackups int    `mapstructure:"max_backups"` // 最大备份文件数
	MaxAge     int    `mapstructure:"max_age"`     // 最大保存天数
	Compress   bool   `mapstructure:"compress"`    // 是否压缩旧日志
}

// SecurityConfig 安全配置
type SecurityConfig struct {
	EnableAuth     bool            `mapstructure:"enable_auth"`     // 是否启用认证
	APIKeys        []string        `mapstructure:"api_keys"`        // API密钥列表
	RateLimit      RateLimitConfig `mapstructure:"rate_limit"`      // 限流配置
	AllowedOrigins []string        `mapstructure:"allowed_origins"` // 允许的跨域来源
	EnableCORS     bool            `mapstructure:"enable_cors"`     // 是否启用CORS
}

// RateLimitConfig 限流配置
type RateLimitConfig struct {
	Enable   bool          `mapstructure:"enable"`   // 是否启用限流
	Requests int           `mapstructure:"requests"` // 请求数量
	Window   time.Duration `mapstructure:"window"`   // 时间窗口
}

var globalConfig *Config

// Load 加载配置文件
func Load(configPath string) (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")

	if configPath != "" {
		viper.SetConfigFile(configPath)
	} else {
		viper.AddConfigPath(".")
		viper.AddConfigPath("./config")
		viper.AddConfigPath("/etc/qq-chat-exporter")
	}

	// 设置默认值
	setDefaults()

	// 环境变量支持
	viper.AutomaticEnv()
	viper.SetEnvPrefix("QCE")

	// 读取配置文件
	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("读取配置文件失败: %w", err)
		}
		// 配置文件不存在时使用默认配置
	}

	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}

	// 手动解析duration字段，因为viper可能有问题
	if retryDelayStr := viper.GetString("napcat.retry_delay"); retryDelayStr != "" {
		if retryDelay, err := time.ParseDuration(retryDelayStr); err == nil {
			config.Napcat.RetryDelay = retryDelay
		}
	}

	// 硬编码超时时间为60秒，不允许配置
	config.Napcat.Timeout = 60 * time.Second
	if config.Napcat.RetryDelay == 0 {
		config.Napcat.RetryDelay = 500 * time.Millisecond
	}

	// 验证配置
	if err := validateConfig(&config); err != nil {
		return nil, fmt.Errorf("配置验证失败: %w", err)
	}

	globalConfig = &config
	return &config, nil
}

// Get 获取全局配置
func Get() *Config {
	return globalConfig
}

// GetDefaultConfig 获取默认配置
func GetDefaultConfig(configDir string) *Config {
	return &Config{
		Napcat: NapcatConfig{
			BaseURL:     "http://127.0.0.1:3032",
			Token:       "",
			Timeout:     60 * time.Second, // 硬编码1分钟超时
			RetryCount:  2,
			RetryDelay:  500 * time.Millisecond,
			MaxRequests: 2000,
		},
		Export: ExportConfig{
			OutputDir:       filepath.Join(configDir, "exports"),
			MaxFileSize:     100 * 1024 * 1024, // 100MB
			MaxMessageCount: 10000,
			IncludeImages:   true,
			DateFormat:      "2006-01-02 15:04:05",
			Compression:     false,
		},
		Log: LogConfig{
			Level:      "info",
			Format:     "json",
			Output:     "stdout",
			Filename:   filepath.Join(configDir, "app.log"),
			MaxSize:    100,
			MaxBackups: 10,
			MaxAge:     30,
			Compress:   true,
		},
	}
}

// setDefaults 设置默认配置值
func setDefaults() {
	// 服务器默认配置
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("server.mode", "debug")
	viper.SetDefault("server.read_timeout", "10s")
	viper.SetDefault("server.write_timeout", "10s")
	viper.SetDefault("server.idle_timeout", "60s")

	// Napcat默认配置
	viper.SetDefault("napcat.base_url", "http://127.0.0.1:3000")
	viper.SetDefault("napcat.token", "")
	viper.SetDefault("napcat.retry_count", 3)
	viper.SetDefault("napcat.retry_delay", "1s")
	viper.SetDefault("napcat.max_requests", 10)

	// 导出默认配置
	viper.SetDefault("export.output_dir", "./exports")
	viper.SetDefault("export.max_file_size", 100*1024*1024) // 100MB
	viper.SetDefault("export.max_message_count", 10000)
	viper.SetDefault("export.include_images", true)
	viper.SetDefault("export.date_format", "2006-01-02 15:04:05")
	viper.SetDefault("export.compression", false)

	// 日志默认配置
	viper.SetDefault("log.level", "info")
	viper.SetDefault("log.format", "json")
	viper.SetDefault("log.output", "stdout")
	viper.SetDefault("log.filename", "qq-chat-exporter.log")
	viper.SetDefault("log.max_size", 100) // 100MB
	viper.SetDefault("log.max_backups", 10)
	viper.SetDefault("log.max_age", 30) // 30天
	viper.SetDefault("log.compress", true)

	// 安全默认配置
	viper.SetDefault("security.enable_auth", false)
	viper.SetDefault("security.api_keys", []string{})
	viper.SetDefault("security.rate_limit.enable", true)
	viper.SetDefault("security.rate_limit.requests", 100)
	viper.SetDefault("security.rate_limit.window", "1m")
	viper.SetDefault("security.allowed_origins", []string{"*"})
	viper.SetDefault("security.enable_cors", true)
}

// validateConfig 验证配置
func validateConfig(config *Config) error {
	if config.Server.Port <= 0 || config.Server.Port > 65535 {
		return fmt.Errorf("服务器端口必须在1-65535之间")
	}

	if config.Napcat.BaseURL == "" {
		return fmt.Errorf("Napcat基础URL不能为空")
	}

	if config.Export.OutputDir == "" {
		return fmt.Errorf("导出目录不能为空")
	}

	if config.Export.MaxMessageCount <= 0 {
		return fmt.Errorf("最大消息数量必须大于0")
	}

	return nil
}

// GetAddr 获取服务器监听地址
func (c *ServerConfig) GetAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// IsDebugMode 是否为调试模式
func (c *ServerConfig) IsDebugMode() bool {
	return c.Mode == "debug"
}
