# 合并功能小修:输出格式可选 + 合并记录显示群头像

## 目标与成功标准

1. **输出格式可选**:合并对话框新增「生成 JSON / 生成 HTML」两个开关(默认都开,至少开一个);服务端只写入选中的格式,未生成的路径在结果中为空。
2. **群头像恢复**:合并产物写入聊天 peer 信息,历史记录列表里新合并记录的 `avatarUrl` 正确(群聊 = `p.qlogo.cn/gh/{群号}/{群号}/100`;好友有 uin 时 = q1.qlogo.cn,uid 形式经现有 UID→UIN 映射兜底),UI 行显示群头像而非通用图标。

live 验证(部署后,非破坏性,延续上轮方式):
- `POST /api/merge-resources` 不传 formats → JSON+HTML 都生成(现行为);
- `formats:["html"]` → 只生成 HTML,结果组 `jsonPath` 为空,列表多 1 条 HTML 行(带 avatarUrl + messageCount);
- `formats:[]` / 非法值 → 400;
- 用「小屋」2 个临时副本实机合并 → 新记录 `avatarUrl == https://p.qlogo.cn/gh/772616499/772616499/100`,list 行可见群头像;随后 DELETE 产物 + 移除副本,列表恢复 44 条、available-tasks 4/41(回归)。

## 根因(已实证)

- `write_merged_data` 无条件写 JSON + HTML(HTML 失败才退化为仅 JSON),请求与 UI 都没有格式选择;
- `scan_merged_export_dir` 之前有意不设 `avatarUrl`(chatId 固定 "merged"),而文件名又不含 peer ID,无从推导群头像;现代 HTML 导出器其实已在头部 `QCE_METADATA` 注释里嵌入 `chatName/avatarUrl/peerUid/peerUin/messageCount`(`modern_html_exporter.rs` 1035-1084),`parse_html_metadata` 只读前 4KB 即可取出——之前的「HTML 不解析」成本顾虑不成立。

## 改动 1:服务端输出格式可选(`qq-chat-export-server/src/api/routes/resources.rs`)

- 新增纯函数 `parse_merge_formats(body: &Value) -> Result<(bool, bool), String>`:读取 `formats` 数组(值小写归一),缺省 `["json","html"]`;含非法值或全空 → Err("…", "INVALID_FORMATS")。可单测。
- `merge_resources`:解析格式 → `generate_json` / `generate_html` 传入 `write_merged_data`;响应 `groups[].jsonPath` / `htmlPath` 未生成时为空字符串;`success` 判定不变。
- `write_merged_data` 签名加 `generate_json: bool, generate_html: bool`:命名对仍由 `merged_output_names` 一次算出(保证成对/碰撞一致),只写入选中的文件,未生成的返回空 `PathBuf`;合并消息读取仍走源 JSON(与输出格式无关)。
- 校验:非法 `formats` → 400 `INVALID_FORMATS`;`formats:[]` → 400「至少选择一种输出格式」。

## 改动 2:合并记录群头像(同一文件)

- `MergeGroup` 增加 `chat_id: Option<String>`;`group_merge_sources` 中:scheduled 分支从 `parse_export_file_name` 结果取 `chatId`(遗留「任务名_时间」格式取不到则 None),manual 分支取 `peer_uid`,兜底 None。
- `write_merged_data` 签名再加 `chat_id: Option<&str>`:
  - `avatar = chat_id.and_then(|id| avatar_url(chat_type, id))`(group → gh.qlogo.cn;friend 数字 uin → q1.qlogo.cn;u_uid → None 交给运行时 UID→UIN 映射);
  - JSON `metadata` 增补 `chatId`、`avatarUrl`(Some 才写入,保持 schema 向后兼容);
  - `ChatInfo` 增补 `avatar`、`peer_uid`(已确认字段存在)→ 生成的 HTML 头部 `QCE_METADATA` 自动带上 `avatarUrl/peerUid`,无需改 core。
