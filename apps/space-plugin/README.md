# Space for DeepSeek Harness Desktop

An independent content workspace inside the official DSH application. Browse real
Workspace Spaces and Folders, read frozen Documents and Sheets with Univer's UI,
and explicitly add selected content to an existing native DSH conversation.
There is no plugin chat system or Agent runtime, and no modification to DSH.

## Build and package

Node >=24.9.0, npm, and the repository's existing Workspace Server environment are
required. This application has an isolated npm dependency graph. Do not add it to
the repository pnpm graph: DSH uses React 18 and the Workspace Browser uses React
19. The browser bundle uses the host's published React and ReactDOM singletons.
UI SDKs are build dependencies; only collaboration/materialization dependencies
are installed into the plugin's Host profile.

```sh
cd apps/space-plugin
npm ci
npm run build
npm test
npm run typecheck
npm pack --pack-destination /tmp
```

All coupled Univer packages are pinned to 1.1.0. `skipLibCheck` is not enabled.

## Install in official Desktop

1. Download and launch the official DSH application.
2. Open **Plugins** and install the generated tarball using its absolute local path.
   The manager may require approval for the `protobufjs@7.6.6` package build.
3. Fully quit and reopen Desktop after installing or updating the plugin.
4. Desktop owns its plugin profile; use the official Desktop manager.

For a separate test home, launch the application executable with `DSH_HOME` set
to an isolated directory. Desktop owns its `profiles/desktop` plugin profile.

## Run the Workspace Server

Use the repository's normal Server setup from `apps/workspace/README.md`.
Preserve the existing database and Blob storage locations when restarting:

```sh
cd apps/workspace
PORT=3020 DATABASE_FILE=/path/to/workspace/product.sqlite \
COLLABORATION_DATABASE_FILE=/path/to/workspace/collab.sqlite \
BLOB_DIRECTORY=/path/to/workspace/blobs \
node --import tsx server/src/main.ts
```

Never run `db:reset` to start or upgrade a database. The plugin directly calls
existing Workspace HTTP APIs; this change does not alter the Server contract.

`npm run seed:product` creates a new local test account, a Folder named 产品发布,
and genuine persisted Document / Sheet resources. It never deletes existing
content. The demo is authored acceptance data, not production content or mocked
UI. Credentials are written mode 0600 to `/tmp/task005-workspace-login.json`;
`SPACE_TEST_ENDPOINT` and `SPACE_TEST_LOGIN_FILE` override the local target/file.
The script refuses remote hosts.

## Product workflow

- Open an existing DSH conversation, then select **Space**. Its identity is fixed
  for this Space visit. Independently entering Space allows explicit selection of
  an existing conversation; the plugin never creates one.
- Open **Settings** in the content navigation to set a Workspace origin and sign
  in. Password authentication is supported. Credentials stay in Host memory;
  restart/uninstall requires signing in again.
- Overview combines server Spaces with recent content. Open a Space, browse a
  Folder, or open a recent file. Name/type filtering explicitly covers the loaded
  page only. There is no fabricated global All/search/recommendation endpoint.
- Documents and Sheets use version-matched core Univer UI presets. They are
  disconnected, read-only snapshots. Advanced embedded objects and full
  collaboration are not promised. Close returns to the source list; changing
  files does not change the linked native Session or an earlier Context.
- **Use AI → Select this file** freezes the current text/cell projection. This is
  separate from merely opening a file. **Add to original draft** preserves the
  existing native draft by appending readable context, then opens that same
  conversation with a native right-sidebar document tab.
- Send using DSH's native composer. Selected, added-to-draft, and submitted are
  distinct. Submitted is displayed only after the matching full snapshot and
  unique marker appear in a durable native `user/message` event. It does not
  claim the Agent read it. Context is capped at 64,000 characters and is never
  silently truncated.
- **Back to Space** restores content/navigation state during the plugin lifetime.
  If native side-by-side opening fails, Reduced Experience is displayed and the
  Space visit remains available. No second chat UI is substituted.

Disable and uninstall through **Plugins**. Registrations, reads, observers and
Univer instances belong to the plugin lifecycle; native Session history remains
in DSH. Removing a local Context does not delete an already-created native draft
or a durable message; those are managed in the original conversation.

## Validation

`npm test` covers connection/credential lifetime and frozen context contracts.
Use `npm run test:live` against an isolated Workspace Server and
`npm run test:host` against a running official Desktop Host.
Keep fixture credentials and generated evidence outside the repository.

Browser checks do not establish native Desktop support. Agent writes, merge,
manual editing, OAuth-only login, cross-restart layout persistence, large files
and offline writes are outside this version's supported scope.
