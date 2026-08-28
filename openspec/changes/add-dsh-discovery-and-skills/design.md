## Context

Workspace CLI currently composes `createStandardApiReference()` from `@univer-cli/api-reference@1.0.0-beta.2` and a Node resource library backed by `@univer-cli/resource-library@1.0.0-beta.2` plus `@univerjs-pro/cli-assets@0.1.0`. These published packages already own reference lookup, manifest validation, stable visual-asset handles, HTTPS-only download, size limits and flat SVG export. Commander only parses and presents those outcomes, so `dsh-univer-work` can call the capability packages directly without changing Client Core or importing CLI application code.

Workspace CLI ships eight Skills. `add-dsh-worktree-unit-tools` already assigns the adapted `core` Skill to the DSH application; this Change owns the remaining seven. DeepSeek Harness rc.2 does not discover arbitrary packaged `SKILL.md` files: the Host must inject `skills` and explicitly call `ctx.skills.register()`. Runtime registration is first-wins within its layer, project providers may override it, and the exact returned disposer removes only the contribution it registered.

`add-dsh-file-transfer-tools` owns the positive local-filesystem proof, Session-cwd/current-policy gate and approval ordering for Host file writes. Resource export must use that seam because the published Node output adapter writes through `node:fs`, outside DSH filesystem mutation primitives. The other discovery operations read immutable packaged datasets and require neither Workspace credentials nor a remote Workspace connection.

## Goals / Non-Goals

**Goals:**

- Expose bounded structured API find/show and resource registries/find/export outcomes as five stable DSH tools.
- Keep API reference, resource manifest and seven Skills aligned with the plugin's exact SDK/package baseline.
- Register the seven Skill bodies through the native DSH catalog and remove them on Host disposal.
- Preserve local export policy, path safety, partial output truth, cancellation and secret-free installed behavior.

**Non-Goals:**

- Do not copy Commander rendering, create a docs server, add a discovery service abstraction or move discovery into private Client Core.
- Do not add API/resource data to the prompt eagerly, expose raw SVG in tool results, or add Skill catalog tools alongside DSH's existing `skill` consumer.
- Do not add remote/dynamic Skill download, cache administration, filesystem-provider abstraction, Web UI or publication machinery.

## Diagram design

```text
DSH Agent
  ├── five closed discovery tools
  │     ├── API find/show ─────────> packaged API reference
  │     ├── resource list/find ────> packaged SVG manifest
  │     └── resource export ─ ask ─> local Session-cwd SVG files
  └── DSH skill consumer
        └── ctx.skills registry ───> seven packaged, lazy-loaded instructions

same exact plugin artifact: tool names + SDK data + Skill guidance
```

## Decisions

### 1. Register five outcome-specific tools

The fixed surface is:

| Tool | Parameters | Canonical value |
| --- | --- | --- |
| `workspace_api_find` | `terms`, optional `unit`, `limit` | `{ terms }` with structured matches and totals |
| `workspace_api_show` | `symbols` | `{ results }` with the published found/not-found union |
| `workspace_resource_registries` | none | `{ registries }` |
| `workspace_resource_find` | `queries`, optional `registries`, `limit` | `{ resources, total }` |
| `workspace_resource_export` | `handles`, `output_directory` | `{ complete, exported, failed }` |

The adapter calls the capability packages, then projects their public results into explicit closed output shapes. It preserves API signatures, summaries, examples, inheritance/composition/type appendices, resource handles, group/tag metadata and intrinsic size. It omits resource source URLs, cache locations and export failure messages because Agents do not need them and they may disclose dependency or Host data. `workspace_api_show` preserves a not-found entry with suggestions as ordinary canonical data rather than converting it into a transport failure.

All parameter roots use `additionalProperties: false` plus exact own-key runtime validation. Terms, symbols, queries, registry IDs and handles are non-blank bounded strings. Arrays reject duplicates where repeated work has no meaning. The fixed budgets are:

```text
canonical arguments                       <= 64 KiB
API find terms                            1..8, each <= 160 characters
API find limit                            default 10, maximum 30 per term
API show symbols                          1..8, each <= 160 characters
resource queries / registries             1..8 / 0..8, each <= 160 characters
resource find limit                       default 30, maximum 100 total
resource export handles                   1..32
canonical API find/show result            <= 1 MiB serialized JSON
every other canonical discovery result    <= 256 KiB serialized JSON
```

