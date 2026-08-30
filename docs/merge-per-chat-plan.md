# 合并备份按聊天分组:每聊天独立合并并按聊天名命名

## 目标与成功标准

合并页面勾选多个聊天(每聊天含 N 个定时/手动备份文件)时,服务端**按聊天分组**,每组独立合并成一个产物对(HTML/JSON),文件名带聊天名、历史列表显示名 = 聊天名;不再把所有文件混成一个「合并的聊天记录」。

成功标准(live 验证,部署后):
1. `POST /api/merge-resources` 传 4 个聊天(如 A×3 + B×8 个备份文件)→ 返回 2 个 group 结果,各产出 1 对文件,displayName 分别为 A、B;
2. 新产物出现在 `GET /api/exports/files`(fileName 带聊天名、displayName = 聊天名、JSON 行带 messageCount);
3. `available-tasks` 回归不变(4 群组/41 备份,不含 merged);既有旧格式 `merged_2026-08-30T14-07-16.{json,html}` 仍被识别、仍可预览/删除;
4. 一次非破坏性实机合并验证(用户已同意):复制某群聊 2 个备份为临时名 → 合并 → 验证 → 用 DELETE 接口删除产物并移除临时副本,历史列表恢复基线 44 条。

## 根因(已实证)

- UI(`scheduled-backup-merge-dialog.tsx`)只按文件勾选,把选中的 fileName 平铺进 `sourceTaskIds` 发给 `POST /api/merge-resources`;
- 服务端 `merge_resources`(resources.rs 2280+):`validate_merge_sources` → `merge_source_messages` 把所有源的消息合并进**一个**列表 → `write_merged_data` 写**一对** `merged_{UTC秒}` 文件,`ChatInfo.name` 固定「合并的聊天记录」。没有按聊天分组,也没有聊天名入名。

## 设计决策

- **分组在服务端**(请求 schema 不变,仍传平铺 fileName 列表):文件名已编码聊天信息,`parse_scheduled_export_file_name`(现行+遗留格式)与 `parse_manual_export_file_name` 可直接得到 group_key/聊天名,单一事实来源、不信任客户端。
- **命名**(用户要求「合并功能可以识别的名字」,取方案 A):`merged_{chatType}_{消毒后聊天名}_{YYYY-MM-DDTHH-MM-SS}.{ext}`,同名冲突时追加 `_2` 后缀;`chatType` ∈ friend/group,聊天名消毒复用 `sanitize_task_name`(空格/非法字符→`_`,限 40 字符,空→`unknown`)。该名字:
  - 能被更新后的 `parse_merged_export_file_name` 识别;
  - 不与普通导出名混淆(`merged_` 前缀,`parse_base_name`/`parse_manual_export_file_name` 均不匹配 → 不进 available-tasks、不可作再合并源);
  - 旧格式 `merged_YYYY-MM-DDTHH-MM-SS` 保持可解析(兼容盘上已有数据,旧记录仍显示「合并的聊天记录」)。
- **每组至少 2 个文件才合并**:只有 1 个文件的组跳过并在结果 `skipped` 中报告(UI 说明文字同步提示)。
- `chatId` 沿用 `"merged"`(文件名不带 peer ID,避免名字含下划线时与 ID 分界歧义);行筛选只依赖 `chatType`,friend 合并归「好友」tab、group 归「群组」tab。
- `deleteSourceFiles` 语义改为**每组写盘成功后清理该组源文件**;单组失败不影响其他组。
- 部分失败:按组记录状态,≥1 组成功即 `success:true`;全部失败才返回错误。

## 实现改动

### 1. `qq-chat-export-server/src/scheduled_executor.rs`
- `sanitize_task_name` 改为 `pub(crate)`(供 resources.rs 复用,无行为变化)。

### 2. `qq-chat-export-server/src/api/routes/resources.rs`

a. **解析器**:`parse_merged_export_file_name` 返回结构体 `MergedExportName { format, timestamp, chat_type, display_name }`,两个正则依次匹配:
   - 新:`^merged_(friend|group)_(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:_\d+)?\.(html|json)$` → chat_type 取组1,display_name = 组2 下划线转空格;
   - 旧:`^merged_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(html|json)$` → chat_type "group"、display_name「合并的聊天记录」(兼容旧盘上数据)。
b. 新增 `merged_file_name(chat_type, chat_name, timestamp) -> String`(前缀 + 消毒名 + 时间戳)与碰撞后缀逻辑(目标存在则 `_2`、`_3`…;参考 `collision_name` 模式)。
c. **分组**:新增纯函数 `group_merge_sources(file_names, sources) -> (Vec<MergeGroup>, Vec<Skip>)`;每个文件名依次尝试 `parse_scheduled_export_file_name`(group_key/task_name)→ `parse_manual_export_file_name`(chat_type+peer_uid/session_name)→ 兜底组(displayName「合并的聊天记录」);`MergeGroup { group_key, chat_type, display_name, sources }`;组内文件 <2 → Skip。
d. **write_merged_data**:签名加 `(chat_name: &str, chat_type: &str)`;文件名改 `merged_file_name`;`ChatInfo { name: chat_name, chat_type, self_name: "合并导出" }`;其余(JSON 结构/HTML 导出/时间戳/资源映射)不动。
e. **merge_resources**:保持请求校验(schema、2–100 个文件、outputPath 校验、`resolve_for_creation_within` 原样);`validate_merge_sources` 不变(仍只查顶层两目录,merged 不可作源);其后按组循环:每组 `merge_source_messages` → `merge_resource_files` → `write_merged_data` → 可选 `cleanup_merge_sources`(仅该组);`broadcast_merge_progress` 沿用现有 phase 键(validate/merge/resources/write/cleanup),message 带「正在合并 {聊天名} (i/n)」,current/total = 组序/组数(无 UI 消费方,不破坏现有监听)。
f. **响应 schema**:
   ```json
   { "result": { "mergeTaskId", "outputPath", "mergeTime", "completedAt",
     "groups": [ { "chatType", "displayName", "sourceCount", "totalMessages",
                   "deduplicatedMessages", "totalResources", "jsonPath", "htmlPath",
                   "status": "success|failed", "error" } ],
     "skipped": [ { "fileName", "reason" } ],
     "sourceCount", "totalMessages", "deduplicatedMessages", "totalResources" } }
   ```
   (汇总字段 = 成功组求和;全部组失败 → 按现有 `ApiError::internal` 报错。)
