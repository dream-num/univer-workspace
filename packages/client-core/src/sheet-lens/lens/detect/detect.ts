// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/detect.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// detectRegions: deterministic region detector using cell features, segmentation and anchor reconciliation.
// No network, no LLM, no randomness. Layer 1 (explicit structure: tables, filters, defined names) is NOT used here: the gold
// sheets have 0% explicit coverage by construction, so it cannot be evaluated on them.
import { type Rect, rectToA1 } from "../ranges.js";
import { classify, type Kind } from "./classify.js";
import { DEFAULT_CONFIG, type DetectConfig } from "./config.js";
import { type FeatureSheet, MAX_GRID_CELLS } from "./features.js";
import { segment } from "./segment.js";

export interface DetectedRegion {
  range: string;
  rect: Rect;
  kind: Kind;
  confidence: number;
  why: string;
}
export interface DetectResult {
  regions: DetectedRegion[];
  notes: string[];
}

export function detectRegions(fs: FeatureSheet, cfg: DetectConfig = DEFAULT_CONFIG): DetectResult {
  const notes: string[] = [];
  if (fs.tooLarge) {
    notes.push(
      `skipped: bounding box ${fs.nr}x${fs.nc} = ${fs.nr * fs.nc} cells exceeds MAX_GRID_CELLS=${MAX_GRID_CELLS}; no regions produced`,
    );
    return { regions: [], notes };
  }
  if (!fs.nr) {
    notes.push("empty sheet");
    return { regions: [], notes };
  }
  if (fs.blankFormulaCells)
    notes.push(
      `${fs.blankFormulaCells} blank-rendering formula/whitespace cells treated as empty${fs.blankBox ? ` (within ${rectToA1(fs.blankBox)})` : ""}`,
    );
  const regions = segment(fs, cfg).map((b): DetectedRegion => {
    const c = classify(fs, b.rect, cfg);
    return {
      range: rectToA1(b.rect),
      rect: b.rect,
      kind: c.kind,
      confidence: c.confidence,
      why: `${b.origin}|${c.why}`,
    };
  });
  return { regions, notes };
}
