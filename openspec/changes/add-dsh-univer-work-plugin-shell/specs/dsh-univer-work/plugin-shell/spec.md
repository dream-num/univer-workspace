## Purpose

定义 `dsh-univer-work` Host-only Client Shell 的 package identity、预构建安装 artifact、DeepSeek Harness profile 装配与 load/dispose lifecycle，使后续 Workspace 能力建立在经过隔离安装验证的本地插件入口上。

## ADDED Requirements

### Requirement: Host-only plugin package identity

The `dsh-univer-work` Client Shell SHALL be delivered from `apps/dsh-univer-work` as an ESM package named `dsh-univer-work`, with source version `0.0.0`, `private: true`, a `dsh.bundle.patch` manifest, and a prebuilt Host entry.

#### Scenario: Package metadata is inspected

- **WHEN** a consumer or verification command reads the source package manifest
- **THEN** it identifies `dsh-univer-work@0.0.0` as private, resolves the Host entry from built output, and resolves the bundle patch without consulting source files

#### Scenario: Host-only scope is inspected

- **WHEN** the package manifest and packed files are inspected
- **THEN** they declare no `dsh.client` entry and include no Web Client, Slot, Settings, tool, Skill, Job, authorization, Workspace connection, Client Core runtime, worker, or CLI subprocess surface

### Requirement: Installable prebuilt artifact

The Client Shell MUST produce a tarball whose declared package files contain every manifest, patch, Host output, license, and responsibility document required for DSH installation and startup, without requiring an install-time build or an adjacent source checkout.

#### Scenario: Packed file list is verified

- **WHEN** the package is built and its pack file list is inspected
- **THEN** every declared entry and patch target exists in the tarball and no runtime path resolves through the monorepo source tree or a DeepSeek Harness source checkout

#### Scenario: Tarball is installed outside the source application

- **WHEN** DSH installs the prebuilt tarball into an isolated local profile
- **THEN** installation completes without running a package build and the profile records `dsh-univer-work` in its ordered bundle membership

### Requirement: DSH profile composition

The Client Shell SHALL contribute one enabled Loader row named `dsh-univer-work` through its bundle patch, and the effective profile configuration MUST expose both the package layer and that row.

#### Scenario: Effective configuration is dumped

- **WHEN** DSH dumps the configuration of an isolated profile containing the packed plugin
- **THEN** the dump includes the `dsh-univer-work` bundle layer and one enabled Loader row that resolves the packed Host entry

#### Scenario: Profile does not configure Workspace capabilities

- **WHEN** the shell's patch is applied to the DSH base profile
- **THEN** the inserted row requires no Workspace origin, credential, authorization, Client Core, filesystem, subprocess, tool, Skill, Job, Web, or Client service to activate

### Requirement: Complete Host lifecycle

The Host plugin MUST load in a real Cordis composition and MUST complete all owned cleanup before its fiber disposal settles.

#### Scenario: Plugin is loaded and disposed

- **WHEN** a real composition loads the built Host entry and then disposes its plugin fiber
- **THEN** load and disposal complete without error and no plugin-owned effect remains active after disposal settles

#### Scenario: Installed profile starts and stops

- **WHEN** an isolated DSH process starts from the profile containing the packed plugin and receives the smoke test's normal termination signal
- **THEN** the Host loads the plugin without an unresolved injection or module error and exits within the bounded shutdown deadline

### Requirement: Frozen compatibility baseline

The Client Shell SHALL target DeepSeek Harness `0.1.1-rc.2` at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` and the repository's `1.0.0-beta.2` SDK baseline, and MUST NOT claim compatibility with another Harness or SDK release without re-verification.

#### Scenario: Dependency and documentation baseline is checked

- **WHEN** package metadata, lockfile, responsibility documentation, and installed smoke inputs are reviewed together
- **THEN** they select the frozen Harness release and current exact SDK cohort without a version range or an independent plugin release contract
