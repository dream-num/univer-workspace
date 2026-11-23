# Agent Mode 阶段 0 结果

> 日期 2026-11-23。对应 [规格](spec.zh-CN.md) 6.1 的 A0.1 到 A0.6。测量基于 `@univerjs-pro/collaboration-worktree-service` 1.6.1。
> 测量数字来自一台 12 核的开发机，运行时负载 1.8 到 5.6。部署环境是 16 核 32 GB，数字只用来比较量级和斜率，不能直接当作生产容量。

## 1. 结论

- **A0.6 的闸通过。** A0.4 的判断在运行中逐条复核，没有一条被推翻。阶段 2 可以按规格开始。
- **合入阻塞整个服务。** 合入在主线程同步执行 OT transform，期间不让出事件循环。耗时约为 4 µs 乘以草稿 changeset 数（M）再乘以落后距离（D）。M 和 D 都是 1000 时，服务器停顿约 3.5 秒。这是规格 6.10 没有量化过的风险，见第 8 节。
- **阈值。** `stale` 取落后距离大于 100 个修订，或年龄超过 7 天。每个主体同时未结束的 Worktree 至多 10 个。推导见第 7 节。
- **License 的编辑连接没有测到数字。** 内置 License 的编辑连接数没有上限，SDK 不计数。要得到数字，需要用生产 License 再跑一次脚本。

## 2. 怎样复现

脚本是 `apps/workspace/scripts/sqlite/measure-worktree-sdk.mjs`。它在进程内启动真实的应用、真实的 SDK 和真实的 `/universer-api` 网关，只使用新建的临时 SQLite 数据库，结束后删除它们。

```bash
cd apps/workspace
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --self-test
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --scenario claims --output claims.json
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --scenario behind --output behind.json
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --scenario coldload --output coldload.json
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --scenario memory --idle-wait 200 --output memory.json
```

`--help` 列出全部参数。脚本通过 `loadConfig` 读取 `UNIVER_LICENSE` 和 `UNIVER_LICENSE_KEY`，和服务端一样。

产品的权限判定在 SDK 之前就返回 403，所以有几项判断走 HTTP 到不了 SDK。脚本在 `application.initialize()` 时包装 SDK 类的 `use`，拿到产品创建的服务实例，再用产品传给 SDK 的同一个 `collaborationCallOptions(userId)` 直接调用。需要观察 SDK 自己的行为时，脚本临时跳过 `collaboration-gateway.ts` 注册的中间件。每条记录都同时给出经过中间件和跳过中间件的结果。

本文的数字来自提交 `1e92fd5f` 上的完整运行，每份报告的 `errors` 都是 0。

## 3. A0.4：SDK 的行为

| 判断                   | 结论                     | 观察到的                                                                                                                                                                        |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 加入是浅引用           | 成立                     | Worktree Unit 的 ID 和 Trunk 相同。`baselineTrunkRevision` 和 `draftHeadRevision` 都等于加入那一刻的 Trunk 修订 4。草稿 changeset 和 seed 都是 0 行。Trunk 没有前进             |
| 基线不变               | 成立                     | Trunk 前进到 7 之后，基线仍是 4。通过 SDK 和 HTTP 再加一次同一个 Unit，基线仍是 4                                                                                               |
| `ready` 冻结           | 成立                     | 产品 HTTP 返回 403。跳过产品中间件后，SDK 拒绝，错误是 `PERMISSION_DENIED "Worktree is ready"`。草稿修订没有变化                                                                |
| 合入后 Unit 冻结       | 成立                     | SDK 拒绝写入，错误是 `PERMISSION_DENIED "Worktree is merged"`。`reopenWorktree` 抛出 `WORKTREE_STATUS_MISMATCH`                                                                 |
| 部分冲突后回到 `ready` | 成立                     | 两个 Unit。冲突的 Unit 得到 `conflict`，错误码 `OT_CONFLICT`，它的值没有进入 Trunk。另一个 Unit 得到 `merged`，值进入 Trunk。Worktree 回到 `ready`，产品里 `processedAt` 仍为空 |
| 非作者合入，editor     | 成立                     | E2 合入 E1 的 Team Worktree。Trunk 上这次修订的 `userID` 是 E2，`memberID` 是 `worktree-merge`                                                                                  |
| 非作者合入，viewer     | 成立，检查发生在产品一侧 | viewer 的合入失败，错误是 `PERMISSION_DENIED "Unit is read-only."`。Worktree 回到 `ready`，Trunk 没有变化。跳过产品中间件重试，同一次合入成功落地                               |
| 非作者合入，认领人     | 成立                     | 认领人通过 HTTP 合入 agent 的 User Worktree，返回 200，值进入 Trunk                                                                                                             |

