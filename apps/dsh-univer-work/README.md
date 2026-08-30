# dsh-univer-work

`dsh-univer-work` is the private DeepSeek Harness Client Shell for Univer
Workspace. The current package is a prebuilt Host-only bundle for local DSH
profiles. It owns the DSH package manifest, Cordis Loader row, and Host
lifecycle entry, one Workspace authentication record, four auth tools, seven
Space/Node tools, twelve Worktree/Unit/review tools, four file-transfer tools,
two worker-backed content tools, two Office exchange tools, two Typst generation
tools, two SVG generation tools, two render-verification tools, and five installed discovery tools:

- `workspace_auth_start({ origin })` starts one browser approval and returns only
  its same-origin URL, user code, and expiry.
- `workspace_auth_complete({})` performs one exchange after the user confirms
  approval; it never polls.
- `workspace_auth_whoami({})` reads the Server-authoritative current User.
- `workspace_auth_logout({})` requires DSH human approval and clears the local
  credential even when the remote result is unknown.
- `workspace_space_list({})`, `workspace_space_browse(...)`, and
  `workspace_space_find(...)` provide read-only Space discovery.
- `workspace_node_create(...)`, `workspace_node_rename(...)`,
  `workspace_node_move(...)`, and `workspace_node_trash(...)` require DSH human
  approval before every mutation.
- `workspace_worktree_list(...)`, `workspace_worktree_get(...)`, and
  `workspace_worktree_review_url(...)` discover drafts and construct review URLs
  from the current authenticated Workspace origin.
- `workspace_worktree_create(...)`, `workspace_worktree_update(...)`,
  `workspace_worktree_ready(...)`, `workspace_worktree_reopen(...)`,
  `workspace_worktree_merge(...)`, and `workspace_worktree_discard(...)` own the
  Worktree lifecycle.
- `workspace_unit_list(...)`, `workspace_unit_add(...)`, and
  `workspace_unit_create(...)` list membership, stage an existing Univer
  Resource, or create a Worktree-local Sheet, Doc, Slide, Base, or Board.
- `workspace_blob_get({ resource_id })` reads one Blob Resource and its owning
  Node without approval.
- `workspace_blob_upload(...)` uploads one Host-local regular file inside the
  calling Agent Session cwd after one-time approval.
- `workspace_blob_download(...)` and `workspace_asset_download(...)` write one
  Host-local file inside that cwd after one-time approval.
- `workspace_content_inspect(...)` reads bounded canonical content from a Trunk
  or Worktree Unit without approval.
- `workspace_content_execute(...)` runs bounded Facade code only against a Draft
  Worktree Unit after one-time approval and returns its canonical value and
  confirmed revision state.
- `workspace_office_import(...)` converts one approved Host-local Office file
  and creates one new Worktree-local Sheet/Base, Doc, or Slide Unit.
- `workspace_office_export(...)` converts one authoritative Worktree Unit head
  and atomically publishes one approved Host-local Office file.
- `workspace_typst_compile({ artifact_directory, bundle_path, render_previews? })`
  compiles one approved Host-local Typst Source Bundle without resolving a
  Workspace credential or creating a Unit.
- `workspace_typst_apply({ artifact_directory?, bundle_path, idempotency_key?,
  parent_node_id?, render_previews?, space_id, worktree_id })` compiles once,
  materializes once, and creates one Doc Worktree-local Unit; previews require
  `artifact_directory`.
- `workspace_svg_compile({ source_path, page?, add?, estimate_text_size?, output_path? })`
  compiles one Host-local SVG and its relative assets into an editable Slide
  program, optionally publishing the approved generated-code file.
- `workspace_svg_apply({ source_path, page, unit_id, worktree_id, add?,
  estimate_text_size?, output_path? })` compiles once and applies that exact
  program once to a Draft Slide after one combined approval.
- `workspace_screenshot(...)` renders one bounded Sheet, Doc, Slide, Board, or
  Base target from a Trunk or Worktree Unit and publishes PNG files inside one
  approved Host-local Session directory.
- `workspace_layout_lint(...)` returns one complete structured layout report
  for selected pages of one Worktree Slide without file approval or output.
- `workspace_api_find(...)` and `workspace_api_show(...)` query the immutable,
  version-matched installed Facade API reference without a Workspace grant.
