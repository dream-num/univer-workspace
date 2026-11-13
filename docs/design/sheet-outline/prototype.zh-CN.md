# 表格 outline 原型：宿主进程跑 Lens

状态：原型，待对齐。日期：2026-11-13。前置文档：[可行性研究](feasibility.zh-CN.md)。

本原型按可行性研究的方式 A 实现：Workspace 先把 Unit 导出为 `IWorkbookData`，再在宿主进程里运行移植来的 Lens。
范围只有单个 Unit、只有 spreadsheet。代码是一次性的，用来回答三个问题：

1. 架构要改哪些地方，Lens 放在 CLI 进程还是 daemon 里。
2. 命令面怎么变。
3. 实际耗时和输出与现有 `inspect`、`execute` 相比如何。

前后对比的完整输出见 [prototype-compare.html](prototype-compare.html)，用浏览器直接打开。

## 结论

- **能用，输出与 uxl 一致。** 同一个 xlsx 分别经 uxl 本地读取和经 Workspace 导入后用 `uvw outline` 读取，
  比较整本工作簿以及 `--at s1`、`s2`、`s2.t1`、`s3`、`s3.t1` 六种视图，两个工作簿共 12 组，10 组逐字节相同。
  表格、筛选、条件格式、数据验证、定义名称、批注都从 Workspace 快照的 resources 读到，显示文本（`8.0%`、`#,##0.00`、
  `#,##0,"K"`、日期）也一致。不同的 2 组来自数据而不是 Lens：elements.xlsx 的 `C8 = SUBTOTAL(9,C2:C7)` 在文件里缓存的是
  21K，Workspace 导入时重算成 12K（排除了被筛掉的第 4、7 行，符合 Excel 语义），两边的 Lens 如实报告了各自存储的值。
  可行性研究里的「resources 与显示文本一致性」风险在这批样本上没有出现。
- **Lens 应放在 daemon 里，并按 `(Unit, scope, revision)` 缓存。** 放在 CLI 进程（A1）时，每次调用都要把整本
  UnitData 从 worker 经 daemon 搬到 CLI：3 万行的流水表是 8.7 MB，单是 `export` 就要约 1.1 秒，`outline` 共 3.7 秒。
  放进 daemon 并缓存（A2）后，同一修订的第二次调用只剩进程启动和 resolve，`outline` 是 1.35 秒，与 `uvw --help` 的
  1.32 秒几乎相同。写入产生新修订后缓存自动失效，已验证。
- **token 的主要收益不在「更短」，而在「一次说对」。** 小表上 `outline` 与 `inspect workbook` 大小相近（399 对 364 tokens）。
  差别在内容：现有读法要么截断（抽样文本截掉两列），要么太大（全表 `--json` 37.5 万 tokens），要么要 Agent 自己写统计脚本，
  而原型里一个看似正确的脚本把三列数值的 min/max 全算成了 `null`。`outline --at` 一次给出每列类型、格式、范围、去重值、公式模式、CF 和 DV。
- **有一个硬上限。** 一张表超过 50 万个已用单元格时，Lens 跳过区域检测，只输出一个 `block`。5 万行 × 10 列的流水表正好越过这条线。

## 1. 架构调整

现有读法里，`inspect` 把 SDK 生成的 Facade 代码送进 worker 执行，只回传结果：

```text
uvw inspect ──► daemon ──► worker（headless Univer，执行 inspect 代码）──► JSON 结果
```

原型新增一条路径，worker 只负责导出 UnitData，Lens 在宿主进程运行。实现了两个变体，用 `UVW_LENS_HOST` 切换，便于同数据对比：

```text
A1  uvw outline ──resolve──► daemon ──► worker.exportUnitData()
        ▲                                      │ 整本 UnitData（8.7 MB）
        └──────────── Lens 在 CLI 进程运行 ◄────┘

A2  uvw outline ──resolve──► daemon: sheet-lens.run(target, request)
                               │  缓存命中：直接用已建好的模型
                               │  缓存未命中：worker.exportUnitData() → 建模 → 放入缓存
                               └──► 只回传渲染好的文本（几百到几千字符）
```

改动的文件（原型质量，没有测试）：

