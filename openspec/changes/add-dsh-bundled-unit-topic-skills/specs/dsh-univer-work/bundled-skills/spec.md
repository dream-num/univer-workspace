## Purpose

定义随 `dsh-univer-work` 同一预构建 tarball 交付、由 Host 显式注册并通过 DSH 原生 catalog 按需加载的七份版本匹配 Unit/Topic Skills。

## ADDED Requirements

### Requirement: Exact seven-Skill catalog

The Client Shell SHALL package and contribute exactly `base`, `board`, `cross-unit-formula`, `doc`, `embed`, `sheet`, and `slide` in this capability, while `core` MUST remain solely owned by `add-dsh-worktree-unit-tools`.

#### Scenario: Unshadowed installed catalog is listed

- **WHEN** an isolated installed profile observes the unshadowed runtime Skill layer after plugin activation
- **THEN** the seven exact names appear once with non-empty descriptions, `source: bundled`, `provider: runtime`, and model/user invocation enabled
- **AND** this capability contributes no `core`, alias, generated duplicate, dynamic provider, remote entry or Skill catalog tool

#### Scenario: A nearer or earlier contribution has the same name

- **WHEN** DSH layer precedence or same-layer first-wins selection chooses another valid Skill with one of the seven names
- **THEN** the native registry winner remains authoritative
- **AND** the plugin does not create a parallel catalog, replace the winner or let its disposer remove another contribution

### Requirement: Packaged definitions use the supported metadata contract

Each of the seven package-relative `skills/<name>/SKILL.md` definitions MUST contain frontmatter with exactly the matching non-empty `name` and `description`, followed by a non-empty Markdown body, and MUST NOT declare `allowed-tools` or another field outside this capability's fixed DSH rc.2 metadata subset.

#### Scenario: All definitions are valid

- **WHEN** the Host loads the seven files from its installed package
- **THEN** it derives the exact name, description and body for every entry before contributing any Skill
- **AND** no checkout path, filesystem Skill root, supplemental resource base or CLI artifact is needed

#### Scenario: One packaged definition is invalid

- **WHEN** a file is missing, duplicated, malformed, empty, named incorrectly or contains an unsupported frontmatter field
- **THEN** plugin activation fails before contributing any of the seven Skills
- **AND** no partial package-owned catalog remains

### Requirement: Unit Skills teach DSH-native version-matched workflows

The `base`, `board`, `doc`, `sheet`, and `slide` Skills MUST preserve the matching CLI Skill's applicable Workspace identities, Facade semantics, authoring constraints and verification guidance, while every executable Client Shell step MUST use a stable DSH tool delivered by the same accepted Change set.

#### Scenario: A Unit Skill is loaded

- **WHEN** the Agent loads one of the five Unit Skills
- **THEN** the body routes target discovery, Draft creation/staging, content authoring, exact API lookup and applicable inspect, generation, screenshot, lint, import/export or review outcomes through available `workspace_*` operations
- **AND** it does not use Commander syntax, invent a tool, treat a Blob Resource as a Unit or replace stable Space/Node/Resource/Unit/Worktree identities with display text

#### Scenario: A Unit-specific capability is unavailable

- **WHEN** the installed accepted tool catalog has no operation for an unsupported outcome such as Board Office exchange or Base native inspection
- **THEN** the matching Skill states the existing boundary or uses an available read-only Facade workflow
- **AND** it does not name a deferred or fabricated operation

### Requirement: Topic Skills preserve explicit Source identity

The `embed` and `cross-unit-formula` Skills MUST preserve stable Source `unitId`, Unit type, ResourceRef or persisted qualifier binding as applicable, and MUST route their Host authoring and verification through installed DSH operations.

#### Scenario: Embed guidance is loaded

- **WHEN** the Agent loads `embed`
- **THEN** the body requires an exact Source Unit identity and Host surface, keeps Source loading read-only and lazy, and verifies persisted ResourceRef plus loaded child identity
- **AND** it does not infer Source identity from a display name, Workspace URL, share link, Node ID or Resource ID

#### Scenario: Cross-Unit formula guidance is loaded

- **WHEN** the Agent loads `cross-unit-formula`
- **THEN** the body preserves explicit Host/Source binding, exact Sheet range or Base table-column identity, calculation wait and later read-back requirements
- **AND** it does not stage a Source merely to read it or guess a Source from a loaded Unit or display name

### Requirement: Per-Skill operation and semantic contracts

Source and package verification MUST enforce the following exact required and forbidden operation references for each body in addition to resolving every literal `workspace_*` token against the installed catalog:

