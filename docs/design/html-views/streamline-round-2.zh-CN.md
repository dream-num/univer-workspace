# HTML View 第二轮精简：工具合并与模板渐进式披露

状态：待对齐（2026-11-21）。前置：[默认直接做草稿](default-and-go.zh-CN.md)（#498）。本文的数字都基于 #498 分支实测。

## 1. 结论

#498 已经去掉了“先提方案再等待”，并把默认读取量从约 6.4 万字符降到约 3 至 3.5 万字符。剩下的复杂度集中在三处：

1. **两个写工具做的是同一件事。** `html_view_create` 和 `html_view_replace` 底层是同一个执行器操作 `htmlView.draft`，
   只是 `kind` 不同。建议合成一个 `html_view_save`，按参数区分新建和修改，同时移除已经多余的 `html_view_validate`。
   MCP 上的 HTML View 工具从 6 个减到 4 个。
2. **模板一次读入 1 至 2.4 万字符，其中大部分是另一个场景的示例应用。** 建议把风格的说明分成三层：
   目录一行、风格卡（约 2 至 3 千字符）、完整模板。默认只读到风格卡，数据形状与模板的设计场景相近时才读完整模板。
   第二层是否足以保住观感要先做对比实验再决定。
3. **同一组规则散在至少 9 处。** 每处只保留自己的职责，并用测试防止规则再次扩散。

## 2. 现状（#498 之后）

### 2.1 工具

| 工具 | 权限 | 用途 | 描述长度 |
| --- | --- | --- | --- |
| `html_view_create` | write | 校验并保存新页面草稿；`html` 或 `html_upload_id`；PR 来源用 `repo`+`pr` | 1,429 |
| `html_view_replace` | write | 校验并保存已有页面的修订草稿；需要 ETag | 1,061 |
| `html_view_validate` | read | 只校验不保存；#498 后为可选 | 578 |
| `html_view_draft_get` | read | 草稿状态，发布后给分享链接 | 264 |
| `html_view_styles` | read | 风格目录，驱动浏览器 Agents 的风格画廊卡片 | 249 |
| `html_view_read` | read | 读已有页面的 HTML 与 ETag | 190 |

`create` 与 `replace` 的输入几乎相同：都接受 `html` 或 `html_upload_id`、`repo`+`pr`、`idempotency_key`；区别只在
新建要 `space`、`name`、可选 `parent`，修改要页面资源和 `etag`（`apps/mcp/src/shared/executor-protocol.ts` 的 `htmlView.draft`
已经是 `kind: "create" | "replace"` 的判别联合）。

### 2.2 说明文字与模板

| 来源 | 字符数 | 默认路径是否读取 |
| --- | --- | --- |
| server instructions 中的 HTML View 一句 | 1,182 | 客户端转发时 |
| `core` Skill 中与 HTML View 相关的 6 处 | 约 5,300 | 读 `core` 时 |
| `html-view-creator` | 7,985 | 是 |
| `html-view` Skill（与 CLI 共用）及 5 份参考 | 8,228 + 35,507 | 否 |
| 10 个模板 | 9,614 至 24,102，合计 182,194 | 读其中一个 |

模板的构成（实测）：注释约 5%，CSS 约 25% 至 35%，JavaScript 约 40% 至 60%。十个模板之间共用的 JavaScript
不到 3%，其余都是各自场景的图表和交互。每个模板开头的注释写着它期望的 Sheet 结构，例如 Night Gauge 是
“36 个月现金跑道模型”：A1:B7 是假设、A9:E44 是 36 行公式。数据不同时（比如英雄联盟赛事数据），模型要读完
2 万字符，再改写掉大部分示例逻辑。

### 2.3 现有的渐进式披露

已经做到的：

- `skills_read {"name": "html-view"}` 只返回 Skill 正文和资源路径列表，不带内容。
- 模板按 `resource` 单独读取。
- `full: true` 会请求全部参考和模板（约 21.7 万字符），超过 10 万字符的结果上限时被拒绝，提示逐个读取。
- `html_view_styles` 从 `references/design.md` 的目录表解析出风格目录（`parseHtmlViewStyles`），`design.md` 是目录的唯一来源。

还没做到的：

- `full: true` 先失败一次才回到逐个读取，浪费一轮。
- `html-view-creator` 里有一份手写的精简目录（#498），与 `design.md` 是两个来源，会漂移。
- 选中风格后只能读完整模板，没有更轻的一层。

## 3. 方案 A：合并写工具

### 3.1 新工具 `html_view_save`

一个工具，按参数决定新建还是修改：

| 模式 | 必填参数 | 可选参数 |
| --- | --- | --- |
| 新建页面 | `space`、`name` | `parent` |
| 修改或换风格 | `page`（来自 `html_view_read` 的页面资源）、`etag` | |
| 两种模式共用 | `idempotency_key`；`html` 与 `html_upload_id` 二选一 | `repo`+`pr` |

