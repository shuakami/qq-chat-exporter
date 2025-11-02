# QQ Chat Exporter - 聊天记录索引查看器

一个独立的 Web 应用，用于浏览和管理已导出的 QQ 聊天记录和资源。

## ✨ 功能特性

- 📁 **自动扫描** - 自动索引所有导出的聊天记录
- 💬 **智能分组** - 按聊天对象/群组分组展示
- 🖼️ **资源浏览** - 浏览图片、视频、音频、文件等资源
- 🔍 **强大搜索** - 实时搜索和多维度筛选
- 🎨 **Apple 风格** - 极简优雅的用户界面
- 🚀 **独立运行** - 无需登录 QQ 即可使用
- 📊 **统计分析** - 详细的聊天记录统计信息
- 🌐 **跨平台** - 支持 Windows、macOS、Linux

## 🚀 快速开始

### 方式一：使用启动脚本（推荐）

**Windows 用户：**
双击运行 `start.bat`

**macOS/Linux 用户：**
```bash
chmod +x start.sh
./start.sh
```

### 方式二：手动启动

1. 安装依赖
```bash
npm install
```

2. 启动服务器
```bash
npm start
```

服务器将在 `http://localhost:3000` 启动，并自动打开浏览器。

## 📖 使用说明

### 主页功能
- 📊 **统计概览** - 显示聊天记录总数、导出文件数、资源文件数
- 📋 **聊天列表** - 展示所有已导出的聊天记录
- 🔍 **搜索** - 实时搜索聊天名称或 ID
- 🎯 **筛选** - 按聊天类型（全部/群聊/私聊）筛选
- ↻ **刷新** - 重新扫描导出目录

### 聊天详情
- 📄 **导出文件** - 查看所有导出版本，支持在线查看和下载
- 🖼️ **资源浏览** - 查看聊天中的所有资源文件
- 🔍 **资源筛选** - 按类型（图片/视频/音频/文件）筛选
- 👁️ **图片预览** - 点击图片放大查看
- 📊 **详细信息** - 显示发送者、时间等信息

### 全局资源
- 🌐 **跨聊天浏览** - 浏览所有聊天中的资源
- 📊 **统计信息** - 各类型资源的数量统计
- 🎯 **类型筛选** - 快速筛选特定类型的资源

## 📂 数据源

应用会自动扫描以下目录：

**Windows**: 
```
C:\Users\<用户名>\.qq-chat-exporter\exports\
```

**macOS/Linux**: 
```
/Users/<用户名>/.qq-chat-exporter/exports/
```

### 支持的文件格式

- ✅ **JSON** - 完整元数据和资源信息（推荐）
- ✅ **HTML** - 基本元数据
- ✅ **TXT** - 文件信息
- ✅ **XLSX** - 文件信息

**💡 提示：推荐使用 JSON 格式的导出文件以获得完整的资源浏览功能。**

### 资源文件结构

资源文件需要位于 `.qq-chat-exporter/resources/` 目录下：

```
.qq-chat-exporter/
├── exports/           # 导出文件
├── resources/
│   ├── images/       # 图片文件
│   ├── videos/       # 视频文件
│   ├── audios/       # 音频文件
│   └── files/        # 其他文件
```

## ⚙️ 配置

### 自定义端口

设置环境变量 `PORT` 来修改端口：

```bash
# Windows (CMD)
set PORT=8080
npm start

# Windows (PowerShell)
$env:PORT=8080
npm start

# macOS/Linux
PORT=8080 npm start
```

## 🔧 常见问题

### 1. 显示"导出目录不存在"
✅ 确认 `.qq-chat-exporter` 目录存在，且包含 `exports` 子目录

### 2. 资源无法显示
✅ 确认资源文件存在于 `resources` 目录
✅ 检查文件名是否与导出记录中的一致
✅ 确认使用 JSON 格式导出以包含完整资源信息

### 3. 自动打开浏览器失败
✅ 手动访问 `http://localhost:3000` 即可

### 4. 搜索不到聊天记录
✅ 点击"刷新"按钮重新扫描目录

### 5. 端口被占用
✅ 使用自定义端口启动（参考上面的配置说明）

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript（无框架依赖）
- **数据源**: JSONL 和导出的 JSON/HTML 文件
- **设计风格**: Apple 极简风格

## 📝 项目结构

```
qce-viewer/
├── package.json          # 项目配置
├── server.js            # Express 服务器
├── scanner.js           # 目录扫描和解析逻辑
├── start.bat            # Windows 启动脚本
├── start.sh             # macOS/Linux 启动脚本
├── public/              # 前端文件
│   ├── index.html       # 主页
│   ├── chat.html        # 聊天详情页
│   ├── resources.html   # 全局资源页
│   ├── css/
│   │   └── style.css    # 样式文件
│   └── js/
│       ├── main.js      # 主页逻辑
│       ├── chat.js      # 聊天详情逻辑
│       └── resources.js # 资源浏览逻辑
├── README.md            # 项目说明
└── USAGE.md             # 使用说明
```

## 🔗 相关链接

- 主项目：[QQ Chat Exporter Pro](https://github.com/shuakami/qq-chat-exporter)
- 问题反馈：[GitHub Issues](https://github.com/shuakami/qq-chat-exporter/issues)

## 📄 License

MIT License

---

Made with ❤️ by [shuakami](https://github.com/shuakami)

