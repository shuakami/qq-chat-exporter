package commands

import (
	"fmt"
	"strings"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/models"

	"github.com/spf13/cobra"
)

// createHistoryCommand 创建历史记录命令
func (a *App) createHistoryCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "history",
		Short: "查看导出历史",
		Long:  "查看和管理聊天记录导出的历史记录",
	}

	// 添加子命令
	cmd.AddCommand(a.createListSessionsCommand())
	cmd.AddCommand(a.createListTasksCommand())
	cmd.AddCommand(a.createStatsCommand())

	return cmd
}

// createListSessionsCommand 创建列出会话命令
func (a *App) createListSessionsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "sessions",
		Short: "查看所有会话",
		Long:  "显示所有已导出的聊天会话记录",
		RunE: func(cmd *cobra.Command, args []string) error {
			cli.PrintTitle("所有聊天会话")

			sessions, err := a.exportService.GetSessionHistory()
			if err != nil {
				return err
			}

			if len(sessions) == 0 {
				cli.PrintInfo("暂无会话记录")
				return nil
			}

			// 显示会话表格
			headers := []string{"ID", "类型", "聊天ID", "聊天名称", "消息数", "状态", "创建时间"}
			var rows [][]string

			for _, session := range sessions {
				chatTypeName := "未知"
				if session.ChatType == "group" {
					chatTypeName = "群聊"
				} else if session.ChatType == "friend" {
					chatTypeName = "好友"
				}

				statusName := session.Status
				switch session.Status {
				case "active":
					statusName = "活跃"
				case "completed":
					statusName = "已完成"
				case "failed":
					statusName = "失败"
				}

				row := []string{
					fmt.Sprintf("%d", session.ID),
					chatTypeName,
					session.ChatID,
					session.ChatName,
					fmt.Sprintf("%d", session.MessageCount),
					statusName,
					session.CreatedAt.Format("2006-01-02 15:04:05"),
				}
				rows = append(rows, row)
			}

			cli.PrintTable(headers, rows)

			return nil
		},
	}

	return cmd
}

// createListTasksCommand 创建列出任务命令
func (a *App) createListTasksCommand() *cobra.Command {
	var showAll bool

	cmd := &cobra.Command{
		Use:   "tasks",
		Short: "查看导出任务",
		Long:  "显示导出任务的状态和进度",
		RunE: func(cmd *cobra.Command, args []string) error {
			cli.PrintTitle("导出任务")

			var tasks []models.ExportTask
			var err error

			if showAll {
				tasks, err = a.exportService.GetExportHistory()
			} else {
				tasks, err = a.db.GetRunningTasks()
			}

			if err != nil {
				return err
			}

			if len(tasks) == 0 {
				if showAll {
					cli.PrintInfo("暂无导出任务")
				} else {
					cli.PrintInfo("暂无正在运行的任务")
				}
				return nil
			}

			// 显示任务表格
			headers := []string{"任务ID", "任务名称", "导出类型", "进度", "状态", "开始时间"}
			var rows [][]string

			for _, task := range tasks {
				statusName := task.Status
				switch task.Status {
				case "pending":
					statusName = "等待中"
				case "running":
					statusName = "运行中"
				case "completed":
					statusName = "已完成"
				case "failed":
					statusName = "失败"
				}

				row := []string{
					fmt.Sprintf("%d", task.ID),
					task.TaskName,
					strings.ToUpper(task.ExportType),
					fmt.Sprintf("%d%%", task.Progress),
					statusName,
					task.StartTime.Format("2006-01-02 15:04:05"),
				}
				rows = append(rows, row)
			}

			cli.PrintTable(headers, rows)

			return nil
		},
	}

	cmd.Flags().BoolVarP(&showAll, "all", "a", false, "显示所有任务（默认只显示正在运行的任务）")

	return cmd
}

// createStatsCommand 创建统计信息命令
func (a *App) createStatsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "stats",
		Short: "查看统计信息",
		Long:  "显示导出工具的使用统计信息",
		RunE: func(cmd *cobra.Command, args []string) error {
			cli.PrintTitle("统计信息")

			stats, err := a.db.GetStats()
			if err != nil {
				return err
			}

			fmt.Printf("总会话数: %s\n", cli.BoldBlue(fmt.Sprintf("%v", stats["total_sessions"])))
			fmt.Printf("总消息数: %s\n", cli.BoldBlue(fmt.Sprintf("%v", stats["total_messages"])))
			fmt.Printf("总任务数: %s\n", cli.BoldBlue(fmt.Sprintf("%v", stats["total_tasks"])))
			fmt.Printf("群聊会话: %s\n", cli.Green(fmt.Sprintf("%v", stats["group_sessions"])))
			fmt.Printf("好友会话: %s\n", cli.Green(fmt.Sprintf("%v", stats["friend_sessions"])))

			return nil
		},
	}

	return cmd
}
