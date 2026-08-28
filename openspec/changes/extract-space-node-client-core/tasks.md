> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in the planning repository that contains this Change.

## 1. Establish the private package

- [x] 1.1 Create `packages/client-core` as private `@univerjs/univer-workspace-client-core` with named public exports, TypeScript build, Vitest setup and a responsibility README; verify with `pnpm --filter @univerjs/univer-workspace-client-core typecheck` and `pnpm --filter @univerjs/univer-workspace-client-core build`.

## 2. Move transport ownership

- [x] 2.1 Move the authoritative Workspace error/result-unknown and HTTP transport implementations plus their existing behavior tests into Client Core, leaving exact named re-export shims at the old CLI paths; verify origin, redirect, cookie, response parsing and error identity with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move the Space/Node vertical slice

- [x] 3.1 Move Space/Node types, strict parsers and workflows into Client Core, replace the concrete CLI auth dependency with the agreed lazy authenticated-HTTP provider, and migrate the existing pagination, traversal, filter, mutation, read-back and result-unknown cases; verify with the Client Core test command and confirm every spec scenario has a corresponding assertion.

## 4. Reconnect Workspace CLI

- [x] 4.1 Add the `workspace:*` dependency, switch CLI Space composition and command typing to package exports, and retain only the migration shims needed by later slices; verify unchanged command arguments, requests, JSON/text output and coded failures with the existing CLI command-contract, application-feature, auth-transport and end-to-end tests.

## 5. Preserve build and repository contracts

- [x] 5.1 Make the CLI package workflow build Client Core through the workspace dependency graph before bundling, update the target repository's package/responsibility documentation (`AGENTS.md`, applicable README files and `DREAMNUM.md`) and lockfile, then verify `pnpm package:workspace-cli` and `pnpm --filter univer-workspace-cli package:smoke` succeed without an unresolved workspace import or source-checkout dependency.

## 6. Run the compatibility gate

- [x] 6.1 From a clean target-repository build state, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that the Server contract, CLI Space/Node surface, Session behavior and installed artifact remain unchanged.
