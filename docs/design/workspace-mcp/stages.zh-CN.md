# 阶段计划

> 每个阶段都是一个或一组可以独立评审、独立验收的 PR。前一阶段的验收全部通过后，才能开始依赖它的阶段。
> 验收证据一律来自 `verify-uvw` 的真实运行（规格见阶段 A 编写的 `local-verification.zh-CN.md`），不以单元测试通过代替。
> 每个阶段都要满足 [README](README.zh-CN.md) 第 4 节的兼容性标准，下文不再重复。

## 依赖关系

```text
A ──▶ B ──────────────────────┐
│                             │
├──▶ C ──▶ D ──▶ E            │
│          │     │            │
└──▶ F ────┼─────┼────────────┤
           ▼     ▼            ▼
           G（门禁）──────────▶ H ──▶ I（可选）
```

B、C、F 在 A 之后可以并行。G 需要 D、E、F 都完成。H 需要 B 和 G。

## 阶段 A：骨架与本地验证环境

**目标。** 搭起 `apps/mcp` 和本地 Docker 原型，让 `verify-uvw` 能启动 MCP 并调用工具。后续阶段都在这个环境里验收。

**交付物。**

1. `apps/mcp`：
   - `package.json`（private），`src/main.ts` 按 `MCP_ROLE` 选择入口。本阶段只实现 `gateway`，`executor` 和 `renderer` 入口可以先返回未实现。
   - 网关：Streamable HTTP 的 `/mcp` 端点，兼容 2025-11-25 和 2026-07-28 两版协议；`/healthz`；`/metrics`；用量事件（架构文档 8.1 节）。
   - 开发认证模式 `MCP_DEV_SESSION_PASSTHROUGH`（架构文档 4.6 节）。生产环境设置它时拒绝启动。
   - 工具：`whoami`、`repo_list`、`repo_view`。
   - toolset 选择机制（`?toolsets=`），工具注册按 toolset 分目录。
   - `Dockerfile`：一个镜像，三种角色。
   - `docker/compose.verify.yml`：本地验证用的 compose 文件。
   - `AGENTS.md`、`README.md`。
2. `packages/client-core`：C1，`WorkspaceHttp` 区分身份 origin 和传输地址，默认两者相同。
3. `local-verification.zh-CN.md`：动手前先写，说明 Docker 原型的拓扑、容器访问宿主 Workspace 的方式、镜像构建、各命令的行为和证据格式，并经评审。
4. `.agents/skills/verify-uvw`：按上述规格扩展 `up`、`doctor`、`env`、`down`，新增 `mcp` 和 `mcp-tools` 命令，新增 `features/mcp.md`。
5. 仓库文档：根 `AGENTS.md` 的仓库结构、根 `README.md`、`DREAMNUM.md` 写入 `apps/mcp`。

**验收标准。**

- [ ] `VERIFY_UVW_MCP=1 verify-uvw up` 同时启动 Workspace 和 MCP 网关；`doctor` 全部通过，包括 MCP 的检查项。
- [ ] `verify-uvw user` 之后，`verify-uvw mcp whoami whoami '{}'` 返回本次运行的用户，证据文件齐全。
- [ ] `verify-uvw mcp repo-list repo_list '{}'` 的结果与 `verify-uvw cli repo-list repo list --json` 一致，按 [本地验证环境](local-verification.zh-CN.md) 6.6 节比较。
- [ ] opencode（模型 `console-deepseek/deepseek-flash#high`）通过 `verify-uvw env` 给出的目录和命令连上本地 MCP，并调用 `whoami` 成功。附会话记录。
- [ ] 不带 Bearer 的请求得到 401 和 `WWW-Authenticate`。
- [ ] 设置 `NODE_ENV=production` 和 `MCP_DEV_SESSION_PASSTHROUGH=1` 时，网关拒绝启动。
- [ ] 每次工具调用在网关日志里产生一条 `mcp.tool_call` 事件，字段符合架构文档 8.1 节。
- [ ] `verify-uvw down` 之后，MCP 容器、网络、卷全部清理干净，开发者自己的 3020/5173 实例不受影响。
- [ ] CLI 的测试与打包验证通过，产物中没有 `apps/mcp` 的内容。

**需要回填的信息。** Docker Desktop 下容器访问宿主 Workspace 的方式，写回 `local-verification.zh-CN.md`。

