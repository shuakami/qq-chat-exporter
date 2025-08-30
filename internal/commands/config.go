package commands

import (
	"fmt"
	"os"

	"qq-chat-exporter/internal/cli"

	"github.com/spf13/cobra"
)

// createConfigCommand 创建配置命令
func (a *App) createConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "管理配置",
		Long:  "查看和修改应用程序配置",
	}

	// 添加子命令
	cmd.AddCommand(a.createShowConfigCommand())
	cmd.AddCommand(a.createSetConfigCommand())
	cmd.AddCommand(a.createResetConfigCommand())

	return cmd
}

// createShowConfigCommand 创建显示配置命令
func (a *App) createShowConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "show",
		Short: "显示当前配置",
		Long:  "显示所有当前的配置信息",
		RunE: func(cmd *cobra.Command, args []string) error {
			cli.PrintTitle("当前配置")

			fmt.Printf("%s\n", cli.BoldBlue("Napcat 配置:"))
			fmt.Printf("  服务器地址: %s\n", cli.Blue(a.config.Napcat.BaseURL))
			fmt.Printf("  Token: %s\n", cli.Gray(maskToken(a.config.Napcat.Token)))
			fmt.Printf("  超时时间: %s\n", cli.Blue(a.config.Napcat.Timeout.String()))
			fmt.Printf("  重试次数: %s\n", cli.Blue(fmt.Sprintf("%d", a.config.Napcat.RetryCount)))
			fmt.Printf("  最大并发: %s\n", cli.Blue(fmt.Sprintf("%d", a.config.Napcat.MaxRequests)))

			fmt.Printf("\n%s\n", cli.BoldBlue("导出配置:"))
			fmt.Printf("  输出目录: %s\n", cli.Blue(a.config.Export.OutputDir))
			fmt.Printf("  最大文件大小: %s\n", cli.Blue(fmt.Sprintf("%d MB", a.config.Export.MaxFileSize/(1024*1024))))
			fmt.Printf("  最大消息数量: %s\n", cli.Blue(fmt.Sprintf("%d", a.config.Export.MaxMessageCount)))
			fmt.Printf("  包含图片: %s\n", cli.Blue(fmt.Sprintf("%t", a.config.Export.IncludeImages)))
			fmt.Printf("  日期格式: %s\n", cli.Blue(a.config.Export.DateFormat))

			fmt.Printf("\n%s\n", cli.BoldBlue("日志配置:"))
			fmt.Printf("  日志级别: %s\n", cli.Blue(a.config.Log.Level))
			fmt.Printf("  日志格式: %s\n", cli.Blue(a.config.Log.Format))
			fmt.Printf("  输出方式: %s\n", cli.Blue(a.config.Log.Output))
			fmt.Printf("  日志文件: %s\n", cli.Blue(a.config.Log.Filename))

			return nil
		},
	}

	return cmd
}

// createSetConfigCommand 创建设置配置命令
func (a *App) createSetConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set",
		Short: "设置配置项",
		Long:  "设置指定的配置项",
	}

	// 添加具体的设置子命令
	cmd.AddCommand(a.createSetNapcatURLCommand())
	cmd.AddCommand(a.createSetNapcatTokenCommand())
	cmd.AddCommand(a.createSetOutputDirCommand())

	return cmd
}

// createSetNapcatURLCommand 创建设置Napcat URL命令
func (a *App) createSetNapcatURLCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "napcat-url [URL]",
		Short: "设置Napcat服务器地址",
		Long:  "设置Napcat API服务器的地址",
		Args:  cobra.ExactArgs(1),
		Example: `  qq-chat-exporter config set napcat-url http://127.0.0.1:3000
  qq-chat-exporter config set napcat-url http://localhost:3000`,
		RunE: func(cmd *cobra.Command, args []string) error {
			newURL := args[0]

			cli.PrintInfo(fmt.Sprintf("当前Napcat地址: %s", a.config.Napcat.BaseURL))
			cli.PrintInfo(fmt.Sprintf("新的Napcat地址: %s", newURL))

			a.config.Napcat.BaseURL = newURL
			a.napcatClient.UpdateConfig(&a.config.Napcat)

			cli.PrintSuccess("Napcat服务器地址已更新")

			// 测试连接
			cli.PrintInfo("测试连接...")
			if a.napcatClient.IsHealthy() {
				cli.PrintSuccess("连接测试成功")
			} else {
				cli.PrintWarning("连接测试失败，请检查地址是否正确")
			}

			return nil
		},
	}

	return cmd
}

// createSetNapcatTokenCommand 创建设置Napcat Token命令
func (a *App) createSetNapcatTokenCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "napcat-token [TOKEN]",
		Short:   "设置Napcat Token",
		Long:    "设置Napcat API的访问Token",
		Args:    cobra.ExactArgs(1),
		Example: `  qq-chat-exporter config set napcat-token your_token_here`,
		RunE: func(cmd *cobra.Command, args []string) error {
			newToken := args[0]

			cli.PrintInfo(fmt.Sprintf("当前Token: %s", maskToken(a.config.Napcat.Token)))

			a.config.Napcat.Token = newToken
			a.napcatClient.SetToken(newToken)

			cli.PrintSuccess("Napcat Token已更新")

			return nil
		},
	}

	return cmd
}

// createSetOutputDirCommand 创建设置输出目录命令
func (a *App) createSetOutputDirCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "output-dir [PATH]",
		Short: "设置导出目录",
		Long:  "设置聊天记录的导出目录",
		Args:  cobra.ExactArgs(1),
		Example: `  qq-chat-exporter config set output-dir /path/to/exports
  qq-chat-exporter config set output-dir ./exports`,
		RunE: func(cmd *cobra.Command, args []string) error {
			newDir := args[0]

			cli.PrintInfo(fmt.Sprintf("当前导出目录: %s", a.config.Export.OutputDir))
			cli.PrintInfo(fmt.Sprintf("新的导出目录: %s", newDir))

			// 创建目录
			if err := os.MkdirAll(newDir, 0755); err != nil {
				return fmt.Errorf("创建目录失败: %w", err)
			}

			a.config.Export.OutputDir = newDir

			cli.PrintSuccess("导出目录已更新")

			return nil
		},
	}

	return cmd
}

// createResetConfigCommand 创建重置配置命令
func (a *App) createResetConfigCommand() *cobra.Command {
	var force bool

	cmd := &cobra.Command{
		Use:   "reset",
		Short: "重置配置",
		Long:  "重置所有配置为默认值",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !force {
				cli.PrintWarning("此操作将重置所有配置为默认值")
				cli.PrintWarning("使用 --force 参数跳过确认")
				return fmt.Errorf("操作已取消")
			}

			cli.PrintInfo("正在重置配置...")

			// 重新初始化配置
			if err := a.initConfig(); err != nil {
				return fmt.Errorf("重置配置失败: %w", err)
			}

			// 重新初始化客户端
			if err := a.initNapcatClient(); err != nil {
				return fmt.Errorf("重新初始化客户端失败: %w", err)
			}

			cli.PrintSuccess("配置已重置为默认值")

			return nil
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "强制重置，跳过确认")

	return cmd
}
