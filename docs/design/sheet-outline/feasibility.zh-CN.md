# 表格 outline 迁移到 Workspace 的可行性研究

状态：调研稿，待对齐。日期：2026-11-13。

本文回答一个问题：unvdp 的 outline、find、按 ref 放大等表格探索方式，能否迁移到 Univer Workspace，
并在单文件、多文件、多 repo 三种场景下成立。本期只覆盖 spreadsheet，同时说明其他 Unit 类型以后从哪里接入。
本文不改代码，所有结论都标明依据；标为「推断」的结论还没有在真实 Workspace Unit 上跑过。

参照仓库与版本：

- unvdp：`dream-num/unvdp@2344614`，协议 0.1，outline 格式 0.7，detector 0.3。
- uxl：`dream-num/uxl@ab4070c`，从 unvdp `23446146` 移植 Lens。
- Workspace：本仓库 `b7c49917`，`@univer-cli/*` SDK 1.4.0。

## 结论

**单文件可行，风险低。** unvdp 的 Lens 是纯函数，输入是 `IWorkbookData`、显示文本和对象结构。
Workspace 已有拿到 `IWorkbookData` 的通路：`WorkspaceContentRuntimeOperations.exportUnitData`，
截图、PDF、导出都依赖它。uxl 已经证明显示文本和对象结构都能从快照本身算出来，不需要活的 Univer 实例。
剩下的风险是显示文本和对象 resources 在 Workspace 快照上是否与 xlsx 导入一致，需要在真实 Unit 上验证。

**多文件部分可行。** 对单个 Unit 做 outline 和 find 没有障碍；把多个 Unit 汇总成一份「repo 地图」或做
跨文件内容搜索，今天只能逐个加载 Unit，成本随文件数线性增长，而且 MCP 执行器只有 4 个 worker、
单次调用 25 秒上限。第一期应做有上限、诚实报告覆盖率的扇出，不做服务端索引。

**多 repo 在身份层面可行，成本与多文件相同。** `unitId` 全局唯一，MCP `inspect` 只凭 `unitId` 就能读，
不需要 repo 句柄；带 `unitId` 的 ref 天然跨 repo。跨 repo 的内容搜索与跨文件搜索是同一个问题。

**unvdp 和 uxl 都没有多文件设计。** unvdp 的 ref 表属于单个 target，`s1.t1` 不说明是哪个工作簿；
uxl 每条命令只接受一个文件。多文件下的 ref 命名、覆盖率报告、扇出上限，都需要 Workspace 自己设计。

**「比 uvw 更省 token」目前没有可引用的测量。** unvdp 和 uxl 仓库里只有与 openpyxl 基线的对比，
没有与 `uvw` 的对比。迁移前应先做一轮同题对照，见第 9 节。

## 1. 三者今天怎么读一张表

| 维度 | unvdp | uxl | Workspace（`uvw` / MCP） |
| --- | --- | --- | --- |
| 数据来源 | 本地 xlsx 导入到常驻 daemon 的 headless Univer；也可从 Collaboration server checkout 一个 worktree | 本地 xlsx，经 `exchange-node` 导入为快照，按内容哈希缓存 | 远端 Unit，worker 内 headless Univer 加载快照并回放 changeset |
| 全局视图 | `outline`：区域树，带列类型、统计、公式模式、合并、筛选、对象 | `inspect`：移植的同一套区域树 | `inspect workbook`：每张表的 used range、公式范围、合并、表格、CF/DV 数量、图形数量 |
| 放大 | `outline --at s1.t1`，`read --at <ref或A1>` | `inspect --at s1.t1`，`read 'Sheet!A1:G13'` | `inspect range <A1>`，没有区域或 ref 概念 |
| 搜索 | `Lens.find`，单工作簿内，命中带最近的 outline 节点 ref | `find`，多词、`--in values\|formulas`、`--from` 续页 | 没有表内搜索；`space find` 只匹配文件名 |
| 大表处理 | 每个 scope 6000 字符预算，省略行可续读；工作簿超过 5 万字符退化为表清单 | 同 unvdp | 没有分页；超过 MCP 8 MiB 返回 `workspace-result-too-large` |
| 精确值 | `Runtime.evaluate`（默认关闭） | `read --json`，或 `exec` 脚本 | `inspect range --json` 的 `{v,t,displayValue,f}`，或只读 `execute` |
| 多工作簿 | daemon 可同时开多个 target，但 ref 不带命名空间，CLI 只记一个当前 session | 无 | 每次调用显式给 `--unit` 与 scope，天然多 Unit |

