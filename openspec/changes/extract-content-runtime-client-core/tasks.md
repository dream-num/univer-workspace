> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in this planning repository. Apply only after `extract-runtime-target-client-core` is complete; Changes 1–3 are its transitive prerequisites. `extract-file-transfer-client-core` is not a code prerequisite for this Change.

## 1. Confirm the runtime-target prerequisite

- [x] 1.1 Verify the target repository contains the completed Client Core target, Snapshot adapter, reference host/provider, authenticated HTTP and error exports from Change 5 and its prerequisites; record their exact public names and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating a parallel target, auth or Snapshot seam if any prerequisite is absent.

## 2. Move worker and pool ownership

- [x] 2.1 Add the Client Shell-neutral worker implementation and closeable content runtime owner to `@univerjs/univer-workspace-client-core`, accepting an explicit packaged worker entry plus credential/license resolvers and reusing the prerequisite runtime key, Snapshot and reference exports; verify target loading, Trunk/Worktree Collaboration endpoints, missing credential/license, secret-free errors, pool reuse and awaited close with focused Client Core tests.

## 3. Move synchronized read operations

- [x] 3.1 Implement `executeRead` and `exportUnitData` on the Core owner with the existing dirty-state check, pull conflict handling, exact selected-revision check and lease release behavior; migrate relevant daemon/content cases and verify lossless read values, exact UnitData, dirty/conflict/mismatch errors and no mutation submission with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 4. Move embedded-image externalization

- [x] 4.1 Move image-reference traversal/rewrite, bounded raster BASE64 parsing, digest deduplication and Worktree File API upload into Client Core without depending on file-transfer capability; migrate `embedded-images.test.ts` and verify direct/serialized references, one upload per digest, signature/size/SVG rejection, immutable input and byte-for-byte fallback after upload failure.

## 5. Move write execution and commit

- [x] 5.1 Move Facade program preparation, editable target/type validation, write-mode execution, mutation replacement and the three-attempt commit state machine into Client Core; verify no-mutation reuse, Trunk rejection, reserved binding/type failure, confirmed revision, retry/unknown without execution replay, conflict/pull-required/discard/exhaustion errors and runtime invalidation with the Client Core test command.

## 6. Reduce the CLI to Client Shell adapters

- [x] 6.1 Replace CLI-owned worker/daemon/content implementations with a thin Core worker build entry, daemon RPC delegation and runtime-operation adapters; retain Session/license resolution, socket/control, signal shutdown, `runtime.execute-read`, `runtime.export-unit-data` and `runtime.execute-and-commit` wire shapes plus Commander/inspection presentation, then verify execute, inspect, exchange, screenshot, daemon shutdown and command-contract cases with `pnpm --filter univer-workspace-cli typecheck` and `pnpm --filter univer-workspace-cli test`.

## 7. Preserve package delivery and repository compatibility

- [x] 7.1 Update Client Core exports/dependencies/responsibility README, CLI build graph and worker asset packaging, remove superseded CLI owners, then run `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Server/Collaboration contracts, daemon protocol, CLI Session/license/command/JSON/error behavior and installed artifact remain unchanged and contain no workspace bare import or credential disclosure.

## Implementation notes

- Baseline tree: `b80fd9dd31bfd46d65acafcfc511bb1681ab8bdf`.
- Prerequisite Client Core public exports verified before editing: `WorkspaceHttp`, `AuthenticatedWorkspaceHttp`, `WorkspaceApplicationError`, `workspaceError`, `WorkspaceContentSource`, `WorkspaceRuntimeTarget`, `WorkspaceRuntimeScope`, `parseWorkspaceRuntimeTarget`, `serializeWorkspaceRuntimeTarget`, `workspaceRuntimeKey`, `workspaceSnapshotPrefix`, `WorkspaceSnapshotServerAdapter`, `loadWorkspaceReferenceHostContext`, `createWorkspaceReferencedUnitProviderRegistration`, and `WorkspaceSnapshotLoader`.
- Pre-edit verification: `pnpm --filter @univerjs/univer-workspace-client-core typecheck` exited 0.
- Focused verification: worker/runtime tests passed 14 cases for explicit init, exact endpoints, resolver timing, revision-independent pool reuse and awaited close; synchronized read/export, embedded-image, execution and commit coverage later passed as 4 files / 46 tests, and the final Client Core suite passed 15 files / 263 tests.
- CLI verification: `pnpm --filter univer-workspace-cli typecheck` exited 0; execute/inspect/exchange/screenshot/SVG/Typst/command/auth/config targeted coverage passed 10 files / 63 tests; the complete CLI suite passed 17 files / 74 tests.
- Repository gates: `pnpm typecheck`, `pnpm test`, and `pnpm build` exited 0. Clean Core/CLI builds, `pnpm package:workspace-cli`, package verification and the installed-tarball runtime smoke exited 0; the smoke reported `[package-smoke] installed tarball commands passed`.
- Boundary gates: Core Shell/session/env/file-transfer and private-path searches returned no matches; the excluded Server/reference-provider/Session/auth/Blob/Asset diff was empty; exchange, screenshot and SVG changes were limited to the public runtime-operation port/import. Artifact checkout-path/bare-Core searches returned no matches. Secret diff matches were explicit test fixture values whose tests assert non-disclosure. The optional `127.0.0.1:3020` probe was `environment-unavailable`.
- Pre-completion-note gate tree: `b0f63faf2585cb7a0be0d0e88f83933c6e90ac18`; `git diff --check b80fd9dd31bfd46d65acafcfc511bb1681ab8bdf b0f63faf2585cb7a0be0d0e88f83933c6e90ac18` exited 0.
