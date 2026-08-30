---
name: sheet
description: Create, import, edit, inspect, calculate, export, and visually verify Sheet Units in a Workspace Worktree.
---

# Workspace Sheet

Load `core` first. Start a new task with `workspace_worktree_create`. Stage an existing editable Sheet with `workspace_unit_add`, create a Worktree-local Sheet with `workspace_unit_create`, or use `workspace_office_import` for a supported workbook. Confirm the stable `unitId` with `workspace_unit_list`; Blob Resources are not Units.

Use `workspace_api_find` and `workspace_api_show` before relying on a Facade signature. `workspace_content_execute` injects `workbook` for the selected Unit. Use `workspace_content_inspect` to read bounded range evidence and a later read-only execution for complete cell data.

## Cell data

Treat a cell as explicit `ICellData`. Preserve the distinction between stored value `v`, type `t`, formula `f`, style and number format `s`, and rich text `p`. Displayed text is derived evidence, not a replacement for stored data. Use explicit objects such as `{ v: 42, t: 2 }` and deep-copy complete cell data when fidelity matters.

## Formula ordering

Formula calculation is asynchronous. Register completion before the write or recalculation:

```js
const sheet = workbook.getActiveSheet();
const calculated = api.getFormula().onCalculationResultApplied();
sheet.getRange("A3").setFormula("=A1+A2");
await calculated;
```

For existing formulas, register the same promise before `executeCalculation()`. In a later `workspace_content_execute`, read the stored formula and cached value. Use `workspace_content_inspect` to compare stored `v` and `t` with `displayValue`; do not treat formatted output as the stored value.

Use `workspace_office_export` only after formula and style read-back from the authoritative Worktree head. Finish with `workspace_screenshot`, then call `workspace_worktree_review_url` after the Worktree is ready. Return the stable Worktree and Unit identities with the review URL.
