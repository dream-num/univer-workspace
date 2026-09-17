# Desktop plugin installation and preview recovery

Investigation against Desktop 0.1.0-alpha.10, DSH 0.1.5-rc.1 and Electron
44.0.0, including a Windows 10.0.26200 installation.

## Confirmed findings

- **Preset roots:** the published DSH roster defaults `includeUserRoot` to true.
  Its effective roots, not `settings.yaml`, determine discovery. Desktop previously
  changed `DSH_HOME` to an account runtime on launch, so creating `~/.dsh/.agent-presets`
  did not affect that roster. Desktop now uses its stable writable runtime home;
  the About panel displays the actual host path and the plugin profile path.
- **Copy:** DSH uses `dirname(AgentPreset.path)` with `fs.promises.cp`. Electron 44
  fails recursive copying from ASAR with ENOENT, even for a two-byte fixture.
  Packaging now publishes preset templates as ordinary files and supplies their
  system root through the roster's public configuration.
- **Installation:** DSH plugin management records absolute local tarball specifiers.
  Packaging normalizes both manifest and lockfile, retains relative internal tarballs,
  and pins the packaged DSH dependency graph for later installation. An installed
  profile runs the public standalone DSH CLI and composes its own browser modules.
  It does not combine new plugins with the precompiled browser roster.
- **ASAR metadata:** Electron returns numeric Stats for ASAR even when asked for
  BigIntStats. DSH's `mode & 511n` then fails. This is unrelated to archive size.
  The Electron 44 host adapter normalizes only malformed ASAR stat/lstat results;
  ordinary files retain native metadata. The published DSH packages are unchanged.
- **Blank preview:** DSH's `SlotErrorBoundary` retires a crashed slot entry and renders
  an empty `data-slot-error` element. This explains why closing/reopening a preview
  need not recover after a React lifecycle error. An Electron Desktop session
  connected to the reported Workspace reproduced the failure with an existing
  merged Sheet Worktree. The comparison pane's peer-scroll React effect executes
  `SetScrollOperation` while Univer is at `LifecycleStages.Ready` (1). The desktop
  Sheets UI only registers `SheetScrollManagerService` at `Rendered` (2), so the
  operation throws a Redi missing-service error. The debugger confirmed the render
  instance was not disposed and did not yet have that service. Retrying reproduced
  the same exception. The comparison pane now awaits the public lifecycle's
  `onStage(Rendered)` before exposing its runtime to peer effects, applies the latest
  queued scroll after readiness, and ignores initialization completed after unmount.
  Workspace also contains preview
  failures within a retryable boundary and finishes remaining runtime cleanup when
  one SDK cleanup throws. Pending live-viewer loads are disposed on cancellation.

## Validation

- A relocated packaged profile installed an additional local plugin through pnpm.
  The official preset copy, composition inventory and execution in a newly created
  session succeeded both before and after restarting the standalone DSH host.
- A browser probe exercised thrown render and cleanup errors, retry, and subsequent
  navigation; the document surface recovered in each case.
- After fixing the render lifecycle race, a freshly generated Desktop runtime
  connected to the same test account displayed both panes of the previously failing
  merged Sheet Worktree. Thirty switches across three existing Worktrees (including
  Sheets and Slides), twelve result/diff switches, fullscreen/scroll interaction,
  and five close/reopen cycles finished without preview errors or uncaught exceptions.
  Switch checks waited for a canvas with nonzero dimensions; Sheets also creates
  hidden zero-size document-editor canvases, which are not evidence of readiness.
  The comparison package's 99 tests and both Agent-plugin and comparison-package
  typechecks passed. New lifecycle tests cover delayed render readiness and unmount
  before readiness. The existing DSH Office copy received the same fix and passed
  its two added tests, package typecheck and application typechecks.
- Following the report that rapid Worktree switching triggers the blank preview,
  a separate Chromium probe repeatedly mounted the actual `ComparisonSnapshot`
  and Univer composition with local Sheet and Doc fixtures (30 switches per type,
  10–100 ms between switches). Both the unmodified HEAD implementation and the
  recovery changes finished with canvases present, no error alert and no uncaught
  browser errors. This did **not** reproduce the reported failure: it exercises
  the default Worktree snapshot renderer, not the complete DSH sidebar, remote
  Worktree payloads or the user's Windows account scenario.
- A separate process using the installed Windows Electron reproduced DSH filesystem
  directory-listing failure on `resources/runtime`. Loading the host adapter restored
  directory listing and reading ASAR text files. No installed application files or
  account data were changed by that probe.
- Agent/core and plugin typechecks/builds and their focused test suites cover the
  changed application code. Native artifact smoke also checks ASAR BigIntStats and
  copying the shipped preset template.

## Remaining limits

The reported Windows session cwd exceeding MAX_PATH is not fixed by these changes.
The existing path layout nests account-runtime, origin, user and Space hashes.
Changing it also requires accounting for persisted session cwd values and existing
local files; truncating the current identifiers alone would abandon those paths.

A cold offline `pnpm install` is not guaranteed: third-party and DSH dependencies
must already be in the local store. Additional plugin installation needs registry
access otherwise. Customized profiles do not have the default precompiled startup
timing guarantee. Application upgrades retain replaced profile directories for recovery.

The account-level reproduction used Linux Electron 44 Desktop, with the real remote
Worktrees and production browser bundles. The captured failure was the comparison
pane initialization race; the original Windows session's console was not recorded.