- `workspace_resource_registries({})` and `workspace_resource_find(...)` query
  stable visual-resource metadata without network, approval, cache, credentials,
  or local output.
- `workspace_resource_export(...)` downloads requested catalog handles over
  HTTPS and atomically publishes confirmed SVG files inside one approved,
  Session-cwd-confined Host-local directory.

Every tool exposes a closed parameter schema and returns a bounded canonical
value. Each remote Workspace workflow resolves a fresh authenticated HTTP
capability for its execution and sends only Workspace HTTP requests; the plugin
does not duplicate Workspace routes or response parsing. Mutation approval text
contains the operation identity, never the submitted arguments or credentials. The eight
Worktree/Unit mutations (create, update, ready, reopen, merge, discard, Unit
add, and Unit create) also require one-time DSH approval. Their exact-key,
type, enum, and cross-field validator runs before approval and again inside the
accepted body. Merge and discard use separate fixed high-impact prompts.

The plugin stores either a pending device grant or an authenticated Login
Session under the single DSH Credentials key `dsh-univer-work/workspace`.
Device codes, Session cookies, complete grant payloads, dependency errors, and
passwords do not enter tool arguments, results, rendering, Config, or durable
Session content. A fresh authenticated HTTP capability is resolved from the
credential record for each operation. Client and owner cancellation propagate
through credential resolution, HTTP, pagination, traversal, mutation, and
read-back. Disposal stops admission, unregisters tools and listeners, aborts
active bodies, and drains them before completing.

Worktree, Unit, and review Core methods accept an optional operation signal.
Stable-identity create/add retries keep one identity and stop before a new
attempt after cancellation. Lifecycle transitions are never replayed and use
one read-back after an uncertain response. Unconfirmed writes remain
`workspace-result-unknown`; tool output directs the Agent to Worktree get/list
or Unit list before deciding what to do next.

Blob get/upload/download and Asset download accept an optional operation
signal. Upload retains one idempotency identity through bounded recovery;
cancelled dispatched writes remain `workspace-result-unknown` with the complete
public upload intent and known Upload Session identity. Downloads use private
`0600` temp files and atomic publication. Existing destinations remain unchanged
unless `force: true` is explicit.

File-bearing tools accept only the public `LocalFileSystem` constructor or an
in-process subclass. Paths resolve against the calling Agent Session cwd and
must remain canonically inside it. A confining filesystem also requires the
rc.2 sandbox-policy service: `read-only` denies downloads; `workspace-write`
requires both the current policy root and Session cwd; `danger-full-access` and
bare LocalFS still require Session-cwd containment. Downloads repeat policy,
provider identity, and path checks in the approved body. The plugin does not
escalate policy or interpret remote/E2B paths as Host paths.

Office import accepts `.xls`/`.xlsx`, `.doc`/`.docx`, and
`.ppt`/`.pptx`/`.pptm`/`.ppsx`/`.ppsm`/`.potx`; export accepts only compatible
Sheet/Base→`.xlsx`, Doc→`.docx`, and Slide→`.pptx` outputs. CSV, Board, legacy
export suffixes, replacement import, Trunk export, and caller-selected export
type or revision are unsupported. Both tools require one DSH approval. Import
checks the current local provider and Session cwd only inside the approved body,
then limits actual source bytes and final UnitData to 52,428,800 bytes and 64
levels before creating one Worktree-local Unit. Export repeats the current file
policy, local-provider and containment checks after approval, selects one
authoritative Worktree head, synchronizes that exact revision, applies the same
UnitData limits, and uses a private `0600` same-directory temp plus atomic
publication. Existing output is preserved unless `force: true` is explicit.

Caller and owner cancellation propagate through source reads, target/runtime
work, native conversion, Unit create, and output cleanup. Native conversion is
not interruptible, so the tool waits for it to settle and checks the signal
before starting the next step. A dispatched import create returning
`workspace-result-unknown`, `workspace-result-mismatch`, or
`workspace-invalid-response` is never converted or submitted again; fixed
guidance requires `workspace_unit_list` and `workspace_worktree_get` inspection
before any manual action. A late export cancellation similarly requires
destination inspection and prohibits automatic replay.

