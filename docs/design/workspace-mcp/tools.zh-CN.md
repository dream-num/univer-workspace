# 工具规格

> 本文是 MCP 工具与 `uvw` 命令的对照规格（D2）。实现时以 `apps/cli/src/program.ts`、`apps/cli/src/product-commands.ts` 和 `apps/cli/src/features/**` 为准。
> 两者不一致时，以 CLI 的行为为准，并修正本文。

## 1. 约定

### 1.1 命名与参数

- 工具名是 `uvw` 命令路径的 snake_case：`uvw pr create` 对应 `pr_create`。
- 参数名是 CLI 长选项去掉 `--` 后的 snake_case：`--idempotency-key` 对应 `idempotency_key`，`--worktree` 对应 `worktree`。
- 位置参数改为具名参数，名字取 CLI help 里的占位名，例如 `uvw issue view <n>` 对应 `number`。
- CLI 接受的各种引用形式在 MCP 里照样接受：仓库可以是 `owner/slug`、`owner/personal`、Space ID 或 Workspace URL；条目可以是 `12`、`#12`、URL 或 Worktree ID；用户可以是 `@me`。
- `repo` 在需要仓库的工具里是必填参数。MCP 没有 `UVW_REPO` 这样的环境变量。
- `limit`（CLI 的 `-L`）默认 30，与 CLI 相同。

### 1.2 输出

- 每个工具都声明 `outputSchema`，结果放在 `structuredContent`。
- 形状与 `--json` 输出一致：产品命令返回裸对象，内容命令返回以名词为键的包装（`{units}`、`{unit}`、`{nodes}`、`{upload}`）。`execute`、`import`、`export` 返回裸结果。
- `--json` 输出是数组的命令，MCP 把数组包成以名词为键的对象，例如 `repo_list` 返回 `{repos}`。2025-11-25 要求 `structuredContent` 是对象，SDK 会把数组自动包成 `{result}`，而 2026-07-28 保持数组，同一个工具的形状因此随协议版本变化。显式名词键让两版协议得到同一个形状（[本地验证环境](local-verification.zh-CN.md) R2、附录 A.4）。
- `content` 只放一行文字摘要，不重复整段 JSON。
- 结果里凡是有对应网页的对象，都附带 `url` 字段，相当于顺带执行了一次 `uvw browse`。
- `inspect`、`screenshot --json`、`lint --json` 等来自闭源 `@univer-cli/*` 包的输出，结构以各包的 `dist/index.d.ts` 为准。

### 1.3 错误

- 工具错误返回 `isError: true`，`structuredContent` 为 `{code, message, detail}`。`code` 沿用 CLI 的 `workspace-*` 错误码（`apps/cli/src/command.ts:42-60`）。
- 认证失败不作为工具错误。网关返回 HTTP 401 和 `WWW-Authenticate`，让客户端重新授权。这对应 CLI 的退出码 4。
- scope 不足返回工具错误 `workspace-scope-required`，`detail` 里写明缺少的 scope。
- 结果未知的写入（`WorkspaceResultUnknownError`）原样返回，并提示用同一个 `idempotency_key` 重试。

### 1.4 注解

每个工具都必须声明 `readOnlyHint`、`destructiveHint`、`openWorldHint`，ChatGPT 要求三者齐全。下表中：

- “只读”列为“是”的工具，`readOnlyHint: true`。
- “破坏性”列为“是”的工具，`destructiveHint: true`。
- 所有工具 `openWorldHint: false`，因为它们只作用于 Workspace。

### 1.5 幂等

保留 CLI 已有的 `idempotency_key`：`pr_create`、`unit_create`、`blob_upload`、`blob_replace`（两种 Blob 写工具均必填）、`html_view_create`（必填）、`import`、`compile_markdown`、`compile_typst`。
`compile_svg` 在 CLI 里没有幂等键，MCP 补上一个可选的。

客户端可能因为超时而重试调用（ChatGPT 的社区报告，未核实）。创建类工具的描述里要写明“创建前生成一个幂等键，重试时复用”。

### 1.6 写入安全

- 内容写入必须显式给出 `worktree`。读取必须在 `trunk: true` 和 `worktree` 之间二选一，两者都没有时报错，与 CLI 的 `workspace-*-scope-required` 一致。
- 直接写入（不经 Worktree 评审）的工具在描述开头写明“立即生效，不经评审”。
- `pr_merge`、`pr_discard` 的描述沿用 `core` skill 的规则：除非用户明确要求，否则交给用户在网页上完成。

