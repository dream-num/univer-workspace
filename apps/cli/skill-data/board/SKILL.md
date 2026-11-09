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
- Read only the relevant reference of the `board` Skill below. The `core` Skill explains how to load it. Loading every reference is unnecessary for ordinary tasks.

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

Run `unit create` with type `board`, name `Planning Board`, and the destination Space in the task Worktree. Run `inspect` with target `board` for its Unit, and use `api show` for `FBoard.insertShape` and `FBoard.insertConnector`.

`inspect` with target `board` is a selector-free overview. `inspect` with target `board-element` and one or more `id:<element-id>` selectors gives type-specific
detail without the full snapshot. Both are read-only. Query only the Facade methods/types needed for the next
operation with `api find` / `api show`, rather than loading the entire capability catalog.

`execute` predefines `univerAPI`, `api`, and the `FBoard` named `board`; do not redeclare them. The installed
SDK is authoritative: before a large batch, probe selected runtime methods/enums in a read-only call if their
availability is uncertain. An indexed type alone does not establish runtime support. Do not invent parameters or
upgrade dependencies to match a reference; report unavailable capabilities or explain a semantics-preserving fallback.

Pass this code to `execute` for the Unit in its Worktree:

```js
const shape = board.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.RoundRect,
  transform: { left: 80, top: 80, width: 180, height: 100 }
});
if (!shape) throw new Error("Cannot insert Board shape");
shape.getText().setText("Review");
return { shapeId: shape.getId(), elements: board.describeElements() };
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

## Choose an explicit layout plan

Check whether the installed `lint` supports plan selection and use `api show` for `FBoard.planLayout` and
`FBoard.applyLayoutPlan`. For example, request a `routes` plan in rendered mode for the selected page and
connector IDs `edge-a` and `edge-b`. See the client's `core` Skill for command syntax.

Use `graph` for a new ordinary diagram whose nodes may move. Use `routes` to coordinate paths while keeping frames
and ports, `ports` for automatic endpoint positions, `labels` for caption placement, or `text` for measured frame
growth. Pass generated IDs for the active page. Human editing uses individual routes. Native structured layout
owners and authored geometry remain authoritative.

Read `analyses[].plan` from the lint report, including the report attached to a lint failure. The plan is read-only
and needs a render runtime with fonts ready. Apply a ready, non-empty plan in the draft through
`board.applyLayoutPlan(plan)` after checking the page ID. If the call returns false, obtain a fresh plan.
For an incomplete plan, resolve the reported IDs, ownership, resource or spacing constraint before retrying.
Capture a fresh screenshot and lint again. If the installed tool lacks the option, use its documented supported
planning capabilities and report any mode that is unavailable.

## Verify in proportion to the change

For a generated diagram, follow intent → spec when useful → layout decisions → Facade calls → check → targeted repair:

1. Read back persisted elements/text, ownership and bindings with `describeElements()`, `getElements()`, or
   type-specific inspection. Check the requested meaning, not only counts.
2. Run Board `lint` in `model` mode for a browser-free check, then use `both` mode and capture a full screenshot
   with structured results. Use trunk scope for read-only checks of shared content. If the client cannot lint
   a Board, run `board.analyzeModelLayout(48)` and inspect the rendered screenshot separately. Review the report
   status, coverage, raw `analyses`, image, and `outputs[0].layoutAnalysis` where available. Resolve incomplete
   coverage before claiming a clean layout. Model checks cannot establish final font metrics or automatic routes.
3. Repair implicated elements and recapture. Use [routing](references/connector-routing.md) or
   [label](references/connector-labels.md) guidance for their diagnostics. Never silently discard semantics to pass.
4. Hand off an overview and any needed readable details. Distinguish clean results, visually reviewed diagnostic
   exceptions, and blockers; command success alone is not visual verification.

For automatic crossings, excessive detours or distant automatic captions, use the installed port planning
option in both mode when available. Read `analyses[].portPlan` and the original findings. Apply one ready,
non-empty plan through `FBoard.applyLayoutPlan` on the same current page; then lint a fresh snapshot before requesting label repairs.
For a distance finding, also set the maximum automatic label distance to 12 when supported. An empty plan does
not resolve the finding; report ineligible ownership or missing support rather than forcing ports to automatic.
Missing/incomplete planning remains incomplete. Preserve authored ports/routes, node frames and native ownership.
See [port and label repair](references/connector-labels.md#verification-and-repair) and review arrowheads in screenshots.

For new ordinary generated shapes, check whether the installed `lint` supports text planning. When available, request only
the generated shape IDs in rendered or both mode, inspect `analyses[].textPlan`, and apply a ready current plan through the headless Facade. Missing or incomplete support remains unresolved. Replan, fit and
remeasure after sizing; preserve all text, fonts and authored/native ownership. See the
[native text sizing procedure](references/board-spec.md) before applying a batch.

If the installed text planner supports a width growth factor, choose a value from 1 to 2. Use 1 to keep the
original width. For long or bilingual generated text, start with 1.25 and adjust using complete coverage and
screenshots. Preserve complete text and font sizes.

For a localized edit, inspect the changed region and affected relationships; do not regenerate the Board or run
an unrelated profile matrix. Full drag/menu/Undo/Redo testing belongs to explicit interaction or coverage requests,
not every authoring task. A static screenshot does not prove UI behavior.

For an explicit automatic-label proximity check, set the maximum automatic label distance to 12 in
rendered or both mode. It is opt-in, accepts finite non-negative Board units including zero,
and preserves authored/fixed and endpoint-role labels. Missing native support or unresolved distance makes
coverage incomplete; exceeded limits are lint errors. Read the native receipt/status and screenshots;
the metric is a sampled, marker-trimmed stroke-centerline distance, not raster ink. This check never repairs.

For measured label repair, request a label plan in both mode for the Board in its Worktree. Planning is read-only.
Read `analyses[].labelPlan` in the report, including the report attached to a lint failure.
An empty `patches` array needs no write. For a non-empty plan, check that it is ready and
`plan.pageId === board.getData().activePageId`, then pass that exact plan to `board.applyLayoutPlan(plan)`
through `execute` on the same Worktree/Unit/current page. Report other-page plans as unapplied; use only an
installed, supported page-selection API if one is available. Check the boolean result. A stale rejection requires a fresh lint;
an incomplete or unavailable plan requires resolving its diagnostics. Run lint and capture again after apply.
For endpoint constraints or `label-layout/no-free-position`, follow the [label spacing repair](references/connector-labels.md#verification-and-repair):
keep the same selection, fixed elements and direction, increase graph `layerGap` for movable nodes with automatic
endpoints, then obtain a fresh rendered label plan. Preserve manual/native constraints and report any remaining incomplete result.

Run `screenshot` for the Board Unit in its Worktree, then `browse` for its review link. Follow the `core` Skill for output handling.

Board has no supported Office import/export format. Keep merge and discard user-authorized as described by `core`.
