---
name: univer-base
description: Discover Univer Base Units and read their Workspace status through univer_open, univer_documents, and univer_status; Base Viewer and authoring remain beta-limited until their preset is verified.
---

# Univer Base Units

The Workspace API can expose a Base Unit in Space and status data can be read.
The current in-page Viewer and Base authoring preset are beta-limited, so this
Skill does not authorize an edit or preview claim for `base`.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Base and confirm its `unitType`, `unitId`, and
access mode. Keep the returned ids and stop when a Viewer or authoring
operation reports `unsupported`/unavailable.

`univer_execute` exists in the shared tool registry, but its Base Facade path
is not verified in this profile; do not report a Base mutation as successful
until the Base preset passes the Viewer gate.
