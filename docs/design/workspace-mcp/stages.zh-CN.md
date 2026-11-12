# 阶段计划

> 每个阶段都是一个或一组可以独立评审、独立验收的 PR。前一阶段的验收全部通过后，才能开始依赖它的阶段。
> 验收证据一律来自 `verify-uvw` 的真实运行（规格见阶段 A 编写的 `local-verification.zh-CN.md`），不以单元测试通过代替。
> 每个阶段都要满足 [README](README.zh-CN.md) 第 4 节的兼容性标准，下文不再重复。

## 依赖关系

```text
A ──▶ B ─────────────────┐
│                        │
├──▶ C ──▶ D ──▶ E ──────┤
│                        │
└──▶ F ──────────────────┤
                         ▼
                  G0 受信用户先行开放 ──▶ H ──▶ I（可选）
                         │
                         ▼
                  G 执行层多租户隔离（已搁置）
```

B、C、F 在 A 之后可以并行。G0 第一步需要 B、D、F，第二步需要 E。H 需要 G0 第一步，首次开放时执行层只对白名单用户开放。
对公众开放执行层和渲染服务需要 G，G 已搁置，以后基于 G0 的执行后端协议重新设计。

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

阶段 F 的验收全部满足，依赖它的阶段 G 可以开始。（2026-11-09 补记：G 已搁置，F 之后进入 G0。）

**不做。** 产品 API 逐路由识别 scope（scope 由网关执行，架构文档 4.2 节）；来源归因（阶段 I）。

**风险。** 各 MCP 客户端实际发送的 `state` 格式可能不符合现有校验（F7）。开工时先用 opencode 实测，再决定放宽方式。

## 阶段 G0：受信用户先行开放与执行后端协议

**背景。** 原阶段 G 想在 MCP 自己的代码里，把一个执行层容器做成多个用户共用、彼此隔离的环境。设计稿是 PR #267，
它为此引入了凭据代理、命名空间包装器、进程树采样、每用户配额等机制。产品负责人评审后认为复杂度过高，于 2026-11-09 搁置
（见 #267 的评论）。G0 取代原 G 中“开放给真实用户”这一半：网关对所有用户开放，执行层先只对白名单内的受信用户开放，沿用现在的共享常驻实现。
原 G 中“执行层和渲染服务多租户隔离”这一半没有被 G0 取代，仍然搁置。对公众开放仍然需要它，以后基于本阶段的协议另行设计。

三类组件的信任关系不同，这是本阶段拆分的依据：

| 组件 | 运行什么 | G0 中的状态 |
| --- | --- | --- |
| 网关 | 我们的代码：MCP 协议、认证、产品工具、文件进出 | 第一步开放 |
| 脚本执行与转换（`execute`、`inspect`、import、export、Markdown、Typst、SVG、HTML View） | 模型生成的代码，以及处理不可信数据的我们的代码 | 第一步只对白名单用户开放；对公众开放需要隔离，倾向于由平台按租户隔离 |
| 渲染（截图、PDF、lint） | 我们的代码，处理不可信数据 | 第一步可以不部署，第二步接入 |

**目标。**

1. 第一个可验收版本是“网关加执行层”：白名单用户在生产配置下能完成“找文件、开 PR、`execute` 写入、`inspect` 读回、ready”的完整任务，其他用户能使用全部纯 HTTP 工具。渲染服务可以不部署，此时依赖它的工具不出现。
2. 网关与执行后端（执行层、渲染服务）之间有一份与部署形态无关的协议。常驻型后端现在实现并通过 D、E 的全部验收。
   serverless 型后端以后按同一份协议接入，不修改网关的工具代码。

### 第一步：网关加执行层，执行层只对白名单用户开放

**交付物。**