规则：

- `page` 与 `space` 必须且只能出现一个；`etag` 只在修改时出现。违反时返回可行动的错误，例如
  “新建页面请给 space 和 name；修改页面请给 html_view_read 返回的 page 和 etag”。
- 输入 schema 用一个扁平对象加运行时检查，不用 `oneOf`。部分客户端和模型处理 `oneOf` 不稳定，扁平对象的字段说明也更直白。
- 输出与今天相同：`draft` 加绑定样本。
- 执行器操作 `htmlView.draft` 不变，网关按参数映射到 `kind: "create"` 或 `"replace"`。

描述约 1,400 字符，替代今天两个描述合计 2,490 字符。第一句说明它是什么、什么时候用，其余是两种模式和上线规则。

### 3.2 同时移除 `html_view_validate`（MCP）

`html_view_save` 会校验并返回样本，HTML 不合法时直接报同样的错误。MCP 上单独的校验工具只多一个选择。CLI 的
`uvw html-view validate` 保留，CLI 不走草稿。

合并后 MCP 的 HTML View 工具：`html_view_save`、`html_view_read`、`html_view_draft_get`、`html_view_styles`。

### 3.3 取舍

| 好处 | 代价 |
| --- | --- |
| 少两个工具，写入只有一个动词，新建、修改、换风格都用它 | 新建和修改的必填参数无法在 schema 里表达，只能靠运行时错误提示 |
| 懒加载客户端少一次工具搜索（WorkBuddy、千问办公、LobsterAI 都要先搜工具再调用） | 工具改名，需要迁移，见 3.4 |
| 描述总量减少约 1,700 字符（两个写工具合并，加上去掉校验工具） | |

不建议的替代方案：保留 `html_view_create` 这个名字并让它也接受修改参数。不用迁移，但“create”去修改已有页面，名字会误导模型。

### 3.4 迁移

工具改名会影响：

- **已有浏览器 Agents 会话。** 会话快照里的工具定义保持不变（根 `AGENTS.md` 的提示缓存规则），调用旧名字会收到
  “未知工具”的工具错误，模型可以据此改用新工具；这是 AGENTS.md 已经约定的行为。新会话直接用新工具。
- **浏览器里按工具名识别结果的代码。** `draft-reminder.ts`、`render-check.ts`、`replaced-drafts.ts`、`session-page.tsx`
  改为识别 `html_view_save`，同时保留对旧名字的识别，旧会话的历史消息仍能显示草稿卡片。
- **网关。** `server.ts` 的结果截断、`instructions.ts`，以及 `blob-replace.ts`、`blob-upload.ts`、`space-node.ts`、
  `html-view-read.ts`、`html-view-draft-get.ts` 描述里提到旧名字的地方；服务端 `html-view-guard.ts` 的报错文案。
- **Skill 与文档。** `html-view-creator`、`core`、`html-view`、MCP README。
- **用量事件。** `mcp.tool_call` 的 `tool` 字段出现新值，依赖工具名的统计需要同步。事件结构不变。

一次迁移完成，不保留旧工具别名。

## 4. 方案 B：模板的三层渐进式披露

### 4.1 三层

| 层 | 内容 | 大小 | 何时读 |
| --- | --- | --- | --- |
| L0 目录行 | 每种风格一行：ID、气质、适合的语境与数据形状 | 每行约 150 字符，十行约 1,500 | 随 `html-view-creator` 一起读 |
| L1 风格卡 | 一种风格的设计要素：配色与字体变量、版式骨架、标志元素的做法、密度与间距、几段可直接复用的 HTML/CSS 片段、该风格的禁忌 | 约 2,000 至 3,000 | 选中风格后读 |
| L2 完整模板 | 今天的模板：一个完整的示例应用 | 9,600 至 24,100 | 数据形状接近模板的设计场景，或需要它的交互实现时读 |

模型默认读 L0 和 L1。比如英雄联盟数据选了「周会幻灯」，读它的风格卡就能写页面；做现金流测算时选 Night Gauge，
数据形状与模板一致，再读完整模板直接改。

风格卡放在 `apps/cli/skill-data/html-view/styles/<id>.md`，与模板同名，CLI 与 MCP 共用。

### 4.2 目录只有一个来源

L0 目录行从 `references/design.md` 的目录表生成：

- `design.md` 的目录表增加一列“适合的语境与数据”，替代 #498 在 creator 里手写的那份。
- 网关组装 Skill 时（`apps/mcp/scripts/assemble-skills.mjs`，已经在构建 `dist/skill-data`）把目录表渲染成 creator 里的十行。
  `html_view_styles` 继续从同一张表解析。
- 加一条测试：目录 ID 与 `templates/`、`styles/` 下的文件一一对应。

### 4.3 关掉一次性全读

`skills_read` 的 `full: true` 只返回参考文件，不再包含模板和风格卡，后两者只能按 `resource` 单独读。描述里写明这一点。
这样 `full` 不会先失败一次再回退。