依据：unvdp `rfcs/0001-unvdp/04-lens-outline.md`、`03-domains.md`、`schema/unvdp.d.ts`；
uxl `test/golden/inspect/*`、`src/lens/read.ts`、`src/lens/find.ts`；
Workspace `apps/cli/skill-data/sheet/SKILL.md`、`apps/mcp/src/gateway/tools/core/inspect.ts`、
SDK `@univer-cli/content-inspection@1.4.0` 的 `dist/index.d.ts`。

两者在「读」上的差距集中在三处：

1. **Workspace 的 `inspect workbook` 只回答「哪里有数据」，不回答「数据是什么」。** 它没有表头、
   列类型、取值分布、公式模式、小计行这些 outline 的核心信息。Agent 只能接着 `inspect range` 读原始格子，
   或写 `execute` 脚本自己统计。
2. **Workspace 没有续读机制。** outline 的每条省略行都给出续读命令，Agent 不会把「被截断」误当成「没有」；
   `inspect range` 只能整块返回或报错。
3. **Workspace 没有表内搜索。** 找一个值只能读整片区域或写脚本扫描。

同一个例子，unvdp outline 的输出（`packages/unvdp-core/test/server/elements.test.ts` 逐字节比对）：

```text
- workbook "Elements" [sheets=4]
  - sheet "Types" [ref=s1, used=A1:N10, frozen=1r]
    - table [ref=s1.t1, A1:N10, rows=8, totals=10]
  - sheet "Layout" [ref=s2, used=A1:H20]
    - text "Quarterly Report" [ref=s2.x1, A1:E1, span=A1:E1]
    - form [ref=s2.f1, A3:B5, fields=3]
    - kpi [ref=s2.k1, G3, number, f=SUM(B9:E11)]: 107
```

放大到列（同一测试）：

```text
    - col "Region" [ref=s1.t1.c7, G, text, 4 distinct: East|West|North|South]
    - col "Amount" [ref=s1.t1.c13, M, number unique, 0.5..99, f=E{r}*F{r} ×6, breaks: M8, const: M6]
```

Workspace `inspect workbook` 对类似工作表的输出（用 SDK 导出的 `renderContentInspection` 渲染合成数据得到，
不是仓库内测试）：

```text
worksheet [1] s1 Q1 (1000x26)
  values: A1:D9
  formulas: D2:D9
  merged: A1:C1
  tables: Orders(A1:D9)
  conditional formatting: 1
```

## 2. 单文件：Lens 的输入在 Workspace 里都拿得到

### Lens 需要什么

unvdp 的 `src/lens` 由 `scripts/check-boundaries.mjs` 约束为纯 TypeScript，只允许 `@univerjs/core` 的类型导入。
入口是三步：

1. `workbookFromData(snapshot, name, displayReader, structure?)`
2. `buildOutlineModel(wb, { revision, prevRefs })`
3. `renderOutline(model, { ref, depth, budget, from })`

所以 Lens 需要四样输入：

| 输入 | unvdp 的来源 | uxl 的来源 | Workspace 的来源 |
| --- | --- | --- | --- |
| `IWorkbookData` | 活实例 `workbook.save()` | `exchange-node` 导入 | `exportUnitData()`，已有 |
| 显示文本 | 活实例 `getDisplayValues()` | `src/engine/display.ts`，只用 `@univerjs/core` 的 numfmt 复现，测试与活实例对拍 | 可直接复用 uxl 做法 |
| 对象结构（表格、筛选、名称、CF、DV、透视表） | Facade `getTableList()` 等 | `src/lens/structure.ts`，从 `snapshot.resources` 的 `SHEET_*_PLUGIN` 解码 | 同 uxl，前提是 Workspace 快照带这些 resources（推断，待验证） |
| 上一次的 ref 表 | 内存中按 target 保存 | 不保存，按内容首次分配规则重算 | 见第 5 节 |

公式：Workspace 的 headless Univer 以 `NO_CALCULATION` 加载（`@univer-cli/headless-univer` README），
读取的是快照里缓存的 `v`。uxl 只在文件缺缓存值时才起实例计算；Workspace 的 Unit 由编辑器写入，
通常带缓存值，这个分支可以不要。

渲染引擎：三者都不需要。列「窄」的判断来自列宽数值，不做排版测量。

### 三种接入方式

