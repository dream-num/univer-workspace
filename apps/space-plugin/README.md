# Space plugin for official DeepSeek Harness

Space-style content navigation, genuine read-only Univer Docs/Sheets/Slides/Boards/Bases and sandbox HTML previews, and the
native DSH Conversation in a floating overlay. DSH owns Session history, composer, model,
Agent and tool logs. Official host source is unchanged.

## Build / install

Use Node >=24.9.0 and this application's isolated npm graph:

```sh
npm ci
npm run build
npm test
npm run typecheck
npm pack --pack-destination /tmp
```

Install the resulting tarball with the official DSH Plugins manager. Coupled
Univer dependencies are pinned to 1.1.0; React 18 is resolved by the official
host module loader. Tailwind utilities are prefixed/scoped with preflight off.
Build-time PostCSS confines SDK global reset blocks and unprefixed utilities to
the editor and Univer namespace portal roots; published SDK files stay intact.

## Use

1. Open an existing native DSH Conversation and select the Space global entry.
   Space immediately supplies navigation through the public `sidebar.workspaces`
   region Slot. DSH retains its outer column, width, collapse controls and original
   Chat navigation. Back to Chat restores that registration without a drawer.
2. Open Workspace settings at the navigation bottom, set an HTTP(S) origin and
   sign in. Credentials remain only in Host memory. Local HTTP is allowed;
   remote connections require HTTPS.
3. All / Your items lists real ACL-checked metadata. Pinned is a separate local
   navigation and Suggested section; it does not imply Favorites. Space opens
   Overview / Content; Folder opens its own breadcrumb and content list.
4. Docs uses a detached Modern layout projection with one body title; the top
   file menu remains. Docs/Sheets/Slides/Boards/Bases all use published SDKs and
   read-only permissions. Pro previews show the SDK license watermark in the
   current test environment; advanced embedded objects are not bundled.
   Pages / Sites maps specifically to the Server HTML Views directory
   (`.univer.html` Blobs), with a sandboxed, script-free preview up to 1 MiB.
   Ordinary HTML files remain Files. Full HTML Sheet bindings stay in Workspace.
5. Floating chat provides compact-message, expanded and minimized states. Move
   its grip, resize either side, restore it, create a Host Conversation or choose
   an existing one from History. It is one DSH composer/transcript, with DSH-owned
   messages, model, running state and tools. It never reserves editor width.
6. Opening a Doc or Sheet visibly associates its stable identity with the selected
   native Session in `conversation.input.dock`. Remove/reassociate there. Ask
   “总结当前文档”; the native Agent receives a short runtime-context identity and
   reads current Server content through `univer_inspect`. No body or large JSON
   is inserted into ordinary user messages. Page association is frozen at native
   message admission, including queued requests; stale association responses are
   rejected. Slides/Boards/Bases/Sites previews do not yet have Agent read tools;
   opening them clears the previous current-document pointer.
7. Existing durable Workspace references remain clickable through the public
   UserText rule/keyed Slot. Clicks recheck current ACL and Node/Resource/Unit,
   open the file, preserve its native Session and show the current association.
   File switches retain each selected native Session and unsent draft. Workspace
   identity/endpoint changes clear Workspace grants/content, not DSH references.
   Close viewer returns to its source list. Reconnecting the same endpoint keeps
   authentication; an invalid/unreachable replacement keeps the existing service.

Creation, direct sharing, Favorites, Trash, subpages, moves and deletes are
unavailable in this release. Disabled controls explain feature availability separately from Server permissions. Suggested has
local pinned metadata cards, with no fabricated templates or recommendations.
The native DSH composer is taller than Space's 52px input capsule; it is kept
intact.

Run the Web checks against a local owner Host and isolated product fixture.
Use `node scripts/seed-mvp.mjs` to create nonempty test resources:

```sh
SPACE_DSH_LOG=/path/to/private-launcher.log \
SPACE_TEST_LOGIN_FILE=/path/to/private-fixture-login.json \
SPACE_EVIDENCE_DIR=/tmp/space-ui-evidence \
SPACE_MVP_FIXTURES=/path/to/private-fixtures.json \
SPACE_SESSION_ROOT=/path/to/actual-host/sessions \
SPACE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
SPACE_BROWSER_EXECUTABLE=/path/to/browser \
node scripts/check-recovery-live.mjs
```

The recovery check exercises settings, connection failures, six viewers and
current-document questions in an existing native Conversation.
`node scripts/check-context-races-live.mjs` checks superseded associations,
Composer preservation, floating geometry, references and disabled menus.

For the original Workspace Browser's minimum assembly check, serve it with its
own Vite config against the same Server, set `SPACE_WORKSPACE_BROWSER_ORIGIN`,
and run `node scripts/check-editor-assembly-live.mjs`. It observes the real
collaboration WebSocket and current History version, performs no edits, and
compares persisted Snapshot hashes. This does not certify Comments writes,
multi-user editing or offline persistence.

The read tools are `univer_spaces`, `univer_documents`, `univer_open`, and
`univer_inspect`. They use Session-scoped association routing and current Host
Workspace login; the real Server rechecks ACLs. Inspection reads current Server
content, returns revision/hash and bounded line/cell entries, and exposes
`nextOffset` for paging. These are deliberately read-only subsets; they do not
promise the complete old plugin's Facade/Worktree interface. No write/merge tool
is registered. Removing the current-document association does not erase a durable message or
revoke historical read grants; change identity/disconnect to clear grants.

DSH Tools is a type-only development dependency. Four public JSON Schema
registrations match the previous defineTool builder output exactly. Installing
another Tools service package in the profile can split its module-local scheduler
Symbol from the bundled Agent loop. The package regression test prevents that
runtime dependency from returning. No DSH source or installed SDK is patched.

Shell icons use Lucide React 0.468.0; the ISC/Feather notice is retained in
`THIRD_PARTY_NOTICES.txt` and included in the package.

Run `node scripts/check-layout-live.mjs` with the Host/browser/evidence environment
to inspect native sidebar width and collapse behavior.

Additional read-only UI check: `node scripts/check-readonly-live.mjs` with the
same Host/browser/MVP-fixture variables, after connecting Workspace. It verifies
that Base create controls are disabled and a Slides insertion is rejected by
the SDK permission guard. Source snapshots remain unchanged.
