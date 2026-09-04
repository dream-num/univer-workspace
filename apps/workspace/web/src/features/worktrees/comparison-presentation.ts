import type {
  IUnitComparisonItem,
  IUnitComparisonLeafChange,
  IUnitComparisonResult,
} from "@univerjs-pro/edit-history";

export type ComparisonSide = "left" | "right";
export type ComparisonTone = "delete" | "insert" | "update";

export interface DocumentParagraphAlignment {
  readonly segmentPath?: readonly string[];
  readonly stableId: string;
  readonly leftPosition: number | null;
  readonly rightPosition: number | null;
  readonly leftNativeStableId: string | null;
  readonly rightNativeStableId: string | null;
  readonly presence: "left" | "paired" | "right";
}

/** Canvas-facing shape used by univer-cli's comparison presentation code. */
export interface StructuralDiffItem {
  readonly id: string;
  readonly stableId: string;
  readonly category: string;
  readonly entityType: string;
  readonly parentStableId?: string;
  readonly scope?: {
    readonly entityType: string;
    readonly stableId: string;
  };
  readonly path: readonly string[];
  readonly label: string;
  readonly kind: "delete" | "insert" | "update";
  readonly moved: boolean;
  readonly changes: readonly IUnitComparisonLeafChange[];
  readonly nativeStableIds?: {
    readonly left?: string;
    readonly right?: string;
  };
  readonly position: {
    readonly left: number | null;
    readonly right: number | null;
  };
  readonly values: {
    readonly left?: unknown;
    readonly right?: unknown;
  };
}

export interface DocumentComparisonParagraph {
  readonly stableId: string;
  readonly paragraphId: string;
  readonly structureId?: string;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly value: unknown;
}

export interface DocumentComparisonRow {
  readonly id: string;
  readonly stableId: string;
  readonly kind: "delete" | "equal" | "insert" | "update";
  readonly moved: boolean;
  readonly left: DocumentComparisonParagraph | null;
  readonly right: DocumentComparisonParagraph | null;
}

const EMPTY_DOCUMENT_PARAGRAPH_ALIGNMENT: readonly DocumentParagraphAlignment[] = [];

/** Non-Doc comparisons reuse one empty value so item selection cannot remount the viewer. */
export function documentParagraphAlignmentFromResult(
  result: Pick<IUnitComparisonResult, "productContext">
): readonly DocumentParagraphAlignment[] {
  return result.productContext !== undefined &&
    "paragraphAlignment" in result.productContext
    ? result.productContext.paragraphAlignment
    : EMPTY_DOCUMENT_PARAGRAPH_ALIGNMENT;
}

/** Adapt the public Pro History packet to the canvas model used by univer-cli. */
export function structuralDiffItemsFromResult(
  items: readonly IUnitComparisonItem[]
): StructuralDiffItem[] {
  return items.map((item) => {
    const nativeStableIds = sideNativeStableIds(item);
    return {
      id: item.id,
      stableId: item.stableId,
      category: itemCategory(item),
      entityType: item.entityType,
      ...(item.parentStableId === undefined
        ? {}
        : { parentStableId: item.parentStableId }),
      ...(item.scope === undefined ? {} : { scope: item.scope }),
      path: item.path,
      label: item.displayName ?? item.stableId,
      kind: item.kind,
      moved: item.moved,
      changes: item.changes,
      ...(nativeStableIds === undefined ? {} : { nativeStableIds }),
      position: {
        left: item.locations.left?.position ?? null,
        right: item.locations.right?.position ?? null,
      },
      values: item.values ?? {},
    };
  });
}

function itemCategory(item: IUnitComparisonItem): string {
  if (
    item.parentStableId !== undefined &&
    ["slide-element", "board-element", "field", "record", "view"].includes(
      item.entityType
    )
  ) {
    return `${item.entityType}:${item.parentStableId}`;
  }
  return item.entityType;
}

function sideNativeStableIds(
  item: IUnitComparisonItem
): StructuralDiffItem["nativeStableIds"] {
  const left = item.locations.left?.stableId;
  const right = item.locations.right?.stableId;
  if (
    (left === undefined || left === item.stableId) &&
    (right === undefined || right === item.stableId)
  ) {
    return undefined;
  }
  return {
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
  };
}