| 方式 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| A. 宿主进程跑 Lens | `exportUnitData()` 把 `IWorkbookData` 交给 daemon 或 MCP 执行器进程，Lens 作为普通 TS 运行 | 通路现成；Lens 保持纯函数，可单测；与截图、导出同一条数据路径 | 整本工作簿 JSON 经 worker 到宿主进程序列化一次；显示文本靠复现 numfmt |
| B. worker 内跑 Lens | 把 Lens 打成一段 JS，经 `runtime.execute-read` 在 worker 里对活实例执行 | 可直接用 `getDisplayValues()` 与 Facade，不复现 numfmt | Lens 有数千行，每次调用要传代码或改 worker 入口；worker 由 SDK 的 `defineUniverCollaborationRuntimeWorker` 定义，只开放 `execute` 与 `exportUnitData` |
| C. 上游 SDK 新增 inspection kind | 在 `@univer-cli/content-inspection` 里加 `outline` 查询，Workspace 照常调用 `inspect` | 归属最正确；CLI、MCP、DSH 自动获得 | 依赖 SDK 发版与 `pnpm update:univer-sdk`；格式迭代变慢 |

**建议先走 A，格式稳定后推 C。** A 不需要新增 daemon 方法以外的东西，Lens 原样可测；
uxl 已经证明「快照 + 复现 numfmt + resources 解码」能得到与活实例一致的显示文本（`test/engine/display.test.ts`）。
放进宿主进程时，把 outline 计算放在 daemon（CLI）或执行器（MCP）一侧，只把渲染好的文本返回给调用方，
大块 JSON 不出本机进程边界。

### 单文件风险

1. **resources 一致性（推断，待验证）。** uxl 的 resources 来自 `exchange-node` 导入；Workspace 的来自协同快照。
   两者用的是同一组 Univer 插件 resource 名，但 Workspace worker 的 headless Univer 是否注册了透视表等 Pro 插件、
   `exportUnitData()` 是否原样保留未注册插件的 resources，需要在真实 Unit 上确认。
2. **显示文本一致性。** 复现的 numfmt 必须与 Workspace 浏览器端看到的一致；uxl 的对拍测试可以直接搬来，
   换成 Workspace 快照做 fixture。
3. **大表内存。** uxl 在 10 万行 × 8 列上冷启动 `inspect` 用 2.72 秒、1.36 GB RSS，读 50 行同样要全量建模
   （`docs/research/2026-11-05-large-workbook-performance.md`）。成本随整本工作簿增长，不随任务增长。
   Workspace 的 worker 已经全量加载 Unit，A 方式再在宿主进程持有一份模型，内存翻倍。
   应按 `(scope, unitId, revision)` 缓存 outline 模型，而不是每次调用重建。

## 3. 多文件：outline 按 Unit 做，汇总和搜索要设上限

### Agent 今天怎么在多个文件间移动

Workspace 的产品模型是 Space（repo）> Node 树 > Resource > Unit（`apps/workspace/docs/data-model.md`）。
Agent 今天的多文件路径是：

1. 用 `space browse` 或 `space find` 列文件。两者只返回元数据，`find` 是客户端递归遍历后按名字子串过滤
   （`packages/client-core/src/space.ts`），每个目录一次 HTTP，没有上限。
2. 选出若干 `unitId`。
3. 对每个 Unit 单独 `inspect`，结果之间没有关联。

服务端没有任何内容搜索或索引。`apps/workspace/server/src` 中没有全文检索，OpenAPI 里唯一的 search 接口是
`/api/users/search`。

### repo 地图

outline 的价值在于让 Agent 一眼看清结构。放到 repo 层面，对应的是「这个 repo 里有哪些表、每张表大致装了什么」。

- **元数据层（便宜）。** 文件树、Unit 类型、更新时间都来自现有列表接口，可以随时给。
- **内容层（贵）。** 每个文件给一行 outline（`depth=0`，只列 sheet 名和 used range），也要加载每个 Unit。
  服务端的 SDK worker 每个启动约一秒（`apps/workspace/docs/architecture.md`）；CLI 一侧冷加载一个 Unit
  还要下载快照和回放 changeset，本文没有测量，按同一量级估计。

建议：repo 地图只给元数据，并提示用 `outline --unit` 逐个进入。等第 10 节的阶段 3 有了按修订缓存的
outline，再考虑把缓存命中的摘要并入地图。

### 跨文件内容搜索

没有索引时，跨文件搜索等于逐个加载 Unit 再扫描。MCP 执行器的限制（`apps/mcp/README.md`）：

