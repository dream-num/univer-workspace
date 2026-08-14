# Univer Workspace

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
pnpm workspace:dev:client
```

The browser runs at <http://127.0.0.1:5173> and the server at
<http://127.0.0.1:3020>. See [the Workspace application README](apps/workspace/README.md)
for configuration, deployment, and data migration details.

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
pnpm sdk:update -- <exact-sdk-version>
```

## Runtime development license

The Workspace browser and CLI contain synchronized copies of the approved runtime
development credential for local use. It is rotated every 90 days and is not the
repository software license. Set `VITE_UNIVER_LICENSE` for browser builds or
`UNIVER_LICENSE` for the CLI to override it.
