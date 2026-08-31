## Context

`add-dsh-space-node-tools` plans the shared closed-tool wrapper, Workspace error boundary, approval listener pattern and fiber-scoped execution owner. Its current artifacts assume body-side exact-key validation happens before approval. The frozen rc.2 ToolRuntime appends caller/model arguments as Native `tool/call.arguments` or Code Mode `tool/code-dispatch-start.arguments`, then runs `tools/pre-execute` and resolves `ask`, and only afterward lets `defineTool.execute` validate parameters or enter that wrapper. Code Mode settlement also writes `tool/code-dispatch.arguments` from `normalized.logged`, including a policy-rejected call. Change 3 must correct this assumption in its own artifacts and implementation before this Change is applied; this Change records the dependency but does not edit Change 3.

`add-dsh-univer-work-authentication` owns one credential-backed resolver that reads and validates the current grant at each operation boundary and returns a fresh `WorkspaceHttp`. This Change extends those owners; it does not create a parallel connection, tool runtime, controller or retry layer.

`packages/client-core/src/worktree.ts`, `unit.ts` and `open.ts` already own Worktree/Unit HTTP paths, strict models, stable idempotency identity, lifecycle preconditions and read-back, result-unknown, Unit membership and review URL selection. Their public methods currently do not accept `AbortSignal`. Worktree create and Unit add/create retry unknown results with one stable identity; lifecycle reads state before a transition and performs one read-back after an unknown result. Cancellation must stop future sequential work without changing ordinary retries or the Workspace CLI caller that omits a signal.

DeepSeek Harness `0.1.1-rc.2` owns caller-cancellation finalization and approval through `tools/pre-execute`; the approval stage precedes tool-definition parameter validation. Its Skill registry does not scan arbitrary package files: a packaged Skill enters the catalog only after the Host explicitly calls `ctx.skills.register()`. These version-sensitive contracts were rechecked at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## Goals / Non-Goals

**Goals:**

- Map the existing Worktree, Unit and review outcomes to stable DSH tools without copying Workspace protocol or Commander composition.
- Preserve the Draft/terminal approval boundary, idempotency, read-back, result-unknown, error secrecy and cancellation across source and installed profiles.
- Ship one static `core` Skill that teaches the capabilities actually available after Changes 2–4.
- Keep existing Workspace CLI method calls, command behavior, Skill and self-contained artifact unchanged.

**Non-Goals:**

- Do not add a generic Workspace action tool, lifecycle router, tool generator, DSH service interface, background Job or account selector.
- Do not add files, content authoring/runtime, Office/render/generation/discovery capabilities or the remaining seven Skills.
- Do not expose a caller-selected viewer origin, open a browser, add Web UI, or broaden local Host-only support.

## Diagram design

```text
DSH Agent ── loads core Skill ───────────────────────┐
    │                                               │
    └── twelve closed tools                         │
           ├── four read/review ────────────────────┤
           ├── six routine mutations ── validate   │
           └── merge / discard ── validate ── ask  │
                                                   ▼
                            existing Host owner + authenticated resolver
                                      │ fused caller/owner signal
                                      ▼
                    Workspace Client Core Worktree / Unit / review workflow
                       ├── stable identity + bounded retry
                       └── lifecycle validation + result read-back
                                      │
                                      ▼
                              Workspace Server / Browser URL
```

## Decisions

### 1. Register twelve outcome-specific tools

The Host registers this fixed surface:

| Tool | Parameters | Canonical output |
| --- | --- | --- |
| `workspace_worktree_list` | optional `view`, `scope`, `space_id` | `{ worktrees }` |
| `workspace_worktree_get` | `worktree_id` | `{ worktree }` |
| `workspace_worktree_create` | `name`, `scope`, optional `space_id`, `visibility`, `idempotency_key` | `{ worktree }` |
| `workspace_worktree_update` | `worktree_id`, optional `name`, `visibility` | `{ worktree }` |
| `workspace_worktree_ready` | `worktree_id` | `{ worktree }` |
| `workspace_worktree_reopen` | `worktree_id` | `{ worktree }` |
| `workspace_worktree_merge` | `worktree_id` | `{ worktree }` |
| `workspace_worktree_discard` | `worktree_id` | `{ worktree }` |
| `workspace_unit_list` | `worktree_id` | `{ units }` |
| `workspace_unit_add` | `worktree_id`, `resource_id` | `{ unit }` |
| `workspace_unit_create` | `worktree_id`, `space_id`, `type`, `name`, optional `parent_node_id`, `idempotency_key` | `{ unit }` |
| `workspace_worktree_review_url` | `worktree_id`, optional `unit_id` | `{ review }` |

