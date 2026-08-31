# add-dsh-univer-work-plugin-shell Code Review

固定基线：`d2e51a25ef05bd662cb4a88ba6ff68236577269a`

审查范围：从固定基线到 shared worktree 当前实现，仅审查 Change `add-dsh-univer-work-plugin-shell`。Review 不修改产品代码或 `tasks.md`。

## 状态

**PASS，0 open findings。** 历史 findings：1 medium、2 low，均已修复并复验关闭。

## 验收标准

### Correctness / Spec

- `apps/dsh-univer-work` 是 `dsh-univer-work@0.0.0`、`private: true`、strict ESM；Host entry 与 `dsh.bundle.patch` 都只解析 packed build output。
- 包保持 Host-only：没有 `dsh.client`、Web、Slot、Settings、tool、Skill、Job、authorization、Workspace connection、Client Core、worker、CLI subprocess 或预留 placeholder。
- `cordis.patch.yml` 只插入一个启用的 `dsh-univer-work` Loader row，package、patch、row 与 resolver identity 一致。
- built entry 通过真实 Cordis composition load/dispose；fiber dispose settle 后没有 plugin-owned effect。
- 隔离 `DSH_HOME` 的预构建 tarball 安装 smoke 证明 ordered bundle membership、effective layer/Loader row、fresh Host start、正常信号终止和 bounded deadline；不借助源码 overlay 或 Harness 私有 test-support package。

### Security / Lifecycle

- smoke 只清理其创建且已解析验证的临时根；成功和失败路径都清理，不读取或改写真实 DSH profile。
- child process 环境只局部设置隔离 `DSH_HOME`；错误保留 stdout/stderr，但不引入或输出 credential。
- spawn/error/timeout/signal/exit 路径都能 settle，没有 orphan process；终止升级只在 deadline 后发生。
- package、build、test、smoke 不解析相邻 DeepSeek Harness 或其他 checkout 的源码/绝对路径。

### Packaging

- 依赖精确冻结为 DSH `0.1.1-rc.2`、Cordis `4.0.1`，仓库 SDK cohort 仍为 `1.0.0-beta.2`，lockfile 同步且没有宽范围兼容声明。
- tarball 只含运行所需 Host output、patch、README、Apache-2.0 license 和 manifest；所有 manifest target 存在。
- tarball 没有 source entry、`prepare`/install-time build、未声明资源或未来 capability placeholder；安装后不依赖 monorepo checkout。
- 根 recursive build/typecheck/test 能发现新 app，既有 CLI packaging/release、Workspace Server/Browser、HTTP contract、数据库和 deployment 不变。

### Documentation / Maintainability

- `README.md`、`AGENTS.md`、`DREAMNUM.md`、`apps/workspace/CONTEXT.md`、新 ADR 和 package README 准确记录 Workspace Agent Client、Workspace Client Core、Client Shell 与共仓 owner。
- 文档明确 `dsh-univer-work` 当前只有 local Host shell，private/no-release；不把后续认证、tools、Skills、runtime 或 CLI parity 写成已实现事实。
- 复用仓库 TypeScript/Vitest、Node 标准库和公开 package exports；不新增单实现 interface、factory、provider、service package、重复脚本或 speculative config。
- 非平凡 smoke 分支保留最小可运行测试；避免为 inert plugin 添加 synthetic health service、log line 或占位 effect。

## Findings

