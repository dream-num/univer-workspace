---
name: html-view
description: Create or revise live .univer.html pages backed by existing Workspace Sheet data using HTML bindings and JavaScript. Validate sources and publish pages with univer-workspace-cli html-view; revise existing pages through the Blob workflow.
---

# Workspace HTML Views

Use HTML, CSS and JavaScript to present or edit existing Sheet data in a Workspace page.
For binding syntax, JavaScript data access, controls and frontend libraries, read
[authoring](references/authoring.md). Create a complete local `.univer.html` file; sibling scripts
and assets are not uploaded automatically. Opening the local file alone does not provide
`window.univerBinding`; use the published Workspace URL.

## Find the sources

Use the [Core Skill](../core/SKILL.md) for authentication and discovery, and the
[Sheet Skill](../sheet/SKILL.md) to inspect worksheets, values and formulas. Bind to actual Unit
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
worksheet existence and cell bounds. It returns `{ valid, unitIds, bindingCount }`. It does not
execute JavaScript or discover references created by scripts. A JavaScript-only page may report
zero static bindings; runtime requests still require access to each source Unit.

`create` performs the same validation and uploads the validated HTML as a new Blob. It adds
`.univer.html` to the name if missing and returns Blob identities plus `workspaceUrl`. The Space
is explicit; the parent defaults to its root. Reuse an idempotency key only when retrying identical
content, name and destination. Creation publishes immediately without a Unit Worktree and does
not modify source cells.

Review the template's structure, script syntax, referenced IDs, coordinates, loading/error states
and intended write handlers. Template validation does not prove runtime rendering, interaction or
synchronization; report which checks ran. Unit screenshot commands do not render HTML Views.

## Revise an existing page

Follow the [Blob Skill](../blob/SKILL.md): download the existing Resource to a local `.univer.html`
file, edit it, run `html-view validate`, then use `blob replace` with its downloaded ETag and a new
stable write key. Replacement preserves the existing page identity and URL. Reconcile ETag
conflicts; create another Blob only when a separate page is wanted.

Page access does not grant access to the source Sheets. Author validation uses the current CLI
identity; each viewer's source access is checked separately by Workspace at runtime.
