/** Base operation: prepare the opening active table/view for browser-native DOM + Canvas capture. */
import { IUniverInstanceService, type Univer } from "@univerjs/core";
import type { FUniver } from "@univerjs/core/facade";
import type { LoadedUnit } from "./units.js";
import { codedError, nextFrames } from "./support.js";

const BASE_WORKBENCH_SELECTOR = '[data-u-comp="base-workbench-layout"]';
const BASE_CANVAS_ROOT_SELECTOR = '[data-u-comp="base-canvas-root"]';
const READY_TIMEOUT_MS = 5_000;
const STABLE_LAYOUT_FRAMES = 8;

export interface BaseViewCapturePreparation {
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface BaseLayoutSnapshot extends BaseViewCapturePreparation {
  readonly signature: string;
}

type UniverFacade = ReturnType<typeof FUniver.newAPI>;
type BaseUiFacade = ReturnType<UniverFacade["getBaseUI"]>;

export async function prepareBaseView(
  univer: Univer,
  univerAPI: UniverFacade,
  unit: LoadedUnit,
): Promise<BaseViewCapturePreparation> {
  if (unit.unitType !== "base") {
    throw codedError("RENDER_TARGET_INVALID", `unit ${unit.unitId} is not a Base`);
  }
  if (!univerAPI.getBase(unit.unitId)) {
    throw codedError("RENDER_INTERNAL", `Base not found: ${unit.unitId}`);
  }

  const baseUI = univerAPI.getBaseUI();
  baseUI.stopEditingCell();
  baseUI.setSelection(null);
  await document.fonts.ready;
  await univerAPI.getFormula().onCalculationResultApplied(READY_TIMEOUT_MS);
  // Formula Source Units (especially Sheet UI) may asynchronously take focus while they
  // materialize. Re-activate the Host immediately before capture so BaseRootWorkbench stays
  // mounted; focusUnit does not set the current Unit for non Sheet/Doc/Slide types.
  const instanceService = univer.__getInjector().get(IUniverInstanceService);
  instanceService.focusUnit(unit.unitId);
  instanceService.setCurrentUnitForType(unit.unitId);
  const snapshot = await waitForStableBaseLayout(
    () => readBaseLayout(baseUI, unit.unitId),
    READY_TIMEOUT_MS,
    () => describeBaseLayout(baseUI, unit.unitId),
  );
  return { clip: snapshot.clip };
}

export async function waitForStableBaseLayout(
  read: () => BaseLayoutSnapshot | null,
  timeoutMs = READY_TIMEOUT_MS,
  describeTimeout?: () => unknown,
): Promise<BaseLayoutSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let previousSignature: string | undefined;
  let stableFrames = 0;
  while (Date.now() < deadline) {
    await nextFrames(1);
    const current = read();
    if (current === null) {
      previousSignature = undefined;
      stableFrames = 0;
      continue;
    }
    stableFrames = current.signature === previousSignature ? stableFrames + 1 : 1;
    previousSignature = current.signature;
    if (stableFrames >= STABLE_LAYOUT_FRAMES) {
      return current;
    }
  }
  throw codedError(
    "RENDER_INTERNAL",
    `Base render-ready timed out after ${timeoutMs}ms; active table/view, workbench, canvas, or rendered viewport remained unavailable or unstable` +
      (describeTimeout === undefined ? "" : `; state=${JSON.stringify(describeTimeout())}`),
  );
}

function readBaseLayout(baseUI: BaseUiFacade, unitId: string): BaseLayoutSnapshot | null {
  const tableId = baseUI.getActiveTableId();
  const viewId = baseUI.getActiveViewId();
  const workbench = document.querySelector<HTMLElement>(BASE_WORKBENCH_SELECTOR);
  const canvasRoots = [...document.querySelectorAll<HTMLElement>(BASE_CANVAS_ROOT_SELECTOR)];
  const canvasRoot = canvasRoots.find((candidate) => candidate.dataset.baseUnitId === unitId);
  const expectedCanvasId = `univer-base-main-canvas_${unitId}`;
  const canvas = [...(canvasRoot?.querySelectorAll<HTMLCanvasElement>("canvas") ?? [])].find(
    (candidate) => candidate.id === expectedCanvasId,
  );
  if (!tableId || !viewId || !workbench || !canvasRoot || !canvas) {
    return null;
  }

  const workbenchRect = workbench.getBoundingClientRect();
  const canvasRootRect = canvasRoot.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  if (
    workbenchRect.width <= 0 ||
    workbenchRect.height <= 0 ||
    canvasRootRect.width <= 0 ||
    canvasRootRect.height <= 0 ||
    canvasRect.width <= 0 ||
    canvasRect.height <= 0 ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    return null;
  }

  const x = Math.max(0, workbenchRect.left);
  const y = Math.max(0, workbenchRect.top);
  const right = Math.min(window.innerWidth, workbenchRect.right);
  const bottom = Math.min(window.innerHeight, workbenchRect.bottom);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const clip = { x, y, width, height };
  return {
    clip,
    signature: JSON.stringify({
      tableId,
      viewId,
      clip,
      canvasRoot: rectSignature(canvasRootRect),
      canvas: rectSignature(canvasRect),
      canvasBuffer: { width: canvas.width, height: canvas.height },
    }),
  };
}

function describeBaseLayout(baseUI: BaseUiFacade, unitId: string): unknown {
  const canvasRoots = [...document.querySelectorAll<HTMLElement>(BASE_CANVAS_ROOT_SELECTOR)];
  const canvasRoot = canvasRoots.find((candidate) => candidate.dataset.baseUnitId === unitId);
  const expectedCanvasId = `univer-base-main-canvas_${unitId}`;
  const canvases = [...(canvasRoot?.querySelectorAll<HTMLCanvasElement>("canvas") ?? [])];
  const expectedCanvas = canvases.find((candidate) => candidate.id === expectedCanvasId);
  const workbench = document.querySelector<HTMLElement>(BASE_WORKBENCH_SELECTOR);
  return {
    activeTableId: baseUI.getActiveTableId() ?? null,
    activeViewId: baseUI.getActiveViewId() ?? null,
    workbench: elementSignature(workbench),
    canvasRoots: canvasRoots.map((candidate) => ({
      baseUnitId: candidate.dataset.baseUnitId ?? null,
      rect: elementSignature(candidate),
      canvasIds: [...candidate.querySelectorAll<HTMLCanvasElement>("canvas")].map(
        (canvas) => canvas.id,
      ),
    })),
    expectedCanvas: expectedCanvas
      ? {
          id: expectedCanvas.id,
          rect: elementSignature(expectedCanvas),
          buffer: { width: expectedCanvas.width, height: expectedCanvas.height },
        }
      : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

function elementSignature(element: Element | null): ReturnType<typeof rectSignature> | null {
  return element ? rectSignature(element.getBoundingClientRect()) : null;
}

function rectSignature(rect: DOMRect): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
