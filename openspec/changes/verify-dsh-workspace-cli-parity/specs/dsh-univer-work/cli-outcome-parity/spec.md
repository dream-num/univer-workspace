## Purpose

定义冻结 Workspace CLI outcome 与 DSH-native operation/Skill surface 的完整映射，以及预构建 `dsh-univer-work` tarball 必须通过的安装闭包、行为、大小、生命周期和文档 gate，使首版 parity 成为可重复验证的交付事实。

## ADDED Requirements

### Requirement: Frozen outcome baseline is complete and executable

The parity gate SHALL derive one checked manifest from Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`, SDK `1.0.0-beta.2`, DeepSeek Harness `0.1.1-rc.2` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, the `apps/cli` production composition and tests, and the twelve accepted `add-dsh-*` prerequisite Changes. Every CLI product outcome MUST have exactly one DSH capability owner and one executable acceptance route; DSH-native replacements for CLI-only delivery mechanics MUST be identified explicitly.

#### Scenario: Every product outcome has an owner

- **WHEN** the checked manifest is validated
- **THEN** it covers browser approval and identity, Space/Node/Trash, Worktree/Unit/review URL, Blob/Asset transfer, content inspect/execute, Office exchange, Typst, SVG, screenshot/layout lint, API/resource discovery, and eight bundled Skills
- **AND** every row names one prerequisite Change, its exact tool or Skill surface, and at least one source or installed acceptance case

#### Scenario: A baseline outcome is missing or multiply owned

- **WHEN** a CLI product outcome has no DSH route, more than one authoritative owner, an unknown owner, or an operation absent from that owner's accepted spec
- **THEN** the parity gate fails and identifies the owner Change without adding a replacement operation

#### Scenario: CLI delivery mechanics are exhaustively classified

- **WHEN** the validator inventories every production root/subcommand, positional argument, option and result form from the frozen CLI composition
- **THEN** it maps origin configuration and Session persistence to the current plugin-owned authenticated grant, daemon control to Cordis Host lifecycle, version/help and JSON/text presentation to installed package/catalog/canonical-value evidence, and Skill list/get/path to native Skill discovery
- **AND** it maps `screenshot setup` install/probe/resolve to operator-owned browser deployment preflight plus installed real-browser smoke, `resources cache path/clear` to the DSH no-retention design, password login options to browser approval with no password tool, and `open --viewer-url` to the current grant's authoritative origin with no caller override
- **AND** every remaining CLI-only input or output form is classified by a checked rule as a product argument/result, a DSH-native shell mechanism, or presentation-only evidence rather than being decided ad hoc during implementation
- **AND** no classification requires a matching Commander command, CLI subprocess, CLI Session file, daemon socket, resource cache, model-triggered browser download, viewer-origin override, password tool, or additional generic model tool

### Requirement: Exact installed tool and Skill catalog

The unshadowed installed Client Shell SHALL expose exactly the following 42 package-owned tools and eight package-owned Skills, with no alias, generic action tool, duplicate registration, or additional `workspace_*` operation:

`workspace_auth_start`, `workspace_auth_complete`, `workspace_auth_whoami`, `workspace_auth_logout`, `workspace_space_list`, `workspace_space_browse`, `workspace_space_find`, `workspace_node_create`, `workspace_node_rename`, `workspace_node_move`, `workspace_node_trash`, `workspace_worktree_list`, `workspace_worktree_get`, `workspace_worktree_create`, `workspace_worktree_update`, `workspace_worktree_ready`, `workspace_worktree_reopen`, `workspace_worktree_merge`, `workspace_worktree_discard`, `workspace_unit_list`, `workspace_unit_add`, `workspace_unit_create`, `workspace_worktree_review_url`, `workspace_blob_upload`, `workspace_blob_get`, `workspace_blob_download`, `workspace_asset_download`, `workspace_content_inspect`, `workspace_content_execute`, `workspace_office_import`, `workspace_office_export`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_screenshot`, `workspace_layout_lint`, `workspace_api_find`, `workspace_api_show`, `workspace_resource_find`, `workspace_resource_registries`, and `workspace_resource_export`;

`core`, `base`, `board`, `cross-unit-formula`, `doc`, `embed`, `sheet`, and `slide`.

#### Scenario: Complete catalog and schemas are snapshotted

- **WHEN** the built source application and isolated installed tarball are activated without project or user shadowing
- **THEN** their sorted tool names, full parameter schemas, full output schemas, tool descriptions and sorted Skill summaries match one checked canonical registry snapshot byte-for-byte
- **AND** every tool parameter root and representable object output is closed as required by its owner Change

