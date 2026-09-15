## Context

Workspace CLI composes `createStandardApiReference()` from `@univer-cli/api-reference@1.0.0-beta.2` and a Node resource library backed by `@univer-cli/resource-library@1.0.0-beta.2` plus `@univerjs-pro/cli-assets@0.1.0`. These published packages already own reference lookup, resource manifest validation, stable visual-asset handles, HTTPS-only download, redirect limits, SVG validation and flat export naming. Commander only parses and presents their outcomes, so the DSH Client Shell can consume the capability packages without importing CLI application code or changing Client Core.

`add-dsh-file-transfer-tools` owns the positive Host-local filesystem proof, calling Session cwd/current-policy gate and approval ordering. Its atomic publication lives inside Blob/Asset Client Core workflows and is not a generic application helper. Resource export therefore reuses only the DSH policy/path seam and adds the minimum SVG-specific same-directory publisher in this application. API/resource queries only read immutable packaged datasets and need neither Workspace credentials nor a Workspace connection.

The previous combined `add-dsh-discovery-and-skills` draft exceeded Tina's size gate. This Change retains only its discovery capability; `add-dsh-bundled-unit-topic-skills` owns the seven static Skills independently.

## Goals / Non-Goals

**Goals:**

- Expose API find/show and resource registries/find/export as five stable DSH operations.
- Keep reference and resource data aligned with the exact plugin SDK baseline.
- Keep every operation credential-free, while enforcing local file policy and one-time approval for export.
- Bound search fan-out, canonical results and downloaded SVG bytes, preserve partial confirmed files, and drain accepted work on disposal.

**Non-Goals:**

- Do not add Skills, copy Commander rendering, create a docs server, add a discovery service abstraction or move discovery into Client Core.
- Do not expose raw SVG in tool results, add persistent cache/configuration, or add a cache-management tool.
- Do not add remote filesystem support, a generic binary artifact seam, Web UI, Jobs or publication machinery.

## Diagram design

```text
DSH Agent
  ├── api find/show ───────────────> packaged API reference ──> bounded JSON
  ├── resource registries/find ───> packaged SVG manifest ───> bounded JSON
  └── resource export
        └── policy + local cwd + ask + body recheck
              └── HTTPS read, no-retention adapter
                    └── app-local atomic SVG publisher ──────> Session-cwd SVG files
```

## Decisions

### 1. Register five outcome-specific tools

The fixed surface is:

| Tool | Parameters | Canonical value |
| --- | --- | --- |
| `workspace_api_find` | `terms`, optional `unit`, `limit` | `{ terms }` |
| `workspace_api_show` | `symbols` | `{ results }` |
| `workspace_resource_registries` | none | `{ registries }` |
| `workspace_resource_find` | `queries`, optional `registries`, `limit` | `{ resources, total }` |
| `workspace_resource_export` | `handles`, `output_directory` | `{ complete, exported, failed }` |

The adapter projects package results into explicit closed shapes. API results preserve the published found/not-found unions, signatures, summaries, inheritance/composition/type appendices and spelling suggestions. Resource results preserve stable handles, public names/group/tags/keywords/order/intrinsic size/color-editability. They omit source URLs, manifest records, cache/package paths, raw SVG and dependency messages.

Every parameter root uses `additionalProperties: false` and the shared exact-own-key runtime wrapper. Native and Code Mode receive the same validated canonical JSON; `output.render` derives only from that value. A generic action tool and inline resource-read result are omitted because the five outcomes have different schemas and only export needs an effect boundary.

### 2. Apply fixed query, result and asset budgets

The application fixes these limits:

```text
canonical arguments                         <= 64 KiB
API find terms / API show symbols            1..8, each <= 160 characters
API find limit                               default 10, maximum 30 per term
resource queries / registry filters          1..8 / 0..8, each <= 160 characters
resource find limit                          default 30, maximum 100 total
resource export handles                      1..32 unique values
canonical API find/show result               <= 1 MiB serialized JSON
every other canonical discovery result       <= 256 KiB serialized JSON
single accepted export downloaded SVG total  <= 32 MiB
single SVG download                          <= published 10 MiB default
```

