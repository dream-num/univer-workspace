---
name: board
description: Create, edit, verify, open, and screenshot Board Units in a remote Univer Workspace Worktree.
---

# Workspace Board

Load `core` first and use one explicit draft Worktree and Board Unit ID throughout the task.

```bash
univer-workspace-cli unit create \
  --worktree <worktree-id> --space <space-id> \
  --type board --name <name> --json
univer-workspace-cli unit list --worktree <worktree-id> --json
```

Creation returns server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned `unitId` for
every Board content command.
Use `blob upload` only when preserving original bytes without an editable Board Unit; Blob Resources
have no `unitId` and cannot use this Skill's commands.

Board authoring uses the shared execute transaction and injects `board` for the selected Unit:

```bash
univer-workspace-cli execute \
  --worktree <worktree-id> --unit <board-id> \
  -e 'const shape = board.insertShape({ shapeType: api.Enum.ShapeTypeEnum.Rect, transform: { left: 40, top: 40, width: 180, height: 100 } }); if (!shape) throw new Error("Cannot insert Board shape"); shape.getText().setText("Plan"); return { shapeId: shape.getId(), board: board.save() };' \
  --json
```

`insertShape` accepts the common `IShapeCreateInput`: geometry belongs in `transform`, visual data
belongs in `shapeData`, and text is edited through the returned live handle. It does not accept
top-level `id`, `left`, `top`, `width`, `height`, or `text`; retain `getId()` immediately when later
operations need the generated element id. Inspect the version-matched `FBoard.insertShapes` entry
before batch insertion so the script follows the SDK installed with this CLI.

Use `api find` and `api show` to resolve Board Facade methods and enums. Use read-only `execute`
with `board.describeElements()` or `board.save()` for model readback. A Board screenshot with
`--json` also returns `outputs[0].layoutAnalysis` from the real browser routes:

Native `inspect` is not supported for Board targets. Use read-only `execute` for model evidence and
`screenshot --json` for rendered evidence; do not invent a Board inspect command.

```bash
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <board-id> --out <directory> --json
univer-workspace-cli open --worktree <worktree-id> --unit <board-id>
```

## Connectors and layout verification

Create related shapes with `insertShapes()` before creating connectors. Use generated element IDs
for bound endpoints and prefer `routing: "orthogonal"` plus `routingMode: "auto"` for normal
diagrams. Use `straight` only for a short adjacent edge with a visibly clear corridor, `curve` for a
self-loop or short feedback edge, and `freePolyline` only for explicitly manual geometry.
Choose outward connection sites from the planned geometry: `Right → Left` for left-to-right flow and
`Bottom → Top` for top-to-bottom flow. Put feedback edges on an outer lane with sites facing that
lane. Do not route every edge through the default sites.

The following execute program is self-contained; replace only the Worktree and Unit placeholders:

```bash
univer-workspace-cli execute \
  --worktree <worktree-id> --unit <board-id> --json \
  -e '
const shapes = board.insertShapes([
  { shapeType: api.Enum.ShapeTypeEnum.RoundRect, transform: { left: 80, top: 80, width: 180, height: 100 } },
  { shapeType: api.Enum.ShapeTypeEnum.RoundRect, transform: { left: 400, top: 80, width: 180, height: 100 } }
]);
if (!shapes) throw new Error("Cannot insert Board shapes");
const source = shapes[0];
const target = shapes[1];
if (!source || !target) throw new Error("Expected two Board shapes");
const connectors = board.insertConnectors([{
  fromElementId: source.getId(),
  toElementId: target.getId(),
  fromConnectionSiteId: api.Enum.BoardConnectorSite.Right,
  toConnectionSiteId: api.Enum.BoardConnectorSite.Left,
  routing: "orthogonal",
  routingMode: "auto",
  style: { endMarker: { type: "filledTriangle", size: "md" } }
}]);
if (!connectors) throw new Error("Cannot insert Board connectors");
const analysis = board.analyzeModelLayout(48);
if (!analysis) throw new Error("Cannot analyze Board layout");
return { connectorIds: connectors.map((item) => item.id), analysis };'
```

After the write, run a read-only `execute` that returns `board.analyzeModelLayout(48)`. Block on
`element-overlap`, `connector-through-element`, and `connector-collinear-overlap`; review every
`connector-crossing`. An auto connector without persisted route points is intentionally unresolved
in model evidence because the browser renderer owns its final route.

Endpoint lint applies to every Board connector, not only sequence diagrams.
`connector-free-endpoint-near-element` means a free start/end lies within the normal snap threshold
of a connectable element. Repair the endpoint with `board.setConnectorConnection()`: use the
existing shape-site or shape-boundary endpoint contract for ordinary shapes. A
`connector-free-endpoint-near-dashed-connector` warning means a horizontal message-like endpoint
is using a vertical dashed connector as a likely fake lifeline. Rebuild that participant with
`api.Enum.BoardSequenceShapeType`, then patch the reported start or end with
`{ kind: "lifeline", shapeId, offsetY }`. Both are analysis warnings, not insertion parameter
errors. `normalizeConnectorRouting()` does not repair endpoint semantics and must not substitute
for rebinding them.

Specify connector intent, marker type/size/offset, and routing mode; do not hand-calculate arrow
depth or terminal-leg length. Render geometry accounts for marker paint bounds, stroke width,
endpoint gap, rounded corners, and dash phase. For orthogonal auto connectors without manual
waypoints or route points, the router reserves marker-aware terminal space without changing the
connector type. Imported or explicitly manual routes keep their topology: rendered lint reports
`connector-marker-target-overlap`, `connector-marker-corner-overlap`, `connector-marker-collision`,
`connector-terminal-stem-too-short`, or `connector-terminal-dash-discontinuity` when their visual
configuration does not fit. Treat marker target/corner overlap and marker collision as errors;
review terminal stem and dash continuity warnings instead of repeatedly normalizing the route.

Run a full screenshot with `--json` and treat `outputs[0].layoutAnalysis` as final routing evidence.
Each rendered issue includes related ids, exact `bounds`, and a padded `focusBounds` ready for a
targeted screenshot.

Collect the connector IDs named by rendered issues and call
`board.normalizeConnectorRouting(["<connector-id>"])` at most once for that set in an execute
transaction, then run the full screenshot again. Connectors already using orthogonal auto routing
are a safe no-op. This preserves endpoints, labels, markers, style, parent container, and lane while
resetting only route state. When connectors change, a non-null `affectedBounds` covers the previous
connector and both endpoint elements; a no-op returns `null`. Do not loop repairs or move unrelated
elements automatically.

Capture each remaining issue's `focusBounds`, or the connector with both endpoint nodes, before the
final full overview:

```bash
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <board-id> \
  --region <left,top,width,height> --scale 2 --out <directory> --json
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <board-id> \
  --elements <connector-id>,<source-id>,<target-id> --padding 48 --scale 2 \
  --out <directory> --json
univer-workspace-cli screenshot \
  --worktree <worktree-id> --unit <board-id> --out <overview-directory> --json
```

## Images

Images may come from user-provided assets or the built-in SVG resource library. For built-in assets,
use `univer-workspace-cli resources registries`, `univer-workspace-cli resources find`, and
`univer-workspace-cli resources export`, then pass the exported SVG as a data URI to
`board.insertImage()` with `imageSourceType: api.Enum.ImageSourceType.BASE64`.

Board has no supported Office import/export format. Keep merge and discard user-authorized as
described by `core`.