#### Scenario: Consequential classification is probed

- **WHEN** the checked manifest marks a tool consequential or non-consequential
- **THEN** parity verification joins that manifest fact with the registered tool schema and invokes the real `tools/pre-execute` chain using invalid and valid arguments
- **AND** every consequential tool rejects invalid input before approval and produces the accepted ask/deny/allow behavior, while every non-consequential tool delegates without acquiring that tool's mutation or file-effect approval

#### Scenario: Catalog drifts

- **WHEN** a tool or Skill is missing, added, renamed, duplicated, unexpectedly shadowed, or its checked schema/description/approval classification changes
- **THEN** source and installed parity verification fail before an Agent turn is accepted

#### Scenario: Skills load on demand

- **WHEN** the installed Skill consumer loads each of the eight unshadowed names without a Workspace credential or network
- **THEN** each body comes from the packed version-matched resource, references only installed operations, preserves its accepted invocation policy, and disappears after plugin disposal

### Requirement: Outcome conformance uses authoritative fake boundaries

The parity gate MUST exercise every manifest row through real DSH Native and Code Mode tool dispatch. It MAY fake only deterministic loopback Workspace/Collaboration remote authority and transport plus approval and credential endpoints; it MUST use the real temporary local DSH filesystem service and real installed worker/runtime child, native bindings, compilers, render page, browser runtime, datasets, assets, and Skills. Fixtures MUST use production parsers and public package boundaries rather than checkout-only replacements.

#### Scenario: Keyless outcomes are exercised

- **WHEN** the gate runs without a stored Workspace grant or model key and without external public network access
- **THEN** package load, authentication handoff presentation through an isolated loopback endpoint, API/resource query, all eight Skill catalog/load paths, closed-schema rejection, approval denial, and normal disposal behave as specified
- **AND** local fixture files are handled by the real temporary local DSH filesystem service

#### Scenario: Authenticated outcomes are exercised

- **WHEN** an owner-valid grant and deterministic loopback Workspace/Collaboration authority and transport are installed
- **THEN** each authenticated manifest row completes one representative success with authoritative identity/read-back checks and lossless canonical output
- **AND** content, Office, Typst, SVG, screenshot, and layout-lint routes use the real packaged worker, native binding, or browser runtime required by their accepted owners

#### Scenario: A fixture bypasses the production boundary

- **WHEN** a conformance case imports `apps/cli/src/*`, private Client Core source or dist paths, a neighboring checkout, or replaces the operation under test with a fixture implementation
- **THEN** the parity gate rejects that case as invalid evidence

### Requirement: Cross-cutting safety contracts remain observable

For every operation to which its owner Change assigns approval, error, cancellation, result-unknown, file-effect, or secrecy behavior, the parity manifest MUST select an executable case that proves that behavior through the final DSH boundary. No parity case may weaken an owner requirement.

#### Scenario: Consequential operation is invoked

- **WHEN** a consequential mutation, file publication, local generation, import/export, execution, screenshot, or resource export is attempted
- **THEN** pure closed validation runs before one fail-closed approval decision, the accepted body repeats current authority/path/policy validation where required, and denial or unavailable approval causes no side effect

#### Scenario: Failure, cancellation, or uncertain result occurs

- **WHEN** an allowlisted Workspace failure, unlisted dependency failure, caller abort, owner disposal, dispatched uncertain mutation, confirmed partial file publication, or late confirmed success occurs
- **THEN** the final Native and Code Mode outcomes preserve the exact error/cancellation/result-unknown/no-replay class specified by the owner Change
- **AND** accepted bodies are drained without detached request, worker, browser, file handle, listener, timer, in-flight credential mutation, or temporary output

#### Scenario: Secret sentinel crosses a dependency boundary

- **WHEN** credential, cookie, `Set-Cookie`, password, grant, signed URL, license, source bytes, generated code, UnitData, stack, cause, or absolute dependency path contains a sentinel
- **THEN** plugin-owned result content, failure content/metadata, approval interactions, contexts, logs, and checked transcript contain no unauthorized copy
- **AND** the gate preserves the explicit owner exclusions for DSH records that already contain caller-supplied arguments

#### Scenario: Non-local execution world is selected

- **WHEN** a file, Office, Typst, SVG, screenshot, or resource-export operation runs outside the accepted local Session execution world
- **THEN** it fails with the owner Change's stable unsupported/local-boundary result before local read, write, native, worker, browser, or Workspace side effect

### Requirement: Prebuilt tarball is self-contained for the accepted surface

