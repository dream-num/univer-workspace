# DSH desktop packaging feasibility

Research date: 2026-09-10. This is a feasibility note, not an implemented desktop
delivery contract. Sources were read through the upstream GitHub API; no upstream
checkout is a build input.

## Conclusion

Workspace Agent can adopt the upstream packaging architecture, but cannot consume
its desktop shell as a published SDK. Both `@deepseek-ai/dsh-desktop` and
`@deepseek-ai/dsh-desktop-host` are private application packages. Upstream explicitly
keeps the Desktop Host out of the public CLI and never publishes it to npm. Its
packaging commands build and pack the upstream repository rather than accepting a
downstream branded profile as a public packaging input. [1][2][3]

The recommended downstream approach is an application-owned Electron shell that
starts the published DSH CLI under a bundled standalone Node.js runtime and loads
the existing Workspace Agent profile. Reusing the desktop source, internal Host
entry, or internal transport would violate this repository's published-package
boundary. This recommendation is an integration inference, not an upstream promise
of compatibility. [1][2][3][10]

## Version and evidence boundary

- The `dsh-v0.1.5-rc.1` tag resolves to
  `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Desktop packaging already exists at
  that tag; a move to the default branch is unnecessary for examining it. [4]
- The inspected default branch resolved to
  `aa8262ec091698bae9a6b04773a6b5b06ad4aef2`, nine commits ahead. Its comparison with
  the release changes documentation, including translated Desktop README files,
  without changing the Desktop implementation. All source links below pin rc.1. [5]
- The GitHub rc.1 release was published at `2026-09-10T03:09:00Z`; its GitHub assets
  list was empty when inspected. This does not establish whether an installer
  exists on the separate download service documented upstream. [4][1]

## What upstream actually ships

| Concern | Upstream implementation |
| --- | --- |
| Shell | Electron, not Tauri; Electron `^44.0.0`, electron-builder `^26.15.3`, electron-updater `^6.8.9`. [2] |
| Host runtime | Standalone upstream Node.js 24.17.0, downloaded with SHA-256 verification and executable-version verification on compatible hosts; bundled pnpm 11.7.0. Electron's Node and system Node/pnpm are outside the packaged host execution path. [1][2][6] |
| Transport | No listening web port. A private Node child boots DSH; `dsh-app://` serves assets and Fetch traffic, framed byte pipes carry request/response bodies, and Node IPC carries lifecycle messages. [1][7] |
| Composition | Desktop Host applies the installed profile's bundle patches, then a desktop overlay disabling web startup/server/runtime, HMR and browser launch, and adding native directory-picker plugins. [7][8] |
| Installation | Signed resources contain local first-party tarballs, a lockfile, integrity inventory and offline pnpm seed. Installation stages a writable profile, verifies offline installation and backend health, and activates with a journal and rollback profile. [1] |
| State | A process-lifetime single-instance lock protects the reserved `$DSH_HOME/profiles/desktop`; executable graphs and pnpm state are isolated from CLI even where supported product data is shared. [1] |
| Renderer boundary | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; arbitrary new windows and navigation outside the app protocol are denied. [9] |
| Updates | Shell, exact matching DSH, Node and pnpm form a single release. electron-updater uses platform-specific generic-provider metadata; upload is separate from packaging. [1][11] |

These are application implementation details worth learning from, not exported
desktop APIs. The public CLI package does expose the `dsh` executable at
`lib/bin.js`. [10]

## Platform and release limits

The supported packaging targets are `mac-arm64`, `mac-x64`, and `win-x64`.
macOS arm64 requires Apple Silicon; macOS x64 can use Intel or Apple Silicon with
Rosetta; Windows x64 requires a Windows x64 build host. Although the generic
electron-builder configuration mentions AppImage, upstream explicitly says Linux
is not a supported Desktop release target and its target parser excludes Linux.
macOS artifacts are DMG and ZIP; Windows uses NSIS. [1][11][12]

