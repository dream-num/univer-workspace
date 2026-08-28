> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in the planning repository that contains this Change. Apply only after `extract-space-node-client-core`, `extract-auth-client-core` and `extract-worktree-unit-client-core` are complete.

## 1. Confirm prerequisite boundaries

- [x] 1.1 Verify the target repository contains the private Client Core package plus the completed HTTP/error, `authenticatedHttp(role)` and Worktree/Worktree Unit public exports from Changes 1–3; record their exact export names in this Change's implementation notes and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating a parallel transport, auth or Worktree parser if any prerequisite is absent.

## 2. Move runtime target and source resolution

- [x] 2.1 Move target/scope types, strict parsing, plain-JSON serialization, Snapshot prefix, revision-independent runtime key and Worktree/Trunk target resolution into Client Core, reusing the prerequisite Workspace HTTP and Worktree/Unit owners; migrate target/content-source cases and verify exact scope shapes, round trips, key separation, Draft editability, membership/revision validation, supported-type probe order and non-mismatch early exit with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move scope-aware Snapshot access

- [x] 3.1 Move direct Unit/block reads and the `ISnapshotServerService` adapter into Client Core while preserving their distinct existing error contracts; verify Trunk/Worktree endpoint selection, head-revision mismatch, Snapshot/changeset/block/resource/error-envelope identity, base64 decoding and every write-side read-only rejection with the Client Core test command.

## 4. Move reference policy and provider

- [x] 4.1 Move Worktree host-context loading, mapped/fallback scope selection, v1 load-context encoding/validation and referenced Unit provider registration into Client Core; verify stale host revision, missing host membership, mapped Worktree versus Trunk fallback, malformed/wrong-Unit context, already-aborted load, self/type/loaded-identity checks and all five supported Unit loaders with focused Client Core tests.

## 5. Reconnect Workspace CLI runtime callers

- [x] 5.1 Switch CLI program composition, daemon, worker, content execution/inspection, exchange, screenshot and lint modules to Client Core public exports and the canonical target serializer; keep Session lookup, runtime pool, worker/Collaboration composition and Asset image resolution in their existing owners, remove superseded CLI target/Snapshot/reference implementations, and verify unchanged daemon requests, image Asset resolution, inspect/execute and render behavior with `pnpm --filter univer-workspace-cli test`.

## 6. Preserve package ownership and delivery

- [x] 6.1 Add only the SDK dependencies required by the moved Snapshot/reference implementation, update Client Core and CLI responsibility docs plus package exports/build graph, and verify `pnpm --filter @univerjs/univer-workspace-client-core typecheck`, `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm --filter univer-workspace-cli typecheck`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify` and `pnpm --filter univer-workspace-cli package:smoke` succeed without a workspace bare import or source-checkout dependency.

## 7. Run the compatibility gate

- [x] 7.1 From a clean target-repository build state, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Server/Collaboration contracts, CLI command/JSON/error behavior, target wire shape, Session timing, daemon protocol, Trunk/Worktree/reference policy and installed artifact remain unchanged.

## Implementation notes

- Baseline tree: `33a49d2baaca732dd5bea7850b00877eb55011b4`.
- Prerequisite Client Core root exports verified before editing: `WorkspaceHttp`, `AuthenticatedWorkspaceHttp`, `WorkspaceApplicationError`, `workspaceError`, `getWorktree`, `parseWorktree`, `parseUnit`, `WorkspaceWorktree`, `WorkspaceUnit`, and `WorkspaceUnitType`.
- Pre-edit verification: `pnpm --filter @univerjs/univer-workspace-client-core typecheck` exited 0.
- Final clean-state gates exited 0: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, and `pnpm --filter univer-workspace-cli package:smoke`.
- Gate tree `d476051f1891fa1be383ed21f04c3bf074836240`: `git diff --check 33a49d2baaca732dd5bea7850b00877eb55011b4 d476051f1891fa1be383ed21f04c3bf074836240` exited 0; Server/Browser reference-provider/Session/auth/Asset/Blob and excluded Typst/SVG/embedded-image workflow scope checks were empty. CLI command/JSON/error behavior, target wire shape, Session timing, daemon protocol, Trunk/Worktree/reference policy, and installed artifact remained unchanged.
- Final self-audit gate tree `5e81392c84e6b5a3283022edff9cae0fd246853c`: focused Client Core runtime/reference tests passed (4 files, 66 tests), the full Client Core suite passed (217 tests), and the full repository test/build/package gates above remained green after strict origin, base64/resource-envelope, abort, and read-only adapter edge-case coverage was completed.
