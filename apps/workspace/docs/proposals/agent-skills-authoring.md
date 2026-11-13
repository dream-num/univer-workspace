# Workspace Agents 的 Skill 创作与导入（设计）

状态：设计稿，2026-11-13。尚未实现。建立在 [agent-skills.md](./agent-skills.md) 的 SK1 至 SK3 之上。
范围包括三处：MCP gateway（`apps/mcp`）、Workspace Server 与 Browser（`apps/workspace`），以及浏览器
Workspace Agents（`apps/workspace/web/src/features/agents`）。

## 目标

现在用户想要一个 skill，只能在本地手写 `SKILL.md`，在文件树里连建三层目录再上传。修改要下载、编辑、
重新上传。大多数用户到这一步就放弃了。

本设计让用户用对话完成创作、修改和导入：

```text
/skill-creator 把我们每周对账的流程做成一个 skill，参考这个仓库里的「银行流水」表
/skill-creator 把 weekly-report 改成按部门分组
/skill-creator 导入 https://skills.sh/anthropics/skills/pdf 到我的个人空间
```

`skill-creator` 是 Workspace 的第一个、也是全局的内置 skill。它改写自 Anthropic 的
[skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)，并针对 Workspace 做了特化。
它运行在用户已经在用的 Workspace Agent 里，所以能直接读仓库里的表、文档和已有 skill，用的也是用户已配置的模型。
agent 写好的 skill 先存成草稿。用户在草稿页看到文件、扫描结果和 agent 的审查意见，点 **发布** 后 skill 才生效。
流程与 HTML View 的草稿和发布相同。

### 设计取向

能力放在 skill 和工具里，界面只留人必须亲手做的那一步：

- **对话负责创作。** 访谈、起草、试用、修改、导入、兼容性审查都由 agent 按 `skill-creator` 完成。
  不做 skill 编辑器、导入向导和 Studio 页面。
- **工具负责确定性的事。** 抓取外部来源、静态扫描、校验证据、写入 Space，这些由服务端完成，不交给模型。
- **界面只负责确认。** 唯一新增的界面是草稿审阅页，用户在这里决定发布还是拒绝。

外部 MCP 客户端（例如连接 Workspace MCP 的 Claude Code）可以读同一个 `skill-creator`，调用同一组工具，
也拿到同一个草稿链接。所有客户端都由人在 Workspace 里完成发布，不依赖浏览器 agent 的审批卡片。

### 不变的部分

- **分发仍走 MCP。** skill 仍存放在个人空间或仓库根目录的 `.agents/skills/<name>/`，由 `skills_read` 发现和分发。
  受益方是浏览器 Workspace Agent 和使用 Workspace MCP 的外部客户端。
- **`uvw` CLI 和 DSH Agent 不在范围内。** `skill-creator` 只加入 gateway 的内置 skill，不加入 `apps/cli/skill-data`。
- **执行环境不变。** 浏览器没有 shell 和沙箱，`scripts/` 不会被执行。扫描和审查只负责把这一点提前告诉用户。
- **SK1 至 SK3 的不变量全部保留。** 包括系统提示词逐字不变、历史只追加、非成员仓库不加载、日志不含内容。

### 不做

- skill 编辑器、导入向导、独立的 Creator agent 或会话类型。手动编辑仍然可以走现有的文件树上传。
- 执行 `scripts/`，或在 agent 中使用二进制 `assets/`。office 模板依赖「从 Blob 直接导入」，那是独立需求。
- skill-creator 原版的自动评测、基准对比、盲比和描述优化循环。它们依赖 Python 和子 agent，见下文。
- 在产品里浏览或搜索 hub、发布 skill 到外部 hub、自动更新。导入时记录来源，为以后的「检查更新」留位置。

