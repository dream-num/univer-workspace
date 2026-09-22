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

## Referenced Sheet replay fixture

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.referenced-sheet.config.ts`,
then open `http://127.0.0.1:5184/test/fixtures/referenced-sheet.html?type=doc`
or change `type` to `slide`.

The fixture captures each production editor's preset definition and assembles it
with the published collaboration and Embed plugins. It creates a fresh Sheet,
serializes it through the SDK, and supplies changesets that rename its worksheet
to `Finance` and change A1 from 100 to 12500. The host reads A1 through the Embed
formula reference data provider. `window.referenceResult` resolves with the
replayed name, amount, and Sheet cursor dependency result.

The snapshot service is in memory; this fixture does not exercise Workspace
authentication or a live collaboration server. The collaboration client can log
404 responses for its session-ticket and authorization endpoints. Missing commands,
injector errors, or an amount other than 12500 are failures. Production builds do
not include this test entry. The matching unit tests exercise snapshot replay
through the Workspace source provider with both editor preset definitions.

## Mobile Sheets investigation record

The standalone mobile verification fixture (`mobile.html` / `mobile.ts` /
`vite.mobile.config.ts`) was removed after the production mobile composition
landed. This section preserves the source review that guided it, as the
reference for future SDK upgrades and the Doc/Slide mobile work.

### Official-source review (updated 2026-09-20, local dev checkouts)

Earlier reviews mixed stale references: univer-pro `main` stops at v0.24.0 (2026-05-23)
and is not the current source. The authoritative branch is `dev`. This update reads local
checkouts pulled on 2026-09-20: `univer` dev @ `279c049cde`, `univer-pro` dev @ `d3f40ded20`
(submodule `submodules/univer` @ `279c049cde`). Published SDK 1.0.0-rc.0 (npm `rc` tag,
2026-09-10) remains the newest release; npm `latest` still points to the 0.25.x stable
line. The installed 1.0.0-rc.0 packages were verified per-package to contain every
Mobile export used by the dev sheets example, so the Workspace SDK baseline needs no
upgrade for Sheets work.

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
- The interceptor disposer defect found during the investigation is still
  unfixed on dev (`packages/core/src/common/interceptor.ts:130`): `dispose()` clears
  the interceptor map, and calling an `intercept()` disposer afterwards throws
  `TypeError: Cannot read properties of undefined (reading 'indexOf')`. The host must
  run every interceptor disposer before `univer.dispose()`. This constrains disposal
  ordering; it is not evidence that the official mobile stack is unsuitable.
- The official examples show no dispose/unmount handling at all (single-page lifetime).
  Workspace must own teardown ordering itself.

Workspace sequencing follows the coverage table: the Sheet editor mobile variant
landed on rc.0 (see below); extend to Doc and Slide after the next SDK release
publishes the docs/slides Mobile plugins, using the dev examples named above as the
reference compositions. Real-device gestures, software keyboard/IME, clipboard,
collaboration/reconnect, authorization, server comments, history and Office
conversion still need real-device validation before claiming Workspace mobile support.

### Production mobile composition (added 2026-09-20)

The production mobile Sheet editor has landed at
`web/src/features/editor/units/sheet/sheet-editor.mobile.tsx` +
`sheet-mobile-presets.ts`, selected in `resource-editor.tsx` via
`shared/platform.ts` (`pointer: coarse` or max-width 720px, evaluated once per
page load). It uses the factory-managed collaboration path
(`collaborationProvidedByPreset: false`), keeps formulas on the main thread
(the deliberate no-worker deviation from the official sheets-mobile example,
matching the Workspace desktop stack), and registers the Mobile exchange
variants through `exchangeFeaturePlugins` so the factory's trunk/sign-in
gating still applies.
