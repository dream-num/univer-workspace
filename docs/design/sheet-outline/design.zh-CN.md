# 表格 outline、read、find：正式设计

状态：已与操作者对齐，进入实施。日期：2026-11-13。
前置文档：[可行性研究](feasibility.zh-CN.md)、[原型报告](prototype.zh-CN.md)、[前后对比页](prototype-compare.html)。
执行计划见 [plan.zh-CN.md](plan.zh-CN.md)。

## 目标

Agent 读一张远程 Sheet 时，不截图、不写统计脚本，用几百到几千 token 就能知道表里有什么、在哪里、每列是什么，
再按 ref 放大到细节。做法是把 uxl 的 Lens（源自 unvdp）搬进 Workspace，在 CLI daemon 和 MCP 执行器里运行，
按修订号缓存，对外提供 `outline`、`read`、`find` 三个读操作。

本期范围：

- 只支持 Sheet Unit。命令、工具、错误、skill 都写明这一点。Doc、Slide、Base、Board 的 outline 另行接入。
- 单个 Unit。多 Unit 汇总和跨文件搜索不在本期。
- 入口是 `uvw` CLI 和 Workspace MCP。浏览器 Agents 通过 MCP core toolset 自动获得。DSH 插件不在本期。

## 已确认的决定

| 决定 | 依据 |
| --- | --- |
| 采用方式 A2：Lens 在宿主长驻进程（CLI daemon、MCP 执行器）里运行，按修订号缓存 | 原型实测。3 万行表上 A1 每次 3.7 秒，A2 命中缓存 1.35 秒，后者约等于 `uvw` 进程启动时间 |
| 直接复制 uxl 的 Lens 代码，不需要另外授权 | uxl 与 unvdp 作者确认 |
| ref 无状态，由内容决定，输出带修订戳 | 可行性研究第 5 节；原型验证了修订变化后缓存失效、输出更新 |

## 问题解答

### 超过 50 万格会怎样

不会报错。实际情况如下，均来自代码和原型测量：

1. **判断的是已用范围的外接矩形，不是非空单元格数。** `sheet-lens/lens/outline/cells.ts:330` 计算
   `(used.r1 - used.r0 + 1) * (used.c1 - used.c0 + 1) > 500_000`。一张只在 A1 和 Z20000 各有一个值的稀疏表
   （26 × 20000 = 52 万）也会触发。
2. **触发后跳过整套区域检测，也跳过显式结构。** `model.ts:659` 不调用 `detectRegions`，`model.ts:690` 不处理
   Excel 表格、筛选、名称、透视表这些来自 resources 的结构。整张表输出成一个 `block`，`--at s1.b1` 放大也只有这一行，没有列信息。
3. **Lens 会留下一条说明，但原型把它丢了。** 模型的 `notes` 里有 `sheet s1 too large: rendered as one block`，
   uxl 把它转成警告 `W_SHEET_TOO_LARGE`。原型没有输出 `notes`，Agent 只会看到一个没有解释的 `block`。
4. **`read` 和 `find` 不受影响。** 它们按需遍历稀疏单元格，不建密集网格。原型在 5 万行表上 `read` 前 6 行、`find void`
   都正常，结果带续读命令。
5. **还有一个 800 万格的上限**（`detect/features.ts:22` 的 `MAX_GRID_CELLS`），在 50 万的判断之后，目前到不了。

阈值不是硬性的算法上限。原型把阈值临时调到 800 万后，5 万行 × 10 列（500,010 格）的表输出了完整的表格和 10 列摘要，
内容正确，建模时间从 0.5 秒增加到 1.15 秒。真正需要控制的是内存：daemon 同时缓存三张表（约 81 万格）时 RSS 峰值约 700 MB，
但 GC 使 RSS 起伏很大，每格的常驻内存还没有测准。

决定：

- **本期保持 50 万。** 在 `outline` 输出里把 Lens 的 `notes` 显示出来，并在 `block` 后给出可执行的下一步：用 `read` 分页读、用 `find` 定位。
- **阈值改成 Lens 的参数。** 把 50 万提成 `buildOutlineModel` 的选项，Workspace 先传入同样的 50 万。
  这是对复制代码的第一处改动，记录在 `sheet-lens/README.md` 的差异清单里；是否在 uxl 一侧同步，由 uxl 作者决定。
  等用堆快照测出每格内存后，再单独提高，见计划里的 SL4。
- **SL4 测量后的取值。** Lens 缺省仍是 50 万。SL4 实测后，CLI daemon 改用 75 万（单表常驻约 211 MiB，建模约 2.8 秒），见 [大表阈值](large-sheets.zh-CN.md)。
- **大表也保留显式结构**（Excel 表格、筛选、名称）是 Lens 算法的改动，列入 uxl 的后续工作，不在本期。

