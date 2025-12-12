## QQ Chat Exporter 安装到现有 NapCat（含前端）

### 推荐方式：直接使用 NapCat-QCE 整包
- 从发布页下载 NapCat-QCE 对应平台整包，完整解压即可使用。整包已包含插件、依赖（含 `NapCatQQ`、`tsx`）、生成好的 Overlay 运行时以及前端静态资源（位于 `static/qce-v4-tool`），无需额外安装或构建。
- 发行文件名（Actions `release-plugin.yml`）：`NapCat-QCE-Windows-x64.zip`、`NapCat-QCE-Linux-x64.tar.gz`，以及独立查看器 `qce-viewer.zip`（仅离线浏览导出记录）。macOS 当前未发布。

### 手动集成到您已有的 NapCat
1. **拷贝文件（必须包含 node_modules）**
   - 将发布包中的 `plugins/qq-chat-exporter` 整个目录连同其中的 `node_modules` 拷贝到您的 NapCat 根目录的 `plugins/` 下。不要只拷源码，`plugins/qq-chat-exporter/node_modules/NapCatQQ/` 必须存在。
   - 要使用内置前端，必须将发布包中的 `qce-v4-tool` 目录拷贝到 NapCat 根目录，并确保已有静态资源目录 `static/qce-v4-tool`（从发布包中复制）。
2. **启用插件**
   - 编辑 NapCat 配置文件 `config/napcat_xxx.json`（具体文件名取决于账号），在 `plugins.list` 增加：
     ```json
     {"name": "qq-chat-exporter", "enable": true, "path": "./plugins/qq-chat-exporter/index.mjs"}
     ```
3. **自检依赖（PowerShell 于 NapCat 根目录执行）**
   - `Test-Path plugins/qq-chat-exporter/node_modules/tsx`
   - `Test-Path plugins/qq-chat-exporter/node_modules/NapCatQQ/package.json`
   任一为 `False` 说明解压或拷贝不完整，请重新完整解压。
4. **启动 NapCat**
   - 通过 `launcher.bat` 等常规方式启动。日志中应出现：
     - “QQ聊天记录导出工具已启动”
     - “API 地址: http://localhost:40653”
     - “访问令牌: <token>”
5. **访问前端**
   - 浏览器打开 `http://localhost:40653/qce-v4-tool`。首次访问需要输入日志中显示的访问令牌。

### 版本兼容提醒
- 插件当前基于 NapCat 4.9.80 打包。如出现 “PacketBackend 不支持当前 QQ 版本架构” 等提示，请按 NapCat 发布页要求更换对应 QQ 版本。

### 常见问题
- **报错 `Cannot find package 'NapCatQQ'`**：说明 `plugins/qq-chat-exporter/node_modules/NapCatQQ` 缺失，请重新完整解压插件目录或改用整包。
- **报错提示安装 tsx**：发行包已自带 `tsx`，出现此提示即说明解压不完整，请重新完整解压。
- **前端 404**：确认根目录存在 `qce-v4-tool`，且 `static/qce-v4-tool` 已从发布包复制；或直接使用 NapCat-QCE 整包。***