viewer 这一行要说清楚。拒绝来自 `collaboration-gateway.ts` 在 Trunk 服务上注册的 `requireChangesetAccess`，它调用 `requireUnitEdit`，按合入者的身份检查 `editContent`。SDK 自己不检查合入者。规格 5.4 说 Trunk 的协同服务按合入者检查编辑权，这句话成立，前提是 Trunk 服务挂着产品的这个中间件。阶段 2 改权限判定时不能动它。

部分冲突的触发条件也有一个细节。Trunk 删除的行和草稿写入的行重叠时冲突。删除的行在写入的行之上时不冲突，草稿的值随行号上移。

## 4. A0.1：落后距离和合入

每个 Worktree 有一个 Sheet，草稿里做 20 次单元格修改（M = 20）。然后 Trunk 由另一个 editor 前进 D 个修订，再 ready 和合入。每一行做 5 次。时间是中位数和范围，单位毫秒。

上游的修改分两种负载：

- `values`：Trunk 的每次修改都写一个随机单元格，其中一成落在草稿写过的区域。
- `structural`：同上，但每次修改有 2% 的概率是插入或删除一行。

| 负载       | D    | merged | conflict | failed | 合入              | merge preview     |
| ---------- | ---- | ------ | -------- | ------ | ----------------- | ----------------- |
| values     | 0    | 5      | 0        | 0      | 36.6 [11.5, 39.1] | 0.2，`not-behind` |
| values     | 10   | 5      | 0        | 0      | 7.6 [7.2, 8.8]    | 676 [635, 682]    |
| values     | 100  | 5      | 0        | 0      | 15.4 [14.4, 16.2] | 667 [647, 671]    |
| values     | 1000 | 5      | 0        | 0      | 86.6 [84.7, 86.8] | 662 [649, 685]    |
| structural | 0    | 5      | 0        | 0      | 14.4 [10.6, 19.5] | 0.1，`not-behind` |
| structural | 10   | 5      | 0        | 0      | 7.1 [7.0, 10.1]   | 661 [646, 711]    |
| structural | 100  | 4      | 1        | 0      | 15.3 [13.7, 18.7] | 650 [12, 661]     |
| structural | 1000 | 3      | 2        | 0      | 94.3 [11.7, 95.7] | 672 [12, 682]     |

37 次成功的合入，草稿最后写的值都在 Trunk 上读到了，产品视图和 SDK 记录一致。没有 `failed`。每种负载都先跑 D = 0，它比 D = 10 慢，推测是第一次合入的预热，没有单独测。

D = 1000 时另外各跑一次，加大 M：

| M    | values                                | structural                  |
| ---- | ------------------------------------- | --------------------------- |
| 100  | merged，合入 355 ms，preview 712 ms   | `OT_CONFLICT`，合入 404 ms  |
| 1000 | merged，合入 3456 ms，preview 3625 ms | `OT_CONFLICT`，合入 3732 ms |

下面三段的线程 CPU、线程启动次数、事件循环延迟和 CPU profile，来自给脚本临时加了计时的诊断运行。诊断版本没有提交，所以这些数字不能用提交的脚本直接复现，结论按它们写成推断。

**合入的耗时是主线程上的 CPU。** D = 1000、M = 20 时，主线程 CPU 占了 89 ms 里的 87 ms。CPU profile 显示时间花在 `@univerjs-pro/collaboration` 的 `transformChangesets` 和 `transformMutation`，其中约一半是 `@univerjs/core` 的 `deepClone`。耗时大致与 M × D 成正比，每对 changeset 3.5 到 4.3 µs。合入期间事件循环不让出。M = D = 1000 时，事件循环的最大延迟是 3464 ms 和 3758 ms，和两次合入的耗时一致。

**merge preview 的固定成本是启动一个 worker。** 每次产出 preview 都新启动一个 Unit Runtime worker 线程。主线程 CPU 只有 6 到 94 ms，进程 CPU 约 1 秒。返回 `conflict` 的 preview 不启动 worker。M = 20 时只要 12 到 80 ms，但它同样要做 transform，M = 100 和 1000 时分别是 387 ms 和 3787 ms。这一项是按线程计数和 CPU 拆分推断的，没有在 worker 内部做 profile。

**SDK 的 3000 ms transform 上限没有起作用。** 读 `@univerjs-pro/collaboration` 的代码，它每 1 万次循环才检查一次。3.7 秒的合入也没有触发它。上面的 `OT_CONFLICT` 都是真冲突。

