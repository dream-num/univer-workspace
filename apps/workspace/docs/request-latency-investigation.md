# 请求延迟本地复现（2026-09-16）

初始诊断基于本仓库 `6806dd2`、Node 24.14.0、已安装的 `1.0.0-rc.0` SDK；
随后修复了产品权限查询，修复结果单独列于下文。未修改正式 Schema 或 SDK，
不依赖相邻 SDK 仓库。
本地已有产品数据库只有 14 个 Node、14 个 Resource、5 个 Worktree。
下述大数据结果使用新建的独立临时数据库，不代表生产数据规模。

## 复现方法

从仓库根运行：

```bash
cd apps/workspace
LOG_LEVEL=silent node --import tsx scripts/diagnose-request-latency.mjs
```

快速验证 SDK 延迟可加 `LATENCY_QUICK=1`，仅执行 0/1,000 个额外节点的阶段。
脚本通过真实 HTTP、WebSocket 会话和发布版 Collaboration SDK 测试：

- 创建 60 个真实 Sheet Resource，并记录 Recent；
- 创建 10 个 Worktree，每个包含 5 个 Trunk Unit；
- 逐步插入 1,000、10,000、100,000、300,000 个无 Resource 的根 Node；
- 每个阶段对六条读写路径分别串行请求 5 次，记录中位数、最大值和权限查询耗时；
- 通过公开 SDK 方法的进程内计时包装记录慢调用，包装在结束时恢复；
- 仅在实验数据库增加诊断索引，重复同一组请求作为因果对照；
- 断言 HTTP 成功、创建未停留在 pending，且所有协同提交均已持久化。

脚本打印临时目录，保留其中的产品/协同数据库及 `results.json` 供复核。
不会加载 `.env`、连接既有服务或修改已安装的 SDK 文件。
每个阶段会多创建 5 个 Resource 和 5 个空 Worktree，因此节点数略高于插入数量。
5 次样本只用于定位瓶颈，不作为稳定的 P95 或容量测试结论。

## 修复前基线

一轮完整运行的 HTTP 中位数，单位毫秒：

| 路径 | 初始小库 | 10 万额外节点 | 30 万额外节点 | 30 万节点 + 诊断索引 |
| --- | ---: | ---: | ---: | ---: |
| GET `/api/recent-resources` | 2.16 | 134.21 | 473.18 | 1.87 |
| GET `/api/owned-by-me` | 1.86 | 137.78 | 473.11 | 15.18 |
| GET `/api/worktrees` | 2.33 | 132.78 | 448.41 | 3.47 |
| POST `/api/resources` | 1.53 | 4.87 | 11.45 | 1.99 |
| POST `/api/worktrees` | 0.91 | 1.07 | 1.12 | 0.92 |

`new_changes` 的空 mutation 提交通常只有数毫秒，但在小库也复现到约 505 毫秒；
30 万节点时最大 524 毫秒，加诊断索引后最大仍约 505 毫秒。
完整运行的 30 次提交全部落库。两轮快速运行也复现了周期性慢请求。

## 本仓库：权限解析中的全索引扫描

`server/src/modules/access/access.repository.ts` 的 `resolveNode()` 为每个节点计算
`has_children`：

```sql
SELECT 1 FROM nodes AS child
WHERE child.parent_id = node.id
  AND child.trash_batch_id IS NULL
```

现有 `nodes_parent` 索引首列为 `space_id`，查询缺少该条件。
本次实验的 `EXPLAIN QUERY PLAN` 为 `SCAN child USING COVERING INDEX nodes_parent`。
对无子节点的目标，需要扫描到末尾。Recent/Owned 默认分页解析 51 个候选资源；
Worktree 列表在本次 10 × 5 个 Unit 的配置中解析 50 次资源权限。
因此全库扫描被每页反复执行，30 万节点时权限查询占据了列表请求的绝大部分耗时。

仅在实验数据库添加 `nodes(parent_id, trash_batch_id)` 后，查询变成 `SEARCH`，
上述列表延迟显著下降。这是诊断对照，不是已接受的迁移方案。
正式修复在原查询补充 `child.space_id = node.space_id`，利用现有索引。
产品的创建与移动操作约束父子节点属于同一 Space；集成测试直接检查实际权限 SQL
使用现有索引的三列查找，并验证目录响应与权限行为。

## 修复与复测

- 完整 Node 投影通过 Space + Parent + Trash 查找子节点，复用编译后的权限查询语句。
  缓存的是 Statement，不是权限结果，每次执行都绑定当前用户并读取当前数据。
- 内容授权与目录授权共享可见性及角色规则；协同和 Worktree 内容能力检查不再计算
  子节点、目录字段及导航根。
