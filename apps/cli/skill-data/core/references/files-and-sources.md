# CLI files and sources

Shared Skills describe operations and parameters by meaning. This reference binds their inputs and outputs to local CLI files. Use `uvw <command> --help` for exact options. Request structured results with `--json`; display-only output is not stored-value evidence. Content operations target `--worktree <id>` and `--unit <id>`, except creation, which takes a destination Space and returns a new Unit ID.

## Office import and export

`unit create` takes `--worktree`, `--space`, `--type`, and `--name`. `import --file` converts an existing Office file into an editable Worktree-local Unit. Both return server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned Unit ID, never an imported internal ID. Blob upload preserves original bytes instead.

```bash
uvw unit create --worktree <worktree-id> --space <space-id> --type sheet --name <name> --json
uvw import --file source.xlsx --worktree <worktree-id> --space <space-id> --type sheet --json
```

```bash
uvw unit create --worktree <worktree-id> --space <space-id> --type doc --name <name> --json
uvw import --file source.docx --worktree <worktree-id> --space <space-id> --type doc --json
```

```bash
uvw unit create --worktree <worktree-id> --space <space-id> --type slide --name <name> --json
uvw import --file source.pptx --worktree <worktree-id> --space <space-id> --type slide --json
```

`export <output>` writes the selected Unit head to an Office file. Verify values, formulas, styles, and rendering first. Base participates in the existing Office exchange matrix; Board has no supported Office import/export format.

```bash
uvw screenshot --worktree <id> --unit <id> --sheet <name> --range A1:H40
uvw export output.xlsx --worktree <id> --unit <id>
```

```bash
uvw screenshot --worktree <id> --unit <id>
uvw export output.docx --worktree <id> --unit <id>
```

```bash
uvw screenshot --worktree <id> --unit <id> --pages all
uvw export output.pptx --worktree <id> --unit <id>
```

## Screenshots, PDFs, and review evidence

Run `uvw screenshot setup` once before the first SVG compile or screenshot so the browser and real fonts are available. Screenshots accept `--out <directory>` and return structured outputs with `--json`. Preserve semantic specs, realization scripts, persisted readbacks, full screenshots, and raw layout diagnostics together in a local output directory. Do not add generated user artifacts to repository history unless requested.

For Sheets, select the worksheet with `--sheet` and a range with `--range`. Structured inspection instead requires `--worksheet name:<sheet-name>`, `id:<sheet-id>`, or a 1-based `index:<N>` and accepts multiple A1 ranges in that worksheet. Use `--json` for stored values and types; text output shows display values only. Base accepts common screenshot options only, without Sheet ranges or Slide pages.

Slide screenshot and lint page selections use `--pages`, accepting `all` or lists such as `1,3-5`. SVG compilation selects one page with `--page N`. These page numbers are 1-based; Facade indexes in `execute` are 0-based. Prefer stable page IDs when carrying output into code.

Board captures can include a full overview and a scaled detail:

```bash
uvw screenshot --worktree <id> --unit <board-id> --out ./board-overview --json
uvw screenshot --worktree <id> --unit <board-id> \
  --region <left,top,width,height> --scale 2 --out ./board-detail --json
```

Inspect `outputs[0].layoutAnalysis` in the JSON result. A static screenshot proves neither interactive behavior nor animation. HTML Views are not rendered by Unit screenshot commands.

`uvw print-pdf <output.pdf>` prints Sheet, Doc, Slide, or Board from explicit `--trunk --unit <id>` or `--worktree <id> --unit <id>` scope. Base is not printable. An existing PDF output is never replaced. Use `uvw browse <n> -R <repo> --unit <id>` for the Workspace review URL.

## Slide SVG pages and assets

Write the deck plan in `spec.md`. Keep each hand-authored `page-NN.svg` through delivery, with the page's photos, logos, QR codes, icons, emoji, illustrations, and textures as individual files. Record exported paths in the spec and reuse earlier exported assets. Do not generate or rewrite pages through scripts, shared templates, or bulk substitutions.

Reference local PNG, JPEG, GIF, WebP, or SVG assets with explicit width and height:

