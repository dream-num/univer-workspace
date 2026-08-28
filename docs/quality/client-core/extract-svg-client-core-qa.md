# `extract-svg-client-core` QA matrix

Status: **PASS — AC-01–95 pass；AC-96 environment-unavailable；0 open issue；Ready**

This report defines the acceptance evidence for Change 10 only. It does not treat task completion as proof, does not repair a missing Change 1–9 prerequisite in this Change, and does not authorize product or OpenSpec edits. The implementation must reuse the existing public content-execution and render-runtime seams. QA must reject a parallel target, runtime, browser, commit, filesystem, compiler-registry, service-container, cache, pool, or compatibility owner.

## Fixed references and boundaries

- Change artifacts: `openspec/changes/extract-svg-client-core/{proposal.md,design.md,tasks.md,specs/workspace-client-core/svg/spec.md}`.
- Domain: `apps/workspace/CONTEXT.md`, ADR-0001, ADR-0002, and the artifact ownership rule recorded by ADR-0003/ADR-0005.
- Behavioral baseline: the pre-extraction `apps/cli/src/features/svg/{command,text-measurer}.ts`, `apps/cli/test/{workspace-compile-svg,svg-text-measurer,workspace-cli}.test.ts`, and current package scripts.
- Direct prerequisites: the public `WorkspaceContentExecutionFeature.executeSlide` operation and Client Core browser render/runtime delivery seam. If either is absent, stop and return to its owning Change.
- Client Core owns source/asset compilation, text measurement, page wrapping, and apply orchestration. CLI owns Commander validation, license/environment/render-page assembly, `--out`, diagnostics, and JSON/text presentation.
- Local Node filesystem semantics remain concrete. Change 4 Blob/Asset transfer is not a filesystem provider for SVG compilation.

## Scenario-to-evidence matrix

Every AC starts as `not-run`. Direct behavior belongs in new Client Core SVG tests; shell behavior stays in the existing CLI tests. Test names below are required behavior labels, not required implementation names.

### A. Prerequisites and extraction boundary

| AC | Scenario / observable | Executable evidence | Expected |
|---|---|---|---|
| AC-01 | Changes 1–9 are complete | Inspect their final QA/review reports and run the final source/package gates in section J | Every predecessor has zero open blocking issue; a missing predecessor stops Change 10 |
| AC-02 | Shared Slide execution is reused | Import/owner scan plus focused Core apply test | SVG calls the existing public Slide execution once; no second target/runtime/commit owner exists |
| AC-03 | Shared browser runtime is reused | Import/owner scan plus focused measurement lifecycle tests | SVG uses the existing Client Core render dependency and caller-supplied page/license/environment |
| AC-04 | Package exports are real prerequisites | Import `@univerjs/univer-workspace-client-core` from package tests/build output | SVG types and operations are public root exports; consumers use no private source path |
| AC-05 | SDK baseline remains exact | Manifest/lock diff and SDK dependency test | `@univer-cli/svg-facade` uses the repository's exact cohort; no floating range or duplicate version |
| AC-06 | Local-only scope remains narrow | Diff/owner scan | No filesystem provider, compiler registry, browser pool/cache, cancellation protocol, remote filesystem, or new npm package |
| AC-07 | Server and contracts are untouched | Fixed implementation diff review | No Workspace Server, persistence, HTTP/WS protocol, Session, daemon wire, or Browser application behavior change |

### B. SVG source, assets, and single compilation

Map AC-08–18 to `packages/client-core/test/svg.test.ts`; keep an arbitrary-cwd integration case in `apps/cli/test/workspace-cli.test.ts`.

