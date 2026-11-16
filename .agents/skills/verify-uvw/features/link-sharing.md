# Link sharing

A file's owner turns Link Sharing on or off from the browser `Share` dialog or with `uvw share`. With the
link set to `viewer`, anyone who opens the file URL without signing in sees the file read-only. With it
`off`, only people with access to the repository can open it, and an anonymous visitor gets a not-found
page. Both surfaces show the same state.

## Sub-features

- LS1 shows a file's link and its Link Sharing state with `uvw share <node>`.
- LS2 sets the link to `viewer` with `uvw share --link viewer`, and an anonymous visitor opens the file read-only.
- LS3 sets the link to `off`, and the anonymous visitor gets a 404 page.
- LS4 shows the CLI-set state in the browser `Share` dialog, turns sharing on there, and reads it back through
  uvw and an anonymous visit.

## How to get to it (user POV)

- Browser: open a file, then click `Share` in its header. The dialog `Share “<name>”` has a `Link sharing`
  section with a switch, a `Link access` combobox and `Copy link`.
- CLI: `uvw share <file link or Node ID>` prints the link and its state; `--link off|viewer|editor` sets it.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`, browser signed in as the baseline user (see [auth](./auth.md)).
- A Sheet `Verify Budget` with `Rent`/`1200` in A1:B1, created as in [create-document](./create-document.md).
  `N` is its Node ID: `nodes[0].nodeId` from `$V cli doc-find space find "Verify Budget" --space "verify-$VERIFY_UVW_RUN/personal" --json`.

- **LS1. Show.** Run `$V cli share-show share "$N" --json`. Output has `url: "$ORIGIN/nodes/$N"`,
  `name: "Verify Budget"`, `link: "off"` and `owner.username: "verify-<run-id>"`.
- **LS2. Viewer link.** Run `$V cli share-viewer share "$N" --link viewer --json` (`link: "viewer"`), then
  `$V open-anon share-anon-viewer "$ORIGIN/nodes/$N"`. `share-anon-viewer.node-status` reports `200`, and
  `share-anon-viewer.png` shows the grid with `Rent`/`1200`, a `Read only` badge, and `Sign up`/`Sign in`.
- **LS3. Off.** Run `$V cli share-off share "$N" --link off --json` (`link: "off"`), then
  `$V open-anon share-anon-off "$ORIGIN/nodes/$N"`. `share-anon-off.node-status` reports `404`, and the page
  text reads `Unable to open this resource`.
- **LS4. Browser dialog.** Run `agent-browser open "$ORIGIN/nodes/$N"`, `agent-browser wait canvas`, then
  `agent-browser find role button click --name Share --exact`. The dialog `Share “Verify Budget”` shows
  `Link access is off`, a switch `Enable link sharing` (unchecked), and a disabled `Copy link`. Run
  `agent-browser find role switch click --name 'Enable link sharing'`. A `Link sharing updated.` toast shows,
  the switch becomes `Disable link sharing` (checked), and `Copy link` is enabled. Screenshot
  `$EVIDENCE/share-dialog-on.png`. Read back with `$V cli share-after-web share "$N" --json` (`link: "viewer"`)
  and `$V open-anon share-anon-web "$ORIGIN/nodes/$N"` (`200`). Finish with
  `$V cli share-cleanup share "$N" --link off --json`.

## Gotchas

- `space find --json` names the Node ID `nodeId`; there is no `id` field, so `jq .nodes[0].id` gives `null`
  and `uvw share null` fails with `NOT_FOUND`.
- The switch's accessible name follows its state: `Enable link sharing` when off, `Disable link sharing` when on.
- Prove the state with `open-anon` or `uvw share`, not the toast. `open-anon` uses its own cookie-less session,
  so the run's signed-in browser is unaffected.
- With the link on, `uvw share` also prints when the link stops working unless the owner stays active; `--json`
  carries it as `expiresAt`. For the human run user it was `null`.
