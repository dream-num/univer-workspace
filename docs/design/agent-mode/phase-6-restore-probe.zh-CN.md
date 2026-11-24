# Agent Mode 阶段 6 的 Trunk restore 探针

> 日期 2026-11-24。[规格](spec.zh-CN.md) 6.7 的撤回打算在本仓库用 Trunk 的 restore 组合出来，不改上游。这个做法依赖的 SDK 行为原先只来自类型声明、界面文字和压缩后的代码。本文在已安装的 SDK 1.6.1（`@univerjs-pro/collaboration` 和 `@univerjs-pro/collaboration-service`）上逐条运行复核，是 P6-8 开工前的闸，作用和 [阶段 0 结果](phase-0-results.zh-CN.md) 相同。
> 每个结论都来自提交 `529b6edd` 上的脚本输出。两次完整运行的结论逐条相同，`errors` 都是 0。下文用“记录 `id`”指 `scenarios.restore.records` 里的一行，用字段名指它的 `observed`。文中的“计划”指协调者的阶段 6 工作计划，不在仓库里，它采纳的结论已写进规格 6.7。

## 1. 结论

- **P6-8 的闸没有通过。** restore 只需要整个 Unit 的 Edit 权限，SDK 不按受保护的区域计算权限。一个没有区域编辑权的 editor 用 restore 覆盖了受保护的单元格，还删掉了保护规则本身，之后这个 editor 可以直接改那个单元格（第 8 节）。计划推断“受保护的区域会让整个 restore 被拒绝”，结果相反。计划里“能验收并能编辑每个 Unit 的主体可以撤回”这条规则，在有区域保护的 Unit 上不够，P6-8 开工前要先定规则（第 11 节）。Browser 的 History 界面挡住了这条路：没有区域编辑权的 editor 看到的“Restore this version”是禁用的（第 8 节）。但这个检查只在客户端，服务端照样接受这样的 restore，绕开界面直接提交的客户端，以及 P6-8 以撤回者身份在服务端提交的 restore，都不受它约束。
- **Sheet 和 Doc 一样，restore 只能在 head 上提交。** 计划说 restore 的 transform 只有 Sheet 有。实际上 Sheet 的 restore 在过期的 base revision 上同样得到 `OT_CONFLICT`，而同一个 base 上的普通修改能 transform 并提交。反方向也一样，restore 落地之后，基于更早 revision 的普通修改得到 `OT_CONFLICT`，Sheet 和 Doc 都是（第 5 节）。
- **restore 本身符合规格 6.7。** Sheet 和 Doc 都能恢复到合入之前的 revision。restore 追加一个新的 revision，内容等于合入之前（Sheet 只差一个空资源的写法，见第 2 节），历史同时保留合入和 restore。它替换整个 Unit，合入之后别人的修改一起消失（第 3、4、7 节）。
- **幂等成立，前提是原样重交。** 同一个 `sid` 和 `reqId` 原样重交返回 `already-committed`。head 前进之后、应用重启之后结果都一样。同样的 `sid` 和 `reqId` 换一个 base revision 重交，得到 `retry` 和 `REVISION_MISMATCH`，不生效。换一个 `reqId` 会再执行一次（第 6 节）。
- **合入之前的 revision 可以从公开读取得到，但不能靠 `sid`。** 每次合入在 Trunk 上正好是一个 revision，即 SDK 记录的 `mergeResult.trunkRevision`，它减 1 就是合入之前的 revision。合入 changeset 的 `sid` 是随机值，不含 Worktree ID。计划里“按 `sid` 认出属于这组 Worktree 的 revision”做不到，要按 `trunkRevision` 认（第 9 节）。
- **restore 不能经过 Worktree。** 把 restore 交给 Worktree 草稿，SDK 拒绝，错误是 `Worktree draft snapshots are disabled`。撤回只能直接写 Trunk。规格 1.4 写着“每个对 Unit 的修改仍然经过 Worktree”，规格 6.7 的撤回是它的一个例外，规格里还没有写明（第 10 节）。

