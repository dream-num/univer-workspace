# @univerjs/univer-workspace-reference-provider

`@univerjs/univer-workspace-reference-provider` 是本仓库内部、只供
`apps/workspace` Browser 使用的跨 Unit 只读 Source policy。它把 Host 当前 view 与 Worktree Unit
mapping 转换为 trunk、Worktree 或 per-Unit merge-preview Source scope，并提供一个 ResourceRef Unit
Provider，让 Formula 与 Embed 在当前 Univer Host 中按需 materialize exact Source Unit。

这个 package 是 private workspace module，不发布 npm package，也不供其他 repository 消费。Workspace
CLI 在 `apps/cli` 内拥有独立 Provider 实现；两者只保持 persisted identity 和行为语义一致。

## 职责

- 固定 Workspace Host view 到 Source scope 的唯一选择矩阵。
- 生成和解析仅在一次 `SnapshotService.load*` 调用中使用的 application load context。
- 交付 `workspace-referenced-unit-provider` registration；支持 Sheet、Doc、Slide、Base、Board。
- 校验 ResourceRef、requested type 与 materialized Unit identity。
- 提供 Browser adapter 使用的 scope conformance cases。

## 非职责

- 不解析 Unit Name、URL 或分享链接，不枚举 Workspace。
- 不拥有 Cookie、HTTP transport 或 credential。
- 不调用 `readyForCollab()`，不创建 Source collaboration write session。
- 不改变 Worktree membership，不调用 `addUnit`，不保存或修改 Source。

## 使用

```ts
import { createWorkspaceReferencedUnitProviderRegistration } from "@univerjs/univer-workspace-reference-provider";

const registration = createWorkspaceReferencedUnitProviderRegistration({
  hostContext: {
    view: { kind: "worktree", worktreeId: "worktree-1" },
    mappedUnitIds: ["host-unit", "source-unit"],
  },
  resolveSnapshotService: () => snapshotService,
});
```

`apps/workspace` 提供 package peerDependencies 声明的同一 Univer SDK cohort，并在 Browser composition
中注入 `ISnapshotServerService` adapter。不得为跨 repository 复用增加 publish workflow、公开版本合同或
外部 consumer dependency。
