## Why

`add-dsh-univer-work-authentication` 为 Host-only Client Shell 建立 authenticated HTTP resolver，但模型仍无法发现 Workspace Space、浏览 Node 树或管理 Node。Workspace CLI 已通过 `WorkspaceSpaceFeature` 交付这些 outcome；DSH 需要在不复制 Commander tree、HTTP 请求或可靠性逻辑的前提下，把同一能力映射成稳定、可授权、可取消的 native tools。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，直接复用 Workspace Client Core 的严格 parser、read-back 与 result-unknown 语义。

## What Changes

- 在 `dsh-univer-work` Host plugin 注册七个 snake_case tools：Space list/browse/find，以及 Node create/rename/move/trash；每个稳定操作使用独立 tool name、root `additionalProperties: false` 的精确 parameter schema、closed output schema 和只从 canonical value 派生的 render。最小纯 operation validator 检查 root object、exact own keys、types 与 cross-field rules；四个 mutation 在 policy 返回 `ask` 前调用它，所有 tool body 再调用一次，关闭 DSH rc.2 open-root validator 与 pre-execute 早于 body validation 的两个缝隙。
- 在 mutation approval、authenticated resolver 和 HTTP 之前校验空字符串、Node 名称、Resource/Unit filter 冲突和 move 自指；失败固定为不反射参数的 `workspace-argument-invalid`。后代关系仍由 Server 权威校验。结果完整保留 Space、Node、Resource、capabilities 与 Trash Batch 的结构化语义。
- 复用 Change 2 的 authenticated HTTP resolver 构造 `WorkspaceSpaceFeature`；Workspace 错误在 tool 边界转换为不泄露 credential 的稳定 failure，只允许冻结基线明确列出的 Core/Server codes 及各操作 allowlisted JSON-safe detail，尤其不弱化 dispatched mutation 的 `workspace-result-unknown`。
- 通过 fiber-owned `tools/pre-execute` listener 对四个 Node mutation tools 先执行同一纯 operation validator，只有合法输入才返回固定、secret-free 的 DSH `ask`；只读 tools 委托给既有 policy。每个 mutation 保持独立名称，`workspace_node_trash` 不被组合或隐藏在通用 update tool 中。
- 把 `exec.signal` 与 Host owner disposal signal 融合后传给整个 Space/Node operation；wrapper 将 body 内的只读或 pre-request abort 分别映射为稳定 cancelled/disposing failure。已 dispatch mutation 的 tool-owned `workspace-result-unknown` 保留；若 Core 在 caller abort 竞态中确认成功，DSH rc.2 仍把最终 tool outcome 强制为 canonical `ABORTED`，调用方必须 browse/read-back 核对且不得自动重放。owner-only dispose 不触发该 caller classification，可保留已确认 mutation result。插件 dispose 停止新调用、abort 在途 HTTP/递归 traversal，并等待所有已接受 tool bodies 收敛。
- 修改 `workspace-client-core/space-node`，为 `list`、`browse`、`find`、`createNode`、`renameNode`、`moveNode` 与 `trashNode` 增加向后兼容的 optional `AbortSignal`，贯穿 authenticated HTTP resolution、分页、递归 traversal、mutation 和 read-back；Workspace CLI 现有调用保持兼容。
- 扩展 source、真实 ToolRuntime、keyless transcript 与安装态 tarball smoke，验证 closed-root schema、mutation pre-approval/body 双重 validation、approval、取消分类、dispose、error-code/detail/secret 边界和 packed Client Core 闭包。Native `tool/call.arguments`、Code Mode `tool/code-dispatch-start.arguments` 与 settled `tool/code-dispatch.arguments` 会保留 DSH 已接收的 caller 参数；测试只要求 approval interaction/events、failure/result content 与 metadata、plugin-owned context/log 不复制非法 key/value，不承诺整个 Session 抹除 caller 已提交的 sentinel。

## Scope

**Intent:** 通过 DSH-native stable tools 交付与 Workspace CLI 对等的 Space list/browse/find 和 Node create/rename/move/trash outcome，并保持 Client Core 的安全、严格解析与远程写入可靠性语义。

**Non-Goals:** 不新增 Worktree、Unit、open、Blob、Asset、文件输入输出、content runtime、worker、Office、Typst、SVG、render/screenshot/lint、API/resource discovery 或 Skills；不提供 Web Client、Settings、Slot、overlay、Remote、Jobs 或 CLI subprocess；不修改 Workspace Server、Browser、HTTP contract、数据库、CLI command/output/Session 或发布流程；不支持 sandbox/E2B/remote profile，不发布 package。

**Size Gate:** 一个新 capability、一个修改 capability、七个 coarse tasks，可在一次 focused implementation session 内完成；依赖 `add-dsh-univer-work-authentication`，不预建后续 Change 的接口或资源。

## Capabilities

### New Capabilities

- `dsh-univer-work/space-node-tools`: 定义 Host-only DSH Space/Node tools 的 schemas、canonical outputs、approval、错误、取消、lifecycle 与安装态行为。

### Modified Capabilities

- `workspace-client-core/space-node`: 为现有 Space/Node workflow 增加 optional `AbortSignal` 传播，同时保持 Workspace CLI compatibility 与既有 parser/read-back/result-unknown 行为。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Space、Node、Resource、Trash、Workspace Agent Client、Workspace Client Core 与 Client Shell；tools 返回这些既有产品身份与能力，不用 DSH 的本地 Workspace 概念替代远端 Space。
- `apps/workspace/docs/data-model.md` 规定 Node 是名称、层级、权限和 Trash 的权威身份，Resource 是稳定内容身份；create 只创建组织 Node，rename/move/trash 全部以 Node ID 操作。
- `apps/workspace/docs/adr/0002-keep-the-workspace-product-in-one-repository.md` 要求 Agent clients 与 private packages 共仓；本 Change 只消费 `@univerjs/univer-workspace-client-core` 根 exports，不导入 `apps/cli/src/*`。
- `openspec/changes/add-dsh-univer-work-plugin-shell/` 与 `openspec/changes/add-dsh-univer-work-authentication/` 分别定义 Host package/lifecycle 和 authenticated connection owner；本 Change 复用二者，不建立第二套 connection、credential 或 lifecycle owner。
- `openspec/changes/extract-space-node-client-core/` 已确定 Core 拥有 Space/Node transport、strict parsers 与 reliability，Client Shell 只负责呈现和生命周期适配。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、`packages/client-core/src/space.ts`、Client Core Space tests、DSH application 的 tool/lifecycle/transcript/package smoke 与职责文档，以及 packed Host artifact 中可达 Client Core 代码。Client Core public method signatures 仅追加 optional signal；现有 CLI caller 不需要修改，CLI Space/Node tests 与 package parity gates继续验证兼容性。

Workspace Server/Browser、OpenAPI、数据库、deployment、Workspace CLI 外部合同、SDK baseline 和 release workflow 不变。package 继续内联 reachable private Client Core，DSH/Cordis 依赖保持精确 external。