**不做。** 内容类工具、执行层、认证改造。

**建议的 PR。** 一个 stack 三层：`client-core` 的 C1；`apps/mcp` 骨架；`verify-uvw` 扩展。

## 阶段 B：产品工具（纯 HTTP）

**目标。** `core` 和 `admin` 中所有不需要 headless Univer 的工具可用，行为与 `uvw` 一致。

**交付物。**

- 工具：`issue_*`、`pr_*`（含 `pr_merge`、`pr_discard`）、`search`、`browse`、`space_browse`、`space_find`、`space_node`、`unit_list`、`unit_add`、`unit_create`、`repo_create`、`repo_edit`、`label_list`、`label_write`、`api_find`、`api_show`、`skills_read`、`resources_*`、`blob_get`。
- skills 作为 MCP resource 提供；server instructions。
- 错误映射（工具规格 1.3 节）、注解（1.4 节）、幂等键（1.5 节）、结果截断与分页（第 5 节）。
- scope 检查的接口。开发认证模式下视为拥有全部 scope，阶段 F 接入真实 scope。
- 对齐测试：对每个工具，同一操作分别经 `uvw --json` 和 MCP 执行，比较结构化结果。测试运行在 `verify-uvw` 上，作为可重复执行的脚本放进 skill 的 `features/mcp.md`。

**验收标准。**

- [ ] 工具规格中列出的每个本阶段工具都有一条 `verify-uvw mcp` 证据。
- [ ] 对齐测试全部通过。有意的差异（工具规格第 4 节）在测试里显式列出。
- [ ] 跑通一次完整的产品旅程：创建 Issue、开 PR、加 Unit、ready、在浏览器里看到 PR 处于 ready 状态（截图）。
- [ ] `tools/list` 在 `core`、`files`、`admin`、`all` 四种组合下返回正确的工具集，顺序固定。
- [ ] 每个工具都有 `outputSchema` 和三个注解。
- [ ] 在 opencode（模型 `console-deepseek/deepseek-flash#high`）里用自然语言完成一次“找到我的 Team Space，新建一个 Issue”的任务。Issue 只存在于 Team Space，Personal Space 会返回 `CONFLICT`。

**不做。** `execute`、`inspect`、导入导出、渲染。

## 阶段 C：`client-core` 多租户改造

**目标。** `client-core` 能被一个同时服务多个用户的宿主使用，CLI 行为不变。

**交付物。** 架构文档 9.1 节的 C2 到 C7：

- C2：运行时 key 加入调用者身份，`resolveCredential` 接收调用者上下文。
- C3：池参数可配置，跨 key 排队。
- C4：子进程环境变量显式传入。
- C5：Office、Markdown、Typst、SVG、HTML View 的 Buffer 或字符串接口。
- C6：Office 交换按操作传入 license。
- C7：导出用量存储目录可配置。

**验收标准。**

- [ ] 新增测试：两个用户先后访问同一个 trunk Unit，分别使用各自的凭据，得到各自的 worker。
- [ ] 新增测试：池满时新请求排队，超时后返回可重试错误。
- [ ] 新增测试：子进程只看到显式传入的环境变量。
- [ ] Buffer 接口与文件路径接口对同一输入产生相同的结果。
- [ ] `pnpm --filter univer-workspace-cli test` 通过；`verify-uvw` 跑一遍 CLI 旅程，结果与改动前一致；打包产物校验通过。
- [ ] `apps/cli` 的源码没有为了这次改动而修改。如果确实需要修改，PR 描述里逐条说明原因，并证明行为不变。

**不做。** 执行层服务本身；安全设计。

**风险。** 运行时池来自 `@univer-cli/*` 发布包。C3、C4 需要的参数如果包里没有，需要向上游 Univer CLI SDK 提需求，阶段 C 的范围相应调整。实施者开工前先读各包的 `dist/index.d.ts` 确认。

## 阶段 D：执行层

**目标。** 执行层作为独立进程运行，提供所有需要 headless Univer 的工具。只在本地原型和内部单用户环境运行（架构文档第 10 节）。

**交付物。**

