package commands

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/client"
	"qq-chat-exporter/internal/config"
	"qq-chat-exporter/internal/database"
	"qq-chat-exporter/internal/logger"
	"qq-chat-exporter/internal/models"
	"qq-chat-exporter/internal/services"

	"github.com/spf13/cobra"
	"go.uber.org/zap"
)

// 应用程序常量
const (
	AppConfigDir = ".qq-chat-exporter"
	ConfigFile   = "config.yaml"
	DatabaseFile = "data.db"
)

// App 应用程序结构
type App struct {
	config        *config.Config
	db            *database.Database
	logger        *zap.Logger
	napcatClient  client.NapcatClientInterface
	exportService *services.ExportService
	menu          *cli.InteractiveMenu
	configDir     string // 配置目录路径
}

// NewApp 创建新的应用程序实例
func NewApp() (*App, error) {
	app := &App{
		menu: cli.NewInteractiveMenu(),
	}

	// 初始化配置目录
	if err := app.initConfigDir(); err != nil {
		return nil, fmt.Errorf("初始化配置目录失败: %w", err)
	}

	// 初始化配置
	if err := app.initConfig(); err != nil {
		return nil, fmt.Errorf("初始化配置失败: %w", err)
	}

	// 初始化日志
	if err := app.initLogger(); err != nil {
		return nil, fmt.Errorf("初始化日志失败: %w", err)
	}

	// 初始化数据库
	if err := app.initDatabase(); err != nil {
		return nil, fmt.Errorf("初始化数据库失败: %w", err)
	}

	// 初始化Napcat客户端
	if err := app.initNapcatClient(); err != nil {
		return nil, fmt.Errorf("初始化Napcat客户端失败: %w", err)
	}

	// 初始化服务
	app.exportService = services.NewExportService(app.napcatClient, app.db, app.config, app.logger)

	return app, nil
}

// initConfigDir 初始化配置目录
func (a *App) initConfigDir() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("获取用户主目录失败: %w", err)
	}

	a.configDir = filepath.Join(homeDir, AppConfigDir)
	if err := os.MkdirAll(a.configDir, 0755); err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}

	return nil
}

// initConfig 初始化配置
func (a *App) initConfig() error {
	// 直接从当前目录加载配置文件
	cfg, err := config.Load("config.yaml")
	if err != nil {
		// 如果配置文件不存在，使用默认配置
		cfg = config.GetDefaultConfig(a.configDir)
	}

	a.config = cfg
	return nil
}

// initLogger 初始化日志
func (a *App) initLogger() error {
	log, err := logger.New(&a.config.Log)
	if err != nil {
		return err
	}
	a.logger = log
	return nil
}

// initDatabase 初始化数据库
func (a *App) initDatabase() error {
	dbPath := filepath.Join(a.configDir, DatabaseFile)

	db, err := database.New(dbPath)
	if err != nil {
		return err
	}

	a.db = db
	return nil
}

// initNapcatClient 初始化Napcat客户端
func (a *App) initNapcatClient() error {
	napcatClient := client.NewNapcatServerClient(&a.config.Napcat, a.logger)
	if napcatClient == nil {
		return fmt.Errorf("创建Napcat客户端失败")
	}
	a.napcatClient = napcatClient
	return nil
}

// Close 关闭应用程序
func (a *App) Close() error {
	var errs []error

	if a.db != nil {
		if err := a.db.Close(); err != nil {
			errs = append(errs, fmt.Errorf("关闭数据库失败: %w", err))
		}
	}

	if a.napcatClient != nil {
		if err := a.napcatClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("关闭Napcat客户端失败: %w", err))
		}
	}

	if a.logger != nil {
		if err := a.logger.Sync(); err != nil {
			errs = append(errs, fmt.Errorf("同步日志失败: %w", err))
		}
	}

	if len(errs) > 0 {
		// 返回第一个错误，但记录所有错误
		for i, err := range errs {
			if i == 0 {
				continue // 第一个错误会被返回
			}
			if a.logger != nil {
				a.logger.Error("关闭应用程序时发生额外错误", zap.Error(err))
			}
		}
		return errs[0]
	}

	return nil
}

