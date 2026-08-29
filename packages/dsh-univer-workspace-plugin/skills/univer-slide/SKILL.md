---
name: univer-slide
description: Discover Univer Slide Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Slide Viewer and authoring remain beta-limited.
---

# Univer Slide Units

The Workspace API can expose a Slide Unit in Space. Its identity/status and
minimal Facade read path are verified through `univer_open`, `univer_status`,
and `univer_edit` mode `read`. The in-page Viewer and Slide authoring/write
preset remain beta-limited, so do not claim a Slide mutation as successful.

## Verified actions

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to discover a Slide and confirm its `unitType`, `unitId`, and
access mode. You may then use `univer_edit` mode `read` for a minimal Facade
value. Keep the returned ids and stop when a Viewer or authoring operation
reports `unsupported`/unavailable.

`univer_execute` exists in the shared tool registry, but its Slide Facade path
is not verified in this profile; do not report a Slide mutation as successful
until the Slide preset passes the Viewer gate.
