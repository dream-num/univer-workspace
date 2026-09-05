# @univerjs/univer-workspace-harness

Univer Workspace Harness is a local DSH (DeepSeek Harness) Web client for one
local or remote Univer Workspace connection. It is assembled from published
`@deepseek-ai/*` packages and shipped as three DSH bundles that a local dsh
profile loads:

- `@univerjs/univer-workspace-harness` (this package) — the service core:
  local-only Workspace Device Authorization, one process-wide remote
  connection exposed through the `workspaceAuth` cordis service, the
  Workspace origin settings namespace, and the supervisor that restarts DSH
  into an origin-and-user-specific data directory.
- `dsh-univer-workspace-plugin` — the Univer capability plugin: space ↔
  dsh-workspace reconciliation and the agent toolset operating remote
  Workspace Units.
- `dsh-univer-workspace-skin-plugin` — the browser skin aligning the DSH UI
  with the Workspace brand.

## Responsibilities

- Obtain one remote Workspace session through Device Authorization. The local
  Harness has no users or permissions of its own; every local browser uses the
  same current connection and Workspace remains authoritative for remote ACLs.
- Provide `workspaceAuth` to sibling plugins: effective Workspace origin,
  authenticated HTTP client, and current remote identity.
- Supervise the DSH child process so an origin/account change is applied by a
  full child restart without asking the user to rerun the launch command.
- Keep Workspace capability routes, Viewer UI, template actions, and Space
  behavior in the consuming plugins; this package only composes them.
- Own the composition patch that mounts the three bundles and the deployment
  webserver/connection rows.

## Runtime architecture

The Harness keeps the local DSH process separate from the remote Workspace
service. Workspace remains the authority for identity, permissions, Spaces,
Nodes, Resources, and collaboration data.

```mermaid
flowchart LR
  Browser[Local browser] -->|HTTP and WebSocket| DSH[DSH child process]
  Supervisor[start-local supervisor] -->|Start and restart| DSH
  DSH --> Core[Harness core plugin]
  DSH --> Capability[Workspace capability plugin]
  DSH --> Skin[Workspace skin plugin]
  Core -->|Device Authorization and session cookie| Workspace[Remote or local Workspace]
  Capability -->|HTTP and collaboration requests| Workspace
  Browser -->|Workspace origin and device code| Core
```

The core plugin owns connection and identity lifecycle. The capability plugin
owns Workspace tools and file/document interactions. The skin plugin only owns
branding and visual tokens. The supervisor watches the active connection and
restarts the DSH child when the Workspace origin, account, or session changes.

## Local data and storage

The quick start keeps installation and runtime data outside the repository.

| Location | Contents | Isolation |
| --- | --- | --- |
| `UWH_DSH_BOOTSTRAP` | Isolated installation of the published DSH CLI | Shared by the local installation |
| `DSH_HOME` | Profile metadata and packaged plugin bundles | Shared by the local installation |
| `UWH_DSH_DATA_HOME` | `connection.json`, identity-specific DSH runtimes, and local session/attachment data | Runtime data is separated by Workspace origin and user id |
| `UWH_SHARED_CREDENTIALS_PATH` | DSH model credentials and browser-session signing state; defaults to `$UWH_DSH_DATA_HOME/shared/.credentials.yaml` | Shared across identities; never contains Workspace session cookies |

The active connection file contains the Workspace origin, a non-secret user
identity, and the server-side session credential required by the local DSH
runtime. Treat the file as sensitive local state. Do not commit it, upload it,
or include its values in bug reports. Workspace product data, collaboration
snapshots, and Blob bytes remain in the connected Workspace deployment; the
Harness does not copy those databases into its local data directory.

## Non-responsibilities

- DSH session persistence and attachment storage specialization (a
  deployment provides its own provider; Internal DSH ships the S3 one).
- Workspace product APIs, the Unit data model, or collaboration contracts —
  those stay in the Workspace application and the Univer SDKs.
- Any publication contract: this is a private workspace package, installed
  into a dsh profile from the repository build, never from the npm registry.

## Model credentials

DSH model settings and credentials are local-machine state; they are not tied
to a Workspace user. For a local profile, run without `NODE_ENV=production` or
set `UWH_MODEL_SETTINGS_ENABLED=true`, then configure the stock DSH Models page.
You can instead export `DEEPSEEK_API_KEY` or another provider credential before
starting the supervisor; an inherited environment value wins and is read-only.
The file-backed credential provider uses the supervisor's shared credentials
path, so identity-specific DSH runtimes reuse the same model configuration.
Workspace Session Cookies stay in the separate connection state and are never
written to model settings.