## 关键结论

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 入口 | `/skill-creator`，或者用户直接说「帮我做个 skill」，由模型读取它 | 复用 SK3 的 `/name` 调用 |
| `skill-creator` 放在哪 | gateway 内置 skill，`apps/mcp/skills/skill-creator/` | 与 `core` 同处，由 `assemble-skills.mjs` 打包 |
| agent 怎么写 skill | 新增 `skill_draft_create`，只建草稿，不写 trunk | 仿照 `html_view_create` |
| 谁让 skill 生效 | 用户在草稿审阅页点 **发布**，服务端写入 `.agents/skills/<name>/` | 仿照 HTML View 草稿，只有作者的交互式 Session 能发布 |
| 外部来源由谁抓取 | Workspace Server，只访问固定的 hub 域名 | gateway 不连数据库，抓取和扫描属于产品逻辑 |
| 静态扫描在哪 | Workspace Server，读取来源和创建草稿时都运行 | 草稿页和工具结果用同一份结果 |
| agent 审查是什么 | `skill-creator` 中的一个步骤。模型把审查结论随草稿提交，服务端逐条校验原文证据 | 不另起一次模型调用 |
| 需要改数据库吗 | 需要。新增 `skill_drafts` 表 | 草稿是产品数据。执行 `apps/workspace/AGENTS.md` 的迁移矩阵 |

## 用户看到的流程

### 创建

1. 用户在 Auto 模式输入 `/skill-creator 把每周对账做成 skill`。SK3 把 `skill-creator` 正文放进这条消息的提醒里。
2. agent 按 `skill-creator` 访谈，最多一次问三个问题。需要时先读用户提到的表或文档。
3. agent 起草 `SKILL.md` 和 `references/`，在对话里拿一两条用例按草稿内联试跑一遍，再根据用户反馈修改。
4. agent 调用 `skill_draft_create`，提交文件和自己的审查结论，回复草稿链接后结束这一轮。
5. 用户打开草稿页，看文件、扫描结果和审查意见，点 **发布**。之后的会话里就能用 `/<name>` 调用这个 skill。

### 修改

`/skill-creator 把 weekly-report 改成按部门分组`。agent 用 `skills_read` 读出现有内容，修改后以「替换」的方式
建草稿。草稿记录读取时的版本。发布时，如果有人在这期间改过这个 skill，草稿进入 `conflicted`，不覆盖别人的修改。

### 导入

`/skill-creator 导入 https://skills.sh/anthropics/skills/pdf`。agent 调用 `skill_source_read` 列出来源中的 skill、
读取文件、拿到静态扫描结果。它按 `skill-creator` 的审查清单逐条检查正文，向用户说明哪些部分在 Workspace 里无法工作。
然后由用户选择：

- **原样导入。** `skill_draft_create` 直接从来源复制全部文件，包括二进制文件，模型不用转抄。
- **适配后导入。** agent 把 shell 步骤改写成 Workspace 工具或交给 `execute` 运行的 Facade 代码，删掉改不了的部分，
  然后提交改写后的文件。

两种方式都会在 `SKILL.md` frontmatter 的 `metadata` 里记录来源。

用户也可以先把 zip 或文件夹上传到 Space，再说「导入我刚上传的 xxx.zip」。不需要专门的上传入口。

### Ask 模式

`skill_draft_create` 是 `write` scope，Ask 模式的 token 只有 `read`（`mcp-token.ts` 的 `grantScopes`）。
在 Ask 模式下，agent 可以完成访谈、起草、试跑和导入审查，最后告诉用户切到 Auto 再保存草稿。
`skill-creator` 正文里写明这一点。

## 内置 skill `skill-creator`

### 来源和许可

从 `anthropics/skills` 的 `skills/skill-creator` 复制，钉住一个 commit。该目录自带 Apache-2.0 的 `LICENSE.txt`，
仓库整体没有统一的许可证，所以按目录判断。处理方式如下：

- 保留 `LICENSE.txt`。
- 新增 `NOTICE.md`，写明源仓库、源 commit，以及「本副本已为 Univer Workspace 修改」。Apache-2.0 要求修改过的文件
  注明修改。
- 打包脚本把整个目录带进 `dist/skill-data/`。

### 原版流程怎么取舍

原版有一节「在 claude.ai 上」的降级说明：没有子 agent 时内联跑测试，跳过基线和描述优化。浏览器 agent 的处境
与它最接近，所以以那一节为起点。