Both Typst tools have closed arguments and require one operation-specific DSH
approval. They accept only the current in-process `LocalFileSystem`, resolve the
bundle and optional artifact directory within the calling Session cwd, require
the bundle and output roots to be disjoint, and repeat provider, cwd, policy,
containment, and destination checks after approval. They do not accept inline
Typst, generated JavaScript, arbitrary Facade code, caller-selected filenames,
`force`, a remote filesystem, or compiler/runtime options. The destination must
be absent; the tools never overwrite, merge, rename, or remove an existing
artifact directory.

The fixed artifact layout is:

```text
<artifact_directory>/
  program.js
  diagnostics.json       # { "schemaVersion": 1, "diagnostics": [...] }
  previews/              # present only when render_previews is true
    *.png
```

Canonical results contain only validated diagnostics, preview metadata, and
Session-relative paths; generated JavaScript and PNG bytes remain in local
files. Compile always returns `committed: false` and performs no Workspace
mutation. If native compilation returns structured error diagnostics, compile
still publishes the complete fixed layout for inspection. Apply with error
diagnostics returns `workspace-typst-diagnostics`, removes its private compiler
state, publishes no artifact directory, and starts no materialization or Unit
create. Run the separate compile tool first when local failure artifacts are
needed.

Artifact work starts in a randomized mode-`0700` private sibling directory. The
tool records the identity of each private file and directory it creates; cleanup
removes only still-matching recorded files and then attempts non-recursive
removal of known directories. Publication atomically reserves the absent public
directory with mode `0700`, creates only the known `previews` child when needed,
and publishes each known file no-clobber with file and directory sync. Another
process may briefly observe the reserved directory before every file is present.
Once reservation succeeds, the tool performs no destructive public cleanup.
Any later failure preserves the partial directory and returns only its
Session-relative path with inspect/no-replay guidance. Random names, mode `0700`,
no-clobber publication, and identity/layout/size checks handle ordinary races;
they do not isolate either private or public files from hostile tampering by a
process running as the same OS UID.

Apply uses the current authenticated Workspace connection and current license,
then compiles once, materializes once, and calls Unit create once. The Unit is
confirmed before optional artifact publication. Error diagnostics and
materialization failures therefore occur before create. An unconfirmed create
keeps the exact safe request identity under `workspace-result-unknown` and
requires `workspace_unit_list` inspection without replay. If a confirmed Unit
is followed by artifact validation, publication, or cancellation failure, the
tool returns `workspace-typst-partial-side-effect` with the Unit identity and
artifact state, preserves any public partial directory, and neither deletes the
Unit nor recompiles, rematerializes, or recreates it.

Each materialization runs the exact installed compiler output in a separate Node
VM context with invocation-local deterministic `Math.random` and
`crypto.getRandomValues`. The VM isolates those program-local random sources; it
is not a hostile-code sandbox and the tools never accept caller-supplied code.
Equivalent inputs promise equal semantic content only after a test-side
projection excludes SDK-owned opaque paragraph, section, list, and range IDs.
The saved UnitData keeps those IDs unchanged and the product path never applies
that projection.

The frozen native compiler and generated program cannot be hard-cancelled. The
Host awaits any started call, checks cancellation at each later separable
boundary, performs private cleanup, and starts no later materialization, create,
or publication step after observing cancellation. A fully confirmed result that
loses the final caller race remains DSH `ABORTED` with inspect/no-replay
guidance. Owner disposal unregisters both tools and drains native, VM, HTTP,
file, and cleanup work; Typst adds no Job, timer, retry, listener owner, or
worker.

Limits are fixed and never truncate success: 524,288 canonical argument bytes;
52,428,800 bytes each for generated JavaScript, materialized UnitData, and total
actual artifacts; UnitData and canonical result depth 64; 256 previews;
7,864,320 bytes for the predictable apply-visible compiler projection plus a
524,288-byte closed Unit/result envelope; and 8,388,608 canonical result bytes.
The installed package resolves the exact
`@univerjs-pro/doc-typst-native-binding` wrapper and platform optional packages
from the exact installed Typst facade owner. The Typst path needs no system
Typst executable, external font directory, browser, content worker, adjacent
checkout, model key, or real Workspace account for its package smoke.

SVG tools resolve one source and compiler-requested relative assets inside the
calling Session cwd through the current local filesystem policy. Compile needs
approval only when it publishes `output_path`; apply always needs one approval
covering the optional file and remote Draft mutation. Estimation is the explicit
browserless mode and retains its warning lint. Real measurement reuses the
package-relative render page, current license and configured installed browser.

