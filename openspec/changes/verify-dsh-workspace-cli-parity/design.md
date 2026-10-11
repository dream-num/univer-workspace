## Context

`apps/cli/src/program.ts` composes authentication, Space/Node, Worktree/Unit, review URL, Blob/Asset, content, Office, Typst, SVG, screenshot/layout lint, API/resource discovery and eight Skills into one installable Workspace Agent Client. Its config, Session, daemon socket and Commander tree are Client Shell mechanics; they are not additional Workspace product outcomes.

The twelve prerequisite Changes under `openspec/changes/add-dsh-*` assign the same product outcomes to 42 stable DSH tools and eight explicitly registered Skills. Each Change already owns its schemas, approvals, errors, cancellation, result-unknown behavior, package additions and focused installed smoke. This final Change adds no operation owner. It proves that the accepted parts compose into one artifact without drift or checkout fallback.

The comparison freezes Workspace `a01adf28bfdfbf098ecf66653d520d08ecac4117`, SDK `1.0.0-beta.2` and DSH `0.1.1-rc.2` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. `docs/research/deepseek-harness-plugin-development.md` supplies the DSH bundle/tool/Skill/package facts; `docs/research/dsh-univer-work-capability-migration.md` and `apps/workspace/CONTEXT.md` supply ownership and product vocabulary.

## Goals / Non-Goals

**Goals:**

- Keep one checked outcome manifest as the parity source for catalog, tests, package closure and documentation.
- Exercise every outcome through the real DSH dispatch boundary with deterministic fake authority and real packaged heavy runtimes.
- Install one prebuilt tarball into an isolated local profile and verify its complete runtime/resource closure, bounded size and repeatable disposal.
- Fail with the responsible prerequisite owner when a capability is incomplete.

**Non-Goals:**

- Add, repair or rename a tool, Skill, Client Core workflow or Server contract.
- Recreate Commander commands, config files, Session files or daemon control in DSH.
- Add Web UI, remote filesystem support, package publication, a release channel or a compatibility range.
- Use a real user account, model key or production Workspace in parity tests.

## Diagram design

```text
frozen apps/cli outcomes ─┐
12 accepted Changes ──────┼─> checked parity manifest
DSH rc.2 contracts ───────┘            │
                         ┌──────────────┼──────────────┐
                         ▼              ▼              ▼
                 registry/schema   behavior suites   package allowlist
                         └──────────────┼──────────────┘
                                        ▼
                              prebuilt tarball
                                        │ install
                                        ▼
                           isolated local DSH profile
                           load → exercise → dispose
```

## Decisions

### 1. Use one declarative manifest, not another adapter layer

The application keeps one typed data record that names every parity row, owner Change, exact operations or Skills, source evidence, expected consequential classification, acceptance case ids and required packaged resources. Tests, schema snapshots, package verification and README checks consume this record. It contains data only; it does not wrap tools or introduce a service abstraction.

The frozen mapping is:

| CLI outcome | DSH-native surface | Owner Change | Required evidence |
| --- | --- | --- | --- |
| install/start/stop | bundle layer, Loader row, Host lifecycle | `add-dsh-univer-work-plugin-shell` | tarball install/dump/start plus repeated dispose |
| browser approval, identity, logout | four `workspace_auth_*` tools and credential owner | `add-dsh-univer-work-authentication` | keyless handoff, authenticated identity, approved logout |
| Space browse/find and Node/Trash mutation | three `workspace_space_*` and four `workspace_node_*` tools | `add-dsh-space-node-tools` | discovery, closed schemas, approval/read-back/unknown |
| Worktree lifecycle, Unit membership/create, review URL | eight `workspace_worktree_*` lifecycle/discovery tools, three `workspace_unit_*` tools, `workspace_worktree_review_url` and `core` Skill | `add-dsh-worktree-unit-tools` | authoritative states, approval, stable identity, on-demand Skill |
| Blob/Asset transfer | `workspace_blob_upload/get/download`, `workspace_asset_download` | `add-dsh-file-transfer-tools` | bounded local streams, signed content, atomic output |
| structured read and Draft Facade write | `workspace_content_inspect`, `workspace_content_execute` | `add-dsh-content-runtime-tools` | real packaged worker, commit/read-only scopes, result unknown |
| Office import/export | `workspace_office_import`, `workspace_office_export` | `add-dsh-office-exchange-tools` | real native binding, type matrix, atomic output |
| Typst compile/Doc create | `workspace_typst_compile`, `workspace_typst_apply` | `add-dsh-typst-generation-tools` | real compiler/materializer, deterministic output, local artifacts |
| SVG compile/Slide apply | `workspace_svg_compile`, `workspace_svg_apply` | `add-dsh-svg-generation-tools` | real compiler, estimate/browser measure modes, Draft apply |
| PNG and Slide layout verification | `workspace_screenshot`, `workspace_layout_lint` | `add-dsh-render-verification-tools` | real installed render page/browser, atomic PNGs, lint findings |
| Facade API discovery | `workspace_api_find`, `workspace_api_show` | `add-dsh-api-resource-discovery-tools` | credential-free offline query and closed result |
| SVG resource discovery/export | `workspace_resource_find`, `workspace_resource_registries`, `workspace_resource_export` | `add-dsh-api-resource-discovery-tools` | offline query plus approved bounded export |
| Unit/topic guidance | `base`, `board`, `cross-unit-formula`, `doc`, `embed`, `sheet`, `slide` Skills | `add-dsh-bundled-unit-topic-skills` | exact packed bodies, tool-reference drift gate, load/dispose |
| browser install/probe/resolve | operator deployment preflight; no model operation | `add-dsh-render-verification-tools` | installed real-browser package smoke and README prerequisite |
| resource cache path/clear | no-retention resource design; no cache to manage | `add-dsh-api-resource-discovery-tools` | two independent queries/exports retain no disk cache |
| password login flags | browser approval is the supported authentication outcome | `add-dsh-univer-work-authentication` | no password parameter/tool plus two-stage handoff |
| review viewer override | review URL uses current grant authoritative origin | `add-dsh-worktree-unit-tools` | closed schema rejects viewer URL/origin override |