| AC | Scenario / observable | Fixture/assertion | Expected |
|---|---|---|---|
| AC-08 | UTF-8 source read | SVG contains non-ASCII text | Compiler receives the exact UTF-8 string once |
| AC-09 | Relative asset resolution | SVG and asset are below the same directory while `cwd` is elsewhere | Resolver reads from the SVG source directory, never process cwd |
| AC-10 | Nested relative asset resolution | Nested SVG references `assets/a.bin` and `../shared/b.bin` | Both paths resolve from the source file directory and preserve exact bytes |
| AC-11 | Single compiler call | Exercise raw, page replace, page add, and apply variants | Each top-level operation calls the facade compiler exactly once |
| AC-12 | Compiler input is complete | Spy on compiler dependencies | Exact source, asset resolver, and selected text measurer are passed; no Shell or credential object leaks in |
| AC-13 | Structured fields are lossless | Compiler returns distinctive code, viewport, warnings, lints, and text metadata | Result preserves each field, order, value, and object identity where the old CLI did |
| AC-14 | Raw code is unchanged | Compile without page | Returned code is byte-for-byte compiler code with no page wrapper |
| AC-15 | Unreadable source propagates | Missing/permission-denied source | Existing filesystem error propagates; compiler, runtime, and execution are called zero times |
| AC-16 | Unreadable requested asset propagates | Compiler asks resolver for an unreadable asset | Existing read error propagates; there is no retry, fallback, or path rewriting |
| AC-17 | No-text SVG does not create browser | Compiler never invokes text measurement | Compile succeeds and runtime factory/close are both called zero times |
| AC-18 | Source/asset inputs are not mutated | Freeze input and asset buffers | Compile completes without modifying caller input or returned compiler fields |

### C. Browser-backed text measurement and lifecycle

Map AC-19–32 to `packages/client-core/test/svg-text-measurer.test.ts` plus the SVG orchestration tests.

| AC | Scenario / observable | Fixture/assertion | Expected |
|---|---|---|---|
| AC-19 | Styled runs become one Doc stream | Multiple runs with distinct text | `dataStream` preserves run order and ends with the existing `\r\n`; paragraph starts at the same offset |
| AC-20 | Run offsets use existing string semantics | Include ASCII and surrogate-pair text across runs | Each run starts/ends at the exact pre-extraction offsets; no byte-offset conversion |
| AC-21 | Styles map exactly | Vary font size, bold, italic, and family | `fs = fontSizePx * 0.75`; `bl`, `it`, and `ff` presence/value match the old mapper |
| AC-22 | Layout envelope remains borderless | Inspect generated UnitData | Existing large page and zero-margin settings remain exact; no extra document defaults appear |
| AC-23 | Metrics map exactly | Runtime returns distinctive width and first-line metrics | Result uses actual width plus first-line ascent/descent exactly |
| AC-24 | Multiple requested lines share one runtime | Compiler measures several lines | One lazy runtime is created and every line is measured in request order |
| AC-25 | Runtime inputs are explicit | Spy on runtime creation | Exact render-page root, license, and environment from the Client Shell are supplied |
| AC-26 | Creation is lazy | Compile begins before first text request | Runtime is not created until the first request and only once |
| AC-27 | Success awaits close | Defer `close()` and observe operation settlement | Operation remains pending until the one close completes |
| AC-28 | Compiler failure awaits close | Compiler measures text and then rejects | Original compiler failure propagates only after one awaited close |
| AC-29 | Measurement failure awaits close | Runtime `measureText` rejects | Original measurement failure propagates only after one awaited close |
| AC-30 | Runtime creation failure is not hidden | Factory rejects | Original failure propagates; no estimator fallback and no close on a nonexistent runtime |
| AC-31 | Real mode metadata is exact | Successful real measurement | Result reports exactly `univer-render-runtime` and not estimator metadata |
| AC-32 | Cleanup does not replace primary failure | Compiler/measurement fails and close also fails | Outcome follows the existing error precedence; neither failure triggers recompile or another runtime |

### D. Deterministic estimation

Map AC-33–37 to the focused Core SVG tests.

