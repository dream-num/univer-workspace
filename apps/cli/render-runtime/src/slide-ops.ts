/** slide 操作:布局捕获(声明 vs 渲染 bbox + 文本实测 + z 序)与逐页出图。 */
import { ICommandService, IUniverInstanceService, type Univer } from "@univerjs/core";
import { getEmbedSlidesFloatingCustomData, SetActiveSlideCommand } from "@univerjs-pro/slides";
import { SLIDE_PAGE_RECT_KEY } from "@univerjs-pro/slides-ui";
import {
  waitForFormulaShapePresentation,
  waitForStableRenderedImage,
} from "./formula-shape-readiness.js";
import { measureText } from "./measure.js";
import { rotateAround, textGeometryOf, type SkeletonData } from "./text-geometry.js";
import type { LoadedUnit } from "./units.js";
import {
  blitSceneRect,
  codedError,
  getScene,
  nextFrames,
  settle,
  type SceneLike,
  type SceneObjectLike,
} from "./support.js";

interface SlideTransformView {
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
}

interface SlideFillView {
  readonly color?: string;
  readonly fillType?: string;
  readonly opacity?: number;
  readonly gradientStops?: ReadonlyArray<{ readonly color?: string }>;
  readonly fillImageSource?: string;
}

interface SlideStrokeView {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
  readonly lineStrokeType?: string;
  readonly dashType?: string;
}

interface ShapeTextView {
  readonly text?: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly ha?: number | string;
  readonly va?: number | string;
  /** 折行开关(SDK 落库默认 "none";折行文本框写 "square")。 */
  readonly textWrap?: string;
  readonly dataModel?: {
    readonly doc?: unknown;
    readonly ha?: number | string;
    readonly va?: number | string;
  };
}

interface ShapeDataView {
  readonly shapeType?: string;
  readonly isTextBox?: boolean;
  readonly fill?: SlideFillView;
  readonly stroke?: SlideStrokeView;
  readonly shapeText?: ShapeTextView;
  readonly textRectPadding?: {
    readonly left?: number;
    readonly top?: number;
    readonly right?: number;
    readonly bottom?: number;
  };
}

interface SlideElementView {
  readonly custom?: Record<string, unknown>;
  readonly id?: string;
  readonly type?: string;
  readonly name?: string;
  readonly visible?: boolean;
  readonly transform?: SlideTransformView;
  readonly text?: string;
  readonly textData?: unknown;
  readonly source?: string;
  readonly shapeData?: ShapeDataView;
  readonly connectorData?: ShapeDataView;
}

interface SlidePageView {
  readonly id?: string;
  readonly elementOrder?: readonly string[];
  readonly elements?: Record<string, SlideElementView | undefined>;
  readonly pageSize?: { readonly width?: number; readonly height?: number };
}

interface SlideDeckView {
  readonly defaultPageSize?: { readonly width?: number; readonly height?: number };
  readonly slideOrder?: readonly string[];
  readonly slides?: Record<string, SlidePageView | undefined>;
}

interface TextCacheProbe {
  _documentTextRenderCache?: {
    resources?: {
      skeleton?: {
        getActualSize(): { actualWidth: number; actualHeight: number };
        /** 渲染器排出来的那份骨架(行/字形/位置全在里面)。 */
        getSkeletonData?: () => unknown;
      };
      actualHeight?: number;
      width?: number;
      /** 垂直对齐位移:顶对齐为 0,居中/靠下由渲染器算好存这里。 */
      marginTop?: number;
    };
  };
}

const PAINT_TIMEOUT_MS = 3000;
const SLIDE_EMBED_CANVAS_SELECTOR = "[data-embed-slides-floating-object-host] canvas";

function deckOf(unit: LoadedUnit): SlideDeckView {
  return unit.unitData as SlideDeckView;
}

/** 解析 1 起页号列表(缺省全部页),返回 [页号, pageId]。 */
function resolvePages(unit: LoadedUnit, pages?: readonly number[]): Array<[number, string]> {
  const order = deckOf(unit).slideOrder ?? [];
  const wanted = pages ?? order.map((_, index) => index + 1);
  return wanted.map((page) => {
    const pageId = order[page - 1];
    if (pageId === undefined) {
      throw codedError(
        "RENDER_TARGET_INVALID",
        `slide page ${page} out of range (1..${order.length})`,
      );
    }
    return [page, pageId];
  });
}