## 2. toolset

| toolset | 工具数 | 默认启用 | 用途 |
| --- | --- | --- | --- |
| `core` | 31 | 是 | 查找、Issue、PR 生命周期、编辑、导入导出、截图、参考资料 |
| `files` | 13 | 否 | Blob、Asset、HTML View、Markdown、Typst、SVG、PDF、lint |
| `admin` | 10 | Team Space Owner 默认启用（D10） | 仓库与 Label 管理、目录组织、合并与丢弃、SVG 资源目录 |

选择方式：

- `…/mcp` 只启用 `core`。
- `…/mcp?toolsets=core,files,admin` 启用多个。
- `…/mcp?toolsets=all` 启用全部，与 `uvw` 完全对齐。

“连接到 AI 助手”设置页为用户生成 URL。用户是任一 Team Space 的 Owner 时，默认生成 `core,admin`。
toolset 只决定 `tools/list` 返回哪些工具。权限仍由 scope 和 Workspace ACL 决定。

`tools/list` 的顺序固定，便于客户端缓存。工具描述保持简短，关键信息放在第一句。

## 3. 工具映射

### 3.1 `core`

| 工具 | `uvw` | 主要参数 | 只读 | 破坏性 | scope |
| --- | --- | --- | --- | --- | --- |
| `whoami` | `auth status` | 无 | 是 | 否 | `read` |
| `repo_list` | `repo list` | `owner`、`type`、`limit` | 是 | 否 | `read` |
| `repo_view` | `repo view` | `repo` | 是 | 否 | `read` |
| `issue_list` | `issue list` | `repo`、`state`、`labels`、`assignee`、`author`、`search`、`limit` | 是 | 否 | `read` |
| `issue_view` | `issue view` | `repo`、`number`、`comments` | 是 | 否 | `read` |
| `issue_create` | `issue create` | `repo`、`title`、`body`、`labels`、`assignees`、`nodes` | 否 | 否 | `write` |
| `issue_edit` | `issue edit` | `repo`、`number`、`title`、`body`、`add_labels`、`remove_labels`、`add_assignees`、`remove_assignees`、`add_nodes`、`remove_nodes` | 否 | 否 | `write` |
| `issue_comment` | `issue comment` | `repo`、`number`、`body` | 否 | 否 | `write` |
| `issue_set_state` | `issue close`、`issue reopen` | `repo`、`number`、`state`（`open`、`closed`）、`reason`、`comment` | 否 | 否 | `write` |
| `pr_list` | `pr list` | `repo`、`state`、`author`、`search`、`limit` | 是 | 否 | `read` |
| `pr_view` | `pr view` | `repo`、`number` | 是 | 否 | `read` |
| `pr_create` | `pr create` | `repo`、`title`、`body`、`visibility`、`idempotency_key` | 否 | 否 | `write` |
| `pr_edit` | `pr edit` | `repo`、`number`、`title`、`body`、`visibility` | 否 | 否 | `write` |
| `pr_ready` | `pr ready [--undo]` | `repo`、`number`、`undo` | 否 | 否 | `write` |
| `search` | `search issues`、`search prs` | `kind`（`issues`、`prs`），其余同对应命令 | 是 | 否 | `read` |
| `browse` | `browse` | `repo`、`number`、`unit` | 是 | 否 | `read` |
| `space_browse` | `space browse` | `repo`、`parent`、`recursive`、`resource_kind`、`unit_type` | 是 | 否 | `read` |
| `space_find` | `space find` | `space`、`query`、`resource_kind`、`unit_type` | 是 | 否 | `read` |
| `unit_list` | `unit list` | `worktree` | 是 | 否 | `read` |
| `unit_add` | `unit add` | `worktree`、`resource` | 否 | 否 | `write` |
| `unit_create` | `unit create` | `worktree`、`space`、`type`、`name`、`parent`、`idempotency_key` | 否 | 否 | `write` |
| `execute` | `execute` | `worktree`、`unit`、`code` | 否 | 否 | `write` |
| `inspect` | `inspect` | `target`（workbook、worksheet、range、document、paragraph、presentation、slide、base、board、board-element）、`selectors`、`unit`、`worksheet`、`trunk` 或 `worktree`、`cursor` | 是 | 否 | `read` |
| `screenshot` | `screenshot` | `unit`、`trunk` 或 `worktree`、`pages`、`contact_slide`、`tile`、`sheet`、`range`、`region`、`elements`、`padding`、`scale` | 是 | 否 | `read` |
| `import` | `import` | `upload_id` 或 `file`（ChatGPT 文件参数）、`worktree`、`space`、`type`、`name`、`parent`、`idempotency_key` | 否 | 否 | `write` |
| `export` | `export` | `worktree`、`unit`、`format`（`xlsx`、`docx`、`pptx`） | 是 | 否 | `read` |
| `file_upload_create` | 无 | `purpose`、`file_name`、`size`、`media_type` | 否 | 否 | `write` |
| `job_get` | 无 | `job_id` | 是 | 否 | `read` |
| `api_find` | `api find` | `terms`、`unit` | 是 | 否 | `read` |
| `api_show` | `api show` | `symbols` | 是 | 否 | `read` |
| `skills_read` | `skills list`、`skills get`、`skills read` | `name`、`resource`、`full` | 是 | 否 | `read` |

