# Linux 部署指南

QCE 的 Shell 模式包可以在 Linux 系统上原生运行，接下来我会介绍如何在官方 `linuxqq` 客户端（deb/rpm 包）的基础之上，配合 NapCat Shell 完成环境部署与运行。

*注意：如果你打算使用 Docker 容器来部署，请直接查阅 [Docker NapCat 部署](docker-napcat-deployment.md) 文档。*

## 前提条件与依赖

在安装之前，请先确认你的 Linux 服务器满足以下要求哟：

| 配置项 | 推荐版本 / 要求 |
| --- | --- |
| **操作系统** | Ubuntu 22.04+ / Debian 11+ / RHEL 9+ / Fedora 38+ 或更新版本 |
| **系统架构** | x86_64 (AMD64) |
| **Node.js 运行时** | Node.js 18 或更高版本 |
| **编译器环境** | 需要安装 `g++`（用于现场编译 `qq_magic.so` 注入模块） |
| **必备系统底层库** | `libgnutls30`、`libdbus-1-3`、`libnotify4`、`libappindicator3-1` |

随包提供的 `qce-server` 使用静态 musl 构建，因此不要求宿主机提供特定版本的 glibc。此兼容性仅适用于 Rust 服务端；Linux QQ、NapCat、Node.js 和注入模块仍须满足上表及各自的系统依赖。

虽然腾讯官方提供了 ARM64、loong64 和 mips64el 架构的 Linux QQ 客户端，但目前 QCE 的 Shell 预编译包仅在 x86_64 架构下进行自动化构建QAQ。

如果你使用的是树莓派等 ARM64 架构设备，需要克隆源码并自行使用 `scripts/quick-pack.py` 重新打包。

---

## 部署具体步骤

### 1. 安装官方 Linux QQ 客户端

访问腾讯 QQ 官网的 Linux 版本页面，根据你的发行版下载并安装对应的软件包。以下是常见系统的安装命令：

#### Debian / Ubuntu 系统：

```bash
# 下载 deb 安装包
curl -L -o linuxqq.deb \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq_3.2.27-47256_amd64.deb"

# 本地安装并自动补全依赖
sudo apt-get install -y ./linuxqq.deb
```

#### RHEL / Fedora 系统：

```bash
# 直接通过包管理器在线安装 rpm 包
sudo dnf install -y \
  "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/linuxqq-3.2.27-47256.x86_64.rpm"
```

### 2. 安装系统运行时依赖

工具的后台需要 Node.js 运行环境和相关的动态链接库，运行以下命令统一安装：

```bash
sudo apt-get install -y \
    nodejs g++ \
    libgnutls30 libdbus-1-3 libnotify4 libappindicator3-1
```

*提示：如果你的 Linux 发行版自带的 Node.js 版本低于 18，请自行通过 NodeSource 官方源或者 nvm 工具将 Node.js 升级到 18 或更高版本。*

### 3. 下载并解压 QCE Shell 运行包

