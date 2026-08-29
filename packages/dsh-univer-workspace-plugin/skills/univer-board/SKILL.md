---
name: univer-board
description: Discover Univer Board Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Board structured inspection, Viewer, and authoring remain beta-limited.
---

# Univer Board Units

The Workspace API can expose a Board Unit in Space. Its identity/status and
minimal Facade read path are verified through `univer_open`, `univer_status`,
and `univer_edit` mode `read`. Structured `univer_inspect` currently returns
an explicit unsupported-capability result for Board; the in-page Viewer and
Board authoring/write preset remain beta-limited.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Board and confirm its `unitType`, `unitId`, and
access mode. You may then use `univer_edit` mode `read` for a minimal Facade
value. Keep the returned ids and stop when a Viewer or authoring operation
reports `unsupported`/unavailable.

`univer_execute` exists in the shared tool registry, but its Board Facade path
is not verified in this profile; do not report a Board mutation as successful
until the Board preset passes the Viewer gate.
