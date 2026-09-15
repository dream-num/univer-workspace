# dsh-univer-work 基础形态与 Workspace CLI 能力迁移研究

## 研究范围

- 日期：2026-08-27
- 问题：Workspace CLI 的 Agent 能力能否完整迁移为 `dsh-univer-work` 提供的 DSH tools 与 DSH skills。
- Univer Workspace 基线：commit `081a8e7f30141b3d1dbb4a2200db426b56bfdb28`
- DeepSeek Harness 基线：commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，`0.1.1-rc.2`
- 输入：`docs/research/univer-workspace-cli-implementation.md`、`docs/research/deepseek-harness-plugin-development.md`，并重新核对两个本地源码快照。
- 本文只记录可行性与限制，不创建 proposal，不实现代码。

## 2026-08-28 状态核对

Univer Workspace 已推进到 commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`。原研究识别的代码复用阻点已经解除：private workspace package `@univerjs/univer-workspace-client-core` 通过根入口和 `./worker` subpath 导出共享能力，CLI 已作为第一个 consumer 从 package exports 组合这些能力。Client Core 仍不单独发布；`apps/dsh-univer-work` 必须在自己的可安装 artifact 中携带运行依赖与资源闭包。证据见 `packages/client-core/package.json:1-20`、`packages/client-core/README.md:3-35`、`packages/client-core/src/index.ts:1-173`、`apps/cli/src/program.ts:17-33,94-168`、`apps/cli/src/runtime/daemon.ts:3-29` 和 `apps/cli/src/runtime/worker.ts:1`。

Client Core 的最终审计记录了 453/453 Core tests、69/69 CLI tests、仓库 typecheck/test/build、CLI packaging 与隔离安装 smoke 全部通过；真实环境补充 QA 也覆盖 auth、Space/Node、Worktree/Unit、runtime、Blob/Asset、Office、Typst、screenshot、SVG 与 layout lint。证据见 `docs/quality/client-core/client-core-extraction-final-audit.md:11-46` 和 `docs/quality/client-core/client-core-extraction-real-environment-qa.md:1-46`。

## 结论

Workspace CLI 的产品能力可以由 `dsh-univer-work` 覆盖，且当前代码已经具备同仓直接复用的 private Client Core 边界。

能力可行的依据是：CLI 通过 Workspace HTTP、Collaboration endpoint 和已发布 Univer CLI SDK 工作，没有只有 Commander 才能访问的 Server 能力。DSH Host plugin 同样运行在 Node.js 中，可以持有 Workspace client、headless runtime pool、worker、浏览器渲染器，并把操作注册为 tools。

CLI 发布物仍是 bin-only application，不能作为插件 library 使用；但同仓插件无需导入 CLI。Workspace 认证协议、HTTP adapter、Space、Worktree、Unit、Blob、Asset、runtime target、content runtime、Office、Typst、render、lint 与 SVG workflow 已由 `packages/client-core` 的 package exports 提供。`apps/dsh-univer-work` 应直接消费该 private package，不能导入 `apps/cli/src/*`。

因此需要区分三个结论：

1. DSH Skills 可以完整迁移。八份现有 Skill 的 frontmatter 与名称符合 DSH skill registry；内容知识可以保留，CLI 命令示例需要改成 DSH tool 调用。
2. DSH Tools 可以覆盖完整业务能力。直接 HTTP 操作迁移简单；内容执行、inspection、Office exchange、截图、layout lint、Typst 与 SVG 需要继续携带 headless runtime、worker、原生依赖和浏览器资源。
3. 完整原生迁移不再受 Workspace 代码所有权阻挡。剩余工作是 DSH Client Shell 的 manifest、Cordis lifecycle、Credentials、tool schema、Skills、local filesystem 约束和安装态资源闭包；无需 CLI subprocess 或源码复制。

本轮选择的路径已经完成前半段：`dsh-univer-work` 将成为 `apps/dsh-univer-work`，framework-neutral 的 Workspace client/runtime core 已落在 `packages/client-core`。首版不采用 CLI subprocess 兼容层，只支持 local DSH profile。

## 基础形态判断

这一轮澄清了 `dsh-univer-work` 的“客户端入口”含义：它是 Workspace Server 的第三个 Agent client，不是 DSH Web UI 的新页面。

```text
Human ──> Workspace Browser ─┐
                             │
Agent ──> Workspace CLI ─────┼──> Workspace Server
                             │      ├── Product HTTP /api
Agent ──> dsh-univer-work ───┘      ├── Collaboration /universer-api
                                    └── Worktree events / WebSocket
```

基础插件因此是 Host-only bundle：

```text
DSH Agent
  ├── DSH skill catalog
  │     └── Workspace workflow + Facade guidance
  └── DSH tools
        └── Workspace capability owner
              ├── authentication / HTTP client
              ├── Space / Worktree / Unit operations
              ├── headless collaboration runtime pool + worker
              ├── Office / Typst / SVG / render runtimes
              └── Workspace Server
```

首个 Agent 能力包不需要 `dsh.client`、Slot、Client bundle 或 Client→Host Remote。需要浏览器登录卡片、Settings UI 或可视化工作台时再升级为 Mixed plugin。这个判断缩小了 `docs/research/deepseek-harness-plugin-development.md` 中 Web Client 路径对基础能力的影响。

## CLI 外壳在 DSH 中如何替换

Workspace CLI 的 composition root 同时注册配置、daemon、API reference、resource library、Skills、认证、Space、Worktree、Unit、exchange、Blob、Asset、截图、lint、execute、Typst、SVG 和 inspection，见 `apps/cli/src/program.ts:75-213`。迁移时不应把每个 CLI 命令机械变成同名 tool。

| CLI 外壳 | DSH 对应形态 | 结论 |
| --- | --- | --- |
| `config` | Cordis `Config`，可选 Settings | 不需要模型工具 |
| CLI session file | DSH Credentials `GrantRecord` 或插件自有受保护状态 | cookie 不进入 tool 参数、日志或普通 Settings |
| `daemon` command / socket | Host plugin 内的 runtime owner | 不需要模型工具 |
| `skills list/get/path` | `ctx.skills` + `dsh-tool-skill` | 由 DSH 原生 skill catalog 替换 |
| Commander 参数解析 | `defineTool` parameter schema | 输入在 tool 边界直接校验 |
| `--json` 输出 | tool canonical JSON value + `output.render` | 不再维护文本/JSON双模式 |
| CLI 退出码 | `HarnessError` 或稳定 tool error | 保留 Workspace error code 与 result-unknown 语义 |
| 长命令等待 | `ctx.jobs` | 只给确实耗时的操作使用 |

Harness 的 `defineTool` 会校验模型参数和规范输出；tool 执行必须转发 `exec.signal`，完整退出后才能 settle，见 `docs/user/develop/basic/tool.zh.md:7-36` 和 `packages/core/tools/src/index.ts:250-430`。Client Core 的 `WorkspaceHttp` 和部分 render/source 路径已经接受 `AbortSignal`，但 Space、Worktree、Unit 等 feature 方法还没有统一的 signal 输入。DSH tool 设计仍需逐条确定取消传播和清理边界，不能只把方法包进 `defineTool`。

## 能力迁移矩阵

### 1. Workspace 产品与工作流

| CLI 能力 | 依赖 | DSH 迁移判断 |
| --- | --- | --- |
| `space list/browse/find` | Product HTTP | 可直接变为只读 tools |
| `space node create/rename/move` | Product HTTP | 可直接迁移 |
| `space node trash` | Product HTTP | 可迁移；应保留为独立 consequential tool，便于 approval policy 识别 |
| `worktree list/get/create/update` | Product HTTP + idempotency/readback | 可直接迁移，必须保留 result-unknown 处理 |
| `worktree ready/reopen` | Product HTTP 状态机 | 可直接迁移 |
| `worktree merge/discard` | Product HTTP 状态机 | 可迁移；应与普通更新分开授权 |
| `unit list/add/create` | Product HTTP + Worktree revision | 可直接迁移 |
| `open` | Worktree/Unit 校验 + URL 构造 | 可直接迁移 |

这些 feature 现在由 Client Core 拥有并从 package 根入口导出；`createProgram()` 只负责注入 CLI Session-backed HTTP、构造实例并注册 Commander 命令。DSH shell 可以注入自己的 credential-backed HTTP 后复用同一组 feature。

### 2. 认证

CLI 支持两阶段 browser approval，并按 origin 把 Session cookie 与 pending device code 写入 `0600` JSON 文件。storage-neutral 协议与同源、redirect、认证错误约束现由 Client Core 拥有；CLI Session 文件仍由 Client Shell 持有，见 `packages/client-core/src/auth.ts`、`packages/client-core/src/http.ts` 和 `apps/cli/src/features/auth/session.ts`。

DSH Credentials 的 `GrantRecord` 允许拥有插件保存自定义、可 JSON round-trip 的授权 payload，见 `packages/credentials/credentials/src/types.ts:16-59`。这足以保存 `{ origin, cookie, subject }`。DSH authorization seam 也能表达“打开页面、输入 code、由 flow 写入 credential record”的人机流程，见 `packages/credentials/authorization/README.zh.md:5-66`。

仍有两个边界：

- `0.1.1-rc.2` 的标准 base composition 已装 Credentials，但没有直接装载 `AuthorizationService`。插件需要显式装配该服务，或保留两阶段 login tools。
- DSH authorization flow 不可恢复；CLI 会把 pending login 写入磁盘。若要求重启后继续待批准登录，插件需要保留 CLI 的 pending state 语义，不能只换成当前 authorization flow。

密码登录不应接受模型参数。密码会进入 tool call 与 session log。若保留兼容能力，应通过 `secret` interaction 或 Credentials 配置面完成。

### 3. Blob、Asset 与本地文件

| CLI 能力 | DSH 迁移判断 |
| --- | --- |
| Blob metadata / download URL | 可直接迁移 |
| Blob upload | `ctx.fs.readBytes()` 可以读取有界二进制输入 |
| Blob / Asset download | 本地 profile 可写进 agent cwd；通用 DSH FS 暂无二进制 write |
| Office import | 可以读取源文件并调用 SDK；需要大小上限与 execution-world 路径转换 |
| Office export | SDK 可生成文件；通用 DSH FS 无法原子写二进制结果 |
| Screenshot | 可以存成 DSH image attachment，或在 local profile 写 PNG |

Harness `ctx.fs` 提供 `readBytes()`，但写入与编辑只支持 UTF-8 文本；没有二进制 write、rename、move 或 copy，见 `packages/fs/fs/README.zh.md:18-35,61-65`。因此文件能力分两种支持范围：

- local Host profile：插件进程与 agent cwd 共享本地 execution world，可以用 `ctx.fs.resolve()` + `processPath()` 把安全路径交给 SDK。
- sandbox/E2B/remote FS：输入可以通过 `readBytes()` 搬入 Host，通用 Office/Blob 二进制输出没有对称写回 seam。

DSH attachment service只持久化图片，不是任意文件 artifact store。它可以承接截图，不能承接 `.xlsx`、`.docx`、`.pptx` 或普通 Blob。完整迁移若要求所有 DSH FS provider 都可用，需要先增加通用二进制 artifact/write 能力；若首版限定 local profile，应明确写成兼容范围。

### 4. Headless 内容执行与 inspection

CLI 的 `execute`、inspection 与 UnitData export 通过 daemon 调用 Client Core runtime pool；worker 加载 headless Univer、Workspace snapshot adapter、Collaboration transport、embedded Unit/reference provider 和许可证，见：

- `packages/client-core/src/content-runtime.ts`
- `packages/client-core/src/content-worker.ts`
- `packages/client-core/src/content-execution.ts`
- `apps/cli/src/runtime/daemon.ts:3-49`
- `apps/cli/src/runtime/worker.ts:1`

迁移不需要保留 daemon socket。DSH Host 本身是长进程，可以直接拥有 pool；worker 隔离仍需要保留，因为它承载 headless Univer 实例、snapshot 同步和跨 Unit provider。插件 dispose 时必须关闭 pool 并等待 worker 停稳。

内容能力在技术上可完整迁移：

- `execute` 继续接收 Facade JavaScript，只有 Worktree target 可写。
- inspection 继续通过只读 runtime 执行。
- mutation capture、embedded image externalization、changeset commit、revision 确认与冲突处理必须原样保留。
- tool 输出可使用 lossless JSON，和现有 CLI `--json` 结果兼容。

代码所有权阻碍已经解除。DSH Host 可直接创建 Client Core runtime，并注入自己的 credential resolver、license resolver 与 packaged worker entry；DSH lifecycle 必须在 dispose 时调用 runtime `close()`。

### 5. Office exchange、截图、lint、Typst 与 SVG

这些能力不是简单 HTTP wrapper：

| 能力 | 额外运行时 |
| --- | --- |
| import/export | Office exchange + native binding |
| screenshot | UnitData export、Puppeteer/browser、render page、字体与 image asset 重写 |
| Slide layout lint | browser render runtime + layout capture |
| Typst | doc-typst native binding + headless materializer |
| SVG | SVG compiler；真实字体测量时需要 browser runtime |

CLI artifact 为此保留六个外部 runtime dependencies，包括 Puppeteer、CLI assets 和三个 native binding，并复制 render runtime 与 worker child，见 `apps/cli/scripts/package-artifact.mjs:6-58,104-131`。`dsh-univer-work` 若原生承载这些能力，也必须交付相同资源闭包；它们不能从 DSH 本身获得。

这些操作适合在耗时超过普通 tool call 时进入 `ctx.jobs`。Jobs 由生产方持有执行资源，owner/session 控制读取和取消，见 `docs/subsystems/jobs.zh.md:24-60`。迁移时仍需定义最终 artifact 的位置，Jobs 只解决生命周期，不解决二进制文件交付。

### 6. API reference 与 SVG resource library

`api find/show` 和 `resources registries/find/export` 属于 Agent 的按需发现能力，应保留为 tools，而不是把完整 Facade catalog 或资源索引塞入 Skill。它们分别由已发布的 `@univer-cli/api-reference` 与 `@univer-cli/resource-library` 组合，见 `apps/cli/src/program.ts:103-107,147-152`。

查询和结构化结果可直接迁移。resource export 仍受二进制/文件输出限制。版本必须继续与 headless runtime 的精确 SDK baseline 一起升级，否则 Skill 指引、API reference 与执行 runtime 会漂移。

## DSH Skills 迁移

CLI 当前交付八份 Skills：`core`、`sheet`、`doc`、`slide`、`base`、`board`、`embed`、`cross-unit-formula`。固定列表见 `apps/cli/src/features/skills/command.ts:5-14`，artifact 验证会检查八个 `SKILL.md` 都存在。

DSH 不会因 package 中存在 `SKILL.md` 自动发现 Skill。固定、随包发布的 Workspace Skills 应由 Host plugin 注入 `skills` 并调用 `ctx.skills.register()`；只有远程发现或动态条目才需要 `registerProvider()`。证据见 DeepSeek Harness 的 `docs/subsystems/skills.zh.md:9-17,64-85,178-219`、`packages/skill/skill/src/index.ts:95-120,385-459` 和 `packages/skill/skill-filesystem/src/index.ts:45-89,129-143`。

迁移工作分两类：

- 可原样保留：Space/Node/Resource/Unit/Worktree 术语、Facade 写法、验证规则、Slide/Doc/Sheet/Base/Board 专项知识、跨 Unit 与 embed 约束。
- 必须改写：所有 `univer-workspace-cli ...` 命令、`skills get` 路由、CLI help 提示、文件路径与 stdout/JSON 说明。

`core` 应继续承担 workflow skill，其他七份按 Unit 或能力渐进加载。DSH skill catalog 会把摘要加入模型上下文，`dsh-tool-skill` 负责加载正文，因此不需要再暴露 `workspace_skills_list/get/path` tools。

Skills 与 SDK/runtime 必须随同一个 plugin version 发布。CLI 已经这样做；`dsh-univer-work` 需要保持相同版本耦合，不能从 Workspace 仓库复制一次后永久不更新。

## 三种实现复用路径的事实比较

| 路径 | 决策 | 主要代价 |
| --- | --- | --- |
| 调用已安装 Workspace CLI subprocess | 不采用 | 仍依赖独立 CLI、daemon、CLI session file、private registry 与 browser setup；取消工具可能只杀掉前台进程，daemon mutation 仍在执行 |
| 提取 Workspace client/runtime core，由 CLI 与 plugin 共用 | 已完成 | private package exports 已建立；DSH artifact 仍需内联或携带其闭包 |
| 在独立仓库重写 Workspace-specific adapters | 不采用 | 认证、HTTP validation、idempotency、result-unknown、runtime target 与 worker adapter 会形成双份实现并持续漂移 |

subprocess 路径还受发布边界限制：CLI distribution 当前发布到 `https://insider-npm-registry.univer.work/`，且 manifest 只提供 bin，不是公共 library，见 `apps/cli/scripts/package-artifact.mjs:15-17,79-94`。如果 `dsh-univer-work` 面向该 registry 之外的用户，不能把它当成自动可安装的依赖。

### 选定的 monorepo 边界

建议的源码所有权是：

```text
univer-workspace/
  apps/cli                  # Commander、CLI session、daemon command、文本输出
  apps/dsh-univer-work      # DSH bundle、tools、skills、Credentials 与生命周期适配
  packages/client-core      # Workspace HTTP、模型、错误与可靠性语义、runtime target/owner
```

同仓不等于 app-to-app 源码引用。`apps/dsh-univer-work` 不应导入 `apps/cli/src/*`；两个 app 只能通过 `packages/*` 的公共 exports 复用代码。共享模块保持 framework-neutral，不依赖 Commander 或 DSH。认证存储、工具 schema、输出呈现和进程生命周期分别留在两个 app 中。

Client Core 已包含两个客户端都会调用的 Workspace HTTP 与 origin 约束、响应校验、错误码、idempotency/result-unknown、Space/Worktree/Unit/Blob/Asset feature、content runtime、Office、Typst、render/lint 与 SVG workflow。CLI command、Session、daemon socket 和 DSH tool registration 仍留在各自 Client Shell；当前没有再拆 package 的依据。

monorepo 解决源码所有权、原子修改和 SDK 版本同步，不改变交付形态。`apps/dsh-univer-work` 仍应构建为可由 DSH 安装的独立 package，并把运行时资源和依赖带进发布闭包。

## 完整迁移的兼容性门槛

在以下条件同时满足时，可以声明“能力对齐 Workspace CLI”：

1. Space、Worktree、Unit、Blob、Asset、open、execute、inspect、exchange、screenshot、lint、Typst、SVG、API reference 和 resource library 均有 DSH tool 路径。
2. 八份 Skills 已改写为 tool 语义，并与同一 SDK baseline 发布。
3. browser approval、cookie secrecy、logout 与 pending authorization 的生命周期有明确 owner。
4. Worktree 写入继续执行 target revision 校验、mutation capture、changeset commit、冲突与 result-unknown 处理。
5. tool cancellation 能到达 HTTP、worker、browser 与 native operation，并在返回前完成清理。
6. local-only 或 provider-independent 文件能力范围已经写清；Office 与 Blob 二进制结果有真实交付路径。
7. render page、worker child、Puppeteer、字体、native bindings 和 Univer license 均进入发布与验证闭包。
8. merge、discard、trash 等 consequential 操作仍要求用户授权，不能只依赖 Skill 提醒。

当前源码已经证明 1 和 2 在产品能力层面可行，也证明 Workspace Client Core 可以保持 CLI parity。3 至 8 仍需要 DSH-specific 的实现选择和组合验证。因此当前准确表述是：

> `dsh-univer-work` 可以覆盖 Workspace CLI 的完整 Agent 能力。共享 Client Core 已经就绪；local-only 首版不受通用 DSH 二进制输出缺口阻挡，剩余验证集中在 DSH Credentials、取消、plugin lifecycle 和安装态资源闭包。

## 已确定的首版边界

1. `dsh-univer-work` 迁入 `univer-workspace`，源码位置为 `apps/dsh-univer-work`。
2. 不采用 CLI subprocess；两个客户端依赖 `packages/client-core` 的 package exports。
3. 首版只支持 local DSH profile。文件输入输出使用同一台主机上的 agent cwd；sandbox、E2B、remote FS 和通用二进制 artifact 传输不进入首版。
4. 对非 local execution world 应返回明确的不支持错误，不能退化为 Host 路径或静默写入错误位置。

这两个选择消除了完整原生迁移的主要架构歧义。共享 Core 与 CLI consumer 已完成；后续 proposal 应从可安装、可加载、可卸载的 Host-only local plugin shell 开始，再增加 Credentials、基础 workflow tools/Skills 和重运行时能力。首个 Change 不应同时承诺全部 CLI parity。