| 原版步骤 | 依赖 | 特化版 |
| --- | --- | --- |
| 弄清意图、访谈和调研 | 无，可选子 agent | 保留，并加上「先读用户提到的 Workspace 文档」 |
| 写 `SKILL.md`（主动型描述、渐进披露、正文 500 行内、「不意外」原则） | 无 | 保留，作为核心 |
| 写两三条测试用例到 `evals/evals.json` | 文件 | 保留用例，写在对话里，不进 skill |
| 带 skill 与不带 skill 并行运行、计时 | 子 agent、文件系统 | 改为在对话中按草稿内联试跑一两条用例，由用户评价 |
| 打分、汇总、评测查看器 | Python、本地服务 | 删除 |
| 按反馈改进、避免过拟合 | 无 | 保留 |
| 盲比 | 子 agent | 删除 |
| 描述优化循环（`run_loop.py` 调 `claude -p`） | `claude` CLI | 删除循环。保留「写 8 到 10 条该触发和易混淆不该触发的请求，逐条对照描述」作为自查 |
| 打包 `.skill` | Python | 删除，改为 `skill_draft_create` |

删除 `scripts/`、`eval-viewer/`、`agents/` 和 `assets/eval_review.html`。这样内置 skill 自己也能通过静态扫描。

### 特化后的目录

```text
apps/mcp/skills/skill-creator/
	SKILL.md                      主流程，控制在约 300 行
	LICENSE.txt                   原样保留
	NOTICE.md                     来源和修改说明
	references/
		authoring.md              写法细则：name、description、渐进披露、正文风格（取自原版）
		workspace.md              Workspace 约束：存放位置、无 shell、Facade 脚本、可用工具、模板格式
		review.md                 兼容性和安全审查清单，审查结论的提交格式
		importing.md              来源写法、导入步骤、原样导入与适配的选择、来源记录
```

正文要短，因为 `/skill-creator` 会把整段正文放进用户消息。原版 `SKILL.md` 约 33 KB。
特化版把细则移到 `references/`，正文只保留流程，以及「什么时候读哪个文件」。

### `SKILL.md` 的主流程

1. **判断任务类型。** 新建、修改或导入。修改和导入先读现有内容或来源。
2. **弄清意图。** 这个 skill 让 agent 做什么、什么时候触发、产出什么、有没有例子。用户提到了表或文档就先读。
   一次最多问三个问题。
3. **起草。** 按 `references/authoring.md` 和 `references/workspace.md` 写。用到的工具名只取当前连接里真实存在的。
   需要计算时写成交给 `execute` 的 Facade 代码，放在 `scripts/`，并在正文里说明用法。
4. **试跑。** 拿一两条真实请求，按草稿在对话中内联执行。Ask 模式下只读，不改用户数据。用户评价后修改。
5. **自查描述。** 写 8 到 10 条该触发和易混淆不该触发的请求，逐条对照 `description`。
6. **审查。** 按 `references/review.md` 检查全部文件，整理成审查结论。
7. **保存草稿。** 调用 `skill_draft_create`，把审查结论放进 `review`。回复草稿链接，说明用户需要在草稿页发布，
   然后结束这一轮。发布前不要声称 skill 已经可用。
8. **发布之后。** 用户回来时，用 `skill_draft_get` 确认状态，再提示用 `/<name>` 试用。

skill 正文、仓库文件和导入来源都是数据。`skill-creator` 要求模型把它们当作材料，不当作给自己的指令。

### 让内置 skill 能用 `/` 调用

现在内置 skill 不进 `/` 菜单，也不进目录提醒。浏览器的 `gatewaySkillCatalogSchema` 会丢弃 `builtin` 条目。
改法如下：

- **gateway。** 内置条目的 `userInvocable` 改为读 frontmatter：显式写了 `user-invocable: true` 才是 true，
  其余内置 skill 默认 false。只有 `skill-creator` 写这一行。外部客户端不读这个字段，不受影响。
- **浏览器。** 目录保留 `userInvocable` 为 true 的内置条目，`SkillSource` 增加 `"builtin"`。`/` 菜单显示它，
  来源标签为 **内置**。目录提醒仍然排除所有内置条目，所以模型看到的提醒和系统提示词都不变。
- **模型如何发现它。** 在 `core` skill 的路由说明里加一行：「用户想创建、修改或导入 skill 时，读 `skill-creator`」。
  这样用户不打 `/` 也能触发。