## Build

`pnpm build` emits `lib/index.js` (node host bundle), `lib/identity.js`, and
`lib/client.js` (browser bundle). The capability plugin emits its own
`lib/client.css`; profile assembly lives in this package's `scripts/` and
`cordis.patch.yml`.

Native addons used by the capability plugin remain external runtime
dependencies. The Harness image installs the platform-specific packages once
while assembling the profile; the runtime container only copies that assembled
profile and does not download or compile binaries during startup.

## Local Web client quick start

Use Node.js 24 or newer and the pnpm version declared in the root
`package.json` (currently 11.24.0). Start from a clone of this repository and
install its dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

The checked-in `.npmrc` selects the registry for the pinned Univer SDK release.
The installation also needs access to the public npm registry for DSH packages.

The Harness is a local Web page, not a desktop application. The DSH CLI must be
installed outside this pnpm workspace so its React 18 dependency tree does not
enter the Univer React 19 graph. From the repository root, prepare one isolated
local installation:

```bash
export UWH_LOCAL_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/univer-workspace-harness"
export UWH_DSH_BOOTSTRAP="$UWH_LOCAL_ROOT/dsh-cli"
export DSH_HOME="$UWH_LOCAL_ROOT/install"
export UWH_DSH_DATA_HOME="$UWH_LOCAL_ROOT/data"
mkdir -p "$UWH_DSH_BOOTSTRAP" "$DSH_HOME/internal-packages"

npm install --prefix "$UWH_DSH_BOOTSTRAP" --save-exact \
  @deepseek-ai/dsh@0.1.2-alpha.4
export DSH_BIN="$UWH_DSH_BOOTSTRAP/node_modules/@deepseek-ai/dsh/lib/bin.js"

pnpm --filter @univerjs/univer-workspace-harness build
pnpm --filter dsh-univer-workspace-plugin build
pnpm --filter dsh-univer-workspace-skin-plugin build
pnpm --filter @univerjs/univer-workspace-harness pack \
  --pack-destination "$DSH_HOME/internal-packages"
pnpm --filter dsh-univer-workspace-plugin pack \
  --pack-destination "$DSH_HOME/internal-packages"
pnpm --filter dsh-univer-workspace-skin-plugin pack \
  --pack-destination "$DSH_HOME/internal-packages"

export DSH_PLUGINS="file:$DSH_HOME/internal-packages/univerjs-univer-workspace-harness-0.1.0.tgz file:$DSH_HOME/internal-packages/dsh-univer-workspace-plugin-0.1.0.tgz file:$DSH_HOME/internal-packages/dsh-univer-workspace-skin-plugin-0.1.0.tgz"
NPM_CONFIG_USERCONFIG="$PWD/.npmrc" ./apps/harness/scripts/build-profile.sh
node apps/harness/scripts/start-local.mjs --port 3101 \
  --no-open --trusted-host 127.0.0.1
```

Keep `start-local.mjs` running: it is the supervisor, not a one-shot command.
The first profile start can take several seconds while DSH loads the profile;
wait until stderr prints a line beginning with `dsh web:`. Open that exact
authenticated URL, which contains a one-time `?token=...` query, in the
browser. DSH responds with a redirect to `/` and sets an HttpOnly browser
session cookie. Do not copy the token into a bug report or reuse it after the
exchange. The bare `http://127.0.0.1:3101` may be rejected before this
exchange because no DSH browser session cookie exists yet; after the cookie is
stored, the clean root URL works. If port `3101` is occupied, choose another
explicit port and use the matching printed URL.

If an agent is starting the Harness for a human, pass the complete `dsh web:`
URL to the human exactly as printed and ask them to open it in their browser.
Do not replace it with the bare root URL, remove the query string, put the token
in another message field, or attempt to complete the browser exchange through
an API client. The token is intended for the user's browser and is consumed
once; after the user opens it, the browser can use the clean root URL.

In Settings → Workspace, set the service origin (for the shared test environment use
`https://workspace.univer.plus`; a local Workspace URL works as well). The first
login uses Workspace Device
Authorization: click “Sign in to Workspace”, open the verification page, sign in or
register a test account on Workspace, approve the code, then return to Harness
and click “I completed authorization” once. Harness automatically polls the authorization
until Workspace approves it, then stores only the resulting session cookie
server-side; it never asks the Harness page for a Workspace password. If the
authorization expires, start a new login request instead of reusing the old code.