`review` is the existing Core result `{ openUrl, type, unitId, worktreeId }`; the adapter does not invent another URL model. Parameter keys follow DSH snake_case, while outputs retain Client Core field names as in Change 3. `view` defaults to active. A list `space_id` requires `scope: space`; create uses flat fields plus exact cross-field rules so the model sees one shallow schema rather than an unnecessary nested scope object.

Worktree create rejects Space-only fields for user scope and requires `space_id` for Space scope. Update requires at least one changed field. Unit create intentionally omits Core's `initialData`: Workspace CLI does not expose it on this command, and later content tools own authoring. IDs, names and idempotency keys must be non-empty; the Server remains authoritative for permissions, target existence, Worktree visibility and lifecycle state.

The closed-tool helper projects `additionalProperties: false` for model assembly. Each mutation has one small pure operation validator that accepts `unknown` and either returns the canonical typed input or throws a fixed `workspace-argument-invalid` without copying keys or values. It checks the exact root keys, primitive types, enums and operation cross-fields. Every body calls it before Core; because rc.2 policy runs earlier than ordinary schema execution, the merge/discard policy also calls the same validator before returning `ask`. Local schema fragments cover Worktree and Unit output once inside the module; no schema compiler, validator framework or feature factory is added. Each tool calls exactly one Core public operation.

Alternatives rejected:

- A generic `workspace_worktree_transition` would hide merge/discard from approval policy and make arguments less precise.
- One composite “start task” tool would choose scope and mutation ordering for the Agent, obscure intermediate identities, and make partial failure harder to reconcile.
- Mirroring CLI `open --viewer-url` would let model input change the review origin without adding a Workspace outcome.

### 2. Ask only for terminal merge and discard

One extension to the existing `tools/pre-execute` listener matches only Worktree merge and discard. It selects the operation validator, validates `exec.arguments`, and only then returns DSH `ask`. Worktree create/update/ready/reopen and Unit add/create bypass this approval policy and validate in their bodies before credential resolution. Exact-key, type, enum or cross-field failure throws one fixed Harness failure with metadata `workspace-argument-invalid`; its result/failure and plugin-owned payloads include no rejected key/value, it produces no approval interaction/event and performs no credential lookup. DSH still retains Native `tool/call.arguments`, or both Code Mode `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments`; the plugin neither owns nor rewrites those records. List/get/Unit list/review also delegate immediately.

Each mutation body runs its pure validator before Core. Merge/discard therefore recheck the input accepted by policy, while the six routine mutations establish their complete validation boundary in the body. The body contains no approval API call, and mutation definitions remain exclusive.

Merge and discard keep distinct names and fixed high-impact approval text naming only the exact operation. Approval interactions/events and plugin-owned payloads contain no Worktree ID, name or other caller value, so they do not make another copy beyond the DSH-owned Native record or two Code Mode records. Approval denial, cancellation, absence or unavailable interaction fails before credential resolution. The static Skill also says merge/discard require an explicit user request, but policy remains the enforcement boundary.

The Worktree is the isolation boundary for routine task preparation and same-task rework. Keeping approval on merge/discard protects the two operations that finalize or destroy remote draft state without interrupting create/update/ready/reopen and Unit staging/creation. Separate tool names leave deployments free to apply stricter policy without a generic action discriminator.

### 3. Append optional signals to the existing Core methods

Client Core retains its classes and appends one optional final argument:

```text
Worktree: list(input, signal?), get(id, signal?), create(input, signal?),
          update(id, input, signal?), transition(id, action, signal?)
Unit:     list(worktreeId, signal?), add(worktreeId, resourceId, signal?),
          create(input, signal?)
Review:   createUrl(input, signal?)
```

Core checks the signal before and after the unabortable authenticated resolver and before each sequential request. Every `WorkspaceHttp.json()` and shared `getWorktree()` call receives it. Existing callers omit the final argument.

