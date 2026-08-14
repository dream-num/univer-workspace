/** sheet 操作:行/列实测 + 单元格溢出捕获,A1 范围出图。 */
import { ICommandService, IUniverInstanceService, type Univer } from "@univerjs/core";
import { SetWorksheetActiveOperation } from "@univerjs/sheets";
import { SheetSkeletonManagerService } from "@univerjs/sheets-ui";
import {
  waitForFormulaShapePresentation,
  waitForStableRenderedImage,
} from "./formula-shape-readiness.js";
import type { LoadedUnit } from "./units.js";
import { codedError, getRender, getScene, settle, withContainerSize } from "./support.js";
import { blitViaViewport } from "./transform.js";

/** 无范围时捕获的行/列上限(防失控输出;要更多请显式给 range)。 */
const DEFAULT_ROW_CAP = 500;
const DEFAULT_COLUMN_CAP = 100;
/** 出图容器边长上限(px);超出说明范围太大,让调用方缩小范围。 */
const MAX_CANVAS_EDGE = 8192;

interface SkeletonLike {
  readonly rowHeightAccumulation?: readonly number[];
  readonly columnWidthAccumulation?: readonly number[];
  readonly rowHeaderWidth?: number;
  readonly columnHeaderHeight?: number;
  readonly overflowCache?: {
    forValue?: (callback: (row: number, column: number, value: unknown) => void) => void;
  };
}

interface WorkbookDataView {
  readonly sheetOrder?: readonly string[];
  readonly sheets?: Record<string, { readonly id?: string; readonly name?: string } | undefined>;
}

