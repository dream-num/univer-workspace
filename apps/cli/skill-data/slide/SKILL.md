---
name: slide
description: "Create, import, edit, inspect, compile, export, and visually verify remote Workspace Slide Units."
---

# Workspace Slide units

Every content command targets one remote draft explicitly with `--worktree <id>` and `--unit <id>`. `execute` provides `univerAPI`, `api` (an alias of `univerAPI`), and `presentation` (the `FPresentation` bound by `--unit`). Do not redeclare them. Select pages with `presentation.getSlideByIndex(0)`, `presentation.getSlideById(id)`, or `presentation.getSlides()`. A Slide unit does not provide `workbook`; if it is undefined, verify the selected unit type.

Pages are 1-based across all CLI commands (`inspect --pages`, `screenshot --pages`, `compile-svg --page`, JSON `page`, `page-NN.png`) and share one selector grammar: `<n|n-m|id>[,…]` or `all`. Inside `execute`, facade indexes are 0-based (`getSlideByIndex`, `getSlides()[i]`). When carrying a page from CLI output into code, prefer `getSlideById(id)` — every page node and lint finding carries the page `id`.

Query exact signatures and enum values with `univer-workspace-cli api show <symbol>` and `univer-workspace-cli api find <keyword>`. Use the declared common Shape names such as `ShapeTypeEnum`, `ShapeFillEnum`, and `ShapeLineTypeEnum`.

## Workspace target

Create an empty Slide Unit or import a deck into the selected Worktree:

```bash
univer-workspace-cli unit create --worktree <worktree-id> --space <space-id> --type slide --name <name> --json
univer-workspace-cli import --file source.pptx --worktree <worktree-id> --space <space-id> --type slide --json
```

Both commands return server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned `unitId`
for every content command; never reuse an imported deck's internal id as the Workspace address.
Use `blob upload` instead of `import` only when the original file bytes must remain unchanged and no
editable Slide Unit is required; Blob Resources have no `unitId` and cannot use this Skill's commands.

## Presentation structure

A slide unit is one presentation: the presentation holds slides ("Deck and pages"), a slide holds elements in stacking order ("Stacking order"), and an element is a shape, an image, or a group — a text box is a shape ("Elements"). Tables and charts are elements too, and both are editable ("Tables", "Charts"). Native charts are available through `slide.charts` ("Native charts"). Imported decks can carry further element kinds (placeholders, connectors, media); address those through the generic element surface and verify their dedicated facade before editing. Master/layout pages render underneath a slide but are not edited here. A transition is a per-slide page-enter effect ("Transitions"). The facade mirrors this shape — `FPresentation` → `FSlide` → `FShape` / `FImage` / `FGroup` — and `univer-workspace-cli api show` gives signatures.

## Task routing

- Create or redesign pages: run the four-stage workflow below — author SVG and compile it ("SVG is the generation path"); do not hand-write facade drawing code for new content.
- Edit existing content: facade through `execute` — element CRUD in "Elements", content rules in "Text", "Shapes, fill, and stroke", and "Images and textures"; block-level rework in "Editing existing pages"; tables and charts in "Tables" and "Charts".
- Insert or update data-driven charts: reserve the chart rectangle in the page SVG, then use the native `slide.charts` facade through `execute` ("Native charts").
- Restack or add page-enter effects: "Stacking order", "Transitions".
- Verify: "Visual verification" — run per-page `lint --pages N` while building, then review screenshots of every page before delivery.

## Multi-page deck workflow

Four stages. Stage 1 fixes the deck-level plan, stage 2 runs once **per page** as a closed loop, stage 3 reviews the whole deck, stage 4 delivers. A page must pass its own loop before the next page starts; do not batch-author pages and defer checking to the end — a layout mistake repeated across ten unchecked pages costs ten rewrites.

### 1. Write the per-page specification

Before drawing SVG, write `spec.md` precisely enough that page generation requires no fresh decisions about copy, palette, or structure. Specify what each page should be, not merely what is easy to implement. The environment includes a semantic library of about 18,000 SVG resources across icons, logos, emoji, and illustrations, so do not remove useful assets to save drawing effort. At this stage describe asset meaning, not concrete registry names; exporting happens per page in stage 2.

Fix deck-level constants once: named colors in `#RRGGBB`, font roles expressed in points (`design px × 0.75`), font families, a baseline `outline` or `filled` icon style, illustration style, and page size. Each page section must define:

1. Layout, including exact tier and card counts.
2. Structure type, chosen from forms such as process chain, hub-spoke, layered architecture, circular stages, timeline, comparison columns, card grid, or hero image. Adjacent pages should differ and a deck should use at least four structures.
3. One core message.
4. Verbatim final copy for every title, label, card, and annotation.
5. Required image and icon assets.

