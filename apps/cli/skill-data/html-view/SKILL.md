---
name: html-view
description: Create or revise live .univer.html pages backed by existing Workspace Sheet data using HTML bindings and JavaScript. Validate sources and publish pages with univer-workspace-cli html-view; revise existing pages through the Blob workflow.
---

# Workspace HTML Views

Use HTML, CSS and JavaScript to present or edit existing Sheet data in a Workspace page.
Declare each live component's source with `data-univer-cell-subscribe` or
`data-univer-range-subscribe`, then register `subscribeCellById()` / `subscribeRangeById()` callbacks.
Use fine-grained declarations on the consuming elements so bindings are traceable in HTML;
plain text and native controls use `data-univer-cell-text` / `data-univer-cell-model`.
For binding syntax, JavaScript data access, controls and frontend libraries, load the bundled
authoring reference through the CLI:

```bash
univer-workspace-cli skills read html-view references/authoring.md
```

This prints [authoring](references/authoring.md). `skills get html-view` lists the other references
and their read commands; use `skills read html-view references/<name>.md` when one is needed.
`skills get html-view --full` prints all references at once. If the needed sections are already
in context, use them directly. No `ls`, `cat`, or installation-directory access is needed.

Create a complete local `.univer.html` file; sibling scripts
and assets are not uploaded automatically. Opening the local file alone does not provide
`window.univerBinding`; use the published Workspace URL.

## Find the sources

Use `univer-workspace-cli skills get core` for authentication and discovery, and
`univer-workspace-cli skills get sheet` to inspect worksheets, values and formulas. Bind to actual Unit
and worksheet IDs; Resource IDs and worksheet names are different identities.

Sources always resolve on trunk. If the required Unit, worksheet or changes exist only in a
Worktree, prepare the template but defer validation and publication until those changes are
merged through the existing review workflow. Do not automatically merge a Worktree or substitute
older trunk data. Creating an HTML View does not authorize changing its source cells or formulas.

## Validate and create

```bash
univer-workspace-cli html-view validate --file ./dashboard.univer.html --json
univer-workspace-cli html-view create --file ./dashboard.univer.html \
  --space <space-id> --name Dashboard --idempotency-key <key> [--parent <node-id>] --json
```

`validate` parses declarative HTML bindings, reads accessible trunk Sheet data, and checks
worksheet existence and cell/range bounds. It returns `{ valid, unitIds, bindingCount }`. It does not
execute JavaScript or discover references created by scripts. A JavaScript-only page may report
zero static bindings; runtime requests still require access to each source Unit.

Blob write keys must be 16–200 ASCII letters, digits, underscores or hyphens; a UUID is a suitable key. This applies to both creation and replacement.

`create` performs the same validation and uploads the validated HTML as a new Blob. It adds
`.univer.html` to the name if missing and returns Blob identities plus `workspaceUrl`. The Space
is explicit; the parent defaults to its root. Reuse an idempotency key only when retrying identical
content, name and destination. Creation publishes immediately without a Unit Worktree and does
not modify source cells.

Review the template's structure, script syntax, referenced IDs, coordinates, loading/error states
and intended write handlers. Template validation does not prove runtime rendering, interaction or
synchronization; report which checks ran. Unit screenshot commands do not render HTML Views.

## Revise an existing page

Read `univer-workspace-cli skills get blob`: download the existing Resource to a local `.univer.html`
file, edit it, run `html-view validate`, then use `blob replace` with its downloaded ETag and a new
stable write key. Replacement preserves the existing page identity and URL. Reconcile ETag
conflicts; create another Blob only when a separate page is wanted.

Page access does not grant access to the source Sheets. Author validation uses the current CLI
identity; each viewer's source access is checked separately by Workspace at runtime.
