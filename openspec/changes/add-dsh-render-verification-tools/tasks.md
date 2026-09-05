## 1. 核对前置 owner 与冻结合同

- [ ] 1.1 确认 Changes 1–6 已实施，核对现有 DSH Host lifecycle、authenticated current runtime generation、local file/policy gate、Core render/load/write exports、Change 5/6 shared error adapter与其完整allowlist、DSH rc.2 ToolRuntime cancellation/pre-execute 顺序，以及 SDK beta.2 screenshot/layout/browser schemas与限制；记录实现后Change 5/6 allowlist exports的真实名称并复用，不另造平行adapter；先运行 `pnpm --filter @univerjs/univer-workspace-client-core typecheck` 和 `pnpm --filter dsh-univer-work typecheck`，任一 prerequisite 不符时停止，不创建第二 runtime、file 或 render owner，也不改变冻结 baseline。

## 2. 贯穿 Core render Unit 与 browser cancellation

- [ ] 2.1 为 render Unit input、source opening、target/reference resolution、UnitData export、Worktree Asset resolution 和 layout load 追加 optional signal，并把既有 screenshot/lint signal 贯穿 browser construction/operation；增加 focused Core tests，覆盖 pre-abort、reference/Asset mid-abort、无后续步骤、browser success/failure/abort 全部先 close、不可中断 close 被等待，以及无 signal 的 target/reference/order/result compatibility，再运行相关 Client Core render/source/screenshot/lint tests。

## 3. 固定 signalled PNG publication 与 partial output

- [ ] 3.1 让 screenshot writer 接受 optional signal，在每个 private temp/exclusive link 前后检查但始终完成 cleanup；为 supplied-signal caller 记录 confirmed links，并在任意 post-commit 取消/失败时返回 exact `workspace-screenshot-output-partial` detail `{ totalOutputCount, committedOutputCount, committedOutputs: [{ name, location }], causeCode }`，其中 `causeCode` 仅为 `ABORTED`、`workspace-screenshot-output-exists` 或 `workspace-screenshot-output-failed`，不投影 raw cause/message/errno/stack，不删除、覆盖、recapture 或 replay；测试 zero/one/multiple commit、link race、generic late failure、late complete success、owner cancellation、temp cleanup，并证明无 signal 的 CLI `0600`、existing/concurrent destination 与 non-transactional behavior 不变。

## 4. 声明并验证两个 DSH tool contracts

- [ ] 4.1 添加 `workspace_screenshot` 与 `workspace_layout_lint` definitions、closed-root/exact-own-key helpers、完整 nested schemas 与 shared pure validators；实现Trunk禁止`worktree_id`、Worktree要求non-empty `worktree_id`，禁止caller `unit_type`/`revision`/`origin`，通过existing Core probe解析authoritative type/revision且target mismatch在browser前失败；实现六种 screenshot target、beta.2 A1/page/page-id/Board/tile/scale semantics、Worktree Slide pages、65,536-byte arguments、30 screenshot pages、10,000 lint selectors和complete lint report validator；截图capture后基于approved canonical directory与safe basenames预构造exact bytes-free result并在首PNG publication前完成closed-schema/8 MiB/64-depth gate，oversize/malformed写零文件；用真实 ToolRuntime覆盖Native/Code Mode、unknown keys、scope cross-field/limit/error ordering、all Unit targets、all finding fields、pre-publication zero-file failure、no truncation和PNG-byte absence。

## 5. 把 screenshot 接入 local file policy 与一次 approval

- [ ] 5.1 扩展现有 `tools/pre-execute` listener，使 screenshot 按 current policy deny → public local-constructor proof → pure args → Session cwd/current-root containment → fixed `ask` 的顺序 preflight，并在 approved body 对 immutable arguments 重做 policy/provider/path gate 后才调用 `processPath()`、credential/Core/browser/file work；测试 read-only/non-local/no-cwd/escape/symlink/policy race/deny/cancel/approve、默认 `screenshots`、无 pre-approval Host I/O，以及每个 generated basename 都留在 approved directory；同时证明只读 layout lint不询问且不写文件。

## 6. 组合 runtime、errors 与 total lifecycle

- [ ] 6.1 复用 current worker generation、credential-change retirement和application license resolver，向每次 Core render operation提供 package-relative render page与process browser environment；复用Design Decision 6逐项枚举的完整Change 5/6 allowlists，仅增加本Change列出的render codes，固定safe detail和total finalizers，覆盖browser unavailable、source/Asset/runtime/screenshot/lint failures、exact partial detail、caller late success→`ABORTED` inspection/no-replay guidance与owner-only drain；冻结Chromium `--no-sandbox`的restricted OS user/container部署前提，明确file approval/no-approval都不是process isolation；用secret/content/path sentinels和真实Cordis dispose tests证明无credential/license/UnitData/raw selector/browser path/raw cause泄漏、每次browser先close、accepted bodies/worker generation均被等待且无Job/pool/daemon/detached work。

## 7. 交付安装态 render closure

- [ ] 7.1 让 DSH package build依赖Client Core render-page build并复制完整本地asset graph；解析installed `@univer-cli/univer-render-runtime`并对其package/manifest执行`realpath`，验证exact `1.0.0-beta.2`，再从该physical owner directory解析actual installed `puppeteer-core`/`@puppeteer/browsers` package manifests，读取concrete exact versions写入packed manifest并在pack/install后核对resolved versions相等，禁止复用owner semver ranges；保留Change 6 worker-child/formula binding闭包，拒绝remote URL、sourcemap、browser binary/cache、bare private Core、CLI/source checkout与Office/Typst/SVG资源；从unrelated temporary cwd安装tarball，在restricted temporary user/container filesystem/network boundary内，以real ToolRuntime、keyless fake Workspace/Collaboration service和显式resolved test browser运行真实screenshot/lint、exact PNG/report、caller cancellation、partial output、credential replacement和bounded dispose，并执行package verify/smoke。

## 8. 文档与仓库 compatibility gate

- [ ] 8.1 更新 DSH/Client Core package READMEs，记录已交付的local screenshot/layout scope、browser prerequisite、Chromium `--no-sandbox`下restricted OS user/container与bounded filesystem/network部署责任、approval仅授权文件effect而不提供process isolation、Session cwd、PNG no-overwrite/partial/abort ceiling、system-font差异与exclusions；运行Client Core typecheck/test/build、DSH typecheck/test/build/package verify/smoke、CLI screenshot/lint/SVG regressions、`pnpm package:workspace-cli`及CLI package verify/smoke、`pnpm typecheck`、`pnpm test`、`pnpm build`、`openspec validate add-dsh-render-verification-tools --strict`和`git diff --check`，确认Server/Browser/OpenAPI/database/deployment/CLI command/release behavior与exact SDK baseline未变。