Upstream production packaging requires signing rather than silently emitting
unsigned releases. macOS verifies Developer ID identity and Team ID and notarizes
and staples the app and DMG. Windows uses a configured EV certificate, SignTool,
SafeNet private-key token, and controlled runner credentials. Those release
credentials and upstream download URLs are not reusable downstream assets. [1][11]

Upstream platform support does not prove that Workspace Agent's native Office
dependencies support the same matrix. Our parallel local inspection found the
installed `@univerjs-pro/exchange-node-binding@0.1.0` optional-package matrix covers
macOS arm64, Linux x64/arm64 GNU, and Windows x64 MSVC, but not macOS x64 or Windows
arm64. This local finding must be revalidated against the final pinned artifact
before release. Windows x64 and macOS arm64 are therefore sensible first targets;
macOS x64 should not be promised based on Electron support alone.

## Proposed Workspace Agent adaptation

The following is downstream design analysis; it is not implemented by this note.

1. Keep desktop delivery inside the Agent application boundary. Own the window,
   installer metadata, lifecycle and update identity; consume the published DSH CLI
   and existing profile rather than the upstream private Desktop Host.
2. Bundle standalone Node 24, the exact DSH release, the three Agent/profile/plugin
   bundles and their production dependencies. Keep package assembly isolated from
   the repository's React 19 application graph. Exercise Office native bindings,
   render-browser assets and workers from the packaged artifact.
3. Store immutable runtime and packaged inputs in application resources. Put
   credentials, sessions, logs and the installed writable profile in an
   application-owned data directory. Do not write beneath the signed installer or
   reuse the upstream reserved desktop profile.
4. Initially preserve our existing loopback HTTP composition. The upstream
   no-port transport is private and would require an independent transport
   integration. Verify the existing browser OAuth callback and its fixed loopback
   registration against the packaged launcher; arbitrary port selection cannot be
   assumed compatible with a registered callback URL.
5. Restrict the renderer to the owned local origin, keep Node integration disabled,
   and explicitly allowlist external-browser handoffs needed for Workspace login.
   Verify browser callback completion and return to the desktop session.
6. Own one backend child per desktop instance, wait for readiness, report startup
   errors, and stop the owned process tree on quit. Separate instances and other
   locally running Agent services must remain independent.
7. Build and test on each target OS. Treat installer creation, clean-machine first
   launch, authentication, document rendering, Office import/export, uninstall and
   upgrade as distinct acceptance checks. A successful Linux build cannot certify
   a Windows installer or macOS signatures.

Signing identity, first supported operating systems, release distribution and
automatic-update policy remain product/release choices. A first reviewable package
can be built without copying upstream's entire transactional plugin manager or
claiming support for its private transport.

## Public startup integration follow-up

The published rc.1 APIs provide a structured alternative to parsing startup logs:

- `@deepseek-ai/dsh-cmdline` exposes `AppReady.onReady(listener): disposer` through
  `ctx.appReady`. The public CLI provides it before mounting the profile and commits
  readiness only after successful boot and watcher setup. Failed or terminated
  startup does not notify listeners. [13][14]
- `@deepseek-ai/dsh-client-connection` exposes
  `HostConnectionHandle.authenticatedUrl(baseUrl)` and the corresponding
  `HostConnectionService` method. Together with the public `ctx.webServer.port`, an
  application plugin can produce the authenticated loopback URL after readiness.
  The initial root GET exchanges its token for the standard DSH cookie. [15][16]
- An Agent-owned plugin can inject those services, register an `onReady` callback,
  and send a typed readiness message through an explicitly inherited Node IPC
  channel. The local launcher must forward that channel between DSH and Electron;
  DSH does not itself provide an IPC readiness announcement. This is a proposed
  application integration using public services, not a modification of DSH.
- Public Web flags are `--host`, `--port` (including `0`), `--no-open`, and
  `--trusted-host`. There is no startup flag or connection configuration property
  to choose the browser token; the implementation generates 32 random bytes per
  process root. Do not recreate the cookie or read its signing secret. [16][17]
