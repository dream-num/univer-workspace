# dream-num/univer-workspace

> Owns the Univer Workspace product and its agent-ready CLI for organizing, collaborating on, and automating Univer content.

## Responsibilities

### Owns

- The Workspace product model for identity, Spaces, Nodes, Resources, access, sharing, Trash, recent activity,
  Blobs, Univer Assets, product-level Worktrees, and recoverable cross-system operations. See the
  [application design](apps/workspace/docs/application-design.md).
- The deployable Workspace Browser and Server composition, including the product HTTP contract, authenticated
  Collaboration Endpoint integration, local persistence layout, and deployment lifecycle. See the
  [Workspace README](apps/workspace/README.md).
- The Workspace-specific CLI composition and agent workflow over remote Workspace Resources and Worktrees,
  including version-matched operational Skills and review handoff. See the [CLI README](apps/cli/README.md).
- The private Browser reference-provider policy under `packages/reference-provider`. It is an internal module,
  not a separately provided application or a cross-repository SDK contract.

## Provides

- **Univer Workspace** — the deployable Browser and Server application, product HTTP API, authenticated
  collaboration entry points, and background recovery processes. Contract: [Workspace README](apps/workspace/README.md)
  and [OpenAPI source](apps/workspace/contracts/http/openapi.yaml).
- **Univer Workspace CLI** — the internally packaged `univer-workspace-cli` application for agent-driven remote
  Workspace authoring, inspection, rendering, exchange, Worktree, and review workflows, with browser-approved
  passwordless CLI session handoff for password and external-identity users. Contract:
  [CLI README](apps/cli/README.md) and [release workflow](.github/workflows/release-cli.yml).

## Depends on

- [`dream-num/univer`](https://github.com/dream-num/univer) — owns the core Unit model, Facade APIs, mutations,
  rendering, and `@univerjs/*` packages composed by both applications. Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-pro`](https://github.com/dream-num/univer-pro) — owns the Univer Pro content, Office exchange,
  collaboration client, and UI packages consumed by the Browser and CLI. Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-collaboration-sdk`](https://github.com/dream-num/univer-collaboration-sdk) — owns collaboration
  Service, revision, changeset, Worktree, persistence, Endpoint, and Transport contracts used by Workspace.
  Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-cli-sdk`](https://github.com/dream-num/univer-cli-sdk) — owns the target-neutral headless,
  execution, inspection, rendering, daemon, and Commander capabilities composed by Workspace CLI.
  Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-protocol`](https://github.com/dream-num/univer-protocol) — owns the protocol types consumed by
  collaboration and content workflows. Contract: [repository boundary](AGENTS.md).
- [`dream-num/helm-chart-private`](https://github.com/dream-num/helm-chart-private) — receives deployment handoff
  events for Workspace container images. Contract: [deployment workflow](.github/workflows/push.yml).

## Authoritative sources

- **Repository purpose and development entry points:** [README.md](README.md)
- **Repository responsibilities and dependency boundaries:** [AGENTS.md](AGENTS.md)
- **Workspace runtime, configuration, persistence, and deployment:** [Workspace README](apps/workspace/README.md)
- **Product HTTP contract:** [OpenAPI source](apps/workspace/contracts/http/openapi.yaml)
- **Code and system architecture:** [Architecture](apps/workspace/docs/architecture.md)
- **Application module boundaries:** [Application design](apps/workspace/docs/application-design.md)
- **Product data model and persistence semantics:** [Data model](apps/workspace/docs/data-model.md)
- **Accepted architectural decisions:** [ADR directory](apps/workspace/docs/adr)
- **CLI user and distribution contract:** [CLI README](apps/cli/README.md)

## Deployment and data classification

- Workspace product metadata and authentication state are stored in the product SQLite database; Univer snapshot,
  changeset, and revision data are stored separately through the Collaboration Database Adapter.
- Uploaded Resource bytes and embedded Univer Asset bytes are stored by the configured BlobStore. Database rows
  retain their identities, metadata, and recovery state.
- Login sessions, password hashes, stable GitHub and Discord user identifiers, ACLs, sharing state, and user-authored
  content are protected application data. OAuth access tokens are used only during sign-in and are not persisted.
- Short-lived pending CLI browser authorizations are bounded process-local state; approval issues a separate normal
  persisted login session and does not pass a browser cookie, password, or OAuth access token through the agent.
- OAuth secrets, trusted Bot credentials, registry credentials, production licenses, and deployment credentials are
  environment or build configuration and must not be committed to the repository.
- Stable `vX.Y.Z` tags are immutable source coordinates shared by the stable CLI release and Workspace deployments
  that select a release tag. Tag push publishes only the CLI; deployment remains a separate manual workflow.
- Workspace images use either the selected release tag or `sha-<commit>` for an untagged workflow dispatch and are
  handed off to the private deployment repository; database migration and rollout ordering remain part of the
  Workspace application contract.

## Update contract

Update this file in the same change when any of these facts change:

- repository responsibilities or ownership boundaries;
- either of the two externally provided applications or their contracts;
- outgoing cross-repository dependencies;
- public APIs, protocols, events, images, artifacts, or deployment handoff;
- persistence layout, protected data classification, or credential handling.
