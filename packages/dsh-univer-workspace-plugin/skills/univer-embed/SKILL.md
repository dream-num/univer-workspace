---
name: univer-embed
description: Inspect Workspace Unit metadata for an embed request; embed authoring and rendering are beta-limited and must not be reported as verified through the current univer_ tools.
---

# Embed Units

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to confirm the host and child Unit identities and their five
possible types: `sheet`, `doc`, `slide`, `base`, and `board`.

The current Workspace profile has no verified embed authoring/rendering
contract. `univer_execute` is present for the shared Facade surface, but do
not call an embed complete or claim a rendered result until the Viewer/embed
gate is passed.
