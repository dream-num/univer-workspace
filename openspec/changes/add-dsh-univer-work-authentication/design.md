## Context

`add-dsh-univer-work-plugin-shell` creates an inert Host entry. This Change is the first model-visible vertical slice and the owner of the connection used by every later Workspace capability. `packages/client-core/src/auth.ts` already exports strict, storage-neutral browser approval start/complete, `whoami`, logout, and `WorkspaceAuthentication` values; `WorkspaceHttp` owns origin normalization, redirect refusal, Cookie headers, response parsing, and result-unknown errors. The DSH shell must compose those exports rather than repeat their HTTP requests.

`docs/research/deepseek-harness-plugin-development.md` identified `CredentialKey`/`GrantRecord` as the storage seam for plugin-owned grants. A fresh source check against DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` found no production caller of `ctx.authorization.begin()`: the Browser Remote and Settings APIs expose only `CredentialRef` describe/set/unset, and the CLI has no plugin-contributed configuration command. Registering an authorization flow would therefore make the flow visible only to direct in-process callers and tests, not to a user.

The Workspace browser authorization protocol has no decline response. A user who does not approve leaves the request pending until it expires. The DSH surface must preserve that fact rather than invent an authorization-service `declined` outcome.

The current Core auth functions do not accept a signal even though `WorkspaceHttp.request()` does. DSH requires an async tool to observe `exec.signal` and remain running until owned work settles, so the smallest shared change adds optional signal arguments and forwards them to the existing requests.

## Goals / Non-Goals

**Goals:**

- Deliver one active Workspace connection using four schema-validated DSH tools and one plugin-owned credential record.
- Preserve the CLI's human handoff: start exits with safe approval fields, complete performs one exchange only after the user reports approval, and pending never becomes a polling loop.
- Keep the device code and Login Session cookie inside the credentials provider while exposing stable, programmatic outcomes and Workspace error codes.
- Give later plugin code one resolver that reads and validates the current grant for every operation.
- Propagate DSH cancellation through Client Core to all authentication HTTP requests and keep CLI callers source-compatible.

**Non-Goals:**

- Do not add password login, DSH authorization service/flow, Config, Settings, a Web Client, Remote, command, Job, timer, or background polling.
- Do not support multiple concurrent Workspace origins or prebuild an account selector.
- Do not coordinate authentication mutations across multiple live DSH Host processes or any out-of-band writer that bypasses the owner Host for this credential key.
- Do not modify Workspace endpoints, Server identity semantics, CLI persistence, or CLI command presentation.
- Do not add any Space/Node, Worktree/Unit, file, runtime, Office, render, discovery, or Skill capability.

## Diagram design

```text
                         workspace_auth_complete
absent ── auth_start ──> pending ─────────────────> authenticated
  ▲                        │   │                         │
  │                        │   └─ HTTP 202 ─────────────┘ stays pending
  │                        │
  └──── logout / expiry ───┴──────── logout ────────────┘

CredentialKey: dsh-univer-work/workspace
  pending grant       = device code + safe handoff fields
  authenticated grant = origin + cookie + User subject
