# Workspace Agents Skill 机制架构

状态：gateway 发现、浏览器目录注入、显式调用、门禁、输入框菜单和右侧栏展示已实现。产品语义和决定见 [agent-skills.md](./agent-skills.md)，分期执行见
[agent-skills-plan.md](./agent-skills-plan.md)。本文写给实现者，说明每个模块拥有什么、数据怎么流动、
哪些不变量不能破坏。文中的文件路径和函数名以 SK1 至 SK3 的实现为准。

## 模块和职责

skill 机制跨两个应用。gateway 拥有发现、校验、合并和读取。浏览器拥有提示词注入、显式调用和展示。
两者之间只有一个接口，即 MCP 工具 `skills_read`。

| 模块 | 位置 | 拥有 | 不拥有 |
| --- | --- | --- | --- |
| skill 目录加载 | `apps/mcp/src/gateway/`（新文件，如 `custom-skills.ts`） | 在个人空间和作用域仓库里找 `.agents/skills`，校验 `SKILL.md`，合并，产出诊断，读取文本附属文件 | 内置 skill 的静态快照（仍由 `skill-catalog.ts` 负责） |
| `skills_read` | `apps/mcp/src/gateway/tools/core/skills-read.ts` | 输入解析，三层名字解析，分页，`ToolResult.repo` 归属 | 模型何时调用 |
| runner | `apps/workspace/web/src/features/agents/runtime/runner.ts` | 每次运行开始时比对目录、追加提醒、展开 `/name`、写会话元数据，以及给输入框用的 `skills(scope)` | skill 内容本身 |
| 工具门禁 | `runtime/approvals.ts` 的 `gateTools` | 拒绝模型加载 `disable-model-invocation` 的 skill 指令，允许读取其附属文件 | 权限和 token scope |
| 输入框菜单 | `ui/composer.tsx`、`ui/composer-editor.tsx`、`ui/session-page.tsx` 的追加输入框 | `/` 菜单、过滤、键盘选择 | 解析和展开（在 runner） |
| 右侧栏和消息标签 | `ui/session-page.tsx`、`ui/messages.ts`、`ui/agents.css` | 从会话元数据渲染 skill 列表、诊断和 `/name` 标签 | 数据获取（右侧栏不发请求） |

不新增数据库表、HTTP 接口或 schema 版本。用户级 skill 存在个人空间的普通 Blob 里，读取走已有的
产品 HTTP 接口。

## 数据形状

gateway 输出使用下列形状。浏览器侧用 zod 在边界解析 `skills_read` 的 `structuredContent`，
随后移除 `builtin` 项。浏览器 `SkillEntry` 的 source 只允许 `repository` 和 `user`，
持久化和界面只使用这个过滤后的 `SkillCatalog`。

```ts
type SkillSource = "builtin" | "repository" | "user";

interface SkillEntry {
	name: string;
	description: string;
	source: SkillSource;
	path?: string;            // 自定义 skill 的 SKILL.md 路径，如 ".agents/skills/weekly-report/SKILL.md"
	modelInvocable: boolean;  // !disable-model-invocation，默认 true
	userInvocable: boolean;   // user-invocable，默认 true
	argumentHint?: string;
}

type SkillProblem = "invalid-skill" | "reserved-name" | "shadowed" | "too-large";

interface SkillDiagnostic {
	source: "repository" | "user";
	path: string;
	problem: SkillProblem;
	detail?: string;          // skillEntry 的 problems 摘要，不含文件内容
}

type RepositorySkills = "loaded" | "not-member" | "no-repository";

interface SkillCatalog {
	skills: SkillEntry[];
	diagnostics: SkillDiagnostic[];
	repository: RepositorySkills;
}

type SkillFile =
	| { path: string; kind: "text"; byteSize: number }
	| { path: string; kind: "binary"; byteSize: number; mediaType: string };
```

会话在用户消息的 `metadata` 上保存 `agentSkills` 和匹配成功时的 `agentSkillInvocation`。
字段与已有的 `agentContextPrompt`、
`agentReferences` 并列。`messages` 的 schema 是 `.passthrough()`，IndexedDB 不需要升级版本。