说明：

- `execute` 只接受 `code` 字符串，没有 `--script`。CLI 对代码长度的上限（10 MiB）保持不变。
- `inspect` 的结果可能很大，按第 5 节分页。`cursor` 是 MCP 新增的分页参数。
- `skills_read` 不带 `name` 时等于 `skills list`；带 `name` 不带 `resource` 时等于 `skills get`。返回内容里的 `uvw skills read …` 改写成对应的工具调用说明。
- `screenshot` 在结果不超过约 1 MB 时直接返回图片内容，否则返回下载链接。
- `import` 和 `export` 可能返回任务，所以 `job_get` 放在 `core`。

### 3.2 `files`

| 工具 | `uvw` | 主要参数 | 只读 | 破坏性 | scope |
| --- | --- | --- | --- | --- | --- |
| `blob_get` | `blob get` | `resource` | 是 | 否 | `read` |
| `blob_upload` | `blob upload` | `upload_id`、`space`、`parent`、`name`、`media_type`、`idempotency_key` | 否 | 否 | `publish` |
| `blob_download` | `blob download` | `resource` | 是 | 否 | `read` |
| `blob_replace` | `blob replace` | `resource`、`upload_id`、`etag`、`idempotency_key` | 否 | 是 | `publish` |
| `asset_download` | `asset download` | `id`、`worktree` | 是 | 否 | `read` |
| `html_view_validate` | `html-view validate` | `html` | 是 | 否 | `read` |
| `html_view_create` | `html-view create` | `html`、`space`、`name`、`parent`、`idempotency_key` | 否 | 否 | `publish` |
| `compile_markdown` | `compile-markdown` | `markdown`、`assets_upload_id`、`title`、`apply`、`worktree`、`space`、`parent`、`unit`、`source_map`、`blocks`、`idempotency_key` | 否 | 否 | `write` |
| `export_markdown` | `export-markdown` | `worktree`、`unit`、`source_map`、`blocks` | 是 | 否 | `read` |
| `compile_typst` | `compile-typst` | `bundle_upload_id`、`apply`、`worktree`、`space`、`parent`、`idempotency_key` | 否 | 否 | `write` |
| `compile_svg` | `compile-svg` | `svg`、`assets_upload_id`、`page`、`add`、`estimate_text_size`、`apply`、`worktree`、`unit`、`idempotency_key` | 否 | 否 | `write` |
| `print_pdf` | `print-pdf` | `unit`、`trunk` 或 `worktree` | 是 | 否 | `read` |
| `lint` | `lint` | `unit`、`worktree`、`pages` | 是 | 否 | `read` |

说明：

