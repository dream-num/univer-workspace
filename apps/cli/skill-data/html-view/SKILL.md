---
name: html-view
description: Create or revise live .univer.html pages backed by existing Workspace Sheet data using HTML bindings and JavaScript. Validate sources and publish pages with HTML View operations; revise existing pages through the Blob workflow.
---

# Workspace HTML Views

With the CLI, `html-view create` and replacement publish immediately. Through MCP tools,
use html_view_save to save a draft. Read the html-view-creator Skill for the MCP workflow.

## Start with a style and live data

1. Read the source Sheet. Use the style the user named; otherwise choose from the catalog in
   [design.md](references/design.md) using the purpose, audience and adjectives in the request,
   and the data's shape (dense rankings, time series, tasks/status or a few key numbers).
   If none fits, use Night Gauge (`night-gauge`, 仪表夜航) or a custom style. Ask at most
   one question only when purpose or data is unclear, or the user asks to see a plan or pick
   a style. Otherwise proceed directly. In the reply, always name the style and why it fits
   the request or data in one clause, and
   offer to change it; give a custom style a name and one-line description.
2. Read `styles/<id>.md` by default. Read the full `templates/<id>.univer.html` only
   when the data's shape is close to its designed-for scenario in the catalog, or the
   page needs that template's interaction. Keep the style's fonts, palette, density and
   signature element. Adapt the structure and bindings to the inspected Sheet.
   For a custom style, start from the structurally closest style card and change palette,
   type and signature element while meeting the design floor in design.md.
3. Controls write input cells or insert records. Subscriptions display recalculated Sheet values.
   Never compute Sheet metrics in page code or embed copied data or fallback numbers.
   If a derived metric is missing, add Sheet formula cells through the execution operation in
   the session's pull request. For a merged Sheet, create a pull request and add the Sheet first.
   Bind the formula results. MCP drafts select that repository and pull request when saving.
4. Keep loading, empty and error states honest. Label host-provided trials with `getWriteMode`.
   Write visible text, units and dates in the user's language. Templates are English starting points.

## Bind the page

Use HTML, CSS and JavaScript to present or edit existing Sheet data in a Workspace page.
Declare each live component's source with `data-univer-cell-subscribe` or
`data-univer-range-subscribe`, then register `subscribeCellById()` / `subscribeRangeById()` callbacks.
Use fine-grained declarations on the consuming elements so bindings are traceable in HTML;
plain text and native controls use `data-univer-cell-text` / `data-univer-cell-model`.
For binding syntax,
JavaScript data access, controls and frontend libraries, load the [authoring.md](references/authoring.md) reference of the `html-view` Skill and its linked references as needed. The `core` Skill explains how to load them. If the needed sections are already in context, use them directly.
When a binding pattern is still unclear, the [binding starter](examples/binding-starter.univer.html)
shows each one without a design; do not take its look.

Follow the `core` Skill for source and asset handling. `window.univerBinding` is provided at the published Workspace URL.

## Find the sources

Use the `core` Skill for authentication and discovery, and the `sheet` Skill to inspect worksheets, values and formulas. Bind to actual Unit
and worksheet IDs; Resource IDs and worksheet names are different identities.

Use `html-view validate --worktree <id>` to read a pull request's data. Sources mapped in
that pull request read its current changes; other sources read merged data. A merged pull
request reads merged data. `html-view create` publishes immediately and still needs merged
sources, so defer creation until review and merge are complete. Do not automatically merge
or substitute older merged data. Creating an HTML View does not authorize changing its
source cells or formulas. `workspace-html-view-source-unavailable` means a merged source
may not exist, may not be readable by you, or may exist only in an unmerged pull request.

## Host navigation

Workspace renders pages in an iframe with `sandbox="allow-scripts allow-forms"` and blocks native form navigation. Handle form submission with `preventDefault()` and the binding API. Popups and top-level navigation are unavailable; a normal link navigates inside the iframe. Return separate Workspace page links to the user instead of adding cross-page navigation that loads Workspace inside the view.

## Validate and create

Through MCP, check with `html_view_save` and `dryRun: true`, then save once as a draft.
Revise pending drafts with `draft`. Save an existing local file with bindings as a draft too,
unless the user explicitly requested a file.
Explain draft.publishWhen: `merge` goes live when the user merges the pull request in
Workspace; never tell them to press Publish. `publish` means open the preview and press **Publish**.

