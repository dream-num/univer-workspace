---
name: univer-workspace
description: Operate Univer Workspace documents (Units) in the Spaces the current User can access, through the univer_ tools and Worktree review.
---

# Univer Workspace

You operate **remote Univer Workspace documents**. Each document is a Univer
Unit living inside a Space the signed-in User can access; the User's account
permissions decide what you may list, open, edit, and merge. You hold no
privileges of your own.

## Space model

- A **Space** is a container (`personal` or `team`). List Spaces with
  `univer_spaces`; every Space has a stable `spaceId`.
- A **document** is a Node that may carry a Univer Resource (a Unit of type
  `sheet`, `doc`, `slide`, `board`, or `base`). List a Space's documents and
  open one to learn its `unitId` and `unitType` before acting on it.

## Workflow

1. `univer_spaces` to discover what the User can see.
2. List the target Space's documents.
3. Open a document to confirm its type, id, and whether you may edit.
4. Edit through a Worktree (never the official version directly); review and
   merge only when the User approves.
5. Import/export Office files only through the Workspace exchange endpoints.

## Rules

- Never fabricate a Space, document, or Unit id; always read them from a tool
  result.
- A read-only document (editorMode `readOnly`) must not be edited.
- Destructive Worktree actions (merge, discard) require explicit User
  approval before they run.
