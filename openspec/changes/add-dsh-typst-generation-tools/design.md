## Context

`WorkspaceCompileTypstFeature` already calls exact `@univer-cli/doc-typst-facade@1.0.0-beta.2` once, returns generated JavaScript/diagnostics/previews, blocks apply on error diagnostics, materializes one semantically deterministic Doc and delegates staged Unit creation to `WorkspaceUnitFeature`. Workspace CLI keeps Commander validation and writes `--out` followed by `--diagnostics-out`; Client Core deliberately owns neither CLI path presentation nor a generic artifact store.

Changes 4–6 plan the shared Unit create signal/result-unknown contract, local `LocalFileSystem`/Session-cwd gate, authenticated/license resolver and one Host fiber lifecycle. DSH rc.2 tools require closed input/output schemas and explicit pre-execute approval; its runtime turns a successfully returned late body value into `ABORTED`, while a body-thrown structured failure keeps its tool error. The frozen Typst compiler accepts no signal and may write previews during its native call, so cancellation can stop later steps but cannot abandon or interrupt that call.

The current materializer temporarily replaces process-global random functions around generated program execution. That is adequate for the single-process CLI command but would let concurrent DSH Host work observe deterministic random values. Node's built-in VM context can give the exact compiler-generated program private deterministic intrinsics without adding a worker or dependency. `docs/research/dsh-typst-runtime-rng-seam-2026-08-29.md` confirms that beta.2 Host Facade/Core ID allocation still reads Host random intrinsics through module-lexical functions and that no later unified SDK release adds a public injection seam. The VM therefore controls compiler-program-local randomness, while semantic equality excludes SDK-generated opaque paragraph/section/list/range identities. This context is not treated as a hostile-code sandbox.

## Goals / Non-Goals

**Goals:**

- Expose compile-only and compile-plus-apply as two operation-specific DSH tools while preserving compile-once, diagnostics and staged Doc outcomes.
- Keep generated JavaScript and PNG bytes out of DSH canonical/session content; publish a fixed artifact directory safely inside the calling Session cwd.
- Preserve Unit create stable identity/result-unknown, total cleanup, optional cancellation and exact native runtime delivery.
- Remove Typst's process-global deterministic-random mutation with a per-invocation standard-library context and preserve deterministic semantic content plus existing CLI-visible output.

**Non-Goals:**

- Do not build a generic document generator, renderer, artifact service, task queue, native-operation wrapper or second runtime owner.
- Do not accept arbitrary JavaScript or promise that Node VM makes exact compiler output safe against a compromised compiler.
- Do not add a Typst worker, system Typst executable, font configuration, browser preview path or remote filesystem adapter.
- Do not change Commander options, upstream bundle schema/compiler/native binding or Workspace Server contracts.
- Do not rewrite, remove or synthesize SDK-generated opaque paragraph/section/list/range identities in persisted UnitData.

## Diagram design

```text
DSH Session cwd
  bundle/typst.json
         │ local gate + one approval
         ▼
workspace_typst_compile / workspace_typst_apply
         │
         ├── exact Core compiler ──> private artifact directory
         │                                  │
         │                    mkdir 0700 reserve + no-clobber files
         │                                  ▼
         │                           public artifacts
         │
         └── apply only: private program-random VM context
                              │ complete Doc UnitData
                              ▼
                     shared Unit create ──> Workspace Server
```

## Decisions

### 1. Use two tools and one fixed artifact directory

`workspace_typst_compile` owns local compilation and requires `artifact_directory`. `workspace_typst_apply` owns the consequential staged-Doc outcome and accepts optional `artifact_directory`; `render_previews: true` requires that directory. Both accept `bundle_path`; only apply accepts Worktree, Space, parent and idempotency identity.

This split makes approval and failure guidance operation-specific without recreating Commander. A directory replaces arbitrary `--out`/`--diagnostics-out` combinations:

```text
<artifact_directory>/
  program.js
  diagnostics.json       # { schemaVersion: 1, diagnostics }
  previews/              # only when requested
```