| 字段 | 形状 | 写入时机 | 读者 |
| --- | --- | --- | --- |
| `agentSkills` | `SkillCatalog`，去掉 `builtin` | `drive` 处理这条消息时，无论目录是否变化 | 下一次比对、右侧栏 |
| `agentSkillInvocation` | `{ name, source, digest }`，`digest` 是渲染前正文的 SHA-256 | 消息开头的 `/name` 匹配成功时 | 消息标签、右侧栏「已使用」、重复调用判断 |

`agentSkills` 同时是「这条消息已处理」的标记，见「每次运行的流程」。

## gateway 发现流程

`skills_read` 每次列目录或按名字解析自定义 skill 时，都实时执行下列步骤，不做进程内缓存。
用户修改 skill 后下一次调用即生效，这是设计要求。

1. **找个人空间。** `ToolContext.user` 只有 `{id, name}`，没有 username。调用 client-core 的
   `spaces.list()`（`GET /api/spaces`），取 `type === "personal"` 且 `affiliation === "owner"` 的那一项。
   找不到时用户级为空。
2. **解析作用域仓库。** 有 `repo` 输入时用 `resolveRepo(context, repo)`（`tools/core/issue-support.ts`），
   再用 `spaces.get(spaceId)` 取 `affiliation`。`owner` 或 `member` 才加载，否则 `repository` 记为
   `not-member`。不能用 `accessRole` 判断，公开仓库的非成员也是 `viewer`。仓库就是个人空间时只加载一次，
   按仓库级处理。
3. **逐层找目录。** `WorkspaceSpaceFeature.browse` 的 `parentNodeId` 只接受 Node ID，所以按名字逐层走：
   根目录找 `.agents`，再找 `skills`，再列出子目录。每层最多处理 100 个 skill 目录。
4. **读 `SKILL.md`。** 每个子目录取名为 `SKILL.md` 的 Blob。先用 browse 结果里的 `resource.byteSize` 检查，
   超过 64 KiB 记 `too-large`。再用 `downloadStream` 读取，按 `readWorkspaceHtmlView`
   （`packages/client-core/src/html-view-page.ts`）的做法：严格 UTF-8 解码，累计上限，`finally` 里
   `close()`。被隔离或不可下载的 Blob 记为 `invalid-skill`。
5. **校验。** 把 `SKILL.md` 交给 `@modelcontextprotocol/server/ext/skills` 的 `skillEntry`，与内置 skill
   使用同一套规则：`name` 1-64 位小写字母、数字和单个连字符，与目录同名；`description` 1-1024 字符。
   抛出的 `SkillCatalogError.problems` 转成 `invalid-skill` 诊断。`disable-model-invocation`、
   `user-invocable`、`argument-hint` 从解析出的 frontmatter 读取。
6. **合并。** 一个 `Map<name, SkillEntry>`。先放内置 skill，自定义 skill 与之同名时记 `reserved-name`。
   再放用户级，最后放仓库级，覆盖同名用户级时为被覆盖的一方记 `shadowed`。

附属文件只在按名字读取某个 skill 时才列出：对 skill 目录调用 `browse({ recursive: true })`，把
`WorkspaceNode.path` 去掉 `.agents/skills/<name>/` 前缀得到相对路径。每个 skill 最多 100 个文件，
单个文本文件上限 256 KiB。文本判定与 `SKILL.md` 相同：严格 UTF-8 解码成功且不含 NUL。

### 权限

gateway 用 agent token 通过 RFC 8693 换到的用户会话访问产品 API。token scope 只在 gateway 按工具检查，
`skills_read` 的 scope 是 `read`，Ask 模式的只读 token 也能用。Blob 下载接口只检查会话用户。
所以自定义 skill 的读取权限与用户自己在 Workspace 里的读取权限一致，没有额外提权。

### 与内置快照的关系

`apps/mcp/AGENTS.md` 要求 Skills 扩展和 `skills_read`「使用同一份快照」。这条规则只适用于内置 skill。
自定义 skill 不进入 Skills 扩展（`skill://` 资源），只能通过 `skills_read` 读取。实现时要在
`apps/mcp/AGENTS.md` 和 README 里写明这个例外。

## `skills_read` 接口