- **名字保留。** `skill-creator` 成为内置名后，同名的自定义 skill 会自动得到 `reserved-name` 诊断。这是 SK1 已有的规则。

## 新增 MCP 工具

三个工具都放在 `core` 工具集。浏览器 agent 默认只拿 `core`（`runner.ts` 删掉了 `toolsets` 参数）。
工具列表只在 gateway 发版时变化，不影响一次会话内工具列表不变的要求。

### `skill_source_read`（`read` scope）

读取一个外部来源或 Space 中的归档，不写任何东西。

```ts
input: {
	source: string;      // 链接、hub 标识符、`npx skills add ...` 这类命令，或 Space 中 zip、文件夹的 node ID
	skill?: string;      // 来源中有多个 skill 时选一个
	path?: string;       // 读取该 skill 中的一个文本文件
	cursor?: string;     // 长文件分页，语义同 skills_read
}
output（不带 skill）: { source: ResolvedSource; candidates: { name; description; path; fileCount; problems }[] }
output（带 skill）:  { source; skill: { name; description; files: SkillFileInfo[]; content: string }; scan: ScanFinding[] }
output（带 path）:   { path; content; nextCursor? }
```

`source` 的解析结果钉在一个确定版本上，例如 GitHub 的 commit SHA。之后用同一个 `ResolvedSource` 建草稿，
不会读到另一个版本。

### `skill_draft_create`（`write` scope）

建一个草稿，返回 `previewUrl`。

```ts
input: {
	name: string;
	destination: { personal: true } | { repo: string };
	replace?: boolean;                 // 修改已有 skill。服务端记录当前每个文件的 ETag
	files?: { path: string; text: string }[] | undefined;    // agent 写的文本文件
	keep?: string[];                   // replace 时原样保留的已有文件，例如二进制文件
	from?: { source: ResolvedSource; skill: string; overrides?: { path: string; text: string | null }[] };
	review: ReviewFinding[];           // agent 的审查结论，可以为空数组
	idempotency_key: string;
}
output: { draft: { id; previewUrl; expiresAt; scan: ScanFinding[]; review: VerifiedReviewFinding[]; compatibility } }
```

`files` 和 `from` 只能二选一。`from` 是原样导入：服务端直接复制来源中的文件，`overrides` 只替换或删除少数文件。
这样适配一个大 skill 时，模型不用转抄没有改动的文件。

### `skill_draft_get`（`read` scope）

返回草稿状态：`pending`、`published`、`rejected`、`expired` 或 `conflicted`。语义同 `html_view_draft_get`。

## 产品侧

### 数据形状

```ts
type SkillDestination =
	| { kind: "personal"; spaceId: string }
	| { kind: "repository"; spaceId: string };

type ResolvedSource =
	| { kind: "git"; hub: "github" | "skills-sh"; owner: string; repo: string; commit: string; path: string; pageUrl: string }
	| { kind: "clawhub"; owner: string; slug: string; version: string; pageUrl: string }
	| { kind: "space"; nodeId: string; etag: string };      // Space 中的 zip 或文件夹

type ScanSeverity = "block" | "warn" | "info";

interface ScanFinding { rule: StaticRule; severity: ScanSeverity; path: string; line: number | null; message: string }

interface ReviewFinding {          // agent 提交
	rule: ReviewRule;
	path: string;
	quote: string;                 // 原文片段，不超过 200 字符
	impact: string;                // 在 Workspace 里会发生什么
	suggestion: string;
}

interface VerifiedReviewFinding extends ReviewFinding { line: number }   // 服务端找到了原文

type Compatibility = "ready" | "degraded" | "blocked";

interface SkillDraftRecord {
	id: string;
	authorId: string;
	idempotencyKey: string;
	name: string;
	destination: SkillDestination;
	base: { path: string; resourceId: string; etag: string }[] | null;   // replace 时的版本
	source: ResolvedSource | null;
	files: { path: string; byteSize: number; sha256: string; kind: "text" | "binary"; objectKey: string }[];
	scan: ScanFinding[];
	review: VerifiedReviewFinding[];
	unverifiedReviewCount: number;
	status: "pending" | "published" | "rejected" | "expired" | "conflicted";
	expiresAt: string;
	result: { folderNodeId: string } | null;
}
```

