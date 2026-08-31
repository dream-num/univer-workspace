---
name: base
description: Create, edit, verify, screenshot, import, and export Base Units in a Workspace Worktree.
---

# Workspace Base

Load `core` first. Start a new task with `workspace_worktree_create`. Stage an existing editable Base with `workspace_unit_add`, or create a Worktree-local Base with `workspace_unit_create`. Confirm the selected `unitId` with `workspace_unit_list`; Blob Resources are not Units.

Use `workspace_api_find` and `workspace_api_show` before relying on a Facade signature. Author and read Base content with `workspace_content_execute`. The runtime does not inject a `base` variable. Resolve the selected Unit explicitly:

```js
const unitId = "<selected-unit-id>";
const base = api.getBase(unitId);
if (!base) throw new Error("Base not found");
```

Base has no native inspection target. Run a later read-only execution for model evidence rather than inventing one.

## Table formulas

Use `table.getFormulaName()` for the real OOXML table identifier. `Table[[#This Row],[Column]]` reads the formula record's row; `Table[[#Data],[Column]]` reads the complete data column. Do not replace either scope with a display name or generic `table` placeholder. After a formula write, wait for calculation and use a later `workspace_content_execute` call to read the computed record values.

## Attachments

Write local image attachments through `record.setAttachments()` and declare `sourceType: api.Enum.ImageSourceType.BASE64`. Keep the original data URI in `source`. In a later execution, read `record.getValues()[field.getId()]` and verify the stored attachment identity.

Use `workspace_office_import` to create an editable Base from a supported Office file and `workspace_office_export` for a compatible Worktree Base head. Finish by calling `workspace_screenshot`, then `workspace_worktree_review_url` after the Worktree is ready. Return the stable Worktree and Unit identities with the review URL.