### uxl 的分页读取能否迁移

已经迁移了一半，剩下的列入本期。

| uxl 能力 | 原型状态 | 本期 |
| --- | --- | --- |
| `read RANGE --max N`，按整行截断，末尾给出续读命令 | 已迁移 | 保留 |
| `read --values`、`--formulas` | 已迁移 | 保留 |
| `read --json`：每格 `type`、`display`、`value`、`formula`，`truncated.next` | 原型的 `--json` 只包了一层文本 | 迁移，作为读精确值的标准方式 |
| `read --styles`（可与 `--formulas` 组合） | 未迁移 | 迁移 |
| `read --csv` | 未迁移 | 不做。CLI 输出给 Agent 看，管道场景用 `export` |
| `find --max`、`--from` 续读，`--in formulas`，`--case` | 已迁移 | 保留，加上 `--sheet` |
| `outline --budget`、`--depth`、`--from` 续读 | 已迁移 | 保留 |

另外，原型的 `read` 和 `find` 每次都重新构建单元格视图（3 万行表上 `find` 0.84 秒、`read` 0.58 秒）。
正式实现把构建好的各表单元格视图和模型一起放进缓存，三个操作共用。

### skill 怎么迁移

uxl 的 `SKILL.md`（Workflow 一节）和 `references/reading.md` 是 Agent 用好这三个操作的关键，本期按下面的方式搬进 Workspace：

1. **共享的 `apps/cli/skill-data/sheet/SKILL.md` 新增「读一张表」一节**，内容来自 uxl 的 Workflow：
   先 `outline` 建立地图，再 `outline --at`、`read`、`find` 看细节，再 `execute` 修改，最后只读回答案依赖的单元格。
   保留 uxl 总结的几条规则：
   - 输出末尾有续读行时执行它，省略不等于不存在。
   - 不要把一页数据当成整个范围来求和。
   - 区域类型和边界是启发式的，用来决定去哪里读，不代表业务含义。
   - 精确值用 `read` 的 JSON 输出（`type`、`value`），不要解析显示文本。
   - `subtotals:`、`frozen`、`merged`、`errors`、`via=name` 这些信号出现时要注意。
   - ref 由内容决定，绑定输出第一行的修订号，结构性编辑后重新 `outline`。
2. **新增 `apps/cli/skill-data/sheet/references/reading.md`**，从 uxl 的 `reading.md` 改写：三个操作的参数、ref 语法、
   预算和续读、`read` 的 JSON 字段、大表的 `block` 行为。
3. **措辞不绑定入口。** 这两份文件同时打包进 CLI 和 MCP（`apps/mcp/scripts/assemble-skills.mjs`），
   `apps/mcp/test/core-skill.test.ts` 禁止其中出现 `uvw`。所以写「对该 Unit 运行 `outline`，`at` 设为 `s2.t1`」，不写命令行。
   现有 sheet skill 已经是这种写法。
4. **改写「Reading evidence」和「Verification」两节。** 值、类型、公式的验证改用 `read` 的 JSON 输出；`inspect range` 只在需要原始
   `ICellData`（如 `si`、`custom`）时使用。
5. **CLI 的 `core` skill 与 MCP 的 `core` skill 在命令表里加入三个操作**，各自用本入口的写法。
6. **uxl 里只适用于本地文件的内容不搬**：`exec`、`recalc`、`convert`、`--csv`、本地缓存、`cells(at)` 辅助函数。
   Workspace 的写入仍走 `execute`，相关坑已在现有 sheet skill 里（例如 `getValues()` 返回显示字符串）。

### 只支持 Sheet 怎么说清楚

四个地方同时说明，避免 Agent 用错：

| 位置 | 写法 |
| --- | --- |
| CLI `--help` 描述 | `Outline a Sheet Unit (Sheet only; use inspect for Doc, Slide, Base and Board)`，`read`、`find` 同理 |
| MCP 工具描述 | 第一句写明只接受 Sheet Unit，其他类型用 `inspect` |
| 错误 | 非 Sheet 时返回 `workspace-sheet-lens-unit-type-unsupported`，消息给出 Unit 的类型和该用的操作 |
| skill | 只在 `sheet` skill 里介绍这三个操作；`doc`、`slide`、`base`、`board` skill 不变，继续用 `inspect` |

命令名用通用的 `outline`、`read`、`find`，不加 `sheet` 前缀。其他类型接入时沿用同一个动词，按 Unit 类型分派，
帮助文本和错误随之更新。

### 旧的 `inspect` 怎么处理

保留，不改行为，在 Sheet 场景下降级为补充手段。

