# dsh-univer-workspace-plugin

The Univer capability plugin for DSH. It gives an agent the ability to
operate **remote Univer Workspace Units** (documents) in the Spaces the
authorizing User can access — the capability profile of `dsh-univer-office`,
reimplemented independently against the Workspace service instead of local
session files.

Capability alignment with `dsh-univer-office`, on the remote Unit model:

- discovery: list the User's Spaces and the Units inside them;
- authoring: create Units through the Workspace product API, read Unit
  state, edit content through a headless collaboration runtime in Worktree
  scope;
- review: Worktree ready/merge/discard lifecycle with mandatory user
  approval on merge and discard;
- exchange: Office import/export through the Workspace exchange endpoints;
- visual inspection: screenshots and layout lint from a local render
  runtime (no separate network service);
- skills: bundled SKILL.md guidance for the Univer editors and the
  Worktree review flow.

## Architecture boundary

- No separate gateway process: the browser-facing API is registered on the
  DSH web server (`/univer-workspace/api/**` JSON state and
  `/univer-workspace/collab/**` collaboration proxy), and the host side
  calls the Workspace service directly with the User's workspace session
  credential obtained from the harness `workspaceAuth` service.
- Selecting a workspace in DSH selects one of the User's accessible
  Workspace Spaces; the backing dsh workspace directory is an invisible
  mechanical detail.

## Non-responsibilities

- Authentication and credential storage (`workspaceAuth` belongs to
  `@univerjs/univer-workspace-harness`).
- Workspace product APIs, Unit data model, or collaboration contracts
  (owned by the Workspace application and the Univer SDKs).
- Publication: this is a private workspace package consumed by the harness
  profile build, never published to npm.

## Build

`pnpm build` emits `lib/index.js` (node host bundle) and `lib/client.js`
(browser bundle); bundled skills ship under `skills/`.