| AC | Scenario / observable | Fixture/assertion | Expected |
|---|---|---|---|
| AC-33 | Estimation is explicit | Same SVG with/without estimate flag | Only the explicit flag selects the facade's built-in estimator |
| AC-34 | Estimation starts no browser | Text-bearing SVG in estimate mode | Runtime factory and close are both called zero times |
| AC-35 | Estimation metadata is exact | Successful estimated compile | Result reports exactly `builtin-estimate` |
| AC-36 | Existing diagnostics are preserved | Compiler returns ordered warnings/lints | Original warnings/lints remain ordered and unchanged; one fixed estimate-placement lint is appended |
| AC-37 | Estimation is deterministic | Compile identical input twice | Generated code, viewport, measurements, warnings, and lints are deeply equal |

### E. Raw/page program construction

Map AC-38–45 to `packages/client-core/test/svg.test.ts`.

| AC | Scenario / observable | Fixture/assertion | Expected |
|---|---|---|---|
| AC-38 | No page means no wrapper | Compile without page | Raw compiler code returns unchanged; wrapper is called zero times |
| AC-39 | Positive page is preserved | Structured input contains a positive page | Result returns the exact page value |
| AC-40 | Viewport is passed exactly | Distinctive width/height | Wrapper receives compiler viewport unchanged |
| AC-41 | Replace mode is exact | Page with `add=false` | Wrapper is called once in replace mode and metadata says `replace` |
| AC-42 | Add mode is exact | Page with `add=true` | Wrapper is called once in add mode and metadata says `add` |
| AC-43 | Generated page program is returned losslessly | Wrapper returns distinctive code | Result code is exactly that code, wrapped once |
| AC-44 | Page construction does not recompile | Both page modes | Compiler remains one call and text/runtime lifecycle remains one top-level lifecycle |
| AC-45 | Wrapper failure is terminal | Wrapper rejects | Failure propagates; execution is zero and compiler/wrapper are not replayed |

### F. Shared Slide apply

Map AC-46–55 to focused Core SVG apply tests and keep one CLI application integration case.

| AC | Scenario / observable | Fixture/assertion | Expected |
|---|---|---|---|
| AC-46 | Apply input uses exact identity | Distinctive Worktree/Unit/page/code | `executeSlide` receives the same Worktree id, Unit id, and generated page code once |
| AC-47 | Apply uses page program, not raw compiler code | Compiler and wrapper return different markers | Execution receives only the wrapper result |
| AC-48 | Commit success is preserved | Execution returns committed=true | Structured compile fields plus existing committed result are returned unchanged |
| AC-49 | No mutation is preserved | Execution returns committed=false | Result remains successful/no-mutation; no compile, wrap, execute, or commit replay |
| AC-50 | Target/Draft validation failure propagates | Existing execution seam rejects before runtime mutation | Same coded failure escapes; SVG adds no target resolver or recovery path |
| AC-51 | Execution failure propagates | Slide execute rejects | Same structured failure; one compile and one execution maximum |
| AC-52 | Commit failure/result-unknown propagates | Shared operation returns its known/unknown failure | Same code/detail/identity; no second execution or compile |
| AC-53 | Compile failure has no Workspace side effect | Compiler rejects | Wrapper and execution are both zero calls |
| AC-54 | Page failure has no Workspace side effect | Wrapper rejects | Execution is zero calls |
| AC-55 | Apply does not mutate inputs | Freeze structured request and generated program | Operation completes/fails without changing caller values |

### G. Workspace CLI compatibility

Map AC-56–70 to `apps/cli/test/workspace-compile-svg.test.ts`, `apps/cli/test/svg-text-measurer.test.ts`, `apps/cli/test/application-command-contracts.test.ts`, and `apps/cli/test/workspace-cli.test.ts`.

