# Sheet Lens copy

This internal directory owns the pure Sheet outline, bounded read, find, and delimited-text algorithms used by Client Core. The host supplies workbook snapshots and display text. The sibling `engine/display.ts` supplies snapshot display text through Univer's public Core APIs. This directory does not own remote loading, caching, authentication, CLI commands, or runtime lifecycle. It adds no exports to Client Core's public entry.

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

No algorithm, threshold, successful rendering, or parameterized test case changes. The five source test files contain 96 test declarations and 118 expanded cases. `read.test.ts` has 31 declarations and 53 cases because two declarations each contain 12 parameterized cases.
