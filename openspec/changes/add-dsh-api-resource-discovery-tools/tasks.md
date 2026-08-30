## 1. 固定 installed discovery datasets

- [x] 1.1 在 `apps/dsh-univer-work` 声明 exact `@univer-cli/api-reference@1.0.0-beta.2`、`@univer-cli/resource-library@1.0.0-beta.2` 与 `@univerjs-pro/cli-assets@0.1.0` ownership，从 installed public exports 加载 opaque manifest 并构造 shared query-only library 完成 fail-closed validation；用 focused tests 覆盖有效、缺失、malformed data 及 activation-before-registration failure，确认无 private manifest read、CLI/checkout fallback、credential、network 或 cache side effect。

## 2. 交付 API discovery tools

- [x] 2.1 实现 `workspace_api_find` 和 `workspace_api_show` 的 closed schemas/results、exact-key validation、固定 fan-out/64 KiB argument/1 MiB result budgets、found/not-found projections 与 value-only render；通过 real ToolRuntime Native/Code Mode tests 覆盖 success、invalid input、output overflow/malformed、caller abort 和 secret-free fixed failures。

## 3. 交付 resource query tools

- [x] 3.1 实现 `workspace_resource_registries` 和 `workspace_resource_find` 的 closed 256 KiB canonical results，保留 stable public metadata 并排除 source URL/raw manifest/cache/SVG；测试 filters、defaults/maxima、unknown registry、output validation、keyless zero-effect execution 与 cancellation。

## 4. 复用 local export effect gate

- [x] 4.1 为 `workspace_resource_export` 复用 Change 5 current policy、public local-constructor proof、Session-cwd/`workspaceRoot` output-directory containment、one-time pre-ask 和 immutable body recheck；pre-execute 只锁定 handles/directory，不读取 private manifest 或自行解析 filename，验证 read-only/non-local/outside-root zero-effect rejection、approval deny/allow，以及 approval 等待期间 policy/provider/directory/symlink 变化不触发 `processPath()`、network 或 output。

## 5. 实现无 cache 的 bounded atomic export

- [x] 5.1 每个 accepted body 从同一 opaque loaded manifest 构造 call-owned ResourceLibrary、no-retention cache、response-chunk 计费 downloader、output/signal/budget/directory closures 和 application-local same-directory `0600` temp/sync/atomic-replace helper，禁止 shared current-call/AsyncLocalStorage；测试并发调用隔离、10 MiB per-resource failure且累计有余时继续、failed/aborted bytes扣减后next继承余量、`Content-Length`/stream chunks耗尽32 MiB后终止later network、filename/target rejection、partial results、prior-file preservation、temp cleanup和零cache state。

## 6. 收敛 errors、cancellation 与 owner lifecycle

- [x] 6.1 扩展既有 Host owner，注册五个 tools/一个 export policy，使用 frozen discovery/resource/file code allowlist，fuse caller/owner signals 并只 track/drain accepted-body promises；通过 tests 证明未知 dependency/URL/header/path/cause/secret 不泄漏，caller abort 后不启动 later handle，dispose unregisters、aborts、awaits isolated call-owned finalizers，且不遗留 request/file/temp/listener/timer/cache/current-call/AsyncLocalStorage/promise。

## 7. 验证 installed closure 与仓库 gates

- [x] 7.1 扩展 package verification、责任文档和隔离 tarball smoke，证明 exact datasets/dependencies、五个 tools、unrelated cwd/no credential 的四个 keyless queries、controlled-HTTPS approved export、bounded Native/Code Mode transcripts、partial/cancel/dispose 与无 CLI/Core bare import/Skill/monorepo fallback；运行 focused app checks、repository SDK-baseline/typecheck/test/build、CLI package smoke 和 `git diff --check`。
