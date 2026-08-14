/** 类型无关文本量字:公开链路 DocumentDataModel → DocumentViewModel → DocumentSkeleton。 */
import { DocumentDataModel, LocaleService, type IDocumentData, type Univer } from "@univerjs/core";
import { DocumentSkeleton, DocumentViewModel } from "@univerjs/engine-render";
import { codedError } from "./support.js";

/**
 * 无约束时的排版画布宽。必须是 Infinity:有限宽度会让 getActualSize 把
 * 页宽当实测宽返回(实测坐实),Infinity 才回真实文本排版宽。
 */
const UNBOUNDED_WIDTH = Infinity;

export interface MeasureTextResult {
  /** 文字真正占的宽:骨架里**最宽那一行的字形宽之和**,不是页宽/列宽。 */
  readonly actualWidth: number;
  readonly actualHeight: number;
  readonly lineCount: number;
  /** 首行 ascent(px):行内所有字形 ascent 的最大值,骨架里现成。 */
  readonly firstLineAscent: number;
  /** 首行 descent(px):同上,骨架里现成(`line.dsc`)。 */
  readonly firstLineDescent: number;
}

/** 骨架内部形状(engine-render 未导出这些结构,按实测字段读)。 */
interface SkeletonGlyph {
  readonly width?: number;
}
interface SkeletonDivide {
  readonly width?: number;
  readonly glyphGroup?: readonly SkeletonGlyph[];
}
interface SkeletonLine {
  readonly divides?: readonly SkeletonDivide[];
  /** 行内所有字形 ascent / descent 的最大值 —— 渲染器画字时读的就是它们。 */
  readonly asc?: number;
  readonly dsc?: number;
}
interface SkeletonData {
  readonly pages?: ReadonlyArray<{
    readonly sections?: ReadonlyArray<{
      readonly columns?: ReadonlyArray<{ readonly lines?: readonly SkeletonLine[] }>;
    }>;
  }>;
}

function linesOf(skeleton: DocumentSkeleton): readonly SkeletonLine[] {
  try {
    const data = (skeleton as unknown as { getSkeletonData(): SkeletonData }).getSkeletonData();
    return (data.pages ?? []).flatMap((page) =>
      (page.sections ?? []).flatMap((section) =>
        (section.columns ?? []).flatMap((column) => column.lines ?? []),
      ),
    );
  } catch {
    return [];
  }
}

/** 一行的宽 = 这行所有字形的宽之和(divide.width 是列宽,不是字宽)。 */
function lineWidth(line: SkeletonLine): number {
  return (line.divides ?? []).reduce(
    (sum, divide) =>
      sum + (divide.glyphGroup ?? []).reduce((inner, glyph) => inner + (glyph.width ?? 0), 0),
    0,
  );
}

/**
 * 首行的 ascent:骨架里现成 —— 渲染器画每个字形时读的就是同一个 `line.asc`
 * (`draw()` 里 `const { asc, dsc } = line`),所以这里读出来的与实际画出来的同源。
 * 不要用字号 × 某个常数去推:ascent 跟该行实际用到的字体走(渲染器取行内所有字形
 * ascent 的最大值,跨 fallback 字体),实测本机 STHeiti 0.775em ~ PingFang SC 1.05em。
 *
 * **只回 asc,不回 `top + marginTop + paddingTop + asc`**:padding 取决于本次量字所用
 * 文档的 section 配置,与调用方真正要渲染的容器未必是同一分支 —— 实测量字 doc 走
 * gridType=LINES 的加 padding 分支(把 lineSpacing 喂进来时 padding 甚至为负),而
 * slide shape text 的 UNSPECIFIED flavor 里 paddingTop 恒 0。把 padding 一起回,等于
 * 把量字 doc 自己的排版当成调用方的排版。
 */
function firstLineAscentOf(lines: readonly SkeletonLine[]): number {
  return lines[0]?.asc ?? 0;
}

/** 首行 descent:同 {@link firstLineAscentOf},骨架直读。 */
function firstLineDescentOf(lines: readonly SkeletonLine[]): number {
  return lines[0]?.dsc ?? 0;
}

/** 排版用的列宽(所有行共用);拿不到就返回 undefined。 */
function columnWidth(lines: readonly SkeletonLine[]): number | undefined {
  for (const line of lines) {
    const width = line.divides?.[0]?.width;
    if (typeof width === "number" && Number.isFinite(width)) {
      return width;
    }
  }
  return undefined;
}

function layout(univer: Univer, doc: IDocumentData, pageWidth: number): DocumentSkeleton {
  const prepared: IDocumentData = {
    ...doc,
    documentStyle: {
      ...doc.documentStyle,
      pageSize: { width: pageWidth, height: UNBOUNDED_WIDTH },
      // 这四个边距**不起作用**(实测:设 0 与设 200,列宽都是 pageWidth − 133.33px)。留着是
      // 为了不改动文档语义;真正的列宽落差由下面的自标定吃掉。
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    },
  };
  const docModel = new DocumentDataModel(prepared);
  const viewModel = new DocumentViewModel(docModel);
  const localeService = univer.__getInjector().get(LocaleService);
  const skeleton = DocumentSkeleton.create(viewModel, localeService);
  skeleton.calculate();
  return skeleton;
}

export function measureText(
  univer: Univer,
  input: { doc: Record<string, unknown>; wrapWidth?: number },
): MeasureTextResult {
  const doc = input.doc as unknown as IDocumentData;
  if (typeof doc !== "object" || doc === null || typeof doc.body !== "object") {
    throw codedError("RENDER_TARGET_INVALID", "measureText requires IDocumentData with a body");
  }

  const wrapWidth = input.wrapWidth;
  let skeleton = layout(univer, doc, wrapWidth ?? UNBOUNDED_WIDTH);

  if (wrapWidth !== undefined && Number.isFinite(wrapWidth)) {
    // 排版列比传进去的页宽窄一截(实测恒 133.33px:引擎内部烘死的落差,documentStyle 的边距
    // 改不动它)。不硬编码那个数字——先排一遍读回真实列宽,把落差补回去再排一遍,列宽就正好
    // 等于文本框宽。少了这一步,420px 的框会按 287px 折行,三行字排成四行。
    const measuredColumn = columnWidth(linesOf(skeleton));
    if (measuredColumn !== undefined && measuredColumn > 0) {
      const gutter = wrapWidth - measuredColumn;
      if (gutter > 0) {
        skeleton = layout(univer, doc, wrapWidth + gutter);
      }
    }
  }

  const lines = linesOf(skeleton);
  const size = skeleton.getActualSize();
  // getActualSize().actualWidth 在有限页宽下回的是**列宽**,与文字无关(实测:"AAA BBB" 在
  // 800 列里报 667,字其实只有 141)。所以宽只信骨架里最宽那一行的字形宽。
  const widest = lines.length === 0 ? size.actualWidth : Math.max(...lines.map(lineWidth));
  return {
    actualWidth: widest,
    actualHeight: size.actualHeight,
    lineCount: lines.length,
    firstLineAscent: firstLineAscentOf(lines),
    firstLineDescent: firstLineDescentOf(lines),
  };
}