| AC | Scenario / observable | Expected |
|---|---|---|
| AC-56 | Command surface | `compile-svg <file>` and all existing options/help text remain unchanged |
| AC-57 | Positive-page parser | Zero, negative, fractional, and malformed page values fail with the same Commander error before Core invocation |
| AC-58 | Validation order | `--add`/`--out` without page, apply without page/Worktree/Unit, and stray Worktree/Unit fail in the same precedence and wording |
| AC-59 | Shell dependency assembly | CLI resolves the same license, environment, and installed `dist/render-runtime` path and passes them exactly once |
| AC-60 | Core request mapping | File, estimate/page/add/apply/Worktree/Unit options map exactly; CLI contains no compile/measure/wrap/apply owner |
| AC-61 | `--out` behavior | Only page mode permits it; existing UTF-8 overwrite/path/error behavior and final newline remain byte-compatible |
| AC-62 | Output-write ordering | A write failure occurs after compile and before apply, and therefore invokes shared execution zero times |
| AC-63 | Diagnostics presentation | Non-JSON mode emits warnings then lints to stderr with unchanged text/order; JSON mode does not duplicate them on stderr |
| AC-64 | JSON presentation | stdout is the same complete structured result, two-space JSON plus one newline, with no prose |
| AC-65 | Text raw/page presentation | Existing generated code versus generated-file messages remain exact |
| AC-66 | Text apply presentation | Existing committed and no-mutation messages remain exact |
| AC-67 | Error contract | Filesystem, compiler, browser, output, target, execute, commit, and result-unknown errors retain code/detail, stdout/stderr, and exit status |
| AC-68 | Browser selection | Real mode uses assembled browser inputs; estimate and no-text paths create no browser |
| AC-69 | Built entrypoint arbitrary cwd | Built CLI compiles a fixture with nested relative asset in estimate mode outside the repository cwd |
| AC-70 | CLI/session/daemon isolation | SVG command neither reads/writes Session nor adds daemon RPC/wire payload; credential values never enter output/errors |

### H. Ownership, build, and installable closure

| AC | Scenario / observable | Executable evidence | Expected |
|---|---|---|---|
| AC-71 | Unique implementation owner | `rg` imports/symbols after extraction | Compiler orchestration and text measurer live in Client Core; CLI contains only the command adapter |
| AC-72 | Safe shim cleanup | Compare all imports before deleting a shim | Only zero-caller migration shims/duplicate owners are deleted; referenced compatibility exports remain |
| AC-73 | Public/private import discipline | Repo-wide import scan and package verify | No consumer imports Client Core `src/**`; built artifact has no workspace bare import/source path |
| AC-74 | Dependency ownership | Manifest/lock/package-artifact tests | Client Core owns exact svg-facade/render dependencies; CLI distribution owns its artifact closure; no new dependency |
| AC-75 | Worker delivery | Package verify and installed daemon/inspect smoke | Worker entry and colocated `worker-child.mjs` resolve from the tarball |
| AC-76 | Render delivery | Package verify plus installed render-page inspection | `dist/render-runtime/index.html`, local assets, and no sourcemap/source dependency remain valid |
| AC-77 | Skills delivery | Package verify and installed `skills list --json` | All eight Skills are present and load from the installed package |
| AC-78 | Browser dependencies | Installed package resolver and screenshot/lint/compile-svg surfaces | `puppeteer-core` and `@puppeteer/browsers` resolve from the install, not workspace hoisting |
| AC-79 | Three native bindings | Installed package load/smoke | Typst, formula-rust, and exchange native bindings resolve/load with owned exact versions |
| AC-80 | Installed SVG operation | Tarball smoke from arbitrary cwd | A real minimal UTF-8/nested-asset SVG compile succeeds without source checkout or user credentials |

### I. Final ten-slice parity checkpoint

These ACs verify existing gates; they do not move a failed predecessor into Change 10.