async function activatePage(univer: Univer, unit: LoadedUnit, pageId: string): Promise<void> {
  const injector = univer.__getInjector();
  const instanceService = injector.get(IUniverInstanceService) as unknown as {
    focusUnit?: (unitId: string) => void;
  };
  instanceService.focusUnit?.(unit.unitId);
  const commandService = injector.get(ICommandService);
  commandService.syncExecuteCommand(SetActiveSlideCommand.id, {
    unitId: unit.unitId,
    subUnitId: pageId,
  });
  await settle(60);
}

function drawingPrefix(unit: LoadedUnit, pageId: string): string {
  return `slide-drawing-${unit.unitId}-${pageId}-`;
}

/** 该页含文本的元素 id 集(等待绘制时用:文本布局缓存须填充)。 */
function textElementIds(page: SlidePageView | undefined): Set<string> {
  const ids = new Set<string>();
  for (const [id, element] of Object.entries(page?.elements ?? {})) {
    if (!element) {
      continue;
    }
    const hasText =
      (typeof element.text === "string" && element.text !== "") ||
      element.textData !== undefined ||
      (element.shapeData?.shapeText !== undefined &&
        (element.shapeData.shapeText.text !== "" ||
          element.shapeData.shapeText.dataModel !== undefined));
    if (hasText) {
      ids.add(id);
    }
  }
  return ids;
}

/** 等待激活页绘制完成:所有含文本元素的布局缓存填充,或超时后尽力而为。 */
async function waitPagePaint(scene: SceneLike, unit: LoadedUnit, pageId: string): Promise<void> {
  const prefix = drawingPrefix(unit, pageId);
  const wanted = textElementIds(deckOf(unit).slides?.[pageId]);
  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await nextFrames(2);
    const objects = scene.getAllObjects();
    let pending = 0;
    for (const object of objects) {
      const key = object.oKey ?? "";
      if (!key.startsWith(prefix)) {
        continue;
      }
      const elementId = key.slice(prefix.length);
      if (!wanted.has(elementId)) {
        continue;
      }
      const cache = (object as TextCacheProbe)._documentTextRenderCache;
      if (cache?.resources?.skeleton === undefined) {
        pending += 1;
      }
    }
    if (pending === 0 && objects.some((o) => (o.oKey ?? "").startsWith(prefix))) {
      return;
    }
    if (wanted.size === 0 && objects.length > 0) {
      await settle(30);
      return;
    }
  }
}

async function waitForSlideEmbedCanvases(unit: LoadedUnit, pageId: string): Promise<boolean> {
  const expectedCount = Object.values(deckOf(unit).slides?.[pageId]?.elements ?? {}).filter(
    (element) => element && getEmbedSlidesFloatingCustomData(element) !== undefined,
  ).length;
  if (expectedCount === 0) return false;

  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const canvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(SLIDE_EMBED_CANVAS_SELECTOR),
    );
    const readyCanvases = canvases.filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
    });
    if (readyCanvases.length >= expectedCount) {
      await nextFrames(2);
      return true;
    }
    await nextFrames(1);
  }

  const hostCount = document.querySelectorAll("[data-embed-slides-floating-object-host]").length;
  const canvasCount = document.querySelectorAll(SLIDE_EMBED_CANVAS_SELECTOR).length;
  const embedRootCount = document.querySelectorAll('[data-embed-float-dom="true"]').length;
  throw codedError(
    "RENDER_INTERNAL",
    `Slide Embed canvases did not materialize for unit ${unit.unitId} page ${pageId} within ${PAINT_TIMEOUT_MS}ms` +
      ` (hosts=${hostCount}, embedRoots=${embedRootCount}, canvases=${canvasCount}, expected=${expectedCount})`,
  );
}

function pageRectOf(scene: SceneLike): SceneObjectLike {
  const objects = scene.getAllObjects();
  const pageRect =
    objects.find((object) => (object.oKey ?? "") === SLIDE_PAGE_RECT_KEY) ??
    objects.find((object) => (object.oKey ?? "").startsWith("slide-page-background"));
  if (!pageRect) {
    throw codedError("RENDER_INTERNAL", "slide page rect not found in scene");
  }
  return pageRect;
}

