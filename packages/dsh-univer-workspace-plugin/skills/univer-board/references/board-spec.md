# Semantic BoardSpec

Use a compact JSON object to preserve relationship-heavy intent before realization. This is an agent planning
artifact, not an SDK parameter, a compiler contract, or a replacement for the Board model. Simple edits and
standalone content do not require it.

## Core shape

```json
{
  "schemaVersion": 1,
  "diagramType": "dataflow",
  "title": "Order event topology",
  "nodes": [
    { "id": "checkout", "label": "Checkout API", "semanticRole": "service" },
    {
      "id": "orders",
      "label": "orders.v1",
      "semanticRole": "message-bus",
      "description": "Order events, partitioned by order_id"
    }
  ],
  "relations": [
    {
      "id": "publish-orders",
      "from": "checkout",
      "to": "orders",
      "semantic": "publish-event",
      "label": "OrderPlaced",
      "importance": "primary"
    }
  ],
  "groups": [
    {
      "id": "order-system",
      "label": "Order system",
      "groupType": "system-boundary",
      "contains": ["orders"]
    }
  ]
}
```

Required fields: `schemaVersion: 1`, `diagramType`, `nodes`, `relations`. Nodes have stable semantic `id`,
`label` and `semanticRole`. Roles are descriptive domain vocabulary, not a closed enum or a mandated visual style.
Use `semanticRole` rather than node `role`, which Board elements reserve for runtime-owned behavior. Add
`description` when role and label do not convey enough intent, and `content` for meaningful structured payloads.

Relations have `from`, `to`, and `semantic`; optional `label` is visible wording. Give referenced relations stable
`id` values (for example, messages defining an activation span). `ends.from` / `ends.to` hold endpoint semantics
such as role, multiplicity, cardinality or activation identity—not node roles. Add positive `order` only where
ordering matters; scope it to sequential messages, a parallel operand, or siblings under one tree parent.
Optional `activity` and `importance` describe meaning, not animation settings.

Groups use `id`, `label`, `groupType` and `contains`; groups may contain groups. Common kinds are `container`,
`system-boundary`, `uml-package`, and `swimlane`. A swimlane can declare
`lanes: [{ id, label, contains: [...] }]`. Each member has at most one direct group/lane owner; a pool-wide
control node can belong to the pool rather than a lane. Mind-map `contains` relations mean topic hierarchy,
not Board container ownership.

Keep all coordinates, dimensions, concrete shape types, style, ports, routes, markers and animation settings out
of the spec. The agent chooses those after reading the installed API and current Board. Not every relation
requires a line: `annotates` can become an Ink underline or a nearby note.

## Select only the relevant grammar

| Intent / `diagramType`                                       | Native candidates and focused reference                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `flowchart`, `uml-activity`, `uml-state`                     | Flowchart shapes, StateBar, lanes/containers: [flow-state.md](flow-state.md)              |
| `uml-sequence`                                               | Native participants/activations and ordered messages: [sequence.md](sequence.md)          |
| `uml-class`, `erd`                                           | Table compartments and semantic relation helpers: [class-er.md](class-er.md)              |
| `uml-use-case`, `uml-component`, `uml-package`, `deployment` | Actors, interfaces and real scopes: [uml-structure.md](uml-structure.md)                  |
| `mindmap`, `tree`, `timeline`                                | Native structured layout: [mind-map.md](mind-map.md)                                      |
| `architecture`, `dataflow`                                   | Responsibilities, payload direction, storage and actual scope membership                  |
| Any profile with mixed content                               | Dedicated native APIs and semantic payloads: [content-selection.md](content-selection.md) |

A profile guides selection, not an all-elements template. Instance-specific meaning belongs here; reusable selection
rules stay in references. Read a second reference only if that capability participates in the requested result.

## Realize meaning and hierarchy

Preserve every meaningful title, description, tag, explanation card, phase and group from the source. Check
source-to-element coverage explicitly; an importer accepting a document does not establish that every field was
represented. Keep source lane/phase constraints and a requested main path in the semantic plan and readback.

Choose a consistent visual vocabulary for responsibilities, storage, messages, decisions and exception paths.
Use emphasis for the requested primary path while keeping secondary/evidence relations readable. Discover the
installed text and style APIs: distinguish headings, supporting text and tags with rich-text hierarchy where
supported. A newline alone does not create that hierarchy. Size for the actual text and verify wrapping and contrast.

Use the shared `univerAPI.newRichText()` builder: a heading span followed by `paragraph()` and supporting/tag spans
stays editable. Set each span's font family, size, color and bold state explicitly; normal text must not inherit a
bold heading. For a compact 12/10/8 px title/body/tag hierarchy, native document point sizes are 9/7.5/6 pt.
Container/lane title styles use pixels directly. Verify the actual render and enlarge text for the requested
output scale. Rich-text `paragraph()` options style the following paragraph: set heading/body line height and
spacing before their spans, and set each multiline body paragraph explicitly rather than relying on inheritance.
Use native text-box wrapping and padding; enlarge for real content rather than clipping or dropping
words. Apply primary-path color/weight to the actual connectors, not only custom metadata.

