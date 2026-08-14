/**
 * scene 坐标 → 主画布 buffer 像素的通用换算。
 * slide 的 scene 与视口同尺寸(main.width/scene.width 即比例);sheet/doc 的 scene 是
 * 内容全幅,画布只是视口——须叠加视口滚动(viewportScrollX/Y)与缩放(scaleX/scaleY),
 * buffer 像素比从 canvas.width / canvas.clientWidth 实测(含 dpr)。
 */
import { codedError, mainCanvas, type SceneLike } from "./support.js";

interface ViewportLike {
  readonly viewportKey?: string;
  readonly viewportScrollX?: number;
  readonly viewportScrollY?: number;
  readonly actualScrollX?: number;
  readonly actualScrollY?: number;
}

interface SceneWithViewports extends SceneLike {
  readonly scaleX?: number;
  readonly scaleY?: number;
  getViewports?: () => readonly ViewportLike[];
}

export interface SceneToBuffer {
  toBufferX(sceneX: number): number;
  toBufferY(sceneY: number): number;
  bufferPerSceneUnitX: number;
  bufferPerSceneUnitY: number;
}

export function sceneToBuffer(scene: SceneLike, mainViewportKeyHint?: string): SceneToBuffer {
  const canvas = mainCanvas();
  const cssToBuffer =
    canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : window.devicePixelRatio;
  const s = scene as SceneWithViewports;
  const scaleX = s.scaleX ?? 1;
  const scaleY = s.scaleY ?? 1;
  const viewports = s.getViewports?.() ?? [];
  const main =
    (mainViewportKeyHint === undefined
      ? undefined
      : viewports.find((v) => v.viewportKey === mainViewportKeyHint)) ??
    viewports.find((v) => (v.viewportKey ?? "").toLowerCase().includes("main")) ??
    viewports[0];
  const scrollX = main?.viewportScrollX ?? main?.actualScrollX ?? 0;
  const scrollY = main?.viewportScrollY ?? main?.actualScrollY ?? 0;
  const perX = scaleX * cssToBuffer;
  const perY = scaleY * cssToBuffer;
  if (!Number.isFinite(perX) || perX <= 0 || !Number.isFinite(perY) || perY <= 0) {
    throw codedError("RENDER_INTERNAL", "cannot resolve scene-to-buffer scale");
  }
  return {
    toBufferX: (sceneX) => (sceneX - scrollX) * perX,
    toBufferY: (sceneY) => (sceneY - scrollY) * perY,
    bufferPerSceneUnitX: perX,
    bufferPerSceneUnitY: perY,
  };
}

/** 用视口换算把 scene 矩形 blit 成 PNG(sheet/doc 用;slide 走 blitSceneRect)。 */
export function blitViaViewport(
  scene: SceneLike,
  rect: { left: number; top: number; width: number; height: number },
  outputWidth: number,
  outputHeight: number,
  mainViewportKeyHint?: string,
): { dataUrl: string; width: number; height: number } {
  const canvas = mainCanvas();
  const transform = sceneToBuffer(scene, mainViewportKeyHint);
  const sx = transform.toBufferX(rect.left);
  const sy = transform.toBufferY(rect.top);
  const sw = rect.width * transform.bufferPerSceneUnitX;
  const sh = rect.height * transform.bufferPerSceneUnitY;
  if (sx < -1 || sy < -1 || sx + sw > canvas.width + 1 || sy + sh > canvas.height + 1) {
    throw codedError(
      "RENDER_TARGET_INVALID",
      `target rect is outside the rendered viewport (${Math.round(sx)},${Math.round(sy)} ${Math.round(sw)}x${Math.round(sh)} vs canvas ${canvas.width}x${canvas.height})`,
    );
  }
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(outputWidth));
  output.height = Math.max(1, Math.round(outputHeight));
  const context = output.getContext("2d");
  if (!context) {
    throw codedError("RENDER_INTERNAL", "no 2d context");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return { dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height };
}
