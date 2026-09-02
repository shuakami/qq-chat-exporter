# 实验性私聊漫游查询 API

这组实验性 API 用于按日期核对 QQ 私聊的漫游记录。它提供固定、查询型、单次有界的原语，不会自动扫描整段历史，也不会把漫游消息直接并入导出任务。

> 漫游日历只是提示信息：实际环境中可能出现日历没有标记、但日期锚点仍能查到的情况。任何响应都不能证明腾讯服务端的聊天记录完整性。

原生方法签名核对自 NapCatQQ 提交 [`3ac54c1`](https://github.com/NapNeko/NapCatQQ/blob/3ac54c181b5e74d7acee5a62293ade88630b05ba/packages/napcat-core/services/NodeIKernelMsgService.ts)。运行时仅在 macOS arm64、QQ `7.0.0-52194` 的一个已授权私聊会话中验证；NapCat 对日历和日期锚点的返回类型仍声明为 `unknown`，其他 QQ/NapCat 版本可能返回不同结构或不提供这些方法。

## 前置条件

- 仅支持 `chatType: 1` 的私聊；不支持群聊、频道或临时会话。
- 完整模式下需要已登录 QQ，独立模式会返回 `503 STANDALONE_MODE`。
- 所有 `/api` 路由沿用 QCE 的访问令牌认证。示例用 `$QCE_TOKEN`、`$QQ_NUMBER` 表示本机环境变量，请勿把真实令牌或账号写入仓库。
- `msgTime` 使用 Unix **秒**，不是毫秒。
- 消息序号和锚点时间按十进制字符串传递，避免 JavaScript 大整数精度损失。

这些方法不会修改 QCE 的导出文件或配置，但 QQ 原生查询可能触发漫游消息同步、更新本地消息数据库或缓存；不要把“查询型”理解为底层绝对无副作用。

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

## 2. 查询漫游日历提示

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

## 3. 查询目标日期的首条锚点

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

目标日期没有锚点时返回 HTTP 200、`found: false` 和 `anchor: null`。这个接口查询的是传入时间所在日期，并不保证自动跳到下一个有消息的日期；调用方还应核对返回 `anchor.msgTime` 是否位于目标日期。

## 4. 按锚点查询原始消息

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
