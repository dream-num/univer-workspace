# Space plugin for official DeepSeek Harness

Space-style content navigation, writable collaborative Univer Docs/Sheets,
formal Slides/Canvas/Relational Table viewers and the shared Workspace HTML Viewer for Pages, and the
native DSH Conversation in a floating overlay. DSH owns Session history, composer, model,
Agent and tool logs. Official host source is unchanged.

## Build / install

Use Node >=24.9.0, pnpm 11 and this application's isolated npm graph. From the
repository root, build the shared runtime and reference provider before installing
the plugin's local build dependencies:

```sh
pnpm --filter '@univerjs/univer-workspace-agent-runtime...' --filter '@univerjs/univer-workspace-client-core...' --filter '@univerjs/univer-workspace-reference-provider...' install --frozen-lockfile
pnpm --filter @univerjs/univer-workspace-agent-runtime build
pnpm --filter @univerjs/univer-workspace-reference-provider build
cd apps/space-plugin
npm ci --no-audit --no-fund
npm run build
npm test
npm run typecheck
npm run package:release -- /absolute/output/outside/repository
```

Install the resulting tarball with the official DSH Plugins manager. Coupled
Univer dependencies are pinned to 1.1.0; React 18 is resolved by the official
host module loader. Tailwind utilities are prefixed/scoped with preflight off.
The packager copies the production closure from committed `package-lock.json`;
it never resolves fresh transitive versions. Manifest/version changes require a
matching package-lock update. Desktop packages include the repository's existing
Workspace application license in Host-only `lib/runtime-license.json`. Packaging
and resource scans fail if it is missing or differs from the current source.
No license value is written to build logs or committed generated files.
Build-time PostCSS confines SDK global reset blocks and unprefixed utilities to
the editor and Univer namespace portal roots; published SDK files stay intact.