Dry runs do not run scripts; say render checks did not run.
With a local shell and `node`, and not as an agent identity, end the reply with exactly
this sentence, translated into the user's language:
If you want to check it live, reply "open live preview" and I will open it in your browser so we can keep tuning.
For Chinese, use exactly: 需要的话，回复「打开实时预览」，我会在你的浏览器里打开实时预览，边看边调。

On acceptance or any request for live preview, even without an offer, including 打开实时预览 or "open live preview", follow [local preview](references/local-preview.md). Through MCP, read it with
`skills_read {"name":"html-view","resource":"references/local-preview.md"}`, then revise the draft with `draft`.
Without a local shell or `node`, or as an agent identity, say in one sentence that live preview is unavailable and suggest the draft preview link instead.

With the CLI there are no drafts: `html-view create` publishes at once. Offer the live preview
before `html-view create`, then run `html-view validate` and `html-view create` as below, or replace
an existing page's Blob.

Run `html-view validate` with the complete HTML source. Then run `html-view create` with the same source, destination Space, name `Dashboard`, stable idempotency key, and optional parent Node. Follow the `core` Skill for source handling.

`validate` parses declarative HTML bindings, reads accessible Sheet data in the selected scope, and checks
worksheet existence and cell/range bounds. It returns `{ valid, unitIds, bindingCount, bindings, truncated? }`, with at most 60 binding samples of cell values and range summaries in document order (`truncated: true` when more exist).
Compare `bindings` with the page plan for empty cells where data is expected, header text where numbers are expected, formula cells behind controls that write, and numbers carrying a date format.
It does not execute JavaScript or discover references created by scripts. A JavaScript-only page may report
zero static bindings; runtime requests still require access to each source Unit.

Blob write keys must be 16–200 ASCII letters, digits, underscores or hyphens; a UUID is a suitable key. This applies to both creation and replacement.

`create` performs the same validation and uploads the validated HTML as a new Blob. It adds
`.univer.html` to the name if missing and returns Blob identities plus `workspaceUrl`, `shareUrl`, `repositoryVisibility` and `privateSourceUnitIds`. The Space
is explicit; the parent defaults to its root. Reuse an idempotency key only when retrying identical
content, name and destination. Creation publishes immediately without a Unit Worktree and does
not modify source cells.

Review the template's structure, script syntax, referenced IDs, coordinates, loading/error states
and intended write handlers. Template validation does not prove runtime rendering, interaction or
synchronization; report which checks ran. Unit screenshot commands do not render HTML Views.

## Share the page

Return `shareUrl` (the immersive page link) to the user and say who can open it.
When `repositoryVisibility` is `public` and `privateSourceUnitIds` is empty, anyone
with the link can view the page and its declared sources. Otherwise, only signed-in
people with access can open the page with all its data. A public page can open
without its private source data. Signed-out visitors and signed-in non-members are
read-only; page writes are rejected for them.

If the user wants anyone with the link to open a private repository's page, ask
before making the repository public: this immediately publishes everything in the
repository. After approval, use CLI `repo edit <repo> --visibility public`. MCP cannot
make a repository public: give the user the repository `url` and ask them to make it
public in its settings in the browser.
Keep source Sheets in the same public repository as the page, or list the
`privateSourceUnitIds` to the user. These fields describe declared sources at
creation time; script-created references and later permission changes still need
checking, and Workspace authorizes every visitor's requests.

Media referenced with `data-workspace-src` appears only when the file itself is in a public
repository or has link sharing on, for every visitor including signed-in members. Tell the user
which referenced files are private instead of changing their sharing without asking.

## Revise an existing page

Read the existing page's HTML and strong ETag, edit the original source, validate the
complete HTML, then replace it with that ETag and a new stable write key. Use the
`core` Skill's operation bindings for the connected product. With the CLI, read the
`blob` Skill, download the Resource, run `html-view validate`, then use `blob replace`.
Replacement preserves the existing page identity and URL. Reconcile ETag conflicts;
create another Blob only when a separate page is wanted.

Page access does not grant access to the source Sheets. Author validation uses the current authenticated
identity; each viewer's source access is checked separately by Workspace at runtime.