- `EXECUTOR_MAX_WORKERS=4`
- `QUEUE_TIMEOUT=5s`
- `OPERATION_TIMEOUT=25s`
- 网关单次调用 30 秒

一次 MCP 调用里扇出十几个冷 Unit 基本会超时。CLI 在用户本机，限制宽松，但同样是线性成本。

建议第一期：

1. `find` 默认只作用于一个 Unit。
2. 允许传多个 `--unit` 或一个目录，设硬上限（例如每次 8 个 Unit），结果按 Unit 分组，
   末尾报告「已搜索 8/40 个，续读命令 …」。这沿用 outline 的续读约定，不让 Agent 把部分结果当作全部。
3. 服务端内容索引不进本期。它是派生的 Unit 内容，按 `AGENTS.md` 不能进产品数据库，
   需要单独的存储和失效机制，属于独立的产品决策。

### 跨 Unit 引用

Sheet 可以用公式引用其他 Unit。持久化身份在宿主 Unit 的 `UNIVER_EXTERNAL_REFERENCE_PLUGIN` resource 里
（`sourceUnitId`），读者按 scope 规则懒加载来源（`packages/client-core/src/reference-scope.ts`）。

对 outline 来说这是好消息。列出「这张表引用了哪些 Unit」只需读宿主快照的 resources，不加载来源。
建议 outline 在 workbook 节点下列出 `refs-out: <unitId>…`，名字按需经 `/api/unit-resources/{unitId}` 解析。
来源无权限时该接口返回 404，outline 只显示 `unitId`，不泄露名字。

## 4. 多 repo：身份没有障碍

- `unitId` 全局唯一，MCP `inspect` 只接受 `unit` 与 scope，不需要 repo（`apps/mcp/src/gateway/tools/core/inspect.ts`）。
- Worktree 属于一个 repo，scope 是每次调用的参数，所以「repo A 的 trunk 与 repo B 的某个 Worktree 同时读」没有歧义。
- 权限由服务端对每个 Unit 单独判定，Agent 跨 repo 读取不需要额外的授权模型。
  区域保护不是保密手段，快照读取本来就不按区域过滤（`apps/workspace/docs/content-permissions-validation.md`），
  outline 和 find 不会因此扩大可见范围。

跨 repo 的列举走 `repo list` 再逐个 `space browse`。跨 repo 内容搜索与第 3 节是同一个问题，同样设上限。

## 5. ref 设计：无状态、以 Unit 为命名空间、带修订戳

unvdp 和 uxl 在 ref 上走了两条路：

- **unvdp 有状态。** ref 表属于 target，编辑后按「相同范围、相同表头签名、IoU ≥ 0.5」等规则对账，
  旧 ref 失效时返回 `StaleRef`。ref 表不随 xlsx 保存，daemon 重启后编号从 `s1` 重来。
- **uxl 无状态。** 同样内容永远得到同样的 ref，ref 只对打印它的那份内容有效；结构性编辑后要重新 `inspect`。

Workspace 应选无状态，理由是：

1. MCP 执行器按 `(userId, scope, unitId)` 做 rendezvous 路由，多副本之间不共享会话状态；
   有状态的 ref 表要么落库，要么绑死副本。
2. 浏览器 Agents 要求工具列表与系统提示词在会话内逐字不变（`AGENTS.md` 提示缓存一节）。
   无状态 ref 只出现在工具结果里，与这条约束天然兼容。
3. Workspace 已经有「内容身份」。uxl 用文件哈希，Workspace 用 `(scope, unitId, revision)`。

具体形态：

- **Unit 内的 ref 沿用 unvdp 语法**：`s1`、`s1.t1`、`s1.t1.c3`、`obj:<type>/<id>`。
  sheet ref 可以直接绑定 `sheetId`，改名不变。
- **跨 Unit 的结果用 Unit 限定**：一次输出涉及多个 Unit 时（多文件 find），每组结果以 `unit <unitId> "<文件名>"`
  开头，组内用 Unit 内 ref。放大时 Agent 照常传 `--unit <unitId> --at s1.t1`。
  不发明 `<unitId>/s1.t1` 这样的复合字符串，避免第二套寻址语法；如果评测显示 Agent 常传错 Unit，再加。
- **每次输出带修订戳**：`rev=<n>`。放大调用可带 `--rev`；当前修订不同时照常返回，但提示「ref 基于 rev n，
  当前 rev m，区域可能已移动」。只读 trunk 时修订很少变化，这个提示主要服务于 Agent 自己在 Worktree 里写入之后。

