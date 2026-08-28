## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/typst/compile.ts` 直接组合 `@univer-cli/doc-typst-facade`、headless materializer 和 `WorkspaceUnitFeature.create()`；`materialize.ts` 创建一次性标准 headless Univer，以编译后的 JavaScript 为随机种子，限制 Unit lifecycle，并保存完整 Doc UnitData。`command.ts` 另行拥有 Commander validation、`--out`、`--diagnostics-out` 与 presentation。

CLI package build bundle Typst JavaScript owner，但将 `@univerjs-pro/doc-typst-native-binding` 保留为 distribution runtime dependency。`package-artifact.mjs` 当前从 `@univer-cli/doc-typst-facade` manifest 读取该 binding 版本，built-entrypoint test 则证明 arbitrary cwd 可以编译 bundle。

本 Change 按既定顺序在 Changes 1–7 后实施。它直接复用 Change 1 的 error exports 和 Change 3 的 Worktree-local Unit create operation；Change 2 是 Change 3 的传递前置。Changes 4–7 已先完成，但 Blob/Asset、runtime target、content runtime 与 Office exports 都不是 Typst workflow 的代码依赖。

## Goals / Non-Goals

**Goals:**

- 让 Client Core 成为 Typst compile、deterministic Doc materialization 和 staged Doc apply workflow 的唯一 owner。
- 让 CLI 只保留 Commander validation、文件输出和 presentation，并保持 observable behavior。
- 让未来 local DSH Client Shell 可以直接组合同一 Typst owner与本机路径，而不依赖 CLI command 或 daemon。
- 保持 native binding 的精确版本、平台选择和 installable CLI artifact gate。

**Non-Goals:**

- 不把 Typst compiler、headless Univer 或 Unit create 包装成通用 plugin system、registry 或多实现 factory。
- 不将一次性 Typst materializer 接入 Change 6 的远程 collaboration runtime pool。
- 不改变 global deterministic-random guard 的并发模型，不增加 cache、worker pool 或 cancellation。
- 不移动 Commander 文件写入，不引入 filesystem provider 或 generic artifact service。

## Diagram design

```text
Workspace CLI shell
  ├── Commander / validation / output files
  └── private Client Core Typst owner
        ├── bundle compile -> diagnostics + Facade program
        ├── disposable deterministic Doc materializer
        └── shared Worktree-local Unit create
                   │                    │
                   ▼                    ▼
          native Typst binding    Workspace Server

future local DSH shell ────────────────┘
```

## Decisions

### 1. 在现有 Client Core 中增加一个 Typst owner

`@univerjs/univer-workspace-client-core` 增加 Typst public exports，并迁入现有 compile/materialize/apply input、result 与 workflow。不创建第二个 package；该 capability 与 Worktree Unit owner共享同一个 Node-hosted consumer boundary、SDK baseline 和仓库生命周期。

默认 compile operation 直接调用 `@univer-cli/doc-typst-facade` 的公开 compiler。保留当前窄的 compile function substitution 和 materializer structural dependency用于 behavior tests，不增加 compiler registry、DI container 或 Client Shell base class。

### 2. compile-only 与 apply 使用一次编译结果

owner 每次顶层 operation只调用 compiler一次，并原样返回 compiler fields。compile-only在结果包含error diagnostics时仍返回预览、程序与 diagnostics，且不启动headless runtime。apply先筛出error diagnostics；存在error时抛出当前coded error，只把errors放入detail；warnings不阻止后续materialization。

Client Core接收bundle path和可选preview directory，因为它们是上游compiler的Node-hosted inputs。`--out`和`--diagnostics-out`不是编译输入，继续由CLI command在operation成功返回后写入；Core不拥有本地输出目录创建或diagnostics JSON envelope。

### 3. Typst materializer 保持独立的一次性 headless runtime

materializer继续通过`@univer-cli/headless-univer`创建一个Doc型临时runtime，执行compiler产生的Facade JavaScript并在`finally`中dispose。它不复用Change 6的content runtime owner：后者加载远程Trunk/Worktree Snapshot、持有credential/license、捕获mutation并提交changeset，而Typst materializer只把target-neutral程序转成新Unit的完整initial data。

