# Univer Workspace 仓库指南

本文件适用于整个仓库。修改前先阅读根 `README.md`、目标目录的 README 和相关设计文档。
`apps/workspace/AGENTS.md` 对 `apps/workspace/**` 提供更具体的数据库与部署约束。
`apps/cli/AGENTS.md` 对 `apps/cli/**` 提供 CLI 与 Client Core 的职责边界，以及从用户 README
移出的 Skills、渲染副本、PDF 打印和运行时许可证约束。两者同时适用，冲突时以更具体且更严格的规则为准。

## 项目目标

本仓库拥有 Univer Workspace 产品及其配套 CLI。它将 Univer、Univer Pro、Univer Collaboration
SDK 和 Univer CLI SDK 组装成以下应用：

- Univer Workspace：可部署的 Browser、产品 HTTP API、协同入口和后台任务。
- Univer Workspace CLI：面向 Agent 的远程 Workspace 自动化应用。
- Univer Workspace MCP：基于 Client Core 的 private 远程 MCP 应用，阶段 A 只提供开发认证和身份、仓库只读工具。

本仓库还包含供 Browser 或 Node-hosted Workspace Agent Client 使用的 private packages。它们是内部
实现，不是额外的对外应用或跨仓库公共 SDK。

## 仓库结构与职责

```text
apps/workspace                 Workspace Browser、Server、HTTP contract 与部署应用
apps/cli                       Univer Workspace CLI
apps/mcp                       Private Workspace MCP gateway（阶段 A 开发认证）
apps/agent                   Univer Workspace Agent（DSH 定制服务 + 两个预装插件）
packages/client-core           Node-hosted Workspace Agent Client 共享能力
packages/reference-provider   Browser 专用的 private referenced-Unit policy
packages/dsh-univer-workspace-plugin        能力插件（远程 Unit 工具集 + headless runtime）
packages/dsh-univer-workspace-skin-plugin   皮肤插件（workspace 品牌与 logo）
scripts                       仓库级 SDK 版本与 CLI 本地开发脚本
```

- `apps/workspace` 拥有 Workspace 产品模型，包括 Identity、Space、Node、Resource、ACL、Trash、
  Recent、Blob、Asset、Operation 和 Worktree 的产品级组织。
- `apps/cli` 拥有 Workspace origin、登录 Session、Commander composition 和面向 Agent 的 CLI 交付体验。
- `apps/mcp` 是基于 Client Core 的第三个 Node-hosted Workspace Client，拥有远程 MCP 协议、工具映射、认证边界和用量事件；不连接数据库，不依赖 CLI 应用。阶段 A 仅供本地和内部单用户开发验证。
- `packages/client-core` 拥有 Node-hosted Workspace Agent Client 共享的 HTTP、错误、storage-neutral 认证协议、
  远程产品 workflow 与 worker-backed content runtime；Client Shell 注入 origin、凭据、license 与 packaged
  worker entry，package 不读取 CLI Session 或配置。
- `apps/agent` 拥有 Workspace Agent 服务：DSH（DeepSeek Harness）定制组装，以 Workspace OAuth
  授权用户身份提供 agent 操作远程 Workspace 文档（Unit）的能力。它预装两个仓库内开发的插件，
  本身不发布为公共 SDK。
- `packages/reference-provider` 只服务于 Workspace Browser。CLI 在自身 application 内维护独立
  Provider；两者共享 persisted identity 和行为语义，但不为消除代码重复而制造跨应用公共合同。
- `packages/dsh-univer-workspace-plugin` 提供 agent 操作远程 Workspace 文档的能力（工具集、空间对账、
  headless 协同 runtime、导入导出）。代码与维护独立，通过 harness profile 预装，不发布到 npm。
- `packages/dsh-univer-workspace-skin-plugin` 只提供 DSH 浏览器面的 workspace 外观（主题令牌与品牌）。
- `apps/*` 可以组合 SDK 能力；private packages 不得反向依赖 application。`packages/dsh-univer-workspace-plugin`
  依赖 `apps/agent` 暴露的 `workspaceAuth`/`workspaceSession` 服务，通过 cordis 服务组合而非 npm 依赖。

