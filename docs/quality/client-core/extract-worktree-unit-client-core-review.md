# extract-worktree-unit-client-core Code Review

审查范围：`git diff d5c28e35aea32ddaccc32222bec4d35e10de8fe3 f6a55c177737680d8b9020e219ca26ce3007e4da`

Standards 与 Spec 由两个独立 subagent 审查。系统 thread limit 阻止同时启动第二个 reviewer，因此 Standards 完成后才启动 Spec；两轴没有共享结论。

## Standards

### STD-01：共享 authenticated HTTP type 仍由 Space feature 拥有

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/space.ts:22`、`packages/client-core/src/open.ts:2`、`packages/client-core/src/unit.ts:5`、`packages/client-core/src/worktree.ts:8`
- 标准与证据：根 `AGENTS.md:31-32` 将共享 HTTP capability 归属 Client Core 的 HTTP 边界。`AuthenticatedWorkspaceHttp` 定义在 `space.ts` 后，新增 open、Unit 与 Worktree workflow 都反向依赖 Space feature，形成错误 shared owner。
- 建议：将同一 type 移至既有 `http.ts`，从 package 根入口保持同名导出，并更新四个 feature 的内部 type import。无需增加 interface、package 或 adapter。

### STD-02：lifecycle mismatch error detail 携带无界 Worktree

- 严重度：medium
- 状态：accepted-risk
- 位置：`packages/client-core/src/worktree.ts:114-121`、`apps/cli/src/command.ts:16-18`
- 标准与证据：mismatch detail 将完整 `WorkspaceWorktree` 放在 `actual.worktree`，其 `units` 数量无界；CLI 会完整 `JSON.stringify` 该 detail。错误输出可能随 Worktree 大小增长并包含与 state mismatch 无关的元数据。
- 建议：detail 只保留 `actualId`、`actualState`、`expectedState` 与 `worktreeId`，维持现有 error code/message。此处与 CLI error-detail parity 存在取舍，修复时应以 Change 的公开行为约束为准，不引入 compatibility layer。

其余检查通过：旧 CLI owner 已删除，后续 capability 的 type imports 使用 package 根入口；stable identity/read-back 没有重复 owner，也没有新增 speculative abstraction。

Standards：2 个历史 findings，最高严重度 medium；0 open，1 accepted-risk。

## Spec

PASS，0 findings。

- lifecycle 保留 allowed/invalid precondition、返回 ID/state mismatch、merge/discard stable key，以及 unknown 后单次 read-back；无法确认时仍返回 `workspace-result-unknown`。
- Unit list/add/create 校验 Worktree membership、source/target/type/name/Space/parent，并跨重试复用相同 identity；`initialData` 未进入公开 error detail。
- review URL 在读取 Worktree 前验证 HTTP(S) base URL，保持 zero/one/many Unit selection、membership 校验、精确 `/worktrees?worktree=…&unit=…&view=agent` 与既有 result shape。
- CLI 命令、Session/auth composition、exchange/Typst 行为和 self-contained package 合同均保持；相关 diff 只迁移 owner、切换公开 imports 并扩充 installed smoke。
- 未发现 missing、partial、scope creep 或错误实现。

Spec：0 findings，PASS。

## Summary

- Standards：2 个历史 findings，最高严重度 medium；0 open，1 accepted-risk。
- Spec：0 findings，PASS。
- 总 open：0。

## Fix re-review：STD-01 / STD-02

复审日期：2026-08-28。产品修复范围：

```text
git diff f6a55c177737680d8b9020e219ca26ce3007e4da 4b9767ba9d9ada452a116108b6e85b7593513938 -- packages/client-core/src/http.ts packages/client-core/src/index.ts packages/client-core/src/space.ts packages/client-core/src/worktree.ts packages/client-core/src/unit.ts packages/client-core/src/open.ts
```

系统 thread limit 阻止同时启动两个 closure reviewer，因此 Standards 完成后才启动 Spec；两轴仍由独立 subagent 执行，没有共享结论。

### Standards closure check

- `STD-01` closed。`AuthenticatedWorkspaceHttp` 已从 `space.ts` 移至其依赖对象 owner `http.ts`；Space、Worktree、Unit、Open 均从 `http.ts` type-only import，package 根入口继续导出同名类型。改动只搬移既有 alias，没有新增 interface、factory、中间层或运行时逻辑。
- `STD-02` accepted-risk。pre-tree `apps/cli/src/features/worktree/management.ts:113-120` 已在 lifecycle mismatch detail 中返回完整 Worktree，`apps/cli/src/command.ts:16-18` 会原样 JSON 输出。无界 detail 是既有风险，不是本次 owner 提取造成的 CLI 能力差异。压缩字段会改变公开错误输出，应另立明确的 behavior Change；本 Change 不添加 compatibility layer。

限定 diff 未发现 regression、新 abstraction 或 code smell。Standards：0 open，1 accepted-risk。

### Spec closure check

PASS，0 findings。type owner 移动保持同名 package root export、类型签名、构造参数和运行时行为。保留旧 Worktree error detail 符合“原样迁移 lifecycle”和 CLI error contract 不变；限定 diff 未引入 scope creep 或 regression。Client Core typecheck 与 113/113 tests 通过。

复审汇总：0 open；1 accepted-risk。
