# 合并备份缺陷修复计划

## 背景与目标

最近 4 个本地 commit 完成了合并备份按聊天分组、合并记录进入历史列表、输出格式选择和群头像恢复。静态审查发现以下业务链路仍不完整：

- 请求格式校验会静默接受非法输入。
- HTML 写出失败可能被当成成功，并删除源文件。
- 只选择 HTML 源文件时，消息会静默变成空列表。
- 合并产物未纳入资源索引和资源列表接口。
- 多聊天合并共享资源目录时，同名资源可能互相覆盖。

本计划只修复上述行为问题，保持现有请求兼容性、文件命名兼容性、历史记录兼容性和删除源文件语义。

## 修复内容

### 1. 严格校验 `formats`

位置：`qq-chat-export-server/src/api/routes/resources.rs`

调整 `parse_merge_formats`：

- `formats` 缺省时继续使用 `["json", "html"]`。
- `formats` 必须是数组；字段存在但不是数组时返回 `400`，错误码保持 `INVALID_FORMATS`。
- 数组中的每一项必须是字符串，统一转小写后只允许 `json` 或 `html`。
- 不允许通过 `filter_map` 丢弃非字符串值。
- 空数组或归一化后没有有效格式时返回 `400`。
- `["json", "xlsx"]`、`[1, "html"]`、`"html"` 等输入都必须拒绝。

补充纯函数级测试覆盖缺省值、大小写、空数组、非数组、非字符串和未知格式。

### 2. HTML 写出失败不得伪装成功

位置：`write_merged_data` 和 `merge_resources`

当前 `write_merged_data` 把 HTML 导出失败转换为空路径，调用方仍将该组标记为 `success`，并可能执行源文件清理。

调整为：

- 选中的每一种格式都必须明确报告写出结果。
- 只要请求生成的格式中任一格式写出失败，该聊天组标记为 `failed`。
- 失败组不得执行 `cleanup_merge_sources`。
- 失败组结果必须包含明确错误信息和已生成文件信息（如有）。
- 只有所有请求格式均成功写出，才标记 `status: "success"`。
- `deleteSourceFiles=true` 只在该组完整成功后删除源 HTML、JSON 和资源目录。
- 若某组失败但其他组成功，接口继续返回部分成功结果；若全部失败，保持现有 `MERGE_FAILED` 错误响应。

这样可避免“接口成功但没有完整产物、源文件已删除”的数据损失。

### 3. 源消息读取失败必须显式处理

位置：`validate_merge_sources`、`merge_source_messages`、`merge_resources`

当前合并消息只读取同名 JSON；HTML-only 源没有 JSON 时会得到空消息列表并继续成功写出。

调整为：

- 在每个聊天组开始合并时，统计可读取的 JSON 源数量和读取/解析失败情况。
- 如果组内没有任何可读取 JSON，组标记为失败，错误说明“缺少可合并的 JSON 消息数据”，保留源文件。
- 如果部分 JSON 缺失或解析失败，不能静默忽略；组标记为失败并报告具体原因。
- HTML-only 文件仍可作为历史记录查看和下载对象，但当前合并接口不应把它们伪装成空消息成功结果。
- 只有消息数据读取成功后，才继续资源合并、格式写出和可选清理。

保持现有“源文件必须存在”的校验和请求字段不变。

### 4. 合并产物接入资源索引与资源列表

位置：`resources_index`、`export_file_resources`，必要时复用已有 `merged_exports_dir` 和资源解析辅助函数。

调整为：

- `/api/resources/index` 扫描 `exports/merged` 下可识别的 HTML/JSON 合并产物。
- 合并产物的资源目录统一按 `exports/merged/resources` 统计。
- 在 `exports` 数组中加入合并文件的格式、聊天类型、显示名、资源数量和资源大小。
- 汇总字段 `summary.totalResources`、`totalSize`、`bySource` 必须包含合并资源，并避免同一共享资源目录被 HTML/JSON 文件重复累计。
- `/api/resources/export/:fileName` 对合并文件解析到 `exports/merged/resources`，返回真实资源列表和正确的资源 URL。
- 保持已有 `/api/exports/files/:fileName/resources/*path`、预览和删除接口行为不变。
- 资源索引应正确处理只有 HTML、只有 JSON、HTML+JSON 成对存在的情况，不能因缺少另一格式而丢失资源统计。

