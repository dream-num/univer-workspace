# 传播回路实施方案

> 状态：实施中，未完成。日期 2026-11-16。第 8 节的问题已于 2026-11-16 决定。
> 本文只做两件事。它给 [Agent Hub 实施规格](../agent-hub/spec.zh-CN.md) 里还没做的功能点排出顺序，并补上规格里没有的传播工作项。
> 规格已写明的功能点（F2.1 到 F2.7、G1 到 G4）不在这里重写，实施时以规格为准。
> 人日估算是编写者的猜测，没有历史数据支撑，按正负五成看待。

## 1. 目标

**愿景。** 把 Univer Workspace（officelab）做成 AI 时代 office 文件协作的基础设施。agent 无缝接入、协作和传播文件，人在节点上审阅和决策。

**本方案的目标。** 让一个文件能自己带来下一个文件。回路是四步：

1. agent 做出文件并发出链接。
2. 人把链接发给别人。
3. 接收者（人或 agent）打开链接。
4. 接收者自己做出一个文件并再次发出链接。

**核心指标。** 传播系数等于“带来源的新文件数”除以“被打开过的分享文件数”，按周统计。来源由 F2.1 的 `nodes.copied_from_node_id` 记录，所以这个数在里程碑 M2 之后才算得出。M2 之前只看漏斗：每次分享带来的打开数，每次打开带来的注册数和访客 agent 数。
目标值在 A2 上线两周、有了基线之后再定，现在不写数字。

## 2. 今天回路断在哪里

| 步骤 | 断点 | 依据 |
| --- | --- | --- |
| 1 做出文件 | 访客 agent 在生产环境能用执行层，但它和所有人共用同一个执行层实例，没有隔离，也没有配额 | 生产和 staging 的 `MCP_EXECUTOR_ALLOWED_USER_IDS` 都是 `*`，执行层只有 1 个副本。见 A1 |
| 1 做出文件 | 创建访客 agent 限每 IP 每小时 5 个。生产没设 `TRUST_PROXY`，Workspace 又在代理之后，所以很可能全站共用这 5 个名额 | `apps/workspace/README.md:417-418`。见 A1 |
| 3 打开 | agent 发出的链接没有品牌条，不显示作者，链接预览没有图 | `share` 返回 `/nodes/<id>`（`packages/client-core/src/urls.ts:7`）。品牌条只在 `?view=immersive` 渲染（`apps/workspace/web/src/modes/workspace-layout.tsx:69`）。`static-site.ts` 不注入 `og:image` |
| 3 打开 | agent 抓取链接只拿到单页应用的空壳 | `apps/workspace/server/src/middleware/static-site.ts` 只注入标题和 Open Graph |
| 4 再做一个 | 没有复制、Remix、交给我的 Agent | 全仓库检索无实现。规格 F2.1、F2.3 待实施 |
| 4 再做一个 | 访客 agent 的文件无法认领，30 天无访问即暂停 | `agents.owner_user_id` 从未被写入。规格 F2.2 待实施 |
| 全程 | 没有任何度量。算不出打开数、注册来源和传播系数 | `users` 表没有来源列。服务端只有 `http_request_duration_seconds` 一个指标 |

## 3. 里程碑与排期

周次按自然周，W1 从 2026-11-16 起。W7 含元旦，留作缓冲和验收。

| 里程碑 | 周次 | 截止 | 内容 | 退出条件 |
| --- | --- | --- | --- | --- |
| M0 接通与度量 | W1 到 W3 | 12-04 | A1 到 A6 | 生产配置下，一个从未连接过的 MCP 客户端凭一句话做出带公式的表并返回链接。仪表盘上能看到这次运行带来的分享、打开和访客 agent 计数 |
| M1 落地页 | W1 到 W2 | 11-27 | B1 到 B4 | 无痕窗口打开 agent 发出的 Sheet 链接，能看到作者、品牌链接、交给我的 Agent 和举报。把链接贴进聊天软件，预览带图 |
| M2 链接即安装器 | W2 到 W6 | 12-25 | C1 到 C3，C5 到 C7 | 规格 5.2 的验收全部通过，外加 C7：一个没有任何 Workspace 配置的 agent 只凭“交给我的 Agent”复制出的文字，做出衍生文件并发出新链接，新文件记录了来源 |
| 缓冲 | W7 | 01-01 | M2 的修复与复验 | M2 退出条件在生产配置下复验通过 |
| M3 Pages 与发现 | W8 到 W9 | 01-15 | C4，D2 到 D6 | C4、D2 到 D6 各自的验收通过，或写明推迟原因 |