| 输入 | 行为 |
| --- | --- |
| 无 `name` | 返回合并目录：`skills`（每项带 `source` 等字段）、`diagnostics`、`repository` |
| `name` | 按内置、仓库级、用户级的顺序解析。返回 `{ name, source, content, resources? }`，`resources` 只列文本文件，每项带 `readCommand`。二进制文件放在 `binaryFiles` 里，只有路径、大小和类型 |
| `name` + `resource` | 返回一个文本附属文件，长内容按现有 `cursor` 分页 |
| `name` + `full: true` | 附带全部文本附属文件，超过 `RESULT_LIMIT` 时报 `workspace-result-too-large` |
| 以上任意 + `repo` | 加入作用域仓库这一层。`ToolResult.repo` 返回解析出的 Space ID，用于 `mcp.tool_call` 事件归属 |

`resource` 只接受清单里出现过的路径，不拼接路径，防止越界读取。现有的内置 skill 行为保持不变。

## 浏览器每次运行的流程

`drive` 在创建 MCP client、取得工具列表之后，创建 `Chat` 之前，执行下列步骤：

1. 只在 `messages.at(-1)?.role === "user"` 且这条消息没有 `metadata.agentSkills` 时处理。
   审批恢复、崩溃恢复和旧会话恢复末尾是 assistant 消息，全部跳过，不查找更早的用户消息。
2. 与 core `readResource` 并行调用 `client.callTool({ name: "skills_read", arguments: { repo? } })`。
   仅仓库作用域带 `repo: scope.spaceId`。在边界用 zod 解析 `structuredContent`，必须有来源字段、
   `diagnostics` 和 `repository`。`isError: true`、抛错或解析失败（包括旧 gateway 结果）都按失败处理。
3. 成功时过滤掉 `builtin`，保留 `modelInvocable: false` 的项用于持久化和展示。
   与更早的、最近一条带有效 `agentSkills` 的用户消息比较，只比较按目录顺序排列的
   `{ name, source, description }`，且只取 `modelInvocable: true` 的项。没有上一份目录视为空。
4. 仅模型可见部分变化时，追加一个独立文本 part 的目录提醒。首次空目录不追加，非空变空时说明现在
   没有可用 skills。名字和描述中的 `<` 转义成字面量 `\u003c`；超长时优先截短最长描述，保留所有名字。
5. 成功时总把解析后的目录写进这条消息的 `metadata.agentSkills`。失败不追加提醒；有上一份目录就复制到
   这条消息，没有就不写该字段。运行继续。写入后用现有 `persist()` 保存，完成保存后再创建 `Chat`。

运行中排队的引导消息不经过这些步骤。`contextPrompt` 增加一行固定说明，所有会话相同。
`initialContextPrompt` 会把系统提示词固定在第一条消息的 `agentContextPrompt` 里，所以这行说明只对
新会话生效，旧会话保持原样，不影响缓存。

## 显式调用

**展开。** 只处理 `drive` 中 SK2 目录步骤处理的用户消息；运行中的引导消息不展开，审批恢复不重写历史。
在本次新目录已知后（目录查询失败时使用复制的上一份目录），对消息自身的第一个文本 part 匹配
`^/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$`。没有目录或匹配不到 `userInvocable` 的条目时保持普通文本，不按名字读取。
参数是名字后第一个空白之后的全部文字，去除两端空白；空字符串表示没有参数。

调用 `skills_read { name, repo? }`，只有仓库作用域才带 `repo`。gateway 返回的 `content` 是完整的
`SKILL.md`；在参数替换前用 `crypto.subtle` 计算十六进制 SHA-256，记录为 `digest`。
如果更早的用户消息已有同名、同 `digest` 的 `agentSkillInvocation`，追加说明用户再次调用、指令已经加载的短提醒。
用户提供新参数时，短提醒也包含 `ARGUMENTS: <参数>`，不重复正文。
否则将所有 `$ARGUMENTS` 替换成参数；没有占位符且有参数时，在正文末尾追加 `\n\nARGUMENTS: <参数>`。

渲染结果放进一个独立文本 part，开头为 `\n\n<system-reminder>`，说明用户通过 `/name` 调用了哪个来源的 skill，
随后是正文、每个附属文件的 `readCommand` 和结束标签。正文中只有开始 `system-reminder` 或
`/system-reminder` 的 `<`（忽略大小写）转义成六个字符 `\u003c`，其余内容保持原样。
同名同摘要的短提醒也保存 `agentSkillInvocation`。该元数据与 SK2 的 `agentSkills` 一次保存。
按名字读取返回 `isError`、抛错或正文解析失败时，运行以错误结束，消息保留，不追加目录或调用提醒。