前端历史页通过 `resourceIndex.exports` 显示资源数量时，应能命中合并文件名。

### 5. 防止多聊天合并资源互相覆盖

位置：`merge_resource_files`、合并输出目录布局和对应资源 URL 生成逻辑。

当前所有聊天组共用 `exports/merged/resources`，且按原始文件名复制；不同内容但同名的资源会覆盖。

采用按合并产物隔离资源目录的方案：

- 每个聊天组生成独立的资源目录，例如 `exports/merged/resources_<base_name>/...`。
- 该组 JSON/HTML 中的资源路径指向自己的目录。
- `merge_resource_files` 的去重表只在组内使用，但目标路径也必须包含组标识。
- 同一组内仍按 MD5 去重；不同组之间不共享可变目标文件。
- 删除某个合并产物时，只删除其对应的 `resources_<base_name>`，不影响其他合并产物。
- 更新资源查找、资源列表、预览重写和历史资源统计逻辑，使新目录布局与普通导出一致。
- 对已有旧格式合并产物继续兼容共享 `exports/merged/resources` 目录，避免历史文件失效。

### 6. 响应与 UI 兼容

保持现有响应结构：

- `groups[].status` 继续使用 `success` / `failed`。
- `jsonPath` / `htmlPath` 只在对应文件真实写出后返回非空值。
- 失败组包含 `error`，成功组包含消息数、去重数、资源数。
- UI 继续按组显示成功、失败和跳过信息。
- “打开文件位置”只对真实存在的 JSON/HTML 路径生成动作；若组失败或没有产物，不生成无效动作。
- 不向成功通知暴露完整本地路径。

## 验证计划

服务端：

- 单测 `parse_merge_formats` 的所有非法输入。
- 单测 HTML 写出失败时组状态、清理逻辑和路径返回。
- 单测缺失 JSON、损坏 JSON、部分 JSON 缺失时不会生成空消息成功结果。
- 单测两个聊天组存在同名不同内容资源时，两个产物读取到的内容互不影响。
- 单测资源索引和单文件资源列表能识别 `exports/merged`。
- 保留旧格式 `merged_YYYY-MM-DDTHH-MM-SS.{json,html}` 的 info、preview、资源访问和删除兼容性。

执行：

```bash
cd qq-chat-export-server
cargo test
cargo clippy --all-targets -- -D warnings
cargo build
rustfmt --edition 2021 --check src/api/routes/resources.rs
```

前端：

```bash
cd qce-v4-tool
pnpm build
```

接口场景：

1. `formats` 缺省：JSON+HTML 均生成。
2. `formats: ["html"]`：只生成 HTML，且源 JSON 缺失时返回失败而不是空消息成功。
3. `formats: "html"`、`formats: [1, "html"]`、`formats: ["xlsx"]`、`formats: []`：均返回 400。
4. 两个聊天各有同名不同内容资源：合并后分别预览，内容不能串组。
5. `/api/resources/index` 和 `/api/resources/export/:fileName` 能返回合并产物资源。
6. `deleteSourceFiles=true` 时，只有完整成功组删除源文件；失败组源文件保留。

## 假设与边界

- 不改变 `POST /api/merge-resources` 的请求字段名称和整体响应外壳。
- 不允许 HTML-only 源被静默当作空消息合并；如需支持从 HTML 反解析消息，应另立需求，不在本次修复中实现。
- 旧合并产物继续使用旧资源目录兼容路径，新产物使用按文件隔离的资源目录。
- 不修改已有普通导出、定时导出和手动导出的资源布局。
- 本计划只覆盖上述 5 个已确认缺陷，不新增额外安全防御、无关重构或扩展测试。