Each push to `feat/space-full-univer-integration` also builds a **Space Plugin**
workflow artifact. Download and extract it from the successful GitHub Actions run.
It contains `space-plugin-<version>-<short-sha>.tgz`, `SHA256SUMS` and
`build-info.json`; Actions retains it for 30 days. Verify the download from the
extracted directory with `shasum -a 256 -c SHA256SUMS` on macOS or
`sha256sum -c SHA256SUMS` on Linux. Then install the tarball in the official DSH
Plugins manager as described under [Release candidate](#release-candidate).
These workflow artifacts are builds for review, not GitHub Releases or npm publications.

## Use

1. Open an existing native DSH Conversation and select the Space global entry.
   A persistent 52px Activity Bar selects Chat, Space and native global panels.
   Chat has the native Session list; Space supplies the public `sidebar.workspaces`
   content with the Space heading. The top secondary button collapses it; the selected Activity entry
   restores it. Plugins/Automation have no Session list or unused secondary track.
   This controlled DOM/CSS integration is gated to official Web release
   `0.2.1-rc.3` / commit `be72761` and tested native structure. Unknown builds keep
   native navigation without applying this adapter. Host controls,
   width preference and Sessions stay Host-owned; uninstall removes the adapter.
2. Select **Sign in to Univer**. The default service is `https://space.univer.ai/`;
   the system browser completes the existing Workspace authorization and the plugin
   exchanges its one-use code with PKCE. DSH Settings → Workspace owns account,
   Switch Account, Sign Out and Custom Workspace URL. The Host credential provider
   persists only the plugin's own grant; the client receives no cookie or token.
3. All / Your items lists real ACL-checked metadata. Pinned is a separate local
   navigation and Suggested section; it does not imply Favorites. Space opens
   Overview / Content; Folder opens its own breadcrumb and content list.
4. Docs and Sheets use the formal published Core presets, Collaboration Client,
   browser collaboration UI and Facade Server loaders. Toolbars, selection/context
   menus and collaborative Undo/Redo stay SDK-owned. SDK changesets save remotely;
   other clients receive edits over the real Server WebSocket. File switches drain
   pending changes before disposal; failed flush leaves the current editor open.
   While disconnected, new content edits pause until reconnection. Reliable offline
   writing is not enabled. The SDK's queued-online-change recovery remains enabled.
   Workspace cookies stay Host-only; an isolated grant is persisted by the official credential provider: SDK HTTP uses the existing owner Connection;
   WebSocket connects directly to Workspace using its one-time session ticket.
   Slides/Canvas/Relational Table keep detached previews. Pages maps specifically to Server
   `.univer.html` Blobs, using the Fork's shared formal sandbox and binding engine (up to 1 MiB source). It supports scripts, authenticated Sheet bindings, inspection, and save-before-leave with resume after a failed connection change. License uses the Fork's existing source through official SDK initialization. Docs/Sheets Comments use the formal presets and remote datasource; the document toolbar opens the native panel. Docs supports selection anchors, replies, Resolve/Reopen and retained discussions when original text is removed. History remains unaccepted.
5. Floating chat provides compact-message, expanded and minimized states. Move
   its grip, resize either side, restore it, create a Host Conversation or choose
   an existing one from History. It is one DSH composer/transcript, with DSH-owned
   messages, model, running state and tools. It never reserves editor width.
6. Opening any of the six supported file types visibly associates its stable identity with the selected
   native Session in `conversation.input.dock`. Remove/reassociate there. Ask
   “总结当前文档”; the native Agent receives a short runtime-context identity and
   reads current Server content through `univer_inspect` (Docs text, Sheets cells,
   Slides/Canvas/Relational Table structured SDK Unit data, Pages HTML source). No body or large JSON
   is inserted into ordinary user messages. Page association is frozen at native
   message admission, including queued requests; stale association responses are
   rejected.
7. Existing durable Workspace references remain clickable through the public
   UserText rule/keyed Slot. Clicks recheck current ACL and Node/Resource/Unit,
   open the file, preserve its native Session and show the current association.
   File switches retain each selected native Session and unsent draft. Workspace
   identity/endpoint changes clear Workspace grants/content, not DSH references.
   Close viewer returns to its source list. Reconnecting the same endpoint keeps
   authentication; an invalid/unreachable replacement keeps the existing service.

Create / New keeps all eight entries: Doc, Sheet, Slide, Canvas, Relational Table, Page, Folder, Space. All uses the Personal Space; Space / Folder uses the current directory. All six content types open automatically after Server persistence. Folder stays in its parent and Space navigates to the new Space. Restricted destinations retain disabled entries with permission feedback. Node rename/move and Trash/restore reuse the Browser product workflows; file identity and the native Session stay stable.

Space Share manages actual Team membership. File Share distinguishes Team inheritance from Personal direct/ancestor grants and formal link access. Viewer/Editor (and Team Admin) are the existing Server roles; optional creation invites activate membership immediately. Favorites remains unavailable. Pinned Pages show actual Page/Subpage ancestry from Workspace Node metadata; hover controls reuse the existing file actions and Page creation workflow. Group collapse and Page disclosure are kept in the live navigation store across Chat / Space switches; pins and expansion preferences are still session-local. Trash/Restore, Rename and same-Space folder moves are available through shared row, right-click and file-identity menus. Space supports Create/Open/Rename; Space Move/Trash/Restore need a separate lifecycle extension and are not implemented. Disabled controls explain feature availability separately from Server permissions. Suggested has
local pinned metadata cards, with no fabricated templates or recommendations.
The native DSH composer is taller than Space's 52px input capsule; it is kept
intact.

Current protocol and real Server regression (use an isolated local Server with the exact OAuth callback registered):

```sh
SPACE_TEST_LOGIN_FILE=/path/to/private-fixture-login.json \
SPACE_EVIDENCE_DIR=/path/to/evidence/outside/source \
node scripts/check-oauth-api-live.mjs
```

The protocol check covers consent, code exchange, PKCE, callback, identity,
eight creation kinds and six file lifecycle paths. CRUD, collaboration, sharing
and human-collaboration Web scripts use `authorizeWorkspace` through the same
OAuth flow. Run native Desktop checks separately.

Docs, Sheets, Slides, Canvas and Relational Table now use shared Browser preset
sources, including their existing collaboration and feature plugins. The Base
formula Worker is packaged and served through the owner Connection.

For the original Workspace Browser's minimum assembly check, serve it with its
own Vite config against the same Server, set `SPACE_WORKSPACE_BROWSER_ORIGIN`,
and run `node scripts/check-editor-assembly-live.mjs`. It observes the real
collaboration WebSocket and current History version, performs no edits, and
compares persisted Snapshot hashes. This does not certify Comments writes,
multi-user editing or offline persistence.

The Workspace read tools are `univer_spaces`, `univer_documents`, `univer_list`,
`univer_open`, and `univer_inspect`. Directory discovery uses the original
recursive Workspace implementation and filters, defaulting to the Space captured
when the native request was admitted. A native Session can open an authorized
Node, Resource or Unit without a current file; inspection uses its Session
association. The Server rechecks access. `univer_api` reuses the original version-matched
Facade reference lookup without needing document access. `univer_new` and
`univer_create` reuse the original Resource creation path for all five Univer
Unit types. `univer_workspace` uses the existing Workspace operations for Space,
Folder and Page creation, rename, move and restore. The admitted Folder is the
default destination. Inspection reads current Server
content, returns revision/hash and bounded text/cell/structured-Unit/HTML-source lines, and exposes
`nextOffset` for paging. The discovery/read operations remain bounded and Session-scoped; draft inspection uses the existing headless inspection runtime. They do not yet provide the complete old plugin interface. Ordinary `univer_edit` calls select the document admitted with the native request, or an explicitly identified authorized Unit, and commit Facade mutations to trunk through the original collaboration runtime. An explicitly created Worktree retains the existing Docs/Sheets draft and Review workflow. Apply requires the displayed Server review token and rechecks revisions/ACL atomically; Reject/Cancel discard the draft. Removing the current-document association does not erase a durable message or
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

Run `node scripts/check-navigation-live.mjs` to exercise Chat/Space/Plugins/Automation,
narrow navigation, six file types and a Tool read in the existing Session.
`node scripts/check-navigation-lifecycle-live.mjs` also requires
`SPACE_PLUGIN_TARBALL=/absolute/path/to/exact-built-package.tgz` and removes and
reinstalls that bundle through the official manager. Preserve any Host diagnostics.

Use `SPACE_LIFECYCLE_REMOVE_ONLY=1` with the lifecycle script to verify actual
uninstall restoration alone. This deliberately leaves the bundle uninstalled;
reinstall the exact tarball through the manager afterwards.

On macOS, the native Host drag marker is applied to existing secondary/file
header rows. Chat leaves the existing top row blank except for the sidebar
control; Space keeps its Space heading. No extra chrome row, white strip or top
padding is added. The Host excludes interactive controls from drag geometry.

The shell uses Host theme tokens for surfaces, text, muted labels, borders and
selected/hover states. `check-navigation-theme-live.mjs` changes themes through
actual native Settings controls and restores the previous preference; it captures
both Chat and Space in light/dark. `check-all-context-live.mjs` exercises all six
file identities, remove/reassociate and new formal Tool reads in the existing
Session. No document bodies are injected into ordinary prompts. Structured Unit
inspection is bounded JSON data returned by a Tool, not a full editor or write
capability. Schemas/names stay unchanged; the inspect description now documents
these added read formats in the checked contract fixture.

The taxonomy in `src/content-types.ts` owns every UI name and creation entry.
`node scripts/check-crud-live.mjs` covers all eight object types against the Server,
including content/identity after restore and unauthorized-write rejection.
`node scripts/check-html-live.mjs` covers Page scripts, Sheet binding reads/writes,
persisted reopen, inspection and resume after a rejected connection change.

The formal HTML Viewer is a build-time `file:` dependency on the Fork's existing
`packages/workspace-html-viewer`; `.npmrc` materializes its sources with isolated
consumer peers, rather than linking a second SDK/React graph. Browser JSX uses
automatic transformation for that shared component. All coupled SDKs stay at
1.1.0. Desktop packaging carries the Fork's existing development license through
the Host-only runtime configuration. A nonempty UNIVER_LICENSE overrides it;
an ordinary Desktop launch needs no environment-variable setup. The license's
existing scope and expiry still apply; the SDK remains responsible for validation.
Run build/install from this repository, preserving those source directories.

Run `node scripts/check-human-collaboration-live.mjs` and
`node scripts/check-sharing-live.mjs` with two independently configured DSH Hosts,
each authenticated as a different Workspace test user. Supply `SPACE_SECOND_DSH_LOG`
and `SPACE_SECOND_LOGIN_FILE` in addition to the Host/browser/evidence variables.
These scripts cover comments, identities, permissions, grants and sharing.
Keep credentials outside the repository and generated evidence.

`check-coediting-live.mjs` performs real native Agent editing, current-document Review/Apply/Reject, two-user synchronization and reopen checks for Docs and Sheets, concurrent human edits, cancel/switch races and Viewer/revoked-member denial. It requires two independent owner Hosts and both private fixture-login files; those files and Host logs never enter the evidence package. Browser evidence identifies the official DSH Web carrier and does not certify the Electron window.

## Release candidate

This package is a release candidate and is not certified for Public Preview.
The target platform is official DSH Desktop 0.2.1-rc.3 on macOS arm64 (macOS 13+).
The compatible official Web build is 0.2.1-rc.3 / be72761.

In Plugins, choose Add plugin and paste the generated tarball's path into Package name or address, then install and cold-restart DSH. For updates, remove the existing dsh-space-plugin bundle first, install the new exact tarball and cold-restart; verify the checksum first. Uninstall by removing dsh-space-plugin in Plugins and restarting. Workspace documents remain on the Server; native conversation history stays DSH-owned. Hot reinstall can encounter official Host module-identity diagnostics, so it is not the supported update procedure. The package contains no second DSH runtime or local Workspace Server.

On a fresh profile pnpm blocks the transitive protobufjs@7.6.6 postinstall until explicitly approved. In the official installer, verify that this is the listed package and choose Allow these scripts and retry. This is the normal dependency trust step, not a peer-warning failure. The exact published postinstall reads dependency metadata and prints a version-scheme warning; it downloads no executable. Do not globally enable all dependency scripts.

Desktop test packages include the repository's existing Workspace application
license in Host-only `lib/runtime-license.json`, so a normal Desktop launch does
not need terminal environment variables. A nonempty UNIVER_LICENSE can override
the packaged value. The existing authenticated owner-only runtime config route
supplies it to the official LicensePlugin; it is not saved in client preferences
or included in Agent context. Packaging does not extend its scope or expiry.

The Server must run the matching release commit (including the Review/Apply fixes), as one writer process against persistent product SQLite, collaboration SQLite and Blob storage. Back up those stores together. Stop the old writer before upgrading; never reset the database. Remote services require HTTPS/WSS, the registered public OAuth client `univer-workspace-harness` with consent and `identity session` scopes, and reverse-proxy support for /api, /universer-api and collaboration WebSocket upgrade. The plugin expects a service origin, not an API path. Outstanding Review tokens expire after 30 minutes and require fresh Review after a Server restart. Multi-Unit SDK merges are per-Unit, not a cross-Unit transaction; Space's current-document Agent edit targets one Doc or Sheet.

First use: select Space and choose Sign in to Univer. Sign in and authorize in the system browser; successful authorization loads Space Home. DSH Settings → Workspace manages the current account and server, Switch Account, Sign Out and Custom Workspace URL. Session reuse uses the official Host credential provider's isolated `dsh-space-plugin/workspace` grant record. Only that record is changed; DSH model credentials and native Sessions remain owned by DSH. A denied, cancelled or expired request can be retried. Switching accounts uses the browser's Workspace account; sign out or choose the desired account there before authorizing.

The existing cloud registration accepts the exact loopback return `http://127.0.0.1:3101/auth/oauth/callback`. The plugin binds only IPv4 loopback for the pending authorization and closes it on completion, cancellation or timeout. Keep that port free; a conflicting listener produces a retryable sign-in error, never a fallback credential form. Custom Server administrators must register the same exact callback. The authenticated public DSH Connection starts/cancels requests; the loopback listener accepts only bounded, state-matched OAuth callbacks. Official Desktop 0.2.1-rc.3 forwards external HTTP(S) window opens to the system browser; its installed `dsh://open` handler focuses the app without carrying any credential. An OS/browser confirmation may appear for the return link. No `univer-workspace://` scheme or DSH account grant is used.

Reproduce the demo with a disposable Team Space and two accounts: create a Folder and all six content types; rename/move/trash/restore a file; edit Docs/Sheets from both clients; share with the second account and add a comment. Associate a Doc with the native conversation, ask the Agent to append a unique paragraph to a private Worktree and mark it ready, inspect Review, explicitly Apply, and verify the already-open second client and a reopen. Repeat with a Sheet formula, then with Reject and a shared edit after Review (the old Apply must conflict). Viewer / removed-member writes must fail. No test fixture, model credential or private Session archive is included.

The release script stages only runtime files, a production-only manifest, notices and npm-shrinkwrap.json. npm consumers honor that lock; DSH's pnpm manager owns its profile lock and needs registry access. Preserve the profile lock for exact reinstall. Run the release scan and actual clean-profile install before distributing a new artifact.
