# `add-dsh-svg-generation-tools` 独立 Review

状态：**PASS / READY TO ARCHIVE；8/8 tasks；Standards 与 Spec 均 0 open findings**。

## Review 边界

- 固定起点为 pre-SVG product tree `494e88fbe87c3236d31d7f6d2911d7f2de46e883`；最终 working tree 通过临时 index 冻结为 `393f5f064987791736c7bccf750426a3a3fc9445`。
- 审查依据包括根与目标 README/AGENTS、`apps/workspace/CONTEXT.md`、accepted ADR 0007、本 Change proposal/design/tasks/delta specs，以及 Core、DSH、CLI、package verifier 与 installed smoke 的实际 caller。
- 双轴 subagents 对同一固定区间并行审查。Render QA/review bookkeeping 与 SVG QA 报告不作为产品 diff；本 agent 只新增本报告，不修改产品、tests、tasks、QA 或 planning artifacts，不 commit/push/archive。
- Ponytail full 约束保持：延长现有 Core SVG workflow、单一 `WorkspaceToolOwner`、content-runtime generation、local policy 与 package graph；没有新增 compiler/filesystem registry、browser pool、第二 worker/owner 或跨 feature generic lifecycle framework。

## Findings ledger

| ID | Severity | 初始问题 | 最终复验 | 状态 |
| --- | --- | --- | --- | --- |
| SVG-REV-001 | Medium / Warning | proposal Domain Alignment 曾引用相邻 checkout 的绝对 CONTEXT/ADR。 | `proposal.md:36-38` 现引用 repo-relative `apps/workspace/CONTEXT.md` 与 accepted ADR 0007，并准确区分 DSH Client Shell 与 private Core；`change.html` 已刷新且无旧 authority。 | **CLOSED** |
| SVG-REV-002 | Medium / Warning | packed-artifact spec 曾声称整个 tarball 不含 Office/Typst native assets，与既有 closures 共存事实冲突。 | DSH delta spec `:298` 与 checked Task 6.1 都把禁止范围限定为 SVG reachable graph 新增资源，并明确 existing Office/Typst closures 继续独立验证。 | **CLOSED** |
| SVG-REV-003 | High | apply value allowance 只按 no-mutation envelope 预留，confirmed revision/status 可在 commit 后把完整结果推过 8 MiB；status 也未固定。 | `svg-tools.ts:789-860` 固定 `status: "committed"`，按 no-mutation 与最大 safe revision 的 committed envelope 取最坏 fixed bytes；exact boundary 成功，+1 在 commit 前拒绝。 | **CLOSED** |
| SVG-REV-004 | High | output path 丢弃 body-time `SandboxExecutionPolicy`，最终 `writeText` 会回退 deployment policy。 | `svg-tools.ts:271-277,441-510` 保留 exact current policy并作为第五参数传给 provider；真实 `SandboxedFileSystem` regression 以 default read-only / Session workspace-write 证明最终 fence。 | **CLOSED** |
| WT-SVG-QA-004 | High | source/root `realpath` 后把 canonical file 换成 root 外 symlink，旧 `stat`/`open` 会共同跟随并读出外部字节。 | `packages/client-core/src/svg.ts:215-283` 使用 `lstat`、`O_NOFOLLOW`、`fstat`、post-open realpath/root/dev/ino recheck和同 descriptor bounded read；source/asset real-FS races 均 fail closed。 | **CLOSED / independently rechecked** |
| SVG-REV-005 | Medium | 带 `output_path` 的 compile preflight 只约束 output；escaped source 会先请求 approval，违反 source escape 必须先拒绝的 scenario。 | `svg-tools.ts:378-385` 在 approval 前先 resolve source identity/containment；`svg-tools.test.ts:101-128` 对 traversal 与 symlink 的 compile-output/apply 均断言零 approval、零 feature work。 | **CLOSED** |
| SVG-REV-006 | Medium | installed smoke 未成功执行 approved compile output；dispose 只停在 compile approval，未覆盖已启动的 apply/worker。首轮计时修复又在 active execution 结束后才开始 5 秒 race，不能证明 bounded drain。 | `smoke-package.mjs:1390-1404` 验证 approved exact replacement；`:1480-1540` 等待真实 changeset dispatch 后调用 dispose，并立即以 `Promise.all([disposal, activeApply])` 进入 5 秒 race，验证 confirmed outcome、文件不变、无 replay、worker/browser cleanup。 | **CLOSED** |