这种分离避免为一次本地转换启动daemon、Collaboration worker或远程target。未来Client Shell直接调用同一Core operation即可，不需要daemon adapter。

### 4. 原样迁移确定性与 Doc runtime contract

materialization期间继续以generated JavaScript的stable seed替换`Math.random`和`crypto.getRandomValues`，完成后恢复原descriptor。program只能通过允许的Doc facade创建恰好一个与`targetUnitId`同名的Doc；当前禁止的其他Unit create/dispose lifecycle methods继续在调用点失败。

执行结束后必须取得目标Doc、保存record-shaped UnitData并核对identity，再把`id`固定为compiler target、把`rev`归一为`1`。name继续从saved `name`、saved `title`依次选择。本 Change不引入并行materialization调度；现有调用模型保持不变。

### 5. apply 只依赖共享 Worktree-local Unit create

apply把materialized UnitData交给Change 3已完成的Unit create operation，固定type为`doc`，透传Space、Worktree、可选parent Node和调用方idempotency key。name优先使用materialized name，缺失时使用compiled title。Server返回的实际Unit identity不要求等于compiler的临时`targetUnitId`。

Core不复制Unit response parser、idempotency retry或result-unknown算法；这些语义由共享create operation拥有。create失败直接向调用方传播，owner不重新compile或materialize。

### 6. CLI command 与本地输出留在 Client Shell

`features/typst/command.ts`继续拥有`compile-typst`名称、arguments/options、compile-only必须`--out`、apply必须Worktree与Space、target options只能随apply使用等validation。它只将framework-neutral input交给package owner。

command继续按当前顺序写generated JavaScript与schema version `1`的diagnostics JSON，再构造相同JSON/text value。Core不导入Commander、CLI command helper或presentation types。权威feature/materializer实现与核心tests迁入package后，CLI只保留command adapter和command/built-entrypoint tests。

### 7. Core拥有源码依赖，installable Client Shell拥有native delivery

Client Core manifest声明精确SDK baseline的`@univer-cli/doc-typst-facade`与`@univer-cli/headless-univer`，并由package build拥有Typst workflow code。private Client Core不独立发布，也不建立自己的installable native artifact合同。

CLI distribution继续把`@univerjs-pro/doc-typst-native-binding`列为external runtime dependency，并保留现有platform optional package选择。packaging改从新的真实dependency owner解析facade及binding版本，不能依赖pnpm偶然hoist；package verify和installed smoke继续失败于缺失binding。未来另一个可安装Client Shell也必须在自己的artifact中交付该binding。

## Risks / Trade-offs

- **Change 3 的 create export 与计划假设不同** -> apply首步读取真实public export并直接复用；缺失时停止，不建立平行Unit owner。
- **移动materializer时改变random恢复或runtime dispose** -> 迁移现有重复materialization test，并补充contract failure后的descriptor恢复和dispose assertion。
- **compiler error gate顺序漂移** -> Core tests固定compile-only errors可返回、apply errors阻断、warnings放行、compiler只调用一次。
- **CLI输出被误移进Core** -> command contract与built-entrypoint tests继续验证文件内容、diagnostics schema、presentation和arbitrary cwd。
- **binding版本解析仍假定CLI直接依赖facade** -> packaging显式从Client Core的declared dependency定位facade，并用package manifest test固定external version和dependency集合。
- **private package code未进入CLI bundle** -> 复用dependency-first build与Vite bundling，运行package verify和tarball smoke。

## Migration Plan

1. 确认Changes 1与3已完成，并记录Client Core error和Worktree-local Unit create的真实public names。
2. 在Client Core中加入Typst compiler owner与headless materializer，迁移确定性、diagnostics和runtime-contract tests。
3. 迁移apply workflow并复用Unit create operation；将CLI program与command typing切到package exports。
4. 删除无调用方的CLI-owned compile/materializer实现，更新package exports、dependencies和职责文档。
5. 调整CLI artifact对Typst facade/native binding的owner解析，执行Core、CLI、workspace和真实安装artifact compatibility gate。

没有远程或本地数据迁移。失败时可整体恢复CLI Typst owner与imports；既有Worktree Units、Typst bundles和输出文件不需要转换。

## Open Questions

无。会改变行为、实现路径或task breakdown的决定均已由既定边界和本Change设计确定。
