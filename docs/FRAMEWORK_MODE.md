# NapCat Framework 模式安装指南

QQ Chat Exporter (QCE) 支持两种运行模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **Shell** | 独立的无头 QQ 实例 | 服务器、Docker、自动化备份 |
| **Framework** | 作为 QQNT 插件运行 | Windows 桌面用户，与 QQNT 共存 |

## Framework 模式优势

- 与正在使用的 QQNT 共享登录状态，无需单独登录
- 可以在使用 QQ 的同时进行聊天记录备份
- 支持定时备份功能，无需保持独立 QQ 实例在线

## 安装步骤

### 前置要求

1. 已安装 [LiteLoaderQQNT](https://liteloaderqqnt.github.io/)
2. 已安装 [NapCat Framework](https://napneko.github.io/) 插件

### 安装 QCE 插件

1. 下载 QCE 插件包（`qq-chat-exporter-plugin.zip`）

2. 解压到 NapCat 的插件目录：
   ```
   %APPDATA%/LiteLoaderQQNT/plugins/NapCat/plugins/qq-chat-exporter/
   ```

3. 目录结构应如下：
   ```
   plugins/
   └── qq-chat-exporter/
       ├── index.mjs
       ├── package.json
       ├── lib/
       │   ├── api/
       │   ├── core/
       │   └── ...
       └── node_modules/
   ```

4. 重启 QQNT

5. 访问 `http://localhost:40653/qce-v4-tool` 打开管理界面

## 验证安装

在 QCE 管理界面的首页，状态栏会显示当前运行模式：

- **Framework** (紫色指示器): 正在以 QQNT 插件模式运行
- **Shell** (蓝色指示器): 正在以独立无头模式运行

## 常见问题

### Q: Framework 模式下定时备份会影响 QQ 使用吗？

A: 不会。Framework 模式下 QCE 与 QQNT 共享进程，备份操作在后台进行，不会影响正常聊天。

### Q: 两种模式的功能有区别吗？

A: 功能完全相同。唯一区别是登录方式和运行环境。

### Q: 可以同时运行两种模式吗？

A: 不建议。同一个 QQ 账号同时只能在一个地方登录。

## 相关链接

- [NapCat 官方文档](https://napneko.github.io/)
- [LiteLoaderQQNT](https://liteloaderqqnt.github.io/)
- [QCE GitHub](https://github.com/shuakami/qq-chat-exporter)
