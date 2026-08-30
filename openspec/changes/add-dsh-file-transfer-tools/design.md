## Context

`packages/client-core/src/blob.ts`, `asset.ts`, `asset-content.ts` and `files.ts` already form the complete Node-hosted file-transfer slice used by Workspace CLI. Blob upload owns a stable idempotency intent and bounded reserve→PUT→status→complete→Resource read-back state machine. Blob/Asset downloads validate remote identity and metadata, write a private same-directory temporary file, enforce exact byte counts, synchronize it, and publish it atomically without clobbering by default.

The missing DSH-specific work is path ownership and tool execution. A DSH path is not a Host path: `ctx.fs.resolve()` returns an execution-world identity, and only `ctx.fs.processPath()` supplies a path for another capability in that same world. DeepSeek Harness `0.1.1-rc.2` exposes no provider-neutral flag saying that the filesystem world is the Cordis Host process. Its shipped local `SandboxedFileSystem` inherits the public `LocalFileSystem`; the E2B provider does not. This frozen provider relationship is the smallest positive local-world check available in the supported baseline.

The base local profile mounts the in-process local sandbox wrapper. This wrapper remains supported because its process paths are Host-local; E2B and other remote sandbox/filesystem providers remain unsupported. DSH filesystem mutation primitives write text only, so they cannot replace Client Core's streaming binary output path. `SandboxedFileSystem.processPath()` still returns a Host path, but a later Client Core `node:fs` write does not pass through the `checkedTarget` fence used by `writeText`/`editText`. Downloads therefore enforce the calling Session's DSH file-effect policy before approval and again before exposing that Host path.

This Change depends on the authenticated resolver and single Host owner from `add-dsh-univer-work-authentication`, plus the closed-tool, approval, error and lifecycle conventions from `add-dsh-space-node-tools`. It adds no second owner or framework-neutral adapter.

## Goals / Non-Goals

**Goals:**

- Expose Blob get/upload/download and Worktree Asset download as four stable DSH operations.
- Enforce the calling Session's current DSH file-effect policy before download approval and re-evaluate it in the approved body before credential, HTTP or local I/O.
- Resolve every source/destination inside the calling Agent Session cwd and pass only positively proven Host-local process paths to Client Core.
- Preserve Client Core's Blob recovery, signed URL security, exact-byte validation and atomic overwrite rules.
- Carry caller/owner cancellation through DSH resolution, HTTP, recovery, streams, atomic publication and cleanup.
- Prove the packed package's real ToolRuntime and local filesystem behavior outside the monorepo checkout.

**Non-Goals:**

- Do not support E2B, remote sandbox/filesystem, inline bytes, attachments, base64 or a universal binary transfer seam.
- Do not add a generic sandbox controller, binary filesystem abstraction, policy escalation parameter or second approval layer.
- Do not add Jobs. Existing CLI operations are bounded foreground workflows, and no measured duration requires a second lifecycle surface.
- Do not add Office exchange, embedded-image upload, content/runtime, screenshot, render, Typst, SVG, discovery or Skills.
- Do not change Server endpoints, Blob recovery limits, destination semantics, CLI commands or private Core publication status.

## Diagram design

```text
DSH file tool
  │ closed tool identity + caller/owner signal
  ▼
Download policy preflight
  ├── confining provider: resolve current Session policy
  ├── read-only: deny before path / ask / I/O
  ├── public LocalFileSystem constructor proof
  └── only then: undefined mode means bare local
  ▼
Session cwd path gate
  ├── workspace-write: policy root + Session cwd
  ├── danger / bare local: Session cwd
  └── ctx.fs resolve / contains; no processPath
  │ one transfer approval, then policy / identity / path revalidation
  ▼
Workspace Client Core
  ├── Blob protocol / bounded recovery ──> Workspace Server
  ├── Asset sign / credential isolation ─> Workspace Server or CDN
  └── private temp / exact bytes / atomic commit ─> local Session cwd
```

