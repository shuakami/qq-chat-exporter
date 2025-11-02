# qce-viewer

![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-FFA500?style=flat-square&logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-10B981?style=flat-square&logoColor=white)

> [!NOTE]
> 用于查看已导出的 QQ 聊天记录的 Web 工具，无需登录 QQ 即可使用。

## 快速开始

1. 安装 Node.js 20+ (从 [nodejs.org](https://nodejs.org) 下载)

2. 运行启动脚本：
   - **Windows**：双击 `start.bat`
   - **macOS/Linux**：`chmod +x start.sh && ./start.sh`

3. 浏览器访问 `http://localhost:3000`

## 功能

支持 JSON、HTML、TXT、XLSX 格式的导出文件，可以查看聊天中的图片、视频、音频、文件等资源，支持搜索和筛选。

## 使用说明

启动后会自动扫描 `.qq-chat-exporter/exports/` 目录中的导出文件。新增文件点刷新按钮重新扫描。端口被占用的话设置环境变量 `PORT=8080`。

## 技术栈

![TypeScript](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-FFA500?style=flat-square&logo=express&logoColor=white)

后端基于 Node.js + Express，前端使用原生 JavaScript，无框架依赖。

## 许可证

本项目采用 [MIT License](https://opensource.org/licenses/MIT) 开源。

