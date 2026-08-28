> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in this planning repository. Apply only after Changes 1–9 are complete. Changes 6 and 9 are direct code prerequisites; Changes 1–5 are transitive, while Changes 7–8 are ordered predecessors only.

## 1. Confirm the completed extraction prerequisites

- [x] 1.1 Verify Changes 1–9 have completed their own compatibility gates and the target repository contains the real Client Core Slide content execution plus browser runtime/render-page public seams from Changes 6 and 9; record their exact export names and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping and returning to the owning Change instead of adding a parallel owner when any prerequisite is absent.

## 2. Move SVG source and compilation ownership

- [x] 2.1 Add local SVG source/relative-asset loading, compiler input/result types and the existing `@univer-cli/svg-facade` compilation to `@univerjs/univer-workspace-client-core` public exports without a filesystem or compiler registry; migrate focused compiler cases and verify one compile call, source-relative nested assets, raw code, viewport, warnings, lints, unreadable input propagation and no browser creation for an SVG without text with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move SVG text measurement

- [x] 3.1 Move the styled-run Univer Doc mapping, lazy real-font runtime lifecycle and explicit built-in estimation path into Client Core, reusing Change 9's render dependency and explicit render-page/license/environment inputs; verify run offsets/styles/metrics, one runtime across multiple lines, close after success/compiler failure/measurement failure, no runtime for estimation, exact `builtin-estimate`/`univer-render-runtime` metadata and one existing estimation lint with the Client Core test command.

## 4. Move page construction and apply

- [x] 4.1 Move raw/page program selection and SVG apply into Client Core, using the prerequisite Slide content execution operation and the same single compiled result; verify positive page metadata, compiled viewport, replace/add wrapping, exact Worktree/Unit execution input, committed and no-mutation results, failure propagation, and no compilation or execution replay with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 5. Reduce CLI to Client Shell adapters

- [x] 5.1 Switch CLI program composition and `compile-svg` command to package exports, retaining Commander option validation, license/environment/render-page path assembly, `--out` write, warning/lint stderr and JSON/text presentation; remove the superseded CLI SVG implementation/tests and verify unchanged arguments, validation order/error codes, generated code, output file, diagnostics, runtime options and Worktree commit results with CLI command-contract, built-entrypoint and application integration tests from an arbitrary working directory.

## 6. Finish package ownership and migration cleanup

- [x] 6.1 Update Client Core/CLI exports, exact SDK dependencies, build graph and responsibility docs, then use a repo-wide import scan to remove only unreferenced migration re-export shims and duplicate CLI owners left by Changes 1–10; verify Client Core build, CLI typecheck/tests, package manifest checks and `pnpm --filter univer-workspace-cli package:verify` preserve the private single-package boundary, existing `dist/render-runtime`, worker child, Skills, browser dependencies and native dependency closure without a workspace bare import.

## 7. Run the complete CLI parity and package checkpoint

- [x] 7.1 Extend the installed-tarball smoke only as needed to load the full command surface and version-matched worker, render page, Puppeteer dependencies and native bindings from an arbitrary working directory, then run `pnpm --filter @univerjs/univer-workspace-client-core typecheck`, `pnpm --filter @univerjs/univer-workspace-client-core test`, `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record parity for auth, Space/Node, Worktree/Unit/open, Blob/Asset, target/reference, content execute/inspect/commit, Office, Typst, screenshot/lint, SVG, daemon, Skills and the installed artifact, without implementing a missing predecessor in this Change.