## Decisions

### 1. Keep four operation-specific tools

The tool surface is:

| Tool | Parameters | Canonical value |
| --- | --- | --- |
| `workspace_blob_get` | `resource_id` | `{ node, resource }` |
| `workspace_blob_upload` | `source_path`, `space_id`, optional `parent_node_id`, `name`, `declared_media_type`, `idempotency_key` | `{ upload }` |
| `workspace_blob_download` | `resource_id`, `output_path`, optional `force` | `{ download }` |
| `workspace_asset_download` | `worktree_id`, `asset_id`, `output_path`, optional `force` | `{ download }` |

Parameters use DSH snake_case. Values retain the Client Core camelCase model and existing Blob/Asset result fields, avoiding a second Resource/Node/Operation projection. Upload keeps `idempotency_key` optional like CLI; Core creates one UUID once for that accepted body when omitted and retains it with the public upload intent in every final result-unknown, including cancellation after dispatch. The Client Shell never retries a settled tool result.

The application reuses the closed root helper introduced by the Space/Node Change: model-facing parameter schemas project `additionalProperties: false`, and the body exact-own-key checks raw arguments before other body work. Because `defineTool()` validation runs inside the body in DSH rc.2, upload pre-execute explicitly invokes the same pure closed-key and scalar validator before it returns `ask`; the approved body repeats that validation before any credential, filesystem or HTTP effect. Download pre-execute first resolves policy without inspecting arguments; if the mode permits writing, it applies the same pure closed-key and scalar constraints needed to preflight `output_path`, then the approved body repeats the shared exact validation against DSH's immutable `ToolExecution.arguments`. This ordering lets read-only deny before arguments/path, prevents malformed uploads and malformed/out-of-bound downloads from prompting, and keeps credential/Core work behind one approval. It does not claim validation precedes caller-owned Session logging.

Outputs use explicit closed Node, Blob Resource, Operation, upload and download schema fragments local to the application. Rendering reads only the validated canonical value. No generic transfer action, arbitrary headers, URL, bytes or credential field is accepted.

Alternatives rejected:

- One `workspace_file_transfer` action tool would weaken schemas and approval policy identity.
- Inline/base64 input would duplicate DSH filesystem ownership and buffer potentially large files.
- Reusing Commander commands or CLI JSON presentation would violate Client Shell ownership.

### 2. Recheck the current download policy on both sides of approval

The fiber-owned `tools/pre-execute` listener handles a stateless download preflight. When `ctx.fs.sandboxMode` is defined, application composition requires the public DSH sandbox-policy service. For each Blob/Asset download call, the listener resolves the current policy with the calling Session. A confining filesystem without the policy service is a load/composition failure, not a permissive fallback.

The listener checks policy before it parses the output path or asks for transfer approval. `read-only` throws the existing shared secret-safe `HarnessError` form with fixed code `workspace-file-policy-denied`: it does not inspect provider identity or path, ask, start the body, resolve credentials, send HTTP, call `processPath()`, or perform Host file I/O. This is supported by rc.2: the pre-execute catch path converts a thrown `HarnessError` through `toolErrorResult()` and retains its `{ name, code }`; a plain `{ kind: 'deny' }` would retain only a reason and is not used for plugin-owned policy failures.

After that policy check, and still before argument/path interpretation, the listener requires `ctx.fs instanceof LocalFileSystem` using the exact rc.2 public constructor. This accepts the bare local provider and its in-process `SandboxedFileSystem` subclass. It rejects E2B and every unrelated provider with the existing fixed secret-safe `workspace-local-filesystem-required` Harness error, with no `ctx.fs.resolve()`/`contains()`/`processPath()`, approval, credential, Core or Host I/O. `sandboxMode === undefined` is not itself proof of local execution: only after the constructor check passes may the listener interpret it as a bare LocalFS that requires no policy service. A constructor-proven `workspace-write` provider applies its current policy `workspaceRoot` plus Session cwd; `danger-full-access` and bare local still apply Session cwd. No mode accepts an escalation argument.