export interface A1Range {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/** 最小 A1 区间解析(0 基闭区间;拒绝整行/整列)。 */
export function parseA1(range: string): A1Range {
  const match = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/u.exec(range.trim());
  if (!match) {
    throw codedError("RENDER_TARGET_INVALID", `invalid A1 range: ${range}`);
  }
  const column = (letters: string): number =>
    [...letters.toUpperCase()].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const startColumn = column(match[1]!);
  const startRow = Number(match[2]) - 1;
  const endColumn = match[3] === undefined ? startColumn : column(match[3]);
  const endRow = match[4] === undefined ? startRow : Number(match[4]) - 1;
  if (endRow < startRow || endColumn < startColumn || startRow < 0 || startColumn < 0) {
    throw codedError("RENDER_TARGET_INVALID", `invalid A1 range: ${range}`);
  }
  return { startRow, startColumn, endRow, endColumn };
}

function resolveSheetId(unit: LoadedUnit, sheetName?: string): string | undefined {
  if (sheetName === undefined) {
    return undefined;
  }
  const data = unit.unitData as WorkbookDataView;
  for (const [id, sheet] of Object.entries(data.sheets ?? {})) {
    if (sheet?.name === sheetName) {
      return sheet.id ?? id;
    }
  }
  throw codedError("RENDER_TARGET_INVALID", `sheet not found: ${sheetName}`);
}

async function activateSheet(univer: Univer, unit: LoadedUnit, sheetName?: string): Promise<void> {
  const injector = univer.__getInjector();
  (
    injector.get(IUniverInstanceService) as unknown as { focusUnit?: (id: string) => void }
  ).focusUnit?.(unit.unitId);
  const subUnitId = resolveSheetId(unit, sheetName);
  if (subUnitId !== undefined) {
    injector
      .get(ICommandService)
      .syncExecuteCommand(SetWorksheetActiveOperation.id, { unitId: unit.unitId, subUnitId });
  }
  await settle(60);
}

function currentSkeleton(
  univer: Univer,
  unit: LoadedUnit,
): { skeleton: SkeletonLike; sheetId: string } {
  const render = getRender(univer, unit.unitId);
  const manager = (
    render as unknown as {
      with(dep: unknown): {
        getCurrentSkeleton(): SkeletonLike | null;
        getCurrentParam?: () => { sheetId?: string } | null;
      };
    }
  ).with(SheetSkeletonManagerService);
  const skeleton = manager.getCurrentSkeleton();
  if (!skeleton) {
    throw codedError("RENDER_INTERNAL", "no sheet skeleton");
  }
  const sheetId = manager.getCurrentParam?.()?.sheetId ?? "";
  return { skeleton, sheetId };
}

/** 累计数组 → 单项尺寸(acc[i] 是 0..i 的累计端点)。 */
function sizesFromAccumulation(
  accumulation: readonly number[],
  from: number,
  to: number,
): Array<{ index: number; size: number }> {
  const result: Array<{ index: number; size: number }> = [];
  const last = Math.min(to, accumulation.length - 1);
  for (let i = Math.max(0, from); i <= last; i += 1) {
    result.push({ index: i, size: accumulation[i]! - (i === 0 ? 0 : accumulation[i - 1]!) });
  }
  return result;
}

export interface SheetLayoutCaptureResult {
  readonly sheetId: string;
  readonly bounds: A1Range;
  readonly rows: Array<{ index: number; height: number }>;
  readonly columns: Array<{ index: number; width: number }>;
  readonly overflows: Array<{
    row: number;
    column: number;
    startColumn: number;
    endColumn: number;
  }>;
}

export async function captureSheetLayout(
  univer: Univer,
  unit: LoadedUnit,
  input: { range?: string; sheetName?: string },
): Promise<SheetLayoutCaptureResult> {
  await activateSheet(univer, unit, input.sheetName);
  const { skeleton, sheetId } = currentSkeleton(univer, unit);
  const bounds =
    input.range === undefined
      ? {
          startRow: 0,
          startColumn: 0,
          endRow: DEFAULT_ROW_CAP - 1,
          endColumn: DEFAULT_COLUMN_CAP - 1,
        }
      : parseA1(input.range);
  const rowAccumulation = skeleton.rowHeightAccumulation ?? [];
  const columnAccumulation = skeleton.columnWidthAccumulation ?? [];
  const actualBounds = {
    startRow: bounds.startRow,
    startColumn: bounds.startColumn,
    endRow: Math.min(bounds.endRow, rowAccumulation.length - 1),
    endColumn: Math.min(bounds.endColumn, columnAccumulation.length - 1),
  };
  const rows = sizesFromAccumulation(
    rowAccumulation,
    actualBounds.startRow,
    actualBounds.endRow,
  ).map(({ index, size }) => ({ index, height: size }));
  const columns = sizesFromAccumulation(
    columnAccumulation,
    actualBounds.startColumn,
    actualBounds.endColumn,
  ).map(({ index, size }) => ({ index, width: size }));
  const overflows: SheetLayoutCaptureResult["overflows"] = [];
  skeleton.overflowCache?.forValue?.((row, column, value) => {
    if (row < bounds.startRow || row > bounds.endRow) {
      return;
    }
    if (column < bounds.startColumn || column > bounds.endColumn) {
      return;
    }
    const span = value as { startColumn?: number; endColumn?: number } | undefined;
    overflows.push({
      row,
      column,
      startColumn: span?.startColumn ?? column,
      endColumn: span?.endColumn ?? column,
    });
  });
  return { sheetId, bounds: actualBounds, rows, columns, overflows };
}

export async function renderSheetRange(
  univer: Univer,
  unit: LoadedUnit,
  input: { range: string; sheetName?: string; scale?: number },
): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = input.scale ?? 1;
  await activateSheet(univer, unit, input.sheetName);
  const bounds = parseA1(input.range);
  const { skeleton } = currentSkeleton(univer, unit);
  const rowAcc = skeleton.rowHeightAccumulation ?? [];
  const colAcc = skeleton.columnWidthAccumulation ?? [];
  if (bounds.endRow >= rowAcc.length || bounds.endColumn >= colAcc.length) {
    throw codedError("RENDER_TARGET_INVALID", `range ${input.range} exceeds sheet bounds`);
  }
  const headerLeft = skeleton.rowHeaderWidth ?? 0;
  const headerTop = skeleton.columnHeaderHeight ?? 0;
  const left = headerLeft + (bounds.startColumn === 0 ? 0 : colAcc[bounds.startColumn - 1]!);
  const top = headerTop + (bounds.startRow === 0 ? 0 : rowAcc[bounds.startRow - 1]!);
  const width =
    colAcc[bounds.endColumn]! - (bounds.startColumn === 0 ? 0 : colAcc[bounds.startColumn - 1]!);
  const height =
    rowAcc[bounds.endRow]! - (bounds.startRow === 0 ? 0 : rowAcc[bounds.startRow - 1]!);
  const neededWidth = headerLeft + colAcc[bounds.endColumn]! + 40;
  const neededHeight = headerTop + rowAcc[bounds.endRow]! + 40;
  if (neededWidth > MAX_CANVAS_EDGE || neededHeight > MAX_CANVAS_EDGE) {
    throw codedError(
      "RENDER_TARGET_INVALID",
      `range ${input.range} is too large to render (${Math.round(neededWidth)}x${Math.round(neededHeight)}px > ${MAX_CANVAS_EDGE}px)`,
    );
  }
  // 放大容器让整个范围从原点起可见(全新 unit 无滚动),blit 后恢复。
  const restore = await withContainerSize(neededWidth + 60, neededHeight + 200);
  try {
    const hasFormulaShapes = await waitForFormulaShapePresentation(univer, unit);
    const scene = getScene(univer, unit.unitId);
    const capture = () =>
      blitViaViewport(
        scene,
        { left, top, width, height },
        width * scale,
        height * scale,
        "viewMain",
      );
    return hasFormulaShapes ? await waitForStableRenderedImage(capture) : capture();
  } finally {
    await restore();
  }
}
