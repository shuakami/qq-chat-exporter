# 贡献指南

特别感谢你有想法对 QCE 做出贡献！我们对贡献很重视，所以提供了一些可能有帮助的内容让你了解如何贡献。

## 准备开发环境

在开始之前，你的开发机需要配置好以下基础环境与工具链：

* **Node.js**：`v20` 或更高版本。
* **pnpm**：`v9` 或更新版本（主要用于主前端项目的依赖管理与构建）。
* **Rust**：稳定版（Stable）工具链（用于服务端核心 `qce-server` 和数据导出解析引擎的开发）。
* **Git**：用于版本控制。

完成基础环境配置后，将项目克隆到本地开发目录中：

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter
```

---

## 简单来说

QCE 是一个结合了多运行时的混合架构项目。为了保证高性能和低内存占用，核心的数据解析、文件导出、定时调度以及 API 行为均运行在 Rust 侧；Node.js/JavaScript 侧主要充当轻量级的宿主桥接层。

项目的具体目录分工如下：

| 目录路径 | 核心职责说明 | 主要技术栈 |
| --- | --- | --- |
| `plugins/qq-chat-exporter/` | NapCat 插件桥接层，负责在 NapCat 生态内拉起并监控底层的 Rust 服务。 | ESM JavaScript / Node.js |
| `qq-chat-export-server/` | HTTP/WebSocket API 服务端。负责处理前端请求、实现 NapCat RPC 客户端、数据持久化及定时任务调度。 | Rust (Tokio / Axum) |
| `qq-chat-export-core/` | 核心导出引擎。负责将原始聊天数据高效解析并生成 TXT、JSON、JSONL、HTML、XLSX 等格式。 | Rust |
| `qce-v4-tool/` | 主 Web 控制台界面。采用静态导出架构，生产环境最终会被部署在服务路径的 `/qce` 下。 | Next.js + Tailwind CSS |
| `qce-chunked-viewer/` | 超大群流式（分块）导出时，内嵌在 ZIP 包中的特制动态高性能网页查看器。 | React + HyperScroll |
| `installer/` / `uninstaller/` | Windows 一键安装包与卸载程序的源码。 | Tauri |
| `scripts/`、`.github/workflows/`、`docker/` | 包含自动化打包、CI/CD 持续集成流水线、发布脚本以及 Docker 镜像构建配置。 | Python / GitHub Actions / Dockerfile |

**生产环境启动链条**：
当程序启动时，执行流依次为：`index.mjs` → `runtime/ApiLauncher.mjs` → `runtime/rustBridge.mjs` → 拉起 `qce-server` 二进制程序。
可以看出，插件目录本身只是一层极薄的转发桥，几乎所有的核心业务逻辑都在 Rust 服务端内部消化。

> 如果你需要深入研究整体架构、API 接口定义或代码工程规范，请务必仔细阅读官方的 [DeepWiki 文档](https://deepwiki.com/shuakami/qq-chat-exporter)，并严格遵循仓库根目录下的 `AGENTS.md` 规范文件。

---

## 本地开发与调试流程

项目各模块独立性较强，你可以根据自己负责的功能进入对应的目录进行单端调试：

### 1. 主前端 Web 界面 (`qce-v4-tool`)

在调整控制台 UI 或前端交互逻辑时，执行以下命令开启热更新开发服务器：

```bash
cd qce-v4-tool
pnpm install --frozen-lockfile
pnpm dev
```

*注意：在修改完前端代码并准备提交前，请务必在本地手动执行一次静态构建，确保没有引入类型错误或编译阻断：*

```bash
pnpm build
```

### 2. Rust 服务端与导出核心 (`qq-chat-export-server` / `qq-chat-export-core`)

在修改导出逻辑、文件解析器或服务端 API 时，请确保代码通过单元测试与静态语法检查：

```bash
# 进入对应的 Rust 项目目录
cd qq-chat-export-server   # 或 cd qq-chat-export-core

# 运行自动化单元测试
cargo test

# 执行严格的代码静态检查（不允许任何未处理的警告）
cargo clippy --all-targets -- -D warnings

# 验证编译产物
cargo build
```

### 3. 插件桥接层 (`plugins/qq-chat-exporter`)

在调整与 NapCat 框架的对接协议时使用。本地调试该模块无需启动真实的 QQ 客户端，测试脚本已内嵌 Mock 机制（MockNapCatCore）：

```bash
cd plugins/qq-chat-exporter
npm ci
npm run gen:overlay
npm run typecheck
npm test
```

---

## 代码提交规范

我们非常欢迎社区提交 Pull Request 来共同完善项目！以下是一些教程：

1. 将本仓库 Fork 到你个人的 GitHub 账号下。
2. 从你的 Fork 仓库中基于 `master` 分支切出一个语义明确的新特性或修复分支（例如 `feat/stream-export` 或 `fix/token-refresh`）。
3. 进行代码编写与本地完整验证。
4. 提交 Commit 时，请严格遵循 Angular 规范，使用标准的约定式提交格式（Conventional Commits）：
    * `feat: 添加了某项新功能`
    * `fix: 修复了某个已知 Bug`
    * `docs: 更新或补充了某篇文档`
    * `test: 增加了单元测试或集成测试`
    * `perf: 优化了某段代码的执行性能或内存占用`
    * `chore: 调整了构建流程、依赖库依赖或常规维护`

### 一些需要注意的东西

- 在运行测试或本地打包时，请仔细核对暂存区，切勿将个人的 Access Token、Cookie 凭证、`cache/` 中的二维码会话、登录缓存以及真实的私人聊天记录导出文件提交上屏噢！
- 请勿手动去修改诸如 `qce-v4-tool/out/` 下的静态产物，或是 `qce-chunked-viewer/assets/modern_chunked_app.js` 等由编译器自动生成的流水线文件。这类文件必须通过标准的 CI/CD 或打包脚本自动更新，手工修改会导致构建哈希冲突。

---

参与开源社区并不局限于编写核心代码，这些也同样可以起到帮助：

- 如果你在阅读或使用过程中发现了文档中描述模糊、存在错别字或语病的地方，欢迎直接提交 PR 进行修正。
- 如果在日常使用中碰到了程序报错或异常闪退，可以在 [GitHub Issues](https://github.com/shuakami/qq-chat-exporter/issues) 页面向我们反馈。反馈时如果能附带上详细的系统环境、复现步骤以及控制台的日志，将极大帮助我们定位问题。
- 在每个大版本正式发布前，去测试 [Release 页面](https://github.com/shuakami/qq-chat-exporter/releases)下载 Pre-release 预览版进行尝鲜，帮我们提前抓出潜在的 Bug。
- 如果你觉得 QCE 确实帮到了你，可以在仓库右上角为项目点个 **Star**，或者将其推荐给其他有 QQ 聊天记录本地备份需求的朋友。你的认可就是对我们持续维护的最大动力，感谢QAQ！
