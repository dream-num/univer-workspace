# Workspace Agents 的 Skill 机制（初期设计）

状态：SK1 至 SK3 已实现 gateway 发现、目录提醒与右侧栏、`/name` 显式调用。2026-11-12 确认了「已确认的决定」中的 6 项。范围是浏览器 Workspace Agents
（`apps/workspace/web/src/features/agents`）和它依赖的 MCP gateway（`apps/mcp`）。

## 目标

用户和仓库维护者可以用一个 `SKILL.md` 教 agent 一种做法，比如「按我们团队的格式写周报」
「这个仓库的财务表怎么对账」。agent 平时只看到每个 skill 的名字和一句描述，任务匹配时才读正文。
skill 的格式和加载方式跟随 [Agent Skills 规范](https://agentskills.io/specification)，
同一个 skill 目录拿到 Claude Code、Codex、OpenCode 里也能直接用，反过来也一样。

初期只做最小闭环：

1. 自定义 skill，以 `SKILL.md` 为入口。目录里的文本文件（`references/`、`assets/` 等）可以按需读取，
   见「附属文件」。
2. agent 一开始只拿到目录（名字和描述），任务匹配时再读取正文，正文提到附属文件时再读附属文件。
3. 会话作用域是某个仓库时，从该仓库根目录的 `.agents/skills` 加载 skill。
4. 用户级 skill 对该用户的所有会话生效。仓库级和用户级同名时，仓库级生效。
5. 会话页右侧 **会话** 栏显示本会话的 skill，默认显示前三条，其余折叠。
6. 用户在输入框开头输入 `/` 选择 skill 直接调用，形态和语义对齐 Claude Code。

## 主流做法速览

下表只列和本设计相关的结论。来源见文末，均为 2026-11-12 读取的官方文档。

| 维度 | 主流做法 | 本设计 |
| --- | --- | --- |
| 目录结构 | `<name>/SKILL.md`，可选 `scripts/`、`references/`、`assets/` | 保留目录结构，文本附属文件可读 |
| 必填字段 | `name`（1-64，小写字母数字和连字符，与目录同名）、`description`（1-1024） | 同规范 |
| 项目级位置 | `.agents/skills` 已是通用约定（Codex、OpenCode、Gemini CLI、Cursor、VS Code 都读） | 仓库根目录 `.agents/skills` |
| 用户级位置 | `~/.agents/skills` 等用户目录。规范指出云端 agent 的用户级 skill 需要另行提供（API、上传界面等） | 个人空间根目录 `.agents/skills` |
| 同名冲突 | 规范、Gemini CLI 是项目级优先。Claude Code 相反，个人级优先。Codex 两个都显示 | 仓库级优先，被覆盖的显示出来 |
| 目录注入 | 系统提示词或激活工具的描述里放名字和描述，每个约 50-100 token | 追加在用户消息里的 `<system-reminder>`，原因见下文 |
| 目录预算 | Claude Code 占上下文 1%，每条至多 1536 字符。Codex 占 2% 或 8000 字符。超出时先截短描述 | 总长 8000 字符，超出时截短描述，保留名字 |
| 激活 | 专用工具（Claude Code `Skill`、OpenCode `skill`、Gemini `activate_skill`），或模型用读文件工具读路径（Codex） | 复用已有的 `skills_read` 工具 |
| 用户显式调用 | 几乎都有：`/name`（Claude Code、Cursor、VS Code）、`$name`（Codex）、`@id`（OpenCode） | 对齐 Claude Code 的 `/name`，见「用户显式调用」 |
| 校验失败 | 规范要求 `name` 与目录同名。规范的实现指南建议宽松处理，名字和目录不一致只警告 | 按规范严格校验，复用 MCP SDK 的 `skillEntry`，与内置 skill 同一套规则。不合格的跳过并展示诊断 |
| 信任 | 规范建议对项目级 skill 做信任检查，因为克隆来的仓库可以借 skill 注入指令 | 只加载用户有角色的仓库的 skill |

## AI SDK 能提供什么

浏览器 agent 用 `ai@7.0.166` 的 `ToolLoopAgent` 驱动，用 `@ai-sdk/mcp@2.0.93` 连接 gateway
（版本见 `apps/workspace/package.json`）。下表依据该版本安装包里的类型声明和随包文档。
AI SDK 中与 skill 相关的能力有四处，都不能替代本设计：

| AI SDK 能力 | 是什么 | 对本设计 |
| --- | --- | --- |
| `ToolLoopAgent` | 正在使用的 agent。`ToolLoopAgentSettings` 只有 `instructions`、`tools`、`prepareCall`、`prepareStep` 等，没有 skill 字段 | 发现、目录、激活都要自己做 |
| `HarnessAgent`（`@ai-sdk/harness`，实验性） | 把 Claude Code、Codex、OpenCode 等完整 agent 运行时接进 AI SDK。`skills: [{name, description, content, files: [{path, content}]}]` 交给底层运行时处理，`files` 是 skill 内相对路径的文本文件。两轮之间可以用 `prepareCall` 替换 skill。必须配沙箱，会话历史由运行时持有 | 浏览器用不了：没有沙箱，提示缓存要求我们自己掌握历史，模型也走 DeepSeek 等 provider。它的 skill 形状与本设计一致，见下 |
| `uploadSkill` | 把 skill 包上传到 Anthropic 或 OpenAI 的 skills API，在 provider 托管的代码执行容器里使用 | 只对这两家 provider 有效。Workspace 用户主要用 DeepSeek 和 OpenAI 兼容接口，不采用 |
| `@ai-sdk/mcp` | MCP 客户端，有通用的 `listResources`、`readResource`。类型声明里没有 MCP Skills 扩展 | 现在已经用 `readResource` 读 `core` skill。自定义 skill 走 `skills_read` 工具，不依赖这个扩展 |

结论有两条。第一，AI SDK 没有给 `ToolLoopAgent` 提供 skill 加载器，gateway、提醒和 `skills_read`
这套仍然要自己做。第二，`HarnessAgent` 的 skill 形状只有「正文加文本文件」，和本设计的附属文件范围一样。
gateway 返回的一个 skill 可以直接映射成 `{name, description, content, files}`。以后 Node 宿主想执行
`scripts/`，可以用 `HarnessAgent` 加沙箱，把 skill 原样交给底层运行时。底层运行时会执行 `files` 里的脚本，
这一点是推断，文档没有写明。`HarnessAgent` 标注实验性，版本之间可能有破坏性变化。

## 对需求表述的几处勘误

**skill 是一个目录，不是一个 `.md` 文件。** 规范要求 `name` 必须等于目录名，所以路径是
`.agents/skills/<name>/SKILL.md`。原需求的「仅单文件」经评估可以放宽到「文本附属文件可读」，
理由和边界见「附属文件」。

**是 frontmatter，不是 formatter。** frontmatter 指 `SKILL.md` 开头 `---` 之间的 YAML。

**目录不放进系统提示词。** 规范允许放在系统提示词里，但本仓库有两条约束：

- 根 `AGENTS.md` 的「Workspace Agents 提示缓存」要求一次会话内系统提示词逐字不变。
- 会话作用域可以在两轮之间切换（`runtime/runner.ts` 的 `launch` 会覆盖 `session.scope`），
  仓库级 skill 也可能被人随时修改。

所以系统提示词只加一行固定说明，告诉模型 skill 是什么、怎么读。会变的目录放在用户消息末尾的
`<system-reminder>` 里，沿用 mode 和 scope 变更已经在走的通道（`settingsReminder`）。
本会话里我观察到 Claude Code 自己也把 skill 清单放在对话中的 `<system-reminder>` 里，而不是系统提示词，
这是同一种取舍。这一条是对当前会话的观察，Claude Code 文档没有写明清单的标记格式。

**「仓库根目录」在 Workspace 里是 Space 根节点。** 有两点和本地 git 仓库不同：

- `SKILL.md` 是 Blob，而 Blob 第一版不进入 Worktree（`data-model.md`）。所以 skill 永远读 trunk，
  修改即时生效，不经过 PR 评审。
- 全局作用域的会话没有仓库，只加载用户级 skill。用户之后切换到某个仓库时，仓库级 skill 从下一轮开始可用。

**「正在生效」需要分成两种状态。** 「可用」指 skill 已在目录里，模型知道它存在。「已使用」指本会话
已读取过它的正文。右侧栏两者都显示，已使用的排在前面并加标记。只显示「可用」的话，用户分不清 agent
到底有没有按 skill 做事。

**还有第三层，内置 skill。** gateway 已经通过 MCP Skills 扩展提供一组内置 skill（`core`、`sheet`、
`doc` 等，见 `apps/mcp/src/gateway/skill-catalog.ts`），`core` 的正文直接拼进了系统提示词。
自定义 skill 不能与它们同名，否则会覆盖产品自身的工作流说明。

## 数据形状

先定数据，再谈流程。gateway 和浏览器共用同一个形状：

```ts
type SkillSource = "repository" | "user";

interface SkillEntry {
	name: string;          // frontmatter name，目录内唯一键
	description: string;   // 至多 1024 字符
	source: SkillSource;
	path: string;          // 如 ".agents/skills/weekly-report/SKILL.md"，用于界面展示
	modelInvocable: boolean; // frontmatter disable-model-invocation 取反，默认 true
	userInvocable: boolean;  // frontmatter user-invocable，默认 true
	argumentHint?: string;   // frontmatter argument-hint，显示在 / 菜单里
}

type SkillProblem =
	| "invalid-skill"         // skillEntry 校验失败（YAML、name、description、name 与目录名不一致），跳过
	| "reserved-name"         // 与内置 skill 同名，跳过
	| "shadowed"              // 用户级被同名仓库级覆盖
	| "too-large";            // 超过大小上限，跳过

interface SkillDiagnostic { source: SkillSource; path: string; problem: SkillProblem; detail?: string }

type RepositorySkills = "loaded" | "not-member" | "no-repository";

interface SkillCatalog {
	skills: SkillEntry[];
	diagnostics: SkillDiagnostic[];
	repository: RepositorySkills; // 右侧栏据此显示「未加载：你不是该仓库成员」
}

// 只在读取某个 skill 时生成，不进入目录
type SkillFile =
	| { path: string; kind: "text"; byteSize: number }                    // 可用 resource 读取
	| { path: string; kind: "binary"; byteSize: number; mediaType: string }; // 只列出，不返回内容
```

合并规则只有一个 `Map<name, SkillEntry>`：先排除内置名字，再放用户级，最后放仓库级覆盖同名项，
并为被覆盖的用户级记一条 `shadowed`。不需要额外的优先级配置。

## 存放位置

| 层级 | 位置 | 理由 |
| --- | --- | --- |
| 仓库级 | 作用域仓库的根目录 `.agents/skills/<name>/SKILL.md` | 与 Codex、Cursor 等的约定一致，本仓库自己的 `.agents/skills` 也是这个结构 |
| 用户级 | 用户个人空间（`<username>/personal`）的根目录 `.agents/skills/<name>/SKILL.md` | 见下 |

用户级放在个人空间，比较过的另外两种做法：

- **浏览器 IndexedDB。** 换设备就没了，CLI 和外部 MCP 客户端也读不到。还要升级 `database.ts`
  的数据库版本。
- **新增产品数据库表。** 要改 schema、做迁移矩阵，还要做一套编辑界面。初期不值得。

个人空间是普通 Space，只有本人能访问，已有文件树、Markdown 上传和 GFM 预览，不改 schema。
用户还没有个人空间时，用户级目录为空。会话作用域正好是自己的个人空间时，只按仓库级加载一次。

已知代价：在界面上建 `.agents/skills/<name>/` 要连建三层目录。`nodes.service.ts` 的 `validName`
只限制长度，不过滤点开头的名字，但上传链路没有端到端核实过。初期接受这个代价，下一步可以加一个
「新建 skill」入口。

## 加载流程

### 发现和读取由 gateway 负责

浏览器 agent 的工具全部来自 MCP gateway。浏览器端没有本地工具机制，gateway 的 core 工具集里也没有
读取任意 Blob 正文的工具。所以发现和读取都放在 gateway，扩展已有的 `skills_read`：

- 输入增加可选的 `repo`（Space ID 或名字，与其他工具一致）。
- 不带 `name` 时返回合并后的目录。每项增加 `source` 字段（`builtin`、`repository`、`user`），
  另带 `diagnostics`。
- 带 `name` 时按「内置、仓库级、用户级」的顺序解析，返回 `SKILL.md` 全文和附属文件清单。
  长内容沿用现有的 `cursor` 分页。
- 带 `name` 和 `resource` 时返回一个文本附属文件，`full` 的语义与内置 skill 相同。

gateway 读取的步骤：用 token 解析当前用户，找到个人空间和作用域仓库，在根目录逐层找 `.agents`、
`skills`，列出子目录，读每个子目录下名为 `SKILL.md` 的 Blob，解析 frontmatter。
每层最多扫描 100 个 skill 目录，`SKILL.md` 上限 64 KiB。

这样做还有一个附带收益：用 Workspace MCP 的外部客户端（Claude Code、opencode 等）通过同一个工具也能
读到仓库级 skill。工具定义只在 gateway 发版时变化，不影响一次会话内工具列表不变的要求。

### 浏览器在每次运行开始时比对目录

MCP client 只在 `runner.ts` 的 `drive` 里创建，`launch` 拿不到。所以比对放在 `drive` 里，
在 `client.tools()` 之后、创建 `Chat` 之前执行。只处理还没发给模型、也没有 `metadata.agentSkills`
的那条用户消息。审批恢复、重试等再次进入 `drive` 的情况会跳过，不会给已发出的消息追加内容。
运行中排队的引导消息（steering）不刷新目录。步骤如下：

1. 在模型循环外调用一次 `skills_read`（作用域是仓库时带 `repo`），过滤掉 `builtin` 和
   `modelInvocable` 为 false 的项。
   这和现在读取 `core` skill 资源的方式相同。
2. 和历史里最后一次下发的目录比较。上一份目录存在用户消息的 `metadata.agentSkills` 里，
   与 `agentContextPrompt` 并列。
3. 第一轮，或者目录有变化（作用域切换、有人增删改了 skill）时，在这条用户消息末尾追加一个
   `<system-reminder>`，写入完整的新目录，并声明它替换之前的清单。没有变化就不追加。
4. 把这份目录写进这条消息的 `metadata.agentSkills`。

开始、切换仓库、skill 被修改这三种情况走同一条路径，不需要分别处理。历史只追加，系统提示词不动，
满足提示缓存约束。一次运行之内（最多 50 步）不刷新。

系统提示词里新增的固定说明放在 `contextPrompt`，所有会话都相同，大致如下：

```text
Skills are instructions written by the user or the repository. When a <system-reminder> lists skills and a task matches one, call skills_read with that name before you act, then follow it. A later list replaces earlier ones.
```

目录提醒的格式如下。名字和描述是用户数据，按 `referencesReminder` 的做法转义 `<`：

```text
<system-reminder>
Skills available in this session. This list replaces any earlier one.
Read a skill with skills_read {"name": "<name>", "repo": "<spaceId>"} before using it.
- weekly-report (user): Write the weekly report in the team format. Use when asked for a weekly summary.
- reconcile-ledger (repository): Reconcile the ledger sheet against bank exports.
</system-reminder>
```

目录总长超过 8000 字符时，从最长的描述开始截短，名字全部保留，这与 Claude Code 和 Codex 的降级方式相同。

### 激活

模型调用 `skills_read {name, repo}`，拿到正文后照做。模型读到的是当前 trunk 上的内容。如果 skill
在目录下发之后被删除，工具会返回错误，模型按普通工具错误处理。

`disable-model-invocation: true` 的 skill 不进目录提醒。模型如果仍然用这个名字调用 `skills_read` 且没有 `resource`，
浏览器在 `gateTools` 这一层拒绝，包括普通读取和 `full` 读取。带 `resource` 的附属文件读取允许通过，
供模型按用户显式调用提醒中的读取指令使用。这条限制只在浏览器端执行，
外部 MCP 客户端有自己的 skill 机制，gateway 不区分调用者。

「已使用」从历史推导，不新增状态。来源有两个：模型的 `skills_read` 调用，以及用户的 `/` 调用。

## 用户显式调用

形态和语义对齐 Claude Code。下文引用的 Claude Code 行为均出自它的 Skills 文档。

### 输入框

- 只在消息开头生效。输入框内容以 `/` 开头时弹出 skill 菜单，后续字符用来过滤。消息中间出现的
  `/name` 不触发。Claude Code 会把中间的 `/name` 当作「允许模型使用」，初期不做这个区分。
- 菜单列出 `userInvocable` 为 true 的自定义 skill。每项显示 `/name`、来源标签（**仓库**、**个人**）、
  单行描述和 `argument-hint`。Claude Code 文档没有写明菜单是否显示描述。显示描述对不熟悉 skill 的
  用户更友好，所以这里显示。
- 方向键选择，Enter 或 Tab 补全为 `/name `，Esc 关闭。补全后用户继续输入参数。
- 菜单的数据来自 runner 新增的 `skills(scope)`。它创建一个短时 MCP client 调用 `skills_read`，
  按当前作用域（全局，或某个仓库）缓存，打开菜单时请求。首页输入框（Lexical）和会话页的追加输入框
  （普通 `Textarea`）都接入同一个菜单。
- 会话正在运行时不弹出菜单。运行中输入的内容会作为引导消息排队，按普通文本处理。
- 内置 skill 不进菜单。它们教的是工具用法，模型已经能读到，用户直接调用的意义不大。
- 初期一条消息只调用一个 skill。Claude Code 在终端里允许连写多个，在 Agent SDK 和 `claude -p`
  里只加载第一个。

### 发送后

1. 用户消息的文本保持原样（`/name 参数`），会话里和标题里都能看到用户调用了什么。发送接口不变。
2. `drive` 在比对目录的同一步解析消息开头的 `/name`，对照本次目录中 `userInvocable` 的 skill，
   再调用 `skills_read {name, repo}` 取正文和附属文件清单。
3. 正文中的 `$ARGUMENTS` 替换为 `/name` 之后的全部文字。正文里没有 `$ARGUMENTS` 且用户写了参数时，
   在正文末尾追加 `ARGUMENTS: <参数>`。这两条与 Claude Code 相同。`$0`、`$1` 这类按位置的占位符初期不做。
4. 把渲染后的正文放进这条用户消息末尾的 `<system-reminder>`，说明这是用户调用的 skill，本次请求按它执行，
   并附上附属文件的读取指令。模型不需要再调一次工具。Claude Code 也是直接展开，不经过模型的 `Skill` 工具。
5. 在消息 `metadata.agentSkillInvocation` 里记录 `{name, source, digest}`。界面用它把消息开头的 `/name`
   渲染成标签，右侧栏用它标记「已使用」。

正文随历史保留，后续轮次不重新读取，与 Claude Code 一致。同一会话里再次调用同一个 skill 时，
如果 `digest` 没变，追加「该 skill 已加载」的短提醒；用户提供参数时也包含 `ARGUMENTS: <参数>`，不重复正文。内容变了就追加新的全文。
这两条同样对齐 Claude Code。

开头是 `/` 但不匹配任何 skill 时，按普通文本发送，因为用户可能就是在写一个路径。读取失败
（例如 skill 刚被删除）时，本次运行以错误结束，错误显示在会话里，用户消息保留，用户可以重发。
消息在 `launch` 时已经保存，而读取发生在 `drive`，所以不做「不发送」。

### 两个 frontmatter 开关

| 字段 | 默认 | 效果 |
| --- | --- | --- |
| `disable-model-invocation: true` | false | 不进模型目录，只能用 `/` 调用 |
| `user-invocable: false` | true | 不进 `/` 菜单，只能由模型调用 |

语义照搬 Claude Code。两者都是 Claude Code 和 VS Code 已有的字段，不是我们自造的扩展。

## 附属文件

结论：文本类附属文件初期就支持，增量成本小。浏览器端 `scripts/` 只当文本读取，非 Web 客户端可以执行。二进制文件只列出，不返回内容。
目录结构照规范写，三类子目录在机制上不区分，按文件内容分成「文本」和「二进制」两类处理。

### 为什么文本文件成本小

内置 skill 已经在生产环境用同一个接口提供附属文件：`html-view` 带 10 个 `templates/*.univer.html`，
`board` 带 10 篇 `references/`，模型通过 `skills_read {name, resource}` 按需读取，长内容分页。
自定义 skill 只是换了数据来源，下列能力都已存在：

| 需要的能力 | 现有实现 |
| --- | --- |
| 读取 Blob 字节 | client-core `WorkspaceBlobFeature.downloadStream`（`packages/client-core/src/blob.ts`） |
| 递归列出 skill 目录 | `space_browse` 的 `recursive` 选项背后的 client-core 调用，返回每个 Node 的 `path` |
| 附属文件清单和读取指令 | `skills_read` 已返回 `resources: [{path, readCommand}]` |
| 防止越界读取 | `skills_read` 只接受清单里出现过的 `resource`，不拼接路径 |
| 长文本分页、`full` 的总量检查 | `pageText` 和 `RESULT_LIMIT`（100,000 字符） |

需要新写的部分：以 `SKILL.md` 所在目录为根计算相对路径，判断文本还是二进制，以及几条上限。
预计 gateway 侧只多几十行代码，外加对应单测。目录发现阶段不展开 skill 子目录，
只有模型读取某个 skill 时才递归列出它的文件，所以目录的成本不变。

### 规则

- **文本判定。** 用 `TextDecoder("utf-8", { fatal: true })` 解码，成功且不含 NUL 字节就是文本。
  不依赖上传时记录的 `media_type`，因为 `.md`、`.js`、`.univer.html` 上传后的类型不一定可靠。
- **上限。** 每个 skill 最多列 100 个文件，单个文本文件 256 KiB，超出的文件标记为不可读。
  深度不限制，规范只是建议引用保持一层。
- **二进制文件。** 在清单里给出路径、大小和类型，不返回内容。

### 浏览器端 `scripts/` 为什么只当文本

主流的 `scripts/` 指在 shell 或沙箱里执行、只把输出放进上下文的代码。Claude 平台在代码执行容器里运行，
Claude Code 在本机 bash 里运行。浏览器 agent 没有 shell，也没有沙箱。它唯一能执行代码的工具是 `execute`，
输入是 `{worktree, unit, code}`，在 PR 的草稿 Worktree 里对某个 Unit 运行 Univer Facade 代码。

所以初期的 `scripts/` 就是可读的文本。如果写的是 Facade 代码，模型可以读出来作为 `code` 传给
`execute`，不需要新机制。代价是模型要把整段脚本抄进工具参数：token 翻倍，长脚本还可能抄错。
Python、bash 脚本无法运行。这不是实现难度问题，而是缺少运行时。

以后的演进方向：`execute` 增加一个 skill 脚本引用参数（如 `script: {skill, path}`），由 gateway 在服务端
取出代码执行，模型不用抄写。通用脚本要等 Workspace 有沙箱运行时之后再考虑。

### 二进制 `assets/` 为什么只列出

`.xlsx` 模板、图片、字体对模型来说只有在工具能使用时才有意义。现在 `import` 只接受 `upload_id`，
上传要先用 `file_upload_create` 拿到地址，再向它 PUT 字节。浏览器 agent 不能自己发 HTTP 请求，
所以拿不到这些字节。

要支持它，需要一个从仓库 Blob 直接导入的能力，比如 `import` 接受 `resource`。这在 skill 之外也有用
（「把仓库里这个 xlsx 导入成表格」），应该作为独立需求做，不放进 skill 初期范围。文本模板不受影响，
比如 `.univer.html` 可以读出来交给 `html_view_create`，内置 `html-view` skill 现在就是这样用的。

### 非 Web 客户端可以执行 `scripts/`

gateway 对所有客户端返回同样的内容，`scripts/` 里的文本文件也照常返回。执不执行由客户端的能力决定，
gateway 不关心：

- **浏览器 agent。** 只能读，原因见上。
- **外部 MCP 客户端和 CLI 场景的 agent。** 比如连接 Workspace MCP 的 Claude Code、opencode，自带 shell，
  可以把 skill 文件写到本地目录后执行。
- **Node 宿主。** 可以用 AI SDK 的 `HarnessAgent` 加沙箱，把 skill 原样交给底层运行时，
  见「AI SDK 能提供什么」。

初期只保证 gateway 返回完整的文本文件，不为非 Web 客户端提供额外工具。以后可以做两件事：
用 `uvw skills pull` 把仓库或个人空间里的 skill 落成本地目录；以及在文件清单里给二进制文件附上
短时下载链接，做法与 `blob_download` 相同。

### 作者体验

在 Workspace 界面里建多层目录比在本地麻烦。附属文件是可选的，只写一个 `SKILL.md` 仍然是完整的 skill。
之后做「新建 skill」入口时，可以一并考虑上传整个 skill 目录。

## 信任边界

仓库级 skill 是仓库写入者对 agent 下的指令，权重比普通文件内容高。用户把 agent 指向别人的公开仓库时，
那个仓库的 skill 就成了注入入口。规范的实现指南也建议对项目级 skill 做信任检查。

初期规则：只有用户在作用域仓库中有角色时，才加载该仓库的 skill。没有角色时目录为空，右侧栏显示
「未加载：你不是该仓库成员」。我还没核实「是否有角色」能否从 gateway 直接取到，`repo_view`
的返回值可能已经包含，实现前要确认。

Ask 模式的只读限制、写入的 token scope 和 `gateTools` 审批都不变。skill 只是文字，不能提升权限。

## 右侧「会话」栏

在 `session-page.tsx` 的 `agent-session-rail` 里，在 **Pull requests** 之前新增一个 **Skills** 小节：

- 数据来自最新一条用户消息的 `metadata.agentSkills`，不新增会话字段。这份目录在发送时也包含
  `modelInvocable` 为 false 的项，只是它们不进模型提醒，这样只能显式调用的 skill 也会显示。
- 排序：已使用的在前，按首次使用的时间排。使用包括模型读取和用户 `/` 调用。其余先仓库级再用户级，
  同层按名字排。
- 每项显示名字和来源标签（**仓库**、**个人**），悬停显示描述和路径，已使用的加标记。
- 默认显示前三条，其余折叠成「显示其余 N 个」，展开后可收起。复用 `AgentStepsGroup` 的
  `agent-steps-window` 样式和文案模式。
- 展开区底部列出诊断：被覆盖、无效、与内置同名、超出大小，并给出路径。这样用户才知道自己写的 skill
  为什么没出现。
- 没有任何 skill 时显示一行说明，告诉用户在哪里放 `.agents/skills`。

## 初期不做

以下能力主流 harness 有，但初期不做。数据形状和工具接口已为它们留了位置：

- 执行 `scripts/`、使用二进制 `assets/`。原因和演进方向见「附属文件」。
- `allowed-tools`、`context: fork`、`model`、`paths` 等扩展字段。初期解析时忽略未知字段，不报错，
  与 Claude Code 一致。
- 子目录里的嵌套 `.agents/skills` 和向上逐级查找。Workspace agent 没有「当前目录」概念，只读根目录。
- 逐个启用、禁用的开关，以及从市场安装。
- 一次运行之内的热更新。目录在每次运行开始时刷新已经够用。
- 浏览器端缓存目录。每次运行一次 `skills_read`，第一版先不优化。如果 skill 多到请求变慢再加 ETag 缓存。

## 已确认的决定

2026-11-12 确认：

1. **用户显式调用纳入初期**，形态和语义对齐 Claude Code，见「用户显式调用」。
2. **用户级 skill 放在个人空间**，取舍见「存放位置」。
3. **仓库级覆盖用户级。** 这与规范一致，与 Claude Code 相反。成员检查加上右侧栏的 `shadowed` 诊断，
   能抵消仓库替换用户 skill 的风险。
4. **内置名字保留。** 与内置 skill 同名的自定义 skill 一律跳过并报诊断。
5. **非成员仓库不加载 skill。**
6. **初期支持文本附属文件。** 浏览器端 `scripts/` 只当文本，非 Web 客户端可以自行执行。二进制只列出。
   从 Blob 直接导入作为独立需求。

## 实施拆分

架构见 [agent-skills-architecture.md](./agent-skills-architecture.md)，分期执行计划见
[agent-skills-plan.md](./agent-skills-plan.md)。

## 参考来源

- Agent Skills 规范：<https://agentskills.io/specification>
- Agent Skills 客户端实现指南：<https://agentskills.io/client-implementation/adding-skills-support.md>
- Claude Code Skills：<https://code.claude.com/docs/en/skills>
- Claude 平台 Agent Skills 概览：<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
- OpenAI Codex Skills：<https://developers.openai.com/codex/skills>
- OpenCode Skills：<https://opencode.ai/docs/skills>
- Gemini CLI Skills：<https://geminicli.com/docs/cli/skills/>
- Cursor Skills：<https://cursor.com/docs/context/skills>
- VS Code Agent Skills：<https://code.visualstudio.com/docs/copilot/customization/agent-skills>
- AI SDK：`ai@7.0.166` 安装包内的 `docs/03-ai-sdk-harnesses/04-skills.mdx`、`01-overview.mdx`、
  `05-harness-adapters.mdx`、`docs/03-ai-sdk-core/41-skill-uploads.mdx` 和 `dist/index.d.ts`；
  `@ai-sdk/mcp@2.0.93` 的 `dist/index.d.ts`
