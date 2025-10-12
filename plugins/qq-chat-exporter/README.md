# QQ聊天记录导出工具 - NapCat插件版

## 安装使用

### 1. 安装依赖
```bash
cd plugins/qq-chat-exporter
npm install
```

### 2. 复制插件到NapCat
将整个 `qq-chat-exporter` 文件夹复制到NapCat的 `plugins` 目录

### 3. 重启NapCat
插件会自动加载

### 4. 访问
- API: http://localhost:40653
- Web界面: http://localhost:40653/qce-v4-tool

## 架构说明

采用Overlay架构：
- `node_modules/NapCatQQ/` - 运行时代理层
- `lib/` - 业务代码
- 所有NapCat API通过Bridge转发到宿主

## macOS兼容性

✓ 不直接依赖NapCat源码
✓ 不接触wrapper.node
✓ 避免dyld符号冲突

## 更新Overlay

当NapCat版本更新时：
```bash
npm run gen:overlay
```

