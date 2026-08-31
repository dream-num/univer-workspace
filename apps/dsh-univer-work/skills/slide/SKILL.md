---
name: slide
description: Create, import, edit, inspect, generate, export, and visually verify Slide Units in a Workspace Worktree.
---

# Workspace Slide

Load `core` first. Start a new task with `workspace_worktree_create`. Stage an existing editable Slide with `workspace_unit_add`, create a Worktree-local Slide with `workspace_unit_create`, or use `workspace_office_import` for a supported deck. Confirm the stable `unitId` with `workspace_unit_list`; Blob Resources are not Units.

Use `workspace_api_find` and `workspace_api_show` before relying on a Facade signature. `workspace_content_execute` injects `presentation` for the selected Unit, and `workspace_content_inspect` returns bounded presentation facts.

Tool page selectors are one-based; Facade indexes such as `presentation.getSlideByIndex(0)` are zero-based. Prefer stable page IDs when moving between tool output and Facade code.

## SVG generation and resources

New or reworked pages use `workspace_svg_compile` for read-only generation and `workspace_svg_apply` for the exact Draft Slide mutation. Rework replaces the complete page from its corrected SVG; never repair a page by overlaying a second copy of its old elements.

Discover built-in assets with `workspace_resource_registries` and `workspace_resource_find`, then publish stable handles with `workspace_resource_export`. Keep exported SVG resources as files referenced by the page source. Do not copy partial path data or replace a handle with a display label.

## Native charts

Native charts belong directly to `FSlide`. Resolve `FSlide.newChart`, reserve its rectangle in the SVG, build detached chart information with `slide.newChart(...)`, and insert it with `await slide.insertChart(info)` after the final page replacement. Verify the live chart ID, type, position, size, title, and data in a later read-only execution.

## Verification

Use `workspace_layout_lint` on every affected page and resolve or explicitly justify each finding. Then use `workspace_screenshot` for final rendered evidence of every page. Use `workspace_office_export` only after logical and visual verification of the authoritative Worktree head.

After the Worktree is ready, call `workspace_worktree_review_url`. Return the stable Worktree and Unit identities with the review URL.
