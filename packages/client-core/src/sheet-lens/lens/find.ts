// `uxl find`: the cells whose text contains a query word. Pure: sheet models in, a page of
// hits out; the text and the JSON are rendered from the same result.
import type { SheetCells } from "./outline/cells.js";
import { hasContent, json, type ReadCell, readCell, refOf, sheetLabel } from "./read.js";

export type FindIn = "values" | "formulas";

export interface FindOptions {
  terms: string[];
  in: FindIn;
  caseSensitive: boolean;
  /** The first cell to consider (inclusive), as a sheet position and 0-based row and column. */
  from?: { sheet: number; r: number; c: number };
  /** Hits to keep; the rest are counted. */
  max: number;
}

export interface Hit {
  sheet: string;
  cell: ReadCell;
  /** The query words this cell contains, in command-line order. */
  terms: string[];
}

export interface FindResult {
  hits: Hit[];
  /** Cells that match, from the start position on, including those beyond `max`. */
  total: number;
  /** Per query word, in command-line order. */
  counts: number[];
  searched: { sheets: number; cells: number };
  /** The first hit that was not kept. */
  next: { sheet: string; ref: string } | null;
}

/** Walks the sheets in order (they are built one at a time and dropped), row-major inside each. */
export function findCells(sheets: Iterable<SheetCells>, o: FindOptions): FindResult {
  const fold = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
  const needles = o.terms.map(fold);
  const out: FindResult = {
    hits: [],
    total: 0,
    counts: o.terms.map(() => 0),
    searched: { sheets: 0, cells: 0 },
    next: null,
  };
  for (const sc of sheets) {
    out.searched.sheets++;
    for (const r of sc.rowNums) {
      for (const cell of sc.byRow.get(r) ?? []) {
        if (
          o.from &&
          (sc.index < o.from.sheet ||
            (sc.index === o.from.sheet && (r < o.from.r || (r === o.from.r && cell.c < o.from.c))))
        )
          continue;
        if (!hasContent(cell)) continue;
        out.searched.cells++;
        const texts =
          o.in === "formulas"
            ? cell.formula === undefined
              ? []
              : [`=${cell.formula}`]
            : [...new Set([cell.text, cell.raw === null ? "" : String(cell.raw)])];
        const folded = texts.filter((t) => t !== "").map(fold);
        const matched = needles.flatMap((n, i) => (folded.some((t) => t.includes(n)) ? [i] : []));
        if (matched.length === 0) continue;
        out.total++;
        for (const i of matched) out.counts[i] = (out.counts[i] ?? 0) + 1;
        if (out.hits.length < o.max)
          out.hits.push({
            sheet: sc.name,
            cell: readCell(cell, r, cell.c, undefined),
            terms: matched.map((i) => o.terms[i] as string),
          });
        else out.next ??= { sheet: sc.name, ref: refOf(r, cell.c) };
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- rendering

export function renderFind(
  result: FindResult,
  o: Pick<FindOptions, "terms" | "in" | "caseSensitive">,
): string {
  const attrs = [`in=${o.in}`, ...(o.caseSensitive ? ["case"] : []), `cells=${result.total}`];
  const lines = [`find ${o.terms.map(json).join(" ")} [${attrs.join(", ")}]`];
  if (result.total === 0) {
    const n = result.searched.sheets;
    const other = o.in === "values" ? "searching formulas" : "searching values";
    lines.push(
      `no cell matches in the ${o.in} of ${n} sheet${n === 1 ? "" : "s"}; try ${other}, a shorter term, or run outline on this Unit`,
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push("ref\tdisplay\tformula\tterms");
  for (const h of result.hits)
    lines.push(
      [
        `${sheetLabel(h.sheet)}!${h.cell.ref}`,
        json(h.cell.display),
        json(h.cell.formula ?? ""),
        json(h.terms),
      ].join("\t"),
    );
  if (o.terms.length > 1)
    lines.push(`terms: ${o.terms.map((t, i) => `${json(t)}=${result.counts[i]}`).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

/** The `result` fields that come from the search; the caller adds `file`, `format`, `from` and `truncated`. */
export function findJson(
  result: FindResult,
  o: Pick<FindOptions, "terms" | "in" | "caseSensitive">,
): Record<string, unknown> {
  return {
    terms: o.terms,
    in: o.in,
    caseSensitive: o.caseSensitive,
    searched: result.searched,
    total: result.total,
    counts: o.terms.map((term, i) => ({ term, cells: result.counts[i] })),
    cells: result.hits.map((h) => ({
      sheet: h.sheet,
      ref: h.cell.ref,
      type: h.cell.type,
      display: h.cell.display,
      value: h.cell.value,
      ...(h.cell.formula !== undefined ? { formula: h.cell.formula } : {}),
      terms: h.terms,
    })),
  };
}