去 [GitHub Releases](https://github.com/shuakami/qq-chat-exporter/releases) 页面下载最新的 Linux 压缩包，并在你的主目录下解压：

```bash
# 创建工作目录并进入
mkdir -p ~/qce && cd ~/qce

# 解压下载好的 Linux 压缩包（请将 vXXX 替换为实际的版本号）
tar -xzf ~/Downloads/NapCat-QCE-Linux-x64-vXXX.tar.gz

# 进入解压后的程序目录
cd NapCat-QCE-Linux-x64
```

### 4. 启动程序与扫码登录

在解压目录中直接执行启动脚本：

```bash
./launcher-user.sh
```

**登录操作：**
启动成功后，控制台窗口会出现登录二维码（同时也会在 `cache/qrcode.png` 保存一份图片文件）。只需要打开手机 QQ 扫描控制台的二维码就可以完成登录力。

**访问网页：**
登录成功后，后台服务开始正常运转。其中 NapCat 的基础 WebUI 占用 `6099` 端口，**QCE 的聊天记录导出管理界面占用 `40653` 端口**。你可以在局域网或本地浏览器中访问：

```
http://<你的服务器IP>:40653/qce/
```

登录网页所需的访问令牌（Access Token）存放在主目录的 `~/.qq-chat-exporter/security.json` 配置文件中，找到 `accessToken` 字段复制进去即可，具体细节可以参考[使用手册](guide.md#login)。

注意了，如果是将工具部署在公网远端服务器上，不建议将 `40653` 端口直接暴露到公网。推荐通过 SSH 隧道转发本地端口，或者使用 Nginx / Caddy 配置文件反向代理，并开启 HTTPS 加密访问。

---

## 支持的环境变量

启动脚本在运行时会读取以下环境变量。如果这些变量未手动设置，脚本将采用默认策略：

| 环境变量名称 | 默认值 | 具体用途说明 |
| --- | --- | --- |
| `NAPCAT_QQ_PATH` | 自动探测 | 手动指定 Linux QQ 的绝对执行路径。 |
| `NAPCAT_DISABLE_MULTI_PROCESS` | `1` | 决定是否禁用 NapCat 的多进程模式（Linux 下默认禁用）。 |
| `LD_PRELOAD` | `qq_magic.so:libgnutls.so.30` | 动态库预加载路径，用于核心注入和防崩溃。 |
| `QCE_LINUX_LEGACY_LAUNCH` | `0` | 如果设为 `1`，将切换到旧版的独立 Node 启动方式（常用于解决多端同时在线问题）。 |

---

## 如何实现与桌面 QQ 同时在线

在较新版本中，Linux 默认的启动机制变更为直接拉起真实的 QQ Electron 核心进程（执行 `qq --no-sandbox` 命令），并通过 `LD_PRELOAD` 注入。这意味着此时 QCE 抢占的是标准「PC 桌面端」的登录名额。

**这会导致抢登冲突**：如果你在自己的普通电脑上登录了桌面版 QQ，一旦在服务器上启动了 QCE 完整模式，你的桌面 QQ 就会被强制顶下线；反之，在电脑上登录 QQ，服务器上的 QCE 也会断开连接。

如果你希望两边同时保持在线，可以给启动脚本加上参数，强制回退到旧版的启动方式——让程序以独立的 Node 进程直接去跑 `napcat-bootstrap.mjs`。这种机制不占用 PC 登录名额（与 macOS 的处理逻辑一致）：

```bash
# 方式一：直接在启动命令后加参数
./launcher-user.sh --legacy

# 方式二：通过环境变量启动
QCE_LINUX_LEGACY_LAUNCH=1 ./launcher-user.sh
```

不过，在部分 Linux 发行版上，使用这种兼容模式登录时可能会导致底层的 `wrapper.node` 发生段错误（Segmentation fault）而崩溃。如果你开启该模式后程序频繁闪退，说明系统不支持，请去掉参数回到默认的 Electron 启动方式。

---

## 常见问题

### 报错：`Error: ENOENT: no such file or directory, open '/usr/bin/resources/app/.../package.json'`

* **原因分析**：说明 NapCat 在推导路径时误将软链接 `/usr/bin/qq` 当作了实际安装目录，导致去错误的路径下寻找资源文件。
* **解决方法**：
    1. 请检查你的 QCE 是否低于 v5.5.25 版本，早期版本存在 Linux 路径解析缺陷，请更新到最新版。
    2. 如果你在环境变量里手动写了 `export NAPCAT_QQ_PATH=/usr/bin/qq`，请将其修改为解析真实路径的写法：`export NAPCAT_QQ_PATH=$(readlink -f /usr/bin/qq)`。或者直接将这一行配置从环境变量中删掉，让脚本自己去探测。

### 报错：`Error: /opt/QQ/resources/app/libbugly.so: undefined symbol: gnutls_free`

* **原因分析**：系统缺少必要的安全通信动态库。
* **解决方法**：通过包管理器补充安装库文件：`sudo apt-get install -y libgnutls30`。安装后可以使用 `ldconfig -p | grep libgnutls.so.30` 命令确认系统是否已经成功识别到该库。

### 启动后控制台只看到 `chrome-sandbox` 或 `seccomp-bpf` 报错，完全不打印二维码

* **原因分析**：Linux 服务器环境（尤其是无图形界面的沙盒环境）没有成功禁用 QQ 的多进程架构。
* **解决方法**：在终端执行 `env | grep NAPCAT_DISABLE` 检查变量是否存在。如果输出为空，请在终端手动执行 `export NAPCAT_DISABLE_MULTI_PROCESS=1` 之后，再重新运行启动脚本。

### 提示：`qq_magic.so compile failed`（编译失败）

* **原因分析**：系统缺乏基本的编译环境，无法编译 C++ 注入文件。
* **解决方法**：首先执行 `sudo apt-get install -y g++ build-essential` 补充编译链。如果你的服务器因特殊原因无法配置编译环境，可以在另一台相同架构（x86_64）的 Linux 电脑上手动编译出文件再拷贝过来：

```bash
# 在其他好用的 Linux 机器上创建一个临时源码文件
cat > qq_magic.cpp <<'EOF'
#include <dlfcn.h>
extern "C" void qq_magic_napi_register(void *m) {
    typedef void (*reg_fn)(void *);
    static reg_fn fn = (reg_fn) dlsym(RTLD_DEFAULT, "napi_module_register");
    if (fn) fn(m);
}
EOF

# 使用 g++ 编译出动态链接库
g++ -shared -fPIC -O2 -o qq_magic.so qq_magic.cpp -ldl
```

编译完成后，将生成的 `qq_magic.so` 文件下载并拷贝到服务器上，直接放在与 `launcher-user.sh` 同一目录下即可。

### 如何在一台服务器上登录多个 QQ 账号？

项目的持久化数据（如登录凭证缓存 `cache/` 和任务配置 `config/`）默认存放在与脚本相同的文件夹下。如果你需要在一台机器上同时挂载多个账号，只需要将解压后的 `NapCat-QCE-Linux-x64` 文件夹复制出多份（例如 `qce_account1/`、`qce_account2/`），分别进入对应的文件夹启动即可，每个账号的数据相互独立。

---

## 配置为 systemd 系统守护进程

如果你希望将工具配置为系统服务，在后台静默运行并跟随系统开机自动启动，请参考以下配置：

1. **为工具创建独立的低权限系统用户（提高安全性）**：

```bash
sudo useradd -m -s /bin/bash qce
```

2. **将程序目录移动到该用户的主目录下，并修正权限**：

```bash
sudo cp -r NapCat-QCE-Linux-x64 /home/qce/
sudo chown -R qce:qce /home/qce/NapCat-QCE-Linux-x64
```

3. **创建系统服务配置文件**：
新建文件 `/etc/systemd/system/qce.service`，写入以下配置内容：

```ini
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

# 安全加固选项
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

4. **激活并启动服务**：

```bash
# 重新加载系统服务配置
sudo systemctl daemon-reload

# 启用开机自启并立刻运行服务
sudo systemctl enable --now qce.service

# 查看实时运行日志以获取登录二维码
journalctl -u qce.service -f
```

*提示：首次启动时，你依然需要运行最后一行日志命令，在控制台中扫码完成登录。登录成功后，登录状态会保存在该用户的 `config/` 目录中，后续重启服务或服务器开机自启时，工具会自动恢复登录，不需要重复扫码。*

---

## 关于 macOS 系统的说明

部署包中的 `launcher-user.sh` 脚本在编写时同时也兼顾了 macOS 的基础路径规则（会自动检索 `/Applications/QQ.app/Contents/MacOS/QQ` 和 `~/Applications/QQ.app/Contents/MacOS/QQ`）。Linux 专用的 `LD_PRELOAD` 环境和多进程禁用开关在检测到 macOS 系统时会自动跳过。

不过！**目前 macOS 的完整运行流程尚未经过全面端到端的验证**：

* macOS 系统下需要将注入机制改为 `DYLD_INSERT_LIBRARIES`，并且通常需要用户手动关闭系统的 SIP（系统完整性保护）功能才能让注入生效。
* 预编译包中尚未默认打包 `qq_magic.dylib` 模块。
* macOS QQ 客户端的内部底层模块结构与 Linux 版本存在一定差异。

如果你在 Mac 设备上尝试部署并遇到了问题，欢迎前往 GitHub 的 [Issue 区](https://github.com/shuakami/qq-chat-exporter/issues)提交你的实测反馈与技术日志，帮助我们一起完善 Mac 端的支持~
