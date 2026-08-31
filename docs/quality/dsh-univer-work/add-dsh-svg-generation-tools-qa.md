# add-dsh-svg-generation-tools QA

状态：**PASS / READY TO ARCHIVE；8/8 tasks；0 open findings**

范围：独立验证 OpenSpec `add-dsh-svg-generation-tools` 的 proposal、design、两份 delta spec、8 项任务、
domain authority、Client Core SVG workflow、DSH Client Shell、actual packed/installed closure 与 CLI compatibility。
QA 只修改本报告；没有修改产品、tests、tasks、planning、review，没有 commit、push 或 archive。

最终核对坐标：Core SVG `a04d03a71bd7f62fa2c1e700334e24fc78f6a14c`，DSH SVG tools
`24c6663fa2c9e64766c721c8f6cdee6aa936a124`，Core tests
`962d3d09fda8af3ef0bac46cc57597334257f639`，DSH tests
`6cec79e9c8c4fdedef54ac5d56002567f3647a35`，proposal
`8209f2e2b112592ac886c4d9f317363a3730f491`，design
`40298b22e2ad8200e8f18df3174c0a3a0d95af6e`，tasks
`e7d85cf0826b41144d02922fb978491d9eafd3b9`，DSH delta spec
`3b116e59388ca1478564d8a7f3ae46f5e14ac2e5`，`change.html`
`8ab54d3f66361460d8357e93b75bfa4930f2ac31`。

## Findings ledger

| ID | Severity | Initial evidence | Final independent verification | Status |
| --- | --- | --- | --- | --- |
| WT-SVG-QA-001 | Medium / Warning | 初始 proposal 的 Domain Alignment 引用相邻 checkout 的绝对 CONTEXT/ADR 路径。 | proposal 现引用 repo-relative `apps/workspace/CONTEXT.md` 与 accepted ADR 0007，准确区分 DSH Client Shell 与 private Core；刷新后的 `change.html` 不再含旧 authority。 | **CLOSED / VERIFIED** |
| WT-SVG-QA-002 | Medium / Warning | 初始 packed-artifact scenario 把整个 artifact 写成不含 Office/Typst native assets，与必须保留的 predecessor closures 冲突。 | delta spec 与 checked Task 6.1 均把限制收窄到 SVG reachable graph 的新增资源，并明确既有 Office/Typst closure 继续独立验证。 | **CLOSED / VERIFIED** |
| WT-SVG-QA-003 | High | 初始 `remainingApplyValueBytes()` 只按 no-mutation envelope 预留固定 bytes；remote commit 后新增的 revision/status 可能使最终 canonical result 超限。SVG status 还接受任意 nonempty string。 | schema/validator 固定 status=`committed`；allowance 取 no-mutation 与最坏 committed envelope（safe-integer 最大 revision）的较大 fixed bytes。独立 DSH focused 的 exact 8 MiB committed boundary 与 +1 zero-commit regression 通过。 | **CLOSED / VERIFIED** |
| WT-SVG-QA-004 | High | 真实 FS barrier 在 source/root `realpath` 后把 source 换成 root 外 symlink；旧 reader 返回 SUCCESS，compiler 观察到 `OUTSIDE_SENTINEL`。 | reader 现执行 canonical target `lstat`、`O_NOFOLLOW` open、`fstat`、post-open `realpath`/root/dev/ino identity 检查。独立重跑同一窗口得到 `{"checks":4,"outcome":"workspace-svg-source-unavailable","observedOutside":false}`；source/asset replacement 与 stable-contained-symlink regressions均通过。probe 的两个临时目录已删除。 | **CLOSED / VERIFIED** |
| WT-SVG-QA-005 | High | 初始 output path 丢弃 body-time policy，`writeText` 未传第五个 `sandboxPolicy` 参数，provider 可能回退 deployment/default policy。 | `SvgOutputPath` 保留 exact current policy，publication 把它作为 `writeText` 第五参数传递；真实 `SandboxedFileSystem` 用 default read-only、per-call workspace-write 的 regression 成功且仅写 Session workspace。 | **CLOSED / VERIFIED** |

## Task / contract evidence

| Task | Independent result |
| --- | --- |
| 1.1 predecessors | **PASS**：复读 authenticated HTTP/tool owner、Session-cwd/local policy、Slide content execution、worker、render browser/page 与 error/lifecycle seams；实现复用既有 public exports，没有复制 app/private Core ownership。 |
| 2.1 Core controls | **PASS**：source 与 aggregate assets 使用同一 descriptor-bounded reader；真实 size exact/+1、growth/shrink、source/asset symlink escape、replacement races、contained symlink、abort、runtime close、apply value forwarding、unknown/no-replay 与 unsignalled CLI compatibility 通过。 |
| 3.1 closed tools/budgets | **PASS**：catalog 对该 capability 恰好注册 `workspace_svg_compile`、`workspace_svg_apply`；closed snake_case args/results、raw/page、replace/add、inline/file、diagnostics、Native/Code values、argument/source/asset/code/result depth/bytes，以及 committed envelope exact/+1 通过。 |
| 4.1 path/effect gate | **PASS**：missing cwd、remote provider、read-only、traversal/symlink、policy/provider drift 在 effect 前拒绝；one compile approval 或 one combined apply approval；denial/cancel 零 source/browser/credential/Workspace effect；apply 先保存 exact in-memory program，save failure 零 remote work；current policy 到达真实 provider write seam。 |
| 5.1 outcomes/lifecycle | **PASS**：file-confirmed body cancellation 投影 closed `workspace-svg-apply-partial`；registry-only late abort 保持 canonical `ABORTED` 与 fixed inspect/no-replay guidance；普通失败/value limit/commit unknown 不伪造 mutation。单 owner stop/unregister/abort/drain、generation retirement、dispose/remount、无 Job/timer/replay/delete 通过。 |
| 6.1 package graph | **PASS**：actual `package:verify` 重建并检查 tarball；private Core 与 exact SVG facade 内联，worker/render page/browser resolution closure 完整，无 bare Core/CLI source/artifact/sourcemap/absolute checkout/browser binary/font bundle。SVG reachable graph 不新增 Office/Typst native asset，既有 closures 保持独立 verification。 |
| 7.1 compatibility | **PASS**：Core/DSH/CLI focused 与三 package typecheck 全绿；CLI `compile-svg` source/assets、`--out`、estimate/real mode、warnings/lints、apply outcome 与 omitted-control行为保持。 |
| 8.1 installed/docs/gates | **PASS**：current tarball explicit-Chrome smoke 从隔离 profile/unrelated cwd 经 real ToolRuntime 执行 nested asset、estimate/real browser、file/apply exact-once、partial/unknown/cancel/dispose/secrecy/cleanup matrix。README、root ownership、CONTEXT/ADR 与 visual 与当前合同一致；OpenSpec 为 8/8。 |

