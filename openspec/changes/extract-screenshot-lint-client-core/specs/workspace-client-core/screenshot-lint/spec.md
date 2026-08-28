## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 render Unit、browser screenshot 与 Slide layout lint 行为，并固定引用与图片解析、本地 PNG 安全、浏览器资源清理和现有 Workspace CLI 交付兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent Workspace render capability

Workspace Client Core SHALL let a Node-hosted Client Shell supply runtime target/reference operations, UnitData export, Asset content access, an explicit render page path, Univer license and browser environment, then render Workspace content with the existing preset, font and image behavior without depending on that shell's command framework, credential storage, daemon protocol or output presenter.

#### Scenario: Client Shell supplies render dependencies

- **WHEN** a Node-hosted Client Shell supplies valid Workspace operations and browser runtime inputs
- **THEN** the core loads and renders the selected Unit without reading shell-owned configuration, credentials or command state

#### Scenario: Render operation finishes or fails

- **WHEN** screenshot capture or Slide layout lint creates a browser runtime and then succeeds, fails or is aborted through the existing signal
- **THEN** the core closes that runtime before the operation settles

### Requirement: Scope-aware render Unit assembly

Workspace Client Core MUST preserve Host Unit export, formula-reference discovery, active Embed child discovery and scope-relative target resolution when it assembles render input from a Trunk or Worktree target.

#### Scenario: Host has formula references

- **WHEN** Host UnitData declares distinct external formula reference Units
- **THEN** the core resolves each reference relative to the Host target, accepts only Sheet or Base formula sources, exports them in the existing stable order and excludes a self reference

#### Scenario: Host has embedded Units

- **WHEN** Host UnitData declares active and soft-deleted Embed descriptors
- **THEN** the core exports each distinct active child through the shared reference scope policy, excludes the Host and formula-reference duplicates, and ignores soft-deleted descriptors

#### Scenario: Reference metadata is invalid

- **WHEN** an external-reference or Embed resource has malformed JSON, a missing identity, an invalid ResourceRef or an unsupported formula-source Unit type
- **THEN** the core returns the existing structured screenshot reference or Embed error instead of rendering incomplete data

### Requirement: Worktree render-copy Asset resolution

Workspace Client Core SHALL resolve UUID-backed images for a Worktree Host, its formula references and its embedded Units through the shared Asset content capability while leaving source UnitData and Trunk render data unchanged.

#### Scenario: Worktree render data contains shared Asset identities

- **WHEN** one or more Worktree render Units reference valid UUID-backed images
- **THEN** the core resolves each required Asset through that Worktree and rewrites only the render copy to the existing BASE64 representation

#### Scenario: Trunk render data is loaded

- **WHEN** the selected Host target is Trunk
- **THEN** the core returns the assembled render Unit without requesting Worktree Asset content or applying Worktree image rewrites

### Requirement: Screenshot capture and local PNG safety

Workspace Client Core MUST preserve the existing screenshot result and Node-hosted PNG output behavior, including safe basenames, recursive destination creation, private temporary files and non-replacing exclusive commit.

#### Scenario: Screenshot capture succeeds

- **WHEN** the browser runtime renders a supported Workspace Unit
- **THEN** the core returns the existing Unit identity, Unit type and ordered PNG image metadata and bytes

#### Scenario: PNG name is unsafe or output exists

- **WHEN** a returned image name contains a path component, is `.` or `..`, or its destination already exists before or during commit
- **THEN** the core returns the existing screenshot output error and does not replace the existing destination

#### Scenario: PNG output is committed

- **WHEN** all names pass preflight and an image's exclusive commit succeeds
- **THEN** the destination contains exactly those PNG bytes with the existing private-file behavior and the temporary file is removed

### Requirement: Slide layout lint

Workspace Client Core SHALL run the existing Unit layout lint only for Slide render input and return the target-neutral structured findings without changing the selected Workspace content.

#### Scenario: Slide layout is inspected

- **WHEN** the selected render Unit is a Slide and the browser runtime captures its layout
- **THEN** the core returns the existing Unit layout lint kind, Unit identity, Unit type and ordered findings

#### Scenario: Selected Unit is not a Slide

- **WHEN** layout lint receives a Sheet, Doc, Base or Board render Unit
- **THEN** the core returns the existing `workspace-unit-layout-lint-unit-type-unsupported` failure before creating a browser runtime

### Requirement: Browser runtime and render-page delivery

Each installable Client Shell that exposes Workspace Client Core screenshot or layout lint MUST deliver the version-matched static render page and Puppeteer browser runtime dependencies required by the selected exact SDK baseline.

#### Scenario: Installed render runtime is complete

- **WHEN** an installable Client Shell loads screenshot or layout lint and prepares its browser runtime outside the monorepo
- **THEN** it resolves its packaged render page, browser executable support, `puppeteer-core`, `@puppeteer/browsers` and license without a source-checkout dependency

#### Scenario: Render asset is absent

- **WHEN** the installable artifact lacks its render page or required browser runtime dependency
- **THEN** package verification or installation smoke fails instead of declaring screenshot and lint ready

### Requirement: Workspace CLI screenshot and lint compatibility

Workspace CLI MUST retain its screenshot and lint commands, arguments, scope rules, browser setup behavior, render results, PNG paths, JSON/text presentation, coded errors and package-installed behavior after it consumes Workspace Client Core.

#### Scenario: Existing CLI contracts are exercised

- **WHEN** existing screenshot, Slide layout lint and command cases run against the refactored CLI
- **THEN** target selection, reference and Asset requests, runtime options, outputs, findings, errors and browser close behavior remain compatible

#### Scenario: Installed CLI carries the shared render page

- **WHEN** the CLI artifact is built, installed outside the monorepo and its screenshot/lint surface is loaded
- **THEN** it resolves the Client Core workflow and copied render page while preserving the existing SVG consumer until the subsequent SVG extraction Change
