// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/config.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// All tunable thresholds of detector v0 and of the SpreadsheetLLM-style anchors baseline (B1) in ONE object.
// The evaluation prints this object verbatim in the report. Thresholds were chosen by hand and only adjusted on the DEV split.
export interface DetectConfig {
  // layer 4: segmentation
  /** empty lines tolerated INSIDE one connected component; 1 => a gap of >= 2 empty rows/cols separates blocks */
  gapTolerance: number;
  /** a row/column counts as header-like when its header score is >= this */
  headerScoreMin: number;
  /** a line with at most this many cells is a title-like line (blank-row rules) */
  sparseMaxCells: number;
  /** every row above the header row must fill at most this share of the block width to be peeled as preamble */
  preambleMaxShare: number;
  /** leading rows above the header row are peeled into their own regions only if the header sits within this many rows */
  maxPreambleRows: number;
  /** a trailing single text cell at least this long is a note and is peeled off the table above */
  noteMinChars: number;
  /** a single-row block (peeled title / kpi line) is cut only by a gap of this many empty columns */
  lineGapSplit: number;
  /** the top/bottom row is cut off when fewer than this share of its columns are also occupied by the rest of the block */
  overhangShare: number;
  /** minimum Delta (L1 of row signatures, see anchors.ts) between row k-1 and k to allow a style-change cut */
  styleCutDelta: number;
  // layer 5: classification
  /** minimum share of a column's body cells that must share its dominant value type (table / matrix) */
  columnHomogeneity: number;
  /** minimum non-empty share of the bounding box for table / matrix */
  minDensity: number;
  /** minimum share of numeric body cells for matrix */
  matrixNumericShare: number;
  // B1 anchors
  anchorDelta: number;
  anchorMaxLines: number;
  anchorMinDensity: number;
  anchorMinEdgeFill: number;
  anchorMaxCandidates: number;
}

export const DEFAULT_CONFIG: DetectConfig = {
  gapTolerance: 1,
  headerScoreMin: 0.6,
  sparseMaxCells: 2,
  preambleMaxShare: 0.75,
  maxPreambleRows: 4,
  noteMinChars: 20,
  lineGapSplit: 3,
  overhangShare: 0.34,
  styleCutDelta: 1.0,
  columnHomogeneity: 0.7,
  minDensity: 0.5,
  matrixNumericShare: 0.8,
  anchorDelta: 2.0,
  anchorMaxLines: 16,
  anchorMinDensity: 0.4,
  anchorMinEdgeFill: 0.5,
  anchorMaxCandidates: 400,
};
