# add-dsh-space-node-tools code review

本报告记录 Change `add-dsh-space-node-tools` 的独立代码审查。逻辑基线是 Plugin Shell 与
Authentication 已验收状态；审查只覆盖 Space/Node 新增或修改的行为，不把前置 Change 的历史
diff 计入 finding。实现、QA 与 review 由相互独立的 subagent 执行。

## 审查依据

- `openspec/changes/add-dsh-space-node-tools/` 的 proposal、design、tasks 与两份 delta spec。
- `apps/workspace/CONTEXT.md`、`apps/workspace/docs/data-model.md`、ADR-0001/0002/0007 与两份 DSH
  研究记录。
- 已验收的 Authentication owner/resolver，以及 Workspace Client Core Space/HTTP/error owner。
- DeepSeek Harness `0.1.1-rc.2` commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的 ToolRuntime、approval、finalizer、Session 与
  cancellation 合同。

## 审查范围

- Spec/correctness：七个稳定 tools、closed parameter/output schema、canonical output 与 value-only render。
- Approval/security：四个 mutation 的 policy/body 同源 validation、fail-closed approval、credential/error
  non-reflection。
- Reliability：error code/detail allowlist、mutation read-back、late success、result-unknown 与 no-replay。
- Cancellation/lifecycle：Client Core optional signal、caller/owner 分类、accepted body drain 与 dispose。
- Packaging/Agent seam：packed Client Core closure、真实 ToolRuntime/Code Mode/Agent 可发现和可执行。
- Ponytail：复用 Core/auth owner，不增加通用 action、重复 transport、单实现 service 或后续能力 scaffolding。

## Findings

### REV-SN-01：read body 在 abort 后晚到成功时返回 success，而不是来源相关 failure

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/src/space-node.ts:568-574`
- Evidence：`executeOwned()` 只在调用 `body()` 前执行一次 `owned.signal.throwIfAborted()`，随后直接
  `return await body(...)`。若 credential provider 或 fetcher 已收到 signal 但仍在 caller abort/owner
  disposal 后 resolve 成功，read operation 不进入 catch，因此 caller 路径由 ToolRuntime 改写为通用
  `ABORTED`，owner-only disposal 路径甚至返回成功。Design/Spec 要求已接受的 list/browse/find 在 caller
  abort 后得到 `workspace-operation-cancelled`，owner abort 后得到 `workspace-plugin-disposing`，且不能返回
  partial/late success。当前 Core/Authentication 前置评审已经明确把“不遵守 abort 但晚到 resolve”的
  dependency 当作必须关闭的 race；只依赖 fetch 通常 reject 不足以证明该合同。
- 最小修复：保存 read body 的 result；在返回它之前按 owner 优先、caller 次之再次检查两个 source
  signals，并抛现有 `disposing(operation)` / `cancelled(operation)`。该 post-body check 只用于 `kind ===
  "read"`；mutation 必须继续让 caller-aborted confirmed success 返回 ToolRuntime，以得到 registry-owned
  `ABORTED`，同时允许 owner-only confirmed success。增加 resolver/fetch 忽略 abort 后 resolve 的 caller/
  owner read table，断言 stable code、无 canonical success，且 disposer 等待 body settle。
- Closure：`executeOwned()` 现在在 read body resolve 后按 owner、caller 顺序复查 source signal；focused
  race table 使用 body-entry barrier 覆盖 caller abort 与 owner dispose，均返回对应 stable failure，且未泄露
  canonical success。`pnpm --filter dsh-univer-work typecheck` 与 focused 21/21 tests 通过。

### REV-SN-02：shared owner 为每次调用注册两个无行为 abort listeners，且当前无法 typecheck

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/src/tool-owner.ts:24-34`
- Evidence：`releaseSource` 始终返回 `undefined`，两个 `addEventListener("abort", releaseSource)` 不传播
  signal、不释放资源，也不参与 `AbortSignal.any()`；finally 再移除它们只是在维护无功能状态。它不能证明
  native `AbortSignal.any()` 的内部依赖已清理，并给每个 auth/Space/Node body 增加两次无意义注册。当前
  `sources as const` 还导致 `AbortSignal.any(sources)` 违反 TypeScript 的 mutable-array signature；独立执行
  `pnpm --filter dsh-univer-work typecheck` 在 line 31 报 TS2345 并 exit 2。
- 最小修复：删除 `sources`、`releaseSource` 和两组 add/remove 循环，直接使用
  `AbortSignal.any([exec.signal, this.controller.signal])`；active body promise 已完整承担 lifecycle drain，
  不需要为了测试可观察性增加 no-op listener。运行 DSH typecheck 与 owner/auth regression。
- Closure：无行为 listener 已删除，owner 直接组合 mutable signal array；DSH typecheck 通过，shared owner
  仍以 active promise set 承担 accepted-body drain。