`compatibility` 由 `scan` 和 `review` 推导：有 `block` 就是 `blocked`，否则只要有 `warn` 或任何审查结论就是 `degraded`，
否则是 `ready`。这是一个纯函数。

字节存在 `BlobStore`，`skill_drafts` 表只存身份、元数据和状态。这条遵守根 `AGENTS.md` 的数据边界。
`files`、`scan` 和 `review` 存成表中的 JSON 列还是拆成子表，由执行者对照 `html_view_drafts` 的做法决定。

### 外部来源

Workspace Server 新增一个来源解析模块，只访问下表中的域名。

| 来源 | 用户的写法 | 抓取方式 |
| --- | --- | --- |
| GitHub | 仓库、`tree`、`blob` 链接 | `git/trees/<commit>?recursive=1` 取路径，`raw.githubusercontent.com` 取文件 |
| skills.sh | `skills.sh/<owner>/<repo>/<skill>`、`owner/repo/skill`、`npx skills add ...` | 翻译成 GitHub 坐标，走 GitHub。well-known 域名来源第一版不支持 |
| ClawHub | `clawhub.ai/<owner>/<slug>`、`clawhub install ...` | 它的 `/api/v1/` REST API。它的审核结论转成 `hub-verdict` 发现 |
| anthropics/skills、huggingface/skills、Claude Code 插件仓库 | 仓库链接 | 走 GitHub，列出全部 `SKILL.md` 供选择 |
| Space 中的 zip 或文件夹 | node ID，或 agent 用 `space_find` 找到的文件 | 读 Blob。zip 在服务端解压 |
| LobeHub、Smithery、SkillsMP 等 | 下载 zip 后上传到 Space | 同上 |

约束：

- 不跟随出白名单的重定向，有超时，不带任何用户凭据。
- 上限与 gateway 一致：每个 skill 最多 100 个文件，`SKILL.md` 64 KiB，单个文本文件 256 KiB。
  另加单个二进制文件 10 MiB，单个 skill 总量 20 MiB。解压时累计计数，超限立即停止，防止压缩炸弹。
- 拒绝绝对路径、含 `..` 的路径和符号链接。
- **GitHub 额度。** 未认证 API 每个 IP 每小时 60 次，而现在所有用户共用服务端的出口 IP。部署可以配置可选的
  `GITHUB_TOKEN`（认证后每小时 5000 次），写进 `apps/workspace/README.md` 的运行配置。没有配置且额度用完时，
  工具返回明确的错误，`skill-creator` 引导用户下载 zip 后上传到 Space。`raw.githubusercontent.com`
  不计入 API 额度，这一点是推断，实现时确认。

### 静态扫描

纯函数，输入文件清单和字节，输出 `ScanFinding[]`。`skill_source_read` 和 `skill_draft_create` 都调用它，
发布前再跑一次。文本判定沿用 gateway 的规则：`TextDecoder("utf-8", { fatal: true })` 解码成功且不含 NUL 字节。

| 规则 | 级别 | 条件 |
| --- | --- | --- |
| `frontmatter-invalid` | block | `skillEntry` 校验失败 |
| `reserved-name` | block | 与内置 skill 同名 |
| `size-limit` | block | `SKILL.md` 超 64 KiB，或文件数超 100 |
| `unsafe-path` | block | 绝对路径、`..`、符号链接 |
| `text-too-large` | warn | 附属文本文件超 256 KiB，模型读不到 |
| `script-file` | warn | `scripts/` 下的文件、脚本扩展名（`.py`、`.sh`、`.ps1`、`.bat`、`.rb`、`.pl` 等），或首行是 `#!` |
| `facade-script` | info | `.js` 或 `.ts` 文件包含 `univerAPI`，可以交给 `execute` |
| `executable-binary` | warn | `.exe`、`.dll`、`.so`、`.dylib`、`.wasm`、`.jar`、`.whl`、归档文件，或 ELF、Mach-O、PE 文件头 |
| `office-asset` | warn | `.xlsx`、`.docx`、`.pptx` 等二进制模板，当前不能导入为 Unit |
| `media-asset` | info | 图片、字体，模型看不到内容 |
| `missing-reference` | warn | `SKILL.md` 中的相对链接或反引号路径在文件清单里不存在 |
| `ignored-field` | info | `allowed-tools`、`context`、`model`、`hooks`、`paths` 等 Workspace 会忽略的字段 |
| `hidden-text` | warn | 双向控制字符、零宽字符、HTML 注释 |
| `name-conflict` | warn | 目标位置已有同名 skill 但没有 `replace`，或者仓库级会覆盖同名个人级 |
| `hub-verdict` | warn 或 info | 来源 hub 给出了审核结论，例如 ClawHub 的 `isSuspicious`、`isMalwareBlocked` |