Apply saves the exact in-memory program before executing it once. A confirmed
file followed by failure returns `workspace-svg-apply-partial`; an unconfirmed
commit remains `workspace-result-unknown`. Both outcomes require inspection and
prohibit automatic recompile, replay, overwrite, or deletion. The tools accept
no inline SVG, URL asset, caller-provided code, Trunk target, origin, credential,
license, render path, revision, Job, daemon, or detached work.

Render tools reuse the authoritative Unit loader, current credential and
license resolvers, package-relative render page, and one browser process per
operation. Screenshot output defaults to `screenshots` below the Session cwd.
The Host proves the requested directory against the current file policy, local
filesystem provider, Session cwd, and workspace root before approval and again
inside the accepted body. Layout lint reads one Worktree Slide head and creates
no Host-local file effect.

Screenshot publication never overwrites an existing path and creates confirmed
PNG files with mode `0600`. Tool results contain paths and metadata, never PNG
bytes. A partial result lists only the exact files already published from the
approved canonical candidate set. Inspect those files before a manual retry;
the Host does not recapture them. Caller cancellation remains the result ceiling
after dispatch, while the owner awaits any started browser/native operation and
browser close before settling.

The package does not install a browser or own a browser cache. Operators select
a supported installed browser with `UNIVER_RENDER_BROWSER` when automatic
discovery is insufficient. Chromium starts with `--no-sandbox`; deployment must
therefore run the Host as a restricted OS user or container with bounded
filesystem and network access. Human approval and Host-local path policy do not
provide process isolation. Browser versions and installed system fonts can
change screenshot pixels and lint measurements.

Content tools use one lazy, current worker-backed runtime generation. The Host
passes the packaged worker entry, current authenticated cookie, and a non-empty
`UNIVER_LICENSE` override or the synchronized development credential; none of
those values enter tool output. Credential replacement drains and closes the
old generation before later work starts. Inspection accepts only the documented
closed query unions and enforces selector, safe-area, depth, and output budgets.
Execution repeats its exact argument and code limits inside the approved body,
accepts only an editable Draft target, and validates its result before render.

Facade code is intentionally present in DSH-owned tool-call and Code Mode
argument fields so the Harness can dispatch it. Durable Session storage may
therefore retain that code. Do not put credentials or other secrets in content
code. Cancellation stops before later runtime, upload, replacement, or commit
steps where possible; a confirmed embedded-image upload remains
`workspace-content-partial-side-effect`, and an unconfirmed commit remains
`workspace-result-unknown`. Both results direct the Agent to inspect the
Worktree and content before any manual next action and prohibit automatic code
replay.

The package includes and explicitly registers eight static, model- and
user-invocable operational Skills. `core` teaches the delivered authentication,
Space/Node discovery, new-Worktree-per-task, same-task rework, Unit staging or
creation, ready/read-back/review, and explicitly authorized merge/discard
workflow. Seven Unit/Topic Skills cover Base, Board, cross-Unit formulas, Doc,
Embed, Sheet, and Slide through the exact installed DSH tool names. They add no
filesystem provider, root, watcher, network lookup, or eager prompt content.

Discovery queries enforce fixed fan-out and canonical byte budgets. Each
accepted resource export owns its no-retention downloader, signal, output state,
and 32 MiB cumulative response budget while retaining the public 10 MiB
per-resource cap. It reuses the current file-effect policy, exact public
LocalFileSystem proof, Session cwd and workspace-root containment, and one-time
approval. Confirmed files use same-directory private `0600` temps, complete
write and sync, and atomic replacement. Cancellation starts no later handle and
leaves confirmed files caller-owned; inspect the approved directory before any
manual retry.

The tool boundary preserves the documented Client Core and Workspace Server
error-code allowlists with a small JSON-safe detail allowlist. Other failures
become `workspace-operation-failed` without copying provider, transport, header,
cookie, cause, or grant material; file-transfer failures use the narrower fixed
`workspace-file-operation-failed`. A dispatched mutation whose authoritative
result cannot be determined remains `workspace-result-unknown`. A caller-aborted
late mutation success remains a DSH `ABORTED` result with fixed guidance to
browse/find the Node, get/list the Worktree, or list its Units as appropriate,
and never replay the mutation automatically. A late Blob upload directs the
Agent to inspect the target Space and Blob identity; a late local download
directs it to inspect the requested destination before any manual retry.

