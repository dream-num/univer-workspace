> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in this planning repository. Apply only after Changes 1–7 are complete. `extract-space-node-client-core` error exports and `extract-worktree-unit-client-core` Worktree-local Unit create are direct code prerequisites; `extract-auth-client-core` is transitive, while Changes 4–7 are ordered predecessors only.

## 1. Confirm prerequisite boundaries

- [x] 1.1 Verify the target repository contains the completed Client Core error and Worktree-local Unit create public exports from Changes 1 and 3 and that Changes 1–7 have passed their compatibility gates; record the exact export names and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating a parallel error or Unit owner if a direct prerequisite is absent.

## 2. Move Typst compilation ownership

- [x] 2.1 Add Typst compile inputs/results, the default bundle compiler and diagnostic gate to `@univerjs/univer-workspace-client-core` public exports; migrate focused feature cases and verify one compiler call, exact preview options/result fields, compile-only errors without Workspace side effects, apply error blocking, warning pass-through and existing coded error detail with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move deterministic Doc materialization

- [x] 3.1 Move the disposable headless Doc materializer and its existing random seed, lifecycle guard, target identity, saved UnitData, revision and name rules into Client Core; verify repeated equivalent output, prohibited/zero/multiple/wrong Unit creation, invalid saved data, deterministic-random restoration and runtime disposal on success and failure with the Client Core test command.

## 4. Move the apply workflow

- [x] 4.1 Connect accepted compiler output to the prerequisite Worktree-local Unit create operation, preserving Doc type, materialized-name/compiled-title precedence, Space, Worktree, optional parent Node, caller idempotency identity and Server-allocated Unit result; verify create input, successful `committed: true`, mismatch/result-unknown propagation and no compile or materialization replay in Client Core tests.

## 5. Reduce the CLI to presentation and delivery adapters

- [x] 5.1 Switch CLI program composition and Typst command typing to package exports, retain Commander validation plus `--out`/`--diagnostics-out` local writes and JSON/text presentation, remove superseded CLI compile/materializer owners, and update Client Core/CLI exports, manifests, build graph and responsibility docs; make CLI packaging resolve `@univerjs-pro/doc-typst-native-binding` from the new declared dependency owner while preserving the external dependency set, then verify command contracts, built entrypoint from an arbitrary cwd, Client Core build, CLI tests, package manifest tests and package verification.

## 6. Run the native artifact and compatibility gate

- [x] 6.1 Extend the installed-tarball smoke to compile a minimal Typst bundle through the packaged CLI and assert the requested generated program/result outside the monorepo, then run `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Typst bundle/compiler behavior, determinism, diagnostics, CLI command/results/errors, native platform delivery, SDK baseline and installed artifact remain unchanged and contain no workspace bare import or source-checkout dependency.

## Implementation notes

- Baseline virtual tree: `ed3a6c57deddd3d0724073fd48da56e6e094b2a1`.
- Direct prerequisite package-root exports verified before editing: `workspaceError`,
  `WorkspaceApplicationError`, `WorkspaceResultUnknownError`, `WorkspaceUnitFeature`, and
  `WorkspaceUnit`; `WorkspaceUnitFeature.create` is the shared Worktree-local Unit operation.
- Changes 1–7 contain no pending tasks, and pre-edit
  `pnpm --filter @univerjs/univer-workspace-client-core typecheck` passed.
- Focused Core tests passed with 21 files and 380 tests; focused CLI Typst/application
  contracts passed with 17 tests, built-entrypoint Typst/arbitrary-cwd checks passed, CLI full
  tests passed with 16 files and 70 tests, and package manifest tests passed with 9 tests.
- `pnpm install --frozen-lockfile`, Client Core build, root typecheck/test/build, package build,
  package verify, installed-tarball smoke, and `git diff --check` passed. The installed smoke
  compiled a real minimal bundle from an arbitrary cwd and verified its generated program,
  result identity, diagnostics schema, and native binding delivery.
- Owner/scope checks leave the Typst facade dependency and implementation in Client Core,
  retain only command/file/presentation and artifact delivery in CLI, and found no source-checkout
  dependency or user credential. Product virtual tree: `188e0ce49824dbabf19889aa6fec2723fb15e2ca`.
