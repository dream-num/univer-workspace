---
name: html-view
description: Create or revise live .univer.html pages backed by existing Workspace Sheet data using HTML bindings and JavaScript. Validate sources and publish pages with HTML View operations; revise existing pages through the Blob workflow.
---

# Workspace HTML Views

## Start with a style and live data

1. Read [design.md](references/design.md). Unless the user already named a style, ask which
   style they want before reading Sheets in depth or authoring. Ask in the user's language,
   listing the ten style names and their one-line moods in that language, and say
   Night Gauge (`night-gauge`, 仪表夜航) is the default. Ask in your normal reply text,
   then end your turn and wait for the answer; do not rely on a client question or form tool,
   or validate or publish a page before the user answers. If they
   leave the choice to you (你来定, 随便, 默认就行), use Night Gauge (仪表夜航). Never silently choose
   another style.
2. Read and adapt the complete `templates/<id>.univer.html` for that style; never start from
   a blank page. Keep its fonts, palette, density and signature element when adapting to new data.
3. Page controls write to Sheet cells or append rows; the page displays the recalculated
   source values through live bindings, and label host-provided visitor trials with `getWriteMode`
   as the templates do, without page-side simulations. Never re-implement a Sheet formula in page code,
   embed copies of Sheet data, or use fallback numbers. Keep loading, empty and error states honest.
4. Write the page in the user's language as [design.md](references/design.md) describes;
   templates are English starting points.

## Bind the page

Use HTML, CSS and JavaScript to present or edit existing Sheet data in a Workspace page.
Declare each live component's source with `data-univer-cell-subscribe` or
`data-univer-range-subscribe`, then register `subscribeCellById()` / `subscribeRangeById()` callbacks.
Use fine-grained declarations on the consuming elements so bindings are traceable in HTML;
plain text and native controls use `data-univer-cell-text` / `data-univer-cell-model`.
For binding syntax, JavaScript data access, controls and frontend libraries, load the [authoring.md](references/authoring.md) reference of the `html-view` Skill and its linked references as needed. The `core` Skill explains how to load them. If the needed sections are already in context, use them directly.

Follow the `core` Skill for source and asset handling. `window.univerBinding` is provided at the published Workspace URL.

## Find the sources

Use the `core` Skill for authentication and discovery, and the `sheet` Skill to inspect worksheets, values and formulas. Bind to actual Unit
and worksheet IDs; Resource IDs and worksheet names are different identities.

Sources always resolve on trunk. If the required Unit, worksheet or changes exist only in a
Worktree, prepare the template but defer validation and publication until those changes are
merged through the existing review workflow. Do not automatically merge a Worktree or substitute
older trunk data. Creating an HTML View does not authorize changing its source cells or formulas.

## Host navigation

Workspace renders pages in an iframe with `sandbox="allow-scripts allow-forms"` and blocks native form navigation. Handle form submission with `preventDefault()` and the binding API. Popups and top-level navigation are unavailable; a normal link navigates inside the iframe. Return separate Workspace page links to the user instead of adding cross-page navigation that loads Workspace inside the view.

## Validate and create

Run `html-view validate` with the complete HTML source. Then run `html-view create` with the same source, destination Space, name `Dashboard`, stable idempotency key, and optional parent Node. Follow the `core` Skill for source handling.

`validate` parses declarative HTML bindings, reads accessible trunk Sheet data, and checks
worksheet existence and cell/range bounds. It returns `{ valid, unitIds, bindingCount }`. It does not
execute JavaScript or discover references created by scripts. A JavaScript-only page may report
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
repository. After approval, use CLI `repo edit <repo> --visibility public`, or MCP
`repo_edit {repo, visibility: "public"}` in the `admin` toolset.
Keep source Sheets in the same public repository as the page, or list the
`privateSourceUnitIds` to the user. These fields describe declared sources at
creation time; script-created references and later permission changes still need
checking, and Workspace authorizes every visitor's requests.

Media referenced with `data-workspace-src` appears only when the file itself is in a public
repository or has link sharing on, for every visitor including signed-in members. Tell the user
which referenced files are private instead of changing their sharing without asking.

## Revise an existing page

Read the `blob` Skill. Download the existing Resource, edit the original HTML source, run `html-view validate`, then use `blob replace` with its downloaded ETag and a new
stable write key. Replacement preserves the existing page identity and URL. Reconcile ETag
conflicts; create another Blob only when a separate page is wanted.

Page access does not grant access to the source Sheets. Author validation uses the current authenticated
identity; each viewer's source access is checked separately by Workspace at runtime.