| 文件 | 改动 |
| --- | --- |
| `packages/client-core/src/sheet-lens/**` | 从 uxl `ab4070c` 原样复制的 Lens（`lens/`）、显示文本（`engine/display.ts`）、类型和错误识别，共约 5k 行。只改了 import 后缀，并把 uxl 的错误类换成 `WorkspaceApplicationError` |
| `packages/client-core/src/sheet-lens.ts` | `WorkspaceSheetLensEngine`：给定已解析的 target 和请求，导出、建模、渲染，可选 LRU 缓存。`WorkspaceSheetLensFeature`：解析 Unit、调用引擎、拼出 `uvw` 语法的续读命令 |
| `packages/client-core/src/index.ts` | 导出上面两个类和请求类型 |
| `apps/cli/src/runtime/daemon.ts` | 新增 daemon 方法 `sheet-lens.run`，引擎缓存 8 个已准备的 Unit |
| `apps/cli/src/features/outline/command.ts` | `outline`、`read`、`find` 三条命令 |
| `apps/cli/src/program.ts` | 注册命令，默认走 A2，`UVW_LENS_HOST=cli` 走 A1 |

几个设计点：

- **resolve 留在 CLI 进程。** 它需要带认证的 HTTP，服务端返回权威的 revision。daemon 只拿到已解析的 target，
  不信任客户端给的修订号这一条没有变。
- **缓存键就是 target 本身**：origin、scope、unitId、unitType、revision。修订号变化即失效，不需要另外的失效逻辑。
- **引擎与宿主无关。** `WorkspaceSheetLensEngine` 只依赖 `exportUnitData`，CLI daemon 能用，MCP 执行器也能用，
  见第 5 节。
- **sheet 以外的类型在引擎入口统一拒绝**，错误码 `workspace-outline-unit-type-unsupported`。

## 2. 命令面

新增三条顶层命令，`inspect` 不变：

```text
uvw outline --unit <id> (--trunk | --worktree <id>) [--at <ref>] [--from <ref>] [--depth 0..2] [--budget <chars>]
uvw read    --unit <id> (--trunk | --worktree <id>) <range> [--values | --formulas] [--max <cells>]
uvw find    --unit <id> (--trunk | --worktree <id>) <terms...> [--in values|formulas] [--case] [--from <cell>] [--max <hits>]
```

三条命令都支持 `--json` 和 `--timing`（把阶段耗时写到 stderr）。

每次输出的第一行是 Unit、scope 和修订号，这是可行性研究里「无状态 ref + 修订戳」的落地：

```text
unit 9505ab85-… [worktree f5885296-…, rev=1]
- workbook "sales-1000" [sheets=4]
  - sheet "Inputs" [ref=s1, used=A1:B6]
    - kpi "TaxRate" [ref=s1.k1, B3, percent 0.0%, via=name]: 8.0%
  - sheet "Orders" [ref=s2, used=A1:J1001, frozen=1r, formulas=2000]
    - table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, via=table]
    - objects [table=1, cf=1, dv=1]
  …
```

输出被截断时，最后一行是可以直接执行的续读命令，带上原来的 `--unit` 和 scope：

```text
… 11 more matches: uvw find --unit 9505ab85-… --worktree f5885296-… "returned" --from 'Orders!J822'
```

对齐时需要你决定的命名问题：

- 顶层 `read`、`find` 是否太泛。另一个选择是 `uvw sheet outline|read|find`，与未来其他类型的读法分开。
  本原型选顶层，因为 `outline` 将来要按 Unit 类型分派，`read` 与 `find` 也可以分派。
- 与 `inspect` 的关系。本原型并存。正式实现时，sheet skill 应改为「先 `outline`，再 `--at` 放大，精确值用 `read`」，
  `inspect range` 保留给需要原始 `ICellData` 的场景。

## 3. 实际耗时

环境：本机 macOS，10 核，测量时 load average 7 到 14（有其他会话在跑），所以 A1 与 A2 交替执行，每项 5 次取中位数。
所有调用都成功（失败 0 次）。每次调用都包含 `uvw` 进程启动，`uvw --help` 的中位数是 1,318 ms。

### 热路径（daemon 与 worker 已就绪）

| 命令 | Unit | A1 CLI 进程 | A2 daemon + 缓存 | 现有命令对照 |
| --- | --- | --- | --- | --- |
| `outline` | sales-1000（964 KB） | 1,569 ms | 1,384 ms | `inspect workbook` 1,466 ms |
| `outline --at s2.t1` | sales-1000 | 1,521 ms | 1,395 ms | `inspect range` 抽样 1,502 ms |
| `find returned` | sales-1000 | 1,542 ms | 1,391 ms | `execute` 扫描脚本 1,391 ms |
| `read Summary!A3:I8` | sales-1000 | 1,433 ms | 1,358 ms | `inspect range --json` 1,443 ms |
| `outline` | ledger-30k（8.7 MB） | 3,681 ms | 1,346 ms | `inspect workbook` 1,706 ms |
| `outline --at s1.t1` | ledger-30k | 3,864 ms | 1,428 ms | `execute` 统计脚本 1,667 ms |
| `outline` | ledger-50k（14.5 MB） | 5,709 ms | 1,356 ms | `inspect workbook` 1,970 ms |