- `parse_json_metadata` 增加回退链:`peer_uid` 增 `/metadata/chatId`,`avatar_url` 增 `/metadata/avatarUrl`(对普通导出无影响,字段不存在时回退为空)。
- `scan_merged_export_dir`:
  - JSON 行仍走 `parse_json_metadata`,HTML 行改为 `parse_html_metadata`(仅读 4KB 头,顺带拿到 messageCount/avatarUrl);
  - `file_info["chatId"]` = 元数据 peer_uid(存在时),否则保持 `"merged"`;
  - 改用 `apply_file_metadata(&mut file_info, metadata)` 统一注入 avatarUrl/peerUid/messageCount(displayName/description 不受影响:元数据无 chatName/timeRange 时该函数不动现有字段,已核对);
  - friend + `u_xxx` chatId 的行由既有 `fix_avatar_urls` 走 UID→UIN 映射补头像(该函数对 merged 行同样生效)。
- 旧格式 merged 文件(盘上 `merged_2026-08-30T14-07-16.*`,元数据无 chatId/avatarUrl)保持通用图标——无可恢复的群号,不回填。

## 改动 3:UI(`qce-v4-tool`)

- `components/ui/scheduled-backup-merge-dialog.tsx`:
  - 新增 `formats` 状态 `{ json: true, html: true }`;「合并选项」区加两个 Switch(生成 JSON 文件 / 生成 HTML 文件,带说明);
  - `onMerge` config 类型加 `formats: string[]`;「开始合并」按钮 disabled 条件加 `(!formats.json && !formats.html)`。
- `app/page.tsx` `handleScheduledMerge`:
  - config 类型加 `formats?: string[]`,随请求透传;
  - 成功通知尾句按 `config.formats` 动态生成(JSON 和 HTML / JSON / HTML);
  - 「打开文件位置」动作 `filePath: g.jsonPath || g.htmlPath`(仅 HTML 时也能打开)。

## 测试

- 服务端单测(metadata_tests 追加):`parse_merge_formats`(缺省双格式、`["html"]`、大小写归一、非法值/空数组报错);`group_merge_sources` 增加 chat_id 断言(scheduled 现行名、manual、遗留名 None)。
- 检查(docker 既有流程):`rustfmt 就地` → `cargo test` → `clippy --all-targets -- -D warnings` → `cargo build` → `rustfmt --check`;`git diff --check`。
- 前端:`pnpm install --frozen-lockfile && pnpm build`。

## 构建、部署与 live 验证

1. musl release `QCE_VERSION=6.2.8` 构建;官方 `build-napcat-plugin.py` 打包(Windows 沿用现役 exe)。
2. 部署:整目录备份到 `plugin-backups/`(plugins 之外)→ 停容器 → 替换(保留 logs/)→ 启动。
3. live(非破坏性,同上轮):
   - 复制「小屋」2 个备份为临时名 → `POST formats:["html"]` → 断言仅 htmlPath 非空、jsonPath 为空;列表出现 1 条新 HTML 行且 `avatarUrl == https://p.qlogo.cn/gh/772616499/772616499/100`、有 messageCount;info 正常;
   - 再 `POST` 默认 formats → 断言 json+html 都生成、JSON 行 avatarUrl 同群头像、messageCount 正确;
   - `formats:[]` 与 `formats:["xlsx"]` → 400;
   - 用 DELETE 接口删掉两组新产物 → 移除 2 个临时副本 → 列表恢复 44 条、available-tasks 4/41、旧 merged 记录 info/preview 200。

## 明确不做 / 假设与风险

- 不改请求 schema 兼容性:不传 `formats` 时保持现行为(双格式);响应仅 jsonPath/htmlPath 可能为空,无其他消费方(已 grep)。
- 不把 peer ID 写进合并文件名(避免 u_ 下划线与名字分界歧义),头像信息走元数据(QCE_METADATA / merged JSON metadata)。
- 旧 merged 记录无头像、不回填(无群号来源);合并 HTML 行从此带 messageCount(4KB 头解析,成本可忽略,属顺带改进)。
- 风险自查:JSON metadata 增字段只影响本解析器;HTML QCE_METADATA 由既有导出器生成,无需改 core;friend u_uid 无映射时仍回退图标(与普通 friend 行一致)。
- 回滚:恢复 `plugin-backups/` 上一整目录备份 + 重启容器。

## 提交

完成后按仓库规范提交(如 `fix(server): 合并输出格式可选并恢复合并记录群头像`),计划文件一并提交,不推送(与既有工作一致)。
