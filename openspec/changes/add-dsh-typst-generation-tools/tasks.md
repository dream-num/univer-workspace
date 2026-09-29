## 1. Confirm prerequisites and frozen contracts

- [ ] 1.1 Verify Changes 1–6 are implemented and their Host owner, authenticated/license resolver, Worktree-local Unit create signal/result-unknown contract and local `LocalFileSystem`/Session-cwd gate match this design; recheck DSH `0.1.1-rc.2` ToolRuntime pre-execute/finalization order and exact SDK `1.0.0-beta.2` Typst facade/native/headless public exports, then run pre-edit Client Core and `dsh-univer-work` typechecks, stopping instead of creating a parallel owner, parser or baseline when any prerequisite differs.

## 2. Extend Client Core Typst behavior

- [ ] 2.1 Add optional signal, generated-result/UnitData byte-depth limits and materializer license while passing signal to Change 4 Unit create; await frozen native/program operations, stop later steps after cancellation, preserve result-unknown/no-replay and keep omitted controls compatible, with focused Core tests for pre-abort, native/program cancellation, every next-step fence, confirmed/unknown create races, exact limit boundaries, license secrecy and unchanged unsignalled CLI inputs/results.
- [ ] 2.2 Replace process-global deterministic-random patching with a per-invocation Node VM context that injects only the guarded Facade and same-seed random intrinsics; preserve exactly-one-Doc, identity/save/revision/name and total disposal contracts, and verify concurrent deterministic materializations leave Host `Math.random`/`crypto.getRandomValues` unchanged and do not turn VM into an arbitrary-code tool input.

## 3. Add closed tools and local artifact publication

- [ ] 3.1 Register `workspace_typst_compile` and `workspace_typst_apply` in the existing Host effect with exact closed schemas/results, cross-field validation, fixed 512 KiB argument and 8 MiB/depth-64 result gates, fixed secret-safe pre-execute approval and defensive body revalidation; use real ToolRuntime tests to prove invalid/oversize calls request zero approval/work, approval deny/allow, generated JavaScript/PNG bytes remain outside canonical/session content and compile-only resolves no credential/license.
- [ ] 3.2 Reuse Change 5's current local provider/policy/Session-cwd checks before approval and in the accepted body; add disjoint bundle/artifact validation plus mode-restricted same-parent temporary directory publication of fixed `program.js`, `diagnostics.json` and optional previews with no-clobber, sync, 50 MiB/256-preview limits and non-cancellable cleanup, then test local/non-local/read-only/world changes, outside/overlap paths, destination races, exact successful/compile-only-error artifacts, apply/throw failure zero-publication, cancellation and unchanged existing destinations.

## 4. Preserve apply, error, cancellation, and lifecycle outcomes

- [ ] 4.1 Compose apply with the current license and authenticated Unit owner, exact one-compile/one-materialize/one-create behavior, structured diagnostics, frozen Typst/file/Workspace error projection and total caller/owner finalizers; cover errors-before-create, confirmed/unknown create, confirmed Unit followed by artifact failure/cancellation, late-success `ABORTED`, owner-only success, no replay/compensation, safe Unit-list guidance, sentinel secrecy and disposal that drains native/VM/HTTP/file work with no Typst Job, worker, timer or second owner.

## 5. Deliver the real installed Typst closure

- [ ] 5.1 Extend package assembly to inline reachable private Core, exact Typst facade/TypeScript/headless JavaScript and resolve the concrete `@univerjs-pro/doc-typst-native-binding` plus platform optional packages from the installed facade owner; verify manifests/emitted files reject bare Core, `workspace:*`, source/CLI/daemon/Session/system-Typst/absolute paths and a second Typst worker, then install the tarball in an isolated local profile and from an unrelated Session cwd run real-native compile/previews and fake-Workspace apply through real ToolRuntime with budgets, no-clobber, cancellation and bounded dispose.

## 6. Preserve documentation and repository compatibility

- [ ] 6.1 Update the DSH and Client Core READMEs for the delivered two-tool scope, fixed artifact layout, VM-not-sandbox statement, cancellation ceiling, native dependency and exclusions; run focused Typst/Core/CLI tests, full Client Core typecheck/test/build, `dsh-univer-work` typecheck/test/build/package verify/smoke, `pnpm package:workspace-cli` plus CLI package verify/smoke, repository `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate add-dsh-typst-generation-tools --strict` and `git diff --check`, confirming Server/Browser/OpenAPI/database/deployment/Commander/release behavior and the frozen SDK baseline remain unchanged.