The supported topology has one live local Host owning this key and no file,
provider, or process writer that bypasses that Host. The plugin cannot detect
or coordinate multiple Hosts or out-of-band mutation. One active origin is
supported: complete or run approved logout before starting another origin.

The shell has no password tool, DSH authorization service or UI, Jobs,
background polling, remote filesystem or inline/base64 transfer, inline Typst
or caller-provided JavaScript execution, generic document generator or artifact
service, inline/base64 SVG or URL assets, browser download/cache,
shared browser pool, attachment capture, Trunk layout lint, new lint rules,
non-PNG render output, Web Client, Settings, Slots, overlays, or Client-to-Host
remotes. It
does not invoke or read state from `univer-workspace-cli`.

The source version remains `0.0.0` and the package remains `private: true`.
Packing and isolated installation verify the artifact; they do not define a
registry, release channel, or public compatibility promise. The verified
baseline is DeepSeek Harness `0.1.1-rc.2` at commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, Cordis `4.0.1`, and the
repository's exact Univer SDK cohort `1.0.0-beta.2`; no other release is
currently supported.

The packed Host declares its DSH/Cordis Service Definition imports as exact
optional peers. A DSH profile supplies those packages through its installation
module fallback, so the plugin and Host share one Cordis/tool runtime identity.
The package does not install a second Harness runtime graph into the profile.

## Frozen Workspace CLI parity

<!-- parity-manifest-projection:start -->
Baseline: Workspace `a01adf28bfdfbf098ecf66653d520d08ecac4117`, Univer SDK
`1.0.0-beta.2`, DeepSeek Harness `0.1.1-rc.2` at
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

| Outcome | Owning Change | Tools | Skills |
| --- | --- | ---: | ---: |
| `shell` | `add-dsh-univer-work-plugin-shell` | 0 | 0 |
| `authentication` | `add-dsh-univer-work-authentication` | 4 | 0 |
| `space-node` | `add-dsh-space-node-tools` | 7 | 0 |
| `worktree-unit` | `add-dsh-worktree-unit-tools` | 12 | 1 |
| `file-transfer` | `add-dsh-file-transfer-tools` | 4 | 0 |
| `content` | `add-dsh-content-runtime-tools` | 2 | 0 |
| `office` | `add-dsh-office-exchange-tools` | 2 | 0 |
| `typst` | `add-dsh-typst-generation-tools` | 2 | 0 |
| `svg` | `add-dsh-svg-generation-tools` | 2 | 0 |
| `render` | `add-dsh-render-verification-tools` | 2 | 0 |
| `api-discovery` | `add-dsh-api-resource-discovery-tools` | 2 | 0 |
| `resource-discovery` | `add-dsh-api-resource-discovery-tools` | 3 | 0 |
| `unit-topic-skills` | `add-dsh-bundled-unit-topic-skills` | 0 | 7 |

The manifest contains 13 outcome groups, 42 tools, and 8 Skills.

Fixed package limits: 16,777,216 packed bytes,
67,108,864 unpacked bytes, and
256 entries. Frozen package evidence
`task7-final-before-doc-projection-gate` measured
12,945,659 packed bytes,
57,929,107 unpacked bytes, and
123 entries. `package:verify` obtains the live
measurement from one `npm pack --dry-run --json --ignore-scripts` inspection,
prints it, and enforces the fixed limits. The frozen packed-byte evidence is a
named run, not a self-referential equality constraint on this README's gzip
bytes.

All filesystem and process effects run in the local DSH Host execution world
through its in-process `LocalFileSystem`, Agent Session cwd, packaged workers,
native bindings, compilers, and explicitly selected installed browser. Remote
or E2B filesystem path interpretation is outside this contract. Installed
parity tests use isolated loopback authorities; production remote workflows
still call the configured authenticated Workspace origin, and resource export
uses the documented HTTPS registries.

