/** Board operation: active-page full-visible-content or model-resolved region capture. */
import type { FUniver } from "@univerjs/core/facade";
import type { IBoardLayoutAnalysisResult, IBoardRect } from "./preset/index.js";
import { codedError } from "./support.js";
import type { LoadedUnit } from "./units.js";

export interface BoardContentRenderResult {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly pageId: string;
  readonly contentBounds: IBoardRect;
  readonly layoutAnalysis: IBoardLayoutAnalysisResult;
  readonly scale: number;
}

export interface BoardContentRenderOptions {
  readonly region?: IBoardRect;
  readonly elementIds?: readonly string[];
  readonly padding?: number;
  readonly scale?: number;
}

type UniverFacade = ReturnType<typeof FUniver.newAPI>;

export async function renderBoardContent(
  univerAPI: UniverFacade,
  unit: LoadedUnit,
  options: BoardContentRenderOptions = {},
): Promise<BoardContentRenderResult> {
  const board = univerAPI.getBoard(unit.unitId);
  if (!board) {
    throw codedError("RENDER_INTERNAL", `board not found: ${unit.unitId}`);
  }

  const captureBounds = board.resolveCaptureBounds({
    ...(options.region === undefined ? {} : { region: options.region }),
    ...(options.elementIds === undefined ? {} : { elementIds: [...options.elementIds] }),
    ...(options.padding === undefined ? {} : { padding: options.padding }),
  });
  if (captureBounds === false) {
    throw codedError("RENDER_INTERNAL", "Board capture bounds command is unavailable");
  }
  if (!captureBounds.ok) {
    throw codedError("RENDER_TARGET_INVALID", formatBoardCaptureBoundsError(captureBounds));
  }

  const targeted = captureBounds.selector !== "content";
  const screenshot = await board.getScreenshot({
    bounds: captureBounds.bounds,
    ...(targeted ? { scale: options.scale ?? 1 } : {}),
  });
  if (!screenshot) {
    throw codedError(
      "RENDER_TARGET_INVALID",
      `Board renderer could not capture ${formatBounds(captureBounds.bounds)}${targeted ? ` at scale ${formatNumber(options.scale ?? 1)}` : ""}`,
    );
  }
  const layoutAnalysis = board.analyzeRenderedLayout();
  if (!layoutAnalysis) {
    throw codedError("RENDER_INTERNAL", "Board rendered layout analysis is unavailable");
  }

  return {
    dataUrl: screenshot.dataUrl,
    width: screenshot.width,
    height: screenshot.height,
    pageId: screenshot.subUnitId,
    contentBounds: { ...screenshot.contentBounds },
    layoutAnalysis,
    scale: screenshot.scale,
  };
}

function formatBoardCaptureBoundsError(error: {
  readonly code: string;
  readonly elementId?: string;
}): string {
  switch (error.code) {
    case "content-empty":
      return "active Board page has no visible bounded content";
    case "element-hidden":
      return `Board element is hidden: ${error.elementId ?? "unknown"}`;
    case "element-missing":
      return `Board element not found on active page: ${error.elementId ?? "unknown"}`;
    case "element-unbounded":
      return `Board element has no resolved bounds: ${error.elementId ?? "unknown"}`;
    case "elements-empty":
      return "Board element selector is empty";
    case "padding-invalid":
      return "Board capture padding must be a finite non-negative number";
    case "region-invalid":
      return "Board capture region must have finite coordinates and positive size";
    case "selector-conflict":
      return "Board capture accepts either region or element ids, not both";
    default:
      return `Board capture bounds failed: ${error.code}`;
  }
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}

function formatBounds(bounds: IBoardRect): string {
  return `${formatNumber(bounds.left)},${formatNumber(bounds.top)},${formatNumber(bounds.width)},${formatNumber(bounds.height)}`;
}
