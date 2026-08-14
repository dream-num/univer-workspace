/**
 * 文本几何:把**渲染器画这段文字时用的那份骨架**读成两个框。
 *
 * 关键取舍:这里**只读，不推导**。渲染缓存里的骨架就是渲染器排出来的那一份,行的位置、
 * 每行的水平对齐位移(`divide.paddingLeft`)、每个字形的位置与墨迹盒(`bBox`)全都是现成的;
 * 垂直对齐位移存在缓存的 `resources.marginTop` 里。旧实现另起炉灶重排一遍再按对齐把结果
 * "摆"进框里——六步推导,每步都可能与渲染器分家,实测已经分家过两次(折行按不折行量、
 * 重排行高 35px 而渲染器画 24px)。
 *
 * 两个框各有各的用途,不再互相冒充:
 * - `box`  排版占位框 = 行盒堆叠 × 推进宽。判「这段文字占多大位置、塞不塞得下」。
 *          它与内容无关:`ooo` 与 `Ágj` 占一样的位。
 * - `ink`  墨迹框 = 所有字形实际落墨范围的并集(`bBox.aba/abd` 是字形真实的上下伸)。
 *          判「看起来有没有压到、有没有出血」。实测与逐像素量出来的字身差 0.3px。
 *
 * 本模块是纯函数:输入是普通数据,不碰 Univer、不碰浏览器,可直接单测。
 */

export interface GeometryBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 字形的墨迹盒:`aba`/`abd` 是这个字形**实际**的上/下伸(`ba`/`bd` 是字体声明的,偏大)。 */
export interface SkeletonGlyphBBox {
  readonly aba?: number;
  readonly abd?: number;
  readonly ba?: number;
  readonly bd?: number;
}

export interface SkeletonGlyph {
  readonly content?: string;
  /** 相对所在 divide 的左偏移。 */
  readonly left?: number;
  /** 推进宽。 */
  readonly width?: number;
  readonly bBox?: SkeletonGlyphBBox;
}

export interface SkeletonDivide {
  readonly left?: number;
  /** 本行的水平对齐位移(居中/靠右都落在这里)。 */
  readonly paddingLeft?: number;
  /** 本行字形的推进宽合计。 */
  readonly glyphGroupWidth?: number;
  readonly glyphGroup?: readonly SkeletonGlyph[];
}

export interface SkeletonLine {
  /** 行盒顶(相对文本矩形原点)。 */
  readonly top?: number;
  /** 行盒高。 */
  readonly lineHeight?: number;
  /** 行盒顶到基线的距离。 */
  readonly asc?: number;
  readonly divides?: readonly SkeletonDivide[];
}

export interface SkeletonData {
  readonly pages?: ReadonlyArray<{
    readonly sections?: ReadonlyArray<{
      readonly columns?: ReadonlyArray<{ readonly lines?: readonly SkeletonLine[] }>;
    }>;
  }>;
}

export interface TextGeometryInput {
  readonly skeleton: SkeletonData;
  /** 垂直对齐位移(渲染缓存 `resources.marginTop`);顶对齐为 0。 */
  readonly verticalOffset: number;
  /** 元素声明框(页面坐标)。 */
  readonly declared: GeometryBox;
  /** 文本框内边距(SDK `textRectPadding`)。 */
  readonly inset: { left: number; top: number; right: number; bottom: number };
  /** 元素旋转角(度)。 */
  readonly angle: number;
}

export interface TextGeometry {
  /** 排版占位框:行盒堆叠 × 推进宽。 */
  readonly box: GeometryBox;
  /** 墨迹框:字形实际落墨的范围。 */
  readonly ink: GeometryBox;
  readonly lineCount: number;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function emptyBounds(): Bounds {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
}

function extend(bounds: Bounds, left: number, top: number, right: number, bottom: number): void {
  bounds.left = Math.min(bounds.left, left);
  bounds.top = Math.min(bounds.top, top);
  bounds.right = Math.max(bounds.right, right);
  bounds.bottom = Math.max(bounds.bottom, bottom);
}

function toBox(bounds: Bounds): GeometryBox | undefined {
  if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top)) {
    return undefined;
  }
  return {
    left: bounds.left,
    top: bounds.top,
    width: Math.max(0, bounds.right - bounds.left),
    height: Math.max(0, bounds.bottom - bounds.top),
  };
}

export function linesOf(skeleton: SkeletonData): readonly SkeletonLine[] {
  return (skeleton.pages ?? []).flatMap((page) =>
    (page.sections ?? []).flatMap((section) =>
      (section.columns ?? []).flatMap((column) => column.lines ?? []),
    ),
  );
}

