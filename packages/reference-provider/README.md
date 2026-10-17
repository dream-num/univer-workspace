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
  prepareUnit: (unitType) => embedProducts.ensure(unitType),
  resolveSnapshotService: () => snapshotService,
});
```

`apps/workspace` 提供 package peerDependencies 声明的同一 Univer SDK cohort，并在 Browser composition
中注入 `ISnapshotServerService` adapter。不得为跨 repository 复用增加 publish workflow、公开版本合同或
外部 consumer dependency。

## 按需产品运行时

可选 `prepareUnit` 由 Browser 宿主注入。Provider 完成 ResourceRef/type 校验和 scope 选择后，先等待
产品模型与 UI 注册，再调用对应 `SnapshotService.load*`。准备失败直接返回错误，不发起 snapshot
请求；等待中取消的调用不再加载数据。没有该回调的调用方维持原行为。

回调不拥有数据权限、Worktree membership 或写入会话；这些仍由既有 Provider policy 和服务端校验。
产品 chunk、语言包、插件去重和 Worker 生命周期由 Browser editor 拥有，见
[嵌入运行时说明](../../apps/workspace/docs/embed-runtime.md)。
