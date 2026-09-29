> Prerequisite: complete and verify `add-dsh-univer-work-plugin-shell` before implementation.

## 1. 贯穿 Client Core auth cancellation

- [ ] 1.1 为 Client Core 的 browser approval start/complete、`whoami` 与 logout 追加向后兼容的 optional `AbortSignal`，透传到各自唯一的 `WorkspaceHttp` 请求；在 `packages/client-core/test/auth.test.ts` 用 abort-observing fetcher 覆盖四条在途取消路径，并运行 `pnpm --filter @univerjs/univer-workspace-client-core test`，确认无 signal 的既有认证测试保持通过。

## 2. 建立 plugin-owned credential state

- [ ] 2.1 在 `apps/dsh-univer-work` 定义唯一 `dsh-univer-work/workspace` key、pending/authenticated `GrantRecord` 精确解析、process-local auth mutation queue、`modifyRecord` transition、queued expiry 清理和按操作重读的 authenticated HTTP resolver；pending 在首次存储及每次读取时均校验 device-code 最小长度、固定 user-code pattern、精确 same-origin `/cli-login?userCode=<matching-code>` URL 及 safe fields 的 raw/decoded device-code 排除；用 focused tests 覆盖错误 kind/state/field/origin/URL/cookie/subject、sequential rotation、single-origin 保护与同 Host 并发串行化，断言无效 payload 不被回显、pending 不能产生 authenticated HTTP；文档明确一个 live Host 且无绕过它修改 owner key 的 writer 是支持前提，不声称能检测或协调该拓扑。

## 3. 交付两阶段 browser approval tools

- [ ] 3.1 用 `defineTool()` 注册 `workspace_auth_start` 与 `workspace_auth_complete` 的参数、完整 canonical status vocabulary、safe rendering 和执行逻辑；测试 start/reuse/conflict、complete missing/pending/expired/authenticated、同 Host mutation queue 的顺序结果与 post-request `workspace-authentication-state-conflict`、同源 URL path/query/raw/decoded 夹带 device-code sentinel、每次最多一个 HTTP exchange、无 timer/Job/poll/password，并确认未提交或未通过 handoff allowlist 的字段以及 device code/cookie 从所有 args、results、rendering 与 errors 中排除。

## 4. 交付 identity、logout 与 consequential gate

- [ ] 4.1 注册 `workspace_auth_whoami`、`workspace_auth_logout` 和只匹配 logout 的 `tools/pre-execute` `ask` listener；用真实 ToolRuntime + fake approval/credentials/Server 证明 whoami 读取 Server 权威 User、approval 缺失时 fail closed、remote success/failure/cancellation/result-unknown 均在 settle 前完成本地删除，删除失败不会误报 logged out；所有 validator/provider/transport failure 均变为固定 operation-specific `HarnessError`/tool failure，且仅 recognized `WorkspaceApplicationError` 保留 stable Workspace code。

## 5. 验证 lifecycle 与 keyless transcript

- [ ] 5.1 用单一 fiber-owned `ctx.effect()` 组合 accepting gate、四个 tool registrations、logout listener、owner `AbortController`、mutation queue 与 active-body tracking；async disposer 按“拒绝/显式注销新调用 → abort owner signal → await queue 和全部 bodies”收敛，accepted logout 仍执行 non-cancellable local delete。真实 Cordis tests 覆盖 dispose 发生在四条 Core I/O、mutation queue wait 与 logout finally，断言原始 `exec.signal` 和 owner signal 均到达请求、dispose 返回后无 body/queue/listener/effect；再增加 keyless Native/Code Mode transcript，在 same-origin verification URL、transport 与 credential-provider thrown message/cause 中分别植入 device-code/credential sentinel，断言 Session log 不含未校验 handoff、原始依赖错误、password、device code、cookie、`Set-Cookie` 或 grant payload。

## 6. 固定安装 artifact 闭包

- [ ] 6.1 复用仓库现有 Vite/Rollup 把 reachable Client Core auth/http/error 代码内联进预构建 Host entry，保留精确 DSH/Cordis external dependencies；扩展 `package:verify` 与隔离 tarball `package:smoke`，断言 packed manifest/产物无 workspace dependency 或 bare Client Core import、无 runtime/worker/native/render 资源，并在 installed profile 中注册/执行四个 tool schema 后正常 dispose。

## 7. 更新职责文档并运行兼容性 gate

- [ ] 7.1 更新 `apps/dsh-univer-work/README.md` 与受影响的 Client Core 职责说明，记录 single-origin、两阶段 handoff、credential secrecy、local Host-only、一个 live Host/no out-of-band owner-key writer 的支持前提、无 authorization service/UI/password 与后续 resolver owner；依次运行 `pnpm --filter @univerjs/univer-workspace-client-core typecheck`、其 `test`/`build`、`pnpm --filter dsh-univer-work typecheck`、`test`、`build`、`package:verify`、`package:smoke`、Workspace CLI auth tests 与 `pnpm package:workspace-cli`，再运行 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`，确认 Server/OpenAPI、CLI Session/command/output、SDK baseline 与发布流程未改变。