The final package MUST install from its already-built tarball into an isolated local DSH profile and run the complete parity suite from an unrelated working directory without an install-time build, monorepo module fallback, or adjacent checkout. Every Host, worker, runtime child, native binding reference, browser page and emitted asset, API/resource dataset, and Skill resource reachable from the 42 tools and eight Skills MUST resolve from the installed dependency or package closure.

#### Scenario: Packed closure is inspected

- **WHEN** package files, manifest targets, bare imports, worker/native/browser references, resource links, and Skill links are traversed from all installed entries
- **THEN** every reachable target exists and every external package has one declared exact runtime dependency justified by a reachable reference
- **AND** no `workspace:*`, bare `@univerjs/univer-workspace-client-core`, `apps/cli/src/*`, Server source, TypeScript source map/test fixture, neighboring checkout, source-root fallback, or absolute build path is present

#### Scenario: Isolated profile runs the full smoke

- **WHEN** a fresh profile installs the tarball, dumps effective configuration, activates the Host from an unrelated cwd, runs the keyless and authenticated loopback-authority suites, and requests normal shutdown
- **THEN** the expected bundle layer and one enabled Loader row are present, all 42 tools and eight Skills retain source behavior, and shutdown settles within the bounded deadline

#### Scenario: Required runtime resource is absent

- **WHEN** a packaged worker entry, runtime child, native binding, render page asset, discovery dataset, Skill file, or declared external is removed or resolves only through the source checkout
- **THEN** artifact verification or installed smoke fails before delivery

### Requirement: Package size and file surface are bounded

The packed artifact MUST have a compressed size no greater than `16,777,216` bytes, an unpacked size no greater than `67,108,864` bytes, and no more than `256` entries. It MUST also match an allowlisted file-class and runtime-import manifest. These limits apply to the final tarball reported by package inspection and MUST NOT be met by omitting a resource required by another parity requirement.

#### Scenario: Final artifact stays within the fixed budget

- **WHEN** the already-built package is packed with scripts disabled
- **THEN** its reported archive bytes, unpacked bytes, entry count, file classes, manifest targets and runtime imports all satisfy the fixed limits and checked allowlists

#### Scenario: Artifact grows or gains an unknown file

- **WHEN** any fixed size/count limit is exceeded or an unclassified file/import appears
- **THEN** package verification fails with the measured totals and offending entries
- **AND** raising the budget or allowlist requires an explicit planning change rather than an automatic snapshot update

### Requirement: Repeated lifecycle leaves no plugin-owned state

The installed parity smoke MUST perform at least three sequential activate/use/dispose cycles in one process and one fresh-process profile start/stop. Each disposal MUST stop new calls, unregister all tools, Skills and approval policies, abort owner-controlled work, drain accepted work, close heavy runtimes, and leave no surviving in-process volatile state for the next cycle. A valid persistent owner GrantRecord MUST remain in the credential provider across disposal and restart until explicit logout removes it; fixture isolation belongs to the test harness rather than plugin disposal.

#### Scenario: In-process lifecycle repeats

- **WHEN** the complete plugin is activated, representative keyless and authenticated operations run, and the owning fiber is disposed three times sequentially
- **THEN** every cycle begins with exactly 42 tools and eight Skills, ends with none of those package-owned registrations, and reports no surviving body, worker, browser, timer, listener, in-flight credential mutation, file handle, temporary output, or unhandled rejection
- **AND** the credential provider retains any valid authenticated GrantRecord unless the cycle explicitly invoked logout

#### Scenario: Process receives normal termination

- **WHEN** the isolated DSH Host has loaded the installed package and receives the smoke test's normal termination signal
- **THEN** all owned cleanup settles and the process exits successfully within the documented deadline

### Requirement: Documentation claims only passing parity

The `dsh-univer-work` responsibility documentation SHALL state the frozen baseline, DSH-native outcome mapping, exact supported tool and Skill catalog, verified package limits, local execution-world boundary, and explicit exclusions. A checked documentation projection MUST be generated from the same parity manifest or validated against it.

#### Scenario: All gates pass

- **WHEN** the complete source and installed parity gates pass
- **THEN** the README may identify the first version as outcome-equivalent to the frozen Univer Workspace CLI for the manifest rows
- **AND** it still excludes Commander-shape parity, password tools, CLI subprocess/Session/daemon, remote filesystem, Web Client, Settings, Slots, release workflow and public npm publication

#### Scenario: A capability or package gate fails

- **WHEN** any matrix, behavior, closure, size, lifecycle or documentation check fails
- **THEN** the first version is not reported as parity-complete and the failure names the prerequisite owner or delivery gate that must be corrected