export interface LayoutBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideElementLayout {
  elementId: string;
  elementType: string;
  /** 形状子类型(rect / ellipse / line …),非形状元素没有。 */
  shapeType?: string;
  name?: string;
  /** 模型里显式 visible:false 才为 false。 */
  visible?: boolean;
  /** 模型声明的框(= 普通 inspect 看到的几何)。 */
  declared: LayoutBox;
  rotation: number;
  /** 场景 z 序(捕获内部保留:lint 容器判定用;不进 CLI 输出)。 */
  zIndex: number;
  fill?: { type?: string; color?: string; opacity?: number };
  stroke?: { type?: string; color?: string; width?: number; opacity?: number };
  /** 图片来源(截断,只用于辨识)。 */
  imageSource?: string;
  text?: {
    content: string;
    /** 墨迹框:字形实际落墨的范围(页面坐标,含旋转)。判「看起来有没有压到、有没有出血」。 */
    ink: LayoutBox;
    lineCount: number;
    /** 文字颜色(compile-svg 把 `<text opacity>` 烘进颜色,故淡色文字是 `rgba(...)`)。 */
    color?: string;
    /** 从颜色读出的不透明度;不透明(1)时不报。 */
    opacity?: number;
    align?: { horizontal?: string; vertical?: string };
    /** 文本框内边距(SDK textRectPadding),模型未写则为 0。 */
    inset?: { left: number; top: number; right: number; bottom: number };
  };
}

export interface SlideLayoutCaptureResult {
  readonly pages: Array<{
    page: number;
    pageId: string;
    pageWidth: number;
    pageHeight: number;
    elements: SlideElementLayout[];
  }>;
}

const H_ALIGN: Record<number, string> = { 1: "left", 2: "center", 3: "right", 4: "justified" };
const V_ALIGN: Record<number, string> = { 1: "top", 2: "middle", 3: "bottom" };

function alignName(
  value: number | string | undefined,
  table: Record<number, string>,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return table[value];
  }
  return undefined;
}

function shapeDataOf(element: SlideElementView | undefined): ShapeDataView | undefined {
  return element?.shapeData ?? element?.connectorData;
}

/** ShapeFillEnum / ShapeLineTypeEnum 是数字枚举,对外报名字(agent 要据此判断元素可不可见)。 */
const FILL_TYPE: Record<number, string> = {
  1: "none",
  2: "solid",
  3: "gradient",
  4: "pattern",
  5: "image",
};
const STROKE_TYPE: Record<number, string> = { 1: "none", 2: "solid", 3: "gradient" };

function typeName(
  value: number | string | undefined,
  table: Record<number, string>,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return table[value];
  }
  return undefined;
}

function fillOf(element: SlideElementView | undefined): SlideElementLayout["fill"] {
  const fill = shapeDataOf(element)?.fill;
  if (fill === undefined) {
    return undefined;
  }
  const type =
    typeName(fill.fillType, FILL_TYPE) ??
    (fill.fillImageSource !== undefined
      ? "image"
      : fill.gradientStops !== undefined
        ? "gradient"
        : fill.color !== undefined
          ? "solid"
          : undefined);
  if (type === "none") {
    return { type: "none" };
  }
  const color = fill.color ?? fill.gradientStops?.[0]?.color;
  if (color === undefined && type === undefined && fill.opacity === undefined) {
    return undefined;
  }
  return {
    ...(type === undefined ? {} : { type }),
    ...(color === undefined ? {} : { color }),
    ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
  };
}

function strokeOf(element: SlideElementView | undefined): SlideElementLayout["stroke"] {
  const stroke = shapeDataOf(element)?.stroke;
  if (stroke === undefined) {
    return undefined;
  }
  const type = typeName(stroke.lineStrokeType, STROKE_TYPE);
  if (type === "none" || stroke.opacity === 0) {
    return { type: "none" };
  }
  if (stroke.color === undefined && stroke.width === undefined && stroke.opacity === undefined) {
    return undefined;
  }
  return {
    ...(type === undefined ? {} : { type }),
    ...(stroke.color === undefined ? {} : { color: stroke.color }),
    ...(stroke.width === undefined ? {} : { width: stroke.width }),
    ...(stroke.opacity === undefined ? {} : { opacity: stroke.opacity }),
  };
}

/** 元素的文本文档(compile-svg 的富文本走 shapeText.dataModel.doc;独立文本框走 textData)。 */
function textDocOf(element: SlideElementView | undefined): Record<string, unknown> | undefined {
  const doc = shapeDataOf(element)?.shapeText?.dataModel?.doc ?? element?.textData;
  return typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : undefined;
}

