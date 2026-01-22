如果你想参与 QCE 的开发，这里是一些入门指引。

## 准备开发环境

你需要安装 Node.js 18 或更高版本，以及 Git。然后把项目克隆到本地：

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter
```

## 了解项目结构

项目分为两个主要部分：

后端插件代码在 `plugins/qq-chat-exporter/lib/` 目录下，使用 TypeScript 编写，基于 Express 框架。

前端界面在 `qce-v4-tool/` 目录下，是一个 Next.js 应用，使用 Tailwind CSS 做样式。

如果想深入了解架构和 API，可以查看 [DeepWiki 文档](https://deepwiki.com/shuakami/qq-chat-exporter)。

## 本地开发

启动前端开发服务器：

```bash
cd qce-v4-tool
pnpm install
pnpm dev
```

后端插件需要在 NapCat 环境下运行。你需要先去 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 下载 Shell 版本，然后把 `plugins/qq-chat-exporter` 目录复制到 NapCat 的 plugins 目录下。

## 提交代码

一般的流程是：先 Fork 项目到自己的账号，然后创建一个新分支进行开发，完成后提交 Pull Request。

Commit 信息建议遵循这个格式：
- `feat: 添加了什么功能`
- `fix: 修复了什么问题`
- `docs: 更新了什么文档`

## 其他贡献方式

不写代码也可以帮忙。比如完善文档、报告你发现的 Bug、帮忙测试新版本，或者给项目点个 Star 让更多人看到，这些都是很有价值的贡献。
