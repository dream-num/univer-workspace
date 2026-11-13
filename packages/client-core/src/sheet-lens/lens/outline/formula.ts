// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/formula.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Formula text helpers: shift a shared-formula master to another cell, and normalise a formula to the relative form of
// spec 4.5 (`{r}` same row, `{r-1}` previous row, absolute references kept). Regex based, not a full parser:
// string literals are skipped, whole-column / whole-row ranges are left untouched, names that look like cells
// (e.g. `Q1`) are treated as cells. These limits are listed in the README.
import { colName } from "../ranges.js";

const colNum = (letters: string): number =>
  [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// $? letters $? digits, not glued to an identifier on the left and not a function name / identifier on the right
const REF = /(?<![A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(!])/g;

export interface RefHit {
  cAbs: boolean;
  col: string;
  rAbs: boolean;
  row: number; // 1-based
}

function mapRefs(f: string, fn: (h: RefHit) => string): string {
  // odd segments are string literals
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((seg, i) =>
      i % 2
        ? seg
        : seg.replace(REF, (_m, d1: string, col: string, d2: string, row: string) =>
            fn({ cAbs: d1 === "$", col: col.toUpperCase(), rAbs: d2 === "$", row: Number(row) }),
          ),
    )
    .join("");
}

const abs = (h: RefHit, col: string, row: string): string =>
  `${h.cAbs ? "$" : ""}${col}${h.rAbs ? "$" : ""}${row}`;

/** Shifts relative references as if the formula were copied by (dr rows, dc columns). Used for shared-formula members. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  return mapRefs(f, (h) => {
    const row = h.rAbs ? h.row : Math.max(1, h.row + dr);
    const col = h.cAbs ? h.col : colName(Math.max(0, colNum(h.col) - 1 + dc));
    return abs(h, col, String(row));
  });
}

/** Relative-row form for a column pattern: `E4` in a formula hosted in row 5 (1-based) becomes `E{r-1}`; `$E$4` stays. */
export function relativize(f: string, hostRow0: number): string {
  return mapRefs(f, (h) => {
    if (h.rAbs) return abs(h, h.col, String(h.row));
    const off = h.row - (hostRow0 + 1);
    const tag = off === 0 ? "{r}" : off > 0 ? `{r+${off}}` : `{r${off}}`;
    return `${h.cAbs ? "$" : ""}${h.col}${tag}`;
  });
}

export const stripEq = (f: string): string => f.replace(/^=/, "");
