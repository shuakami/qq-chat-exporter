package main

import (
	"fmt"
	"log"
	"time"

	"go.uber.org/zap"

	"qq-chat-exporter/internal/client"
	"qq-chat-exporter/internal/config"
	"qq-chat-exporter/internal/models"
)

func main() {
	// 创建日志
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()

	// 模拟配置
	cfg := &config.NapcatConfig{
		BaseURL:    "http://127.0.0.1:3032", // WebSocket服务端监听地址
		Token:      "",
		Timeout:    30 * time.Second,
		RetryDelay: 500 * time.Millisecond,
	}

	// 创建WebSocket服务端客户端
	client := client.NewNapcatServerClient(cfg, logger)
	if client == nil {
		log.Fatal("创建WebSocket服务端客户端失败")
	}
	defer client.Close()

	fmt.Println("=== 群聊API调试工具 ===")
	fmt.Println("WebSocket服务端已启动，等待Napcat连接到 ws://127.0.0.1:3032")
	fmt.Println("请在Napcat中配置反向WebSocket连接到此地址...")

	// 等待连接建立
	fmt.Println("等待Napcat连接...")
	time.Sleep(5 * time.Second)

	// 检查连接状态
	if !client.IsHealthy() {
		fmt.Println("警告: 没有检测到Napcat连接")
		fmt.Println("请确保:")
		fmt.Println("1. Napcat正在运行")
		fmt.Println("2. Napcat配置了反向WebSocket连接到 ws://127.0.0.1:3032")
		time.Sleep(30 * time.Second) // 再等待30秒
	}

	if client.IsHealthy() {
		fmt.Println("Napcat连接成功！")

		// 测试用户报告的群号
		groupID := "960420904"

		fmt.Printf("\n=== 测试群聊 %s ===\n", groupID)

		// 测试不同的messageSeq参数
		testCases := []struct {
			messageSeq  string
			description string
		}{
			{"", "空字符串（第一次调用）"},
			{"0", "数字0"},
			{"-1", "数字-1"},
		}

		for _, tc := range testCases {
			fmt.Printf("\n--- 测试 messageSeq: %s (%s) ---\n", tc.messageSeq, tc.description)

			req := &models.GroupMessageHistoryRequest{
				GroupID:      groupID,
				MessageSeq:   tc.messageSeq,
				Count:        15,
				ReverseOrder: true,
			}

			fmt.Printf("发送请求: %+v\n", req)

			resp, err := client.GetGroupMessageHistoryWithRetry(req, 3)
			if err != nil {
				fmt.Printf("❌ API调用失败: %v\n", err)
				continue
			}

			fmt.Printf("✅ API调用成功！\n")
			fmt.Printf("响应状态: %s\n", resp.Status)
			fmt.Printf("返回码: %d\n", resp.Retcode)
			if resp.Message != "" {
				fmt.Printf("响应消息: %s\n", resp.Message)
			}
			fmt.Printf("消息数量: %d\n", len(resp.Data.Messages))

			if len(resp.Data.Messages) > 0 {
				fmt.Printf("\n前3条消息预览:\n")
				for i, msg := range resp.Data.Messages {
					if i >= 3 {
						break
					}
					msgTime := time.Unix(msg.Time, 0)
					fmt.Printf("  %d. [%s] %s: %s\n",
						i+1,
						msgTime.Format("01-02 15:04"),
						msg.Sender.Nickname,
						truncateString(fmt.Sprintf("%v", msg.Message), 50))
				}
				break // 找到有效的调用就停止
			} else {
				fmt.Printf("⚠️  返回了空的消息列表\n")
			}
		}

		// 如果所有测试都失败，提供调试信息
		fmt.Printf("\n=== 调试信息 ===\n")
		fmt.Printf("群号: %s\n", groupID)
		fmt.Printf("可能的问题:\n")
		fmt.Printf("1. 群号不存在或输入错误\n")
		fmt.Printf("2. 机器人不在该群中\n")
		fmt.Printf("3. 没有访问该群历史消息的权限\n")
		fmt.Printf("4. 群中确实没有消息\n")
		fmt.Printf("5. Napcat版本或配置问题\n")

	} else {
		fmt.Println("无法连接到Napcat，测试终止")
	}
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
