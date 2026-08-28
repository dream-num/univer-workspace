## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/exchange/exchange.ts` 同时拥有 Office 后缀/type matrix、import/export options、Worktree-local Unit 创建校验、runtime target/UnitData export 接入和 `@univerjs-pro/exchange-node` 默认 adapter。Commander mapping 位于 `features/exchange/command.ts`；`exchange-node.test.ts` 执行真实 XLSX native round trip；CLI package workflow把 `@univerjs-pro/exchange-node-binding` 作为 external runtime dependency，并在安装 smoke 中直接加载其入口。

本 Change 在 `extract-worktree-unit-client-core`、`extract-runtime-target-client-core` 与 `extract-content-runtime-client-core` 完成后实施，分别复用 Worktree-local Unit create、target resolution 和 UnitData export public seams。`extract-file-transfer-client-core` 虽在既定实施顺序中先完成，但其 Blob/Asset 原子文件 protocol 与 Office SDK 的 path-based conversion 不同，不构成本 Change 的代码依赖。

## Goals / Non-Goals

**Goals:**

- 让 Client Core 成为 Office format/type policy、conversion adapter 与 Workspace import/export workflow 的唯一 owner。
- 让 CLI 只保留 Commander presentation 和现有 daemon transport adapter，同时保持所有 observable behavior。
- 让未来 local DSH Client Shell 能直接组合相同 Office owner、content runtime owner 和本机路径。
- 保持 CLI artifact 的 native binding externalization、平台选择与安装 smoke 合同。

**Non-Goals:**

- 不把 Office path-based I/O 改为 byte buffer、stream、filesystem provider 或 artifact service。
- 不添加 CSV、PDF、旧格式输出、Board exchange、自动后缀修复或覆盖保护。
- 不改变 Office SDK、native binding、formula calculation policy 或 runtime UnitData schema。
- 不为 import 与 export 创建两个 package、通用 converter registry 或多实现 factory。

## Diagram design

```text
Workspace CLI shell
  ├── Commander / output
  └── daemon export adapter ───────────────┐
                                           ▼
private Workspace Client Core Office exchange
  ├── format/type/name policy
  ├── Worktree Unit create + runtime target/export
  └── Node Office adapter
             │                         │
             ▼                         ▼
Workspace product/runtime        platform native binding

future local DSH shell ────────────────────┘
```

## Decisions

### 1. 在现有 Client Core 中增加一个 Office exchange owner

`@univerjs/univer-workspace-client-core` 增加 Office exchange public exports，并迁入现有 `WorkspaceUnitExchangeFeature` 的 framework-neutral workflow、input/result types 与默认 Node adapter。不创建第二个 package；Office workflow 与其他 Client Core capabilities共享同一 Workspace model、SDK baseline和预期 consumers。

默认 adapter由Client Core直接组合`@univerjs-pro/exchange-node` 的 `importFile` 与 `exportToFile`。保留当前窄的function substitution用于behavior tests，不引入converter interface、registry或factory hierarchy。

### 2. 直接复用三个 prerequisite capabilities

import 依赖 Change 3 的 Worktree-local Unit create operation与共享 Unit types。export 依赖 Change 5 的 runtime target resolution及Change 6 的UnitData export operation。Office owner通过这些package public operations的最小结构类型组合，不导入CLI feature class、daemon client或RPC `JsonValue`。

CLI composition为Unit create和target resolution传入package operations，并把现有`runtime.export-unit-data` daemon request适配成Core要求的UnitData export function。未来local DSH Client Shell可以把Change 6的content runtime owner method直接传入，因此不依赖CLI daemon。

Changes 1–2 由上述prerequisites传递提供errors、HTTP与认证access。Change 4不提供Office需要复用的contract；强行依赖其atomic download helper会改变现有Office SDK直接读写path的行为。

### 3. 原样保留 import format、options 与名称规则

source extension按现有大小写不敏感matrix解析：XLS/XLSX默认Sheet且可显式Base，DOC/DOCX只允许Doc，PPT/PPTX/PPTM/PPSX/PPSM/POTX只允许Slide。特殊presentation suffix继续显式传`PPTX` format；XLSX Sheet继续强制formula calculation，其他import保持当前options。

