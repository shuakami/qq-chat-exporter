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

去 [GitHub Releases](https://github.com/shuakami/qq-chat-exporter/releases) 页面，下载文件名以 `NapCat-QCE-macOS-arm64` 开头的压缩包。

下载完成后打开「终端」，把下面三行整段复制进去执行。命令会自动找到你刚下载的那个压缩包并解压到 `~/qce`，不需要改动任何内容：

```bash
mkdir -p ~/qce && cd ~/qce
tar -xf "$(ls -t ~/Downloads/NapCat-QCE-macOS-arm64-*.tar* | head -1)"
cd NapCat-QCE-macOS-arm64
```

如果你把压缩包存到了「下载」以外的位置，把命令里的 `~/Downloads` 换成实际所在的文件夹；想解压到别处，把两处 `~/qce` 换掉即可。

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

**首次运行会比日常慢一些**：脚本会自动在同目录下生成一份专用的 QQ 运行副本（`QQNapCatRuntime.app`），这一步涉及约 1 GB 文件的复制与重新签名，通常需要几十秒到一两分钟，具体取决于磁盘速度。这是正常现象，请耐心等待；控制台会打印 `Preparing a private, patched copy of QQ.app for NapCat` 提示。之后启动会校验副本的入口、补丁版本与签名，通过后直接复用；QQ 更新版本时会重新复制，启动器补丁更新或签名损坏时会自动重新打补丁并签名。

**登录操作：**
启动成功后，控制台窗口会出现登录二维码。打开手机 QQ 扫描即可完成登录。

**访问网页：**
登录成功后，控制台会打印访问令牌和一条一键登录链接，打开它即可进入操作界面（在网页的「设置 → 启动」里可开启登录后自动打开浏览器）：

```
[QCE] Token: xxxxxxxx
[QCE] 一键登录: http://127.0.0.1:40653/qce/auth?token=...
```

浏览器没有自动弹出时，手动复制这条链接打开即可；也可以直接访问 `http://localhost:40653/qce`，把上面那串 Token 粘贴进验证框。如果两行都没看到，令牌也存在 `~/.qq-chat-exporter/security.json` 的 `accessToken` 字段里，详见[使用手册](guide.md#login)。

### 停止、重启与升级

需要重启时，先等当前导出任务结束，再在启动终端按 `Ctrl+C`。启动器加载的入口会清理已加载的 QCE 插件、关闭其服务，然后退出。等终端回到命令提示符后，重新执行 `./launcher-user.sh`。

在服务仍启动时停止，会先取消启动并等待已创建的子进程和桥接服务清理。若清理超过 10 秒，终端会提示继续等待，不会因超时强退主进程。若清理失败，运行进程会保留并打印错误；请检查日志、确认原进程已停止后再启动，避免遗留后台服务或同时运行两份实例。

升级 QCE 前也请先停止运行，再更新解压目录里的程序文件，并保留配置和导出记录。即使 QQ 版本没有变化，新启动器也会检查自己的补丁版本，自动修复已有 `QQNapCatRuntime.app` 的入口及主程序、Helper 签名，无需手动删除副本或 QQ 聊天数据。

**始终通过 `./launcher-user.sh` 启动。** 不要双击 `QQNapCatRuntime.app`，也不要使用系统崩溃报告里的「重新打开（Reopen）」。这些入口缺少启动器配置，新版副本会退出并提示改用启动脚本；它不会继续进入桌面 QQ。

### 独立查看模式

只需要浏览已经导出的聊天记录、不需要登录 QQ 时，可以运行：

```bash
./start-standalone.sh
```

这个模式不用退出桌面 QQ，启动后同样会打印登录链接。你可以浏览已有聊天记录、资源和执行历史，也可以创建、编辑或删除定时计划；计划在独立模式下不会自动执行，手动触发导出也不可用。需要获取新聊天记录、群文件或相册时，请改用完整模式并登录 QQ。

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
3. 由于补丁改动了签名清单覆盖的文件，必须先对副本内的 QQ Helper 应用逐一重新签名，再签主应用，最后校验完整签名。主程序和 Helper 使用一致的不含 App Sandbox、沙盒继承和 App Group 的临时自签名授权，仅限本机使用。

启动时保留 Electron / Chromium 正常的子进程结构，禁用 GPU 加速，并为这份副本传入 `--no-sandbox`；不再使用会影响 Electron 退出过程的 `--single-process`。环境变量 `NAPCAT_DISABLE_MULTI_PROCESS=1` 控制的是 NapCat 自己的工作进程模式，与这些 Chromium 子进程是两回事。

启动器会拒绝手动传入 `--single-process`，以及通过环境或 `config/.env` 启用 NapCat 工作进程的配置。遇到此类提示时，按提示移除参数，并确认 `config/.env` 中 `NAPCAT_DISABLE_MULTI_PROCESS=1`、没有 `NAPCAT_WORKER_PROCESS=1`，再重新启动。

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
| `NAPCAT_DISABLE_MULTI_PROCESS` | `1` | macOS 启动器固定禁用 NapCat 的工作进程模式；若 `config/.env` 覆盖为启用，则报错并提示修改 |
| `QCE_NO_AUTO_OPEN` | 未设置 | 设为 `1` 后不再自动打开浏览器，只在控制台打印链接；优先级高于设置页里的开关 |
| `QCE_LOG_DIR` / `QCE_LOG_FILE` | `logs/qce-runtime.log` | 运行日志输出位置 |

---

## 常见问题

### 提示 `codesign not found`

* **原因分析**：本机未安装 Xcode 命令行工具。
* **解决方法**：执行 `xcode-select --install`，按提示完成安装后重新运行 `launcher-user.sh`。

### 提示 `codesign failed`，或副本损坏想要重来

先确认 Xcode 命令行工具可用、解压目录可写，再重新运行启动脚本。签名或校验失败不会被记作准备完成，下次启动会重试修复。

如果仍需从头生成，请先停止 QCE，再仅删除解压目录内的运行副本：

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

### 关闭或重启后弹出系统崩溃报告

旧启动器使用的 `--single-process` 可能触发 Electron / libuv 退出阶段的信号量异常；副本中 Helper 的沙盒继承授权与主程序不一致，也可能导致子进程启动崩溃。

新版启动器移除了 `--single-process`，统一重签副本内的主程序和 Helper，并在停止时清理当前已加载的 QCE 插件。升级后通过 `./launcher-user.sh` 启动一次，即可自动将这些修复应用到已有副本。原版 QQ 和聊天数据目录无需修改。

不要用崩溃窗口的「重新打开」恢复 QCE，请回到终端重新运行启动脚本。如果升级后仍出现崩溃，请保留发生时间、QQ / QCE / macOS 版本、脱敏后的崩溃报告和相关日志片段并反馈。崩溃需要继续排查，不能以关闭报告窗口作为修复。

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

## 开发回归验证

在 macOS 的源码检出目录中，安装插件开发依赖后运行统一入口：

```bash
npm --prefix plugins/qq-chat-exporter ci
npm --prefix plugins/qq-chat-exporter run test:macos-launcher
```

需要 Node.js、Python 3 和 Xcode 命令行工具。该命令依次运行临时 Mach-O 应用及四个 Helper 的真实签名测试、生成入口的隔离运行测试、签名缓存与启动参数的 shell mock 测试。测试不登录 QQ，不访问本机 QQ 数据；真实签名只作用于临时 fixture。

插件 CI 会在 macOS 的 Node.js 20 / 22 矩阵中运行同一入口。macOS 发布包结构校验还会逐字节比对包内 `launcher-user.sh` 与仓库脚本，防止遗漏启动器修复。

## 反馈问题

提交 Issue 时请附上：

* Mac 芯片型号（如 M1 / M2 / M3 / M4 / M5）和 macOS 版本；
* QQ、QCE 与 NapCat 版本；
* `logs/qce-runtime.log` 与终端中出现问题前后的相关片段，先去除访问令牌和聊天内容；
* 如果发生系统崩溃，附上发生时间和脱敏后的崩溃报告。
