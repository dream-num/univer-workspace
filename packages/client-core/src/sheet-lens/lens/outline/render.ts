// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/render.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// renderOutline: budget-driven breadth-first selection over the OutlineModel, then a pure text rendering of the
// selected JSON tree (spec sections 2, 6, 7, 9). Same model + same options => byte-identical text and json.

import { SheetLensError } from "../../platform/errors.js";
import { rectToA1 } from "../ranges.js";
import { listItem, nameStr, nameText, patternStr, token, trunc } from "./format.js";
import {
  type ColAttrs,
  metaOf,
  type NodeKind,
  type OutlineModel,
  type OutlineNode,
  type StatInfo,
  type TypeInfo,
} from "./model.js";

// ---------------------------------------------------------------- line rendering
export function typeWord(t: TypeInfo): string {
  const parts: string[] = [t.type];
  if (t.mix) parts.push(t.mix.map((m) => `${m.type} ${m.pct}%`).join("/"));
  if (t.numfmt) parts.push(patternStr(t.numfmt));
  if (t.unique) parts.push("unique");
  return parts.join(" ");
}

export function statWord(s: StatInfo): string {
  const of = s.of ? `${s.of} ` : ""; // mixed column: say which family the stat covers
  if (s.k === "range") return `${of}${token(`${s.min.display}..${s.max.display}`)}`;
  if (s.k === "bool") return `${of}true ${s.truePct}%`;
  const list = s.values.map(listItem).join("|") + (s.more ? "…" : "");
  return `${of}${s.n} distinct${s.values.length ? `: ${list}` : ""}`;
}

const listWord = (key: string, items: string[], more: number): string =>
  `${key}: ${items.join(" ")}${more ? ` …+${more}` : ""}`;
const capped = (key: string, l: { items: string[]; more: number }): string =>
  listWord(key, l.items, l.more);
/** Type word plus `scale=1e<n>` when the number format divides by a power of ten (spec 4.8). */
const typeAttrs = (t: TypeInfo): string[] => [
  typeWord(t),
  ...(t.scale ? [`scale=1e${t.scale}`] : []),
];
// formula text is written verbatim unless it would break the attribute grammar (brackets, quotes, ", "), then JSON-quoted
const fTrunc = (f: string): string => token(trunc(f, 60));

