以下是适用于Claude在工作中的部署指南。

## 1. 更新插件代码到测试环境

### 1.1 构建 NapCatQQ Overlay Runtime

```powershell
# 如果修改了任何导入 NapCatQQ 的代码，必须先运行此命令
node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs
```

### 1.2 复制插件核心代码

```powershell
# 复制插件核心代码
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\lib\*" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\lib\"
```

### 1.3 复制 NapCatQQ Overlay Runtime

```powershell
# 删除旧的 NapCatQQ overlay 文件夹
Remove-Item -Recurse -Force "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\NapCatQQ" -ErrorAction SilentlyContinue

# 复制新的 NapCatQQ overlay 文件夹（注意：复制整个文件夹，不是文件夹内容）
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\node_modules\NapCatQQ" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\"
```

### 1.4 一键部署命令（推荐）

```powershell
# 完整部署插件（包含 overlay runtime 构建和复制）
node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\lib\*" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\lib\"
Remove-Item -Recurse -Force "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\NapCatQQ" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "plugins\qq-chat-exporter\node_modules\NapCatQQ" "NapCat-QCE-Windows-x64\plugins\qq-chat-exporter\node_modules\"
```

## 2. 更新前端代码到测试环境

### 2.1 编译前端（如果有修改）

```powershell
cd qce-v4-tool
npm run build
cd ..
```

### 2.2 复制前端文件

```powershell
# 删除旧的前端文件
Remove-Item -Recurse -Force "NapCat-QCE-Windows-x64\static\qce-v4-tool" -ErrorAction SilentlyContinue

# 创建目录并复制新编译的前端文件
New-Item -ItemType Directory -Force -Path "NapCat-QCE-Windows-x64\static\qce-v4-tool"
Copy-Item -Recurse -Force "qce-v4-tool\out\*" "NapCat-QCE-Windows-x64\static\qce-v4-tool\"
```

## 3. 注意事项

1. **NapCatQQ Overlay Runtime**: 修改任何导入 `NapCatQQ` 的代码后，必须重新运行构建工具
2. **复制 NapCatQQ 时注意**: 必须复制整个文件夹，保持 `src/core/` 目录结构完整
3. **前端构建产物**: 必须保持 `_next/static/` 完整层级
4. **路径引用**: index.html 中的路径引用是 `/static/qce-v4-tool/_next/static/...`
5. **静态路径映射**: FrontendBuilder 将 staticPath 映射到 `/static/qce-v4-tool`
6. **新增依赖**: 如果安装了新的 npm 包，需要同步复制 node_modules（通常不需要，因为测试环境已有）

## 4. 常见错误

### Error: Cannot find module 'NapCatQQ'
**原因**: 未运行 overlay runtime 构建工具  
**解决**: 运行 `node plugins/qq-chat-exporter/tools/create-overlay-runtime.cjs`

### Error: Cannot find module '.../src/core/types.js'
**原因**: 复制 NapCatQQ 时使用了错误的命令（如 `Copy-Item ... NapCatQQ\*` 而不是 `Copy-Item ... NapCatQQ`）  
**解决**: 删除旧文件夹，使用正确的复制命令（见 1.3）