// Execute 执行应用程序
func (a *App) Execute() error {
	// 创建根命令
	rootCmd := &cobra.Command{
		Use:   "qq-chat-exporter",
		Short: "QQ Chat Exporter Pro V3",
		Long:  "基于Napcat API的QQ聊天记录导出工具，支持群聊和好友聊天记录的完整导出",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runInteractiveMode()
		},
	}

	// 添加子命令
	rootCmd.AddCommand(a.createExportCommand())
	rootCmd.AddCommand(a.createHistoryCommand())
	rootCmd.AddCommand(a.createConfigCommand())
	rootCmd.AddCommand(a.createVersionCommand())

	return rootCmd.Execute()
}

// runInteractiveMode 运行交互模式
func (a *App) runInteractiveMode() error {
	// 显示欢迎信息
	a.menu.ShowWelcome()

	for {
		choice := a.menu.ShowMainMenu()

		switch choice {
		case 1: // 开始导出聊天记录
			if err := a.handleExport(); err != nil {
				a.menu.ShowError(err)
			}
		case 2: // 查看导出历史
			if err := a.handleHistory(); err != nil {
				a.menu.ShowError(err)
			}
		case 3: // 管理配置
			if err := a.handleConfig(); err != nil {
				a.menu.ShowError(err)
			}
		case 4: // 帮助说明
			a.showHelp()
		case 5: // 退出程序
			cli.PrintInfo("感谢使用 QQ聊天记录导出工具！")
			return nil
		}
	}
}

// handleExport 处理导出操作
func (a *App) handleExport() error {
	choice := a.menu.ShowExportMenu()

	switch choice {
	case 1: // 导出群聊记录
		return a.exportGroup()
	case 2: // 导出好友聊天记录
		return a.exportFriend()
	case 3: // 返回主菜单
		return nil
	}

	return nil
}

// exportGroup 导出群聊记录
func (a *App) exportGroup() error {
	cli.PrintTitle("导出群聊记录")

	// 获取群号
	groupID := a.menu.GetGroupID()

	// 获取时间范围
	startTime, endTime := a.menu.GetTimeRange()

	// 获取导出配置
	exportConfig := services.ExportConfig{
		ChatType:     "group",
		ChatID:       groupID,
		ChatName:     fmt.Sprintf("群聊-%s", groupID),
		MaxCount:     a.menu.GetMessageCount(),
		ExportFormat: a.menu.GetExportFormat(),
		OutputDir:    a.config.Export.OutputDir,
		StartTime:    startTime,
		EndTime:      endTime,
	}

	// 确认导出
	if !a.menu.GetConfirmation(fmt.Sprintf("确认导出群聊 %s 的聊天记录吗？", groupID)) {
		cli.PrintInfo("已取消导出")
		return nil
	}

	// 检查Napcat连接
	cli.PrintInfo("检查Napcat服务连接...")
	if !a.napcatClient.IsHealthy() {
		return cli.WrapError(fmt.Errorf("无法连接到Napcat服务"), cli.ErrorTypeNetwork)
	}
	cli.PrintSuccess("Napcat服务连接正常")

	// 开始导出
	return a.exportService.StartExport(context.Background(), exportConfig)
}

// exportFriend 导出好友聊天记录
func (a *App) exportFriend() error {
	cli.PrintTitle("导出好友聊天记录")

	// 获取QQ号
	friendID := a.menu.GetFriendID()

	// 获取时间范围
	startTime, endTime := a.menu.GetTimeRange()

	// 获取导出配置
	exportConfig := services.ExportConfig{
		ChatType:     "friend",
		ChatID:       friendID,
		ChatName:     fmt.Sprintf("好友-%s", friendID),
		MaxCount:     a.menu.GetMessageCount(),
		ExportFormat: a.menu.GetExportFormat(),
		OutputDir:    a.config.Export.OutputDir,
		StartTime:    startTime,
		EndTime:      endTime,
	}

	// 确认导出
	if !a.menu.GetConfirmation(fmt.Sprintf("确认导出与好友 %s 的聊天记录吗？", friendID)) {
		cli.PrintInfo("已取消导出")
		return nil
	}

	// 检查Napcat连接
	cli.PrintInfo("检查Napcat服务连接...")
	if !a.napcatClient.IsHealthy() {
		return cli.WrapError(fmt.Errorf("无法连接到Napcat服务"), cli.ErrorTypeNetwork)
	}
	cli.PrintSuccess("Napcat服务连接正常")

	// 开始导出
	return a.exportService.StartExport(context.Background(), exportConfig)
}