export function attrList(n: OutlineNode, showBounds = false): string[] {
  const out: string[] = [];
  if (n.ref) out.push(`ref=${n.ref}`);
  // biome-ignore lint/suspicious/noExplicitAny: attrs is a per-kind bag typed by the model builder; this is its only reader
  const a = n.attrs as Record<string, any>;
  const range = n.range ?? "";
  switch (n.kind) {
    case "workbook":
      out.push(`sheets=${a.sheets}`);
      if (a.active) out.push(`active=${a.active}`);
      break;
    case "sheet":
      if (a.used) out.push(`used=${a.used}`);
      if (a.frozen)
        out.push(
          `frozen=${a.frozen.rows ? `${a.frozen.rows}r` : ""}${a.frozen.cols ? `${a.frozen.cols}c` : ""}`,
        );
      for (const key of ["formulas", "uncached", "errors"] as const)
        if (a[key]) out.push(`${key}=${a[key]}`);
      if (a.regions !== undefined) out.push(`regions=${a.regions}`);
      break;
    case "table":
      out.push(range, `rows=${a.rows}`);
      if (a.header !== undefined) out.push(`header=${a.header}r`);
      if (a.totals !== undefined) out.push(`totals=${a.totals}`);
      if (a.subtotals) out.push(capped("subtotals", a.subtotals));
      if (Array.isArray(a.filter))
        out.push(listWord("filter", (a.filter as string[]).map(token), 0));
      else if (a.filter) out.push("filter");
      break;
    case "matrix":
      out.push(
        range,
        `rows=${listItem(a.rows.label ?? "rows")}(${a.rows.n})`,
        `cols=${a.cols}`,
        typeWord(a.valueType),
      );
      break;
    case "form":
      out.push(range, `fields=${a.fields}`);
      break;
    case "text":
    case "block":
      out.push(range);
      if (a.span) out.push(`span=${a.span.join(" ")}`);
      break;
    case "kpi":
    case "field":
      out.push(range, ...typeAttrs(a.type));
      if (a.f !== undefined) out.push(`f=${fTrunc(a.f)}`);
      if (a.span) out.push(`span=${a.span.join(" ")}`);
      break;
    case "col": {
      const c = a as ColAttrs;
      out.push(range, ...typeAttrs(c.type));
      if (c.stat) out.push(statWord(c.stat));
      if (c.f) {
        out.push(`f=${fTrunc(c.f.pattern)} ×${c.f.count}`);
        if (c.f.breaks.length) out.push(listWord("breaks", c.f.breaks, c.f.breaksMore));
        if (c.f.consts.length) out.push(listWord("const", c.f.consts, c.f.constsMore));
      }
      if (c.fill < 100) out.push(`fill ${c.fill}%`);
      if (c.err) out.push(`err=${c.err}`);
      if (c.span) out.push(`span=${c.span.join(" ")}`);
      if (c.merges) out.push(capped("merges", c.merges));
      if (c.numtext) out.push(`numtext=${c.numtext}`);
      if (c.fmts) out.push(capped("fmts", c.fmts));
      if (c.invisible) out.push(capped("invisible", c.invisible));
      if (c.notes) out.push(capped("notes", c.notes));
      for (const key of ["dv", "cf"] as const) {
        const rules = c[key];
        if (rules)
          out.push(
            `${key}=${token(trunc(rules.items[0] ?? "", 40))}${rules.more ? ` …+${rules.more}` : ""}`,
          );
      }
      if (c.narrow) out.push("narrow");
      break;
    }
    case "axis":
      out.push(
        range,
        typeWord(a.type),
        String(a.n),
        a.values.map(listItem).join("|") + (a.more ? "…" : ""),
      );
      break;
    case "obj":
      if (n.range) out.push(n.range);
      if (a.summary) out.push(token(trunc(a.summary, 120)));
      if (a.source) out.push(`src=${a.source}`);
      break;
    case "objects":
      out.push(...(a.counts as [string, number][]).map(([k, v]) => `${k}=${v}`));
      break;
  }
  if (n.kind !== "objects" && n.kind !== "col") {
    for (const key of ["filtered", "hrows", "hcols", "merged"] as const)
      if (a[key]) out.push(`${key}=${a[key]}`);
    if (a.groups) out.push(capped("groups", a.groups));
    if (a.notes) out.push(`notes=${a.notes}`);
  }
  if (showBounds && a.bounds) {
    const b = a.bounds;
    out.push(
      `data=${b.data ?? "none"}`,
      `header-range=${b.header ?? "none"}`,
      `header-source=${b.headerSource}`,
    );
    if (b.totals) out.push(`totals-candidate=${b.totals}`);
  }
  if (n.kind === "obj" && a.cellRanges?.length !== 1)
    out.push(`cell-ranges=${a.cellRanges?.length ?? 0}`);
  if (n.via) out.push(`via=${n.via}`);
  if (n.hidden) out.push("hidden");
  return out;
}

const REGION_SET = new Set<NodeKind>(["table", "matrix", "form", "text", "kpi", "block"]);

/** Names that identify something and are used as locators: sheets and explicit regions (via=). Printed exactly (RFC 04 section 2). */
const isIdentifier = (n: OutlineNode): boolean => n.kind === "sheet" || n.via !== undefined;

/** Elision label: region groups of a sheet read "regions", everything else uses the omitted kind. */
export const elisionLabel = (n: OutlineNode): string =>
  n.elided && REGION_SET.has(n.elided.kind) && /^s\d+$/.test(n.elided.zoom)
    ? "regions"
    : (n.elided?.kind ?? n.kind);

/** One line (without indent) for a node; elision nodes render as `- … N more <label> [zoom=<ref>]`. */
export function lineOf(n: OutlineNode, showBounds = false): string {
  if (n.elided)
    return `- … ${n.elided.count} more ${elisionLabel(n)} [zoom=${n.elided.zoom}${n.elided.from ? `, from=${n.elided.from}` : ""}${n.elided.range ? `, range=${n.elided.range}` : ""}]`;
  let s = `- ${n.kind}`;
  if (n.kind === "obj") s += ` ${(n.attrs as { objtype: string }).objtype}`;
  if (n.name !== undefined) s += ` ${nameStr(n.name, isIdentifier(n))}`;
  const attrs = attrList(n, showBounds);
  if (attrs.length) s += ` [${attrs.join(", ")}]`;
  if (n.value && n.value.display !== "") s += `: ${trunc(n.value.display)}`;
  return s;
}