1. 执行层白名单 `MCP_EXECUTOR_ALLOWED_USER_IDS`，值为逗号分隔的 Workspace 用户 ID。它只限制谁能使用执行层，不限制谁能使用网关。
   - 网关认证之后检查用户 ID。白名单内的用户得到部署的全部可用操作。不在白名单内的用户得到空的操作集合，看到的工具与没有执行层的部署相同，纯 HTTP 工具照常可用（产品负责人 2026-11-09 决定）。
   - 不在白名单内的用户，server instructions 说明这个账号不能修改文档内容，请用户在浏览器里修改。
   - 执行层读取同一个变量，拒绝白名单之外的 grant。这是网关检查之外的第二道检查，两个角色的配置不一致时以更严格的一方为准。
   - `NODE_ENV=production` 时，执行层只在设置了白名单时接受 session grant，替换 `shared/config-executor.ts` 中“生产环境一律拒绝”的规则。网关在生产环境配置了执行层、却没有设置白名单时拒绝启动。开发认证在生产环境仍然被拒绝。
   - 非生产环境不设置白名单时，所有用户都能使用执行层，本地验证保持不变。
   - 执行层没有多租户隔离，这就是白名单存在的原因。`apps/mcp/README.md` 写明：加入白名单的用户能在共享执行层里看到彼此的脚本环境，只能加入互相信任的用户。
2. 能力发现。
   - 执行层提供 `GET /rpc/v1/capabilities`，返回协议版本和它能处理的操作名。只有配置了 `MCP_RENDERER_URL` 时才声明 `screenshot`、`print_pdf`、`lint` 所需的 `render.*` 操作。
   - 网关在启动和就绪检查时读取能力，算出可用操作集合。版本不兼容的执行层不计入集合。
3. 网关只列出当前部署能完成的工具。
   - 每个工具声明它依赖的后端操作（`shared/executor-protocol.ts` 的操作名）。依赖不满足的工具不进入 `tools/list`，调用时与不存在的工具一样处理。
   - 没有渲染服务时隐藏 `screenshot`、`print_pdf`、`lint`。`compile_svg` 保留，改用估算量字，与带 `estimate_text_size` 的行为一致，工具描述写明这一点。
   - 没有执行层时隐藏全部 14 个依赖执行层的工具（13 个直接调用执行层，加上只取回任务结果的 `job_get`）。这种部署不是本步骤的验收目标，只由单元测试覆盖。
   - 每种 toolset 组合下的工具顺序固定，等于完整列表去掉被隐藏的工具。有执行层和渲染服务时，`tools/list` 与改动前完全相同。
4. server instructions 按当前连接实际可见的工具生成。
   - 不提及不可见的工具。
   - 连接没有选择 `files` 时，说明哪些能力需要 `?toolsets=files`（#256 的 P1：`core,admin` 连接里模型找不到 `print_pdf`）。只提部署中真正可用的能力。
   - Skills 由 MCP 专用 core 与 `apps/cli/skill-data` 的九个共享领域 Skill 组成，通过 Skills 扩展和 skills_read 读取同一内置 catalog。skills_read 另实时发现个人空间和 repo 指定的成员仓库中 `.agents/skills` 的自定义 Skill，返回来源、调用开关和诊断，文本按清单分页读取，二进制仅列元数据。自定义 Skill 不进入扩展。MCP core 负责操作与工具绑定；工具不在当前连接列表时，告诉用户该步骤不可用。
