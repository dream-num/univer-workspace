import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import { workspaceError } from "./errors.js";
import {
  workspaceRuntimeKey,
  type WorkspaceRuntimeCaller,
  type WorkspaceRuntimeTarget,
} from "./runtime-target.js";
import { createDisplayReader } from "./sheet-lens/engine/display.js";
import { uncachedFormulas } from "./sheet-lens/engine/formulas.js";
import type { Snapshot } from "./sheet-lens/engine/types.js";
import {
  buildOutlineModel,
  elisionLabel,
  findCells,
  findJson,
  pageJson,
  parseRange,
  rangeText,
  readPage,
  renderFind,
  renderGrid,
  renderOutline,
  resolveRect,
  sheetIndexOf,
  sheetLabel,
  structureOf,
  workbookFromData,
  type Content,
  type OutlineModel,
  type OutlineNode,
} from "./sheet-lens/lens/index.js";
import type { Workbook } from "./sheet-lens/lens/outline/cells.js";
import { SheetLensError } from "./sheet-lens/platform/errors.js";

export type SheetLensRequest =
  | { op: "outline"; at?: string; from?: string; depth?: 0 | 1 | 2; budget?: number }
  | { op: "read"; range: string; content: Content; max?: number }
  | {
      op: "find";
      terms: string[];
      in: "values" | "formulas";
      caseSensitive: boolean;
      sheets?: string[];
      from?: string;
      max?: number;
    };

export type SheetLensContinuation =
  | { op: "outline"; at: string; from?: string; remaining: number; unit: string }
  | { op: "read"; range: string; remaining: number }
  | { op: "find"; from: string; remaining: number };

export interface SheetLensResult {
  text: string;
  json: unknown;
  next?: SheetLensContinuation;
  warnings: { code: `sheet-lens-${string}`; message: string }[];
  revision: number;
  timings: Record<string, number>;
  cache: "hit" | "miss";
}

export interface WorkspaceSheetLensEngineOptions {
  exportUnitData: WorkspaceContentRuntimeOperations["exportUnitData"];
  maxCachedBytes: number;
  bytesPerJsonByte?: number;
  maxBoxCells?: number;
}

interface PreparedWorkbook {
  runtimeKey: string;
  revision: number;
  snapshot: Snapshot;
  display: Awaited<ReturnType<typeof createDisplayReader>>;
  workbook: Workbook;
  uncached: Record<string, number>;
  warnings: SheetLensResult["warnings"];
  estimatedBytes: number;
  model?: OutlineModel;
}

// Forced-GC ledger measurements and the rerun command are recorded in sheet-lens/README.md.
const DEFAULT_BYTES_PER_JSON_BYTE = 12;

export class WorkspaceSheetLensEngine {
  private readonly entries = new Map<string, PreparedWorkbook>();
  private readonly preparing = new Map<string, Promise<PreparedWorkbook>>();
  private cachedBytes = 0;
  private readonly bytesPerJsonByte: number;

  constructor(private readonly options: WorkspaceSheetLensEngineOptions) {
    this.bytesPerJsonByte = options.bytesPerJsonByte ?? DEFAULT_BYTES_PER_JSON_BYTE;
    if (!Number.isFinite(options.maxCachedBytes) || options.maxCachedBytes < 0)
      throw workspaceError(
        "workspace-argument-invalid",
        "maxCachedBytes must be finite and non-negative",
      );
    if (
      options.maxBoxCells !== undefined &&
      (!Number.isSafeInteger(options.maxBoxCells) || options.maxBoxCells <= 0)
    )
      throw workspaceError(
        "workspace-argument-invalid",
        "maxBoxCells must be a positive safe integer",
      );
    if (!Number.isFinite(this.bytesPerJsonByte) || this.bytesPerJsonByte <= 0)
      throw workspaceError(
        "workspace-argument-invalid",
        "bytesPerJsonByte must be finite and positive",
      );
  }

