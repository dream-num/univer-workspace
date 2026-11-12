# dream-num/univer-workspace

> Owns the Univer Workspace product and its agent-ready CLI for organizing, collaborating on, and automating Univer content.

The repository source is licensed under Apache-2.0. Runtime development credentials,
Pro SDK dependencies, and artifact delivery retain their separately defined policies.

## Responsibilities

### Owns

- The Workspace product model for identity, Spaces, Nodes, Resources, access, sharing, Trash, recent activity,
  Blobs, Univer Assets, product-level Worktrees, Team Space Issues, Space stars, and recoverable cross-system operations. See the
  [application design](apps/workspace/docs/application-design.md).
- The deployable Workspace Browser and Server composition, including the product HTTP contract, authenticated and anonymous read-only
  Collaboration Endpoint integration, local persistence layout, and deployment lifecycle. See the
  [Workspace README](apps/workspace/README.md).
- The Workspace-specific CLI composition and agent workflow over remote Workspace Resources and Worktrees,
  including the agent-installable discovery entry at `skills/univer-workspace-cli/SKILL.md`,
  version-matched operational Skills, CLI-based reference reading and review handoff.
  This repository owns the discovery source; operational Skills remain in the CLI artifact.
  See the [CLI README](apps/cli/README.md).
- The private Node-hosted Workspace Client Core under `packages/client-core`, including shared Workspace HTTP,
  error, storage-neutral authentication protocol, Space/Node model, remote workflow behavior, and worker-backed
  content runtime lifecycle, including Office, Markdown, Typst, rendering, and SVG workflows. It is bundled into repository
  applications and is not a separately published SDK.
- The private Browser reference-provider policy under `packages/reference-provider`. It is an internal module,
  not a separately provided application or a cross-repository SDK contract.
- The private read-only Unit comparison UI under `packages/unit-comparison-viewer`, including decoded-UnitData
  rendering and its host-injected Univer runtime boundary. Workspace Browser and Workspace Agent consume
  the same repository source in separate React/Univer peer contexts; Agent bundles its copy into its browser artifact. Until an application-level shared component home is
  available, changes remain synchronized with the copies in `dream-num/univer-cli` and the DSH plugin.

- The private `packages/workspace-agent-runtime` headless content runtime, extracted from the existing Workspace Agent plugin. It supplies the same Facade worker and Worktree changeset path to that plugin and the isolated Space application. It owns no DSH Agent, conversation, document authority or permission model.

- The private shared HTML View host under `packages/workspace-html-viewer`, consumed by Browser and Agent.
  It owns sandbox rendering and Binding Host lifecycle; applications own source authorization,
  runtime assembly, and leave/save behavior.

- The standalone HTML App HTTP entry at `/apps/{nodeId}/run`, authorized through existing Node/Blob ACLs. It serves self-contained HTML in an opaque-origin CSP sandbox without a Binding Host; live-bound Apps use the existing embedded viewer.

- The private Markdown viewer under `packages/workspace-markdown-viewer`, shared by Browser and Agent.
  It owns read-only GFM rendering and URL presentation policy; applications own authenticated
  content loading and downloads. Markdown remains a Blob Resource, not a new Unit type.

## Provides

- **Univer Workspace** — the deployable Browser and Server application, product HTTP API, authenticated and anonymous read-only
  collaboration entry points, and background recovery processes. Contract: [Workspace README](apps/workspace/README.md)
  and [OpenAPI source](apps/workspace/contracts/http/openapi.yaml).
- **Univer Workspace CLI** — the internally packaged `univer-workspace-cli` application (executables `uvw` and
  `univer-workspace-cli`, one program; gh-style `repo`/`issue`/`pr` commands addressing `owner/slug` and `#N`) for agent-driven remote
  Workspace authoring, inspection, rendering, exchange, Worktree, and review workflows, including Blob
  download, ETag-guarded content replacement, and HTML View validation/publication, with browser-approved
  passwordless CLI session handoff for password, Email-code, and external-identity users. Contract:
  [CLI README](apps/cli/README.md) and [release workflow](.github/workflows/release-cli-manual.yml).

- **Univer Workspace MCP** — the private remote gateway under `apps/mcp`, built on Client Core.
  It exposes identity, repository, Issue, pull request, Space, Unit, Blob, label, merge, Facade API reference, Skills,
  and SVG resource catalog tools. It authenticates personal access tokens and MCP OAuth access tokens by exchanging
  them at Workspace for short-lived sessions; development session authentication is refused in production. It runs
  apart from Workspace Server and connects to no database. Use is limited to local and internal single-user
  environments until Stage G.
  Contract: [MCP README](apps/mcp/README.md).

- **Univer Workspace Agent** — the local browser application for conversations, document references,
  and agent Worktree review, composed from published DSH packages. Each instance has
  one active account for its single operator; switching accounts applies to every open tab.
  DSH owns browser authentication and Session attachments. Its Desktop shell uses
  default-browser OAuth with a one-use `univer-workspace://login` return link and
  backend-owned PKCE/session storage, with an isolated embedded-browser fallback when the
  operating system cannot open the default browser. Contract: [Agent README](apps/agent/README.md).

