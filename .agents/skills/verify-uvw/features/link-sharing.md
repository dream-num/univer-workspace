# Link sharing

A file's owner turns Link Sharing on or off from the browser `Share` dialog or with `uvw share`. With the
link set to `viewer`, anyone who opens the file URL without signing in sees the file read-only. With it
`off`, only people with access to the repository can open it, and an anonymous visitor gets a not-found
page, unless the Space is public. Both surfaces show the same state. A reader who is not the owner can
**Remix** the file into their own Personal Space, and a shared link unfurls with a title and preview image.

## Sub-features

- LS1 shows a file's link and its Link Sharing state with `uvw share <node>`.
- LS2 asks for a `viewer` link with `uvw share --link viewer`, which the server refuses with a confirm link. The owner
  confirms it in the browser, and an anonymous visitor opens the file read-only.
- LS3 sets the link to `off`, and the anonymous visitor gets a 404 page.
- LS4 shows the CLI-set state in the browser `Share` dialog, turns sharing on there, and reads it back through
  uvw and an anonymous visit.
- LS5 remixes a shared file: a signed-in reader copies it into their Personal Space, a signed-out reader signs up
  from `Remix this file` and gets the copy afterwards, and the owner sees the copy count.
- LS6 serves link preview tags (`og:*`, `twitter:*`) for a shared file from the built server.
- LS7 makes a Space public, which opens its files to anonymous readers even with the file link `off`.

## How to get to it (user POV)

- Browser: open a file, then click `Share` in its header. The dialog `Share “<name>”` has a `Link sharing`
  section with a switch, a `Link access` combobox and `Copy link`.
- CLI: `uvw share <file link or Node ID>` prints the link and its state; `--link off` turns it off. `--link viewer`
  and `--link editor` change nothing and print a confirm link, `$ORIGIN/confirm/link-sharing?node=<id>&role=<role>`.
- Confirm page: the link opens `Turn on Link Sharing for <name>?` with the consequence, `Now` and `After you confirm`,
  and the buttons `Confirm` and `Give up`.
- A signed-out reader sees `Read only`, `Sign up` and `Sign in` in the page header. Below it the visitor bar shows
  the logo (a GitHub link named `Made with Univer Workspace`), `By <name>` for a Personal Space file, the copy count
  (`1 copy`) and a `More actions` menu with `Remix` (files only), `Hand to my agent`
  ([agent handoff](./agent-handoff.md)), `Copy link` and `Report`. In immersive view (`?view=immersive`) the header
  is hidden and the bar adds the links `Sign up free` and `Sign in` and `Collapse sign-up bar`.
- A signed-in reader of someone else's Personal Space file sees the same bar without the sign-up links or collapse.
- Space visibility: the repository settings, or `uvw repo edit <owner>/<slug> --visibility private`. `--visibility
  public` prints a confirm link the same way. `$V person` runs uvw with the run user's browser session, for setup.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`, browser signed in as the baseline user (see [auth](./auth.md)).
- A Sheet `Verify Budget` with `Rent`/`1200` in A1:B1, created as in [create-document](./create-document.md).
  `N` is its Node ID: `nodes[0].nodeId` from `$V cli doc-find space find "Verify Budget" --space "verify-$VERIFY_UVW_RUN/personal" --json`.

### LS1. Show

Run `$V cli share-show share "$N" --json`. Output has `url: "$ORIGIN/nodes/$N"`,
`name: "Verify Budget"`, `link: "off"`, `owner.username: "verify-<run-id>"` and an `access` sentence:
`Only people with access to the repository can open the link. Only if the user asks, run …--link viewer…`.
Without `--json`, the second line is `Link Sharing: off.` followed by that sentence.

### LS2. Viewer link

Run `$V cli share-viewer share "$N" --link viewer --json`. It exits 1, and `share-viewer.err` starts
`INTERACTIVE_SESSION_REQUIRED:`, ends its first line with
`Give the user this link so they can confirm it in the browser: $ORIGIN/confirm/link-sharing?node=$N&role=viewer`
and carries the same link as `url` in the detail. `$V cli share-refused share "$N" --json` still reads `link: "off"`.
Open that link in the run browser: the page reads `Turn on Link Sharing for Verify Budget?` and
`Anyone with the link will be able to read Verify Budget without signing in.`, with `Now` `Off` and
`After you confirm` `Can view`. Screenshot `$EVIDENCE/share-confirm.png`, then
`agent-browser find role button click --name Confirm --exact`. The page says `Done.` Read back with
`$V cli share-confirmed share "$N" --json` (`link: "viewer"`), then
`$V open-anon share-anon-viewer "$ORIGIN/nodes/$N"`. `share-anon-viewer.node-status` reports `200`, and
`share-anon-viewer.png` shows the grid with `Rent`/`1200`, `Read only` and `Sign up`/`Sign in` in the header,
and the bar with `By Verify <run-id>` and `More actions`.

### LS3. Off

Run `$V cli share-off share "$N" --link off --json` (`link: "off"`), then
`$V open-anon share-anon-off "$ORIGIN/nodes/$N"`. `share-anon-off.node-status` reports `404`, and the page
text reads `Unable to open this resource`.

### LS4. Browser dialog