// handleHistory 处理历史记录操作
func (a *App) handleHistory() error {
	choice := a.menu.ShowHistoryMenu()

	switch choice {
	case 1: // 查看所有导出记录
		return a.showAllHistory()
	case 2: // 查看正在进行的任务
		return a.showRunningTasks()
	case 3: // 删除导出记录
		return a.deleteHistory()
	case 4: // 重新导出
		return a.reExport()
	case 5: // 返回主菜单
		return nil
	}

	return nil
}

// showAllHistory 显示所有历史记录
func (a *App) showAllHistory() error {
	cli.PrintTitle("所有导出记录")

	sessions, err := a.exportService.GetSessionHistory()
	if err != nil {
		return err
	}

	if len(sessions) == 0 {
		cli.PrintInfo("暂无导出记录")
		a.menu.Wait("")
		return nil
	}

	// 显示会话表格
	headers := []string{"ID", "类型", "聊天ID", "消息数", "状态", "创建时间"}
	var rows [][]string

	for _, session := range sessions {
		row := []string{
			fmt.Sprintf("%d", session.ID),
			a.getChatTypeName(session.ChatType),
			session.ChatID,
			fmt.Sprintf("%d", session.MessageCount),
			session.Status,
			session.CreatedAt.Format("2006-01-02 15:04:05"),
		}
		rows = append(rows, row)
	}

	cli.PrintTable(headers, rows)
	a.menu.Wait("")

	return nil
}

// showRunningTasks 显示正在运行的任务
func (a *App) showRunningTasks() error {
	cli.PrintTitle("正在进行的任务")

	tasks, err := a.db.GetRunningTasks()
	if err != nil {
		return err
	}

	if len(tasks) == 0 {
		cli.PrintInfo("暂无正在进行的任务")
		a.menu.Wait("")
		return nil
	}

	// 显示任务表格
	headers := []string{"任务ID", "任务名称", "进度", "状态", "开始时间"}
	var rows [][]string

	for _, task := range tasks {
		row := []string{
			fmt.Sprintf("%d", task.ID),
			task.TaskName,
			fmt.Sprintf("%d%%", task.Progress),
			task.Status,
			task.StartTime.Format("2006-01-02 15:04:05"),
		}
		rows = append(rows, row)
	}

	cli.PrintTable(headers, rows)
	a.menu.Wait("")

	return nil
}

// deleteHistory 删除历史记录
func (a *App) deleteHistory() error {
	cli.PrintTitle("删除导出记录")
	cli.PrintWarning("此操作将永久删除选中的记录，无法恢复")

	sessions, err := a.exportService.GetSessionHistory()
	if err != nil {
		return err
	}

	if len(sessions) == 0 {
		cli.PrintInfo("暂无导出记录")
		a.menu.Wait("")
		return nil
	}

	// 显示可删除的记录
	a.displaySessionList(sessions, false)

	choice := a.menu.GetChoice(1, len(sessions))
	selectedSession := sessions[choice-1]

	if a.menu.GetConfirmation(fmt.Sprintf("确认删除 %s-%s 的记录吗？", a.getChatTypeName(selectedSession.ChatType), selectedSession.ChatID)) {
		if err := a.exportService.DeleteSession(selectedSession.ID); err != nil {
			return err
		}
		cli.PrintSuccess("记录已删除")
	} else {
		cli.PrintInfo("已取消删除")
	}

	a.menu.Wait("")
	return nil
}

