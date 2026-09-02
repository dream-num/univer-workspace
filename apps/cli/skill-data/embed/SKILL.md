---
name: embed
description: "Embed one remote Workspace Univer Unit into another Host using an exact ResourceRef and lazy read-only Source loading."
---

# Workspace Embed

Load `core` plus the Host and child Unit Skills. The command targets the Host Unit; the embedded
child is a read-only Source selected by a ResourceRef.

```bash
univer-workspace-cli api show FUniver.createEmbed FEmbed FEmbedHostSurface ICreateEmbedParams IEmbedDescriptor
univer-workspace-cli api find embed host surface
```

## Identity contract

- Build a self ResourceRef from the exact stable child `unitId` and its Unit type:
  `#unit=<source-unit-id>&type=<sheet|doc|slide|base|board>`.
- Obtain the Source identity from the caller, an existing Host descriptor, or an already selected
  identity workflow. A display name, Workspace URL, share link, Node ID, and Resource ID are not
  substitutes for `unitId`.
- Do not add the child to the task Worktree merely so Embed can read it, and do not preload it. The
  Workspace Provider materializes an authorized child when `loadAsync()` first needs it.
- One Host may have sibling Embeds. Do not create a nested Embed graph unless the selected Viewer
  explicitly supports it.

Choose the Host surface and required context from the Host Unit Skill. For a Sheet floating object,
provide an explicit drawing placement; a Sheet tab needs no placement:

```js
const sourceUnitId = "<source-unit-id>";
const embed = api.createEmbed({
  embedId: "<stable-embed-id>",
  host: {
    unitId: workbook.getId(),
    surface: api.Enum.FEmbedHostSurface.SheetTab,
  },
  content: {
    unitType: api.Enum.UniverInstanceType.UNIVER_DOC,
    ref: "#unit=" + sourceUnitId + "&type=doc",
  },
  interaction: "interactive",
});

const child = await embed.loadAsync();
if (child?.getId?.() !== sourceUnitId) {
  throw new Error("Embedded child identity mismatch.");
}
return {
  embedId: embed.getId(),
  childId: child.getId(),
  descriptor: embed.getDescriptor(),
};
```

Verify the exact persisted ResourceRef, loaded child ID/type, and Host anchor in a later read-only
`execute`, then follow the Host screenshot and review flow. An inaccessible, missing, malformed, or
type-incompatible Source is a load failure; do not fall back to name search or silently replace it.

## Referencing another Unit's data from a Chart

When a Chart on a Slide, Doc, or Board should reflect a range in a different Unit, bind the range as
a ResourceRef instead of copying its current values. Copied values are a snapshot; a ResourceRef
keeps the Chart connected to the Source.

The Host and Source are Univer Units in the same Workspace deployment and are addressed by stable
`unitId`. Resolve the exact input with:

```bash
univer-workspace-cli api show IResourceRefChartDataSourceInput
```

Pass the ref contents (`{ file?, unit, part }`) directly to
`newChart(...).setSource(ref)`. For an existing live Chart, use
`await chart.setDataSource(ref)`. Wrapping the ref as `{ source: { kind, ref } }` fails normalization
with `RESOURCE_REF_INVALID_UNIT`.

For a Worktree Host, an authorized Source staged in the same Worktree resolves from that Worktree;
otherwise the Workspace reference policy resolves the authorized trunk Source. Do not stage a
read-only Source merely to make the reference load.

Verify that the stored `dataSource.source.kind` is `resource-ref`, then confirm the exact Source
Unit, Sheet/Table selector, and range in a fresh readback. Workspace Viewer and execute runtimes
materialize an authorized Source on demand; the Viewer also watches the Source data and refreshes a
live Chart when it changes. The screenshot renderer does not currently preload a Source referenced
only by a Chart, so that case can render a placeholder there; finish its visual review in the
Workspace Viewer.