- `executor` 角色：内部 RPC、worker 池宿主（基于阶段 C）、作业子进程、`/healthz`、`/metrics`。
- 网关到执行层的路由（一致性哈希）、内部令牌、修订号冲突重试。
- 暂存存储（架构文档 5.1 节）和文件端点（5.2 节）。
- 工具：`execute`、`inspect`、`import`、`export`、`file_upload_create`、`job_get`、`blob_upload`、`blob_download`、`blob_replace`、`asset_download`、`html_view_validate`、`html_view_create`、`compile_markdown`、`export_markdown`、`compile_typst`、`compile_svg`。
- C9：凭据获取集中到一个接口后面。
- 长任务（工具规格第 7 节）。
- `compose.verify.yml` 增加 executor 服务。

**验收标准。**

- [ ] 跑通编辑旅程：开 PR，`unit_create` 新建表格，`execute` 写入数据，`inspect` 读回，在浏览器里打开 PR 看到数据（截图）。
- [ ] 跑通导入导出旅程：用签名 URL 上传一个 xlsx，`import`，`export` 为 xlsx，下载并用 `uvw inspect` 或解析结果比对内容。
- [ ] 每个本阶段工具都有对齐测试或证据。
- [ ] 测量并写回架构文档：worker 冷启动时间、热调用耗时、单个 worker 常驻内存、单节点可承载 worker 数。
- [ ] 压测 Workspace Server 在持续 agent 写入下的表现，记录可承受的写入速率，作为阶段 H 限流默认值的依据。
- [ ] 超过 30 秒的导出返回 `job_id`，`job_get` 能拿到结果。用同一个 `idempotency_key` 重试不会产生第二个任务。
- [ ] 下载端点的响应头符合架构文档 5.2 节。
- [ ] 与 Workspace 维护者确定大文件导入的方案（架构文档 7.3 节），结论写回架构文档。方案如需 Workspace 改动，单独开 PR，不阻塞本阶段。

**不做。** 截图、PDF、lint；多用户环境；安全加固。

## 阶段 E：渲染服务

**目标。** 截图、PDF、版式检查可用。

**交付物。**

- `renderer` 角色：常驻浏览器池，每个任务一个 BrowserContext。
- C8：trunk 渲染的图片内联。如需 Workspace 新增按 trunk 读取 Asset 的接口，单独开 PR。
- 工具：`screenshot`、`print_pdf`、`lint`。
- `compose.verify.yml` 增加 renderer 服务。

**验收标准。**

- [ ] trunk 和 Worktree 两种范围的截图都包含图片，与 `uvw screenshot` 的结果目视一致（两张截图并列作为证据）。
- [ ] 小截图以图片内容返回，opencode 的会话记录里能看到 `image` 类型的结果，模型对截图内容的描述与 Unit 内容相符。多页截图返回下载链接。
- [ ] `print_pdf` 生成的 PDF 能打开，页数与 `uvw print-pdf` 一致。
- [ ] 渲染服务的容器没有到 Workspace 的网络路由，渲染仍然成功。
- [ ] 测量浏览器池的单任务内存和吞吐，写回架构文档。

## 阶段 F：Workspace 认证

**目标。** Workspace 支持 MCP 标准的 OAuth 和 PAT，网关接入真实认证与 scope。

**交付物。**

- Workspace Server：架构文档 4.4 节的 F1 到 F10，以及 HTTP contract、数据库迁移和测试。
- Workspace Browser：同意页的 scope 选择；PAT 管理页（列出、创建、吊销）。
- MCP 网关：受保护资源元数据、401 质询、token exchange、下游凭据缓存、scope 检查（架构文档 4.5 节）。
- `verify-uvw`：支持用 PAT 调用 MCP（`verify-uvw mcp-token` 生成一个 PAT 并写入本次运行目录）。

**验收标准。**

- [ ] opencode 对本地 MCP 走完整的 OAuth 流程：发现元数据，CIMD 或 DCR，浏览器同意，拿到 token，调用工具成功。
- [ ] 取消 `worktree:merge` 后，`pr_merge` 返回 `workspace-scope-required`。
- [ ] refresh token 能续期；吊销后，网关在下一次调用时返回 401。
- [ ] PAT 能调用工具；吊销后立即失效；默认全部 scope、不过期（D9）。
- [ ] 现有客户端不受影响：`apps/agent` 的 OAuth 登录、`uvw auth login`、浏览器登录都照常工作。
- [ ] `api:verify` 通过；`verify-db-migration` 的完整矩阵通过。
- [ ] 本地验证默认改用 PAT，开发认证模式只在显式指定时使用。