**冲突率取决于上游做了什么。** `values` 负载在 D = 1000 时也没有冲突，因为两边写同一个单元格不算冲突。`structural` 负载里，只有删除的行和草稿写过的行重叠才冲突。按这个负载推算，每个修订冲突的概率约为 0.02 × 0.5 × 0.1 = 0.001，D 个修订后冲突的概率约为 1 − 0.999^D。这个模型预测 D = 10、100、1000 时分别是 1%、10%、63%。5 次试验里实际观察到 0、1、2 次，和模型相符。每行只有 5 次，单行的比率误差很大，结论应看趋势，不看具体百分比。

## 5. A0.2：冷加载

一个 Worktree，一个 Unit，草稿里有 N 个 changeset。关闭应用，在同一份数据库上重新打开，然后计时。每个 N 重复 3 次，每次都重新打开。单位毫秒。

| N    | 浏览器加载（snapshot rev 0） | 重启后的第一次草稿写入 |
| ---- | ---------------------------- | ---------------------- |
| 0    | 4.4 [3.8, 5.0]               | 844 [789, 872]         |
| 10   | 3.3 [3.3, 8.7]               | 676 [667, 681]         |
| 100  | 4.1 [3.7, 4.6]               | 669 [659, 669]         |
| 1000 | 13.7 [11.4, 29.0]            | 696 [680, 715]         |

- 加载接口返回 Trunk 快照加上全部 N 个 changeset，不做物化，由浏览器重放。服务端这一侧随 N 增长很慢。
- 第一次草稿写入要启动这个 Worktree 的草稿服务和它的 worker，固定约 0.7 秒。从 N = 10 到 N = 1000，只多出约 20 ms。N = 0 那一行是应用启动后的第一个 Worktree，更慢的原因没有单独测，推测是 Trunk 的 worker 同时在启动。
- 浏览器重放 N 个 changeset 的时间没有测。它是规格 5.9 里“草稿快照”这项上游需求要看的数字。

结论是，到 1000 个草稿 changeset 为止，服务端的冷加载不是瓶颈。

## 6. A0.3：内存和 License

### 6.1 每个 Worktree 的内存

活跃指的是最近写过草稿。下表的每个 Worktree 都写过一次。读草稿也会创建草稿服务，但读完之后第一次写入仍要约 0.7 秒，所以读可能不启动 worker，这一点没有单独测。空闲 180 秒后草稿服务退出。

| 活跃 Worktree 数 | worker 线程 | worker heap used | worker heap total |
| ---------------- | ----------- | ---------------- | ----------------- |
| 0                | 6           | 518 MiB          | 990 MiB           |
| 1                | 7           | 612 MiB          | 1199 MiB          |
| 5                | 11          | 988 MiB          | 1974 MiB          |
| 10               | 16          | 1459 MiB         | 2894 MiB          |
| 20               | 26          | 2404 MiB         | 4798 MiB          |

- 每个活跃的 Worktree 多一个 worker 线程，heap used 多约 94 MiB，heap total 多约 190 MiB。主线程 heap 只多约 0.2 MiB。
- 只加了 Unit、从没写过的 Worktree 不启动 worker，主线程 heap 每个只多约 0.1 MiB。
- 等待 200 秒后，草稿服务全部退出，线程回到 6 个，worker heap used 回到 484 MiB。
- 每个 Worktree 在 Worktree endpoint 里有一个 scoped endpoint，创建后一直缓存，直到进程退出，等待之后仍有 40 个。它占的内存没有单独测，上限约为每个 0.1 MiB。
- macOS 上的 RSS 不单调，所以用 worker heap，不用 RSS。

### 6.2 License 的编辑连接

没有测到数字。内置 License 的 `editingConnectionsLimit` 是 `null`，即没有上限。Trunk endpoint 的 `limit`、`used`、`remaining` 都是 `null`，40 个 scoped endpoint 只记录了 `used`，也都是 `null`。

读代码得到的计数规则如下，没有运行验证：

- 草稿连接和 Trunk 共用同一个配额。
- 一个 WebSocket 会话第一次提交成功后开始占用一个名额，关闭或最后一次提交 120 秒后释放。每个浏览器标签页单独算。
- 产品通过 HTTP 写草稿时，`memberID` 是 `product-api:<userId>`，按不同的用户各占一个名额，而且不受上限检查。
- 合入的 `memberID` 是 `worktree-merge`，不占名额。

要得到真实的占用，需要用生产 License 运行 `--scenario memory`，再用浏览器打开几个草稿会话。

## 7. A0.5：阈值和上限

### 7.1 `stale` 的阈值

**落后距离大于 100 个修订，或者加入 Worktree 超过 7 天，标为 `stale`。** 这是基于第 4 节数据的判断，不是测出来的常数。