M0 和 M1 并行。M1 不依赖执行层开放，可以先交付。

## 4. 分配视图

假设有四条泳道：Server、Web、MCP（含 Client Core 和 CLI）、Ops。前三条各一人全职，Ops 兼职。人数不同的话，按第 6 节的依赖关系重排，不要拆散同一个工作项。

| 周 | Server | Web | MCP | Ops |
| --- | --- | --- | --- | --- |
| W1 11-16 | A2 服务端计数，B1 接口 | B3，B2 | A3 的 G1，A4，A2 网关字段 | A1 |
| W2 11-23 | A5，B4，C3 探查 | B1 页眉，B4 图片，A5 | A3 的 G2 和 G3 | A2 仪表盘，A3 的 G4 |
| W3 11-30 | C1 服务端 | C1 认领页和 Agents 设置页 | A3 验收，C1 的 `claim` 和 `uvw claim` | A3 验收后部署 staging 一次（见 Q5） |
| W4 12-07 | C2 | C1 收尾，M1 复验 | A6，C6 | |
| W5 12-14 | C3 | C3 的复制入口 | C3 的 `from` | |
| W6 12-21 | C5 | C3 的 Remix 和“保存我的版本”，C5 | C5，C7 | M2 验收后部署 staging 一次 |
| W7 12-28 | 缓冲 | 缓冲 | D2 | |
| W8 01-04 | C4，D3，D4 | C4 页眉，D4，D3 | C4 的 `html_view_publish`，D3 | |
| W9 01-11 | D6 探查 | D5 原型 | | |

各泳道合计：Server 约 26 人日，Web 约 21 人日，MCP 约 19 人日，Ops 约 7 人日。

## 5. 工作项

每个工作项是一个 PR 或一个 PR stack。标了规格编号的，功能点和验收以规格为准，这里只写增量。
通用约束见规格第 2 节。另加一条：规格写于 PostgreSQL 支持合入之前，现在 schema 变更要同时覆盖 `apps/workspace/server/src/db/sqlite` 和 `db/postgres`，当前 `user_version` 是 21。

### M0 接通与度量

**A1 核实生产配置。** Ops，0.5 人日。不改代码。

- 查清 `space.univer.ai` 上四个值：`MCP_EXECUTOR_ALLOWED_USER_IDS`、`TRUST_PROXY`、是否开放注册、`AGENT_CREATE_LIMIT_PER_HOUR`。
- 验收：四个值写回本文第 8 节。已于 2026-11-17 完成，`TRUST_PROXY` 和 `AGENT_CREATE_LIMIT_PER_HOUR` 都没设。
- 后续：`TRUST_PROXY` 的值是 Workspace 前面会追加 `X-Forwarded-For` 的代理层数。生产在 CloudFront 和 Istio 之后，helm 仓库里查不到层数。先在 staging 的入口网关访问日志里数一次请求的 `X-Forwarded-For` 条目，设好后用两个不同出口 IP 验证各自计数，再由操作者决定是否改生产。设大了，客户端可以伪造来源 IP 绕过限流。

**A2 回路埋点。** Server 2 人日，MCP 1 人日，Ops 1 人日。依赖：无。

- 不加表，不引入分析 SDK。沿用现有两样东西：`apps/workspace/server/src/middleware/metrics.ts` 的 prom-client，和 `mcp.tool_call` 那样的 pino 结构化日志。
- 服务端加四个计数器，每次计数同时写一条带 `node_id` 的日志事件供下钻：
  - 链接分享被打开或关闭，标签是主体类别和角色。计数点在 Link Sharing 的写入。
  - 分享页被请求，标签是读者是否带会话、所有者的主体类别。计数点在 `static-site.ts` 的 `/nodes/:nodeId` 处理，也就是 `recordAgentPageView` 所在的位置。
  - 注册成功，标签是登录方式和来源。`returnTo` 指向 `/nodes/` 记为 `share_link`，指向 `/api/auth/authorize` 记为 `oauth_consent`，其余记为 `direct`。
  - 访客 agent 被创建，标签是入口（`/api/agents` 或 `/api/auth/guest`）。
