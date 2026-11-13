// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/test/lens/truthfulness.ts
// (reference implementation, read-only). Tests of Lens.read are left out until `uxl read` (#19); expectations were adapted to uxl's
// outline (sheet counts, SheetLensError messages). Everything else is as in the reference.
import assert from "node:assert/strict";
import type {
  SnapshotCell as ICellData,
  Snapshot as IWorkbookData,
} from "../../../src/sheet-lens/engine/types.js";
import type { OutlineModel, OutlineNode } from "../../../src/sheet-lens/lens/outline/model.js";
import { parseArea } from "../../../src/sheet-lens/lens/ranges.js";

const REGION_KINDS = new Set(["table", "matrix", "form", "text", "kpi", "block"]);
type Raw = {
  r: number;
  c: number;
  v: unknown;
  t?: number | undefined;
  f?: string | undefined;
  si?: unknown;
  p?: unknown;
};
function rawCells(data: IWorkbookData, index: number): Raw[] {
  const s = data.sheets[data.sheetOrder[index] as string]!;
  const out: Raw[] = [];
  for (const [rk, row] of Object.entries(s.cellData ?? {})) {
    for (const [ck, c] of Object.entries((row ?? {}) as Record<string, ICellData | null>)) {
      if (!c) continue;
      out.push({
        r: Number(rk),
        c: Number(ck),
        v: c.v,
        t: c.t as number | undefined,
        f: c.f ?? undefined,
        si: c.si,
        p: (c as { p?: unknown }).p,
      });
    }
  }
  return out;
}
const rawText = (x: Raw): string => {
  const rich = (x.p as { body?: { dataStream?: string } } | undefined)?.body?.dataStream;
  const v = x.v ?? (rich !== undefined ? rich.replace(/\r\n?$/, "") : undefined);
  return v === undefined || v === null ? "" : String(v);
};
const rawError = (x: Raw): boolean =>
  !!(x.f || x.si) &&
  /^#(?:DIV\/0!|NAME\?|VALUE!|NUM!|N\/A|CYCLE!|REF!|SPILL!|CALC!|ERROR!|GETTING_DATA|NULL!)$/.test(
    rawText(x),
  );
const rawBlank = (x: Raw): boolean => rawText(x).trim() === "";
/** independent: a raw cell counts as number when t===2 or its v is a JS number */
const rawNum = (x: Raw): number | null =>
  (x.t === 2 || (typeof x.v === "number" && x.t !== 3)) &&
  rawText(x).trim() !== "" &&
  Number.isFinite(Number(x.v))
    ? Number(x.v)
    : null;

