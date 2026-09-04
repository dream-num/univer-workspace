---
name: univer-base
description: Create, edit, calculate, inspect, export, and review Univer Base database Units through DSH tools and the Lite Interface. Use proactively for Base tables, fields, records, views, Formula fields, structured references, Sheet-backed external references, Base import/export, or any Base Unit task.
---

# Univer Base Units

Load `univer` first. Create the Base with `univer_unit` in a draft worktree, then use the returned `unitId` for every operation. Resolve it with `univerAPI.getBase(unitId)` inside `univer_execute`.

Before unfamiliar work, call `univer_api` for exact `FUniver.createBase`, `FUniver.getBase`, `FBase`, table, field, record, and view methods. Use Facade changes, read the model back, and follow the core ready/status handoff.

## OOXML Base table formulas

Base Formula fields must use exact Excel structured references:

- `Table[[#This Row],[Column]]` or `Table[@[Column]]` reads one value from the formula record's row.
- `Table[[#Data],[Column]]` or `Table[Column]` reads the complete data column.
- Unqualified `[@[Column]]` is valid only for the current row of the Host table.
- `table[Column]` is invalid unless `table` is the real table identifier.

Resolve every table's formula identifier with `table.getFormulaName()`. It may differ from the display name when duplicated or illegal as an Excel table name.

```js
const ordersName = orders.getFormulaName();
const pricingName = pricing.getFormulaName();
orders.addField("Line Total", univerAPI.Enum.BaseFieldType.Formula, {
  field: {
    config: {
      formula: `=${ordersName}[[#This Row],[Quantity]]*${pricingName}[[#This Row],[Unit Price]]`,
    },
  },
  externalReferences: [],
});
```

A qualified `#This Row` reference to another Base table aligns by row position. Use it only when both tables deliberately share row order. For relational data, use a stable key or RecordLink with lookup logic. Use `#Data` only for intended full-column aggregation.

After writing a Formula field, subscribe to calculation completion before triggering the change, await it, and read computed record values. Stored formula text alone is not evidence.

## Formula fields with a Sheet source

Persist the complete external-reference binding with the Formula field:

```js
const base = univerAPI.getBase("<base-id>");
const table = base?.getTableById("<table-id>");
if (!table) throw new Error("Base table not found");

table.addField("Current Total", univerAPI.Enum.BaseFieldType.Formula, {
  field: {
    config: { formula: "=SUM('[Sales Source]Data'!B2:B4)" },
  },
  externalReferences: [
    {
      qualifier: "Sales Source",
      sourceUnitId: "<sheet-unit-id>",
      sourceUnitType: univerAPI.Enum.UniverInstanceType.UNIVER_SHEET,
    },
  ],
});
```

The formula qualifier and binding qualifier must match exactly. For broader cross-Unit formula work, load `univer-cross-unit-formula` as well.

## Verification

After each mutation, use a fresh read-only `univer_execute` to verify:

- Base and table IDs;
- table display and formula names;
- field names, types, formula source, and external bindings;
- record values and calculated Formula results;
- view IDs, types, filters, sorting, grouping, and visible fields required by the task.

Use `univer_inspect` for the Unit overview when applicable, then call `univer_screenshot` with the Base `unitId`, selected worktree or trunk, and an explicit workspace `output` directory. Inspect the returned full-workbench PNG for the opening active table/view. Base screenshots accept only common screenshot arguments; do not pass Sheet ranges, Slide pages, or Board selectors.

Base may export to `.xlsx`, `.csv`, or `.tsv` through `univer_export`. Await calculation and complete readback before export.
