// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/ranges.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Small A1 / defined-name range helpers (0-based inclusive rectangles).
export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const MAX_ROW = 1048575;
export const MAX_COL = 16383;

const colIndex = (letters: string): number =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function rectToA1(r: Rect): string {
  const a = `${colName(r.c0)}${r.r0 + 1}`;
  const b = `${colName(r.c1)}${r.r1 + 1}`;
  return a === b ? a : `${a}:${b}`;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COL = /^\$?([A-Za-z]{1,3})$/;
const ROW = /^\$?(\d+)$/;

// Parses "A1", "A1:C3", "A:A", "1:3" (with optional $) into a rectangle; null if not a plain area.
export function parseArea(ref: string): Rect | null {
  const parts = ref.split(":");
  if (parts.length > 2) return null;
  const pt = (p: string): { r?: number; c?: number } | null => {
    let m = CELL.exec(p);
    if (m) return { c: colIndex(m[1] as string), r: Number(m[2]) - 1 };
    m = COL.exec(p);
    if (m) return { c: colIndex(m[1] as string) };
    m = ROW.exec(p);
    if (m) return { r: Number(m[1]) - 1 };
    return null;
  };
  const a = pt(parts[0] as string);
  const b = parts.length === 2 ? pt(parts[1] as string) : a;
  if (!a || !b) return null;
  const rows = [a.r, b.r].filter((x): x is number => x !== undefined);
  const cols = [a.c, b.c].filter((x): x is number => x !== undefined);
  return {
    r0: rows.length ? Math.min(...rows) : 0,
    r1: rows.length ? Math.max(...rows) : MAX_ROW,
    c0: cols.length ? Math.min(...cols) : 0,
    c1: cols.length ? Math.max(...cols) : MAX_COL,
  };
}

export interface SheetRef {
  sheetName: string;
  rect: Rect;
}

// Parses a defined-name formula that is purely one or more sheet-qualified areas, e.g.
// "Orders!$A$1:$D$6", "'My Sheet'!$A:$A", "(S1!A1:B2,S1!D1:E2)". Anything else (constants,
// OFFSET(...), external refs, unions mixed with operators) returns null = not range-type.
export function parseNameRanges(formula: string): SheetRef[] | null {
  let f = formula.trim().replace(/^=/, "");
  if (f.startsWith("(") && f.endsWith(")")) f = f.slice(1, -1);
  if (!f || f.startsWith("[")) return null;
  const out: SheetRef[] = [];
  const parts: string[] = [];
  let quoted = false,
    start = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "'") quoted = !quoted;
    if (f[i] === "," && !quoted) {
      parts.push(f.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted) return null;
  parts.push(f.slice(start));
  for (const part of parts) {
    const bang = part.lastIndexOf("!");
    if (bang <= 0) return null;
    let sheet = part.slice(0, bang).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'"))
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    else if (/[^\w.\u0080-￿]/.test(sheet)) return null;
    const rect = parseArea(part.slice(bang + 1).trim());
    if (!rect) return null;
    out.push({ sheetName: sheet, rect });
  }
  return out.length ? out : null;
}

export const inRect = (r: number, c: number, q: Rect): boolean =>
  r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1;