/** Recomputes the claims of every region / col / kpi / form / matrix node from raw cells. Returns the number of claims checked. */
export function verifyClaims(data: IWorkbookData, model: OutlineModel, label: string): number {
  let checked = 0;
  const fail = (m: string): never => assert.fail(`${label}: ${m}`);
  model.root.children!.forEach((sheetNode, si) => {
    const cells = rawCells(data, si);
    const nonBlank = cells.filter((x) => !rawBlank(x));
    const usedCells = cells.filter((x) => rawText(x) !== "" || x.f || x.si);
    const used = (() => {
      if (!usedCells.length) return null;
      const r = usedCells.map((x) => x.r);
      const c = usedCells.map((x) => x.c);
      return { r0: Math.min(...r), r1: Math.max(...r), c0: Math.min(...c), c1: Math.max(...c) };
    })();
    const usedAttr = sheetNode.attrs.used as string | undefined;
    if (used) {
      const ur = parseArea(usedAttr!)!;
      assert.deepEqual(ur, used, `${label}: sheet used= mismatch`);
      checked++;
    } else assert.equal(usedAttr, undefined);
    const inRect = (x: Raw, q: { r0: number; r1: number; c0: number; c1: number }) =>
      x.r >= q.r0 && x.r <= q.r1 && x.c >= q.c0 && x.c <= q.c1;
    for (const region of sheetNode.children!.filter((n) => REGION_KINDS.has(n.kind))) {
      const q = parseArea(region.range!)!;
      const inside = nonBlank.filter((x) => inRect(x, q));
      checked++;
      // range claim: non-empty and tight (every edge line holds a non-blank cell, except merged / kpi extents)
      if (region.kind !== "kpi" && !region.via && region.kind !== "block") {
        assert.ok(inside.length > 0, `${label}: ${region.ref} ${region.range} holds no content`);
        for (const edge of [
          (x: Raw) => x.r === q.r0,
          (x: Raw) => x.r === q.r1,
          (x: Raw) => x.c === q.c0,
          (x: Raw) => x.c === q.c1,
        ]) {
          if (!inside.some(edge))
            fail(`${region.ref} ${region.range} is not tight (an edge line is empty)`);
        }
      }
      if (region.kind === "table") {
        const header = Number(region.attrs.header ?? 1);
        const totals = region.attrs.totals as number | undefined;
        const body = q.r1 - q.r0 + 1 - header - (totals !== undefined ? 1 : 0);
        if (region.attrs.rows !== Math.max(0, body))
          fail(`${region.ref} rows=${region.attrs.rows}, raw says ${body}`);
        checked++;
        const bodyTop = q.r0 + header;
        const bodyEnd = totals !== undefined ? q.r1 - 1 : q.r1;
        for (const col of region.children!.filter((n) => n.kind === "col")) {
          const letter = col.range!;
          const c = [...letter].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
          const cs = nonBlank.filter((x) => x.c === c && x.r >= bodyTop && x.r <= bodyEnd);
          const a = col.attrs as {
            fill: number;
            nonBlank: number;
            rows: number;
            stat?: any;
            type: any;
            err?: number;
            f?: any;
          };
          assert.equal(a.rows, bodyEnd - bodyTop + 1, `${label}: ${col.ref} rows`);
          assert.equal(
            a.nonBlank,
            cs.length,
            `${label}: ${col.ref} nonBlank ${a.nonBlank} vs raw ${cs.length}`,
          );
          const exactFill = a.rows ? (100 * cs.length) / a.rows : 0;
          if (a.fill === 100)
            assert.equal(cs.length, a.rows, `${label}: ${col.ref} claims no gaps`);
          else
            assert.ok(
              Math.abs(a.fill - exactFill) <= 1 || a.fill === 99 || a.fill === 1 || a.fill === 0,
              `${label}: ${col.ref} fill ${a.fill}% vs ${exactFill.toFixed(1)}%`,
            );
          if (a.fill === 0) assert.equal(cs.length, 0);
          if (a.fill >= 1 && a.fill <= 99)
            assert.ok(
              cs.length > 0 && cs.length < a.rows,
              `${label}: ${col.ref} fill ${a.fill}% but raw has ${cs.length}/${a.rows}`,
            );
          checked += 2;
          if (a.stat?.k === "range") {
            const nums = cs.map(rawNum).filter((n): n is number => n !== null);
            assert.ok(nums.length > 0, `${label}: ${col.ref} range stat without numbers`);
            if (a.stat.of) {
              // mixed column: the range covers one family only, so it must be a sub-range made of values that exist
              assert.ok(
                nums.includes(a.stat.min.raw) && nums.includes(a.stat.max.raw),
                `${label}: ${col.ref} min/max absent from raw`,
              );
              assert.ok(
                a.stat.min.raw >= Math.min(...nums) && a.stat.max.raw <= Math.max(...nums),
                `${label}: ${col.ref} range outside raw`,
              );
              assert.equal(a.type.type, "mixed", `${label}: ${col.ref} 'of' on a non-mixed column`);
            } else {
              assert.equal(a.stat.min.raw, Math.min(...nums), `${label}: ${col.ref} min`);
              assert.equal(a.stat.max.raw, Math.max(...nums), `${label}: ${col.ref} max`);
            }
            checked += 2;
          }
          if (a.stat?.k === "distinct") {
            const texts = cs
              .filter(
                (x) => rawNum(x) === null && !rawError(x) && x.t !== 3 && typeof x.v !== "boolean",
              )
              .map(rawText);
            assert.equal(a.stat.n, new Set(texts).size, `${label}: ${col.ref} distinct`);
            for (const v of a.stat.values as string[])
              assert.ok(
                texts.includes(v),
                `${label}: ${col.ref} lists a value absent from raw: ${v}`,
              );
            checked += 2;
          }
          if (a.type.unique) {
            const vals = cs.map(rawText);
            assert.equal(new Set(vals).size, vals.length, `${label}: ${col.ref} claims unique`);
            checked++;
          }
          if (a.err !== undefined) {
            const n = cs.filter((x) => rawError(x)).length;
            assert.equal(a.err, n, `${label}: ${col.ref} err`);
            checked++;
          }
          if (a.f) {
            const fcells = cells.filter(
              (x) =>
                x.c === c &&
                x.r >= bodyTop &&
                x.r <= bodyEnd &&
                (typeof x.f === "string" && x.f !== ""
                  ? true
                  : x.si !== undefined && x.si !== null && x.si !== ""),
            );
            assert.ok(
              fcells.length >= a.f.count,
              `${label}: ${col.ref} claims f ×${a.f.count} but raw has ${fcells.length} formula cells`,
            );
            for (const a1 of [...a.f.breaks, ...a.f.consts] as string[]) {
              const rc = parseArea(a1)!;
              const hit = cells.find((x) => x.r === rc.r0 && x.c === rc.c0);
              assert.ok(hit, `${label}: ${col.ref} lists ${a1} which holds nothing`);
            }
            for (const a1 of a.f.consts as string[]) {
              const rc = parseArea(a1)!;
              const hit = cells.find((x) => x.r === rc.r0 && x.c === rc.c0)!;
              assert.ok(
                !(typeof hit.f === "string" && hit.f !== "") &&
                  !(hit.si !== undefined && hit.si !== null && hit.si !== ""),
                `${label}: ${col.ref} const ${a1} is a formula`,
              );
            }
            checked += 2;
          }
        }
      }
      if (region.kind === "matrix") {
        const q2 = parseArea(region.range!)!;
        assert.equal(
          (region.attrs.rows as { n: number }).n,
          q2.r1 - q2.r0,
          `${label}: ${region.ref} rows(n)`,
        );
        const [rowsAxis, colsAxis] = region.children!.filter((n) => n.kind === "axis") as [
          OutlineNode,
          OutlineNode,
        ];
        const rb = parseArea(rowsAxis.range!)!;
        const cb = parseArea(colsAxis.range!)!;
        assert.equal(
          rowsAxis.attrs.n,
          nonBlank.filter((x) => inRect(x, rb)).length,
          `${label}: ${region.ref} row-axis n`,
        );
        assert.equal(
          colsAxis.attrs.n,
          nonBlank.filter((x) => inRect(x, cb)).length,
          `${label}: ${region.ref} col-axis n`,
        );
        checked += 2;
      }
      if (region.kind === "kpi") {
        const q1 = parseArea(region.range!)!;
        const cell = nonBlank.filter((x) => inRect(x, q1));
        assert.equal(
          cell.length,
          1,
          `${label}: kpi ${region.ref} must cover exactly one non-blank cell`,
        );
        const rc = cell[0]!;
        const isBool = rc.t === 3 || typeof rc.v === "boolean";
        if (isBool)
          assert.equal(
            region.value!.raw,
            ["1", "true"].includes(rawText(rc).toLowerCase()),
            `${label}: kpi ${region.ref} bool`,
          );
        else if (rawNum(rc) !== null)
          assert.equal(region.value!.raw, rawNum(rc), `${label}: kpi ${region.ref} number`);
        else assert.equal(region.value!.raw, rawText(rc), `${label}: kpi ${region.ref} text`);
        checked++;
      }
      if (region.kind === "form") {
        assert.equal(
          region.attrs.fields,
          region.children!.filter((n) => n.kind === "field").length,
          `${label}: ${region.ref} fields=`,
        );
        for (const f of region.children!.filter((n) => n.kind === "field")) {
          const a = parseArea(f.range!)!;
          const cell = cells.find((x) => x.r === a.r0 && x.c === a.c0);
          assert.ok(cell && !rawBlank(cell), `${label}: field ${f.ref} points at an empty cell`);
          if (f.value) {
            if (rawNum(cell!) !== null) assert.equal(f.value.raw, rawNum(cell!));
            else assert.equal(f.value.raw, rawText(cell!));
          }
          checked++;
        }
      }
      if (region.kind === "text") {
        const parts = nonBlank
          .filter((x) => inRect(x, q))
          .sort((a, b) => a.r - b.r || a.c - b.c)
          .map((x) => (rawNum(x) !== null ? undefined : rawText(x)));
        assert.ok(
          region.name !== undefined && parts.length > 0,
          `${label}: ${region.ref} text without content`,
        );
        checked++;
      }
    }
  });
  return checked;
}
