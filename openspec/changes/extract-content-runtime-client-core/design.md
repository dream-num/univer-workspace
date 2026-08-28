## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/runtime/daemon.ts` 同时充当 CLI daemon entry、runtime pool owner 和 content commit coordinator；`runtime/worker.ts` 从 CLI Session 文件与环境读取 credential/license，再装配 Workspace Snapshot/reference adapters、headless Univer 和 Collaboration backend。`features/content/execution.ts` 通过 daemon port 完成 target resolution、Facade program preparation 与结果解析，inspection、exchange 和 screenshot 则直接调用两个只读 RPC methods。

`extract-runtime-target-client-core` 先把 target、Snapshot adapter、reference policy/provider 与 host-context loader移到 private `packages/client-core`。本 Change 必须在它完成后实施，复用其唯一 runtime access contract。`docs/adr/0001-co-locate-workspace-agent-clients.md` 已确定共享实现和目标仓库。

## Goals / Non-Goals

**Goals:**

- 让 Client Core 成为 worker composition、runtime pool、同步、内容执行、UnitData export、embedded-image 外置和 changeset commit 的唯一 owner。
- 让 CLI daemon 只适配 socket/RPC、CLI credential/license 与 process shutdown，同时保持 wire contract 不变。
- 让未来 local DSH Client Shell 能直接持有同一个 runtime owner，不依赖 CLI daemon 或 Session 文件。
- 保持 runtime reuse、错误、commit retry、best-effort image hosting、CLI output 和实际 package artifact 行为。

**Non-Goals:**

- 不为 runtime owner 建立 service container、plugin framework 或多实现 factory hierarchy。
- 不增加 operation cancellation、commit attempt 配置、credential rotation、runtime eviction policy或新的 telemetry。
- 不迁移 Office、Typst、render、screenshot/lint 和 SVG 的业务 workflow。
- 不改变 upstream Univer CLI SDK runtime、Collaboration 或 content-inspection contracts。

## Diagram design

```text
Workspace CLI commands
  └── daemon client ── RPC ── CLI daemon shell
                              ├── Session/license providers
                              └── Client Core content runtime owner
                                    ├── pool + packaged worker
                                    ├── read / export / execute
                                    └── image rewrite + commit

future local DSH shell ───────────────┘
```

## Decisions

### 1. 在现有 Client Core 中加入一个可关闭的 runtime owner

`@univerjs/univer-workspace-client-core` 增加一个 content runtime owner，公开 `executeRead`、`exportUnitData`、`executeAndCommit` 和 `close` 这组最小操作。owner 内部持有一个 `@univer-cli/univer-collaboration-runtime-pool`，按 Change 5 的 revision-independent runtime key acquire worker lease。

不新增第二个 package或通用 runtime registry。三个内容操作共享同一同步、lease 和 worker lifecycle，拆开 owner会重复错误处理并使 shutdown无法统一收敛。

### 2. Client Shell 注入 worker entry、credential 与 license resolver

runtime owner 在创建新 worker 所需的 initialization value 时调用 Client Shell提供的 credential 与 license resolver，并把 target、Login Session credential和 resolved license作为私有、可序列化的 worker init传入子进程。worker init不得进入 daemon RPC payload、结构化结果、日志或 coded error detail。

CLI daemon adapter继续从现有 Session path读取当前 origin的 cookie，并通过现有环境规则解析 license；未来 DSH shell可以从自己的 credential store和配置提供相同值。credential只在新 worker创建时解析，pool复用期间不主动重建 backend，与当前 worker startup时读取Session的时序一致。本 Change不增加credential rotation或强制 eviction。

worker entry URL由交付方显式提供。Client Core拥有worker implementation和public worker subpath；CLI保留一个薄 package entry或build entry把该worker放进当前 `dist/runtime/worker.js`，未来 DSH artifact可以包装同一subpath。这样共享worker行为，同时不让private package假设consumer的artifact目录。

### 3. worker composition 完整迁入 Core

Core worker解析私有init，复用 Change 5 的 runtime target、host-context loader、Snapshot adapter和referenced Unit provider，装配headless Univer与Collaboration backend，并加载target Unit。它不导入CLI Config、Session path、`process.env`或daemon identity。

Collaboration HTTP、WebSocket、session-ticket和Trunk/Worktree endpoint构造保持现状。target的Unit、type和revision仍由Change 5的parsers与host validation约束；本 Change不产生第二套target或Worktree parser。