## Commands and observed results

| Gate | Result |
| --- | --- |
| Core focused: `test/svg.test.ts test/svg-text-measurer.test.ts test/content-execution.test.ts` | **PASS**：3 files / 37 tests。 |
| DSH focused: `test/svg-tools.test.ts test/authentication.test.ts` | **PASS**：2 files / 95 tests。 |
| CLI focused: `test/workspace-compile-svg.test.ts test/content-execution.test.ts` | **PASS**：2 files / 10 tests。一次误写不存在的 `svg-command.test.ts` 时 Vitest 只运行 content test；随后用真实文件名重跑并得到本行结果。 |
| Core、DSH、CLI `typecheck` | **PASS**。 |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**：current source 重新 build；actual tgz file set、AST/runtime refs、physical SVG facade closure通过。 |
| explicit-Chrome `pnpm --filter dsh-univer-work package:smoke` | **PASS**：`smoke passed`，real Chrome/current installed matrix 完成。无显式 browser 的首次命令按设计拒绝；补齐 `UNIVER_RENDER_BROWSER` 后同一 gate 通过。 |
| Earlier independent `package:smoke:restricted` | **PASS**：Linux/arm64 restricted container、fresh profile、network/runtime restrictions与 real ToolRuntime/Chrome SVG matrix通过；latest reader/budget/policy回修另由 current focused、real-FS probe 与 host installed smoke覆盖。 |
| CLI package build/verify/smoke | **PASS**：此前独立重建 actual CLI artifact，并从 arbitrary cwd 编译 nested SVG/assets；current CLI focused/typecheck 保持通过。 |
| `openspec validate add-dsh-svg-generation-tools --strict` | **PASS**：change valid。 |
| `openspec status` / `openspec instructions apply` | **PASS**：planning complete；8 complete、0 remaining、`all_done`。 |
| `git diff --check` / `git diff --cached --check` | **PASS**。 |
| process/temp residual audit | **PASS**：smoke 退出后无 matching smoke/web/worker process；无 `svg-qa-*`、DSH smoke/profile/run temp residue。 |

## Final Spec follow-up

在 review 指出的两处证据缺口修正后，QA 对最终树执行了独立窄复验；既有 findings ledger 和此前
验证历史保持不变。

| Follow-up | Independent evidence | Status |
| --- | --- | --- |
| Compile/output traversal 与 outside-symlink 必须在 approval 前失败 | 最终 `svg-tools.test.ts` blob `244e27fa8d5c1a4bb5dccf42e8f6469247d68310` 通过 real ToolRuntime 对 `workspace_svg_compile` 与 `workspace_svg_apply` 分别注入 `../outside.svg` 和 cwd 内指向外部真实文件的 `escape.svg`，两种工具均返回 error；同一 harness 终局断言 approval 列表为空、`createFeature` 零调用，因此 source/compiler/browser/credential/worker/Workspace/output effect 都未启动。DSH SVG/auth focused **2 files / 95 tests PASS**；Core SVG **1 file / 24 tests PASS**。 | **CLOSED / VERIFIED** |
| Installed exact output 与 apply-after-worker-submission joint disposal | 最终 smoke blob `129667aa7c3330d41717aa6e36d4afd6edf7b089` 从 actual installed tarball/unrelated Session cwd 运行。approved compile 先以旧文件为 target，随后逐字节断言其内容为当前 compile result `${code}\n`。apply disposal case 先保存 `disposing.js`，fixture 明确观察第三次 worker `new_changes` submission 后立即调用 plugin-fiber dispose；execution 与 disposal 联合等待的 hard bound 为 5 秒。结果保持 exact `{committed:true,revision:2,status:"committed",value:null}`，order 为 `execution, dispose`，tool catalog 已注销，文件仍等于同次 compiled program；外层终局断言 `svgSubmissions() === 3`，排除 replay。explicit-Chrome `package:smoke` **PASS**，browser/worker/process/temp cleanup 为零残留。 | **CLOSED / VERIFIED** |
| Follow-up convergence | `openspec validate add-dsh-svg-generation-tools --strict`、working/cached `git diff --check` 均 **PASS**；最终实现 blob `9dffb12b38918c8248d66aa76eb237aed444ca01`。 | **PASS** |

## Final assessment

五个 QA findings 和两项 final Spec follow-up 均已在稳定树上独立关闭。任务、spec scenarios、domain ownership、
actual artifact、installed real-browser路径、CLI compatibility、strict/diff 与 cleanup gates 没有剩余偏差。
该 Change **READY TO ARCHIVE**。