## 2. 怎样复现

```bash
cd apps/workspace
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --self-test
LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --scenario restore --output restore.json
```

`restore` 场景和阶段 0 的场景一样，在进程内启动真实的应用、真实的 SDK 和真实的 `/universer-api` 网关，只使用新建的临时 SQLite 数据库，结束后删除它们。一次运行约 12 秒。

一次 restore 是一个只含 `RevertRevisionMutation` 的 changeset。这个 mutation 的 id 是 `univer.mutation.revert-version`，参数是 `{unitId, revision}`。脚本通过公开的 `UniverCollabService.submitChangeset` 提交它，调用方式和产品自己写 Trunk 时相同（`collaborationCallOptions(userId)`），所以会经过产品在 Trunk 服务上注册的全部中间件。脚本还记下每次提交时 SDK 算出的 `requiredUnitPermissions`，它们取自产品的 `commitChangeset` 中间件收到的上下文。

每条记录有三个字段。`statement` 是被检验的判断，多数取自计划。`verdict` 是 `CONFIRMED`、`REFUTED` 或 `INCONCLUSIVE`。`observed` 是观察到的值。几条记录带对照，例如同一个过期 base 上的普通修改，或者 viewer 的 restore。对照不成立时，verdict 是 `INCONCLUSIVE`。

内容比较把 Unit 在两个 revision 上物化成 workbook 或 document 数据，逐字段比对，差异列在 `differences*` 字段里。Sheet 的 restore 之后，资源 `SHEET_DEFINED_NAME_PLUGIN` 从 `""` 变成 `"{}"`。推断两者都表示没有定义名称，没有在界面里核对。脚本照常报告这一处，判定时用 `material` 排除空资源的这两种写法。Doc 没有这一处差异。

参与者沿用阶段 0。H 是 Team Space 的 owner，E1 和 E2 是 editor，V 是 viewer。

## 3. 问题 1：合入之后恢复一个 Sheet

记录 `restore-after-merge`，`CONFIRMED`。

E1 在 Worktree 里改了两个单元格，然后合入。合入之前 Trunk 在 revision 1（`merge.preMergeHead`），合入写成 revision 2（`merge.sdkResult.trunkRevision`）。E2 以 base revision 2 提交 restore，目标是 revision 1。

| 观察                       | 值                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 提交结果                   | `committed`，revision 3（`restore.submitted`）                                                                                |
| 和合入之前的内容差异       | 只有 `SHEET_DEFINED_NAME_PLUGIN` 从 `""` 变成 `"{}"`（`differencesFromPreMerge`）                                             |
| 合入写的值还在不在 Trunk 上 | 不在，`mergedValueAfter` 是 `null`                                                                                          |
| Trunk 历史                 | revision 2 的 `memberID` 是 `worktree-merge`，含两个 `sheet.mutation.set-range-values`。revision 3 的 `memberID` 是 `product-api:<E2>`，只含 `univer.mutation.revert-version` |
| SDK 要求的权限             | 一项，Unit 本身（`objectType` 1，Workbook）的 Edit（`action` 1）                                                               |

restore 追加 revision，不删除也不改写已有的历史。合入那一条仍在。

## 4. 问题 2：合入之后别人又改过

记录 `restore-overwrites-later-edit`，`CONFIRMED`。

E1 合入（revision 2），之后 E2 在 Trunk 上改了另一个单元格（revision 3）。H 恢复到 revision 1，得到 revision 4。E2 的修改不在了（`laterEditAfter` 是 `null`），合入的修改也不在了（`mergedValueAfter` 是 `null`），内容和 revision 1 只差空资源那一处。

restore 替换整个 Unit，不区分修改来自谁。规格 6.7 让“合入之后别人又改过的 Unit 默认不撤回”，这条规则是必要的。

## 5. 问题 3：并发

记录 `restore-stale-base-sheet`（`REFUTED`）、`restore-stale-base-doc`（`CONFIRMED`）、`stale-edit-over-restore-sheet` 和 `stale-edit-over-restore-doc`（都是 `REFUTED`）。