### REV-SN-03：focused suite 的 assertions/fixtures 没有建立它声称验证的边界

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/test/space-node.test.ts:56-62,92-136,213-221,254-341`
- Evidence：独立执行 `pnpm --filter dsh-univer-work test` 得到 7 failures（67 pass）。其中 SDK
  negative scan 对整份 Harness SDK prose/output 扫 `/origin|action|.../`，必然命中合法 Trash 字段
  `originalLocation` 或 Harness 自身文字，不能证明 parameter surface；find fixture 在递归访问 child 时
  返回 root page metadata，导致合法 find 得到 invalid-response；allowlisted detail 在
  `JSON.stringify(result)` 后断言未转义 JSON 片段，和真实 deterministic envelope 不匹配。四条 cancellation/
  late-success tests 在 abort/dispose 前只执行 `waitFor(expect(true))` 或完全不等待 request/body entered，实测
  得到 `ABORTED_BEFORE_DISPATCH` / `UNKNOWN_TOOL`，因此没有覆盖 REV-SN-01、late mutation success 或 dispatched
  result-unknown 合同。
- 最小修复：只检查七个 schema 的 parameter property keys；让 recursive child fixture 返回匹配
  breadcrumbs/parentNode 的 child page；直接检查/解析 `result.error.message` 中的 envelope；每个 race 用一个
  request/resolver `entered` deferred，在它 resolve 后才 abort/dispose，再 release response。对 owner case 还要
  在 release 前断言 disposer 未 settle。重新运行整个 DSH suite，不能把重跑偶然 green 当 closure。
- Closure：negative scan 只比较 schema property keys；find child fixture、allowlisted detail assertion 与四条
  race 均已改用正确观察点和 body-entry barrier。独立重跑 focused suite 通过 21/21；最终全套结果仍由本报告
  后续 package/Agent 审查统一记录。

### REV-SN-04：validator 只检查 enumerable string keys，没有实现承诺的 exact own keys

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/src/space-node.ts:490-500`
- Evidence：validator 用 `Object.keys(value)` 枚举参数，所以 direct definition execution 传入 non-enumerable
  own key 或 symbol own key 时，该 key 对 policy/body 两层都不可见，参数会继续进入 resolver/HTTP。Task 2.1 和
  design 明确要求检查 `exact own keys`，且 direct execution 是本 Change 主动要求关闭的 seam。当前 lines
  494-499 的 length 分支又被 line 500 的同一 `some()` 条件完全覆盖，增加代码但没有补上该边界。
- 最小修复：把实际 key 读取改为 `Reflect.ownKeys(value)`，遇到非 string key 或未声明 string key 就抛现有
  `workspace-argument-invalid`；删除被后一个条件覆盖的 length 分支。增加一个 direct execution table，用
  `Object.defineProperty` 与 symbol 分别植入未知 own key，断言不访问 credential/HTTP。无需新增 schema helper
  或通用 validator abstraction。
- Closure：validator 现在比较 `Reflect.ownKeys()` 与 enumerable string keys，从而拒绝任何
  non-enumerable/symbol own key，同时保留单一 unknown-key condition；新增 direct mutation body test 对两种
  JSON-invisible key 断言固定 failure、credential/HTTP 0。独立 focused suite 通过 38/38。