- 网关的 `mcp.tool_call` 事件加 `principal_kind`，`share` 调用带上 `node_id`。同步 `apps/mcp/README.md` 里的事件合同。
- `observability/` 里加一块仪表盘，回答五个问题：本周新开了多少分享，其中多少来自 agent，分享页被打开多少次，带来多少注册，新建了多少访客 agent。
- 已知偏差：聊天软件的链接预览爬虫也会请求分享页。日志事件带 User-Agent，仪表盘先按原始值展示并注明。
- 验收：用 `verify-uvw` 跑一遍“访客 agent 做表并分享，无痕窗口打开，从分享页注册”，五个数各自加一。

**A3 把 agent 隔离到自己的执行层池。** 规格第 7 节 G1 到 G4。MCP 8 人日，Ops 2 人日。依赖：无。这是整个方案里最大的一项。

生产已经对所有人开放执行层（A1），所以这一项的作用从“开放”变成“隔离和限额”：零成本的访客 agent 今天和人共用一个执行层实例。

- 顺序是 G1 测量，G2 agent 专用池，G3 执行配额，G4 部署检查。G1 测的是生产上已经存在的风险。结果是“A 的脚本读得到 B 的会话”时立即报告操作者。
- G2 要处理现有的 `*`：今天用执行层的人在 G2 之后照常能用，agent 改进 agent 池。会让人和 agent 进同一个池的生产配置要拒绝启动。
- 增量：`apps/mcp/src/gateway/instructions.ts` 今天在执行层受限且主体是 agent 时，会同时说“不能编辑”和“合并后分享”。改成受限时只说不能编辑，不要求分享空文件。
- 验收：规格第 7 节的验收。

**A4 `share` 的返回值和说明文字。** MCP 1.5 人日。依赖：无。

- `share` 今天的文本内容只有 `share completed.`（`apps/mcp/src/gateway/server.ts:224`）。改成一段交接说明：链接、谁能打开、哪天过期。C1 合入后再加认领链接。
- 目标是 `.univer.html` 时，返回的 `url` 用 `?view=immersive` 的地址，与分享对话框一致。
- `describeAccess`（`packages/client-core/src/html-view.ts:189-222`）只看 Space 是否公开，访客 agent 的空间不能公开，所以它总是报告来源 Sheet 是私有的。改成把 Link Sharing 算进去。
- 服务端说明文字加一句适用场景：用户要一份给别人打开的表格、文档或幻灯片时，在这里创建并返回链接。
- 验收：访客 agent 的一次真实运行里，模型交给用户的话包含链接和过期日期。`tools/list` 对人主体逐字不变。

**A5 访客 agent 用客户端名命名。** Server 1 人日，Web 0.5 人日。依赖：无。

- 登录页的访客卡片今天不传 `label`，agent 一律叫 `agent-xxxx`（`apps/workspace/web/src/features/auth/guest-agent-card.tsx`）。`returnTo` 里有 OAuth 的 `client_id`，服务端据此取客户端名作为 `label`。
- 验收：从 Claude Code 走访客入口，同意页和 `whoami` 显示的名字含客户端名。B1 的作者行因此有意义。

**A6 文档对齐。** MCP 0.5 人日。

- `docs/design/agent-hub/README.zh-CN.md` 和 `spec.zh-CN.md` 的状态行还写着未实现，阶段 1 已随 #402 到 #406 合入。改状态行，并在规格里标出阶段 2 的顺序以本文为准。

### M1 落地页

**B1 分享页页眉。** 规格 F2.3 去掉 Remix 的部分。Server 1.5 人日，Web 3 人日。依赖：A5（可并行，命名晚到不阻塞）。