function plainTextOf(element: SlideElementView | undefined): string {
  const shapeText = shapeDataOf(element)?.shapeText;
  if (typeof shapeText?.text === "string" && shapeText.text !== "") {
    return shapeText.text;
  }
  if (typeof element?.text === "string") {
    return element.text;
  }
  const doc = textDocOf(element) as { body?: { dataStream?: string } } | undefined;
  const stream = doc?.body?.dataStream ?? "";
  return stream.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

/**
 * 文字的颜色与不透明度。facade 的文本样式没有 alpha 字段,compile-svg 把 `<text opacity>`
 * **烘进颜色**成 `rgba(...)`,所以文字自身的透明度只能从颜色里读回来。这里只报值,
 * 怎么解读(对比度够不够、压在一起的两段字算不算问题)由消费方定。
 */
function paintOfText(element: SlideElementView | undefined): {
  color?: string;
  opacity?: number;
} {
  const shapeText = shapeDataOf(element)?.shapeText;
  const doc = textDocOf(element) as
    | { body?: { textRuns?: Array<{ ts?: { cl?: { rgb?: string } } }> } }
    | undefined;
  const color =
    doc?.body?.textRuns?.find((run) => run.ts?.cl?.rgb !== undefined)?.ts?.cl?.rgb ??
    shapeText?.color;
  if (typeof color !== "string") {
    return {};
  }
  const rgba = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/u.exec(color);
  const alpha = rgba?.[1] === undefined ? 1 : Number(rgba[1]);
  return {
    color,
    ...(Number.isFinite(alpha) ? { opacity: alpha } : {}),
  };
}

/** 文档里登记的对齐(compile-svg 写在 documentStyle.renderConfig;其次读 shapeText.ha/va)。 */
function alignOf(element: SlideElementView | undefined): {
  horizontal?: string;
  vertical?: string;
} {
  const doc = textDocOf(element) as
    | {
        documentStyle?: {
          renderConfig?: { horizontalAlign?: number; verticalAlign?: number };
        };
      }
    | undefined;
  const renderConfig = doc?.documentStyle?.renderConfig;
  const shapeText = shapeDataOf(element)?.shapeText;
  const horizontal =
    alignName(renderConfig?.horizontalAlign, H_ALIGN) ??
    alignName(shapeText?.dataModel?.ha ?? shapeText?.ha, H_ALIGN);
  const vertical =
    alignName(renderConfig?.verticalAlign, V_ALIGN) ??
    alignName(shapeText?.dataModel?.va ?? shapeText?.va, V_ALIGN);
  return {
    ...(horizontal === undefined ? {} : { horizontal }),
    ...(vertical === undefined ? {} : { vertical }),
  };
}

/**
 * 这个文本框会折行吗。SDK 落库的 canonical 默认是 `"none"`(compile-svg 的产出恒走这条);
 * 手写 facade 给 CJK 长文本开折行时写 `"square"`。除 "none" 外一律按折行处理——宁可按框宽
 * 排版,也不要把折了行的文字量成一整行。
 */
function wrapsText(element: SlideElementView | undefined): boolean {
  const textWrap = shapeDataOf(element)?.shapeText?.textWrap;
  return typeof textWrap === "string" && textWrap.toLowerCase() !== "none";
}

function insetOf(element: SlideElementView | undefined): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const padding = shapeDataOf(element)?.textRectPadding;
  return {
    left: padding?.left ?? 0,
    top: padding?.top ?? 0,
    right: padding?.right ?? 0,
    bottom: padding?.bottom ?? 0,
  };
}

/**
 * 文本墨迹框,**直接读渲染器画这段字时用的那份骨架**(不重排、不按对齐摆位)。
 *
 * 骨架里什么都有:行的位置与行盒高、每行的水平对齐位移(`divide.paddingLeft`)、每个字形的
 * 位置与实际墨迹盒;垂直对齐位移在缓存的 `resources.marginTop` 里。旧实现是"另起炉灶重排一遍
 * 再摆进框里"的六步推导,与渲染器分家过两次(折行按不折行量 / 重排行高 35px 而渲染器画 24px)。
 * 排版占位框(box)留在 textGeometryOf 内部(空白文本的墨迹锚点),不进捕获契约。
 */
