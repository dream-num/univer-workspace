/** doc 操作:页框 + 段落框捕获,逐页出图。 */
import { IUniverInstanceService, type Univer } from "@univerjs/core";
import { documentSkeletonLineIterator, type IDocumentSkeletonPage } from "@univerjs/engine-render";
import {
  waitForFormulaShapePresentation,
  waitForStableRenderedImage,
} from "./formula-shape-readiness.js";
import type { LoadedUnit } from "./units.js";
import { codedError, getRender, getScene, settle, withContainerSize } from "./support.js";
import { blitViaViewport } from "./transform.js";

const MAX_CANVAS_EDGE = 8192;

interface DocPageLike {
  /** 纸面尺寸；Modern Doc 为 Infinity，此时按实际内容尺寸裁剪。 */
  readonly pageWidth?: number;
  readonly pageHeight?: number;
  /** 实际已使用的内容尺寸，不等于 Traditional Doc 的固定纸面。 */
  readonly width?: number;
  readonly height?: number;
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginLeft?: number;
  readonly marginRight?: number;
}

/** skeleton 页 → 可截图尺寸；Traditional 用固定纸面，Modern 用实际内容。 */
export function paperSize(page: DocPageLike): { width: number; height: number } {
  const marginLeft = page.marginLeft ?? 0;
  const marginTop = page.marginTop ?? 0;
  const pageWidth = page.pageWidth;
  const pageHeight = page.pageHeight;
  const contentWidth = (page.width ?? 0) + marginLeft + (page.marginRight ?? marginLeft);
  const contentHeight = (page.height ?? 0) + marginTop + (page.marginBottom ?? marginTop);
  return {
    width:
      typeof pageWidth === "number" && Number.isFinite(pageWidth) && pageWidth > 0
        ? pageWidth
        : contentWidth,
    height:
      typeof pageHeight === "number" && Number.isFinite(pageHeight) && pageHeight > 0
        ? pageHeight
        : contentHeight,
  };
}

interface DocSkeletonLike {
  getActualSize(): { actualWidth: number; actualHeight: number };
  getSkeletonData(): { pages?: IDocumentSkeletonPage[] };
}

interface DocumentsComponentLike {
  readonly left?: number;
  readonly top?: number;
  readonly pageMarginTop?: number;
  readonly pageMarginLeft?: number;
  getSkeleton?: () => DocSkeletonLike | null;
}

function docSkeleton(
  univer: Univer,
  unit: LoadedUnit,
): {
  skeleton: DocSkeletonLike;
  component: DocumentsComponentLike;
} {
  (
    univer.__getInjector().get(IUniverInstanceService) as unknown as {
      focusUnit?: (id: string) => void;
    }
  ).focusUnit?.(unit.unitId);
  const component = getRender(univer, unit.unitId).mainComponent as DocumentsComponentLike | null;
  const skeleton = component?.getSkeleton?.();
  if (!component || !skeleton) {
    throw codedError("RENDER_INTERNAL", "no doc skeleton");
  }
  return { skeleton, component };
}

function resolvePageIndexes(pages: readonly DocPageLike[], wanted?: readonly number[]): number[] {
  const all = pages.map((_, index) => index + 1);
  const target = wanted ?? all;
  for (const page of target) {
    if (page < 1 || page > pages.length) {
      throw codedError(
        "RENDER_TARGET_INVALID",
        `doc page ${page} out of range (1..${pages.length})`,
      );
    }
  }
  return [...target];
}

export interface DocLayoutCaptureResult {
  readonly pages: Array<{
    page: number;
    width: number;
    height: number;
    paragraphs: Array<{
      paragraphIndex: number;
      paragraphId?: string;
      top: number;
      height: number;
      width: number;
    }>;
  }>;
}

