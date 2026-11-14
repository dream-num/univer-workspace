# html-view-creator：内置的页面创作流程

状态：方向已确定，分期实施中。日期 2026-11-14。

[返回集成概览](README.md)

## 要解决的问题

用户的数据已经在 Sheet 里，想快速做出一个绑定实时数据的页面。今天这件事只有 Agent 能做，而且有三处慢或容易出错：

- 流程靠 prose 约束。先问风格、从模板开始、不在页面里重算公式，这些规则散落在 html-view Skill、core Skill、
  server instructions 和工具描述里，模型会跳过。一次 DeepSeek Flash 验收就跳过了模板（见[分享与观感改进方案](sharing-and-design-floor.md)）。
- 回合多，返工晚。原流程先问风格并结束一轮，再读 Sheet；用哪些数据、哪些单元格会被页面改写，用户直到预览才看到。
- 人没有入口。Browser 的“新建”菜单没有页面，Pages 空状态让用户去下载桌面 Agent，已发布页面也没有“让 Agent 修改”。

## 设计

`html-view-creator` 是网关内置、用户可调用的 Skill（`apps/mcp/skills/html-view-creator/`），与 `skill-creator`
走同一套机制：`/` 菜单列出它，`/html-view-creator` 把正文放进这条用户消息，core Skill 的路由句让模型在用户只说
“做个页面”时也读它。

它只负责**顺序**，不复制**写法**。绑定语法、十种风格、模板和设计下限仍只在 HTML View Skill 里，creator 用
`skills_read` 按需读取。这样同一条规则只有一处来源。

流程：

1. 判断任务：新建、修改已有页面、只换风格。
2. 读数据：用 `outline`、`read`、`find` 读来源 Sheet，记下 unitId、子表 ID、表头、数据区域和增长空间、公式单元格、
   可编辑单元格。同时问清谁会打开页面，需要公开链接时用 `repo_view` 提前检查仓库是否公开。
3. 一轮确认：同一条回复给出页面的一句话描述、数据计划表（每块内容用哪块区域，读还是写）、风格提问和可见范围，然后结束本轮。
4. 写页面并用 `html_view_validate` 对照数据计划检查。
5. 用 `html_view_create` 或 `html_view_replace` 保存草稿，交出 `previewUrl`。
6. 用 `html_view_draft_get` 跟进草稿状态，发布后才交出 `shareUrl`。

与原流程的差别是第 3 步：先读 Sheet，再把风格和数据计划放在同一轮问。用户少答一轮，绑错区域在写几百行 HTML 前就能被发现。
HTML View Skill 的 `design.md` 同步改成这个顺序。

范围只限网关：`uvw` CLI 直接发布，DSH Agent 用自己的 Skill 分叉，两者都没有草稿卡片。

## 分期

| 期 | 内容 | 改动面 |
| --- | --- | --- |
| 1 | creator Skill、core 路由、保留名、HTML View Skill 的提问顺序 | `apps/mcp`、`apps/cli/skill-data/html-view`、Skill 草稿扫描的保留名 |
| 1 | Browser 入口：Agents 页接受预填的 prompt；Pages 空状态、HTML View 工具栏、Sheet 工具栏一键进入 `/html-view-creator` | `apps/workspace/web` |
| 2 | `validate` 返回每个绑定的子表名、示例值和单元格类型，让 Agent 对照数据计划 | client-core、MCP、CLI |
| 2 | 草稿卡片“要求修改”带理由；新草稿作废同一会话的旧草稿 | Server、Browser、HTTP contract |
| 3 | 会话内的风格画廊卡片 | Browser、MCP |
| 3 | 渲染检查（运行时错误与截图），先做原型比较浏览器隐藏渲染与服务端无头渲染 | 待原型决定 |

另有几项与 creator 无关的 Browser 修复，各自开 PR：绑定页面不显示“Open standalone”、绑定错误文案与来源状态、
分享对话框提示来源 Sheet 的可见性、Apps 与 Pages 的命名统一。