- **Space Plugin release candidate** — `apps/space-plugin` packages a standard Cordis/DSH
  plugin for the unchanged official DSH Desktop. This is an extension, not an Electron fork,
  a new Agent runtime, a managed Workspace Server, or a public SDK. Its isolated React 18/npm
  graph bundles the private content worker and carries the existing application development
  license and matching Exchange key in Host-only packaged configuration. It does not extend
  their validity. Markdown compilation/export reuse Client Core and the shared content runtime;
  compilation requires an explicit draft Worktree and does not implicitly publish to trunk.
  The current candidate targets DSH 0.2.1-rc.3 on macOS arm64; native acceptance and safe
  recovery after a Server crash in SDK `merging` remain release gates. Contract and install
  requirements: [Space Plugin README](apps/space-plugin/README.md).

## Depends on

- [`dream-num/univer`](https://github.com/dream-num/univer) — owns the core Unit model, Facade APIs, mutations,
  rendering, and `@univerjs/*` packages composed by both applications. Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-pro`](https://github.com/dream-num/univer-pro) — owns the Univer Pro content, Office exchange,
  collaboration client, and UI packages consumed by the Browser and CLI. Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-collaboration-sdk`](https://github.com/dream-num/univer-collaboration-sdk) — owns collaboration
  Service, revision, changeset, Thread Comment, Worktree, persistence, Endpoint, and Transport contracts used by Workspace.
  Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-cli-sdk`](https://github.com/dream-num/univer-cli-sdk) — owns the target-neutral headless,
  execution, inspection, rendering, daemon, and Commander capabilities composed by Workspace CLI.
  Contract: [repository boundary](AGENTS.md).
- [`dream-num/univer-data-binding-sdk`](https://github.com/dream-num/univer-data-binding-sdk) — owns HTML
  binding syntax and runtime APIs. CLI and Agent consume the published HTML parser; Browser and Agent compose page execution
  through their shared private viewer and Binding Engine factory, with application-specific
  source authorization, collaboration endpoints and referenced-Unit providers.
  Contract: [HTML Views integration](docs/design/html-views/README.md).
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
  changeset, revision, and Thread Comment data are stored separately in component-owned tables in the Collaboration
  SQLite file. Thread Comment anchors remain in Unit data while bodies, replies, and solved state use the Comment Adapter.
- SDK 1.0.0 upgrades the Collaboration file through published Core, Worktree, and History migrations.
  Workspace owns the offline startup boundary: consistent backup, migration on a copy, validation,
  and atomic replacement before Services start. Rollback requires the matching pre-upgrade backups;
  old and new SDK writers must never share the file. History segment indexing and catch-up belong to the SDK.
- Uploaded Resource bytes and embedded Univer Asset bytes are stored by the configured BlobStore. Database rows
  retain their identities, metadata, and recovery state. Blob content replacement preserves Resource identity
  and publishes directly; it does not use Worktree review. Sessions issued by token exchange (the MCP gateway)
  cannot create, replace or rename a Blob into a `.univer.html` page; they submit HTML View drafts instead.
- Link Sharing and Space public read admit anonymous viewers without creating Users or Login Sessions.
  Product writes and Worktree access still require authentication; HTML source permissions remain independent.
- Space stars are protected product User-Space relations, not memberships or access grants. The authenticated
  `GET/PUT/DELETE /api/spaces/{spaceId}/star` contract returns only the caller's state and an aggregate count;
  `SpaceView.owner` projects the existing owner's ID and username. Product V10 adds stars through the backed-up
  V9 → V10 startup migration; V11 adds the plain-text `SpaceView.description` (at most 350 characters, editable by
  users who can rename the Space) through a backed-up V10 → V11 startup migration; V12 adds the Team Space `slug` (addressed as `owner/slug`, with every
  Personal Space as `owner/personal`) and the repository-level Worktree `number` shared with Issues in a Team Space,
  through a backed-up V11 → V12 startup migration that backfills nothing. V14 adds an optional verified Email address on Users
  (`users.email`) and single-use Email login codes through a backed-up V13 → V14 startup migration. Old and new writers must not
  share the product file.
- `GET /api/spaces` lists only Spaces the caller owns or has joined, and every `SpaceView` carries
  `affiliation` (`owner`, `member`, or `none`). Public Spaces the caller has not joined are listed only by
  `GET /api/spaces/explore`; starred Spaces by `GET /api/spaces/starred`, filtered by current access. Listing
  never grants or reveals more than `GET /api/spaces/{spaceId}`. Sidebar pins are protected product User-Space
  preferences, not memberships or access grants: `GET/PUT/DELETE /api/spaces/pins` read, replace, and reset the
  caller's ordered list. Product V15 adds them, with a `space_stars(user_id)` index, through a backed-up
  V14 → V15 startup migration that backfills nothing.
- Product V18 adds MCP OAuth clients, OAuth grants with their retired refresh tokens, and personal access tokens,
  plus the `login_sessions` columns that tie a session issued by token exchange to its token, through a backed-up
  V17 → V18 startup migration that backfills nothing. Workspace issues and stores these tokens itself; the
  database keeps only their hashes, and the plaintext is returned once at creation or issuance. Revoking a token
  deletes the sessions issued for it. `POST /api/auth/agent-token` issues the Browser Agents module, from an
  interactive session cookie, a one-hour `uvw_at_` grant for the first-party `univer-workspace-agents` client bound to the
  same-origin `/mcp` resource, with only `read` or `read write`, and returns no refresh token.
- Product V19 adds HTML View drafts through a backed-up V18 → V19 startup migration that backfills nothing.
  A draft is a `.univer.html` create or revision whose bytes wait in the BlobStore; only its author can publish
  or reject it, from an interactive session, at `/api/html-view-drafts`. Publishing adopts the stored bytes in one
  transaction; rejected, expired and stale drafts release them. Pending drafts expire after 7 days.
- Login sessions, password hashes, verified Email addresses, Email verification-code hashes, stable GitHub and Discord user identifiers, ACLs (including Unit content edit protection collaborators and policies), personal access token and OAuth grant hashes, sharing state, and user-authored
  content are protected application data. Access tokens from external OAuth identity providers are used only during
  sign-in and account linking and are not persisted.
- The Browser Agents module keeps agent session records, which include document content returned by tools, and
  user-supplied model provider keys only in the user's browser: IndexedDB per Workspace user, or `sessionStorage` for a
  key the user chooses not to remember. Model requests go from the browser straight to the provider; no Workspace
  endpoint, log, URL, or session record receives the key.
- Short-lived pending CLI browser authorizations are bounded process-local state; approval issues a separate normal
  persisted login session and does not pass a browser cookie, password, or OAuth access token through the agent.
- OAuth secrets, trusted Bot credentials, registry credentials, production licenses, and deployment credentials are
  environment or build configuration and must not be committed to the repository.
- Stable `vX.Y.Z` tags are immutable source coordinates shared by the stable CLI release and Workspace deployments
  that select a release tag. Tag pushes trigger no CI or publication. CLI releases and deployment require separate manual workflow dispatches.
- Workspace images use either the selected release tag or `sha-<commit>` for an untagged workflow dispatch and are
  handed off to the private deployment repository; database migration and rollout ordering remain part of the
  Workspace application contract.

## Update contract

Update this file in the same change when any of these facts change:

- repository responsibilities or ownership boundaries;
- externally provided applications or their contracts;
- outgoing cross-repository dependencies;
- public APIs, protocols, events, images, artifacts, or deployment handoff;
- persistence layout, protected data classification, or credential handling.

## Agent desktop delivery

`apps/agent/desktop` owns experimental Electron packaging of the existing Agent
for Windows x64, macOS Apple Silicon, and Linux x64. It boots published DSH packages and local plugins from ASAR through Electron's
Node runtime, with native libraries unpacked. A user-installed plugin profile instead
runs the published DSH CLI with standalone Node and composes its browser modules.
Desktop keeps the profile and authored presets in a stable writable DSH_HOME;
account-owned sessions remain isolated. Independent Desktop migration scripts own
runtime-home upgrades. The home stores an independent data schema version, with
explicit ordered transitions and rejection of newer schemas; resource identity
only controls shipped-resource refresh. Staged activation switches data and its
version together, with a recovery journal and retained previous-home backups;
startup only invokes the migration entry point. This does not version DSH's
internal session formats or Workspace server databases.
The Desktop executable exposes a migration-only mode used by the Windows
installer in a confirmed non-admin user context and by normal first launch on
all platforms. Shared progress/failure UI runs before DSH. Silent installation
receives process exit codes; a data-preparation failure after program installation
only permits program-file rollback before registration commit when the migration
runner proves the original home remains active. Unknown outcomes retain both
program trees; a later repair archives owned backups without deleting them.
Existing installation/update mechanisms
remain responsible for application delivery. Standalone Node also serves external
commands; pinned Chromium serves document rendering. The
Electron packaging toolchain shares the repository pnpm workspace and lockfile.
GitHub Releases (`agent-vX.Y.Z`, `agent-vX.Y.Z-{alpha,beta,rc}.N`) are the download and update channel; CI requires
explicit manual dispatch and publication opt-in. Account data stays in the OS
application user-data directory, separate from replaceable runtime resources and
the local `workspace/` working directory.
See the [desktop contract](apps/agent/desktop/README.md).

## Browser HTML navigation

Workspace Browser owns the `window.univerWorkspace` native-preview navigation
interface for `.univer.html` templates. It displays independently authorized
Trunk Sheets, Docs and Slides read-only in an isolated editor frame and supports
bounded cell/paragraph/slide navigation and copying the HTML file link. The
existing SDK `univerBinding` interface still owns cell data operations. No
credentials, permission overrides, arbitrary commands or draft routing are
exposed to templates. Workspace Agent's Sidecar does not yet provide this Browser
navigation interface. See `docs/design/html-views/native-preview.md`.
