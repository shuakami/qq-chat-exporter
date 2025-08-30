package cli

import (
	"fmt"

	"github.com/fatih/color"
)

// 定义颜色函数
var (
	// 基本颜色
	Red    = color.New(color.FgRed).SprintFunc()
	Green  = color.New(color.FgGreen).SprintFunc()
	Yellow = color.New(color.FgYellow).SprintFunc()
	Blue   = color.New(color.FgBlue).SprintFunc()
	Purple = color.New(color.FgMagenta).SprintFunc()
	Cyan   = color.New(color.FgCyan).SprintFunc()
	White  = color.New(color.FgWhite).SprintFunc()
	Gray   = color.New(color.FgHiBlack).SprintFunc()

	// 强调颜色
	BoldRed    = color.New(color.FgRed, color.Bold).SprintFunc()
	BoldGreen  = color.New(color.FgGreen, color.Bold).SprintFunc()
	BoldYellow = color.New(color.FgYellow, color.Bold).SprintFunc()
	BoldBlue   = color.New(color.FgBlue, color.Bold).SprintFunc()
	BoldPurple = color.New(color.FgMagenta, color.Bold).SprintFunc()
	BoldCyan   = color.New(color.FgCyan, color.Bold).SprintFunc()
	BoldWhite  = color.New(color.FgWhite, color.Bold).SprintFunc()

	// 背景颜色
	BgRed    = color.New(color.BgRed, color.FgWhite).SprintFunc()
	BgGreen  = color.New(color.BgGreen, color.FgWhite).SprintFunc()
	BgYellow = color.New(color.BgYellow, color.FgBlack).SprintFunc()
	BgBlue   = color.New(color.BgBlue, color.FgWhite).SprintFunc()
)

// 打印函数
func PrintSuccess(text string) {
	fmt.Printf("%s %s\n", BoldGreen("[SUCCESS]"), text)
}

func PrintError(text string) {
	fmt.Printf("%s %s\n", BoldRed("[ERROR]"), text)
}

func PrintWarning(text string) {
	fmt.Printf("%s %s\n", BoldYellow("[WARNING]"), text)
}

func PrintInfo(text string) {
	fmt.Printf("%s %s\n", BoldBlue("[INFO]"), text)
}

func PrintStep(step int, total int, text string) {
	fmt.Printf("%s %s\n", BoldCyan(fmt.Sprintf("[%d/%d]", step, total)), text)
}

func PrintTitle(text string) {
	fmt.Printf("\n%s\n", BoldWhite(text))
	fmt.Printf("%s\n\n", Gray("==========================================="))
}

func PrintSubTitle(text string) {
	fmt.Printf("\n%s\n", BoldCyan(text))
	fmt.Printf("%s\n", Gray("-------------------------------------------"))
}

func PrintBanner() {
	banner := `
                      
  / _ \   / _ \     / ___| | |__     __ _  | |_    | ____| __  __  _ __     ___    _ __  | |_    ___   _ __    |  _ \   _ __    ___  
 | | | | | | | |   | |     | '_ \   / _` + "`" + ` | | __|   |  _|   \ \/ / | '_ \   / _ \  | '__| | __|  / _ \ | '__|   | |_) | | '__|  / _ \ 
 | |_| | | |_| |   | |___  | | | | | (_| | | |_    | |___   >  <  | |_) | | (_) | | |    | |_  |  __/ | |      |  __/  | |    | (_) |
  \__\_\  \__\_\    \____| |_| |_|  \__,_|  \__|   |_____| /_/\_\ | .__/   \___/  |_|     \__|  \___| |_|      |_|     |_|     \___/ 
                                                                  |_|                                                                
QQ Chat Exporter Pro V3
`
	fmt.Print(BoldCyan(banner))
}

func PrintSeparator() {
	fmt.Printf("%s\n", Gray("═══════════════════════════════════════════════════════════════"))
}

func PrintHelp(command, description string) {
	fmt.Printf("  %s  %s\n", BoldBlue(fmt.Sprintf("%-20s", command)), description)
}

func PrintStatus(status, message string) {
	switch status {
	case "running":
		fmt.Printf("%s %s\n", BoldYellow("[运行中]"), message)
	case "completed":
		fmt.Printf("%s %s\n", BoldGreen("[已完成]"), message)
	case "failed":
		fmt.Printf("%s %s\n", BoldRed("[失败]"), message)
	case "pending":
		fmt.Printf("%s %s\n", Gray("[等待中]"), message)
	default:
		fmt.Printf("%s %s\n", White("[状态]"), message)
	}
}

func PrintTable(headers []string, rows [][]string) {
	if len(headers) == 0 || len(rows) == 0 {
		PrintInfo("没有数据可显示")
		return
	}

	// 计算每列的最大宽度
	colWidths := make([]int, len(headers))
	for i, header := range headers {
		colWidths[i] = len(header)
	}

	for _, row := range rows {
		for i, cell := range row {
			if i < len(colWidths) && len(cell) > colWidths[i] {
				colWidths[i] = len(cell)
			}
		}
	}

	// 打印表头
	fmt.Print(BoldWhite("│"))
	for i, header := range headers {
		fmt.Printf(" %-*s %s", colWidths[i], header, BoldWhite("│"))
	}
	fmt.Println()

	// 打印分隔线
	fmt.Print(Gray("├"))
	for i, width := range colWidths {
		fmt.Print(Gray(fmt.Sprintf("%s", repeatChar("─", width+2))))
		if i < len(colWidths)-1 {
			fmt.Print(Gray("┼"))
		}
	}
	fmt.Println(Gray("┤"))

	// 打印数据行
	for _, row := range rows {
		fmt.Print("│")
		for i, cell := range row {
			if i < len(colWidths) {
				fmt.Printf(" %-*s │", colWidths[i], cell)
			}
		}
		fmt.Println()
	}
}

func repeatChar(char string, count int) string {
	result := ""
	for i := 0; i < count; i++ {
		result += char
	}
	return result
}

func PrintMenu(title string, options []string) {
	PrintSubTitle(title)
	for i, option := range options {
		fmt.Printf("  %s %s\n", BoldBlue(fmt.Sprintf("[%d]", i+1)), option)
	}
	fmt.Printf("\n请选择一个选项 (输入数字): ")
}

func PrintConfirm(message string) {
	fmt.Printf("%s %s (y/N): ", BoldYellow("[确认]"), message)
}
