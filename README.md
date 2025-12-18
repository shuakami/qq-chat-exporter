# QQ Chat Exporter

![Next.js](https://img.shields.io/badge/Next.js-14-0070F3?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-10B981?style=flat-square&logoColor=white)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/shuakami/qq-chat-exporter)

![QCE V4 界面截图](https://github.com/shuakami/qq-chat-exporter/blob/9959f84b/image.png)


> [!NOTE]
> 这是一款功能强大的 QQ 聊天记录导出工具，可以将您的 QQ 聊天记录（包括消息、图片、视频、文件、表情包等）完整地导出为 `HTML`、`JSON`、`TXT` 等多种格式。最新的 V4 版本深度集成了 NapCatQQ 框架，提供企业级的聊天记录管理解决方案。

> [!WARNING]
> **macOS 兼容性说明**：由于技术兼容性问题，V4 版本暂时不支持 macOS 平台。我们正在努力解决相关问题，后续有进展会及时通知。推荐 macOS 用户使用 Windows 系统运行本工具。

> [!TIP]
> 如果导出聊天记录后，想深入分析聊天内容可以试试 [@hellodigua](https://github.com/hellodigua) 的 [ChatLab](https://chatlab.fun/)
> 
> 也可以试试 [@CutrelyAlex](https://github.com/CutrelyAlex) 的 [QQChatAnalyzer](https://github.com/CutrelyAlex/QQChatAnalyzer) - 支持个人分析、群聊分析、社交网络可视化和 AI 摘要
>
> 如果需要 Python API 封装，可以使用 [@streetartist](https://github.com/streetartist) 的 [napcat-qce-python](https://github.com/streetartist/napcat-qce-python)

## 快速开始

本文档涵盖了系统的核心功能与架构。有关详细的安装和配置说明，请参阅[安装与设置](https://deepwiki.com/shuakami/qq-chat-exporter/1.1-installation-and-setup)。有关完整的使用说明和操作指南，请查看[快速入门指南](https://deepwiki.com/shuakami/qq-chat-exporter/1.2-quick-start-guide)。

1.  **下载与解压**
    前往 [GitHub Releases 页面](https://github.com/shuakami/qq-chat-exporter/releases)下载适用于您操作系统的最新 V4 版本压缩包并解压。

2.  **启动与登录**
    *   **Windows**: 双击运行 `launcher-user.bat`。
    *   **Linux**: 将文件解压到 QQ 安装目录 (`/opt/QQ`) 后运行 `./launcher-user.sh`。
    *   ~~**macOS**: 运行 `./launcher-user.sh`（暂不支持，开发中）~~
    *   根据控制台提示，使用您的手机 QQ 扫描二维码完成登录。

3.  **访问与使用**
    *   在浏览器中打开：`http://localhost:40653/qce-v4-tool`。
    *   输入控制台中显示的**访问令牌 (Access Token)** 以完成身份验证。
    *   开始使用聊天记录导出功能。

## 功能特性

-   **多格式导出**: 支持导出为交互式 `HTML`、机器可读的 `JSON` 和纯文本 `TXT` 格式，以满足不同场景的需求。
-   **完整的消息类型支持**: 支持导出文本、图片、文件、语音、视频、贴纸、回复和转发消息。
-   **强大的资源管理**: 自动下载聊天记录中引用的所有媒体文件（如图片、视频、文件），并进行本地缓存和 MD5 完整性校验。
-   **表情包导出**: 支持导出市场表情包、收藏表情和系统表情包，自动下载所有表情资源并生成结构化 JSON 文件，提供完整的表情包备份方案。
-   **灵活的任务管理**:
    *   支持创建多个并发导出任务。
    *   通过 Web 界面实时监控任务进度和完成状态。
    *   断点续传功能可在中断后恢复任务，无需重新下载已有数据。
-   **定时自动备份**: 内置强大的定时任务系统，支持使用标准 cron 表达式配置每日、每周或自定义周期的自动导出。
-   **现代化 Web 界面**: 基于 React 和 Next.js 构建的响应式 Web 仪表板，提供直观的图形化操作体验。

## 支持平台

| 平台 | 架构 | 状态 | 要求 |
| :--- | :--- | :--- | :--- |
| Windows | x64 | ✅ 完全支持 | Windows 10/11 |
| Linux | x64 | ✅ 应该支持 | Ubuntu 20.04+ |
| macOS | x64 / arm64 | ⚠️ 暂不支持 | 因兼容性问题暂不可用，开发中 |

## 系统架构与鸣谢

QCE V4.5 采用创新的 Overlay 插件架构设计，作为 [**NapCatQQ**](https://github.com/NapNeko/NapCatQQ) 框架的独立外部插件运行，通过双层代理机制实现了零业务代码修改的跨平台兼容。我们在此特别感谢 **NapCatQQ 团队**，没有其强大的插件生态和底层框架支持，V4 版本无法实现。

-   **Overlay 层**: 创新的双层代理架构，编译期通过类型镜像提供 TypeScript 类型检查，运行期通过 JS 代理和 Bridge 机制委托宿主 NapCat 执行核心能力，彻底解决了原生模块依赖问题。
-   **后端服务层**: 基于 Express.js 和 WebSocket 构建，使用 tsx 即时编译 TypeScript，负责处理 API 请求、编排导出流程、管理任务调度和持久化数据存储。
-   **前端应用层**: 基于 Next.js 14 和 React 构建的现代化单页应用，为用户提供所有交互功能。
-   **存储层**: 采用基于 **JSONL** 的文件存储系统并辅以内存索引，实现高性能的读写与任务恢复。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![tsx](https://img.shields.io/badge/tsx-Runtime-2D3748?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-14-0070F3?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![Express.js](https://img.shields.io/badge/Express.js-FFA500?style=flat-square&logo=express&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

## 统计数据

[![Star History Chart](https://api.star-history.com/svg?repos=shuakami/qq-chat-exporter&type=Date)](https://star-history.com/#shuakami/qq-chat-exporter&Date)

## 免责声明

**请务必仔细阅读以下免责声明：**

本项目仅供**个人学习研究**和**数据备份**使用，严禁用于任何商业用途和非法目的。本项目与腾讯公司无任何关联，属于**非官方第三方工具**。

使用本工具可能违反 QQ 用户协议。尽管 V4 版本通过优化请求策略显著降低了风险，但用户仍需**自行承担使用本工具可能带来的一切风险**，包括但不限于账号安全问题。

请严格遵守**数据隐私**原则，仅导出您本人拥有合法权利的聊天记录，不得用于侵犯他人隐私、诽谤、骚扰等任何违法行为。您导出的数据应妥善保管，防止泄露或被滥用。

开发者不对因使用本工具而导致的**任何直接或间接损失**负责，包括但不限于账号安全、数据丢失或潜在的法律风险。

如腾讯公司认为本项目存在不当之处，欢迎随时联系处理。

**继续使用即表示您已充分理解并同意承担上述所有风险。如有任何疑虑，请立即停止使用。**

## 许可证

本项目采用 [GNU General Public License v3.0 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html) 开源。