### REV-01：timeout/finally 在子进程退出前删除临时 profile

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs:27-30,145-160`
- Evidence：首轮实现的 timeout/finally 在 kill 后立即 reject/rm。第一轮修复加入 detached process group 与 kill-and-reap，但 `signalTree()` 在 direct child 已有 `exitCode`/`signalCode` 时直接返回。POSIX process-group leader 可以先退出，而 descendant 继续持有继承的 stdout/stderr，使 `close` 仍未 settle；此时 TERM/KILL 两次都不会送给残留 group，reap 最终 assert。`run()` 外层仍可能删除 descendant 正在使用的临时根，Host `finally` 则会因 reap throw 直接跳过 `rm(root)`。该行为仍不满足 design 的 bounded cleanup、spec 的“所有 owned cleanup 在 settle 前完成”及 smoke 的“成功或失败后清理”。
- 修复建议：POSIX tree signaling 由 `closed` 是否 settle 决定，不因 leader exit status 跳过负 PID group signal；`ESRCH` 表示 group 已消失。TERM 后等 close，超时再 KILL 并有界等待。cleanup/reap 报错时用 nested `finally` 确保 exact-root cleanup 被尝试，并保留/聚合原始错误。不要引入 process manager 或通用 subprocess abstraction。
- Closure evidence：`signalTree()` 在 POSIX 上始终向 detached process group 发信号，`killAndReap()` 等待 `close`、TERM deadline 与 KILL deadline；顶层分别捕获主失败、child cleanup 与 exact-root cleanup failure，并用 `AggregateError` 保留原因。真实 `package:smoke` 通过，结束后系统临时目录无 `dsh-univer-work-smoke-*` 残留。

### REV-02：artifact path gate 只拦截名称包含 deepseek-harness 的路径

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/scripts/verify-package.mjs:60-63`
- Evidence：正则 `/(?:\/Users\/|file:|link:).*deepseek-harness/i` 只有在绝对路径或本地 dependency scheme 后面再次出现字面量 `deepseek-harness` 时才失败。`/Users/.../univer-workspace`、`file:../repo`、`link:../other` 都能通过，但 Task 3.1 和 packed-file scenario 要求 gate 拒绝任何 adjacent checkout/runtime source path，不只拒绝 Harness checkout。
- 修复建议：分别拒绝 `/Users/`、`file:` 与 `link:`（若目标平台需要，再覆盖 Windows absolute checkout path）。当前 artifact 不含这些字符串，无需增加通用 dependency scanner。
- Closure evidence：verifier 现在分别拒绝 `file:`、`link:`、parent traversal、Unix user/tmp/workspace root 与带边界的 Windows drive absolute path；`package:verify` 对实际 pack metadata/file list 通过。

### REV-03：packed responsibility documentation 缺少冻结 commit

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/README.md:14-18`
- Evidence：Frozen compatibility requirement 明确目标是 Harness `0.1.1-rc.2` at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，其 scenario 要求 package metadata、lockfile、responsibility documentation 与 smoke inputs 联合选择该 baseline。packed README 只记录 release、Cordis 和 SDK，tarball 内没有冻结 Harness commit，无法从安装 artifact 的责任文档区分同版本源码坐标。
- 修复建议：在 package README 的 verified baseline 句补充 frozen Harness commit，并保留“不对其他 release 作兼容承诺”的现有限定。无需增加 compatibility manifest。
- Closure evidence：packed README 记录 Harness `0.1.1-rc.2`、commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`、Cordis `4.0.1` 与 SDK `1.0.0-beta.2`，并明确其他 release 当前不受支持。

## Final audit

### Correctness / Spec

PASS。Package identity、Host-only scope、唯一 Loader row、真实 Cordis lifecycle、packed tarball 安装、effective config、fresh Host start/stop 与 frozen baseline 均对应 Change requirements。`tasks.md` 6/6 complete；`openspec validate add-dsh-univer-work-plugin-shell --strict` 通过。未修改 Workspace HTTP contract、Server/Browser、数据库、Client Core、CLI package/release 或 SDK cohort。

### Security / Lifecycle

PASS。Smoke 使用唯一临时 `DSH_HOME`，local child command 在 POSIX 独立 process group 中运行；失败/timeout 执行 TERM→bounded wait→KILL→bounded reap，最后独立尝试删除 exact temporary root。输出诊断保留 stdout/stderr；shell 不读取 credential、CLI Session 或 Workspace connection。

### Packaging

PASS。Manifest 精确选择 DSH `0.1.1-rc.2` 与 Cordis `4.0.1`，没有 runtime dependency、install-time build 或 `dsh.client`。实际 pack closure 为 `LICENSE`、`README.md`、`cordis.patch.yml`、`dist/index.js`、`package.json`；verifier 与隔离安装 smoke 均通过，不依赖相邻 checkout 或 Harness 私有 test-support。

### Maintainability / Ponytail

PASS。实现保持单 application package、一个 inert Host entry、一个 patch、一个 lifecycle test 与两个 Node-standard-library verification scripts；没有单实现 interface、factory、service/provider package、placeholder config 或未来 capability abstraction。进程清理 helper 只服务 smoke 的安全边界，未扩展成通用 subprocess framework。

### Verification evidence

- Focused：typecheck PASS；Vitest 1 file / 2 tests PASS；build PASS；package verify PASS；真实 package smoke PASS。
- Repository：`pnpm typecheck` PASS；`pnpm test` PASS（Client Core 453、CLI 69、Workspace 152、reference-provider 16、shell 2，另含 SDK/release tests）；`pnpm build` PASS。
- Planning/format：OpenSpec strict PASS；`git diff --check` PASS。

## Final conclusion

**PASS，0 open findings。** Standards/correctness 历史 3 findings 均 closed；Spec 0 open；最高历史严重度 medium。Change 可进入独立 QA 最终结论与后续实施编排。
