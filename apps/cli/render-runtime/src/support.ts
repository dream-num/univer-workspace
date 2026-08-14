/** 页内公共设施:错误码约定、帧等待、scene 访问、画布 blit。 */
import type { Univer } from "@univerjs/core";
import { IRenderManagerService } from "@univerjs/engine-render";

/**
 * 失败约定:reject 的 Error.message 以错误码前缀开头(`CODE: message`),
 * daemon 宿主解析前缀映射为结构化 render 错误。
 */
export function codedError(
  code: "RENDER_UNIT_UNKNOWN" | "RENDER_TARGET_INVALID" | "RENDER_INTERNAL",
  message: string,
): Error {
  return new Error(`${code}: ${message}`);
}

export async function nextFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export async function settle(ms: number): Promise<void> {
  await nextFrames(2);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  await nextFrames(1);
}

export interface SceneObjectLike {
  readonly oKey?: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly angle?: number;
  readonly zIndex?: number;
}

export interface SceneLike {
  readonly width: number;
  readonly height: number;
  getAllObjects(): readonly SceneObjectLike[];
}

export interface RenderLike {
  readonly scene?: SceneLike | null;
  readonly mainComponent?: unknown;
  readonly engine?: { resize?: () => void } | null;
}

export function getRender(univer: Univer, unitId: string): RenderLike {
  const renderManager = univer.__getInjector().get(IRenderManagerService);
  const render = renderManager.getRenderUnitById(unitId);
  if (!render) {
    throw codedError("RENDER_INTERNAL", `no render for unit ${unitId}`);
  }
  return render;
}

/** 等待目标 Unit 的 render 注册完成，避免被页面上的旧/通用 canvas 提前放行。 */
export async function waitForRender(
  univer: Univer,
  unitId: string,
  timeoutMs = 5000,
): Promise<RenderLike> {
  const renderManager = univer.__getInjector().get(IRenderManagerService);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const render = renderManager.getRenderUnitById(unitId);
    if (render) {
      await nextFrames(2);
      return render;
    }
    await settle(60);
  }
  throw codedError(
    "RENDER_INTERNAL",
    `render for unit ${unitId} did not register within ${timeoutMs}ms`,
  );
}

export function getScene(univer: Univer, unitId: string): SceneLike {
  const scene = getRender(univer, unitId).scene;
  if (!scene) {
    throw codedError("RENDER_INTERNAL", `no scene for unit ${unitId}`);
  }
  return scene;
}

/** 找主画布(面积最大的 canvas)。 */
export function mainCanvas(): HTMLCanvasElement {
  const canvases = [...document.querySelectorAll("canvas")];
  const main = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!main) {
    throw codedError("RENDER_INTERNAL", "no canvas in page");
  }
  return main;
}

/**
 * 把主画布中一段 scene 坐标矩形 blit 成独立 PNG。
 * scene 单位 → 画布 buffer 像素:main.width / scene.width(实测自洽含 dpr)。
 */
export function blitSceneRect(
  scene: SceneLike,
  rect: { left: number; top: number; width: number; height: number },
  outputWidth: number,
  outputHeight: number,
  overlaySelector?: string,
): { dataUrl: string; width: number; height: number } {
  const main = mainCanvas();
  const bufferScale = main.width / scene.width;
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(outputWidth));
  output.height = Math.max(1, Math.round(outputHeight));
  const context = output.getContext("2d");
  if (!context) {
    throw codedError("RENDER_INTERNAL", "no 2d context");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(
    main,
    rect.left * bufferScale,
    rect.top * bufferScale,
    rect.width * bufferScale,
    rect.height * bufferScale,
    0,
    0,
    output.width,
    output.height,
  );
  if (overlaySelector) {
    compositeDomCanvasOverlays(context, output, main, scene, rect, overlaySelector);
  }
  return { dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height };
}