先看过期的 restore。H 在 revision 2 和 3 上各改一次，E1 在 revision 4 上又改一次，然后 E2 在 base revision 3 上提交。Sheet 的“内容等于”都只差第 2 节的空资源写法。

| 提交                                | Sheet                                                                           | Doc      |
| ----------------------------------- | ------------------------------------------------------------------------------- | -------- |
| 对照，普通修改，base 3              | `committed`，revision 5（`ordinaryAtStaleBase`）                                | 同 Sheet |
| restore 到 revision 2，base 3       | `rejected`，`OT_CONFLICT`，`Changeset cannot be transformed`。head 仍是 5，内容不变 | 同 Sheet |
| 同一个 restore，base 换成 head 5    | `committed`，revision 6，内容等于 revision 2（`atHead`、`differencesFromGoalAfterAll`） | 同 Sheet |

再看反方向。restore 以 head 7 为 base 提交并落地成 revision 8，之后另一个成员以 base 7 提交一个普通修改。

| 提交                                       | Sheet                                           | Doc      |
| ------------------------------------------ | ----------------------------------------------- | -------- |
| restore 到 revision 2，base 7              | `committed`，revision 8                         | 同 Sheet |
| 普通修改，base 7，即 restore 之前的 head   | `rejected`，`OT_CONFLICT`（`late`）。head 仍是 8 | 同 Sheet |

结论有三点：

- restore 在 Trunk 上不做 transform，Sheet 也不做。SDK 1.6.1 导出了 Sheet 的 restore transform 算法的类型（`@univerjs-pro/collaboration` 的 `controllers/sheet-transform/algorithms/revert-revision/`），但这两个方向在 Trunk 上都得到冲突。原因没有在代码里确认。
- 过期的 restore 被整个拒绝，不会部分生效。服务端读 head，在 head 上重交，就能提交。
- restore 落地的那一刻，任何基于更早 revision、还没有提交的修改都会被拒绝。Browser 收到这个拒绝之后怎么处理，没有测（第 12 节）。

## 6. 问题 4：幂等

记录 `restore-resubmit`，`CONFIRMED`。

restore 用 `sid` 为 `revert-operation-<uuid>`、`reqId` 为 1，模拟一个持久化的 Operation 会用的标识。

| 步骤                                                     | 结果                                                                   | head |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ---- |
| 第一次提交，base 3                                       | `committed`，revision 4（`first`）                                      | 4    |
| 原样重交                                                 | `already-committed`，revision 4（`identical`）                          | 4    |
| E1 改了另一个单元格                                      |                                                                        | 5    |
| 原样重交，base 仍是 3                                    | `already-committed`，revision 4（`identicalAfterLaterEdit`）            | 5    |
| 同样的 `sid` 和 `reqId`，base 换成 5                     | `retry`，`REVISION_MISMATCH`，`Changeset could not be committed after bounded retries`（`sameIdsAtHead`） | 5    |
| 关闭应用，在同一份数据库上重新启动，原样重交             | `already-committed`，revision 4（`identicalAfterRestart`）              | 5    |
| 对照，同样的 `sid`，`reqId` 为 2，base 5                 | `committed`，revision 6，E1 的修改消失（`nextReqIdControl`）            | 6    |

去重按 `sid` 和 `reqId` 做，重启之后仍然有效，并且先于 transform 检查。依据是 head 已经前进时，原样重交得到的是 `already-committed`，不是 `OT_CONFLICT`。同样的标识从来没有执行两次。换一个 `reqId` 就是一次新的 restore。

## 7. 问题 5：恢复一个 Doc

记录 `restore-doc-after-merge`，`CONFIRMED`。

Doc 的正文是 `One\rTwo\r\n`。E1 在 Worktree 里插入 `merged `，然后合入（revision 2）。E2 恢复到 revision 1，得到 revision 3。

