import { IShapeHostAdapterRegistry } from "@univerjs-pro/engine-shape";
import { FormulaShapeResultStatus, ShapeFormulaService } from "@univerjs-pro/shape-editor";
import { UniverInstanceType, type Univer } from "@univerjs/core";
import { codedError, nextFrames } from "./support.js";
import type { LoadedUnit } from "./units.js";

const FORMULA_READY_TIMEOUT_MS = 3_000;
const STABLE_IMAGE_TIMEOUT_MS = 3_000;
const STABLE_IMAGE_FRAMES = 12;

const HOST_TYPE: Partial<Record<LoadedUnit["unitType"], UniverInstanceType>> = {
  sheet: UniverInstanceType.UNIVER_SHEET,
  doc: UniverInstanceType.UNIVER_DOC,
  slide: UniverInstanceType.UNIVER_SLIDE,
  board: UniverInstanceType.UNIVER_BOARD,
};

/**
 * Formula Shape 的最终文字晚于 Shape 物化。截图只等待目标 Unit 的公式离开 pending；
 * 持续 pending 说明 Source Unit 闭包或计算链不完整，必须显式失败，不能返回空白图。
 */
export async function waitForFormulaShapePresentation(
  univer: Univer,
  unit: LoadedUnit,
  timeoutMs = FORMULA_READY_TIMEOUT_MS,
): Promise<boolean> {
  const injector = univer.__getInjector();
  const hostType = HOST_TYPE[unit.unitType];
  if (hostType === undefined) {
    return false;
  }
  const adapter = injector.get(IShapeHostAdapterRegistry).get(hostType);
  const shapes = (adapter?.listShapesInUnit?.(unit.unitId) ?? []).filter((shape) =>
    shape.shapeData.formulaBinding?.formula.trim(),
  );
  if (shapes.length === 0) {
    return false;
  }

  const service = injector.get(ShapeFormulaService);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resolved = shapes.every((shape) => {
      const result = service.getResult(shape);
      return result !== undefined && result.status !== FormulaShapeResultStatus.PENDING;
    });
    if (resolved) {
      await nextFrames(2);
      return true;
    }
    await nextFrames(1);
  }
  throw codedError(
    "RENDER_INTERNAL",
    `Formula Shape calculation did not settle for unit ${unit.unitId} within ${timeoutMs}ms`,
  );
}

export interface RenderedImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Formula Shape 的终态文字仍可能处于补间动画。连续若干帧像素一致后才返回，
 * 避免固定延时与动画时长耦合。
 */
export async function waitForStableRenderedImage(
  capture: () => RenderedImage,
  timeoutMs = STABLE_IMAGE_TIMEOUT_MS,
): Promise<RenderedImage> {
  const deadline = Date.now() + timeoutMs;
  let previousDataUrl: string | undefined;
  let stableFrames = 0;
  while (Date.now() < deadline) {
    await nextFrames(1);
    const current = capture();
    stableFrames = current.dataUrl === previousDataUrl ? stableFrames + 1 : 1;
    if (stableFrames >= STABLE_IMAGE_FRAMES) {
      return current;
    }
    previousDataUrl = current.dataUrl;
  }
  throw codedError(
    "RENDER_INTERNAL",
    `Formula Shape presentation did not reach stable pixels within ${timeoutMs}ms`,
  );
}
