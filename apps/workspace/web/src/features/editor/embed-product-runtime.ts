// The embedded Sheet runtime loads its presets from the shared package, which
// owns no styles. Load the published Sheet preset styles here so the host
// ships them with the embed runtime instead of importing the whole comparison
// preset module.
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-advanced/lib/index.css";

/** The original embed product runtime is shared with the Space Plugin. */
export { createEmbedProductRuntime } from "@univerjs/univer-workspace-editor-presets/embed-product-runtime";
