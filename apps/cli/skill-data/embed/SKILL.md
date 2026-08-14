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