CLI-only mechanics receive explicit native substitutions rather than tools: origin and Login Session state live in the authentication credential owner; daemon start/status/stop becomes Cordis activation/disposal; version/help and JSON/text output become installed package, registry/schema and canonical-value evidence; `skills list/get/path` becomes DSH Skill catalog and consumer behavior. The validator inventories every production root/subcommand, positional argument, option and result form. Each item must be classified as a mapped product argument/result, a named DSH-native shell mechanism, or presentation-only evidence; it fails on an unclassified surface so future CLI additions cannot silently bypass parity review.

Alternatives rejected:

- A snapshot generated only from the DSH catalog would prove self-consistency while missing a CLI outcome.
- Calling the CLI during tests would make the plugin depend on the client it is replacing.
- One test file per Commander command would freeze delivery syntax and duplicate prerequisite behavior tests.

### 2. Snapshot complete schemas and index behavior cases

The catalog gate activates the complete plugin with empty project/user Skill roots, enumerates package-owned tool and Skill contributions, normalizes deterministic fields and compares the full checked snapshot. Tool names, descriptions, parameter JSON Schema and output JSON Schema are included. DSH rc.2 does not store consequential metadata on `ToolDefinition`; the gate joins the frozen manifest classification with each registered definition, then sends invalid and valid arguments through the real `tools/pre-execute` chain to prove pre-approval validation and ask/deny/allow or delegation. Runtime function source, registration order artifacts and generated ids are excluded because they are not public behavior.

The manifest points each outcome and cross-cutting contract to existing prerequisite test fixtures or a thin final composition case. Final tests do not reproduce every owner scenario. They prove one success per outcome row and select at least one final-boundary case for each applicable approval, allowlisted/unlisted error, caller/owner cancellation, result-unknown/no-replay, secret and non-local rule. Missing case ids fail manifest validation.

### 3. Split deterministic authority from real heavy runtime closure

The keyless suite uses real DSH dispatch, registries, temporary local DSH filesystem and plugin lifecycle with empty credentials, no model key and no external public network. It covers load, authentication handoff presentation through an isolated deterministic loopback endpoint, offline discovery, all Skills, validation/approval denial and disposal.

The authenticated suite stores an owner-valid grant through the real credential service and serves deterministic loopback Workspace HTTP, Collaboration HTTP/WebSocket, approval and asset responses. It drives each authenticated outcome through public application/Core boundaries. Files use the real temporary local DSH filesystem service; content uses the packaged worker and runtime child; Office uses the installed native exchange binding; Typst and SVG use their real compilers; screenshot/lint use the installed render page and browser runtime; datasets, assets and Skills come from the installed package. Only remote authority/transport, approval responses, credential records and fixture data are controlled. No fixture implements the operation being tested or imports an application/private source path.

One small fixture corpus is reused across routes: a Space with Nodes, one Blob, one Worktree containing representative Sheet/Doc/Slide Units, deterministic snapshots/changesets/assets, a minimal Office round-trip file, Typst bundle and SVG. Fixtures remain test-only and never enter the tarball.

### 4. Treat approval, cancellation and uncertainty as parity dimensions