function textBoxesOf(
  object: SceneObjectLike,
  element: SlideElementView | undefined,
  declared: LayoutBox,
  angle: number,
): { ink: LayoutBox; lineCount: number } | undefined {
  const cache = (object as TextCacheProbe)._documentTextRenderCache;
  const skeleton = cache?.resources?.skeleton;
  if (skeleton?.getSkeletonData === undefined) {
    return undefined;
  }
  let data: SkeletonData;
  try {
    data = skeleton.getSkeletonData() as SkeletonData;
  } catch {
    return undefined;
  }
  return textGeometryOf({
    skeleton: data,
    // 垂直位移只取 marginTop。缓存里另有 `contentVerticalOffset` / `opticalVerticalOffset`,
    // 它们由**交互式形状编辑器**的视觉居中(`shapeTextOpticalVerticalAlign`)驱动;CLI 产出的
    // deck 从不开这个开关,实测两者恒为 0。哪天有人手写 facade 打开它,文本的竖向位置会偏,
    // 那时把它们加进来——但要先确认它们与 marginTop 同坐标系,别盲目相加。
    verticalOffset: cache?.resources?.marginTop ?? 0,
    declared,
    inset: insetOf(element),
    angle,
  });
}

/**
 * 兜底:渲染器还没画过这段字(缓存里没有骨架)时,自己量一遍并按登记的对齐摆位。
 *
 * 这是**降级**路径,只在拿不到真相时才走——`captureSlideLayout` 会先等每个含文本元素的布局
 * 缓存填充(`waitPagePaint`),所以正常不该命中;命中说明那一页没画完(超时)。
 *
 * 降级时 `ink` 只能报估算框(量字给不出字形的墨迹范围)。**不给它加个
 * "degraded" 标记**:多一个字段,消费方就多一条要处理的分支,而这条分支永远该是 0 命中;
 * 真正该做的是别让它命中——它一旦频繁命中,是绘制等待的 bug,不是报告格式的问题。
 */
function estimateTextBoxes(
  univer: Univer,
  element: SlideElementView | undefined,
  declared: LayoutBox,
  angle: number,
  fallback: { width: number; height: number },
): { ink: LayoutBox; lineCount: number } {
  const inset = insetOf(element);
  const rect = {
    left: declared.left + inset.left,
    top: declared.top + inset.top,
    width: Math.max(0, declared.width - inset.left - inset.right),
    height: Math.max(0, declared.height - inset.top - inset.bottom),
  };
  const doc = textDocOf(element);
  let width = fallback.width;
  let height = fallback.height;
  let lineCount = 0;
  if (doc !== undefined) {
    try {
      const measured = measureText(univer, {
        doc,
        ...(wrapsText(element) && rect.width > 0 ? { wrapWidth: rect.width } : {}),
      });
      width = measured.actualWidth;
      if (height <= 0) {
        height = measured.actualHeight;
      }
      lineCount = measured.lineCount;
    } catch {
      // 量不出来就用渲染缓存里的实测尺寸(受容器约束,可能等于框宽)。
    }
  }
  const align = alignOf(element);
  const left =
    align.horizontal === "center"
      ? rect.left + (rect.width - width) / 2
      : align.horizontal === "right"
        ? rect.left + rect.width - width
        : rect.left;
  const top =
    align.vertical === "middle"
      ? rect.top + (rect.height - height) / 2
      : align.vertical === "bottom"
        ? rect.top + rect.height - height
        : rect.top;
  const placed = rotateAround({ left, top, width, height }, declared, angle);
  // 降级路径给不出真墨迹:报按对齐摆位后的估算框。
  return { ink: placed, lineCount };
}

