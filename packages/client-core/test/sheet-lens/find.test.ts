// The pure part of `uxl find`: matching, order, paging, counts, rendering.
import { describe, expect, test } from "vitest";
import {
  type FindOptions,
  findCells,
  findJson,
  renderFind,
} from "../../src/sheet-lens/lens/find.js";
import { num, type SheetInit, sheetOf, snapshot, text } from "./support/lens-data.js";

const opts = (o: Partial<FindOptions> & { terms: string[] }): FindOptions => ({
  in: "values",
  caseSensitive: false,
  max: 50,
  ...o,
});
/** `show` replaces the display text of single cells, as a number format would. */
const run = (
  inits: SheetInit[],
  o: Parameters<typeof opts>[0],
  show?: (row: number, column: number) => string | undefined,
) => {
  const data = snapshot(...inits);
  const result = findCells(
    data.sheetOrder.map((_, i) => sheetOf(data, i, show)),
    opts(o),
  );
  return { result, text: renderFind(result, opts(o)), json: findJson(result, opts(o)) };
};
const refs = (r: ReturnType<typeof run>) => r.result.hits.map((h) => `${h.sheet}!${h.cell.ref}`);

describe("matching", () => {
  const cells = {
    0: { 0: text("Apple"), 1: text("pineapple"), 2: text("A*B"), 3: text("a.b") },
    1: { 0: num(0.075, { s: { n: { pattern: "0%" } } }), 1: { v: "TRUE", t: 3 } },
  };
  test("substring, and not case-sensitive by default", () => {
    expect(refs(run([{ cells }], { terms: ["APPLE"] }))).toEqual(["Sheet1!A1", "Sheet1!B1"]);
  });
  test("--case", () => {
    expect(refs(run([{ cells }], { terms: ["apple"], caseSensitive: true }))).toEqual([
      "Sheet1!B1",
    ]);
  });
  test("wildcards and regex characters are literal", () => {
    expect(refs(run([{ cells }], { terms: ["A*"] }))).toEqual(["Sheet1!C1"]);
    expect(refs(run([{ cells }], { terms: ["."] }))).toEqual(["Sheet1!D1", "Sheet1!A2"]); // "a.b" and 0.075
  });
  test("the stored value matches as well as the display", () => {
    // display "8%" (format 0%), stored 0.075
    const show = (r: number, c: number) => (r === 1 && c === 0 ? "8%" : undefined);
    expect(refs(run([{ cells }], { terms: ["8%"] }, show))).toEqual(["Sheet1!A2"]);
    expect(refs(run([{ cells }], { terms: ["0.075"] }, show))).toEqual(["Sheet1!A2"]);
  });
  test('formulas: the text of the formula with its "=", and only formula cells', () => {
    const f = {
      0: { 0: text("SUM(x)"), 1: { f: "=SUM(A1:A3)", v: 6, t: 2 }, 2: { f: "=B1*2", v: 12, t: 2 } },
    };
    expect(refs(run([{ cells: f }], { terms: ["sum("], in: "formulas" }))).toEqual(["Sheet1!B1"]);
    expect(refs(run([{ cells: f }], { terms: ["=b1"], in: "formulas" }))).toEqual(["Sheet1!C1"]);
    expect(refs(run([{ cells: f }], { terms: ["sum("] }))).toEqual(["Sheet1!A1"]); // values: the text cell, not the formula
  });
  test("empty cells never match, and are not counted as searched", () => {
    const r = run([{ cells: { 0: { 0: text(""), 1: text("x") } } }], { terms: ["x"] });
    expect([r.result.total, r.result.searched]).toEqual([1, { sheets: 1, cells: 1 }]);
  });
});

describe("terms", () => {
  const cells = { 0: { 0: text("Apple pie"), 1: text("Pear"), 2: text("Fig") } };
  test("a cell is listed once with every term it contains; counts are per term", () => {
    const r = run([{ cells }], { terms: ["pie", "apple", "zzz", "e"] });
    expect(r.result.hits.map((h) => h.terms)).toEqual([["pie", "apple", "e"], ["e"]]);
    expect(r.result.counts).toEqual([1, 1, 0, 2]);
    expect(r.text.trimEnd().split("\n").at(-1)).toBe('terms: "pie"=1 "apple"=1 "zzz"=0 "e"=2');
  });
  test("the same word twice is two terms with the same count", () => {
    const r = run([{ cells }], { terms: ["fig", "fig"] });
    expect([r.result.total, r.result.counts, r.result.hits[0]?.terms]).toEqual([
      1,
      [1, 1],
      ["fig", "fig"],
    ]);
  });
});