For reconstruction, transcribe reference text exactly. For original work, derive it from the task requirements.

### 2. Build each page in a closed loop

Run steps 2a–2e for page N and reach a clean 2d before starting page N+1.

**2a. Prepare this page's assets.** Prepare the photos, logos, QR codes, icons, emoji, illustrations, and textures this page needs as individual files, record each exported path in the spec, and reuse files already exported for earlier pages. Discover and export SVG resources by meaning:

```bash
univer-workspace-cli resources registries
univer-workspace-cli resources find <query> [<query>...] [--registry <id>]... [--limit <n>]
univer-workspace-cli resources export <registry>/<resource> [<handle>...] --out ./resources/
```

Copy the canonical handle exactly. Export downloads uncached resources once and then reuses `UNIVER_HOME/cache/resources`; output files are named `<registryId>--<resourceId>.svg`. `colorEditable: true` resources can follow an authored color, while fixed logos, color emoji, and illustrations remain whole-image assets. Keep one icon registry/style baseline across the deck. Hand-draw an icon only when the library has no appropriate result. Do not clone one icon under different names, substitute Unicode glyphs, or use empty circles as placeholders. Keep exported resources as files and reference them with `<image href="./resources/<registry>--<resource>.svg">`; use `<defs><symbol>` + `<use>` for a self-authored graphic deliberately reused within a page. Never extract and copy an exported resource's path data into the page: that loses source organization, and truncated paths can still render without warnings.

**2b. Author the page SVG.** Reread the page's spec section, then hand-author the complete `page-NN.svg` with inline styles and the prepared assets, and check it against all five spec fields. Keep every SVG through delivery so review can compare exact coordinates. Do not generate or rewrite pages through scripts, shared templates, or bulk substitutions; that produces repeated layouts and propagates page-specific errors.

**2c. Compile and apply with zero warnings.** Run `univer-workspace-cli screenshot setup` once before the first compile so real fonts can be measured. Apply the page:

```bash
univer-workspace-cli compile-svg page-NN.svg --page N --apply \
  --worktree <id> --unit <id> --json
```

Clear every `warning` before continuing because warnings mean output was dropped or degraded. Review every `lint`; a lint is advisory and may remain only when the behavior is intentional. Errors mean the SVG construct has no Slide representation and must be redrawn.

**2d. Check the rendered lint and snapshot facts (required, every page).**

```bash
univer-workspace-cli lint --worktree <id> --unit <id> --pages N --json
univer-workspace-cli inspect presentation --worktree <id> --unit <id> --pages N --json
```

`lint` is a standalone Slide-only command. With `--pages`, it reports only the selected page's findings. It covers three conservative rules (text off the page, text escaping an opaque card, two texts overlapping) and is tuned to almost never fire on a healthy deck, so **assume every finding is real until the evidence says otherwise**. Each finding includes the rendered ink and related geometry needed to judge that finding; `inspect presentation` provides the declared element facts. Check everything else in the screenshot against this checklist:

1. **Overflow** — resolve every lint finding and visually check anything sitting close to a page or card edge.
2. **Unexpected wrapping** — compare the screenshot with the intended copy and line breaks. An extra line means the box is too narrow or the copy too long.
3. **Centering** — visually compare centered text and icons with their containers, horizontally and vertically.
4. **Alignment** — elements that share a role (card titles, list rows, number columns) should share a visible left edge or center line.
5. **Indentation** — hierarchical text keeps its left-edge contract: peers indent equally, children indent deeper than their parent.
6. **Icon sizing** — icons with the same role should have the same declared size; mixed sizes across sibling cards is a common defect.
7. Deviations of ≤3px are invisible at slide scale — a reference point, not a rule to chase to zero.

Each lint finding carries its own evidence: the text content and its `ink` box, the offending container (id, shape type, fill, box) or the other text, and the exact overflow in px. Discipline:

- **Every lint must end as fixed, or as an explicit "intentional" call justified against that evidence in your final report.** Never drop one silently, and never dismiss one from memory of what the page looks like — re-read the element it names. Calling a lint a false positive because you _think_ it points at a decoration, when the evidence says the container is an opaque card, is a wrong call.
- Text running **off the page** is clipped by definition — there is no legitimate design that needs it. Fix it.
- Text **escaping its card** is nearly always a CJK line that was not hand-wrapped. Shorten it, wrap it, or widen the card.
- **Overlapping text**: the finding prints both sides' colour and opacity. Read them before deciding.

