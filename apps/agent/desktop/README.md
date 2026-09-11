# Workspace Agent desktop

Experimental desktop delivery of the existing Workspace Agent application. This
is an application-owned Electron shell around the published DSH CLI and the three
Workspace bundles, not a fork of DSH or a public SDK. Electron packaging tools belong to the root pnpm workspace and share its single
`pnpm-lock.yaml`. The generated DSH runtime remains isolated from that workspace
and its React dependency graph.

Like DSH Desktop, the Electron shell explicitly uses ASAR while the standalone
Node/DSH runtime stays in `extraResources`; ordinary Node cannot load modules
directly from Electron's ASAR. The version-scoped osx-sign patch follows DSH's
`lstat` fix for Framework aliases and additionally scans files sequentially to
avoid exhausting file descriptors. Remove it when an upstream release provides
both fixes. Raising the descriptor limit alone did not fix the native build.

## Release size policy

Agent and both plugin builds do not generate source maps. Finalization removes
maps supplied by third-party packages before inventory/signing, and runtime smoke
checks reject any remaining maps. The Electron ASAR also excludes them.

The capability plugin bundles its JavaScript SDK dependencies; only external
native bindings and `ws` remain installation dependencies. Desktop builds remove
unnecessary whitespace without renaming identifiers. Standalone Node includes
the executable and upstream notices, while npm and development headers remain
in the build directory. DSH's pnpm and plugin installation sources remain available
for profile management. node-pty retains only target-platform prebuilds alongside
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
every six hours, or from **Help → Check for Updates**. All channels exclude CLI
releases and use the selected release's immutable generic update feed,
not GitHub's repository-wide latest release. The app asks before downloading and
restarting. Active tasks should finish before accepting. Metadata and blockmaps
are release assets, not extra installer choices. Linux updates require running
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

## Manual CI and publication

Run **Build and release Agent desktop (manual)** in GitHub Actions with an exact version. `dry_run`
defaults to true; all three native jobs upload Actions artifacts. To publish,
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
that Later keeps the current app running, and that accepting downloads, stops
the local service, installs and restarts into alpha.2 with account data intact.
On Linux run the AppImage itself, not the unpacked executable. Verify that a
failed download leaves the current app running and can be retried. Repeat the
alpha-to-beta, beta-to-rc, and rc-to-stable transitions before graduating each stage. Windows remains unsigned.

The automated tests cover selection, metadata channel/version matching, consent,
retry, and shutdown/install order. Native CI smoke tests cover packaged startup;
these do not substitute for the two-release installation acceptance above.

## Runtime, login, and data

The shell starts its own Node/DSH process on `127.0.0.1:3101`. An occupied port is
an error; the app never adopts an unknown process. DSH generates browser
authentication and passes the URL through a private child-process IPC channel.
The main renderer has no Node access and remains on the local origin. Login
uses a separate sandboxed window sharing the local cookie session. External OAuth
providers may restrict embedded browsers; verify your deployment's login flow.
Register the callback documented in the [Agent guide](../README.md#connect-to-a-local-workspace)
for port 3101 before connecting. Desktop packaging does not include a Workspace
Server or model credentials.

Electron's OS-specific `userData` directory contains `data/` for credentials,
settings, and account-scoped sessions. `workspace/` is the separate local working
directory; Agent does not use its credential/runtime tree as the project folder. `runtime/` is a writable installed copy of
the bundled runtime. Upgrades stage and verify a new runtime before activation,
retain `runtime.previous` for recovery, and leave `data/` intact. Initial setup and upgrades can take several minutes;
later launches reuse the verified runtime. Quit stops the
application-owned service process tree. Back up `data/` independently; uninstall
and update operations must not be used as account-data cleanup.
