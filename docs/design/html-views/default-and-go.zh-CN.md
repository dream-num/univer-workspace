# HTML View 精简：默认直接做草稿

状态：待评审（2026-11-21）。前置：[来源 Sheet 还在 PR 里](worktree-sources.zh-CN.md)（#493 至 #496 已上线）。
本文修订 [html-view-creator](html-view-creator.zh-CN.md) 的第 3 步“一轮确认”。

## 1. 结论

用户说“把数据做成一个好看的页面，便于分享”时，Agent 应该直接交出一个 HTML View 草稿链接，而不是本地
`.html` 文件。现在做不到，原因不是能力缺失，而是这条路对模型来说最贵：读约 6.4 万字符的说明，先提方案并结束本轮
等用户回复，再通过严格校验。写一个本地 `.html` 只要一次文件写入。

方案已定的三点：

1. 去掉默认的“提方案、问风格、等待”。只在页面用途或数据不明确，或用户要求挑风格时提问，一次最多一个问题。
   用户点名了风格就用它；没点名时，按用户的语境和数据特点从风格目录里选；都不合适时用 Night Gauge，
   或由模型自定义一种风格。然后直接保存草稿。
2. `html_view_create` 和 `html_view_replace` 自带校验并返回绑定样本，`html_view_validate` 降为可选工具。
   默认路径只读一份 Skill 和一份模板。
3. 所有客户端走同一套流程，包括 Workspace 浏览器 Agents。风格画廊从“草稿前必经”改为“草稿后可选”。

人的确认点只保留一个：打开预览后发布，或合并来源 PR 时自动发布。

## 2. 证据

### 2.1 五次运行

2026-11-20 至 21 的真实运行，证据在各客户端的本地会话记录里。

| 运行 | 提示词是否点名 HTML View | 是否用了 HTML View | 决定因素（引自模型推理） |
| --- | --- | --- | --- |
| 千问办公（#488 之前） | 否 | 没走到 | MCP 结果与报错送不到模型 |
| WorkBuddy 第一次 | 否 | 否 | “a mandated wait… local HTML + present_files is better and simpler”；另有 PR 里的表不能做页面的死路，已由 #493 至 #496 解决 |
| WorkBuddy 第二次（S2 上线后） | 否 | 否 | “propose plan, wait for style choice. That would stall… a lot of extra turns”；把“生成 HTML”理解为文件。它读了 `core` Skill，其中已有“做页面先读 html-view-creator”的路由句，仍选了本地文件 |
| 千问办公访客 | 是 | 是 | 每一步都照做，草稿前有 1 次阻塞提问 |
| LobsterAI 访客 | 是 | 是 | **完全跳过了提方案和等待**，约 3 分钟完成，结果正常 |

用户原话（不点名 HTML View）命中 0/2，点名后 2/2。样本很小，但两次放弃都把“等待”列为理由，唯一跳过等待的模型结果正常。

### 2.2 一页三行数据要付出多少

千问办公访客那次（实测自会话记录 `ses_e033ad1edffe…`）：表格在第 54 秒写好，草稿在第 268 秒保存，HTML View 部分约 3.6 分钟。
保存草稿前读了：

| 读取 | 字符数 |
| --- | --- |
| `html-view-creator` | 9,200 |
| `html-view` | 10,510 |
| `references/design.md` | 10,137 |
| `references/authoring.md` | 12,664 |
| `templates/night-gauge.univer.html` | 21,174 |
| 合计 | 63,685 |

另有 `html_view_styles` 一次、阻塞提问一次、上传、`html_view_validate`、`html_view_create`、`html_view_draft_get`。

### 2.3 为什么没有被选中

1. **强制等待。** 每次放弃都提到它。规则写在 `html_view_create` 描述开头（“propose the page plan… and wait”）、
   creator 第 3 步（“end your turn and wait”）和 `html-view/references/design.md`（“then end your turn and wait”）。
   这一步当初为 Workspace 浏览器 Agents 设计，那里有风格画廊卡片和草稿卡片陪着用户。在 WorkBuddy 这类一次性执行的
   客户端里，它看起来就是“这条路会卡住”。