### 4.4 风险：风格卡能否保住观感

模板是观感的依据。只读风格卡时，页面可能不如照着完整模板改出来的好。所以 L1 不直接上线，先做对比实验：

- 同一组数据（英雄联盟赛事、销售周会、项目任务看板三类），每类选一种风格，分别用“风格卡”和“完整模板”各做一次页面。
- 比较：预览截图并排评审（设计下限各项是否满足、标志元素是否到位）、绑定是否正确、读取字符数、耗时。
- 风格卡不低于完整模板时才采用；否则只做 4.2 与 4.3，模板仍按选中读取。

先为两到三种风格写风格卡做实验，通过后再补齐十种。

## 5. 方案 C：规则只放一处

同一组规则（优先 HTML View、不等待、怎么选风格、PR 草稿合并后上线、只保存草稿）今天写在至少 9 处：三个工具描述、
server instructions、`core` 两处、`html-view-creator`、`html-view`、`design.md`、MCP README。#498 改“等待”规则时
就漏过 `core` 的第二处，评审时才发现。

每处只做一件事：

| 位置 | 只保留 |
| --- | --- |
| 工具描述 | 是什么、什么时候用、自己的输入输出；不写流程 |
| server instructions | 一句路由：分享或展示 Workspace 数据的页面就是 HTML View，读 `html-view-creator` |
| `core` Skill | 一段路由加操作表里的行；删掉约第 335 行的第二份流程 |
| `html-view-creator` | 完整流程（唯一来源） |
| `html-view` Skill 与 `design.md` | CLI 写页面的方法、风格目录、设计下限 |

加一条测试：“不等待”“选风格”“PR 合并后上线”这几条规则的关键句只允许出现在 `html-view-creator`（以及 CLI 用的
`html-view`），出现在别处就失败。

## 6. 方案 D：默认内联传 HTML

千问办公那次（会话 `ses_e033ad1edffe…`）模型把三行数据的页面写成文件，再调用 `file_upload_create`、用 `curl` 上传、
传 `html_upload_id`，比直接传 `html` 多三步。`html_view_save` 的描述和 creator 写明：默认内联传 `html`；
只有 HTML 大到一次调用放不下时才用上传。

## 7. 不做的事

- **不拆分或压缩模板本身。** 共用代码不到 3%，体积来自各自的设计；渐进式披露解决“何时读”，不改“读什么”。
- **不改草稿与发布。** 人发布或合并 PR 后上线，这是安全门槛，刚上线的 PR 自动发布也不动。
- **不合并 `html_view_read`、`html_view_draft_get`、`html_view_styles`。** 它们分别承担读 ETag 防并发覆盖、查草稿状态、
  驱动风格画廊，职责不重叠。
- **DSH 插件的 `univer-html-view`（18,356 字符）** 仍按低优先级处理，不在本轮。

## 8. 效果预估

| 指标 | #498 之后 | 本轮之后 |
| --- | --- | --- |
| MCP HTML View 工具数 | 6 | 4 |
| HTML View 工具描述合计 | 约 3,800 字符 | 约 2,100 字符 |
| 新页面默认读取（creator + 风格说明） | 约 8,000 + 1 至 2.4 万 | 约 8,000 + 2 至 3 千（若 L1 通过实验） |
| 小页面的调用步骤 | 可能走上传，多 3 步 | 默认内联 |
| 规则出现的位置 | 至少 9 处 | 1 处主流程，其余只做路由 |

L1 那一行是预估，要以 4.4 的实验结果为准。

## 9. 验收

- 方案 A、C、D：MCP、Client Core、CLI、Web 的测试与类型检查通过；新增测试覆盖两种模式的参数校验、错误提示、
  旧会话里旧工具名的草稿卡片仍能显示、规则只出现在一处。
- 线上：用户原话在 WorkBuddy、千问办公、LobsterAI 各跑一次，都调用 `html_view_save` 得到草稿；有一次走“换风格”，
  确认修改模式也用同一个工具。
- 方案 B：4.4 的对比实验结果写入本文，再决定是否补齐风格卡。

## 10. 实施顺序

1. 等 #498 合入。
2. PR 1：方案 A、C、D 与 4.2、4.3（工具合并、规则收口、内联优先、目录单一来源、关掉 full 读模板）。
3. 实验：两到三张风格卡对比完整模板。
4. PR 2：通过后补齐十张风格卡，creator 改为默认读风格卡。

## 11. 需要你决定

1. 合并后的工具名：建议 `html_view_save`。备选 `html_view_draft`，与 `html_view_draft_get` 太像，不建议。
2. 是否一并移除 MCP 上的 `html_view_validate`。建议移除。
3. 风格卡（L1）是否按 4.4 先做实验再决定。建议先实验。
4. 旧工具名是否完全不保留别名，只靠工具错误引导旧会话。建议不保留。
