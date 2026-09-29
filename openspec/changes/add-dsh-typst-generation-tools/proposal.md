## Why

Changes 1–7 已让 local Host-only `dsh-univer-work` 具备 authenticated Worktree/Unit workflow、本地文件 gate、content runtime 与 Office exchange，但 Agent 仍不能把受支持的 Typst Source Bundle 编译为可检查的 Doc Facade program，也不能用同一次编译结果创建 Worktree-local Doc。Workspace Client Core 已拥有 compile、deterministic headless materialization、diagnostic gate 与 Unit create workflow；缺口位于 DSH Client Shell 的稳定 tools、本地 artifact publication、审批、取消和安装态 native closure。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，补齐与 Workspace CLI outcome 对等的 Typst generation vertical slice。

## What Changes

- 注册 `workspace_typst_compile` 与 `workspace_typst_apply` 两个 DSH-native tools。compile 从调用 Session cwd 读取 bundle/`typst.json`，原子发布 `program.js`、schema-versioned `diagnostics.json` 与可选 PNG previews；apply 用同一次编译结果 materialize 并创建一个 Doc 类型的 Worktree-local Unit，可选发布同一组 artifacts。
- 采用一个 closed `artifact_directory`，而不复制 Commander 的 `--out`、`--diagnostics-out` 参数组合；compile 必须提供该目录，apply 可省略。目录默认 no-clobber，工具不接受 `force`、inline source、generated JavaScript、arbitrary Facade program 或 caller-selected output filenames，完整 program 不进入 canonical tool value、render 或 session content。
- 复用 Change 5 的 current file-effect policy、public `LocalFileSystem` identity、Session-cwd containment、path recheck 和一次 approval；approved body 在 private sibling directory 中运行 compiler并写入 artifacts，完成 fixed budgets、sync 与取消检查后才发布目录，失败时清理 private state并保留既有 destination。
- 修改 `workspace-client-core/typst`，为 compile/materialize/apply 增加向后兼容的 optional `AbortSignal`、fixed DSH result/UnitData budgets 与可选 materializer license；不可中断的 frozen Typst native call和 generated program execution必须等待完成，在每个可分离边界检查取消，Unit create 继续复用 Change 4 的 signal、stable identity 与 result-unknown语义。
- apply 复用 Change 6 的 current license resolver 和现有 Host lifecycle；Core 以每次调用独立的 Node VM context 提供 deterministic `Math.random`/`crypto.getRandomValues`，不再修改 process-global descriptors，也不建立worker、daemon、Job、pool、renderer abstraction或第二lifecycle owner。该VM只隔离随机源，不作为恶意代码安全sandbox；工具只执行exact compiler生成且经approval的program。
- 使用 closed snake_case schemas、`512 KiB` canonical argument、各自`50 MiB`的generated program、UnitData和总artifact bytes、`8 MiB` canonical result与`64`层JSON depth上限；apply在Unit create前把DSH可见的target/title/diagnostics/preview metadata限制为`7.5 MiB`，为closed Unit/envelope预留`512 KiB`。diagnostics失败只返回bounded diagnostics并清理private目录；需要本地失败分析artifact时，调用方先使用compile，不由apply发布半套目录。
- packed Host 内联 reachable private Core、Typst facade和headless JavaScript；从已安装 `@univer-cli/doc-typst-facade` owner manifest解析并声明精确`@univerjs-pro/doc-typst-native-binding`及平台 optional package。Typst 路径不增加或调用worker，也不依赖system Typst、外部字体目录、browser、CLI artifact或相邻checkout。

## Scope

**Intent:** 让 local Host-only `dsh-univer-work` Agent 通过 DSH-native tools 把受支持的 Typst Source Bundle 编译为安全的本地 artifacts，并可创建一个可 review 的 Worktree-local Doc。

**Non-Goals:** 不修改 Typst Source Bundle schema、compiler、dialect、diagnostic内容、native binding或现有 Doc Facade lowering；不接受inline Typst、remote/E2B filesystem、caller-generated JavaScript、任意 output filenames或覆盖既有 artifact directory；不实现SVG、Office、screenshot/lint、API/resource discovery、Skills、generic document renderer/artifact service、Jobs、daemon、Web Client、Settings、Slot或Remote；不修改Workspace Server、Browser、HTTP/Collaboration contract、Commander command/output、CLI Session或SDK baseline。

**Size Gate:** 一个新 capability、一个 modified capability、八个 coarse tasks；两个 tools 复用 Changes 4–6 已有 Unit、local-file、license、error与lifecycle seams，只增加一个 Typst native runtime dependency且不增加worker或抽象层，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/typst-generation-tools`: 定义 Host-only local DSH Typst compile/apply tools 的 schemas、artifact目录、file policy、approval、budgets、errors、cancellation、lifecycle与安装态native behavior。

### Modified Capabilities

- `workspace-client-core/typst`: 为现有 Typst compile、deterministic Doc materialization和Worktree-local Unit apply增加optional signal、fixed optional budgets与materializer license，同时保持Workspace CLI compatibility。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Unit、Worktree Unit、Worktree-local Unit与Draft；apply创建一个新的Doc Worktree-local Unit，compiler内部`targetUnitId`不是Workspace分配的真实Unit identity，本地artifact也不是Resource。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client、Workspace Client Core与Client Shell；本Change只通过private Core package exports复用Typst workflow，不导入`apps/cli/src/*`。
- `openspec/changes/extract-typst-client-core/` 已确定Core拥有compile/materialize/apply与native delivery contract；`add-dsh-worktree-unit-tools`、`add-dsh-file-transfer-tools`与`add-dsh-content-runtime-tools`分别提供本Change复用的Unit authority、local file gate及license/lifecycle owner。

No domain-model change.

## Impact

实现主要影响`apps/dsh-univer-work/**`、`packages/client-core/src/{typst,typst-materialize}.ts`、相关tests、package verification/smoke与两处package README。`dsh-univer-work` artifact新增从Client Core-owned exact Typst facade解析的`@univerjs-pro/doc-typst-native-binding` runtime dependency；现有Change 6 worker与formula binding仍服务content runtime，Typst不增加worker entry、worker child、browser或字体资源。

Workspace CLI继续省略optional signal、budgets与license input并保留`compile-typst` options、validation、write order、diagnostics schema、preview metadata、JSON/text output和installed package behavior。Workspace Server/Browser、OpenAPI、数据库、deployment、release workflow和frozen SDK baseline不变。
