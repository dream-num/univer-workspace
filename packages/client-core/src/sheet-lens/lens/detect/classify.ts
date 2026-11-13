// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/classify.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Layer 5: classification of one block into table / matrix / form / text / other (the lens kpi/block kinds map to
// `other`, as in the gold). Rule order matters; when no rule is confident the answer is `other`.

import type { Rect } from "../ranges.js";
import { emphasisShare, headerScore, rowStats } from "./anchors.js";
import type { DetectConfig } from "./config.js";
import { countIn, type FeatureSheet, gi, NF, styledIn, VT } from "./features.js";

export type Kind = "table" | "matrix" | "form" | "text" | "other";
export interface Classified {
  kind: Kind;
  confidence: number;
  why: string;
  headerRows: number;
}

const isTextish = (t: number) => t === VT.text || t === VT.bool || t === VT.error;

interface ColProfile {
  n: number;
  dominant: number;
  share: number;
  fmt: number;
}
function columnProfiles(fs: FeatureSheet, q: Rect, r0: number): ColProfile[] {
  const out: ColProfile[] = [];
  for (let c = q.c0; c <= q.c1; c++) {
    const hist = new Map<number, number>();
    const fmts = new Map<number, number>();
    let n = 0;
    for (let r = r0; r <= q.r1; r++) {
      const k = gi(fs, r, c);
      const t = fs.vt[k] ?? 0;
      if (!t) continue;
      n++;
      const kind = isTextish(t) ? VT.text : t;
      hist.set(kind, (hist.get(kind) ?? 0) + 1);
      if (kind === VT.num) {
        const nf = fs.nf[k] ?? 0;
        fmts.set(nf, (fmts.get(nf) ?? 0) + 1);
      }
    }
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const fmt = [...fmts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? NF.none;
    out.push({ n, dominant: top?.[0] ?? 0, share: top && n ? top[1] / n : 0, fmt });
  }
  return out;
}

export function classify(fs: FeatureSheet, q: Rect, cfg: DetectConfig): Classified {
  const rows = q.r1 - q.r0 + 1,
    cols = q.c1 - q.c0 + 1;
  const n = countIn(fs, q);
  const density = (n + styledIn(fs, q)) / (rows * cols); // a bordered empty template body is part of the table's grid
  const done = (kind: Kind, why: string, confidence: number, headerRows = 0): Classified => ({
    kind,
    why,
    confidence: Math.round(confidence * 100) / 100,
    headerRows,
  });

  if (n === 1) {
    const t = fs.vt[gi(fs, q.r0, q.c0)];
    return t === VT.text
      ? done("text", "rule:single-text-cell", 0.8)
      : done("other", "rule:single-value-cell", 0.7);
  }
  let textCells = 0,
    numCells = 0;
  for (let r = q.r0; r <= q.r1; r++) {
    const s = rowStats(fs, r, q.c0, q.c1);
    textCells += s.text;
    numCells += s.num + s.date;
  }
  if (rows === 1) {
    const firstText =
      fs.vt[gi(fs, q.r0, q.c0)] === VT.text ? (fs.texts.get(gi(fs, q.r0, q.c0)) ?? "") : "";
    if (n <= 4 && /[:：]\s*$/.test(firstText.trim()))
      return done("form", "rule:single-row-label-colon", 0.6);
    if (textCells === n) return done("text", "rule:single-row-all-text", 0.7);
    return done("other", "rule:single-row-mixed", 0.6);
  }
  if (n <= 3) return done(textCells === n ? "text" : "other", "rule:few-cells", 0.5); // 2-3 scattered cells: a kpi / label group
  const hdr = rowStats(fs, q.r0, q.c0, q.c1);
  const hdrScore = headerScore(hdr);
  if (cols === 1) {
    if (textCells === n)
      return done(
        rows >= 3 && emphasisShare(hdr) >= 0.5 ? "table" : "text",
        "rule:single-column-text",
        0.6,
        emphasisShare(hdr) >= 0.5 ? 1 : 0,
      );
    return done(
      rows >= 3 ? "table" : "other",
      "rule:single-column-values",
      0.5,
      hdrScore >= cfg.headerScoreMin ? 1 : 0,
    );
  }

  // form: label column (first column) of text labels, mostly "label:" or bold, value cells beside them
  const firstCol = [] as string[];
  for (let r = q.r0; r <= q.r1; r++)
    if (fs.vt[gi(fs, r, q.c0)] === VT.text) firstCol.push(fs.texts.get(gi(fs, r, q.c0)) ?? "");
  const colon = firstCol.filter((s) => /[:：]\s*$/.test(s.trim())).length;
  const labelRows = (() => {
    let k = 0;
    for (let r = q.r0; r <= q.r1; r++) if (fs.vt[gi(fs, r, q.c0)] === VT.text) k++;
    return k;
  })();
  if (cols <= 3 && labelRows >= Math.ceil(rows * 0.6) && colon >= Math.ceil(labelRows * 0.5))
    return done("form", "rule:label-colon-values", 0.75);

  // headers
  const body = rowStats(fs, q.r0 + 1, q.c0, q.c1);
  const hasHeader =
    hdrScore >= cfg.headerScoreMin &&
    (hdrScore - headerScore(body) >= 0.15 ||
      emphasisShare(hdr) >= 0.5 ||
      body.num + body.date > body.text);
  const bodyTop = hasHeader ? q.r0 + 1 : q.r0;
  const prof = columnProfiles(fs, q, bodyTop);
  const populated = prof.filter((p) => p.n > 0);
  const homog = populated.length
    ? populated.reduce((s, p) => s + p.share, 0) / populated.length
    : 0;

  // matrix: row labels + column labels + homogeneous numeric body
  if (rows >= 3 && cols >= 3 && hasHeader) {
    const topLeftEmpty = fs.vt[gi(fs, q.r0, q.c0)] === 0;
    let bodyCells = 0,
      bodyNum = 0;
    const labelText = [] as number[];
    for (let r = bodyTop; r <= q.r1; r++) {
      if (isTextish(fs.vt[gi(fs, r, q.c0)] ?? 0)) labelText.push(r);
      for (let c = q.c0 + 1; c <= q.c1; c++) {
        const t = fs.vt[gi(fs, r, c)];
        if (t) {
          bodyCells++;
          if (t === VT.num) bodyNum++;
        }
      }
    }
    const rowLabelShare = labelText.length / (q.r1 - bodyTop + 1);
    const fmts = new Set(
      prof
        .slice(1)
        .filter((p) => p.n > 0 && p.dominant === VT.num)
        .map((p) => p.fmt),
    );
    const yearHeader = hdr.year + hdr.date >= hdr.n - 1 && hdr.n >= 3;
    if (
      rowLabelShare >= 0.7 &&
      bodyCells &&
      bodyNum / bodyCells >= cfg.matrixNumericShare &&
      (topLeftEmpty || yearHeader) &&
      fmts.size <= 1
    ) {
      return done(
        "matrix",
        `rule:crosstab(topLeft=${topLeftEmpty ? "empty" : "label"},year=${yearHeader ? 1 : 0})`,
        0.7,
        1,
      );
    }
  }

  // a header row over exactly one value row is a (horizontal) key/value block
  if (rows === 2 && hasHeader && cols <= 4 && rowStats(fs, q.r1, q.c0, q.c1).n >= 2)
    return done("form", "rule:header-over-value-row", 0.5, 1);

  if (density >= cfg.minDensity && homog >= cfg.columnHomogeneity && rows >= 2) {
    return done(
      "table",
      `rule:table(header=${hasHeader ? 1 : 0},homog=${homog.toFixed(2)},dens=${density.toFixed(2)})`,
      0.4 + 0.3 * homog + 0.3 * density,
      hasHeader ? 1 : 0,
    );
  }
  // two-column key/value list without colons: text labels beside mixed values
  if (cols === 2 && !hasHeader && labelRows === rows && numCells > 0)
    return done("form", "rule:two-column-label-values", 0.5);
  if (textCells === n && rows >= 2 && cols >= 2 && density >= cfg.minDensity)
    return done("text", "rule:all-text-block", 0.4);
  return done(
    "other",
    `rule:unsure(header=${hasHeader ? 1 : 0},homog=${homog.toFixed(2)},dens=${density.toFixed(2)})`,
    0.3,
  );
}
