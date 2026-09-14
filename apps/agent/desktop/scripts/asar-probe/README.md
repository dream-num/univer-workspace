# ASAR service prototype

This is a diagnostic application host, not the shipping desktop launcher. It
tests published DSH packages in Electron 44 utility processes with read-only code
in ASAR, preserving the bootstrap and profile dependency graphs. It does not
patch DSH, merge conflicting package versions, modify an installed application,
or read an existing desktop account profile.

Run on the target OS with the workspace dependencies installed, a prepared native
`resources/runtime` directory, and the Electron version matching that runtime's
browser-cache manifest:

```sh
node apps/agent/desktop/scripts/asar-probe/prepare.mjs <runtime> <new-probe-directory>
node apps/agent/desktop/scripts/asar-probe/run.mjs <electron-executable> <probe-directory>
```

Then run Electron with `<probe-directory>/capability-host.cjs` as its application
entry. In PowerShell, use `&` before a quoted executable path.

Preparation copies only application runtime inputs, packs ordinary code and
resources, and keeps native modules, executables and shared libraries with
`.node`, `.exe`, `.dll`, `.so` and `.dylib` extensions in `host.asar.unpacked`.
It retains staging files for inspection. The browser probe opens a temporary
English-language window, uses a random loopback port and new data directory,
reuses the production onboarding interaction check, and requests graceful service
shutdown. The capability probe exercises native CSV import/export, the real SDK
worker fork/handshake, and a terminal that prints a sentinel and exits. The worker
test deliberately rejects a test runtime after its handshake; it does not connect
to a Workspace or edit a document.

Outputs include `browser-result.json`, `host-result.json`, `capability-result.json`,
and a screenshot. Read the JSON result as well as process exit status. Generated
runtime data and archives stay in the supplied probe directory. Do not put that
directory inside an existing installation or account directory.

## Host adaptations

- Use published `loadProfileDirectory`, `boot`, and `provideCmdline` APIs for a
  fixed application-owned plugin roster, avoiding the CLI's writable module
  fallback junctions into ASAR.
- Use `module.registerHooks` only to resolve missing bare imports from the public
  Cordis Loader entry or this host's writable configuration directory. The
  original import/require conditions and both package graphs remain intact.
  This isolates the workaround for the native internal-loader helper being
  unavailable in Electron. No `--expose-internals` flag is required by the final
  prototype. Remove the workaround when published DSH handles both initial and
  dynamically mounted plugin imports in an embedded archive host.
- Bridge the Workspace readiness plugin's Node IPC to the utility parent port;
  expose a launcher-owned readiness service after the plugin tree settles.
- Set `ELECTRON_RUN_AS_NODE` inside the service for descendant forks. The current
  Electron 44 executable can read ASAR in this mode as well. This relies on its
  RunAsNode fuse and must be checked against the final packaged executable.

## Validation and limits

The tested host layout is one ASAR plus 23 unpacked native files. A 78.84 MB ZIP
of these files extracted with the shipping NSIS plugin in 6.037 seconds, with all
24 output files matching SHA-256. This is host-payload extraction only, not a
complete installation. [Raw results](../../docs/measurements/windows-asar-prototype-20260914.json)
include the timings and capability checks.

The Windows prototype passed native Office roundtrip, worker handshake, ConPTY,
the production onboarding interaction probe, and graceful service disposal. One
fresh-profile browser run measured 9.183 seconds interactive, 2.026 seconds for
service readiness, and 35 milliseconds for shutdown, with no renderer errors.
A second fresh-profile run measured 9.048 seconds interactive, 1.964 seconds for
service readiness, and 36 milliseconds for shutdown. OS caches were already warm; the random origin differs from the browser-cache
seed's fixed origin. These results are not an installed first-launch guarantee.

The prototype does not implement `start-local.mjs`'s account-state migration and
active-connection setup, the shipping desktop's OAuth/update/menu integration,
or general CLI/plugin management. It does not prove every DSH subprocess tool
works without a separate `node` on PATH. macOS signing/notarization, Linux,
full native document rendering, old-version upgrades, and complete installer
timings remain unverified for this host. Production code still uses the existing
standalone Node launcher.