| revision | `body.dataStream`（`dataStream`） |
| -------- | --------------------------------- |
| 1，合入之前 | `One\rTwo\r\n`                  |
| 2，合入之后 | `merged One\rTwo\r\n`           |
| 3，restore 之后 | `One\rTwo\r\n`              |

和合入之前比没有任何差异（`differencesFromPreMerge` 为空）。SDK 要求的权限是 Unit 本身（`objectType` 4，Document）的 Edit。

## 8. 问题 6：受保护的区域

记录 `restore-protected-untouched`（`CONFIRMED`）、`restore-protected-range`（`REFUTED`）、`restore-removes-protection`（`REFUTED`）。

H 通过 `/universer-api/authz/3/object` 建一条 SelectRange 保护，编辑范围是 `OneSelf`，再用 `sheet.mutation.add-range-protection` 把它绑定到 B2（revision 2）。做法和 `apps/workspace/test/integration/collaboration-gateway.test.ts` 里的“rejects protected cell writes server-side”相同。之后的顺序如下：

1. E1 改 A1（revision 3），E2 restore 到 revision 2（revision 4）。
2. H 改 B2（revision 5），E1 再改 A1（revision 6）。
3. V 和 E2 各提交一次 restore 到 revision 4，H 也提交一次。
4. E2 restore 到 revision 1，然后直接写 B2。

| 提交                                                     | SDK 要求的权限                                         | 结果                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| E2 直接写 B2（`directB2ByEditorTwo`）                    | Workbook 的 Edit，加上这条保护（`objectType` 3）的 Edit | `rejected`，`PERMISSION_DENIED`，`Content permission denied.`                         |
| E2 restore，恢复的内容不涉及 B2                          | Workbook 的 Edit                                       | `committed`                                                                            |
| V 的 restore（`byViewer`）                               | 没有走到 commit 阶段，列表为空                         | `rejected`，`PERMISSION_DENIED`，`Unit is read-only.`                                 |
| E2 restore 到 revision 4，会把 H 写在 B2 的值改回去（`byEditor`） | Workbook 的 Edit                               | `committed`，revision 7。B2 上 H 的值和 A1 上 E1 的值都不在了（`afterEditor` 的 `b2`、`a1` 都是 `null`） |
| E2 restore 到 revision 1，那时还没有保护（`restore-removes-protection`） | Workbook 的 Edit                        | `committed`，revision 9。`SHEET_RANGE_PROTECTION_PLUGIN` 从含 `protected-b2` 的规则变成 `""`（`protectionBefore`、`protectionAfter`） |
| 之后 E2 直接写 B2（`directB2ByEditorTwoAfter`）          | 未单独记录                                             | `committed`，revision 10，值在 Trunk 上                                                |

viewer 被拒绝，说明产品的中间件对 restore 确实运行。拒绝 viewer 的是 `requireChangesetAccess`，它要求 Unit 的 `editContent`。

editor 能通过，原因在权限计算。产品的 `commitChangeset` 中间件（`apps/workspace/server/src/integrations/univer/collaboration-gateway.ts:136`）逐项检查 SDK 算出的 `requiredUnitPermissions`。普通修改碰到 B2 时，SDK 列出这条保护，检查失败。restore 时 SDK 只列出 Unit 本身。`content-permissions.ts:99` 对 Unit 本身的要求只看 Unit 的 `editContent`，所以任何 editor 都能通过。restore 到保护之前，Unit 里的绑定就没了（`protectionAfter`）。产品数据库里那条规则的记录没有检查，按代码它只在永久删除 Resource 时删除（`content-permissions.ts:389`）。

restore mutation 和它的权限分析（`enableUnitPermissionAnalysis`）归上游，所以这是上游的缺陷。产品可以在自己的中间件里加一道检查作为 workaround，按根 `AGENTS.md` 写明原因、影响和移除条件。