Parity covers Workspace outcomes rather than a second Commander interface.
DSH profile and credential storage, Cordis lifecycle, catalog inspection,
canonical tool values, and operator deployment replace CLI-only configuration,
Session, daemon, presentation, version/help, resource-cache, password-input,
viewer-origin, and browser-installation mechanics. This Change adds no CLI
command or artifact, package publication, Workspace Server, Browser, OpenAPI,
database, deployment, SDK-baseline, or release-workflow contract.
<!-- parity-manifest-projection:end -->

## Development

```bash
pnpm --filter dsh-univer-work typecheck
pnpm --filter dsh-univer-work test
pnpm --filter dsh-univer-work build
pnpm --filter dsh-univer-work package:verify
pnpm --filter dsh-univer-work package:smoke
pnpm --filter dsh-univer-work package:smoke:restricted
```

`package:smoke` installs the built tarball into a temporary `DSH_HOME`, verifies
the effective local profile, registers all four auth, seven Space/Node,
twelve Worktree/Unit/review, four file-transfer, two content, two Office, two
Typst, two SVG, two render, and five discovery schemas plus all eight bundled Skills from the
installed package, and exercises Native list/load, the real Skill consumer, and a
real Agent Loop scheduler and installed Code Mode
dispatch. For file transfer, the smoke covers bare LocalFS and the real
in-process sandbox subclass, workspace-write dual-root and danger-mode
Session-cwd fences, read-only and non-local rejection, approval denial and
body-time policy/provider changes, closed arguments, exact source/upload and
download bytes, no-clobber/force, dispatched-upload uncertainty, stream/temp
cleanup, owner drain, and a keyless secret-free transcript. It also exercises
Worktree lifecycle, review handoff, cancellation, and result-unknown. The
installed content matrix runs Trunk and Worktree inspection, no-mutation and
confirmed execution with read-back, dispatched commit uncertainty, credential
rotation, Agent Loop and Code Mode dispatch, worker disposal, and the exact
worker-child/native-binding package closure. The discovery matrix runs four
keyless queries without a Workspace grant, controlled local TLS export with no
credential headers or public-network fallback, complete and partial results,
caller cancellation, Agent Loop and Code Mode dispatch, owner drain, remount,
and output/temp cleanup. The Office matrix resolves the exact native binding
from the installed converter owner, runs a real XLSX export/import round trip,
checks Doc/Slide converter wiring, actual-source and UnitData limits, exact-head
revision mismatch, all three non-confirmed create outcomes without replay,
approval/policy rejection, `0600` atomic no-clobber/force output, Native Agent
Loop and Code Mode results, cancellation, owner drain, remount, and temp cleanup.
The Typst matrix resolves the exact native wrapper and current-platform package
from the installed facade owner, runs real-native compile with diagnostics and
optional previews, and uses fake Workspace HTTP for licensed semantic apply,
result-unknown recovery, confirmed-Unit artifact partials, budgets,
no-clobber, cancellation, owner drain, remount, and private/public cleanup
boundaries. It proves that the Typst path starts no browser or system Typst
process. The SVG matrix compiles nested relative assets from an unrelated
Session cwd in estimate and real-browser modes, saves and applies the same
program once against fake Workspace/Collaboration endpoints, and covers
file-confirmed partial, commit uncertainty, caller cancellation, owner drain,
model-visible secrecy, and browser/worker cleanup. The render matrix uses a real installed browser and package-relative
render page to cover PNG screenshot publication, Slide layout lint, missing
browser, source/asset/runtime/capture/lint failures, exact partial output,
caller cancellation, credential rotation, owner drain, and browser close. The
smoke then starts a fresh Host, requests normal shutdown, and
removes only that temporary root. No real account or credential is used.

`package:smoke:restricted` runs the same installed-package smoke in a disposable
Linux arm64 Docker profile. The image uses a fixed base digest; the container
runs as UID/GID `65532`, with a read-only root, no network, no capabilities,
`no-new-privileges`, bounded processes, memory, CPU, `/tmp`, and `/dev/shm`.
`/tmp` is `exec,nosuid,nodev`: the installed package must load native `.node`
bindings from its disposable profile. It is the only general-purpose writable
filesystem; `/dev/shm` is a fixed-size browser shared-memory tmpfs. The build
stage prewarms pnpm metadata and content, then the offline runtime seeds only
the three exact current-platform optional packages named by the installed
`-binding` owners into that disposable profile. This runner changes no product
manifest, production sandbox, host user, or host package.