## SDK 与仓库边界

本仓库是 product/application composition root，不重新拥有上游 SDK 的合同：

- Univer / Univer Pro SDK 拥有 Unit 数据模型、Facade API、mutation、render、Office exchange 和内容能力。
- Univer Collaboration SDK 拥有 snapshot、changeset、revision、OT、协同 Service、Worktree、
  Database Adapter、Endpoint 和 Transport 合同。
- Univer CLI SDK 拥有 target-neutral 的 headless runtime、execution、inspection、render、daemon 和可选
  Commander preset。
- Workspace 产品模型、认证、资源目录、远程 workflow 和 deployment 留在本仓库。

只通过已发布 package 的公开 exports 使用其他 SDK。代码、构建、测试和生成流程不得依赖相邻仓库
checkout、其他仓库的绝对路径或未发布源码目录。

`apps/agent` 与两个 dsh 插件包通过公开 npm 的 `@deepseek-ai/*` 包使用 DSH（dsh 是外部产品，本仓库
不 fork、不修改其源码）。dsh CLI 运行时图由 `packages/dsh-runtime` 声明——它是独立嵌套 workspace
（`packages/*` glob 显式排除），自带 committed `pnpm-lock.yaml`，以精确 pin 锁定完整闭包；桌面产物
与 agent 镜像在构建时先 `pnpm install --frozen-lockfile` 再 `pnpm deploy --prod
--config.node-linker=hoisted` 把它物化为 workspace 安装之外的自包含目录，不在构建时浮动解析。
该闭包不得并入根 workspace 图：共享解析域会重解析消费者 optional peers，使同一 dsh 包产生多个
实例并分裂跨包品牌类型（SessionId、Context）。物化同时使 dsh client 的 react 18 树与 Univer SDK
的 react 19 图保持分离，不分裂 `@wendellhu/redi` 实例。

所有 version-coupled `@univer-cli/*`、`@univerjs/*` 和 `@univerjs-pro/*` 依赖使用同一个精确
SDK release。升级时运行：

```bash
pnpm update:univer-sdk --sdk_version <exact-sdk-version>
```

`@univerjs/icons`、`@univerjs-pro/cli-assets` 和 `@univerjs-pro/doc-typst-native-binding` 按自身
发布节奏独立发版：声明保持精确版本，不跟随 SDK baseline。原生绑定
`@univerjs-pro/engine-formula-rust-binding` 和 `@univerjs-pro/exchange-node-binding` 由 wrapper 包
`@univerjs-pro/engine-formula-rust`、`@univerjs-pro/exchange-node` 声明，manifest 只声明 wrapper；
CLI 打包脚本从 wrapper manifest 读取绑定版本写入 artifact 运行时依赖。`pnpm-workspace.yaml` 的
`overrides` 只承载 dev 版本探索与 insiders 修复回移：顶层 SDK 条目必须是 dev 或 insiders 版本，
`父包@版本>子包` 形式的 scoped 条目只约束一条边，可持任意版本形式。升级时清空其中的全部 SDK 条目。

必须同时提交所有受影响的 manifest 和 `pnpm-lock.yaml`，不得手工只更新其中一部分。

应用内置的 runtime 开发 license 与 license key 由 `pnpm update:univer-license --license <file>
--license-key <file>` 生成到各应用的 `license.ts`，轮换时只运行该脚本，不手工编辑这些文件。

## 标准能力与临时代码

- 优先在应用边界直接组合上游公开能力；只有承担了新的职责或生命周期时才增加抽象，不为简单转发制造
  包装层，也不在本仓库复制上游合同。
- 历史数据兼容、迁移和补偿逻辑必须与常态业务路径隔离，集中在单一入口和明确的生命周期阶段执行；实现
  应幂等，并说明适用范围、失败语义和退出条件。
- Workaround 必须集中隔离，避免临时分支散落到正常代码中；注明原因、影响范围和删除条件，并在上游
  问题消失时及时移除。

## Workspace 数据与运行边界

- 产品数据与 Univer 协同数据分别存储。产品数据库不得保存 snapshot、changeset 或 revision；
  Collaboration Database Adapter 不拥有 Space、Node、Resource 或 ACL 产品模型。
