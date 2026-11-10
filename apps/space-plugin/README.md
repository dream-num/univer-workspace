# Space plugin for official DeepSeek Harness

Space is a proof-of-concept plugin for Univer Workspace. It runs inside official DeepSeek Harness (DSH), connects to a Workspace service, and lets you browse your files, edit Univer Docs and Sheets, and chat with an AI alongside an open document.

This preview targets DSH 0.2.2-rc.1. It is an optional way to use Workspace inside DSH, not a replacement for the separate Workspace Agent Desktop application. Use non-critical documents while evaluating it.

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
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-reference-provider build
cd apps/space-plugin
npm ci --no-audit --no-fund
npm run build
npm test
npm run typecheck
npm run package:release -- /absolute/output/outside/repository
```

Install the resulting tarball with the official DSH Plugins manager. Coupled
Univer dependencies are pinned to 1.4.0; React 18 is resolved by the official
host module loader. Tailwind utilities are prefixed/scoped with preflight off.
The packager copies the production closure from committed `package-lock.json`;
it never resolves fresh transitive versions. Manifest/version changes require a
matching package-lock update. Desktop packages include the repository's existing
Workspace application license in Host-only `lib/runtime-license.json`, together with the matching Exchange verification key. Packaging
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
   `0.2.2-rc.1` / commit `c59d10a` and tested native structure. Unknown builds keep
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
   `.univer.html` Blobs, using the Fork's shared formal sandbox and binding engine. It supports scripts, authenticated Sheet bindings, inspection, and save-before-leave with resume after a failed connection change. License uses the Fork's existing source through official SDK initialization. Docs/Sheets Comments use the formal presets and remote datasource; the document toolbar opens the native panel. Docs supports selection anchors, replies, Resolve/Reopen and retained discussions when original text is removed. History remains unaccepted.
5. Floating chat provides compact-message, expanded and minimized states. Move
   its grip, resize either side, restore it, create a Host Conversation or choose
   an existing one from History. It is one DSH composer/transcript, with DSH-owned
   messages, model, running state and tools. It never reserves editor width.
6. Opening any of the six supported content types or a Markdown Blob visibly associates its stable identity with the selected
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

Markdown `.md` / `.markdown` Blobs open with the shared read-only Markdown Viewer's
Preview / Source controls. Both modes use the complete validated UTF-8 source,
including original line endings; opening does not convert a Blob into a Doc.
The file header reuses Workspace Browser's **Download** action for Blobs. It uses
the Server's original-byte download and original filename (including UTF-8 BOM),
not the decoded Preview/Source text. Every click rechecks the current account,
Node/Resource identity and Server download permission; cached previews grant no
download after access is revoked.
The shared classifier also supports Markdown MIME types and historical
`application/octet-stream` uploads with Markdown filenames. Binary, invalid UTF-8,
partial and denied reads fail visibly. Markdown remains outside Create / New.

Pages load the complete HTML source without Space's former 1 MiB cutoff; partial
responses are rejected. The optional HTML source cache retains at most 16 entries
and 16 MiB of UTF-8 source. This is a cache budget, not an opening limit. Every
open still checks the current Node/Resource ACL before any cached bytes are used.
The formal HTML sandbox, scripts, Sheet bindings and departure save/resume
protocol are unchanged.

Live Docs focus is scoped to the active Space owner, document association and
editor mount generation. Selection updates within that mount are ordered, and
retirement prevents delayed updates from restoring a closed editor. Captured
message targets and pending selection suggestions have separate lifetimes;
switching Conversation in the same document does not retire a pending suggestion.
A step consuming queued messages with different targets has no implicit focus.

**Known limitation on official DSH 0.2.2-rc.1:** native Conversation focus is still
captured from Host state after inbox insertion, rather than at the send gesture.
A selection update still in transit can therefore leave an earlier target in that
message's snapshot. Generation ordering and the native sending phase do not close
this window. Exact native send binding requires a supported per-attempt snapshot/admission API from DSH;
composer blocks and pre-step hooks do not provide it. This is a known POC risk: ordinary chat may act on an earlier document or selection. Check the target and the result when trying AI edits. The separate **Ask for change** control captures its SDK selection at
activation and retains the existing target, content, permission and revision checks.
Its model request separates the selected text from read-only surrounding paragraph
text. The model returns a complete local fragment tied to that selection request.
The Host verifies the exact unchanged prefix and suffix before extracting the
replacement at those declared boundaries; it never searches for similar text or
repairs a response. Legacy, mismatched, ambiguous, context-changing or incomplete
responses fail without projecting a new candidate. Review remains the user's
check on the proposed wording.

Docs selection tools require unique IDs compatible with the SDK's public
`PARAGRAPH_ID_PREFIX`. Capture validates
IDs before the SDK resolves paragraph offsets. A capture error clears the old
selection target, aborts an outstanding proposal and shows a diagnostic while
native editing/saving remain available. A later valid selection recovers the
selection controls. This guard does not generate or persist missing IDs, repair
the source document or establish why its IDs were invalid. Newly inserted
paragraphs in a selection replacement use the SDK's public `createParagraphId`
factory; unchanged source paragraph identities are retained by the SDK diff.

Current protocol and real Server regression (use an isolated local Server with the exact OAuth callback registered):

```sh
SPACE_TEST_LOGIN_FILE=/path/to/private-fixture-login.json \
SPACE_EVIDENCE_DIR=/path/to/evidence/outside/source \
node test/live/auth/check-oauth-api-live.mjs
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
and run `node test/live/editor/check-editor-assembly-live.mjs`. It observes the real
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
default destination. `univer_compile_markdown` uses the shared Client Core compiler and
materializer to create an editable Modern Doc in an explicitly supplied draft
Worktree. It does not publish or merge. Save the returned `sourceMap`; use
`univer_export_markdown` with that map and selected `blockIds` to read current
native content, export image sidecars, and refresh the map before a block update.
All source, asset and output paths stay inside the native Session workspace.
These tools preserve the compiler's draft contract; ordinary edits of existing
files still use trunk. Inspection reads current Server
content, returns revision/hash and bounded text/cell/structured-Unit/HTML-source lines, and exposes
`nextOffset` for paging. The discovery/read operations remain bounded and Session-scoped; draft inspection uses the existing headless inspection runtime. They do not yet provide the complete old plugin interface. Ordinary `univer_edit` calls select the document admitted with the native request, or an explicitly identified authorized Unit, and commit Facade mutations to trunk through the original collaboration runtime. An explicitly created Worktree retains the existing Docs/Sheets draft and Review workflow. Review reads the current comparison; Apply uses the existing Workspace merge workflow with current Server permissions. Reject/Cancel discard the draft. The preview is not version-bound to Apply: concurrent edits can change the merge result or cause a conflict. Removing the current-document association does not erase a durable message or
revoke historical read grants; change identity/disconnect to clear grants.