For a constructor-proven download the listener performs only pure argument validation plus provider-owned DSH `ctx.fs.resolve()`/`contains()` identity preflight, then returns one `ask`. It does not stat/open/read/create the destination, call `processPath()`, resolve credentials or start HTTP/Core work. It stores no policy, path, bytes or execution state across approval. After the definition/body exact validation of the same immutable arguments, the application resolves current Session policy, repeats the public-constructor identity gate, and only then repeats canonical path containment. If policy narrows to `read-only`, the body throws the same fixed error before provider/path inspection; if the provider is no longer Host-local, it fails before path interpretation. If policy widens, immutable arguments and the always-on Session-cwd fence prevent the call from selecting a broader path. Re-resolving canonical identity catches a symlink or path that now escapes the current applicable roots. Only after all three application body gates succeed does it call `processPath()` and Client Core. This second check is part of the accepted body and never emits a second `ask`.

Alternatives rejected:

- Calling `processPath()` after Session containment alone would bypass DSH's file-effect policy when Client Core writes with `node:fs`.
- Reconstructing DSH's sandbox controller or routing binary bytes through text mutation primitives would duplicate framework policy and invent a new filesystem abstraction.

### 3. Resolve and fence paths through the calling Session

Each of the three file-bearing tools requires `exec.agent.session.header.cwd`. After its applicable constructor gate, it resolves that cwd as the root and the requested path with `{ cwd, signal }`, verifies the root is a directory, and uses `ctx.fs.contains(root, target)` on provider-owned canonical identities. Each download check additionally resolves the current policy workspace root under `workspace-write` and requires both containments. A relative path, absolute path, `..`, or symlink is accepted only when its resolved target remains every applicable root or a descendant. Calls without Agent Session cwd fail rather than inherit the filesystem provider's default or `process.cwd()`.

Upload also stats the resolved source through `ctx.fs` and requires a regular file before authenticated resolution. Downloads may resolve an absent leaf; Client Core owns parent availability, destination existence races, private temporary output and commit behavior. The DSH adapter does not pre-create directories or files.

The adapter positively checks the exact-baseline public `LocalFileSystem` constructor before resolving any model path. Download does this before both preflight and body path work; upload does it in its approved body before source path work. E2B and unrelated providers fail with `workspace-local-filesystem-required`; the adapter never resolves their model paths or probes their process paths with Host `node:fs`. Only the body calls `ctx.fs.processPath(target)`, after identity and containment succeed. `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-fs-local`, `@deepseek-ai/dsh-sandbox` and `@deepseek-ai/dsh-sandbox-policy` at exact `0.1.1-rc.2` remain published external runtime dependencies, aligned with the Host baseline rather than bundled copies. The provider identity check uses the mounted constructor, while policy resolution uses the mounted public service and types rather than a copied policy model.

The process path is provider-canonical. Client Core may return that absolute canonical path as its existing `sourcePath`/`outputPath`; the tool does not manufacture a second display-path result. Because Client Core opens the canonical path rather than the caller's unresolved spelling, an accepted symlink resolves to its contained target identity. This Change does not promise a cross-process `openat`/directory-handle fence that neither current Core nor DSH rc.2 exposes.

Alternatives rejected:

- Treating `targetKey` or `displayPath` as a Host path violates the DSH filesystem contract.
- Checking whether `processPath()` happens to exist on the Host could confuse an E2B `/workspace/...` path with unrelated Host data.
- Adding a provider-neutral execution-world identity to DSH is upstream framework work and exceeds local first-version parity.
- Reading all source bytes with `ctx.fs.readBytes()` imposes a buffer cap and still has no symmetric binary write primitive.

### 4. Preserve Core transfer workflows and append optional signals

Client Core adds only backwards-compatible signal positions:

```text
Blob get(resourceId, signal?)
Blob upload(input, signal?)
Blob download(input, signal?)
Asset download(input, signal?)
```

The supplied signal reaches Blob/Asset HTTP requests, Asset signed content, source inspection/streaming, response streaming, destination writes and the check immediately before atomic publication. File operations that Node cannot interrupt check before and after; `discard()` remains non-cancellable so handles and private temp files are cleaned after cancellation.

Blob helpers receive the same signal for reserve, PUT, status, complete and Resource read-back. Loops check it before starting every step. The existing shared stable-identity helper accepts an optional signal to stop another attempt when cancellation is observed. If reserve returns transport `workspace-result-unknown` while that signal is aborted, the helper does not rethrow the transport error: it immediately creates the same final `workspace-result-unknown` envelope used after exhausted attempts, with `request` set to the supplied public upload intent, including `idempotencyKey`, canonical `sourcePath`, Space/parent/name/filename/size/media-type fields. It starts no next attempt.

Blob's nested PUT, complete, status and Resource read-back paths apply the same explicit wrapping at the operation owner. A cancelled PUT or complete failure carries the public intent plus the already known `uploadId` and current Upload Session `state`; a cancellation that arrives during a recovery status/read-back carries the same known identity. The wrapper omits the raw transport cause from the application error exposed to DSH and starts no further status, read-back, retry or completion call after observing cancellation. Without cancellation, the current three-attempt stable-idempotent recovery and read-back behavior remain unchanged.

Source streaming uses the initial stat byte size and an abort-aware stream. Download writing checks cancellation between chunks and before commit, then preserves the current exact-size/fsync/link-or-rename algorithm. If cancellation precedes publication, cleanup leaves the destination unchanged. Once an atomic rename/link has completed, Core may return confirmed success; DSH owns whether caller cancellation hides that success.

Existing CLI calls omit the signal. No overload, request object, filesystem interface, error taxonomy or DSH dependency enters Client Core.

### 5. Ask once for every allowed upload and download

One fiber-owned `tools/pre-execute` listener returns `ask` for upload only after its pure existing argument validator succeeds and for each download only after its policy/path preflight succeeds. It calls `next()` for Blob get and every unrelated tool. Upload creates remote product state; downloads create or replace local bytes. A fixed reason names only the operation and never includes a path, URL or argument value.

The definitions remain exclusive by omitting `isConcurrencySafe`. This avoids parallel writes to the same output path and parallel retries of one upload intent without introducing an application lock. Client Core's atomic no-clobber behavior still resolves races with other processes or tools.

`read-only` download denial happens before provider/argument/path inspection and emits no `ask`. Non-local download denial happens after the policy check but before argument/path resolution and also emits no `ask`. For constructor-proven modes, a malformed or out-of-bound download fails during the minimal preflight without asking; the body still runs the shared exact-own-key validation before credential/Core work and re-resolves current policy, provider identity and path before Host I/O. Rejected, cancelled, missing-channel and unavailable approval all fail before the body resolves a credential or performs Core/Host I/O. A malformed upload fails its pure argument validation without asking; an allowed upload keeps one transfer approval, then its body revalidates the immutable arguments before local identity, source-path, credential or HTTP work. There is no standing grant, approval bypass, double approval, sandbox escalation or special force path.

### 6. Reuse one secret-safe error adapter with a transfer allowlist

The existing DSH execution wrapper is extended with one file-transfer allowlist. It may preserve these Core/common codes:

```text
workspace-argument-invalid
workspace-invalid-response
workspace-result-mismatch
workspace-result-unknown
workspace-origin-mismatch
workspace-authentication-required
workspace-request-invalid
workspace-redirect-refused
workspace-resource-kind-mismatch
workspace-blob-source-unavailable
workspace-blob-source-invalid
workspace-blob-size-mismatch
workspace-blob-download-unavailable
workspace-blob-upload-terminal
workspace-blob-output-exists
workspace-blob-output-unavailable
workspace-blob-output-invalid-state
workspace-blob-download-write-failed
workspace-asset-size-mismatch
workspace-asset-output-exists
workspace-asset-output-unavailable
workspace-asset-output-invalid-state
workspace-asset-download-write-failed
workspace-file-policy-denied
UNAUTHENTICATED
INVALID_INPUT
FORBIDDEN
NOT_FOUND
CONFLICT
PAYLOAD_TOO_LARGE
INTERNAL_ERROR
```