- D ≤ 100 时，M = 20 的合入只要 16 ms 左右。在 `structural` 负载下，冲突概率按模型约为 10%。
- D 超过 100 之后，冲突概率上升很快，D = 1000 时约 63%。这时在新的基线上重做，比先合入再处理冲突更便宜。
- 年龄没有测量依据。7 天和 HTML View 草稿的过期时间一致（规格 5.7），提议超过 7 天时页面本来就要重新保存。
- 落后距离大于 0 时，先在 merge preview 上验证。preview 每次要启动一个 worker，约 0.7 秒、1 秒 CPU。agent 应该只对改过的 Unit 做 preview。

### 7.2 每个主体同时未结束的 Worktree

**每个主体同时未结束的 Worktree 至多 10 个。**

- 未结束但空闲的 Worktree 几乎不占内存。内存花在活跃的 Worktree 上，每个约 190 MiB worker heap total。
- 一个主体的 10 个 Worktree 同时活跃时，约占 1.9 GB，是 32 GB 主机的 6%。8 个这样的主体同时满载，约占一半内存。
- 这个上限保护不了整个服务。真正需要的是全服务范围内同时活跃的草稿服务数量上限，SDK 今天没有这个设置。第 8 节把它列为上游需求。

## 8. 对规格的影响

规格不需要因为 A0.4 修改。下面几项需要补充，已经在同一个改动里写进规格：

- 5.6 的两个阈值取第 7.1 节的值。
- 5.9 的上游需求加一项：合入的 OT transform 移出主线程，或者分段让出事件循环。没有它，大的合入会让整个服务停顿，停顿时间约为 4 µs × M × D。
- 9.2 里归阶段 0 的两项假设已经确认。跨 Unit 公式见第 9 节。

阶段 2 开工时要注意：

- 不要动 Trunk 服务上的 `requireChangesetAccess`。viewer 的提议由 editor 合入，正是靠它按合入者检查编辑权。
- viewer 合入失败后，Unit 的结果是 `failed`，Worktree 回到 `ready`，可以重试。阶段 2 的 `capabilities.merge` 应该让 viewer 根本走不到这一步。
- 合入的停顿时间和 M × D 成正比。如果阶段 2 之后生产环境出现停顿，再决定是否在服务端限制 M × D，并同时向上游提需求。本文不建议现在加硬上限，因为规格要求 `stale` 只提示。

## 9. 规格 9.2：跨 Unit 公式

这一项用 verify-uvw 在真实应用里，通过 `uvw` 的无界面运行时观察。

| 情况                             | Host!A1 的计算结果 | Source!A1，Worktree 里 | Source!A1，Trunk |
| -------------------------------- | ------------------ | ---------------------- | ---------------- |
| Source 和 Host 在同一个 Worktree | 2，草稿值          | 2                      | 1                |
| Worktree 里只有 Host             | 1，Trunk 值        | 不在 Worktree 里       | 1                |

- 跨 Unit 公式在 Worktree 里读同一个 Worktree 里的草稿，不在其中的 Unit 读 Trunk。另一个 Worktree 里 Source 的草稿不会串过来。
- Host 存下的是上一次计算的结果。在同一个 Worktree 里把 Source 再改成 3，读 Host 仍然得到 2。读取不会重新计算，要等 Host 自己被写一次。agent 验证跨 Unit 的结果时，要先触发 Host 重算。
- 浏览器走 `packages/reference-provider/src/scope.ts`，规则和 CLI 的 `packages/client-core/src/runtime-source.ts` 相同。浏览器这条路径只读了代码，没有运行。

## 10. 规格 1.3 的基线

`workspace_ceiling_denials_total` 和 `mcp.tool_call` 的 `principal_category` 在 PR 530 里加入。部署之后，按主体类别统计的拒绝次数从这两处读取。在那之前，基线按代码和一次 verify-uvw 运行给出：

- 规格 6.8 的三个故事今天都走不完。故事 1 和故事 2 的第一步是把 agent 加为成员，`addTeamMember` 返回 `AGENT_NOT_ALLOWED`。故事 3 的第一步是 agent 创建仓库，`createTeamSpace` 返回 `AGENT_NOT_ALLOWED`，verify-uvw 的运行确认了这一次拒绝。
- 人用 PAT 交给 agent 的任务，网关的说明文字要求把 ready 和合入留给人，所以中途至少有一次人的动作。等待人的时长取决于人，产品里没有记录。

## 11. 没有测到的

- 生产 License 下的编辑连接占用。
- 浏览器重放草稿 changeset 的时间。
- 部署环境上的内存和合入耗时。本文的数字来自开发机。
- merge preview 和第一次草稿写入在 worker 内部的时间分布。
- scoped endpoint 单独占用的内存。