Successful canonical values contain paths and metadata, not `javascript` or PNG bytes. The tool constructs an exact projection instead of spreading the Core result. Caller-selected filenames, `force` and inline Typst are omitted; a caller can choose a fresh directory when it wants another result. This is enough for CLI outcome parity and avoids a multi-file overwrite/recovery protocol.

When compilation itself returns error diagnostics, compile publishes the ordinary layout and returns `committed: false`. Apply returns bounded diagnostics, removes its private preview/output directory and publishes nothing. A recognized thrown compiler/translation failure follows the same cleanup rule. Callers that need local diagnostic files or previews first invoke the separate compile tool; apply does not own a second failure-artifact shape.

### 2. Reuse the Change 5 local gate and publish through a reserved directory

Pure exact-key/type/cross-field/argument-budget validation runs before async policy. The pre-execute branch positively checks public `LocalFileSystem` identity, normalizes Session-relative model paths, enforces lexical containment and disjoint bundle/output roots, checks current read/write effect policy, verifies the destination is eligible and asks once with fixed text. It neither explicitly calls `processPath` nor derives, retains or emits a Host path before approval, and it retains no path or policy object across approval.

The accepted body repeats current provider, cwd, policy, containment and absence checks, then and only then converts the normalized targets with explicit `processPath`. It creates a mode-restricted private directory beside the destination, passes its `previews` child to Core, writes program/diagnostics there, validates actual byte totals and preview metadata and syncs completed private files. Publication atomically reserves the still-absent destination with `mkdir(..., { mode: 0o700 })`, creates a known `previews` child only when needed, and publishes each known file with no-clobber semantics followed by file and directory sync. This standard-library contract prevents replacing a competing destination on macOS without adding a native helper, while accepting that an observer may briefly see the reserved directory with only some files.

The compiler stage uses a randomized mode-`0700` private sibling directory and records its directory identity plus every file identity it creates. Before publication, a non-cancellable finalizer may remove a recorded private file only while its current identity still matches, then remove known private directories from the inside out with non-recursive `rmdir`. Once the public destination has been created, the shell performs no destructive cleanup beneath it. Any later write, sync, size, identity, cancellation or publication failure preserves the partial directory and returns a bounded structured failure with its Session-relative path and inspect/no-replay guidance. Canonical artifact and preview paths are derived only from the normalized Session-relative destination, so an accepted cwd-contained absolute caller input never reappears in a canonical value, render, approval, event or error detail.

The first version protects against accidental collisions and ordinary concurrent destination creation through no-clobber operations and identity checks. It does not claim isolation from a malicious process running as the same OS UID, which can access mode-`0700` paths and race after any check. That stronger boundary requires a separate user/container or a platform-specific atomic primitive and is outside this Change.

The frozen compiler remains authoritative for `typst.json`, page, prelude, asset, traversal and symlink rules. The shell does not duplicate its bundle parser. DSH adds only outer Session containment and post-compile budgets.

### 3. Keep Core compile-once composition and make post-create artifact failure explicit

The DSH body calls the existing Core `execute()` once. Core checks the optional generated-program and Client Shell-visible projection limits after compilation, gates apply diagnostics, materializes once, checks optional UnitData limits and delegates one Unit create. Splitting Core into public `compile` and `applyCompiled` phases would expand its API only to change shell write ordering, so this Change does not add them.

For apply with artifacts, Core can therefore confirm the staged Unit before the shell publishes the local directory. A later local failure returns `workspace-typst-partial-side-effect` with only the confirmed Worktree/Unit identity and artifact publication state. The shell cleans private files, does not compensate by deleting the Unit, and never reruns compile or apply. This is preferable to hiding a confirmed Workspace side effect or adding a cross-system transaction that does not exist.

Apply without artifacts returns immediately after Core confirmation. Error diagnostics and materialization failures occur before Unit create. A Unit create mismatch/invalid-response/result-unknown propagates directly with inspection guidance and no local publication as ordinary success.

