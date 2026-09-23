# Native Office previews in Workspace HTML

Workspace Browser provides `window.univerWorkspace` inside its `.univer.html`
files. This is an application navigation interface, separate from the SDK-owned
`window.univerBinding` data API. It is not yet provided by Workspace Agent's Sidecar.
Feature-detect it when authoring a page used in multiple hosts.

## Page interface

```html
<div id="material" style="height: 640px"></div>
<button id="open">Open financial model</button>
<script>
  document.getElementById('open').onclick = () => {
    const host = window.univerWorkspace;
    if (!host?.capabilities.includes('native-preview')) return;
    host.showUnit('REPLACE_WITH_UNIT_ID', document.getElementById('material'));
  };
</script>
```

| API | Behavior |
| --- | --- |
| `version` | `1` |
| `capabilities` | `native-preview`, `native-focus`, `share-link` |
| `showUnit(unitId, connectedElement, options?)` | Requests a live Sheet, Doc or Slides preview using the server-selected editor mode in the element's rectangle. Returns immediately; observe status events for the result. Only one native preview is mounted per HTML viewer. |
| `hideUnit()` | Closes and disposes the current native frame; HTML bindings remain mounted. |
| `share()` | Opens a host-owned link dialog for the current HTML file. It does not invite users or change permissions. |

The slot supplies position and size; the host clips it to the HTML frame's viewport.
Scrolling, resizing and layout shifts update placement. A hidden or disconnected
slot hides the native surface. Call `hideUnit()` when permanently removing a slot
to release its runtime. Showing the same Unit again changes placement/navigation
without remounting it; showing another Unit cancels the previous open request.

The host provides a compact title, live/editability label, **Open file** link and Close
button. Doc and Slides previews hide the redundant ribbon/header; Slides fit the
available viewport with a local zoom operation. Authorized editors can edit the
native content; viewers retain the read-only guard. **Open file** provides the full
native controls. Signed-in users also receive a **Download PPTX** button in the
host header when the Slides editor exposes export. It calculates and exports the
current native snapshot through the existing authenticated SDK Exchange service,
so visible reference results are included without writing document content. Export
progress/errors remain in that header. Managed image export requires the server's
Workspace Asset resolution support.

The share dialog has a Copy link action and inline success/failure feedback.
Copying does not change access: the HTML and each referenced Unit remain separately
authorized. Preview content is real Univer rendering, not screenshots
or a second copy of document data.

Opening and closing a preview are personal navigation. They do not change model
assumptions, share permissions, approve a document, or merge a Worktree.

## Source navigation

```js
const slot = document.getElementById('material');
window.univerWorkspace.showUnit(modelUnitId, slot, {
  focus: { kind: 'sheet', sheetId: 'STABLE_SHEET_ID', range: 'B20' }
});
window.univerWorkspace.showUnit(contractUnitId, slot, {
  focus: { kind: 'doc', paragraphId: 'STABLE_PARAGRAPH_ID', quote: 'Cash consideration' }
});
window.univerWorkspace.showUnit(deckUnitId, slot, {
  focus: { kind: 'slide', slideId: 'STABLE_SLIDE_ID' }
});
```

Document navigation finds the current paragraph and exact quote, then places a
collapsed caret. It never reuses stored offsets or selects a text range that would
open the floating formatting menu. The earlier `{ paragraphId, quote }` focus
shape is also accepted. Missing/changed targets report `missing`; no content is
rewritten to make a locator match. Sheet navigation validates the range against
current dimensions; Slide navigation uses a stable page ID, not a page number.

```js
window.addEventListener('workspace-preview-status', (event) => {
  // status: ready | located | missing | error
  const { unitId, status } = event.detail;
  document.getElementById('status').textContent = `${unitId}: ${status}`;
});
window.addEventListener('workspace-preview-closed', () => {
  // The user closed the host's surface. Restore your page's local layout here.
});
```

`ready` means the native Unit loaded, not that every external reference has
calculated. Repeated show requests have distinct internal IDs so an older focus
result cannot label the current request. Malformed requests are ignored by the
host; synchronous slot errors throw in the template. A failed open stays visible
with a generic error and close control. Close and reopen to retry.

## Authorization and isolation

- HTML access grants no access to an embedded Unit. Each open uses the existing
  Unit-to-Resource lookup and Resource Open API; the native route independently
  repeats authorization. Snapshot and collaboration access remain server-enforced.
- Public HTML can be viewed anonymously. Private sources stay unavailable, and
  the native route uses the Resource Open API's authoritative `editorMode`. The
  HTML cannot grant editing. Anonymous previews have no export action.
- Targets are published **Trunk** Units. This interface does not select draft or
  merge-preview scopes, and the HTML Blob remains outside Unit Worktree review.
- The template can supply only identity, geometry and bounded navigation. It
  cannot supply a URL, user, permission, editor mode, SDK command, or credential.
- HTML remains inside the SDK's opaque-origin sandbox. The host pins messages to
  that viewer's actual iframe Window and per-source nonce. Placement is constrained
  to the viewer; messages from sibling/native frames and stale source generations
  are rejected.
- Native Office runs in a separate same-origin browsing context at
  `/preview/<unitId>`. UI Facade extensions never enter the HTML Binding Engine's
  JavaScript environment. Closing, replacing or unmounting removes that context.
- No changes to SDK sandbox flags, binding protocol, public packages, storage
  schema or permission policies are required. Cross-Unit formulas still require
  the appropriate Doc/Slide source plugins (the separate #106 fix).

The Browser-only DOM adapter discovers the renderer iframe inside the viewer's
open DOM/shadow roots without SDK class names or private properties. Revalidate
this adapter and the production browser fixture when upgrading the renderer.
The generic shared HTML viewer and Agent consumer remain unchanged.

## Live formula sources

Doc and Slide hosts subscribe to referenced Sheets through their existing SDK
collaboration transport after snapshot materialization. This is Browser editor
composition; the snapshot provider remains read-only and does not create sessions.
Only sources in the host's live scope join: Trunk-to-Trunk or a Sheet mapped into
the same Worktree. Merge previews stay frozen, and an unmapped Trunk source never
joins a Worktree room. Source mutations from the host are blocked; authoritative
replay and local calculation caches remain allowed. Editor disposal releases the
subscriptions with its SDK runtime.

Shared native navigation imports Facade types only. Each product editor owns its
runtime UI extensions, so loading a headless Sheet source cannot install Sheet UI
observers in a Doc or Slide host.

SDK 1.0.0-rc.0 can calculate external Shape formulas before a changed Source's
calculated cells are applied. The isolated `referenced-formula-results` adapter
invalidates Host formulas after a live Source result batch. Remove it when the
SDK refreshes external consumers after Source results apply; it does not calculate
financial results or write Source content itself.
