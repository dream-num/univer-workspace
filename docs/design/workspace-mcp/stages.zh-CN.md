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

- [x] 跑通编辑旅程：开 PR，`unit_create` 新建表格，`execute` 写入数据，`inspect` 读回，在浏览器里打开 PR 看到数据（截图）。 证据：PR #219–#232，`verify-uvw` MX1–MX6，含 PR 浏览器截图。
- [x] 跑通导入导出旅程：用签名 URL 上传一个 xlsx，`import`，`export` 为 xlsx，下载并用 `uvw inspect` 或解析结果比对内容。 证据：PR #219–#232，MX7–MX9 的上传、导入、导出和内容比对。
- [x] 每个本阶段工具都有对齐测试或证据。 证据：PR #219–#232，MH、MM、MT、MV 对齐旅程及 MX1–MX15。
- [x] 测量并写回架构文档：worker 冷启动时间、热调用耗时、单个 worker 常驻内存、单节点可承载 worker 数。 证据：[架构 6.2](architecture.zh-CN.md#62-worker-池) 的冷、热调用和内存预算表。
- [x] 压测 Workspace Server 在持续 agent 写入下的表现，记录可承受的写入速率，作为阶段 H 限流默认值的依据。 证据：[架构 3.3](architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力) 的持续写入和读回结果。
- [x] 超过 30 秒的导出返回 `job_id`，`job_get` 能拿到结果。用同一个 `idempotency_key` 重试不会产生第二个任务。 证据：PR #219–#232，MX10–MX15 的 job、幂等重试、故障恢复旅程。
- [x] 下载端点的响应头符合架构文档 5.2 节。 证据：PR #219–#232，MX7–MX9 下载头断言及 `apps/mcp/test/staging.test.ts`。
- [ ] 大文件导入方案延后。产品负责人决定移至后续阶段，当前保留 900 KiB 序列化 UnitData 上限。候选方案与边界见[架构 7.3](architecture.zh-CN.md#73-大文件导入的限制)。

**不做。** 截图、PDF、lint；多用户环境；安全加固。

## 阶段 E：渲染服务

**目标。** 截图、PDF、版式检查可用。

**交付物。**

- `renderer` 角色：长驻的 runtime 池（每个 runtime 一个 Chromium），跨任务复用。这是对每任务一个 BrowserContext 的临时偏离（2026-11-09 产品负责人决定，阶段 G 收口，见[架构 7.1](architecture.zh-CN.md#71-渲染服务)）。
- 真实字体的 SVG 文字测量：`compile_svg` 在不带 `estimate_text_size` 时由渲染服务量字（产品负责人决定 2026-11-09）。
- C8：trunk 渲染的图片内联。如需 Workspace 新增按 trunk 读取 Asset 的接口，单独开 PR。
- 工具：`screenshot`、`print_pdf`、`lint`。
- `compose.verify.yml` 增加 renderer 服务。

**验收标准。**

- [x] trunk 和 Worktree 两种范围的截图都包含图片，与 `uvw screenshot` 的结果目视一致（两张截图并列作为证据）。 证据：PR #235（trunk 图片内联）、#237，`verify-uvw` MR10 的 `mr10-side-by-side-worktree.png` 与 `mr10-side-by-side-trunk.png`（CLI 在上，MCP 在下，四色图和单元格文字一致），MR11 的 Sheet 并列图覆盖打印路径。
- [x] 小截图以图片内容返回，opencode 的会话记录里能看到 `image` 类型的结果，模型对截图内容的描述与 Unit 内容相符。多页截图返回下载链接。 证据：MR12（`console-deepseek/deepseek-flash#high`）。会话记录里 `verify-uvw.screenshot` 调用完成，结果是文本加一个 `image/png` 的 `file` 片段（opencode 对 MCP `image` 块的表示），模型的回答写出 `Aurora Kettle`、`KT-48213`、`77` 和红绿蓝黄四象限的位置，与解码出的图一致；同一旅程里两页 Slide（共 6.4 MB）返回两个下载链接且没有图片片段，MR10 下载的页面是 1920×1080 PNG。多页 Doc 的截图是一张高图，约 4 页以上超过像素上限，`uvw screenshot` 同样失败，是上游行为，见下文已知问题，所以多页下载链接用 Slide 验收。
- [x] `print_pdf` 生成的 PDF 能打开，页数与 `uvw print-pdf` 一致。 证据：PR #238，MR11（Doc 在 Worktree 和 trunk 各 5 页、Sheet 各 1 页，与 CLI 页数一致，`pdfinfo` 打开，并列图目视一致）；同一旅程还验证 `lint` 与 CLI 的发现一致。
- [x] 渲染服务的容器没有到 Workspace 的网络路由，渲染仍然成功。 证据：PR #236，MR9 与 `doctor`（renderer 只加入 `internal: true` 网络，没有 published port，`host.docker.internal:3925` 与公网主机都 `blocked`），在这个拓扑下 MR9、MR10、MR11、MR12 的渲染全部成功。
- [x] 测量浏览器池的单任务内存和吞吐，写回架构文档。 证据：[架构 7.1.1](architecture.zh-CN.md#711-容量测量2026-11-09)：冷、热延迟，1、2（补充 4）个 runtime 的吞吐与限制因素，每个 runtime 的内存与容器预算（2 GiB 下 OOM，3 GiB 通过），200 次复用渲染的内存序列，以及复跑命令。
- [x] 真实字体的 SVG 文字测量（交付物之一，不在原验收清单内）。 证据：PR #239，MV2（与 `uvw compile-svg` 结构一致，估算模式对照，Slide 页面截图无溢出，55 行量字客户端墙钟 378 ms，网关记录约 150 ms）。

**验收记录（2026-11-09，`verify-uvw` run e6，启动 HEAD `239e433e`）。** MR9、MR10、MR11、MV2 在当前 `main` 上按文档原样逐条通过，MR12 新增为可重复旅程。验收中发现的问题没有在本阶段修复，列在架构 [7.1.2](architecture.zh-CN.md#712-已知问题与后续)，每条给出触发条件：

- 故障后的请求迟迟不应答，被丢弃 runtime 的浏览器还会存活约 2 分钟（页面进程被杀或容器 OOM 时复现）；
- 回收守卫：200 次渲染内没有增长，暂不加，给出重测阈值；
- renderer 进程经 `shared/errors.ts` 间接加载 client-core 产品模块，import 边界测试只检查直接导入；
- Chromium 空闲时死亡后，最多 `RENDERER_MAX_RUNTIMES` 次调用先失败再得到新 runtime；
- 冷启动 runtime 不能被中断，deadline 短于冷启动的请求在启动结束后才失败；
- Sheet 默认截图范围不包含网格外的图片；
- Doc skill 的示例使用 SDK 没有的 `api.Enum.DocsImageWrappingStyle`；
- Doc 截图约 4 页以上超过像素上限，CLI 同样失败（上游行为）；
- 内存预算没有覆盖大输入。

## 阶段 F：Workspace 认证

**目标。** Workspace 支持 MCP 标准的 OAuth 和 PAT，网关接入真实认证与 scope。

**交付物。**

- Workspace Server：架构文档 4.4 节的 F1 到 F10，以及 HTTP contract、数据库迁移和测试。
- Workspace Browser：同意页的 scope 选择；PAT 管理页（列出、创建、吊销）。
- MCP 网关：受保护资源元数据、401 质询、token exchange、下游凭据缓存、scope 检查（架构文档 4.5 节）。
- `verify-uvw`：支持用 PAT 调用 MCP（`verify-uvw mcp-token` 生成一个 PAT 并写入本次运行目录）。

**验收标准。**

- [x] opencode 对本地 MCP 走完整的 OAuth 流程：发现元数据，CIMD 或 DCR，浏览器同意，拿到 token，调用工具成功。 证据：PR #214、#216、#253，run f6 的 MO1：当前 opencode 发现授权服务器支持 CIMD 后，以 `https://opencode.ai/oauth/opencode/client.json` 为 `client_id` 登录，同意页显示 `opencode (opencode.ai)` 并取消 `worktree:merge`，回调只授予 `read write publish`，`whoami`、`repo_list` 各一条 `auth_kind: oauth`、`outcome: ok` 的用量事件，`client_id` 是该 URL。DCR 由 MO2、MO4 证明（run f5 的 MO1 也走 DCR）。
- [x] 取消 `worktree:merge` 后，`pr_merge` 返回 `workspace-scope-required`。 证据：run f6 的 MO2（OAuth token 能 `pr_create`、`unit_create`、`pr_ready`，`pr_merge` 和 `pr_discard` 返回 `workspace-scope-required`，用量事件记录同一错误码，CLI 看到 PR 仍是 `ready`，随后全 scope 的 PAT 合入成功）；MA7 对不含 `worktree:merge` 的 PAT 得到同样结果。
- [x] refresh token 能续期；吊销后，访问 Workspace 的下一次调用返回 401，不访问 Workspace 的调用最多 30 秒内仍由网关缓存回答（措辞于 2026-11-09 由产品负责人改定，见架构 4.2 节）。 证据：run f6 的 MO2：refresh 返回新的一对 token，scope 不变，`expires_in` 为 3600，新 access token 可用；吊销后紧接着的 `whoami`、`api_find` 退出码为 0（缓存窗口内，`mcp-oauth2-revoked-*.exit-observed`），第一次访问 Workspace 的 `repo_list` 返回 401 并带 `resource_metadata`，随后 `whoami` 也是 401，refresh token 返回 `invalid_grant`；超过 60 秒宽限期重放旧 refresh token 会吊销整个授权。MO3 对 CIMD 客户端（Claude Code）得到同样的续期与吊销结果。
- [x] PAT 能调用工具；吊销后访问 Workspace 的调用立即失效，不访问 Workspace 的调用最多 30 秒内仍由网关缓存回答（措辞同上）；默认全部 scope、不过期（D9）。 证据：run f6 的 MA1（默认用 PAT，`auth_kind: pat`）；MA6 中 API 列出的默认 PAT 有四个 scope、`expiresAt` 为 `null`，Browser 新建表单默认勾选四个 scope、过期时间为 Never，在 Browser 创建的 PAT 能经网关调用工具，吊销后紧接着的 `whoami` 退出码为 0（缓存窗口内），随后访问 Workspace 的调用返回 401；MA4 吊销后连续两次访问 Workspace 的调用都是 401；PAT 换取的下游 session 保留四个 scope，`expires_in` 为 600。
- [x] 现有客户端不受影响：`apps/agent` 的 OAuth 登录、`uvw auth login`、浏览器登录都照常工作。 证据：PR #252 修复 Agent 启动失败（#246，缺陷在上游 DSH 0.1.5-rc.1：自定义 profile 默认的 live patch 监听在 HMR 服务注册前就开始；本仓库的 profile 改为启动时应用 patch，与 Desktop 一致）。run f6-ma8 的 MA8：`agent-up` 按 README 的构建步骤安装并启动 Agent，Agent 的 Workspace 登录进入 `univer-workspace-harness` 的同意页，批准后显示 `Connected: Verify f6-ma8`、服务地址为本次运行的 Workspace，并能列出该用户的 Personal Space；同一次运行里 Browser 注册与登录、`uvw auth login --password-stdin`、Browser 批准的 `uvw auth login`、错误密码用例都通过。
- [x] `api:verify` 通过；`verify-db-migration` 的完整矩阵通过。 证据：在 `72e6d781` 上 `api:verify` 退出 0 且工作区无改动；源码与 `--dist` 的 schema parity 对 12 个历史 schema 全部 `ok`；V17→V18 矩阵覆盖 skill 第 3 步的全部七项（`apps/workspace/test/support/v17-migration-checks.ts`），集成用例与 `test:production-import` 通过；`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。审计中发现的 data-model 表数笔误由 PR #244 修正。此后的 #251、#253 不改 schema，各自的 `api:verify` 退出 0，#253 的 `test:production-import` 通过。
- [x] 本地验证默认改用 PAT，开发认证模式只在显式指定时使用。 证据：PR #247；`user` 默认创建 PAT，`verify-uvw mcp` 不带 `--auth` 时用 PAT（MA1 的 `auth=pat`），只有 `--auth dev` 才走开发认证（MA5）；run f6 中 M11 的 opencode 事件是 `auth_kind: pat`。
- [x] token 不透传，下游凭据短时效（交付物之一，不在原验收清单内）。 证据：run f6 的 MO2 `direct` 把 OAuth access token 直接作为 Bearer 和 cookie 发给 Workspace，`/api/session` 都是未登录；token exchange 返回的下游 session 为 600 秒，scope 与 token 一致（MO2、MA6）；生产环境拒绝开发认证（M10）。
- [x] Client ID Metadata Documents（F2，交付物之一，不在原验收清单内）。 证据：PR #253，设计与两轮对抗评审见 [cimd.zh-CN.md](cimd.zh-CN.md)。run f6 的 MO3：授权服务器元数据声明 `client_id_metadata_document_supported` 与 `authorization_response_iss_parameter_supported`；以 Claude Code 的真实文档登录，同意页显示 `Claude Code (claude.ai)`，回调带 `iss`，token、refresh、吊销都符合预期；VS Code 的真实文档进入同意页，多出的 `device_code` 被忽略；IPv4 与 IPv6 loopback 字面量、解析到 loopback 的域名、带 query 的 URL、`client_id` 与文档不符（主机名大写）都在 Workspace 上返回 400，不重定向；未登录访问不触发抓取；`MCP_CIMD_ENABLED=0` 时不声明支持且不抓取。本机 DNS 是 fake-IP，运行只为 Workspace Server 豁免 `198.18.0.0/15`。
- [x] 不带点的私有 scheme 回调（交付物之一，不在原验收清单内）。 产品负责人 2026-11-09 决定只放行白名单里的 scheme，目前只有 Cursor 用的 `cursor`。证据：PR #251，run f6 的 MO4：Cursor 原样的三个回调注册返回 201，`myapp://callback` 返回 400，`cursor://` 回调的同意页 CSP 含 `form-action 'self' cursor:`，拒绝与批准都重定向到该回调并带 `iss`，授权码兑换得到一小时的 access token 和 refresh token。

**验收记录（2026-11-09，`verify-uvw` run f6 与 f6-ma8，`main` `2ec43c08`）。** M4、M10、M11、MA1–MA8、MO1–MO4 全部通过，每次运行的 `doctor` 无 `FAIL`，`down` 清理完毕，证据中没有 token、授权码或 cookie。按文档原样执行时发现三处旅程文档缺陷，都不是产品问题，已在本次变更中修正：MO3 用 `--reuse` 重启后需要重新导出环境变量，否则其后的 M11 用到已删除的 opencode 目录；MA8 添加 Space 后导航会多次重新挂载，`Files` 标签页的点击改为重试；auth.md 仍写着 Browser 批准的登录不在范围内。

仍然存在、但不阻塞阶段 F 的事项：

- 吊销后最多 30 秒的缓存窗口是接受的取舍，见架构 4.2 节；
- 用户看不到、也不能吊销已授权的 AI 助手，只有客户端自己能调用吊销端点。管理入口属于 F11（“连接到 AI 助手”，阶段 H）；
- CIMD 不在 refresh 时重新抓取文档，文档撤下后已签发的 refresh token 最长仍可续期 30 天（[cimd.zh-CN.md](cimd.zh-CN.md) 第 7 节）；
- 上游 DSH 的 HMR 竞态与 `cordis-plugin-hmr` 版本错配仍在，本仓库已不依赖它们；`packages/dsh-runtime` 的 README 说 `pnpm deploy --legacy` 遵守 committed lockfile，实测不遵守；
- `apps/mcp` 的 `exchange-hardening` 测试有两个偶发超时（#250、#254），与阶段 F 的改动无关。

阶段 F 的验收全部满足，依赖它的阶段 G 可以开始。

**不做。** 产品 API 逐路由识别 scope（scope 由网关执行，架构文档 4.2 节）；来源归因（阶段 I）。

**风险。** 各 MCP 客户端实际发送的 `state` 格式可能不符合现有校验（F7）。开工时先用 opencode 实测，再决定放宽方式。

## 阶段 G：执行层安全设计与评审（门禁）

**目标。** 执行层和渲染服务能安全地服务多个互不信任的用户。这是对外开放的门禁。

**交付物。**

1. 一份安全设计文档，放在本目录下，说明如何满足架构文档第 10 节的七条要求。设计稿见 [security.zh-CN.md](security.zh-CN.md)，待评审。
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