Application-owned policy/path failures use `workspace-file-policy-denied`, `workspace-session-cwd-required`, `workspace-file-path-outside-session`, `workspace-local-filesystem-required`, or `workspace-file-operation-failed`. Policy denial has a fixed message and no path, root, provider or argument detail. Any other string/numeric service code becomes `workspace-file-operation-failed`; current Server Asset signing reports product HTTP codes, while its successful service envelope uses only `ErrorCode.OK`.

For allowed codes, exact detail fields cover stable operation identities, state, status, expected/actual byte sizes, Resource/Node/Upload/Operation IDs, safe requested/canonical paths, availability and capabilities. `cause`, original messages, headers, cookies, signed URLs, temp filenames, bytes, provider objects and unknown nested fields never cross. Unknown filesystem/provider/dependency failures use a fixed operation message and no source material.

Paths are not treated as credentials, but only the requested or already containment-checked canonical path may appear. Provider-default or Host launch paths never do. Tests plant credential and byte sentinels in errors, URLs and causes and inspect both results and Session events.

### 7. Share the Host owner and classify cancellation by side effect

The four bodies run through the existing single owner using `AbortSignal.any([exec.signal, owner.signal])`. Async download pre-execute path checks observe `exec.signal`; no preflight state survives their promise. Path resolution, authenticated resolution and the complete Core promise remain inside the existing body owner. The wrapper retains caller and owner sources so it can distinguish caller cancellation, owner disposal and a Core result-unknown failure.

Before remote/local dispatch, caller abort becomes `workspace-operation-cancelled`; owner-only abort becomes `workspace-plugin-disposing`. Blob get/download/Asset download are remote reads, so an abort-induced request unknown becomes the same source-specific cancellation after destination cleanup. Blob upload is a remote mutation: once reserve, PUT, status/read-back or complete may have dispatched, Core's public-intent-wrapped `workspace-result-unknown` remains authoritative, and neither Core after observing cancellation nor the DSH shell performs another request or attempt.

DSH rc.2 replaces any body-started success with `ABORTED` when the original caller signal is aborted before finalization. A total finalizer preserves that registry-owned identity and changes only content: upload guidance tells the Agent to inspect the Space/Blob identity before retrying; download guidance tells it to inspect the requested destination. It never claims Core success remained visible. Owner-only disposal does not abort ToolRuntime's caller signal, so a confirmed remote publication or local commit may still return success while disposal drains it; unknown upload remains unknown.

The one fiber-owned effect registers the four tools and transfer approval listener. Disposal marks the owner non-accepting, unregisters these contributions, aborts owner-controlled bodies and waits for every accepted body, then completes only after Core cleanup has closed streams/handles and removed temp files. Cordis unregisters the listener with its fiber, while ToolRuntime itself awaits any in-flight pre-execute promise. There are no Jobs, timers, detached retries, cached policy/path/bytes or second lifecycle/controller.

### 8. Test the source and installed artifact, not a file-shaped mock only

Client Core tests add abort-observing cases for metadata, every Blob recovery edge, public-intent wrapping at cancelled reserve/PUT/status/complete/read-back, absence of any later request, source streaming, signed content, response streaming, destination writing, pre-publication cancellation, cleanup and late confirmed publication. Existing no-signal cases and CLI command contracts remain unchanged.

