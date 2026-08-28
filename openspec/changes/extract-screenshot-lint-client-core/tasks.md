> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in this planning repository. Apply only after Changes 1–8 are complete. Changes 4, 5 and 6 are direct code prerequisites; Changes 1–3 are transitive, while Changes 7–8 are ordered predecessors only.

## 1. Confirm direct prerequisite boundaries

- [x] 1.1 Verify the target repository contains the completed Client Core Asset content, runtime target/reference and content-runtime UnitData export public operations from Changes 4, 5 and 6; record their exact names and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating a parallel Asset, target, reference or runtime owner if any prerequisite is absent.

## 2. Move render Unit assembly

- [x] 2.1 Move screenshot target loading, UnitData validation, external formula-reference parsing, active Embed child parsing, scope-relative reference resolution and Worktree render-copy Asset rewrite into `@univerjs/univer-workspace-client-core` public exports; migrate the focused feature cases and verify stable reference order/deduplication, self and soft-deleted exclusions, Sheet/Base formula type gates, malformed resources, Trunk no-Asset behavior and Host/reference/Embed image resolution with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move screenshot capture and PNG output

- [x] 3.1 Move browser screenshot capture and the existing local PNG output implementation into Client Core, accepting explicit render page, license and environment inputs without a renderer or filesystem abstraction; verify runtime options and close on success/failure/abort, result fields, recursive destination creation, unsafe-name rejection, `0600` temporary output, pre-existing/concurrent destination preservation, exact bytes and temp cleanup with the Client Core test command.

## 4. Move Slide layout lint

- [x] 4.1 Move the Workspace Slide layout lint workflow into Client Core using the same render Unit and browser runtime owners; verify non-Slide rejection before browser creation, exact Slide input and formula references, structured findings, signal pass-through and runtime close on every settled path with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 5. Move the render page source

- [x] 5.1 Move `apps/cli/render-runtime` to Client Core as the single render-page source, preserve its preset Univer/license bootstrap, 1600×1000 container and relative production build, and make the package build emit a stable asset directory; verify with Client Core typecheck/build plus a static asset check that `index.html` and its local assets exist without sourcemaps or remote runtime dependencies.

## 6. Reduce CLI to command and artifact adapters

- [x] 6.1 Switch CLI screenshot/lint composition and command typing to package exports, pass the existing resolved license/environment and adapt `runtime.export-unit-data` without changing daemon wire payloads, remove superseded feature owners/tests, and make CLI build/package copy the Core render page to the existing `dist/render-runtime` while retaining browser install/probe/resolve and the SVG text-measure consumer; update manifests, build graph and responsibility docs, then verify CLI command/scope/JSON/text/error tests, SVG regression tests, Client Core build, CLI typecheck/tests, package manifest checks and `pnpm --filter univer-workspace-cli package:verify`, including `puppeteer-core`/`@puppeteer/browsers` resolution from the declared render-runtime owner.

## 7. Run the browser artifact and compatibility gate

- [x] 7.1 Extend the installed-tarball smoke to assert the copied render page and load the screenshot/lint/browser-setup surfaces from an arbitrary working directory, then run `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that target/reference/Asset requests, PNG bytes/paths, lint findings, CLI commands/results/errors, browser lifecycle, SVG temporary consumer, exact SDK baseline and installed artifact remain unchanged and contain no workspace bare import or source-checkout dependency.

## Implementation notes

- Baseline virtual tree: `7e53844aa8a90950479f30382259e17dc6ec7529`.
- Direct prerequisite package-root exports verified before editing: `resolveWorkspaceAssetContent`;
  `WorkspaceContentSource.resolveRuntimeTarget`, `resolveTrunkRuntimeTarget`, and
  `resolveReferencedRuntimeTarget`; `WorkspaceRuntimeTarget` / `WorkspaceRuntimeScope`;
  `createWorkspaceReferenceLoadContext`, `readWorkspaceReferenceScope`,
  `selectWorkspaceReferenceScope`, `WorkspaceReferenceHostContext`, and
  `WorkspaceReferenceSourceScope`; and `WorkspaceContentRuntimeOperations.exportUnitData`.
- Pre-edit `pnpm --filter @univerjs/univer-workspace-client-core typecheck` passed.
- Final focused verification passed: Client Core render/source/screenshot/output/lint 58 tests,
  CLI screenshot/lint/SVG 8 tests, CLI full 15 files / 65 tests, and package ownership 13 tests.
- Final gates passed: frozen install, Client Core build, root typecheck/test/build,
  `package:workspace-cli`, package verify, installed-tarball smoke, static render-page closure,
  Core-to-CLI-to-package render-page directory equality, owner/scope/secret checks, and
  `git diff --check`. The root suite passed Client Core 25 files / 429 tests,
  reference-provider 2 / 16, Workspace 34 / 152, and CLI 15 / 65.
- Product virtual tree after the completed implementation and gates:
  `8ee94b17a949394b18c47c587613d6c34cf3045a`.
- Target/reference/Asset request order, PNG bytes and paths, lint findings, CLI command/result/error
  presentation, browser lifecycle, the SVG render-runtime consumer, and exact SDK versions remain
  covered by their migrated or retained tests. Package verify/smoke found no workspace bare import,
  source-checkout dependency, or unresolved render-page asset.