- `html_view_validate` 与 `html_view_create` 接受最多 512 KiB UTF-8 HTML，超限返回 `workspace-argument-invalid` 和明确上限。两者在执行层复用 Client Core，按调用者身份导出所绑定的 trunk Sheets。创建在同一执行操作中校验并上传原字节，返回 CLI 的裸结果及 `workspaceUrl`；必填幂等键为 16 到 200 个 URL-safe 字符，结果未知时复用相同键、HTML 和目标重试。
- `blob_download`、`asset_download`、`print_pdf` 返回签名下载链接。`blob_download` 同时返回 ETag，因为 `blob_replace` 需要它。
- `compile_markdown` 的 Markdown 正文以字符串传入。正文引用的本地图片打成 zip 上传，用 `assets_upload_id` 传入，zip 内路径对应 Markdown 里的相对路径。CLI 要求资源不能超出源文件目录（`packages/client-core/src/markdown-source.ts:31-47`），MCP 同样拒绝 zip 中越界的路径。
- `export_markdown` 与当前 CLI 一样，要求上次成功生成或回读的 `source_map` 和非空、去重的显式 `blocks`，不推断任意原生文档的整篇映射。
- `export_markdown` 返回 `{markdown, sourceMap, assets}`。`assets` 是每个资源的下载链接，不内联字节。CLI 的 JSON 输出本来就不含资源字节（`apps/cli/src/features/markdown/export-command.ts:74`）。
- `compile_typst` 的 bundle 目录打成 zip 上传。
- 不带 `apply` 的编译工具返回生成的 Facade 代码和诊断，不写入 Workspace。

### 3.3 `admin`

| 工具 | `uvw` | 主要参数 | 只读 | 破坏性 | scope |
| --- | --- | --- | --- | --- | --- |
| `repo_create` | `repo create` | `slug`、`name`、`description`、`public` | 否 | 否 | `publish` |
| `repo_edit` | `repo edit`、`repo rename` | `repo`、`name`、`description`、`visibility`、`slug` | 否 | 是（改 `slug` 时） | `publish` |
| `label_list` | `label list` | `repo` | 是 | 否 | `read` |
| `label_write` | `label create`、`label edit`、`label delete` | `repo`、`action`、`name`、`new_name`、`color`、`description` | 否 | 是 | `write` |
| `space_node` | `space node create`、`rename`、`move`、`trash` | `action`、`repo`、`node`、`name`、`parent`、`root` | 否 | 是 | `publish` |
| `pr_merge` | `pr merge` | `repo`、`number` | 否 | 是 | `worktree:merge` |
| `pr_discard` | `pr discard` | `repo`、`number` | 否 | 是 | `worktree:merge` |
| `resources_registries` | `resources registries` | 无 | 是 | 否 | `read` |
| `resources_find` | `resources find` | `query`、`registry`、`limit` | 是 | 否 | `read` |
| `resources_export` | `resources export` | `handles` | 是 | 否 | `read` |

说明：

- `repo_edit` 改 `slug` 会让旧引用失效，描述里写明。
- `label_write` 和 `space_node` 用 `action` 枚举合并低频操作，以控制工具数量。
- `resources_export` 返回 SVG 文本，不写目录。实测差异：库的 `read` 直接返回 SVG 文本，不必借临时目录；结果是 `{resources: [{handle, svg}], failed: [...]}`（CLI 为 `{exported: [{handle, path}], failed}`），`failed` 与 CLI 一致。`query` 和 `registry` 各取一个值（CLI 可传多个）。
- `@univer-cli/resource-library` 1.4.0 未限制缓存符号链接，上游需修复。gateway 通过公开 `ResourceCache` 接口补上校验，默认缓存为 `<os.tmpdir()>/univer-workspace-mcp-<uid>/resources`，新建根目录、父目录与 registry 目录使用 `0700`。首次使用前及每次 registry 读取前，根目录、gateway 创建的父目录及 registry 必须是当前 uid 拥有且不可由 group/world 写入的真实目录；registry 的 `realpath` 必须位于根目录内。导出文件必须是非符号链接的普通文件，且 `realpath` 位于根目录内。违反条件时整次调用返回 `workspace-resource-cache-unsafe`，按内部错误记录日志，不记录文件内容。`MCP_RESOURCE_CACHE_DIRECTORY` 覆盖路径也遵守这些校验。

## 4. 不可避免的差异

