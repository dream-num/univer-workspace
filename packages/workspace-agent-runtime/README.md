# Workspace Agent runtime

`@univerjs/univer-workspace-agent-runtime` is a private, Node-facing execution
layer for Workspace content work. It owns the headless Univer runtime that reads
and commits Unit content, and the Workspace product operations — spaces,
resources, issues, worktrees, blobs, status, rendering, exchange — that agent
tools call. It is not published to npm.

## Why this package exists

Two Node hosts need the same product operations and runtime composition: the
DSH-hosted Workspace Agent and the isolated Space app. Sharing this common core
avoids duplicated execution logic and reduces behavioral drift as the hosts
evolve. Host-specific policy stays with each host.

## Consumers

- [`packages/dsh-univer-workspace-plugin`](../dsh-univer-workspace-plugin/README.md)
  — the DSH-hosted Workspace Agent, which adapts the runtime behind its own
  provider and tool modules.
- [`apps/space-plugin`](../../apps/space-plugin/package.json) (`dsh-space-plugin`)
  — the isolated Space app, which **bundles** this package into its artifact
  rather than shipping it as a runtime dependency.

## What it owns

| Area | Where |
| --- | --- |
| Runtime manager, worker, worker HTTP, target, snapshot adapter | [`src/manager.ts`](./src/manager.ts), [`src/worker.ts`](./src/worker.ts), [`src/worker-http.ts`](./src/worker-http.ts), [`src/target.ts`](./src/target.ts), [`src/snapshot-adapter.ts`](./src/snapshot-adapter.ts) |
| Workspace product operations | [`src/workspace/`](./src/workspace/) |
| Version-matched API reference query | [`src/api-reference.ts`](./src/api-reference.ts) |

Entry points are declared in [`package.json`](./package.json). The `./workspace-*`
subpaths group product operations by area: spaces, resources, issues, worktree,
file state, blob, inspection, skill resources, HTML view, SVG, render, exchange,
session path, plus the JSON/wire/state contracts.

The shared worker registers the published Markdown runtime. `readWithRevision`
reads native blocks and their authoritative revision under one lease; the
revision is read metadata. Office conversion uses `configureLocalExchange` with
a Host-supplied license/key pair; the published Exchange wrapper stays external
so Node owns native binding resolution.

## What the host owns

The host stays responsible for the authorization scope it exposes, the
credentials it resolves, its configuration, and the lifecycle of the worker
processes it starts. The Server performs the final authorization for every
request. This package does not own chat, document storage, permissions, or an
Agent Runtime. The original draft-write entry requires a Worktree; the explicit
trunk entry serves ordinary Space Agent edits.

## Build and verification

Build this package before building either consumer:

```bash
pnpm --filter @univerjs/univer-workspace-agent-runtime build
```

This package has a `build` script and no independent `typecheck` or `test`
script. Use the consumer checks as integration entry points; the absence of
a package-level check is not a claim of complete type coverage:

```bash
pnpm --filter dsh-univer-workspace-plugin typecheck
pnpm --filter dsh-univer-workspace-plugin test   # builds this package first
pnpm --filter dsh-space-plugin typecheck
pnpm --filter dsh-space-plugin test
```

Node 24 is the supported runtime: the repository declares `node >=24` in
[`package.json`](../../package.json) and the build targets `node24`. The
Univer / Univer CLI / Univer Pro baseline is 1.4.0; `@univerjs-labs/html-view`
follows its own release cadence.
