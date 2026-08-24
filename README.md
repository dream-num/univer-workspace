# Univer Workspace

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Univer Workspace is the product repository for the Workspace browser and server,
its HTTP contract, the Workspace CLI, and the private reference-provider package.
The product organizes collaborative office content, access, sharing, Trash, history,
and isolated Worktree changes.

## Repository layout

```text
apps/workspace                 Workspace browser, server, and HTTP contract
apps/cli                       Agent-ready Workspace CLI
packages/reference-provider   Private browser reference-provider policy
```

The repository consumes version-matched `@univer-cli/*`, `@univerjs/*`, and
`@univerjs-pro/*` packages from the internal npm registry. The application and
reference provider are private workspace packages. Only `univer-workspace-cli`
is packaged for the internal npm registry.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 10
- access to the internal Univer npm registry

```bash
pnpm install
pnpm workspace:dev:server
pnpm workspace:dev:web
```

`workspace:dev:server` watches the backend and listens on
<http://127.0.0.1:3020>. When `apps/workspace/dist/public` exists, the server also
serves that last-built static web application; it does not rebuild or hot-reload web
changes.

`workspace:dev:web` starts the Vite web development server at
<http://127.0.0.1:5173>, enables hot module replacement, and proxies API and WebSocket
requests to port 3020. Run both commands and open port 5173 for web development.
Use port 3020 alone for backend work or to inspect the latest built web application.

See [the Workspace application README](apps/workspace/README.md) for configuration,
deployment, and data migration details.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
pnpm package:workspace-cli
```

All version-coupled Univer SDK packages use one exact release. Update them and the
lockfile together:

```bash
pnpm update:sdk --sdk_version <exact-sdk-version>
```

## Delivery

The source manifest for `univer-workspace-cli` remains at version `0.0.0`; release
versions are injected while building the package and must match the installed CLI
runtime.

- Pushing a stable `vX.Y.Z` tag whose commit belongs to `main` publishes
  `univer-workspace-cli@X.Y.Z` to insider-npm with the `latest` dist-tag.
- The `Release CLI to insider-npm` workflow can be dispatched manually from `main`
  with an exact `X.Y.Z-insider.<suffix>` version for the `insiders` dist-tag.
- Development packages use `X.Y.Z-dev.<suffix>` and can only be published locally:

  ```bash
  pnpm release:cli:dev -- --version X.Y.Z-dev.<suffix>
  ```

The `latest` and `insiders` paths verify that every version-coupled Univer dependency
uses one exact SDK baseline before packaging. The local `dev` path deliberately skips
that graph check. All three paths build, verify, install, and smoke-test the actual
tarball before publication. This workflow ends at insider-npm and does not perform a
Public Registry Promotion.

Workspace deployment is a separate manual workflow. It can build a selected existing
stable `vX.Y.Z` release tag and use that tag for the image, or, when no release tag is
provided, build the workflow dispatch commit and tag the image as `sha-<commit>`. It
hands the resulting image to the selected deployment environment. Pushing a tag does
not deploy the server.

## Runtime development license

The Workspace browser and CLI contain synchronized copies of the approved runtime
development credential for local use. It is rotated every 90 days and is not the
repository software license. Set `VITE_UNIVER_LICENSE` for browser builds or
`UNIVER_LICENSE` for the CLI to override it.

## License

[Apache-2.0](LICENSE)
