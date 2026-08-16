# Univer Workspace 仓库指南

本文件适用于整个仓库。修改前先阅读根 `README.md`、目标目录的 README 和相关设计文档。
`apps/workspace/AGENTS.md` 对 `apps/workspace/**` 提供更具体的数据库与部署约束；两者同时适用，
冲突时以更具体且更严格的规则为准。

## 项目目标

本仓库拥有 Univer Workspace 产品及其配套 CLI。它将 Univer、Univer Pro、Univer Collaboration
SDK 和 Univer CLI SDK 组装成两个对外应用：

- Univer Workspace：可部署的 Browser、产品 HTTP API、协同入口和后台任务。
- Univer Workspace CLI：面向 Agent 的远程 Workspace 自动化应用。

本仓库还包含 Browser 专用的 private reference-provider package。它是内部实现，不是第三个
对外应用或跨仓库公共 SDK。

## 仓库结构与职责

```text
apps/workspace                 Workspace Browser、Server、HTTP contract 与部署应用
apps/cli                       Univer Workspace CLI
packages/reference-provider   Browser 专用的 private referenced-Unit policy
scripts                       仓库级 SDK 版本与 CLI 本地开发脚本
```

- `apps/workspace` 拥有 Workspace 产品模型，包括 Identity、Space、Node、Resource、ACL、Trash、
  Recent、Blob、Asset、Operation 和 Worktree 的产品级组织。
- `apps/cli` 拥有 Workspace origin、登录 Session、远程 Resource/Worktree workflow、CLI composition
  和面向 Agent 的交付体验。
- `packages/reference-provider` 只服务于 Workspace Browser。CLI 在自身 application 内维护独立
  Provider；两者共享 persisted identity 和行为语义，但不为消除代码重复而制造跨应用公共合同。
- `apps/*` 可以组合 SDK 能力；`packages/reference-provider` 不得反向依赖 application。

## SDK 与仓库边界

本仓库是 product/application composition root，不重新拥有上游 SDK 的合同：

- Univer / Univer Pro SDK 拥有 Unit 数据模型、Facade API、mutation、render 和内容能力。
- Univer Collaboration SDK 拥有 snapshot、changeset、revision、OT、协同 Service、Worktree、
  Database Adapter、Endpoint 和 Transport 合同。
- Univer CLI SDK 拥有 target-neutral 的 headless runtime、execution、inspection、render、exchange、
  daemon 和可选 Commander preset。
- Workspace 产品模型、认证、资源目录、远程 workflow 和 deployment 留在本仓库。

只通过已发布 package 的公开 exports 使用其他 SDK。代码、构建、测试和生成流程不得依赖相邻仓库
checkout、其他仓库的绝对路径或未发布源码目录。

所有 version-coupled `@univer-cli/*`、`@univerjs/*` 和 `@univerjs-pro/*` 依赖使用同一个精确
SDK release。升级时运行：

```bash
pnpm update:sdk --sdk_version <exact-sdk-version>
```

必须同时提交所有受影响的 manifest 和 `pnpm-lock.yaml`，不得手工只更新其中一部分。

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

## HTTP contract 与生成物

- `apps/workspace/contracts/http` 是产品 HTTP contract 的源码。
- `apps/workspace/generated/http` 由 Redocly 和 `openapi-typescript` 生成，不得手工修改。
- Express 路由实现、OpenAPI 源文件、生成类型和调用方必须描述同一行为。
- 修改 HTTP contract 时运行 `pnpm --filter @univerjs/univer-workspace api:verify`，并同步更新受影响
  的 Server、Browser、CLI、测试和文档。
- TanStack Router 生成文件同样通过现有 script 生成，不手工维护生成结果。

## Package 与发布边界

- `apps/workspace` 和 `packages/reference-provider` 是 private workspace package，不发布为公共 SDK。
- `univer-workspace-cli` 通过仓库内 packaging workflow 生成内部安装包；不要把 source workspace
  manifest 的 `private` 状态误当成公共 npm SDK 合同。
- `apps/cli/package.json` 的 source version 固定为 `0.0.0`；稳定 CLI 版本只来自 `vX.Y.Z` git tag，
  insiders 版本由 release workflow 的完整 `X.Y.Z-insider.<suffix>` 输入提供，发布过程不得改写 source
  manifest。
- CLI 只有 `latest`、`insiders` 和 `dev` 三个发布通道。`latest` 只由默认分支上的稳定 tag push
  触发，`insiders` 只由默认分支手动 CI 触发，`dev` 只允许本地触发。`latest` 和 `insiders`
  发布前必须检查整个 workspace 的单一 SDK baseline；`dev` 明确跳过该检查。
- CLI package artifact 必须只包含运行所需代码、资源和版本匹配的 Skills，不得依赖当前 checkout。
- `packages/reference-provider` 不增加独立发布、版本或外部 consumer 合同。
- 稳定 `vX.Y.Z` tag 是 CLI release 与 Workspace deployment 共享的不可变源码坐标；tag push 只发布
  CLI，部署 workflow 只手动部署所选 tag。Docker image 和 CLI artifact 的交付时机与执行流程仍然独立。
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
- 不自行创建 Git commit、发布 artifact、推送 image 或触发部署；只有用户明确要求时才执行。
