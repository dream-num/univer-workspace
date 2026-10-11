> Prerequisite: complete and verify `add-dsh-univer-work-authentication` before implementation.

## 1. 贯穿 Client Core Space/Node cancellation

- [ ] 1.1 为 `WorkspaceSpaceFeature` 的 list/browse/find/create/rename/move/Trash methods 追加向后兼容的 optional `AbortSignal`，传给每个 `WorkspaceHttp.json()` 并在 pagination、recursive traversal 与 read-back 边界检查；在 `packages/client-core/test/space.test.ts` 用 abort-observing fetcher 覆盖 list、多页/递归 browse/find、四种 mutation 和 rename/move read-back，运行 `pnpm --filter @univerjs/univer-workspace-client-core test` 并确认所有无 signal cases 保持通过。

## 2. 固定 tools 的 schema 与参数边界

- [ ] 2.1 在 `apps/dsh-univer-work` 添加七个 operation-specific definitions、复用的 closed Space/Node/Resource/Trash output fragments，以及最小 `defineClosedWorkspaceTool()`：把 `defineTool()` 生成的 parameter root 投影为 `additionalProperties: false`，并为每个 operation 生成可由 policy/body 共用的纯 validator，检查 plain-object root、exact own keys、required/optional types、blank ID/query、非法 Node name、`unit_type + resource_kind none|blob` 与 non-null `parent_node_id === node_id`，不访问 service、不重写或反射参数；所有 body 在 resolver/HTTP 前复验。参数使用 DSH snake_case，输出保持 `{ spaces }`、`{ nodes }`、`{ node }`、`{ trashBatch }` Core model。用七个 schema/Code SDK/body cases 证明 schema/runtime 两侧均关闭；验证 descendant/cross-Space move 仍到 Server、missing/broadened output 在 render 前失败。

## 3. 交付 Space discovery tools

- [ ] 3.1 接入 Change 2 的 authenticated resolver 与 `WorkspaceSpaceFeature`，实现 `workspace_space_list`、`workspace_space_browse`、`workspace_space_find` 的 canonical values 和 value-only rendering；用真实 ToolRuntime + fake credential/Server 覆盖 ordered list、多页/递归 browse、filters、find、cycle/cursor invalid-response 与每次操作重读 grant，断言 adapter 不复制 `/api` path/parser 并运行 `pnpm --filter dsh-univer-work test`。

## 4. 交付 Node mutations 与 approval gate

- [ ] 4.1 实现 `workspace_node_create`、`workspace_node_rename`、`workspace_node_move`、`workspace_node_trash`，并添加只匹配这四个 names 的 fiber-owned `tools/pre-execute` listener：先按 tool name 调用 Task 2 的纯 validator，失败抛固定 `workspace-argument-invalid`，合法才返回只含 operation identity 的 secret-free `ask`，allowed body 再验。真实 ToolRuntime tests 对四个 mutations 覆盖 non-object root、extra `cookie`/`origin`/`path`/`action`、wrong/missing types、blank/name/self-parent 在 ask 前失败且无 approval/credential/HTTP、不回显 key/value，以及 allowed-once、rejected/cancelled/unavailable/no-channel fail-closed、create identity、rename/move read-back、root move、Trash Batch 与 create/Trash unknown result；断言 Trash 无其他 tool path、mutation definitions 保持 exclusive。

## 5. 收敛 errors、signals 与 Host lifecycle

- [ ] 5.1 用单一 application-local execution wrapper 复用 Change 2 的 Host owner，基于 `AbortSignal.any()` 融合但保留 `exec.signal`/owner signal 来源、跟踪完整 body；只透传冻结的 Core codes（`workspace-argument-invalid`、`workspace-invalid-response`、`workspace-result-mismatch`、`workspace-result-unknown`、`workspace-origin-mismatch`、`workspace-authentication-required`、`workspace-request-invalid`、`workspace-redirect-refused`）和 Server codes（`UNAUTHENTICATED`、`INVALID_INPUT`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`INTERNAL_ERROR`）及 exact allowlisted JSON detail，其他 code/throw 映射 `workspace-operation-failed`。真实 Cordis tests 固定 body 调用前 caller abort 为 DSH `ABORTED_BEFORE_DISPATCH`，已接受 body 的 pre-request/readonly exec abort=`workspace-operation-cancelled`、owner abort=`workspace-plugin-disposing`；dispatched mutation 的 tool-owned `workspace-result-unknown` 保持 failure，Core 已确认但 caller signal abort 的 late success 最终为 DSH `ABORTED`，并由 total finalizer 保留 error identity、只给 browse/find 核对与绝不自动重放的固定 guidance，owner-only dispose 则允许已确认 success 并保留 unknown failure。覆盖 resolver/HTTP/pagination/traversal/mutation/read-back 与 dispose drain；在 invalid args/unlisted code/cause/detail 植入 password/cookie/`Set-Cookie`/grant sentinel，明确排除 Native `tool/call.arguments`、Code Mode `tool/code-dispatch-start.arguments` 与 settled `tool/code-dispatch.arguments`，只断言 approval interactions/events、failure/result content+metadata、plugin-owned contexts/logs 无复制，且无 partial success/retry/detached promise/listener/Job/timer。

## 6. 固定 installed artifact 与 keyless transcript

- [ ] 6.1 扩展 `package:verify` 与隔离 tarball `package:smoke`，证明 reachable Client Core Space/Node 代码内联、packed manifest 无 workspace/bare Core/CLI/Server import、无 worker/native/render/Web/Skill/later resources，exact DSH/Cordis 保持 external；在 installed local profile 断言七个 parameter roots closed，执行代表性 mutation pre-ask/body unknown-key reject、read、approval deny/allow、allowlisted/unlisted Workspace failure、`ABORTED_BEFORE_DISPATCH`、body cancelled、owner disposing、caller-aborted late mutation success=`ABORTED`、dispatched-mutation-unknown 与 normal dispose，并保存含 browse/find/no-replay guidance 的 keyless transcript；sentinel transcript 显式允许 Native `tool/call.arguments`、Code Mode `tool/code-dispatch-start.arguments` 与 settled `tool/code-dispatch.arguments` 保留 DSH 已接收参数，只扫描 approval interactions/events、failure/result content+metadata、plugin-owned contexts/logs 的 non-reflection；运行 `pnpm --filter dsh-univer-work build`、`package:verify`、`package:smoke`。

## 7. 更新职责文档并运行兼容性 gate

- [ ] 7.1 更新 `apps/dsh-univer-work/README.md` 与 `packages/client-core/README.md`，记录 Space/Node tool names、approval、signal、error/result-unknown、Host-only/HTTP-only 与明确非职责；依次运行 Client Core `typecheck`/`test`/`build`、DSH application `typecheck`/`test`/`build`/`package:verify`/`package:smoke`、`pnpm --filter univer-workspace-cli test -- space-cli.test.ts application-command-contracts.test.ts`、`pnpm package:workspace-cli`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`，确认 CLI Space/Node command/output/Session/package、Server/OpenAPI、SDK baseline 与发布流程未改变。
