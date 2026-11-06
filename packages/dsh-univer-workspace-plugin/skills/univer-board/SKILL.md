---
name: univer-board
description: Create, edit, chart, inspect, and review Univer Board canvas Units through DSH tools and the Lite Interface. Use proactively for Board shapes, text, connectors, routing, images, native charts, diagrams, canvas layout, or any Board Unit task.
---

# Univer Board Units

Load `univer` first. Use an explicit draft worktree for writes and retain the Board `unitId` returned by `univer_unit`. The Board is a remote Workspace Unit; Resource and Node IDs are not content Unit IDs.

Use native editable Board elements to express the user's intent. Choose shape types, layout, spacing, colors, and
emphasis for the actual content; examples are not templates that every Board must follow.

## Start with the task

- Inspect an existing Board before editing; preserve unrelated content and deliberate manual layout.
- For a new relationship-heavy diagram, draft a compact [BoardSpec](references/board-spec.md) to preserve meaning
  before choosing geometry. Translate it through Facade APIs; it is not an SDK input or another persisted model.
- Direct edits, standalone charts, images, sticky notes, and freehand work can call their dedicated APIs without
  a spec. Do not invent graph relations just to use one.
- Read only the relevant reference below through `univer_skill_resource`, with
  `skill: "univer-board"` and its listed `path` (for example `references/board-spec.md`).
  These are bundled resource identifiers, not session or installation paths; no Shell/file-reading tool is needed.

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

Create a Board with `univer_unit` only when a new Unit is needed. Use `univer_inspect` with its `unitId` and `unitType: "board"`
for a read-only overview. For selected elements, use `univer_edit` with `mode: "read"` and
`board.describeElements()` or `board.getElements()`; this inspect tool has no `elementIds` parameter.
Discover existing IDs before editing.

Use `univer_api` with `find` / `show` to query only the Facade methods/types needed for the next operation.
`univer_execute` predefines `univerAPI`, `api`, and the selected `FBoard` as `board`; do not redeclare them. The installed
SDK is authoritative: before a large batch, probe selected runtime methods/enums in a read-only call if their
availability is uncertain. An indexed type alone does not establish runtime support. Do not invent parameters or
upgrade dependencies to match a reference; report unavailable capabilities or explain a semantics-preserving fallback.

Run this code through `univer_execute` with `unitType: "board"`, the Board `unitId`, and its draft `worktreeId`:

```js
const shape = board.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.RoundRect,
  transform: { left: 80, top: 80, width: 180, height: 100 },
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

## Verify in proportion to the change

For a generated diagram, follow intent → spec when useful → layout decisions → Facade calls → check → targeted repair:

1. Read back persisted elements/text, ownership and bindings with `describeElements()`, `getElements()`, or
   `univer_edit` with `mode: "read"`. Check the requested meaning, not only counts.
2. Run `univer_lint` with `unitType: "board"` and `mode: "model"` for a browser-free model check;
   finish with `mode: "both"` (the default) and a full `univer_screenshot`. Inspect the report's `status`,
   `coverage`, raw `analyses`, the image and each image's `metadata.layoutAnalysis`. `incomplete` is a blocker
   to claiming clean layout; model checks cannot establish final font metrics or automatic routes.
3. Repair implicated elements and recapture. Use [routing](references/connector-routing.md) or
   [label](references/connector-labels.md) guidance for their diagnostics. Never silently discard semantics to pass.
4. Hand off an overview and any needed readable details. Distinguish clean results, visually reviewed diagnostic
   exceptions, and blockers; command success alone is not visual verification.

For automatic crossings, excessive detours or distant automatic captions, inspect the installed `univer_lint`
schema for `includePortPlan`. When supported,
request `includePortPlan: true` with `unitType: "board"` and `mode: "both"` on the intended Worktree.
Read `analyses[].portPlan` and the unchanged original findings. Apply only one ready non-empty plan through
`FBoard.applyLayoutPlan` on the same current page; then lint a fresh snapshot before requesting label repairs.
For a distance finding, also request `maximumAutomaticLabelDistance: 12` when supported. An empty plan does not
resolve the finding; report ineligible ownership or missing support rather than forcing ports to automatic.
Missing/incomplete planning remains incomplete. Preserve authored ports/routes, node frames and native ownership.
See [port and label repair](references/connector-labels.md#verification-and-repair) and review arrowheads in screenshots.

For new ordinary generated shapes, inspect the installed `univer_lint` tool schema first. Only when it
exposes `textPlanElementIds`, request that explicit generated selection in rendered/both mode, retain
`analyses[].textPlan`, and apply a ready current plan through the Facade. Report missing support instead of
sending unsupported arguments or guessing ordinary shape heights. Replan, fit and remeasure; preserve
all text, fonts and authored/native ownership. See the [native text sizing procedure](references/board-spec.md).

If the installed schema also exposes `textPlanMaximumWidthGrowth`, use it with `textPlanElementIds` to bound
horizontal growth from 1 to 2; 1 keeps the original width. For long or bilingual generated text, start with 1.25
and adjust using complete coverage and screenshots. Preserve complete text, fonts and incomplete findings;
never send the option to an unsupported version or fall back to guessed dimensions.

For a localized edit, inspect the changed region and affected relationships; do not regenerate the Board or run
an unrelated profile matrix. Full drag/menu/Undo/Redo testing belongs to explicit interaction or coverage requests,
not every authoring task. A static screenshot does not prove UI behavior.

For requested automatic layout, inspect `FBoard.planGraphLayout` and `FBoard.applyLayoutPlan` in the installed
API. Run planning through `univer_edit` with `mode: "read"`: review its diagnostics and proposed patches before
applying a ready plan through `univer_execute` to the same Board/page. Preserve fixed elements, manual connectors
and native structured-layout owners. A stale or incomplete plan must be recomputed or reported; never
force-apply it or replace the Board snapshot.

For an explicit automatic-label proximity check, call `univer_lint` with `unitType: "board"`,
`mode: "rendered"` or `"both"`, and `maximumAutomaticLabelDistance: 12`. The opt-in value must be finite and
non-negative; zero is valid. Missing native support or unresolved distance makes coverage incomplete, and
exceeded limits are errors. Preserve fixed/authored and endpoint-role labels. Read native receipt/status and
screenshots; this sampled, marker-trimmed stroke-centerline metric is not raster ink and never repairs labels.

For measured label repair, call `univer_lint` with `unitType: "board"`, `mode: "both"` and
`includeLabelPlan: true`. The check remains read-only. An empty `patches` array needs no write.
For a non-empty plan, check that `analyses[].labelPlan` is ready and
`plan.pageId === board.getActivePageId()`, then pass that exact plan to `board.applyLayoutPlan(plan)`
through `univer_execute` on the same Worktree/Unit/current page. Report other-page plans as unapplied; use only an
installed, supported page-selection API if one is available. Check the boolean result. A stale rejection requires a fresh lint; an incomplete or
unavailable plan requires resolving its diagnostics. Lint and screenshot again after application.
For endpoint constraints or `label-layout/no-free-position`, follow the [label spacing repair](references/connector-labels.md#verification-and-repair):
keep the same selection, fixed elements and direction, increase graph `layerGap` for movable nodes with automatic
endpoints, then obtain a fresh rendered label plan. Preserve manual/native constraints and report any remaining incomplete result.

Call `univer_screenshot` with `unitType: "board"`, the selected `unitId`, `worktreeId`, and an authorized workspace `output`
directory. Use the DSH live Board preview for requested interaction or animation checks. Follow the
`univer` ready/status handoff; merge and discard remain user-authorized. Board Office export is unsupported.
