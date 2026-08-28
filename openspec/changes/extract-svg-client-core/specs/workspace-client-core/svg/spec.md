## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 SVG-to-Slide 编译、真实或估算字体测量与 Draft Worktree apply 行为，并固定十个 Client Core 提取切面完成后的 Workspace CLI 与安装包兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent SVG compilation

Workspace Client Core SHALL compile a local Node-hosted SVG source and its relative assets into the existing Slide Facade code, viewport, warnings, lints and text-measure result without depending on a command framework, credential store, daemon transport or output presenter.

#### Scenario: SVG and relative assets compile

- **WHEN** a Node-hosted Client Shell supplies a readable SVG path whose referenced local assets are valid
- **THEN** the core resolves those assets relative to the SVG, compiles the source once and returns the existing structured compiler fields

#### Scenario: SVG has no text

- **WHEN** the SVG compiler does not request text measurement
- **THEN** the core returns the compiled result without starting a browser runtime

### Requirement: Exact and estimated SVG text measurement

Workspace Client Core MUST preserve the existing choice between browser-backed real font metrics and deterministic built-in estimation, including styled text-run conversion, result metadata and the estimation lint.

#### Scenario: Real font metrics are requested

- **WHEN** compilation encounters text and estimation is not selected
- **THEN** the core lazily starts one browser render runtime with the supplied render page, license and environment, measures every requested line with the existing Univer document mapping, and reports `univer-render-runtime`

#### Scenario: Browser-backed compilation settles

- **WHEN** real text measurement starts a browser runtime and compilation succeeds or fails
- **THEN** the core closes that runtime before the operation settles

#### Scenario: Deterministic estimation is selected

- **WHEN** estimation is selected for an SVG containing text
- **THEN** the core starts no browser runtime, reports `builtin-estimate`, preserves compiler warnings and lints, and adds the existing `--estimate-text-size` placement lint

### Requirement: Slide page program construction

Workspace Client Core SHALL preserve raw compile output and the existing optional Slide page wrapper, including viewport page size and replace or add mode.

#### Scenario: No page is selected

- **WHEN** compilation is requested without a target page
- **THEN** the core returns the compiler's raw generated code without a Slide page wrapper

#### Scenario: A page is selected

- **WHEN** a positive page and replace or add mode are supplied
- **THEN** the core wraps the compiled code once for that page with the compiled viewport and returns the same page and mode metadata

### Requirement: SVG apply uses shared content execution

Workspace Client Core MUST apply the generated page program only through the shared Slide content execution capability for the selected Draft Worktree and Unit, without recompiling or creating another target or commit workflow.

#### Scenario: Compiled page is applied

- **WHEN** a valid Worktree, Slide Unit and page are supplied for apply
- **THEN** the core passes the same generated page program once to shared Slide execution and returns the existing structured compilation and commit result

#### Scenario: Apply does not commit a mutation

- **WHEN** shared Slide execution returns a successful no-mutation result
- **THEN** the core preserves that result and does not repeat compilation or execution

#### Scenario: Shared execution fails

- **WHEN** target resolution, Draft validation, execution or commit fails
- **THEN** the core propagates the existing structured failure and does not add a second apply or recovery path

### Requirement: Workspace CLI SVG compatibility

Workspace CLI MUST retain its `compile-svg` arguments, option validation, local file behavior, output code, warnings, lints, JSON and text presentation, coded errors, browser behavior and apply results after it consumes Workspace Client Core SVG.

#### Scenario: Existing CLI SVG contracts are exercised

- **WHEN** existing SVG command, compiler, text-measure and Worktree apply cases run against the refactored CLI
- **THEN** source and asset paths, runtime options, generated code, page mode, diagnostics, output files, commit results and errors remain compatible

#### Scenario: Built entrypoint runs from another working directory

- **WHEN** the built CLI compiles an SVG from an arbitrary working directory
- **THEN** it resolves the shared compiler and selected estimation or packaged browser path without depending on the monorepo source tree

### Requirement: Complete Client Core extraction checkpoint

The Univer Workspace repository MUST verify the complete ten-slice Client Core extraction before the SVG Change is accepted, without using this Change to implement an incomplete predecessor.

#### Scenario: A predecessor is incomplete

- **WHEN** any public operation, test gate or artifact delivery obligation required by Changes 1–9 is absent
- **THEN** SVG implementation stops and the missing predecessor is completed under its own Change instead of adding a duplicate owner to this Change

#### Scenario: Source workspace parity gate runs

- **WHEN** the final extraction checkpoint runs after Changes 1–10 are implemented in order
- **THEN** Client Core and Workspace CLI typecheck, tests and builds pass while the existing auth, Space/Node, Worktree/Unit/open, file transfer, runtime target, content execution, Office, Typst, screenshot/lint and SVG behavior remains compatible

#### Scenario: Installed CLI artifact is verified

- **WHEN** the CLI is packed, installed and exercised outside the monorepo from an arbitrary working directory
- **THEN** its commands, worker child, render page, browser dependencies, native bindings and shared Client Core code resolve without a workspace bare import or source-checkout dependency