2. **替代品几乎免费，用户的措辞又指向它。** “生成 HTML”像是要一个文件；本地文件让模型完全掌控设计，客户端还有预览面板。
3. **模型做决定的地方没有说明 HTML View 好在哪。** `html_view_create` 的描述 214 个词全是流程，没有一句说用户能得到什么：
   一个任何人都能打开的链接、数据随表格实时更新、合并 PR 后自动上线。
4. **工具懒加载。** WorkBuddy、千问办公、LobsterAI 都只把模型搜索过的工具描述交给它，Skill 也要模型主动读。
   WorkBuddy 的会话记录里看不到我们的 server instructions。能确定送达模型的只有工具描述。

## 3. 目标与不变量

目标：

- 用户原话命中 HTML View。
- 保存草稿前不需要人回复。
- 默认路径只读一份 Skill 加一份模板。
- 页面观感不低于今天的草稿，且不总是同一种风格。

不变：

- 页面只通过绑定显示实时数据，不复制 Sheet 数据，不在页面里重算公式。
- 只有人能让页面上线：预览后点 **Publish**，或在浏览器里合并来源 PR。
- 草稿状态、PR 关联草稿、合并自动发布的规则（#493 至 #496）不变。
- Ask mode 不能保存草稿，这条照旧。

## 4. 新流程

### 4.1 什么时候问，什么时候直接做

| 情况 | 做法 |
| --- | --- |
| 用户说了要什么页面（例如“做成页面便于分享，尽可能高级”），数据明确 | 直接做，不提问 |
| 用户点名了风格 | 用该风格，不提问 |
| 没点名风格 | 按语境和数据特点从风格目录选一种（见 4.2），回复里说明选了什么、为什么，以及可以换 |
| 目录里的风格都不合适 | 用 Night Gauge，或自定义一种风格（见 4.2） |
| 页面用途不清楚，例如只说“做个页面”，表里有多块互不相关的数据 | 问一个问题：页面给谁看、看什么 |
| 页面要改写源表的单元格（表单、可编辑字段） | 直接做，回复里写明会改哪些单元格；这是给人看的说明，不是等待 |
| 用户要求先看方案或挑风格 | 照用户说的做：先提方案或打开风格画廊 |

### 4.2 默认路径

1. 读数据：`outline`，需要时 `read` 或 `find`。来源表在本次会话的 PR 里时记下 `repo` 和 `pr`。
2. 选风格，读对应模板（一次 `skills_read`），按数据改写。选风格的依据：
   - 用户的语境：用途（汇报、分享介绍、日常追踪、公开报名）、受众、用户用的形容词（例如“高级”“活泼”“专业”）。
   - 数据特点：密集数字与排行、时间序列、任务与状态、少量关键数字。
   - 风格目录里每种风格的气质、设计场景和标志元素（`html-view/references/design.md`）。
   目录里都不合适时，用 Night Gauge，或自定义一种风格。自定义风格从结构最接近的模板出发，
   换配色、字体和标志元素，仍须满足[设计下限](sharing-and-design-floor.md)，并在回复里给出名称和一句话描述。
3. `html_view_create`：校验、保存草稿，返回草稿和绑定样本。样本与预期不符时修改后再调用一次（同名同空间，新的幂等键）。
4. 回复：页面做了什么、来源表、预览链接、怎样上线、谁能打开、选了哪种风格及原因、可以换风格。然后结束本轮。

数据就绪后是 3 到 4 次调用，人只在看预览时介入一次。

### 4.3 所有客户端同一流程

Workspace 浏览器 Agents 也走 4.2。变化只有风格画廊的位置：

