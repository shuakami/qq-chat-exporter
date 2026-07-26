# macOS Apple Silicon 预览支持

QQ Chat Exporter 现在可以为 Apple Silicon（arm64）构建独立的 Shell 完整包。

> [!WARNING]
> macOS 支持目前仍处于预览阶段。自动化构建会验证 ARM64 `qce-server`、压缩包结构和启动脚本，但无法在 CI 中完成真实 QQ 扫码登录与聊天记录导出验证。

## 适用范围

- Apple Silicon Mac（M1 及后续芯片）
- 已安装当前官方 macOS 版 QQ
- 已安装 Node.js 18 或更高版本
- Intel Mac 暂无官方 x64 完整包

## 安装与启动

1. 从 Releases 下载 `NapCat-QCE-macOS-arm64-v*.tar.gz`。
2. 解压后进入目录。
3. 移除 macOS 隔离属性并补充执行权限：

```bash
xattr -r -d com.apple.quarantine .
chmod +x launcher-user.sh start-standalone.sh qce-server
```

4. 启动完整模式：

```bash
./launcher-user.sh
```

5. 完成 QQ 登录后，在浏览器打开：

```text
http://localhost:40653/qce
```

## 自定义 QQ 路径

启动器会优先查找以下位置：

```text
/Applications/QQ.app/Contents/MacOS/QQ
~/Applications/QQ.app/Contents/MacOS/QQ
```

QQ 安装在其他位置时，可以手动指定：

```bash
export NAPCAT_QQ_PATH="/你的路径/QQ.app/Contents/MacOS/QQ"
./launcher-user.sh
```

`NAPCAT_QQ_PATH` 必须指向 `.app` 内部真实的 QQ 可执行文件，而不是 `.app` 目录本身。

## 独立查看模式

只需要浏览已经导出的聊天记录时，不必启动 QQ：

```bash
./start-standalone.sh
```

## 与旧版 Linux 包的区别

不要在 macOS 上使用 `NapCat-QCE-Linux-x64`。Linux 包包含 Linux 架构的服务端和注入组件，无法作为 macOS 完整包使用。

macOS 完整包会：

- 使用原生 ARM64 `qce-server`；
- 使用 macOS QQ 的 `.app` 路径；
- 通过 `napcat-bootstrap.mjs` 在加载 NapCat 前同步 QQ 可执行文件路径；
- 排除 Windows 的 BAT、DLL 和 EXE 文件。

## 反馈问题

提交 Issue 时请附上：

- Mac 芯片型号和 macOS 版本；
- QQ、QCE 与 NapCat 版本；
- `logs/qce-runtime.log`；
- 终端中从启动到报错前后的完整日志。