describe("order, --from and paging", () => {
  const rows = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, r) => [r, { 1: text("x"), 0: text("x") }]));
  const two = [
    { name: "One", cells: rows(3) },
    { name: "Two", cells: rows(2) },
  ];
  test("sheet order, then row-major (a cell stored after another in the same row still comes in column order)", () => {
    expect(refs(run(two, { terms: ["x"] }))).toEqual([
      "One!A1",
      "One!B1",
      "One!A2",
      "One!B2",
      "One!A3",
      "One!B3",
      "Two!A1",
      "Two!B1",
      "Two!A2",
      "Two!B2",
    ]);
  });
  test("--from is inclusive, counts start there, and it can name a cell without a hit", () => {
    const r = run(two, { terms: ["x"], from: { sheet: 0, r: 2, c: 1 } });
    expect(refs(r)).toEqual(["One!B3", "Two!A1", "Two!B1", "Two!A2", "Two!B2"]);
    expect([r.result.total, r.result.counts, r.result.searched.cells]).toEqual([5, [5], 5]);
    expect(refs(run(two, { terms: ["x"], from: { sheet: 1, r: 0, c: 0 } })).length).toBe(4);
    expect(refs(run(two, { terms: ["x"], from: { sheet: 1, r: 1, c: 2 } }))).toEqual([]);
  });
  test("--max keeps the first hits, counts the rest and names the next one", () => {
    const r = run(two, { terms: ["x"], max: 3 });
    expect(refs(r)).toEqual(["One!A1", "One!B1", "One!A2"]);
    expect([r.result.total, r.result.next]).toEqual([10, { sheet: "One", ref: "B2" }]);
    expect(r.text.split("\n")[0]).toBe('find "x" [in=values, cells=10]');
  });
  test("no truncation: no next", () => {
    expect(run(two, { terms: ["x"], max: 10 }).result.next).toBeNull();
  });
  test("paging with the next hit as --from covers everything once", () => {
    const seen: string[] = [];
    let from: FindOptions["from"];
    for (let guard = 0; guard < 20; guard++) {
      const r = run(two, { terms: ["x"], max: 4, ...(from ? { from } : {}) });
      seen.push(...refs(r));
      if (!r.result.next) break;
      const sheet = two.findIndex((s) => s.name === r.result.next?.sheet);
      const m = /^([A-Z]+)(\d+)$/.exec(r.result.next.ref) as RegExpExecArray;
      from = { sheet, r: Number(m[2]) - 1, c: (m[1] as string).charCodeAt(0) - 65 };
    }
    expect(seen).toEqual(refs(run(two, { terms: ["x"] })));
  });
});

describe("rendering", () => {
  test("a title, a header, one tab-separated line per hit; sheet names that need it are quoted", () => {
    const r = run([{ name: "O'Neil Q1", cells: { 0: { 0: { f: "=1+1", v: "two", t: 1 } } } }], {
      terms: ["two"],
    });
    expect(r.text).toBe(
      'find "two" [in=values, cells=1]\nref\tdisplay\tformula\tterms\n\'O\'\'Neil Q1\'!A1\t"two"\t"=1+1"\t["two"]\n',
    );
  });
  test("control characters cannot break a line or a column", () => {
    const nasty = ["a\nb x", "tab\there x", 'say "x"', "ls ps x", "nel\u0085x"];
    const r = run([{ cells: Object.fromEntries(nasty.map((v, i) => [i, { 0: text(v) }])) }], {
      terms: ["x"],
    });
    const lines = r.text.trimEnd().split("\n");
    expect(lines).toHaveLength(2 + nasty.length);
    for (const line of lines.slice(2)) expect(line.split("\t")).toHaveLength(4);
    expect(lines.slice(2).map((l) => JSON.parse(l.split("\t")[1] as string))).toEqual(nasty);
  });
  test("nothing found: the title and a hint, and the hint points to the other search", () => {
    const a = run([{ cells: { 0: { 0: text("a") } } }], { terms: ["zzz"] });
    expect(a.text).toBe(
      'find "zzz" [in=values, cells=0]\nno cell matches in the values of 1 sheet; try --in formulas, a shorter term, or run outline on this Unit\n',
    );
    const b = run([{}, {}], { terms: ["zzz"], in: "formulas", caseSensitive: true });
    expect(b.text).toBe(
      'find "zzz" [in=formulas, case, cells=0]\nno cell matches in the formulas of 2 sheets; try --in values, a shorter term, or run outline on this Unit\n',
    );
  });
  test("JSON carries what the text carries, plus the stored value", () => {
    const r = run(
      [{ cells: { 0: { 0: num(0.075, { s: { n: { pattern: "0%" } } }) } } }],
      { terms: ["8%"] },
      () => "8%",
    );
    expect(r.json).toEqual({
      terms: ["8%"],
      in: "values",
      caseSensitive: false,
      searched: { sheets: 1, cells: 1 },
      total: 1,
      counts: [{ term: "8%", cells: 1 }],
      cells: [
        { sheet: "Sheet1", ref: "A1", type: "percent", display: "8%", value: 0.075, terms: ["8%"] },
      ],
    });
  });
});