- Blob 与内嵌 Univer Asset 的字节由 `BlobStore` 保存，产品数据库只保存身份、元数据和恢复状态。
- 产品数据库、Collaboration Service 与 BlobStore 之间不存在伪造的跨系统事务。跨边界写入使用
  持久化 Operation、idempotency 和 recovery 明确收敛。
- Browser 和 CLI 都不能信任客户端提供的 User、Role、Resource、Unit、Worktree 或 confirmed
  revision；服务端从认证 Session 与产品数据解析权威身份和权限。
- `apps/workspace/**` 的 schema、迁移、备份、升级和部署操作必须遵守
  `apps/workspace/AGENTS.md`。不得把 `db:reset` 用于正常启动、升级或生产恢复。

## HTML View

- HTML View 是绑定实时 Sheet 数据的小型应用，不是静态页面。渲染、分享和预览都基于实时数据，
  不引入快照、静态导出或内联数据副本。
- 有编辑权限的用户在页面上的操作实时协同写入来源 Sheet，这是 HTML View 的核心能力，试算不得削弱它。
- 没有编辑权限的用户（匿名访客，或已登录但只读）跟随 repository 的文档权限，不能更改源数据；宿主
  启用试算时，他们的页面编辑只在自己的浏览器中由真实公式引擎试算，不保存也不发送。

## Workspace Agents 提示缓存

浏览器 Agents（`apps/workspace/web/src/features/agents`）每一步都会重发完整请求。模型服务商按前缀匹配缓存，前缀中任一 token 变化，其后的内容都要重新计算。

- 一次会话内，工具列表、系统提示词和已发出的历史必须逐字不变。系统提示词只放会话创建时已确定的内容；运行中产生的状态（Worktree ID、计数、时间戳）留在历史的工具结果里，不写进系统提示词。
- 历史消息只追加，不改写、截断或重排。工具集合保持不变。用户可以在两轮之间切换 mode、scope、模型和 thinking 参数；系统提示词与已发出的历史保持不变。mode 与 scope 的变化只通过追加在该轮用户消息末尾的 `<system-reminder>` 文本 part 告知模型；切换模型或 thinking 参数会产生一次缓存未命中，由用户自行选择。
- `runtime/runner.test.ts` 断言新 PR 出现后系统提示词不变。修改提示词组装或消息转换时，保持该测试通过，并在会话页核对缓存命中率没有下降。

## HTTP contract 与生成物

- `apps/workspace/contracts/http` 是产品 HTTP contract 的源码。
- `apps/workspace/generated/http` 由 Redocly 和 `openapi-typescript` 生成，不得手工修改。
- Express 路由实现、OpenAPI 源文件、生成类型和调用方必须描述同一行为。
- 修改 HTTP contract 时运行 `pnpm --filter @univerjs/univer-workspace api:verify`，并同步更新受影响
  的 Server、Browser、CLI、测试和文档。
- TanStack Router 生成文件同样通过现有 script 生成，不手工维护生成结果。

## Package 与发布边界

- `apps/workspace`、`apps/mcp`、`packages/client-core`、`packages/reference-provider` 和
  `packages/unit-comparison-viewer` 是 private workspace package，不发布为公共 SDK。
- `univer-workspace-cli` 通过仓库内 packaging workflow 生成内部安装包；不要把 source workspace
  manifest 的 `private` 状态误当成公共 npm SDK 合同。
- `apps/cli/package.json` 的 source version 固定为 `0.0.0`；稳定 CLI 版本只来自 `vX.Y.Z` git tag，
  insiders 版本由 release workflow 的完整 `X.Y.Z-insider.<suffix>` 输入提供，发布过程不得改写 source
  manifest。
- CLI 只有 `latest`、`insiders` 和 `dev` 三个发布通道。`latest` 只由手动 CI 在默认分支包含的稳定 tag 上
  触发，`insiders` 只由默认分支手动 CI 触发，`dev` 只允许本地触发。`latest` 和 `insiders`
  发布前必须检查整个 workspace 的单一 SDK baseline；`dev` 明确跳过该检查。
