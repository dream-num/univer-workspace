# Base Formula fields

Base Formula fields use Excel structured references; do not invent aliases or infer scope from
intent.

- `Table[[#This Row],[Column]]` (or `Table[@[Column]]`) reads one value from the formula record's
  row.
- `Table[[#Data],[Column]]` (or `Table[Column]`) reads the complete data column.
- Unqualified `[@[Column]]` is valid only for the current row of the Host table.
- `table[Column]` is invalid unless `table` is the real table identifier. It is never a generic
  placeholder for the current table.

Resolve every table's formula identifier with `table.getFormulaName()`. It may differ from the
display name when that name is duplicated or is not a legal Excel table name:

```js
const ordersName = orders.getFormulaName();
const pricingName = pricing.getFormulaName();
orders.addField("Line Total", api.Enum.BaseFieldType.Formula, {
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
lookup formula instead. Use `#Data` only for an intentional aggregate over all records. After a
Formula write, await calculation and read back computed record values; stored formula text alone is
not correctness evidence.

For a Formula field that reads a Sheet Source Unit, persist the complete external-reference binding:

```js
const table = base.getTableById("<table-id>");
if (!table) throw new Error("Base table not found");

table.addField("Current Total", api.Enum.BaseFieldType.Formula, {
  field: {
    config: { formula: "=SUM('[Sales Source]Data'!B2:B4)" },
  },
  externalReferences: [
    {
      qualifier: "Sales Source",
      sourceUnitId: "<sheet-unit-id>",
      sourceUnitType: api.Enum.UniverInstanceType.UNIVER_SHEET,
    },
  ],
});
```

The qualifier in the formula and binding must match. This binding belongs to the Base Formula Field.
