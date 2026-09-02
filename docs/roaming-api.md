# 实验性私聊漫游导出与查询 API

这组实验性 API 用于按日期核对和导出 QQ 私聊的漫游记录。推荐的任务端点会在服务端执行有界扫描，并把结果送入正式导出管线；三个低层查询端点只提供单次原语，不会自行扫描整段历史或创建导出任务。

> 漫游日历只是提示信息：实际环境中可能出现日历没有标记、但日期锚点仍能查到的情况。任何响应都不能证明腾讯服务端的聊天记录完整性。

原生方法签名核对自 NapCatQQ 提交 [`3ac54c1`](https://github.com/NapNeko/NapCatQQ/blob/3ac54c181b5e74d7acee5a62293ade88630b05ba/packages/napcat-core/services/NodeIKernelMsgService.ts)。三个低层原语曾在 macOS arm64、QQ `7.0.0-52194` 的已授权私聊中验证；本次完整有界导出链路另在 macOS arm64、QQ `6.9.98-51102` 的已授权 NapCat plugin-mode 环境中验证。NapCat 对日历和日期锚点的返回类型仍声明为 `unknown`，其他 QQ/NapCat 版本可能返回不同结构或不提供这些方法。这些验证不代表标准 macOS 启动器路径已经完成端到端验证。

## 前置条件

- 仅支持 `chatType: 1` 的私聊；不支持群聊、频道或临时会话。
- 完整模式下需要已登录 QQ，独立模式会返回 `503 STANDALONE_MODE`。
- 所有 `/api` 路由沿用 QCE 的访问令牌认证。示例用 `$QCE_TOKEN`、`$QQ_NUMBER` 表示本机环境变量，请勿把真实令牌或账号写入仓库。
- `msgTime` 使用 Unix **秒**，不是毫秒。
- 消息序号和锚点时间按十进制字符串传递，避免 JavaScript 大整数精度损失。

三个低层查询方法不会直接修改 QCE 的导出文件或配置，但 QQ 原生查询可能触发漫游消息同步、更新本地消息数据库或缓存；不要把“查询型”理解为底层绝对无副作用。推荐的 `/api/messages/roaming/export` 会创建持久化任务，并在成功时写出所选格式的导出文件。

## 1. QQ 号解析为 peer UID

漫游接口不直接接收 QQ 号。先复用现有用户查询接口，将 QQ 号转换为 NTQQ 私聊使用的 `peerUid`：

```bash
curl -sS \
  -H "Authorization: Bearer $QCE_TOKEN" \
  "http://127.0.0.1:40653/api/users/lookup?uin=$QQ_NUMBER"
```

找到用户时，响应中的 `data.uid` 就是后续请求的 `peer.peerUid`：

```json
{
  "success": true,
  "data": {
    "found": true,
    "uid": "u_example"
  }
}
```

`found: false` 时不要继续调用漫游接口。纯数字 QQ 号不会被当作 `peerUid` 接受。

## 2. 创建有界漫游扫描与导出任务（推荐）

面向应用前端和普通调用方时，优先使用 `POST /api/messages/roaming/export`。该接口在服务端依次完成日期锚点扫描和受限序列桥接，再把恢复的原始消息送入与普通导出相同的解析、资源下载和格式导出管线；浏览器不需要逐日发起请求。

### 网页操作

1. 已在会话列表中的普通私聊：打开该行的导出下拉菜单，选择“漫游导出”。
2. 列表里找不到的联系人：在搜索框输入 QQ 号，先执行反查，再从反查结果选择“漫游导出”；网页会先把 QQ 号解析为会话 `peerUid`，不会把纯数字直接传给漫游接口。
3. 选择必填的开始日期、结束日期和导出格式后启动任务。
4. 在任务页查看扫描进度和 `partial` 提示；可停止任务，完成后可下载文件或打开所在位置。默认导出目录中支持的格式还可在文件列表中预览。

漫游扫描只在连接完整 QQ 登录环境、bridge 可用时开放；独立查看模式不能创建该任务。

请求中的 `filter.startTime` 和 `filter.endTime` 都是 Unix **秒**，且为必填；日期跨度按服务端本机时区的日历日计算。下面示例使用 UTC 中午的时间戳，创建一个 JSON 导出任务：

```bash
curl -sS \
  -H "Authorization: Bearer $QCE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "peer": {"chatType": 1, "peerUid": "u_example", "guildId": ""},
    "sessionName": "历史私聊",
    "format": "JSON",
    "filter": {
      "startTime": 1672574400,
      "endTime": 1704024000
    },
    "options": {
      "includeResourceLinks": true,
      "prettyFormat": true
    },
    "roaming": {
      "maxMessages": 50000,
      "maxSequenceQueries": 50000
    }
  }' \
  http://127.0.0.1:40653/api/messages/roaming/export
```

支持的 `format` 与正式导出管线一致：`TXT`、`JSON`、`HTML`、`EXCEL`、`STREAMING_ZIP`、`STREAMING_JSONL`。`options` 也沿用普通导出选项，包括资源跳过、自包含 HTML、自定义导出目录等。

创建成功后立即返回现有任务模型：

```json
{
  "success": true,
  "data": {
    "taskId": "roaming_export_...",
    "taskKind": "roaming_export",
    "status": "running",
    "fileName": "friend_历史私聊_example_20260902_120000000.json",
    "downloadUrl": "/downloads/friend_历史私聊_example_20260902_120000000.json",
    "startTime": 1672574400,
    "endTime": 1704024000,
    "roamingScan": {
      "bounded": true,
      "requestedDays": 365,
      "probedDays": 0,
      "scannedDays": 0,
      "calendarQueries": 0,
      "calendarErrors": 0,
      "anchorDays": 0,
      "exactQueries": 0,
      "latestQueries": 0,
      "sequenceQueries": 0,
      "emptySequenceQueries": 0,
      "gapCount": 0,
      "mismatchedAnchors": 0,
      "unresolvedAnchors": 0,
      "untimestampedMessages": 0,
      "rawMessagesSeen": 0,
      "messageCount": 0,
      "maxMessages": 50000,
      "maxSequenceQueries": 50000,
      "closingAnchorFound": false,
      "partial": false,
      "stopReason": "running",
      "currentDate": null,
      "calendarAdvisory": true,
      "serverCompletenessProven": false
    }
  }
}
```

### 任务状态、进度和取消

该任务复用现有任务生命周期，不另建一套浏览器状态：

- `GET /api/tasks/:taskId` 查询单个任务，`GET /api/tasks` 可在重连后恢复任务列表；任务状态和 `roamingScan` 会持久化到 QCE 数据库。
- WebSocket 继续发送 `export_progress`、`export_complete`、`export_error`，前端也可沿用现有轮询兜底。
- `POST /api/tasks/:taskId/cancel` 会设置现有导出取消信号。扫描会在每个原生调用、重试退避和序列批次之间检查取消；正在进行的单次 QQ 原生调用仍受 bridge 自身超时约束。
- 运行中或等待中的任务不能直接删除；`DELETE /api/tasks/:taskId` 会返回 `409 TASK_STILL_RUNNING`，应先调用取消接口，确认任务进入 `cancelled` 后再删除。
- 完成后返回正常的 `fileName`、`filePath`、`downloadUrl` 和文件元数据。使用默认导出目录时，文件会出现在现有文件列表，支持预览的格式可继续使用 `GET /api/exports/files/:fileName/preview`；使用任务级自定义 `options.outputDir` 时，该文件不进入默认文件列表，应从任务页按精确路径下载或打开所在位置。两者的资源下载和补齐都沿用正式导出链路。

### 扫描和完整性边界

服务端任务按以下固定顺序运行：

1. 先固定调用一次 `MsgService.getAioFirstViewLatestMsgs(peer, 10)`，取得当前可见的最新正序号候选。候选在 `endTime` 内时作为包含式尾界；候选晚于 `endTime` 且仍处于结束日期后的 31 天探测范围内时，才可作为过滤后的外部尾界。更远的候选不会触发跨范围逐序号桥接，找不到较近尾界时结果会标记为 `partial`。若这个缓存候选在时间或序号上早于逐日发现的锚点，也不会用它假装闭合范围。
2. 每个自然月尝试调用一次 `MsgService.queryRoamCalendar`，只记录提示，不用日历空位跳过日期；调用或响应解析失败仅增加 `calendarErrors`，不会单独中止扫描或把结果标成 `partial`。
3. 按本机时区逐日调用 `MsgService.queryFirstRoamMsg`。首日使用 `max(dayStart, startTime)`，后续日期使用当天最早的有效本地时间（通常为 00:00）；日期探测之间保留约 120 ms 的可取消间隔。没有可用 latest 尾界时，结束日期后最多再探测 31 天寻找下一锚点。
4. 对每个有效日期锚点调用 `MsgService.getMsgByClientSeqAndTime`。若 exact 为空，但 first 已给出正 `msgSeq`，任务会把该序号计入查询预算并调用一次 `MsgService.getSingleMsg` 恢复端点。只有 exact 或这个受限回退确实返回与 `msgSeq`、`clientSeq` 和 `msgTime` 匹配的消息，才把锚点作为已恢复的区间端点；两种方式都无法恢复时会增加 `unresolvedAnchors` 并标记 `partial`。
5. 对相邻的已恢复锚点，按正整数 `msgSeq` 的开区间逐个调用固定方法 `MsgService.getSingleMsg(peer, msgSeq)`。每批最多并发 4 个逻辑序号，批次之间保留约 120 ms 的可取消间隔，结果按请求序号顺序消费并稳定去重。成功空列表以及明确的 `2004000`、`2004007` 只表示该整数序号没有消息，计入 `emptySequenceQueries` 后继续；它们不制造 gap，也不会把结构上已核对完的区间标成 `partial`。未知业务码、错误序号或损坏结构会让任务失败。最老锚点之前没有经验证的序列边界，因此不会向 `seq=1` 盲扫。
6. 对所有结果执行请求时间范围过滤和稳定去重，写入磁盘 spool 后进入普通导出的解析、附件下载和格式生成阶段。

所有历史原生调用在同一个进程级独占门控内完成，不会与另一个历史获取任务叠加；仅单个序列批次内部固定并发 4 个查询。限制如下：

- 日期跨度硬上限为 1461 个本机日历日。
- `roaming.maxMessages` 默认 50000，允许范围 `1..=100000`。
- `roaming.maxSequenceQueries` 默认 50000，允许范围 `1..=100000`；retry attempt 不重复占用这个逻辑查询预算。
- 达到消息或序号查询上限会导出当前已验证的有界结果，并设置 `partial: true` 以及相应 `stopReason`。
- 找不到可信尾界、锚点序列不单调、锚点消息无法由 exact 或受限 single 回退恢复、或消息缺少时间戳时，也会通过计数字段和 `partial` 明示，绝不静默宣称完整。
- `serverCompletenessProven` 始终为 `false`；`partial: false` 只表示本次有界算法走完了请求范围，不代表腾讯服务端保存完整。

创建任务时若历史查询门控被占用，同步返回 `429 HISTORY_QUERY_BUSY`。任务运行中的 calendar、first、exact、latest、single 五类原生查询会对 connect/timeout/request/body 传输错误及明确的瞬时 Worker/RPC 错误最多重试 3 次，采用 120/240/480 ms 的可取消退避；一旦成功便停止重试。URL 构造错误、JSON 解码错误、原生方法不存在、响应结构异常、非零 QQ 业务码和普通 TypeError 都不会进入重试。`2004000`/`2004007` 的单序号空结果同样不会重试；exact 的 raw/RPC 空码会进入上述单序号端点回退，而不是直接丢弃锚点。日历重试全部失败仍只计为一次逻辑 `calendarQueries` 和一次 `calendarErrors`。

若 QQ/NapCat 缺少必需的原生方法，任务进入 `failed`，并持久化/广播 `errorCode: ROAMING_API_UNAVAILABLE`、`errorHttpStatus: 501`；重试耗尽的 bridge 传输错误、TypeError 等 Worker 内部错误、未列入允许范围的 QQ 业务码或封装失败对应 `ROAMING_QUERY_FAILED`/`502`，返回结构不兼容对应 `INVALID_ROAMING_RESPONSE`/`502`。任务层把 `0` 和无消息码 `2004000` 作为空的 first 结果；exact 的 `0`/`2004000`/`2004007` 空结果会尝试 single 端点回退。若响应带有有效锚点或消息则保留其载荷，其他非零码不能被误判为“没有历史”。日历仍只是 advisory，其业务码异常只增加 `calendarErrors`。single 的 `2004000`/`2004007`（包括 RPC 文本中严格的 `qq_result_...` 形式）仅折叠为对应整数序号为空。

## 3. 低层接口：查询漫游日历提示

`POST /api/messages/roaming/calendar` 调用固定的 `MsgService.queryRoamCalendar`。下面的 `1672531200` 是 2023-01-01 00:00:00 UTC 的秒级时间戳，仅作脱敏示例：

```bash
curl -sS \
  -H "Authorization: Bearer $QCE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "peer": {"chatType": 1, "peerUid": "u_example", "guildId": ""},
    "msgTime": 1672531200
  }' \
  http://127.0.0.1:40653/api/messages/roaming/calendar
```

```json
{
  "success": true,
  "data": {
    "resultCode": 0,
    "errorMessage": "success",
    "calendar": [5, 0],
    "calendarAdvisory": true,
    "serverCompletenessProven": false
  }
}
```

`calendar` 保留 QQ 原生位图数组，不在 HTTP 层猜测月份、时区或日期。不能因数组为空或某日未标记，就断言更早记录不存在。

## 4. 低层接口：查询目标日期的首条锚点

`POST /api/messages/roaming/first` 调用固定的 `MsgService.queryFirstRoamMsg`。即使日历未标记目标日期，也可以直接查询该日期：

```bash
curl -sS \
  -H "Authorization: Bearer $QCE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "peer": {"chatType": 1, "peerUid": "u_example", "guildId": ""},
    "msgTime": 1672531200
  }' \
  http://127.0.0.1:40653/api/messages/roaming/first
```

找到锚点时，`clientSeq`、`msgTime` 统一为字符串；上游没有返回 `msgSeq` 时该字段为 `null`：

```json
{
  "success": true,
  "data": {
    "resultCode": 0,
    "errorMessage": "success",
    "found": true,
    "anchor": {
      "msgSeq": "13774",
      "clientSeq": "35566",
      "msgTime": "1672531201"
    },
    "serverCompletenessProven": false
  }
}
```

目标日期没有锚点时返回 HTTP 200、`found: false` 和 `anchor: null`。成功业务码 `0` 的原生响应仍必须明确携带 `roamDatemsg`/`roamDateMsg` 字段；该字段为 `null`、空对象、`clientSeq`/`msgTime` 同时为零，或 `msgSeq`/`clientSeq`/`msgTime` 三字段都严格为 `-1` 时表示空锚点。兼容性观察中出现过三字段均为 `-1` 的空锚点形态，它只在业务码为 `0` 时作为空结果接受，并不代表服务端没有更早记录；缺字段、其他负值、单边为零或混合正负仍属于 `INVALID_ROAMING_RESPONSE`。有效锚点的字段必须是正十进制值；`msgSeq` 若未随锚点返回，只能由后续 exact 中实际匹配的消息恢复。这个接口查询的是传入时间所在日期，并不保证自动跳到下一个有消息的日期；调用方还应核对返回 `anchor.msgTime` 是否位于目标日期。

## 5. 低层接口：按锚点查询原始消息

将上一步返回的 `clientSeq` 和 `msgTime` 原样传入 `POST /api/messages/roaming/exact`。该路由固定调用 `MsgService.getMsgByClientSeqAndTime(peer, clientSeq, msgTime)`：

```bash
curl -sS \
  -H "Authorization: Bearer $QCE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "peer": {"chatType": 1, "peerUid": "u_example", "guildId": ""},
    "clientSeq": "35566",
    "msgTime": "1672531201"
  }' \
  http://127.0.0.1:40653/api/messages/roaming/exact
```

```json
{
  "success": true,
  "data": {
    "resultCode": 0,
    "errorMessage": "success",
    "count": 1,
    "messages": [
      {"msgId": "9007199254740993", "msgTime": "1672531201"}
    ],
    "serverCompletenessProven": false
  }
}
```

`messages` 保留 NapCat 返回的原始消息对象。接口不会解析消息、下载附件或自动加入导出结果。

## 状态与兼容边界

HTTP 层和 QQ 原生结果是两层状态：

- HTTP `200 success: true` 表示 bridge 调用成功且返回结构可识别。`data.resultCode` 仍是 QQ 原生业务状态；非零状态可能同时携带有效 `messages`，因此接口不会先丢弃消息。
- bridge 传输或调用失败返回 `502 ROAMING_QUERY_FAILED`。
- 另一个历史消息查询正在占用 QQ Worker 时返回 `429 HISTORY_QUERY_BUSY`，调用方应稍后重试，不要无上限并发。
- 当前 QQ/NapCat 缺少原生方法时返回 `501 ROAMING_API_UNAVAILABLE`。
- 原生成功状态缺少必须字段时返回 `502 INVALID_ROAMING_RESPONSE`，避免把版本不兼容静默误报成“没有记录”。
- 参数错误返回 `400`，包括群聊 peer、纯数字 QQ 号、非空 `guildId`、毫秒时间戳和非十进制锚点。

这三个端点不接收任意 RPC 方法名、不提供无上限年份扫描，也没有暴露已废弃的序号批量分页接口。若要核对 2023 年等更早日期，应由调用方设置明确的日期范围、请求上限和停止条件，并始终将结果表述为“当前账号与客户端可见的记录”，而不是“完整腾讯云端记录”。
