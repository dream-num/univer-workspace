---
name: univer-doc
description: Discover Univer Doc Units and read their Workspace status through univer_open, univer_documents, and univer_status; Doc Viewer and authoring remain beta-limited until their preset is verified.
---

# Univer Doc Units

The Workspace API can expose a Doc Unit in Space and status data can be read.
The current in-page Viewer and Doc authoring preset are beta-limited, so this
Skill does not authorize an edit or preview claim for `doc`.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Doc and confirm its `unitType`, `unitId`, and
access mode. Keep the returned ids and stop when the result is
`unsupported`/unavailable for a Viewer or authoring operation.

`univer_execute` exists in the shared tool registry, but its Doc Facade path is
not verified in this profile; do not report a Doc mutation as successful until
the Doc preset passes the Viewer gate.