### REV-SN-05：mutation policy 的普通对象查找会误匹配 Object prototype tool names

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/src/space-node.ts:462-466`
- Evidence：listener 用 `mutationNames[exec.name]` 判断是否属于四个 mutation，但 `mutationNames` 是带
  `Object.prototype` 的普通对象。合法的无关 tool name `constructor`、`toString`、`hasOwnProperty` 等会
  取得继承属性而不是 `undefined`；随后 validators map 也会取得继承方法，listener 最终返回 Workspace
  `ask`（或产生非预期异常），而不是 `next()`。这让 application-local policy 干扰其他 Host plugins，违反
  design/AC-12 的“只匹配四个 Node mutation，其他 tool 委托 next”。
- 最小修复：读取 map 前先用 `Object.hasOwn(mutationNames, exec.name)`；false 直接 `next()`，true 再以
  narrowed key 读取 operation/validator。增加一个名为 `constructor`（或 `toString`）的 benign tool，通过
  real ToolRuntime 在没有 approval service/agent 时执行成功，证明 listener 未拦截。无需新增 policy class、
  service 或通用 registry abstraction。
- Closure：listener 现以 `Object.hasOwn(mutationNames, exec.name)` 先关闭 inherited-key 查找，再读取
  narrowed map entry；real ToolRuntime 对 `constructor`、`toString`、`hasOwnProperty` 三个 benign tools
  均在无 approval/agent 时成功执行。独立 focused suite 通过 57/57。

### REV-SN-06：installed/Code Mode gate 没有穿过 mutation approval/body，也未形成要求的 Agent transcript

- Severity：high
- 状态：closed
- 位置：`apps/dsh-univer-work/test/space-node.test.ts:392-436`、
  `apps/dsh-univer-work/scripts/smoke-package.mjs:292-399,401-470`
- Evidence：source Code Mode 只 dispatch 带额外 `cookie` 的 `workspace_node_create`，它在 pre-ask
  validator 失败，因而没有经过 approval、credential、HTTP 或 canonical mutation output；这不能证明
  Task 6/design/AC-27 的 real Code Mode mutation seam。installed Agent adapter 只生成
  `workspace_space_list` 一个 call；browse/find 和任何专用 mutation 仍全部由 direct `ctx.tools.execute()`
  驱动，没有满足 real-Agent seam（AC-28）。脚本创建 `approvalSession`，但没有把 late `ABORTED` result 与
  browse/find/no-replay guidance 写入/汇总为 keyless transcript，也没有按三类 DSH-owned argument fields 的
  排除规则扫描 durable result/events。最后 normal re-registration 使用 dispose 前缓存的
  `spaceNodeSchemas` 数组断言 length 7，因此即使第二个 fiber 未重新注册 tools 也会通过。
- 最小修复：让 source Code Mode fixture 执行一个 allowed-once mutation，并核对 approval、canonical value
  及 start/settled name+subCallId；让 installed real Agent adapter 实际调度 list/browse/find 与一个专用
  mutation，并核对 durable call/results。把 installed invalid/error/late-ABORTED guidance、approval events 与
  Agent events 汇总成 keyless transcript，删除三类允许保留的 `arguments` 后做 sentinel/non-reflection
  assertions。正常重挂后用当前 `names()`/schema query 断言 11/7，再 dispose 并断言清空。继续复用现有
  fake Server/adapter，不增加 runtime abstraction 或持久 fixture 文件。
- Closure：Code Mode 现通过 real `run_code` 依次覆盖 invalid mutation、Space read 与 allowed-once create，
  并核对 approval、canonical value 及 start/settled name+subCallId；installed Agent Loop 实际调度
  list/browse/find/create 并持久化四组 call/result。smoke 汇总 approval/Agent events 与代表性结果，排除三类
  DSH-owned argument fields 后扫描 sentinel，并包含 late `ABORTED` browse/find/no-replay guidance；normal
  re-registration 改为查询当前 schemas。修正一次把 `run_code` value envelope 当数组的 test assertion 后，
  独立验证 DSH 112/112、`package:verify` 与隔离 `package:smoke` 全部通过。

### REV-SN-07：README 把 source Code Mode coverage 错写成 package smoke 行为

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/README.md:80-86`
- Evidence：README 说 `package:smoke` “exercises Native and Code Mode tool dispatch”，但
  `scripts/smoke-package.mjs` 没有加载 CodeRuntime、以 `mode: "code"` 安装 ToolRuntime 或调用
  `run_code`；真实 Code Mode coverage 位于 `test/space-node.test.ts`。安装态 smoke 覆盖 Native direct
  dispatch 与 Agent Loop，这两者均已通过。当前文字把 source 与 installed evidence 混为一个 gate。
- 最小修复：把句子改成 package smoke 覆盖 installed Native dispatch 与 real Agent Loop，并另句说明
  source tests 覆盖 real Code Mode dispatch；无需为了文案重复一套 installed CodeRuntime fixture。
- Closure：README 现准确区分 installed `package:smoke` 的 Native/Agent Loop coverage 与 source suite 的
  real Code Mode dispatch，未增加重复 fixture。

## 最终结论

**PASS，0 open findings。** 本轮共记录 7 个 findings（1 high、3 medium、3 low），均经原 repro 与相邻
回归复验关闭。Space `type` 按 delta spec/Core model 保持 optional；新增
regression 接受 omitted type，并在 render 前拒绝 invalid type 与 broadened field。

Ponytail 复核确认 Space/Node adapter 直接复用 `WorkspaceSpaceFeature`、Authentication resolver 与唯一
`WorkspaceToolOwner`；没有第二套 HTTP/parser、Cordis service、generic action、Job/timer、retry 或后续能力
scaffolding。新增 local schema fragments 对 closed canonical output 有直接用途，不建议再抽 generator。

独立运行并通过：

- Client Core `typecheck`、focused Space 18/18、全套 461/461、`build`。
- DSH `typecheck`、全套 112/112、`build`、packed `package:verify`、隔离 tarball `package:smoke`。
- Workspace CLI focused/package contract 69/69、`pnpm package:workspace-cli`。
- `openspec validate add-dsh-space-node-tools --strict` 与 `git diff --check`。

本结论覆盖 code review 的 source/package/docs/real-Agent seam；真实 Workspace `:3020` 演练和仓库全量
`pnpm typecheck/test/build` 由独立 QA/实现 gate 记录，不在本报告中伪报为已由 reviewer 执行。
