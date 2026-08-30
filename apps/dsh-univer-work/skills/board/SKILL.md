---
name: board
description: Create, edit, verify, and screenshot Board Units in a Workspace Worktree.
---

# Workspace Board

Load `core` first. Start a new task with `workspace_worktree_create`. Stage an existing editable Board with `workspace_unit_add`, or create a Worktree-local Board with `workspace_unit_create`. Confirm its stable `unitId` with `workspace_unit_list`; Blob Resources are not Units.

Use `workspace_api_find` and `workspace_api_show` before relying on Board Facade methods or enums. `workspace_content_execute` injects `board` for the selected Unit.

## Connectors and layout

Create related shapes with `board.insertShapes()` before creating bound connectors with `board.insertConnectors()`. Retain generated element IDs and bind connector endpoints to those IDs. After the write, run a read-only execution containing `board.analyzeModelLayout(48)` before browser evidence.

Treat overlap and connector-through-element findings as defects. For the connectors named by evidence, call `board.normalizeConnectorRouting(ids)` at most once, then analyze again. Do not loop repairs or use routing normalization to replace endpoint rebinding.

Call `workspace_screenshot` only after model analysis. Review its rendered layout evidence and capture focused regions when a connector needs inspection.

## Native charts and images

Native charts belong directly to `FBoard`. Resolve `FBoard.newChart` through API discovery, build detached chart information with `board.newChart(...)`, and insert it with `await board.insertChart(info)`. In a later read-only execution, verify the live chart ID, type, position, size, title, and data.

For built-in images, call `workspace_resource_registries`, locate stable resource handles with `workspace_resource_find`, and publish the selected handles with `workspace_resource_export`. Keep the exported SVG as a file and pass its data URI to the Board image API; never infer a handle from a display label.

Board has no supported Office exchange. Finish with `workspace_screenshot`, then call `workspace_worktree_review_url` after the Worktree is ready. Return the stable Worktree and Unit identities with the review URL.
