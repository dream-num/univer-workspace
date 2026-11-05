## Context

`docs/research/deepseek-harness-plugin-development.md` confirms that DeepSeek Harness `0.1.1-rc.2` installs external extensions as bundle packages: `dsh.bundle.patch` selects a patch, the patch inserts a Loader row, and the row resolves the package's prebuilt Host entry. Source overlay proves local development only; it does not prove that npm packaging, profile membership or installed module resolution works.

`docs/research/dsh-univer-work-capability-migration.md` and the accepted migration terminology distinguish Workspace Client Core from delivery-specific Client Shells. This Change creates only the DSH Client Shell owner. It intentionally has no Workspace connection or shared Core dependency, so every later capability can assume the package and Cordis lifecycle are already valid.

The target package remains private and source-versioned `0.0.0`. The frozen external baseline is DeepSeek Harness `0.1.1-rc.2` / Cordis `4.0.1`; the repository SDK baseline remains `1.0.0-beta.2`, although this shell does not consume Univer packages yet.

## Goals / Non-Goals

**Goals:**

- Add one `apps/dsh-univer-work` workspace application with a prebuilt ESM Host entry and installable DSH bundle patch.
- Prove the built entry loads and disposes through a real Cordis composition.
- Prove a packed tarball installs, appears in an isolated profile's effective configuration, starts under the real DSH CLI, and shuts down within a deadline.
- Record the new Workspace Agent Client, Client Shell owner and co-location decision in the target repository.

**Non-Goals:**

- Do not add Client Core, Workspace protocol, credentials, tools, Skills, runtime resources or model-visible output.
- Do not add a Web Client or any Host-to-Client communication seam.
- Do not create a publishing channel, distribution version derivation, compatibility range or install-from-Git build path.
- Do not alter the Workspace CLI, Server, Browser, SDK baseline or deployment workflow.

## Diagram design

```text
prebuilt dsh-univer-work tarball
              │ dsh plugin add
              ▼
isolated local DSH profile
  ├── bundles: dsh-univer-work
  └── effective patch
              │ inserts
              ▼
dsh-univer-work Loader row
              │ resolves
              ▼
packed Host entry
              │ load / dispose
              ▼
Cordis fiber lifecycle
```

## Decisions

### 1. Keep the shell in one application package

`apps/dsh-univer-work` owns package metadata, Host source, bundle patch, build output, tests, smoke script and package README. No service-definition package, provider package, consumer package or shared DSH adapter is introduced. The first shell has one consumer and no independently evolving capability seam.

The manifest name, patch Loader row name and package resolver name all use `dsh-univer-work`. The source manifest remains `0.0.0` and `private: true`; `pnpm pack` is a verification and local delivery mechanism, not publication. The package declares only the prebuilt Host output, patch, README and license required by the artifact.

Alternatives rejected:

- A separate repository would break the accepted co-location decision and prevent atomic changes with private Client Core.
- A mixed Host/Web package would add an unused `dsh.client` build and unverified Remote/Slot seams.
- GitHub source installation would require `prepare` execution and user `allowBuilds`; the confirmed first delivery path is a prebuilt tarball.

### 2. Use the repository compiler for the single Host entry

The application uses the repository's existing TypeScript compiler and Vitest rather than adding a bundle framework. One Host entry has no Client Core or native resources, so plain ESM output is sufficient. The entry consumes only published package exports from the frozen DSH/Cordis baseline; no config, build or test path may resolve the Harness checkout listed in the Research Note.

The package scripts provide focused `build`, `typecheck`, `test`, pack inspection and installed-smoke commands. Root recursive `build`, `typecheck` and `test` discover the application through the existing `apps/*` workspace pattern; no root script is added unless it shortens an actual invocation used by CI or maintainers.

### 3. Make the patch and Host entry intentionally inert

