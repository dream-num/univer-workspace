# verify-dsh-workspace-cli-parity review

状态：**PASS / READY TO ARCHIVE；Standards 0 open，Spec 0 open**

本报告只审查 OpenSpec change `verify-dsh-workspace-cli-parity`。实现是未提交 WIP，因此 review
没有使用 `HEAD` 三点 diff：固定起点为
`a01adf28bfdfbf098ecf66653d520d08ecac4117`，tracked 与 parity 相关 untracked 文件组成的冻结
endpoint tree 为 `7227d91ab1010433c1cfb39229a8bd0c0344789e`。审查范围限于 parity manifest、catalog/manifest
tests 与 snapshot、package verifier/smoke、README、package 配置中本 Change 的部分、planning 和 QA
报告。十二个 prerequisite owner 的实现只用于核实引用，不重新计为 parity findings。

## Review method

按 `mattpocock-skills:code-review` 同时运行两个独立 axis：

- Standards：根 `AGENTS.md`、根及 app README、app package/test/script patterns、
  `apps/workspace/CONTEXT.md`、ADR 0007，以及完整 Fowler smell baseline。
- Spec：proposal、design、tasks、delta spec、change visual 与独立 QA 报告。

两个 axis 的 findings 分开保留，不跨轴重排。QA finding `WT-PARITY-QA-001` 的 README projection
修复保持 **CLOSED / VERIFIED**；它不覆盖下列 false-pass。

## Standards

### PARITY-STD-001 — medium — 跨 application 导入 CLI 内部源码

