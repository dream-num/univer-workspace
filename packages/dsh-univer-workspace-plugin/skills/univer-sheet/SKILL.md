---
name: univer-sheet
description: Read, create, edit, inspect, import, export, and review verified Univer Sheet Units through the Workspace univer_ tools and headless Facade API.
---

# Univer Sheet Units

This profile has a verified browser Viewer and headless workflow for `sheet`.
Load `univer` first, then discover the Space and Unit instead of inventing ids.

## Available tools

- `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
  `univer_status` discover and identify a Sheet Unit.
- `univer_new`/`univer_create` create a document in the linked Space.
- `univer_worktree` creates the review draft; `univer_edit` with `mode:
  "write"` and `univer_execute` write only to that draft.
- `univer_inspect` reads structured content; `univer_edit` with `mode: "read"`
  reads Facade values.
- `univer_import` and `univer_export` handle the supported Office exchange
  paths; `univer_api` and `univer_resources` expose their real SDK contracts.

## Safe workflow

1. Call `univer_spaces`, list the selected Space, and call `univer_open` to
   confirm `unitType: "sheet"`, `unitId`, and `editorMode`.
2. Create or select a draft Worktree before any write. A read-only Unit must
   not be edited.
3. Use the version-matched Facade bindings supplied by the execution tool:
   `univerAPI` (also `api`) and `workbook`.
4. Read the changed range or an inspection result back before reporting a
   write as complete. Publish only through the explicit ready/merge review.

For a worksheet, use `workbook.getActiveSheet()` or
`workbook.getSheetByName("Sheet 1")`; the worksheet method is
`getSheetName()`, while the workbook method is `getName()`. Range row and
column indexes are zero-based. Use explicit cell data such as
`{ v: "text", t: 1 }` instead of relying on inferred types.

Render/lint evidence is outside the current verified tool set; do not claim a
result that the profile did not produce.