Application tests use real Cordis `ToolRuntime`, local `FileSystem`/sandbox composition, sandbox-policy service, fake approval and fake credential/HTTP to cover closed schemas, direct unknown-key rejection, Session-cwd containment/symlink escape, confining-provider composition failure without policy, `read-only` denial before provider/ask/path/credential/body/I/O with preserved Harness error code, E2B-like/undefined-mode non-local denial before ask/resolve/contains/processPath/credential/Core/Host I/O, bare `LocalFileSystem` and in-process subclass constructor acceptance, `workspace-write` dual-root allowance/rejection, `danger-full-access` still confined to cwd, one-time approval ordering, provider/policy narrowing/widening and symlink drift between preflight/body, canonical results, overwrite/force, exact error allowlist, cancellation source, upload uncertainty, finalizer guidance and owner drain.

The built package verification confirms reachable Blob/Asset/file Core code is inlined while exact DSH/Cordis/filesystem/sandbox/sandbox-policy packages remain external, and excludes CLI source, worker/native/render/Office resources and future capabilities. The isolated tarball smoke installs the package, creates temporary Session workspaces, runs the same real ToolRuntime file paths under read-only, workspace-write, danger-full-access, bare-local and E2B-like/undefined-mode non-local compositions against keyless fake Workspace responses, proves pre-execute read-only keeps stable Harness error info before provider/path work, proves non-local gets zero ask/resolve/contains/processPath/credential/Core/Host I/O, narrows one approved call to read-only before its body, repeats the constructor gate before local output, inspects allowed bytes/permissions/temp cleanup, and disposes normally. It does not require a real account or access adjacent source checkouts.

## Risks / Trade-offs

- **The local provider identity is prerelease-specific** -> Pin `0.1.1-rc.2`, externalize one package instance, check the public constructor before model-path resolution and again before `processPath()`, test bare local plus in-process sandbox acceptance and E2B-like/undefined-mode rejection, and revisit when DSH publishes a provider-neutral execution-world identity.
- **Client Core `node:fs` bypasses DSH text-mutation policy checks** -> Resolve current Session policy before path/approval, fail closed under read-only or missing policy, require dual containment under workspace-write, and repeat current-policy/canonical containment immediately before exposing a Host path.
- **The policy or canonical path changes while approval is pending** -> Re-read current policy and the same immutable arguments in the body; narrower read-only denies, widening remains capped by Session cwd, and escaping symlink drift fails before Host I/O without a second approval.
- **A path changes after canonical containment** -> Pass the provider's canonical process path, reuse Core's regular-file and atomic destination checks, and make no stronger race claim than current public seams can enforce.
- **Cancellation arrives after a remote request or local publication** -> Preserve tool-owned upload uncertainty with the stable public intent and known Upload Session identity, start no later recovery request, let DSH own caller-aborted late success, and instruct inspection before retry.
- **Force can replace user data** -> Keep a separate explicit boolean, require per-call approval, and retain temp/fsync/atomic publication.
- **A safe code later gains unsafe detail** -> Project a frozen exact field allowlist; never forward original messages or causes.
- **Installed packaging resolves a second local-provider constructor** -> Keep exact DSH filesystem packages external and prove the mounted local/sandbox provider passes the installed identity check.

## Migration Plan

1. Complete and verify the shell, authentication and Space/Node prerequisite Changes.
2. Add optional signal propagation and focused cancellation cases to Client Core without changing no-signal callers.
3. Add the four tools, stateless download-policy/path preflight, body recheck, local path gate, schemas, single approval, error mapping and finalizers to the existing Host lifecycle effect.
4. Extend package verification and isolated installed ToolRuntime/local-file policy-mode smoke, then run Client Core, DSH, CLI and repository gates.

There is no persisted schema migration. Rollback unregisters the four tools and removes optional-signal call sites; existing remote Blob/Asset state and completed local files remain valid.

## Open Questions

无。会改变 tool names、local path范围、provider gate、approval、overwrite、signal/result-unknown 语义或 Change size 的决定均已由用户、现有 Client Core 行为与冻结 DSH source 收敛。
