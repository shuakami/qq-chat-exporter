package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"qq-chat-exporter/internal/cli"
	"qq-chat-exporter/internal/commands"
)

type SimpleGuide struct {
	scanner *bufio.Scanner
}

func NewSimpleGuide() *SimpleGuide {
	return &SimpleGuide{
		scanner: bufio.NewScanner(os.Stdin),
	}
}

func (s *SimpleGuide) getInput() string {
	if !s.scanner.Scan() {
		return ""
	}
	return strings.TrimSpace(s.scanner.Text())
}

func (s *SimpleGuide) getChoice(prompt string, options []string) int {
	for {
		cli.PrintTitle(prompt)
		for i, option := range options {
			fmt.Printf("  %s %s\n", cli.BoldBlue(fmt.Sprintf("[%d]", i+1)), option)
		}

		fmt.Printf("\n%s 请选择 (1-%d): ", cli.BoldBlue("[输入]"), len(options))
		input := s.getInput()

		choice, err := strconv.Atoi(input)
		if err != nil || choice < 1 || choice > len(options) {
			cli.PrintError(fmt.Sprintf("请输入 1 到 %d 之间的数字", len(options)))
			continue
		}

		return choice
	}
}

func (s *SimpleGuide) showWelcome() {
	cli.PrintBanner()
	cli.PrintTitle("欢迎使用 QQ Chat Exporter Pro V3 (QCE)")

	fmt.Printf("\n%s 这是一个基于 NapCat 的 QQ 聊天记录导出工具\n", cli.Green("•"))
	fmt.Printf("%s 支持群聊和好友聊天记录的完整导出\n", cli.Green("•"))
	fmt.Printf("%s 支持多种导出格式: JSON、TXT、HTML\n", cli.Green("•"))
	fmt.Printf("%s 支持断点续传，不怕中断\n", cli.Green("•"))
	fmt.Printf("%s 实时保存，数据安全可靠\n", cli.Green("•"))

	fmt.Printf("\n%s 使用前需要安装和配置 NapCat\n", cli.Yellow("注意:"))
}

func (s *SimpleGuide) isSetupComplete() bool {
	_, err := os.Stat(".napcat_setup_complete")
	return err == nil
}

func (s *SimpleGuide) markSetupComplete() {
	file, err := os.Create(".napcat_setup_complete")
	if err == nil {
		file.Close()
	}
}

func (s *SimpleGuide) runSetupWizard() bool {
	fmt.Printf("\n%s 您是否已经安装并配置了 NapCat？\n", cli.BoldBlue("❓"))

	options := []string{
		"是的，我已经安装并配置了 NapCat",
		"没有，我需要安装指导",
		"不确定，显示检查方法",
	}

	choice := s.getChoice("请选择", options)

	switch choice {
	case 1:
		cli.PrintSuccess("太好了！直接进入主程序...")
		return true
	case 2:
		return s.showInstallGuide()
	case 3:
		s.showCheckGuide()
		return s.runSetupWizard() // 递归询问
	}

	return false
}

