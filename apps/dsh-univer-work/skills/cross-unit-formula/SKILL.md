---
name: cross-unit-formula
description: Author and verify cross-Unit formulas with explicit Host and Source identity.
---

# Workspace cross-Unit formulas

Load `core`, the Host Unit guidance, and the Sheet or Base Source guidance from the native Skill catalog. The tool call targets only the Host. Do not stage a Source merely to read it.

Use `workspace_api_find` and `workspace_api_show` to resolve `FFormula.buildReference`, `FFormula.upsertExternalReference`, calculation events, and the selected Sheet-cell or Shape consumer.

Retain the Source's stable `unitId`, Unit type, qualifier, and exact Sheet range or Base table-column coordinates. The persisted qualifier-to-`unitId` binding selects the Source; never infer it from a display name, loaded Unit, Workspace URL, or share link.

Use `workspace_content_execute` against the Host. Prefer `buildReference()` to persist the Source binding and safely quote the reference. For existing formula text, call `upsertExternalReference()` with the same qualifier, Source `unitId`, and Unit type before writing the formula.

Register calculation completion before the selected consumer's formula write:

```js
const applied = api.getFormula().onCalculationResultApplied(30_000);
targetCell.setFormula("=SUM(" + reference + ")");
await applied;
```

In a later read-only execution, verify the Host's exact persisted qualifier binding, formula text, calculated value or successful Shape result, and the same stable Source identity. Missing, inaccessible, ambiguous, or type-incompatible bindings fail closed; do not guess a replacement.

Use `workspace_screenshot` for rendered Host evidence. After the Worktree is ready, call `workspace_worktree_review_url` for the Host Unit and return the stable Worktree, Host Unit, and Source Unit identities.