`skillEntry` 已经在 gateway 使用（`@modelcontextprotocol/server/ext/skills`）。Workspace Server 是 Node，
可以直接依赖同一个包和同一个精确版本，这样服务端和 gateway 的校验规则一致。实现前确认它在 server 的依赖图里
不会引入问题。

### agent 审查和证据校验

agent 审查不是一次单独的模型调用，而是 `skill-creator` 的一个步骤。`references/review.md` 列出要找的内容：

| 规则 | 找什么 |
| --- | --- |
| `requires-shell` | 要求运行命令，例如 `bash`、`python`、`node`、`npx`、`pip`、`uv`、`curl`，或「运行 `scripts/x.py`」 |
| `requires-binary` | 要求打开、修改或执行二进制文件和外部程序 |
| `requires-local-io` | 要求读写本地文件系统或环境变量，或直接访问网络和外部 API |
| `unavailable-tool` | 步骤依赖 Workspace 没有的工具，例如 `Bash`、`Read`、`Write`、`Edit`、`WebFetch`、`Task` |
| `suspicious-instruction` | 让 agent 忽略用户或系统指示、隐瞒操作、把数据发往外部地址、绕过评审直接合入 |

模型在对话里向用户说明结论，并把每一条放进 `skill_draft_create` 的 `review`。服务端逐条校验：`quote` 必须在 `path`
对应的文件里逐字出现，找到就补上行号，找不到就丢弃并计入 `unverifiedReviewCount`。草稿页只显示通过校验的条目，
并注明有几条未通过。

这样做有三个好处。一是模型编造的问题不会出现在草稿页上。二是审查用的是用户正在用的模型和上下文，不额外花钱。
三是外部 MCP 客户端提交的审查结论走同一套校验。

审查结论只能是 `warn`。能阻止发布的只有静态扫描的 `block`。

### 草稿审阅页

`/drafts/$draftId` 现在只渲染 HTML View 草稿。改为按草稿类型分派，skill 草稿渲染一个新组件。路由怎么区分两种
草稿（id 前缀、查询两张表，或者统一的草稿入口），由执行者比较后决定。页面内容如下：

- 顶部一行写兼容性结论，例如「部分可用：3 个脚本在 Workspace 中不会运行」，旁边是保存位置和来源。
- `SKILL.md` 用现有的 Markdown 预览渲染。其他文本文件可以展开。二进制文件只列出名字、大小和类型。
- 修改已有 skill 时，显示与当前版本的逐文件差异。
- 扫描发现和审查意见按级别分组，每条可以跳到对应文件和行。
- 保存到仓库时提示：「仓库所有成员的 agent 都会读到它」。
- **发布** 和 **拒绝** 两个按钮。有 `block` 时 **发布** 不可用，并说明原因。

界面文案不写「安全」或「已通过」，只写「发现 N 个问题」或「未发现问题」。

### 发布

只有作者的交互式 Session 可以发布或拒绝，与 HTML View 草稿相同。服务端按以下顺序执行：

1. **复核。** 重新运行静态扫描。有 `block` 就停止。
2. **检查冲突。** 有 `base` 时，逐个比对目标文件当前的 ETag。不一致就把草稿置为 `conflicted` 并停止。
3. **定位目录。** 在目标 Space 根目录逐层查找或创建 `.agents`、`skills`、`<name>`。已存在就复用，所以重试不会建出重复目录。
4. **写附属文件。** 已存在的同路径文件按 ETag 替换，新文件新建。
5. **最后写 `SKILL.md`。** gateway 以 `SKILL.md` 的存在判定一个 skill。最后写它，读取方就不会看到一个引用了尚未写入文件的 skill。
6. **清理。** `replace` 时，目标目录中有、草稿中没有、也不在 `keep` 里的文件移入 Trash。草稿页事先列出这些文件。
7. **记录结果。** 置为 `published`，保存目录节点 ID。