| Skill | Required operation references | Forbidden operation references |
| --- | --- | --- |
| `base` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_unit_list`, `workspace_content_execute`, `workspace_api_find`, `workspace_api_show`, `workspace_office_import`, `workspace_office_export`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_content_inspect`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_layout_lint` |
| `board` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_unit_list`, `workspace_content_execute`, `workspace_api_find`, `workspace_api_show`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_content_inspect`, `workspace_office_import`, `workspace_office_export`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_layout_lint` |
| `doc` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_unit_list`, `workspace_content_execute`, `workspace_content_inspect`, `workspace_api_find`, `workspace_api_show`, `workspace_office_import`, `workspace_office_export`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_layout_lint` |
| `sheet` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_unit_list`, `workspace_content_execute`, `workspace_content_inspect`, `workspace_api_find`, `workspace_api_show`, `workspace_office_import`, `workspace_office_export`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_layout_lint` |
| `slide` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_unit_list`, `workspace_content_execute`, `workspace_content_inspect`, `workspace_api_find`, `workspace_api_show`, `workspace_office_import`, `workspace_office_export`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_screenshot`, `workspace_layout_lint`, `workspace_worktree_review_url` | `workspace_typst_compile`, `workspace_typst_apply` |
| `embed` | `workspace_content_execute`, `workspace_api_find`, `workspace_api_show`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_content_inspect`, `workspace_office_import`, `workspace_office_export`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_layout_lint` |
| `cross-unit-formula` | `workspace_content_execute`, `workspace_api_find`, `workspace_api_show`, `workspace_screenshot`, `workspace_worktree_review_url` | `workspace_worktree_create`, `workspace_unit_add`, `workspace_unit_create`, `workspace_content_inspect`, `workspace_office_import`, `workspace_office_export`, `workspace_typst_compile`, `workspace_typst_apply`, `workspace_svg_compile`, `workspace_svg_apply`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export`, `workspace_layout_lint` |

Verification MUST also retain per-Skill semantic anchors derived from the current CLI Skill bodies and tests: Base lookup/no injected Base plus table-formula/attachment read-back; Board direct shape/connector/chart ownership and layout analysis; Doc paragraph stream, flavor/pagination, Typst and direct chart ownership; Sheet explicit cell data and calculation ordering; Slide one-based tool versus zero-based Facade pages, SVG replacement, resource, lint and direct chart ownership; Embed stable ResourceRef/lazy Source loading; and cross-Unit formula binding/calculation ordering.

#### Scenario: All references match

- **WHEN** source verification and isolated tarball verification inspect the seven definitions
- **THEN** every required reference and semantic anchor is present, every forbidden reference is absent, and every other literal operation name exists in the real catalog produced by the accepted authentication, Space/Node, Worktree/Unit/review, file-transfer, content-runtime, Office, Typst, SVG, render-verification and API/resource-discovery owners
- **AND** the definitions contain no `univer-workspace-cli`, Commander option, CLI config/Session/daemon, `skills get`, absolute checkout path or capability deferred beyond that artifact

#### Scenario: Guidance drifts from the installed catalog

- **WHEN** a definition omits a required operation or semantic anchor, includes a forbidden operation, references an unknown or renamed `workspace_*` operation, retains prohibited CLI syntax, or names a capability absent from the installed artifact
- **THEN** verification fails before the tarball is accepted
- **AND** it identifies the Skill and stale reference without loading a Workspace credential or contacting Workspace

### Requirement: Skills remain keyless guidance rather than authority

Bundled Skills MUST provide instructions only and MUST NOT execute tools, approve effects, resolve credentials, weaken input or filesystem policy, claim mutation success, or replace Workspace Server and Client Core authority.

#### Scenario: A Skill is loaded without authentication

- **WHEN** a keyless profile lists or invokes any of the seven Skills
- **THEN** DSH returns the registered summary or instruction body without resolving a Workspace origin or credential, contacting Workspace, opening a local user file, starting a browser or requesting approval

#### Scenario: An instructed tool is later invoked

- **WHEN** the Agent follows one of the instruction bodies and calls an installed operation
- **THEN** that operation independently applies its own schema, authentication, authorization, approval, reliability and lifecycle requirements
- **AND** the Skill content grants no bypass or pre-approval

### Requirement: Explicit registration and lifecycle cleanup

The Host MUST validate all seven definitions before registration, MUST register every valid entry separately with bundled source, runtime provider and the registry's default invocation policy, and MUST retain each exact registration disposer under the plugin lifecycle.

#### Scenario: Plugin activation succeeds

- **WHEN** all seven packaged definitions validate and the native Skill service is available
- **THEN** the seven contributions become observable through the real SkillRegistry and `skill` consumer
- **AND** no filesystem scanner, watcher, timer, network provider or supplemental resource base is created

#### Scenario: Plugin is disposed

- **WHEN** the owning Host fiber is disposed
- **THEN** it invokes its exact registration disposers in reverse order and every unshadowed package contribution disappears before disposal settles
- **AND** no Skill body, provider callback, watcher or open file handle remains owned by this capability

### Requirement: Skills and executable catalog ship as one verified artifact

The prebuilt plugin tarball MUST include the seven complete definitions exactly once and MUST load them with the version-matched executable surface without a source checkout, installed Workspace CLI, Workspace credential or network download.

#### Scenario: Packed Skill resources are inspected

- **WHEN** package verification walks the tarball
- **THEN** every expected `skills/<name>/SKILL.md` exists exactly once and passes metadata, body, forbidden-syntax and installed-tool-reference checks
- **AND** the artifact contains no sibling CLI Skill dependency, generated install-time rewrite, dynamic download manifest or absolute build path

#### Scenario: Installed keyless smoke runs

- **WHEN** the tarball is installed into an isolated local DSH profile and started from an unrelated cwd with empty isolated project, DSH and AGENTS Skill roots and without Workspace credentials or network access
- **THEN** the real SkillRegistry lists the seven unshadowed entries, the real `skill` consumer loads each exact body in Native and Code Mode, and disposal removes them
- **AND** default/scoped provider lookups may run, the filesystem provider queries only those empty roots, their results are not required for plugin registration, and the plugin adds no provider, root or watcher