Judge occlusion and contrast risks from the same facts (stacking order, fill, opacity); stage 3 confirms them visually. Do not screenshot inside this loop — screenshots belong to stage 3.

**2e. Fix and re-verify.** Fix the page by editing its `page-NN.svg` and reapplying it with `--page N` (a replacement). **Never patch a page with `--add`.** `--add` overlays: the old, broken element stays exactly where it was and the corrected one lands on top of it, so a single "fix" leaves two copies of the line — the overflow you set out to remove is still there, now with a ghost stacked over it. Seen in a real run: three pages patched this way ended with 19 duplicated texts and the original overflows intact. `--add` is for adding genuinely new content to a finished page, never for rework. After fixing, re-run 2d: the page is done when the scan is clean or every surviving finding has a written justification. If the rescan shows the same text twice, you patched with `--add` — redraw the full page and replace it.

### 3. Review the whole deck

After every page has passed its loop, screenshot every page and review in batches of no more than five pages, using independent reviewer agents when the host supports them; otherwise review the batches directly. A review must answer each checklist item with an explicit PASS or FAIL plus the observed evidence — an open-ended "does it look fine?" reliably misses defects. Check, in order: the seven items in "Visual verification", then cross-page consistency — adjacent pages should not repeat the same structure, and colors, fonts, and icon style should not drift from the spec constants. Treat each defect as a pattern: search every page SVG for the same mistake, fix the sources, reapply those pages with `--page N` (each reapplied page goes through its 2d check again), and re-screenshot them. Report anything that genuinely requires human redesign.

### 4. Deliver

After every page passes visual review, follow the core Skill's "Finish the task" steps. Provide the
Workspace review link together with any requested exported artifact.

## SVG is the generation path

For new pages or generated elements, author SVG and compile it. Do not hand-write individual shape and text calls or paste generated Facade code into `execute`. The compiler owns geometry conversion, baseline conversion, page selection, and common Facade workarounds, including `textWrap=None + NoAutoFit + padding=0` for measured SVG text. **Native charts are the deliberate exception**: use SVG to establish the page layout and leave the chart rectangle empty, then insert the chart through `slide.charts` in a follow-up `execute`. Reapplying the full page SVG clears every page element, including the chart, so finish page rework before inserting it or reinsert it afterward.

`--page` is one-based and declarative: an existing page is cleared and replaced, `pageCount + 1` appends, and a larger number fails. Add `--add` only when an SVG contains genuinely new elements to overlay onto a finished page. **`--add` is never the way to fix something**: it keeps the old element and stacks the corrected one on top, leaving both. Rework always means editing the page's SVG and reapplying it with `--page N`, which clears the page first and is idempotent. Without `--apply`, compilation is a read-only preview; `--out` writes the generated script. Reapplying the same replacement is idempotent.

Use ordinary browser-valid SVG: shapes, paths, transforms, gradients, text, bitmaps, `<use>`, style sheets, CSS units, and color functions. Open the SVG in a browser before compilation when one is available; its visible result is the baseline expectation.

