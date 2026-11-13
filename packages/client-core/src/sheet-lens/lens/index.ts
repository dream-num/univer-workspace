// The lens: a snapshot in, an outline out. Pure: no I/O, no Univer instance. The host supplies display text.

export { DEFAULT_CONFIG } from "./detect/config.js";
export { type DetectedRegion, type DetectResult, detectRegions } from "./detect/detect.js";
export { featureSheetOf } from "./detect/features.js";
export { type FindIn, type FindResult, findCells, findJson, renderFind } from "./find.js";
export { type DisplayReader, sheetCellsOf, workbookFromData } from "./outline/cells.js";
export {
  allNodes,
  buildOutlineModel,
  type OutlineModel,
  type OutlineNode,
} from "./outline/model.js";
export {
  elisionLabel,
  type OutlineOptions,
  type OutlineRender,
  renderOutline,
} from "./outline/render.js";
export { colName, parseArea, type Rect, rectToA1 } from "./ranges.js";
export {
  type Content,
  nameList,
  pageJson,
  parseRange,
  type ReadPage,
  rangeText,
  readPage,
  renderCsv,
  renderGrid,
  renderSheetText,
  resolveRect,
  sheetIndexOf,
  sheetLabel,
  sheetNames,
} from "./read.js";
export { structureOf } from "./structure.js";
