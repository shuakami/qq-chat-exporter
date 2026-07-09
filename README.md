# QQ Chat Exporter

将 QQ 聊天记录导出为 HTML、JSON、TXT 格式。支持定时备份、批量导出、表情包导出。

![hero](https://github.com/shuakami/qq-chat-exporter/blob/9959f84b/image.png?raw=true)

## 文档

访问 https://shuakami.github.io/qq-chat-exporter/ 查看使用文档。

## 快速开始

1. 从 [Releases](https://github.com/shuakami/qq-chat-exporter/releases) 下载
2. 运行 `launcher-user.bat` (Windows) 或 `./launcher-user.sh` (Linux)
3. 用 QQ 扫码登录
4. 复制控制台的 Token
5. 打开 `http://localhost:40653/qce`

### Docker 一键部署

适用于 macOS（含 Apple Silicon）、Linux、Windows，无需安装 QQ 客户端。

1. 克隆仓库：`git clone https://github.com/shuakami/qq-chat-exporter.git`
2. 启动：`cd qq-chat-exporter/docker && docker compose up -d`
3. 查看 Token：`docker logs napcat-qce 2>&1 | grep -i token`
4. 访问：`http://localhost:40653/qce`

> Apple Silicon (M1/M2/M3/M4) 通过 Rosetta 模拟运行，首次启动可能稍慢。

详见 [Docker 部署指南](docs/docker-napcat-deployment.md)。

## 相关项目

如果导出聊天记录后，想深入分析聊天内容可以试试 [ChatLab](https://chatlab.fun/cn)

如果需要QCE 导出自动导入 ChatLab，支持定时同步可尝试[QCE2ChatLab](https://github.com/Ruoan-486/QCE2Chatlab)

也可以试试 [QQChatAnalyzer](https://github.com/CutrelyAlex/QQChatAnalyzer) - 支持个人分析、群聊分析、社交网络可视化和 AI 摘要

还可以试试 [QQ-Chat-AI-Analyzer](https://github.com/JUSTMONIKA2022/QQ-Chat-AI-Analyzer) - 基于 AI 的群聊消息总结分析工具，可生成年度报告

如果需要 Python API 封装，可以使用 [napcat-qce-python](https://github.com/streetartist/napcat-qce-python)

## 致谢

感谢 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 团队提供的框架支持。

<a href="https://github.com/shuakami/qq-chat-exporter/graphs/contributors">

  <img src="https://contrib.rocks/image?repo=shuakami/qq-chat-exporter&max=12&columns=12" width="125" />

</a>

## 许可证

[GPL-3.0](https://github.com/shuakami/qq-chat-exporter/blob/main/LICENSE)
