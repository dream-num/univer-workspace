---
name: doc
description: Create, import, edit, inspect, export, and visually verify Doc Units in a Workspace Worktree.
---

# Workspace Doc

Load `core` first. Start a new task with `workspace_worktree_create`. Stage an existing editable Doc with `workspace_unit_add`, create a Worktree-local Doc with `workspace_unit_create`, or use `workspace_office_import` for a supported document. Confirm the stable `unitId` with `workspace_unit_list`; Blob Resources are not Units.

Use `workspace_api_find` and `workspace_api_show` before relying on a Facade signature. `workspace_content_execute` injects `doc` for the selected Unit. Use `workspace_content_inspect` for bounded structural evidence and a later read-only execution for Facade facts.

## Paragraph stream and pagination

The body is one `dataStream`. Paragraphs end with `\r`, and the document ends with `\r\n`; offsets address that stream. Preserve paragraph breaks when using range edits and retain stable paragraph IDs across steps.

Physical pagination requires a Traditional Doc. Guard page-specific work with `doc.isTraditional()` before inserting section breaks or reading effective page setup. Modern Docs are pageless and must not be padded into simulated pages.

## Formal documents and charts

For formal paginated authoring, first use `workspace_typst_compile` to review diagnostics and optional previews. Use `workspace_typst_apply` to create the Worktree-local Doc from the same Source Bundle. Treat the returned Workspace `unitId`, rather than a compiler target identifier, as the content address.

Native charts belong directly to `FDocument`. Resolve `FDocument.newChart`, build detached chart information with `doc.newChart(...)`, and insert it with `await doc.insertChart(info)`. Verify the live chart ID, anchor, type, size, title, and data in a later read-only execution.

Use `workspace_office_export` only for the authoritative Worktree Doc head. Finish with `workspace_content_inspect`, `workspace_screenshot`, and `workspace_worktree_review_url` after the Worktree is ready. Return the stable Worktree and Unit identities with the review URL.