The adapter measures complete UTF-8 JSON after closed projection and rejects overflow without truncating a success. API not-found remains canonical data. The injected fetch wraps every response body consumed by the public downloader and subtracts each received chunk from one call-owned 32 MiB counter before forwarding it. Bytes remain charged when a later step rejects UTF-8/SVG, the request aborts, or publication fails; a failed handle therefore cannot reset the budget for the next handle. Each request also retains the published 10 MiB per-resource cap.

A per-resource overflow is non-terminal when cumulative capacity remains: that handle fails and the next handle receives the remaining cumulative allowance. A response whose `Content-Length` exceeds the cumulative remainder is rejected before its body and marks the call budget terminal. A response that completes exactly as chunks consume the remainder may still validate and publish, but it marks the budget terminal before another handle; a chunk that exceeds the remainder fails the current handle and also marks it terminal. Terminal budget state prevents every later network request, while already confirmed outputs remain in the partial result. This differs from an ordinary 10 MiB resource failure, which may continue. Limits are constants, not Config, because the first-version installed dataset and Session budget are frozen.

### 3. Keep all operations keyless and gate only local export

At Host activation the plugin loads the built-in API reference and opaque installed resource manifest through public exports, then creates one shared query-only resource library so public construction validates the manifest before any tool registration. This pure initialization creates no filesystem cache, local output, credential, timer or network request. API find/show and resource registries/find query these immutable instances after caller/owner signal checks; they never resolve Change 2 authentication.

The export `tools/pre-execute` listener follows Change 5's ordering. It resolves current policy for a confining filesystem and rejects `read-only`; proves the exact public `LocalFileSystem` constructor before interpreting the model path; validates exact argument shape, handle syntax/fan-out and the output directory; confirms only that directory's identity under Session cwd and any current `workspaceRoot`; then returns one fixed `ask` covering the immutable handle list and directory. The public resource library exposes no side-effect-free handle-to-filename resolver, so pre-execute does not read private manifest structure, assert handle existence or derive target filenames. It also does not call `processPath()`, inspect/create the directory, resolve a credential, read a source URL, download, create cache state or write output.

The accepted body repeats exact arguments, current policy, provider identity and output-directory containment from immutable arguments. Only after this recheck may it convert that directory to a Host path and ask the public resource library to export one handle. The library alone resolves handle existence and its canonical flat filename. Before writing, the output adapter requires that filename to be a single basename, resolves the target below the rechecked directory, and repeats Session/policy containment; it never parses private manifest data or rewrites the library naming rule. Existing flat target files may be atomically replaced as part of the approved outcome. Policy/provider/directory changes while approval waits fail without a second ask. Every operation, including export, remains independent of Workspace origin and credentials.

### 4. Use no-retention resource adapters instead of a filesystem cache

The published resource library requires cache/downloader/output adapters, but this Client Shell has no user-visible cache outcome. The shared activation instance is query-only and uses inert adapters solely for fail-closed validation/list/find. Every accepted export body constructs a new call-owned ResourceLibrary from the same opaque loaded manifest, repeating public validation if required, and supplies its own no-retention cache, downloader, output, signal, counter and revalidated directory closure. No mutable current-call field, singleton adapter, AsyncLocalStorage or cross-call lookup routes one export's state into another.

The no-retention cache adapter always misses, retains no write, and clears as a no-op. Neither shared queries nor call-owned exports create `mkdtemp`, cache directories, watchers or cleanup contracts. Concurrent calls cannot share signal, byte budget, directory, temporary filenames or partial results; the Host owner tracks only their accepted body promises.

For one accepted export, the adapter calls the published batch export with one handle at a time. A signal-aware response-body wrapper around the public HTTPS downloader fuses the caller/owner signal and charges every consumed chunk, including bytes from downloads that later fail. The output adapter accepts only the public library's single basename after its own root containment check, then writes a same-directory unpredictable `0600` temporary file, writes and synchronizes the complete validated SVG, checks cancellation immediately before publication, atomically renames it over the target, and removes only that private temporary file on failure. This helper belongs to `apps/dsh-univer-work`; it does not claim to call the Blob/Asset Core publisher. One-handle calls let the outer loop stop before the next download after cancellation and retain confirmed files without reimplementing manifest lookup, handle resolution, export naming, HTTPS validation or SVG validation.