- CLI package artifact 必须只包含运行所需代码、资源和版本匹配的 Skills，不得依赖当前 checkout。
- CLI package workflow 必须先构建 Client Core，并把其运行时代码内联到自包含 artifact；不得把 private
  Core 变成安装时依赖。
- `packages/reference-provider` 不增加独立发布、版本或外部 consumer 合同。
- `packages/client-core` 不增加独立发布、版本或外部 consumer 合同。
- `packages/unit-comparison-viewer` 不拥有数据请求、wire payload 解码或 Univer Runtime 装配；宿主只向其
  传入已解码 UnitData、comparison result 和 Univer factory。
- 稳定 `vX.Y.Z` tag 在被选择时是 CLI release 与 Workspace deployment 共享的不可变源码坐标；tag push
  不触发 CI 或发布；CLI 发布必须单独手动触发 workflow。部署 workflow 也可以不选 tag，改为手动部署 workflow dispatch 的精确 commit，并使用
  `sha-<commit>` image tag。Docker image 和 CLI artifact 的交付时机与执行流程仍然独立。
- 当前 release workflow 只写 insider-npm；公开 npm Promotion 属于独立后续工作，不得加入该 workflow。

## 文档维护

- 根 `README.md` 记录仓库目的、布局、开发入口和仓库级验证方式。
- `apps/workspace/README.md` 记录运行配置、认证、数据位置、Docker 和升级方式。
- `apps/workspace/docs/architecture.md` 记录代码与技术架构。
- `apps/workspace/docs/application-design.md` 记录产品模块和跨系统边界。
- `apps/workspace/docs/data-model.md` 是产品数据模型、状态和持久化语义的权威说明。
- `apps/workspace/docs/adr` 只记录已经接受的架构决策，不把临时计划写成既成事实。
- `apps/cli/README.md` 记录 CLI 的用户能力、安装方式与对外交付合同。
- Package README 必须明确该 package 的职责、非职责和 consumer 边界。

仅当变更影响 `DREAMNUM.md` 已记录的事实时才更新该文件。其他任务无需读取、重写或顺手整理它。
仓库职责、对外应用、跨仓库依赖、公开合同、部署交接或数据分类发生变化时，必须在同一变更中更新
`DREAMNUM.md`。

## 开发与验证

仓库使用 TypeScript、strict ESM、pnpm workspace 和 Vitest。遵循目标目录的既有代码风格；优先
使用 named exports，保持应用模块依赖方向，不跨 package 导入 `src` 或 `dist` 内部路径。

