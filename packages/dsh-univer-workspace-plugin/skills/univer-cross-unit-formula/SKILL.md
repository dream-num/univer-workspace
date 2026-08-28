---
name: univer-cross-unit-formula
description: Inspect Workspace Unit metadata for a cross-Unit formula request; cross-Unit formula authoring and calculation are beta-limited and must not be reported as verified through the current univer_ tools.
---

# Cross-Unit formulas

Use `univer_spaces`, `univer_documents` (or `univer_list`), `univer_open`, and
`univer_status` to identify the host and source Units. The Workspace contract
recognizes `sheet`, `doc`, `slide`, `base`, and `board`, but the current profile
has no verified cross-Unit formula authoring/calculation path.

`univer_execute` is present for the shared Facade surface; do not report a
formula write, recalculation, or cross-Unit result as successful until that
contract is verified end to end.