`cordis.patch.yml` inserts one enabled Loader row named `dsh-univer-work`, resolving the package root Host entry. The plugin exports the ordinary Cordis `name` and `apply` entry points and declares no injections. It does not reserve configuration fields or register placeholder services, tools, Skills, Settings, authorization flows, Jobs or UI contributions.

This keeps later Changes free to add only the injection and lifecycle resources their capability needs. Dispose correctness is tested through the real Cordis fiber that owns the built plugin; when later Changes add async owners, their cleanup remains in that fiber and must settle before disposal returns.

Alternatives rejected:

- Placeholder Workspace config or credential interfaces would freeze names before the authentication Change defines their behavior.
- A synthetic health service or log line would add product surface only to make a test easier; Loader success, fiber state and process exit provide the required observations.

### 4. Separate source checks from installed-artifact acceptance

Focused tests cover package metadata/patch consistency and a real Cordis load/dispose cycle using the built Host entry. A separate Node smoke script uses only Node standard-library process/filesystem primitives plus the installed `@deepseek-ai/dsh@0.1.1-rc.2` CLI; it must not depend on `@deepseek-ai/dsh-loader-smoke`, which the Harness research identifies as private test support.

The installed smoke creates temporary output and `DSH_HOME`, packs the already-built package, installs that tarball into an isolated local profile, inspects profile bundle membership, runs `--dump-config`, and starts a fresh Host process. It waits for successful startup evidence, requests normal termination, enforces a deadline and includes stdout/stderr in failures. Temporary state is removed after both success and failure.

The test does not run an Agent turn or require model credentials. A source import, `--patch` overlay or direct link is insufficient because each bypasses part of the artifact resolution path.

### 5. Move settled client terminology and ownership into this repository

Implementation adds the Workspace Agent Client, Workspace Client Core and Client Shell terms to `apps/workspace/CONTEXT.md`, records the accepted co-location decision in the existing ADR directory, and updates root `README.md`, `AGENTS.md`, `DREAMNUM.md` plus the new package README. The package README states its Host-only responsibility, current non-capabilities, local profile scope and private/no-release status.

The copied decision records the durable choice without making the adjacent migration repository a build or documentation dependency. No Space, Node, Resource, Unit, Worktree or persistence term changes.

## Risks / Trade-offs

- **Harness prerelease manifest or Loader behavior changes** -> Pin the verified release, assert exact manifest/row identity, and rerun the installed smoke before changing the supported baseline.
- **Source tests pass while packed paths are incomplete** -> Inspect the pack file list and perform add/dump/start from the generated tarball in a temporary profile.
- **Startup smoke mistakes a hanging or partially loaded process for success** -> Wait for explicit startup evidence, capture diagnostics, request normal termination and fail on a bounded deadline.
- **The smoke leaks profile state or conflicts with a developer's DSH home** -> Use unique temporary directories and set `DSH_HOME` only for child processes; clean the exact temporary root in a `finally` path.
- **Private `0.0.0` metadata is mistaken for a release contract** -> Keep publication absent and describe tarball use as installation verification/local delivery only.
- **Documentation claims later Workspace capabilities are already present** -> Package and repository docs distinguish the new Client Shell from the deferred authentication, tools, Skills and runtime Changes.

## Migration Plan

1. Add the package manifest, compiler/test configuration, inert Host entry and bundle patch at `apps/dsh-univer-work`.
2. Add focused manifest/patch and real Cordis lifecycle tests, then build and inspect the packed files.
3. Add and run the isolated tarball install/dump/start smoke against the frozen DSH release.
4. Move the settled client terminology and co-location ADR into this repository and update repository/package responsibility documentation.
5. Run the focused application checks, repository build/typecheck/test integration and `git diff --check`.

There is no persisted data or remote state migration. Rollback removes the application workspace and its documentation entries; existing Workspace and CLI artifacts remain unchanged.

## Open Questions

无。会改变 package identity、Host-only scope、verification path 或后续 Change 边界的决定均已由用户确认和现有研究收敛。