独立复核在真实应用里用 Browser 走了一遍（PR 575 的复核评论）。H 在 B2 上加了只有自己能编辑的区域保护，E 是 editor。E 改不了 B2；E 在 Trunk 的 History 界面里，对保护之前和之后的每个版本，“Restore this version” 都是禁用的，点击没有反应，Trunk 不变。H 的同一个按钮可用，同一个 E 在没有保护的 Sheet 上也可用。原因在 SDK 1.6.1 的界面层：`sheets-history` 的 `canRevert` 和 `sheets-history-ui` 的 `_checkCanRevert` 要求 Unit、每个 worksheet 和每条区域保护规则的 Edit，`edit-history-ui` 的 `restore()` 在 `canRestore` 为 false 时直接返回。所以今天的 Browser 界面不会让 editor 绕过区域保护。服务端没有对应的检查，上面的脚本结果说明绕开界面直接提交的 restore 会被接受。经实时 endpoint 伪造这样的提交，没有在真实应用里运行。

## 9. 问题 7：恢复到哪个 revision

记录 `pre-merge-revision`，`CONFIRMED`。

E1 的 Worktree 有 3 个草稿 changeset，合入。H 在 Trunk 上改一次。E2 的 Worktree 有 1 个草稿 changeset，合入。之后 Trunk 历史如下（`history`）。

| revision | `userID` | `memberID`         | `sid`       | `reqId` | mutation 数 |
| -------- | -------- | ------------------ | ----------- | ------- | ----------- |
| 2        | E1       | `worktree-merge`   | 随机 UUID   | 3       | 3           |
| 3        | H        | `product-api:<H>`  | H 的会话    | 15      | 1           |
| 4        | E2       | `worktree-merge`   | 随机 UUID   | 1       | 1           |

- 每次合入正好是一个 Trunk revision。E1 的合入在 revision 1 之后写成 2，E2 的在 3 之后写成 4，`trunkRevision` 都等于 `preMergeHead + 1`。3 个草稿 changeset 合成了一个含 3 个 mutation 的 changeset。
- 合入 changeset 的 `sid` 不含 Worktree ID（`mergeSids[].sidContainsWorktreeId` 都是 `false`）。所以 revision 只能按 `trunkRevision` 对应到 Worktree。
- 产品的 `GET /api/worktrees/{id}` 只返回字符串 `merged`（`productResult`），不带 revision。SDK 的 `getWorktree` 按 Unit 返回 `{status: "merged", trunkRevision}`（`sdkResult`），`unit-comparison.ts` 已经在读它。
- 按计划的规则推导，这组 Worktree 在这个 Unit 上的恢复目标是 `min(trunkRevision) - 1`，即 1（`restoreTarget`）。revision 1 之后不属于这组的只有 revision 3，作者是 H（`laterAuthors`）。这个 Unit 应当被拦下，并列出 H。

SDK 不为 `unchanged` 的 Unit 记录 `trunkRevision`（`unit-comparison.ts:204` 的注释）。这样的 Unit 没有改动，本来就不需要恢复。

## 10. 问题 8：其他限制

记录 `restore-limits`（`CONFIRMED`）和 `restore-in-worktree-draft`（`REFUTED`）。

| 提交                                                     | 结果                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| restore 和一个 `set-range-values` 放在同一个 changeset   | `rejected`，`INVALID_REQUEST`，`A restore changeset cannot contain other mutations`（`mixed`） |
| restore 到 revision 0                                    | `rejected`，`INVALID_REQUEST`，`Restore target must identify an existing revision of this Unit`（`zero`） |
| restore 到 base revision 加 1                            | 同上（`future`）                                                                              |
| restore 到 base revision 本身                            | `committed`，多一个 revision，内容不变（`atBase`）                                            |
| restore 到 Unit 创建时的 revision 1                      | `committed`（`toCreation`）                                                                    |
| 经 `POST /api/worktrees/{id}/units/{unitId}/changesets` 交给 Worktree 草稿 | HTTP 200，body 的 `status` 是 `rejected`，`INTERNAL_ERROR`，`Worktree draft snapshots are disabled`（`draftSubmit`） |

