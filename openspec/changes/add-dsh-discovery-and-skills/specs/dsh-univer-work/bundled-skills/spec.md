## Purpose

定义随 `dsh-univer-work` tarball 交付并通过 DSH 原生 registry 显式注册的七份版本匹配 Unit/Topic Skills，使 Agent 渐进加载与实际 tool catalog、Facade SDK 和 Workspace 领域边界一致的操作指导。

## ADDED Requirements

### Requirement: Exact seven-skill catalog

The Client Shell SHALL package and register exactly `base`, `board`, `cross-unit-formula`, `doc`, `embed`, `sheet`, and `slide` as its Skills in this Change, while `core` MUST remain solely owned by the preceding Worktree/Unit capability.

#### Scenario: Installed Skill catalog is listed

- **WHEN** DSH observes the unshadowed runtime Skill layer after plugin activation
- **THEN** the seven exact names appear with non-empty descriptions and model/user invocation enabled
- **AND** this Change contributes no `core`, alias, generated duplicate, dynamic provider, remote entry or Skill catalog tool

#### Scenario: Skill file metadata is invalid

- **WHEN** any packaged Skill is missing, has malformed frontmatter, declares a different name, or has an empty description/body
- **THEN** plugin activation fails before registering any of the seven entries
- **AND** it does not leave a partially registered catalog

### Requirement: Skills teach DSH-native version-matched workflows

Each bundled Skill MUST preserve the matching CLI Skill's applicable Workspace identities, Facade semantics, authoring rules and verification guidance, MUST express every executable step using a stable tool present in the accepted installed `dsh-univer-work` catalog, and MUST contain no CLI-only command, option, stdout, Session/config, daemon or Skill-loading instruction.

#### Scenario: Unit Skill is loaded

- **WHEN** the Agent loads `sheet`, `doc`, `slide`, `base`, or `board`
- **THEN** the body teaches the exact Unit type's version-matched Facade objects, selection/editing model, API discovery, Draft authoring and available verification/export outcomes through DSH tools
- **AND** it does not invent a tool, reuse Commander syntax, or treat a Blob Resource as a Unit

#### Scenario: Topic Skill is loaded

- **WHEN** the Agent loads `embed` or `cross-unit-formula`
- **THEN** the body preserves stable Unit/ResourceRef/source-binding identity and read-only Source rules and routes prerequisite workflow/API lookup through installed Skills/tools
- **AND** it does not resolve identity from a display name, URL or share link

#### Scenario: Base Skill is loaded

- **WHEN** the Agent loads `base`
- **THEN** it receives the Base-specific Facade and verification guidance required by the installed content/runtime tools
- **AND** the entry does not replace or duplicate the `core` Workspace lifecycle Skill

#### Scenario: Guidance names an unavailable tool

- **WHEN** package verification extracts any `workspace_*` reference from one of the seven bodies
- **THEN** the referenced name must exist in the installed tool catalog for the same artifact
- **AND** verification fails on stale CLI syntax, unknown names or references to a capability deferred beyond this artifact

### Requirement: Skills remain guidance, not authority

Bundled Skills MUST supply instructions only; they MUST NOT execute tools, approve effects, validate trust-boundary input, obtain credentials, weaken policy, claim mutation success, or replace Server/Client Core authority.

#### Scenario: Skill is loaded before authentication

- **WHEN** a keyless installed profile loads one of the seven Skills
- **THEN** DSH returns its instruction body without reading a Workspace credential, contacting Workspace, running a tool, opening a local file or asking approval

#### Scenario: Skill is shadowed or ignored

- **WHEN** native DSH layer precedence selects a nearer project/user Skill with the same name, or another same-layer runtime contribution wins first
- **THEN** DSH applies its documented catalog behavior while every Workspace tool continues to enforce its own schema, credential, permission and approval rules
- **AND** the plugin does not add a second registry or bypass the winner

### Requirement: Explicit atomic registration and disposal

The Host plugin MUST read and validate all seven package-relative definitions before registration, MUST call `ctx.skills.register()` separately for each definition, and MUST retain the exact returned disposers in one fiber-owned lifecycle effect.

#### Scenario: Plugin activates normally

- **WHEN** all seven definitions validate and the DSH Skill service is available
- **THEN** the plugin registers each name with its parsed description and body, no supplemental resource base, and the native runtime provider/default invocation policy

#### Scenario: Plugin is disposed

- **WHEN** the owning Host fiber is disposed
- **THEN** it invokes the exact registration disposers in reverse order and all seven unshadowed package contributions disappear before disposal settles
- **AND** no provider, invalidation callback, watcher, timer, file handle or loaded body remains owned by the plugin

### Requirement: Skills and SDK ship as one verified artifact

The prebuilt tarball MUST include the seven complete Skill files and the exact SDK/tool implementation they describe, MUST reject drift between their references and installed catalog, and MUST load them without a source checkout or network download.

#### Scenario: Packed Skill resources are inspected

- **WHEN** package verification checks the tarball
- **THEN** all seven package-relative files exist exactly once, declare the expected names, contain no checkout-absolute path or CLI command surface, and correspond to the artifact's frozen SDK/tool catalog
- **AND** no sibling CLI Skill file or installed CLI package is read at runtime or installation

#### Scenario: Installed Skill smoke runs

- **WHEN** a tarball is installed into an isolated keyless profile from an unrelated cwd
- **THEN** real SkillRegistry list/get observes and loads all seven bodies, verifies their registered metadata/tool references, disposes them, and succeeds without Workspace credentials, monorepo files or network access