A1 在大表上慢，原因在 `--timing` 的分解里很清楚（ledger-30k，A1）：

```text
resolve=11  export=1148  model=690  render=1  unitDataBytes=8694173
```

`export` 是 UnitData 从 worker 经 daemon 到 CLI 的两次序列化，`model` 是区域检测和列统计。
A2 缓存命中后两者都没有了，只剩 `resolve≈13 ms` 与 `render≈1 ms`，所以 A2 的时间基本等于进程启动时间。

A2 缓存未命中时的成本（写入一个单元格产生 rev=5 之后的第一次调用，worker 已热）：

```text
resolve=14  export=900  model=1019  render=0  cache=miss
```

也就是说，A1 里 1.1 秒的 `export` 有约 0.9 秒发生在 worker 到 daemon 之间，daemon 到 CLI 只占约 0.2 秒。
A2 省下的主要是「同一修订不再重复导出和建模」，而不是少了一次进程间传输。

### 冷启动（`uvw daemon stop` 之后第一次调用）

| Unit | `inspect workbook` | `outline` | `outline` 的阶段 |
| --- | --- | --- | --- |
| sales-1000 | 3,616 ms | 3,569 ms | export 943，model 75 |
| ledger-30k | 5,428 ms | 6,436 ms | export 3,031，model 793 |
| ledger-50k | 6,439 ms | 7,431 ms | export 4,215，model 554 |

冷启动时两者都要起 daemon、起 worker、下载快照并回放 changeset，差距来自 `outline` 多出的导出和建模，
在 30k、50k 行上多 1 秒左右。冷启动每个 Unit 只发生一次，后续调用走热路径。

### 仍然慢的地方

- `find` 在 A2 下仍要逐表重建单元格视图：ledger-30k 上 `find` 阶段 839 ms。可以把 `sheetCellsOf` 的结果也放进缓存。
- 进程启动 1.3 秒是所有 `uvw` 命令共同的下限，不是 Lens 的成本。

## 4. 输出差异

token 用 o200k_base 估算，只用于相对比较。逐条输出见 [prototype-compare.html](prototype-compare.html)。

| 任务 | 接入前 | tokens | 接入后 | tokens |
| --- | --- | --- | --- | --- |
| T1 整本是什么 | `inspect workbook` | 364 | `outline` | 399 |
| T2 Orders 每列 | `inspect range` 抽样 20 行 | 624 | `outline --at s2.t1` | 761 |
| | `inspect range` 全表 `--json` | 375,372 | | |
| | `execute` 统计脚本 | 644 + 脚本 128 | | |
| T3 找 returned | `execute` 扫描脚本 | 266 + 脚本 96 | `find returned` | 836 |
| T4 读汇总块 | `inspect range A3:I8 --json` | 2,923 | `read Summary!A3:I8` | 1,517 |
| T5 3 万行结构 | `inspect workbook` + 抽样 + 统计脚本 | 1,432 + 脚本 128 | `outline` + `--at s1.t1` | 708 |
| T6 5 万行结构 | `inspect workbook` | 130 | `outline` | 104 |

把 T1 到 T4 当作一次探索会话：接入前 5 次调用、输出 4,821 tokens、Agent 还要写 224 tokens 的脚本；
接入后 4 次调用、3,513 tokens、不写脚本。这是「省力的接入前做法」与接入后的对比。
如果照 sheet skill 的建议用 `--json` 读全表，接入前的 T2 一步就是 37.5 万 tokens。

数字之外更重要的是内容差异：

- **T1。** `inspect workbook` 只给出 values、formulas、styles 的已用范围。`outline` 给出 Inputs 里带名字的 KPI
  （`TaxRate` 8.0%）、Orders 是 1000 行的 `OrdersTbl`、Summary 是带标题和合计行的表。
