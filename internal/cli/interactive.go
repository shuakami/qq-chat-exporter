package cli

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// UI常量
const (
	DefaultProgressBarLength = 30  // 默认进度条长度
	ClearScreenLines         = 50  // 清屏时的换行数
	DefaultBatchSize         = 100 // 默认批处理大小
)

// InteractiveMenu 交互式菜单
type InteractiveMenu struct {
	scanner *bufio.Scanner
}

// NewInteractiveMenu 创建新的交互式菜单
func NewInteractiveMenu() *InteractiveMenu {
	return &InteractiveMenu{
		scanner: bufio.NewScanner(os.Stdin),
	}
}

// ShowMainMenu 显示主菜单
func (m *InteractiveMenu) ShowMainMenu() int {
	PrintBanner()

	options := []string{
		"开始导出聊天记录",
		"查看导出历史",
		"管理配置",
		"帮助说明",
		"退出程序",
	}

	PrintMenu("主菜单", options)

	choice := m.GetChoice(1, len(options))
	return choice
}

// ShowExportMenu 显示导出菜单
func (m *InteractiveMenu) ShowExportMenu() int {
	PrintTitle("开始导出聊天记录")

	options := []string{
		"导出群聊记录",
		"导出好友聊天记录",
		"返回主菜单",
	}

	PrintMenu("选择导出类型", options)

	choice := m.GetChoice(1, len(options))
	return choice
}

// ShowHistoryMenu 显示历史菜单
func (m *InteractiveMenu) ShowHistoryMenu() int {
	PrintTitle("查看导出历史")

	options := []string{
		"查看所有导出记录",
		"查看正在进行的任务",
		"删除导出记录",
		"重新导出",
		"返回主菜单",
	}

	PrintMenu("历史记录管理", options)

	choice := m.GetChoice(1, len(options))
	return choice
}

// ShowConfigMenu 显示配置菜单
func (m *InteractiveMenu) ShowConfigMenu() int {
	PrintTitle("管理配置")

	options := []string{
		"查看当前配置",
		"设置 Napcat 服务器地址",
		"设置 Napcat Token",
		"设置导出目录",
		"重置所有配置",
		"返回主菜单",
	}

	PrintMenu("配置管理", options)

	choice := m.GetChoice(1, len(options))
	return choice
}

// GetChoice 获取用户选择
func (m *InteractiveMenu) GetChoice(min, max int) int {
	for {
		input := m.GetInput()

		if input == "" {
			PrintError("请输入一个数字")
			continue
		}

		choice, err := strconv.Atoi(input)
		if err != nil {
			PrintError("请输入有效的数字")
			continue
		}

		if choice < min || choice > max {
			PrintError(fmt.Sprintf("请输入 %d 到 %d 之间的数字", min, max))
			continue
		}

		return choice
	}
}

// GetInput 获取用户输入
func (m *InteractiveMenu) GetInput() string {
	if !m.scanner.Scan() {
		// 检查扫描错误
		if err := m.scanner.Err(); err != nil {
			PrintError(fmt.Sprintf("读取输入失败: %v", err))
			return ""
		}
		// EOF 或其他原因导致的扫描结束
		return ""
	}
	return strings.TrimSpace(m.scanner.Text())
}

// GetString 获取字符串输入
func (m *InteractiveMenu) GetString(prompt string) string {
	fmt.Printf("%s %s: ", BoldBlue("[输入]"), prompt)
	return m.GetInput()
}

// GetStringWithDefault 获取带默认值的字符串输入
func (m *InteractiveMenu) GetStringWithDefault(prompt, defaultValue string) string {
	fmt.Printf("%s %s [默认: %s]: ", BoldBlue("[输入]"), prompt, Gray(defaultValue))
	input := m.GetInput()
	if input == "" {
		return defaultValue
	}
	return input
}

// GetNumber 获取数字输入
func (m *InteractiveMenu) GetNumber(prompt string, min, max int) int {
	for {
		fmt.Printf("%s %s (%d-%d): ", BoldBlue("[输入]"), prompt, min, max)
		input := m.GetInput()

		if input == "" {
			PrintError("请输入一个数字")
			continue
		}

		num, err := strconv.Atoi(input)
		if err != nil {
			PrintError("请输入有效的数字")
			continue
		}

		if num < min || num > max {
			PrintError(fmt.Sprintf("请输入 %d 到 %d 之间的数字", min, max))
			continue
		}

		return num
	}
}

// GetConfirmation 获取确认输入
func (m *InteractiveMenu) GetConfirmation(prompt string) bool {
	PrintConfirm(prompt)
	input := strings.ToLower(m.GetInput())
	return input == "y" || input == "yes" || input == "是"
}

// ShowProgress 显示进度条
func (m *InteractiveMenu) ShowProgress(message string, current, total int) {
	percentage := float64(current) / float64(total) * 100
	bar := ""
	barLength := DefaultProgressBarLength
	filled := int(float64(barLength) * float64(current) / float64(total))

	for i := 0; i < barLength; i++ {
		if i < filled {
			bar += "█"
		} else {
			bar += "░"
		}
	}

	fmt.Printf("\r%s [%s] %.1f%% (%d/%d)",
		BoldBlue("[进度]"),
		bar,
		percentage,
		current,
		total,
	)

	if current >= total {
		fmt.Printf("\n")
		PrintSuccess(message + " 完成")
	}
}