- Axis：Standards；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/test/parity-manifest.test.ts:276-320`，具体 import 在 283 行。
- 依据：根 `AGENTS.md:140-141` 要求保持应用模块依赖方向，不跨 package 导入 `src` 或 `dist`
  内部路径；delta spec 的 fixture-boundary scenario 也把 `apps/cli/src/*` 列为无效证据。
- Evidence：`readFrozenCommanderSurface()` 通过 `pnpm --filter univer-workspace-cli exec tsx --eval`
  直接执行 `import { createProgram } from "./src/program.ts"`。该 gate 依赖另一个 application 的内部
  module 与构造参数；CLI 内部重构会破坏 DSH parity test。
- 影响：当前 frozen-inventory 证据违反仓库依赖边界，也与 Change 自己拒绝 checkout-only CLI source
  import 的规则冲突。
- 最小修复：从 CLI-owned supported executable/artifact boundary 读取 production inventory，或使用经
  CLI owner 固定并校验的 checked inventory；删除跨 application `src` import，不新增第二套 Commander。

非阻断简化建议：`parity-catalog.test.ts:88,314` 的 `probeArguments(..., cwd)` 只以 `void cwd`
消音，可直接删除参数。该处不影响合同，未单列 finding。

## Spec

### PARITY-SP-001 — high — safety index 只扫描源码文本，不选择可执行 case

- Axis：Spec；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/src/parity-manifest.ts:62-87,205-271`；
  `apps/dsh-univer-work/test/parity-manifest.test.ts:107-135`。
- 依据：delta spec `Cross-cutting safety contracts remain observable`（81-105 行）要求 manifest 为每个
  适用行为选择一个通过 final DSH boundary 的 executable case；Task 4.1 要求运行 indexed Native/Code
  suite，并在缺失或语义漂移时 fail closed。
- Evidence：acceptance case 只记录 source file。validator 对 owner test 整个文件应用宽泛关键词 regex，
  对 installed smoke 只搜索 `["<outcome>",` 字符串。删除具体断言、把测试改成 `it.skip`，或由同文件
  另一测试保留关键词，gate 仍可通过。
- 影响：报告可声称 approval、failure、cancellation、result-unknown、partial、secrecy 或 non-local 已执行，
  实际对应 case 已停止运行或丢失语义。
- 最小修复：让 manifest case identity 对应 runner 实际执行并输出的 exact case-id/dimension/Native-Code
  ledger，再由 parity gate 精确核对；避免另造 owner 行为实现。

### PARITY-SP-002 — high — validator 不锁定 owner mapping 与 frozen result forms

- Axis：Spec；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/test/parity-manifest.test.ts:172-268`。
- 依据：delta spec `Frozen outcome baseline is complete and executable`（7-28 行）及 Task 1.1 要求每个
  product row 对应一个确切 owner、该 owner 的 accepted operation/Skill，并穷尽 production CLI 的
  command、argument、option 与 result form。
- Evidence：validator 只比较十二个 owner 的集合和全局 42-tool/8-Skill 集合。它没有校验
  owner-to-operation/Skill 或 frozen outcome-to-owner mapping；把 authentication operation/case 改挂另一
  合法 owner 并同步引用仍可通过。CLI route 的 `results`/`presentations` 也只检查非空，任意非空文本不会
  触发 drift。
- 影响：全局 counts 保持不变时，权责错挂或 output-form 漂移可静默进入 checked manifest 与 README。
- 最小修复：增加 frozen owner→outcome→operation/Skill exact map，并将 result/presentation forms 与
  CLI-owned checked evidence 精确比较；为跨 owner 错挂与 result drift 增加负例。

### PARITY-SP-003 — medium — allow path 只覆盖一个 consequential tool

- Axis：Spec；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/test/parity-catalog.test.ts:81-147`。
- 依据：delta spec `Consequential classification is probed`（44-48 行）及 Task 2.1 要求每个
  consequential/non-consequential tool 通过真实 `tools/pre-execute` 的 invalid/ask/deny/allow 或 delegation
  路径。
- Evidence：rejected fixture 对 42 tools 逐项执行 invalid 与 valid deny/delegate；`allowed-once` fixture
  只调用 `workspace_node_create`。其余 required/conditional tools 的 allow 分支没有被 parity catalog gate
  触发。
- 影响：某个 consequential tool 若在 allowance 后错误地再次拒绝、跳过 accepted pre-execute 链或错误
  分类，当前 gate 仍可能通过。
- 最小修复：参数化全部 required/conditional tools 的 `allowed-once` probe，断言一次 ask 且执行进入既有
  deterministic dependency sentinel；继续使用真实 ToolRuntime，不需要实现 owner operation fixture。

## Follow-up 1 — endpoint `8f171d37c116ed66f081f277317f538cfb6fdafa`

实现方按首轮四项 findings 回修后，review 从旧 endpoint `7227d91ab1010433c1cfb39229a8bd0c0344789e`
重新冻结 tracked 与 untracked WIP，并再次并行运行 Standards / Spec。以下状态覆盖本节之前的首轮
状态，同时保留原始 finding 证据。

### PARITY-STD-001 — CLOSED

- Axis：Standards；原 severity：medium；状态：**CLOSED**。
- Closure evidence：`parity-manifest.test.ts:322-335` 只执行 CLI owner 提供的
  `inspect:command-surface` script；`apps/cli/scripts/inspect-command-surface.ts:1-35` 在 CLI application
  内部读取 production `createProgram()`。DSH parity test 不再跨 application import `src`/`dist`。
- Scope evidence：CLI package artifact 的 fixed file list 不包含 `scripts`；`apps/cli/src` 与 release
  workflow 无 parity diff。该命令只供 workspace validation 使用，不进入安装包、不增加 Commander surface。

### PARITY-STD-002 — low — frozen diff-check 失败

- Axis：Standards；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/test/fixtures/parity-accepted-surface.json:1067`。
- Evidence：冻结 closure 上运行 path-limited `git diff --check 7227d91... 8f171d37...` 返回
  `new blank line at EOF`。
- 影响：Task 7 明确要求的 diff-check gate 未通过；其余测试通过不能替代该 repository hygiene gate。
- 最小修复：删除 JSON 末尾额外空行，只保留一个终止换行。

### PARITY-SP-001 — high — 26-case ledger 仍未证明 safety dimensions

- Axis：Spec；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs:807-813,3393-3414,3767-3796`；后续安全断言
  位于 `3807-3881,3883-3978`。
- Evidence：runner fixture 与 completion ledger 只携带 `id/outcome/owner/mode`，不携带 dimension。
  `completeParityCase()` 在 representative outcome success 后立即记录；exact 26-case set 在 3796 行完成，
  早于 secret transcript、owner disposal/cancellation、cleanup 与 persistent GrantRecord assertions。删除或
  skip 后续安全断言仍不影响 26-case ledger。
- 影响：manifest 可把 approval、failure、cancellation、result-unknown、partial、secrecy、non-local 等
  dimensions 全部挂到一个只证明 representative success 的 case，继续形成 Task 4.1 false-pass。
- 最小修复：在所有适用维度的 actual assertions 完成后输出并精确比较
  `{id,outcome,owner,mode,dimensions}` ledger；增加 wrong-dimension 与 record-before-assert 负例。

### PARITY-SP-002 — high — Skill ownership 未进入 independent evidence

- Axis：Spec；状态：**OPEN（部分关闭）**。
- 已关闭：独立 `parity-accepted-surface.json` 已锁定 42 个 operation→outcome→owner、13 个
  outcome→owner、26 个 runner case 和 67 条 CLI result/presentation forms；对应错挂/drift 负例通过。
- 剩余位置：`apps/dsh-univer-work/test/parity-manifest.test.ts:139-143,219-220,289-309`；fixture 未包含
  Skill mapping。
- Evidence：validator 对 Skills 仍只比较全局八项集合。把 `core` 与 `base` 在 `worktree-unit`、
  `unit-topic-skills` 两个合法 outcome/owner 之间交换，八项集合、outcome owner evidence 与 runner cases
  均不变，gate 仍可通过。
- 影响：Task 1.1 要求的 exact operation/Skill surface ownership 仍可静默错挂。
- 最小修复：给独立 fixture 增加八条 `[skill,outcome,owner]` evidence，精确校验并增加跨 owner 交换负例。

### PARITY-SP-003 — CLOSED

- Axis：Spec；原 severity：medium；状态：**CLOSED**。
- Closure evidence：`parity-catalog.test.ts:131-159,317-352` 遍历全部 25 个 required/conditional tools；
  每项通过 real `tools/pre-execute` 获得 exact-one `allowed-once` ask，并进入 dependency/file sentinel。
  `workspace_svg_compile` 的 probe 参数触发 conditional approval；non-consequential tools 保持 delegation。
- Focused regression：2 files / 6 tests PASS。

## Follow-up 2 — endpoint `1e2c1252a5321ee98f686555e925cb5d0f645848`

第二轮回修相对 `8f171d37c116ed66f081f277317f538cfb6fdafa` 只改变 installed smoke、
independent evidence fixture、manifest validator test 与本报告。两个 code-review axis 再次并行运行。

### Standards — PASS，0 open

- `PARITY-STD-001` 保持 **CLOSED**：DSH parity test 仍只调用 CLI-owned inspector；inspector 不进入
  CLI artifact，Commander、release 与 `apps/cli/src` production contract 无 diff。
- `PARITY-STD-002` **CLOSED**：`parity-accepted-surface.json` 只保留正常终止换行；旧 endpoint→新
  endpoint 及 baseline→新 endpoint 的 scope diff-check 均通过。
- 158 条 case-dimension pairs 是 Task 4.1 要求的 data oracle；一个 ledger 与一个 assertion dispatch
  没有复制 owner 行为，也没有形成需单列的 Fowler smell。

### PARITY-SP-001 — high — exact keys 仍复用跨 case 的全局证据

- Axis：Spec；状态：**OPEN**。
- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs:4040-4117`。
- 已关闭：fixture 与 manifest validator 精确锁定 158 个唯一 `[caseId,dimension]`，其中 Native/Code
  各 79；completion helper 在 assertion 成功后记录，duplicate/unexpected/missing key fail closed；最终
  exact-set check 位于 safety 与三轮 lifecycle assertions 之后。
- 剩余 evidence：循环没有按 `caseId` 的 outcome/mode 选择对应 observation。approval 合并
  `approvalRequests`、`codeApprovals`、SVG 与 Typst approval；allowlisted/unlisted/caller/result-unknown/
  partial 等维度对同一个 `finalSafetyProjection` 做全局 regex；secret 与 non-local 也复用跨 outcome/mode
  projection。一个 Native 或其他 outcome 的结果因此可为所有同名 Code/owner dimension 记账。
- 影响：删除某个 Code outcome 的安全断言或让该 outcome 的语义漂移，另一 mode/outcome 的证据仍可使
  对应 key 进入 completed set；Task 4.1 继续 false-pass。
- 最小修复：在每个实际 final-boundary assertion 成功处写入按
  `caseId/mode/outcome/dimension` 区分的 observation；最终仍只比较 expected/completed exact key set。
  增加删除某一 outcome/mode 具体 observation 后缺 key 的负例。

### PARITY-SP-002 — CLOSED

- Axis：Spec；状态：**CLOSED**。
- Closure evidence：independent fixture 现精确包含八条 `[skill,outcome,owner]`；validator 比较完整
  mapping，`core`/`base` 在两个合法 owner 间交换的负例被 `accepted Skill owner evidence differs` 拒绝。

### PARITY-SP-003 — CLOSED / no regression

25 个 consequential tools 的 real `allowed-once` exact ask/body entry matrix 保持通过；CLI inspector、
README projection 与 package boundary 无回归。

## Follow-up 3 — endpoint `c1d7e3ae252b27a486056ae09ec1a9b80b844d5b`

第三轮删除 installed smoke 中会跨 outcome/mode 借证的全局 158-key ledger，改由 Vitest reporter 消费
完整 source suite 的 actual case results。两个 axis 按 Requirement、Design Decision 2 与 Task 4 的组合
语义复审；Design 允许复用 prerequisite owner cases，并只要求每个适用 dimension 至少一个 final-boundary
case，因此不要求凭空制造另外 62 个 Code Mode owner scenarios。

### Standards — PASS，0 open

- `PARITY-STD-001`、`PARITY-STD-002` 保持 **CLOSED**。
- `parity-safety-reporter.mjs` 只在 source `pnpm test` 的显式环境开关下校验，不进入 123-entry package
  artifact。96 rows 是 data oracle，没有复制 owner 行为或引入新的 production hook。
- 完整 app test 通过：14 files / 624 tests；双 typecheck、reporter/smoke syntax、dry-pack closure 与两段
  diff-check 均通过。

### PARITY-SP-001 — high — reporter 可用，但两条 evidence identity 语义错绑

- Axis：Spec；状态：**OPEN / residual**。
- 已关闭：reporter 用 exact `[relativeModuleId,fullName]` 读取 Vitest 的实际 pass/skip/fail state；96 rows
  对应 79 个 test identities、Native 79 rows、Code 17 rows，跨 case identity 复用为 0。missing、skip、
  Native/Code substitution、cross-outcome result-unknown/partial/approval negatives 均 fail closed。每个 owner
  的 applicable dimension union 仍由 manifest validator 锁定。
- 错绑一：`parity-accepted-surface.json:746-749` 把 `render.installed.native:non-local` 指向
  `render-tools.test.ts:361-371` 的本地 layout-lint success。该 test 返回 `isError:false`，不构造 non-local
  provider。真正 evidence 在同文件 `78-101`：undefined sandbox provider 返回
  `workspace-local-filesystem-required`，且 approval/processPath 为零。
- 错绑二：fixture `944-947` 把 `typst.installed.native:allowlisted-failure` 指向
  `typst-tools.test.ts:722-743` 的 compile diagnostics success；结果为 `isError:false, committed:false`，没有
  allowlisted failure。现有 `421-495` 的 uncertain-create test 才断言 allowlisted
  `workspace-result-unknown`、identity、no-replay 与 secrecy。
- 影响：两个无关但 passing 的 tests 会让 reporter 错误确认 Render non-local 与 Typst allowlisted failure
  已执行，仍违反 delta spec 81-105、Design Decision 2 和 Task 4.1 的 executable case 要求。
- 最小修复：只把这两条 fixture `fullName` 改为上述真实 owner tests，并加入针对两条错误 identity 的
  mutation regression；不新增 owner test、Code case 或 production abstraction。

### Other findings — CLOSED / no regression

`PARITY-SP-002`、`PARITY-SP-003` 保持 **CLOSED**；CLI inspector、Skill ownership、25-tool allowance、
README projection、package boundary 与 lifecycle evidence 无回归。

## Follow-up 4 — endpoint `74f8e71f35dcdc343f7e14b36c1cd6a17f14401e`

第四轮只修正两条 safety evidence identity 并增加对应语义错绑负例。Standards 与 Spec axis 在新冻结
endpoint 上再次并行复审。

### Standards — PASS，0 open

- `PARITY-STD-001`、`PARITY-STD-002` 保持 **CLOSED**；CLI-owned inspector、package boundary、EOF 与
  diff-check 无回归。
- 两条 fixture identity 修正和四个定向 mutation cases 只收紧 test oracle，没有增加 production hook、
  跨 package source import 或新的 Fowler smell。reporter、Vitest config 与 package script 没有本轮改动。

### PARITY-SP-001 — CLOSED

- Axis：Spec；原 severity：high；状态：**CLOSED**。
- Render non-local row 现绑定 `Workspace render closed contracts > orders screenshot preflight as policy,
  local proof, pure arguments, then Session containment`。该 owner test 构造缺少 local-filesystem sandbox
  的请求，断言 exact `workspace-local-filesystem-required`，并确认 approval 与 process invocation 均为零。
- Typst allowlisted-failure row 现绑定 `Workspace Typst real ToolRuntime > preserves uncertain-create identity
  and guidance without dependency secrets`。Typst owner spec 明确把 Unit create 的
  `workspace-result-unknown` 列入 allowlist；该 test 断言 exact code、稳定 idempotency identity、三次请求
  identity 一致、`workspace_unit_list` recovery guidance、禁止 replay、secret-negative 与 apply-once。
- `REQUIRED_SAFETY_TEST_IDENTITIES` 冻结上述两个 exact identities。两个 mutation 分别换回旧的
  passing-but-semantically-wrong Render local-success 与 Typst diagnostics-success tests，validator 均以
  `required safety test identity differs` fail closed。
- Reporter 继续从 full Vitest run 的 actual results 精确 join 96 rows：19 cases、78 个 exact test
  identities、Native 79 rows、Code 17 rows，跨 case identity 复用为 0；missing、skip、fail 都使 suite
  失败。
- Requirement 的每个 outcome Native/Code representative success 与 Design Decision 2 的 prerequisite
  final-boundary dimension evidence 是两项组合约束。后者要求每个 applicable dimension 至少选择一个真实
  owner case，并未要求每个 dimension 在两种 mode 各复制一次。因此无需制造不存在的另外 62 个 Code
  owner rows；这不是 predecessor evidence gap。

### Other findings — CLOSED / no regression

`PARITY-SP-002`、`PARITY-SP-003` 保持 **CLOSED**。独立 fixture 继续锁定 42 operations、8 Skills、
13 outcomes、26 runner cases 与 67 result/presentation rows；25 个 consequential tools 仍逐项执行真实
allowed-once exact ask/body sentinel。

## Independent gate evidence

| Gate | Result |
| --- | --- |
| focused `parity-manifest` + `parity-catalog` | PASS：2 files / 7 tests |
| full `pnpm --filter dsh-univer-work test`（含 parity safety reporter） | PASS：14 files / 624 tests |
| app dual TypeScript typecheck | PASS |
| verifier/smoke `node --check` | PASS |
| `verify-package.mjs --docs-only` | PASS |
| full `pnpm --filter dsh-univer-work package:verify` | PASS：123 entries；packed `12,945,706`；unpacked `57,929,255` |
| OpenSpec strict | PASS |
| frozen path-limited `git diff --check` | PASS |

最终双轴结论为 **Standards PASS / Spec PASS**，0 open findings。当前 Change 为
**PASS / READY TO ARCHIVE**；本 review 不执行 archive。