- **T2。** 抽样文本输出截掉了 Tax、Status 两列（`… 2 columns omitted`），Agent 看不到这两列。
  统计脚本看起来没问题，但 `getValues()` 对带数字格式的 Unit Price、Amount、Tax 返回的不是 number，
  脚本算出的 min/max 全是 `null`，Agent 要再来一轮才能发现。`outline --at s2.t1` 直接给出
  `number #,##0.00, 3.02..119.99`，还有 `f=F{r}*G{r} ×1000`、`cf="cellIs gt 3000"`、`dv="list: open,shipped,returned"`。
- **T3。** `find` 比脚本输出多，因为每个命中带显示值，末尾有续读命令；它也命中 Summary 里的 「Returned」，共 61 处，
  脚本只扫 Orders，得到 60 处。
- **T4。** 同一块数据，`read` 的 A1 网格比 `inspect --json` 少一半；公式单元格同时给出显示值和公式。
- **T6。** 50 万格以上的表退化为一个 `block`，信息量与 `inspect workbook` 相当。

这些数字只能说明单次调用的输出大小和内容，不能替代可行性研究第 9 节提出的同题 Agent 对照。

## 5. 推到正式实现前要定的事

1. **采用 A2。** 理由见第 3 节。正式实现时缓存要有内存上限：ledger-30k 的 UnitData 是 8.7 MB JSON，
   解析后的对象和模型更大。原型按条数（8 个）淘汰，正式版应按估算字节数淘汰。
2. **MCP 执行器用同一个引擎。** 执行器按 `(userId, scope, unitId)` 路由，同一个 Unit 的请求落在同一副本，
   缓存命中率与 CLI daemon 相当。新增一个执行器 op，网关加 `outline`、`read`、`find` 三个 core 工具，
   浏览器 Agents 随之获得。
3. **50 万格阈值。** 这是 Lens 的设计上限，超过时只给 `block`。可以先保留，并在 `block` 行提示改用 `read` 分页；
   要提高上限需要改 Lens 的检测算法，属于上游 Lens 的问题。
4. **Lens 代码的归属。** 原型直接复制了 uxl 的约 5k 行。uxl 与 unvdp 的作者已确认可以直接复制，不需要另外授权。正式方案见 [design.zh-CN.md](design.zh-CN.md)。
5. **命令命名。** 顶层 `outline`、`read`、`find`，还是 `uvw sheet …`。见第 2 节。

## 6. 原型中遇到的其他问题

- **`uvw import` 导入 2,000 行的 xlsx 返回 500。** 服务端日志是 `PayloadTooLargeError: request entity too large`：
  导入把整本 UnitData JSON 放在一个请求里，超过了请求体上限。144 KB 的 xlsx 就会触发。这与本原型无关，
  原型改用 1,000 行的工作簿，大表通过 `uvw execute` 分批写入。建议单独开 issue。
- **Workspace 导入会重算公式。** 导入后的 Unit 存储的公式结果可能与 xlsx 里缓存的值不同（见结论第一条的 SUBTOTAL）。
  这对 Agent 是好事，但与「读到的就是文件里的值」的直觉不同，skill 里值得说明。
- **Facade `getValues()` 对带数字格式的单元格返回字符串。** 例如 `"24.72"`、`"4,610.19"`，日期返回 `"2026-02-14"`。
  即使写入时给的是 JS number，设置格式后单元格存储的 `v` 也是字符串（`{"v":"24.72","t":2}`）。
  见第 4 节 T2，它会让 Agent 写的统计脚本静默出错。Lens 按 `t` 与格式解析，不受影响。

## 复现

原型代码在分支 `proto/sheet-lens-a2`（提交 `6f6b2ea5`，基于 `b7c49917`），只作参考，不合入。
测量脚本和结果在 [prototype-kit/](prototype-kit/)：

- `gen.py` 生成 sales 工作簿，再用 `uxl recalc --in-place` 写入公式缓存值。
- `ledger.js` 是在 Workspace 里分批写流水表的 `execute` 脚本模板，`__START__` 和 `__COUNT__` 由调用方替换。
- `exec/*.js` 是对比中「接入前」一侧 Agent 要写的统计和扫描脚本。
- `compare.mjs` 运行全部前后对比，`report.mjs` 从结果生成 HTML 对比页。两者里的 `/tmp/sheet-lens-proto` 路径是当时的工作目录，重跑时按需修改。
- `results.json` 是本文引用的那次测量结果。

一次性 Workspace 实例由 verify-uvw 启动：`VERIFY_UVW_ROOT=/tmp/verify-uvw-lens`，run `lens`，端口 3961 和 5961，已关闭。