### 4. owner 保留现有 synchronize、reuse 与 invalidation 算法

每个操作先 acquire lease并检查 pending mutation、awaiting changeset和conflict，随后pull并要求base revision精确匹配selected target。read execution与UnitData export始终release lease；write execution只有无mutation或confirmed commit时release，其余路径invalidate。

不把commit attempt count改成配置。当前固定三次是既有可靠性合同；开放一个从未变化的knob只会扩大API和测试面。

### 5. content execution 通过三操作 structural port 连接 Shell

Facade program preparation、editable target resolution、Slide-specific type guard和runtime result parsing进入Client Core的content execution workflow。它只依赖Change 5 target resolver与一个具有所需runtime operations的结构化值，不依赖daemon types。

CLI main提供一个薄adapter，把三项操作映射到现有 `runtime.execute-read`、`runtime.export-unit-data`和`runtime.execute-and-commit` RPC；daemon handlers则把同名payload委派给Core owner。inspection command仍属于CLI presentation，但target selection和read execution使用Core exports。exchange与screenshot只切换到同一export port type，本 Change不移动它们的workflow。

### 6. embedded image 外置属于 commit pipeline

`embedded-images.ts`与`image-references.ts`的权威实现迁入Core。write execution捕获mutation后，在替换pending mutations前按内容digest去重supported raster BASE64，使用该target origin的authenticated Workspace HTTP调用Worktree File API，并把成功项改写为UUID。

upload仍是best-effort：单项失败、非法data URI、SVG或超过20 MiB的图片保持原值，提交继续进行。Core不会复用Change 4的Blob/Asset transfer owner，因为这里使用不同endpoint、identity和失败语义；两者建立依赖只会错误合并两个协议。

### 7. commit 只重试 pending changeset，不重放 execution

externalization完成后，owner一次性replace pending mutations，再最多三次调用lease commit。`confirmed`返回base revision；`retry`与`unknown`继续同一pending changeset；`conflict`、`pull-required`、discard或exhaustion保留现有stable errors。任何未确认路径invalidate lease，避免另一个consumer复用含有不确定mutation的runtime。

CLI daemon只做RPC request validation和coded error transport，不复制commit状态机。核心行为测试随owner迁入package；daemon tests只验证wire mapping、credential/license composition和shutdown delegation。

## Risks / Trade-offs

- **credential进入worker init后被错误输出** -> init parser、errors和daemon contract tests确认cookie/license从不出现在RPC、result或error detail；只在本机parent-child IPC内传递。
- **Change 5 exports与计划假设不一致** -> apply首步读取真实target/adapter/provider exports并复用；缺失时停止，不建立平行实现。
- **worker public subpath未进入CLI artifact** -> 保留当前CLI worker build entry并让它只包装package export；运行实际package verify和tarball smoke。
- **daemon与direct owner调用产生两套行为** -> daemon handlers只委派同一owner methods；Core tests固定算法，CLI tests固定wire adapter。
- **image外置误依赖Change 4或改变fallback** -> 独立保留File API uploader与现有fixtures，明确Change 4不是直接依赖。
- **池关闭时worker仍有进行中操作** -> 复用runtime pool的close contract，并让daemon shutdown等待owner close；本 Change不改变upstream pool语义。

## Migration Plan

1. 确认 Change 5 已完成，并记录Client Core target、Snapshot/reference和authenticated HTTP的真实public exports。
2. 在Client Core中加入worker implementation、content runtime owner、embedded-image pipeline与行为测试。
3. 迁移content execution workflow和runtime operation types，保留Commander与inspection presentation。
4. 将CLI worker entry缩减为Core worker包装，将daemon handlers缩减为Core owner adapter，并保留Session/license和signal owner。
5. 切换program、inspection、exchange与screenshot callers到Core public types/operations，删除无调用方的CLI-owned implementation。
6. 更新package build/worker assets与职责文档，执行Client Core、CLI、workspace和实际安装artifact compatibility gate。

没有持久化数据、Session schema或远程state迁移。失败时可整体恢复CLI worker/daemon/content owner与imports；现有daemon socket、remote Worktree和runtime worker临时状态无需转换。

## Open Questions

无。会改变行为、implementation approach或task breakdown的决定均已由既定边界和本Change设计确定。
