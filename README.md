# QQ聊天记录导出工具 Pro

[![GPL3 License](https://img.shields.io/badge/License-GPL3-4a5568?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Release](https://img.shields.io/github/v/release/shuakami/qq-chat-exporter?include_prereleases&style=flat-square&color=667eea)](https://github.com/shuakami/qq-chat-exporter/releases) 
![Platform](https://img.shields.io/badge/平台-Win/Mac/Linux-48bb78?style=flat-square)
[![使用教程](https://img.shields.io/badge/使用教程-点击查看-f6ad55?style=flat-square)](https://qce.luoxiaohei.cn)

## 这是什么

这是一款 QQ 聊天记录导出工具，可以将您的 QQ 聊天记录（包括消息、图片、表情等）完整地导出为 `HTML`、`JSON`、`TXT` 等多种格式。

最新的 **V4 版本** 是基于 NapCatQQ 框架的完全重构版本，集成了现代化 Web 界面、SQLite 数据库、定时任务系统和完整的 API 服务，为用户提供企业级的聊天记录管理解决方案。

## V4 版本核心特性

- **深度集成架构**: 完全集成到 NapCatQQ 框架中，共享底层 QQ 连接和 API
- **现代化 Web 界面**: 基于 React + NextUI 构建的响应式管理界面
- **企业级后端**: Express + WebSocket 驱动的 API 服务器，支持实时状态推送
- **数据持久化**: SQLite 数据库存储，支持断点续传和任务恢复
- **定时导出系统**: 基于 cron 表达式的灵活定时任务调度器
- **资源管理**: 智能资源下载和缓存系统，确保附件完整性
- **安全机制**: 内置权限验证和错误恢复机制
- **多格式导出**: HTML、JSON、TXT 三种格式，满足不同使用场景

## 快速开始

### 下载安装

前往 [Releases 页面](https://github.com/shuakami/qq-chat-exporter/releases) 下载最新版本的 V4 工具包。

### 基本使用流程

1.  **启动 NapCatQQ**: 解压下载的文件，运行 `NapCatWinBootMain.exe`，使用手机 QQ 扫码登录
2.  **访问管理界面**: 浏览器打开 `http://localhost:40653`，使用控制台的密钥登录
3.  **进入 QCE 模块**: 在 NapCat 管理界面中找到 "QQ 聊天记录导出" 模块
4.  **开始导出**: 选择聊天对象，配置导出参数，创建导出任务
5.  **管理任务**: 在任务列表中监控进度，下载完成的文件

详细使用说明请查看：[使用文档](https://qce.sdjz.wiki)

## 架构说明

### V4 版本技术架构
V4 版本采用现代化的微服务架构，主要组件包括：

- **NapCatQQ 框架**: 提供 QQ 协议适配和基础 API
- **QCE API 服务器**: Express 应用，监听端口 40653，提供完整的 RESTful API
- **WebSocket 服务**: 实时推送任务状态和系统事件  
- **SQLite 数据库**: 存储任务配置、消息缓存和系统状态
- **Web 前端**: React 应用，提供直观的图形化操作界面
- **定时任务调度器**: 支持 cron 表达式的自动化导出系统
- **资源处理器**: 负责媒体文件的下载、验证和存储

### V3 版本（Go 实现）
V3 版本使用 Go 语言重写，通过 NapCat 中间件提供的 API 接口获取 QQ 数据。引入了 SQLite 数据库来存储消息，实现了断点续传和实时保存功能。

### V2 版本（JavaScript 方案）
V2 版本利用了 QQ NT 客户端基于 Electron 的特性，通过向其内置的 Chromium 浏览器注入 JavaScript 脚本来抓取 DOM 节点上的聊天记录。

## 版本历史

### V4 版本：集成架构方案（当前版本）
**发布时间**: 2024年
**主要特性**: 完全集成到 NapCatQQ 框架，提供企业级聊天记录管理解决方案
**技术栈**: TypeScript + Express + React + NextUI + SQLite
**下载地址**: [最新 Release](https://github.com/shuakami/qq-chat-exporter/releases/latest)

### V3 版本：Go 语言重构方案
**发布时间**: 2023年
**主要特性**: 独立 Go 程序，SQLite 数据库，断点续传，实时保存
**技术栈**: Go + SQLite + WebSocket + HTML/CSS
**访问方式**: 查看历史提交记录

### V2 版本：JavaScript 浏览器方案
**发布时间**: 2022年
**主要特性**: 基于 DOM 操作的浏览器端解决方案，支持图片导出
**技术栈**: JavaScript + IndexedDB + Web Worker
**源码链接**: [查看 V2 提交](https://github.com/shuakami/qq-chat-exporter/tree/a257756a22febfba783e8ce5926c5382f81e57f6)

### V1 版本：Python 原型方案
**发布时间**: 2021年
**主要特性**: 最初的 Python 实现版本，功能基础但稳定
**技术栈**: Python + 文件系统
**下载地址**: [v1.0.0 Release](https://github.com/shuakami/qq-chat-exporter/releases/tag/v1.0.0)
**使用文档**: [V1 使用说明](https://github.com/shuakami/qq-chat-exporter/tree/144c3e74c658b2822ad36ac6423d84716b0519b5)

## 免责声明

**请务必仔细阅读以下免责声明：**

本项目仅供**个人学习研究**和**数据备份**使用，严禁用于任何商业用途和非法目的。项目与腾讯公司无任何关联，属于**非官方第三方工具**。

使用本工具可能违反QQ用户协议。根据最新反馈，腾讯通常采用**警告提示**而非封号处理，但政策可能随时调整。**V3/V4 版本**通过优化请求策略显著降低了风控触发概率，但用户仍需**自行承担使用风险**。

请严格遵守**数据隐私**原则，仅导出本人聊天记录，不得用于侵犯他人隐私、诽谤、骚扰等违法行为。导出的数据应妥善保管，避免泄露或滥用。

开发者不对使用本工具导致的**任何直接或间接损失**负责，包括但不限于账号安全、数据丢失、法律风险等问题。用户应充分评估风险并采取适当的防护措施。

如腾讯公司认为本项目存在不当之处，欢迎通过正当渠道联系处理。

**继续使用即表示您已充分理解并同意承担上述所有风险。如有疑虑，请立即停止使用。**

## 许可证

本项目采用 [GNU通用公共许可证 v3 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html) 开源。

如果有帮到你，顺手点个star呗～

没帮到你也欢迎来issue区骂我，狠狠鞭策我～