  async run(
    target: WorkspaceRuntimeTarget,
    caller: WorkspaceRuntimeCaller,
    request: SheetLensRequest,
  ): Promise<SheetLensResult> {
    const start = performance.now();
    if (target.unitType !== "sheet")
      throw workspaceError(
        "workspace-sheet-lens-unit-type-unsupported",
        `Sheet Lens does not support Unit type '${target.unitType}'; use inspect for this Unit`,
      );
    validateRequest(request);
    const key = `${workspaceRuntimeKey(target, caller)}:revision:${target.revision}`;
    let entry = this.entries.get(key);
    const cache = entry ? "hit" : "miss";
    const timings = { exportMs: 0, prepareMs: 0, operationMs: 0, totalMs: 0 };
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      let pending = this.preparing.get(key);
      if (!pending) {
        pending = this.prepare(target, caller, timings).finally(() => this.preparing.delete(key));
        this.preparing.set(key, pending);
      }
      entry = await pending;
    }
    const operationAt = performance.now();
    const body = runRequest(entry, request, this.options.maxBoxCells);
    timings.operationMs = performance.now() - operationAt;
    timings.totalMs = performance.now() - start;
    return {
      ...body,
      warnings: [...entry.warnings, ...(body.warnings ?? [])].map((warning) => ({ ...warning })),
      revision: target.revision,
      timings,
      cache,
    };
  }

  private async prepare(
    target: WorkspaceRuntimeTarget,
    caller: WorkspaceRuntimeCaller,
    timings: SheetLensResult["timings"],
  ): Promise<PreparedWorkbook> {
    const exportAt = performance.now();
    const runtimeKey = workspaceRuntimeKey(target, caller);
    const key = `${runtimeKey}:revision:${target.revision}`;
    const exported = await this.options.exportUnitData({ target, caller });
    timings.exportMs = performance.now() - exportAt;
    if (!("sheetOrder" in exported) || !("sheets" in exported))
      throw workspaceError(
        "workspace-sheet-lens-unit-type-unsupported",
        "Expected Sheet Unit data; use inspect for this Unit",
      );
    const preparedAt = performance.now();
    const estimatedBytes = Math.ceil(
      Buffer.byteLength(JSON.stringify(exported)) * this.bytesPerJsonByte,
    );
    const display = await createDisplayReader(exported);
    const { structure, notes } = structureOf(exported);
    const uncached = uncachedFormulas(exported);
    const warnings: SheetLensResult["warnings"] = notes.map((message) => ({
      code: "sheet-lens-structure-unreadable",
      message,
    }));
    for (const [id, count] of Object.entries(uncached))
      warnings.push({
        code: "sheet-lens-uncached-formulas",
        message: `sheet ${exported.sheets[id]?.name ?? id} has ${count} formula cells without cached values; use execute to trigger calculation`,
      });
    const entry: PreparedWorkbook = {
      runtimeKey,
      revision: target.revision,
      snapshot: exported,
      display,
      workbook: workbookFromData(exported, target.unitId, display, structure, {
        maxBoxCells: this.options.maxBoxCells ?? 500_000,
      }),
      uncached,
      warnings,
      estimatedBytes,
    };
    if (estimatedBytes > this.options.maxCachedBytes) {
      warnings.push({
        code: "sheet-lens-not-cached",
        message: `Unit estimated at ${estimatedBytes} bytes exceeds the ${this.options.maxCachedBytes}-byte cache budget; result is not cached`,
      });
    } else {
      for (const [cachedKey, previous] of this.entries) {
        if (previous.runtimeKey === runtimeKey && previous.revision < target.revision) {
          this.entries.delete(cachedKey);
          this.cachedBytes -= previous.estimatedBytes;
        }
      }
      while (this.cachedBytes + estimatedBytes > this.options.maxCachedBytes) {
        const oldest = this.entries.entries().next().value;
        if (!oldest) break;
        this.entries.delete(oldest[0]);
        this.cachedBytes -= oldest[1].estimatedBytes;
      }
      this.entries.set(key, entry);
      this.cachedBytes += estimatedBytes;
    }
    timings.prepareMs = performance.now() - preparedAt;
    return entry;
  }
}

function validateRequest(request: SheetLensRequest): void {
  if (request.op === "outline") {
    if (request.depth !== undefined && ![0, 1, 2].includes(request.depth))
      throw new SheetLensError("E_USAGE", "outline depth must be 0, 1 or 2");
    if (request.budget !== undefined && (!Number.isFinite(request.budget) || request.budget <= 0))
      throw new SheetLensError("E_USAGE", "outline budget must be finite and positive");
  } else {
    if (request.max !== undefined && (!Number.isSafeInteger(request.max) || request.max <= 0))
      throw new SheetLensError("E_USAGE", "max must be a positive integer");
    if (
      request.op === "find" &&
      (!request.terms.length || request.terms.some((term) => term.length === 0))
    )
      throw new SheetLensError("E_USAGE", "find needs at least one non-empty term");
  }
}

function firstCut(root: OutlineNode): OutlineNode | undefined {
  let level = [root];
  while (level.length) {
    const cut = level.find((node) => node.elided);
    if (cut) return cut;
    level = level.flatMap((node) => node.children ?? []);
  }
  return undefined;
}

