---
name: base
description: Create, edit, verify, open, screenshot, import, and export Base Units in a remote Univer Workspace Worktree.
---

# Workspace Base

Load `core` first and use one explicit draft Worktree and Base Unit ID throughout the task.

Create an empty Base or stage an existing Base file:

```bash
univer-workspace-cli unit create \
  --worktree <worktree-id> --space <space-id> \
  --type base --name <name> --json
univer-workspace-cli unit list --worktree <worktree-id> --json
```

Creation returns server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned `unitId` for
every Base content command.
Use `blob upload` only when preserving original bytes without an editable Base Unit; Blob Resources
have no `unitId` and cannot use this Skill's commands.

Base authoring uses the shared execute transaction. Base does not inject a `base` variable; resolve
the exact Unit through `api`:

```bash
univer-workspace-cli execute \
  --worktree <worktree-id> --unit <base-id> \
  -e 'const base = api.getBase("<base-id>"); if (!base) throw new Error("Base not found"); return base.getId();' \
  --json
```

Use `api find` and `api show` to resolve Base Facade methods before writing mutations. Native
`inspect base` is not supported. Verify model facts with read-only `execute`, and verify appearance
with:

```bash
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <base-id> --out <directory> --json
univer-workspace-cli open --worktree <worktree-id> --unit <base-id>
```

## OOXML Base table formulas

Base Formula fields must use Excel structured references exactly; do not invent aliases or infer
scope from intent.

- `Table[[#This Row],[Column]]` (or `Table[@[Column]]`) reads one value from the formula
  record's row.
- `Table[[#Data],[Column]]` (or `Table[Column]`) reads the complete data column.
- Unqualified `[@[Column]]` is valid only for the current row of the Host table.
- `table[Column]` is invalid unless `table` is the real table identifier. It is never a generic
  placeholder for the current table.

Resolve every Base table's formula identifier with `table.getFormulaName()`. The identifier may
differ from its display name when that name is duplicated or is not a legal Excel table name:

```js
const ordersName = orders.getFormulaName();
const pricingName = pricing.getFormulaName();
const lineTotal = orders.addField("Line Total", api.Enum.BaseFieldType.Formula, {
  field: {
    config: {
      formula: `=${ordersName}[[#This Row],[Quantity]]*${pricingName}[[#This Row],[Unit Price]]`,
    },
  },
  externalReferences: [],
});
```

A qualified `#This Row` reference to another Base table aligns by row position; use it only when
the tables deliberately share row order. For relational data, use a stable key or RecordLink with a
lookup formula instead. Use `#Data` only when an aggregate over all records is intended. After
writing or editing a Formula field, await calculation and read back its computed record values; the
stored formula text alone is not correctness evidence.

## Image attachments

Create an Attachment field, add or select a record, and use `record.setAttachments()`. For a local
image, put its data URI in `source` and declare `sourceType: api.Enum.ImageSourceType.BASE64`:

```js
const base = api.getBase("<base-id>");
if (!base) throw new Error("Base not found");
const table = base.insertTable("Assets");
const field = table.addField("Image", api.Enum.BaseFieldType.Attachment);
const record = table.addRecord({});
const ok = record.setAttachments(field.getId(), [
  {
    id: "local-image",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    sourceType: api.Enum.ImageSourceType.BASE64,
    source: imageDataUri,
  },
]);
if (!ok) throw new Error("Attachment write failed");
```

Read back `record.getValues()[field.getId()]` in a later execution.

Base participates in the existing Workspace Office import/export matrix. Keep merge and discard
user-authorized as described by `core`.