**输入框目录。** `createAgentRunner` 中的 `skills(scope)` 用 `deps.createTokenSource("ask")`、
`authenticatedFetch(token, controller.signal)` 和短时 MCP client 调用一次 `skills_read { repo? }`。
整个调用与 15 秒超时竞争，包括获取 agent token、MCP 初始化、读取和清理。
用 `gatewaySkillCatalogSchema` 解析并去除内置项；错误向调用方抛出。完成或超时都关闭 client 并释放 token。
超时会关闭 MCP 传输，清理仍在后台完成，不让等待中的 token 请求延长调用；超时后才创建成功的 client 也会关闭。

**输入框。** `ui/skill-menu.tsx` 的 hook 和列表由首页 Lexical `ComposerEditor` 与会话追加 `Textarea` 共用。
只有整个输入匹配 `^/[^\s]*$` 且会话未运行才触发；按全局或 Space ID 在页面存活期间缓存目录，首次打开才查询。失败不显示，并删除该缓存项，下次打开重试；成功结果继续按作用域缓存。
列表仅包含 `userInvocable` 且名字匹配输入前缀的条目，显示 `/name`、来源、单行描述和 `argumentHint`。
只有不带 Shift、Ctrl、Meta 或 Alt 的方向键、Enter、Tab 和 Escape 由菜单处理。
方向键移动，Enter 或 Tab 补全为 `/name `；空格使菜单关闭。Escape 保留文字并关闭，直到输入变化才重新打开。
带修饰键的事件交给原有输入框处理，Shift+Tab 保持焦点移动，Ctrl+J 继续换行。菜单打开时，普通 Enter 只补全，不发送。
Lexical 菜单命令注册为 `COMMAND_PRIORITY_CRITICAL`，高于原有 Enter 发送命令；Textarea 在原有键盘处理前调用菜单处理。
列表使用 `role="listbox"`，由 `useId` 生成唯一 ID；每个选项使用稳定的唯一 ID、`role="option"`、`aria-selected` 和 `tabIndex={-1}`。
两个输入框使用 `role="combobox"`、`aria-expanded` 和 `aria-autocomplete="list"`。打开时，`aria-controls` 指向列表，
`aria-activedescendant` 指向选中选项；关闭时 `aria-expanded="false"`，不保留活动选项。
选中项变化时调用 `scrollIntoView({ block: "nearest" })`。

**门禁。** 目录步骤之后，从最近一条带有效 `agentSkills` 的用户消息取 `modelInvocable: false` 的名字集合，传给 `gateTools`。
排队或引导消息没有目录时继续向前查找，与目录比对使用的上一份目录查找规则一致；审批恢复跳过目录步骤时也如此。
模型以这些名字调用 `skills_read` 且没有 `resource` 时，包括普通读取和 `full` 读取，返回
`{ type: "denied", reason: 'The skill "<name>" can only be invoked by the user with /<name>.' }`。
带 `resource` 的附属文件读取允许通过，供模型按显式调用提醒中的 `readCommand` 使用。其他工具和名字沿用原有 scope 门禁。

## 展示

右侧栏只读会话元数据，不发请求：

- 取最新一条带有效 `agentSkills` 的用户消息。「已使用」来自历史里 `skills_read` dynamic-tool part，
  必须 `state === "output-available"`、结果非错误，且 `input.name` 在当前目录中；也计入用户消息的 `agentSkillInvocation`。两种使用按消息时间的首次使用顺序排在前面，
  其余先仓库后个人，同层按名字排序。
- 默认显示前三条。按钮复用 `agent-steps-window`，展开其余条目和带路径的诊断，可再次收起。
  只有诊断没有隐藏条目时也有展开按钮。无 skills 显示存放路径，`not-member` 显示未加载原因。
- 每项显示名字、来源和已使用标记，悬停显示描述和路径。文案加在 `ui/messages.ts` 的中英两个字典里。
- 用户消息有有效 `agentSkillInvocation` 且文字以对应 `/name` 开头时，该前缀复用 `AgentReferencePill` 的样式显示为标签，剩余文字照常显示。

## 不变量

