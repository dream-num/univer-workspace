# Referenced Office product runtimes

Workspace desktop editors assemble native Embed through the published SDK. `UniverEmbedUIPlugin` registers
product contributions, but does not register every product's data model. Before a referenced
snapshot is loaded, the editor's `embed-product-runtime.ts` prepares the requested product.

## Runtime ownership

- The editor owns the loader. Product chunks, styles, Facade extensions, locales and plugins are
  prepared on demand for Sheets, Docs, Slides, Bases and Boards.
- Concurrent requests for a product share one promise. Registration is serialized across products.
  Import failures can be retried without blocking another product. After SDK registration starts,
  a failure stays failed until the editor closes: the SDK registry may be partially initialized.
- Mobile editors retain their existing model-only reference path. Desktop product presets are
  not installed into the mobile workbench, whose service registrations are incompatible.
- Explicit host plugins are reused. SDK 1.0.3 also installs transitive plugins without exposing a
  public registry query. The single registration loop tolerates only the SDK's exact duplicate-name
  error for the requested plugin; all other errors propagate. Replace that fallback when a public
  registry query becomes available.
- Collaboration hosts retain their remote image/attachment services. Embedded Base/Slide/Board
  presets suppress their local implementations, avoiding duplicate dependency injection.
- Base creates a worker only when the host has no RPC plugin. An externally created Worker is not
  terminated by SDK 1.0.3's RPC plugin, so the embed runtime explicitly terminates its own workers
  when disposed. Imports finishing after disposal do not instantiate presets or workers.
- Native SDK capabilities, anchors and view adapters remain SDK-owned. Workspace does not alter
  document resources to emulate an unsupported renderer.

## Data and permissions

The existing reference policy remains authoritative: trunk references read trunk; a Worktree reads
mapped sources from that Worktree and unmapped sources from trunk; merge previews use the existing
per-source resolution. Preparation happens after reference validation and before snapshot loading.
Server ACL checks are unchanged. Cancelling a request during preparation prevents its snapshot load.

Reference materialization opens no new collaboration write session. The existing live Sheet
observer remains in place for its supported hosts. A source-write guard now covers all materialized
referenced product types, including review pages; loading source data is not permission to edit it.
This change does not add editing of referenced products or new collaboration semantics.

## Native host surface matrix

The following SDK 1.0.3 surfaces all reach the same product preparation hook. Disposable browser
fixtures are generated with published `FUniver.createEmbed` and Facade `save()` APIs, not handcrafted
Embed JSON.

| Surface | Browser case | Result / boundary |
| --- | --- | --- |
| Docs custom block | Real License analytics PRD → Base | Inline grid, fullscreen, formal route, Worktree draft review and ready-state merge preview rendered |
| Sheets floating object | Sheet → Base | Grid rendered |
| Sheets sheet tab | Sheet → Base | Selected tab rendered Base workbench |
| Bases table-list block | Base → Doc | Document rendered; host must enable Docs collaboration UI dependencies |
| Slides floating object | Slide → Base | Grid rendered |
| Slides page-list block | Slide → remote Base ResourceRef | **SDK limitation below; not a passed case** |
| Boards floating object | Board → Base | Grid rendered |

Docs → Sheet and Docs → Slide child rendering were also visually checked. An empty Board source
produces an empty document block; it is not sufficient evidence for a populated Board rendering.
PDF is not a supported child in this SDK's Embed capability matrix; this change does not advertise it.

### Remaining SDK and viewer boundaries

For a provider-backed Slides page-list embed created without first materializing its child, the
published SDK persists a ResourceRef without `childUnitId`. `SlideEmbedPageHost` checks native page
custom data for `childUnitId` and returns before `mountPageList` when it is absent. The thumbnail
preview independently resolves the ResourceRef and can show the Base while the main page stays
blank. Product preparation succeeds; changing the Workspace loader cannot correct that UI guard.
An SDK fix must let the page host mount from the descriptor/ResourceRef without persisting a
scope-specific child cache into the document. This remains explicitly unverified as an end-to-end
success, rather than being hidden by rewriting native snapshot data in Workspace.

The side-by-side `UnitComparisonViewer` uses a separate snapshot-only runtime that currently has
neither Embed plugins nor a scoped source provider. It is not covered by the native editor review
verification above. Adding it requires explicit left/right source snapshot scope; falling back to
current trunk for both panes would show misleading review content. Do not mark comparison embeds
as verified until that scope contract is supplied.

## Reproduce browser verification

Export the real document and Base with their version-matched public Facade `save()` methods to
local JSON files. Keep business snapshots outside the repository. Build only Workspace and its
required private dependencies, then run one disposable local server:

```sh
pnpm --filter @univerjs/univer-workspace... build
cd apps/workspace
EMBED_DOC_SNAPSHOT=/absolute/path/doc.json \
EMBED_BASE_SNAPSHOT=/absolute/path/base.json \
pnpm exec tsx test/fixtures/embed-runtime-server.ts
```

The server prints its local login URL and a temporary `fixture.json` containing formal-node,
Worktree and matrix URLs. Authentication and seeded resources exist only in its temporary
SQLite/blob directory. It does not connect to production, alter real PRDs, or add production routes.
Stop it after validation. Its temporary directory is removed on process exit.

Verify both `/nodes/<docNode>` and
`/worktrees/<worktree>/units/<docUnit>/draft?embedded=true`, scrolling the native document canvas to
its embedded table. Check inline rows, fullscreen enter/exit, source scope requests, error logs and
read-only review behavior. Use actual wheel scrolling rather than DOM `scrollIntoView` for a canvas
document. Matrix URLs expose the other host surfaces.

Automated checks cover the original missing-Base-model failure with the published SDK, all five
product requests, coalescing, SDK transitive duplicates, real initialization failures, retry,
disposal and Worker termination. Reference-provider tests cover scope policy, identity/type
validation and cancellation before snapshot loading.