- 今天：草稿前调用 `html_view_styles`，会话里出现画廊卡片，用户选完风格 Agent 才开始写。
- 之后：草稿保存后，Agent 在回复里提一句“可以换风格”。用户说要换时，Agent 调用 `html_view_styles` 展示画廊，
  用户选定后 Agent 用 `html_view_replace` 换风格。

`renderCheck` 只在浏览器 Agents 里有（`apps/workspace/web/src/features/agents/runtime/render-check.ts`）。
第三方客户端没有渲染检查，只有绑定样本；回复里照旧说明脚本没有运行。

## 5. 改动清单

### 5.1 工具与网关

| 位置 | 改动 |
| --- | --- |
| `apps/mcp/src/shared/executor-protocol.ts` 的 `htmlView.draft` | 输出在 `draft` 之外增加与 `htmlView.validate` 相同的 `bindings`、`bindingCount`、`truncated`。草稿保存前本来就校验，只是把结果带回来 |
| `apps/mcp/src/gateway/tools/files/html-view-create.ts` | 描述重写，见 5.2 |
| `apps/mcp/src/gateway/tools/core/html-view-replace.ts` | 描述同步：自带校验，不等待，换风格也用它 |
| `apps/mcp/src/gateway/tools/files/html-view-validate.ts` | 描述改为“可选：保存前单独检查绑定”。工具保留，CLI 的 `html-view validate` 不变 |
| `apps/mcp/src/gateway/instructions.ts:80` | 改为：页面就是 HTML View；用户要分享或展示 Workspace 数据的页面时用它，除非用户要文件，否则不写本地 `.html`；默认直接保存草稿；PR 关联草稿在合并后自动上线，其余草稿由用户发布 |

### 5.2 `html_view_create` 新描述（草案）

工具描述用英文，与其他工具一致：

> Create a shareable live page (HTML View, .univer.html) on Workspace Sheet data and save it as a draft.
> Use it whenever the user wants a page, dashboard, report or HTML to share or present data that is in
> Workspace. Prefer it over writing a local .html file unless the user asks for a file. Read the
> html-view-creator Skill first. Do not wait for the user to approve a plan or pick a style: use the style
> they named; otherwise pick the catalog style that fits the request and the data, and if none fits, use
> night-gauge or define a custom style that meets the design floor. Then draft. The call validates the HTML against the live Sheets and
> returns binding samples; if they do not match what you expect, fix the HTML and call again. For a Sheet
> still in a pull request, pass repo and pr: the preview shows that pull request's data and the page goes
> live when the user merges it in Workspace. Otherwise the user opens draft.previewUrl and presses Publish.
> Give the user draft.previewUrl and end your turn. Generate an idempotency_key and reuse it with identical
> HTML and destination on retry. Provide exactly one of html or html_upload_id.

开头两句说明它是什么、什么时候用；流程细节留给 Skill。

### 5.3 Skill

| Skill | 改动 |
| --- | --- |
| `apps/mcp/skills/html-view-creator/SKILL.md` | 重写为默认路径的唯一入口，目标不超过 8,000 字符。保留：只用实时数据、只能由人上线、PR 关联、Ask mode、用户可见措辞。删除：第 3 步的等待、草稿前的风格画廊、第 2 步的可见范围前置检查（改为回复里说明）、单独的校验步骤。并入 `authoring.md` 里写页面必需的绑定要点和一份精简风格目录（每种风格一行：ID、气质、适合的语境与数据），默认路径不再读 `html-view` Skill 和两个 reference |
| `apps/cli/skill-data/html-view/SKILL.md`、`references/design.md` | 删除“先问风格并等待”和“Never silently choose another style”，改为 4.2 的选风格规则：点名就用；否则按语境和数据从目录选；都不合适时用 Night Gauge 或自定义风格（从最接近的模板出发，满足设计下限）。风格目录、模板、设计下限不动。这份 Skill 同时服务 `uvw` CLI，两边说法一致 |
| `apps/mcp/skills/core/SKILL.md:206-210` | 路由句加一句：用户要分享或展示 Workspace 数据的 HTML 页面，就是 HTML View；修正“outside a Worktree”，写明来源在 PR 里时草稿关联该 PR |