代价：无状态 ref 在编辑后可能重新编号，同一张表的 `t2` 可能变成 `t3`。
uxl 在 SpreadsheetBench 400 题上的输入 token 比 unvdp 多 44.6%、工具调用多 59.6%（同模型 deepseek-flash，
`uxl/docs/research/2026-11-02-spreadsheetbench-400/README.md`）。这个差距有 skill 和工具集的混杂因素，
不能归因于无状态 ref，但说明「照搬 uxl」不是零成本，需要在第 9 节的对照里单独观察编辑后重读的次数。

## 6. 各消费方的接线

| 消费方 | 读路径 | 新能力怎样到达 |
| --- | --- | --- |
| `uvw` CLI | client-core → daemon → worker | `packages/client-core` 新增 `WorkspaceSheetOutlineFeature`，`apps/cli/src/features/outline` 注册命令 |
| MCP | client-core + 执行器 | `shared/executor-protocol.ts` 加 op，`executor/ops/` 加处理器，`gateway/tools/core/` 加工具，更新 `instructions.ts` 与 core skill |
| 浏览器 Agents | 通过 MCP core toolset | MCP 一侧加好即自动获得，不改浏览器代码 |
| DSH 插件、Space 插件 | `packages/workspace-agent-runtime`，独立实现 | 需要并行接线，第一期不做 |

两点约束：

- 浏览器 Agents 每轮重新列工具（`runtime/runner.test.ts`），依赖执行器的工具会随执行器能力发现而出现或消失。
  outline 工具应进入 core toolset 并保持描述稳定，否则会破坏提示缓存。
- `inspect` 由 SDK 的 Commander preset 提供（`createWorktreeContentInspectionCommand`）。
  在本仓库实现时应新增独立命令 `outline`、`find`，不改 `inspect` 的语义，等推到上游（方式 C）时再合并。

## 7. 代码从哪里来

unvdp 的 `@unvdp/core` 是 `private: true`，没有 LICENSE，导出直接指向 TS 源码，没有构建产物。
uxl 的做法是移植而不是依赖，每个文件头注明来源 commit，Lens 约 4.8k 行。

| 选项 | 说明 | 判断 |
| --- | --- | --- |
| 依赖 `@unvdp/core` | 无发布、无构建、无版本承诺 | 不可行 |
| 移植到本仓库私有包 | 新建 `packages/sheet-lens`（名字待定），只依赖 `@univerjs/core` 类型与 numfmt，边界测试保证纯净 | 最快，但会有第三份副本（unvdp、uxl、Workspace） |
| 推到 `univer-cli-sdk` | Lens 成为上游公开能力，三方共用 | 归属正确，周期最长 |

`AGENTS.md` 规定 inspection 属于 Univer CLI SDK，本仓库不复制上游合同。
unvdp 不是本仓库的上游 SDK，移植本身不违反这条；但长期留在本仓库就是在应用仓库里拥有一个通用的 inspection 能力。
建议移植时按 workaround 的标准隔离：单独一个包，写明来源 commit 和「上游提供后删除」的条件。

## 8. 为其他 Unit 类型留的扩展口

unvdp 和 uxl 都没有代码层面的类型抽象，unvdp 协议明确把 Docs、Slides 列为范围外。可以复用的是做法，不是代码：

- 文本树行语法 `- kind "name" [attrs]: value`；
- 按 scope 的字符预算、省略行与 `from` 续读；
- 内容决定的 ref；
- `--at` 放大。

Workspace 已有按类型分派的位置：`WorkspaceRuntimeUnitType`（`packages/client-core/src/runtime-target.ts`），
以及 SDK inspection 的「每种类型一个概览 kind」。建议：

- 命令与工具以 Unit 为对象，`outline --unit <id>` 按 Unit 类型分派到各自的 Lens；
  本期只注册 sheet，其他类型返回 `outline-unit-type-unsupported`。
- 预算、省略、续读、修订戳放在类型无关的一层；区域检测、列统计、A1 寻址放在 sheet Lens 里。
- 不为还不存在的类型预先定义接口。第二种类型出现时，再从 sheet 的实现里提取公共部分。

## 9. token 效率：先补一轮同题对照

现有证据：

- unvdp `docs/research/command-gap-results.md`：SpreadsheetBench 400 题，单次运行，gpt-6.1-sol。
  unvdp 368 题通过，openpyxl 基线 371 题；平均输入 token 82k 对 62k，输出 786 对 1,361。
  作者说明没有消融，调用次数下降主要来自 skill 措辞。