- **不能移除。** `inspect` 是 Doc、Slide、Base、Board 唯一的结构化读取方式。仓库里的 doc、slide、board、base、html-view、
  cross-unit-formula skill，MCP core skill，DSH 插件的 skill 都依赖它。
- **Sheet 场景降级。** sheet skill 改为先 `outline`、`read`、`find`；`inspect workbook` 被 `outline` 取代，
  `inspect range` 只用于读取原始 `ICellData`。CLI 和 MCP 的 `inspect` 本身不加弃用提示，因为它对其他类型仍是主路径。
- **以后再定。** 当五种类型都有 outline、且 `read --json` 覆盖了原始 `ICellData` 的需求时，再讨论 `inspect` 是否只作为调试工具。

## 架构

### 数据流

```text
uvw outline/read/find ──resolve（认证 HTTP，服务端给出 revision）──► CLI daemon: sheet-lens.run
MCP outline/read/find ──网关──► 执行器 op content.sheet-lens ──resolve──┐
                                                                       ▼
                                                    WorkspaceSheetLensEngine.run(target, caller, request)
                                                      缓存命中：复用已建好的模型与单元格视图
                                                      缓存未命中：worker.exportUnitData() → 显示文本 → 结构 → 建模
                                                      返回：正文、结构化续读、警告、修订号、阶段耗时
```

- **resolve 在调用方完成。** CLI 进程和 MCP 执行器都用带认证的 `WorkspaceContentSource` 解析 Unit，服务端给出权威 revision。
  引擎只接受已解析的 `WorkspaceRuntimeTarget`，不信任客户端给的修订号这一点不变。
- **引擎与宿主无关。** 它只依赖 `exportUnitData`，CLI daemon 和 MCP 执行器各持有一个实例。
- **续读由入口渲染。** 引擎返回结构化的续读（`{op:"outline", at, from}` 等），CLI 渲染成 `uvw outline --unit … --at …`，
  MCP 渲染成下一次调用的工具参数。共享 skill 因此不需要出现 `uvw`。

### 代码位置

| 路径 | 内容 |
| --- | --- |
| `packages/client-core/src/sheet-lens/` | 从 uxl 复制的 Lens、显示文本、类型。`README.md` 写明来源 commit、复制方法和与 uxl 的差异 |
| `packages/client-core/src/sheet-lens.ts` | `WorkspaceSheetLensEngine`（缓存、建模、三种请求）与入口无关的请求和结果类型 |
| `packages/client-core/test/sheet-lens/` | 从 uxl `test/lens/*.test.ts` 移植的 Lens 测试（约 130 个用例，`bun:test` 换成 vitest），加上引擎测试 |
| `apps/cli/src/features/sheet-lens/command.ts` | 三条命令、CLI 续读渲染 |
| `apps/cli/src/runtime/daemon.ts` | `sheet-lens.run` 方法 |
| `apps/mcp/src/shared/executor-protocol.ts`、`executor/ops/sheet-lens.ts`、`gateway/tools/core/{outline,read,find}.ts` | 执行器 op 与三个 core 工具 |
| `apps/cli/skill-data/sheet/`、`apps/cli/skill-data/core/`、`apps/mcp/skills/core/` | skill |

Lens 放在 client-core 的子目录而不是新包：client-core 已经被内联进 CLI 产物和 MCP 镜像，新包要多改两条打包链路。
边界由测试保证：`sheet-lens/lens/**` 只能 import 本目录文件和 `@univerjs/core` 的类型，不能 import `node:*` 或 client-core 其他模块。

### 引擎接口

```ts
type SheetLensRequest =
  | { op: "outline"; at?: string; from?: string; depth?: 0 | 1 | 2; budget?: number }
  | { op: "read"; range: string; content: "both" | "display" | "formula" | "style" | "formula+style"; max?: number }
  | { op: "find"; terms: string[]; in: "values" | "formulas"; caseSensitive: boolean; sheets?: string[]; from?: string; max?: number };

type SheetLensContinuation =
  | { op: "outline"; at: string; from?: string; remaining: number; unit: string }
  | { op: "read"; range: string; remaining: number }
  | { op: "find"; from: string; remaining: number };

interface SheetLensResult {
  text: string;                       // 不含首行；首行由入口拼出
  json: unknown;                      // outline 的节点树、read 的逐格值、find 的命中
  next?: SheetLensContinuation;
  warnings: { code: `sheet-lens-${string}`; message: string }[];
  revision: number;
  timings: Record<string, number>;
  cache: "hit" | "miss";
}

class WorkspaceSheetLensEngine {
  constructor(options: { exportUnitData: …; maxCachedBytes: number });
  run(target: WorkspaceRuntimeTarget, caller: string, request: SheetLensRequest): Promise<SheetLensResult>;
}
```