| AC | Slice | Minimum evidence | Expected |
|---|---|---|---|
| AC-81 | Authentication | Core auth tests, CLI auth transport tests, installed fixture login/complete/whoami/logout | Protocol, byte schema, secrecy, and CLI presentation remain compatible |
| AC-82 | Space/Node | Core space tests, CLI space/application tests, installed list/browse | Request, model, JSON/text, and coded errors remain compatible |
| AC-83 | Worktree/Unit/open | Core worktree-unit tests, CLI contracts, installed lifecycle/unit/open | State, identity, idempotency, review URL, and result-unknown behavior remain compatible |
| AC-84 | Blob/Asset | Core file-transfer tests and installed exact-byte/mode fixture | Upload/download/sign/identity/recovery and atomic file behavior remain compatible |
| AC-85 | Target/reference | Core target/source/snapshot/reference tests plus CLI content tests | Parsing, resolution order, read-only snapshot, and reference identity remain compatible |
| AC-86 | Content execute/inspect/commit | Core runtime/worker/execution/image tests and installed authenticated inspect | Pool, worker, execute, embedded image, commit, and close behavior remain compatible |
| AC-87 | Office exchange | Core/CLI exchange tests and installed native load | Import/export matrix, identity, exact revision, and native ownership remain compatible |
| AC-88 | Typst | Core/CLI Typst tests and installed real minimal bundle compile | Compile/materialize/apply, deterministic state restoration, and native artifact remain compatible |
| AC-89 | Screenshot/lint | Core/CLI render tests and installed surfaces | Assembly, browser lifecycle, atomic PNG output, lint, render page, and browser deps remain compatible |
| AC-90 | SVG | AC-08–80 plus Core/CLI full suites | Compile, measure, page, apply, shell, and installed behavior pass together |
| AC-91 | Daemon and Skills | CLI daemon/legacy/skills tests plus installed start/status/stop and Skills list | Wire shapes, socket lifecycle, signals, license/session, and eight Skills remain compatible |
| AC-92 | Installed artifact | Package manifest tests, verify, npm pack/install smoke from arbitrary cwd | Full command surface, shared Core, worker/render/browser/native assets resolve without workspace/source dependency |

### J. Repository, package, hygiene, and environment gates

| AC | Gate | Command / inspection | Expected |
|---|---|---|---|
| AC-93 | Focused and full source gates | Commands below for Core, CLI, and root | All typecheck/test/build commands exit 0 |
| AC-94 | Frozen and package gates | `pnpm install --frozen-lockfile`; package build/verify/smoke | Frozen install and tarball closure exit 0 with no undeclared dependency |
| AC-95 | Diff, owner, and secret hygiene | Fixed-base `git diff`, owner/import `rg`, `git diff --check`, secret scan of changed fixtures/logs | Scope is limited; unique owners remain; no credential/device code/cookie/password is persisted or printed |
| AC-96 | Optional local authenticated smoke | First probe `127.0.0.1:3020`; if available, use credentials only through secure runtime input and prefer read-only login/whoami/Space/Node | Failure caused solely by absent Server is `environment-unavailable`, not product failure; this smoke never replaces automated gates and no credential appears in command history/report |

## Commands to run after implementation

Run from `/Users/shenweimin/github.com/dream-num/univer-workspace`. Capture exit code and the focused test names/output in the execution section; do not record secrets.

```sh
# Fixed scope and prerequisites
git diff --name-status <implementation-base>..<implementation-tree> -- . ':(exclude)docs/quality/**' ':(exclude)openspec/**'
rg -n "WorkspaceContentExecutionFeature|executeSlide|createUniverRenderRuntime|Workspace.*Svg|compileWorkspace.*Svg" packages/client-core apps/cli/src
rg -n "packages/client-core/src|@univerjs/univer-workspace-client-core/src|apps/cli/src/features/svg/(text-measurer|compile)" apps packages

# Focused behavior
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/svg.test.ts test/svg-text-measurer.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-compile-svg.test.ts test/svg-text-measurer.test.ts test/application-command-contracts.test.ts test/workspace-cli.test.ts

# Package and repository gates
pnpm install --frozen-lockfile
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli test
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check
```

The focused Core filenames may be consolidated by the implementation, but the runner must still select and report every mapped scenario. Do not accept a mocked `package:smoke` in place of npm pack, isolated install, installed executable, native loads, worker/render assets, and arbitrary-cwd execution.

## Execution record