默认路径读取量从约 6.4 万字符降到约 3 万字符（creator 约 8,000 加一份模板约 2.1 万），模板仍然完整读入，观感的依据不变。

### 5.4 浏览器 Agents

| 位置 | 改动 |
| --- | --- |
| Agents 运行时的系统提示词与草稿卡片文案 | 去掉“先选风格”的引导；草稿卡片加一个“换风格”入口，点击后发送“换个风格”，由 Agent 调用 `html_view_styles` |
| 风格画廊卡片（`features/html-views/style-gallery`、`style-result`） | 组件不变，触发时机从草稿前改为用户要求换风格时 |

系统提示词变化只影响新会话，已有会话的 `modelSnapshot` 保持不变，符合根 `AGENTS.md` 的提示缓存约束。

### 5.5 测试与文档

- `apps/mcp/test/html-view-creator-skill.test.ts`、CLI 的 `shared-skills.test.ts`：按新流程改断言（不再出现等待，默认风格，PR 关联）。
- `htmlView.draft` 输出新增字段的单元测试。
- 本文合入后，`html-view-creator.zh-CN.md` 第 3 步加一句指向本文。

## 6. 最终呈现效果

以用户的原始请求为例：“研究近期英雄联盟夏季赛数据……使用 univer workspace mcp 将数据保存到 spreadsheet，
然后生成 HTML 便于我的分享和介绍，页面尽可能高级吸引眼球。”

### 6.1 第三方客户端（WorkBuddy、千问办公、LobsterAI）

用户发出这一句后不需要再回复。Agent 研究数据、在 PR 里建表写数据、按语境选风格写页面、保存草稿，最后回复（示意）：

> 数据和页面都准备好了。
>
> **表格**：「2026 英雄联盟夏季赛数据总览」，7 个工作表（总览、赛区对比、战队榜、选手榜、对局明细、英雄 BP、荣誉与决赛），
> 放在 PR #5 里等你审阅：https://space.univer.ai/spaces/…/pulls/5
>
> **页面**：「2026 夏季赛数据全景」，预览：https://space.univer.ai/drafts/…
> 预览里显示的是 PR 里的数据。你在 Workspace 合并 PR #5 后，页面会自动上线，以后表格里的数据更新，页面也跟着更新。
>
> 风格选的是「周会幻灯」：你要拿它分享和介绍，这种整页分段、大标题、可以逐屏翻的版式适合边讲边看。
> 想换成别的风格（比如更密集的「交易台」）或调整内容，直接告诉我。
>
> 谁能打开：页面和表格都在你的个人空间，上线后默认只有你能看到。要让别人打开，页面和它用到的表格都要对他们可见，需要时告诉我。

回复里没有 403、trunk、worktree、unitId，也没有把本地文件当作交付物。

### 6.2 打开预览

预览页 `/drafts/{id}` 用 PR 里的实时数据渲染整页，只读。页面上方显示（示意）：

```
┌────────────────────────────────────────────────────────────────┐
│ 草稿 · 合并 PR #5 后自动发布  [查看 PR #5]        [发布](禁用)  │
├────────────────────────────────────────────────────────────────┤
│  2026 夏季赛数据全景                                            │
│  615 场 · 216 位选手 · 40 支战队 · 91 个英雄                      │
│  …（周会幻灯风格，逐屏分段，数据来自 PR #5）                     │
└────────────────────────────────────────────────────────────────┘
```

这一部分是 #496 已上线的行为，本方案不改。

### 6.3 合并 PR，页面上线

用户在 PR #5 页面点合并，确认框写着“合并后将发布 1 个页面”。合并完成后提示“已发布 1 个页面”，带 **打开页面**。
页面此后只读主干数据。用户回到 Agent 问“页面上线了吗”，Agent 先调用 `html_view_draft_get`，确认 `published` 后给出分享链接。