产品数据库和 BlobStore 之间没有跨系统事务。每一步都是查找优先或带幂等键的写入，中途失败后重新发布会收敛到同一结果。
执行者参照 HTML View 草稿发布的 Operation 和恢复语义实现，不另起一套。

### 来源记录

原样导入和适配导入都在 `SKILL.md` frontmatter 的 `metadata` 中写入来源。规范允许 `metadata` 是字符串键值表：

```yaml
metadata:
  source: github.com/anthropics/skills/skills/pdf
  source-commit: 0123abcd...
  source-hub: skills-sh
  imported-at: 2026-11-13
```

来源跟着 skill 走，复制到 Claude Code 或 Codex 里也不会丢。以后「检查更新」只需要比对 commit。代价是改动了第三方文件的
frontmatter。原样导入时，这是唯一的改动。

## gateway 的其他改动

- **`duplicate` 诊断。** 产品库不限制同一目录下的节点重名。现在 `custom-skills.ts` 用 `.find` 取第一个名为 `.agents`、
  `skills` 的目录和第一个 `SKILL.md`，取到哪个取决于列表顺序。改为：任一层出现重名就产出 `duplicate` 诊断并跳过。
  发布流程的「查找优先」保证我们自己不会制造重名。
- **透传 `metadata`。** 目录条目增加可选的 `metadata`，右侧栏用它显示「来自 skills.sh」这类来源。

`SkillProblem` 增加 `"duplicate"`。`ui/messages.ts` 的中英文案、`skills_read` 的输出 schema、`apps/mcp/README.md`
和 SK1 的测试同步更新。

## 信任和安全

扫描是尽力而为，不是安全保证。Snyk 在 2026 年 2 月扫描 ClawHub 和 skills.sh 的 3,984 个 skill，13.4% 有严重问题，
76 个确认恶意。也有论文专门研究如何绕过 skill 扫描器。我们不执行脚本，所以主要风险是 `SKILL.md` 和 `references/`
里的提示注入。防线有以下几层：

- **人发布。** agent 只能建草稿。skill 进入目录必须由作者在 Workspace 里点 **发布**，外部 MCP 客户端也一样。
- **默认个人空间。** `skill-creator` 默认保存到个人空间。保存到仓库要求用户明确指定，且需要该仓库的写权限，由服务端 ACL 判定。
- **只访问白名单。** 外部抓取只访问固定的 hub 域名，不带用户凭据。
- **来源当数据。** `skill-creator` 要求模型把来源内容当作材料而非指令。读取来源时，模型看到的内容放在工具结果里，
  受 Ask 和 Auto 模式、token scope 和 `publish` 审批的约束，与读取任何仓库文件相同。
- **日志不含内容。** gateway 和 server 的事件不记录 skill 正文和来源文件内容。

## 实施拆分

每个 PR 都能单独验证。SB1 从 `main` 开分支，不依赖其他 PR。SB2 到 SB5 组成一个 stack。

