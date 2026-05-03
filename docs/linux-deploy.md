# Linux 部署指南

QCE 的 Shell 模式包在 Linux 上原生可用，本文档描述基于官方 `linuxqq` deb / rpm 之上、配合 NapCat Shell 的部署流程。

如使用 Docker 部署 NapCat，请改看 [Docker NapCat 部署](docker-napcat-deployment.md)。

## 前提条件

| 项 | 版本 |
|---|---|
| 发行版 | Ubuntu 22.04 / Debian 11 / RHEL 9 / Fedora 38 或更新 |
| 架构 | x86_64 |
| Node.js | 18 或更新 |
| 编译器 | `g++`（用于 `qq_magic.so`）|
| 系统库 | `libgnutls30`、`libdbus-1-3`、`libnotify4`、`libappindicator3-1` |

ARM64 / loong64 / mips64el 的 Linux QQ 客户端官方提供，但 Shell 包目前仅在 x86_64 上 CI 构建，其他架构需自行用 `scripts/quick-pack.py` 重新打包。

## 部署步骤

### 1. 安装 QQ NT Linux 客户端

从 https://im.qq.com/linuxqq/index.html 下载对应包：

```bash
# Debian / Ubuntu
curl -L -o linuxqq.deb \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq_3.2.27-47256_amd64.deb"
sudo apt-get install -y ./linuxqq.deb
```

```bash
# RHEL / Fedora
sudo dnf install -y \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq-3.2.27-47256.x86_64.rpm"
```

### 2. 安装运行时依赖

```bash
sudo apt-get install -y \
    nodejs g++ \
    libgnutls30 libdbus-1-3 libnotify4 libappindicator3-1
```

发行版自带的 Node.js 版本低于 18 时，使用 [NodeSource](https://github.com/nodesource/distributions) 或 nvm。

### 3. 解压 QCE Shell 包

从 [Releases](https://github.com/shuakami/qq-chat-exporter/releases) 下载 `NapCat-QCE-Linux-x64-vXXX.tar.gz`：

```bash
mkdir -p ~/qce && cd ~/qce
tar -xzf ~/Downloads/NapCat-QCE-Linux-x64-vXXX.tar.gz
cd NapCat-QCE-Linux-x64
```

### 4. 启动

```bash
./launcher-user.sh
```

启动器会自动：

- 探测 QQ 安装路径（`/opt/QQ/qq`、`/opt/linuxqq/qq`、`/usr/share/QQ/qq`、Snap、Flatpak），用 `readlink -f` 解软链
- 设置 `LD_PRELOAD`，包含 `qq_magic.so` 和 `libgnutls.so.30`
- 在 `qq_magic.so` 缺失而 `g++` 可用时原地编译
- 在 Linux 上默认 `NAPCAT_DISABLE_MULTI_PROCESS=1`

启动成功后控制台会打印二维码（同时保存到 `cache/qrcode.png`），用手机 QQ 扫码登录。NapCat WebUI 监听 6099，QCE 监听 40653：

```
http://<服务器IP>:40653/qce-v4-tool/
```

远端服务器建议通过 SSH 端口转发或反向代理（nginx / caddy）暴露 40653，不直接公网放出。

## 环境变量

启动器尊重以下环境变量，未设置时使用默认值：

| 变量 | 默认 | 用途 |
|---|---|---|
| `NAPCAT_QQ_PATH` | 自动探测 | QQ 二进制路径 |
| `NAPCAT_DISABLE_MULTI_PROCESS` | `1`（Linux） | 禁用 NapCat 多进程模式 |
| `LD_PRELOAD` | `qq_magic.so:libgnutls.so.30` | 见 [#常见问题](#常见问题) |

需要 NapCat master / worker 模式时设置 `NAPCAT_DISABLE_MULTI_PROCESS=0`。

## 常见问题

### `Error: ENOENT: no such file or directory, open '/usr/bin/resources/app/.../package.json'`

NapCat 用 `/usr/bin/qq` 而不是 `/opt/QQ/qq` 推路径。检查：

- QCE 版本是否低于 v5.5.25（早期 Linux 路径解析 bug 会复发）
- 手动 `export NAPCAT_QQ_PATH=/usr/bin/qq` 时未解软链：改成 `export NAPCAT_QQ_PATH=$(readlink -f /usr/bin/qq)`，或直接删掉变量让启动器自己探测
- QQ 装在非标准路径，启动器候选列表未覆盖：手动 `export NAPCAT_QQ_PATH=/your/path/to/qq`

### `Error: /opt/QQ/resources/app/libbugly.so: undefined symbol: gnutls_free`

```bash
sudo apt-get install -y libgnutls30
```

确认 `ldconfig -p | grep libgnutls.so.30` 能查到该库。

### 启动后只看到 chrome-sandbox / seccomp-bpf 报错，无二维码

NapCat 多进程模式未禁用：

```bash
env | grep NAPCAT_DISABLE
```

不存在则 `export NAPCAT_DISABLE_MULTI_PROCESS=1` 后重新启动。

### `qq_magic.so compile failed`

```bash
sudo apt-get install -y g++ build-essential
```

无法安装 `g++` 时，在另一台同架构 Linux 上编译：

```bash
cat > qq_magic.cpp <<'EOF'
#include <dlfcn.h>
extern "C" void qq_magic_napi_register(void *m) {
    typedef void (*reg_fn)(void *);
    static reg_fn fn = (reg_fn) dlsym(RTLD_DEFAULT, "napi_module_register");
    if (fn) fn(m);
}
EOF
g++ -shared -fPIC -O2 -o qq_magic.so qq_magic.cpp -ldl
```

把 `qq_magic.so` 复制回与 `launcher-user.sh` 同目录。

### 多账号

`cache/`、`config/` 持久化在脚本同目录，每个账号使用独立目录。

## 在 systemd 上运行

```ini
# /etc/systemd/system/qce.service
[Unit]
Description=QQ Chat Exporter (NapCat Shell)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=qce
WorkingDirectory=/home/qce/NapCat-QCE-Linux-x64
ExecStart=/home/qce/NapCat-QCE-Linux-x64/launcher-user.sh
Restart=on-failure
RestartSec=10s

PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -m -s /bin/bash qce
sudo cp -r NapCat-QCE-Linux-x64 /home/qce/
sudo chown -R qce:qce /home/qce/NapCat-QCE-Linux-x64
sudo systemctl daemon-reload
sudo systemctl enable --now qce.service
journalctl -u qce.service -f
```

首次启动仍需扫码登录，`config/` 目录持久化登录态，重启 service 不再要求扫码。

## macOS

`launcher-user.sh` 同时覆盖 macOS 路径（`/Applications/QQ.app/Contents/MacOS/QQ`、`~/Applications/QQ.app/Contents/MacOS/QQ`）。Linux 专属的 `LD_PRELOAD` / `NAPCAT_DISABLE_MULTI_PROCESS` 在 macOS 上不会执行。

macOS 端到端流程目前未验证：

- macOS 使用 `DYLD_INSERT_LIBRARIES`，且需禁用 SIP 才生效
- `qq_magic.dylib` 尚未生成
- macOS QQ 内部模块结构与 Linux 不完全一致

欢迎 macOS 用户在 issue 区反馈实测情况。
