# macOS 部署指南（Apple Silicon 预览）

QCE 的 Shell 模式包现在也可以在 Apple Silicon（M1 及以上）Mac 上原生运行。这份文档介绍如何在官方 macOS 版 QQ 的基础之上完成部署，以及背后的运行机制。

*注意：Intel 芯片的 Mac，或者不想在本机安装 QQ 客户端的用户，请改用 [Docker NapCat 部署](docker-napcat-deployment.md)。*

⚠️ **macOS 支持目前仍处于预览阶段**，扫码登录与导出已经能正常跑通，但覆盖面还不如 Windows / Linux 版本充分。如果你在使用中遇到问题，欢迎反馈（见文末）。

⚠️ **启动前必须先完全退出电脑上的 QQ**：QCE 会用一份专属的 QQ 副本登录，它和你日常使用的 QQ 共用同一个「电脑端」登录名额。桌面 QQ 没退出时，启动器会在最开始就自动检测到并直接停止运行、给出提示，不会进入登录环节。注意点红色叉号只是关闭窗口，QQ 仍在后台运行，正确的退出方式见下面第 2 步。

## 前提条件与依赖

在安装之前，请先确认你的 Mac 满足以下要求：

| 配置项 | 推荐版本 / 要求 |
| --- | --- |
| **芯片架构** | Apple Silicon（M1 及以上，arm64）。Intel（x64）Mac 暂无官方预编译包 |
| **操作系统** | 与官方 macOS 版 QQ 的要求一致（Apple Silicon 机型的出厂系统均已满足） |
| **QQ 客户端** | 已从 [QQ 官网](https://im.qq.com/) 安装到 `/Applications/QQ.app`（或 `~/Applications/QQ.app`） |
| **Xcode 命令行工具** | 需要 `codesign`，未安装时执行 `xcode-select --install` |
| **可用磁盘空间** | 至少 1.5 GB（首次启动会在本地生成一份约 1 GB 的 QQ 运行副本，见下文） |

---

## 部署具体步骤

### 1. 下载并解压

去 [GitHub Releases](https://github.com/shuakami/qq-chat-exporter/releases) 页面下载最新的 `NapCat-QCE-macOS-arm64-vXXX.tar.gz`，然后在终端执行以下命令解压（默认解压到 `~/qce`，想放别处把命令里的路径改掉即可）：

```bash
mkdir -p ~/qce && cd ~/qce
tar -xzf ~/Downloads/NapCat-QCE-macOS-arm64-vXXX.tar.gz
cd NapCat-QCE-macOS-arm64
```

### 2. 退出桌面 QQ

用下面任意一种方式退出：

* 在程序坞（Dock）里右键点击 QQ 图标，选择「退出」；
* 或者切换到 QQ 窗口，按 `Command + Q`。

点窗口左上角的红色叉号只是关闭窗口，QQ 会继续在后台运行，程序坞图标下方的小圆点还在就说明没退干净。

如果忘了这一步，启动器会直接停下并提示 `The desktop QQ client is still running`，退出 QQ 后重新运行即可。

### 3. 启动程序与扫码登录

```bash
./launcher-user.sh
```

**首次运行会比日常慢一些**：脚本会自动在同目录下生成一份专用的 QQ 运行副本（`QQNapCatRuntime.app`），这一步涉及约 1 GB 文件的复制与重新签名，通常需要几十秒到一两分钟，具体取决于磁盘速度。这是正常现象，请耐心等待；控制台会打印 `Preparing a private, patched copy of QQ.app for NapCat` 提示。之后每次启动都会直接复用这份副本，仅在检测到 QQ 更新版本时才会重新生成。

**登录操作：**
启动成功后，控制台窗口会出现登录二维码。打开手机 QQ 扫描即可完成登录。

**访问网页：**
登录成功后，控制台会打印访问令牌和一条一键登录链接，并自动用默认浏览器打开它，直接进入操作界面（可以在网页的「设置 → 启动」里关闭这个自动打开）：

```
[QCE] Token: xxxxxxxx
[QCE] 一键登录: http://127.0.0.1:40653/qce/auth?token=...
```

浏览器没有自动弹出时，手动复制这条链接打开即可；也可以直接访问 `http://localhost:40653/qce`，把上面那串 Token 粘贴进验证框。如果两行都没看到，令牌也存在 `~/.qq-chat-exporter/security.json` 的 `accessToken` 字段里，详见[使用手册](guide.md#login)。

### 独立查看模式

只需要浏览已经导出的聊天记录、不需要登录 QQ 时，可以运行：

```bash
./start-standalone.sh
```

这个模式不用退出桌面 QQ，启动后同样会打印登录链接并自动打开浏览器。

### 自定义 QQ 路径

启动器默认按顺序查找 `/Applications/QQ.app/Contents/MacOS/QQ` 和 `~/Applications/QQ.app/Contents/MacOS/QQ`。如果你的 QQ 安装在其他位置，可以手动指定（必须指向 `.app` 内部真实的可执行文件，而不是 `.app` 目录本身）：

```bash
export NAPCAT_QQ_PATH="/你的路径/QQ.app/Contents/MacOS/QQ"
./launcher-user.sh
```

---

## 这份"专用 QQ 运行副本"是什么，为什么需要它

macOS 版 `/Applications/QQ.app` 是苹果 Hardened Runtime（强化运行时）签名的正式打包应用，不像 Linux 那样可以用 `LD_PRELOAD` 在内存里劫持文件读取。要让 QQ 的 Electron 进程加载 NapCat 的代码，唯一稳定可行的办法是：

1. 在 `launcher-user.sh` 所在目录下复制一份 QQ.app（`QQNapCatRuntime.app`），**从不修改你日常使用的 `/Applications/QQ.app`**；
2. 给这份副本的 `package.json` 打补丁，让它加载 NapCat 而不是 QQ 自己的入口；
3. 由于补丁改动了签名清单覆盖的文件，必须对副本重新签名（临时自签名，仅限本机使用）才能通过 Gatekeeper 校验并正常启动。

重新签名是这套方案能生效的必要代价，会带来一个副作用：**这份运行副本会永久失去 macOS 的 App 沙盒（App Sandbox）保护**（临时自签名无法获得与真实 QQ 相匹配的 App Group 授权）。这只影响这个专门用于后台运行 NapCat 的副本，不会影响你日常使用的、始终保持苹果原版签名的 `/Applications/QQ.app`。如果你不希望在本机保留一份失去沙盒保护的 QQ 副本，请不要使用 macOS Shell 模式。

首次启动时脚本会打印明确提示，说明即将进行这一操作。副本与真实安装完全隔离存放，删除启动器目录下的 `QQNapCatRuntime.app` 即可随时清除，下次启动会重新生成。

### 副本与桌面 QQ 共用同一份聊天数据

失去沙盒还有一个连带影响：沙盒会把 QQ 的数据目录重定向到系统的容器目录里，而副本没有沙盒，默认会另起一份**全新的空数据库**。如果放任不管，导出好友聊天时就只能拿到最近这一两天的内容（群聊记录可以从服务器补拉，所以看起来正常，一对一聊天则不行）。

因此启动器会把桌面 QQ 的聊天数据目录**软链接**到副本读取的位置，让两者共用同一份数据库——这与 Windows / Linux 版本本来的行为一致，在那两个平台上 Shell 模式和桌面 QQ 读的就是同一个数据目录。具体来说：

* 只在 `~/Library/Application Support/QQ/` 下创建软链接，**不会复制、移动或删除系统容器目录里的任何东西**；
* 如果这个位置上已经有一份运行副本自己建的独立数据库（例如你在桌面 QQ 首次登录之前就先跑过 QCE），它会被改名保留为 `<原名>.qce-unlinked-backup`（不会删除），确认无用后可以自行删掉；
* 因为两者共用一份数据库，桌面 QQ 必须先退出——这也正是前面那条前置要求的另一个原因。

另外要注意：**QCE 运行期间也请不要再打开桌面 QQ**。系统不会阻止你这么做（运行副本和 `/Applications/QQ.app` 是两个独立的程序），桌面 QQ 也能正常登录——但它会占走登录名额，把 QCE 这边的连接顶下线。

有意思的是，因为两者共用同一份数据库，被顶下线后 QCE 表面上仍然一切正常：桌面 QQ 收到的新消息会立刻写进这份库，QCE 照样读得到，历史导出也完全不受影响。但这只是「借着桌面 QQ 在工作」，一旦你把桌面 QQ 关掉，就不再有新消息进库，QCE 也不会自己重新登录，需要 `Ctrl+C` 停掉后重新启动。

省事的做法就是：用 QCE 期间别开桌面 QQ，用完停掉 QCE 再开。

---

## 支持的环境变量

| 环境变量名称 | 默认值 | 具体用途说明 |
| --- | --- | --- |
| `NAPCAT_QQ_PATH` | 自动探测 | 手动指定 QQ.app 内部可执行文件的绝对路径 |
| `NAPCAT_DISABLE_MULTI_PROCESS` | `1` | 是否禁用 NapCat 的多进程模式（macOS 下默认禁用） |
| `QCE_NO_AUTO_OPEN` | 未设置 | 设为 `1` 后不再自动打开浏览器，只在控制台打印链接；优先级高于设置页里的开关 |
| `QCE_LOG_DIR` / `QCE_LOG_FILE` | `logs/qce-runtime.log` | 运行日志输出位置 |

---

## 常见问题

### 提示 `codesign not found`

* **原因分析**：本机未安装 Xcode 命令行工具。
* **解决方法**：执行 `xcode-select --install`，按提示完成安装后重新运行 `launcher-user.sh`。

### 提示 `codesign failed`，或副本损坏想要重来

* **解决方法**：删除运行副本后重新执行脚本，会从头重新生成：

```bash
rm -rf QQNapCatRuntime.app
./launcher-user.sh
```

### 提示 `The desktop QQ client is still running`

* **原因分析**：电脑上的 QQ 还在后台运行，它和 QCE 的运行副本共用同一个电脑端登录名额与同一份聊天数据。
* **解决方法**：在程序坞里右键 QQ 图标选「退出」，或切到 QQ 窗口按 `Command + Q`，然后重新运行 `./launcher-user.sh`。

### 提示 `端口 40653 绑定失败: Address already in use`

* **原因分析**：多半是上一次运行的 `qce-server` 还在后台。它由 QQ 拉起，如果 QQ 是被强制退出或异常结束的，它不会跟着关闭，会一直占着端口——即使你换一个目录重新解压也一样，端口只有一个。完整模式和独立模式也不能同时开。
* **解决方法**：先查出是谁占着，再结束它：

```bash
lsof -nP -iTCP:40653 -sTCP:LISTEN
kill <上面查到的 PID>
```

### 关闭（Ctrl+C 或退出 QQ）后弹出系统崩溃报告

* **原因分析**：`--single-process` 把原本相互独立的 GPU、网络等子进程都并入了同一个进程（见上文「这份"专用 QQ 运行副本"是什么」），退出阶段偶尔会撞上 Node/libuv 内部一个信号量的时序竞争，被系统判定为崩溃。
* **解决方法**：无需处理。这个崩溃发生在进程已经在退出的过程中，不影响此前已完成的导出结果，直接关掉崩溃报告窗口即可。

### 首次启动为什么要花这么久，是不是卡死了？

参见上文「启动程序与扫码登录」——首次运行会复制并签名一份约 1 GB 的 QQ 副本，属于正常现象，请留意控制台是否有 `[Info]` 前缀的日志在持续输出。之后的启动会跳过这一步，明显更快。

### 首次启动时 macOS 弹出麦克风 / 摄像头权限请求

这是 QQ 自身的功能所需（语音、视频通话），运行副本沿用了同一套权限声明。QCE 只做聊天记录导出，全部拒绝不影响使用。

### 想彻底卸载

删掉整个解压出来的包目录即可，其中包含运行副本。另外还有两处可选清理：

* `~/.qq-chat-exporter/`：QCE 的配置与访问令牌；
* `~/Library/Application Support/QQ/nt_qq_*.qce-unlinked-backup`：如果有的话，是改用共享数据库时保留下来的那份副本自建数据库。

**不要**删除 `~/Library/Containers/com.tencent.qq/`，那是你桌面 QQ 的真实聊天数据。

---

## 与 Linux / Windows 版本的区别

不要在 macOS 上使用 `NapCat-QCE-Linux-x64` 或 `NapCat-QCE-Windows-x64` 压缩包，其中的服务端与注入模块均为对应平台架构编译，无法在 macOS 上运行。

macOS 完整包会：

* 使用原生 Apple Silicon（arm64）编译的 `qce-server`；
* 使用 macOS QQ 的 `.app` 路径自动探测逻辑；
* 通过本文上一节描述的私有运行副本机制加载 NapCat；
* 不包含 Windows 专用的 `.bat` / `.dll` / `.exe` 文件。

另外，Linux 版本有一个 `--legacy` 参数可以让 QCE 与桌面 QQ 同时在线，**macOS 没有对应功能**：那种启动方式在 macOS 上根本加载不了 NapCat，这也正是本文这套运行副本方案存在的原因。

---

## 反馈问题

提交 Issue 时请附上：

* Mac 芯片型号（如 M1 / M2 / M3 / M4 / M5）和 macOS 版本；
* QQ、QCE 与 NapCat 版本；
* `logs/qce-runtime.log` 的完整内容；
* 终端中从启动到出现问题前后的完整日志。