The stable-identity helper receives an optional signal only to make retry stopping correct for these existing algorithms. Before the first attempt, an aborted signal prevents dispatch. After an attempt returns result-unknown, ordinary execution may continue with the same identity up to the existing bound; if cancellation has arrived, the helper emits the existing bounded `workspace-result-unknown` immediately and starts no next attempt. It does not add a cancellation error to Client Core or change unsignalled consumers.

Lifecycle uses the signal for the initial GET, transition POST and result-unknown GET. An abort before a read-back begins prevents it; an abort during read-back stops it and leaves the transition unknown. If response validation or read-back already confirmed the requested state before cancellation was observed, Core may return success. DSH remains free to replace that late success with its caller-owned `ABORTED` result.

No tool-layer retry is added. Ordinary create/add/create retry remains inside Core with stable identity; update never becomes retryable; lifecycle keeps exactly its current precondition and read-back algorithm.

### 4. Resolve the review origin once per operation

`workspace_worktree_review_url` first obtains one authenticated `WorkspaceHttp` from Change 2's operation resolver. It creates `WorkspaceOpenFeature` with two closures over that same object: one returns the HTTP instance and the other returns `http.origin`. Core therefore validates membership and builds the URL from one grant snapshot without reading the credential twice or exposing the record.

The tool accepts only Worktree and optional Unit identity. It does not fetch the URL, open a browser, accept `viewer_url`, or use CLI config. Invalid zero/many-Unit and missing-Unit cases preserve Core codes and safe identity detail.

### 5. Extend the frozen Workspace error projection

The application reuses Change 3's fixed-message error adapter. The Worktree/Unit feature accepts the shared Core/HTTP codes plus four verified workflow codes:

```text
Shared Core/HTTP:
  workspace-argument-invalid
  workspace-invalid-response
  workspace-result-mismatch
  workspace-result-unknown
  workspace-origin-mismatch
  workspace-authentication-required
  workspace-request-invalid
  workspace-redirect-refused
Workflow:
  workspace-lifecycle-invalid
  workspace-viewer-url-invalid
  workspace-open-unit-required
  workspace-unit-not-found
Server:
  UNAUTHENTICATED INVALID_INPUT FORBIDDEN NOT_FOUND CONFLICT INTERNAL_ERROR
```

Exact safe detail fields are limited to HTTP status/path and operation identities such as Worktree, Unit, Resource, Space, parent, idempotency key, requested/actual state and Unit count. Nested requested/actual values receive their own exact projection. Worktree-local `initialData`, original messages, causes, headers, records and unknown fields never cross. Any other code or thrown value becomes `workspace-operation-failed` with fixed operation text.

Every mutation validator uses this same fixed `workspace-argument-invalid` metadata and fixed operation message but never includes detail, because its source is untrusted tool input. Merge/discard apply it in policy and body; the six routine mutations apply it in the body before credentials. This extends a verified local allowlist rather than adding a generic redactor, error registry or recursive serializer.

### 6. Reuse one owner for cancellation and quiescence

Each body enters Change 3's active set before credential resolution and receives `AbortSignal.any([exec.signal, owner.signal])`, while the wrapper retains both sources for classification. Read operations and pre-request mutations map accepted-body abort to fixed `workspace-operation-cancelled` or `workspace-plugin-disposing` without exposing dependency causes.

After a mutation request starts, a Core `workspace-result-unknown` remains that failure even when either signal is aborted. If Core returns confirmed success after caller cancellation, rc.2 replaces the final result with canonical `ABORTED`; the definition's total `finalizeContent` preserves registry error identity and adds only fixed inspection guidance:

- create: inspect Worktree list before deciding whether the same idempotency key should be reused;
- update and lifecycle: inspect Worktree get;
- Unit add/create: inspect Unit list.

No guidance tells the model to replay automatically. Owner-only disposal does not abort ToolRuntime's caller signal, so an already confirmed success may remain visible while disposal drains it. The owner unregisters all tools, the two-name terminal approval policy and Skill, marks itself non-accepting, aborts I/O and awaits accepted bodies. No Job, timer, detached retry or result cache exists.

### 7. Package and explicitly register one static core Skill

The application owns one source `skills/core/SKILL.md`, adapted from `apps/cli/skill-data/core/SKILL.md` rather than imported from the CLI application. It keeps the established product concepts and these current workflow rules:

