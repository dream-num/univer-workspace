> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in the planning repository that contains this Change. Apply only after `extract-space-node-client-core` and `extract-auth-client-core` are complete.

## Implementation notes

- Pre-edit tree: `d5c28e35aea32ddaccc32222bec4d35e10de8fe3`.
- Reused Client Core root exports: `WorkspaceHttp`, `AuthenticatedWorkspaceHttp`,
  `WorkspaceUnitType`, `executeWithStableIdentity`, `isWorkspaceResultUnknown`,
  `WorkspaceApplicationError`, `WorkspaceResultUnknownError`, and `workspaceError`.
- Reused CLI composition methods: `WorkspaceAuth.configuredOrigin()` and
  `WorkspaceAuth.authenticatedHttp("client")`.
- Pre-edit `pnpm --filter @univerjs/univer-workspace-client-core typecheck` exited 0.
- The full repository typecheck, test, build, CLI package, package verification, and installed
  tarball smoke commands exited 0. The installed fixture exercised Worktree list/create/update/ready,
  Unit add/create/list, and Open after authentication.
- The scoped implementation diff contains no Workspace Server contract, route, schema, generated
  HTTP, Session, or unrelated later-capability changes. Exchange and Typst changes are type-import
  switches only.

## 1. Confirm prerequisite boundaries

- [x] 1.1 Verify the target repository contains the private Client Core package plus the completed transport/error/model and authenticated HTTP/origin exports from Changes 1 and 2; record their public export names in this Change's implementation notes and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating a parallel auth or transport seam if a prerequisite is absent.

## 2. Move Worktree ownership

- [x] 2.1 Move the authoritative Worktree/Worktree Unit types, strict parsers, list/get/create/update workflow, stable identity helper and lifecycle algorithm into Client Core; migrate the existing behavior tests and add lifecycle-invalid, result-mismatch and unsuccessful read-back cases, then verify with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move Worktree Unit membership

- [x] 3.1 Move Unit list, trunk-backed add and Worktree-local create into Client Core using the prerequisite authenticated HTTP seam; preserve stable identities and bounded public error detail, and verify source/target/type/Worktree mismatch plus same-key retry cases with the Client Core test command.

## 4. Separate review URL rules from CLI configuration

- [x] 4.1 Move HTTP(S) validation, Worktree/Unit selection and agent review URL construction into Client Core, inject lazy `authenticatedHttp("client")` and `configuredOrigin()` wrappers from CLI composition, and retain `--viewer-url` as an explicit override; verify invalid URL ordering, zero/one/many Unit selection, membership mismatch and the exact structured URL result in Client Core and CLI command-contract tests.

## 5. Reconnect Workspace CLI and dependent types

- [x] 5.1 Switch Worktree, Unit and open commands plus program composition to package exports, update exchange/Typst and related tests to import shared Worktree Unit types through public exports, remove superseded CLI-owned implementations, and update the Client Core responsibility README; verify `pnpm --filter univer-workspace-cli typecheck`, `pnpm --filter univer-workspace-cli test` and `pnpm --filter @univerjs/univer-workspace-client-core build`.

## 6. Run the compatibility gate

- [x] 6.1 From a clean target-repository build state, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that the Server contract, Worktree/Unit/open CLI surface, Session behavior, lifecycle reliability and installed artifact remain unchanged.
