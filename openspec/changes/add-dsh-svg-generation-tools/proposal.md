## Why

Workspace CLI 已通过 Workspace Client Core 提供 SVG-to-Slide 编译、真实或估算字体测量、page program 和 Draft Worktree apply，但 `dsh-univer-work` 尚无对应的模型工具。Agent 因而无法在 DSH 中执行 Slide Skill 所依赖的 SVG 生成路径，也无法安全地从调用 Session 的本地文件读取 SVG 与 relative assets。

本 Change 在已确认的 local Host-only 边界内补齐 SVG 纵切，复用既有 Client Core、文件策略、content runtime 和 render runtime，不复制 Commander 或另建编译/渲染抽象。

## What Changes

- 在 `apps/dsh-univer-work` 注册独立的 SVG compile 与 Draft apply tools，使用 closed snake_case 参数和有界 canonical values。
- compile 支持 raw 或 1-based page program、replace/add、真实字体测量或显式估算；可把生成代码作为结果返回，或经一次本地写入 approval 保存到 Session cwd 内。
- apply 在一次已批准调用内从本地 SVG 编译 page program，可先保存同一 exact program，再仅通过共享 Slide content execution 写入指定 Draft Worktree Unit；返回 generated union、完整 diagnostics 与 commit outcome。
- 复用 Change 5 的 Host-local provider、Session cwd、当前文件策略和路径 containment，约束 SVG source、递归 relative assets 与可选代码输出；复用 Change 6 的 revision/result-unknown/no-replay 语义和 Change 9 的 render page/browser owner。
- 为 `workspace-client-core/svg` 增加可选 `AbortSignal` 与调用方提供的本地根目录约束；区分 body 已观察的 file-confirmed partial 与仅 DSH registry final check 捕获的 late-success `ABORTED`，CLI 省略新选项时保持现有行为。
- 扩展预构建 tarball 的 exact SDK/runtime 闭包，并以真实 DSH ToolRuntime、隔离 cwd 和 keyless dependencies 验证 compile/apply、approval、取消及 dispose。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 提供可安装、可取消且保留 Draft commit 可靠性语义的 SVG-to-Slide generation tools。

**Non-Goals:** 不实现 Typst、Office exchange、screenshot、layout lint、API/resource discovery、Skills、daemon、Jobs、Web Client 或 remote filesystem；不复制 CLI command tree、文本 presentation 或 CLI Session；不增加 compiler/renderer/filesystem registry、共享 browser pool、自动 browser 下载或新的 SVG mapping；不允许 Trunk write、arbitrary code、inline/base64 SVG、HTTP asset、调用方提供 origin/revision/license/render path；不让 apply 接受既有 generated code 或 compile token，source 必须在该调用内编译一次。

**Size Gate:** 一个 DSH SVG capability 与一个既有 Client Core capability modification，预计八个 coarse tasks，可在一次 focused implementation session 内完成。直接依赖 `add-dsh-file-transfer-tools`、`add-dsh-content-runtime-tools` 与 `add-dsh-render-verification-tools`；认证和 Worktree/Unit tools 是传递或验收依赖。

## Capabilities

### New Capabilities

- `dsh-univer-work/svg-generation-tools`: 提供受本地执行世界、approval、结果预算与 Host 生命周期约束的 SVG compile 和 Draft apply DSH operations。

### Modified Capabilities

- `workspace-client-core/svg`: 为现有 SVG compile/measure/apply workflow 增加可选取消信号与调用方本地根目录 containment，同时保持未传新选项的 CLI 兼容性。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Unit、Worktree Unit 与 Draft；apply 只修改指定 Worktree 中的 Slide Worktree Unit，不把 Node、Resource 或 Trunk 当作写入目标。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；framework-neutral SVG workflow 留在 Core，DSH tool schema、Credentials、文件策略、approval、artifact path 与生命周期留在 Client Shell。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/docs/adr/0001-co-locate-workspace-agent-clients.md` 要求两个 Agent clients 通过同仓 private package exports 共享能力，禁止 CLI subprocess 和应用间源码导入。

No domain-model change.

## Impact

规划影响后续实现的 `apps/dsh-univer-work/**`、`packages/client-core/src/svg.ts` 及其 exports/tests、应用与 Core manifests、DSH build/package verification、Client Core/CLI compatibility tests 和相关职责文档。运行依赖继续固定 Workspace/SDK `1.0.0-beta.2` 与 DSH `0.1.1-rc.2`；private Core 仍内联进自包含插件 artifact，DSH/Cordis 与所需 SDK/browser packages 维持 exact declared externals。

Workspace Server、Browser、HTTP/Collaboration contract、数据库、CLI command/output/Session、SDK baseline、DSH Web profile 和发布渠道不变。