The application measures canonical UTF-8 JSON after projection and fails without truncating a successful value. An API show overflow directs the caller to request fewer or narrower symbols; it does not return a structurally incomplete class/member. Rendering consumes only the validated canonical value. Native and Code Mode therefore see the same bounded JSON and never a Commander-formatted second copy.

A generic `workspace_discover` action was rejected because it weakens schema/tool routing. A resource-read tool returning SVG was rejected because export already provides the CLI outcome without putting up to 10 MiB of markup into Session content.

### 2. Keep four queries keyless and gate only export

API find/show and resource registries/find instantiate and query packaged immutable data without resolving Change 2 credentials, Workspace origin or HTTP. Each checks the fused caller/owner signal before and after synchronous dataset work; DSH still owns caller-abort finalization. Dataset construction/validation failure is a fixed plugin error and exposes no package path or raw manifest data.

`workspace_resource_export` is a local write and remote HTTPS read. Its `tools/pre-execute` listener reuses Change 5's exact ordering: resolve current policy for a confining filesystem; reject `read-only`; prove the exact public `LocalFileSystem` constructor before interpreting a model path; validate immutable arguments and every derived `<registry>--<resource>.svg` target under Session cwd and any current `workspaceRoot`; then return one fixed `ask`. It performs no download, cache/output write, `processPath()`, credential lookup or Workspace request in pre-execute.

The accepted body repeats current policy, provider identity, output-directory and all derived target checks from immutable arguments before `processPath()` and export. `danger-full-access` still retains the Session-cwd fence. Bare local is accepted only after constructor proof; E2B/remote providers fail. Existing flat SVG files may be replaced after approval, matching the published resource export outcome. Symlink identities must remain inside every applicable root during both checks; the design makes no stronger cross-process `openat` guarantee than Change 5.

No discovery tool asks for or reads a Workspace credential. The export policy listener delegates unrelated tools and the four read-only discovery names without an approval prompt.

### 3. Use the published resource workflow with one private temporary cache

The plugin resolves `@univerjs-pro/cli-assets/manifest.json` relative to its installed Host entry, loads and validates it through the resource-library public export, and creates its cache below one plugin-owned `mkdtemp()` directory. The directory is never exposed as a tool parameter/result and is removed after accepted exports drain during Host disposal. A custom cache/config service is unnecessary.

For each export call, the adapter supplies an HTTPS downloader whose `fetch` combines the library timeout signal with the fused caller/owner signal. The published library already processes handles sequentially and records per-handle export success/failure. Signal-aware cache/output wrappers check before and after each unabortable filesystem primitive, so cancellation starts no later handle download or publication; Host disposal still awaits an in-flight primitive and cleanup.

The canonical result retains every confirmed `{ handle, path }`, and failed entries retain only `{ handle, code }` from the frozen `ResourceLibraryErrorCode` set or `resource-export-failed`. `complete` is true only when no handle failed. Partial success is returned as data so the Agent does not replay already written handles blindly. If caller cancellation races confirmed output, rc.2 may replace the late result with `ABORTED`; fixed failure guidance tells the caller to inspect the approved directory before retrying. Confirmed files are not deleted during cancellation or disposal.

Alternatives rejected:

- Reimplementing manifest search, download validation or SVG naming would fork the published capability.
- A persistent cache location in Config would add an operator contract with no first-version outcome.
- Buffering SVG into tool output would spend Session budget and bypass the local file boundary.

### 4. Freeze a narrow discovery error projection

API/reference and dataset exceptions expose one of `workspace-discovery-invalid`, `workspace-discovery-result-too-large`, `workspace-discovery-dataset-invalid` or `workspace-discovery-failed` with fixed messages. Resource operations additionally preserve the published resource-library code set, `workspace-file-policy-denied`, `workspace-local-filesystem-required`, the existing path/file codes from Change 5, `workspace-operation-cancelled` and `workspace-plugin-disposing`.

Safe detail is limited to public query counts/limits, resource handles, exported paths already confined to Session cwd, and serialized byte counts/limits. Original messages, causes, stack traces, manifest/cache paths, source/download/redirect URLs, headers, file temporary names, credentials and unknown fields never cross the tool boundary. Export per-handle failures use the same allowlist; an unknown code becomes `resource-export-failed`.

