# Linux 部署指南

QCE 的 Shell 包在 Linux 上原生可用，无需 Wine 或 Docker。本文档描述官方 `linuxqq` deb/rpm 包之上、基于 NapCat Shell 的标准部署流程，以及在无桌面服务器上常见的几个坑位。

## 适用场景

- 仅做归档/导出的 Linux 服务器（无 X 桌面、无 GPU）
- 个人 Linux 桌面想跑 QCE
- macOS（仅做了路径自动检测，仍以 Linux 路径为主，详见末节）

如果你正在使用 Docker 部署 NapCat，请改看 [docker-napcat-deployment.md](docker-napcat-deployment.md)。

## 系统要求

| 项 | 版本 |
|---|---|
| 内核 / 发行版 | Ubuntu 22.04 / Debian 11 / RHEL 9 / Fedora 38 或更新 |
| 架构 | x86_64 (`amd64`) |
| Node.js | 18.x 或更新 |
| 编译器 | `g++`（构建 `qq_magic.so`）|
| 系统库 | `libgnutls30`、`libdbus-1-3`、`libnotify4`、`libappindicator3-1` |

ARM64 / loong64 / mips64el 的 Linux QQ 客户端腾讯也提供，但 Shell 包当前仅在 x86_64 上 CI 构建过；其他架构需要自行用 `scripts/quick-pack.py` 重新打包。

## 安装步骤

### 1. 安装 QQ NT Linux 客户端

从 https://im.qq.com/linuxqq/index.html 下载对应包，例如：

```bash
# Ubuntu / Debian
curl -L -o linuxqq.deb \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq_3.2.27-47256_amd64.deb"
sudo apt-get install -y ./linuxqq.deb
```

```bash
# RHEL / Fedora / Rocky
sudo dnf install -y \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq-3.2.27-47256.x86_64.rpm"
```

安装完成后 `/opt/QQ/qq` 应该就位（`/usr/bin/qq` 是它的软链接，启动器会用 `readlink -f` 解到真实路径）。

### 2. 安装运行时依赖

```bash
sudo apt-get install -y \
    nodejs \
    g++ \
    libgnutls30 \
    libdbus-1-3 \
    libnotify4 \
    libappindicator3-1
```

