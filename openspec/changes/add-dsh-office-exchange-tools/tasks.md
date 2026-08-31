> Prerequisite: complete and verify `add-dsh-worktree-unit-tools`, `add-dsh-file-transfer-tools`, and `add-dsh-content-runtime-tools` before implementation.

## 1. 建立向后兼容的 Core Office controls

- [x] 1.1 为 `WorkspaceUnitExchangeFeature` import/export 追加 optional operation controls，并让 Unit create、target resolver 和 `runtime.exportUnitData` 接受/转发 optional signal 与 export UnitData budget；为受控 import 注入已发布 `importBuffer` port，加入 524,288-byte argument 以外由 shell拥有、52,428,800-byte/64-depth Core controls所需的最小 canonical JSON/limit helpers，测试 pre-abort/no-next-step、budget forwarding 和 CLI 无 controls 时仍走原 `importFile`/`exportToFile`、daemon payload、result/error/overwrite behavior不变，运行 Client Core `typecheck` 与 focused `office-exchange`/`content-runtime` tests。

## 2. 使 Office import 可取消且在 create 前有界

- [x] 2.1 在受控 import 中复用Change 5 signal-aware `inspectSource(path)`→`openSource(source, signal)` stream与cleanup，把实际 source bytes最多收集到52,428,801 bytes，核对existing inspected-size/actual-byte count，关闭stream后才用原文件名/options调用published `importBuffer`；不新增open-handle identity API，并继承Change 5无cross-process `openat`/directory-handle fence ceiling。native import前后检查signal并等待不可中断conversion，对最终name-adjusted UnitData执行52,428,800-byte/64-depth gate后才以同一idempotency key和signal调用Change 4 Unit create。测试全部suffix/type/options、大小写、name precedence、source增长/截断/超限、same-length replacement ceiling、read cancel/cleanup、converted limit、native cancel、create confirmed/`workspace-result-unknown`/`workspace-result-mismatch`/`workspace-invalid-response` after dispatch与no replay，并确认CLI no-controls仍走`importFile`且create前failure/cancel无远程副作用。

## 3. 使 Office export 有界且原子

- [x] 3.1 为 DSH atomic branch调用 published `exportToBuffer`，在一次target resolution后要求Change 6 runtime精确同步selected revision并完成UnitData identity与52,428,800-byte/64-depth gate，head推进则在native/output前以`workspace-result-mismatch`失败且不重解析；随后执行native conversion，检查52,428,800-byte output与signal，再复用Change 5 private exact-byte atomic publisher增加Office error kind、default no-clobber和explicit force。测试Sheet/Base/Doc/Slide options、Board/format/identity rejection、head-advance race、runtime/native cancellation settlement、oversize、`0600` temp、sync、racing output、force replace、cleanup与late confirmed publication，同时断言CLI无controls仍调用原`exportToFile` direct path。

## 4. 接入 closed tools、local path policy 与 approval

- [x] 4.1 在 `apps/dsh-univer-work` 添加两个 root-closed definitions及 exact canonical import/export outputs；扩展既有 pure validators 和 fiber-owned pre-execute listener，使两者在ask前完成exact keys/types/suffix/524,288-byte arguments，import按Blob upload顺序一次ask后才做public LocalFS/Session-cwd/source gate，export按Change 5 download顺序执行current policy→local constructor→canonical path preflight→一次ask，approved body重做policy/provider/path后才`processPath()`。真实ToolRuntime/filesystem/policy tests覆盖Native/Code Mode schemas、invalid no-ask、read-only/non-local/outside/no-cwd、workspace-write dual root、danger cwd、provider/policy/symlink drift、deny/cancel/unavailable/no-channel与无第二approval。

## 5. 交付 import/create 与 export outcomes

- [x] 5.1 组合Change 4 Unit、Change 5 source reader、Change 6 runtime generation和Core Office owner实现`workspace_office_import`/`workspace_office_export`，保持existing Core result fields/value-only render，不接受replacement/Trunk/revision/Unit type for export；source tests用fake Workspace/runtime和strict converters固定全部真实format matrix（CSV/Board/legacy output拒绝）、actual-byte bounded import、authoritative Worktree-local Unit create、exact selected revision及head-advance mismatch、no content commit、atomic output/no-clobber/force和canonical output-before-render，运行 DSH app focused tests。

## 6. 收敛 Office errors、cancellation 与 lifecycle

- [x] 6.1 扩展共享safe error adapter与accepted-body owner：加入exact Office/output/limit codes，known `ExchangeErrorCode`只映射fixed `workspace-office-conversion-failed` `{phase, exchangeCode}`，其余固定`workspace-office-operation-failed`；贯穿caller/owner signal并等待source reader/native conversion/Unit create/runtime/file cleanup。create dispatch后的`workspace-result-unknown`、`workspace-result-mismatch`与`workspace-invalid-response`均保留原safe code和固定Worktree Unit inspect-before-retry guidance，任何未确认outcome均不重放；caller late confirmed create/publication=`ABORTED`，owner-only confirmed success可见。Cordis tests覆盖response mismatch/invalid-after-dispatch no replay并植入credential/cookie/license/UnitData/bytes/temp/native cause/rejected-args sentinels，断言仅DSH-owned Native/Code Mode argument records可保留caller args，dispose后无tool/listener/body/request/worker/temp/Job/retry。

## 7. 固定 native、worker 与 installed ToolRuntime closure

- [x] 7.1 扩展manifest/build/`package:verify`，从installed Client Core dependency graph解析exact `@univerjs-pro/exchange-node@1.0.0-beta.2` owner及其`@univerjs-pro/exchange-node-binding` npm version，externalize/copy/declare binding并复用Change 6 worker/`worker-child.mjs`；拒绝bare private Core、`workspace:*`、CLI source/daemon/Session、adjacent checkout fallback和later resources。扩展隔离tarball `package:smoke`，在unrelated cwd用real ToolRuntime、real native XLSX round trip、strict Doc/Slide fixtures、keyless fake Workspace/Collaboration覆盖两tools、policy/approval/actual-source budgets、revision race、create `workspace-result-unknown`/`workspace-result-mismatch`/`workspace-invalid-response` no replay、atomic/no-clobber/force、caller/owner abort、sentinel transcript、cleanup/dispose，并运行DSH app `build`/`package:verify`/`package:smoke`。

## 8. 更新职责文档并运行 compatibility gates

- [x] 8.1 更新 `apps/dsh-univer-work/README.md` 与 `packages/client-core/README.md`，记录两个tool names、exact formats（明确CSV不支持）、Worktree-local create/Worktree-head export、50 MiB/64-depth actual-byte source gate、local path/file policy、single approval、exact revision、atomic force、signal及create dispatch后all non-confirmed inspect/no-replay语义与非职责；依次运行Client Core `typecheck`/`test`/`build`、DSH app `typecheck`/`test`/`build`/`package:verify`/`package:smoke`、`pnpm --filter univer-workspace-cli test -- workspace-unit-exchange.test.ts application-command-contracts.test.ts`、`pnpm package:workspace-cli`、`pnpm typecheck`、`pnpm test`、`pnpm build`和`git diff --check`，确认CLI Office commands/results/daemon/package、Server/OpenAPI、SDK baseline、release与deployment不变。