DSH Tools is a type-only development dependency. Four public JSON Schema
registrations match the previous defineTool builder output exactly. Installing
another Tools service package in the profile can split its module-local scheduler
Symbol from the bundled Agent loop. The package regression test prevents that
runtime dependency from returning. No DSH source or installed SDK is patched.

Shell icons use Lucide React 0.468.0; the ISC/Feather notice is retained in
`THIRD_PARTY_NOTICES.txt` and included in the package.

Additional read-only UI check: `node test/live/editor/check-readonly-live.mjs` with the
same Host/browser/MVP-fixture variables, after connecting Workspace. It verifies
that Base create controls are disabled and a Slides insertion is rejected by
the SDK permission guard. Source snapshots remain unchanged.

`node test/live/navigation/check-navigation-lifecycle-live.mjs` also requires
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
selected/hover states. `test/live/navigation/check-navigation-theme-live.mjs` changes themes through
actual native Settings controls and restores the previous preference; it captures
both Chat and Space in light/dark. No document bodies are injected into ordinary
prompts. Structured Unit inspection is bounded JSON data returned by a Tool, not a
full editor or write capability. Schemas/names stay unchanged; the inspect
description now documents these added read formats in the checked contract fixture.

The taxonomy in `src/content-types.ts` owns every UI name and creation entry.
`node test/live/editor/check-crud-live.mjs` covers all eight object types against the Server,
including content/identity after restore and unauthorized-write rejection.
`node test/live/editor/check-html-live.mjs` covers Page scripts, Sheet binding reads/writes,
persisted reopen, inspection and resume after a rejected connection change.

