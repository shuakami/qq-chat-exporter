package commands

import (
	"context"
	"fmt"
	"time"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/services"

	"github.com/spf13/cobra"
)

// createExportCommand 创建导出命令
func (a *App) createExportCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "export",
		Short: "导出聊天记录",
		Long:  "通过命令行参数导出指定的聊天记录",
	}

	// 添加子命令
	cmd.AddCommand(a.createGroupExportCommand())
	cmd.AddCommand(a.createFriendExportCommand())

	return cmd
}

// createGroupExportCommand 创建群聊导出命令
func (a *App) createGroupExportCommand() *cobra.Command {
	var groupID string
	var maxCount int
	var format string
	var outputDir string

	cmd := &cobra.Command{
		Use:   "group",
		Short: "导出群聊记录",
		Long:  "导出指定群的聊天记录",
		Example: `  qq-chat-exporter export group --group-id 123456789 --format json --max-count 1000
  qq-chat-exporter export group --group-id 123456789 --format txt
  qq-chat-exporter export group --group-id 123456789 --format json --max-count 0  # 无限制`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if groupID == "" {
				return fmt.Errorf("群号不能为空，请使用 --group-id 参数指定")
			}

			// 设置默认值
			if format == "" {
				format = "json"
			}
			if outputDir == "" {
				outputDir = a.config.Export.OutputDir
			}

			cli.PrintTitle("导出群聊记录")
			cli.PrintInfo(fmt.Sprintf("群号: %s", groupID))
			cli.PrintInfo(fmt.Sprintf("格式: %s", format))
			if maxCount == 0 {
				cli.PrintInfo("最大数量: 无限制")
			} else {
				cli.PrintInfo(fmt.Sprintf("最大数量: %d", maxCount))
			}

			// 检查Napcat连接
			cli.PrintInfo("检查Napcat服务连接...")
			if !a.waitForNapcatConnection(30) {
				return fmt.Errorf("无法连接到Napcat服务，请检查服务是否正常运行")
			}
			cli.PrintSuccess("Napcat服务连接正常")

			// 创建导出配置
			exportConfig := services.ExportConfig{
				ChatType:     "group",
				ChatID:       groupID,
				ChatName:     fmt.Sprintf("群聊-%s", groupID),
				MaxCount:     maxCount,
				ExportFormat: format,
				OutputDir:    outputDir,
			}

			// 开始导出
			return a.exportService.StartExport(context.Background(), exportConfig)
		},
	}

	cmd.Flags().StringVarP(&groupID, "group-id", "g", "", "群号 (必需)")
	cmd.Flags().IntVarP(&maxCount, "max-count", "c", 0, "最大消息数量 (0表示无限制)")
	cmd.Flags().StringVarP(&format, "format", "f", "json", "导出格式 (json, txt, html)")
	cmd.Flags().StringVarP(&outputDir, "output", "o", "", "输出目录")

	cmd.MarkFlagRequired("group-id")

	return cmd
}

// createFriendExportCommand 创建好友导出命令
func (a *App) createFriendExportCommand() *cobra.Command {
	var userID string
	var maxCount int
	var format string
	var outputDir string

	cmd := &cobra.Command{
		Use:   "friend",
		Short: "导出好友聊天记录",
		Long:  "导出与指定好友的聊天记录",
		Example: `  qq-chat-exporter export friend --user-id 123456789 --format json --max-count 1000
  qq-chat-exporter export friend --user-id 123456789 --format txt`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if userID == "" {
				return fmt.Errorf("QQ号不能为空，请使用 --user-id 参数指定")
			}

			// 设置默认值
			if format == "" {
				format = "json"
			}
			if outputDir == "" {
				outputDir = a.config.Export.OutputDir
			}

			cli.PrintTitle("导出好友聊天记录")
			cli.PrintInfo(fmt.Sprintf("QQ号: %s", userID))
			cli.PrintInfo(fmt.Sprintf("格式: %s", format))
			if maxCount == 0 {
				cli.PrintInfo("最大数量: 无限制")
			} else {
				cli.PrintInfo(fmt.Sprintf("最大数量: %d", maxCount))
			}

			// 检查Napcat连接
			cli.PrintInfo("检查Napcat服务连接...")
			if !a.waitForNapcatConnection(30) {
				return fmt.Errorf("无法连接到Napcat服务，请检查服务是否正常运行")
			}
			cli.PrintSuccess("Napcat服务连接正常")

			// 创建导出配置
			exportConfig := services.ExportConfig{
				ChatType:     "friend",
				ChatID:       userID,
				ChatName:     fmt.Sprintf("好友-%s", userID),
				MaxCount:     maxCount,
				ExportFormat: format,
				OutputDir:    outputDir,
			}

			// 开始导出
			return a.exportService.StartExport(context.Background(), exportConfig)
		},
	}

	cmd.Flags().StringVarP(&userID, "user-id", "u", "", "好友QQ号 (必需)")
	cmd.Flags().IntVarP(&maxCount, "max-count", "c", 0, "最大消息数量 (0表示无限制)")
	cmd.Flags().StringVarP(&format, "format", "f", "json", "导出格式 (json, txt, html)")
	cmd.Flags().StringVarP(&outputDir, "output", "o", "", "输出目录")

	cmd.MarkFlagRequired("user-id")

	return cmd
}

// waitForNapcatConnection 等待Napcat连接建立
func (a *App) waitForNapcatConnection(timeoutSeconds int) bool {
	timeout := time.Duration(timeoutSeconds) * time.Second
	checkInterval := 2 * time.Second // 每2秒检查一次

	startTime := time.Now()

	// 先检查一次，如果已经连接就直接返回
	if a.napcatClient.IsHealthy() {
		return true
	}

	// 显示等待提示
	cli.PrintInfo(fmt.Sprintf("等待Napcat连接中，最多等待%d秒...", timeoutSeconds))

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// 检查连接状态
			if a.napcatClient.IsHealthy() {
				return true
			}

			// 显示剩余等待时间
			elapsed := time.Since(startTime)
			remaining := timeout - elapsed
			if remaining > 0 {
				cli.PrintInfo(fmt.Sprintf("仍在等待Napcat连接，剩余%.0f秒... (请确保Napcat已启动并配置了反向WebSocket)", remaining.Seconds()))
			}

		case <-time.After(timeout):
			// 超时
			return false
		}
	}
}