### 4. Thread cancellation through separable boundaries and await native/program work

Core adds optional signal to Typst input/materializer input and forwards it to Change 4 Unit create. It checks before compiler entry, after the compiler settles, before/after materializer creation and exact program execution, before save/normalization and before Unit create. The frozen compiler and a generated async program do not accept a signal; Core never races them against a rejection that would let work continue after the public promise settles. It waits, performs total runtime/context cleanup and starts no later step after observing cancellation.

The shell passes a fused caller/owner signal through local gate, Core and file work and tracks the body until all native, VM, HTTP and cleanup work settles. Caller abort before dispatch remains DSH `ABORTED_BEFORE_DISPATCH`. A tool-owned `workspace-result-unknown` or `workspace-typst-partial-side-effect` throw remains that structured failure. A completely confirmed body value that loses the final race to caller cancellation becomes rc.2 `ABORTED`; the total finalizer appends inspect guidance without changing the DSH identity. Owner-only disposal does not abort the caller signal, so a fully confirmed accepted body may return success while disposal drains it.

No automatic replay, poll, background Job or timer is introduced. If measured compile duration later exceeds ordinary tool-call constraints, a separate Change can add Jobs without changing the compile/apply owner.

### 5. Use a per-invocation Node VM context for program-local random values

`HeadlessWorkspaceTypstMaterializer` accepts optional license and passes `license ?? ""` to the existing disposable headless Doc factory. DSH resolves the current Change 6 license for apply only; compile-only does not resolve credential or license. License never enters arguments, results or error projection.

The materializer replaces `new Function` plus process-global random descriptor patching with Node's built-in VM compilation/context. Each invocation exposes the guarded Host `univerAPI`, an invocation-local `Math.random` and `crypto.getRandomValues` backed by the existing JavaScript-source stable seed. The compiler-generated program therefore receives an independent deterministic sequence and Host globals remain untouched. Calls that enter the Host Facade/Core continue to receive valid SDK-generated opaque paragraph/section/list/range identities from Host random intrinsics; exact values may differ between materializations.

The persisted UnitData retains those identities unchanged. Determinism tests compare copies after removing only the known SDK-owned opaque paragraph/section/list/range identity values; the projection is test-only and is neither returned nor used to rewrite stored content. The existing exactly-one-Doc lifecycle guard, target identity, `save()`, `rev: 1`, name selection and `finally` disposal remain unchanged.

The VM context is an isolation mechanism for random intrinsics, not a security sandbox. Only exact JavaScript from the exact installed compiler reaches it, after user approval; model arguments cannot supply code. The application still relies on the existing guarded Facade contract and restricted Host deployment. A worker would add a new entry, message protocol and shutdown owner without improving the required outcome, so Typst neither adds nor uses one.

### 6. Fix DSH budgets and project errors instead of reflecting dependencies

The tool uses the established `512 KiB` canonical argument and `8 MiB`/depth-64 canonical result limits. DSH supplies separate optional Core limits of `50 MiB` for generated JavaScript and materialized UnitData. Before apply materialization or Unit create, Core also canonicalizes the DSH-visible target/title/diagnostics/preview fragment and limits it to `7.5 MiB`/depth 64; the closed Unit projection plus result envelope is capped at the reserved `512 KiB`, so every schema-valid complete value fits `8 MiB`. A Server response outside that reserved closed envelope is invalid response after a confirmed create, not a pre-computable result overflow. The shell separately limits at most 256 previews and `50 MiB` actual total artifacts. Limits never truncate output; CLI omits the optional controls and retains current behavior.

The adapter maps exact facade categories to fixed plugin codes: invalid manifest/path, compile/translation, preview and runtime-unavailable. Bounded compiler diagnostics retain only their frozen schema and Session-relative contained source paths. Workspace/file/limit/runtime/result-unknown codes use prior allowlists. Original messages, native loader details, absolute/temp/dependency paths, source, generated program, UnitData, PNG bytes, credential, license, stack, cause and unknown fields never cross; unrecognized material becomes `workspace-typst-operation-failed`.

