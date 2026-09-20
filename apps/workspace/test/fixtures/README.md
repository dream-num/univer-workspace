# Header fixture

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.header.config.ts` from the repository root, then open `http://127.0.0.1:5182/test/fixtures/header.html`.

This development entry renders the application Header with inert callbacks and no product data access. Check both languages, long document names, lifecycle states, and frame widths 1440, 1300, 1130, 960, 720, and 480 px. The fixture sidebar stays 256 px wide. Merge preview controls preserve the content-area placement and disappear in comparison mode.

The fixture has its own development configuration and requires no backend. Production
`build:web` still uses `web/index.html`; it does not include this test HTML entry.
`pnpm --filter @univerjs/univer-workspace typecheck` also checks the relocated fixture.

## Immersive resource fixture

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.immersive.config.ts`,
then open `http://127.0.0.1:5183/nodes/html` (HTML) or `/nodes/text` (plain text).
The fixture uses the real resource route, Workspace layout, ShareDialog and sandbox renderer with
in-memory fetch responses. It never connects to the product backend or collaboration data.

Check normal entry, Command/Ctrl click, browser Back and direct `?view=immersive` reload.
The HTML instance identifier and typed notes should survive presentation changes. The immersive feature
must not react to Escape. Share view selection must change only the generated link;
HTML defaults to immersive and text to standard. Actual live Sheet writes require a configured backend.

The sidebar also includes a folder with a second text resource. Expand it, then switch
between HTML, text, the folder and its child. The sidebar should retain its rows,
expansion and scroll position while only the content changes. Switching to immersive
view should preserve the current HTML instance.

## Mobile Sheets plugin verification

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.mobile.config.ts`,
then open `http://127.0.0.1:5184/test/fixtures/mobile.html?stack=core`.
This standalone fixture uses the application's installed SDK and React 19 dependency graph,
public package exports, and an in-memory workbook. It does not connect to Workspace data.
The production editor is unchanged. Reloading resets the sample data.

- `stack=core`: mobile workbench, Sheets, formula UI and number-format UI.
- `stack=features`: also adds drawing, conditional formatting, validation, filtering,
  find/replace, links, sorting, tables and local thread comments.
- `stack=advanced`: also adds the Pro preset with mobile variants, chart UI and shape UI.
  Exchange/print UI may be present, but no conversion backend is provided.
- `stack=advanced&desktop=1`: desktop control using the same presets and sample data.
- `stack=advanced&omitPivot=1`: diagnostic exclusion of pivot logic and UI only.

Wait for the grid to render before testing. “写入/撤销/重做” writes B2=7 and checks
undo/redo against the previous value. “检查数据” reads A2, B2 and D2, reports viewport
size and accumulated errors. Formula evaluation is asynchronous: read after it settles;
D2 should equal B2×5. “保存并重建” saves a snapshot, disposes Univer and mounts the
snapshot again; a successful run increments `mounted`. Recheck data after remount.
Use the actual floating edit button and tools drawer for UI tests.

### Observed on 2026-09-19, SDK 1.0.0-rc.0

Verification used the desktop in-app browser with 390×844 and 844×390 viewports;
this is viewport testing, not touch-device or mobile-browser emulation.

- Core: mounted mobile UI, API write/undo/redo passed, formula recomputed 7×5=35.
  Native mobile edit entry accepted keyboard input and committed it (7→79; D2=395).
  This does not establish native phone IME or software-keyboard behavior.
- Features: write/undo/redo passed; mobile tools exposed filter/sort/conditional-format
  actions; Chinese find input `苹果` produced `1/1`. Snapshot/dispose/remount retained
  B2=7 and D2=35. Individual filter/sort/validation mutations were not exhaustively tested.
- Pro: mounted and edited with no captured startup errors; mobile chart picker inserted
  and rendered a column chart. The large default chart extends beyond the narrow grid.
