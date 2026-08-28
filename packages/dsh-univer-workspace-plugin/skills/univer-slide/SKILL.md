---
name: univer-slide
description: Discover Univer Slide Units and read their Workspace status through univer_open, univer_documents, and univer_status; Slide Viewer and authoring remain beta-limited until their preset is verified.
---

# Univer Slide Units

The Workspace API can expose a Slide Unit in Space and status data can be read.
The current in-page Viewer and Slide authoring preset are beta-limited, so this
Skill does not authorize an edit or preview claim for `slide`.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Slide and confirm its `unitType`, `unitId`, and
access mode. Keep the returned ids and stop when a Viewer or authoring
operation reports `unsupported`/unavailable.

`univer_execute` exists in the shared tool registry, but its Slide Facade path
is not verified in this profile; do not report a Slide mutation as successful
until the Slide preset passes the Viewer gate.
