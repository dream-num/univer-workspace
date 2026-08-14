---
name: cross-unit-formula
description: "Author, calculate, inspect, and verify cross-Unit formulas in remote Workspace Sheet cells or Shapes with explicit Sheet or Base Source identity."
---

# Workspace cross-Unit formulas

Load `core`, the Host Unit Skill, and the Sheet or Base Source Skill first. A cross-Unit formula has
two supported consumers: a Sheet cell, or a normal Host Shape whose displayed text is calculated
from a Sheet range or Base table column. Unit Skills own Unit-local content and visual behavior;
this Topic Skill owns external Source binding, formula, calculation, and cross-Unit verification.

Resolve the public Facade contract before authoring:

```bash
univer-workspace-cli api show FRange.setFormula FShape.setFormula FShape.getFormulaResult FFormula.buildReference FFormula.upsertExternalReference FFormula.onCalculationResultApplied
```

## Identity contract

- The caller must already know the stable Source `unitId`, Source Unit type, Unit name, and source
  coordinates. An existing Host binding is also authoritative. Do not resolve a Unit ID from a
  display name.
- Use the Source Unit name as the normal `formulaQualifier`. Reusing a qualifier with a different
  Source explicitly changes what every Host formula using it resolves on its next write or fresh
  load. If both Sources must remain available, choose an explicit readable Host-local alias for at
  least one. The persisted qualifier-to-`unitId` binding, not global name uniqueness, selects the
  Source.
- `buildReference()` writes that binding into the Host snapshot and returns a safely quoted formula
  fragment. It does not list or preload Workspace Units.
- Sheet cell formulas and formula-driven Shapes read the same Host external-reference metadata. A
  mapping written by `buildReference()` is therefore shared by both consumers.
- A Sheet cell reads the persisted Host mapping directly. For a Shape, pass the same stable identity
  again in `setFormula({ formula, externalReferences })`; the repeated binding is an idempotent
  consistency check.
- Do not stage a Source into the task Worktree merely to read it. The Workspace runtime loads an
  authorized Source on first calculation. Do not persist a Workspace URL or share link as identity.

## Sheet Source binding

The command still targets only the Host Unit. Replace the Source placeholders with exact identity
and Sheet coordinates established before this authoring step, then build the reference in the Host
context:

```js
const hostUnit = workbook;
const hostSheet = hostUnit.getSheetByName("Dashboard");
if (!hostSheet) throw new Error("Host sheet Dashboard was not found.");

const source = {
  unitId: "<source-unit-id>",
  qualifier: "<source-unit-name-or-host-local-alias>",
  sheetName: "Orders",
};
const formula = api.getFormula();
const reference = formula.buildReference({
  hostUnitId: hostUnit.getId(),
  unit: {
    unitId: source.unitId,
    formulaQualifier: source.qualifier,
  },
  target: {
    kind: api.Enum.FormulaReferenceType.SHEET_RANGE,
    sheetName: source.sheetName,
    range: { startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 },
  },
});
```

## Sheet cell consumer

Continue in the same execution by subscribing before the write:

```js
const targetCell = hostSheet.getRange("C1");
const applied = formula.onCalculationResultApplied(30_000);
targetCell.setFormula("=SUM(" + reference + ")");
await applied;
return { formula: targetCell.getFormula(), value: targetCell.getValue() };
```

## Formula-driven Shape consumer

Use the Host Unit Skill to create a regular Shape, then bind it to the same reference and Source
identity. The Facade retains Formula Shape method and enum names; they are API details, not a
separate authoring workflow.

```js
const shape = hostSheet.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.Rect,
  transform: { left: 700, top: 240, width: 280, height: 72 },
});
if (!shape) throw new Error("Formula-driven Shape could not be inserted.");

const applied = formula.onCalculationResultApplied(30_000);
shape.setFormula({
  formula: "=SUM(" + reference + ")",
  externalReferences: [
    {
      qualifier: source.qualifier,
      sourceUnitId: source.unitId,
      sourceUnitType: api.Enum.UniverInstanceType.UNIVER_SHEET,
    },
  ],
});
await applied;

const result = shape.getFormulaResult();
if (result?.status !== api.Enum.FormulaShapeResultStatus.SUCCESS) {
  throw new Error("Formula-driven Shape failed: " + JSON.stringify(result));
}
return { shapeId: shape.getId(), formula: shape.getFormula(), result };
```

## Base Source binding

For a Base Source, keep the Host and selected consumer unchanged and build a table-column reference:

```js
const source = {
  unitId: "<source-base-unit-id>",
  qualifier: "<source-base-name-or-host-local-alias>",
};
const reference = api.getFormula().buildReference({
  hostUnitId: hostUnit.getId(),
  unit: { unitId: source.unitId, formulaQualifier: source.qualifier },
  target: {
    kind: api.Enum.FormulaReferenceType.TABLE_COLUMN,
    tableName: "Budget",
    columnName: "Amount",
  },
});
```

`tableName` must be the Source Base's real OOXML table identifier and `columnName` must
match the real field name. Never pass `"table"` as a generic placeholder. Resolve the Source table
from Base metadata first; `buildReference()` owns qualifier quoting and escaping.

Use that `reference` in the Sheet cell recipe above. For a formula-driven Shape, use the same
`externalReferences` structure with `sourceUnitType: api.Enum.UniverInstanceType.UNIVER_BASE`.

## Existing formula text

For hand-written, imported, or batch formula text, persist the same Host mapping before writing the
formula and fail when the mapping is rejected:

```js
const source = { unitId: "<source-sheet-unit-id>", qualifier: "Orders" };
const bound = api.getFormula().upsertExternalReference({
  unitId: hostUnit.getId(),
  qualifier: source.qualifier,
  sourceUnitId: source.unitId,
  sourceUnitType: api.Enum.UniverInstanceType.UNIVER_SHEET,
});
if (!bound) throw new Error("Cross-Unit Source binding failed.");
const applied = api.getFormula().onCalculationResultApplied(30_000);
hostSheet.getRange("C1").setFormula("=SUM('[Orders]Sheet1'!B2:B10)");
await applied;
```

Use `UNIVER_BASE` for a Base Source. The qualifier in formula text and metadata must match exactly.
When an upsert rebinds an existing qualifier, write the formula for the current authoring operation
after the upsert and await calculation. `executeCalculation()` recalculates compiled formulas but
does not by itself reparse every existing formula against the new Host binding. Prefer
`buildReference()` whenever names need quoting or escaping.
A Sheet, Doc, Slide, or Board may own a formula-driven Shape; use its Unit Skill to create and later
resolve the Shape by stable ID.

## Verification and failure

Register `onCalculationResultApplied()` before the selected consumer's formula write. In a later
read-only `execute`, verify a cell's exact formula and cached value, or a Shape's stable ID,
`isFormulaShape()`, exact formula, and successful raw/display result. Missing, invalid, ambiguous,
inaccessible, or type-incompatible bindings fail closed; do not repair them by guessing a Source
from a loaded Unit or display name. Finish with the Host Skill's screenshot and review flow.
