# Workspace Agents Skill 机制架构

状态：目标架构，未实现。产品语义和决定见 [agent-skills.md](./agent-skills.md)，分期执行见
[agent-skills-plan.md](./agent-skills-plan.md)。本文写给实现者，说明每个模块拥有什么、数据怎么流动、
哪些不变量不能破坏。文中的文件路径和函数名以 2026-11-12 的 `main`（`c05ab2fc`）为准。

## 模块和职责

skill 机制跨两个应用。gateway 拥有发现、校验、合并和读取。浏览器拥有提示词注入、显式调用和展示。
两者之间只有一个接口，即 MCP 工具 `skills_read`。

| 模块 | 位置 | 拥有 | 不拥有 |
| --- | --- | --- | --- |
| skill 目录加载 | `apps/mcp/src/gateway/`（新文件，如 `custom-skills.ts`） | 在个人空间和作用域仓库里找 `.agents/skills`，校验 `SKILL.md`，合并，产出诊断，读取文本附属文件 | 内置 skill 的静态快照（仍由 `skill-catalog.ts` 负责） |
| `skills_read` | `apps/mcp/src/gateway/tools/core/skills-read.ts` | 输入解析，三层名字解析，分页，`ToolResult.repo` 归属 | 模型何时调用 |
| runner | `apps/workspace/web/src/features/agents/runtime/runner.ts` | 每次运行开始时比对目录、追加提醒、展开 `/name`、写会话元数据，以及给输入框用的 `skills(scope)` | skill 内容本身 |
| 工具门禁 | `runtime/approvals.ts` 的 `gateTools` | 拒绝模型读取 `disable-model-invocation` 的 skill | 权限和 token scope |
| 输入框菜单 | `ui/composer.tsx`、`ui/composer-editor.tsx`、`ui/session-page.tsx` 的追加输入框 | `/` 菜单、过滤、键盘选择 | 解析和展开（在 runner） |
| 右侧栏和消息标签 | `ui/session-page.tsx`、`ui/messages.ts`、`ui/agents.css` | 从会话元数据渲染 skill 列表、诊断和 `/name` 标签 | 数据获取（右侧栏不发请求） |

不新增数据库表、HTTP 接口或 schema 版本。用户级 skill 存在个人空间的普通 Blob 里，读取走已有的
产品 HTTP 接口。

## 数据形状

gateway 输出和浏览器持久化共用下列形状。浏览器侧用 zod 在边界解析 `skills_read` 的
`structuredContent`，内部只传解析后的类型。

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

会话里新增两个消息元数据字段，都写在用户消息的 `metadata` 上，与已有的 `agentContextPrompt`、
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
4. **读 `SKILL.md`。** 每个子目录取名为 `SKILL.md` 的 Blob。先用 `WorkspaceBlobFeature.get` 检查
   `byteSize`，超过 64 KiB 记 `too-large`。再用 `downloadStream` 读取，按 `readHtmlViewPage`
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

1. 找到最后一条用户消息。它已有 `metadata.agentSkills` 时跳过全部步骤。审批恢复、重试和中断修复会再次
   进入 `drive`，这条规则保证已发给模型的消息不会被改写。
2. 调用 `client.callTool({ name: "skills_read", arguments: { repo? } })`。作用域是全局时不带 `repo`。
   调用失败时记录为空目录，不阻塞本次运行。旧 gateway 不认识 `repo` 时同样按空目录处理。
3. 过滤掉 `builtin`，得到本次目录。与上一条带 `agentSkills` 的用户消息比较，只比较模型可见的部分
   （`modelInvocable` 为 true 的名字、来源和描述）。
4. 第一次处理，或模型可见部分有变化时，在这条消息末尾追加目录提醒。提醒的格式见设计文档。
5. 如果消息文本以 `/name` 开头，并且 `name` 匹配目录中 `userInvocable` 的 skill，执行显式调用展开，
   见下一节。
6. 把目录写进 `metadata.agentSkills`，保存会话，然后创建 `Chat`。

运行中排队的引导消息不经过这些步骤。`contextPrompt` 增加一行固定说明，所有会话相同。
`initialContextPrompt` 会把系统提示词固定在第一条消息的 `agentContextPrompt` 里，所以这行说明只对
新会话生效，旧会话保持原样，不影响缓存。

## 显式调用

**展开。** 第 5 步调用 `skills_read { name, repo }`，对正文计算 `digest`。如果之前已有同名、
同 `digest` 的 `agentSkillInvocation`，只追加一句「该 skill 已加载」。否则做参数替换：`$ARGUMENTS`
换成 `/name` 之后的全部文字；正文没有 `$ARGUMENTS` 而用户写了参数时，在末尾追加 `ARGUMENTS: <参数>`。
渲染结果连同附属文件的读取指令，放进这条消息末尾的 `<system-reminder>`。读取失败时本次运行以错误结束，
错误进入会话，消息保留。

**输入框目录。** runner 新增 `skills(scope)`。它仿照 `drive` 里发布审批的短时 client，用
`deps.createTokenSource("ask")` 取只读 token，创建 client 调用 `skills_read` 后关闭。输入框按作用域缓存结果，
打开菜单时请求。

**输入框。** 首页的 `ComposerEditor` 是 Lexical，Enter 默认换行，Shift、Ctrl 或 Meta 加 Enter 发送
（`KEY_ENTER_COMMAND`）。菜单打开时，方向键、Enter、Tab 和 Esc 必须以高于 `COMMAND_PRIORITY_HIGH`
的优先级注册，或者在菜单打开期间绕过现有处理。会话页的追加输入框是普通 `Textarea`，在
`onKeyDown` 里处理。两处共用一个菜单组件，触发条件只是「文本以 `/` 开头且会话没有在运行」，不需要光标定位。

**门禁。** `gateTools` 增加一个参数：本次目录中 `modelInvocable` 为 false 的名字集合。模型以这些名字调用
`skills_read` 时，按名字和输入返回 `{ type: "denied", reason }`。现有门禁按工具的
`_meta["univer.workspace/scope"]` 判断，按名字判断是新增的一类规则。

## 展示

右侧栏和消息标签只读会话元数据，不发请求：

- 右侧栏取最后一条用户消息的 `agentSkills`。「已使用」来自两处：历史里模型的 `skills_read` 工具调用，
  以及各条消息的 `agentSkillInvocation`。
- 消息标签在 `session-page.tsx` 的用户消息气泡里渲染，仿照 `messageReferences` 和
  `AgentReferencePill`：在 `agent.types.ts` 增加一个 zod 解析函数读取 `agentSkillInvocation`。
- 文案加在 `ui/messages.ts` 的中英两个字典里。

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
| 仓库不存在或无权访问 | `skills_read` 返回现有的仓库错误。runner 按空目录处理 |
| 非成员仓库 | `repository: "not-member"`，右侧栏说明原因 |
| `SKILL.md` 校验失败、超限、被隔离 | 跳过，产出诊断 |
| 运行开始时列目录失败 | 空目录，本次运行继续 |
| `/name` 展开时读取失败 | 本次运行以错误结束，消息保留 |
| 模型读取 `disable-model-invocation` 的 skill | 门禁拒绝，模型收到拒绝原因 |
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
  建 `.agents/skills/<name>/SKILL.md`，浏览器用本地 OpenAI 兼容的 SSE mock provider 驱动会话。仓库里没有
  可复用的 mock provider 脚本，执行计划的第二阶段会补一个。