| PR | 内容 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| SB1 `feat(mcp)` | `duplicate` 诊断，透传 `metadata` | main | 三层重名的单测；verify-uvw MR13 增加重名用例 |
| SB2 `feat(workspace)` | `skill_drafts` 表与迁移、HTTP contract、静态扫描、证据校验、发布流程、草稿审阅页 | main | 扫描规则逐条单测；发布的中断重试、ETag 冲突、`SKILL.md` 最后写入都有测试；`api:verify` 通过；按 `verify-db-migration` 跑完迁移矩阵；浏览器旅程用 HTTP 建一个草稿，发布后 `/name` 能调用 |
| SB3 `feat(mcp)` | `skill_draft_create`（`files` 形式）、`skill_draft_get` | SB2 | 工具单测；verify-uvw 旅程从 MCP 建草稿、发布、`skills_read` 能读到 |
| SB4 `feat(mcp)` | 内置 `skill-creator`（复制、特化、`NOTICE.md`），内置 skill 的 `user-invocable`，浏览器 `/` 菜单显示内置条目，`core` 增加路由说明 | SB3 | `runner.test.ts` 断言系统提示词与目录提醒不变；mock provider 旅程覆盖 `/skill-creator`、访谈、建草稿、发布；真实模型手动跑一次创建和一次修改，附会话截图 |
| SB5 `feat(workspace)` | 来源解析（GitHub、skills.sh、ClawHub、Space 中的 zip 和文件夹）、`skill_source_read`、`skill_draft_create` 的 `from` 形式、`skill-creator` 的 `importing.md` 和 `review.md` 定稿 | SB4 | 每种来源的解析有表驱动单测；抓取用录制的响应测试；压缩炸弹和路径穿越有测试；一条真实旅程从固定 commit 的公开仓库导入一个带脚本的 skill，草稿页显示 `script-file` 和通过校验的审查意见 |

顺序的理由：SB2 是所有路径共用的出口，先做。SB4 让「创建」和「修改」端到端可用，用户先拿到价值。导入放最后，
因为它依赖前面全部能力，又有外部网络这个不确定因素。

SB2 涉及数据库，必须遵守 `apps/workspace/AGENTS.md`。SB4 改动了目录和 `/` 调用，合入前用 pstack 的 `interrogate`
技能做一轮对抗审查，重点是提示缓存不变量。

## 需要确认的产品决定

下面几项没有实验能回答，需要产品判断。括号里是本设计的默认。

1. **来源写进 frontmatter `metadata`。**（写。）另一种做法是写一个旁路文件，或者不记录。
2. **Ask 模式能否保存草稿。**（不能，提示切到 Auto。）如果要允许，需要给草稿创建单独开一个 scope 例外。
3. **部署是否配置 `GITHUB_TOKEN`。**（文档提供该选项，默认不配。）不配时 GitHub 导入受共用出口 IP 每小时 60 次的限制。

## 交给执行者的提醒

- 先读：本文、[agent-skills.md](./agent-skills.md)、[agent-skills-architecture.md](./agent-skills-architecture.md)、
  根 `AGENTS.md`、`apps/workspace/AGENTS.md`、`apps/mcp/AGENTS.md`、`data-model.md` 中 `html_view_drafts` 一节、
  `.agents/skills/verify-uvw/SKILL.md` 和 `features/agent-skills.md`。
- 实现前要确认的事实：
  - Workspace Server 能否依赖 `@modelcontextprotocol/server` 的 `skillEntry`。
  - `skillEntry` 是否接受 `metadata` 字段。
  - `raw.githubusercontent.com` 是否计入 GitHub API 额度。
  - ClawHub `/api/v1/` 的文件接口与审核字段是否与调研描述一致。
  - HTML View 草稿的 Operation 和恢复语义能否直接复用。
- 草稿与 HTML View 草稿共用多少代码，用 pstack 的 `architect` 技能比较后决定。不为复用而硬合并两张表。
- 不手工修改生成文件。改了 HTTP contract 就运行 `pnpm --filter @univerjs/univer-workspace api:verify`。

## 参考来源

- Anthropic skill-creator：<https://github.com/anthropics/skills/tree/main/skills/skill-creator>
- Agent Skills 规范：<https://agentskills.io/specification>
- skills.sh：<https://skills.sh>，API 文档 <https://skills.sh/docs/api>，CLI 源码 <https://github.com/vercel-labs/skills>
- ClawHub：<https://clawhub.ai>，源码与 HTTP API 文档 <https://github.com/openclaw/clawhub>
- anthropics/skills：<https://github.com/anthropics/skills>；Hugging Face skills：<https://github.com/huggingface/skills>
- Snyk ToxicSkills：<https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/>
- ClawHub 恶意 skill 报道：<https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html>
- 可参考规则的扫描器：Cisco skill-scanner <https://github.com/cisco-ai-defense/skill-scanner>，
  Snyk agent-scan <https://github.com/snyk/agent-scan>

hub 和安全资料由一个调研子 agent 于 2026-11-13 读取。API 行为是它用 curl 观察到的，实现前复测。