```svg
<image x="0" y="0" width="240" height="160" href="./materials/photo.png"/>
```

The compiler validates local files early and embeds them into the generated program applied to the remote Unit. Prefer local assets over HTTP URLs, whose bytes cannot be validated until rendering. Never put a full-page reference screenshot behind editable elements.

```bash
uvw compile-svg page-NN.svg --page N --apply \
  --worktree <id> --unit <id> --json
```

```bash
uvw lint --worktree <id> --unit <id> --pages N --json
uvw inspect slide index:N --worktree <id> --unit <id> --json
```

`--page N` is declarative and 1-based. It clears and replaces an existing page, appends at `pageCount + 1`, and rejects larger numbers. Reapplying a replacement is idempotent. Without `--apply`, compilation is read-only; `--out <script.js>` writes its generated script.

`--add` overlays genuinely new elements on a finished page. Never use it to fix a page without first deleting every replaced element. Otherwise old broken elements remain under corrected copies. For page rework, edit the full SVG and reapply with `--page N`. Reinsert native charts after the final full-page replacement because it clears them too.

`--estimate-text-size` is an emergency fallback for browserless environments. It can shift long or aligned text significantly. Remove it and verify real-font compilation before delivery.

## SVG resource catalog

```bash
uvw resources registries
uvw resources find <query> [<query>...] [--registry <id>]... [--limit <n>]
uvw resources export <registry>/<resource> [<handle>...] --out ./resources/
```

Copy canonical handles exactly. Resource export downloads uncached resources once, then reuses `UNIVER_HOME/cache/resources`. Exported files are named `<registryId>--<resourceId>.svg`; preserve the registry in filenames. Keep one registry/style baseline across the deck.

Keep exported assets as files and reference them with `<image href="./resources/<registry>--<resource>.svg" width=".." height=".."/>`. Never extract their path data into the page. For a self-authored graphic deliberately reused within one page, use `<defs><symbol>` with `<use>`. External sprites can use `<use href="./icons.svg#home" …/>`.

Preview external sprite sheets over HTTP. `file://` blocks cross-file references under browser same-origin policy and shows blank icons. That is browser security, not a broken page. Only `colorEditable: true` resources may follow authored colors; fixed logos, emoji, and illustrations remain whole-image assets with intrinsic colors. Image recoloring can preview differently in a browser; verify the compiled result.

## Typst bundles

Use a bundle root containing `typst.json`, ordered `pages/*.typ`, an optional prelude, and optional `assets/`. The manifest requires at least:

```json
{ "schemaVersion": 1, "targetUnitId": "report", "pages": ["pages/01.typ"] }
```

It can also declare `title` and `prelude`. Put shared definitions in the prelude instead of `#import` or `#include`. Store PNG, JPEG, GIF, WebP, or SVG images under bundle-root `assets/`, referenced as `#image("assets/name.png", width: 240pt, height: 120pt)`. The compiler embeds them as native images with deterministic dimensions, not table placeholders.

```bash
uvw compile-typst paper/typst.json --out review/doc.js \
  --diagnostics-out review/diagnostics.json --preview-dir review/png --json
uvw compile-typst paper/typst.json --apply --worktree <id> --space <space-id> \
  --out review/doc.js --diagnostics-out review/diagnostics.json --json
```

Build-only mode opens no mutation session and requires `--out`; unrequested outputs are not generated. `--diagnostics-out` writes diagnostics and `--preview-dir` writes direct Typst PNGs. Apply requires `--apply`, `--worktree`, and `--space`, with optional `--parent <node-id>` and `--idempotency-key <key>`.

The manifest target is a compiler validation ID. JSON returns it as `compiledTargetUnitId` separately from server-allocated `unitId`, `resourceId`, and `nodeId`. Use only the returned Unit ID afterward. Apply always creates a new Doc and rejects `targetUnitId` if it matches an existing Unit in the destination Worktree with `workspace-argument-invalid`; choose a new local compiler ID such as `report`. Errors block apply; warnings require comparison of the Typst PNG and final Workspace screenshot. Only the bundled `@univerjs-pro/doc-typst-native-binding` is supported, with no system `typst` fallback.

## Markdown and its assets

