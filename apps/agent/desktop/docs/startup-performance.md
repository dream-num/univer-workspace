# Desktop startup performance investigation

The acceptance targets are installation within 30 seconds and an interactive
first window within 5 seconds. Neither target has passed Windows acceptance yet.

## Final measured status for this investigation

[Windows run 34756212817](https://github.com/dream-num/univer-workspace/actions/runs/34756212817),
source `1fd1aa6` (performance implementation `ccd5f47`), completed with **failure**.
Work stops here under the requested fallback: report inability to deliver the
targets with the validated implementation. This branch is not release acceptance.

| Native acceptance | Measured | Target | Result |
| --- | ---: | ---: | --- |
| First installation | 35.917 s | 30 s | Failed |
| First interactive opening | 9.785 s | 5 s | Failed |
| Reinstall while app is running | 60.144 s, watchdog termination | 30 s | Failed |

The installed first-opening log divides its main-process time into 0.790 s of
preparation, 3.233 s to backend readiness and 4.917 s to page load. Process launch
and the interaction check account for the remaining 0.845 s. Preparation improved
from 2.506 s and backend readiness from 4.328 s in run 34754029211, but the page
phase barely changed from 5.177 s. Installation did not improve from that run's
34.751 s. Baseline installation/opening were 175.36 s/about 82 s; the substantial
reduction does not satisfy either requested threshold.

### Remaining causes and evidence limits

- **Windows did not reuse the main browser script from the packaged HTTP cache.**
  Its 44,987,704-byte body still produced a 44,988,004-byte transfer and a 0.997 s
  resource request. The small second script reported zero transferred bytes.
  Windows' seed was only 42,447,015 bytes, including a 38,792,224-byte compiled
  script entry; it did not reproduce Linux's approximately 86 MB seed or page-load
  improvement. The sampled renderer spent 1.487 s in DSH's `materialize` factory
  invocation. Cache generation succeeding is therefore insufficient evidence of
  effective Windows cache reuse. Cache capacity/large-entry policy and script
  splitting are follow-up candidates, not validated fixes in this branch.
- **Backend filesystem initialization remains on first launch.** A separate
  cold-cache backend CPU profile lasted 4.062 s. About 1.090 s was in
  `symlinkSync` called by published DSH `ensureSymlink` →
  `healProfilesModuleFallbackLocked`; module stat calls contributed 0.363 s,
  `lstat` 0.175 s and `mkdir` 0.120 s. ESM compilation was only 0.258 s after
  lazy host loading. These samples are diagnostics, not replacement acceptance
  timings. They point to DSH profile repair/module discovery rather than maps
  or repeated browser composition as the remaining backend work.
- **Running-app replacement still fails.** Its report recorded old inventory
  disappearance at 36.984 s and executable disappearance at 37.236 s. Neither was
  present before the 60.144 s watchdog terminated installation. The only emitted
  native phase was `uninstall-files-start`; the new phase instrumentation did not
  capture all intended hooks, so it cannot fully separate old-file movement,
  deletion and new extraction. Builder's published template recursively moves
  old files before replacement, but exact per-stage costs remain unproven. This
  run did not establish recurrence or resolution of the interactive cannot-close
  dialog. No update-fix claim is justified.

The Windows runtime has 12,903 inventory entries and 982,098,664 bytes before
Electron shell files, with zero source maps. First installation observed the
inventory at 30.533 s and executable at 31.547 s, completing at 35.917 s. Further
file-layout/installer changes need their own recovery and native acceptance;
moving cleanup after the measured interval would not resolve the update failure.

Node 24.18.0 does expose portable compile caches, but its
[documented contract](https://nodejs.org/download/release/v24.18.0/docs/api/module.html#portability-of-the-compile-cache)
requires the code/cache relative layout to remain stable. The current installed
resources and writable user-data cache are separate trees. Copying a build cache
into user data is not an established fix, and the measured compilation fraction
alone cannot close the remaining first-opening gap.

### Validation and delivery boundary

Agent and capability typechecks/tests, native Desktop tests, runtime preparation,
relocated Office CSV roundtrip/worker fork/PTY/browser checks, installer building,
packaged runtime checks and independent CPU sampling passed. The earlier run
34756001118 stopped before packaging on seven Windows test-fixture failures;
`1fd1aa6` corrected URL paths, canonical short/long paths, path separators and CRLF
handling without relaxing behavior assertions. Linux's five affected test files
also passed all 31 tests.

Raw native evidence is retained in the run's `agent-startup-win-x64` artifact:
`startup-logs/install.json`, `update.json`, `update.json.phases`, `startup.log`,
`browser-performance.json` and `profiles/*.cpuprofile`. The size artifact is
`agent-size-win-x64`. Failed build installers are diagnostic artifacts only.
No release, deployment or merge was performed; changes remain on
`fix/agent-desktop-performance-ci`.

## Windows acceptance after static browser delivery

[Run 34754029211](https://github.com/dream-num/univer-workspace/actions/runs/34754029211),
source `ffe8401`, enforced both targets and failed:

| Measurement | Duration |
| --- | ---: |
| Fresh installation | 34.751 s |
| First interactive opening | 12.904 s |
| Main-process setup before backend | 2.506 s |
| Backend launch to readiness | 4.328 s |
| Backend ready to page load | 5.177 s |
| Reinstall while app was running | Exceeded 60 s watchdog |

The main script was about 45 MB and its request took 1.07 s. The installed
executable was absent after the reinstall watchdog fired. This establishes an
update failure but does not by itself distinguish old-file removal from payload
extraction or prove that the cannot-close dialog recurred.

## Browser cache and lazy host follow-up

Local CPU sampling attributed about 1.80 s of backend startup to ESM compilation
and 2.95 s of renderer self time to DSH's `materialize` factory invocation. The
capability host had eagerly bundled document engines and the API reference into
approximately 30.9 MB. Dynamic imports and Node code splitting reduce its eager
code to about 1.16 MB; document-specific modules still ship and load on demand.

Copying only Chromium's compiled-code cache did not improve the local page load.
Seeding both its HTTP and compiled-code caches reduced page load from 8.07 s to
1.87 s in an isolated experiment. Native packaging now warms only those caches,
excluding account storage and non-static HTTP responses. The measured seed is
85,748,422 bytes; CPU compatibility can affect Chromium's cache reuse.

A clean Linux runtime build with both changes contained 12,847 inventory entries,
no maps, and about 1.024 GB of runtime files. The packaged first opening took
**7.566 s**, still failing the 5-second budget: main setup 0.604 s, backend 3.774 s,
page 1.878 s, with the rest in process launch/automation and interaction checks.
The package passed a real CSV import/export roundtrip and a fork/bootstrap probe
without a remote account. This result does not establish Windows acceptance.

## Measurements

[Windows baseline run 34673003978](https://github.com/dream-num/univer-workspace/actions/runs/34673003978)
installed in 175.36 seconds. Its startup diagnostic artifact reports:

| Phase | Duration |
| --- | ---: |
| Copy runtime into userData | 46.85 s |
| Verify copied runtime | 10.79 s |
| Activate writable runtime | 0.02 s |
| Start backend | 19.88 s |
| Load local page | 3.98 s |
| Total from main-process startup | 81.80 s |

The artifact contains 25,479 files and 965,431,441 uncompressed bytes.

With the current changes, a fresh Linux packaged Electron check took 42.746 s
from process launch to an interactive local page. Its main-process log reports
0.395 s before backend launch, 33.857 s for backend readiness, and 7.660 s for
page load. This is a different platform and freshly resolved DSH dependency
graph, not a before/after Windows benchmark. The installed resource inventory
remained intact after the relocated service/browser checks.

A separate CPU profile of fresh DSH startup without Node's compile cache took
33.668 s (33.794 s wall time to readiness). The resolved published
`@deepseek-ai/dsh-client-modules` is `0.1.5-rc.2`. Largest self-time samples:

| Function | Self time |
| --- | ---: |
| `buildCombo` | 7.919 s |
| `newlineCount` | 6.728 s |
| Buffer UTF-8 writes | 3.418 s |
| `identitySectionMap` | 2.626 s |
| Garbage collection | 1.766 s |
| ESM compilation | 1.607 s |

This identifies browser artifact composition as a remaining bottleneck. It does
not establish how fast startup will be after an upstream change. The Workspace
capability client is already minified and still about 34 MB in UTF-8.

## Dynamic registry ownership and upstream improvement options

The published DSH `ClientModuleRegistry` subscribes to `internal/plugin`, batches
notifications in a microtask, and calls `compose()` after changed records. Plugin
activation spans multiple microtasks. Every composition builds all initial-load
batches and also all individual-record responses. `buildCombo()` eagerly builds
indexed source maps; a missing map causes `identitySectionMap()` to embed the
complete generated source. It also scans the same JavaScript again to count
newlines. Maps are computed even when no browser requests one.

A fix belongs in DSH, using its public package release process:

1. Keep declaration validation and dependency-graph updates incremental, but defer
   expensive response construction until the first graph/resource request after
   activation. Do not delay malformed-package errors or expose incomplete graphs.
2. Cache each bundle's prepared bytes and line count by artifact identity. Cache
   combinations by ordered bundle identities and composition format version.
   A changed row invalidates its affected combinations, not every response.
3. Build source maps only when a `.map` resource is requested. Missing input maps
   should not eagerly embed entire sources during ordinary production startup.
   Preserve immutable revision URLs, HEAD semantics and the prior HMR generation.
4. For a fixed desktop profile, expose a build/export and validated preload API
   so CI can ship the composed scripts and manifest. Use stable content identities
   instead of the current random initial revision nonce. A cache key must include
   DSH composition format, package contents, order and active client declarations;
   runtime profile changes must invalidate it.

Steps 1–3 eliminate repeated work per launch without a new disk cache. Step 4
moves the remaining fixed-profile work to packaging and benefits first launch,
where a user-local cache cannot help. Bootstrap graph validation, authentication,
backend service startup and browser execution still run locally.

There is no dedicated precomposed-artifact import/export or source-map disabling
option in the inspected package. A follow-up audit found that the existing public
`graph()`, `fetchBundle()` and `bootInjections()` APIs are sufficient for an
application-owned fixed-profile delivery path. Desktop now captures the official
output at build time and provides the transformed static scripts without the
runtime registry, source maps, HMR or configuration watching. This does not require
patching DSH or recreating its browser bootstrap protocol. See the
[upstream investigation](dsh-production-upstream.md) and [Desktop guide](../README.md).
The earlier 42.746-second Linux result above predates static browser delivery.

## Fixed-profile production artifact verification

After switching Desktop to build-time capture and runtime static serving, the
packaged Linux Electron smoke test passed with fresh user data:

| Measurement | Duration |
| --- | ---: |
| Process launch to interactive local page | 14.171 s |
| Main-process start to backend launch | 0.381 s |
| Backend launch to ready | 5.597 s |
| Backend ready to loaded page | 7.474 s |

The earlier 42.746-second measurement and this result are from the same Linux
host, not native Windows acceptance. The five-second total target is still unmet.
The remaining time is in backend initialization and browser loading/execution;
this measurement alone does not attribute those phases to individual functions.

The built artifact contains 50 client entries in two static script files. The
smoke tests require the advertised URLs to use the static Desktop carrier,
validate the actual served scripts have no source-map trailer, require `.map`
requests to return 404, and reject a graph containing the client HMR plugin.
Inventory inspection found no shipped `.map` or `.credentials.yaml` files.
The Agent typecheck, 41 Agent tests and 27 Desktop tests also passed. Windows
installation, running-app replacement, and startup budgets still require native CI.

## Clean-build follow-up verification

On 2026-09-12, the normal `prepare:runtime` command completed from an empty
`.build` directory, rebuilding and installing the normal package filenames. The
relocated runtime smoke and Linux AppImage packaging passed. The newly packaged
Electron first launch, using a fresh user-data directory, took **14.622 s**:

| Phase | Duration |
| --- | ---: |
| Main-process start to backend launch | 0.393 s |
| Backend launch to ready | 5.942 s |
| Backend ready to loaded page | 7.588 s |

The smoke ran with `UWA_SMOKE_STARTUP_BUDGET_MS=5000` and exited nonzero for the
timing violation, after passing its original UI/static script/no-map/no-HMR
checks. This reproduces the earlier approximately 14-second result without
iterative package replacement. The generated inventory has 14,027 entries, no
`.map` or `.credentials.yaml` files, and 50 browser entries in two static scripts.

Windows PowerShell 5.1 on the WSL host also executed
`test/installer-processes.ps1` successfully against isolated native executables.
It verified absent/running detection, termination of the selected application
and a differently named `node.exe` child, preservation of a same-name app at a
different path, an unrelated `node.exe`, and an uninstaller below the installation
directory, and idempotent repeated shutdown. These are fixture processes without
an Electron GUI; this does not validate the complete NSIS installation or the
two-release updater flow.

CI now records both installation durations before enforcing the 30-second
budgets, allowing startup and running-app replacement diagnostics to be collected
when installation succeeds slowly. The 60-second installation watchdog and
functional failures still stop dependent checks. Browser navigation and resource
timings are uploaded alongside startup logs. Neither performance target is yet
accepted for Windows.

Screenshot review then exposed a weakness in the original UI assertion: enabled
controls could sit behind first-run onboarding. The check now advances the SDK
notice and selects **Configure later** without entering a model key, then uses
Playwright's trial click to require the Settings button to receive pointer events.
Fresh data has no selected workspace, so an editable chat composer is not a valid
first-launch prerequisite. The updated checker also saves a screenshot on failure.

With this stricter interaction check, a fresh packaged Linux launch took
**15.435 s** and failed only the 5-second budget. Main-process setup took 0.378 s,
backend startup 5.796 s, and page load 7.816 s. The main static script was
45,034,053 bytes and its resource request lasted 1.420 s; the navigation load event
completed at 7.809 s. Resource timing alone does not attribute the remaining page
time to parsing, execution, rendering or other initialization. The earlier
14.171 s and 14.622 s figures used the weaker UI assertion and should not be
presented as the current interaction acceptance result.
The packaged relocated-runtime smoke also passed with the stricter onboarding
and interaction check, including native Office/worker/PTY checks, static script
delivery, missing map endpoints, and an unchanged resource inventory.
