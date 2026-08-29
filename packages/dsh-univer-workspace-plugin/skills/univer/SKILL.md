---
name: univer
description: Operate remote Univer Workspace Units through the univer_ tools. Use proactively for Space and document discovery, Worktree review, Facade reads, verified Sheet writes, import/export, and explicit status handoff; Doc, Slide, Base, and Board write/Viewer paths remain beta-limited.
---

# Univer Workspace Units

The Workspace product is the authority for Spaces, Nodes, Resources, Units,
and Worktrees. Start from the current agent's authenticated Space and retain
the ids returned by tools; never fabricate an id or assume a Unit belongs to a
session.

## Current capability boundary

The remote contract recognizes five Unit types: `sheet`, `doc`, `slide`,
`base`, and `board`. The current profile has a verified `univer_open` and
Facade read workflow for all five types. The Sheet embedded Viewer and
Worktree write path are verified. Structured inspection is verified for
Sheet/Doc/Slide; Board/Base must report the explicit
`does not support structured inspection` capability result. Board/Base and
non-Sheet Viewer/authoring paths remain beta-limited and must not be claimed
as successful without fresh evidence.

## Available tools

- Discovery: `univer_spaces`, `univer_documents`, `univer_list`, and
  `univer_open`.
- Status and review: `univer_status` and `univer_worktree`.
- Facade execution: `univer_edit` mode `read` for all five types; mode
  `write` and `univer_execute` are verified for Sheet Worktree drafts.
- Structured inspection: `univer_inspect` for Sheet/Doc/Slide; Board/Base
  return an explicit unsupported-capability result.
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
3. For Facade reads, use the bindings supplied by `univer_edit`:
   `univerAPI` (also `api`) and the Unit-specific object, and report the
   returned value. For a Sheet write, use a Worktree draft and read the
   changed values back before reporting completion. For other types, do not
   infer write or Viewer support from a successful `univer_open`.
4. Import into an explicit draft Worktree and export only to a session-relative
   output path. A Worktree-local Unit is not published until review succeeds.

`univer_execute` accepts exactly one inline `code` or session-relative
`codeFile`; paths outside the session workspace are rejected. A read-only
Resource or a Unit outside the linked Space must not be edited.