- Owned 对每批候选一次性解析，SQL 独立验证 owner，不再逐项递归计算祖先分享。
- Recent 在候选查询中排除回收站条目，之后仍逐项验证当前访问权限。
- Worktree 列表完成所有 SDK 读取后，在无 `await` 的阶段复用同页重复 Resource 的
  授权结果；不跨请求或异步边界缓存。

相同脚本、相同数据规模重跑，以下修复后数据均取**添加诊断索引之前**的阶段，单位毫秒：

| 路径 | 修复前 30 万额外节点 | 修复后 30 万额外节点 |
| --- | ---: | ---: |
| GET `/api/recent-resources` | 473.18 | 2.05 |
| GET `/api/owned-by-me` | 473.11 | 13.43 |
| GET `/api/worktrees` | 448.41 | 2.06 |
| POST `/api/resources` | 11.45 | 1.73 |
| POST `/api/worktrees` | 1.12 | 1.01 |

Owned 每页权限解析由 51 次降为 1 次批量查询，耗时约 0.28ms；Worktree 样本中
10 个工作树共引用 5 个不同 Resource，解析由 50 次降为 5 次，耗时约 0.04ms。
Owned 总耗时仍从小库随节点数量上升，候选筛选和排序尚有成本；本次没有为合成数据
强制 JOIN 顺序或增加正式索引，不能称为所有列表成本已消除。

修复后的 30 次协同提交全部持久化；30 万节点阶段 `new_changes` 中位数 1.31ms，
最大值 505.46ms，快照等待仍然存在。

验证包括全仓 `pnpm typecheck`、`pnpm test`（Workspace 46 文件、232 测试）、
Workspace `build:server` 和 `test:production-import`。新增回归覆盖继承分享、匿名只读、
权限撤销、团队成员角色、回收站、Blob 映射、Owned 分页/目录数据与实际子节点查询计划；
Worktree 测试验证同页复用且权限变更后下次请求重新解析。

本机完整基线结果为临时目录 `workspace-latency-e0ztsO/results.json`，修复后结果为
`workspace-latency-ew81JY/results.json`。临时文件可能被系统清理，脚本是可重复运行入口。

## 上游 SDK：Sheet 快照等待约 500 毫秒

Workspace 的 `new_changes` 使用发布版 Collaboration Endpoint，后者调用
`UniverCollabService.submitChangeset()`。计时包装显示：

- revision 10/15/20/25/30 的 `UniverUnitRuntime.createSnapshot()` 约 500–503 毫秒；
- `submitChangeset()` 包含这段等待；`commitChangeset()`、`saveSnapshot()` 和
  History `appendRevision()` 没有记录到超过 100 毫秒的调用；
- 多个快照慢样本中，整个进程 CPU 增量仅约 2–3 毫秒，符合等待而非同等时长计算的特征。
  这里是进程 CPU 计量，不是独占该方法的 CPU profile。

检查已发布代码可见，Sheet 默认在 revision 为 5 的倍数时触发快照，提交响应会等待
best-effort 快照结束。生成 Sheet 快照先调用
`FormulaCalculationSessionService.waitForLatestApplied(30000)`；该函数的
`startWatchdog` 默认是 500 毫秒。在没有新的计算会话启动等条件下，会等待这个窗口。
实测阶段和代码等待机制相符。这条修复边界在 Collaboration / Formula SDK，
不能在 Workspace 复制 SDK 内部实现或直接修改安装包来规避。

本次使用空 mutations 和空 Sheet；尚未覆盖大文档、真实公式计算、并发提交、磁盘竞争。
revision 5 的首次快照也不一定等待 500 毫秒，不能表述为每次快照必然耗时 500 毫秒。

## 与 Grafana 的对应范围

面板按 `route` 聚合，丢弃了 `method` 与 `status_code` 维度：
`/worktrees` 混合 GET/POST，而 `/resources` 是 POST 创建，不能称为资源列表。
当前本地实验未复现 POST 创建的秒级延迟，也未复现 `/worktrees` 的 1.9 秒峰值。

Histogram 桶为 `[0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30]`。
若低流量窗口样本都落入 0.3–1 秒桶，P95 插值为
`0.3 + (1 - 0.3) × 0.95 = 0.965` 秒；约 500 毫秒请求可以产生 965 毫秒的图表值。
多个路由显示相同 965 毫秒不能证明共同依赖恰好耗时 965 毫秒。

确认生产根因还需要核对部署版本、Node/Worktree/Unit 数量，并从请求日志按
method、request ID、实际耗时及协同 revision 对齐。这份记录证明本地可复现的机制，
不把合成数据下的退化认定为生产事故的最终根因。
