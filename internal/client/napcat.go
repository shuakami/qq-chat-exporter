package client

import (
	"encoding/json"
	"fmt"
	"time"
)

// WSRequest WebSocket请求结构
type WSRequest struct {
	Action string      `json:"action"`
	Params interface{} `json:"params"`
	Echo   string      `json:"echo"`
}

// WSResponse WebSocket响应结构
type WSResponse struct {
	Status  string      `json:"status"`
	Retcode int         `json:"retcode"`
	Data    interface{} `json:"data"`
	Message string      `json:"message"`
	Echo    string      `json:"echo"`
}

// ParseData 解析响应数据到指定结构
func (r *WSResponse) ParseData(target interface{}) error {
	if r.Data == nil {
		return fmt.Errorf("响应数据为空")
	}

	// 先转换为JSON，再解析到目标结构
	jsonData, err := json.Marshal(r.Data)
	if err != nil {
		return fmt.Errorf("序列化响应数据失败: %w", err)
	}

	if err := json.Unmarshal(jsonData, target); err != nil {
		return fmt.Errorf("解析响应数据失败: %w", err)
	}

	return nil
}

// pendingRequest 待处理的请求
type pendingRequest struct {
	echo         string
	responseChan chan *WSResponse
	createdAt    time.Time
}
