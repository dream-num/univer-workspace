# dsh-univer-workspace-plugin

The Univer capability plugin for DSH. It gives an agent the ability to
operate **remote Univer Workspace Units** (documents) in the Spaces the
authorizing User can access. Documents are Units managed and persisted by the
Univer Workspace backend; local paths are used only for task assets and
import/export, not as document identities.

## Why run in a dedicated DSH profile?

This plugin is part of the Workspace Agent application composition. The supported
setup installs it into the dedicated `univer-workspace-harness` profile alongside
the Agent core, skin, and version-matched DSH web bundle. Follow the
[Agent installation guide](../../apps/agent/README.md#installation-and-first-use)
instead of adding this capability bundle alone to an existing general-purpose
`web` profile.

A DSH profile selects an installed bundle set and its composition patches. A
separate profile matters here for four reasons:

- **Required services and lifecycle.** The plugin consumes the Agent core's
  `workspaceAuth` and `workspaceRuntime` services. They supply the authorized
  Workspace connection and account-owned runtime directory. Installing the tools
  alone does not establish OAuth, Space bindings, or account switching.
- **Application-wide UI composition.** Agent replaces the native sidebar and
  reference discovery, and configures the webserver, connection handling,
  settings, and credentials. The native and replacement sidebar cannot both
  declare the same child slots. Applying these patches to a user's ordinary
  profile would also change that profile's interface and behavior.
- **Tool and document semantics.** Other Univer plugins may use overlapping tool
  names for local `.univer` files. Here documents are remote, database-backed
  Workspace Units with Resource identities and Worktree review. Mixing both
  toolsets in one composition can introduce name collisions and contradictory
  instructions about where content lives.
- **Reproducible dependencies.** The profile is a separate pnpm project under
  `$DSH_HOME/profiles/<profile>`. The profile builder installs the pinned DSH web
  bundle first, then the three repository bundles, reusing its peer versions.
  This keeps Agent's supported bundle set separate from another profile's plugin
  choices. The DSH CLI is also installed outside the repository workspace to
  keep its React 18 graph separate from Workspace Browser's React 19 graph;
  choosing a profile alone does not provide that dependency isolation.

### Profile isolation is not account isolation

| Boundary | What owns it |
| --- | --- |
| Installed plugins and composition patches | The dedicated DSH profile, assembled by `build-profile.sh` |
| Workspace connection, login, and account switching | Agent core; one active connection per running instance |
| Account-specific Sessions, indexes, attachments, and local Space directories | Runtime directories selected by Workspace origin and user ID under `UWH_DSH_DATA_HOME` |
| Shared local model settings and browser-session signing state | Agent's shared settings and credentials paths |
| Remote document access and mutation permissions | Workspace server |

Use the same profile when switching Workspace accounts; the application switches
account-owned services and data directories without reinstalling plugins or
restarting the HTTP listener. All tabs connected to that Agent instance share
its current Workspace identity. A profile is not an OS sandbox and does not
restrict the agent's local filesystem permissions.

The default profile name remains `univer-workspace-harness` after the application
rename. Keep the builder and launcher on the same `DSH_PROFILE` if choosing a
custom name. See the [Agent storage guide](../../apps/agent/README.md#local-data-and-storage)
for installation paths, shared state, and account data; do not use a profile name
as a substitute for those explicit storage boundaries.

## Delivered so far

- **Space ↔ dsh-workspace reconciliation**: the User's remote Spaces are
  listed from the Workspace product API and each is bound to a mechanical
  dsh workspace directory under the configured root; a durable shadow table
  (`space-links` storage domain) maps a dsh workspace id back to
  `{ userId, spaceId }`. Selecting a Space in DSH selects one of the User's
  accessible Spaces; the directory is never surfaced to the User.
- **Discovery tool**: `univer_spaces` lists the User's Spaces through the
  harness `workspaceAuth` service, resolving the calling agent from its
  session working directory.
- **Document tools**: `univer_documents`, `univer_open`, and `univer_create`
  list, open, and create Univer documents through the Workspace product API.
- **Editing**: `univer_edit` executes Facade API code in a headless
  collaboration runtime (read against trunk/draft, write only in Worktree
  scope with a committed changeset), managed by a forked worker pool.
- **Review**: `univer_worktree` drives the Worktree lifecycle
  (create/ready/merge/discard) with merge and discard forced through the
  `tools/pre-execute` approval waterfall.
- **Worktree-local Unit**: `univer_unit` implements the Workspace product's
  `source=worktree` create contract with the calling Space as its enforced
  scope, stable idempotency, pending-Operation polling, and complete Unit
  response validation. `action=remove` marks a Unit for deletion at merge;
  `action=restore` undoes that draft intent. Existing documents enter Trash only
  after merge, while canceled new Units never become published documents.
- **Execution sources and path safety**: `univer_execute` accepts exactly one
  inline `code` or session-relative `codeFile`; both import/export paths use
  canonical realpath containment checks, including symlink escapes.
- **Import/export**: `univer_import` and `univer_export` use the pinned
  `@univerjs-pro/exchange-node` SDK locally. Import converts the session file
  into JSON-safe UnitData and creates a Worktree-local Unit (so it can be
  reviewed, discarded, or merged); export synchronizes a trunk or Worktree
  Unit and writes `.xlsx`/`.csv`/`.tsv`/`.docx`/`.pptx` bytes back to the
  session workspace. The product trunk exchange task is intentionally not
  used because it would bypass Worktree review semantics.
- **Structured inspection**: `univer_inspect` uses the pinned
  `@univer-cli/content-inspection` contract for workbook/document/
  presentation overviews and Sheet ranges; it never executes caller-provided
  write code.
- **SDK reference and assets**: `univer_api` uses the pinned
  `@univer-cli/api-reference`; `univer_resources` uses the pinned resource
  library and a build-time copied `@univerjs-pro/cli-assets` manifest. The
  latter is a static visual-asset catalog, not the Workspace product's
  Resource/ACL model.
- **Worktree parity**: `univer_worktree` exposes the review lifecycle used by
  the browser (`create` → `ready` → `merge`/`discard`). The underlying
  transition adapter may retain compatibility with older server actions, but
  the plugin exposes `reopen` for returning a ready Worktree to draft.
- **Browser Space picker**: this plugin owns the Workspace Space picker and
  injects it into the stock DSH hero/sidebar slots. DSH still owns its native
  mechanical workspace list and session persistence; selecting a Space only
  chooses the linked DSH workspace for the next session.
- **Browser file workspace**: the sidebar replaces the shell root with native
  DSH session and Workspace file tabs. The file tab browses the authenticated
  Space/Node/Resource tree, creates items in permitted folders, renames and
  trashes nodes, and exposes a capability-gated trash view with restore and
  permanent removal. Univer Resources open in the embedded Viewer; Blob
  Resources use the native DSH Sidecar for read-only image, video, audio, PDF, and
  text previews, while unsupported media remains download-only. Blob editing
  is intentionally outside this plugin surface.
- **Native Sidecar preview**: file and Worktree opens update one Workspace preview
  tab in the current session's native right sidebar. DSH owns tab closing,
  resizing, splitting and fullscreen; Workspace renders the content inside it.
  With no selected session, the native flow reuses or creates a blank session
  in a connected Space. Other native tab types remain available.
- **Capability HTTP routes**: `/api/uwh/me`, `/api/uwh/template-fork`, Space
  rename, the same-origin Space/Node tree, and trash actions are registered by
  this plugin. The Workspace Agent only supplies the authenticated
  `workspaceAuth` service they consume.
- **Bundled skill**: `univer` teaches the model the Space/document
  model and the Worktree review rules.
- **Conversation change summaries**: turn cards list the documents touched by
  that Turn. Clicking a row opens its Worktree in Sidecar and locates the document;
  conversation cards do not mount document runtimes or offer preview accordions.
- **Floating task list**: one compact session list shows each Worktree's status
  and counts of added, modified and deleted documents. Rows open Sidecar. The
  list is portaled to the document and can be dragged across the entire viewport,
  independently of conversation and Sidecar layout.

## Not yet delivered (tracked as follow-up stages)

- The remaining Office-only gateway/file capabilities that do not have a
  Workspace product equivalent yet.

## Document creation and review

For agent tasks, create an empty draft with `univer_worktree` (`action: "create"`,
no `resourceId`), then create a document with `univer_unit` (`action: "create"`)
or import one with `univer_import`. New Units stay in the Worktree until merge
activates their reserved Resource and Node identities in the target Space.
Existing documents enter a new Worktree by passing their `resourceId` to
`univer_worktree`. Verify the content, mark the draft ready, and let the user
review it before merge.

`univer_new` and `univer_create` create documents directly in trunk and are for
explicit requests to publish immediately. Worktree changes support new, modified, and deleted documents. Use
`univer_unit` with `action: "remove"` to mark a document for deletion and
`action: "restore"` to undo that intent while the Worktree is a draft.
Merging moves existing documents to Trash and cancels unpublished new Units.
Discarding a Worktree leaves existing documents unchanged.

## dsh-univer-office tool audit

The office plugin operates local `.univer` files, while this plugin operates
remote Workspace Resources. The shared operations are deliberately mapped to
the remote contract rather than accepting a local file path that the server
cannot authorize:

| dsh-univer-office                                          | Workspace plugin                                                       | Boundary                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `univer_new`                                               | `univer_new` / `univer_create`                                         | Resource creation is a Workspace API operation; the result is opened to resolve `unitId`.                                                  |
| `univer_unit`                                              | `univer_unit` (`create`, `remove`, `restore`)                                        | Create draft Units or update their deletion intent through the Workspace product API; merge approval remains a separate Worktree action. |
| `univer_status`                                            | `univer_status` + `univer_spaces`, `univer_documents`, `univer_open`   | Status returns the selected trunk Resource or Worktree Unit/file-state; Space, Node and Unit identity remain separate remote resources.    |
| `univer_execute`                                           | `univer_execute` (or `univer_edit` `mode=write`)                       | Writes are Worktree-scoped and commit a collaboration changeset; exactly one inline `code`/safe session `codeFile` is accepted.            |
| `univer_inspect`                                           | `univer_inspect`                                                       | Uses the public content-inspection SDK over the same headless collaboration runtime; range selectors are validated before execution.       |
| `univer_worktree`                                          | `univer_worktree`                                                      | Lifecycle and approval semantics are aligned.                                                                                              |
| `univer_import` / `univer_export`                          | same names                                                             | Local exchange SDK conversion; import creates a Worktree-local Unit and export reads trunk/draft UnitData into a session-relative output.  |
| `univer_api`                                               | `univer_api` (`find`/`show`)                                           | Pinned local CLI SDK reference; read-only and independent of Workspace ACL.                                                                |
| `univer_resources`                                         | `univer_resources` (`registries`/`find`/`read`/`export`/`clear-cache`) | Pinned local visual-resource library; cache/export are session-relative. This is not a product Resource listing.                           |
| `univer_screenshot` / `univer_lint` / `univer_compile_svg` | —                                                                      | No deployable remote render contract is available yet; these remain explicit follow-up work, not silently faked tools.                     |

## Architecture boundary

- No separate gateway process: the browser-facing API is registered on the
  DSH web server (`/univer-workspace/api/**`), and the host side calls the
  Workspace service directly with the User's workspace session credential
  obtained from the harness `workspaceAuth` service.

## Non-responsibilities

- Authentication and credential storage (`workspaceAuth` belongs to
  `@univerjs/workspace-agent`).
- Workspace product APIs, Unit data model, or collaboration contracts
  (owned by the Workspace application and the Univer SDKs).
- Publication: this is a private workspace package consumed by the harness
  profile build, never published to npm.

## Build

`pnpm build` emits `lib/index.js` (node host bundle), `lib/client.js` (browser
bundle), and the linked `lib/client.css` stylesheet; bundled skills ship under
`skills/`. The WebServer plugin serves the stylesheet and contributes its
`<link>` to the DSH boot page, so client code does not create runtime style
tags.

Native/binary addons are deliberately not bundled into either the host or the
worker. The plugin depends on the wrapper packages that own them, so each
binding arrives as a transitive production dependency:

- `@univerjs-pro/engine-formula-rust` owns
  `@univerjs-pro/engine-formula-rust-binding`, the headless formula engine;
- `@univerjs-pro/exchange-node` owns `@univerjs-pro/exchange-node-binding` for
  Office import/export.

Depending on the wrappers keeps every binding at the version its owner
publishes instead of pinning a second copy here that drifts from the SDK
baseline. DSH initializes every profile with pnpm's `nodeLinker: hoisted`, so
the profile installs those transitive bindings into one flat `node_modules`;
the bundles load a binding through the wrapper's `createRequire`, which
resolves from the plugin directory up to that flat profile root.
`supportedArchitectures: current` keeps the install to the container's platform
binary.

Account-level Workspace Agent sessions use the connected account's personal Space as
the default destination. Sessions opened in a selected Space keep that Space
as their default. Explicit targets still require Workspace server permission;
unrelated local DSH directories are not automatically linked.

### Worktree list loading

The Worktree sidebar loads one page of summaries per request, defaults to pending
Worktrees, and loads further pages with **Load more**. Search and lifecycle filters
run on the Workspace server; selecting a row loads that Worktree's Unit details.
The Team and personal groups describe the loaded rows, not global totals.
Conversation cards continue resolving their known Worktree IDs independently.
This sidebar requires a Workspace server supporting `scope=all`, `search`, and
`order=createdAtDesc` on `GET /api/worktrees`; update the server before the plugin.

### Historical Worktree review

Merged Worktrees open the Base-to-draft comparison by default. Draft, ready, and
discarded Worktrees open the read-only resulting draft document; choose Changes
to inspect the comparison. New Worktree-local Units have an empty Base, including those
in discarded Worktrees. Switch between structured changes and the resulting full
version. Ready Worktrees also offer the evaluated merge preview; merged Units can
show their recorded merge revision. A Unit without a recorded merge revision reports
that limitation instead of showing the current trunk as a historical result.
Canceled creations are omitted and deleted Units remain individual review records.

Fixed-Base and recorded-result modes require the matching Workspace Server comparison
endpoint. Older servers can still display the equivalent empty-Base comparison for
new Worktree-local Units. Their merge previews also work when the server evaluator
confirms a Worktree-created Unit and its returned snapshot matches the exact ready
revision. Other unsupported historical modes report that the server
needs updating; they never silently fall back to current trunk or draft.
