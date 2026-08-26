# @univerjs/univer-workspace-harness

Univer Workspace Harness is the DSH (DeepSeek Harness) based agent service for
Univer Workspace. It is assembled from published `@deepseek-ai/*` packages and
shipped as three DSH bundles that a dsh profile loads:

- `@univerjs/univer-workspace-harness` (this package) — the service core:
  OAuth authorization-code login against the Workspace authorization
  endpoints (`session` scope), the per-User workspace session credential
  store exposed through the `workspaceAuth` cordis service, identity and
  session-guard routes, and the workspace origin settings namespace.
- `dsh-univer-workspace-plugin` — the Univer capability plugin: space ↔
  dsh-workspace reconciliation and the agent toolset operating remote
  Workspace Units.
- `dsh-univer-workspace-skin-plugin` — the browser skin aligning the DSH UI
  with the Workspace brand.

## Responsibilities

- Authenticate harness users through the Workspace OAuth flow; the harness
  itself holds no permissions and every Workspace call runs as the
  authorizing User.
- Provide `workspaceAuth` to sibling plugins: effective workspace origin and
  per-User authenticated HTTP clients.
- Own the composition patch that mounts the three bundles and the deployment
  webserver/connection rows.

## Non-responsibilities

- DSH session persistence and attachment storage specialization (a
  deployment provides its own provider; Internal DSH ships the S3 one).
- Workspace product APIs, the Unit data model, or collaboration contracts —
  those stay in the Workspace application and the Univer SDKs.
- Any publication contract: this is a private workspace package, installed
  into a dsh profile from the repository build, never from the npm registry.

## Build

`pnpm build` emits `lib/index.js` (node host bundle) and `lib/client.js`
(browser bundle). The dsh profile assembly lives in this package's
`scripts/` and `cordis.patch.yml`.