- Upstream's exact `dsh web: <authenticated URL>` stdout line is deliberately a
  readiness signal after Loader settlement. Its `printUrl` configuration can be
  disabled by a composed profile so an IPC-based desktop launcher need not place
  the bearer URL in ordinary logs. [18]
- Normal public CLI profile boot resolves the installed graph and creates its
  fallback links without invoking a package-manager subprocess. `dsh plugin`
  separately calls `spawnSync('pnpm', ...)`, using a shell on Windows for the `.cmd`
  shim, and fails if pnpm is absent from PATH. A preinstalled profile can start
  without system pnpm; exposing plugin installation requires a controlled bundled
  pnpm path or a separate application-owned installation workflow. This conclusion
  concerns CLI boot, not tools a model might choose to invoke later. [14][19][20]

## Sources

1. [Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/README.md)
2. [Desktop manifest](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/package.json)
3. [Private Desktop Host manifest](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop-host/package.json)
4. [rc.1 release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.1.5-rc.1) and [tag source](https://github.com/deepseek-ai/deepseek-harness/tree/183f08e9c6dde7e36cd2318eaee70b0da08fb35e)
5. [Pinned release-to-default comparison](https://github.com/deepseek-ai/deepseek-harness/compare/183f08e9c6dde7e36cd2318eaee70b0da08fb35e...aa8262ec091698bae9a6b04773a6b5b06ad4aef2)
6. [Runtime preparation](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/scripts/prepare-runtime.ts)
7. [Private host entry](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop-host/src/index.ts)
8. [Desktop composition overlay](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop-host/config/desktop.cordis.patch.yml)
9. [Electron main process](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/src/main.ts)
10. [Public CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/cli/package.json)
11. [electron-builder configuration](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/electron-builder.config.mjs)
12. [Target packaging script](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/desktop/scripts/package-target.ts)
13. [Public Cmdline readiness service](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/boot/cmdline/src/index.ts)
14. [CLI profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/cli/src/profile-boot.ts)
15. [Public Connection handle](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/client/connection/src/rpc.ts)
16. [Browser authentication implementation](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/client/connection/src/browser-auth.ts)
17. [Public Web startup flags](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/bundle/web-app/src/startup.ts)
18. [Web runtime readiness and URL announcement](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/bundle/web-app/src/index.ts)
19. [CLI plugin package-manager invocation](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/apps/cli/src/plugin.ts)
20. [Profile filesystem and package resolution](https://github.com/deepseek-ai/deepseek-harness/blob/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/packages/boot/app-boot/src/profile.ts)

## CI build follow-up

The official desktop documentation uses fixed per-target package commands on a
compatible native host, not Linux-based cross-compilation: Apple Silicon for
`package:desktop:mac:arm64`, Windows x64 for `package:desktop:win:x64`, and Intel
macOS or Rosetta for `package:desktop:mac:x64`. Its Windows EV-signing guidance
explicitly requires a controlled self-hosted Windows runner with the physical
SafeNet token attached. Packaging and uploading are separate commands. [1][12]

The inspected public `ci.yml`, `ci-master.yml`, `release.yml`, and
`release-publish.yml` do not call the Desktop target packaging commands. Their
ordinary Windows/macOS build/test lanes should not be described as evidence that
they publish desktop installers. This does not exclude private release automation.
See the [pinned workflow directory](https://github.com/deepseek-ai/deepseek-harness/tree/183f08e9c6dde7e36cd2318eaee70b0da08fb35e/.github/workflows).

For Workspace Agent, a Windows x64 / macOS ARM64 / Linux x64 CI matrix is feasible
as a downstream design: use native runners for each production dependency graph
and installer. Suggested artifacts are NSIS EXE, DMG plus ZIP, and AppImage plus
DEB respectively. Linux is our additional target, not an officially supported DSH
Desktop release. Validate the pinned Office native modules on all three platforms.
Unsigned test artifacts can be a separate delivery lane from signed, notarized
public releases; automatic publishing remains a separately authorized action.