function runRequest(
  entry: PreparedWorkbook,
  request: SheetLensRequest,
  maxBoxCells = 500_000,
): Pick<SheetLensResult, "text" | "json" | "next"> & Partial<Pick<SheetLensResult, "warnings">> {
  const snapshot = entry.snapshot;
  switch (request.op) {
    case "outline": {
      entry.model ??= buildOutlineModel(entry.workbook, { uncached: entry.uncached, maxBoxCells });
      const warnings: SheetLensResult["warnings"] = [];
      for (const message of entry.model.notes) {
        if (message === "empty sheet" || message.endsWith(": empty sheet")) continue;
        warnings.push({
          code: message.includes("too large")
            ? "sheet-lens-sheet-too-large"
            : message.includes("blank-rendering")
              ? "sheet-lens-blank-cells"
              : "sheet-lens-outline-note",
          message: message.includes("too large")
            ? `${message}; read it page by page with read, or locate cells with find`
            : message,
        });
      }
      const rendered = renderOutline(entry.model, {
        ref: request.at,
        from: request.from,
        depth: request.depth,
        budget: request.budget,
      });
      const result: Pick<SheetLensResult, "text" | "json" | "next"> = {
        text: rendered.text,
        json: rendered.json,
      };
      if (rendered.degraded) {
        const sheets = (rendered.json.children ?? []).filter(
          (node) => node.kind === "sheet" && node.attrs.regions !== undefined,
        );
        const first = sheets[0];
        if (first?.ref)
          result.next = { op: "outline", at: first.ref, remaining: sheets.length, unit: "sheets" };
      } else {
        const cut = firstCut(rendered.json);
        if (cut?.elided)
          result.next = {
            op: "outline",
            at: cut.elided.zoom,
            ...(cut.elided.from !== undefined ? { from: cut.elided.from } : {}),
            remaining: cut.elided.count,
            unit: elisionLabel(cut),
          };
      }
      return { ...result, warnings };
    }
    case "read": {
      const spec = parseRange(request.range);
      const index = sheetIndexOf(snapshot, spec.sheet, request.range);
      const sheet = entry.workbook.sheets[index];
      if (!sheet) throw new SheetLensError("E_SHEET_NOT_FOUND", `no sheet for '${request.range}'`);
      const page = readPage(snapshot, sheet, resolveRect(spec, sheet), spec.area, {
        content: request.content,
        maxCells: request.max ?? 500,
      });
      return {
        text: renderGrid(snapshot, sheet, page),
        json: pageJson(page),
        ...(page.next
          ? {
              next: {
                op: "read",
                range: rangeText(page.sheet, page.next),
                remaining: page.remaining,
              } satisfies SheetLensContinuation,
            }
          : {}),
      };
    }
    case "find": {
      const selected =
        request.sheets === undefined
          ? undefined
          : [...new Set(request.sheets.map((key) => sheetIndexOf(snapshot, key, key)))].sort(
              (a, b) => a - b,
            );
      const from = request.from === undefined ? undefined : findFrom(snapshot, request.from);
      const sheets =
        selected === undefined
          ? entry.workbook.sheets
          : entry.workbook.sheets.filter((sheet) => selected.includes(sheet.index));
      const found = findCells(sheets, {
        terms: request.terms,
        in: request.in,
        caseSensitive: request.caseSensitive,
        ...(from ? { from } : {}),
        max: request.max ?? 50,
      });
      return {
        text: renderFind(found, request),
        json: {
          ...findJson(found, request),
          from: request.from ?? null,
          sheets:
            selected?.map((i) => snapshot.sheets[snapshot.sheetOrder[i] ?? ""]?.name ?? null) ??
            null,
        },
        ...(found.next
          ? {
              next: {
                op: "find",
                from: `${sheetLabel(found.next.sheet)}!${found.next.ref}`,
                remaining: found.total - found.hits.length,
              } satisfies SheetLensContinuation,
            }
          : {}),
      };
    }
  }
}

function findFrom(snapshot: Snapshot, text: string): { sheet: number; r: number; c: number } {
  const spec = parseRange(text);
  const { r0, c0, r1, c1 } = spec.rect;
  if (spec.kind !== "cells" || r0 !== r1 || c0 !== c1)
    throw new SheetLensError("E_RANGE", `from expects one cell such as Sheet1!D7, got '${text}'`);
  return { sheet: sheetIndexOf(snapshot, spec.sheet, text), r: r0, c: c0 };
}
