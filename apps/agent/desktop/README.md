# Workspace Agent desktop

Experimental desktop delivery of the existing Workspace Agent application. This
is an application-owned Electron shell around the published DSH CLI and the three
Workspace bundles, not a fork of DSH or a public SDK. Electron packaging tools belong to the root pnpm workspace and share its single
`pnpm-lock.yaml`. The generated DSH runtime remains isolated from that workspace
and its React dependency graph.

The production ASAR build passed [all three native CI targets](https://github.com/dream-num/univer-workspace/actions/runs/34833396896).
Windows installed in 20.362 seconds, opened to an interactive page in 8.904 seconds,
and completed replacement plus reopening in 29.064 seconds. macOS DMG installation
was 20.921 seconds, first opening 7.732 seconds, and replacement plus reopening
13.989 seconds. These satisfied the then-current Windows 40/10-second and macOS
60/10-second budgets. The current first-interaction target is 15 seconds on all
platforms; CI enforces 20 seconds to allow 5 seconds of shared-runner variance,
while retaining actual first and post-update startup measurements. Installation
and replacement limits remain 40 seconds on Windows and 60 seconds on macOS.
The macOS build-only test is unsigned; official publication
separately requires signing and notarization. CI does not replace measurements on
the user's machine or a two-release updater acceptance test.

A later isolated production-package test on the user's Windows machine installed
in 38.656 seconds and first became usable in 6.984 seconds. Its upgrade installer
completed in 45.162 seconds, with reopening and cleanup complete in 55.968 seconds;
the user accepted this upgrade duration. The existing installation and account data
were untouched. See [the detailed acceptance limits](docs/startup-performance.md#windows-legacy-migration-and-user-machine-acceptance).

The user's earlier alpha.4 recovery took 100.539 seconds to install, including
93.094 seconds extracting files. [Extraction and prototype measurements](docs/startup-performance.md#local-windows-extraction-comparison-2026-09-14)
explain why ASAR was introduced. The [utility-process prototype](scripts/asar-probe/README.md)
is retained as a diagnostic; the production launcher uses Electron Node mode.

The Electron shell uses `app.asar`; the service uses `runtime/host.asar` in
`extraResources`. Both run through Electron, which provides ASAR filesystem support. The version-scoped osx-sign patch follows DSH's
`lstat` fix for Framework aliases and additionally scans files sequentially to
avoid exhausting file descriptors. Remove it when an upstream release provides
both fixes. Raising the descriptor limit alone did not fix the native build.

The fixed Desktop composition starts from `host.asar/desktop.cordis.yml`, beside
the installed packages. DSH preset discovery walks the composition's filesystem
base, so starting it from a writable account directory can incorrectly report
installed preset plugins as missing. Account data, settings, credentials and
user-authored presets retain their writable locations. Equal-version DSH peers in
the profile resolve to the installation's module instance: `dsh-scope` uses a
module-local Symbol and parent registry, so two copies cannot exchange a scoped
agent context. Different package versions and third-party dependency graphs stay
separate. This adapter belongs to Desktop; it does not patch published DSH code.

## Release size policy

Measured standalone Node and browser sizes, including Windows compressed payload
savings estimates, are recorded in [runtime deduplication sizes](docs/runtime-deduplication-size.md).

Agent and both plugin builds do not generate source maps. Finalization removes
maps supplied by third-party packages before inventory/signing, and runtime smoke
checks reject any remaining maps. The Electron ASAR also excludes them. Desktop finalization also removes TypeScript
declaration files, native debug symbols, and explicitly listed third-party
test/example/source trees. Runtime TypeScript, Skills and licenses are retained.

The capability plugin bundles its JavaScript SDK dependencies. Desktop packaging
stages an installation manifest containing only external native bindings and `ws`,
reading the binding versions from the installed SDK wrapper manifests. Source
dependencies retain the repository SDK upgrade policy. Desktop builds remove
unnecessary whitespace without renaming identifiers. Standalone Node includes
the executable and upstream notices, while npm and development headers remain
in the build directory. DSH's pnpm and plugin installation archives remain in the runtime;
default launches use the precompiled plugin roster. node-pty retains only target-platform prebuilds alongside
any locally compiled fallback; packaged smoke tests exercise a real terminal.
Licenses, Skills, the resource catalog and native Office
bindings are runtime assets, not blanket cleanup targets.

CI uploads `agent-size-<target>` reports containing uncompressed component sizes,
file counts and the largest files. Reports support review without an arbitrary
size threshold blocking releases.
Installer compression is measured separately. Electron displays the app;
the separate pinned Chromium serves the headless document-rendering worker.
Sharing these browsers requires an explicit rendering lifecycle change and
document export validation, rather than deleting the worker browser. This is
tracked as a non-blocking upstream request in
[univer-cli-sdk #63](https://github.com/dream-num/univer-cli-sdk/issues/63).

## Production browser assets

Desktop packaging boots the published DSH profile once in isolated build data,
then exports its browser graph and batch responses using `graph()` and
`fetchBundle()`. It strips source-map trailers, assigns URLs from the final script
content, and stores each batch once in `runtime/desktop-client`. No map is shipped
or served. At runtime, an application-owned static carrier calls DSH's public
`bootInjections()` with that graph; it does not instantiate the host client registry
or build browser combinations/source maps. The DSH package is not patched.

The native build also opens the packaged profile in Electron and warms Chromium's
HTTP and compiled-script caches. Only these disposable caches are shipped; HTML,
authentication and API responses are marked `no-store`, and account storage is
excluded. First launch stages the seed before creating its window. Its identity
includes the browser graph and Electron version; updates replace caches while
preserving cookies and account data. Chromium may reject compiled cache entries
on a different CPU, so this is a performance optimization, not a runtime dependency.
The seed adds about 86 MB before installer compression in the measured Linux build.

The capability host loads the document runtime pool, API reference and Office
conversion modules on their first operation. Node chunks and the worker bootstrap
ship together in the plugin's `lib` directory. Initial application opening avoids
compiling unused document engines; the first corresponding operation bears that
initialization cost. Relocated artifact smoke verifies CSV conversion and the real
worker fork in addition to browser startup.

The Desktop profile sets `patchReload: startup` and disables `hmr` and
`client-hmr` before capturing the graph. The browser module-system entry stays in
the captured graph. Desktop uses a fixed packaged plugin roster: profile manifest
or profile patch edits are rejected on subsequent launches so stale prebuilt UI
cannot silently accompany a changed profile. Application settings and account
state stay in the normal writable data directories. The local Web development
profile keeps its existing live-reload behavior.

See [the upstream investigation](docs/dsh-production-upstream.md) for the exact
published APIs and why `NODE_ENV=production` alone does not turn maps off.

## Downloads and updates

The initial download entry is [GitHub Releases](https://github.com/dream-num/univer-workspace/releases).
No separate download website is required. Desktop releases use `agent-vX.Y.Z` or `agent-vX.Y.Z-{alpha,beta,rc}.N`;
CLI versions use `vX.Y.Z`. Creating or pushing either tag does **not** start CI or
publish anything.

| Platform | Installer | Update payload |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | Same `.exe` |
| macOS Apple Silicon | `.dmg` | `.zip` |
| Linux x64 (glibc) | `.AppImage` | Same `.AppImage` |

Build-only installers have updates disabled. Release stages progress through **alpha → beta → rc → stable**. An installation
accepts newer versions in its current or a later stage, never an earlier stage
(even for a newer version line). Stable installations receive only stable releases.
The channel is derived automatically from the version, with no separate selection.
The stable metadata channel is named `latest`; prereleases use `alpha`, `beta`, and
`rc` respectively. For example: `0.1.0-alpha.1`, `0.1.0-beta.1`, `0.1.0-rc.1`, `0.1.0`. Checks run after startup,
every six hours, or from **Settings → About → Check for updates**.
**Help → Check for Updates** remains available as a secondary entry. All channels exclude CLI
releases and use the selected release's immutable generic update feed,
not GitHub's repository-wide latest release. The update window shows the current/new versions and release notes. The user
chooses **Download update**; it shows percentage, bytes, speed, and retry status.
Closing the window keeps the download running; the About page reopens its progress.
After download and verification, **Restart and install** is a separate explicit
action. Finish active tasks before restarting; merely downloading or quitting the
app does not install an update.

Downloads request byte ranges from the immutable GitHub release asset URL, retain
partial files under `userData/update-downloads`, and retry interruptions up to
three times (after 1, 3 and 8 seconds) with a 30-second idle timeout per request.
**Pause**, **Resume download**, and **Retry download** reuse valid partial data,
including after restarting the app and checking the same release. Each retry
resolves GitHub's redirect again. Servers that ignore ranges trigger a full
replacement download; checksum failures discard the corrupt partial. Cache identity
includes the release URL and SHA-512, and choosing a different artifact removes
older partials. A complete saved download remains available for retry until the
next artifact replaces it.

A SHA-512-verified file is handed to electron-updater through its public generic
provider on a temporary, token-protected loopback URL. The updater independently
checks the checksum and owns platform signature validation, staging and installation.
This retains a download-cache copy in addition to the updater's staged installer;
no installed updater internals or cache manifests are patched. All desktop platforms
use full downloads for this handoff, with differential downloading disabled. Update metadata and any blockmaps
are release assets, not extra installer choices. Windows uses a ZIP/Deflate
installation payload for faster extraction and downloads the full installer for
updates; differential Windows downloads are disabled. Linux updates require running
the AppImage itself from a writable location.

## Build on the target platform

Requirements: Node 24, pnpm 11.24.0, native build tools (Windows Visual Studio C++
workload, macOS Xcode command-line tools, Linux make/g++/Python), and access to the
configured package registries. Linux needs Chromium/Electron system libraries;
use Playwright's `install-deps chromium` on a build/test host when needed.

From the repository root:

```sh
pnpm install --frozen-lockfile
node --test apps/agent/desktop/test/*.test.mjs
pnpm --dir apps/agent/desktop prepare:runtime
node apps/agent/desktop/scripts/smoke.mjs
pnpm --dir apps/agent/desktop package
node apps/agent/desktop/scripts/smoke.mjs --packaged
```

Set `AGENT_DESKTOP_VERSION=X.Y.Z` (or `X.Y.Z-{alpha,beta,rc}.N`) for both preparation and packaging (default
`0.1.0`). Preparation builds repository bundles, installs the pinned published
DSH graph separately, downloads a checksum-verified standalone Node and pinned
Chromium, and inventories the runtime. It never needs a neighboring checkout.
Installers are in `artifacts/`; intermediate files are in `.build/`.

The smoke command relocates the runtime into a temporary directory, starts it
with fresh data and a dynamically allocated loopback port, and requires an
authenticated bootstrap page, loads the Office native binding, and renders the
bootstrap UI in bundled Chromium. It does not use an existing Agent account.
The Linux packaged Electron window check is `xvfb-run -a node apps/agent/desktop/scripts/shell-smoke.mjs --packaged`.
Its optional `--no-sandbox` flag is for restricted test containers only; the
production application keeps the renderer sandbox enabled.

Windows and macOS installers must also be tested on their native hosts; a Linux
smoke result does not validate their signing, OAuth, or installer behavior.
The macOS installation probe registers its copied bundle with Launch Services:
copying into an isolated temporary directory and launching the executable directly
bypasses the discovery normally performed by Finder.

## Manual CI and publication

Run **Build and release Agent desktop (manual)** in GitHub Actions with an exact version. `dry_run`
defaults to true; all three native jobs upload Actions artifacts.
The optional `target=windows` selects only Windows for build-only performance
investigations; publication requires all targets. Windows CI runs CPU sampling
separately after acceptance, saving backend and renderer `.cpuprofile` files in
`startup-logs/profiles`. Both samples use the unpacked packaged artifact so a
failed update cannot remove the profiling executable. The backend sample relocates
that runtime to fresh data and a fresh compile cache. These diagnostic timings do
not replace the installed-application acceptance timings.

To publish,
first create an `agent-vX.Y.Z` or `agent-vX.Y.Z-{alpha,beta,rc}.N` tag contained in the default branch, select that
tag as the workflow ref, enter the matching version, and explicitly disable
`dry_run`. All three jobs must succeed before a draft Release is populated and
made public. Existing Releases are not overwritten. No Release is created by
ordinary tag operations.

Official macOS builds require signing and notarization. The workflow reuses
`GO_BUILD_CERTIFICATE_BASE64` (a base64-encoded P12 containing a valid Developer
ID Application certificate and private key), `GO_P12_PASSWORD`, `APPLE_ID`,
`APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID` as Actions
secrets. The certificate must belong to the notarizing team. Provisioning-profile
and temporary-keychain secrets from the older Electron project are not needed;
electron-builder manages its temporary keychain.

Windows installers are currently unsigned because no Windows signing certificate
is configured. Official publication still includes Windows; users may see
unknown-publisher or SmartScreen warnings. Windows updates use the HTTPS release
feed and artifact checksums, without publisher-signature verification for these
unsigned builds. When a Windows certificate becomes available, configure signing
and require it for official Windows builds; retain the updater's default signature
verification behavior. Linux does not require Apple or Windows credentials.

`NPM_TOKEN` provides any required build registry access. Registry configuration is
stripped from bundled resources. Test the native installers and macOS notarization
before the first official publication.

## Alpha release acceptance

After merging the workflow, manually publish version `0.1.0-alpha.1` from the
matching `agent-v0.1.0-alpha.1` tag. Alpha publication creates a GitHub prerelease,
with updates enabled; a build-only artifact cannot exercise automatic updates.
All native jobs must succeed, including macOS signing/notarization. Tag creation
alone does not build or publish anything.

For release acceptance, install alpha.1 on each supported platform, sign in and
retain a conversation, then manually publish alpha.2 from its matching tag.
Check that alpha.1 shows the update prompt (or use Help → Check for Updates),
that Later keeps the current app running, and that downloading shows progress without stopping the service, and that
**Restart and install** stops the local service, installs and restarts into alpha.2
with account data intact.
On Linux run the AppImage itself, not the unpacked executable. Verify that a
failed download leaves the current app running and can be retried. Repeat the
alpha-to-beta, beta-to-rc, and rc-to-stable transitions before graduating each stage. Windows remains unsigned.

The automated tests cover selection, metadata channel/version matching, consent,
interrupted HTTP transfers, persistent resume, malformed ranges, checksum failure,
retry, IPC sender validation, and shutdown/install order. On Linux, run
`xvfb-run -a node apps/agent/desktop/scripts/update-smoke.mjs` for a real Electron
network/resume and electron-updater generic-provider staging probe, plus update
window progress/pause/reopen/retry checks. Restricted Linux test hosts use the
explicit `--no-sandbox` test flag, as with the shell smoke; production keeps the
renderer sandbox enabled. Native CI smoke tests cover packaged startup;
these do not substitute for the two-release installation acceptance above.

## Runtime, login, and data

The shell starts its own Electron Node/DSH process on `127.0.0.1:3101`. An occupied port is
an error; the app never adopts an unknown process. DSH generates browser
authentication and passes the URL through a private child-process IPC channel.
The main renderer has no Node access and remains on the local origin. Login
opens the system default browser directly on Workspace authorization, so the
browser's existing login and external OAuth-provider sessions are available.
The existing loopback callback opens `univer-workspace://login#state=…&code=…`.
Desktop validates the active ten-minute request and redeems the one-use code
through authenticated local POST endpoints; PKCE and the resulting Workspace
session remain in the local backend. Old, repeated, or unsolicited callbacks
cannot change accounts. Restarting the app requires starting a new sign-in.

Windows installers and macOS bundles declare the `univer-workspace` scheme.
On Linux, packaged launches register a user-local desktop entry pointing at the
original AppImage (`APPIMAGE`), never its temporary mount. The completion page
also provides an explicit **Open Univer Workspace** link if automatic opening
is blocked by the browser. In development, use the browser Agent OAuth flow
unless you separately register the development application's protocol handler.
**Settings → Workspace → Switch account** reopens browser authorization; sign
out or choose another account in that browser to change the Workspace identity.
Register the callback documented in the [Agent guide](../README.md#connect-to-a-local-workspace)
for port 3101 before connecting. Desktop packaging does not include a Workspace
Server or model credentials.

Electron's OS-specific `userData` directory contains `data/` for credentials,
settings, and account-scoped sessions. `workspace/` is the separate local working
directory; Agent does not use its credential/runtime tree as the project folder.
Node, DSH, browser binaries and bundled packages run directly from installed
resources. Startup does not copy or hash the full runtime again. Integrity is
verified during packaging and by relocated/installed artifact smoke checks.

`runtime/home` contains writable profile metadata. DSH and both plugin dependency
graphs execute from `runtime/host.asar`; native libraries and the complete `node-pty` package stay
in `host.asar.unpacked`. The host resolves `node-pty` from its physical path
because macOS native process creation cannot traverse an ASAR directory. Desktop boots published DSH APIs in Electron Node mode,
while standalone Node remains on PATH for external commands. The shared local
launcher still initializes account directories, shared credentials and settings.
A scoped module-resolution adapter handles DSH imports from writable configuration;
published DSH packages remain unmodified. Default launches use the packaged plugin roster.
Installing the writable profile's dependencies selects its standalone DSH runtime
on subsequent launches, with browser modules composed from that installed profile.
A changed resource inventory runs the independent [runtime-home migrations](migrations/README.md).
Startup calls one entry point; numbered migration scripts own the transformations.
They stage a new profile and activate it at the same path, preserving account-owned
links to it. A journal recovers a process interruption during activation. Prior profile directories are retained
as `home.previous-<timestamp>-<uuid>`; an old full runtime from earlier installers is
also retained, but its binaries are no longer executed. No legacy cleanup runs
on the startup path. Node's compile cache is stored separately in `compile-cache`.
Quit stops the application-owned service process tree. Back up `data/`
independently; uninstall and update operations must not be used as account-data
cleanup.

## In-app diagnostics

Desktop contributes an optional **Settings → About** section through DSH's public settings slot. The web-only application
omits this panel. Developers can inspect the application/DSH/Electron/Node
versions, OS and architecture, update state and progress, startup event timings,
recent failure codes, and important directories directly in the UI. It refreshes
once per second while mounted. Timing columns show elapsed time and time since
the previous event, rather than inferring overlapping phase durations.

The panel displays the effective **DSH_HOME** and plugin profile directory and opens
them alongside the logs, application data, workspace, download cache and runtime
directories. **Open developer tools** opens the main window's Chromium tools.
**Export diagnostics** uses the native save dialog to write
a JSON report containing the same environment and selected current/previous
startup and update events. Reports include local directory paths, but exclude
credentials, model keys, conversation content, raw error messages/stacks, and
signed URLs. Only whitelisted scalar diagnostic fields are exported. Update
history is bounded and survives restart. All filesystem, save-dialog and updater
operations remain in the Desktop main process; IPC accepts only the trusted main
frame and fixed directory identifiers. No arbitrary path or URL is accepted.

## Install additional DSH plugins

1. Open **Settings → About → Plugin profile**. Quit Agent before installing packages.
2. From a terminal in that directory, run `pnpm install`, then `pnpm add <plugin-package>`.
   Use pnpm 11. The profile pins the packaged DSH dependency versions and its internal
   tarballs use relative paths. A fresh dependency installation needs registry access;
   offline installation requires a populated pnpm store.
3. Add the plugin row to `cordis.patch.yml` for a host plugin. For an agent plugin,
   restart Agent, use `agentPresets.copy('standard', 'my-preset')`, and add the row to
   the returned preset's `agent.cordis.yml`. Presets are agent compositions; the
   profile patch is the host composition. Follow the plugin's declared scope.
4. Restart Agent and select the copied preset for a new session. Inspect
   `agentPresets.compositionInventory()` and exercise the plugin in that session.

Desktop uses a stable `DSH_HOME` under `userData/runtime/home`; authored presets live
in its `.agent-presets` directory, separately from account-owned sessions. Shipped
preset templates are ordinary read-only installation files so DSH's copy operation
can read them without traversing ASAR. Existing sessions retain their preset composition;
use a new session to verify changes.

The installed profile uses standalone Node and DSH's public CLI. It builds browser
modules for the configured plugins instead of serving the fixed desktop browser graph,
so the default startup timing budget does not cover customized profiles. Keep a backup
of the profile and authored presets before application upgrades; replaced homes are
retained as `home.previous-<timestamp>-<uuid>`. Automatic merging and reinstallation
of customized profiles is not implemented; the independent migration scripts
currently carry authored presets forward and retain the old profile for recovery.

## Startup diagnostics

Desktop startup writes `logs/startup.log` under the application user-data directory
(on Windows: `%APPDATA%\Univer Workspace Agent`). The previous launch is retained
as `startup.previous.log`. Help → Open startup logs opens this location, including
during setup. Logs contain phase timings and failing paths;
they do not record credentials, session URLs or backend output. The startup window remains available while the local service starts. The
previous profile is retained if activation fails.

Windows CI installs the NSIS artifact and launches the installed Electron app with
isolated user data. Startup diagnostics are uploaded as Actions artifacts even
when this check fails. Acceptance budgets are 40 seconds from launching the
installer to successful completion. The startup target is 15 seconds from
launching Electron to an interactive authenticated local page (including browser
automation attachment); the CI ceiling is 20 seconds for shared-runner variance.
A fresh-profile check advances the SDK notice, defers model-key setup, and
requires the Settings button to receive pointer events without an overlay.
This needs no model credentials or remote model request.
A successful eventual start does not satisfy the timing checks. CI also reinstalls
the artifact while the application is running, verifies service-port release,
keeps an unrelated Node process alive, checks a user-data sentinel, and reopens
the installed app. This covers the installer shutdown path; the two-release
updater acceptance above is still required.

Installation and reinstallation write separate timing reports. CI checks their
budgets after running the launch/upgrade checks, so an installation that finishes
after 40 seconds still yields startup and shutdown evidence and still fails
acceptance. A failed installation or the 180-second diagnostic watchdog remains an immediate
failure. Browser navigation/script timings are included in the startup diagnostics.
Installer reports retain exit status, watchdog status and file-presence transitions
on failure. Separate `.phases` files timestamp the app-close check, old-file removal
entry and completed installation using Windows' monotonic tick counter.
The Windows test suite also runs the actual PowerShell shutdown helper against
isolated native processes, checking owned `node.exe` descendants, a same-name app
at another path, an unrelated `node.exe`, and an uninstaller under the install path.

The baseline Windows run [34673003978](https://github.com/dream-num/univer-workspace/actions/runs/34673003978)
took 175.36 seconds to install. Its startup log recorded 46.85 seconds copying,
10.79 seconds verifying, 19.88 seconds starting the backend, and 3.98 seconds
loading the page (81.80 seconds total after main-process startup). These are
baseline measurements, not acceptance results for the current changes. Native
Windows measurements are required before claiming either budget is met.

Baseline DSH composition costs, production static-delivery measurements, the
stricter first-run interaction result (15.435 s), and remaining timing limits are recorded
in [the startup performance investigation](docs/startup-performance.md). Those historical measurements are separate from the current ASAR CI acceptance above.

## Native replacement diagnostics

Windows build-time warmup and installed Electron execution use a 512 MiB HTTP
cache upper limit. An isolated native Electron 44 probe retained the approximately
45 MB main script across launches at this capacity; its default Windows cache
did not. Actual Desktop cache reuse is still checked in the installed browser's
resource timings, separately from successful cache-seed generation.

The diagnostic NSIS script is generated from electron-builder 26.15.3 templates.
A version check and exact-anchor checks fail when its templates change. The copied
includes timestamp old-uninstaller execution, extraction, caching the installer,
registry writes and shortcut creation. Logs append to `<installation>.uwa-install.log`
outside the moved directory; the PowerShell probe copies them into the CI report.
The default builder entry retains its separate uninstaller generation/signing pass;
the custom include only redirects template lookup to the instrumented copy.
The diagnostic watchdog is 180 seconds so a slow update can finish and expose all
stages; acceptance budgets remain separate and are not extended by this watchdog.

Windows replacement renames the old installation to its same-volume sibling
`<installation>.uwa-previous`, after closing owned processes. Ordinary uninstall
still removes the selected installation. Existing backup paths cause an explicit
stop. An extraction failure callback restores the old tree and retains any partial
new tree as `.uwa-failed`; abrupt termination retains the backup for recovery on
that path. The new app retires a marked old tree only after its page loads and its
runtime inventory passes verification. CI waits for this cleanup and reports its
total replacement duration separately from the installer process duration.
Windows cleanup invokes the native directory remover; a sibling
`<installation>.uwa-previous.owner` marker allows interrupted cleanup to resume.
Its ownership must match the installation before any deletion occurs.
A native NSIS fixture tests directory activation, a corrupt ZIP through the
generated builder decompressor, and refusal to overwrite a pre-existing backup.
ZIP failures use the rollback callback instead of builder's default direct exit.

macOS CI now mounts the actual DMG, uses `ditto` to stage its app bundle, verifies
runtime files, activates it and launches the installed Electron executable with
fresh account data. It also closes that app, repeats DMG replacement, verifies a
preserved data sentinel, reopens the app and removes the backup. Every phase is
recorded; replacement includes shutdown, reopening and cleanup. macOS thresholds
are a 15-second target to a usable window (20-second CI ceiling) and 60 seconds
for installation/replacement.
This probes a DMG replacement, not Squirrel's automatic updater. Build-only jobs
also do not validate notarization, downloaded-file quarantine or Gatekeeper delay.

## ASAR release validation

ASAR creation happens after production browser graph capture and before Electron
cache warmup. Packaging verifies native binaries remain accessible outside the
archive, including versioned Linux shared libraries. Relocated smoke uses the
actual Electron executable in Node mode, then checks native Office conversion,
SDK worker startup, PTY execution and the authenticated browser UI. It also creates
two real DSH sessions with the standard preset and verifies shared scope identity
and visible preset tools. Each session prepares the real DeepSeek request
extensions, checking the active private plugin identities. The published model
adapter then sends a request to a local mock SSE endpoint and decodes its reply,
without a Workspace account, real model credential or external model API call.
Fresh-browser smoke also checks the Workspace sign-in step and the sidebar login
action after deferring setup. Installed shell checks exercise the normal
OAuth/menu/update composition. Windows/Linux hide the menu bar by default; Alt
reveals it for Help and logs; updates are available from Settings → About. macOS retains its native application menu.

Profile-only bundles have ASAR links at the composition root, pointing to their
original package directories. This lets DSH's filesystem package-inventory
extension discover the same plugins as its Loader without duplicating payloads
or overriding installation-owned DSH versions. The host resolves ASAR-linked
bundle entries to their owning profile directories before importing, because
Electron can retain a link alias when resolving a descendant file.

The Windows installer migrates the known broken alpha.3 uninstaller only for an
in-place replacement: it closes owned processes and renames the old installation,
retaining its registration until the new installation commits. Extraction failure
restores the old directory. Other versions and changed installation locations use
the normal builder path. The native fixture covers both alpha.3 migration success
and extraction failure, in addition to ordinary replacement and backup protection.

The earlier [utility-process prototype](scripts/asar-probe/README.md) uses a
pre-ASAR runtime as input. Its measurements describe that experiment; complete
release acceptance comes from the production packaging workflow.

### Browser-login smoke

After preparing and packaging the native runtime, run:

```bash
# Linux (use a desktop session instead of Xvfb when available)
xvfb-run -a node apps/agent/desktop/scripts/login-smoke.mjs
```

`UWA_SMOKE_EXECUTABLE` can select an installed native executable. The smoke uses
an isolated Electron profile and a local mock OAuth issuer, with the real local
DSH cookie boundary, PKCE exchange, callback handlers and account switching.
It checks disconnected UI guidance, registered OS protocol ownership, embedded
fallback with fresh cookies, and callback replay rejection. Default-browser
launch is intercepted and OS callback events are delivered by the test; actual
OS-to-app dispatch and real third-party OAuth-provider consent still need
verification on the target operating system. The desktop workflow runs this smoke
on the installed Windows/macOS apps and the packaged Linux app.

When the operating system reports that the default browser cannot be opened,
Desktop falls back to a sandboxed built-in browser with a fresh, non-persistent
cookie session for each attempt. It intercepts the loopback return inside the
app, so fallback does not need the OS protocol handler. Closing the window
clears its cookies. The window title identifies the fallback and notes that
some OAuth providers reject embedded browsers. A successful browser-launch
response is not treated as a failure merely because sign-in takes time.