export function textOf(root: OutlineNode, showBounds = false): string {
  const lines: string[] = [];
  const walk = (n: OutlineNode, depth: number) => {
    lines.push("  ".repeat(depth) + lineOf(n, showBounds));
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines.join("\n");
}

// ---------------------------------------------------------------- budgeted selection
export interface OutlineOptions {
  /** sheet name, sheet id or sheet ref (s1); omit for the whole workbook */
  sheet?: string | undefined;
  /** any ref in the table (region, col, axis, field) to zoom into; wins over `sheet` */
  ref?: string | undefined;
  /** absolute depth: 0 workbook+sheet, 1 +regions, 2 +col/axis/field/obj. Default 1 for a workbook, 2 when scoped */
  depth?: number | undefined;
  /** approximate character budget (default 6000) of ONE scope: the zoomed node, or each sheet of a workbook. Infinity = unlimited. */
  budget?: number | undefined;
  /** continue a cut listing: the first child of the scope node to show (the `from` of an elision line) */
  from?: string | undefined;
  /** workbook scope: above this many characters the outline lists sheets only (default WORKBOOK_CAP) */
  workbookCap?: number | undefined;
  /** workbook scope: list sheets only, whatever the size (the server falls back to this when a response is too large) */
  sheetsOnly?: boolean | undefined;
}
export interface OutlineRender {
  text: string;
  json: OutlineNode;
  refs: string[];
  /** true when at least one node was elided */
  elided: boolean;
  /** true when a workbook outline was reduced to its sheet lines */
  degraded: boolean;
}
export const DEFAULT_BUDGET = 6000;
export const WORKBOOK_CAP = 50_000;

type Cat = "region" | "objects" | "col" | "axis" | "field" | "obj";
const catOf = (n: OutlineNode): Cat =>
  n.kind === "objects"
    ? "objects"
    : n.kind === "col"
      ? "col"
      : n.kind === "axis"
        ? "axis"
        : n.kind === "field"
          ? "field"
          : n.kind === "obj"
            ? "obj"
            : "region";

// JSON carries the same truncated name as the text (spec 7); value.display keeps the full display text.
const clone = (n: OutlineNode): OutlineNode => {
  // `_c` is the model's own column index (a col's position for its rectangle); it is not part of the output
  const { children: _children, _c: _col, ...rest } = n as OutlineNode & { _c?: number };
  return {
    ...rest,
    ...(n.name !== undefined ? { name: nameText(n.name, isIdentifier(n)) } : {}),
    attrs: { ...n.attrs },
  };
};

function resolveScope(model: OutlineModel, o: OutlineOptions): OutlineNode {
  if (o.ref) {
    const hit = model.byRef.get(o.ref);
    if (!hit)
      throw new SheetLensError(
        "E_REF_NOT_FOUND",
        `no region or sheet with ref '${o.ref}' in this file`,
      );
    return hit;
  }
  if (o.sheet !== undefined) {
    const hit = model.byRef.get(o.sheet) ?? model.root.children?.find((s) => s.name === o.sheet);
    if (hit?.kind !== "sheet")
      throw new SheetLensError("E_REF_NOT_FOUND", `no sheet '${o.sheet}' in this file`, {
        hint: "sheet names are case-sensitive; refs look like s1, s2",
      });
    return hit;
  }
  return model.root;
}

/**
 * The elision nodes for `tail`, the children of `parent` that are not shown: one per kind of child. A tail is always the
 * end of the child list (children are shown in order and listing stops at the first one that does not fit), so
 * `from` (its first member) and `range` (the rectangle its regions cover) say exactly where the rest is.
 * `worst` takes `from` from the last member: the longest ref the line can ever carry, used to reserve room.
 */
function elisions(parent: OutlineNode, tail: OutlineNode[], worst = false): OutlineNode[] {
  const byCat = new Map<Cat, OutlineNode[]>();
  for (const n of tail) byCat.set(catOf(n), [...(byCat.get(catOf(n)) ?? []), n]);
  return [...byCat.values()].map((members) => {
    const kinds = new Set(members.map((m) => m.kind));
    const kind: NodeKind = kinds.size === 1 ? ([...kinds][0] as NodeKind) : "block";
    const elided: NonNullable<OutlineNode["elided"]> = {
      count: members.length,
      kind,
      zoom: parent.ref ?? "wb",
      from: (worst ? members[members.length - 1] : members[0])?.ref as string,
    };
    if (members.every((m) => REGION_SET.has(m.kind) && metaOf(m).rect)) {
      const rects = members.flatMap((m) => {
        const r = metaOf(m).rect;
        return r ? [r] : [];
      });
      elided.range = rectToA1({
        r0: Math.min(...rects.map((r) => r.r0)),
        c0: Math.min(...rects.map((r) => r.c0)),
        r1: Math.max(...rects.map((r) => r.r1)),
        c1: Math.max(...rects.map((r) => r.c1)),
      });
    }
    return { kind, attrs: {}, elided };
  });
}

export function renderOutline(model: OutlineModel, o: OutlineOptions = {}): OutlineRender {
  const scope = resolveScope(model, o);
  const isWorkbook = scope === model.root;
  // uxl departs from unvdp here: a workbook listing only counts objects (`objects [cf=40, chart=1]`), but a listing scoped to
  // a sheet or deeper names them, as `obj` lines within the budget. unvdp has an Object.list call for that; uxl has none, and
  // without it a chart's place and source could not be found at all.
  const depth = o.depth ?? (isWorkbook ? 1 : 2);
  const budget = o.budget ?? DEFAULT_BUDGET;
  const showBounds = Boolean(o.ref);
  const lvl = (n: OutlineNode) => metaOf(n).level;
  // An object is a depth-2 node wherever it hangs (a sheet-level object is a child of the sheet but not a region).
  const children = (n: OutlineNode) =>
    (n.children ?? []).filter((ch) => ch.kind !== "obj" || (!isWorkbook && lvl(ch) <= depth));
  if (o.from !== undefined) {
    if (isWorkbook)
      throw new SheetLensError(
        "E_USAGE",
        "--from needs --sheet or --at: it continues the listing of one sheet or region",
      );
    if (!children(scope).some((ch) => ch.ref === o.from))
      throw new SheetLensError(
        "E_USAGE",
        `'${o.from}' is not a child of the listed node; --from takes the 'from=' value of an elision line`,
      );
  }
  const lineCost = (n: OutlineNode, indent: number) =>
    2 * indent + Array.from(lineOf(clone(n), showBounds)).length + 1;
  /** the children that are listed one by one, in order; a sheet's objects summary is printed outside the budget race */
  const kidsOf = (n: OutlineNode): OutlineNode[] => {
    const list = children(n).filter((ch) => ch.kind !== "objects");
    return n === scope && o.from !== undefined
      ? list.slice(list.findIndex((ch) => ch.ref === o.from))
      : list;
  };
  /** characters of the elision lines for `tail`, plus the `, regions=<n>` a sheet line gains once regions are cut */
  const elisCost = (
    parent: OutlineNode,
    tail: OutlineNode[],
    indent: number,
    worst = false,
  ): number => {
    if (!tail.length) return 0;
    const grows =
      parent.kind === "sheet" && tail.some((n) => REGION_SET.has(n.kind))
        ? `, regions=${children(parent).filter((c) => REGION_SET.has(c.kind)).length}`.length
        : 0;
    return grows + elisions(parent, tail, worst).reduce((sum, e) => sum + lineCost(e, indent), 0);
  };

  const attempt = (sheetsOnly: boolean) => {
    const view = new Map<OutlineNode, OutlineNode>(); // model node -> view node, in admission order
    const indentOf = new Map<OutlineNode, number>();
    const admit = (node: OutlineNode, indent: number) => {
      view.set(node, clone(node));
      indentOf.set(node, indent);
    };

    /** Lists the descendants of `unit` level by level within `budget`; returns the characters its subtree takes. */
    const runUnit = (unit: OutlineNode, indent: number): number => {
      let used = lineCost(unit, indent);
      if (sheetsOnly || depth <= lvl(unit)) return used;
      const objects =
        unit.kind === "sheet" && o.from === undefined
          ? children(unit).find((ch) => ch.kind === "objects")
          : undefined;
      if (objects) {
        used += lineCost(objects, indent + 1);
        admit(objects, indent + 1);
      }
      let pendingDeep = 0; // room kept for the elision lines of listed nodes whose children are not decided yet
      const deepOf = new Map<OutlineNode, number>();
      let parents = [unit];
      let stopped = false;
      for (let L = lvl(unit) + 1; L <= depth && parents.length; L++) {
        const next: OutlineNode[] = [];
        for (const p of parents) {
          pendingDeep -= deepOf.get(p) ?? 0;
          const list = kidsOf(p);
          const ci = (indentOf.get(p) ?? 0) + 1;
          let k = 0;
          if (!stopped) {
            for (; k < list.length; k++) {
              const node = list[k] as OutlineNode;
              const cost = lineCost(node, ci);
              const sub = L < depth ? kidsOf(node) : [];
              const deep = elisCost(node, sub, ci + 1, true);
              const forced = p === unit && L === lvl(unit) + 1 && k === 0; // a page always shows something, so `from` always advances
              if (
                !forced &&
                used + cost + deep + elisCost(p, list.slice(k + 1), ci) + pendingDeep > budget
              ) {
                stopped = true;
                break;
              }
              used += cost;
              if (deep) {
                pendingDeep += deep;
                deepOf.set(node, deep);
              }
              admit(node, ci);
              next.push(node);
            }
          }
          used += elisCost(p, list.slice(k), ci);
        }
        parents = next;
        if (stopped) break;
      }
      return used + pendingDeep;
    };

    admit(scope, 0);
    let total = isWorkbook ? lineCost(scope, 0) : 0;
    for (const unit of isWorkbook ? (scope.children ?? []) : [scope]) {
      if (isWorkbook) admit(unit, 1);
      total += runUnit(unit, isWorkbook ? 1 : 0);
    }
    return { view, total, sheetsOnly };
  };

  let r = attempt(Boolean(o.sheetsOnly));
  if (isWorkbook && !r.sheetsOnly && depth >= 1 && r.total > (o.workbookCap ?? WORKBOOK_CAP))
    r = attempt(true);
  const { view } = r;

  // ---- assemble the view tree: admitted children in model order, one elision node per kind of child that is not shown
  let elided = false;
  for (const [mNode, vNode] of view) {
    const kids = children(mNode);
    const entries: { pos: number; node: OutlineNode }[] = [];
    kids.forEach((ch, pos) => {
      const shown = view.get(ch);
      if (shown) entries.push({ pos, node: shown });
    });
    if (!r.sheetsOnly && lvl(mNode) < depth) {
      const start =
        mNode === scope && o.from !== undefined ? kids.findIndex((ch) => ch.ref === o.from) : 0;
      const byCat = new Map<Cat, { pos: number; admitted: boolean }[]>();
      kids.forEach((ch, pos) => {
        if (pos >= start && ch.kind !== "objects")
          byCat.set(catOf(ch), [...(byCat.get(catOf(ch)) ?? []), { pos, admitted: view.has(ch) }]);
      });
      for (const items of byCat.values()) {
        const missing = items.filter((i) => !i.admitted);
        if (!missing.length) continue;
        elided = true;
        const after = items.filter((i) => i.admitted).map((i) => i.pos);
        entries.push({
          pos: after.length ? Math.max(...after) + 0.5 : (missing[0]?.pos ?? 0) - 0.5,
          node: elisions(
            mNode,
            missing.map((i) => kids[i.pos] as OutlineNode),
          )[0] as OutlineNode,
        });
      }
    }
    entries.sort((a, b) => a.pos - b.pos);
    if (entries.length) vNode.children = entries.map((e) => e.node);
    if (mNode.kind === "sheet") {
      const total = kids.filter((c) => REGION_SET.has(c.kind)).length;
      const shown = entries.filter((e) => REGION_SET.has(e.node.kind) && !e.node.elided).length;
      if (total > shown) vNode.attrs.regions = total;
    }
  }
  const rootView = view.get(scope) as OutlineNode;
  const refs: string[] = [];
  const collect = (n: OutlineNode) => {
    if (n.ref) refs.push(n.ref);
    for (const c of n.children ?? []) collect(c);
  };
  collect(rootView);
  return {
    text: textOf(rootView, showBounds),
    json: rootView,
    refs,
    elided,
    degraded: r.sheetsOnly && isWorkbook && depth >= 1,
  };
}