The formal HTML Viewer is a build-time `file:` dependency on the Fork's existing
`packages/workspace-html-viewer`; `.npmrc` materializes its sources with isolated
consumer peers, rather than linking a second SDK/React graph. Browser JSX uses
automatic transformation for that shared component. All coupled SDKs stay at
1.4.0. Desktop packaging carries the Fork's existing development license through
the Host-only runtime configuration. A nonempty UNIVER_LICENSE overrides it;
an ordinary Desktop launch needs no environment-variable setup. The license's
existing scope and expiry still apply; the SDK remains responsible for validation.
Run build/install from this repository, preserving those source directories.

Run `node test/live/collaboration/check-human-collaboration-live.mjs` and
`node test/live/collaboration/check-sharing-live.mjs` with two independently configured DSH Hosts,
each authenticated as a different Workspace test user. Supply `SPACE_SECOND_DSH_LOG`
and `SPACE_SECOND_LOGIN_FILE` in addition to the Host/browser/evidence variables.
These scripts cover comments, identities, permissions, grants and sharing.
Keep credentials outside the repository and generated evidence.


## Release candidate

This package is a proof-of-concept preview for evaluation, not a production release.
The target Host version is official DSH 0.2.2-rc.1.
The navigation adapter recognizes the published Web build 0.2.2-rc.1 / c59d10a.
Desktop 0.2.2-rc.1 installation and native return-flow acceptance remain pending.

In Plugins, choose Add plugin and paste the generated tarball's path into Package name or address, then install and cold-restart DSH. For updates, remove the existing dsh-space-plugin bundle first, install the new exact tarball and cold-restart; verify the checksum first. Uninstall by removing dsh-space-plugin in Plugins and restarting. Workspace documents remain on the Server; native conversation history stays DSH-owned. Hot reinstall can encounter official Host module-identity diagnostics, so it is not the supported update procedure. The package contains no second DSH runtime or local Workspace Server.

On a fresh profile pnpm blocks the transitive protobufjs@7.6.6 postinstall until explicitly approved. In the official installer, verify that this is the listed package and choose Allow these scripts and retry. This is the normal dependency trust step, not a peer-warning failure. The exact published postinstall reads dependency metadata and prints a version-scheme warning; it downloads no executable. Do not globally enable all dependency scripts.

Desktop test packages include the repository's existing Workspace application
license in Host-only `lib/runtime-license.json`, so a normal Desktop launch does
not need terminal environment variables. A nonempty UNIVER_LICENSE can override
the packaged value. The existing authenticated owner-only runtime config route
supplies it to the official LicensePlugin; it is not saved in client preferences
or included in Agent context. Packaging does not extend its scope or expiry.

The Server must run the matching release commit (including the Review/Apply fixes), as one writer process against persistent product SQLite, collaboration SQLite and Blob storage. Back up those stores together. Stop the old writer before upgrading; never reset the database. Remote services require HTTPS/WSS, the registered public OAuth client `univer-workspace-harness` with consent and `identity session` scopes, and reverse-proxy support for /api, /universer-api and collaboration WebSocket upgrade. The plugin expects a service origin, not an API path. Multi-Unit SDK merges are per-Unit, not a cross-Unit transaction; Space's current-document Agent edit targets one Doc or Sheet.

First use: select Space and choose Sign in to Univer. Sign in and authorize in the system browser; successful authorization loads Space Home. DSH Settings → Workspace manages the current account and server, Switch Account, Sign Out and Custom Workspace URL. Session reuse uses the official Host credential provider's isolated `dsh-space-plugin/workspace` grant record. Only that record is changed; DSH model credentials and native Sessions remain owned by DSH. A denied, cancelled or expired request can be retried. Switching accounts uses the browser's Workspace account; sign out or choose the desired account there before authorizing.

