# verify-dsh-workspace-cli-parity QA

状态：**PASS；7/7 tasks；0 open findings；READY TO ARCHIVE**

范围：独立验证 OpenSpec `verify-dsh-workspace-cli-parity` 的 proposal、design、delta spec、7 项任务、
applicable CONTEXT/ADR、十二个 owner contracts、frozen Workspace CLI source、production DSH registries、
actual packed/installed artifact、Native/Agent Loop/Code Mode、README projection 与全仓收敛 gates。本 QA
只新增本报告；未修改产品、tests、tasks、planning、review，未 commit、push 或 archive。

冻结基线：Workspace `a01adf28bfdfbf098ecf66653d520d08ecac4117`；Univer SDK
`1.0.0-beta.2`；DeepSeek Harness `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

## Findings ledger

| ID | Severity | Initial evidence | Resolution and independent verification | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| WT-PARITY-QA-001 | High | 初次独立 `package:verify` 得到 live pack `12,945,659 / 57,929,107 / 123`，README 仍写 `12,945,647 / 57,929,102 / 123`；README 也没有从 parity authority 生成或受 verifier 校验，manifest、owner rows、counts、budgets、execution world 与 non-goals 可静默漂移。 | README 现含唯一 `parity-manifest-projection` block；verifier从同一 `PARITY_MANIFEST` 渲染 exact baseline、13 rows、42/8、三个固定 budgets、named frozen evidence、local-only boundary和 non-goals。`--docs-only` 执行 baseline/owner/catalog/budget/measurement/execution-world/non-goals 七类负例；每类 mutation均被 exact projection comparison拒绝。正常路径复用一次 actual dry-pack inspection。冻结证据明确命名为 `task7-final-before-doc-projection-gate`；live gzip bytes不与包含自身数字的 README做 equality。独立 `node --check`、`--docs-only`、full `package:verify`均通过。修复后的 live pack为 `12,945,706 / 57,929,255 / 123`，仍由固定 `16,777,216 / 67,108,864 / 256` 上限约束。 | parity Task 7 / docs + package verifier | **CLOSED / VERIFIED** |

## Task / contract matrix

| Task | Independent evidence | Result |
| --- | --- | --- |
| 1.1 frozen CLI manifest | 从 frozen/current production `createProgram()` 独立遍历 Commander tree，得到 **67 commands / 31 positional arguments / 158 options**。每个 route、arg、option与 manifest exact set一致；四处差异仅是 manifest把 presentation `--json`后置，sorted comparison为零差异。`git diff --name-only a01adf28... -- apps/cli/src`为空。manifest将每行分类到 product outcome、DSH-native mechanism或 presentation evidence，并绑定十二个 owner、acceptance case、42 tools/eight Skills。omitted/unclassified/unknown-or-duplicate owner/operation/Skill/case/test-owned implementation负例均 fail closed。 | PASS |
| 2.1 production catalog | 真实 production plugin在空 project/user Skill roots下 mount；canonical snapshot恰为 **42 tools / 8 Skills**。独立解析 snapshot得到69个 parameter object nodes与259个 output object nodes，全部 `additionalProperties:false`；tool descriptions非空，Skills均为 `provider: runtime`、`source: bundled`、Native/Code invocation开启。focused gate对42项逐一用 canonical valid args及额外 own key穿过真实 `tools/pre-execute`，unexpected key在 approval、credential、HTTP、heavy runtime与文件 effect前拒绝；missing/extra/renamed/duplicate/open-output/shadow Skill及dispose 0/0负例通过。 | PASS |
| 3.1 real Native / Code outcomes | actual tarball smoke在fresh profile、unrelated cwd、`NODE_PATH`为空、scripts disabled及explicit installed Chrome下运行。仅隔离 loopback Workspace/Collaboration/credential/approval/HTTPS authorities；LocalFS、public parsers/Core boundaries、worker/runtime child、Office native binding、Typst/SVG compilers、render page/browser、datasets/assets/Skills均取真实 installed closure。Native和真实Agent Loop、CodeRuntime dispatch覆盖manifest的13个 outcome ids，返回canonical value/read-back/identity；未解析 `apps/cli/src`、private Core source/dist或相邻 checkout。 | PASS |
| 4.1 indexed safety | manifest对authentication、space-node、worktree-unit、file-transfer、content、Office、Typst、SVG、Render、resource-discovery十个适用 outcome绑定owner source case和installed Native/Code case。维度按owner适用范围包括approval、allowlisted/unlisted failure、caller/owner cancellation、result-unknown/no-replay、confirmed partial file、secret sentinel与non-local。独立运行全部owner focused/full suites及installed smoke；approval前closed validation、denial零effect、late/uncertain/partial projection、secret-negative、local execution-world和accepted body drain保持owner contract。 | PASS |
| 5.1 package closure and budgets | verifier从manifest/Host/worker entries遍历exact ESM、dynamic ESM、CJS、`require.resolve`、`new URL`、Worker及显式native/browser/dataset/Skill resources；拒绝missing/unknown、remote/absolute/source/test/source-map/checkout/CLI/private Core fallback。actual closure恰为123 files，只有declared exact externals与必要resource classes。独立负例确认packed `16,777,216` exact / `+1` reject、unpacked `67,108,864` exact / `+1` reject、entries `256` exact / `257` reject；verifier只报告live measurement和largest entries，不改写budget、allowlist、snapshot或README evidence。 | PASS |
| 6.1 exact installed tarball and lifecycle | smoke build一次、pack一次并在install前后校验同一tgz SHA-256。隔离 profile执行三次 in-process activate/use/dispose：每次42/8，随后0/0；cycle 1/2后owner GrantRecord保留，cycle 3只有approved logout删除。credential mutations、requests、workers、browser、handles、listeners、timers与临时输出均drain。fresh Host单独启动、ready并在normal SIGTERM deadline内code 0退出。 | PASS |
| 7.1 docs and repository readiness | README受同一manifest投影gate约束，准确记录frozen baseline、13 owner rows、42/8、固定budgets、named frozen measurement、local-only execution world与CLI-only replacement/non-goals。parity实现未修改 `apps/cli/src`、CLI manifest/release workflow、`.github`、Workspace product/OpenAPI/database/deployment或SDK baseline；当前 Workspace侧dirty path仅domain `CONTEXT.md`，其余大范围dirty files属于十二个prerequisite Changes。Core、DSH、CLI、root gates、OpenSpec strict/global validation和diffcheck均通过。 | PASS |

## Independent command evidence

| Gate | Observed result |
| --- | --- |
| independent Commander probe against production `createProgram()` | **PASS**：67 commands、31 args、158 options；manifest set difference 0。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/parity-manifest.test.ts test/parity-catalog.test.ts` | **PASS**：2 files / 6 tests。 |
| `pnpm --filter dsh-univer-work typecheck` | **PASS**。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：14 files / 623 tests。 |
| `node --check apps/dsh-univer-work/scripts/verify-package.mjs` | **PASS**。 |
| `node apps/dsh-univer-work/scripts/verify-package.mjs --docs-only` | **PASS**：exact projection及七类drift negatives。 |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**：fresh build、actual dry pack、123-entry closure；live `12,945,706 / 57,929,255 / 123`。 |
| `UNIVER_RENDER_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm --filter dsh-univer-work package:smoke` | **PASS**：`dsh web` ready；exact installed tarball、Native/Agent Loop/Code、13 outcomes、3-cycle/fresh Host、logout-only GrantRecord removal及cleanup matrix。 |
| Client Core `typecheck` / `test` / `build` | **PASS**：full test 28 files / 635 tests。 |
| Workspace CLI `test` | **PASS**：package artifact 13 tests；Vitest 14 files / 69 tests。 |
| `pnpm package:workspace-cli` / CLI `package:verify` | **PASS**：203 files，packed `13,038,431`，unpacked `58,168,319`。 |
| explicit-Chrome CLI `package:smoke` | **PASS**：installed tarball commands passed。 |
| root `pnpm typecheck` | **PASS**：5 projects；OpenAPI lint/routes generation通过。 |
| root `pnpm test` | **PASS**：SDK dependency 4、release 8、reference provider 16、Core 635、Workspace 152、CLI 69 + artifact 13、DSH 623。 |
| root `pnpm build` | **PASS**：reference provider、Core、CLI、DSH、Workspace及OpenAPI/web/server builds。 |
| `openspec validate verify-dsh-workspace-cli-parity --strict` | **PASS**。 |
| `openspec validate --all --strict` | **PASS**：23 changes、0 failures。 |
| `git diff --check` | **PASS**。 |
| `openspec status` / `instructions apply` | **PASS**：planning complete；7 complete、0 remaining、`all_done`。 |