### 5. Register exactly seven package-owned Skills

`apps/dsh-univer-work/skill-data` contains exactly these package-owned entries:

```text
base
board
cross-unit-formula
doc
embed
sheet
slide
```

Each begins from the matching CLI Skill's verified Facade/workflow knowledge, then replaces every CLI command, option, stdout/path instruction and `skills get` routing with the stable DSH tools delivered by accepted Changes 2–10. The `core` Skill is neither copied nor registered here. The application owns its rewritten files; runtime/package paths never import `apps/cli/src/*`, read the CLI artifact, or transform sibling application files during installation.

At Host activation the plugin reads and validates all seven package-relative files before registering any of them. It requires exact frontmatter `name` and non-empty `description`, strips frontmatter from the registered `content`, sets no `resourceBase` because these Skills have no supplemental files, and calls `ctx.skills.register()` once per entry. The registrations use the registry default model/user invocation policy and `runtime` provider. One fiber-owned effect returns the exact seven disposers in reverse registration order. No `registerProvider()`, invalidation, polling or network exists.

Skill tests treat the accepted installed tool catalog as authority: every `workspace_*` reference must name a registered tool, all seven files must teach DSH invocation rather than `univer-workspace-cli`, and instructions cannot claim Skills execute, authorize or validate operations. Project/user Skill override remains native DSH behavior; tool validation and approvals remain enforcement even when a Skill is shadowed.

### 6. Extend the existing owner and package closure only

The single Host owner from preceding Changes registers the five tools, one export approval listener and seven Skills, tracks accepted exports, owns the temporary cache, and rejects new work once disposal starts. Its disposer unregisters the listener/tools/Skills, aborts owner-controlled work, awaits every accepted body and unabortable cache/output finalizer, removes the cache, and leaves no promise, request, file handle or registration active.

The Host build inlines the two pure published discovery packages and their built-in API dataset. It keeps exact DSH/Cordis runtime packages external as established. The artifact declares exact `@univerjs-pro/cli-assets@0.1.0`, includes all seven Skill files, and resolves the resource manifest from the installed dependency; verification rejects bare private Core imports, CLI source/artifact reads, absolute checkout paths, sourcemaps and a second core Skill. The normal repository SDK-baseline check covers `@univer-cli/api-reference` and `@univer-cli/resource-library` at `1.0.0-beta.2`.

Source tests use real ToolRuntime and SkillRegistry. Installed smoke starts from an unrelated cwd/profile without a Workspace grant, verifies all four read-only discovery tools and the seven Skill catalog/load results, then exercises export with the mounted local filesystem/policy and a controlled HTTPS fixture. It asserts bounded Native/Code Mode results, approval/path rejection, partial export, caller abort, Skill/tool disposal and zero dependency on the monorepo checkout.

## Risks / Trade-offs

- **Skills drift from tool names or SDK declarations** -> Validate every tool reference against the installed catalog and package Skills with the same exact SDK cohort and API dataset.
- **A broad API query consumes excessive Session context** -> Bound fan-out and canonical bytes; reject overflow without truncating type information.
- **Resource export follows an unsafe Host path** -> Reuse the two-phase local constructor/policy/canonical-target gate for every derived file.
- **A resource download or file write outlives disposal** -> Fuse fetch signals, stop new sequential handles, track the accepted body and await unabortable primitives before cache cleanup.
- **Generic Skill names are shadowed by a project Skill** -> Preserve DSH's documented layer precedence; tools remain the enforcement boundary and installed smoke verifies the unshadowed package contribution.

## Migration Plan

1. Add exact discovery dependencies, five tools and focused bounded schema/result tests.
2. Add resource manifest composition, the Change 5 export path/approval seam and cancellation/partial-output tests.
3. Add and validate the seven rewritten static Skills, explicit registration and disposal.
4. Extend package closure/verification and run keyless isolated ToolRuntime/Skill/tarball smoke plus repository SDK/CLI gates.

No persisted Workspace data changes. Rollback unregisters the tools/Skills and removes their packed resources; exported SVG files already confirmed in a caller-approved directory remain caller-owned.

## Open Questions

无。会改变 tool names、Skill names、resource export semantics、result budgets、package closure或 Change size 的决定均由冻结 SDK/DSH source、前序 Changes 与已确认 parity 范围收敛。