converted UnitData的名称继续按显式非空name、converted `name`、converted `title`、`Imported <type>`选择。只有显式name覆盖converted payload的`name`。create继续透传Space、parent Node、Worktree和调用方idempotency key，并严格核对返回的Worktree-local source、type、name和activation target。

### 4. export 在 conversion 前完成 target、format 与 UnitData 校验

export先解析Worktree runtime target并拒绝Board，再从output extension得到XLSX/DOCX/PPTX format，校验Sheet/Base、Doc、Slide兼容矩阵，然后通过注入的content runtime operation导出选定revision的UnitData。返回值必须是record且`id`匹配target Unit，之后才能调用Node Office adapter。

输出继续传入调用方提供的path。Sheet export继续强制formula calculation，Base、Doc和Slide保持当前options。本 Change不增加临时文件、force flag、目录创建或overwrite guard；这些都会改变既有CLI文件行为。

### 5. CLI command 和 daemon wire contract 留在 Client Shell

`features/exchange/command.ts`继续拥有`import`/`export` Commander名称、参数、one-of校验、JSON switch和文本presentation。它只将framework-neutral input交给package owner。

CLI的daemon仍公开`runtime.export-unit-data`及原payload；adapter使用Change 5的canonical target serializer并把结果交给Core Office owner。Client Core不认识daemon method name、socket、Session或process lifecycle。原`features/exchange/exchange.ts`权威实现与feature tests迁入package后删除，command module只改public type import。

### 6. 代码级 native adapter 归 Core，安装责任留给 Client Shell artifact

Client Core manifest声明精确SDK baseline的`@univerjs-pro/exchange-node`，其source build拥有Node adapter代码。private Client Core不独立发布，因此不生成自己的可安装native artifact合同。

CLI继续在distribution manifest中列出`@univerjs-pro/exchange-node-binding` external runtime dependency，并由现有platform optional packages完成native选择；package verify继续检查external dependency集合，smoke继续从临时安装目录加载binding的import/export functions。未来另一个可安装Client Shell也必须在自己的artifact中交付该binding，不能依赖monorepo checkout或CLI package。

### 7. 核心行为测试迁入 package，CLI delivery tests 保留

`workspace-unit-exchange.test.ts`中的format/type、name、create result、target/UnitData与converter调用cases迁入Client Core；`exchange-node.test.ts`的真实XLSX round trip也随native owner迁入。Commander mapping/presentation cases继续留在CLI。

测试不复制完整fixtures或引入新test harness。CLI的package artifact、verify和smoke tests继续验证binding的distribution ownership以及bundle中没有workspace bare import。

## Risks / Trade-offs

- **前序 Change 的 operations 命名与计划不同** -> apply首步读取真实public exports并直接适配，缺失时停止，不建立平行Unit、target或runtime owner。
- **移动 format matrix 时改变校验顺序或options** -> 将现有feature cases迁入Core并补齐所有支持suffix、显式Base、Board、format mismatch和UnitData identity断言。
- **private package dependency未进入CLI bundle** -> 复用既有dependency-first build与Vite bundling，运行package verify和tarball smoke。
- **native binding从source dependency graph消失** -> CLI artifact继续显式拥有external binding，manifest test与installed binding smoke保持不变。
- **Office文件误用Change 4的atomic helper** -> Office owner继续传递原path给SDK；proposal、spec与tests固定不新增overwrite/atomic语义。
- **真实native round trip受平台支持限制** -> 使用既有受支持平台test和artifact smoke，不改变当前CI支持矩阵或增加fallback。

## Migration Plan

1. 确认Changes 3、5、6已完成，并记录Client Core的Unit create、runtime target和UnitData export真实public names。
2. 在Client Core中加入Office format/type policy、Node adapter与import/export owner，迁移behavior和native round-trip tests。
3. 将CLI exchange composition改为package owner及daemon export adapter，保留command presentation和RPC wire shape。
4. 删除无调用方的CLI-owned exchange implementation，更新package exports、依赖图与职责文档。
5. 执行Client Core、CLI、workspace和真实安装artifact compatibility gate。

没有远程或本地数据迁移。失败时可整体恢复CLI exchange owner和imports；既有Worktree Unit和Office文件不需要转换。

## Open Questions

无。会改变行为、实现路径或task breakdown的决定均已由既定边界和本Change设计确定。