g. **列表/详情/预览/删除/资源链**:`scan_merged_export_dir` 与 `export_file_info` 的 merged 分支改用解析结果(chatType/displayName 来自文件名,chatId "merged",exportDate/description「合并于 …」不变);`resolve_export_or_merged_file`、`delete_export_file`、`preview_export_file`、`find_export_local_resource`(merged_ 前缀判断)**无需改动**,新名字自动兼容。
h. **防线**:`parse_scheduled_export_file_name` 开头对以 `merged_` 开头的名字直接返回 None(虽然 merged 目录本就不被 available-tasks 扫描,防止未来目录变化时泄漏为合并源)。
i. **测试**(metadata_tests 更新+新增):新格式解析(group/friend、多词聊天名、`_2` 碰撞后缀)、旧格式仍解析、拒绝(zip、无 T、普通 `group_…` 名、`merged_.json`);`merged_file_name` 消毒(空格/斜杠/空名);`group_merge_sources` 分组(混合聊天 → 正确分组、单文件组 → skipped、无法解析 → 兜底组);隔离断言:`parse_export_file_name`/`parse_manual_export_file_name`/`parse_scheduled_export_file_name` 对新 merged 名均返回 None。

### 3. `qce-v4-tool/app/page.tsx`(仅通知处理)

`handleScheduledMerge`:按新 result 渲染——成功:「合并完成」,message 按组列出「{displayName}:合并 {sourceCount} 个备份 → {totalMessages} 条消息」,`actions` 每组一个「打开文件位置 {displayName}」(`jsonPath` 调 `/api/open-file-location`),`skipped` 追加说明;部分失败组在消息中标注。

### 4. `qce-v4-tool/components/ui/scheduled-backup-merge-dialog.tsx`(仅文案)

说明文字改为:「同一聊天的备份会分别合并成一个文件并按聊天名命名;每个聊天需至少 2 个备份才会合并」。

## 构建、部署与验证

1. 服务端检查(docker 既有流程,root + 挂载 /cargo):`rustfmt 就地` → `cargo test` → `cargo clippy --all-targets -- -D warnings` → `cargo build` → `rustfmt --check`;`git diff --check`。
2. 前端:`cd qce-v4-tool && pnpm install --frozen-lockfile && pnpm build`(pnpm 12/Node 22 本机已验证可行)。
3. musl release 构建:`QCE_VERSION=6.2.8`(延续当前部署版本线)。
4. 打包:`QCE_VERSION=6.2.8 QCE_SERVER_LINUX_X64=<新二进制> QCE_SERVER_WINDOWS_X64=<现役 exe> python3 scripts/build-napcat-plugin.py`。
5. 部署:整目录备份到 **`/home/qinzhu/AstrBot/napcat-data/plugin-backups/`(plugins 目录之外,吸取上次 NapCat 误加载 .bak 目录的教训)**→ 停容器 → 替换 `napcat-plugin-qce`(保留 logs/)→ 启动。
6. live 验证:
   - 基线:`/api/exports/files` 44 条(含 2 条旧 merged);`available-tasks` 4/41 且无 merged;
   - **非破坏性实机合并**:复制某群聊 2 个现有定时备份为临时新名(如 `group_胡椒玉米汤_647668860_20260830_990001.json/.html` 对,原名未动)→ `POST /api/merge-resources`(deleteSourceFiles=false)→ 断言 groups[0].displayName=聊天名、新文件存在且命名含聊天名 → 历史列表出现新记录(displayName=聊天名)→ 用 `DELETE /api/exports/files/{name}` 删除新产物(顺带验证删除路径)→ 移除 2 个临时副本 → 列表恢复 44 条、available-tasks 恢复 4/41;
   - 回归:旧 merged 记录 info/preview/资源仍 200。

## 明确不做 / 假设与风险

- 不改 `POST /api/merge-resources` 请求 schema(平铺 fileName 列表向后兼容);响应 schema 变更与 UI 同步部署,无其他消费方(已 grep 确认)。
- 合并输出仍写 `exports/merged`,共享 `resources/` 目录机制不变。
- 单文件组跳过(不复制重导出);UI 仍保留「至少选 2 个」总闸。
- 聊天名消毒后同秒同聊天再合并由 `_N` 碰撞后缀兜底;极端重名聊天(消毒后同名)合并记录会相邻出现,可接受。
- 风险自查:新命名只影响 `parse_merged_export_file_name` 消费方;`validate_merge_sources` 不扫 merged 目录 + `parse_scheduled_export_file_name` 前缀防护,merged 不会成为再合并源;删除仍按 base_name 删同名对、共享 resources 目录命名不同天然保留。
- 回滚:恢复 `plugin-backups/` 中上一整目录备份 + 重启容器。

## 提交

完成后按仓库规范提交(如 `fix(server): 合并备份按聊天分组并按聊天名命名`),计划文件 `docs/merge-per-chat-plan.md` 一并提交,不推送(与既有工作一致)。