- **Custom Pro fixture teardown failure (not an official-example verdict):** after the grid settles, save/dispose/remount
  reproducibly throws `TypeError: Cannot read properties of undefined (reading 'indexOf')`
  during `univer.dispose()`, before remount. It also occurs without inserting a chart.
  Published Core's interceptor disposer calls `remove(this._interceptorsByName.get(key),
  interceptor)` after its map has been cleared. One stack includes the published pivot UI;
  omitting pivot still reproduces the failure through another disposer. The desktop Pro
  control completed a remount. The precise owning controller and a reproduction using the complete official
  composition remain to isolate; this does not establish a defect in the official example.
  Immediate remount before deferred initialization completes can pass and is insufficient.
- One rapid repeated mobile remount also emitted `Locale not initialized` and
  `Cannot read properties of null (reading 'removeEventListener')`. These are additional
  lifecycle observations, not independently isolated root causes.

No installed packages were patched. Do not suppress disposal exceptions or disable Pro
features in production based on this fixture. Real-device gestures, software keyboard/IME,
clipboard, collaboration/reconnect, authorization, server comments, history and Office
conversion still need separate validation before claiming Workspace mobile support.

### Official-source review (updated 2026-09-20, local dev checkouts)

Earlier reviews mixed stale references: univer-pro `main` stops at v0.24.0 (2026-05-23)
and is not the current source. The authoritative branch is `dev`. This update reads local
checkouts pulled on 2026-09-20: `univer` dev @ `279c049cde`, `univer-pro` dev @ `d3f40ded20`
(submodule `submodules/univer` @ `279c049cde`). Published SDK 1.0.0-rc.0 (npm `rc` tag,
2026-09-10) remains the newest release; npm `latest` still points to the 0.25.x stable
line. The installed 1.0.0-rc.0 packages were verified per-package to contain every
Mobile export used by the dev sheets example, so the fixture's SDK baseline needs no
upgrade for Sheets work.

The initial fixture was a custom transformation of desktop presets, **not a faithful
reproduction of an official mobile example**. Do not use its disposal failure to
conclude that the official mobile stack is unsuitable for Workspace.

Current official Pro mobile composition (`univer-pro` dev `examples/src/sheets-mobile/`):

- Four files only: `main.ts`, `plugin.ts`, `worker.ts`, `consts.ts`. The `lazy.ts`
  deferred-loading mechanism was removed (`f2f0f77a6`); all plugins register
  synchronously in four grouped helpers.
- Registration order: `UniverDrawingPlugin` and `UniverLicensePlugin` first, then
  render engine → `UniverProFormulaEnginePlugin { notExecuteFormula: true }` →
  `UniverMobileUIPlugin { container: 'app' }` → `UniverDocsPlugin` + desktop-named
  `UniverDocsUIPlugin` → `UniverRPCMainThreadPlugin` (`worker.js` with license query),
  then data→UI pairs. Mobile UI variants now cover almost the whole sheets stack:
  numfmt, formula, conditional formatting, data validation, filter, find-replace,
  drawing (drawing-ui and sheets-drawing-ui), sort, thread-comment, table, hyperlink,
  crosshair-highlight, pivot, outline, chart, sparkline, shape, print, exchange-client,
  sheets-exchange-client and sheets-history. `UniverSheetsNoteUIPlugin` stays
  desktop-named; `sheets-note-ui` has no Mobile variant.
- The main thread sets `notExecuteFormula: true` on ProFormulaEngine, Sheets and
  PivotTable. `worker.ts` runs `UniverProFormulaEnginePlugin` +
  `UniverRemoteSheetsFormulaPlugin` + filter + pivot (formulas enabled) behind
  `UniverRPCWorkerThreadPlugin`.
- History on dev is `UniverSheetsHistoryMobileUIPlugin` (`@univerjs-pro/sheets-history-ui`),
  configured with `historyServerUrl`, `univerContainerId` and the same worker URL.
  The `UniverEditHistoryLoaderMobilePlugin` named in the previous review came from the
  stale `main` branch and does not exist on dev.
- Collaboration and authorization keep their shape: `UniverCollaborationClientPlugin`
  with universer-api endpoints, `enableAuthServer`, offline editing and single-instance
  lock. The example still requires a universer backend; those overrides are not
  appropriate to copy into a standalone local workbook.
- The open-source `univer` repo deleted `examples/src/sheets-mobile` in #7600. Its last
  version (`ee1adb0f94~1`) used Mobile variants only for ui, sheets-ui, filter,
  conditional formatting and data validation, with numfmt-ui and formula-ui
  desktop-named. Dev has since added Mobile variants for those as well, plus
  `UniverDocsMobileUIPlugin` in docs-ui — though the Pro sheets example still uses the
  desktop docs UI plugin.

rc.0 coverage by unit type (verified 2026-09-20 against the installed packages):

- **Sheet: rc.0 is sufficient.** Every Mobile export in the dev `sheets-mobile`
  composition exists in the installed rc.0 packages: `UniverMobileUIPlugin`,
  `UniverSheetsMobileUIPlugin`, the numfmt / formula / conditional-formatting /
  data-validation / filter / find-replace / crosshair-highlight / drawing /
  sheets-drawing / sort / thread-comment / table / hyperlink Mobile UI plugins, and
  the Pro pivot / outline / sheets-chart / chart / sparkline / sheets-shape /
  shape-editor / print / exchange-client / sheets-exchange-client / sheets-history
  Mobile UI plugins. `MOBILE_UI_MODE` is exported from `@univerjs/ui`. The three gaps
  match the dev example and are not blockers: `sheets-note-ui` has no Mobile variant
  anywhere (the example uses the desktop plugin), `collaboration-client-ui` has none
  either (the example uses the desktop plugin), and the desktop `UniverDocsUIPlugin`
  serves the cell editor.
- **Doc, Slide, Board and Base: wait for the next SDK release.** Dev has official
  examples for all of them (`univer-pro` dev `examples/src/docs-mobile`,
  `slides-mobile`, `bases-mobile`, `boards-mobile` and `*-advance` variants), but they
  build on Mobile exports added to dev after rc.0: `UniverDocsMobileUIPlugin`
  (`@univerjs/docs-ui`), the docs-drawing / docs-hyper-link / docs-thread-comment
  Mobile UI plugins, the Pro `docs-*-ui` Mobile UI plugins, and the Pro slides/bases/
  boards Mobile UI plugins. None of these exist in the installed rc.0 packages.
  Sheets work on rc.0 does not depend on them.
- **Presets offer no platform switch on any version.** Latest dev preset sources
  (`univer` repo `presets/packages/`) still contain no mobile/platform option, so
  transforming preset plugin lists (or dropping to plugin mode) remains necessary no
  matter which SDK release Workspace adopts. Waiting for a new release does not remove
  that integration work.

Mechanism facts from dev source:

- There is no platform auto-detection. The host picks the plugin set statically.
  `UniverSheetsMobileUIPlugin` shares `pluginName = SHEET_UI_PLUGIN` with the desktop
  plugin, so exactly one can be registered per Univer instance. `MOBILE_UI_MODE` is set
  by `UniverMobileUIPlugin` and exported from `@univerjs/ui`; mobile UI defaults
  `disableAutoFocus: true`.
- Touch gestures are built into the mobile plugins: inertial scrolling, pinch zoom
  (0.2–2.0), long-press context menu and selection expand handles. The host must not
  intercept touch/wheel above the canvas or override the mobile context keys.
- The interceptor disposer defect behind the fixture's Pro teardown failure is still
  unfixed on dev (`packages/core/src/common/interceptor.ts:130`): `dispose()` clears
  the interceptor map, and calling an `intercept()` disposer afterwards throws
  `TypeError: Cannot read properties of undefined (reading 'indexOf')`. The host must
  run every interceptor disposer before `univer.dispose()`. This constrains disposal
  ordering; it is not evidence that the official mobile stack is unsuitable.
- The official examples show no dispose/unmount handling at all (single-page lifetime).
  Workspace must own teardown ordering itself.

Next verification should reproduce the pinned dev composition above, retaining its
plugin order, public dependencies, Worker and lifecycle ownership. Any local
substitutions must be listed and tested separately before adding Workspace
collaboration and permissions. Workspace sequencing follows the coverage table:
adapt the Sheet editor on rc.0 now, and extend to Doc and Slide after the next SDK
release publishes the docs/slides Mobile plugins, using the dev examples named above
as the reference compositions.
