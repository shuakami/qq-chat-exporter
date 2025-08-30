package cli

import (
	"fmt"
	"strings"
)

// ErrorType 错误类型
type ErrorType int

const (
	ErrorTypeUnknown ErrorType = iota
	ErrorTypeNetwork
	ErrorTypeAuth
	ErrorTypeConfig
	ErrorTypeValidation
	ErrorTypeDatabase
	ErrorTypeIO
	ErrorTypeNapcat
)

// UserFriendlyError 用户友好的错误
type UserFriendlyError struct {
	Type        ErrorType
	Title       string
	Description string
	Suggestion  string
	OriginalErr error
}

// Error 实现error接口
func (e *UserFriendlyError) Error() string {
	return fmt.Sprintf("%s: %s", e.Title, e.Description)
}

// Unwrap 返回原始错误
func (e *UserFriendlyError) Unwrap() error {
	return e.OriginalErr
}

// WrapError 包装错误为用户友好的错误
func WrapError(err error, errorType ErrorType) *UserFriendlyError {
	if err == nil {
		return nil
	}

	ufErr := &UserFriendlyError{
		Type:        errorType,
		OriginalErr: err,
	}

	errStr := strings.ToLower(err.Error())

	switch errorType {
	case ErrorTypeNetwork:
		ufErr.Title = "网络连接错误"
		if strings.Contains(errStr, "connection refused") {
			ufErr.Description = "无法连接到Napcat服务"
			ufErr.Suggestion = "请检查Napcat服务是否正在运行，地址是否正确"
		} else if strings.Contains(errStr, "timeout") {
			ufErr.Description = "网络请求超时"
			ufErr.Suggestion = "请检查网络连接是否正常，或尝试增加超时时间"
		} else {
			ufErr.Description = "网络连接失败"
			ufErr.Suggestion = "请检查网络连接和服务器状态"
		}

	case ErrorTypeAuth:
		ufErr.Title = "认证错误"
		if strings.Contains(errStr, "unauthorized") || strings.Contains(errStr, "401") {
			ufErr.Description = "Napcat API认证失败"
			ufErr.Suggestion = "请检查Token是否正确配置"
		} else if strings.Contains(errStr, "forbidden") || strings.Contains(errStr, "403") {
			ufErr.Description = "没有权限访问此资源"
			ufErr.Suggestion = "请检查账号权限或联系管理员"
		} else {
			ufErr.Description = "身份验证失败"
			ufErr.Suggestion = "请检查认证配置"
		}

	case ErrorTypeConfig:
		ufErr.Title = "配置错误"
		if strings.Contains(errStr, "配置文件") {
			ufErr.Description = "配置文件读取失败"
			ufErr.Suggestion = "请检查配置文件格式是否正确"
		} else {
			ufErr.Description = "配置参数有误"
			ufErr.Suggestion = "请检查配置参数是否正确"
		}

	case ErrorTypeValidation:
		ufErr.Title = "输入验证错误"
		if strings.Contains(errStr, "群id") || strings.Contains(errStr, "group") {
			ufErr.Description = "群号格式不正确"
			ufErr.Suggestion = "请输入正确的群号（纯数字）"
		} else if strings.Contains(errStr, "用户id") || strings.Contains(errStr, "user") {
			ufErr.Description = "QQ号格式不正确"
			ufErr.Suggestion = "请输入正确的QQ号（纯数字）"
		} else {
			ufErr.Description = "输入参数格式不正确"
			ufErr.Suggestion = "请检查输入参数格式"
		}

	case ErrorTypeDatabase:
		ufErr.Title = "数据库错误"
		if strings.Contains(errStr, "permission") {
			ufErr.Description = "数据库文件权限不足"
			ufErr.Suggestion = "请检查数据库文件夹的读写权限"
		} else {
			ufErr.Description = "数据库操作失败"
			ufErr.Suggestion = "请检查数据库文件是否损坏或磁盘空间是否充足"
		}

	case ErrorTypeIO:
		ufErr.Title = "文件操作错误"
		if strings.Contains(errStr, "permission") {
			ufErr.Description = "文件权限不足"
			ufErr.Suggestion = "请检查文件夹的读写权限"
		} else if strings.Contains(errStr, "no space") {
			ufErr.Description = "磁盘空间不足"
			ufErr.Suggestion = "请清理磁盘空间后重试"
		} else {
			ufErr.Description = "文件操作失败"
			ufErr.Suggestion = "请检查文件路径和权限"
		}

	case ErrorTypeNapcat:
		ufErr.Title = "Napcat API错误"
		if strings.Contains(errStr, "api错误") {
			parts := strings.Split(err.Error(), "]:")
			if len(parts) > 1 {
				ufErr.Description = strings.TrimSpace(parts[1])
			} else {
				ufErr.Description = "Napcat API返回错误"
			}
			ufErr.Suggestion = "请检查QQ登录状态和网络连接"
		} else {
			ufErr.Description = "Napcat服务异常"
			ufErr.Suggestion = "请检查Napcat服务状态"
		}

	default:
		ufErr.Title = "未知错误"
		ufErr.Description = err.Error()
		ufErr.Suggestion = "请查看日志文件获取详细信息"
	}

	return ufErr
}

// ShowUserFriendlyError 显示用户友好的错误信息
func ShowUserFriendlyError(err error) {
	if err == nil {
		return
	}

	if ufErr, ok := err.(*UserFriendlyError); ok {
		PrintError(ufErr.Title)
		fmt.Printf("  %s %s\n", Red("问题:"), ufErr.Description)
		fmt.Printf("  %s %s\n", Yellow("建议:"), ufErr.Suggestion)
	} else {
		PrintError(fmt.Sprintf("发生错误: %s", err.Error()))
	}
}

// GetErrorSuggestion 获取错误建议
func GetErrorSuggestion(err error) string {
	if ufErr, ok := err.(*UserFriendlyError); ok {
		return ufErr.Suggestion
	}
	return "请查看日志文件获取详细信息"
}