**不做。** 产品 API 逐路由识别 scope（scope 由网关执行，架构文档 4.2 节）；来源归因（阶段 I）。

**风险。** 各 MCP 客户端实际发送的 `state` 格式可能不符合现有校验（F7）。开工时先用 opencode 实测，再决定放宽方式。

## 阶段 G：执行层安全设计与评审（门禁）

**目标。** 执行层和渲染服务能安全地服务多个互不信任的用户。这是对外开放的门禁。

**交付物。**

1. 一份安全设计文档，放在本目录下，说明如何满足架构文档第 10 节的七条要求。
2. 按设计实现。可能涉及 `apps/mcp`、`packages/client-core`，以及向上游 Univer CLI SDK 提出的改动。
3. 每条要求对应的验证脚本和结果，可以在 `verify-uvw` 上复现。
4. 沙箱运行时（gVisor 或替代方案）下 Univer、原生绑定、Chromium 的兼容性结论。
5. 一名未参与实现的评审者出具的评审结论。

**验收标准。**

- [ ] 第 10 节七条要求每条都有通过的验证结果。
- [ ] 评审结论为通过。
- [ ] C7 上游持久化 license 用量存储已接入并通过重启、崩溃和多副本验证。每次 job 的临时目录不满足此门禁；未通过前不得发布多用户 Office 导出。
- [ ] 阶段 D、E 的全部验收在新设计下重新通过。
- [ ] 性能退化写回架构文档，在可接受范围内（由评审者与产品负责人确认）。

## 阶段 H：SaaS 部署与开放

**目标。** 在 `space.univer.ai` 上对外开放远程 MCP。

**交付物。**

- `dream-num/helm-chart-private` 中三个 release：gateway、executor、renderer（架构文档 3.2 节）。ingress 把 `/mcp` 和 `/.well-known/oauth-protected-resource/mcp` 转发到网关。
- 共享的暂存卷、网络策略、沙箱运行时配置。
- `.github/workflows` 中 MCP 镜像的构建与发布流程，沿用 `push.yml` 的方式。
- 限流：按用户的并发执行数和每分钟写入次数，默认值来自阶段 D 的压测。
- Workspace Browser 的“连接到 AI 助手”设置页：按客户端给出接入方式和 MCP URL，Team Space Owner 默认生成 `core,admin`（D10），提供 PAT 入口。
- Grafana 的 MCP 面板。
- 运维手册写入 `apps/mcp/README.md`：发布顺序、回滚、扩缩容、告警。

**验收标准。**

- [ ] 在 claude.ai、Claude Desktop、ChatGPT、Cursor、VS Code、WorkBuddy 中各完成一次“打开文档、开 PR、写入、ready、在网页上评审”的任务，记录每个客户端的接入步骤和遇到的问题。
- [ ] 各客户端的工具数量、结果大小、超时实测结果写回工具规格。
- [ ] 发布顺序（先 Workspace，后 MCP）和版本检查经过一次真实发布验证。
- [ ] MCP 网关滚动发布期间，进行中的工具调用不出现未知错误（可以返回可重试错误）。
- [ ] 限流触发时，客户端得到可读的错误信息。
- [ ] 用量事件进入日志管道，能按用户、客户端、工具汇总一天的调用量。

## 阶段 I：来源归因（可选）

**目标。** Workspace 的 Space 活动统计能区分 MCP 客户端与 CLI。

**背景。** 活动统计读取的是 `worktrees.created_via` 和 `issues.created_via`（`apps/workspace/server/src/db/schema.sql:213, 613`，`modules/activity/activity.service.ts:109, 125`），
HTTP contract 的计数字段固定为 `browser`、`agent`、`unknown`（`apps/workspace/contracts/http/schemas/activity.yaml`）。
只给 `login_sessions` 加字段不会改变活动统计。

**交付物。** `login_sessions` 记录客户端 ID；`worktrees`、`issues` 记录创建来源的客户端；活动接口与 Browser 展示；HTTP contract；数据库迁移。

**验收标准。** `verify-db-migration` 完整矩阵通过；`api:verify` 通过；浏览器里能看到按客户端区分的活动。

在此之前，MCP 的用量事件（架构文档 8.1 节）是区分客户端的唯一数据来源，已经足够支撑统计需求。