`<image>` must declare width and height. Break lines with a `<tspan>` that has a scalar `x` (that line's horizontal anchor) and either absolute `y` or non-zero `dy` (line spacing); different lines may use different x values and remain one editable rich-text element. An x-only tspan after visible content resets the cursor on the same baseline and is still unsupported, as are `dx` and per-glyph coordinate lists. Center text in a badge or circle with `dominant-baseline="middle"` and `text-anchor="middle"`.

Spaces are not a layout tool. Default SVG whitespace handling collapses every run of consecutive spaces to one and strips leading spaces — in a browser and in the compiled slide alike — so layout built from spaces silently flattens: code indentation goes flush-left, the word gaps of a letter-spaced title (`P R O D U C T   R O A D M A P`) vanish, and multi-column lines or icon-to-label gaps close up. The compiler reports a lint when it collapses such runs. Build the layout structurally instead: `xml:space="preserve"` on the `<text>` (or per-line `x` positions) for code indentation, one positioned `<text>` per column, and non-breaking spaces (`&#160;`) for small fixed gaps.

Draw arrowheads with an SVG `<marker>`, using `orient="auto-start-reverse"` to rotate the head onto the tangent of the line's end.

`markerWidth`/`markerHeight` are multiples of the stroke width, not pixels — keep the head sized in proportion to its line, with looks in mind; `fill="context-stroke"` follows the line's color.

Note: do not hand-place triangle vertices at a line's ends — getting the tangent direction right is hard, and the bare line end easily pokes out past the head.

Gradient coordinates are fractions of the shape's box, not pixels: `gradientUnits` defaults to `objectBoundingBox`, so a vertical gradient is `x2="0" y2="1"` — writing `y2="720"` puts the axis outside the shape and renders a near-flat color.

A few things the slide renderer cannot reproduce, so the compiler warns. Mark that subtree (usually the `<g>` around the card) `data-univer-embed="image"` and it is baked into a faithful bitmap — at the cost that the subtree is no longer editable or recolorable, so keep text and layout structure outside it:

- **Drop shadows, blur, and other filters.**
- **A translucent gradient** — a `stop-opacity` below 1, or a gradient-filled shape with element `opacity` below 1 — renders as a solid block. Illustration packs stack pale gradient shadows behind every card; that is the common case.
- **A radial gradient on a non-square shape** — the renderer draws a circle centred on the box, not an ellipse fitted to it.

SVG resources inline at compile time three ways: an exported file, `<image href="./resources/<registry>--<resource>.svg" width=".." height=".."/>` (the normal choice); a self-authored reusable page graphic, `<defs><symbol id="ic" viewBox="0 0 24 24">…</symbol></defs>` + `<use href="#ic" x=".." width=".."/>`; or an external sprite sheet, `<use href="./icons.svg#home" …/>`. Each `<use>` is one logical instance regardless of whether its target is `<symbol>`, `<g>`, or another graphical element. All three forms use the same logical lowering: one visible leaf remains one native element; multiple faithfully vectorizable single-paint leaves become one multi-path custom shape; multi-paint or text content becomes one Slide group; content that cannot be faithfully vectorized follows `data-univer-embed="auto|vector|image"` (default `auto`) and may become one image. Nested `<use>` keeps the outermost visible instance boundary. A plain `<g>` is only a transform/style/layout container and stays flat; it does not request a Slide group. These compile-time guarantees are not a reason to copy exported path data into the page.

Preserve the registry in exported filenames. A sprite sheet previews in a browser only over http — `file://` blocks the cross-file reference by same-origin policy and shows blank icons; that is browser security, not a broken page. Only resources reported as `colorEditable: true` may follow an authored color; fixed logos, color emoji, and illustrations keep their intrinsic colors and must remain whole-image assets. An `<image>` recolor can preview differently in a browser, so inspect the compiled result before relying on it.

## Visual verification

Snapshot inspection and lint report facts, not final visual quality — you still decide what is a defect, because legitimate slide designs overlap backgrounds and decorations on purpose.

`inspect presentation --pages <n>` gives each element's declared facts straight from the snapshot: `id`, `type` (plus `shapeType` like `rect`, `line`), `transform` (the box you drew, rotation included), `fill` and `stroke` (`{"type":"none"}` means the element is invisible — connector bounding boxes and transparent placeholders look like cards otherwise, so exclude them when deciding which card a text sits in), and for text an object with `content`, `align`, `color`, `opacity`. The `elements` array is in stacking order, bottom to top.

The standalone `lint` command derives three high-precision checks from browser-rendered facts (text off the page, text escaping an opaque rectangular card, two text glyph bands overlapping) and reports nothing else. Each finding includes its relevant ink evidence; there is no raw bbox command. `compile-svg` normally measures text with the real browser and fails with setup guidance when measurement is unavailable. `--estimate-text-size` is an emergency fallback for browserless environments, not a shortcut; it can shift long or aligned text significantly and must be removed before delivery.

Screenshot review must check:

1. Elements clipped by or placed beyond the page.
2. Text overflowing cards or colored regions.
3. Text boxes overlapping one another.
4. Shapes hiding information they should not cover.
5. Low contrast or text placed directly on a complex image without a backing surface.
6. Missing critical elements compared with the task or reference.
7. Arrowheads lopsided, pointing off their line's direction, or mismatching its color.

## Deck and pages

A new deck contains one empty page. `compile-svg --page 1` handles it automatically. When using Facade calls directly, reuse `presentation.getSlides()[0]`; call `appendSlide()` only for page two and later. The default page is 16:9 at 960 × 540, with a top-left origin. Use `getPageSize` and `setPageSize` for dimensions.

Page backgrounds support solid colors, images, gradients, and patterns through `slide.setBackground`. `deleteSlide`, `insertSlide`, and `moveSlide` return booleans instead of throwing, so check their results. Slides have no formulas or recalculation.

## Elements

Read with `getElements()` or `getElementById(id)`; `getShapes()` narrows to shapes (`getImages()` / `getGroups()` likewise). Every element or shape exposes its id through `getId()`. Create a normal shape with `slide.insertShape({ shapeType, transform?, shapeData? })`; it returns a live `FShape` / `FConnectorShape` or `null`, so check the result and record `getId()` immediately. Change it through that live handle (`setTransform`, `setSolidFill`, `setStroke…`, `getText()`); `getShapeData()` is detached, so assigning into the returned object never persists — use `setShapeData` or a dedicated setter. `slide.insertElement(element, index?)` is the snapshot-restoration API: its complete `ISlidePageElement` carries an explicit `id`, and the returned element must have that same id. Use it only when restoring imported snapshot identity and references, not to invent ids for ordinary authoring. Images still use `newImage().…build()` → `insertImage`. Delete with `deleteElement`, which accepts the element object, not its id. Group with `slide.group(...)` / `ungroup()` (`api show FSlide.group FGroup`). Mutation methods often return booleans rather than throwing, so verify results.

## Text

`fontSize` is in points, while positions and boxes use pixels. Convert design pixels with `fontSize = px × 0.75`; passing pixel values directly makes text 1.333 times too large.

Do not rely on text-box defaults. Text added through `slide.insertShape(...).getText()` currently defaults to `Square` wrapping, `NoAutoFit`, and 4px padding on every side. A small or tightly measured box can therefore wrap or clip text silently. The legacy ShapeBuilder TextBox path has different defaults; do not transfer its no-wrap/auto-fit behavior to an inserted Shape.

For SVG-like, measured single-line text, keep the measured box authoritative and remove the renderer inset explicitly:

```js
shape
  .getText()
  .setText("...")
  .setTextBoxOptions({
    textWrap: univerAPI.Enum.ShapeTextWrapType.None,
    autoFitType: univerAPI.Enum.ShapeTextAutoFitType.NoAutoFit,
    padding: { left: 0, top: 0, right: 0, bottom: 0 },
  });
```

`compile-svg` emits this contract automatically after measuring the text. For intentionally wrapped text with content padding, declare that different contract explicitly:

```js
const shape = slide.insertShape({
  shapeType: univerAPI.Enum.ShapeTypeEnum.Rect,
  transform: { left: 60, top: 60, width: 400, height: 200 },
});
if (shape === null) throw new Error("shape insertion failed");
shape
  .getText()
  .setText("...")
  .setTextBoxOptions({
    textWrap: univerAPI.Enum.ShapeTextWrapType.Square, // wrap to the box width
    autoFitType: univerAPI.Enum.ShapeTextAutoFitType.NoAutoFit, // keep the declared box
    padding: { left: 8, top: 8, right: 8, bottom: 8 }, // px, optional
  });
```

With wrapping on, overflow moves to the box bottom instead — still silent — so give `NoAutoFit` boxes explicit width and enough height (a useful starting point is `lines × fontSizePx × 1.4`) and let the deck lint catch escapes.

A text box is a Shape whose text is owned by `shape.getText()`. Anything beyond one uniformly styled line goes through the rich-text builder:

```js
const rich = univerAPI
  .newRichText()
  .paragraph({ lineHeight: 40, lineHeightRule: univerAPI.Enum.SpacingRule.EXACT })
  .span("Revenue ", { fs: 14, cl: { rgb: "#374151" } })
  .span("+18%", { fs: 18, bl: 1, cl: { rgb: "#047857" } })
  .paragraph({ lineHeight: 40, lineHeightRule: univerAPI.Enum.SpacingRule.EXACT })
  .span("second line", { fs: 14, cl: { rgb: "#374151" } })
  .align({
    horizontal: univerAPI.Enum.HorizontalAlign.CENTER,
    vertical: univerAPI.Enum.VerticalAlign.MIDDLE,
  });
const shape = slide.insertShape({
  shapeType: univerAPI.Enum.ShapeTypeEnum.Rect,
  transform: { left: 60, top: 60, width: 400, height: 200 },
});
if (shape === null) throw new Error("shape insertion failed");
shape.getText().setRichText(rich);
```

Two rules, each of which fails silently when broken. Break lines with `.paragraph()` and **never** put a `\n` inside `.span()` — the newline is not rendered as a line break and the text around it can disappear. Repeat the `.paragraph({ lineHeight })` spacing on every line, including the first, or that line gets default spacing. `.align()` aligns the whole block and may be called anywhere in the chain; to align one line differently, pass `align` to that line's `.paragraph()`. `univerAPI.newRichText()` takes no argument; passing a document object still compiles and then quietly ignores your alignment and spacing. `compile-svg` writes all of this for you.

SVG text `y` is a baseline while Facade position is a box top. For manual Facade work, approximate `top = baselineY - 0.8 × fontSizePx`; `compile-svg` performs this conversion. Letter spacing can be stored but is not rendered.

### Reading and editing existing text

Styled text is stored as a flat character stream plus `textRuns` — `[st, ed)` style intervals over the stream. Text with no run renders with the default style, each paragraph ends with a `\r` mark, and every editing position is a stream index.

Everything goes through the element's rich text, and you **`copy()` it the moment you take it — reads included**. `getRichText()` returns `null` for an element that cannot hold text (an image, for example), and a merely-empty text box copies fine and reads as `""`, so the optional chain tells empty apart from unsupported.

```js
shape.getText().getRichText()?.copy()?.toPlainText(); // plain text, or undefined when the element can't hold text
```

To read run structure or change text, copy the same way and work on the copy:

```js
const rt = shape.getText().getRichText().copy();
for (const paragraph of rt.getParagraphs()) {
  for (const run of paragraph.getTextRuns()) {
    if (run.getText() === "48%") run.setText("52%");
  }
}
shape.getText().setRichText(rt); // writes directly; no rebuild/updateShape needed
```

Skip the `copy()` and `paragraph.getTextRuns()` hands back an empty array instead of the runs — no error, so the loop body silently never runs while the code still looks right. Elements that cannot host text return `null` from `getRichText()`, and `setRichText` on one throws. Table cells serve their text through the same pair (`getCell(row, column).getRichText()`), under the same rule.

`run.setText()` swaps a run's text, keeps its style, and takes any length: the runs after it shift to match, so edit in any order, front to back included. A run emptied to `""` is gone, and its handle throws if reused. `setRichText` rewrites only the text — size, position, rotation, fill, stroke, padding, auto-fit, wrap, and alignment all survive. A box built by `setText` exposes its whole text as one unstyled run, so the same loop covers it.

Styling and structural edits go through the builder instead, addressed by stream index — take one from a run's `getRange()`, or search `rt.getData().body.dataStream` for a span that does not line up with a run. `setStyle` merges into what is already there, so it can add one attribute without restating the rest:

```js
const rt = shape.getText().getRichText().copy();
const run = rt.getTextRuns().find((r) => r.getText() === "52%");
const { startOffset, endOffset } = run.getRange();
rt.setStyle(startOffset, endOffset, { cl: { rgb: "#047857" } }); // now green and still bold
shape.getText().setRichText(rt);
```

Each paragraph ends in a `\r` that must never be deleted. Three builder edits misbehave silently: passing a style to `insertText` misplaces it (insert unstyled, then `setStyle`); the one-argument `delete(count)` does nothing, so always pass both; and run handles do **not** follow `insertText` or `delete` — re-read `getTextRuns()` after one instead of reusing handles fetched earlier, which otherwise start returning text sliced at stale offsets.

Prove every write with a fresh read-back in a later `execute`.

## Shapes, fill, and stroke

Shape types are string enums; query `ShapeTypeEnum`. Prefer built-in arrow shapes where suitable. Connectors use `FConnectorShape.bindStart` / `bindEnd` with stable target shape ids. Rounded rectangle adjustments and outer shadow belong to shape data; use the public `shapeData` create input or `setShapeData`, then verify screenshots. Arbitrary paths go through `setCustomGeometry` and must provide `dataArray`; the declared SVG-string field is not consumed by the renderer. Prefer `compile-svg` for complex geometry.

For every manually authored element, explicitly set fill, stroke, and text color. Do not rely on renderer defaults because stored values and rendered theme defaults differ.

- Fill with `setSolidFill`, `setGradientFill`, `setImageFill`, or `setNoneFill`.
- For visible strokes, set color and width explicitly. For no stroke, end the chain with `setStrokeLineType(api.Enum.ShapeLineTypeEnum.NoLine)`. Width zero does not disable a line, and a later width setter can re-enable one.
- Use `#RRGGBB` or `rgba(...)`; color names and `hsl()` are unsupported.

Legacy text boxes may store a white fill, gray line, dark 16-point text, and a 260 × 88 default size. A bare shape may store null fill and stroke while the renderer supplies an opaque blue theme fill. Storage inspection therefore does not prove rendered color.

## Images and textures

Use bitmap images for photos, logos, QR codes, 3D icons, and complex illustrations instead of Unicode or assemblies of primitive shapes. In SVG, reference a local path:

```svg
<image x="0" y="0" width="240" height="160" href="./materials/photo.png"/>
```

The compiler reads local PNG, JPEG, GIF, WebP, and SVG files and fails early for missing or invalid files. Prefer local files over HTTP URLs, which cannot be validated until rendering. Facade insertion supports BASE64 and URL sources. `setCrop` values are distances cropped from each edge in displayed element pixels, not source pixels or percentages; scale crop values with the displayed size. `setClipShape` can crop to a preset shape.

For `compile-svg`, source images should be local assets; the compiler embeds them into the program
applied to the remote Unit. Never place a full-page reference screenshot behind editable elements; it
leaves artifacts and destroys editability. For decorative noise, dots, or grids, tile a small bitmap
rather than creating hundreds of tiny shapes.

## Editing existing pages

For dense pages, lay out a structural skeleton and then add logical blocks. Record returned element ids. To rebuild one block, **delete every one of its old elements first**, then reapply an SVG containing only that block with `--add` — skipping the deletion leaves the old block underneath the new one. When in doubt, redraw the whole page and reapply it with `--page N`. Always review the full page after block edits.

## Stacking order

There is no `zIndex`. Stacking is the element order, bottom to top — the same rule as SVG document order and OOXML `spTree` — and `compile-svg` preserves your SVG's document order exactly. A normal `insertShape` lands on top; move the returned shape with `bringToFront`, `bringForward`, `sendBackward`, or `sendToBack`, or use the complete-order command below for an exact index. Only snapshot restoration through `insertElement(element, index)` accepts an insertion index. `getElements()` and the `elements` array in `inspect presentation` both list stacking order, bottom to top.

For an exact complete order, use the reorder command. Each mutation commits a Worktree revision, so
verify it immediately:

```js
function reorderElementTo(slide, elementId, targetIndex) {
  const order = slide
    .getElements()
    .map((el) => el.getId())
    .filter((id) => id !== elementId);
  order.splice(Math.max(0, Math.min(targetIndex, order.length)), 0, elementId);
  return univerAPI.executeCommand("slide.command.reorder-elements", {
    unitId: presentation.getId(),
    subUnitId: slide.getId(),
    drawingIds: order,
  });
}
// bottom: reorderElementTo(slide, id, 0)   top: reorderElementTo(slide, id, slide.getElements().length)
```

Two traps, both verified against the real runtime:

- `drawingIds` must be the **complete** order. A partial list moves the listed elements to the **bottom**, not the top: the listed ids become the new bottom of the stack in the given order, and every unlisted element keeps its relative order above them. The helper always sends the full list — prefer it over hand-building `drawingIds`.
- A wrong `elementId` is a silent no-op that still returns `true`, so the return value is not evidence. Confirm any restack by reading `getElements()` back.

## Native charts

Slide chart support is registered in the runtime. Create and manage native data-driven charts through
the host-owned `slide.charts` collection (`FSlideCharts`). Query `univer-workspace-cli api show
FSlideCharts.insert FSlideCharts.remove FChartBase.commit FChartBuilderBase.setType
FChartBuilderBase.setTitle ChartTypeString` when the exact builder surface matters.

Build charts detached, configure them, then `await charts.insert(builder)`. The first data row is the header row; use field indexes to declare category and value columns:

```js
const slide = presentation.getSlideByIndex(2);
const charts = slide.charts;
const chart = charts
  .create()
  .setType(univerAPI.Enum.ChartTypeString.Donut)
  .setTitle({ text: "Design Elements" });
chart
  .setData([
    ["Design element", "Share"],
    ["Color", 30],
    ["Composition", 22],
    ["Typography", 20],
    ["Graphics", 16],
    ["Cultural symbols", 12],
  ])
  .setCategoryField(0)
  .setValueFields([1])
  .setDoughnutHole(0.46)
  .setLegend(true)
  .setAbsolutePosition(390, 160)
  .setSize(260, 220);
const inserted = await charts.insert(chart);
return { chartId: inserted.getId(), chart: inserted.describe() };
```

An existing chart is already a builder bound to its host. Set the pending data and call `commit()`
to update that chart in place; its host ID, type, title, position, and chart count stay unchanged:

```js
const slide = presentation.getSlideByIndex(2);
const chart = slide.charts.list()[0];
if (!chart) throw new Error("Expected an existing chart");
chart.setData(values).commit();
return { chartId: chart.getId(), chart: chart.describe() };
```

The collection has two persistence paths: `await charts.insert(builder)` adds a detached builder from
`charts.create()`, while `commit()` persists pending changes on a host-bound builder returned by
`charts.list()` or `charts.get(id)`. `getData()` and `describe()` expose pending values before the
commit. Remove a chart with `await charts.remove(chartOrId)` and check the returned boolean. In a
later `execute`, read the collection again: after an update, confirm the chart ID, count, type,
title, and data; after a removal, confirm the chart is absent.

`insert` is asynchronous; await it before `execute` returns. Verify persistence with a fresh `slide.charts.list().map((item) => item.describe())` read, confirm `inspect presentation --pages <n>` reports a chart element, then screenshot the page and test the exported PPTX. Insert charts after the final full-page SVG replacement, which replaces every page element.

Use model readback as structural proof and the rendered series as visual proof. If `univer-workspace-cli screenshot`
captures the generic blue loading placeholder, run `univer-workspace-cli open --worktree <id> --unit <id>`, open the returned Workspace review URL, wait for the real series to appear, and capture that rendered page.

## Transitions

A transition is the page-enter effect played when the show moves **to** that slide: "fade from page 2 to page 3" is set on page 3, not on page 2. Full preset API, discoverable with `api find transition`:

```js
const slide = presentation.getSlideByIndex(2);
slide.setTransition({
  type: univerAPI.Enum.SlideTransitionTypeEnum.Push,
  duration: 1000, // ms, default 700
  direction: univerAPI.Enum.SlideTransitionDirectionEnum.Right, // "from": the new page enters from the right
});
return slide.getTransition();
```

- `direction` only applies to `Push`, `Wipe`, `Cover`, `Uncover`, `Reveal`, and `Split`; on other types it is silently dropped and does not read back.
- `advanceOnClick`, `advanceAfterTime`, `speed`, and `sound` are stored and read back, but nothing plays them — auto-advance and transition sounds are unsupported, so say so instead of setting dead fields.
- `setTransition()` with no argument clears the slide's transition. `presentation.applyTransitionToAll(t)` covers every slide that exists at call time, and a later per-slide `setTransition` overrides it.
- No visual surface verifies transitions: screenshots, `inspect presentation`, and `lint` all ignore them. The `getTransition()` read-back is the only evidence; include it in your report when a task requires transitions.

## Tables

A table is one element holding a grid of cells; each cell carries rich text. `compile-svg` emits only shapes and images, so a grid drawn in SVG is loose lines that look like a table without being one.

Build one with `slide.newTable()` — `setValues`, `setRows` / `setColumns`, `setColumnWidth` / `setRowHeight`, `setAbsolutePosition` / `setSize` — then `slide.insertTable(builder.build())`. The builder is the only way to place one: `insertTableFromData(values, { rows, columns })` takes **no position**, so its tables stack at one default spot. Read with `table.describe()` — grid size, style, widths, and `sampleRows` of the cell text. Cells are zero-based: `getCellText` / `setCellText(row, column, text)`, or `getCell(row, column)` for `setStyle`, `mergeTo`, and `getRichText` / `setRichText`. Grid edits (`insertRowsBefore`, `appendRows`, `deleteColumns`, `resize`, `mergeCells`) return booleans, so check them.

**Styling takes two settings that must agree.** `setStyleId(id)` picks the palette; `setOptions({ firstRow, bandRow, firstCol, lastCol, lastRow, bandCol })` decides which roles paint — `setStyleId("univerPrimaryHeaderBandedRows")` alone renders a plain grid until you also `setOptions({ firstRow: true, bandRow: true })`. Ids are `univer` + family (`Neutral`, `Primary`, `Blue`, `Cyan`, `Green`, `Orange`, `Purple`, `Pink`) + variant (`LightPlainGrid`, `LightHeader`, `LightHeaderBandedRows`, `MediumStrongHeader`, `MediumFirstColumn`, `MediumHeaderFirstColumn`, `HorizontalLines`), plus `univerPrimaryPlainGrid` (the default). **`setStyleId` does not validate** — a misspelled id returns `true` and the styling is silently lost. Cell fill and borders go through `setCellStyle(range, style)`, text color and font through `setCellTextStyle(range, textStyle)`.

`univer-workspace-cli api show FSlideTable` gives the rest.

## Capability boundary

- Element animation (entrance/emphasis/exit/motion-path effects on elements) is unsupported: a storage schema exists, but nothing plays, renders, or exports it. Do not write animation data into the snapshot; state the limitation instead. Speaker notes and master/layout-page editing are likewise not exposed by the Facade.
- Non-image elements do not support arbitrary clipping, masks, blur, or glow; only preset outer shadows are available.
- Letter spacing is stored but not rendered.
- There is no zIndex field and no bringToFront/sendToBack helpers; stacking is the element order (see "Stacking order").

Always finish with rendered screenshots before following the core Skill's "Finish the task" steps;
logical inspection alone cannot establish visual correctness.

Export only after every page has passed logical and visual verification:

```bash
univer-workspace-cli screenshot --worktree <id> --unit <id> --pages all
univer-workspace-cli export output.pptx --worktree <id> --unit <id>
```
