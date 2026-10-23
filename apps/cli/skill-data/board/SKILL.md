---
name: board
description: Create, edit, verify, open, and screenshot Board Units in a remote Univer Workspace Worktree.
---

# Workspace Board

Load `core` first. Use an explicit draft Worktree for writes and the server-returned `unitId` for content commands.
Creation also returns `resourceId` and `nodeId`; these are not substitutes for the Unit ID.

Use native editable Board elements to express the user's intent. Choose shape types, layout, spacing, colors, and
emphasis for the actual content; examples are not templates that every Board must follow.

## Start with the task

- Inspect an existing Board before editing; preserve unrelated content and deliberate manual layout.
- For a new relationship-heavy diagram, draft a compact [BoardSpec](references/board-spec.md) to preserve meaning
  before choosing geometry. Translate it through Facade APIs; it is not an SDK input or another persisted model.
- Direct edits, standalone charts, images, sticky notes, and freehand work can call their dedicated APIs without
  a spec. Do not invent graph relations just to use one.
- Read only the relevant reference below. Use `uvw skills get board` for this entrypoint and
  `uvw skills path board --json` to locate selected files; `--full` loads every reference and is unnecessary
  for ordinary tasks.

| Task                                                            | Read when needed                                     |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| Relationship planning, semantic IDs and nesting                 | [BoardSpec](references/board-spec.md)                |
| Flowcharts, activity lanes, fork/join, composite states         | [Flow and state](references/flow-state.md)           |
| Lifelines, activation bars, messages and fragments              | [Sequence](references/sequence.md)                   |
| Class/ER compartments, relation ends and cardinalities          | [Class and ER](references/class-er.md)               |
| Use cases, component interfaces, deployment/package nesting     | [Structural UML](references/uml-structure.md)        |
| Mind maps, trees, timelines and family selection                | [Mind maps](references/mind-map.md)                  |
| Tables, charts, images, sticky notes, resources, embeds and Ink | [Content selection](references/content-selection.md) |
| Endpoint selection, routing diagnostics or animation            | [Connector routing](references/connector-routing.md) |
| Multiple texts, label sizing, wrapping or placement             | [Connector labels](references/connector-labels.md)   |
| Explicit multi-profile coverage or UI regression testing        | [Diagram review](references/diagram-review.md)       |

The profile narrows the search, not the design. Mix native primitives where the intent warrants it; no fixed node
size, layout direction, color palette, or animation count is required.

## Work through the installed API

Create a Board only when a new unit is needed; retain its returned unit ID:

```bash
uvw unit create --worktree <id> --space <space-id> --type board --name "Planning Board" --json
uvw inspect board --worktree <id> --unit <board-id> --json
uvw api show FBoard.insertShape FBoard.insertConnector
```

`inspect board` is a selector-free overview. `inspect board-element id:<element-id> ...` gives type-specific
detail without the full snapshot. Both are read-only. Query only the Facade methods/types needed for the next
operation with `api find` / `api show`, rather than loading the entire capability catalog.

`execute` predefines `univerAPI`, `api`, and the `FBoard` named `board`; do not redeclare them. The installed
SDK is authoritative: before a large batch, probe selected runtime methods/enums in a read-only call if their
availability is uncertain. An indexed type alone does not establish runtime support. Do not invent parameters or
upgrade dependencies to match a reference; report unavailable capabilities or explain a semantics-preserving fallback.

```bash
uvw execute --worktree <id> --unit <board-id> -e '
const shape = board.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.RoundRect,
  transform: { left: 80, top: 80, width: 180, height: 100 }
});
if (!shape) throw new Error("Cannot insert Board shape");
shape.getText().setText("Review");
return { shapeId: shape.getId(), elements: board.describeElements() };'
```

`insertShape` takes geometry in `transform`, visual properties in `shapeData`, and text through the returned
live handle—not top-level `id`, coordinates, or `text`. Retain generated IDs and map semantic IDs to them.
Await asynchronous operations according to their installed signatures before dependent calls or readback.

Create and arrange nodes before their connectors. Use element-bound endpoints; for ordinary automatic connections,
start with `fromElementId` / `toElementId` and omit sides/routing overrides. Introduce explicit ports or routes for
diagram semantics or a diagnosed layout problem, not guessed pixel endpoints. Native map branches belong to their
layout owner. Sequence messages need the lifeline/activation rules in their reference.

Create known parents before children. Direct insertion into a parent uses parent-local coordinates;
`insertShapeAtPoint()` resolves a Board-world top-left point. Read back `parentId`, `laneId` and world bounds:
a shape drawn inside a box is not necessarily its child.

## Verify in proportion to the change

For a generated diagram, follow intent → spec when useful → layout decisions → Facade calls → check → targeted repair:

1. Read back persisted elements/text, ownership and bindings with `describeElements()`, `getElements()`, or
   type-specific inspection. Check the requested meaning, not only counts.
2. Run `uvw lint --worktree <id> --unit <board-id> --mode model --json` for a browser-free model check;
   use `--trunk` instead of `--worktree` to inspect shared content without creating a draft.
   finish with the default `--mode both` and a full `uvw screenshot ... --json`. Inspect the report's `status`,
   `coverage`, raw `analyses`, the image and `outputs[0].layoutAnalysis`. `incomplete` is a blocker to claiming
   clean layout; model checks cannot establish final font metrics or automatic routes.
3. Repair implicated elements and recapture. Use [routing](references/connector-routing.md) or
   [label](references/connector-labels.md) guidance for their diagnostics. Never silently discard semantics to pass.
4. Hand off an overview and any needed readable details. Distinguish clean results, visually reviewed diagnostic
   exceptions, and blockers; command success alone is not visual verification.

For a localized edit, inspect the changed region and affected relationships; do not regenerate the Board or run
an unrelated profile matrix. Full drag/menu/Undo/Redo testing belongs to explicit interaction or coverage requests,
not every authoring task. A static screenshot does not prove UI behavior.

For requested automatic layout, inspect `FBoard.planGraphLayout` and `FBoard.applyLayoutPlan` in the installed
API. Planning is read-only: review its diagnostics and proposed patches before applying a ready plan to the
same Board/page. Preserve fixed elements, manual connectors and native structured-layout owners. A stale or
incomplete plan must be recomputed or reported; never force-apply it or replace the Board snapshot.

For measured label repair, run `uvw lint --worktree <id> --unit <board-id> --mode both --plan-labels --json`.
This remains read-only. Read `analyses[].labelPlan` in the report (on failure, `error.details.report` on stderr).
An empty `patches` array needs no write. For a non-empty plan, check that it is ready and
`plan.pageId === board.getActivePageId()`, then pass that exact plan to `board.applyLayoutPlan(plan)`
through `execute` on the same Worktree/Unit/current page. Report other-page plans as unapplied; use only an
installed, supported page-selection API if one is available. Check the boolean result. A stale rejection requires a fresh lint;
an incomplete or unavailable plan requires resolving its diagnostics. Run lint and capture again after apply.
For endpoint constraints or `label-layout/no-free-position`, follow the [label spacing repair](references/connector-labels.md#verification-and-repair):
keep the same selection, fixed elements and direction, increase graph `layerGap` for movable nodes with automatic
endpoints, then obtain a fresh rendered label plan. Preserve manual/native constraints and report any remaining incomplete result.

```bash
uvw screenshot --worktree <id> --unit <board-id> --out ./board-overview --json
uvw browse <n> -R <repo> --unit <board-id>
```

Board has no supported Office import/export format. Keep merge and discard user-authorized as described by `core`.
