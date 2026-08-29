# dsh-univer-workspace-plugin

The Univer capability plugin for DSH. It gives an agent the ability to
operate **remote Univer Workspace Units** (documents) in the Spaces the
authorizing User can access — the capability profile of `dsh-univer-office`,
reimplemented independently against the Workspace service instead of local
session files.

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
  response validation. The product currently has no remove/restore endpoint,
  so `action=create` is intentionally the only advertised action.
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
  the plugin does not invent a visible `reopen` action.
- **Browser Space picker**: this plugin owns the Workspace Space picker and
  injects it into the stock DSH hero/sidebar slots. DSH still owns its native
  mechanical workspace list and session persistence; selecting a Space only
  chooses the linked DSH workspace for the next session.
- **Bundled skill**: `univer-workspace` teaches the model the Space/document
  model and the Worktree review rules.
- **Turn preview and live viewer**: successful document/Worktree operations are
  folded into one replay-safe turn card; while a session is running, a live
  collaboration editor floats in the input dock, and it is removed when the
  session completes while the historical review card remains.
- **Unit-level history folding**: repeated references to the same remote Unit
  (including `resourceId`/`unitId`/Worktree aliases across Turns) keep only the
  latest embedded viewer; older Turns retain a collapsed review card.

## Not yet delivered (tracked as follow-up stages)

- Screenshot/layout-lint/render-machine tooling (no deployable remote render
  contract yet), and the remaining
  Office-only gateway/file capabilities that do not have a Workspace product
  equivalent yet.

## dsh-univer-office tool audit

The office plugin operates local `.univer` files, while this plugin operates
remote Workspace Resources. The shared operations are deliberately mapped to
the remote contract rather than accepting a local file path that the server
cannot authorize:

| dsh-univer-office | Workspace plugin | Boundary |
| --- | --- | --- |
| `univer_new` | `univer_new` / `univer_create` | Resource creation is a Workspace API operation; the result is opened to resolve `unitId`. |
| `univer_unit` | `univer_unit` (`action=create`) | Worktree-local Unit creation is backed by `POST /api/worktrees/{id}/units`; remove/restore is not exposed by the current product contract. |
| `univer_status` | `univer_status` + `univer_spaces`, `univer_documents`, `univer_open` | Status returns the selected trunk Resource or Worktree Unit/file-state; Space, Node and Unit identity remain separate remote resources. |
| `univer_execute` | `univer_execute` (or `univer_edit` `mode=write`) | Writes are Worktree-scoped and commit a collaboration changeset; exactly one inline `code`/safe session `codeFile` is accepted. |
| `univer_inspect` | `univer_inspect` | Uses the public content-inspection SDK over the same headless collaboration runtime; range selectors are validated before execution. |
| `univer_worktree` | `univer_worktree` | Lifecycle and approval semantics are aligned. |
| `univer_import` / `univer_export` | same names | Local exchange SDK conversion; import creates a Worktree-local Unit and export reads trunk/draft UnitData into a session-relative output. |
| `univer_api` | `univer_api` (`find`/`show`) | Pinned local CLI SDK reference; read-only and independent of Workspace ACL. |
| `univer_resources` | `univer_resources` (`registries`/`find`/`read`/`export`/`clear-cache`) | Pinned local visual-resource library; cache/export are session-relative. This is not a product Resource listing. |
| `univer_screenshot` / `univer_lint` / `univer_compile_svg` | — | No deployable remote render contract is available yet; these remain explicit follow-up work, not silently faked tools. |

## Architecture boundary

- No separate gateway process: the browser-facing API is registered on the
  DSH web server (`/univer-workspace/api/**`), and the host side calls the
  Workspace service directly with the User's workspace session credential
  obtained from the harness `workspaceAuth` service.

## Non-responsibilities

- Authentication and credential storage (`workspaceAuth` /
  `workspaceSession` belong to `@univerjs/univer-workspace-harness`).
- Workspace product APIs, Unit data model, or collaboration contracts
  (owned by the Workspace application and the Univer SDKs).
- Publication: this is a private workspace package consumed by the harness
  profile build, never published to npm.

## Build

`pnpm build` emits `lib/index.js` (node host bundle) and `lib/client.js`
(browser bundle); bundled skills ship under `skills/`.

Native/binary addons are deliberately not bundled into either the host or
worker. Every binary used by this plugin is an explicit production dependency
and is externalized by the build:

- `@univerjs-pro/engine-formula-rust-binding` for the headless formula engine;
- `@univerjs-pro/exchange-node-binding` for Office import/export.

The consuming Harness image installs these packages once while assembling the
profile. pnpm's `supportedArchitectures: current` policy selects only the
container's platform binary, so runtime resolution is deterministic and does
not depend on a transitive hoist or a bundled `.node` file.
