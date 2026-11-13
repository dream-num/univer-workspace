// The explicit structure of a workbook (tables, auto filters, defined names, pivot tables) and its objects (conditional
// formats, data validations, charts, images, shapes), read from a snapshot's plugin resources. Pure: snapshot in, data out.
//
// unvdp reads some of these through a live Univer model (Facade `getTableList`, `getConditionalFormattingRules`, ...). The
// exchange binding puts the same data into `snapshot.resources`, so uxl reads it from there and needs no instance.
// Summaries follow dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/server/domains/objects.ts.
import type { Snapshot } from "../engine/types.js";
import type { ExplicitObject, ExplicitRegion, WorkbookStructure } from "./explicit.js";
import { parseNameRanges, type Rect, rectToA1 } from "./ranges.js";

export interface StructureResult {
  structure: WorkbookStructure;
  /** Things that could not be read (a malformed resource); each becomes a warning, never silence. */
  notes: string[];
}

interface IRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}
const rectOf = (r: IRange): Rect => ({
  r0: r.startRow,
  c0: r.startColumn,
  r1: r.endRow,
  c1: r.endColumn,
});
const isRange = (r: unknown): r is IRange => {
  const x = r as Partial<IRange> | null;
  return (
    !!x && [x.startRow, x.startColumn, x.endRow, x.endColumn].every((n) => typeof n === "number")
  );
};

const OPERATORS: Record<string, string> = {
  greaterThan: "gt",
  greaterThanOrEqual: "gte",
  lessThan: "lt",
  lessThanOrEqual: "lte",
  equal: "eq",
  notEqual: "neq",
  between: "between",
  notBetween: "notBetween",
};

/** PivotSubtotalTypeEnum (@univerjs-pro/engine-pivot) as the words of the `values=` list. */
const AGGREGATES: Record<number, string> = {
  1: "avg",
  2: "count",
  3: "countnums",
  4: "max",
  5: "min",
  6: "product",
  7: "stdev",
  8: "stdevp",
  9: "sum",
  10: "var",
  11: "varp",
};

/** ChartTypeBits (@univerjs-pro/engine-chart, enum.d.ts). */
const CHART_TYPES: Record<number, string> = {
  2: "line",
  4: "column",
  1073741828: "stacked column",
  1610612740: "percent stacked column",
  268435460: "bar",
  1342177284: "stacked bar",
  1879048196: "percent stacked bar",
  8: "pie",
  264: "doughnut",
  16: "area",
  1073741840: "stacked area",
  1610612752: "percent stacked area",
  32: "radar",
  64: "scatter",
  128: "combination",
  512: "word cloud",
  1024: "funnel",
  2048: "bubble",
  4096: "relation",
  8192: "waterfall",
  16384: "pareto",
  32768: "sankey",
  65536: "heatmap",
  131072: "boxplot",
  262144: "candlestick",
  524288: "histogram",
  1048576: "treemap",
  2097152: "sunburst",
  4194304: "gauge",
};

/** DrawingTypeEnum (@univerjs/core). */
const DRAWING_IMAGE = 0;
const DRAWING_SHAPE = 1;
const DRAWING_CHART = 2;

function cfSummary(rule: Record<string, unknown>): string {
  const operator = OPERATORS[String(rule.operator)];
  if (rule.type === "highlightCell" && rule.subType === "number" && operator) {
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    return `cellIs ${operator} ${values.join(",")}`;
  }
  if (rule.type === "highlightCell" && rule.subType === "formula") return "formula";
  if (rule.type === "highlightCell" && rule.subType === "duplicateValues") return "duplicate";
  if (rule.type === "highlightCell" && rule.subType === "uniqueValues") return "unique";
  return typeof rule.type === "string" ? rule.type : "other";
}

/** An imported xlsx list is `a,b,c`; rules made through the Facade or UI store a JSON array string. */
function listValues(formula1: string): string[] {
  if (formula1.startsWith("[")) {
    try {
      const values: unknown = JSON.parse(formula1);
      if (Array.isArray(values)) return values.map(String);
    } catch {
      // not JSON: a plain list
    }
  }
  return formula1.replace(/^"|"$/g, "").split(",");
}