### 缓存

- **键**：`caller` 加上序列化的 target（origin、scope、unitId、unitType、revision）。MCP 执行器为多个用户服务，键里必须有用户；
  CLI daemon 只服务一个会话，`caller` 用会话的用户名。权限在 resolve 时已按用户检查，带上用户是为了与 runtime 池的键一致，
  不让一个用户的读取结果被另一个用户命中。
- **值**：UnitData、显示文本读取器、各表单元格视图、模型（首次 `outline` 时建）。
- **失效**：修订号是键的一部分，写入后自然失效，不需要单独的失效逻辑。
- **容量**：按估算字节数淘汰，估算值取 UnitData 的 JSON 字节数乘以系数，系数在 SL1 用堆快照测定。
  CLI daemon 默认上限 512 MB（操作者已确认），SL1 测出估算系数后按实测复核并报告操作者，MCP 执行器按 `EXECUTOR_MAX_WORKERS` 和主机内存配置，用环境变量覆盖。
- **单表上限**：估算字节超过缓存上限时不入缓存，照常返回结果并附警告。

### 输出契约

所有操作的文本输出第一行是 `unit <unitId> [<scope>, rev=<n>]`。正文之后依次是：

1. Lens 的警告，每条一行，形如 `note: sheet s1 too large: rendered as one block; read it page by page with read`。
2. 续读行，以 `… ` 开头，CLI 中是可执行的命令。

CLI `--json` 返回 `{ unitId, scope, revision, text, json, next, warnings }`，`next` 是渲染好的命令字符串。
MCP 的 structured content 返回同样的字段，`next` 是 `{ tool, arguments }`。

错误码统一改成 Workspace 风格：

| Lens 错误 | Workspace 错误码 |
| --- | --- |
| `E_REF_NOT_FOUND` | `workspace-sheet-lens-ref-not-found` |
| `E_RANGE` | `workspace-sheet-lens-range-invalid` |
| `E_SHEET_NOT_FOUND` | `workspace-sheet-lens-sheet-not-found` |
| `E_USAGE` | `workspace-argument-invalid` |
| 非 Sheet Unit | `workspace-sheet-lens-unit-type-unsupported` |

提示文字不提 `uvw`，例如「对该 Unit 重新运行 outline 查看当前的 ref」。

### 公式没有缓存值时

Workspace 的 headless runtime 加载时不重算公式（`NO_CALCULATION`）。若有公式单元格没有 `v`，`outline` 在表一行显示
`uncached=N`（Lens 已支持这个属性），并给出警告，提示先用 `execute` 触发计算。Lens 不自己重算。

## 命令和工具

```text
uvw outline --unit <id> (--trunk | --worktree <id>) [--at <ref>] [--from <ref>] [--depth 0|1|2] [--budget <chars>] [--json]
uvw read    --unit <id> (--trunk | --worktree <id>) <range> [--values | --formulas] [--styles] [--max <cells>] [--json]
uvw find    --unit <id> (--trunk | --worktree <id>) <terms...> [--in values|formulas] [--case] [--sheet <name>]... [--from <cell>] [--max <hits>] [--json]
```

MCP core 工具 `outline`、`read`、`find` 的参数与 CLI 一一对应：`unit`、`trunk` 或 `worktree`，以及各自的选项。
三个工具都是 `read` scope，带只读注解。原型里的 `--timing` 和 `UVW_LENS_HOST` 不进入正式版，阶段耗时只写入日志与 MCP 用量事件。

## 测试与验证

- **Lens**：移植 uxl `test/lens/` 的用例，保证复制后的行为与 uxl 一致。
- **引擎**：缓存命中、修订变化失效、按字节淘汰、用户隔离、非 Sheet 拒绝、警告透出、续读结构。
- **CLI**：命令解析、帮助文本、续读渲染、`--json` 结构、daemon 方法。
- **MCP**：op 输入输出 schema、三个工具注册、core skill 测试（不含 `uvw`、只提已注册工具）。
- **端到端**：在 verify-uvw 中新增 `features/sheet-lens.md`，把原型的对比脚本改写成 journey：导入 sales 工作簿，
  outline 与 uxl 的输出逐字节比较（前提是两边存储的值相同），修订变化后缓存失效，大表输出 `block` 和警告。
- **性能**：沿用原型的探针。热路径缓存命中时，`outline` 的时间不超过同次测量中 `uvw --help` 加 150 ms。

## 本期不做

- DSH 插件与 Space 插件的接入（它们用独立的 `workspace-agent-runtime`）。
- 多 Unit 汇总、跨文件搜索。
- 大表的显式结构和更高阈值（SL4 只测量和调参，不改 Lens 算法）。
- `read --csv`。
- `inspect` 的行为变化。