Author `report.md` with assets under its source directory. Local resource paths resolve relative to the Markdown file. Paths must be safe relative paths, with no absolute paths, network image URLs, `..`, or symlinks escaping the asset root. Keep exported fragments, resource sidecars, and refreshed maps together.

File-backed directives in the Markdown source look like this:

```markdown
::image{#cover src="assets/cover.svg" width="560"}

::chart{#adoption src="assets/adoption.chart.json"}

::shape{#milestone src="assets/milestone.shape.json"}
```

The `markdown.md` reference of the `doc` Skill defines chart and shape JSON, image dimensions, supported syntax, and lossless-conversion boundaries. Create a new draft Doc directly, without a placeholder:

```bash
uvw compile-markdown report.md --apply --worktree <worktree-id> --space <space-id> \
  --source-map-out review/doc-map.json --json
```

Creation can use `--parent <node-id>` for the destination Node. `--unit` is reserved for updates. Compile-only diagnostics use `uvw compile-markdown report.md --out review/report.js --json`, with no Worktree, Unit, or Space options. Save the execution source map from apply; compile-only maps lack materialized native IDs.

Before updating, export selected current native blocks and assets:

```bash
uvw export-markdown --worktree <worktree-id> --unit <doc-id> \
  --source-map review/doc-map.json --blocks overview,readiness \
  --out review/edit.md --source-map-out review/current-map.json --json
```

Edit `review/edit.md`, preserve selected root IDs and exported assets, then pass the refreshed map to the block update:

```bash
uvw compile-markdown review/edit.md --apply --worktree <worktree-id> --unit <doc-id> \
  --source-map review/current-map.json \
  --blocks overview,readiness --source-map-out review/updated-map.json --json
```

`--unit`, `--source-map`, and `--blocks` are required together for updates. Creation options `--space`, `--parent`, and `--idempotency-key` cannot accompany `--unit`. The source-map JSON envelope `{ unitId, revision, sourceMap }` is accepted by `--source-map`; its revision is read metadata. Save each successful execution map for the next edit. On conflicts, export again and replan; native content remains authoritative.

## Blob transfer and recovery

```bash
uvw blob upload \
  --file <source> --space <space-id> [--parent <node-id>] \
  [--name <node-name>] [--media-type <mime>] [--idempotency-key <key>] --json
uvw blob get <resource-id> --json
uvw blob download <output> --resource <resource-id> [--force] --json
uvw blob replace --resource <resource-id> --file <edited-source> \
  --etag '"<downloaded-etag>"' --idempotency-key <key> --json
```

Blob upload and replacement publish immediately, outside Worktree review. For important retries use a unique `--idempotency-key`, reused only for the identical intent after an uncertain result. Downloads require an explicit output path and refuse overwrite by default. Use `--force` only when replacing the destination is intended. Destination replacement occurs only after the complete stream is written. Blob commands never print binary bytes to stdout. Downloads require a quoted strong ETag and reject malformed responses before replacing local files.

Download the existing Blob, edit the local file, then replace it with the exact quoted `download.etag` and a new stable key. JSON returns `replacement: { operationId, resourceId, etag }`. On `PRECONDITION_FAILED`, download to a fresh path and reconcile before using a new ETag and key. Never attach a new ETag to unreconciled older bytes.

After a lost response, the CLI checks the same Operation once. `workspace-result-unknown` includes its identity and source path. Inspect that Operation before retrying the identical file, ETag, and key. Do not restart a pending Operation; reconcile a failed Operation with a new key.

## HTML View sources

Create a complete local `.univer.html` file. Sibling scripts and assets are not uploaded automatically. Opening the file locally does not provide `window.univerBinding`; use the published Workspace URL.

```bash
uvw html-view validate --file ./dashboard.univer.html --json
uvw html-view create --file ./dashboard.univer.html \
  --space <space-id> --name Dashboard --idempotency-key <key> [--parent <node-id>] --json
```

To revise a page, download the existing Blob to a local `.univer.html` file, edit it, run validation, and replace using the downloaded ETag and a new stable write key. This preserves its page identity and URL. Validation uses the current CLI identity; each viewer's access is checked independently at runtime.
