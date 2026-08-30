# Univer Workspace core workflow

Operate the user's remote Univer Workspace only through the available `workspace_*` tools. Keep
Space, Node, Resource, Worktree, and Unit identities distinct. Discover by name or path, then retain
the returned stable IDs for every mutation.

## Authentication

Use `workspace_auth_whoami` before remote work. If authentication is missing, call
`workspace_auth_start` with the user's Workspace origin, relay its verification URL and code, and
wait for browser approval. Call `workspace_auth_complete` once after approval; never poll. Call
`workspace_auth_logout` only when the user asks to disconnect.

## Discover content

1. Use `workspace_space_list` to find a Space.
2. Use `workspace_space_find` for a name search or `workspace_space_browse` for hierarchy context.
3. Compare `spaceId`, `nodeId`, `resourceId`, path, Resource kind, and Unit type. Ask when matches
   remain ambiguous.

Node create, rename, move, and Trash are direct Workspace writes. They are not isolated by a
Worktree. After an aborted or `workspace-result-unknown` mutation, inspect with Space browse or
find and never replay blindly.

## Worktree rule

Start every new task in a new Worktree with `workspace_worktree_create`. Do not reuse a Worktree
because its name or Units look related. Reuse a known Worktree only for rework on the same task:

- continue a `draft` Worktree directly;
- call `workspace_worktree_reopen` before reworking a `ready` Worktree;
- never reuse `merged` or `discarded` Worktrees.

Use a user Worktree for editable Resources across Spaces. Use a Space Worktree only for one Team
Space, with its stable `space_id`.

## Prepare Units

For an existing Univer Resource, call `workspace_unit_add` with its `resourceId`. For a new Sheet,
Doc, Slide, Base, or Board, call `workspace_unit_create` with the target Space, name, and optional
parent Node. Retain the returned `worktreeId`, `unitId`, `resourceId`, and `nodeId`. Confirm the
membership with `workspace_unit_list`.

## Review and handoff

1. Call `workspace_worktree_ready` when the task's draft is ready for human review.
2. Read it back with `workspace_worktree_get` and confirm state `ready`.
3. Call `workspace_worktree_review_url`; provide `unit_id` when the Worktree has zero or multiple
   Units.
4. Return the authenticated-origin review URL to the user.

Call `workspace_worktree_merge` or `workspace_worktree_discard` only after the user explicitly
requests that exact terminal operation. Never infer merge from approval to review. If any write is
aborted or returns `workspace-result-unknown`, inspect with Worktree get/list or Unit list before
deciding the next action, and never replay automatically.