// Wait 等待用户按回车继续
func (m *InteractiveMenu) Wait(message string) {
	if message == "" {
		message = "按回车键继续"
	}
	fmt.Printf("\n%s %s...", Gray("[等待]"), message)
	m.GetInput()
}

// Clear 清屏（跨平台兼容）
func (m *InteractiveMenu) Clear() {
	// 使用多个换行符而不是ANSI转义序列，确保跨平台兼容性
	for i := 0; i < ClearScreenLines; i++ {
		fmt.Println()
	}
}

// ShowWelcome 显示欢迎信息
func (m *InteractiveMenu) ShowWelcome() {
	PrintTitle("欢迎使用 QQ 聊天记录导出工具 V3.0")

	fmt.Printf("%s\n", "这个工具可以帮助您:")
	fmt.Printf("  %s 通过 Napcat API 获取完整的聊天记录\n", Green("·"))
	fmt.Printf("  %s 支持群聊和好友聊天记录导出\n", Green("·"))
	fmt.Printf("  %s 保存为多种格式 (JSON/TXT/HTML)\n", Green("·"))
	fmt.Printf("  %s 完整保存所有消息内容，包括图片、视频等\n", Green("·"))
	fmt.Printf("  %s 简单易用的界面，无需复杂配置\n", Green("·"))

	fmt.Printf("\n%s\n", Gray("使用前请确保:"))
	fmt.Printf("  %s Napcat 服务正在运行 (默认地址: http://127.0.0.1:3000)\n", Yellow("1."))
	fmt.Printf("  %s 已经登录了您的 QQ 账号\n", Yellow("2."))
	fmt.Printf("  %s 网络连接正常\n", Yellow("3."))

	m.Wait("阅读完上述信息后回车继续")
}

// ShowError 显示错误信息并等待
func (m *InteractiveMenu) ShowError(err error) {
	ShowUserFriendlyError(err)
	m.Wait("按回车键继续")
}

// ShowSuccess 显示成功信息并等待
func (m *InteractiveMenu) ShowSuccess(message string) {
	PrintSuccess(message)
	m.Wait("按回车键继续")
}

// GetGroupID 获取群号
func (m *InteractiveMenu) GetGroupID() string {
	PrintSubTitle("输入群号")
	fmt.Printf("%s\n", Gray("请输入您要导出的群号码 (纯数字)"))
	fmt.Printf("%s\n", Gray("小提示：右键可以粘贴"))

	for {
		groupID := m.GetString("群号")

		if groupID == "" {
			PrintError("群号不能为空")
			continue
		}

		// 简单验证是否为数字
		if _, err := strconv.ParseInt(groupID, 10, 64); err != nil {
			PrintError("请输入有效的群号 (纯数字)")
			continue
		}

		return groupID
	}
}

// GetFriendID 获取好友QQ号
func (m *InteractiveMenu) GetFriendID() string {
	PrintSubTitle("输入好友QQ号")
	fmt.Printf("%s\n", Gray("请输入您要导出聊天记录的好友QQ号 (纯数字)"))
	fmt.Printf("%s\n", Gray("小提示：右键可以粘贴"))

	for {
		friendID := m.GetString("QQ号")

		if friendID == "" {
			PrintError("QQ号不能为空")
			continue
		}

		// 简单验证是否为数字
		if _, err := strconv.ParseInt(friendID, 10, 64); err != nil {
			PrintError("请输入有效的QQ号 (纯数字)")
			continue
		}

		return friendID
	}
}

// GetExportFormat 获取导出格式
func (m *InteractiveMenu) GetExportFormat() string {
	PrintSubTitle("选择导出格式")

	options := []string{
		"JSON 格式 (完整数据, 适合程序处理)",
		"TXT 格式 (纯文本, 适合阅读)",
		"HTML 格式 (网页格式, 适合浏览)",
	}

	PrintMenu("导出格式", options)
	choice := m.GetChoice(1, len(options))

	formats := []string{"json", "txt", "html"}
	return formats[choice-1]
}

// GetMessageCount 获取导出消息数量
func (m *InteractiveMenu) GetMessageCount() int {
	PrintSubTitle("设置导出数量")
	fmt.Printf("%s\n", Gray("设置要导出的最大消息数量 (0 表示导出全部)"))

	return m.GetNumber("消息数量", 0, 100000)
}

// ShowTaskStatus 显示任务状态
func (m *InteractiveMenu) ShowTaskStatus(taskName, status string, progress int) {
	switch status {
	case "running":
		fmt.Printf("\r%s %s - 进度: %d%%",
			BoldYellow("[运行中]"),
			taskName,
			progress)
	case "completed":
		fmt.Printf("\n%s %s - 已完成\n",
			BoldGreen("[完成]"),
			taskName)
	case "failed":
		fmt.Printf("\n%s %s - 失败\n",
			BoldRed("[失败]"),
			taskName)
	}
}