| `uvw` 能力 | MCP 中的处理 | 原因 |
| --- | --- | --- |
| `auth login`、`auth login --complete`、`--username`、`--password-stdin` | 由 MCP 客户端的 OAuth 流程或 PAT 取代 | 登录由客户端负责 |
| `auth logout` | 用户在客户端断开连接，或在 Workspace 设置页吊销 token | 同上 |
| `config *`、`daemon *`、`screenshot setup`、`resources cache path`、`resources cache clear`、`skills path`、`-v` | 不提供。`whoami` 返回服务端版本 | 这些命令描述的是本机环境 |
| `uvw worktree` 命令组（`list`、`get`、`create`、`update`、`ready`、`reopen`、`merge`、`discard`） | 由 `pr_*` 工具覆盖，不单独提供 | 两组命令共用同一套处理函数（`apps/cli/src/features/pr/command.ts:49-73`） |
| `pr close`、`pr reopen` | 不提供 | 它们只输出引导性错误 |
| `-F/--body-file`、`--comment-file`、stdin | 改为字符串参数 | 远程读不到本机文件 |
| `execute --script` | 改为 `code` 字符串 | 同上 |
| `--file`（import、blob、html-view），Markdown 目录，Typst bundle，SVG 相对图片 | 上传句柄或字符串 | 同上，见第 6 节 |
| `--out`、`--force`、“不覆盖已有文件” | 签名下载链接或内联结果 | 远程写不了本机文件 |
| `export <out>` 由扩展名决定格式 | 显式 `format` 参数 | 没有输出路径 |
| `--json [fields]` 的字段筛选 | 不提供，始终返回完整结构化结果，大结果分页 | MCP 本身就是结构化输出 |
| `UVW_REPO` | `repo` 必填 | 没有环境变量 |
| 退出码 | `isError` 加错误码；认证失败为 HTTP 401 | MCP 的错误语义 |
| 大文件导入 | MCP 在创建 Unit 前将转换结果限制为 900 KiB，超限返回 `workspace-import-too-large` 和实际字节数 | Workspace 路由限制，见架构文档 7.3 节 |

## 5. 结果大小

客户端的上限各不相同：

| 客户端 | 上限 | 来源 |
| --- | --- | --- |
| claude.ai、Claude Desktop | 每个结果约 15 万字符；单次调用 240 秒 | Claude 连接器文档 |
| Claude Code | 默认 2.5 万 token；工具可用 `_meta["anthropic/maxResultSizeChars"]` 放宽到 50 万字符 | Claude Code MCP 文档 |
| ChatGPT | 未公开；有截断报告 | 社区报告，未核实 |

规则：

- `structuredContent` 超过 10 万字符时截断，返回 `truncated: true` 和 `cursor`，再次调用同一工具并带上 `cursor` 继续读取。
- 二进制内容只有单张截图在约 1 MB 以内时以图片内容返回，其余一律返回下载链接。
- `execute` 的返回值同样遵守截断规则。

上限是否合适，在阶段 B 和 H 用真实客户端复测。

## 6. 文件进出

### 6.1 上传

MCP 规范还没有标准的文件上传机制（SEP-2356、SEP-2631 仍是草案）。统一流程：

1. agent 调用 `file_upload_create`，`size` 可省略；提供时是大小上限，不要求精确长度，浏览器上传前无需知道文件大小。得到 `upload_id`、签名 PUT URL 和浏览器上传页 URL。有效期 10 分钟。
2. 能执行命令的客户端（Claude Code、Cursor、VS Code、WorkBuddy）直接对签名 URL 执行 PUT。不能执行命令的客户端，把上传页链接交给用户点击。
3. agent 把 `upload_id` 交给 `import`、`blob_upload`、`compile_markdown` 等工具。
4. ChatGPT 还可以通过 `_meta["openai/fileParams"]` 直接把用户上传的文件交给 `import`。网关从 ChatGPT 提供的临时 URL 拉取文件，不记录这个 URL。

PUT 支持 chunked，Content-Length 可省略；提供时不得超过有效大小上限。实际字节流同时受声明上限与用途上限约束。成功后记录实际大小和 SHA-256。`blob_upload.name` 可省略，默认使用上传文件名。

每用户上传与下载暂存字节默认合计最多 2 GiB，pending 上传默认最多 20 个，分别由 `MCP_STAGING_USER_MAX_BYTES` 与 `MCP_STAGING_USER_MAX_PENDING_UPLOADS` 配置。工具超额返回 `workspace-staging-quota-exceeded`，PUT 返回 429。

`purpose` 决定大小上限和允许的媒体类型：

| `purpose` | 用于 | 上限 |
| --- | --- | --- |
| `office-import` | `import` | 50 MiB，仍受 Workspace 1 MiB UnitData 提交上限约束 |
| `blob` | `blob_upload`、`blob_replace` | 默认 512 MiB，与 Workspace `maxBlobBytes` 对齐 |
| `markdown-assets`、`svg-assets`、`typst-bundle` | 对应的编译工具 | zip，默认各 50 MiB |

### 6.2 下载

