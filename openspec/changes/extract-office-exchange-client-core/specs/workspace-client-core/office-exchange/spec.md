## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Office import/export 行为，并固定格式与 Unit 类型兼容、Worktree Draft 集成、原生转换运行时和现有 Workspace CLI 交付兼容性。

## ADDED Requirements

### Requirement: Office import format and type selection

Workspace Client Core SHALL infer or validate an Office import Unit type from the source filename using the existing supported format matrix: XLS/XLSX as Sheet by default or explicit Base, DOC/DOCX as Doc, and PPT/PPTX/PPTM/PPSX/PPSM/POTX as Slide.

#### Scenario: Supported source type is inferred

- **WHEN** a Client Shell imports a supported Office source without an explicit Unit type
- **THEN** the core selects the existing default Unit type for that suffix and invokes conversion with the existing format and formula-calculation options

#### Scenario: Spreadsheet is imported as Base

- **WHEN** a Client Shell imports an XLS or XLSX source with explicit Base type
- **THEN** the core converts the source as Base and does not replace that type with the Sheet default

#### Scenario: Source suffix and explicit type are incompatible

- **WHEN** the source suffix is unsupported or its explicit Unit type is incompatible with that suffix
- **THEN** the core returns the existing import-format-unsupported error before creating a Worktree Unit

### Requirement: Office import creates a validated Worktree-local Unit

Workspace Client Core MUST convert the source, choose the Unit name with the existing explicit-name, imported-name, imported-title and fallback precedence, and create a Worktree-local Unit through the shared Worktree Unit capability while preserving the supplied idempotency identity.

#### Scenario: Imported content supplies its name

- **WHEN** no explicit name is supplied and converted UnitData contains a non-empty name or title
- **THEN** the core creates the Unit with the first applicable imported value and returns the existing committed import result

#### Scenario: Explicit name overrides imported content

- **WHEN** a non-empty explicit name is supplied
- **THEN** the core applies it to the converted UnitData and create request and returns that name

#### Scenario: Created Unit does not match the request

- **WHEN** the create result has another Worktree, source, Unit type, name, target Space, or parent Node
- **THEN** the core returns the existing result-mismatch error instead of reporting a committed import

### Requirement: Office export uses the selected Worktree head

Workspace Client Core SHALL resolve the requested Worktree Unit target, reject Board, require XLSX for Sheet or Base, DOCX for Doc and PPTX for Slide, export UnitData from the selected Draft head, and write the Office result to the requested Node-hosted output path.

#### Scenario: Compatible Unit is exported

- **WHEN** a supported Worktree Unit and compatible output suffix are supplied and runtime export returns UnitData for that Unit
- **THEN** the core converts that exact UnitData with the existing type and formula-calculation options and returns the existing output path, Worktree, Unit and type result

#### Scenario: Unit type and output suffix are incompatible

- **WHEN** the selected Unit is Board, the output suffix is unsupported, or the suffix is incompatible with the selected Unit type
- **THEN** the core returns the existing stable type or format error before exporting UnitData or writing an Office result, according to the existing validation order

#### Scenario: Runtime returns another Unit

- **WHEN** runtime export returns a non-object value or UnitData whose identity differs from the selected target Unit
- **THEN** the core returns the existing UnitData-invalid error and does not invoke Office output conversion

### Requirement: Node-hosted Office conversion runtime

Workspace Client Core MUST provide its Office exchange operations to Node-hosted Client Shells without depending on a command framework or daemon transport, and each installable Client Shell MUST deliver a loadable platform-native exchange runtime.

#### Scenario: Native XLSX round trip succeeds

- **WHEN** the supported Node platform exports valid Sheet UnitData to XLSX and imports that file through the installed exchange runtime
- **THEN** the resulting Office file is non-empty and the imported UnitData preserves the fixture content verified by the existing native round-trip test

#### Scenario: Installed Client Shell lacks its native runtime

- **WHEN** an installable Client Shell artifact cannot resolve the platform-native exchange runtime
- **THEN** its artifact verification or installation smoke gate fails instead of declaring Office exchange ready

### Requirement: Workspace CLI Office exchange compatibility

Workspace CLI MUST retain its import/export commands, arguments, file paths, JSON and text results, errors, daemon RPC payloads and installed-package behavior after it consumes Workspace Client Core Office exchange.

#### Scenario: Existing CLI exchange contract is exercised

- **WHEN** existing Office application-feature and command-contract cases run against the refactored CLI
- **THEN** suffix/type mapping, idempotency, names, Worktree Unit identity, runtime target and UnitData requests, output and error codes remain compatible

#### Scenario: Installed CLI loads Office exchange

- **WHEN** the CLI artifact is built, installed outside the monorepo and its package smoke gate loads the exchange runtime
- **THEN** the artifact resolves the Client Core exchange code and platform-native binding without a workspace bare import or source-checkout dependency