如果发行版自带的 Node.js 版本太旧（< 18），改用 [NodeSource](https://github.com/nodesource/distributions) 或 nvm。

`g++` 用于第一次启动时编译 `qq_magic.so`（详见 [#3](#3-qqmagicso)）。如果你的 Release 包里已经带了预编译产物，那 `g++` 就只是兜底，不装也能跑。

### 3. 解压 QCE Shell 包

到 [Releases](https://github.com/shuakami/qq-chat-exporter/releases) 下载 `NapCat-QCE-Linux-x64-vXXX.tar.gz`，随便找个目录解压：

```bash
mkdir -p ~/qce && cd ~/qce
tar -xzf ~/Downloads/NapCat-QCE-Linux-x64-vXXX.tar.gz
cd NapCat-QCE-Linux-x64
```

### 4. 启动

```bash
./launcher-user.sh
```

正常情况下会看到：

```
[Info] QQ Path: /opt/QQ/qq
[Info] LD_PRELOAD: /lib/x86_64-linux-gnu/libgnutls.so.30:.../qq_magic.so
Starting NapCat + QCE...
[bootstrap] process.execPath overridden -> /opt/QQ/qq
NapCat Shell App Loading...
... [NapCat] [Core] NapCat.Core Version: 4.18.x
... [NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6099/webui?token=...
```

随后控制台会打印一张二维码（同时保存到 `cache/qrcode.png`）。用手机 QQ 扫码登录后，QCE 的导出 API 会监听在 `40653`：

```
http://<服务器IP>:40653/qce-v4-tool/
```

如果是远端服务器，建议通过 SSH 端口转发或反向代理（nginx / caddy）暴露 40653，不要直接公网放出来。

## 启动器做了什么

`launcher-user.sh` 替你处理 NapCat 在 Linux 上原本对 Windows 安装链假设过强的几个点：

1. **`NAPCAT_QQ_PATH` 自动探测**：依次检查 `/opt/QQ/qq`、`/opt/linuxqq/qq`、`/usr/share/QQ/qq`、Snap、Flatpak、`/Applications/QQ.app/Contents/MacOS/QQ`，并用 `readlink -f` 解软链接。`/usr/bin/qq` 会被解析成 `/opt/QQ/qq`，否则 NapCat 会按 `path.dirname(/usr/bin/qq) = /usr/bin` 去找 `/usr/bin/resources/app/...`，这是 [#314](https://github.com/shuakami/qq-chat-exporter/issues/314) 报告的崩溃路径。

2. **`napcat-bootstrap.mjs` 注入 `process.execPath`**：NapCat 的 `QQBasicInfoWrapper` 从 `process.execPath` 推导 `resources/app/package.json` 路径，但这个值在 Linux 上是 Node.js 二进制的位置而不是 QQ 二进制的位置。引导 shim 在 `import napcat.mjs` 之前用 `Object.defineProperty` 把它改成 `NAPCAT_QQ_PATH`。

3. **`qq_magic.so` 的 `LD_PRELOAD`**：Linux QQ 不导出 `qq_magic_napi_register` 这个 NapCat 用来跳过模块签名检查的符号。我们 ship 一个微型动态库，定义这个符号并在运行期通过 `dlsym` 转发到真正的 `napi_module_register`。如果 Release 包里没有预编译的 `qq_magic.so`，启动器会用 `g++ -shared -fPIC -O2 -o qq_magic.so qq_magic.cpp -ldl` 在原地编一份。

4. **`libgnutls.so.30` 的 `LD_PRELOAD`**：QQ 的 `libbugly.so` 引用了 `gnutls_free` 等符号，但 ELF 头里没有列 `libgnutls` 为 NEEDED 依赖。导致 dlopen 时报 `undefined symbol: gnutls_free`。启动器在检测到 `libbugly.so` 时自动把系统的 `libgnutls.so.30` 也加进 `LD_PRELOAD`。

5. **`NAPCAT_DISABLE_MULTI_PROCESS=1`**：NapCat 的 master/worker 模式用 `child_process.fork(napcat.mjs)` 起子进程，且默认让 `options.execPath = process.execPath`，即被引导 shim 改写后的 QQ 二进制。`fork` 等于在子进程中起完整的 Electron（chrome-sandbox / GPU / dbus），无桌面服务器上 chrome-sandbox 的 seccomp-bpf 必崩。启动器默认强制单进程模式，`NCoreInitShell` 在主 Node 进程内直接运行。如果你确实需要 master/worker，自行 `export NAPCAT_DISABLE_MULTI_PROCESS=0` 后再启动。

启动器只在 `OSTYPE == linux*` 时做 3、4、5；macOS 走 1 + 2 即可。

## 验证

启动器跑起来之后可以用以下命令快速确认：

```bash
# 1. NapCat WebUi 已起
ss -lnt | grep 6099

# 2. QR 码是否生成
ls -la cache/qrcode.png

# 3. 扫码登录后 QCE 端口
ss -lnt | grep 40653
curl -s http://127.0.0.1:40653/api/health
```

## 常见问题

### `Error: ENOENT: no such file or directory, open '/usr/bin/resources/app/.../package.json'`

NapCat 在用 `/usr/bin/qq` 而不是 `/opt/QQ/qq` 推路径，等于 v5.5.25 之前的老 bug 复发。三种可能：

- 你在用旧版本 QCE（< v5.5.25），更新一下。
- 你手动 `export NAPCAT_QQ_PATH=/usr/bin/qq` 而没用 `readlink -f`：改成 `export NAPCAT_QQ_PATH=$(readlink -f /usr/bin/qq)` 或者直接删掉这个变量让启动器自己探测。
- QQ 安装到了非标准路径，启动器候选列表没覆盖：手动 `export NAPCAT_QQ_PATH=/your/path/to/qq` 即可。

### `Error: /opt/QQ/resources/app/libbugly.so: undefined symbol: gnutls_free`

- 系统未装 `libgnutls30`：`sudo apt-get install -y libgnutls30`。
- 装了但启动器没把它 preload 进去：检查 `ldconfig -p | grep libgnutls.so.30` 是否能查到。

### 启动后只看到 chromium / sandbox / seccomp-bpf 报错，无 QR 码

NapCat 多进程模式没禁掉，启动器把 `NAPCAT_DISABLE_MULTI_PROCESS` 设漏了。检查：

```bash
env | grep NAPCAT_DISABLE
```

不存在的话用 `export NAPCAT_DISABLE_MULTI_PROCESS=1` 强制单进程，再启动。

### `qq_magic.so compile failed`

- 装 `g++`：`sudo apt-get install -y g++ build-essential`。
- 实在装不上 `g++`，去找一个同架构 Linux 编一份：

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

  把 `qq_magic.so` 拷回去和 `launcher-user.sh` 同目录即可。

### 多个 QQ 账号 / 切账号

NapCat 的 `cache/`、`config/` 持久化在脚本同目录下。一个账号一份目录最简单。

## 在 systemd 上长期跑

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

# 仅限本机访问 NapCat WebUi 和 QCE，远端走反向代理
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

第一次启动时仍然要扫码登录。`config/` 目录会持久化登录态，重启 service 不会再要求扫码。

## macOS 备注

`launcher-user.sh` 同时覆盖 macOS（`/Applications/QQ.app/Contents/MacOS/QQ`、`~/Applications/QQ.app/Contents/MacOS/QQ`）。第 3、4、5 步是 Linux 专属，macOS 上不会执行。

但 macOS 上目前未做端到端验证：

- LD_PRELOAD 在 macOS 是 `DYLD_INSERT_LIBRARIES`，且需要禁用 SIP 才生效；
- `qq_magic.so` 等价物（`qq_magic.dylib`）尚未生成；
- macOS QQ 内部模块结构也跟 Linux 不完全一样。

如果你愿意在 macOS 上踩通，欢迎来 issue 区反馈，我们再把它合到这份文档里。
