# 漫游历史接口与完整性核对

本文记录排查 [#182：历史消息获取不全](https://github.com/shuakami/qq-chat-exporter/issues/182) 时核对的 QQ 消息接口、分页行为及验证边界，供开发者复查。它不是新增的漫游导出功能，也不表示 #182 已解决。维护者在 [#481](https://github.com/shuakami/qq-chat-exporter/issues/481#issuecomment-4861736376) 建议先将漫游记录同步到本地再导出，暂不考虑直接漫游导出；本文不改变这一产品范围。

接口声明核对自 NapCatQQ 提交 [`3ac54c1`](https://github.com/NapNeko/NapCatQQ/tree/3ac54c181b5e74d7acee5a62293ade88630b05ba)。运行时观测来自 macOS arm64、QQ `7.0.0-52194` 的一个已授权私聊会话；没有验证其他平台、群聊或其他 QQ/NapCat 版本。以下区分公开源码能确认的签名与该环境下的观测，未公开私人聊天记录、账号信息或机器配置。

## 1. 三层接口不能混用

| 层次 | 接口及用途 | 源码依据 |
| --- | --- | --- |
| QQ 原生消息服务 | `core.context.session.getMsgService()` 提供 `queryRoamCalendar`、`queryFirstRoamMsg`、历史消息查询等方法。它们不是腾讯对外提供的 HTTP API。 | [NapCat `NodeIKernelMsgService.ts`](https://github.com/NapNeko/NapCatQQ/blob/3ac54c181b5e74d7acee5a62293ade88630b05ba/packages/napcat-core/services/NodeIKernelMsgService.ts) |
| QCE 内部 NapCat RPC 桥 | 仅在 loopback 上的 `POST /rpc` 接收 `{ method, params }`；`MsgService.<名称>` 转发至原生服务，`MsgApi.<名称>` 转发至 NapCat 包装层。响应外层是 `{ id, ok, result }`。这不是 NapCat OneBot 的公共 action。 | [`plugins/qq-chat-exporter/runtime/rustBridge.mjs`](../../plugins/qq-chat-exporter/runtime/rustBridge.mjs)，`createNapCatBridge` |
| QCE 面向前端的 HTTP API | `POST /api/messages/fetch` 等路由通过 Rust 抓取器取数、缓存、解析；与内部 RPC 的请求、响应及鉴权边界不同。当前没有本文所述两个漫游查询的独立公共 HTTP 路由。 | [`qq-chat-export-server/src/api/routes/messages.rs`](../../qq-chat-export-server/src/api/routes/messages.rs)，`fetch_messages` |

不要将内部桥端口公开、把访问令牌写入示例，或增加可从前端任意调用原生方法的代理。本文只说明现有调用关系，不新增 RPC 方法、HTTP 路由或自动同步任务。

时间单位也要按层核对：当前 `/api/messages/fetch` 的 `filter.startTime` / `filter.endTime` 直接进入毫秒时间过滤器；不要把它们与下文原生日历查询的秒参数混用。其他导出路由有自己的时间归一化逻辑，应以对应路由实现为准。

## 2. 已核对的查询方法

下表中的 `peer` 在本次私聊观测中为 `{ chatType: 1, peerUid: "<PEER_UID>", guildId: "" }`；占位符不是可执行的账号标识。序号、消息 ID 和原生消息时间字段应保留十进制字符串，避免 JavaScript 大整数精度损失。日历查询参数则按声明传入 `number`。

| 原生方法 | 参数及本次调用方式 | 返回内容与限制 |
| --- | --- | --- |
| `queryRoamCalendar(peer, msgTime)` | 第二参数为查询基准时间。本机以已知消息时间校准后使用 Unix **秒**，不是毫秒。 | 观测到 `{ result, errMsg, calendar }`；`calendar` 为按月位图数组，用于核对有消息的日期，不提供每天消息总数。 |
| `queryFirstRoamMsg(peer, msgTime)` | 本次第二参数同样以 Unix 秒调用；按目标日零点或已取得锚点后的时间查询。 | 观测到 `{ result, errMsg, roamDatemsg: { msgSeq, clientSeq, msgTime } }`。返回的是定位元数据，不是完整消息体；必须核验返回时间是否落在目标日期。 |
| `queryCalendar(peer, msgTime)` | 使用与漫游日历相同的基准时间进行对照。 | 本机观测用它核对本地日历在读取前、读取后和重启后的变化。不能因本地某日无记录就断言云端也没有。 |
| `getAioFirstViewLatestMsgs(peer, count)` | 获取首批最新消息；独立序号复查用 `count = 1` 取得实际起始游标。 | 返回 `msgList`，用于开始分页，不代表全部历史。 |
| `getMsgsIncludeSelf(peer, msgId, count, true)` | 本次按消息 ID 向旧消息翻页，小页审计使用 `count = 100`。 | 返回页可能包含游标自身及重叠消息，须按 `msgId` 去重。 |
| `getMsgsBySeqAndCount(peer, msgSeq, count, true, true)` | 本次独立复查与锚点邻域读取使用 `count = 100`，游标来自实际返回消息。声明中两个布尔参数名为 `desc`、`isReverseOrder`。 | 不能与 `getMsgsIncludeSelf` 的 ID 游标混用；NapCat 声明标注为 deprecated，不承诺未来兼容。 |
| `getMsgByClientSeqAndTime(peer, clientSeq, time)` | 后两个参数均为字符串；使用漫游锚点返回的 `clientSeq`、`msgTime`。 | 返回 `msgList`，本次用于解析无法直接匹配的日期锚点。单次成功不证明该方法总会联网补取消息。 |

签名见 [消息服务声明](https://github.com/NapNeko/NapCatQQ/blob/3ac54c181b5e74d7acee5a62293ade88630b05ba/packages/napcat-core/services/NodeIKernelMsgService.ts)；历史包装调用见 [NapCat `apis/msg.ts`](https://github.com/NapNeko/NapCatQQ/blob/3ac54c181b5e74d7acee5a62293ade88630b05ba/packages/napcat-core/apis/msg.ts)。其中 `queryRoamCalendar`、`queryFirstRoamMsg` 的声明返回类型仍是 `unknown`，上述返回结构是运行时观测，不是稳定的上游类型契约。

内部 RPC 与原生结果有两层状态。例如下列**结构示意**省略了真实标识与数值：

```text
请求：{ method: "MsgService.queryFirstRoamMsg", params: [peer, unixSeconds] }
响应：{
  id: requestId,
  ok: true,
  result: {
    result: 0,
    errMsg: "",
    roamDatemsg: {
      msgSeq: "<decimal-string>",
      clientSeq: "<decimal-string>",
      msgTime: "<unix-seconds-string>"
    }
  }
}
```

`ok: true` 只表示桥调用未抛错，还需检查内层状态和数据结构。本次某些历史分页响应的原生 `result` 为 `2004000`，提示无更多消息，但 `msgList` 仍含有效记录。审计时保留该页有效记录并记录停止原因，不能先因该状态丢弃整页，也不能把所有非零状态都视为成功。日历和日期锚点核对要求观测到的成功状态 `result = 0`。

### 日历与日期锚点的解释

本机对照显示，`calendar[0]` 对应查询时间所在月份，其后按月倒序；将每个值按无符号 32 位解释，`bit(day - 1)` 表示该日存在记录。例如合成位图 `5`（二进制 `101`）表示当月第 1、3 日有记录。须按该月真实天数解码，并使用与客户端一致的时区；本次使用 `Asia/Shanghai`。换版本时应先用已知消息日期重新校准，不能把这个观测当作所有客户端的协议保证。

本次日历末尾出现了纪元附近的异常桶，未能对应真实历史锚点；应单独记录异常，不把它当作历史起点或无限向前查询的依据。日历位只能证明某日有消息，首锚点只能证明该定位点存在；两者都不能证明该日中间和结尾没有遗漏。

## 3. 当前 QCE 私聊分页与独立复查

当前私聊抓取选择 `TimeBasedSequential`：首批通过 `getAioFirstViewLatestMsgs` 取数，后续使用 `getMsgsIncludeSelf` 的 `msgId` 游标。Rust 桥客户端优先调用 `MsgService.*`，RPC/传输调用失败时回退到 `MsgApi.getAioFirstViewLatestMsgs` / `MsgApi.getMsgHistory`；原生结果内的非零 `result` 本身不触发该回退。NapCat 的 `getMsgHistory` 包装的仍是 `getMsgsIncludeSelf`。该路径没有单独调用漫游日历或全量漫游下载接口。依据：[`batch_fetcher.rs`](../../qq-chat-export-server/src/fetcher/batch_fetcher.rs) 的策略选择与 `fetch_by_time_based_sequential`，以及 [`napcat/client.rs`](../../qq-chat-export-server/src/napcat/client.rs) 的 `MessageFetchApi` 实现。

不能据此进一步断言这些 QQ 内核查询永远只读本地、绝不联网。本次读取后有旧日期出现在本地日历，且重启后仍可读取；这支持本次记录已在本地可用，不证明任意账号的全部云端历史都已同步。

复查时必须区分三个定位概念：

- **`msgId`**：本次元数据索引按它去重，也是 `getMsgsIncludeSelf` 的游标；不是 `msgSeq`。
- **`msgSeq`**：用于序号查询；独立复查只采用真实返回记录中的序号，不把序号连续性当成私聊完整性证明，也不靠猜测、递减序号枚举历史。
- **`clientSeq` + `msgTime`**：本次日期锚点与已取索引的主要匹配条件；`msgSeq` 仅辅助比较。出现不匹配时，保留差异并用单条定位及邻近页复查，不能直接认定消息丢失。

每页审计只需保存消息元数据、请求游标、返回/新增数量、时间范围和停止原因。对空页、重复游标、无新增记录、时间方向异常、超时及页数上限分别停止并报告；这些是扫描停止条件，不是服务器全量完成标记。为复现差异，应固定截止时间和索引快照，并使用有上限的请求、重试及检查点，避免实时新消息和并发扫描改变比较基线。

## 4. 按日期定位缺口与复验

以下是本次排查采用的核对顺序，不是已集成到 QCE 的自动修复流程：

1. 固定保存同一会话的漫游日历、已取得的最早锚点及查询截止时间，以元数据建立基线。日历缺口和单条锚点需要分别记录。
2. 完成按 `msgId` 的历史分页后，用实际 `msgSeq` 游标独立分页；比较唯一消息集合及异常记录，而不只比较总数或最早日期。
3. 对每个已知有记录日期，以当日零点调用 `queryFirstRoamMsg`，核验日期并匹配 `clientSeq + msgTime`。匹配失败时用 `getMsgByClientSeqAndTime` 定位原生记录，结合 `getMsgsBySeqAndCount` 检查邻近页；保留原始不匹配和后续解析结果。
4. 日首匹配后再检查日尾：本次从已知当日末条时间的下一秒查询日期锚点，对仍位于当日且推进的锚点读取单条和邻近页，再按 `msgId` 合并。设置每日期限/步数上限，返回时间不推进即停止。**按秒推进可能跳过同一秒内的其他消息；即使读取邻近页并核对所有已知日尾，仍不能证明日内每条都齐全。**
5. 比较读取后本地日历与固定漫游日历；重启 QQ/NapCat 后再次核对本地日期、抽样锚点及旧时间窗口。不要让两个 QQ 实例同时使用同一聊天数据库。
6. 通过正常 QCE HTTP 路由重新读取相同窗口，再核对导出结果。复验要排除缓存影响：`/api/messages/fetch` 支持 `forceRefresh` / `bypassCache`，见 [`fetch_messages`](../../qq-chat-export-server/src/api/routes/messages.rs)。记录原始消息、解析后消息、系统/在线传输记录与空记录的差额；未经解释的数量差不能写成验证通过。

这套方法把“哪些日期/锚点已核对”与“哪些内容仍未证明”分开。查询能够补回已知缺口，不等同于服务端给出了每一天的总数或全量完成证明；附件内容是否可下载也需要单独验证。

## 5. 本次匿名观测结果及未证明事项

以下为同一会话的人工排查结果，私人索引和验证脚本不随仓库发布，亦不是自动化回归测试或其他环境的保证：

| 核对项 | 本次结果 |
| --- | --- |
| 已知有记录日期 | 559 日；首锚点与已知日尾均已核对，最终未留下未解释的已知日期/锚点缺口。 |
| 日首锚点直接匹配 | 初次 558 个直接匹配，另 1 个经原生单条定位解析后匹配；不能把初次报告当作最终结果。 |
| 最终记录口径 | 53,152 个唯一原始记录 ID，分为 53,133 条普通导出记录、18 条在线传输记录及 1 条空内核记录。补充记录不能当作普通文本消息，也不意味着传输文件已下载。 |
| 重启持久性 | 重启后的本地日历与固定漫游日历一致。一次旧窗口复读相较预期多出 2 条记录、未缺失预期 ID；原始数量检查当时未通过，后续按记录差额继续核对，因此不声称所有重启前后数量相等。 |
| 能力边界 | 未批量下载附件；未取得服务端每条消息的完整性证明，最终仍标记 `serverEveryMessageCompletenessProven = false`。 |

公开说明应使用“已核对当前可见记录、已知日期及锚点”“已完成该次扫描/导出”等有限结论，不应使用“已取完全部腾讯云端聊天记录”。本文是 #182 的排查参考，不代表该 issue 所涉及的全部场景均已解决。