For lane/phase workflows, derive a repeatable grid from semantic column order and measured content sizes. Fit lane
headers to their longest caption and place wrapping explanation cards below the content when a side column makes the
whole diagram too wide. Preserve phase order and native group/lane ownership. If those constraints fix node frames,
`planGraphLayout({ elementIds, fixedElementIds: elementIds, direction })` can still assign automatic ports; apply
only a ready plan and verify every frame stayed fixed. Preserve authored endpoint sides with fixed endpoint bindings.
Report this constrained placement separately from a free graph layout; a rejected free plan must remain unapplied.

Treat source positions, columns and authored routes as constraints or an import baseline. Report public automatic
layout separately; reproducing source coordinates is not evidence that the automatic layout algorithm improved.

## Check before realization

Check in memory or with a short script; no general parser/compiler is needed:

- Node/group IDs are non-empty and unique; relation IDs are unique when supplied. Endpoints and membership
  references exist. Groups are acyclic; lane IDs are unique within their pool; direct ownership is unambiguous.
- Required data/compartments and any referenced message, activation, extension point or interface contract exist.
- Ordered relations have positive, scope-unique orders. Each native map is connected and acyclic with one parent
  per non-root. Parallel operands must not acquire unintended precedence.
- Relation direction, cardinalities, guards and lifecycle semantics match the selected grammar. Fix ambiguities
  that change meaning before creating elements.

Repair structural failures before mutation. Geometry is checked after realization, using model readback and
rendered diagnostics. Preserve a semantic-to-generated ID mapping rather than sending this object to the SDK.

JSON is the exchange form; accept user YAML or fenced Markdown by normalizing to the same object, not by
maintaining three schemas. Compact notation is fine. Do not duplicate an existing valid spec just to reformat it.

## Compact generated containers

Use real domain text and relationships when reviewing a generated diagram, including long Chinese/English text,
nested boundaries, table compartments and native ownership. Preserve the source labels, captions, badges and styles.
Inspect a full fit view and overlapping 100%/200% details covering the whole content extent; check text fit and readable
type, hierarchy, whitespace, titles, corners, borders, markers and routes. Record visual review separately from model
and rendered diagnostics. A clean diagnostic or a ready plan is not visual approval; retain unresolved findings and
explicit refusals caused by fixed/manual/native constraints. Count applications from actual apply results, not patches.

After applying a ready layout to a newly generated diagram, inspect `FBoard.fitContainerToContent` and fit its
generated ordinary containers deepest-first. This existing write fits frames to their current children; it does
not solve routes or make an incomplete graph plan applicable. Preserve authored fixed frames, protected elements
and native layout owners. Re-read leaf world bounds, text, membership and bindings after fitting, then obtain fresh
rendered label measurements and screenshots. Earlier layout plans can be stale after frame changes.

New ordinary groups with external captions can set `containerData.headerSize` to `0` through `updateElement`
before child insertion, then fit and remeasure. Patch the complete element and preserve source constraints; leave
existing authored groups, swimlanes and native layout owners unchanged.

## Imported label constraints

For an existing Archify document, inspect `FBoard.importArchify` and schema support in the installed API.
Supported inputs are architecture v1, workflow v1/v2, sequence v1, dataflow v1, lifecycle v3, and
ERD/class/tree/timeline/waterfall/explainer v1. Preserve native lanes, groups, ordered messages, compartments,
semantic markers and source constraints; accepting these schemas does not establish free-layout quality.
Pass the parsed document to that dedicated importer, retain its semantic ID mapping and report unsupported
decorations. A rejected import must leave the Board unchanged. The importer creates editable native elements;
verify their text, container membership and connector bindings, then run model and rendered checks. Archify IR
and BoardSpec have different contracts: do not pass BoardSpec to this importer or send input to a shell renderer.

For verified brand geometry, use the installed async `importArchifyWithAssets(input, { brandAssets })` and provide
each asset as `{ svg, sha256, source? }`. The importer uses the current Board theme, validates exact UTF-8 SHA256
and portable SVG paths with solid hex/currentColor fills, and performs no network fallback. Unsupported SVG features or
an active-page change while awaiting assets reject the import atomically. Preserve synchronous import warnings
when brand assets were not supplied; do not call that result exact brand fidelity.

Imported source label pins stay fixed by default. When optimizing a newly generated copy is requested,
retain each chosen label's original placement and source metadata before using `updateConnectorLabel` with
`placement: { mode: 'auto', anchor: 'auto', side: 'onPath', offset: null }`. Release only selected relative hints
that still match their imported baseline; preserve absolute `labelAt` and user-edited pins. Obtain a fresh ready
measured label plan, apply it, and check again. Lint and planning never relax pins implicitly. Keep import-only
findings separate from the explicitly optimized result.
