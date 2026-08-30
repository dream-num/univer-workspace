---
name: embed
description: Embed one Workspace Univer Unit into another Host through an exact ResourceRef and lazy read-only loading.
---

# Workspace Embed

Load `core` plus the Host and Source Unit guidance from the native Skill catalog. The tool call always targets the Host Unit. The Source remains a read-only Unit selected by stable identity.

Use `workspace_api_find` and `workspace_api_show` to resolve `FUniver.createEmbed`, `FEmbed`, Host surfaces, and descriptor contracts before authoring.

Build the Source ResourceRef from its exact stable `unitId` and Unit type:

```js
const sourceUnitId = "<source-unit-id>";
const ref = "#unit=" + sourceUnitId + "&type=doc";
```

Do not infer Source identity from a display name, Workspace URL, share link, Node ID, or Resource ID. Do not stage a Source merely to read it. Let `loadAsync()` perform lazy authorized loading when the Host first needs the Source.

Use `workspace_content_execute` against the Host to create the Embed with its stable `embedId`, Host `unitId` and surface, Source Unit type, and exact ResourceRef. In a later read-only execution, verify the persisted ResourceRef, loaded child ID and type, and Host anchor. A missing, inaccessible, malformed, or type-incompatible Source fails closed; do not substitute a name search.

Use `workspace_screenshot` for the Host's rendered evidence. After the Worktree is ready, call `workspace_worktree_review_url` for the Host Unit and return the stable Worktree, Host Unit, Source Unit, and Embed identities.