The existing cloud registration accepts the exact loopback return `http://127.0.0.1:3101/auth/oauth/callback`. The plugin binds only IPv4 loopback for the pending authorization and closes it on completion, cancellation or timeout. Keep that port free; a conflicting listener produces a retryable sign-in error, never a fallback credential form. Custom Server administrators must register the same exact callback. The authenticated public DSH Connection starts/cancels requests; the loopback listener accepts only bounded, state-matched OAuth callbacks. Native Desktop external-browser forwarding and the return link require separate acceptance on 0.2.2-rc.1. An OS/browser confirmation may appear for the return link. No `univer-workspace://` scheme or DSH account grant is used.

Reproduce the demo with a disposable Team Space and two accounts: create a Folder and all six content types; rename/move/trash/restore a file; edit Docs/Sheets from both clients; share with the second account and add a comment. Associate a Doc with the native conversation, ask the Agent to append a unique paragraph to a private Worktree and mark it ready, inspect Review, explicitly Apply, and verify the already-open second client and a reopen. Repeat with a Sheet formula, Reject, and a shared edit after Review; verify the SDK merge/conflict behavior and persisted result. Viewer / removed-member writes must fail. No test fixture, model credential or private Session archive is included.

The release script stages only runtime files, a production-only manifest, notices and npm-shrinkwrap.json. npm consumers honor that lock; DSH's pnpm manager owns its profile lock and needs registry access. Preserve the profile lock for exact reinstall. Run the release scan and actual clean-profile install before distributing a new artifact.

## DSH declaration dependencies

The exact development-only `dsh-client-ui-dockkit`, `dsh-util-file-drag` and
`@shikijs/langs` entries satisfy imports in the published DSH 0.2.2-rc.1 type
declarations. Upstream lists those edges only as development dependencies.
They are not added to the installed plugin's production runtime. Remove these
consumer entries after a published DSH metadata repair and a clean typecheck
confirm that they resolve through the owning packages.

## SDK and lock updates

After aligning this isolated application's exact SDK dependencies, regenerate
`package-lock.json` with npm, then run `npm run lock:runtime`. The latter derives
`runtime-lock.json` from the audited production closure used by the packager.
Build the shared Runtime, Client Core and reference provider before `npm ci`,
so copied local build dependencies include their current artifacts.

## Plugin-owned menu positioning

Space dropdowns and content-list right-click menus use one body portal and the
public `@floating-ui/dom` positioning API. Actual menu dimensions determine
flip/shift and scrollable size within the owning Space shell and visual viewport.
The portal retains scoped shell utilities and inherited theme tokens; listeners
exist only while a menu is open. Native DSH, Univer and formal File Tree menus
keep their existing implementations. File actions and Server capability checks
remain in the shared `FileActions` component.

Run `node test/browser/check-floating-menu-regression.mjs` with
`SPACE_PLAYWRIGHT_MODULE`, optional `SPACE_BROWSER_EXECUTABLE` and
`SPACE_EVIDENCE_DIR` to exercise actual React components in an isolated browser
fixture: corners, resize, ancestor scroll, long menus, theme switching, CSS and
visual viewport scaling, outside-click and keyboard behavior. This fixture does
not certify the original reported scene or Electron Desktop. The existing
`test/browser/check-create-menu-regression.mjs` checks the eight-entry creation workflow.

`node test/browser/check-navigation-menu-regression.mjs` uses the same browser/evidence
environment to check the actual Navigation nested scroll container. Placement
continues to use the shell boundary; hidden-reference detection uses the
reference's clipping ancestors. A partly clipped trigger keeps its menu; a fully
clipped trigger dismisses it. The check also verifies multiline Create labels in
a 190px shell without fixed-height text overflow.

## Editor language

The five collaborative Univer editors and AI Changes previews follow the current DSH interface language (English or Simplified Chinese). Language switches update the SDK locale in place; they do not recreate the Unit or add a separate preference. Other Host locales use their declared fallback chain, then English.