export async function captureSlideLayout(
  univer: Univer,
  unit: LoadedUnit,
  pages?: readonly number[],
): Promise<SlideLayoutCaptureResult> {
  const deck = deckOf(unit);
  const resolved = resolvePages(unit, pages);
  const result: SlideLayoutCaptureResult["pages"] = [];
  for (const [page, pageId] of resolved) {
    await activatePage(univer, unit, pageId);
    const scene = getScene(univer, unit.unitId);
    await waitPagePaint(scene, unit, pageId);
    const pageRect = pageRectOf(scene);
    const pageView = deck.slides?.[pageId];
    const prefix = drawingPrefix(unit, pageId);
    const elements: SlideLayoutCaptureResult["pages"][number]["elements"] = [];
    for (const object of scene.getAllObjects()) {
      const key = object.oKey ?? "";
      if (!key.startsWith(prefix)) {
        continue;
      }
      const elementId = key.slice(prefix.length);
      const element = pageView?.elements?.[elementId];
      const transform = element?.transform ?? {};
      const angle = object.angle ?? 0;
      const cache = (object as TextCacheProbe)._documentTextRenderCache;
      const skeleton = cache?.resources?.skeleton;
      const actual = skeleton?.getActualSize();
      // 页快照里查不到的元素(版式/母版来源)没有可读的声明几何:用场景几何顶上,
      // 否则它们在输出里恒是零框,零信息。
      const declared =
        element !== undefined
          ? {
              left: transform.left ?? 0,
              top: transform.top ?? 0,
              width: transform.width ?? 0,
              height: transform.height ?? 0,
            }
          : {
              left: object.left - pageRect.left,
              top: object.top - pageRect.top,
              width: object.width,
              height: object.height,
            };
      const shapeData = shapeDataOf(element);
      const content = plainTextOf(element);
      const hasText = actual !== undefined || content !== "";
      const text = hasText
        ? (() => {
            // 先读渲染器的骨架(真相);它不在时才退回估算。
            const { ink, lineCount } =
              textBoxesOf(object, element, declared, angle) ??
              estimateTextBoxes(univer, element, declared, angle, {
                width: actual?.actualWidth ?? 0,
                height: cache?.resources?.actualHeight ?? actual?.actualHeight ?? 0,
              });
            const align = alignOf(element);
            const paint = paintOfText(element);
            const padding = shapeData?.textRectPadding;
            return {
              content,
              ink,
              lineCount,
              ...(paint.color === undefined ? {} : { color: paint.color }),
              ...(paint.opacity === undefined || paint.opacity === 1
                ? {}
                : { opacity: paint.opacity }),
              ...(Object.keys(align).length === 0 ? {} : { align }),
              ...(padding === undefined
                ? {}
                : {
                    inset: {
                      left: padding.left ?? 0,
                      top: padding.top ?? 0,
                      right: padding.right ?? 0,
                      bottom: padding.bottom ?? 0,
                    },
                  }),
            };
          })()
        : undefined;
      const fill = fillOf(element);
      const stroke = strokeOf(element);
      elements.push({
        elementId,
        elementType: element?.type ?? "unknown",
        ...(shapeData?.shapeType === undefined ? {} : { shapeType: shapeData.shapeType }),
        ...(element?.name === undefined ? {} : { name: element.name }),
        ...(element?.visible === false ? { visible: false } : {}),
        declared,
        rotation: angle,
        zIndex: object.zIndex ?? 0,
        ...(fill === undefined ? {} : { fill }),
        ...(stroke === undefined ? {} : { stroke }),
        ...(element?.source === undefined ? {} : { imageSource: element.source.slice(0, 80) }),
        ...(text === undefined ? {} : { text }),
      });
    }
    result.push({
      page,
      pageId,
      pageWidth: pageView?.pageSize?.width ?? deck.defaultPageSize?.width ?? pageRect.width,
      pageHeight: pageView?.pageSize?.height ?? deck.defaultPageSize?.height ?? pageRect.height,
      elements,
    });
  }
  return { pages: result };
}

export async function renderSlidePage(
  univer: Univer,
  unit: LoadedUnit,
  page: number,
  scale: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const [resolved] = resolvePages(unit, [page]);
  if (!resolved) {
    throw codedError("RENDER_TARGET_INVALID", `slide page ${page} out of range`);
  }
  const [, pageId] = resolved;
  await activatePage(univer, unit, pageId);
  const scene = getScene(univer, unit.unitId);
  await waitPagePaint(scene, unit, pageId);
  const hasEmbedCanvases = await waitForSlideEmbedCanvases(unit, pageId);
  const hasFormulaShapes = await waitForFormulaShapePresentation(univer, unit);
  const pageRect = pageRectOf(scene);
  const capture = () =>
    blitSceneRect(
      scene,
      { left: pageRect.left, top: pageRect.top, width: pageRect.width, height: pageRect.height },
      pageRect.width * scale,
      pageRect.height * scale,
      SLIDE_EMBED_CANVAS_SELECTOR,
    );
  return hasFormulaShapes || hasEmbedCanvases
    ? await waitForStableRenderedImage(capture)
    : capture();
}