### 6.4 数据已经在主干

用户说“把『销售』表做成一个看板”，表已经合并过。Agent 直接保存草稿，回复预览链接，说明“打开预览后点 **发布** 即上线”。
不开 PR，不提问。

### 6.5 Workspace 浏览器 Agents

同一句话在 Workspace 的 Agents 会话里：会话中先后出现 PR 卡片和草稿卡片，草稿卡片显示预览缩略、“合并 PR #5 后自动发布”
和一个“换风格”按钮。`renderCheck` 发现问题时 Agent 先修再交，回复里只在检查发现问题或无法运行时提一句。

### 6.6 需要提问时

用户只说“做个页面”，选中的表里有销售明细、库存和员工排班三块互不相关的数据。Agent 回复一个问题：

> 这个页面主要给谁看、想看什么？比如：给销售团队看本月业绩，还是给仓库看库存预警？

用户回答后直接做草稿，不再追问风格。

### 6.7 换风格或改内容

用户说“换个亮一点的风格”。第三方客户端里 Agent 在回复中列出风格名称让用户选，或直接选一个最接近的；
浏览器 Agents 里出现风格画廊卡片。选定后 Agent 用 `html_view_replace` 保存新草稿，预览链接不变或更新，上线规则不变。

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 没有事先确认，页面绑错数据 | 草稿返回绑定样本，模型自查；用户在预览里看到，改一次是一次 `html_view_replace` |
| 自动选的风格不合用户口味 | 回复说明选了什么、为什么，并主动说可以换；换风格只要一次 `html_view_replace` |
| 自定义风格观感不稳 | 只在目录都不合适时使用；从最接近的模板出发，满足设计下限；浏览器 Agents 有 `renderCheck` |
| 少读设计参考，观感下降 | 模板仍完整读入；验收用截图对比今天的草稿；浏览器 Agents 有 `renderCheck` |
| 第三方客户端没有渲染检查，脚本错误只能靠预览发现 | 与今天相同；回复照旧说明脚本未运行 |
| 页面会改写源表单元格却没有事先确认 | 草稿上线前不会写任何单元格；回复写明会改哪些单元格，用户在发布或合并前看得到 |

## 8. 验收

基线（今天实测）：用户原话命中 0/2（WorkBuddy）；点名 HTML View 时草稿前读取约 6.4 万字符，草稿前 1 次阻塞提问，
表格写好到草稿保存约 3.6 分钟（千问办公）。

改动上线后，用同一句用户原话（不点名 HTML View）在 WorkBuddy、千问办公、LobsterAI 各跑两次：

| 指标 | 通过标准 |
| --- | --- |
| 命中 | 6 次都调用 `html_view_create` 并得到草稿，回复以 Workspace 链接为交付物 |
| 草稿前的人工回复 | 0 |
| 草稿前读取的 Skill 与模板 | 不超过约 3 万字符 |
| 表格写好到草稿保存 | 不慢于基线 |
| 观感 | 预览截图与今天的草稿并排比较，不低于它 |
| 风格说明 | 回复写明所选风格和理由 |
| 上线 | 其中一次由用户在浏览器合并 PR，页面自动发布，匿名打开分享链接能看到数据 |

另跑三个场景：6.6 的模糊请求只问一个问题；6.4 的主干数据不开 PR、不提问；
两种不同语境（例如销售周会汇报、项目任务看板）各做一个页面，所选风格与语境相符，且不都是 Night Gauge。

## 9. 实施

一个 PR，三个提交，按顺序：

1. `htmlView.draft` 返回绑定样本，`html_view_create`、`html_view_replace`、`html_view_validate` 描述与 `instructions.ts`。
2. creator、`html-view`、`design.md`、`core` 四份 Skill 与相应测试。
3. 浏览器 Agents 的“换风格”入口与提示词。

验收按第 8 节，在生产部署后执行，结果补到本文末尾。
