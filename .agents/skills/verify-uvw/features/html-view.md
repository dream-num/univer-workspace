# HTML View

An HTML View is a `.univer.html` page whose elements bind to live Sheet cells. Its owner publishes it with uvw
(or approves an agent's draft) and opens it from the repository `Pages` tab or `/nodes/<id>`. Someone who can edit
the source Sheet writes to it from the page in real time, and Sheet changes reach an open page without a reload.
A read-only visitor sees the same live data; their first edit switches the page to trial mode, which recalculates
in their browser only, saves nothing, and offers `Save my version` to copy the page and its Sheets.

## Sub-features

- HV1 validates and publishes a page with `uvw html-view validate` and `uvw html-view create`; `create` returns
  `workspaceUrl`, `shareUrl` (`?view=immersive`), `repositoryVisibility` and `privateSourceUnitIds`.
- HV2 lists pages on the repository `Pages` tab (`Default page: <name>`, `Visit page`, `Copy address`,
  `New page`) and opens one at `/nodes/<id>` with `Change with Agent`, `Inspect bindings`, `Open standalone` and
  `Enter immersive view`. `Open standalone` (`/apps/<id>/run`) redirects a bound page to `?view=immersive`.
- HV3 writes an owner's edit of a bound control to the trunk Sheet; formula cells recalculate.
- HV4 shows a merged Sheet change on an open page without a reload.
- HV5 shows a read-only visitor `Read only` and a disabled control until the source Sheets are readable too.
- HV6 trial mode: a read-only visitor's edit recalculates locally, shows
  `Trial mode. Changes are not saved; reload to see the latest Sheet.` and `Save my version`, leaves the trunk
  unchanged, and a reload restores the live values.
- HV7 `Save my version` for a signed-in reader copies the page and its Sheets into their Personal Space, opens the
  copy with the toast `This is your own copy, with its Sheets copied too. …`, and their edits there write to their
  own Sheet.

## How to get to it (user POV)

- CLI: `uvw html-view validate --file <page>.univer.html`, then
  `uvw html-view create --file … --space <space id> --name <name> --idempotency-key <key>`.
- Browser: a repository's `Pages` tab (`/spaces/<id>?view=apps`, Repository theme), the Wiki file tree, or the
  page link. Agents create pages as drafts that the owner publishes at `/drafts/<id>`
  ([MHV3 in HTML View drafts over MCP](./mcp-html-view.md#mhv3-save-retry-revise-and-read-back-the-pending-html-view-draft)).
- Visitors open a shared page link; the page and each source Sheet need Link Sharing `viewer`.

## Driving it with agent-browser and uvw

Preconditions: baseline run with `$V user`, the run browser signed in as the baseline user with the Repository
theme (see [page theme](./page-theme-wiki-repository.md)), and `O=verify-$VERIFY_UVW_RUN`.

- **Seed (HV1).** Sources resolve on trunk, so merge the Sheet first:

  ```bash
  $V cli hv-space repo list --owner @me --type personal --json; SPACE=$(jq -r '.[0].id' "$EVIDENCE/hv-space.out")
  $V cli hv-pr pr create -R $O/personal -t "HV data" --json   # W=.id, P=.number
  $V cli hv-unit unit create --worktree $W --space $O/personal --type sheet --name "HV data" --json   # U=.unit.unitId, R=.unit.resourceId
  $V cli hv-seed execute --worktree $W --unit $U --json -e 'const ws=workbook.getActiveSheet(); ws.getRange("A1:C2").setValues([["Item","Qty","Double"],["Rent",5,"=B2*2"]]); return {sheet:ws.getSheetId()};'   # S=.value.sheet
  $V cli hv-ready pr ready $P -R $O/personal --json; $V cli hv-merge pr merge $P -R $O/personal --json
  printf '<!DOCTYPE html><html><head><title>Qty page</title></head><body style="background:#fff;color:#111;font:18px system-ui;padding:32px"><h1>Qty page</h1><label>Qty <input type="number" data-univer-cell-model="%s:%s:B2"></label><p>Double: <output data-univer-cell-text="%s:%s:C2">loading</output></p></body></html>\n' $U $S $U $S > "$EVIDENCE/hv.univer.html"
  $V cli hv-validate html-view validate --file "$EVIDENCE/hv.univer.html" --json   # valid: true, bindingCount: 2
  $V cli hv-create html-view create --file "$EVIDENCE/hv.univer.html" --space $SPACE --name 'Qty page' --idempotency-key "hv-$VERIFY_UVW_RUN-0001-abcdef" --json   # PN=.nodeId
  ```

  In a private Personal Space, `repositoryVisibility` is `private` and `privateSourceUnitIds` lists `$U`.
- **Open (HV2).** `agent-browser open "$ORIGIN/spaces/$SPACE?view=apps"`: heading `Default page: Qty page`,
  `Visit page`, `Copy address`. Open `$ORIGIN/nodes/$PN` and wait about 4 s; `snapshot -i -c` shows the page's
  `spinbutton "Qty"` with `5`, and the screenshot shows `Double: 10`. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$ORIGIN/apps/$PN/run"` is `302` to `/nodes/$PN?view=immersive`.
- **Owner write (HV3).** Take the spinbutton ref from `snapshot -i -c`, then `agent-browser fill @<ref> 7` and
  `agent-browser press Tab`. `$V cli hv-after inspect range A1:C2 --trunk --unit $U --worksheet id:$S --json`
  reads `7` and `14` in row 2.
- **Live update (HV4).** With the page open: `pr create`, `unit add --worktree <W2> --resource $R`,
  `execute --worktree <W2> --unit $U -e "workbook.getSheetBySheetId('$S').getRange('B2').setValue(3); return 1;"`,
  `pr ready`, `pr merge`. Within a few seconds, and with no reload, the spinbutton reads `3` and the page shows
  `Double: 6`.
- **Visitor (HV5, HV6).** `$V cli hv-share-page share $PN --link viewer --json`. In a cookie-less session
  (`AGENT_BROWSER_SESSION=<run>-anon`, `cookies clear`) open `$ORIGIN/nodes/$PN`: `Read only`, a disabled
  spinbutton and `The resource was not found.` Share the Sheet too (`space find "HV data" --space $O/personal`,
  `nodes[0].nodeId`, `share <id> --link viewer`) and reload: the page shows `3`/`6`. Fill the spinbutton with
  `9`: the page shows `Double: 18`, the trial banner and `Save my version`, while the trunk `inspect` still reads
  `3`/`6`. Reload shows `3` again.
- **Save my version (HV7).** Sign a second user in (as in [link sharing](./link-sharing.md) LS5), open
  `$ORIGIN/nodes/$PN`, edit to start trial mode, then `agent-browser find text "Save my version" click`. The URL
  becomes the copy's `/nodes/<id>` in the second user's Space with the copy toast and the live values (`3`/`6`).
  Fill `4` there and reload: it stays `4`, and the owner's trunk still reads `3`/`6`.
- Clean up with `share $PN --link off` and `share <sheet node> --link off`.

## Gotchas

- `find role …` cannot reach controls inside the page: it renders in a sandboxed iframe under a shadow root.
  `snapshot` does include them, so act on its refs (`fill @e57 7`). Screenshots show bound text that `snapshot`
  may leave out (`Double: ` without its value).
- Sharing only the page is not enough for visitors: each source Sheet needs its own viewer link, or the Space must
  be public. `privateSourceUnitIds` from `create` names the Sheets that would fail.
- The trial banner appears only after the visitor's first edit, not on load.
- To change an existing Sheet in a new pull request, `unit add --worktree <id> --resource <resource id>` first;
  `execute` otherwise fails with `WORKSPACE_UNIT_NOT_FOUND`.
- `--idempotency-key` takes 16-200 characters of `[A-Za-z0-9_-]`; a `.univer.html` suffix is added to `--name`.
- Signed out, `Save my version` is a link that leads through sign-up; that path has not been driven here.
- `New page`, `Make a page` and `Change with Agent` open the browser Agent with `/html-view-creator`, and the
  style gallery appears only in an Agent session; they need a model provider (see
  [Browser Agent skills](./agent-skills.md)) and are not driven here.