- discover by stable Space/Node/Resource identities;
- start every new task in a new Worktree;
- reuse only a known Worktree for same-task rework, reopening ready state first;
- stage an existing Resource or create one Worktree-local Unit;
- ready, read back and return the review URL;
- merge or discard only after an explicit user request;
- inspect after unknown/aborted writes and never blindly replay.

All examples use only tools delivered by Changes 2–4. The body omits future file/content/runtime/discovery instructions, so it never directs an Agent to unavailable tools. Later capability Changes may update this same source when their tools exist; this Change does not write speculative examples.

The build includes that Markdown in the tarball and makes its validated name, description and body available to the Host without a project/user filesystem scan. The plugin declares the existing `skills` injection and calls `ctx.skills.register({ name: 'core', source: 'bundled', ... })` inside the shared fiber effect. It does not add `registerProvider()`, Chokidar, a custom catalog, a new parser dependency or a second Skill copy. Tests compare the registered definition with the packaged source, query a real catalog, load it through the real `skill` consumer and verify disposal removes the contribution.

### 8. Verify source, real DSH composition and installed closure

Core tests add abort-observing cases for each read/mutation family, stable-identity retry stopping and lifecycle read-back. Existing no-signal cases remain unchanged. Plugin tests use real Cordis `ToolRuntime`, Skill registry and approval pipeline with fake credentials/HTTP to cover all twelve schemas, canonical output, the two-name terminal approval policy, routine mutation no-approval execution, error allowlists, result-unknown, caller `ABORTED`, owner disposal and Skill catalog/load/dispose. For every mutation family they send unknown keys, wrong types, invalid enums and cross-field conflicts through the real runtime and assert fixed `workspace-argument-invalid`, zero approval interactions/events and zero credential/HTTP work. Native tests require the sentinel in `tool/call.arguments`; Code Mode tests require it in both `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments = normalized.logged`. Approval, result/failure and every plugin-owned payload must omit it. Valid routine calls prove direct body validation; approved merge/discard calls prove the body recheck accepts the same canonical input.

Package verification confirms reachable Worktree/Unit/open Core is inlined; the core Skill is present and matches the registered body; no bare private package, `workspace:*`, CLI/Server source, worker, native/browser resource or later Skill enters the tarball. The isolated keyless smoke loads the packed plugin in a fresh local profile and observes the same tools, Skill and lifecycle without a real account.

## Risks / Trade-offs

- **Twelve schemas make one module verbose** -> Reuse only local model fragments; separate stable names keep validation and terminal approval precise.
- **Routine mutations change remote Draft state without approval** -> Keep them inside authoritative Worktree lifecycle and strict Core validation; retain approval for merge/discard, the two operations that finalize or destroy the draft.
- **DSH records arguments before policy and again at Code Mode settlement** -> Accept one Native or two Code Mode DSH-owned argument records as transcript authority; validate merge/discard before `ask`, validate every routine mutation before credentials, and do not copy input into result/failure, approval or plugin-owned payloads.
- **Cancellation after a write cannot prove remote state** -> Stop new attempts, preserve Core result-unknown/read-back semantics and instruct inspection without blind replay.
- **A packaged Skill drifts from registered content** -> Keep one Markdown source and assert the installed catalog body against the packed file.
- **The partial core Skill becomes stale as later tools arrive** -> Update that one source in the Change that delivers each new executable workflow; do not mention a tool before it exists.
- **DSH prerelease behavior changes** -> Keep exact rc.2 dependencies and rerun real ToolRuntime/catalog/tarball checks before baseline changes.

## Migration Plan

1. Complete and verify Changes 1–2, then revise and verify Change 3's same pre-approval validation assumption against rc.2 before this Change begins; this Change does not modify Change 3.
2. Add optional signal propagation and cancellation tests to Client Core without changing unsignalled CLI calls.
3. Register the twelve tools, apply the routine/terminal approval boundary, extend error handling and add focused real ToolRuntime tests.
4. Adapt, package and explicitly register the core Skill; verify the real catalog and disposal.
5. Extend installed artifact checks, keyless smoke, CLI parity and repository gates.

There is no Server, database, credential or product-state migration. Rollback unregisters this Change's tools and Skill and removes optional-signal call sites; authentication and Space/Node capabilities remain.

## Open Questions

无。会改变 tool names、approval boundary、review origin、Skill scope、signal/retry/result-unknown behavior 或 Change size 的决定均已由用户确认、Domain Model 与冻结源码收敛。
