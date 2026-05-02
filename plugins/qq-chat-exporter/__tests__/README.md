# QCE Test Harness

零登录测试架构。所有测试在不连真实 QQ 的情况下跑完整 pipeline。

## 一句话上手

```bash
cd plugins/qq-chat-exporter
npm test                    # 跑全部单测 + 集成测试
npm run mock:server         # 启动一个不需要登录 QQ 的 API Server（端口 40653）
```

## 目录结构

```
__tests__/
├── helpers/                 # 测试基础设施
│   ├── MockNapCatCore.ts    # 假 NapCatCore 工厂，按真实 shape 实现 MsgApi/GroupApi/...
│   ├── installBridge.ts     # 把 MockCore 注入到 globalThis.__NAPCAT_BRIDGE__
│   ├── snapshot.ts          # 极简 snapshot 实现（无 Jest 依赖）
│   ├── silenceConsole.ts    # 跑测试时静音生产代码的 console.log
│   ├── tempDir.ts           # mkdtemp + 自动清理
│   └── types.ts             # 测试用的 Mock* TypeScript 类型
├── fixtures/                # 预置场景
│   ├── builders.ts          # msg().text().image().reply()...build() DSL
│   └── conversations.ts     # privateTextOnly / groupMixedMedia / privateWithRecall ...
├── unit/
│   └── SimpleMessageParser.test.ts   # 9 个 case，覆盖文本/@/图/语音/视频/文件/表情/撤回/回复/转发
├── integration/
│   ├── BatchMessageFetcher.test.ts   # 分页 / 时间过滤 / 批次大小
│   ├── exporters.test.ts             # HTML / JSON / TXT snapshot
│   └── __snapshots__/                # 生成的 baseline，提交进 git
├── scripts/
│   ├── run-tests.mjs                 # 跨平台 npm test 包装器
│   ├── mock-server.mjs               # Tier 2: 起 ApiServer + MockCore
│   └── ensure-platform-esbuild.mjs   # 自动安装当前 OS 的 esbuild 二进制
├── smoke.test.ts                     # bridge 注入/卸载 sanity
└── tsconfig.json                     # 测试用 tsconfig（关掉 verbatimModuleSyntax）
```

## 三层架构

### Tier 1 — 单元 / 集成测试（必跑）

```bash
npm run test:unit         # 解析器单元测试
npm run test:integration  # Fetcher + 4 种 Exporter
npm test                  # 全部
npm run test:update-snapshots  # 改了 exporter 后用这个更新 baseline
```

无依赖。`node:test` 原生跑，约 1.7 秒。

### Tier 2 — Mock API Server（开发 / 调试用）

```bash
npm run mock:server
```

输出：

```
[QCE Mock] API server listening on http://localhost:40653
[QCE Mock] Token:    qce_mock_token_for_tests
[QCE Mock] Scenario: default (5 conversations)
```

跟生产一模一样的 `QQChatExporterApiServer`，只是 `core` 是假的。

环境变量：

- `QCE_MOCK_TOKEN` — 预置 access token，默认 `qce_mock_token_for_tests`
- `QCE_MOCK_SCENARIO` — `default` / `private` / `group` / `recall` / `forward` / `volume`
- `QCE_MOCK_HOME` — sqlite/缓存目录（默认 `mkdtemp`，进程退出时清掉）

前端怎么连：

```bash
# 1. 启动 mock server
cd plugins/qq-chat-exporter && npm run mock:server

# 2. 启动前端 dev
cd ../../qce-v4-tool && npm run dev

# 3. 浏览器打开
open 'http://localhost:3000/auth?token=qce_mock_token_for_tests'
```

### Tier 3 — Playwright Smoke E2E

在 `qce-v4-tool/e2e/`：

```bash
cd qce-v4-tool
pnpm exec playwright install chromium  # 只跑一次
pnpm test:e2e                          # API smoke（需要 mock:server 在跑）
```

`api-smoke.spec.ts` 走 REST + Auth 主流程；`ui-smoke.spec.ts` 在前端不可达时自动 skip。

## 加新测试

### 加一种消息类型

1. 在 `fixtures/builders.ts` 给 `MessageBuilder` 加方法（参考 `.image()` / `.voice()`）
2. 在 `unit/SimpleMessageParser.test.ts` 加 case
3. 跑 `npm run test:update-snapshots` 让 exporter snapshot 接收新 shape

### 复现 bug

1. 在 `fixtures/conversations.ts` 加一个新场景，名字跟 issue 编号关联
2. 在 `integration/` 写一个 case 用这个 fixture
3. 修代码直到测试过

不需要登录 QQ。