QA executed on 2026-08-28 against the fixed trees below. Product evidence comes from the fixed tree diff, direct source inspection, focused tests, full repository gates, and the isolated installed-tarball smoke; implementation/review claims were not accepted as proof.

```text
baseline:       27a3b99627839040840052dea948ac8b07451598
implementation: f90023ca61ed593993ce5e252329492542ed9aa8
product diff:   16 files, 739 insertions, 249 deletions
```

### AC results

| AC | Result | Evidence and conclusion |
|---|---|---|
| AC-01–07 | pass | Changes 1–9 final QA/review records have zero open blocking issues. Fixed diff only moves the SVG owner, tests, package dependency, docs, and installed smoke. `WorkspaceCompileSvgFeature` uses existing `WorkspaceContentExecutionFeature.executeSlide` and `createUniverRenderRuntime`; root exports resolve; exact `1.0.0-beta.2` svg-facade ownership moved from CLI to Core; Server, HTTP/WS, Session, daemon wire, Browser app, and SDK cohort are untouched. No parallel framework/owner was added. |
| AC-08–18 | pass | `packages/client-core/test/svg.test.ts` proves exact UTF-8 source, `assets/a.bin` and `../shared/b.bin` resolution from `dirname(file)`, exact bytes, one compile, raw fields/reference preservation, unreadable source before compile/runtime, unreadable asset without retry, and no browser when no measurement occurs. Source inspection shows only sync Node reads and no input mutation path. Installed smoke independently compiles UTF-8 text plus a nested PNG from another cwd. |
| AC-19–23 | pass | `packages/client-core/test/svg-text-measurer.test.ts` proves ordered one-line stream, `\r\n`, JavaScript string offsets including a surrogate pair, paragraph offset, `fs * 0.75`, bold/italic/family presence, zero margins, fixed large page, and exact first-line ascent/descent/actual width. The migrated implementation matches the previous mapper. |
| AC-24–32 | pass | Focused Core tests prove lazy one-runtime reuse across two lines, exact render root/license/environment, success settlement waiting for close, one close after compiler or measurement failure, runtime factory failure without fallback, and `univer-render-runtime`. Source comparison preserves the old `finally` close-error precedence and never retries compile/runtime. |
| AC-33–37 | pass | Two identical estimate operations are deeply equal, use `builtin-estimate`, create no browser, retain original diagnostics, and append the existing estimate lint once. |
| AC-38–45 | pass | Focused tests prove raw/no-wrapper, exact viewport/page, one replace or add wrap, same returned page program, one compiler call, and terminal wrapper failure with zero execution. |
| AC-46–55 | pass | Focused apply tests prove exact generated program/Worktree/Unit passed once to shared Slide execution, committed and no-mutation result preservation, no replay, and terminal wrapper/execution failures. Source inspection confirms compile/page failure cannot enter apply and input values are only read/spread. |
| AC-56–70 | pass | CLI focused suite (3 files/24 tests) proves exact option mapping including whitespace preservation, validation before Core, JSON without duplicate diagnostics, warning/lint stderr order, output-before-apply, write failure with zero apply, raw/text/no-mutation presentation, and built entrypoint arbitrary cwd. Command/parser/error text is unchanged in the fixed diff; `program.ts` supplies the same license/environment/render-page inputs and adds no Session/daemon behavior. |
| AC-71–74 | pass | Owner/import scans find compiler, wrapper, estimator, and text measurer only in `packages/client-core/src/svg.ts`; the old CLI text-measurer owner is deleted, CLI svg-facade dependency is removed, Core declares it exactly, and no consumer imports Client Core private `src/**`. No new runtime dependency or compatibility shim exists. |
| AC-75–80 | pass | Package verify and smoke prove worker plus colocated child, render page/local assets, eight Skills, both Puppeteer dependencies, Typst/formula/exchange native closure, and a real installed SVG operation from arbitrary cwd. Package has no workspace/source bare import. |
| AC-81–92 | pass | Full Core 27 files/453 tests, CLI 14 files/69 tests, Workspace 34 files/152 tests, reference-provider 2 files/16 tests, package artifact 13 tests, and installed smoke jointly cover auth; Space/Node; Worktree/Unit/open; Blob/Asset; target/reference; content/worker/inspect/commit; Office; Typst; screenshot/lint; SVG; daemon; Skills; and installed artifact parity. The smoke performs fixture login/complete/whoami/logout, list/browse/lifecycle/transfer/inspect, real Typst and SVG compile, daemon start/status/stop, render/worker/browser/native/Skills checks, and credential non-disclosure. |
| AC-93 | pass | Core/CLI focused and full suites, Core/CLI/root typecheck, Core/CLI/root build, SDK 4/4, release 8/8, and root test all exit 0. |
| AC-94 | pass | `pnpm install --frozen-lockfile` reports already up to date; package build, verify, npm pack metadata, isolated npm install, and installed smoke all exit 0. |
| AC-95 | pass | Fixed `git diff --check` and final worktree `git diff --check` exit 0. Fixed product diff is limited to 16 declared files; owner/private-import scans are clean. Secret scan finds only the existing synthetic fixture non-disclosure reference and no user credential, Cookie value, device code value, password, license bytes, signed URL, or key. |
| AC-96 | environment-unavailable | Unauthenticated `curl --max-time 2 http://127.0.0.1:3020/` exits 7 (`connection refused`). No account credential was read or used. The optional smoke is not counted as an automated gate and does not change the product verdict. |

