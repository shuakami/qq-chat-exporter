package commands

import (
	"fmt"
	"runtime"
	"time"

	"qq-chat-exporter/internal/cli"

	"github.com/spf13/cobra"
)

const (
	Version   = "3.0.0"
	BuildDate = "2025-01-01"
	GitCommit = "dev"
	GoVersion = "1.24.0"
)

// createVersionCommand 创建版本命令
func (a *App) createVersionCommand() *cobra.Command {
	var detailed bool

	cmd := &cobra.Command{
		Use:   "version",
		Short: "显示版本信息",
		Long:  "显示QQ聊天记录导出工具的版本信息",
		RunE: func(cmd *cobra.Command, args []string) error {
			if detailed {
				a.showDetailedVersion()
			} else {
				a.showSimpleVersion()
			}
			return nil
		},
	}

	cmd.Flags().BoolVarP(&detailed, "detailed", "d", false, "显示详细版本信息")

	return cmd
}

// showSimpleVersion 显示简单版本信息
func (a *App) showSimpleVersion() {
	fmt.Printf("QQ聊天记录导出工具 V%s\n", cli.BoldBlue(Version))
}

// showDetailedVersion 显示详细版本信息
func (a *App) showDetailedVersion() {
	cli.PrintTitle("版本信息")

	fmt.Printf("版本号: %s\n", cli.BoldBlue(Version))
	fmt.Printf("构建日期: %s\n", cli.Blue(BuildDate))
	fmt.Printf("Git提交: %s\n", cli.Blue(GitCommit))
	fmt.Printf("Go版本: %s\n", cli.Blue(GoVersion))
	fmt.Printf("运行时版本: %s\n", cli.Blue(runtime.Version()))
	fmt.Printf("操作系统: %s\n", cli.Blue(runtime.GOOS))
	fmt.Printf("架构: %s\n", cli.Blue(runtime.GOARCH))
	fmt.Printf("当前时间: %s\n", cli.Blue(time.Now().Format("2006-01-02 15:04:05")))

	fmt.Printf("\n%s\n", cli.BoldBlue("功能特性:"))
	fmt.Printf("  %s 基于Napcat API的完整数据导出\n", cli.Green("✓"))
	fmt.Printf("  %s 支持群聊和好友聊天记录\n", cli.Green("✓"))
	fmt.Printf("  %s 多格式导出 (JSON/TXT/HTML)\n", cli.Green("✓"))
	fmt.Printf("  %s SQLite本地数据库存储\n", cli.Green("✓"))
	fmt.Printf("  %s 交互式命令行界面\n", cli.Green("✓"))
	fmt.Printf("  %s 进度条和彩色输出\n", cli.Green("✓"))
	fmt.Printf("  %s 断点续传支持\n", cli.Green("✓"))
	fmt.Printf("  %s 完整的原始数据保存\n", cli.Green("✓"))

	fmt.Printf("\n%s\n", cli.BoldBlue("项目信息:"))
	fmt.Printf("  项目地址: %s\n", cli.Blue("https://github.com/shuakami/qq-chat-exporter"))
	fmt.Printf("  许可证: %s\n", cli.Blue("GPL-3.0"))
	fmt.Printf("  作者: %s\n", cli.Blue("Shuakami"))
}