### 7. Extend the installed closure with the facade-owned native binding only

The package build tree-shakes and inlines reachable private Core, `@univer-cli/doc-typst-facade`, TypeScript printer and headless JavaScript. Package assembly resolves the exact installed facade through the Client Core manifest, verifies its exact SDK version, reads its concrete `@univerjs-pro/doc-typst-native-binding` dependency and declares that exact wrapper with its platform optional packages in the packed manifest. It neither infers a version from pnpm hoisting nor copies an adjacent checkout.

The native package is the only new Typst runtime resource; it owns semantic evaluation and PNG preview rendering and requires no system Typst binary or separate font directory in this baseline. Change 6's existing formula binding remains available to the direct headless materializer, but the Typst path does not use the content worker or add an entry/worker-child. Package verification rejects bare private Core/`workspace:*`, absolute source paths, CLI source/Session/daemon and system Typst commands, and confirms that the Typst reachable graph adds no SVG capability, browser entry/resource or separate font directory; the package's existing Render closure remains separately verified and intact.

Source tests use real Cordis ToolRuntime with fake Workspace HTTP for identity/error races and the real native binding for a small bundle. The isolated tarball smoke installs the package in a fresh local profile, changes to an unrelated Session cwd and exercises compile artifacts plus semantic-deterministic apply without a model key or real account.

## Risks / Trade-offs

- **The frozen native compiler cannot observe cancellation** -> Await it, cap downstream artifacts, clean private output and start no later work after cancellation; make no hard-cancel claim.
- **A confirmed staged Unit can precede local artifact failure** -> Return structured partial-side-effect identity, preserve the destination and require Unit inspection; do not add compensation or replay.
- **Node VM could be mistaken for a hostile-code sandbox** -> Accept only exact compiler output, keep the existing Facade guard and document that VM only isolates compiler-program-local globals.
- **Opaque SDK identities differ between equivalent runs** -> Preserve them unchanged in UnitData and compare only a test-side semantic projection; do not claim byte-identical snapshots.
- **Compiler diagnostics or paths expose Host details** -> Validate the frozen diagnostic schema, require relative contained source paths and replace unknown/native material with fixed errors.
- **Native/platform dependency is missing from the tarball** -> Resolve it from the installed facade owner, inspect every platform reference and run an unrelated-cwd real-native smoke.
- **Output publication is not an all-files visibility transaction** -> Atomically reserve the destination, publish each known file no-clobber and document the brief partial-directory visibility window; do not add a native rename-exclusion dependency in the first version.
- **Public cleanup can race replacement content** -> Never delete from a public destination after reservation; preserve partial artifacts and return Session-relative inspect guidance.
- **A same-UID process can tamper with private or published files** -> State this first-version threat boundary explicitly; use randomized mode-`0700` staging, no-clobber publication and identity checks for ordinary races, and defer hostile same-UID isolation to a separate user/container design.

## Migration Plan

1. Complete and verify Changes 1–6; confirm their tool owner, Unit create signal, local file gate and current license resolver match this design.
2. Extend Core Typst inputs/materializer with optional signal, budgets and license; move compiler-program-local deterministic execution to a per-invocation VM context while retaining semantic content and existing CLI-visible behavior tests.
3. Register the two tools and approval branches in the existing Host effect; add exact schemas, local artifact publication, safe error projection, cancellation, private-stage cleanup and preserved-public-partial finalizers.
4. Add the exact facade-owned native dependency to package assembly and run source, Core/CLI compatibility and isolated tarball real-native checks.

There is no persisted schema or Workspace data migration. Rollback removes the two tool registrations and optional Core call sites; existing Typst bundles, local artifacts, Worktree Units, CLI packages and credentials remain valid.

## Open Questions

无。会改变tool names、artifact layout、approval、limits、VM/worker choice、Unit side-effect ordering、native closure或Change size的决定均已由确认范围和冻结source收敛。