- 非所有者读到的节点摘要要带出作者的显示名、主体类别和是否已认领。今天这些只对所有者可见，要改 HTTP contract 并跑 `api:verify`。
- 页眉在所有访客视图都显示，不限于沉浸模式。内容是作者、未验证标记、品牌链接、举报按钮。
- “Made with Univer Workspace”今天是纯文字（`apps/workspace/web/src/modes/visitor-bar.tsx:53-54`）。改成指向 `https://github.com/dream-num/univer-workspace` 的链接。页眉放得下时，再露出 `https://space.univer.ai`（Q4）。
- 举报按钮调用已有的 `POST /api/nodes/:nodeId/reports`。
- 验收：规格 5.2 最后一条。外加：无痕窗口打开访客 agent 的 Sheet 链接（非沉浸），页眉四项都在。

**B2 注册后的出口。** Web 1 人日。依赖：无。

- 访客从沉浸模式的品牌条注册后，回到 `?view=immersive`，页面没有顶栏，也没有回首页的入口。动手前先用 `verify-uvw` 复现，这一条来自读代码，没有运行过。
- 验收：从分享页注册的新用户，一次点击能到自己的首页。

**B3 交给我的 Agent。** Web 1.5 人日。依赖：无。

- 页眉和品牌条各加一个按钮，点击后复制一段提示词。提示词含三样：这个链接，本实例的 MCP 地址，以及没有 MCP 时的 CLI 做法（安装 `univer-workspace-cli` 后运行 `uvw auth guest`）。
- 不做深链，不加服务端接口。MCP 地址的取法沿用 `apps/workspace/web/src/modes/repository/shell/home-tools.tsx`。
- 验收：把复制出的文字贴进一个已连接 MCP 的 agent，它第一步用 `read` 加 `trunk: true` 读到内容。

**B4 链接预览图，静态版。** Server 0.5 人日，Web 1 人日。依赖：无。

- 按类型各备一张 1200 乘 630 的图（Sheet、Doc、Slide、Page、文件夹），`static-site.ts` 按节点类型注入 `og:image`，`twitter:card` 改为 `summary_large_image`。
- 内容相关的截图是 D6，不在这里做。
- 验收：`static-site.test.ts` 覆盖五种类型。把生产链接贴进 Slack 和微信各一次，预览带图。

### M2 链接即安装器

规格 5.3 的 PR stack 把复制排在最前。本文改成先认领和卡片，再复制。原因是复制需要 schema 迁移，还可能依赖上游 SDK，风险最高。它的探查提前到 W2 做，实现排在 W5。

**C1 认领。** 规格 F2.2。Server 3 人日，MCP 1.5 人日，Web 3 人日。依赖：无。

- 增量：`share` 对未认领 agent 的返回值带认领链接和一句“打开它可以长期保留这个文件”。
- 验收：规格 5.2 的两条认领验收。

**C2 Agent 卡片。** 规格 F2.4。Server 4.5 人日。依赖：无。

- 增量一：卡片的“接着做”一段写明无账号的接入方法，也就是 MCP 地址的访客入口和 `uvw auth guest`。
- 增量二：加 `/llms.txt`，内容是 MCP 地址、`POST /api/agents` 和 CLI 访客路径。今天这个地址返回单页应用的外壳。
- 验收：规格 5.2 的卡片和注入两条。外加：`curl <origin>/llms.txt` 返回纯文本。

**C3 复制与 Remix。** 规格 F2.1，以及 F2.3 的 Remix 按钮。Server 5 人日（含 W2 的 1 人日探查），MCP 1.5 人日，Web 2.5 人日。依赖：B1。

- 迁移到 v22 时一并加上 F2.5 的 `unverified_role`，以及 D3 的制作说明列（Q2 已定要做）。
- 增量一：页眉显示这个文件被复制的次数。
- 增量二：HTML View 的试算提示条（`apps/workspace/web/src/features/html-views/html-view.tsx:148-150`）今天没有任何入口。加一个“保存我的版本”，已登录时调用复制，未登录时走注册再复制。
- 验收：规格 5.2 的复制一条。外加：访客在页面里改过数字后点“保存我的版本”，注册完成后得到自己的副本。

**C4 agent 发布 Pages。** 规格 F2.6。Server 2 人日，MCP 1 人日，Web 1 人日。依赖：B1 的页眉。

- Q1 定下的主打顺序是 Sheet、HTML View、Slide、Doc。Sheet 的回路不需要这一项，所以它移到 M3 的第一项。
- 验收：规格 5.2 的 Pages 两条。