/**
 * 这一行的推进宽。骨架给了 `glyphGroupWidth` 就用它;拿不到就按字形宽求和——
 * 少了这个兜底,字段一旦改名,占位框会**静默塌成零宽**(墨迹框却仍然正确,更难发现)。
 */
function runWidthOf(divide: SkeletonDivide): number {
  if (typeof divide.glyphGroupWidth === "number" && Number.isFinite(divide.glyphGroupWidth)) {
    return divide.glyphGroupWidth;
  }
  return (divide.glyphGroup ?? []).reduce((sum, glyph) => sum + (glyph.width ?? 0), 0);
}

/**
 * 行盒顶到基线的距离。骨架给了 `asc` 就用它;拿不到就取本行字形声明的最大上伸——
 * 少了这个兜底,基线会落到行盒顶上,整段墨迹凭空上移一行的高度。
 */
function ascentOf(line: SkeletonLine): number {
  if (typeof line.asc === "number" && Number.isFinite(line.asc)) {
    return line.asc;
  }
  let ascent = 0;
  for (const divide of line.divides ?? []) {
    for (const glyph of divide.glyphGroup ?? []) {
      ascent = Math.max(ascent, glyph.bBox?.ba ?? glyph.bBox?.aba ?? 0);
    }
  }
  return ascent;
}

/** 空白字形没有墨迹(尾随空格是纯推进、零墨迹),不该把墨迹框撑大。 */
function hasInk(glyph: SkeletonGlyph): boolean {
  const content = glyph.content ?? "";
  if (content.trim() === "") {
    return false;
  }
  const bBox = glyph.bBox;
  if (bBox === undefined) {
    return false;
  }
  const ascent = bBox.aba ?? bBox.ba ?? 0;
  const descent = bBox.abd ?? bBox.bd ?? 0;
  return ascent + descent > 0;
}

/** 子矩形绕元素中心旋转 angle 后取轴对齐包围盒(0 度原样返回)。 */
export function rotateAround(rect: GeometryBox, host: GeometryBox, angle: number): GeometryBox {
  if (angle === 0) {
    return rect;
  }
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = host.left + host.width / 2;
  const cy = host.top + host.height / 2;
  const points = [
    { x: rect.left, y: rect.top },
    { x: rect.left + rect.width, y: rect.top },
    { x: rect.left, y: rect.top + rect.height },
    { x: rect.left + rect.width, y: rect.top + rect.height },
  ].map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * 从渲染器的骨架读出这段文字的两个框(页面坐标,含旋转)。
 * 骨架为空(没有可见字形)时返回 undefined —— 调用方据此决定要不要退回估算。
 */
export function textGeometryOf(input: TextGeometryInput): TextGeometry | undefined {
  const lines = linesOf(input.skeleton);
  if (lines.length === 0) {
    return undefined;
  }

  // 骨架的局部坐标原点 = 文本矩形左上角;垂直对齐位移由渲染缓存给出。
  const originX = input.declared.left + input.inset.left;
  const originY = input.declared.top + input.inset.top + input.verticalOffset;

  const boxBounds = emptyBounds();
  const inkBounds = emptyBounds();

  for (const line of lines) {
    const lineTop = line.top ?? 0;
    const lineHeight = line.lineHeight ?? 0;
    const baseline = lineTop + ascentOf(line);

    for (const divide of line.divides ?? []) {
      const divideX = (divide.left ?? 0) + (divide.paddingLeft ?? 0);
      const runWidth = runWidthOf(divide);
      if (runWidth > 0 || lineHeight > 0) {
        extend(boxBounds, divideX, lineTop, divideX + runWidth, lineTop + lineHeight);
      }

      for (const glyph of divide.glyphGroup ?? []) {
        if (!hasInk(glyph)) {
          continue;
        }
        const bBox = glyph.bBox as SkeletonGlyphBBox;
        const glyphX = divideX + (glyph.left ?? 0);
        const ascent = bBox.aba ?? bBox.ba ?? 0;
        const descent = bBox.abd ?? bBox.bd ?? 0;
        extend(
          inkBounds,
          glyphX,
          baseline - ascent,
          glyphX + (glyph.width ?? 0),
          baseline + descent,
        );
      }
    }
  }

  const box = toBox(boxBounds);
  if (box === undefined) {
    return undefined;
  }
  // 全是空白(如只有一个空格)时墨迹框退化为占位框的零高线,不谎报墨迹。
  const ink = toBox(inkBounds) ?? { left: box.left, top: box.top, width: 0, height: 0 };

  const place = (rect: GeometryBox): GeometryBox =>
    rotateAround(
      {
        left: rect.left + originX,
        top: rect.top + originY,
        width: rect.width,
        height: rect.height,
      },
      input.declared,
      input.angle,
    );

  return { box: place(box), ink: place(ink), lineCount: lines.length };
}