## Artifact and hygiene audit

- Frozen named package evidence：`task7-final-before-doc-projection-gate` = packed `12,945,659`、
  unpacked `57,929,107`、entries `123`。这是命名运行证据，不是对当前README gzip bytes的循环等式。
- Current live evidence after docs projection：packed `12,945,706`、unpacked `57,929,255`、entries `123`；
  三项均低于固定上限，verifier没有自动调整上限。
- Smoke结束及全仓gates结束后，`/tmp`与`/private/var/folders`中匹配
  `dsh-univer-work-smoke-*`、`dsh-univer-work-run-*`、`dsh-parity-*`、
  `dsh-univer-work-pack-*` 的目录为0；匹配 smoke/worker/render-page 的存活进程为0。
- 最终 source coordinates：README `31c847e451b3c096d8b56dc559daf0a6560d8273`；
  verifier `284ab640524e469bcadec4a21fb4e296214b6b85`；smoke
  `e23046df62448d09dff509321a27fb3c676fb306`；manifest
  `e566fd997309c8938bd0822cda755db0c9cb7ea2`；manifest test
  `5b31e9fc02042dea74dee7e636e25c1759e91c05`；catalog test
  `bfbc415773f9ff4b820e5cf50a8f5d26fa6054f1`；registry snapshot
  `e032a6b85a35f1fc3b286de0061409bb12ea681e`；built Host
  `576db4ffe3e0a4921b136ad681b3cfcc0233752c`。
- 最终 planning coordinates：proposal `461c9fc0a388be144aab65c512667b0eddc31ce4`；design
  `f58974f931f863da1f152803aaf7d78bc10366c7`；tasks
  `6730d07397ace1b1d3a28a724d0c5ba9bbd70d50`；delta spec
  `a6a267d95164276bb49d99a73fd380a8893acfe6`；`change.html`
  `abae80497f738ccb15c9284e63ff7c09129f346b`。

## Final assessment

唯一独立发现 `WT-PARITY-QA-001` 已在稳定树上关闭并复验。frozen CLI inventory、production
42/8 registry、十类safety index、13-outcome real Native/Code boundary、fixed package budgets、exact installed
tarball lifecycle、README projection、scope、全仓gates与cleanup均有独立证据。当前 Change **PASS / READY TO ARCHIVE**。