The closed result records confirmed `{ handle, path }` entries and allowlisted `{ handle, code }` failures. `complete` is true only when all requested handles confirm. Normal per-handle failures continue sequentially; caller/owner cancellation starts no later handle and does not delete caller-owned confirmed outputs. DSH rc.2 may replace a body success racing caller cancellation with `ABORTED`, so fixed guidance requires inspecting the approved directory before a manual retry.

### 5. Freeze a narrow discovery error projection

API/reference failures expose only fixed discovery invalid/result-too-large/dataset-invalid/failed codes. Resource operations preserve the published `ResourceLibraryErrorCode` allowlist plus Change 5's file-policy, local-world, Session-cwd, containment/publication, cancellation and disposing codes. Unknown package, network, filesystem or output failures become one generic fixed failure.

Safe detail is limited to public counts/limits, handles, paths already confined to Session cwd and serialized byte counts. Original messages, causes, stacks, package/manifest locations, source/download/redirect URLs, headers, response bodies, temporary filenames, credential-shaped material and Host paths outside Session cwd never cross Native results, Code Mode settlement, rendering or approval text.

### 6. Extend the existing owner and installed artifact only

The existing Host owner registers five tools and one export approval listener, rejects new bodies once disposal begins, fuses its owner signal into each call-owned export and tracks every accepted body until downloads and atomic file finalizers settle. Disposal unregisters the listener/tools, aborts owner-controlled work and drains those promises. It does not mutate or clean a shared current-call adapter, cache or AsyncLocalStorage because none exists; an export's private closure becomes unreachable after its body settles.

The Host build inlines the two pure published discovery packages and built-in API dataset, keeps exact DSH/Cordis runtime packages external, and resolves `@univerjs-pro/cli-assets/manifest.json` from the installed dependency export. Verification rejects CLI source/artifact reads, Commander packages, a bare private Core import, adjacent checkout paths, Skills and unrequested Web/runtime resources.

Source tests use real ToolRuntime. Installed smoke starts from an unrelated cwd/profile without a Workspace grant, exercises four keyless queries and one controlled-HTTPS approved export through Native and Code Mode, and verifies budgets, denial/recheck, partial output, abort, tool/listener cleanup and load/dispose without monorepo fallback.

## Risks / Trade-offs

- **Repeated exports download the same SVG again** -> The first version owns no cache outcome; add a persistent cache only when measured download cost justifies its storage, invalidation and cleanup contract.
- **A broad API query consumes Session context** -> Bound fan-out and complete canonical bytes; fail rather than truncate signatures or type information.
- **Resource export follows an unsafe Host path** -> Preflight the directory only, then validate the public library basename and repeat current Session/policy containment inside the output adapter before each private temporary write.
- **Cancellation races a confirmed file** -> Stop before the next handle, keep confirmed caller-owned files and instruct the caller to inspect before retrying.
- **Parallel exports mix budget or destination state** -> Construct every export library and adapter set inside its accepted body; share only immutable validated query data and owner-level promise tracking.
- **Installed data drifts from runtime SDK** -> Pin exact packages and verify their closure in the packed tarball and repository SDK-baseline gate.

## Migration Plan

1. Add exact discovery dependencies and pure installed dataset initialization.
2. Register the four keyless query tools and their bounded closed projections.
3. Add approved local resource export using the existing file policy/path gate, an application-owned minimal atomic SVG publisher and no-retention adapters.
4. Extend installed package verification/smoke and run repository SDK/CLI gates.

No persisted Workspace data or cache migration exists. Rollback unregisters the five tools; already confirmed SVG files remain caller-owned.

## Open Questions

无。tool names、budgets、keyless behavior、no-cache policy、local export boundary 与 package closure 已由冻结 package/DSH source、前序 Changes 和已确认拆分收敛。
