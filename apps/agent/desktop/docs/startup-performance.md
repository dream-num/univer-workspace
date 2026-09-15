# Desktop startup performance investigation

The current Windows targets are first installation within 40 seconds and an
interactive first window within 15 seconds. An isolated production-package test
on the user's machine measured 38.656 seconds and 6.984 seconds respectively.
The user accepted the measured 45.162-second upgrade installer; reopening and
cleanup bring the complete replacement to 55.968 seconds. CI retains its stricter
40-second replacement gate. macOS targets remain 60 seconds for installation or
replacement and 15 seconds for first interaction. All three platforms use a
20-second CI startup ceiling, allowing 5 seconds of shared-runner variance above
the 15-second product target. Actual first and post-update startup times remain
in the reports; profiling runs have no startup gate. The dated results below
record the investigation; older runs used 30-second / 5-second gates.

For alpha.9, official Windows CI measured a 10.078-second first interaction,
17.339-second installation, and 32.426-second complete replacement. Its only
functional-acceptance step failure was the then-configured 10-second startup gate.
The user accepted a 15-second target and requested CI headroom on 2026-09-15.
The [release run](https://github.com/dream-num/univer-workspace/actions/runs/34946782320/attempts/2)
retains that failure and its measurements. Linux passed at 5.716 seconds; signed
and notarized macOS passed at 8.469 seconds, with 9.231-second installation and
15.540-second complete replacement. These are CI observations, not user-machine
guarantees.

## ASAR service prototype (2026-09-14)

The [isolated prototype](../scripts/asar-probe/README.md) runs published DSH and
Workspace plugin code directly from ASAR in an Electron 44 utility process. It
preserves both dependency graphs, keeps native files unpacked, and uses public
DSH application boot APIs rather than the CLI's writable fallback junctions.
An application-scoped `module.registerHooks` adapter resolves missing imports at
configuration/Loader boundaries; published DSH code is unchanged. Node IPC is
bridged to the utility parent port, and descendant Electron forks use Node mode.

On the same Windows machine, a fresh-profile interaction probe passed in 9.183
seconds, including service readiness at 2.026 seconds and page readiness at 6.757
seconds relative to service launch. Renderer errors were empty. Service disposal
completed normally (exit 0) in 35 milliseconds. A second fresh-profile run measured
9.048 seconds interactive, 1.964 seconds service readiness, and a normal shutdown
in 36 milliseconds. Native Office CSV import/export,
the SDK worker fork/handshake and ConPTY all passed from the archived code layout.
OS caches were warm, and the random loopback origin differs from the HTTP cache
seed's fixed origin, so this is not a cold installed-startup guarantee.

The prototype host is one 257,503,489-byte ASAR plus 23 native files totaling
75,888,888 bytes. A ZIP of these 24 files is 78,836,599 bytes. The exact `nsisunz`
plugin from the alpha.4 installer extracted that ZIP in **6.037 seconds**:
2.953 seconds user CPU and 2.844 seconds kernel CPU. All 24 output files matched
by SHA-256. This measures only the new DSH/Workspace host payload, excluding the
Electron shell, browser binaries, browser-cache seed, other runtime assets,
registry work and complete upgrade lifecycle. It is not a 6-second installation.

At the prototype stage, the shipping launcher was unchanged; account setup and
the complete installer had not yet been integrated. The production integration
and native results are recorded below. See the
[raw measurement](measurements/windows-asar-prototype-20260914.json).

## Latest CI and local recovery

[Run 34805155923](https://github.com/dream-num/univer-workspace/actions/runs/34805155923),
source `ec2c521`, measured Windows installation at 28.668 seconds, first interactive
opening at 6.720 seconds, and complete same-package replacement at 44.534 seconds.
The replacement installer took 27.695 seconds; reopening took 4.721 seconds. Runtime
verification took 8.098 seconds and backup deletion completed in 2.807 seconds.
The job still failed the old timing gates and a separate native recovery fixture.
These results do not validate upgrading an installed alpha.3 uninstaller.

On the user's Windows machine, the new installer's process check passed, but the
old alpha.3 uninstaller did not complete successfully. Builder's retry loop labels
repeated old-uninstaller failures as an application that cannot be closed. That
message alone does not establish that the Agent is still running. Local recovery
retained the old application directory and registry export, bypassed that old
uninstaller, and installed alpha.4 without clearing account/document storage.

Recovery installation took 100.539 seconds, including 93.094 seconds extracting
the payload. Installed runtime integrity verification passed. The application
window responded and page readiness was observed after 12.377 seconds; this is
not the CI interaction probe. Main-process phases were preparation 0.627 seconds,
backend startup 8.878 seconds, and page loading 1.225 seconds.

## Local Windows extraction comparison (2026-09-14)

The native Windows benchmark uses the installed alpha.4 cached installer from
run 34805155923. It extracts the embedded ZIP and the exact `nsisunz.dll` shipped
in that installer. A minimal NSIS executable invokes that plugin against an
external archive into a fresh temporary directory; it does not invoke the actual
installer, alter registrations, or change application/account directories.

The machine has an AMD Ryzen 9 7945HX (16 cores / 32 logical processors) and about
153 GiB free on C:. Defender real-time protection remained enabled. These tests
neither disable protection nor establish which filesystem filter contributes to
the measured kernel time. All timed executables and destination directories are
on native Windows C: paths; WSL only orchestrates the tests.

The original ZIP contains 12,977 files, 1,412,546,807 uncompressed bytes, and is
514,368,874 bytes on disk. Its payload uses Deflate, with some entries already
stored. The outer NSIS executable stores the embedded ZIP without recompressing
it. The store-only comparison archive is 1,417,051,663 bytes and has identical file
paths, sizes and CRCs. Tests run sequentially into fresh directories, without a
reboot or forced cache flush. These are single-run comparisons with warmed caches,
not cold-install guarantees.
All 12,977 extracted files from both NSIS variants and the store-only 7-Zip
variant matched the Deflate 7-Zip reference by SHA-256. Raw timings and verification
results are in [the measurement record](measurements/windows-extraction-20260914.json).

Measured elapsed time and per-process user/kernel CPU times are recorded below.
CPU time is not a separate wall-time phase and must not be added to elapsed time.
7-Zip 23.01 runs with `-mmt=1`; the no-file test decompresses and checks CRCs without
creating extracted files. Store-archive generation is excluded from extraction
results because production would generate the archive at build time.

| Method | Elapsed | User CPU | Kernel CPU |
| --- | ---: | ---: | ---: |
| 7-Zip Deflate, no extracted files | 12.962 s | 12.250 s | 0.578 s |
| 7-Zip Deflate, extract to disk | 75.574 s | 14.344 s | 59.359 s |
| Shipped NSIS plugin, Deflate | 101.653 s | 17.281 s | 80.062 s |
| Shipped NSIS plugin, store only | 88.303 s | 9.625 s | 77.109 s |
| 7-Zip store only, extract to disk | 61.033 s | 2.750 s | 56.109 s |

The bootstrap directory alone contains 10,232 files totaling 128.8 MB; 9,464 of
those files are smaller than 16 KiB. The runtime home adds 2,213 files totaling
222.4 MB. The 317 browser files total 416.3 MB. File count and byte count therefore
identify different optimization targets.

A final sequential split of the store-only archive, using the same native 7-Zip
with one thread and fresh directories, isolates the bootstrap file set:

| File set | Files | Uncompressed bytes | Elapsed | Kernel CPU |
| --- | ---: | ---: | ---: | ---: |
| Bootstrap only | 10,232 | 128.8 MB | 47.872 s | 45.016 s |
| Everything except bootstrap | 2,745 | 1,283.7 MB | 14.586 s | 12.859 s |

The much smaller bootstrap consumes most of the extraction time despite having
about one tenth of the bytes. This supports prioritizing bootstrap file count,
not merely reducing the largest browser binaries or disabling compression.

Cancelling compression saves only about 13% in the same-plugin comparison while
multiplying archive size by about 2.75. It does not approach the 40-second install
target. The large measured kernel-time component and the no-file comparison point
to filesystem work as the main remaining cost, rather than Deflate alone. This
is not proof of slow physical storage or antivirus responsibility. Next work
should reduce the runtime's file count at build time, especially bootstrap,
while retaining published DSH behavior, dynamic imports, native modules, licenses,
and Skills; changing the decoder alone is also insufficient for the target.

## Windows phase measurements after cache and directory fixes

[Run 34803017413, attempt 2](https://github.com/dream-num/univer-workspace/actions/runs/34803017413/attempts/2),
source `db3b3a3`, completed with failure after producing installed-application data.
The first attempt stopped during DSH plugin installation with native exit code
`0xC0000005`; that crash did not recur in the second attempt.

| Measurement | Duration | Result |
| --- | ---: | --- |
| First installation | 26.182 s | Passed 30 s |
| First interactive opening | 7.172 s | Failed 5 s |
| Running-app replacement, installer process only | 27.975 s | Installer exited successfully |
| Interactive opening after replacement | 4.924 s | Passed 5 s |
| Complete replacement including cleanup | Incomplete | Cleanup exceeded 120 s |

| Installer phase | First install | Replacement |
| --- | ---: | ---: |
| Process start to installer initialization | 2.891 s | 1.797 s |
| Parent app check/shutdown | 0.546 s | 4.812 s |
| Old uninstaller | 0 s | 0.875 s |
| Whole-directory rename (within old uninstaller) | — | 0.032 s |
| Extract embedded payload | 21.422 s | 20.125 s |
| Cache installer executable | 0.969 s | 0.265 s |
| Registry and shortcuts | 0.234 s | Below tick resolution |

The replacement verified its new runtime in 8.441 s, then entered recursive
old-directory deletion. No cleanup completion was recorded before the probe's
timeout. This is not a completed 27.975-second update. The failed probe did not
save `totalMs`; reporting now preserves the full duration and error even when
reopening/cleanup fails. Windows cleanup now uses its native directory remover,
with a sibling ownership marker retained across interruption. Native regression
tests cover locked-directory retry, junction targets and shell-special path names;
full-runtime cleanup performance still requires another native CI measurement.

The 44,987,704-byte main browser script now reports zero transferred bytes: its
packaged HTTP cache was actually reused. Page load fell to 1.272 s. First-opening
main-process phases were 0.818 s preparation, 3.359 s backend startup and 1.278 s
page load; process launch and the interaction check account for the remaining
1.717 s. Cache reuse is verified, but the first-opening target remains unmet.

## Native macOS replacement measurement

[Run 34799903668](https://github.com/dream-num/univer-workspace/actions/runs/34799903668)
passed macOS arm64 and Linux validation. Windows failed NSIS compilation before
installation and therefore produced no new Windows timing result.

| macOS arm64 measurement | Duration | Budget |
| --- | ---: | ---: |
| First DMG installation | 12.220 s | 60 s |
| First interactive opening | 4.532 s | 10 s |
| Complete DMG replacement, reopening and cleanup | 18.105 s | 60 s |

First installation spent 1.997 s mounting, 8.239 s copying the bundle, 1.773 s
verifying the runtime and 0.210 s detaching. Replacement spent 0.467 s stopping
the old app, 0.154 s mounting, 10.313 s copying, 3.390 s verifying, 0.005 s
activating, 0.074 s detaching, 3.046 s reopening and 0.653 s cleaning up. The
account-data sentinel survived. These are native DMG replacement probes, not
Squirrel automatic updates or downloaded-file quarantine/Gatekeeper measurements.

The 44,987,704-byte main browser script reported an HTTP cache hit (zero
transferred bytes), a 0.185 s resource duration and a 0.703 s page load. This
establishes cache reuse on this macOS run only. Evidence is retained in
`agent-startup-mac-arm64/startup-logs`, including `install.json`, `update.json`,
`browser-performance.json` and the first launch's `startup.previous.log`.

## Earlier Windows measurement and resumed investigation

A native Windows Electron 44.0.0 isolated HTTP-cache probe reproduced eviction
of a 44,987,703-byte script between process launches with the default cache:
the second launch transferred 44,988,003 bytes. With `--disk-cache-size=536870912`,
the second launch transferred zero bytes and did not request the script from the
server again. The probe warmed each fresh profile with two reloads and then
closed/reopened Electron. This establishes the large-entry persistence difference,
not a Desktop startup timing result. Windows now sets that same cache capacity
before creating sessions in both build-time warmup and installed execution. It is
a cache upper limit, not an up-front allocation of 512 MiB.

Run 34801432712 generated the full Windows installer after restoring builder's
normal uninstaller generation. A later native fixture compile failed on a mixed
slash include path, so that run did not perform installed-application acceptance.
The fixture now resolves native paths and runs before the full runtime build.

[Windows run 34756212817](https://github.com/dream-num/univer-workspace/actions/runs/34756212817),
source `1fd1aa6` (performance implementation `ccd5f47`), completed with **failure**.
This result was reported under the requested stop-and-report fallback. Investigation
has since resumed at the user's request; it is not release acceptance.

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

## Production ASAR integration

The shipping source now selects Electron in Node mode for `start-local.mjs`,
which preserves account initialization and loads the application-owned DSH host
in the same process. Build-time archiving preserves both dependency graphs;
native binaries, versioned shared libraries and terminal helpers remain unpacked.
The standalone Node executable remains on PATH for external tools. This differs
from the utility-process prototype above; its timing numbers must not be reused
as production installer measurements.

Local Linux relocated production smoke passed Office CSV roundtrip, worker
handshake, PTY, authenticated HTTP and browser onboarding. Windows native fixture
results and all-platform release CI are required before publication. At this stage CI enforced
40 seconds for Windows installation/replacement and 10 seconds for first usable
opening; the user accepts the approximately 45-second upgrade installer measured
on their machine. macOS then used 60/10 seconds.

Same-content prototype size comparison: 12,443 loose files / 330,137,397 bytes,
versus 24 archive/native files / 333,392,377 bytes (0.99% larger). The 78,836,599-byte
compressed host payload is only part of the complete installer.

## Production ASAR CI acceptance (2026-09-14)

[Run 34833396896](https://github.com/dream-num/univer-workspace/actions/runs/34833396896),
source `bec51d5`, passed all native targets. [Machine-readable results](measurements/asar-production-ci-20260914.json)
retain installer phases and acceptance timings.

| Target | Install | First usable | Replacement + reopen |
| --- | ---: | ---: | ---: |
| Windows x64 | 20.362 s | 8.904 s | 29.064 s |
| macOS arm64 | 20.921 s | 7.732 s | 13.989 s |

Windows replacement's installer process took 19.017 seconds, and reopening took
5.970 seconds; the total also includes verification and cleanup. macOS is an
unsigned DMG replacement test. Linux passed relocated and packaged capabilities
and the Electron window check. Official signing/notarization and user-machine
installation remain separate from these build-only results.


## Windows legacy migration and user-machine acceptance

[Run 34835627688](https://github.com/dream-num/univer-workspace/actions/runs/34835627688),
source `c398b4a`, passed Windows installation and the full installer legacy-migration
path: first installation 21.264 seconds, first usable opening 5.416 seconds,
upgrade installer 16.870 seconds, reopening 3.605 seconds, and complete replacement
23.338 seconds. The same run passed Linux but failed the macOS browser actionability
probe, so it is not all-platform release acceptance.

On the user's Windows machine, an isolated complete production installer measured
38.656 seconds for first installation and 6.984 seconds for first usable opening.
A running-app upgrade initially failed because directory handles briefly remained
after process exit. Moving the installer working directory outside the installation
and retrying the same-volume rename fixed the observed failure. The successful
retest needed 14 rename retries and measured:

| Phase | Duration |
| --- | ---: |
| Installer start to initialization | 4.313 s |
| App check and shutdown | 8.328 s |
| Legacy migration, including directory rename retries | 1.906 s |
| Extract new payload | 29.625 s |
| Complete installer process | 45.162 s |
| Usable window after replacement | 5.314 s |
| Complete replacement, reopening and cleanup | 55.968 s |

The phase rows are selected diagnostics, not an exhaustive sum. The installer
exited successfully, backup cleanup completed, and the account-data sentinel and
unrelated Node process survived. The smoke command exited nonzero only because
its 40-second upgrade budget was exceeded; the user subsequently accepted the
approximately 45-second installer duration. No functional check was waived.

Both legacy-path tests set the isolated test installation's registry version to
alpha.3; they do not establish an actual alpha.3-binary-to-new-release upgrade.
The local package used a separate application ID, updater cache, registration and
temporary directory. The user's real alpha.4 installation and account data were
left intact. These are single-run measurements without a reboot or forced cache
flush. An earlier local package lacked `electron-updater`; its installation timing
is excluded from acceptance.
