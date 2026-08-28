---
name: univer-board
description: Discover Univer Board Units and read their Workspace status through univer_open, univer_documents, and univer_status; Board Viewer and authoring remain beta-limited until their preset is verified.
---

# Univer Board Units

The Workspace API can expose a Board Unit in Space and status data can be read.
The current in-page Viewer and Board authoring preset are beta-limited, so this
Skill does not authorize an edit or preview claim for `board`.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Board and confirm its `unitType`, `unitId`, and
access mode. Keep the returned ids and stop when a Viewer or authoring
operation reports `unsupported`/unavailable.

`univer_execute` exists in the shared tool registry, but its Board Facade path
is not verified in this profile; do not report a Board mutation as successful
until the Board preset passes the Viewer gate.