下列规则每个阶段都要保持，测试按这些规则写：

1. **系统提示词逐字不变。** 有没有 skill、目录是否变化，同一会话的系统提示词都相同。
2. **历史只追加。** 只修改还没发给模型、也没有 `agentSkills` 的那条用户消息。
3. **请求前缀不变。** 第二轮请求体的前缀等于第一轮请求体。
4. **非成员仓库不加载。** `affiliation` 不是 `owner` 或 `member` 时，仓库级 skill 不进目录，也不能按名字读取。
5. **不提权。** skill 内容只是文字。Ask 模式的只读限制、token scope 和发布审批不变。
6. **日志不含内容。** gateway 事件和日志不记录 skill 正文、附属文件内容和原始工具参数，与
   `apps/mcp/AGENTS.md` 的现有规则一致。

## 错误语义

| 情况 | 结果 |
| --- | --- |
| 个人空间不存在 | 用户级为空，无诊断 |
| 仓库不存在或无权访问 | `skills_read` 返回现有的仓库错误。runner 不追加提醒，保留上一份目录；运行继续 |
| 非成员仓库 | `repository: "not-member"`，右侧栏说明原因 |
| `SKILL.md` 校验失败、超限、被隔离 | 跳过，产出诊断 |
| 运行开始时列目录返回 `isError: true`、抛错或 zod 解析失败（含旧 gateway） | 不追加提醒；复制上一份目录到本条用户消息，没有上一份时不写；本次运行继续 |
| `/name` 展开时读取失败 | 本次运行以错误结束，消息保留 |
| 模型读取 `disable-model-invocation` 的 skill 指令（无 `resource`，含 `full`） | 门禁拒绝，模型收到拒绝原因 |
| 模型读取该 skill 的附属文件（带 `resource`） | 允许通过门禁，仍由 gateway 校验读取权限与路径 |
| 模型读取已被删除的 skill | 工具错误，模型按普通工具错误处理 |

## 需要同步更新的文档

实现时，下列文档与代码在同一个 PR 里更新：

- `apps/mcp/README.md`：工具表中的 `skills_read` 一行；「不发 Workspace 请求的工具」列表（`skills_read`
  不再属于这一类）；静态目录、分页和 `full` 上限一节。
- `apps/mcp/AGENTS.md`：快照规则的例外。
- `docs/design/workspace-mcp/tools.zh-CN.md`、`architecture.zh-CN.md`、`stages.zh-CN.md` 中描述
  `skills_read` 的段落。
- `apps/mcp/src/gateway/instructions.ts` 和 `apps/mcp/skills/core/SKILL.md` 对 `skills_read` 的说明，
  按需补一句自定义 skill。
- `.agents/skills/verify-uvw/features/mcp.md`：新增自定义 skill 场景。
- `apps/workspace/docs/architecture.md`：功能落地后，把本文的现状部分移入 Agents 相关章节。

## 测试策略

- **gateway 单测。** 扩展 `apps/mcp/test/reference-tools.test.ts` 的假 Workspace（`fetcher`），参考
  `test/tools.test.ts` 和 `test/space-admin-tools.test.ts` 已有的 `/api/spaces`、`/api/spaces/:id/nodes`、
  `/api/nodes/:id/children` 假接口，加上 Blob 元数据和下载。该文件现在按名字精确断言 `skills` 列表，
  新增字段会改动这些断言。
- **runner 单测。** `runtime/runner.test.ts` 的假 gateway 在 `tools/list` 里只返回一个工具，`tools/call`
  返回固定结果。给 `setup` 增加 `skills` 选项，在 `tools/list` 里加入 `skills_read`，在 `tools/call` 里按
  `rpc.params.name` 分支。用已有的 `modelBodies` 断言系统提示词和请求前缀，用 `methods` 断言调用次数。
- **端到端。** verify-uvw 以 `VERIFY_UVW_MCP=1 VERIFY_UVW_MCP_SAME_ORIGIN=1` 启动，用 `uvw` 在仓库和个人空间
  建 `.agents/skills/<name>/SKILL.md`，浏览器用本地 OpenAI 兼容的 SSE mock provider 驱动会话。使用 `.agents/skills/verify-uvw/bin/mock-provider.mjs` 的确定性脚本与 JSONL 请求日志。