5. 就绪检查 `GET /readyz`。`/healthz` 仍然只表示进程存活。网关就绪需要同时满足：
   - 经 `WORKSPACE_TRANSPORT_URL` 访问 Workspace 的 `/healthz` 成功；
   - 配置了 OAuth 时，网关的机密客户端能做 token exchange：用网关的客户端凭据、不带 subject token 调用 token 端点，得到 `invalid_request` 才算通过。Workspace 的授权服务器元数据只列出 `authorization_code` 和 `refresh_token`，不能用来判断；
   - 配置了执行层时，至少一个执行层返回了兼容的能力。

   Workspace 版本接口暂不做（产品负责人 2026-11-09 决定）。[架构 3.2](architecture.zh-CN.md#32-saas-拓扑) 中按版本号拒绝就绪的要求暂缓。
6. 文档。
   - `apps/mcp/README.md` 开头的状态说明改为当前事实。Roles and limits 一节改写为白名单与能力发现的现状，并说明生产部署需要哪些变量。
   - `apps/mcp/AGENTS.md` 中“Stage G 通过前只能在本地或内部单用户环境使用”改为“生产环境中执行层只对白名单内的受信用户开放”。
   - 架构文档第 10、11 节同步更新：第 10 节的七条要求仍然是对公众开放的门禁，G0 用白名单替代它，而不是满足它。
7. 本地验证。
   - `verify-uvw` 增加不启动渲染服务的模式，`doctor` 在这种模式下不检查渲染服务。
   - 新增 MB 旅程，写入 `features/mcp.md`：在不启动渲染服务的模式下，对 `core`、`files`、`admin`、`core,files`、`core,admin`、`files,admin`、`all` 七种组合各取一次 `tools/list`，与预期列表逐项比较；检查 server instructions 不出现被隐藏的工具名；不在白名单内的第二个用户看到的工具列表与没有执行层时相同，纯 HTTP 工具照常可用，调用 `execute` 与调用不存在的工具一样失败；Workspace 停止时 `/readyz` 变为未就绪，恢复后变为就绪。

**验收标准。**

- [x] 网关和执行层在 `NODE_ENV=production`、OAuth 和白名单配置下正常启动，不部署渲染服务，`/readyz` 返回就绪。去掉白名单时，网关和执行层都拒绝启动；加上 `MCP_DEV_SESSION_PASSTHROUGH=1` 时网关拒绝启动。 证据：PR #271、#274、#276、#277，run g0acc2：`doctor` 无 FAIL，两个容器都是 `NODE_ENV=production`、没有开发认证、没有渲染服务容器；用本次镜像 `docker run` 的三种错误配置都以非零退出并指出对应变量；以真实 Workspace 为后端，正确的网关客户端密钥下 `/readyz` 为 200，错误密钥为 503 并指出 `token_exchange`。
- [x] 在上述生产配置下，opencode（模型 `console-deepseek/deepseek-flash#high`）用 OAuth 登录，以自然语言完成“找到表格、开 PR、写入数据、读回、ready”，在浏览器里看到 PR 中的数据（截图）。 证据：run g0cli（`782a4024`）：同意页上 `worktree:merge` 默认不勾选，一次中文请求依次调用 `space_find`、`pr_create`、`unit_add`、`execute`、`inspect`、`pr_ready`、`browse`，11 条用量事件都是 `auth_kind: oauth`、`outcome: ok`；`uvw` 读回 PR #3 为 ready，A1:B4 为表头加 华北 42、华东 57、华南 31；`oauth-pr-ready-rows-full.png` 显示 Ready 标记和这三行。此后的改动只涉及 `/readyz` 与 verify-uvw，不在这条路径上。
- [x] MB 旅程通过。 证据：run g0acc2 的 MB1–MB5：七种组合的工具列表与脚本中逐项写出的预期一致；instructions 不含被隐藏的工具名；不在白名单内的第二个用户得到 40 个工具，`execute` 与未知工具一样失败，instructions 说明不能修改文档内容；MX1–MX3 通过；执行层停止时重建网关，`/readyz` 从 200 变为 503 并指出 `executor`，执行层恢复后回到 200。
- [x] 不启动渲染服务时，阶段 A、B、D、F 的旅程通过：M、MI、MP、MS、MR1–MR8、MX、MH、MM、MT、MV（估算量字部分）、MA、MO 各组。 证据：run g0acc2 在同一个栈上连续执行，87 条中 81 条按原文通过，包括 MA8 的 Workspace Agent 登录；5 条按 skill 的说明不适用：M7（需要渲染服务，由 MB1 覆盖）、MA5 与 MX14（需要开发认证）、MX13（需要两个执行层副本）、MV2（真实字体量字）。MO3 的原文会关闭并重建专用的 `cimd` 运行，与连续执行冲突，它的启用与禁用检查用文档中的脚本分别在 g0acc2 和 g0job 上通过。Typst 任务旅程在 `MCP_SYNC_BUDGET_MS=1` 的 g0job 上通过，`user` 重建网关后预算仍为 1。
- [x] 启动渲染服务时，`tools/list` 与改动前完全相同，B 的 toolset 验收原样通过。 证据：PR #271 的独立验证（`6bc05b34`）：七种组合的工具名称与顺序与 `origin/main` 一致，除 `compile_svg` 外 53 个工具的 schema 与注解逐字节一致；run g0def（`782a4024`）：默认栈 `all` 为 54 个工具、顺序与注册表一致，MR10、MV2 通过。
- [x] CLI 的测试与打包验证通过（如果改动涉及 `packages/client-core`）。 不适用：第一步没有修改 `packages/client-core`。

**验收记录（2026-11-10，`verify-uvw` run g0acc2、g0job、g0cli、g0def，HEAD `62d237df`，g0cli 与 g0def 为 `782a4024`）。** 第一步的验收全部满足。验收中发现并已修复：

- `/readyz` 原先在授权服务器元数据里找 token exchange，但 Workspace 的元数据只列出 `authorization_code` 和 `refresh_token`，所以每个真实部署都不就绪。现在改为用网关的客户端凭据、不带 subject token 调用 token 端点，得到 `invalid_request` 才算通过，密钥配错时网关也不就绪（PR #276）。
- verify-uvw 读容器日志时使用 1 MiB 的默认缓冲区，长时间运行后每次记录调用都失败；现在所有同步的 `docker` 调用都设置 `maxBuffer`，并有测试防止回归。另修正了三个过短的 Typst 幂等键、`user` 重建网关时丢失 `MCP_SYNC_BUDGET_MS`、MS11 截图视口过小（PR #277）。

仍然存在、但不阻塞第一步的事项：

- MO3 的原文要求专用运行，不能与其他旅程连续执行；
- 执行层没有多租户隔离，白名单只能加入互相信任的用户；对公众开放执行层仍然需要阶段 G。

### 第二步：执行后端协议

**交付物。**

1. 协议文档 `backend-protocol.zh-CN.md`，放在本目录下，经过评审。它把现有的执行层和渲染服务协议写成正式规格，并逐项说明哪些假设会挡住 serverless 型实现：
   - **操作目录。** `opSpecs` 本身就是协议：schema、读写效果、限额、路由键、预算、重试策略。它与传输方式无关。
   - **能力发现。** 写入第一步实现的能力端点：后端声明协议版本和操作，网关据此计算可用操作集合。渲染服务同样声明自己的能力，执行层据此决定是否声明 `render.*`。
   - **调用语义。** 同步调用必须带截止时间。长任务的状态由网关持有，后端无状态。协议不依赖后端进程长期存活。
   - **路由与正确性。** 路由键只是性能提示。任何实例都能正确处理任何请求（[架构 6.3](architecture.zh-CN.md#63-路由与状态) 已满足）。
   - **负载。** 小负载内联。大负载允许按引用传递（预签名地址或暂存对象 ID），协议声明各自的上限。常驻型继续内联，协议只预留引用方式，本阶段不实现。
   - **重试与幂等。** 保持每个操作声明的重试策略。后端和平台都不得自行重试写操作。提交阶段结果不确定时返回 `workspace-result-unknown`。
   - **调用者凭据。** 协议只定义“调用者凭据”字段，不限定类型。今天是 session grant，以后可以换成 Workspace 签发、只对本次目标有效的凭据。白名单检查属于部署策略，不写进协议。
   - **认证。** 按调用方向区分凭据：网关到执行层、执行层到渲染服务各用各的令牌，不再共用 `MCP_INTERNAL_TOKEN`。协议只要求被调用方能验证调用方，serverless 型可以改用平台签名。
   - **截止时间与取消。** 截止时间是协议字段。能否中途取消是实现的能力，协议不保证。
   - **错误信封与版本。** 写入现有信封。网关遇到不兼容的后端版本时，不把该后端计入可用操作集合和路由。网关启动后记录到过兼容的执行层就一直就绪，从未记录到时不就绪，这样先发布网关会停住滚动发布，先发布执行层只暂时隐藏工具（2026-11-10 修订，见 [执行后端协议 3.3](backend-protocol.zh-CN.md#33-就绪)）。
   - **执行层调用渲染服务。** 保持为后端内部的事，网关不编排。协议文档说明这一点。
   - **将来的 serverless 实现思路。** 只记录思路，不做设计：按租户隔离的平台能力（AWS Lambda tenant isolation、阿里云函数计算的实例隔离和会话隔离）、负载上限对按引用传递的要求、同一镜像的部署方式、平台隔离解决不了的部分（脚本仍然持有用户 session）、环境变量可见、网络与配额、冷启动、取消和平台自动重试。
2. 按调用方向拆分内部令牌。本地验证和 compose 同步更新。
3. 协议契约测试：一套任何后端实现都必须通过的测试，覆盖能力发现、帧格式、版本不兼容、错误信封、截止时间、写操作不重试、认证拒绝。今天在常驻型执行层和渲染服务上运行，将来接入 serverless 型时直接复用。

**实现原则。** 抽象的单位是线上协议，加网关里的一个后端客户端模块。不为“可插拔”造只有一个实现的插件框架，本阶段不写 serverless 适配器。

**验收标准。**

- [x] 协议文档包含上列各项，经一名未参与编写的评审者评审通过。 证据：PR #280。两名对抗评审者（Opus、Sonnet）对照代码运行复现，经复核成立的发现中，五项是产品缺陷，由 PR #282 修复（执行层先发布会使所有网关不就绪、截止时间在慢上传之后才开始、`content.execute` 进队列前超时报告“可能已提交”、已提交写入的结果过大时要求重试、一致性检查放过重复执行写入的后端），其余是文档与代码不符，已改正。第三名评审者（Sonnet）复核修订稿，11 项中 10 项确认解决，剩下一项是令牌规则的状态标记，已改为“已实现”。执行层排空时空闲 keep-alive 连接被重置、写入可能得到 `workspace-result-unknown`，记为已知问题，不在本阶段。
- [x] 协议契约测试在常驻型执行层和渲染服务上通过。 证据：PR #282 的 `apps/mcp/test/contract/`；验收运行（HEAD `8e8bf74b`）中进程内 45 个检查全部通过；用 `apps/mcp/dist/main.js` 单独启动的执行层和渲染服务按黑盒方式各通过 14 个检查，其余 16 个因需要受控依赖、网关副本或另一方向的令牌而跳过并写明原因。
- [x] 后端声明的协议版本与网关不兼容时，该后端被排除；网关从启动起没有兼容的执行层时 `/readyz` 返回 503，就绪之后执行层改报不同版本时工具隐藏、`/readyz` 仍为 200（契约测试证据）。 证据：`apps/mcp/test/contract/gateway.test.ts` 的三种情形（两个执行层中一个不兼容、从启动起不兼容、就绪后改报版本）在同一次验收运行中通过。
- [x] 常驻型下，阶段 D、E 的全部旅程原样通过，包括 MX、MH、MM、MT、MV、MR9–MR12。 证据：run g0s2 在同一个带渲染服务的栈上连续执行，26 条适用旅程全部按原文通过，MX13 需要两个执行层副本，不适用；MR12 用 `console-deepseek/deepseek-flash#high`，模型的回答写出图中全部单元格和四色位置，两页 Slide 返回下载链接；Typst 任务旅程在 `MCP_SYNC_BUDGET_MS=1` 的 g0s2job 上通过。同一次运行中停掉渲染服务后 39 秒，网关不再列出 `screenshot`、`print_pdf`、`lint`，`compile_svg` 保留；渲染服务恢复后 61 秒三者回来，随后截图成功。第一步的生产形态 g0s2p 上 MB1–MB5 再次通过。
- [x] 如果改动涉及 `packages/client-core`，CLI 的测试与打包验证通过，行为不变（[README](README.zh-CN.md) 第 4.1 节）。 不适用：第二步没有修改 `packages/client-core`。

**验收记录（2026-11-10，`verify-uvw` run g0s2、g0s2job、g0s2p，HEAD `8e8bf74b`）。** 第二步的验收全部满足，阶段 G0 完成。各次运行的日志中没有 session、PAT、OAuth token、两个内部令牌、OAuth secret 或 license，`down` 清理完毕。

仍然存在、但不阻塞 G0 的事项：

- 执行层排空时空闲 keep-alive 连接被重置，网关不把重置算作“没有送达”，执行层滚动重启时个别写入可能得到 `workspace-result-unknown`（[执行后端协议 3.1](backend-protocol.zh-CN.md#31-能力端点)）；
- 渲染服务晚于执行层启动、或停机后恢复时，网关最多约一分钟后才重新列出渲染工具；
- 按引用传递负载、按目标限定的凭据、serverless 后端都是预留项，没有实现；
- 执行层没有多租户隔离，对公众开放执行层仍然需要阶段 G。

**不做。**

- 执行层和渲染服务的多租户隔离（原阶段 G 的这一半，已搁置）。对公众开放执行层需要它。
- Workspace 版本接口。
- serverless 后端的设计、原型与实现。
- Workspace 签发按目标限定的凭据。协议只在凭据字段上留出位置。
- SaaS 部署本身，包括镜像发布、Helm、ingress、限流、“连接到 AI 助手”设置页、各客户端实测。这些属于阶段 H。

**建议的 PR。** 第一步一个 stack：能力发现与按能力决定工具可见性、instructions；白名单与生产配置；`/readyz`；`verify-uvw` 无渲染服务模式与 MB 旅程，以及文档。第二步先单独提交协议文档，评审通过后再提交令牌拆分、契约测试两个 PR。

## 阶段 G：执行层安全设计与评审（已搁置）

> 2026-11-09 搁置，设计稿 PR #267 转为 draft。开放改由 [阶段 G0](#阶段-g0受信用户先行开放与执行后端协议) 先行，执行层只对白名单内的受信用户开放。
> 下文的多租户隔离要求仍然有效：执行层和渲染服务在满足架构文档第 10 节之前，不对公众开放。
> 新的隔离方案以后基于 G0 的执行后端协议设计，倾向于由平台按租户隔离，届时重写本节。
> #267 的威胁模型、附录 A 的 gVisor 实测、附录 B 的 Workspace 路由清单、附录 C 的实验和 14.1 节的评审记录仍可参考。

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

首次开放时执行层只对白名单用户（G0 第一步），部署 gateway 和 executor 两个 release 以及共享暂存卷，渲染服务可以晚些加入。沙箱运行时与面向公众的隔离配置，在 G 重新设计并通过后再做。

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

**部署记录（2026-11-10，镜像 `sha-82be1c84`）。** 网关和执行层已部署到 staging 与 prod，渲染服务在同一天随后加入，限流按产品负责人决定延后。
部署形态没有新建 Helm release，而是照 Workspace 的方式在 `dream-num/helm-chart-private` 增加 `deploy/colla-workspace-mcp/`：
`push.yml` 用同一个 tag 构建两个镜像（#284），dispatch workflow 先发布 Workspace，等它就绪后再发布 MCP（helm-chart-private#376、#377）。

- staging（`workspace.univer.plus`）：执行层白名单为 `*`（#283，内部用户）。401 质询、两份元数据、`/readyz`（workspace、token_exchange、executor）通过；
  opencode 经 CIMD 完成 OAuth；`console-deepseek/deepseek-flash#high` 以一句自然语言完成新建表格、开 PR、`execute`、`inspect`、ready，网关用量事件全部是 `auth_kind: oauth`。
- prod（`space.univer.ai`）：白名单只有产品负责人一个账号（helm-chart-private#378）。暂存目录使用新建的加密 EFS（静态 NFS PV）。同样的检查和旅程全部通过。
- 事故：prod 首次发布时 MCP Pod 按 `biz-intensive` 偏好落到唯一的 c5.xlarge 节点，该节点上其他 Pod 的 memory request 远低于实际用量，
  MCP 加入并滚动一次后节点内存耗尽，失联约 14 分钟，Workspace 与同节点的其他服务不可用，重启实例后恢复。prod MCP 改为只调度到通用节点、
  memory request 按实测设置（helm-chart-private#379），Workspace 改到独占节点。staging 集群 CPU request 接近用满，staging MCP 的 sidecar CPU request 降为 10m。
- 渲染服务：两个环境都是 1 个副本、2 个 runtime，memory request 3Gi、limit 3.5Gi（架构 7.1.1）。两个集群都不执行 NetworkPolicy，
  所以用 Istio `Sidecar`（`REGISTRY_ONLY`，出站只到 `istio-system`）阻止它访问 Workspace 和公网。
  prod 调度到通用节点（helm-chart-private#380），opencode 对一个 Worktree 中的表格截图，图片以内联内容返回，模型读出的单元格与表格一致。
  staging 的共享节点实际内存已用 76–92%，渲染服务与 Workspace 一起固定在新加的 `colla-workspace` 专用节点上（4 核 16 GiB，helm-chart-private#381，镜像 `sha-97b83a8e`）。
  在 staging 验证：渲染服务 Pod 访问 Workspace、公网和执行层都被拒绝；执行层能力端点声明 `render.screenshot`、`render.printPdf`、`render.lint`；
  opencode（`console-deepseek/deepseek-flash#high`，OAuth）对一个 trunk 表格的整表截图返回下载链接（2112×7920，约 8 MB），区域截图以内联内容返回，
  模型读出的表头与数据和 `inspect` 结果一致，网关和渲染服务各有对应记录。执行层先于渲染服务就绪时首次能力读取失败，随后自动恢复（G0 已知问题）。
  `print_pdf` 和 `lint` 在 `files` toolset 中，需要以 `?toolsets=files` 或 `all` 的 URL 重新 OAuth 授权，staging 上尚未经 MCP 调用验证。
- 未做：上面的六项验收；不在白名单内的用户在 prod 上的行为只由本地 MB 旅程覆盖；“连接到 AI 助手”设置页、Grafana 面板、限流、运维手册；两个环境上 `print_pdf`、`lint` 经 MCP 的调用。

## 阶段 I：来源归因（可选）

**目标。** Workspace 的 Space 活动统计能区分 MCP 客户端与 CLI。

**背景。** 活动统计读取的是 `worktrees.created_via` 和 `issues.created_via`（`apps/workspace/server/src/db/schema.sql:213, 613`，`modules/activity/activity.service.ts:109, 125`），
HTTP contract 的计数字段固定为 `browser`、`agent`、`unknown`（`apps/workspace/contracts/http/schemas/activity.yaml`）。
只给 `login_sessions` 加字段不会改变活动统计。

**交付物。** `login_sessions` 记录客户端 ID；`worktrees`、`issues` 记录创建来源的客户端；活动接口与 Browser 展示；HTTP contract；数据库迁移。

**验收标准。** `verify-db-migration` 完整矩阵通过；`api:verify` 通过；浏览器里能看到按客户端区分的活动。

在此之前，MCP 的用量事件（架构文档 8.1 节）是区分客户端的唯一数据来源，已经足够支撑统计需求。