// reExport 重新导出
func (a *App) reExport() error {
	cli.PrintTitle("重新导出")
	cli.PrintInfo("选择已存在的会话进行重新导出")

	// 获取所有会话
	sessions, err := a.exportService.GetSessionHistory()
	if err != nil {
		return fmt.Errorf("获取会话历史失败: %w", err)
	}

	if len(sessions) == 0 {
		cli.PrintInfo("暂无可重新导出的记录")
		a.menu.Wait("")
		return nil
	}

	// 显示可重新导出的记录
	cli.PrintSubTitle("可重新导出的会话:")
	a.displaySessionList(sessions, true)

	choice := a.menu.GetChoice(1, len(sessions))
	selectedSession := sessions[choice-1]

	// 获取导出格式
	format := a.menu.GetExportFormat()

	// 创建导出配置
	exportConfig := services.ExportConfig{
		ChatType:     selectedSession.ChatType,
		ChatID:       selectedSession.ChatID,
		ExportFormat: format,
		MaxCount:     0, // 重新导出时不限制数量，导出所有已采集的消息
	}

	cli.PrintInfo(fmt.Sprintf("开始重新导出 %s-%s 的记录...", a.getChatTypeName(selectedSession.ChatType), selectedSession.ChatID))

	// 直接执行导出，不重新采集消息
	task, err := a.exportService.CreateExportTaskFromSession(selectedSession.ID, exportConfig)
	if err != nil {
		return fmt.Errorf("创建导出任务失败: %w", err)
	}

	if err := a.exportService.ExecuteExportFromTask(context.Background(), task); err != nil {
		return fmt.Errorf("重新导出失败: %w", err)
	}

	cli.PrintSuccess(fmt.Sprintf("重新导出完成！文件已保存到: %s", task.FilePath))
	a.menu.Wait("")
	return nil
}

// handleConfig 处理配置操作
func (a *App) handleConfig() error {
	choice := a.menu.ShowConfigMenu()

	switch choice {
	case 1: // 查看当前配置
		return a.showCurrentConfig()
	case 2: // 设置Napcat服务器地址
		return a.setNapcatURL()
	case 3: // 设置Napcat Token
		return a.setNapcatToken()
	case 4: // 设置导出目录
		return a.setExportDir()
	case 5: // 重置所有配置
		return a.resetConfig()
	case 6: // 返回主菜单
		return nil
	}

	return nil
}

// showCurrentConfig 显示当前配置
func (a *App) showCurrentConfig() error {
	cli.PrintTitle("当前配置")

	fmt.Printf("Napcat服务器地址: %s\n", cli.Blue(a.config.Napcat.BaseURL))
	fmt.Printf("Napcat Token: %s\n", cli.Gray(maskToken(a.config.Napcat.Token)))
	fmt.Printf("导出目录: %s\n", cli.Blue(a.config.Export.OutputDir))
	fmt.Printf("最大消息数量: %s\n", cli.Blue(fmt.Sprintf("%d", a.config.Export.MaxMessageCount)))

	a.menu.Wait("")
	return nil
}

// setNapcatURL 设置Napcat服务器地址
func (a *App) setNapcatURL() error {
	cli.PrintTitle("设置Napcat服务器地址")

	currentURL := a.config.Napcat.BaseURL
	newURL := a.menu.GetStringWithDefault("Napcat服务器地址", currentURL)

	a.config.Napcat.BaseURL = newURL
	a.napcatClient.UpdateConfig(&a.config.Napcat)

	cli.PrintSuccess("配置已更新")
	a.menu.Wait("")
	return nil
}

// setNapcatToken 设置Napcat Token
func (a *App) setNapcatToken() error {
	cli.PrintTitle("设置Napcat Token")

	currentToken := maskToken(a.config.Napcat.Token)
	fmt.Printf("当前Token: %s\n", cli.Gray(currentToken))

	newToken := a.menu.GetString("新的Token (留空则不修改)")
	if newToken != "" {
		a.config.Napcat.Token = newToken
		a.napcatClient.SetToken(newToken)
		cli.PrintSuccess("Token已更新")
	} else {
		cli.PrintInfo("未修改Token")
	}

	a.menu.Wait("")
	return nil
}