常用仓库级验证：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
pnpm package:workspace-cli
```

- 根据变更范围先运行最小相关测试，再在宣称完整实现前运行适当的仓库级验证。
- 修改 Workspace HTTP contract 时增加 `api:verify`。
- 修改数据库 schema、迁移或部署行为时执行 `apps/workspace/AGENTS.md` 要求的完整迁移矩阵。
- 修改 CLI packaging、runtime assets 或 bundled Skills 时验证实际 package artifact，而不只验证源码。
- 纯文档变更至少检查链接、命令、路径和 `git diff --check`。

## 变更纪律

- 保留 dirty worktree 中与当前任务无关的用户改动，不覆盖、清理或重新格式化无关文件。
- 不直接修改生成文件或 Git 忽略的本地产物；修改其 source 或生成脚本后重新生成。
- 不把尚未实现的能力写成当前事实。
- 修复跨 SDK 问题前先判断所有权位于本仓库还是上游 SDK，并向用户说明判断依据。
- 不自行发布 artifact、推送 image 或触发部署；只有用户明确要求时才执行。

## Unit Comparison Viewer 同步

目前没有适合放置应用级共享组件的统一位置。临时方案是 `univer-workspace`、`univer-cli` 与 DSH plugin
各自保留 `packages/unit-comparison-viewer`；修改该 package 时必须同步所有副本。

## React and Redi dependency boundaries

Workspace Browser uses React 19; the published DSH browser packages consumed by
Workspace Agent use React 18. This is intentional application isolation, not a
request to deduplicate React across the repository. Shared private UI components
run with the consuming application's React runtime. The DSH CLI runtime graph is
declared by `packages/dsh-runtime`, a standalone nested workspace whose committed
lockfile pins the whole cohort; it is materialized only at build time with
`pnpm deploy` into a detached, self-contained tree. Nothing imports that package
and it must not join the root workspace graph: sharing one resolution domain
re-resolves consumers' optional peers and splits branded types (SessionId,
Context) across the workspace. Never add `@deepseek-ai/*` React-18 dependencies
to another manifest, resolve browser React from a neighboring application, or
add a second React runtime to an application bundle.

Univer consumers should obtain DI APIs and types through `@univerjs/core`, which
owns the Redi dependency. Some published SDK `.d.ts` files nevertheless emit
inferred `import("@wendellhu/redi").IdentifierDecorator` references even though
runtime code imports from Core. With both React peer contexts installed, an
undeclared Redi reference can resolve through pnpm's hoisted directory to the
other application's Redi instance. A single-React installation can hide this
problem. The same Redi version number does not prove the peer contexts match.

The exact-version Redi `packageExtensions` in `pnpm-workspace.yaml` keep declaration
resolution in the consuming application's dependency graph. They are temporary
package-metadata repairs, not dev SDK version overrides. Prefer an upstream fix
that keeps emitted DI types imported from Core; do not routinely add direct Redi
imports or dependencies to SDK consumers.

Keep shared data-only entry declarations independent of headless runtime types.
The Markdown file writer uses the SDK's `/files` entry; `/node` also exposes
materialization and brings its runtime types into TypeScript's dependency graph.
The SDK type-identity regression checks each application independently and guards
the Markdown contract boundary. After changing dependency metadata, clean TypeScript
build state before checking; incremental diagnostics can retain an old graph.

When upgrading the SDK, inspect the published declarations and manifests before
changing these extensions. Remove obsolete entries only after an isolated clean
install verifies both Workspace and Agent typechecks and browser startup. Check
actual resolved Redi peer contexts; `skipLibCheck`, a successful single-app build,
or an already-populated `node_modules` is insufficient evidence. Do not force a
single React version, add broad overrides, patch installed SDK files, or weaken
typechecking to mask the mismatch. Keep any remaining workaround version-scoped
and document its evidence and removal condition.

## 多 PR 任务与 PR stack

任务拆成多个 PR，且后一个 PR 建立在前一个之上（例如 schema、Server、Browser 依次叠加）时，用 GitHub
原生 Stacked PRs 组织。互不依赖的 PR 各自从 `main` 开分支，不组成 stack。

- 开 stack 前先 rebase 到最新 `main`。每层一个分支，PR 的 base 是下一层分支，每层单独评审。
- 用 `gh stack`（`gh extension install github/gh-stack`）管理。新 stack 用 `gh stack init`、`gh stack add`、
  `gh stack submit --open` 创建；已有 PR 用 `gh stack link <下层> <上层>` 关联。修改下层后运行
  `gh stack rebase --upstack` 和 `gh stack push`。
- 用 `gh stack merge <顶层 PR> --merge -y` 一次合入顶层及其下所有层。stack 只用 merge commit 合入，
  下层原始提交原样进入 `main`，上层无需 rebase。squash 和 rebase 方式会改写下层提交，使上层出现重复改动和假冲突。
- 只合入部分下层后，运行 `gh stack sync` 同步剩余各层。手工维护时用
  `git rebase --onto origin/main <下层原 head>` 移动上层，不把 `main` merge 进上层分支。
- 对自己的 stack 分支执行 `git push --force-with-lease` 是正常步骤。被权限拦截时停下请用户放行，不改用 merge。
- stack 内每个提交都会进入 `main` 历史，提交信息同样遵循下文的 Conventional Commits。

## PR 标题与 Commit Message

PR 标题与 commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)，
使用英文，格式为 `type(scope): description`，其中 scope 可省略。
常用 type 包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci` 和 `chore`。
不兼容变更使用 `!` 或正文中的 `BREAKING CHANGE:` 标记；合并时的 squash commit 和 merge commit 标题也遵循此格式，仓库设置让 merge commit 标题取自 PR 标题。