Run `agent-browser open "$ORIGIN/nodes/$N"`, `agent-browser wait canvas`, then
`agent-browser find role button click --name Share --exact`. The dialog `Share “Verify Budget”` shows
`Link access is off`, a switch `Enable link sharing` (unchecked), and a disabled `Copy link`. Run
`agent-browser find role switch click --name 'Enable link sharing'`. A `Link sharing updated.` toast shows,
the switch becomes `Disable link sharing` (checked), and `Copy link` is enabled. Screenshot
`$EVIDENCE/share-dialog-on.png`. Read back with `$V cli share-after-web share "$N" --json` (`link: "viewer"`)
and `$V open-anon share-anon-web "$ORIGIN/nodes/$N"` (`200`). Finish with
`$V cli share-cleanup share "$N" --link off --json`.

### LS5. Remix

Set the link to `viewer`. Signed in: register a second user (see
[pull requests](./pull-requests.md)), sign them in in a separate agent-browser session, open `$ORIGIN/nodes/$N`,
and pick `More actions` > `Remix` (`find role button click --name "More actions" --exact`, then
`find role menuitem click --name Remix --exact`). The browser moves to the copy's `/nodes/<id>`, the toast reads
`Copied to your space. Your edits change only your copy.`, the second user's `space find "Verify Budget"` finds
`/Verify Budget`, and `curl -s "$ORIGIN/api/nodes/$N" | jq .copyCount` is `1`. The owner's `Share` dialog shows
`1 copy`. Signed out: in a fresh session, pick `More actions` > `Remix`. The dialog `Remix this file` offers the
same MCP and uvw prompts as `Hand to my agent` and a link `Sign up free`, which opens
`/login?mode=register&returnTo=/nodes/<N>?copy=<key>`. Register there; the browser lands on a new copy and
`copyCount` is `2`.

### LS6. Link preview

Needs: web-build.

The server serves link previews from `apps/workspace/dist/public` only when it exists at
`up`. With the link `viewer`,
`curl -s "http://127.0.0.1:<server port>/nodes/$N"` returns the app shell with
`<title>Verify Budget · Univer Workspace</title>`, `og:title`, `og:description` (`Shared from Univer Workspace`;
`Accept-Language: zh-CN` gives `分享自 Univer Workspace`), `og:type`, `og:site_name`, and headers
`Vary: Accept-Language` and `Cache-Control: public, max-age=0`. Without
`PUBLIC_ORIGIN` it ends with `twitter:card` `summary`; in an MCP run (`PUBLIC_ORIGIN` is the web origin) it adds
`og:url`, `og:image` `$ORIGIN/link-preview/sheet.png` (1200×630, alt `Univer Workspace spreadsheet`),
`twitter:image` and `twitter:card` `summary_large_image`. With the link `off` there are no `og:` tags.

### LS7. Public Space

With the file link `off`, run
`$V person ls-public repo edit "verify-$VERIFY_UVW_RUN/personal" --visibility public --json` (`publicRead: true`).
`$V open-anon ls-public "$ORIGIN/nodes/$N"` reports `200`. Set it back with `--visibility private`; the same
visit reports `404`.

## Gotchas

- `space find --json` names the Node ID `nodeId`; there is no `id` field, so `jq .nodes[0].id` gives `null`
  and `uvw share null` fails with `NOT_FOUND`.
- `More actions` toggles its menu. A menu left open by an earlier failed step closes on the next click, and the
  following `find role menuitem` reports "No element found"; check `snapshot -i` for `expanded=true` first.
- The visitor dialogs close with their `Close` button (`Report this file` with `Cancel`). While one is open,
  clicks on the bar fail with "covered by <div.fixed.inset-0>".
- `Copy link` reports `Link copied.` in a `status` element that `get text body` can miss; read it with
  `snapshot -c`.
- The switch's accessible name follows its state: `Enable link sharing` when off, `Disable link sharing` when on.
- Prove the state with `open-anon` or `uvw share`, not the toast. `open-anon` uses its own cookie-less session,
  so the run's signed-in browser is unaffected.
- An unclaimed agent cannot turn the link on (`AGENT_NOT_ALLOWED`); with the link off, its `uvw share` points to its
  handoff link, and `--json` carries `expiresAt`, the date the agent expires. For a person the `expiresAt` key is
  absent.
- Link previews come only from the built server (`apps/workspace/dist/public`, from `build:web` before `up`).
  Vite on the web port never injects them.
- `Save my version` on a page in trial mode copies the page and the Sheets it binds; see HV6-HV7 in
  [HTML View](./html-view.md).
- Only a person signed in to the browser turns a link on, raises it to `editor` or makes a Space public. A uvw
  login, an MCP PAT or OAuth session and a claimed agent get `INTERACTIVE_SESSION_REQUIRED` with a confirm link,
  and an unclaimed agent `AGENT_NOT_ALLOWED`, except for its own `viewer` link
  ([MH4 in agent handoff](./agent-handoff.md#mh4-public-spaces), [CE4 in an agent's limits](./agent-mode-limits.md#ce4-a-person-confirms-what-an-agent-asks-for)).
  Turning a link off and making a Space private need no confirmation.
- A malformed JSON body to the share API answers `400` with `INVALID_INPUT`
  (`The request body is not valid JSON.`).
