---
name: base
description: Create, edit, inspect, verify, open, screenshot, import, and export remote Workspace Base Units, tables, fields, records, and views.
---

# Workspace Base

Load `core` first and use one explicit draft Worktree and Base Unit ID throughout the task.

## Model

A Base is one Univer Unit:

```text
FUniver
└── FBase
    └── FBaseTable
        ├── FBaseTableField   schema and value contract
        ├── FBaseTableRecord  stored business data
        └── FBaseTableView    projection of the same table records
```

- Resolve `FBase` by stable Unit ID. Tables own fields, records, and views; views add filter, sort,
  group, visibility, and type-specific presentation over the same records.
- The primary field is the record's visible identity for links, cards, and details. Define it with
  `insertTable(..., { primaryFieldName })` instead of adding a duplicate label field.
- Use stable Unit/Table/Field/Record/View IDs in Facade relationships and user-facing names for
  display. Record values and view config normally refer to Field IDs.
- `table.getFormulaName()` is the structured-reference name used in formulas; it may differ from the
  table's display name.

## Workspace entry

Create an empty Base or stage an existing Base Resource in the task Worktree:

```bash
univer-workspace-cli unit create \
  --worktree <worktree-id> --space <space-id> \
  --type base --name <name> --json
univer-workspace-cli unit list --worktree <worktree-id> --json
univer-workspace-cli inspect base \
  --worktree <worktree-id> --unit <base-id> --json
```

Creation returns server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned `unitId` for
every Base content command. Use `blob upload` only when preserving original bytes without an
editable Base Unit; Blob Resources have no `unitId` and cannot use this Skill's commands.

Base authoring uses the shared execute transaction. Workspace execution injects the selected
`FBase` as `base`, together with `univerAPI` and alias `api`; do not redeclare them:

```bash
univer-workspace-cli execute \
  --worktree <worktree-id> --unit <base-id> \
  -e 'return base.getId();' \
  --json
```

Do not call `createBase()` after `unit create` merely to obtain a handle. A new Base already contains
`Table 1` with a primary `Name` field and `Grid`; `insertTable()` also creates a Grid. Run
`inspect base` first, then deliberately reuse, rename, or delete defaults.

## Exact API

```bash
univer-workspace-cli api show FUniver.getBase FBase FBaseTable FBaseTableField FBaseTableRecord FBaseTableView
univer-workspace-cli api show FEnum.BaseFieldType FBase.insertTable FBaseTable.addField FBaseTable.addRecords FBaseTable.createView
univer-workspace-cli api show IGridViewConfig ICalendarViewConfig IGalleryViewConfig IGanttViewConfig IKanbanViewConfig ICardLayoutConfig
```

Use focused discovery such as `univer-workspace-cli api find recordLink --unit base`. Follow every
referenced child type: if a result says `card?: ICardLayoutConfig`, run
`api show ICardLayoutConfig` instead of guessing its shape.

## Core contracts

- Add fields one at a time with `FBaseTable.addField(...)`; there is no `addFields` method.
- Single/MultiSelect options use `{ id, name, color? }`; records store option IDs, not labels.
- Progress values follow the configured range: with `{ start: 0, end: 100 }`, 75% is `75`, not
  `0.75`.
- Money uses `BaseFieldType.Currency` and numeric values; Number is not a semantic substitute.
- RecordLink config targets a Table ID and stores target Record IDs. Prefer its dedicated Facade
  methods when editing links.
- View config uses Field IDs. Kanban/Gallery card title and fields follow `ICardLayoutConfig`;
  `fieldSettings` does not replace the card contract.

## Verification

After the last write, check:

1. `univer-workspace-cli inspect base --worktree <worktree-id> --unit <base-id> --json` for tables,
   primary fields, field types and config, record counts, and view types. It is read-only and accepts
   no selector.
2. In a fresh read-only `execute`, explicitly `return` record values plus `view.getConfig()` and
   `view.getProjection()` for stored IDs and view bindings.
3. Review the required rendered views for blank labels, exposed IDs, implausible dates or
   percentages, missing card fields, and empty defaults.

```bash
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <base-id> --out <directory> --json
univer-workspace-cli open --worktree <worktree-id> --unit <base-id>
```

Base screenshots accept only common screenshot options; do not pass Sheet ranges or Slide page
selectors.

## Formula fields

Run `univer-workspace-cli skills get base --full` and follow `references/formulas.md`. Formula
fields use exact Excel structured references. Await calculation and read back computed record
values; stored formula text alone is not correctness evidence.

## Image attachments

Create an Attachment field, add or select a record, and use `record.setAttachments()`. For a local
image, put its data URI in `source` and declare `sourceType: api.Enum.ImageSourceType.BASE64`:

```js
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

Base participates in the existing Workspace Office import/export matrix. Complete calculation,
structured inspection, readback, and visual verification before export. Keep merge and discard
user-authorized as described by `core`.
