# Space plugin for official DeepSeek Harness

Space-style content navigation, writable collaborative Univer Docs/Sheets,
formal Slides/Canvas/Relational Table viewers and the shared Workspace HTML Viewer for Pages, and the
native DSH Conversation in a floating overlay. DSH owns Session history, composer, model,
Agent and tool logs. Official host source is unchanged.

## Build / install

Use Node >=24.9.0 and this application's isolated npm graph:

```sh
pnpm --filter @univerjs/univer-workspace-agent-runtime build
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
   A persistent 52px Activity Bar selects Chat, Space and native global panels.
   Chat has the native Session list; Space supplies the public `sidebar.workspaces`
   content with the Space heading. The top secondary button collapses it; the selected Activity entry
   restores it. Plugins/Automation have no Session list or unused secondary track.
   This controlled DOM/CSS integration is gated to official Web release
   `0.2.1-rc.3` / commit `be72761` and tested native structure. Unknown builds keep
   native navigation and show an explicit unsupported state. Host controls,
   width preference and Sessions stay Host-owned; uninstall removes the adapter.
2. Open Space settings at the navigation bottom, set an HTTP(S) origin and
   sign in. Credentials remain only in Host memory. Local HTTP is allowed;
   remote connections require HTTPS.
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
   Workspace cookies stay in Host memory: SDK HTTP uses the existing owner Connection;
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

Space Share manages actual Team membership. File Share distinguishes Team inheritance from Personal direct/ancestor grants and formal link access. Viewer/Editor (and Team Admin) are the existing Server roles; optional creation invites activate membership immediately. Favorites and subpages remain unavailable. Trash/Restore, Rename and same-Space folder moves are available through shared row, right-click and file-identity menus. Space supports Create/Open/Rename; Space Move/Trash/Restore need a separate lifecycle extension and are not implemented. Disabled controls explain feature availability separately from Server permissions. Suggested has
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
content, returns revision/hash and bounded text/cell/structured-Unit/HTML-source lines, and exposes
`nextOffset` for paging. The discovery/read operations remain bounded and Session-scoped; draft inspection uses the existing headless inspection runtime. They do not promise the complete old plugin interface. The plugin also registers `univer_edit` and `univer_worktree` for actual isolated draft changes through the shared original Headless Facade runtime. Agent tools cannot merge. The document shows Editing with AI / Changes ready, then Review compares the shared content captured at review with the exact proposed SDK merge candidate. Apply requires the displayed Server review token and rechecks revisions/ACL atomically; Reject/Cancel discard the draft. Docs and Sheets share this workflow. No write goes directly to trunk. Removing the current-document association does not erase a durable message or
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
1.1.0. The build also reads the existing Fork license source without printing it.
Run build/install from this repository, preserving those source directories.

Run `node scripts/check-human-collaboration-live.mjs` and
`node scripts/check-sharing-live.mjs` with two independently configured DSH Hosts,
each authenticated as a different Workspace test user. Supply `SPACE_SECOND_DSH_LOG`
and `SPACE_SECOND_LOGIN_FILE` in addition to the Host/browser/evidence variables.
These scripts cover comments, identities, permissions, grants and sharing.
Keep credentials outside the repository and generated evidence.

`check-coediting-live.mjs` performs real native Agent editing, current-document Review/Apply/Reject, two-user synchronization and reopen checks for Docs and Sheets, concurrent human edits, cancel/switch races and Viewer/revoked-member denial. It requires two independent owner Hosts and both private fixture-login files; those files and Host logs never enter the evidence package. Browser evidence identifies the official DSH Web carrier and does not certify the Electron window.