function dvSummary(rule: Record<string, unknown>): string {
  const formula1 = typeof rule.formula1 === "string" ? rule.formula1 : undefined;
  if (rule.type === "list" && formula1 !== undefined)
    return formula1.startsWith("=") ? "listFromRange" : `list: ${listValues(formula1).join(",")}`;
  if (rule.type === "checkbox") return "checkbox";
  if (rule.type === "custom") return "custom";
  const kinds: Record<string, string> = {
    decimal: "number",
    whole: "integer",
    date: "date",
    textLength: "textLength",
  };
  return kinds[String(rule.type)] && OPERATORS[String(rule.operator)]
    ? (kinds[String(rule.type)] as string)
    : "other";
}

/** The connected block of non-blank cells around `start`, 4-neighbourhood: the output of a pivot table. */
function blockAround(
  snapshot: Snapshot,
  sheetId: string,
  row: number,
  col: number,
): Rect | undefined {
  const cells = snapshot.sheets[sheetId]?.cellData;
  const filled = (r: number, c: number): boolean => {
    const cell = cells?.[r]?.[c];
    return !!cell && cell.v !== undefined && cell.v !== null && cell.v !== "";
  };
  if (!filled(row, col)) return undefined;
  const seen = new Set<number>();
  const stack: [number, number][] = [[row, col]];
  const rect: Rect = { r0: row, c0: col, r1: row, c1: col };
  const key = (r: number, c: number) => r * 16384 + c;
  while (stack.length) {
    const [r, c] = stack.pop() as [number, number];
    if (r < 0 || c < 0 || seen.has(key(r, c)) || !filled(r, c)) continue;
    seen.add(key(r, c));
    rect.r0 = Math.min(rect.r0, r);
    rect.r1 = Math.max(rect.r1, r);
    rect.c0 = Math.min(rect.c0, c);
    rect.c1 = Math.max(rect.c1, c);
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
  return rect;
}

export function structureOf(snapshot: Snapshot): StructureResult {
  const notes: string[] = [];
  const structure: WorkbookStructure = {
    sheets: snapshot.sheetOrder.map((id) => ({ id, regions: [], objects: [] })),
  };
  const sheetIndex = (id: string) => snapshot.sheetOrder.indexOf(id);
  const owner = (id: string | undefined) => structure.sheets.find((s) => s.id === id);

  const resource = <T>(name: string): T | undefined => {
    const raw = snapshot.resources?.find((r) => r.name === name)?.data;
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      notes.push(`${name} could not be read (malformed JSON); its objects are not listed`);
      return undefined;
    }
  };
  const addObject = (sheetId: string, o: ExplicitObject) => owner(sheetId)?.objects.push(o);
  const addRegion = (sheetId: string, r: ExplicitRegion) => owner(sheetId)?.regions.push(r);
  const clip = (sheetId: string, r: Rect): Rect => {
    const s = snapshot.sheets[sheetId];
    return {
      ...r,
      r1: Math.min(r.r1, (s?.rowCount ?? 1048576) - 1),
      c1: Math.min(r.c1, (s?.columnCount ?? 16384) - 1),
    };
  };

  // tables
  const tables = resource<
    Record<
      string,
      {
        tables?: {
          id: string;
          name: string;
          range: IRange;
          options?: { showHeader?: boolean };
        }[];
      }
    >
  >("SHEET_TABLE_PLUGIN");
  for (const [sheetId, entry] of Object.entries(tables ?? {})) {
    for (const t of entry.tables ?? []) {
      if (!isRange(t.range)) continue;
      const rect = rectOf(t.range);
      addObject(sheetId, { type: "table", id: t.id, ranges: [rect], summary: t.name });
      addRegion(sheetId, {
        kind: "table",
        name: t.name,
        range: rectToA1(rect),
        headerRows: t.options?.showHeader === false ? 0 : 1,
      });
    }
  }

  // auto filters
  const filters = resource<Record<string, { ref?: IRange }>>("SHEET_FILTER_PLUGIN");
  for (const [sheetId, f] of Object.entries(filters ?? {})) {
    if (!f.ref || !isRange(f.ref) || sheetIndex(sheetId) < 0) continue;
    const rect = clip(sheetId, rectOf(f.ref));
    if (rect.r0 > rect.r1 || rect.c0 > rect.c1) continue;
    addObject(sheetId, {
      type: "filter",
      id: `s${sheetIndex(sheetId) + 1}`,
      ranges: [rect],
      summary: "auto filter",
    });
    addRegion(sheetId, { kind: "autofilter", range: rectToA1(rect) });
  }

  // conditional formats and data validations
  const cfs = resource<
    Record<string, { cfId: string; ranges?: IRange[]; rule?: Record<string, unknown> }[]>
  >("SHEET_CONDITIONAL_FORMATTING_PLUGIN");
  for (const [sheetId, rules] of Object.entries(cfs ?? {})) {
    for (const cf of rules) {
      addObject(sheetId, {
        type: "cf",
        id: cf.cfId,
        scope: sheetId,
        ranges: (cf.ranges ?? []).filter(isRange).map(rectOf),
        summary: cfSummary(cf.rule ?? {}),
      });
    }
  }
  const dvs = resource<
    Record<string, { uid: string; ranges?: IRange[] }[] & Record<string, unknown>[]>
  >("SHEET_DATA_VALIDATION_PLUGIN");
  for (const [sheetId, rules] of Object.entries(dvs ?? {})) {
    for (const dv of rules) {
      addObject(sheetId, {
        type: "dv",
        id: dv.uid,
        scope: sheetId,
        ranges: (dv.ranges ?? []).filter(isRange).map(rectOf),
        summary: dvSummary(dv),
      });
    }
  }

  // defined names; built-in `_xlnm.*` names (print area, filter database, ...) are bookkeeping, not structure
  const names = resource<
    Record<string, { id: string; name: string; localSheetId?: string; formulaOrRefString: string }>
  >("SHEET_DEFINED_NAME_PLUGIN");
  for (const n of Object.values(names ?? {})) {
    if (n.name.startsWith("_xlnm.")) continue;
    const locations = (parseNameRanges(n.formulaOrRefString) ?? []).flatMap((p) => {
      const id = snapshot.sheetOrder.find(
        (sid) => snapshot.sheets[sid]?.name?.toLowerCase() === p.sheetName.toLowerCase(),
      );
      return id ? [{ sheetId: id, rect: clip(id, p.rect) }] : [];
    });
    const scope = n.localSheetId && snapshot.sheets[n.localSheetId] ? n.localSheetId : undefined;
    const home = scope ?? locations[0]?.sheetId;
    if (home === undefined) continue;
    addObject(home, {
      type: "name",
      id: n.id,
      ...(scope ? { scope } : {}),
      ranges: locations.filter((l) => l.sheetId === home).map((l) => l.rect),
      summary: n.name,
    });
    for (const l of locations)
      addRegion(l.sheetId, { kind: "definedName", name: n.name, range: rectToA1(l.rect) });
  }

  // pivot tables
  type PivotConfig = {
    targetCellInfo?: { row: number; col: number };
    sourceRangeInfo?: { subUnitId?: string; range?: IRange };
    fieldsConfig?: {
      rowFields?: string[];
      columnFields?: string[];
      filterFields?: string[];
      valueFields?: string[];
      dimension?: Record<string, { displayName?: string; sourceName?: string }>;
      measure?: Record<string, { sourceName?: string; displayName?: string; subtotal?: number }>;
    };
    isEmpty?: boolean;
  };
  const pivots = resource<{
    pivotTableConfigs?: Record<string, Record<string, Record<string, PivotConfig>>>;
  }>("SHEET_PIVOT_TABLE_PLUGIN");
  for (const sheets of Object.values(pivots?.pivotTableConfigs ?? {})) {
    for (const [sheetId, byId] of Object.entries(sheets)) {
      for (const [id, config] of Object.entries(byId)) {
        const f = config.fieldsConfig ?? {};
        const dims = (ids?: string[]) =>
          (ids ?? [])
            .map((i) => f.dimension?.[i]?.sourceName ?? f.dimension?.[i]?.displayName ?? "")
            .filter(Boolean);
        const values = (f.valueFields ?? []).map(
          (i) =>
            `${AGGREGATES[f.measure?.[i]?.subtotal ?? 0] ?? "sum"}(${f.measure?.[i]?.sourceName ?? f.measure?.[i]?.displayName ?? ""})`,
        );
        const parts = [
          ["rows", dims(f.rowFields)],
          ["cols", dims(f.columnFields)],
          ["filters", dims(f.filterFields)],
          ["values", values],
        ] as const;
        const target = config.targetCellInfo;
        const rect =
          config.isEmpty === false && target
            ? blockAround(snapshot, sheetId, target.row, target.col)
            : undefined;
        const summary = [
          ...parts
            .filter(([, list]) => list.length)
            .map(([key, list]) => `${key}=${list.join(",")}`),
          ...(rect ? [] : ["output range unknown"]),
        ].join(" · ");
        const srcSheet = config.sourceRangeInfo?.subUnitId;
        const srcRange = config.sourceRangeInfo?.range;
        const source =
          srcSheet && sheetIndex(srcSheet) >= 0 && srcRange && isRange(srcRange)
            ? `s${sheetIndex(srcSheet) + 1}!${rectToA1(rectOf(srcRange))}`
            : undefined;
        addObject(sheetId, {
          type: "pivot",
          id,
          ranges: rect ? [rect] : [],
          summary,
          ...(source ? { source } : {}),
        });
        if (rect) addRegion(sheetId, { kind: "pivot", range: rectToA1(rect) });
      }
    }
  }

  // drawings: charts, images, shapes
  type Anchor = {
    from?: { column: number; row: number; columnOffset?: number; rowOffset?: number };
    to?: { column: number; row: number; columnOffset?: number; rowOffset?: number };
  };
  const drawings = resource<
    Record<
      string,
      {
        data?: Record<
          string,
          { drawingId: string; drawingType: number; sheetTransform?: Anchor; shapeType?: number }
        >;
      }
    >
  >("SHEET_DRAWING_PLUGIN");
  const charts = resource<
    Record<
      string,
      {
        id: string;
        chartType?: number;
        rangeInfo?: { rangeInfo?: { subUnitId?: string; range?: IRange } };
      }[]
    >
  >("SHEET_CHART_PLUGIN");
  for (const [sheetId, entry] of Object.entries(drawings ?? {})) {
    for (const d of Object.values(entry.data ?? {})) {
      const a = d.sheetTransform;
      // An anchor edge sitting exactly on a cell boundary (offset 0) ends in the previous cell.
      const rect: Rect | undefined = a?.from
        ? {
            r0: a.from.row,
            c0: a.from.column,
            r1: a.to
              ? Math.max(
                  a.from.row,
                  a.to.row - ((a.to.rowOffset ?? 0) === 0 && a.to.row > a.from.row ? 1 : 0),
                )
              : a.from.row,
            c1: a.to
              ? Math.max(
                  a.from.column,
                  a.to.column -
                    ((a.to.columnOffset ?? 0) === 0 && a.to.column > a.from.column ? 1 : 0),
                )
              : a.from.column,
          }
        : undefined;
      const ranges = rect ? [rect] : [];
      if (d.drawingType === DRAWING_CHART) {
        const c = charts?.[sheetId]?.find((x) => x.id === d.drawingId);
        const src = c?.rangeInfo?.rangeInfo;
        const source =
          src?.subUnitId && sheetIndex(src.subUnitId) >= 0 && src.range && isRange(src.range)
            ? `s${sheetIndex(src.subUnitId) + 1}!${rectToA1(rectOf(src.range))}`
            : undefined;
        const kind =
          c?.chartType !== undefined
            ? (CHART_TYPES[c.chartType] ?? `type ${c.chartType}`)
            : "unknown type";
        addObject(sheetId, {
          type: "chart",
          id: d.drawingId,
          ranges,
          summary: `${kind} chart`,
          ...(source ? { source } : {}),
        });
      } else if (d.drawingType === DRAWING_IMAGE)
        addObject(sheetId, { type: "image", id: d.drawingId, ranges, summary: "image" });
      else if (d.drawingType === DRAWING_SHAPE)
        addObject(sheetId, { type: "shape", id: d.drawingId, ranges, summary: "shape" });
    }
  }
  return { structure, notes };
}