- unvdp `docs/research/outline-0.5-e2e.md`：outline 0.4 到 0.5 的 A/B，92 题 91/92 对 91/92，输入 token
  中位数差异的置信区间包含 0。作者结论是「无害，未证明有益」。
- unvdp `docs/research/detection-eval.md`：detector v0 在冻结测试集上 F1 0.336，没有胜过最简单的基线。
  后续 v0.3 没有重新报告。
- uxl 与 unvdp 的对比见第 5 节。

没有任何一份材料与 `uvw` 对比。如果你手上的实测在 `univer-cli-eval` 或别处，请补充出处，本文会引用。

建议在动手前做一轮对照：

1. 从 SpreadsheetBench 或内部题库取 30 到 50 道只读理解题，导入为 Workspace Unit。
2. 两组 Agent，同模型、同系统提示词骨架。A 组只有现有 `inspect` 与只读 `execute`；B 组加原型 `outline`、`find`。
3. 报告正确率、输入与输出 token、工具调用次数、墙钟时间，每组至少三次运行。
4. 原型可以用方式 A 在 CLI 本地实现，不接 MCP，一周内能出数据。

## 10. 建议分期

1. **阶段 0，验证与对照。** 在真实 Workspace Unit 上验证 resources 与显示文本一致性（第 2 节风险 1、2），
   跑第 9 节的对照。结论不支持就停在这里。
2. **阶段 1，单 Unit。** 移植 Lens 为私有包；client-core 提供 outline、read、find；
   CLI 与 MCP core toolset 各一个入口；sheet skill 改为「先 outline，再按 ref 放大」。
3. **阶段 2，多 Unit。** `find` 支持多个 Unit，有上限和续读；outline 列出跨 Unit 引用；repo 地图只给元数据。
4. **阶段 3，缓存与上游。** 按 `(scope, unitId, revision)` 缓存 outline 模型；与 univer-cli-sdk 维护者商定把 Lens
   上移为 inspection kind；DSH 插件接线。

## 11. 需要你拍板的问题

1. **代码来源。** 移植到本仓库私有包，还是先推 univer-cli-sdk？（已决定：直接复制 uxl 的 Lens，作者已确认不需要授权，见 [design.zh-CN.md](design.zh-CN.md)。）
2. **第一期的消费方。** 只做 CLI 和 MCP（浏览器 Agents 随 MCP 获得），还是也包括 DSH 插件？
3. **search 的含义。** 本文按「单元格内容搜索」理解。如果你指的是文件名或跨 repo 资源搜索，范围和成本完全不同。
4. **跨文件搜索要不要服务端索引。** 本文建议第一期不做。如果多文件搜索是核心场景，需要单独立项。
5. **阶段 0 的对照是否必须。** 如果你已有 `uvw` 的对照数据，可以跳过并补充出处。

## 附录：证据来源

unvdp（`/Users/shenweimin/github.com/hobby/unvdp`）：

- `rfcs/0001-unvdp/01-overview.md`、`03-domains.md`、`04-lens-outline.md`、`schema/unvdp.d.ts`
- `packages/unvdp-core/src/lens/*`、`src/server/{index,state,data}.ts`、`src/worktree.ts`、`scripts/check-boundaries.mjs`
- `docs/research/{command-gap-results,outline-0.5-e2e,detection-eval,opencode-flash-analysis}.md`、`docs/plans/performance.md`

uxl（`/Users/shenweimin/github.com/dream-num/uxl`）：

- `docs/adr/0003`、`0006`、`0009`，`docs/architecture.md`
- `src/lens/*`、`src/engine/{display,types}.ts`、`src/cache/*`、`test/golden/*`
- `docs/research/2026-11-02-spreadsheetbench-400/README.md`、`2026-11-05-large-workbook-performance.md`

本仓库：

- `AGENTS.md`、`apps/cli/AGENTS.md`、`apps/cli/skill-data/sheet/SKILL.md`
- `packages/client-core/src/{content-worker,content-runtime,runtime-source,runtime-target,render-unit,reference-scope,space}.ts`
- `apps/mcp/README.md`、`apps/mcp/src/shared/executor-protocol.ts`、`apps/mcp/src/executor/ops/content-inspect.ts`
- `apps/workspace/docs/{data-model,architecture,content-permissions-validation}.md`
- `apps/workspace/web/src/features/agents/runtime/runner.ts`
