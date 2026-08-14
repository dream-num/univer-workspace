---
status: accepted
---

# Version and publish Workspace artifacts independently

The repository is a private pnpm workspace with `apps/workspace`, `apps/cli`, and
`packages/reference-provider`. The `@univerjs/univer-workspace` app and
`@univerjs/univer-workspace-reference-provider` package remain private; only
`univer-workspace-cli` is packaged for the internal npm registry. The CLI uses SemVer,
deployment images use Git SHAs, and the product database keeps its independent
`PRAGMA user_version`. Workspace and CLI dependencies use one exact Univer SDK cohort
that is updated atomically with the repository lockfile.