export async function captureDocLayout(
  univer: Univer,
  unit: LoadedUnit,
  pages?: readonly number[],
): Promise<DocLayoutCaptureResult> {
  await settle(120);
  const { skeleton } = docSkeleton(univer, unit);
  const skeletonPages = skeleton.getSkeletonData().pages ?? [];
  const indexes = resolvePageIndexes(skeletonPages, pages);
  const paragraphs = (
    unit.unitData as {
      readonly body?: {
        readonly paragraphs?: readonly {
          readonly paragraphId?: string;
          readonly startIndex?: number;
        }[];
      };
    }
  ).body?.paragraphs;
  const paragraphIds = new Map(
    (paragraphs ?? [])
      .filter(
        (paragraph): paragraph is { readonly paragraphId?: string; readonly startIndex: number } =>
          typeof paragraph.startIndex === "number",
      )
      .map((paragraph) => [paragraph.startIndex, paragraph.paragraphId] as const),
  );
  const result: DocLayoutCaptureResult["pages"] = [];
  for (const page of indexes) {
    const data = skeletonPages[page - 1]!;
    const groups = new Map<number, { top: number; bottom: number; width: number }>();
    const rootMarginTop = data.marginTop ?? 0;
    documentSkeletonLineIterator([data], {}, ({ line, sectionTop }) => {
      if (typeof line.paragraphIndex !== "number") {
        throw codedError("RENDER_INTERNAL", "doc line is missing paragraph identity");
      }
      const key = line.paragraphIndex;
      // BLOCK lines identify containers; paragraph capture is projected from model paragraph ids.
      if (!paragraphIds.has(key)) return;
      const top = sectionTop - rootMarginTop + (line.top ?? 0);
      const bottom = top + (line.lineHeight ?? 0);
      const width = line.width ?? 0;
      const group = groups.get(key);
      if (group) {
        group.top = Math.min(group.top, top);
        group.bottom = Math.max(group.bottom, bottom);
        group.width = Math.max(group.width, width);
      } else {
        groups.set(key, { top, bottom, width });
      }
    });
    result.push({
      page,
      width: data.width ?? 0,
      height: data.height ?? 0,
      paragraphs: [...groups.entries()]
        .sort(([, a], [, b]) => a.top - b.top)
        .map(([paragraphIndex, group]) => {
          const paragraphId = paragraphIds.get(paragraphIndex);
          return {
            paragraphIndex,
            ...(paragraphId === undefined ? {} : { paragraphId }),
            top: group.top,
            height: group.bottom - group.top,
            width: group.width,
          };
        }),
    });
  }
  return { pages: result };
}

export async function renderDocPage(
  univer: Univer,
  unit: LoadedUnit,
  page: number,
  scale: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  await settle(120);
  const preread = docSkeleton(univer, unit);
  const prePages = preread.skeleton.getSkeletonData().pages ?? [];
  resolvePageIndexes(prePages, [page]);
  // 先按纸面尺寸估算容器需求(尺寸与容器无关);位置必须等 resize 后重读——
  // doc 是水平居中排版,容器变宽 component.left 会跟着变。
  const gapEstimate = preread.component.pageMarginTop ?? 0;
  const targetPaper = paperSize(prePages[page - 1]!);
  let stackHeight = 0;
  for (let i = 0; i < page; i += 1) {
    if (i > 0) stackHeight += gapEstimate;
    stackHeight += paperSize(prePages[i]!).height;
  }
  if (targetPaper.width + 120 > MAX_CANVAS_EDGE || stackHeight + 240 > MAX_CANVAS_EDGE) {
    throw codedError(
      "RENDER_TARGET_INVALID",
      `doc page ${page} lies beyond the renderable area (${Math.round(stackHeight)}px > ${MAX_CANVAS_EDGE}px); render earlier pages or split the document`,
    );
  }
  const restore = await withContainerSize(targetPaper.width + 120, stackHeight + 240);
  try {
    const hasFormulaShapes = await waitForFormulaShapePresentation(univer, unit);
    // resize 后重读几何:居中偏移已按新容器重算。
    const { skeleton, component } = docSkeleton(univer, unit);
    const skeletonPages = skeleton.getSkeletonData().pages ?? [];
    const gapTop = component.pageMarginTop ?? 0;
    let top = component.top ?? 0;
    for (let i = 0; i < page - 1; i += 1) {
      top += paperSize(skeletonPages[i]!).height + gapTop;
    }
    const { width: pageWidth, height: pageHeight } = paperSize(skeletonPages[page - 1]!);
    const left = component.left ?? 0;
    const scene = getScene(univer, unit.unitId);
    const capture = () =>
      blitViaViewport(
        scene,
        { left, top, width: pageWidth, height: pageHeight },
        pageWidth * scale,
        pageHeight * scale,
      );
    return hasFormulaShapes ? await waitForStableRenderedImage(capture) : capture();
  } finally {
    await restore();
  }
}
