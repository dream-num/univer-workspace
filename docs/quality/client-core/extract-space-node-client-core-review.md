# extract-space-node-client-core Code Review

审查范围：`git diff 96aa8efde0e5a8a9dad32bc3b3b80fa60a6cdab4 5f089b4573d2d5c1d040541800f303b6e63d17fe`

两个审查轴由独立 subagent 执行。系统 thread limit 阻止同时启动两个 reviewer，因此先完成 Standards，再启动 Spec；两者未共享审查结论。

## Standards

PASS。未发现违反 documented standards 的问题，也未发现值得报告的 baseline smell。

- `packages/client-core/**` 符合 private package、named exports、应用依赖方向和既有 `packages/reference-provider` package/config/source/test 模式。
- `apps/cli/src/**` 只通过 package 根 exports 依赖 Core；旧路径为设计明确限定的迁移 re-export shim，不判定为 Middle Man。
- CLI 构建先构建 Core，并将它内联进自包含 artifact；package smoke 覆盖安装后的 Space 命令。
- 测试、文档和 lockfile 与职责边界同步；未引入跨仓库源码依赖、生成文件手改或无关 SDK 版本变更。

## Spec

### SPEC-01：带 URL credentials 的同源请求可能携带 Session cookie

- 严重度：medium
- 状态：closed
- 规格证据：`specs/workspace-client-core/space-node/spec.md:27-28` 要求，当 API request 包含 URL credentials 时，Core 必须拒绝请求，且不得向新目标转发 Workspace Session cookie。
- 实现位置：`packages/client-core/src/http.ts:44-50`、`packages/client-core/src/http.ts:68-70`
- 证据：`request()` 只比较 `url.origin` 与配置 origin。同源绝对 URL（例如 `https://user:secret@workspace.test/api`）的 `origin` 仍匹配，随后认证 headers 会加入 Session cookie。`packages/client-core/test/http.test.ts:5-15` 只覆盖配置 origin 含 credentials，没有覆盖 request URL 含 credentials。
- 建议：在构造认证 headers 和调用 fetcher 前拒绝 `url.username` 或 `url.password` 非空的请求；增加测试并断言 fetcher 未被调用。

未发现其他 spec 缺失、scope creep，或 Space/Node workflow、CLI parity、package artifact 的错误实现。审查期间 Core 29 tests 与 CLI 定向 15 tests 通过；这些测试未覆盖 SPEC-01。

## Summary

- Standards：0 findings，PASS。
- Spec：1 个历史 finding，最高严重度 medium；0 open。

## Fix re-review：SPEC-01

复审日期：2026-08-28。复审范围：

```text
git diff 5f089b4573d2d5c1d040541800f303b6e63d17fe d6ee136d079ec43353023deb5fc5f4ece2a648d1 -- packages/client-core/src/http.ts packages/client-core/test/http.test.ts
```

系统仍将已完成 agent 线程计入 thread limit，无法为 closure check 再次启动 Standards 与 Spec subagent。原始审查已由两个独立 subagent 完成；本轮 coordinator 仅检查原 finding 的两文件修复 diff，没有扩大审查范围。

### Standards closure check

PASS，0 findings。修复只在既有 origin guard 增加 credentials 条件，没有新 abstraction 或错误分支；测试分别覆盖普通 `request()` 与具有不同输入构造、错误语义的 `collaborationRequest()`，未发现值得报告的 duplication 或其他 smell。

### Spec closure check

PASS，`SPEC-01` closed。`packages/client-core/src/http.ts:44-50` 在认证状态检查、header 构造和 fetcher 调用前拒绝 username、password 或 cross-origin URL，沿用 `workspace-origin-mismatch`。`packages/client-core/test/http.test.ts:34-50` 覆盖同源 username/password URL，并断言 fetcher 未调用；`collaborationRequest()` 的对应安全路径也有独立覆盖。

未发现新 scope creep 或 regression。复审执行 `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run test/http.test.ts`，17/17 tests 通过；两文件和本报告的 `git diff --check` 通过。QA 报告另记录 Core 33/33、CLI 定向 15/15、typecheck/build 通过。

复审汇总：Standards 0 findings；Spec 0 open findings。