**C5 链接分享的“未验证”一档。** 规格 F2.5。Server 1 人日，MCP 0.5 人日，Web 1 人日。依赖：C3 的迁移。

**C6 `space_browse` 带链接状态。** 规格 F2.7。MCP 0.5 人日。

**C7 端到端验收。** MCP 1.5 人日。依赖：B3、C1、C2、C3。

- 用 `verify-uvw` 的 `story` 记录三次真实模型运行，并留在验收证据里：
  1. 访客 agent A 凭一句话做出表并分享。
  2. 一个没有任何 Workspace 配置但有 shell 的 agent B，输入只有 B3 复制出的文字。它读到卡片，以访客身份接入，复制、修改并发出新链接。
  3. A 的主人认领后链接不变。
- 通过条件：B 的新文件的 `copied_from_node_id` 指向 A 的文件。仪表盘上分享、打开、访客 agent 三个数与运行次数一致。

### M3 发现

**D1 目录上架。** 不做（Q3）。`docs/design/workspace-mcp/README.zh-CN.md:65` 的“不提交连接器目录”保持不变，官方 MCP Registry 也暂不提交。

**D2 Skill 更新。** MCP 1 人日。依赖：无。

- 本仓库的 `skills/univer-workspace-cli/SKILL.md` 已有访客路径，补上 MCP 地址。
- `dream-num/skills` 仓库里的 `univer-workspace-cli` 和 `build-with-univer` 不归本仓库所有。本方案只改本仓库的 Skill，不向那个仓库提交。

**D3 制作说明。** Server 1 人日，MCP 0.5 人日，Web 1 人日。依赖：C3 的迁移。

- `share` 接受一段可选的、由 agent 自己写的制作说明，有长度上限。它显示在页眉的折叠区里，访客可以复制去给自己的 agent 用。
- 这段文字是作者提供的内容，在 Agent 卡片里只能出现在带“未经核实”标注的预览段。

**D4 嵌入。** Server 1 人日，Web 2 人日。依赖：B1。

- 给匿名只读视图一个明确的可嵌入地址和 `frame-ancestors` 策略，分享对话框给出 iframe 代码，嵌入视图带一行署名。
- 今天 `/nodes/*` 没有设置任何防嵌入的响应头，这是读代码得出的，没有在生产验证。动手前先确认，并让已登录的可编辑视图保持不可嵌入。

**D5 “Open in Univer” 徽章。** Web 3 人日。先做原型。

- 一个 `/new?import=<文件地址>` 入口，可以做成徽章贴在 README 里。浏览器取文件后走现有的导入，不让服务端去抓任意地址。
- 原型要回答两个问题：常见来源的跨域读取是否可行，以及登录这一步放在取文件之前还是之后。原型不成立就放弃，不改成服务端抓取。

**D6 内容相关的预览图。** Server 3 人日。先做探查。依赖：A3。

- 用渲染服务给分享页生成首屏截图作为 `og:image`。今天 MCP 的 `screenshot` 不支持 HTML View，探查先回答 Page 能不能截。

## 6. 依赖关系

- A1 最先做，它决定 A3 的紧迫程度和限流是否已经在误伤。
- A2 不依赖任何项，越早上线基线越长。
- B1 到 B4 互不依赖，也不依赖 A3。
- C1、C2 互不依赖。C3 依赖 B1 的页眉来放 Remix 按钮。C5、D3 依赖 C3 的迁移。
- C7 依赖 B3、C1、C2、C3。
- D6 依赖 A3。C4 依赖 B1。

## 7. 度量定义

| 指标 | 定义 | 来源 | 可用时间 |
| --- | --- | --- | --- |
| 分享数 | 一周内被打开链接分享的节点数，按主体类别分 | A2 的计数器 | M0 |
| 打开数 | 一周内分享页被请求的次数，按是否带会话分 | A2 的计数器 | M0 |
| 注册转化 | 来源为 `share_link` 的注册数除以无会话的打开数 | A2 的计数器 | M0 |
| 访客 agent 数 | 一周内新建的访客 agent 数，按入口分 | A2 的计数器 | M0 |
| 认领率 | 已认领 agent 数除以访客 agent 数 | `agents.claimed_at` | M2 |
| 传播系数 | 带来源的新文件数除以被打开过的分享文件数 | `nodes.copied_from_node_id` 和 A2 的日志事件 | M2 |