export function compositeDomCanvasOverlays(
  context: Pick<CanvasRenderingContext2D, "drawImage">,
  output: Pick<HTMLCanvasElement, "width" | "height">,
  main: HTMLCanvasElement,
  scene: Pick<SceneLike, "width" | "height">,
  rect: { left: number; top: number; width: number; height: number },
  overlaySelector: string,
): void {
  const mainRect = main.getBoundingClientRect();
  if (
    mainRect.width <= 0 ||
    mainRect.height <= 0 ||
    scene.width <= 0 ||
    scene.height <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return;
  }

  const sceneScaleX = mainRect.width / scene.width;
  const sceneScaleY = mainRect.height / scene.height;
  const captureRect = {
    left: mainRect.left + rect.left * sceneScaleX,
    top: mainRect.top + rect.top * sceneScaleY,
    right: mainRect.left + (rect.left + rect.width) * sceneScaleX,
    bottom: mainRect.top + (rect.top + rect.height) * sceneScaleY,
  };
  const captureWidth = captureRect.right - captureRect.left;
  const captureHeight = captureRect.bottom - captureRect.top;
  const outputScaleX = output.width / captureWidth;
  const outputScaleY = output.height / captureHeight;

  document.querySelectorAll<HTMLCanvasElement>(overlaySelector).forEach((canvas) => {
    const canvasRect = canvas.getBoundingClientRect();
    if (
      canvas === main ||
      canvas.width <= 0 ||
      canvas.height <= 0 ||
      canvasRect.width <= 0 ||
      canvasRect.height <= 0
    ) {
      return;
    }

    const left = Math.max(canvasRect.left, captureRect.left);
    const top = Math.max(canvasRect.top, captureRect.top);
    const right = Math.min(canvasRect.right, captureRect.right);
    const bottom = Math.min(canvasRect.bottom, captureRect.bottom);
    if (right <= left || bottom <= top) return;

    const canvasScaleX = canvas.width / canvasRect.width;
    const canvasScaleY = canvas.height / canvasRect.height;
    context.drawImage(
      canvas,
      (left - canvasRect.left) * canvasScaleX,
      (top - canvasRect.top) * canvasScaleY,
      (right - left) * canvasScaleX,
      (bottom - top) * canvasScaleY,
      (left - captureRect.left) * outputScaleX,
      (top - captureRect.top) * outputScaleY,
      (right - left) * outputScaleX,
      (bottom - top) * outputScaleY,
    );
  });
}

/** 轮询等待主画布 CSS 尺寸达到下限(workbench 布局/引擎 resize 是异步的)。 */
export async function waitCanvasAtLeast(
  minWidth: number,
  minHeight: number,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
    if (canvas && canvas.clientWidth >= minWidth && canvas.clientHeight >= minHeight) {
      await nextFrames(2);
      return;
    }
    await settle(60);
  }
  throw codedError(
    "RENDER_INTERNAL",
    `canvas did not reach ${Math.round(minWidth)}x${Math.round(minHeight)} in ${timeoutMs}ms`,
  );
}

/** 临时改容器尺寸并等待引擎画布真正就位;返回恢复函数。 */
export async function withContainerSize(
  width: number,
  height: number,
): Promise<() => Promise<void>> {
  const app = document.getElementById("app");
  if (!app) {
    throw codedError("RENDER_INTERNAL", "no #app container");
  }
  const prevWidth = app.style.width;
  const prevHeight = app.style.height;
  app.style.width = `${Math.ceil(width)}px`;
  app.style.height = `${Math.ceil(height)}px`;
  window.dispatchEvent(new Event("resize"));
  // workbench 有自己的 chrome(工具栏等),画布略小于容器;留 160px 余量下限。
  await waitCanvasAtLeast(Math.max(1, width - 40), Math.max(1, height - 160));
  await settle(120);
  return async () => {
    app.style.width = prevWidth;
    app.style.height = prevHeight;
    window.dispatchEvent(new Event("resize"));
    await settle(60);
  };
}