After login, the left sidebar exposes the implemented **Sessions / Files / Worktree**
tabs. Session navigation keeps the native DSH behavior, Workspace file
management browses the connected Space/Node/Resource tree, and Worktree lists
origin-level personal/team tasks with open/all/closed filtering. Open or create
a file independently of conversations. Opening a file inserts its Viewer in the
center while the right side remains the same native DSH conversation; it does
not create a second conversation, composer, or fixed conversation tab. In the
native composer, type `@` to choose one or more Workspace Resources for the
current message; each reference is checked against the connected Workspace when
the message is sent.
Saving a different Workspace origin changes the
target for the next Device Authorization; it does not silently replace the
currently active identity. Complete authorization for the new origin/account,
or explicitly disconnect, then wait while the supervisor stops the old DSH
child and starts the new identity runtime with the same launch arguments. The
page reconnects automatically; do not stop the supervisor or rerun the command.
Never record passwords or `workspace_session` values in bug reports; record only
the origin and a non-secret account identifier.

### First end-to-end check

Once the page reconnects with the authorized Workspace identity:

1. Open **Sessions** in the left sidebar and select **New session**. Type a message in
   the native composer on the right. Sending to a model also requires a local
   DSH model credential; Workspace login only authorizes Workspace data.
2. Open **Files**, select a Personal or Team Space, then use **New** to create
   a folder or Univer document. The same menu accepts file uploads; supported
   Office files are imported as Univer Resources.
3. Select a Univer Resource in the tree. Its full-height Viewer opens in the
   middle, while the current native DSH conversation stays on the right. Going
   back to **Sessions** changes only the left navigation and must not close the
   Viewer.
4. Use a file row's action menu for the capabilities granted by Workspace,
   such as rename, move, share, copy link, or move to trash. The menu is
   capability-aware; a shared read-only Resource intentionally exposes fewer
   actions.
5. Open **Worktree** to find personal or team tasks. The default view shows
   open tasks; choose **All** to include closed tasks or **Closed only** to show
   only closed tasks, then select a task to open its Changes review surface.
6. In a native conversation message, type `@`, choose **Browse Workspace** when
   the file is not in the recent suggestions, navigate Space → folder → file,
   and repeat to add multiple Resources before sending. The resulting message
   carries stable Resource identities; opening a file alone does not silently
   add it to the message context.
7. To test another Workspace service or identity, return to **Settings →
   Workspace** and save or authorize the new connection. The supervisor
   restarts only the DSH child into the matching identity-specific data
   directory, so the new identity receives its own conversation and file
   state.

## Connect to a local Workspace

The Harness accepts any Workspace HTTP origin. To run the Workspace application
from this repository, use a second terminal and follow the Workspace application
guide:

```bash
cp apps/workspace/.env.example apps/workspace/.env
pnpm workspace:dev:server
```

The local Workspace server listens on `http://127.0.0.1:3020` by default. If you
also need the Browser application, run `pnpm workspace:dev:web` and open
`http://127.0.0.1:5173`. In the Harness Settings page, set the Workspace origin
to `http://127.0.0.1:3020` and complete Device Authorization through the local
Workspace sign-in flow. The Harness does not create Workspace users or bypass
Workspace authentication.

## Troubleshooting

- **The bare local URL returns HTTP 401:** open the authenticated URL printed by
  DSH once. After the browser stores the DSH session cookie, the root URL works.
- **The page says that the connection is waiting for a restart:** keep
  `start-local.mjs` running. It supervises the DSH child and applies origin or
  identity changes automatically.
- **Workspace login succeeds but model messages fail:** Workspace Device
  Authorization only grants Workspace data access. Configure a local DSH model
  credential separately.
- **The device code expires:** start a new authorization request. Device codes
  are single-use and are not persisted in the browser.
- **The Viewer is unavailable:** confirm that the connected account can read the
  Resource and that the profile was rebuilt after changing plugin source.
- **A second user sees the previous user's sessions:** stop the supervisor,
  remove only the test data directory selected by `UWH_DSH_DATA_HOME`, and start
  again. Never delete a shared Workspace product database to reset a Harness test.

Do not put passwords, Workspace session cookies, device codes, or model API keys
in bug reports. Record the Workspace origin, local Harness port, profile name,
and a non-secret account identifier instead.

This is the currently implemented first-version path. Formal Recent/Shared
file surfaces and the final two-identity new-user acceptance matrix remain tracked in
the repository's local development notes
and must not be presented as available until their UI and browser acceptance
are complete.