// Countdown 倒计时
func (m *InteractiveMenu) Countdown(seconds int, message string) {
	for i := seconds; i > 0; i-- {
		fmt.Printf("\r%s %s %s",
			BoldYellow("[倒计时]"),
			message,
			BoldWhite(fmt.Sprintf("%d秒", i)))
		time.Sleep(time.Second)
	}
	fmt.Printf("\n")
}

// GetTimeRange 获取时间范围
func (m *InteractiveMenu) GetTimeRange() (*time.Time, *time.Time) {
	PrintSubTitle("设置时间范围（可选）")
	fmt.Printf("%s\n", Gray("您可以设置时间范围来过滤消息，留空表示不限制"))
	fmt.Printf("%s\n", Gray("时间格式示例: 2025-01-01 或 2025-01-01 15:30:00"))

	// 获取开始时间
	var startTime *time.Time
	for {
		startTimeStr := m.GetString("开始时间 (留空=不限制)")
		if startTimeStr == "" {
			break
		}

		parsedTime, err := m.parseTimeForStart(startTimeStr)
		if err != nil {
			PrintError(fmt.Sprintf("时间格式错误: %v", err))
			PrintInfo("支持的格式: 2025-01-01 或 2025-01-01 15:30:00")
			continue
		}

		startTime = &parsedTime
		break
	}

	// 获取结束时间
	var endTime *time.Time
	for {
		endTimeStr := m.GetString("结束时间 (留空=不限制)")
		if endTimeStr == "" {
			break
		}

		parsedTime, err := m.parseTimeForEnd(endTimeStr)
		if err != nil {
			PrintError(fmt.Sprintf("时间格式错误: %v", err))
			PrintInfo("支持的格式: 2025-01-01 或 2025-01-01 15:30:00")
			continue
		}

		// 检查结束时间是否晚于开始时间
		if startTime != nil && parsedTime.Before(*startTime) {
			PrintError("结束时间不能早于开始时间")
			continue
		}

		endTime = &parsedTime
		break
	}

	// 显示设置的时间范围
	if startTime != nil || endTime != nil {
		fmt.Printf("\n%s\n", BoldBlue("已设置时间范围:"))
		if startTime != nil {
			fmt.Printf("  开始时间: %s\n", Green(startTime.Format("2006-01-02 15:04:05")))
		} else {
			fmt.Printf("  开始时间: %s\n", Gray("不限制"))
		}
		if endTime != nil {
			fmt.Printf("  结束时间: %s\n", Green(endTime.Format("2006-01-02 15:04:05")))
		} else {
			fmt.Printf("  结束时间: %s\n", Gray("不限制"))
		}
	} else {
		fmt.Printf("\n%s\n", Gray("未设置时间范围，将导出所有消息"))
	}

	return startTime, endTime
}

// parseTime 解析时间字符串 (通用版本)
func (m *InteractiveMenu) parseTime(timeStr string) (time.Time, error) {
	timeStr = strings.TrimSpace(timeStr)

	// 支持的时间格式
	formats := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
		"2006/01/02",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, timeStr); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("不支持的时间格式，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS 格式")
}

// parseTimeForStart 解析开始时间字符串（只有日期时解析为当天00:00:00）
func (m *InteractiveMenu) parseTimeForStart(timeStr string) (time.Time, error) {
	timeStr = strings.TrimSpace(timeStr)

	// 先尝试完整时间格式
	fullTimeFormats := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
	}

	for _, format := range fullTimeFormats {
		if t, err := time.Parse(format, timeStr); err == nil {
			return t, nil
		}
	}

	// 尝试仅日期格式，解析为当天开始时间（00:00:00）
	dateFormats := []string{
		"2006-01-02",
		"2006/01/02",
	}

	for _, format := range dateFormats {
		if t, err := time.Parse(format, timeStr); err == nil {
			// 开始时间：当天00:00:00（默认行为）
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("不支持的时间格式，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS 格式")
}

// parseTimeForEnd 解析结束时间字符串（只有日期时解析为当天23:59:59）
func (m *InteractiveMenu) parseTimeForEnd(timeStr string) (time.Time, error) {
	timeStr = strings.TrimSpace(timeStr)

	// 先尝试完整时间格式
	fullTimeFormats := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
	}

	for _, format := range fullTimeFormats {
		if t, err := time.Parse(format, timeStr); err == nil {
			return t, nil
		}
	}

	// 尝试仅日期格式，解析为当天结束时间（23:59:59）
	dateFormats := []string{
		"2006-01-02",
		"2006/01/02",
	}

	for _, format := range dateFormats {
		if t, err := time.Parse(format, timeStr); err == nil {
			// 结束时间：当天23:59:59
			endOfDay := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 999999999, t.Location())
			return endOfDay, nil
		}
	}

	return time.Time{}, fmt.Errorf("不支持的时间格式，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS 格式")
}