Each manifest row declares applicable dimensions instead of assuming all tools share the same policy. The gate verifies the existing owner behavior at the final DSH boundary: validation before approval, fail-closed approval, caller versus owner cancellation, dispatched-write uncertainty, confirmed partial files, late-success replacement by DSH, secret projection and non-local rejection.

This keeps the final gate honest without manufacturing a universal retry or rollback policy. A failure reports the owner Change and case id. Implementation returns to that owner; this Change never patches the tool in its parity test.

### 5. Verify the actual tarball and all reachable resources

Package verification starts from the packed manifest entries, Host entry and worker entry, traverses static bare imports and package-relative resource references, and compares them with an allowlist of file classes and exact declared externals. Dynamic resources that static traversal cannot prove—runtime child, native binding, browser page/assets, discovery datasets and Skills—are explicit manifest resources and must exist.

The installed smoke uses `dsh plugin --profile <temporary> add <absolute-tarball>` with a unique temporary `DSH_HOME`, verifies bundle membership and `--dump-config`, changes to an unrelated cwd, then runs keyless and authenticated suites. It forbids monorepo `NODE_PATH` or source resolver fallback. Cleanup removes only the exact temporary root in a `finally` path.

### 6. Use a fixed budget derived from the frozen CLI artifact

`npm pack apps/cli/package-dist --dry-run --json --ignore-scripts` at the frozen baseline reports `13,029,788` packed bytes, `58,137,751` unpacked bytes and `203` entries. The plugin gate rounds these to fixed ceilings of `16 MiB`, `64 MiB` and `256` entries. This permits manifest, DSH adapter and Skill overhead while preventing accidental source maps, test fixtures, duplicate runtime chunks or checkout copies.

The gate records actual totals and largest entries. It never rewrites the budget or allowlist automatically. If a required published runtime legitimately exceeds a ceiling, a later planning decision must change the contract; deleting required resources is not an acceptable optimization.

### 7. Prove lifecycle reuse, then project only passing facts into docs

The in-process smoke activates and disposes the entire application three times. After each dispose it checks package-owned registry contributions, tracked bodies and volatile runtimes are gone; the next activation must start from the exact catalog. A valid owner GrantRecord deliberately remains in the credential provider across dispose/restart and is removed only by logout. The test harness owns fixture reset between cases; plugin disposal must not erase persistent authentication. A separate process smoke verifies normal DSH termination within the existing bounded deadline.

The README parity section is a small checked projection of manifest categories, exact counts, baseline, local-only boundary, package limits and non-goals. Human wording may remain hand-written, but identifiers and claims must match the executable manifest. A failed gate prevents `parity complete` wording.

## Risks / Trade-offs

- **The final suite duplicates prerequisite tests and becomes slow** -> Reuse their fixtures and case ids; add only composition assertions and one representative success per outcome row.
- **Fake services accidentally replace product behavior** -> Permit controlled responses only at loopback Workspace/Collaboration authority/transport plus approval and credential endpoints; require real temporary local DSH filesystem, real DSH dispatch, production parsers, Core paths and packaged heavy runtimes.
- **Full browser/native smoke is platform-sensitive** -> Resolve concrete dependencies exactly as prerequisite Changes specify and run on a supported local CI host; unsupported platforms fail packaging rather than silently skipping.
- **A schema snapshot creates noisy diffs** -> Normalize only nondeterministic registry metadata; preserve the full externally visible schemas and require deliberate review for changes.
- **The size budget becomes stale after an intentional dependency upgrade** -> Keep it fixed to this baseline; update it only in the Change that upgrades and re-verifies the SDK/DSH cohort.
- **A CLI-only command is mistaken for a missing product capability** -> Require the manifest to classify every production command as product outcome or delivery mechanic, with an explicit DSH-native route for the latter.

## Migration Plan

1. Require all twelve prerequisite Changes to be implemented and verified; stop with owner diagnostics otherwise.
2. Add the checked parity manifest and validate all CLI outcome classifications, operation names, Skill names, owner paths and case ids.
3. Add catalog/schema, keyless/authenticated behavior, package closure/size and lifecycle gates.
4. Pack once, install that exact tarball into the isolated profile and run the full smoke from an unrelated cwd.
5. Update responsibility documentation only after every gate passes, then run repository and existing CLI package gates.

Rollback removes the final manifest/gates and parity-complete documentation. It does not roll back any prerequisite capability or remote state.

## Open Questions

无。会改变冻结 baseline、42-tool/8-Skill catalog、outcome mapping、fake/real boundary、size budget或前置 owner 职责的决定均已由已确认范围与 accepted Changes 收敛。