导出文件、PDF、Blob、Asset 和多张截图都返回签名下载链接，15 分钟有效。工具只为申请者生成，链接本身是 capability，任何持有者都可下载，因此必须私密保存。
目前没有客户端会自动跟随 `resource_link` 下载（未核实），所以链接以文本形式出现在结果里，交给用户点击。

## 7. 长任务

| 客户端 | 单次调用时限 | 来源 |
| --- | --- | --- |
| claude.ai、Claude Desktop | 240 秒 | Claude 连接器文档 |
| ChatGPT | 约 60 秒，进度通知不重置计时 | 社区资料，未核实 |
| Claude Code | 可配置；2 分钟后自动转入后台 | Claude Code MCP 文档 |

MCP 的 Tasks 扩展目前只有 Claude Code CLI 支持。2026-07-28 版还去掉了 SSE 断点续传。所以：

- 所有工具的同步预算为 30 秒。
- `import`、`export`、`print_pdf`、`compile_typst`、多页 `screenshot` 超过预算时返回 `{job_id, status: "running"}`，agent 用 `job_get` 轮询。
- `job_get` 返回 `status`（`running`、`succeeded`、`failed`），完成时附带原工具的结果。
- 任务状态保存在网关内存和暂存存储的 sidecar 文件中，不使用数据库。任务结果的有效期与下载链接一致。
- 创建任务的调用按 `idempotency_key` 去重，客户端重试时返回同一个任务。
- 客户端声明支持 Tasks 扩展时，同时以 Tasks 的方式提供。这一项不在首版必做范围内。

## 8. skills 与 server instructions

- `apps/cli/skill-data` 下的 10 个 skill 同时以 MCP resource 提供，URI 为 `uvw://skills/<name>/SKILL.md` 和 `uvw://skills/<name>/<resource>`。
- server instructions 写入 `core` skill 的工作流规则：先找文件，再开 Worktree，写入后读回或截图验证，然后标记 ready，把评审链接交给用户，合并留给用户。
  不支持 Skill 的客户端（ChatGPT、WorkBuddy）靠这段 instructions 获得规则。
- 仓库里的发现入口 `skills/univer-workspace-cli/SKILL.md` 是面向 CLI 的安装说明，不变。MCP 的接入说明写在 `apps/mcp/README.md` 和 Workspace 的设置页里。

D3 已实现 `file_upload_create`、`blob_upload`、`blob_download`、`blob_replace` 和 `asset_download`。
`MCP_UPLOAD_BLOB_MAX_BYTES`、`MCP_UPLOAD_OFFICE_IMPORT_MAX_BYTES`、
`MCP_UPLOAD_MARKDOWN_ASSETS_MAX_BYTES`、`MCP_UPLOAD_SVG_ASSETS_MAX_BYTES`、
`MCP_UPLOAD_TYPST_BUNDLE_MAX_BYTES` 可配置用途上限。Blob 接受合法 MIME 类型；Office 接受
OpenXML、legacy Office 和 `text/csv`；其余三种用途只接受 `application/zip` 或
`application/x-zip-compressed`。上传对象一小时有效，链接十分钟有效。工具消费不删除对象，
同一 `idempotency_key` 可重试。外用户上传统一返回 `workspace-upload-not-found`，未完成或用途不符
分别返回 `workspace-upload-not-ready`、`workspace-upload-purpose-mismatch`。

D4 已实现同步 `import` 与 `export`。`import` 必填 `upload_id`、`worktree`、`space`、
`idempotency_key`，可选 `type`、`name`、`parent`，仅消费当前调用者的 `office-import` 上传。
结果沿用 CLI 裸结果，`sourcePath` 为上传文件名，并增加 PR 中 Unit 的 `url`。
`export` 接受 `worktree`、`unit`、`format`，返回 `{download, type}`，下载保留既有 attachment、
sandbox 和 private/no-store 头。导入记录 `upload_bytes`，导出记录 `export_bytes`。

本切片不实现 ChatGPT 文件参数或 `job_get`。两种操作仍受 30 秒同步预算约束；读超时返回
`workspace-executor-timeout`，写超时返回 `workspace-result-unknown`。import 的 rerun 为空。
Office 上传默认 50 MiB；内部导入请求帧上限为 64 MiB。导出响应帧上限为 128 MiB，
包含 JSON 头与长度前缀，超限返回 `workspace-result-too-large`。第 7 节的异步任务是后续目标。
