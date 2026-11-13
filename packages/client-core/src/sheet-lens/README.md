# Sheet Lens copy

This internal directory owns the pure Sheet outline, bounded read, find, and delimited-text algorithms used by Client Core. The host supplies workbook snapshots and display text. `engine/display.ts` supplies snapshot display text through Univer's public Core APIs. The sibling `../sheet-lens.ts` owns the host-neutral engine and cache. Authentication, CLI commands, and runtime lifecycle stay with the host. Client Core's root entry exports the engine and its request, continuation, result, and options types.

## Source and copy method

The source is `dream-num/uxl` at commit `ab4070c`, read with `git show` so that no uncommitted file enters the copy.

The copy includes the whole `src/lens/` directory, `src/engine/display.ts`, `src/engine/types.ts`, and `src/platform/cell-error.ts`. Each file was copied as a whole from `git show ab4070c:<path>`, retaining its layout beneath `src/sheet-lens/`. The same method copied all five `test/lens/*.test.ts` files and their three support files, `lens-data.ts`, `outline-grammar.ts`, and `truthfulness.ts`, beneath `test/sheet-lens/`.

To reproduce the copy, enumerate the source paths with `git ls-tree -r --name-only ab4070c`, copy each selected file with `git show ab4070c:<path>`, and replay the differences below. Format only the new files with the repository's oxfmt configuration.

Mechanical differences are relative import relocation, `.js` import suffixes, Vitest imports, repository formatting, and the error class name in imports and comments.

## Non-mechanical differences

- `platform/errors.ts` replaces the application-specific source error with `SheetLensError`, a subclass of `WorkspaceApplicationError`. It maps `E_REF_NOT_FOUND`, `E_RANGE`, `E_SHEET_NOT_FOUND`, and `E_USAGE` to `workspace-sheet-lens-ref-not-found`, `workspace-sheet-lens-range-invalid`, `workspace-sheet-lens-sheet-not-found`, and `workspace-argument-invalid`. It retains hint overrides, details, and causes, exposes hints and details through `detail`, and uses entry-neutral default hints. It omits the source CLI exit-code property.
- The no-match hint in `lens/find.ts` suggests running outline on the Unit. Its two expected strings in `find.test.ts` change with it. Error-code expectations in `read.test.ts` use the mapped Workspace codes.
- `outline.test.ts` creates its two live workbooks through the installed `@univer-cli/headless-univer` public factory and Facade. It disposes the instance after each comparison and if workbook creation throws. Both tests retain live SDK assertions.
- `boundary.test.ts` checks every file beneath `lens/` for imports outside this directory. Only type imports from `@univerjs/core` are allowed as external imports. It also checks its handling of import syntax and escaping relative paths.
- `errors.test.ts` checks all four error mappings and the retained hint, detail, and cause behavior.
- `engine/formulas.ts` adapts only `uncachedFormulas` from uxl's `src/engine/formulas.ts` at `ab4070c`. Counts are keyed directly by sheet ID so equal sheet names cannot merge their counts. The engine never recalculates formulas.
- `../sheet-lens.ts` adds `WorkspaceSheetLensEngine`. It reuses Lens pagination and JSON renderers. Prepared cell views are shared across `read`, `find`, and the lazily built outline model. Structure and model notes become `sheet-lens-*` warnings. Workspace replaces local file and format fields with target metadata supplied by each entry point.

No algorithm, threshold, successful rendering, or parameterized test case changes. The five source test files contain 96 test declarations and 118 expanded cases. `read.test.ts` has 31 declarations and 53 cases because two declarations each contain 12 parameterized cases.

## Engine contract

`new WorkspaceSheetLensEngine({ exportUnitData, maxCachedBytes, bytesPerJsonByte? })` accepts the existing content runtime's `exportUnitData` function. `run(target, caller, request)` requires a resolved `WorkspaceRuntimeTarget` and `WorkspaceRuntimeCaller`, and forwards both to the exporter. Only Sheet targets are accepted. Other Unit types fail before export and suggest `inspect`.

The cache key combines `workspaceRuntimeKey(target, caller)` and `target.revision`. Caller grants remain opaque and do not enter the key. Each entry holds UnitData, the display reader, per-sheet cell views, and the outline model after the first outline request. An access refreshes the entry's position in the byte-bounded LRU cache. Estimated entry bytes equal UTF-8 UnitData JSON bytes multiplied by `bytesPerJsonByte`, rounded up. The default factor is 12. `maxCachedBytes` is required, and zero disables caching. A Unit larger than the budget still returns its result with `sheet-lens-not-cached`.

Results contain `text`, `json`, optional `next`, `warnings`, `revision`, `timings`, and `cache`. Text excludes the Unit header, warning lines, and entry-specific continuation syntax. Timings are monotonic milliseconds named `exportMs`, `prepareMs`, `operationMs`, and `totalMs`. Export and preparation are zero on a hit. Default read and find limits are 500 cells and 50 matches. Read content modes match the request type, including styles and formulas. JSON always preserves typed cached values.

Continuations carry only the new position and remaining count. The host preserves the original request's other options when applying `next`. Read counts remaining rows, find counts remaining matches, and outline includes the omitted node's unit label. Read and find positions are inclusive at the first omitted cell or row. Outline uses Lens's shallowest elision and its `at` and `from` refs.

## Cache memory measurement

Run from the repository root with the installed dependencies:

```bash
SHEET_LENS_MEASURE=1 pnpm --filter @univerjs/univer-workspace-client-core exec vitest run test/sheet-lens/measure.test.ts --pool=forks --execArgv=--expose-gc
```

`measure.test.ts` is skipped unless `SHEET_LENS_MEASURE=1`. It warms the engine and SDK imports, then measures five interleaved samples per size. Each sample allocates its synthetic 10-column ledger inside the injected exporter after the baseline GC. It builds and caches a full outline, forces GC again, and divides the increase in `process.memoryUsage().heapUsed` by the exported UnitData JSON byte count. It then searches every ledger row through a cache hit and asserts exactly one export. The ledger has headers, three text columns, seven numeric columns, and a cached formula in the last column. The 50,000-row ledger has exactly 500,000 cells, within the unchanged Lens threshold.

Measured on 2026-11-13 with Node 24.19.0, Darwin arm64, and Vitest 4.1.11:

| Rows | JSON bytes | Median heap bytes / JSON byte | Minimum | Maximum |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 267,800 | 10.9324 | 10.1485 | 11.7567 |
| 30,000 | 8,666,920 | 10.0433 | 9.9222 | 10.0672 |
| 50,000 | 14,570,120 | 9.3797 | 9.3300 | 9.3862 |

The default factor of 12 rounds up the largest observed sample across all sizes. With a host budget of 512 MiB, these ledger entries are charged about 3.1, 99.2, and 166.7 MiB respectively. The host chooses its byte budget. This is a retained JavaScript heap estimate for these synthetic ledgers. It excludes worker memory, native allocations, and temporary export or preparation peaks. Other workbook contents and Node versions can have different factors. No throughput or latency claim follows from this measurement.