Summary: **AC-01–95 pass; AC-96 followed its specified `environment-unavailable` branch; 0 fail; 0 open issue. The Change is Ready.**

### Commands and observed outcomes

| Command / inspection | Outcome |
|---|---|
| Fixed `git diff --name-status/stat` and `git diff --check` | exit 0; 16 product files, expected SVG/package/docs scope |
| Core SVG focused Vitest | 2 files, 14 tests passed |
| CLI SVG/contracts/built-entrypoint focused Vitest | 3 files, 24 tests passed |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck` | exit 0 |
| `pnpm --filter @univerjs/univer-workspace-client-core test` | 27 files, 453 tests passed |
| `pnpm --filter @univerjs/univer-workspace-client-core build` | exit 0; render page built |
| `pnpm --filter univer-workspace-cli typecheck` | exit 0 |
| `pnpm --filter univer-workspace-cli test` | package artifact 13/13; CLI 14 files/69 tests passed |
| `pnpm install --frozen-lockfile` | exit 0; lockfile already current |
| `pnpm typecheck` | exit 0 for all workspace projects |
| `pnpm test` | exit 0; SDK 4, release 8, reference-provider 16, Core 453, Workspace 152, CLI 69 tests passed |
| `pnpm build` | exit 0 for reference-provider, Core, CLI, and Workspace |
| `pnpm package:workspace-cli` | exit 0; 203 files, packed 13,029,788 bytes, unpacked 58,137,751 bytes |
| `pnpm --filter univer-workspace-cli package:verify` | exit 0 |
| `pnpm --filter univer-workspace-cli package:smoke` | exit 0; `[package-smoke] installed tarball commands passed` |
| `npm pack --json --dry-run` in `apps/cli/package-dist` | `univer-workspace-cli-0.0.0.tgz`; SHA-1 `5d9debf45477cb11fb53b88418dab255f7b897ab`; integrity `sha512-EGgJKC3iFoHQV2eomeMXCydJlVo34iG8G9Zypwi9UKsC8s27GtwPiD0qiEJ0GVsbVPTvgUs39vTNS6CtjKPjAg==` |
| SDK dependency test and owner/private-import/secret `rg` scans | SDK 4/4 passed; ownership/import/secret hygiene passed |
| Local Server probe | curl exit 7; `environment-unavailable`; no credential used |

## QA issues

| ID | Severity | AC | Evidence (file/command/output) | Expected | Status |
|---|---|---|---|---|---|

Final state: **0 issues; 0 open.**
