## Why

`add-dsh-univer-work-plugin-shell` 只建立可安装、可加载、可卸载的 Host shell；后续所有 Workspace tools 都还缺少一个能安全取得 Login Session、按操作解析当前凭据并构造 authenticated HTTP 的 owner。DeepSeek Harness `0.1.1-rc.2` 虽提供 `CredentialKey`/`GrantRecord` 与 authorization service，但该基线没有调用 `authorization.begin()` 的产品 UI、Remote 或 CLI surface。仅注册 flow 会留下用户无法发起的认证路径。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，复用 Workspace Client Core 的两阶段 browser approval protocol，并用四个 DSH tools 交付与 Workspace CLI 对等的认证 outcome。

## What Changes

- 在 Host plugin 注册零参数 `workspace_auth_start`、`workspace_auth_complete`、`workspace_auth_whoami` 与 `workspace_auth_logout`，由 Cordis plugin Config 提供唯一 Workspace public origin，保留“一次 start、等待用户明确批准、一次 complete”的非轮询语义；bundle patch 只从 `UNIVER_WORKSPACE_ORIGIN` 注入该值，不从 DSH Host 页面或模型参数推断 Authority。
- 用 plugin-owned `CredentialKey` 保存严格校验的 pending 或 authenticated `GrantRecord`；模型只看到 verification URL、user code、expiry、status 与 User subject，device code、cookie 和完整 grant 不进入 tool 参数、输出、普通 Config 或 Session log。
- 建立惰性 authenticated connection resolver：每次操作重新读取并校验当前 authenticated grant，pending、过期、损坏或缺失记录均不产生 authenticated HTTP。
- `workspace_auth_logout` 在有 authenticated grant 时先尽力调用 Workspace Server，并在 `finally` 中清除本地 record；远端失败仍保留 Workspace error/result-unknown 语义，且不得遗留可用的本地 Session。
- 为 logout 注册 DSH `tools/pre-execute` human approval gate；start、complete 和 whoami 不取得 password，也不把认证秘密变成模型参数。
- 修改 `workspace-client-core/auth`，让 start、complete、`whoami` 与 logout 接收向后兼容的 optional `AbortSignal` 并透传到单次 Workspace HTTP request，使四个 tools 能把 `exec.signal` 贯穿到在途 I/O；Workspace CLI 现有调用与行为保持不变。
- 不装配 `@deepseek-ai/dsh-authorization`，也不注册当前没有产品调用方的 authorization flow。

## Scope

**Intent:** 在 Host-only local `dsh-univer-work` Client Shell 中交付安全、可取消、可持久化的 Workspace browser approval 与 authenticated connection owner，供后续业务 tools 惰性复用。

**Non-Goals:** 不提供 password login、secret prompt、authorization flow、普通 Config/Settings credential、Web Client、Settings UI、Slot、overlay、Client→Host Remote、Jobs、业务 workflow tools、Skills、文件能力、content runtime、worker、Office、Typst、SVG、render/screenshot/lint；不从 DSH Host origin 自动发现 Workspace，也不增加多 origin/account selector；不修改 Workspace Server、Browser、HTTP contract、CLI Session 文件或 CLI command/output；不支持 sandbox/E2B/remote profile，不协调共享同一 credential store 的多个 live DSH Host 或任何绕过 owner Host 修改该 key 的 writer，不发布 package。

**Size Gate:** 一个新 capability、一个修改 capability、七个 coarse tasks，可在一次 focused implementation session 内完成。该 Change 依赖 `add-dsh-univer-work-plugin-shell` 完成，不预建后续 Space/Node 或 runtime 能力。

## Capabilities

### New Capabilities

- `dsh-univer-work/authentication`: 定义 DSH 两阶段 browser approval tools、plugin-owned credential record、authenticated connection resolution、logout 与模型可见保密行为。

### Modified Capabilities

- `workspace-client-core/auth`: 为现有 storage-neutral start/complete/`whoami`/logout protocol 增加 optional `AbortSignal` 透传，同时保持 Workspace CLI compatibility。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 User 与 Login Session；grant 中的 `subject` 是 User 的非权威呈现，cookie 仍是 Login Session credential，服务端继续解析权威身份与权限。
- `openspec/changes/add-dsh-univer-work-plugin-shell/` 定义 Host-only local Client Shell、package owner 与生命周期，本 Change 只在该 application 中增加认证能力。
- `apps/workspace/docs/adr/0002-keep-the-workspace-product-in-one-repository.md` 要求 Agent clients 与 private packages 共仓；本 Change 只通过 `@univerjs/univer-workspace-client-core` 根 exports 复用认证协议，不导入 `apps/cli/src/*`。
- `openspec/changes/extract-auth-client-core/` 已确定 Core 拥有 storage-neutral protocol、Client Shell 拥有 credential persistence 与呈现；DSH grant 和 tools 遵守同一 owner 划分。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、其 Cordis bundle patch、`packages/client-core/src/auth.ts`、Client Core auth tests、`apps/dsh-univer-work` 的安装态验证与职责文档，以及因精确 DSH/Client Core dependencies 产生的 workspace manifest/lockfile 变化。

`apps/cli` 只运行现有认证与 package parity gates，不改变源码行为。Workspace Server/Browser、OpenAPI、数据库、deployment、CLI release workflow 与 SDK baseline 不变。后续 DSH tools 从本 Change 的 resolver 取得 authenticated HTTP，不读取 grant 或复制 cookie parsing。