func (s *SimpleGuide) showInstallGuide() bool {
	cli.PrintTitle("NapCat 安装配置指南")

	fmt.Printf("\n%s 第1步：下载 NapCat\n", cli.BoldBlue("🔽"))
	fmt.Printf("1. 访问 GitHub 发布页面：\n")
	fmt.Printf("   %s\n", cli.BoldBlue("https://github.com/NapNeko/NapCatQQ/releases/latest"))
	fmt.Printf("2. 下载适合您系统的版本（通常是Windows的 .zip 文件）\n")
	fmt.Printf("3. 解压到任意文件夹（建议桌面或文档文件夹）\n\n")

	fmt.Printf("%s 第2步：启动 NapCat\n", cli.BoldBlue("🚀"))
	fmt.Printf("1. 双击运行 NapCatWinBootMain.exe）\n")
	fmt.Printf("2. 程序启动后会显示二维码\n")
	fmt.Printf("3. 使用手机 QQ 扫码登录\n")
	fmt.Printf("4. 登录成功后会显示 Web 管理界面地址\n")
	fmt.Printf("   通常是：http://127.0.0.1:6099/webui/?token=napcat\n\n")

	fmt.Printf("%s 第3步：配置 WebSocket\n", cli.BoldBlue("⚙️"))
	fmt.Printf("1. 在浏览器中打开上述管理界面地址\n")
	fmt.Printf("2. 左侧菜单 → 网络配置 → 新建\n")
	fmt.Printf("3. 选择 \"WebSocket 客户端\"（不是反向WebSocket）\n")
	fmt.Printf("4. 按以下参数填写：\n")
	fmt.Printf("   • 启用：开启 (打开开关)\n")
	fmt.Printf("   • 名称：QQ Chat Exporter\n")
	fmt.Printf("   • URL：ws://localhost:3032\n")
	fmt.Printf("   • 消息格式：Array\n")
	fmt.Printf("   • Token：(留空)\n")
	fmt.Printf("   • 重连间隔：5000\n")
	fmt.Printf("   • 其他选项保持默认\n")
	fmt.Printf("5. 点击保存\n\n")

	options := []string{
		"在浏览器中打开下载页面",
		"在浏览器中打开管理界面",
		"我已完成配置，进入主程序",
		"返回上一步",
	}

	choice := s.getChoice("选择操作", options)

	switch choice {
	case 1:
		s.openBrowser("https://github.com/NapNeko/NapCatQQ/releases/latest")
		cli.PrintInfo("已在浏览器中打开下载页面")
		return s.showInstallGuide() // 返回当前菜单
	case 2:
		urls := []string{
			"http://127.0.0.1:6099/webui/?token=napcat",
			"http://127.0.0.1:6099/webui",
		}
		for _, url := range urls {
			s.openBrowser(url)
		}
		cli.PrintInfo("已尝试打开管理界面")
		return s.showInstallGuide() // 返回当前菜单
	case 3:
		cli.PrintSuccess("配置完成！启动主程序...")
		return true
	case 4:
		return false
	}

	return false
}

func (s *SimpleGuide) showCheckGuide() {
	cli.PrintTitle("如何检查 NapCat 是否已安装配置")

	fmt.Printf("\n%s 检查安装：\n", cli.BoldBlue("🔍"))
	fmt.Printf("1. 查看桌面或文档文件夹是否有 NapCat 相关文件夹\n")
	fmt.Printf("2. 查看任务管理器是否有 NapCatWinBootMain.exe 进程运行\n")
	fmt.Printf("3. 尝试访问：http://127.0.0.1:6099/webui/?token=napcat\n\n")

	fmt.Printf("%s 检查配置：\n", cli.BoldBlue("⚙️"))
	fmt.Printf("1. 如果能打开上述网址，说明 NapCat 已运行\n")
	fmt.Printf("2. 检查左侧菜单的 \"网络配置\" 是否有配置项\n")
	fmt.Printf("3. 查看是否有 WebSocket 客户端配置，URL 为 ws://localhost:3032\n\n")

	s.waitForUser("了解检查方法后")
}

func (s *SimpleGuide) waitForUser(message string) {
	fmt.Printf("\n%s %s，按回车键继续...", cli.Gray("[等待]"), message)
	s.getInput()
}

func (s *SimpleGuide) openBrowser(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}

	cmd.Run()
}

func main() {
	guide := NewSimpleGuide()

	// 检查是否已经完成过初始设置
	if !guide.isSetupComplete() {
		// 显示欢迎信息和设置向导
		guide.showWelcome()

		// 进行首次设置
		if !guide.runSetupWizard() {
			// 用户选择了需要安装指导，但没有进入主程序，退出
			fmt.Printf("\n%s 安装配置完成后，请重新运行此程序！\n", cli.Green("✅"))
			guide.waitForUser("按回车键退出")
			return
		}

		// 标记设置完成
		guide.markSetupComplete()
	}

	// 进入原有的交互式主程序
	app, err := commands.NewApp()
	if err != nil {
		fmt.Fprintf(os.Stderr, "应用程序初始化失败: %v\n", err)
		os.Exit(1)
	}
	defer app.Close()

	// 执行应用程序的交互模式
	if err := app.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "应用程序执行失败: %v\n", err)
		os.Exit(1)
	}
}