产品没有为 Worktree 配置草稿快照（`apps/workspace/server/src/integrations/univer/unit-store.ts` 的 `WORKTREE_UNIT_RUNTIME` 只设了 worker 数），Worktree 服务的 README 也写着不提供周期性的草稿快照（`@univerjs-pro/collaboration-worktree-service/README.md:158`），它的类型声明里没有打开草稿快照的选项。所以这个拒绝来自 SDK，产品没有办法配置。

## 11. 对 P6-8 的影响

本节是根据上面的结果给出的建议，没有运行。

1. **先定受保护区域的规则。** 这是唯一的阻断项。任务撤回由服务端以撤回者的身份提交 restore。按现在的权限计算，一个 editor 或 editor 角色的 agent 能用撤回覆盖它改不了的区域，并删除保护。可选的做法有两种，由维护者决定：
   - 本仓库加一个 workaround。在 Trunk 的 `commitChangeset` 中间件里，遇到 restore changeset 而 Unit 绑定了内容保护对象时，要求提交者对每个对象都有 Edit，否则拒绝。这和 Browser 界面已有的检查一致，也挡住绕开界面直接提交的客户端。写成一处隔离的 workaround，移除条件是上游修好权限分析。
   - 上游修权限分析。restore 的权限分析按 head 和目标 revision 之间的差异列出受影响的对象，或者要求每个保护对象的管理权。这一项加到计划 2.5 的上游需求里。
2. **每个 restore 都在刚读到的 head 上提交。** 收到 `OT_CONFLICT` 时重读 head，重新检查有没有新的作者，再重交。Sheet 也要这样做。撤回落地时，正在编辑这个 Unit 的人还没提交的修改会被拒绝，撤回页面应该提示这一点。
3. **Operation 先存下完整的 changeset，再提交。** 每个 Unit 存 `sid`、`reqId`、`baseRev` 和目标 revision。恢复执行时原样重交。结果是 `committed` 或 `already-committed` 就完成。结果是 `OT_CONFLICT` 说明它从未生效，这时把新的一次尝试（新的 `reqId`，base 是新的 head）写进 Operation，再提交。不要用同样的 `reqId` 配新的 base，那样只会得到 `REVISION_MISMATCH`。也不要在原样重交之前换 `reqId`，否则同一个 restore 可能执行两次。
4. **按 `trunkRevision` 认合入的 revision。** 服务端从 SDK 的 `getWorktree` 读每个 Unit 的 `trunkRevision`，和 `unit-comparison.ts` 的做法一样。产品的 HTTP 视图不带它。
5. **撤回直接写 Trunk。** restore 不能经过 Worktree。规格 1.4 要写明撤回是例外，修改记录在 Trunk 历史和 Operation 里，没有 pull request。
6. **比较内容时忽略空资源的两种写法。** P6-8 的测试和验收如果比较撤回前后的内容，要把 `""` 和 `"{}"` 当作同一个空资源。Unit 对比界面会不会因此显示一处 `SHEET_DEFINED_NAME_PLUGIN` 的变化，没有测。

## 12. 没有测到的

- Slide、Board、Base 和 PDF 的 restore。只测了 Sheet 和 Doc。
- Doc、Slide 等对象级保护和 worksheet 保护。只测了 Sheet 的区域保护。
- Browser。History 界面的 restore 发出的 changeset 是否和脚本相同，以及客户端收到 restore 之后的 `OT_CONFLICT` 时怎样处理。界面对没有区域编辑权的 editor 禁用 restore，这一点已由独立复核确认（第 8 节）。
- 实时 endpoint（WebSocket）这条路径。脚本直接调用 `UniverCollabService.submitChangeset`。
- 历史很长或 Unit 很大时 restore 的耗时。
- 同一个 `sid` 里 `reqId` 能否跳号，以及去重记录会不会过期。
- restore 提交对 License 编辑连接的占用。
- 产品对 restore 提交的后续处理，例如搜索索引和 HTML View 的刷新。它们和普通修改一样跟着 `changesetCommitted` 事件，没有逐项检查。
- PostgreSQL 的 Collaboration adapter。只测了 SQLite。