```

## Decisions

### 1. Use four DSH tools instead of an unreachable authorization flow

The Host plugin registers these stable names through `defineTool()`:

- `workspace_auth_start({ origin })`
- `workspace_auth_complete({})`
- `workspace_auth_whoami({})`
- `workspace_auth_logout({})`

Start, complete, and whoami use generic call/result presentation. Logout also installs a fiber-owned `tools/pre-execute` listener that returns `ask` only for `workspace_auth_logout` and delegates every other tool to `next()`. Thus removing a usable credential requires the same DSH approval channel as other consequential calls; a headless or unavailable approval channel fails closed.

The start result is `authorization_required`; completion returns `authorization_pending`, `authorization_expired`, `authorization_missing`, or `authenticated`; whoami returns `authenticated` plus only the server-authoritative User subject; logout returns a local-clear result only after its `finally` path has completed. These are the complete non-error canonical status vocabularies. Canonical values carry the fields Code Mode needs directly. Human-readable rendering derives from those values and never adds credential material.

The tool descriptions require the Agent to stop after start, relay the URL/code, and call complete once only after the user says approval finished. Complete itself cannot prove who authored the prior natural-language message, but its one-exchange/no-wait behavior prevents autonomous polling. A 202 response returns the same handoff and asks the Agent to stop again.

Alternatives rejected:

- Registering `ctx.authorization` and a flow has no product caller in the frozen DSH baseline.
- Adding a Web Client, Remote, Settings card, Host HTTP page, or DSH CLI command creates another capability and violates the confirmed Host-only boundary.
- Password arguments or a secret prompt would place a password on a model/session path.

### 2. Store one discriminated grant under one owner key

The package uses `credentialKey('dsh-univer-work', 'workspace')`. The `GrantRecord.payload` has exactly one of two owner-defined JSON forms:

```text
{ state: 'pending', origin, deviceCode, expiresAt, userCode, verificationUrl }
{ state: 'authenticated', origin, cookie, subject: { id, name } }
```

There is no version field or credential-store wrapper: this is the first private prerelease format and no migration consumer exists. The state discriminator and exact-field validators are sufficient. Before a Core start result can be stored or rendered, and again on every pending-record read, the Host validates the Workspace protocol handoff rather than accepting any same-origin URL: `deviceCode` has the contract's minimum length, `userCode` matches `^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`, and the credential-free URL has the normalized origin, exact `/cli-login` pathname, no fragment, and exactly one `userCode` query value equal to that code. The validator also rejects any safe field when its literal or URL-decoded representation contains the device code. This allowlist prevents a malformed Server from moving the secret into an otherwise model-visible origin, code, path, or query.

Every authenticated read also verifies the record kind, payload object, exact fields, normalized HTTP(S) origin, cookie, and User subject. Errors name only the record/state problem, never the rejected value. The extra handoff check remains in the DSH Client Shell because this Change modifies the shared Client Core auth protocol only for optional signal forwarding and preserves the CLI's frozen behavior.

The single key intentionally supports one active connection. Start returns an existing live pending handoff for the same origin, but refuses to overwrite an authenticated record or a pending record for another origin. The caller uses approved logout before changing origin. This avoids an account registry and prevents a harmless start call from silently discarding a working Login Session.

Alternatives rejected:

- `CredentialRef` cannot carry an owner-defined browser grant and is shaped for environment-name secrets.
- Ordinary Config, Settings, plugin module state, or a custom file would bypass the existing protected credential provider.
- Separate pending and authenticated keys allow stale completion to coexist with and potentially replace the wrong active connection.

### 3. Serialize record transitions inside the owning Host

One application-local mutation queue serializes start, complete, and logout across every Agent using the Host. All writes use `ctx.credentials.modifyRecord()`; removal uses `deleteRecord()`. Start holds that queue while it calls Core, then commits pending only if the current record still permits that transition. Complete reads one valid pending payload, performs exactly one exchange, and replaces it before the next queued authentication mutation begins. The queue is process-local because DSH rc.2 offers atomic record replacement but no conditional delete operation.

If the post-request `modifyRecord()` callback observes a state that no longer permits the start or completion transition, the tool raises the plugin-owned stable failure `workspace-authentication-state-conflict`. It returns no handoff fields or User subject from the uncommitted response, does not modify the observed record, and does not retry; a Server-issued browser authorization or Session that the Host could not persist expires through Server policy. This defensive outcome covers out-of-band credential edits without claiming that unsupported multi-Host mutation is coordinated.

An expiry check deletes the pending record inside that queue and makes no request. A 202 response leaves the record unchanged. A start or completion network/parse failure leaves the prior local state unchanged. If Server exchange succeeds but credential persistence fails, the tool reports failure without exposing the cookie; the Server-issued but locally unreachable Session may remain until Server expiry because the product database and credential provider cannot share a transaction.

The supported composition has one live Host owner for this key and no concurrent file, provider, or process mutation that bypasses that Host. This is a documented deployment precondition, not a runtime check: the abstract provider exposes neither store identity nor a live-owner lease. `CredentialProvider.modifyRecord()` uses callback `undefined` to mean “leave unchanged,” while `deleteRecord()` is unconditional, so the frozen DSH API cannot express compare-and-delete against any out-of-band writer. This Change does not add a lock, tombstone format, or upstream credentials seam for an unsupported deployment topology.

Every error crossing an authentication tool boundary is converted to an operation-specific `HarnessError`/tool failure with a fixed sanitized message. Only a recognized `WorkspaceApplicationError` preserves its stable Workspace code. Credential-provider `readRecord()`/`modifyRecord()`/`deleteRecord()` failures, validators, unknown thrown values, and Workspace errors never contribute their original message, `detail`, request body, response headers, cause, or credential record to the failure presentation. Expected non-error states such as pending, missing, and local expiry remain canonical output values.

### 4. Resolve authenticated HTTP at each operation boundary

One application-local resolver accepts the Core role (`client` or `worker`), reads `dsh-univer-work/workspace`, strictly requires the authenticated form, and returns a fresh `WorkspaceHttp` with its origin and cookie. It does not expose the raw record to tool modules or cache the object. `workspace_auth_whoami` resolves role `client`, calls Core `whoami`, and returns only the response's User subject rather than trusting the grant's stored subject as current authority or repeating connection metadata.

Later Changes import this resolver through the `dsh-univer-work` application's internal module seam. They do not add a Cordis service interface with one implementation, read credentials directly, or import CLI Session code.

### 5. Clear local state even when remote logout fails

After approval, logout reads the record once. For an authenticated grant it calls Core remote logout; for pending, invalid, or absent state it sends no authenticated request. A `finally` block always calls `deleteRecord()` and completes that deletion before the tool settles. The deletion is not cancelled with `exec.signal`, because cancellation must not leave a locally usable Session after the tool has begun logout.

If the remote call fails or its result is unknown, the sanitized Workspace error is reported after local deletion. If local deletion itself fails, that storage failure takes precedence because claiming logout while a credential remains would be unsafe. No automatic retry is performed: the remote request may already have succeeded.

### 6. Add optional signals at the existing Client Core protocol seam

The Core keeps its current functions and appends optional signals without introducing request objects, overload families, or a second transport:

```text
startCliLogin(http, now = Date.now, signal?)
completeCliLogin(http, pending, now = Date.now, signal?)
whoami(http, signal?)
logout(http, signal?)
```

Each function passes `signal` to its single `WorkspaceHttp` call. Local expiry/origin checks still occur before I/O. Existing CLI calls omit the new argument and compile unchanged. DSH passes `exec.signal` on every call. Because `WorkspaceHttp` maps fetch failure, including abort after dispatch, to `workspace-result-unknown`, cancellation does not create a new Core error taxonomy or claim that the Server did not act.

Password login is unchanged because no DSH tool consumes it and this Change does not need its signal path.

### 7. Inline private Client Core into the packed Host entry

Change 1 can emit plain ESM because its Host entry has no private workspace imports. This Change invalidates that assumption: a tarball installed in a DSH profile cannot resolve private `@univerjs/univer-workspace-client-core@workspace:*`. The package therefore reuses the repository's installed Vite/Rollup toolchain to bundle the Host entry and inline reachable Client Core code. Node built-ins and the exact published DSH/Cordis runtime packages remain external declared package dependencies.

The build imports Client Core only through its root package export. Tree shaking relies on Client Core's existing `sideEffects: false` manifest so the auth/http/error slice enters this artifact without pulling future content runtime, native bindings, workers, or render assets into the authentication Change. Package verification rejects a bare `@univerjs/univer-workspace-client-core` import and any workspace dependency in the packed manifest.

This is an application packaging adjustment, not a new shared bundler abstraction. The existing TypeScript compiler remains the typecheck face and no publishing workflow is added.

### 8. Quiesce authentication work in one fiber-owned effect

One `ctx.effect()` owns the accepting flag, all four tool registrations, the logout approval listener, one dispose `AbortController`, the mutation queue, and the set of executing authentication bodies. Each execution registers its whole body before it can wait on the queue. Its Core I/O receives a signal fused from `exec.signal` and the owner-dispose signal; the fusion removes its listeners when that body settles. Start and complete check the fused signal after Core I/O and again inside the synchronous `modifyRecord()` transition callback, before a new provider write begins.

The effect's async disposer performs one ordered shutdown: mark the owner non-accepting and explicitly unregister the tools/gate, abort the owner signal, then await the mutation queue and every tracked non-mutating body before returning. A queued start or complete that has not begun I/O exits sanitized after owner abort; an accepted whoami aborts its request and settles. An accepted logout still enters its queue position, skips or aborts remote I/O, and completes the non-cancellable local `deleteRecord()` before the disposer can settle. A `modifyRecord()` provider write that already passed its synchronous transition callback is allowed to finish atomically and is included in the drain; owner abort prevents only transitions whose callback has not started. Thus Cordis does not rely on `ctx.tools.register()` removal to cancel an already running tool body, and no plugin-owned promise remains after `fiber.dispose()` resolves.

The original execution signal remains independently effective: aborting `exec.signal` aborts the same fused signal passed to Core even while the owner stays active. There is no detached promise, timer, Job, or polling task.

### 9. Verify the assembled and packed security boundary

Focused Client Core tests use an abort-observing fetcher for start, complete, whoami, and logout, then rerun the existing protocol cases without signals. Plugin tests compose real Cordis tools with an in-memory credential provider and fake Server transport, covering every grant state, serialized transition, logout approval/finally behavior, both execution- and owner-signal propagation, error sanitization, and disposal during each in-flight Core request or queue wait.

A keyless assembled-agent snapshot inspects tool schemas plus Native/Code Mode results and asserts that password, device code, cookie, `Set-Cookie`, and serialized grants never enter logged args, results, rendering, or failures. The Change 1 installed-tarball smoke is extended to prove the packed plugin has inlined Client Core, resolves its exact DSH dependency closure, registers all four tools, excludes authorization service/flow rows, and unregisters effects on normal shutdown. No real account or credential is used.

## Risks / Trade-offs

- **A model calls complete before the user replies** -> The tool performs one exchange only; pending returns immediately with explicit stop instructions, and no timer, retry, or Job exists.
- **Another Host or out-of-band writer mutates the owner key** -> The local first version documents one live Host and no bypass writer as a support precondition; it cannot detect or safely coordinate that topology. Add an upstream owner lease or conditional-delete seam only when shared mutation becomes a product requirement.
- **A successful Server exchange cannot be committed locally** -> Report the storage failure, discard the cookie, and leave the prior/local state authoritative; do not fake a cross-system transaction or print recovery material.
- **Cancellation makes a remote result unknowable** -> Forward the signal, preserve `workspace-result-unknown`, never retry completion/logout automatically, and still finish local logout deletion.
- **Generic error handling leaks a secret cause** -> Sanitize every transport, validator, and credential-provider failure at the tool boundary; preserve only recognized stable Workspace codes. Transcript tests seed recognizable sentinel secrets into both transport and provider thrown messages and reject their presence.
- **Plugin removal leaves an orphan credential record** -> The operator runs approved logout before removal; DSH credentials can still enumerate/delete an orphan record, and this Change does not add a second cleanup service.
- **DSH prerelease APIs change** -> Keep the exact `0.1.1-rc.2` dependency and rerun installed composition/snapshot checks before any baseline upgrade.

## Migration Plan

1. Complete and verify `add-dsh-univer-work-plugin-shell` so the target package, bundle row, build, and installed smoke exist.
2. Add optional signal forwarding and focused tests to Client Core without changing existing CLI call sites.
3. Add the grant validator/resolver, four tools, logout approval listener, and focused Cordis tests to the Host application.
4. Bundle reachable Client Core into the Host artifact, then extend the built/tarball checks and keyless transcript.
5. Run Client Core, DSH application, CLI parity, package, and repository gates.

There is no Server, database, CLI Session, or existing DSH grant migration. Rollback first invokes approved logout when possible, then removes the authentication code/dependencies; the inert shell from Change 1 remains installable.

## Open Questions

无。会改变 credential key、single-origin behavior、tool surface、secret exposure、Core API compatibility 或 Change size 的决定均已由研究、用户确认与本设计收敛。
