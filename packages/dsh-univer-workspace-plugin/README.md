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
- **Import/export**: `univer_import` and `univer_export` convert between
  Office files in the session workspace and remote Units through the
  Workspace exchange endpoints.
- **Browser Space picker**: the blank-session hero shows the User's Spaces
  and picks a Space's backing dsh workspace.
- **Bundled skill**: `univer-workspace` teaches the model the Space/document
  model and the Worktree review rules.

## Not yet delivered (tracked as follow-up stages)

- The turn-preview cards and floating viewer (stage 8), and
  screenshot/layout-lint rendering (stage 9).

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