## 8. 待核实与待决定

**生产配置（A1）。** 来源是操作者对私有 helm 仓库的核对。

| 项 | 值 | 核实日期 |
| --- | --- | --- |
| 生产的 `MCP_EXECUTOR_ALLOWED_USER_IDS` | `*`，网关和执行层都是。staging 相同。执行层 1 个副本 | 2026-11-17 |
| 生产的 `TRUST_PROXY` | 未设置。Workspace 1 个副本，进程内限流不受多实例影响 | 2026-11-17 |
| 生产是否开放注册 | 已开放。GitHub、Google 和邮箱验证码登录已开，密码登录关闭 | 2026-11-17 |
| 生产的 `AGENT_CREATE_LIMIT_PER_HOUR` | 未设置，使用代码默认 5 | 2026-11-17 |

**已决定（2026-11-16）。**

| 编号 | 问题 | 决定 | 影响 |
| --- | --- | --- | --- |
| Q1 | 主打哪种产物 | 按优先级依次是 Sheet、HTML View、Slide、Doc | C4 移到 M3。B4、C3、D6 的验收先覆盖 Sheet |
| Q2 | 是否做制作说明 | 做，可选，由 agent 自述 | D3 保留，C3 的迁移带上制作说明列 |
| Q3 | 是否重开“不提交连接器目录” | 暂不上架，不重开 | D1 不做 |
| Q4 | 品牌链接指向哪里 | `https://github.com/dream-num/univer-workspace`，放得下时再露出 `https://space.univer.ai` | B1 |
| Q5 | 何时部署 | 验收完成后可以部署 staging，不部署 prod。优先在本机验证，staging 只在里程碑验收后各部署一次 | 本方案不触碰 prod |
| Q6 | 人力 | 由 agent 按工作项执行，人负责合并 | 第 4 节的泳道只用于估算 |

A1 需要读私有 helm 仓库，由能访问它的人完成。

## 9. 风险

| 风险 | 落在哪一项 | 负责人盯什么 |
| --- | --- | --- |
| Agent 卡片把陌生 agent 写的内容交给另一个 agent，注入的指令会沿链接扩散 | C2、D3 | 规格 5.2 的注入验收必须过。文件内容只出现在带标注的预览段 |
| 零成本身份在我们的域名下发布仿冒页面 | C4 | 未认领 agent 的 Page 只在带页眉的外壳里打开，独立地址返回 403 |
| 封禁靠运维手动执行，举报只落表 | B1 | 指定一个人每天看 `node_reports`。量大到看不过来再做后台 |
| G1 的测量显示执行层里一个主体读得到另一个主体的会话 | A3 | 这是生产上已经存在的风险。立即报告操作者，由操作者决定是否先收紧生产的白名单 |
| 复制需要上游 Collaboration SDK 的新能力 | C3 | W2 的探查给出结论。需要上游改动时停下来说明，不在本仓库复制上游合同 |
| 访客的浏览器会话 7 天后失效，人失去对文件的访问 | C1 | C1 不晚于 W4 合入 |
| 限流计数在进程内存里，多实例时各算各的 | A1 | 单实例部署下不处理。扩成多实例前先解决 |
| 链接预览爬虫抬高打开数 | A2 | 仪表盘注明。看趋势时用日志事件按 User-Agent 排除 |
| 自部署要用内部 npm 源和有域名限制的许可证，开源社区难以自行传播 | 不在本方案内 | 记录在此，另行决定 |

## 10. 不做

- Hub、公开画廊和 agent 主页（规格阶段 4）。等有了传播系数的基线和举报处理流程再排。
- 委托会话的 `confirmUrl` 和 Team Space 链接分享（规格阶段 3）。
- 邮件邀请非用户、通知邮件。
- 第三方分析 SDK、新的度量表。
- 新的 MCP 工具集、一次完成的 `create` 工具、服务端旁路的读写路径。
- HTML View 的静态导出或数据快照，根 `AGENTS.md` 禁止。
- 人机验证。
- 发布、部署和推镜像。生产上的开关由操作者执行。
