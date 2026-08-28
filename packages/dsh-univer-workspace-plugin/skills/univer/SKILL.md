---
name: univer
description: Operate remote Univer Workspace Units with the verified Sheet workflow through the univer_ tools. Use proactively for Space and document discovery, Worktree review, Facade reads and writes, import/export, and explicit status handoff; Doc, Slide, Base, and Board metadata is discoverable, but their Viewer and authoring paths remain beta-limited.
---

# Univer Workspace Units

The Workspace product is the authority for Spaces, Nodes, Resources, Units,
and Worktrees. Start from the current agent's authenticated Space and retain
the ids returned by tools; never fabricate an id or assume a Unit belongs to a
session.

## Current capability boundary

The remote contract recognizes five Unit types: `sheet`, `doc`, `slide`,
`base`, and `board`. The current profile has a verified embedded Viewer and
Facade workflow only for `sheet`. The other four types may be discovered and
identified, but their in-page Viewer/authoring paths are beta-limited and must
be reported as unsupported rather than as a successful preview or edit.

## Available tools

- Discovery: `univer_spaces`, `univer_documents`, `univer_list`, and
  `univer_open`.
- Status and review: `univer_status` and `univer_worktree`.
- Verified Sheet execution: `univer_edit`, `univer_inspect`, and
  `univer_execute`.
- Creation and exchange: `univer_new`, `univer_create`, `univer_unit`,
  `univer_import`, and `univer_export`.
- SDK/resource lookup: `univer_api` and `univer_resources`.

Render/lint evidence is outside the current verified tool set; do not invent a
call for it or claim evidence that the profile did not produce.

## Required workflow

1. Call `univer_spaces`, choose an accessible Space, then list its Nodes and
   open the selected Resource to confirm `unitType`, `unitId`, and
   `editorMode`.
2. For a write, create or select a draft with
   `univer_worktree action=create`. Keep trunk read-only and publish only
   through the explicit `ready`/`merge` review flow with user approval.
3. For a verified Sheet, use the Facade bindings supplied by
   `univer_edit`/`univer_execute`: `univerAPI` (also `api`) and `workbook`.
   Read the changed values back before reporting completion.
4. Import into an explicit draft Worktree and export only to a session-relative
   output path. A Worktree-local Unit is not published until review succeeds.

`univer_execute` accepts exactly one inline `code` or session-relative
`codeFile`; paths outside the session workspace are rejected. A read-only
Resource or a Unit outside the linked Space must not be edited.
