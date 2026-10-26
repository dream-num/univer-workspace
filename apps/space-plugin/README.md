# Space plugin for official DeepSeek Harness

Space-style content navigation, genuine read-only Univer Docs/Sheets, and the
native DSH Conversation on the right. DSH owns Session history, composer, model,
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
2. Open Workspace settings at the navigation bottom, set an HTTP(S) origin and
   sign in. Credentials remain only in Host memory. Local HTTP is allowed;
   remote connections require HTTPS.
3. Browse Spaces/Folder or recent content. All aggregates ACL-checked Space/Folder metadata (up to 2,000 items);
   Your items filters owner access and Recents uses the real recent-resource API. Suggested/Favorites/direct-shared discovery do not yet
   have corresponding data integrations. Their missing state is displayed.
4. Open a Document or Sheet. The published Univer UI preset renders it read only.
   Close/back restores its source list. Navigation uses one sidebar; no extra
   sibling-file panel or internal Page tabs are inferred from video chrome.
5. Work with AI opens the native Conversation beside the Page. Pick an existing
   conversation if needed; a compact selector can change that association.
6. Select this file, then associate to Conversation. The original native draft
   receives a short stable `workspace-file://` reference and request to use
   `univer_inspect`. No document text, cell JSON or snapshot is injected.
7. Enter a question and send in the native composer. Reference submission and
   actual tool use are distinct. Native Tool Call/Tool Result records are proof
   of reading; an ordinary chat answer alone is not.

The read tools are `univer_spaces`, `univer_documents`, `univer_open`, and
`univer_inspect`. They use Session-scoped association routing and current Host
Workspace login; the real Server rechecks ACLs. Inspection reads current Server
content, returns revision/hash and bounded line/cell entries, and exposes
`nextOffset` for paging. These are deliberately read-only subsets; they do not
promise the complete old plugin's Facade/Worktree interface. No write/merge tool
is registered. Removing local selection does not erase a durable message or
revoke a previously associated file; change identity/disconnect to clear grants.
