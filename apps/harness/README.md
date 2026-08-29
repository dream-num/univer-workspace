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

## Model credentials

DSH model settings and credentials are profile-global (they are not tied to a
Workspace OAuth user). Production deployments should inject `DEEPSEEK_API_KEY`
or another provider credential through the deployment secret and leave the
Models settings surface disabled. Local/single-user profiles can set
`UWH_MODEL_SETTINGS_ENABLED=true` (or run without `NODE_ENV=production`) to
restore the stock DSH Models page; model namespaces and credential calls are
then allowed through the harness RPC boundary. The credential provider keeps a
file-backed value in `$DSH_HOME/.credentials.yaml`, while an inherited
environment variable always wins and is read-only. An isolated `DSH_HOME` does
not inherit a key from the developer's `~/.dsh`; this is intentional and keeps
the test profile independent.

## Build

`pnpm build` emits `lib/index.js` (node host bundle) and `lib/client.js`
(browser bundle). The dsh profile assembly lives in this package's
`scripts/` and `cordis.patch.yml`.

Native addons used by the capability plugin remain external runtime
dependencies. The Harness image installs the platform-specific packages once
while assembling the profile; the runtime container only copies that assembled
profile and does not download or compile binaries during startup.