## Standards

Standards：**0 open findings**。

- 最终 compile preflight 只解析 source identity/containment，不读 source bytes、不创建 browser、不读 credential、不调用 `processPath()`，符合 both-tool escape rule 与 pre-approval effect boundary。
- Core 对 absolute、`..`、symlink 与 `file://` asset 的行为以 opened real identity containment 为准，符合 Design §4 与 Core delta spec；HTTP(S) 仍不由本 Change fetch。早期“应拒绝全部 file URL”的建议据具体 authority 撤回。
- SVG 与 Render 的 approval/result tracking 虽形状相近，但各自保留 owner-local lifecycle。没有实际漂移证据；抽跨 feature generic helper 会制造 speculative generality，因此早期 Duplicated Code judgement 同样撤回。
- 最终 diff 未违反 strict ESM、named export、private package direction、current-fact docs、SDK exact baseline或 package boundary；12 项 smell baseline 均无剩余 finding。

## Spec

Spec：**0 open findings**；missing/partial、scope creep、implemented-but-wrong 均为 0。

- 两个 closed tools、exact schemas/cross-field validation、source/aggregate asset/generated code/argument/result budgets、raw/page 与 replace/add、Native/Code Mode projection均与 delta specs一致。
- 单一 owner 组合 current credential/license/runtime；compile-only 为零 credential/Workspace effect，apply 先保存 exact program再执行一次 Draft Slide content mutation。partial、unknown、late abort、caller/owner cancellation与 no-replay ordering保持闭合。
- Core 的同 descriptor reader、signal fences、browser close与 optional-control CLI compatibility成立；contained local asset合同未被错误收窄。
- Package verifier覆盖 physical exact SVG facade、private Core inline、worker/render/browser closure和 runtime reference completeness；installed profile从 unrelated cwd执行 estimate/real compile、approved output、confirmed/file-partial/unknown/caller-abort/started-apply dispose与 cleanup。
- proposal/design/spec/tasks/README/CONTEXT/ADR/change.html 描述当前事实；Server、Browser、HTTP/OpenAPI、DB、deployment、CLI command/output与发布边界未扩张。

双轴汇总：Standards 0 findings；Spec 0 findings。

## Verification

| Gate | Result |
| --- | --- |
| Core SVG focused | **PASS**：`test/svg.test.ts` 24/24。 |
| DSH SVG/auth focused | **PASS**：2 files / 95 tests；最终 SVG source-preflight regression单跑 36/36。 |
| CLI SVG focused | **PASS**：`workspace-compile-svg` 9/9；built command catalog 的 SVG case通过。 |
| Root `pnpm typecheck` | **PASS**：Core、reference-provider、CLI、Workspace、DSH。 |
| Final `pnpm package:verify` | **PASS**：重新 build并检查 actual tarball、physical facade与完整 emitted/runtime graph。 |
| Final explicit-Chrome installed smoke | **PASS**：实现 lane与独立 QA 在最终 smoke blob上完成 real ToolRuntime/browser/worker矩阵；最终 Spec reviewer复读 runnable barriers与断言。 |
| OpenSpec strict、Node syntax、working/cached diffcheck | **PASS**。 |
| Final dual-axis follow-up | **PASS**：Standards 0；Spec 0。 |

## Final assessment

所有 review/QA findings 已在最终冻结树上关闭。实现满足 domain ownership、Core/Client Shell 边界、approval/effect ordering、预算、错误与取消语义、actual package/installed closure和 CLI compatibility。该 Change **READY TO ARCHIVE**；本 review 未执行 archive。