// setExportDir 设置导出目录
func (a *App) setExportDir() error {
	cli.PrintTitle("设置导出目录")

	currentDir := a.config.Export.OutputDir
	newDir := a.menu.GetStringWithDefault("导出目录", currentDir)

	// 创建目录
	if err := os.MkdirAll(newDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	a.config.Export.OutputDir = newDir

	cli.PrintSuccess("导出目录已更新")
	a.menu.Wait("")
	return nil
}

// resetConfig 重置配置
func (a *App) resetConfig() error {
	cli.PrintTitle("重置所有配置")
	cli.PrintWarning("此操作将重置所有配置为默认值")

	if a.menu.GetConfirmation("确认重置所有配置吗？") {
		if err := a.initConfig(); err != nil {
			return err
		}

		if err := a.initNapcatClient(); err != nil {
			return err
		}

		cli.PrintSuccess("配置已重置")
	} else {
		cli.PrintInfo("已取消重置")
	}

	a.menu.Wait("")
	return nil
}

// showHelp 显示帮助信息
func (a *App) showHelp() {
	cli.PrintTitle("帮助说明")

	fmt.Printf("%s\n", "QQ Chat Exporter Pro V3")
	fmt.Printf("%s\n\n", "基于Napcat API的完整聊天记录导出工具")

	fmt.Printf("%s\n", cli.BoldBlue("主要功能:"))
	cli.PrintHelp("导出群聊记录", "通过群号导出完整的群聊天记录")
	cli.PrintHelp("导出好友记录", "通过QQ号导出好友聊天记录")
	cli.PrintHelp("多格式支持", "支持JSON、TXT、HTML格式导出")
	cli.PrintHelp("完整数据保存", "保存Napcat返回的所有原始数据")
	cli.PrintHelp("断点续传", "支持中断后继续导出")

	fmt.Printf("\n%s\n", cli.BoldBlue("使用要求:"))
	fmt.Printf("  %s NapCatQQ 正在运行\n", cli.Green("1."))
	fmt.Printf("  %s QQ已登录\n", cli.Green("2."))
	fmt.Printf("  %s 网络连接正常\n", cli.Green("3."))

	fmt.Printf("\n%s\n", cli.BoldBlue("支持的消息类型:"))
	fmt.Printf("  %s 文本消息\n", cli.Green("·"))
	fmt.Printf("  %s 图片消息\n", cli.Green("·"))
	fmt.Printf("  %s 视频消息\n", cli.Green("·"))
	fmt.Printf("  %s 语音消息\n", cli.Green("·"))
	fmt.Printf("  %s 文件消息\n", cli.Green("·"))
	fmt.Printf("  %s 表情消息\n", cli.Green("·"))
	fmt.Printf("  %s @消息\n", cli.Green("·"))

	a.menu.Wait("")
}

// displaySessionList 显示会话列表
func (a *App) displaySessionList(sessions []models.ChatSession, showDetails bool) {
	for i, session := range sessions {
		if showDetails {
			status := "已完成"
			if session.Status != "completed" {
				status = session.Status
			}
			fmt.Printf("  [%d] %s - %s (消息数: %d, 状态: %s)\n",
				i+1,
				a.getChatTypeName(session.ChatType),
				session.ChatID,
				session.MessageCount,
				status)
		} else {
			fmt.Printf("  [%d] %s - %s (ID: %d)\n",
				i+1,
				a.getChatTypeName(session.ChatType),
				session.ChatID,
				session.ID)
		}
	}
}

// maskToken 遮蔽Token
func maskToken(token string) string {
	if token == "" {
		return "未设置"
	}
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

// getChatTypeName 获取聊天类型名称
func (a *App) getChatTypeName(chatType string) string {
	switch chatType {
	case "group":
		return "群聊"
	case "friend":
		return "好友"
	default:
		return "未知"
	}
}
